import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import dns from 'node:dns'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createHost } from '../dist/host.js'
import { SessionStore } from '../dist/plugins/session-store.js'
import { startFakeSshServer } from '../../../apps/desktop/tests/fake-ssh-server.mjs'

async function until(predicate, description, timeout = 1500) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail(`Timed out waiting for ${description}`)
}

function testCredentials() {
  const key = randomBytes(32)
  return {
    persistent: true,
    seal(plain) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return Buffer.concat([iv, data, cipher.getAuthTag()]).toString('base64')
    },
    unseal(sealed) {
      const value = Buffer.from(sealed, 'base64')
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(-16))
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8')
    },
  }
}

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-host-policy-'))
  const hosts = []
  const alive = new Set(['first', 'second'])
  const events = []
  const bridge = {
    getRenderer: (id) => alive.has(id) ? {
      id, isAlive: () => alive.has(id),
      send: (name, ...params) => { events.push({ id, name, params }); return alive.has(id) },
    } : undefined,
  }
  const options = {
    bridge, hostStoreFile: join(directory, 'hosts.json'),
    secretsFile: join(directory, 'secrets.json'), knownHostsFile: join(directory, 'known_hosts.json'),
    ssh: { readyTimeout: 8000, keepaliveInterval: 0 }, log: false, ...overrides,
  }
  t.after(async () => {
    try { for (const host of hosts) await host.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  const create = async () => { const host = await createHost(options); hosts.push(host); return host }
  return { directory, options, create, alive, events }
}

const connection = (server, clientId = 'first') => ({
  host: server.host, port: server.port, username: server.username, password: server.password, clientId,
})

test('session-only Host ignores remember requests and never persists passwords, passphrases or key paths', async (t) => {
  const f = await fixture(t, { credentials: {
    persistent: false,
    seal: () => { throw new Error('session-only credentials must not be sealed') },
    unseal: () => { throw new Error('session-only credentials must not be unsealed') },
  } })
  const host = await f.create()
  const password = host.saveHost({ host: 'example.test', username: 'demo', password: 'sensitive-password', rememberPassword: true })
  const key = host.saveHost({ host: 'key.test', username: 'demo', authMethod: 'privateKey',
    privateKeyPath: '/private/id_ed25519', passphrase: 'sensitive-key-passphrase', rememberPassword: true })
  assert.equal(password.hasSecret, false)
  assert.equal(key.hasSecret, false)
  assert.equal(key.privateKeyPath, undefined)
  assert.equal(existsSync(f.options.secretsFile), false)
  const metadata = await readFile(f.options.hostStoreFile, 'utf8')
  for (const secret of ['sensitive-password', 'sensitive-key-passphrase', '/private/id_ed25519']) assert.ok(!metadata.includes(secret))
  await host.dispose()
  const restarted = await f.create()
  assert.equal(restarted.listHosts().length, 2)
  assert.ok(restarted.listHosts().every((entry) => !entry.hasSecret && !entry.privateKeyPath))
  restarted.removeHost(password.id)
  assert.equal(existsSync(f.options.secretsFile), false)
})

test('omitting the credential provider defaults to session-only storage', async (t) => {
  const f = await fixture(t)
  const host = await f.create()
  const saved = host.saveHost({ host: 'default.test', username: 'demo', password: 'do-not-save', rememberPassword: true })
  assert.equal(saved.hasSecret, false)
  assert.equal(existsSync(f.options.secretsFile), false)
})

test('session-only Host refuses an existing credential file without changing it', async (t) => {
  const f = await fixture(t)
  const ciphertext = '{"legacy-host":"desktop-encrypted-value"}\n'
  await writeFile(f.options.secretsFile, ciphertext)
  await assert.rejects(f.create(), /凭据|密文|credential/i)
  assert.equal(await readFile(f.options.secretsFile, 'utf8'), ciphertext)
  assert.equal(existsSync(f.options.hostStoreFile), false)
})

test('session-only Host refuses inline legacy ciphertext without migration', async (t) => {
  const f = await fixture(t)
  const metadata = '[{"id":"old","host":"old.test","username":"demo","sealedSecret":"legacy-ciphertext"}]\n'
  await writeFile(f.options.hostStoreFile, metadata)
  await assert.rejects(f.create(), /凭据|密文|credential/i)
  assert.equal(await readFile(f.options.hostStoreFile, 'utf8'), metadata)
  assert.equal(existsSync(f.options.secretsFile), false)
})

test('an explicit persistent provider preserves Desktop credential and key-path storage', async (t) => {
  const f = await fixture(t, { credentials: testCredentials() })
  const host = await f.create()
  const saved = host.saveHost({ host: 'desktop.test', username: 'demo', authMethod: 'privateKey',
    privateKeyPath: '/users/demo/.ssh/id_ed25519', passphrase: 'desktop-key-secret', rememberPassword: true })
  assert.equal(saved.hasSecret, true)
  assert.equal(saved.privateKeyPath, '/users/demo/.ssh/id_ed25519')
  assert.ok(!(await readFile(f.options.secretsFile, 'utf8')).includes('desktop-key-secret'))
  await host.dispose()
  const restarted = await f.create()
  assert.equal(restarted.listHosts()[0].hasSecret, true)
  assert.equal(restarted.internals.ctx.sessionStore.secret(saved.id), 'desktop-key-secret')
})

test('Host construction failure unloads services that were already installed', async (t) => {
  const f = await fixture(t)
  let partialRoot
  const load = SessionStore.prototype.load
  // Observe the real service without replacing its loading or registration behavior.
  t.mock.method(SessionStore.prototype, 'load', function () {
    partialRoot = this.ctx.fiber.parent
    return load.call(this)
  })
  Object.defineProperty(f.options, 'ssh', { get() { throw new Error('invalid SSH configuration') } })
  await assert.rejects(f.create(), /invalid SSH configuration/)
  assert.ok(partialRoot)
  assert.equal(partialRoot.sessionStore, undefined, 'the partially installed store must be unregistered')
  assert.equal(partialRoot.renderer, undefined, 'earlier services must also be unregistered')
})

test('releasing a client closes its quiet SSH sessions and keeps another client connected', { timeout: 10000 }, async (t) => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const host = await f.create()
  await host.openTerminal(connection(server))
  const second = await host.openTerminal(connection(server, 'second'))
  f.alive.delete('first')
  assert.equal(typeof host.releaseClient, 'function')
  host.releaseClient('first')
  host.releaseClient('first')
  await until(() => server.connections === 1, 'quiet SSH client cleanup')
  host.input(second.sessionId, 'still-connected\n')
  await until(() => server.terminal.inputs.length > 0, 'remaining client input')
  assert.equal(host.internals.ctx.ssh.size, 1)
})

test('a renderer that disappears before the opened event cannot leave an orphaned quiet SSH session', { timeout: 10000 }, async (t) => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t, { bridge: {
    getRenderer: (id) => ({ id, isAlive: () => true, send: () => false }),
  } })
  const host = await f.create()
  await assert.rejects(host.openTerminal(connection(server)), /客户端|断开/)
  await until(() => server.connections === 0, 'undeliverable opened-event cleanup')
  assert.equal(host.internals.ctx.ssh.size, 0)
  assert.equal(host.internals.ctx.terminal.size, 0)
})

async function stalledServer(t) {
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('data', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  })
  return { host: '127.0.0.1', port: server.address().port, username: 'demo', password: 'test', sockets }
}

test('releasing a client cancels an unfinished SSH handshake promptly', { timeout: 10000 }, async (t) => {
  const server = await stalledServer(t)
  const f = await fixture(t)
  const host = await f.create()
  let outcome
  const opening = host.openTerminal(connection(server)).then((value) => { outcome = { value } }, (error) => { outcome = { error } })
  await until(() => server.sockets.size === 1, 'SSH handshake socket')
  f.alive.delete('first')
  assert.equal(typeof host.releaseClient, 'function')
  host.releaseClient('first')
  await until(() => outcome, 'cancelled open rejection')
  await opening
  assert.ok(outcome.error)
  await until(() => server.sockets.size === 0, 'cancelled handshake socket cleanup')
  assert.equal(host.internals.ctx.ssh.size, 0)
})

test('Host disposal cancels a handshake and rejects later opens', { timeout: 10000 }, async (t) => {
  const server = await stalledServer(t)
  const f = await fixture(t)
  const host = await f.create()
  let outcome
  const opening = host.openTerminal(connection(server)).then((value) => { outcome = { value } }, (error) => { outcome = { error } })
  await until(() => server.sockets.size === 1, 'SSH handshake before disposal')
  await host.dispose()
  await until(() => outcome, 'disposed open rejection')
  await opening
  assert.ok(outcome.error)
  await until(() => server.sockets.size === 0, 'disposed handshake socket cleanup')
  await assert.rejects(host.openTerminal(connection(server)), /关闭|disposed/i)
})

async function halfOpenProxy(t) {
  const remote = await startFakeSshServer({ greeting: false })
  const sockets = new Set()
  let stalled = false
  const proxy = createServer({ allowHalfOpen: true }, (socket) => {
    const upstream = connect(remote.port, remote.host)
    for (const stream of [socket, upstream]) {
      sockets.add(stream)
      stream.on('error', () => {})
      stream.on('close', () => sockets.delete(stream))
    }
    socket.on('data', (data) => { if (!stalled && !upstream.destroyed) upstream.write(data) })
    upstream.on('data', (data) => { if (!socket.destroyed) socket.write(data) })
    // Deliberately do not forward FIN: an unresponsive peer must not own Host shutdown.
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const port = proxy.address().port
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => proxy.close(resolve))
    await remote.close()
  })
  return {
    host: '127.0.0.1', port, username: remote.username, password: remote.password,
    stall: () => { stalled = true },
    // Observe only this fixture's outgoing client socket; no production introspection hook is needed.
    clients: () => process._getActiveHandles().filter((handle) => handle.remotePort === port),
  }
}

for (const action of ['close', 'releaseClient', 'dispose', 'dispose-after-end']) {
  test(`${action} releases the owned TCP socket even when the SSH peer never acknowledges FIN`, { timeout: 10000 }, async (t) => {
    const proxy = await halfOpenProxy(t)
    const f = await fixture(t)
    const host = await f.create()
    const session = await host.openTerminal(connection(proxy))
    assert.equal(proxy.clients().length, 1)
    proxy.stall()
    if (action === 'dispose-after-end') proxy.clients()[0].end()
    if (action === 'close') host.close(session.sessionId)
    else if (action === 'releaseClient') host.releaseClient('first')
    else await host.dispose()
    await until(() => proxy.clients().length === 0, 'TCP socket destruction without a peer FIN')
  })
}

test('owned socket connection errors reject without leaving a session or unhandled error', { timeout: 10000 }, async (t) => {
  const f = await fixture(t)
  const host = await f.create()
  // DNS proxies may synthesize an IP even for .invalid; inject only the resolver failure.
  const lookup = t.mock.method(dns, 'lookup', (_hostname, _options, callback) => {
    process.nextTick(callback, Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))
  })
  await assert.rejects(host.openTerminal({ host: 'unresolvable.test', port: 22,
    username: 'demo', password: 'test', clientId: 'first' }), /无法解析/)
  lookup.mock.restore()
  const listener = createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  await assert.rejects(host.openTerminal({ host: '127.0.0.1', port,
    username: 'demo', password: 'test', clientId: 'first' }), /拒绝连接/)
  assert.equal(host.internals.ctx.ssh.size, 0)
  assert.equal(host.internals.ctx.terminal.size, 0)
})

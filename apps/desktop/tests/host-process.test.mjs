import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { encodeWire, decodeWire } from '@pureterm/protocol'
import { startHostProcess } from '../dist/electron/runtime/host-process.js'
import { startFakeSshServer } from './fake-ssh-server.mjs'
import { connection, rendererFixture, until } from './integration-helpers.mjs'

const entry = fileURLToPath(new URL('../dist/electron/host/entry.js', import.meta.url))
const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const processExists = (pid) => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

async function wireClient(url) {
  const address = new URL(url)
  address.protocol = 'ws:'
  address.pathname = '/ws'
  const socket = new WebSocket(address)
  const messages = []
  socket.addEventListener('message', event => messages.push(decodeWire(JSON.parse(event.data))))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 3000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket open failed')) }, { once: true })
  })
  let sequence = 0
  return {
    messages,
    get connected() { return socket.readyState === WebSocket.OPEN },
    async call(method, params = []) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket disconnected')
      const id = ++sequence
      socket.send(JSON.stringify(encodeWire({ kind: 'call', id, method, params })))
      const reply = await until(() => {
        const found = messages.find(message => message.kind === 'reply' && message.id === id)
        if (found) return found
        if (socket.readyState === WebSocket.CLOSED) throw new Error('WebSocket disconnected')
        return undefined
      }, `reply to ${method}`)
      if (!reply.ok) throw new Error(reply.error)
      return reply.value
    },
    notice(name, params = []) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket disconnected')
      socket.send(JSON.stringify(encodeWire({ kind: 'notice', name, params })))
    },
    output(sessionId) {
      return Buffer.concat(messages.filter(message => message.kind === 'event' && message.name === 'terminal:data' && message.params[0] === sessionId).map(message => {
        assert.ok(message.params[1] instanceof Uint8Array)
        return Buffer.from(message.params[1])
      }))
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return
      socket.close()
      await until(() => socket.readyState === WebSocket.CLOSED, 'WebSocket close')
    },
  }
}

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-host-process-'))
  const crypto = rendererFixture().bridge
  const children = []
  const clients = []
  const picked = []
  const exits = []
  const gates = []
  const options = {
    entry, dataDir: directory, execPath: process.execPath,
    credentials: { persistent: true, seal: async plain => crypto.seal(plain), unseal: async sealed => crypto.unseal(sealed) },
    pickPrivateKey: async clientId => { picked.push(clientId); return { path: '/fixture/id_ed25519', encrypted: true } },
    onExit: error => exits.push(error),
    startupTimeoutMs: 3000, shutdownTimeoutMs: 500,
    ...overrides,
  }
  t.after(async () => {
    for (const gate of gates) gate.resolve()
    try {
      for (const client of clients) await client.close().catch(() => {})
      for (const child of children) await child.dispose()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  return {
    directory, crypto, picked, exits, options,
    gate() { const gate = Promise.withResolvers(); gates.push(gate); return gate },
    async start(extra = {}) { const child = await startHostProcess({ ...options, ...extra }); children.push(child); return child },
    async client(child) { const client = await wireClient(child.url); clients.push(client); return client },
  }
}

test('Desktop child returns a loopback Web Host URL and a separate bearer token', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const child = await f.start({ env: { ...process.env, NODE_OPTIONS: '--require=pureterm-nonexistent-preload', NODE_PATH: '/must-not-be-inherited' } })
  const address = new URL(child.url)
  assert.ok(child.pid > 0)
  assert.notEqual(child.pid, process.pid)
  assert.equal(address.protocol, 'http:')
  assert.equal(address.hostname, '127.0.0.1')
  assert.ok(Number(address.port) > 0)
  assert.ok(Buffer.from(child.desktopToken, 'base64url').length >= 24)
  assert.notEqual(child.desktopToken, address.searchParams.get('token'))
  const client = await f.client(child)
  assert.deepEqual(await client.call('app:capabilities'), { credentialPersistence: 'encrypted', privateKeyPicker: 'native' })
  assert.deepEqual(await client.call('ssh:pick-private-key'), { path: '/fixture/id_ed25519', encrypted: true })
  assert.equal(f.picked.length, 1)
  assert.match(f.picked[0], /^ws:/)
  await child.dispose()
  await child.dispose()
  assert.equal(processExists(child.pid), false)
  assert.deepEqual(f.exits, [])
})

test('disabling attached browser access removes the browser token from the Desktop child URL', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const child = await f.start({ browserAccess: false })
  const address = new URL(child.url)
  assert.equal(address.search, '')
  assert.ok(Buffer.from(child.desktopToken, 'base64url').length >= 24)
  assert.equal((await fetch(child.url)).status, 401)
})

test('Desktop Web Host preserves encrypted credentials across restart and exact SSH/SFTP bytes', { timeout: 20000 }, async t => {
  const server = await startFakeSshServer()
  t.after(() => server.close())
  const f = await fixture(t)
  const first = await f.start()
  const firstClient = await f.client(first)
  const saved = await firstClient.call('hosts:save', [{ ...connection(server), label: 'child host', rememberPassword: true }])
  assert.equal(saved.hasSecret, true)
  assert.ok(!JSON.stringify(saved).includes(server.password))
  const metadata = await readFile(join(f.directory, 'hosts.json'), 'utf8')
  const secrets = await readFile(join(f.directory, 'secrets.json'), 'utf8')
  assert.ok(!metadata.includes(server.password))
  assert.ok(!secrets.includes(server.password))
  assert.equal(f.crypto.unseal(JSON.parse(secrets)[saved.id]), server.password)
  await first.dispose()
  const child = await f.start()
  const client = await f.client(child)
  assert.deepEqual(await client.call('hosts:list'), [saved])
  const { password: _password, ...request } = connection(server)
  const session = await client.call('ssh:open', [{ ...request, hostId: saved.id, cols: 117, rows: 39 }])
  await until(() => client.output(session.sessionId).includes(Buffer.from('你好，世界\r\n')), 'child terminal greeting')
  client.notice('ssh:input', [session.sessionId, 'child🙂\n'])
  await until(() => client.output(session.sessionId).includes(Buffer.from('echo:child🙂\r\n')), 'child terminal UTF-8 echo')
  assert.deepEqual([server.terminal.ptys[0].cols, server.terminal.ptys[0].rows], [117, 39])
  client.notice('ssh:resize', [session.sessionId, 124, 43])
  await until(() => server.terminal.windows.length > 0, 'child terminal resize')
  assert.deepEqual([server.terminal.windows[0].cols, server.terminal.windows[0].rows], [124, 43])
  const bytes = Uint8Array.from([99, 0, 128, 255, 10, 13, 88]).subarray(1, 6)
  const written = await client.call('sftp:write', [session.sessionId, '.', 'child.bin', bytes])
  const downloaded = await client.call('sftp:read', [session.sessionId, written.path])
  assert.ok(downloaded.bytes instanceof Uint8Array)
  assert.deepEqual(Buffer.from(downloaded.bytes), Buffer.from(bytes))
  assert.ok((await client.call('sftp:list', [session.sessionId, '.'])).entries.some(entry => entry.name === 'child.bin'))
  client.notice('ssh:close', [session.sessionId])
  await until(() => server.connections === 0, 'child terminal close')
  await until(() => client.messages.some(message => message.name === 'terminal:closed'), 'child terminal closed event')
  assert.equal(await client.call('hosts:remove', [saved.id]), true)
  assert.deepEqual(await client.call('hosts:list'), [])
})

test('closing one Desktop WebSocket releases its quiet SSH session while another client remains connected', { timeout: 10000 }, async t => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const child = await f.start()
  const first = await f.client(child)
  const second = await f.client(child)
  await first.call('ssh:open', [connection(server)])
  assert.equal(server.connections, 1)
  await first.close()
  await until(() => server.connections === 0, 'WebSocket SSH cleanup')
  assert.deepEqual(await second.call('hosts:list'), [])
})

test('Keychain encrypts through parent platform RPC and authenticates after child restart', { timeout: 20000 }, async t => {
  const server = await startFakeSshServer({ keyAuthentication: true })
  t.after(() => server.close())
  const f = await fixture(t)
  const first = await f.start()
  const firstClient = await f.client(first)
  const key = await firstClient.call('keys:save', [{ label: 'child-key.pem', privateKey: server.hostKey.toString() }])
  assert.equal(key.type, 'RSA')
  assert.equal(key.privateKey, undefined)
  const saved = await firstClient.call('hosts:save', [{ host: server.host, port: server.port, username: server.username, authMethod: 'privateKey', keyId: key.id }])
  const vault = JSON.parse(await readFile(join(f.directory, 'keychain.json'), 'utf8'))
  assert.ok(!JSON.stringify(vault).includes('PRIVATE KEY'))
  assert.equal(JSON.parse(f.crypto.unseal(vault.entries[0].sealed)).record.id, key.id)
  await first.dispose()
  const child = await f.start()
  const client = await f.client(child)
  assert.deepEqual(await client.call('keys:list'), [key])
  const session = await client.call('ssh:open', [{ host: server.host, port: server.port, username: server.username, hostId: saved.id, acceptUnknownHostKey: true }])
  client.notice('ssh:input', [session.sessionId, 'keychain-child\n'])
  await until(() => client.output(session.sessionId).includes(Buffer.from('echo:keychain-child\r\n')), 'keychain child terminal echo')
  assert.ok(server.authentications.includes('publickey'))
  await assert.rejects(client.call('keys:remove', [key.id]), /使用/)
  await client.call('hosts:remove', [saved.id])
  assert.equal(await client.call('keys:remove', [key.id]), true)
})

test('child shutdown drains accepted platform encryption and exits once', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const entered = f.gate()
  const released = f.gate()
  f.options.credentials.seal = async plain => { entered.resolve(); await released.promise; return f.crypto.seal(plain) }
  const child = await f.start({ shutdownTimeoutMs: 2000 })
  const client = await f.client(child)
  const saving = client.call('hosts:save', [{ host: 'saved.example', username: 'demo', password: 'drained-secret', rememberPassword: true }]).catch(() => undefined)
  await entered.promise
  let stopped = false
  const stopping = child.dispose().then(() => { stopped = true })
  await delay(30)
  assert.equal(stopped, false)
  assert.equal(processExists(child.pid), true)
  released.resolve()
  await saving
  await stopping
  assert.equal(processExists(child.pid), false)
  const hosts = JSON.parse(await readFile(join(f.directory, 'hosts.json'), 'utf8'))
  const secrets = JSON.parse(await readFile(join(f.directory, 'secrets.json'), 'utf8'))
  assert.equal(f.crypto.unseal(secrets[hosts[0].id]), 'drained-secret')
  assert.deepEqual(f.exits, [])
})

test('WebSocket disconnect cancels an opening waiting on parent credential service', { timeout: 10000 }, async t => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const entered = f.gate()
  const released = f.gate()
  f.options.credentials.unseal = async value => { entered.resolve(); await released.promise; return f.crypto.unseal(value) }
  const child = await f.start()
  const client = await f.client(child)
  const saved = await client.call('hosts:save', [{ ...connection(server), rememberPassword: true }])
  const { password: _password, ...request } = connection(server)
  const opening = client.call('ssh:open', [{ ...request, hostId: saved.id }])
  const rejected = assert.rejects(opening, /disconnected|关闭|客户端/i)
  await entered.promise
  await client.close()
  await rejected
  assert.equal(server.connections, 0)
  released.resolve()
  await delay(30)
  assert.equal(server.connections, 0)
})

test('child crash closes outstanding WebSocket work and reports one failure', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const entered = f.gate()
  const released = f.gate()
  f.options.pickPrivateKey = async () => { entered.resolve(); await released.promise; return undefined }
  const child = await f.start()
  const client = await f.client(child)
  const rejected = assert.rejects(client.call('ssh:pick-private-key'), /disconnected|exited|IPC/i)
  await entered.promise
  process.kill(child.pid, 'SIGKILL')
  await rejected
  await until(() => !processExists(child.pid), 'crashed Host exit')
  await delay(30)
  assert.equal(f.exits.length, 1, 'disconnect and exit must not notify the same failure twice')
  released.resolve()
  await child.dispose()
  await child.dispose()
})

test('a child that never acknowledges startup is terminated before start rejects', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const pidFile = join(f.directory, 'stalled-child.pid')
  await assert.rejects(f.start({ entry: fixturePath('host-stalled-start.mjs'), startupTimeoutMs: 1000, shutdownTimeoutMs: 50,
    env: { ...process.env, PURETERM_TEST_CHILD_PID: pidFile } }), /timed out|startup/i)
  const pid = Number(await readFile(pidFile, 'utf8'))
  assert.ok(pid > 0)
  assert.equal(processExists(pid), false)
  assert.deepEqual(f.exits, [])
})

test('an invalid child URL is rejected before exposing the Host process', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const pidFile = join(f.directory, 'invalid-child.pid')
  await assert.rejects(f.start({ entry: fixturePath('host-stalled-start.mjs'), shutdownTimeoutMs: 50,
    env: { ...process.env, PURETERM_TEST_CHILD_PID: pidFile, PURETERM_TEST_BAD_HANDSHAKE: '1' } }), /Invalid Desktop Host handshake/)
  const pid = Number(await readFile(pidFile, 'utf8'))
  assert.equal(processExists(pid), false)
  assert.deepEqual(f.exits, [])
})

test('an invalid executable rejects startup without replacing its launch error', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  await assert.rejects(f.start({ execPath: join(f.directory, 'missing-node-executable'), startupTimeoutMs: 200, shutdownTimeoutMs: 50 }), /ENOENT|spawn/i)
  assert.deepEqual(f.exits, [])
})

test('abrupt parent termination leaves no Host child or SSH socket behind', { timeout: 15000 }, async t => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-host-parent-'))
  const parent = fork(fixturePath('host-process-parent.mjs'), [directory], {
    execPath: process.execPath, execArgv: [], serialization: 'advanced', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const messages = []
  let output = ''
  let parentError
  parent.on('message', message => messages.push(message))
  parent.on('error', error => { parentError = error })
  parent.stdout.on('data', data => { output += data })
  parent.stderr.on('data', data => { output += data })
  let hostPid
  t.after(async () => {
    if (parent.exitCode === null && parent.signalCode === null) {
      const closed = once(parent, 'close')
      parent.kill('SIGKILL')
      await closed
    }
    if (hostPid && processExists(hostPid)) { process.kill(hostPid, 'SIGKILL'); await until(() => !processExists(hostPid), 'fixture Host cleanup') }
    await rm(directory, { recursive: true, force: true })
  })
  const ready = await until(() => {
    if (parentError) throw parentError
    const failure = messages.find(message => message.kind === 'error')
    if (failure) throw new Error(failure.error)
    if (parent.exitCode !== null) throw new Error(`Fixture parent exited: ${output}`)
    return messages.find(message => message.kind === 'ready')
  }, 'fixture parent and Host readiness')
  hostPid = ready.pid
  assert.notEqual(hostPid, parent.pid)
  parent.send({ kind: 'open', payload: connection(server) })
  await until(() => messages.find(message => message.kind === 'opened'), 'fixture parent SSH opening')
  assert.equal(server.connections, 1)
  const closed = once(parent, 'close')
  parent.kill('SIGKILL')
  await closed
  await until(() => !processExists(hostPid), 'orphan Host termination', 7000)
  await until(() => server.connections === 0, 'orphan SSH socket cleanup')
})

import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startHostProcess } from '../dist/electron/runtime/host-process.js'
import { startFakeSshServer } from './fake-ssh-server.mjs'
import { connection, rendererFixture, until } from './integration-helpers.mjs'

const entry = fileURLToPath(new URL('../dist/electron/host/entry.js', import.meta.url))
const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const processExists = (pid) => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-host-process-'))
  const renderer = rendererFixture()
  const children = []
  const ready = []
  const picked = []
  const exits = []
  const gates = []
  const options = {
    entry, dataDir: directory, execPath: process.execPath,
    bridge: renderer.bridge,
    credentials: { persistent: true, seal: async (plain) => renderer.bridge.seal(plain), unseal: async (sealed) => renderer.bridge.unseal(sealed) },
    pickPrivateKey: async (clientId) => { picked.push(clientId); return { path: '/fixture/id_ed25519', encrypted: true } },
    onReady: (payload, clientId) => ready.push({ payload, clientId }),
    onExit: (error) => exits.push(error),
    startupTimeoutMs: 3000, shutdownTimeoutMs: 500,
    ...overrides,
  }
  t.after(async () => {
    for (const gate of gates) gate.resolve()
    try { for (const child of children) await child.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  return {
    directory, renderer, ready, picked, exits, options,
    gate() { const gate = Promise.withResolvers(); gates.push(gate); return gate },
    async start(extra = {}) { const child = await startHostProcess({ ...options, ...extra }); children.push(child); return child },
    call: (child, method, params = []) => child.dispatcher.call(method, params, renderer.id),
    notify: (child, method, params = []) => child.dispatcher.notify(method, params, renderer.id),
  }
}

test('Desktop Host runs in a separate Node process and delegates native capabilities to its parent', { timeout: 10000 }, async (t) => {
  const f = await fixture(t)
  const child = await f.start({ env: { ...process.env, NODE_OPTIONS: '--require=pureterm-nonexistent-preload', NODE_PATH: '/must-not-be-inherited' } })
  assert.ok(child.pid > 0)
  assert.notEqual(child.pid, process.pid)
  assert.deepEqual(await f.call(child, 'app:capabilities'), { credentialPersistence: 'encrypted', privateKeyPicker: 'native' })
  assert.deepEqual(await f.call(child, 'ssh:pick-private-key'), { path: '/fixture/id_ed25519', encrypted: true })
  assert.deepEqual(f.picked, [f.renderer.id])
  const ready = { ok: true, hosts: 0, cols: 100, rows: 30 }
  f.notify(child, 'app:renderer-ready', [ready])
  await until(() => f.ready.length === 1, 'renderer ready delegation')
  assert.deepEqual(f.ready, [{ payload: ready, clientId: f.renderer.id }])
  await child.dispose()
  await child.dispose()
  assert.equal(processExists(child.pid), false)
  assert.deepEqual(f.exits, [], 'intentional shutdown must not be reported as a crash')
  await assert.rejects(f.call(child, 'hosts:list'), /connected|stopped|关闭|disconnected/i)
})

test('child Host preserves encrypted credentials across restart and carries real terminal/SFTP bytes', { timeout: 15000 }, async (t) => {
  const server = await startFakeSshServer()
  t.after(() => server.close())
  const f = await fixture(t)
  const first = await f.start()
  const saved = await f.call(first, 'hosts:save', [{ ...connection(server), label: 'child host', rememberPassword: true }])
  assert.equal(saved.hasSecret, true)
  assert.ok(!JSON.stringify(saved).includes(server.password))
  const metadata = await readFile(join(f.directory, 'hosts.json'), 'utf8')
  const secrets = await readFile(join(f.directory, 'secrets.json'), 'utf8')
  assert.ok(!metadata.includes(server.password))
  assert.ok(!secrets.includes(server.password))
  assert.equal(f.renderer.bridge.unseal(JSON.parse(secrets)[saved.id]), server.password)
  await first.dispose()
  const child = await f.start()
  assert.deepEqual(await f.call(child, 'hosts:list'), [JSON.parse(JSON.stringify(saved))])
  const { password: _password, ...request } = connection(server)
  const session = await f.call(child, 'ssh:open', [{ ...request, hostId: saved.id, cols: 117, rows: 39, clientId: 'spoofed-id' }])
  await until(() => f.renderer.output(session.sessionId).includes(Buffer.from('你好，世界\r\n')), 'child terminal greeting')
  f.notify(child, 'ssh:input', [session.sessionId, 'child🙂\n'])
  await until(() => f.renderer.output(session.sessionId).includes(Buffer.from('echo:child🙂\r\n')), 'child terminal UTF-8 echo')
  assert.deepEqual([server.terminal.ptys[0].cols, server.terminal.ptys[0].rows], [117, 39])
  f.notify(child, 'ssh:resize', [session.sessionId, 124, 43])
  await until(() => server.terminal.windows.length > 0, 'child terminal resize')
  assert.deepEqual([server.terminal.windows[0].cols, server.terminal.windows[0].rows], [124, 43])
  const bytes = Uint8Array.from([99, 0, 128, 255, 10, 13, 88]).subarray(1, 6)
  const written = await f.call(child, 'sftp:write', [session.sessionId, '.', 'child.bin', bytes])
  const downloaded = await f.call(child, 'sftp:read', [session.sessionId, written.path])
  assert.ok(downloaded.bytes instanceof Uint8Array)
  assert.deepEqual(Buffer.from(downloaded.bytes), Buffer.from(bytes))
  const listing = await f.call(child, 'sftp:list', [session.sessionId, '.'])
  assert.ok(listing.entries.some((entry) => entry.name === 'child.bin'))
  f.notify(child, 'ssh:close', [session.sessionId])
  await until(() => server.connections === 0, 'child terminal close')
  await until(() => f.renderer.events.some((event) => event.name === 'terminal:closed'), 'child terminal closed event')
  assert.equal(await f.call(child, 'hosts:remove', [saved.id]), true)
  assert.deepEqual(await f.call(child, 'hosts:list'), [])
})

test('renderer removal releases a quiet child-owned SSH session', { timeout: 10000 }, async (t) => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const child = await f.start()
  await f.call(child, 'ssh:open', [connection(server)])
  assert.equal(server.connections, 1)
  f.renderer.disconnect()
  child.releaseClient(f.renderer.id)
  child.releaseClient(f.renderer.id)
  await until(() => server.connections === 0, 'renderer-gone SSH cleanup')
  await assert.rejects(f.call(child, 'hosts:list'), /Client.*connected/i)
})

test('Keychain traverses Desktop private IPC, encrypts through the parent, and authenticates after child restart', { timeout: 15000 }, async t => {
  const server = await startFakeSshServer({ keyAuthentication: true })
  t.after(() => server.close())
  const f = await fixture(t)
  const first = await f.start()
  const key = await f.call(first, 'keys:save', [{ label: 'child-key.pem', privateKey: server.hostKey.toString() }])
  assert.equal(key.type, 'RSA')
  assert.equal(key.privateKey, undefined)
  const saved = await f.call(first, 'hosts:save', [{ host: server.host, port: server.port, username: server.username, authMethod: 'privateKey', keyId: key.id }])
  const vault = JSON.parse(await readFile(join(f.directory, 'keychain.json'), 'utf8'))
  assert.ok(!JSON.stringify(vault).includes('PRIVATE KEY'))
  assert.equal(JSON.parse(f.renderer.bridge.unseal(vault.entries[0].sealed)).record.id, key.id)
  await first.dispose()
  const child = await f.start()
  assert.deepEqual(await f.call(child, 'keys:list'), [key])
  const session = await f.call(child, 'ssh:open', [{ host: server.host, port: server.port, username: server.username, hostId: saved.id, acceptUnknownHostKey: true }])
  f.notify(child, 'ssh:input', [session.sessionId, 'keychain-child\n'])
  await until(() => f.renderer.output(session.sessionId).includes(Buffer.from('echo:keychain-child\r\n')), 'keychain child terminal echo')
  assert.ok(server.authentications.includes('publickey'))
  await assert.rejects(f.call(child, 'keys:remove', [key.id]), /使用/)
  await f.call(child, 'hosts:remove', [saved.id])
  assert.equal(await f.call(child, 'keys:remove', [key.id]), true)
  assert.deepEqual(await f.call(child, 'keys:list'), [])
})

test('failed renderer event delivery reclaims the child session without an explicit disconnect notice', { timeout: 10000 }, async (t) => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  let delivered = 0
  const child = await f.start({ bridge: { getRenderer: (id) => ({ id, isAlive: () => true, send: () => { delivered++; return false } }) } })
  await f.call(child, 'ssh:open', [connection(server)])
  await until(() => delivered > 0, 'failed terminal opened event')
  await until(() => server.connections === 0, 'undeliverable event SSH cleanup')
})

test('child shutdown drains an already accepted platform encryption and exits once', { timeout: 10000 }, async (t) => {
  const f = await fixture(t)
  const entered = f.gate()
  const released = f.gate()
  f.options.credentials.seal = async (plain) => { entered.resolve(); await released.promise; return f.renderer.bridge.seal(plain) }
  const child = await f.start({ shutdownTimeoutMs: 2000 })
  const saving = f.call(child, 'hosts:save', [{ host: 'saved.example', username: 'demo', password: 'drained-secret', rememberPassword: true }])
  await entered.promise
  let stopped = false
  const stopping = child.dispose().then(() => { stopped = true })
  await delay(30)
  assert.equal(stopped, false)
  assert.equal(processExists(child.pid), true)
  released.resolve()
  const saved = await saving
  await stopping
  assert.equal(processExists(child.pid), false)
  assert.equal(f.renderer.bridge.unseal(JSON.parse(await readFile(join(f.directory, 'secrets.json'), 'utf8'))[saved.id]), 'drained-secret')
  assert.deepEqual(f.exits, [])
})

test('renderer removal rejects an opening that is waiting on the parent credential service', { timeout: 10000 }, async (t) => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const entered = f.gate()
  const released = f.gate()
  f.options.credentials.unseal = async (value) => { entered.resolve(); await released.promise; return f.renderer.bridge.unseal(value) }
  const child = await f.start()
  const saved = await f.call(child, 'hosts:save', [{ ...connection(server), rememberPassword: true }])
  const { password: _password, ...request } = connection(server)
  const opening = f.call(child, 'ssh:open', [{ ...request, hostId: saved.id }])
  const rejected = assert.rejects(opening, /断开|关闭|客户端/)
  await entered.promise
  f.renderer.disconnect()
  child.releaseClient(f.renderer.id)
  await rejected
  assert.equal(server.connections, 0)
  released.resolve()
  await delay(30)
  assert.equal(server.connections, 0)
})

test('a child crash rejects outstanding calls and reports one failure', { timeout: 10000 }, async (t) => {
  const f = await fixture(t)
  const entered = f.gate()
  const released = f.gate()
  f.options.pickPrivateKey = async () => { entered.resolve(); await released.promise; return undefined }
  const child = await f.start()
  const pending = f.call(child, 'ssh:pick-private-key')
  const rejected = assert.rejects(pending, /disconnected|exited|IPC/i)
  await entered.promise
  process.kill(child.pid, 'SIGKILL')
  await rejected
  await until(() => !processExists(child.pid), 'crashed Host exit')
  await delay(30)
  assert.equal(f.exits.length, 1, 'disconnect and exit must not notify the same failure twice')
  await assert.rejects(f.call(child, 'hosts:list'), /disconnected|exited|IPC/i)
  released.resolve()
  await child.dispose()
  await child.dispose()
})

test('a Host that never acknowledges startup is terminated before start rejects', { timeout: 10000 }, async (t) => {
  const f = await fixture(t)
  const pidFile = join(f.directory, 'stalled-child.pid')
  await assert.rejects(f.start({ entry: fixturePath('host-stalled-start.mjs'), startupTimeoutMs: 1000, shutdownTimeoutMs: 50,
    env: { ...process.env, PURETERM_TEST_CHILD_PID: pidFile } }), /timed out|startup/i)
  const pid = Number(await readFile(pidFile, 'utf8'))
  assert.ok(pid > 0)
  assert.equal(processExists(pid), false)
  assert.deepEqual(f.exits, [])
})

test('an invalid executable rejects startup without replacing its launch error with a shutdown timeout', { timeout: 10000 }, async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.start({ execPath: join(f.directory, 'missing-node-executable'), startupTimeoutMs: 200, shutdownTimeoutMs: 50 }), /ENOENT|spawn/i)
  assert.deepEqual(f.exits, [])
})

test('abrupt parent termination leaves no Host child or SSH socket behind', { timeout: 15000 }, async (t) => {
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
  parent.on('message', (message) => messages.push(message))
  parent.on('error', (error) => { parentError = error })
  parent.stdout.on('data', (data) => { output += data })
  parent.stderr.on('data', (data) => { output += data })
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
    const failure = messages.find((message) => message.kind === 'error')
    if (failure) throw new Error(failure.error)
    if (parent.exitCode !== null) throw new Error(`Fixture parent exited: ${output}`)
    return messages.find((message) => message.kind === 'ready')
  }, 'fixture parent and Host readiness')
  hostPid = ready.pid
  assert.notEqual(hostPid, parent.pid)
  parent.send({ kind: 'open', payload: connection(server) })
  await until(() => messages.find((message) => message.kind === 'opened'), 'fixture parent SSH opening')
  assert.equal(server.connections, 1)
  const closed = once(parent, 'close')
  parent.kill('SIGKILL')
  await closed
  await until(() => !processExists(hostPid), 'orphan Host termination', 7000)
  await until(() => server.connections === 0, 'orphan SSH socket cleanup')
})

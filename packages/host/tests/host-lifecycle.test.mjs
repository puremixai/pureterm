import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createHost } from '../dist/host.js'
import { startFakeSshServer } from '../../../apps/desktop/tests/fake-ssh-server.mjs'
import { monitorProbe } from '../../../apps/desktop/tests/monitor-probe.mjs'

const rejectedWith = code => error => {
  assert.equal(error.code, code, error.message)
  return true
}

async function until(predicate, description, timeout = 3000) {
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
    credentialPersistence: 'encrypted',
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
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-host-lifecycle-'))
  const hosts = []
  const alive = new Set(['first', 'second', 'stalled'])
  const options = {
    bridge: { getRenderer: (id) => alive.has(id) ? { id, isAlive: () => alive.has(id), send: () => alive.has(id) } : undefined },
    credentials: testCredentials(),
    hostStoreFile: join(directory, 'hosts.json'), secretsFile: join(directory, 'secrets.json'),
    knownHostsFile: join(directory, 'known_hosts.json'), log: false,
    ssh: { readyTimeout: 3000, keepaliveInterval: 0 }, ...overrides,
  }
  t.after(async () => {
    try { for (const host of hosts) await host.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  return { directory, options, alive, async create() { const host = await createHost(options); hosts.push(host); return host } }
}

const connection = (server, clientId = 'first') => ({
  host: server.host, port: server.port, username: server.username, password: server.password, clientId,
})

/** A peer that accepts TCP but never speaks SSH, so a handshake stays pending. */
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
  return { host: '127.0.0.1', port: server.address().port, username: 'demo', password: 'test' }
}

test('snapshot counts a pending handshake and both client sessions', { timeout: 15000 }, async t => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const stalled = await stalledServer(t)
  const f = await fixture(t)
  const host = await f.create()

  const opening = host.openTerminal(connection(stalled, 'stalled')).catch(() => undefined)
  await until(() => host.lifecycle.inspectActivity().pendingConnections === 1, 'pending handshake counted')

  const first = await host.openTerminal(connection(server, 'first'))
  const second = await host.openTerminal(connection(server, 'second'))
  const snapshot = host.lifecycle.inspectActivity()
  assert.deepEqual(Object.keys(snapshot).sort(), ['activeSessions', 'pendingConnections', 'pendingFileOperations', 'pendingMutations'])
  for (const value of Object.values(snapshot)) assert.ok(Number.isSafeInteger(value) && value >= 0, 'counts are finite nonnegative integers')
  assert.equal(snapshot.activeSessions, 2)
  assert.equal(snapshot.pendingConnections, 1)

  host.releaseClient('stalled')
  await opening
  host.close(first.sessionId)
  host.close(second.sessionId)
  await until(() => host.lifecycle.inspectActivity().activeSessions === 0, 'sessions released')
  assert.equal(host.lifecycle.inspectActivity().pendingConnections, 0, 'a cancelled handshake unwinds its count')
})

test('prepare blocks new work but permits cleanup', { timeout: 15000 }, async t => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const host = await f.create()
  const session = await host.openTerminal(connection(server))

  const prepared = host.lifecycle.prepareShutdown('lease-a')
  assert.equal(prepared.activeSessions, 1)
  assert.equal(host.lifecycle.prepareShutdown('lease-a').activeSessions, 1, 'repeated preparation with the same lease is idempotent')
  assert.throws(() => host.lifecycle.prepareShutdown('lease-b'), rejectedWith('host.lifecycle-busy'))

  await assert.rejects(host.openTerminal(connection(server)), rejectedWith('host.preparing-shutdown'))
  await assert.rejects(host.sftpList(session.sessionId, '.'), rejectedWith('host.preparing-shutdown'))
  await assert.rejects(host.sftpRead(session.sessionId, 'x'), rejectedWith('host.preparing-shutdown'))
  await assert.rejects(host.saveHost({ host: 'blocked.test', username: 'demo', password: 'x' }), rejectedWith('host.preparing-shutdown'))
  await assert.rejects(host.removeHost('any'), rejectedWith('host.preparing-shutdown'))
  await assert.rejects(host.saveKey({ label: 'blocked' }, 'first'), rejectedWith('host.preparing-shutdown'))
  await assert.rejects(host.startMonitor({ sessionId: session.sessionId, subscriptionId: 'sub-1' }, 'first'), rejectedWith('host.preparing-shutdown'))

  // Cleanup paths stay open while admission is closed.
  host.resize(session.sessionId, 80, 24)
  host.listHosts()
  host.releaseClient('second')
  assert.deepEqual(await host.stopMonitor('sub-1', 'first'), { stopped: false })

  assert.equal(host.lifecycle.cancelShutdown('lease-a'), true)
  const reopened = await host.openTerminal(connection(server, 'second'))
  assert.ok(reopened.sessionId, 'cancellation restores admission')
})

test('stale cancel cannot reopen admission', { timeout: 15000 }, async t => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const host = await f.create()

  host.lifecycle.prepareShutdown('lease-a')
  assert.equal(host.lifecycle.cancelShutdown('stale-lease'), false)
  await assert.rejects(host.openTerminal(connection(server)), error => error.code === 'host.preparing-shutdown')
  assert.equal(host.lifecycle.cancelShutdown('lease-a'), true)
  assert.equal(host.lifecycle.inspectActivity().pendingMutations, 0)
  const session = await host.openTerminal(connection(server))
  assert.ok(session.sessionId)
})

test('SFTP and queued saves drain on success or rejection', { timeout: 15000 }, async t => {
  const entered = Promise.withResolvers()
  const held = Promise.withResolvers()
  let heldOnce = false
  const server = await startFakeSshServer({
    greeting: false, files: { 'a.txt': 'a' },
    sftpGate: async (name) => { if (name === 'OPENDIR' && !heldOnce) { heldOnce = true; entered.resolve(); await held.promise } },
  })
  t.after(() => server.close())
  const f = await fixture(t)
  const host = await f.create()
  const session = await host.openTerminal(connection(server))

  const listing = host.sftpList(session.sessionId, '.')
  await entered.promise
  assert.equal(host.lifecycle.inspectActivity().pendingFileOperations, 1)
  host.lifecycle.prepareShutdown('lease-a')
  let drained = false
  const drain = host.lifecycle.drainAccepted('lease-a', 5000).then(() => { drained = true })
  await delay(30)
  assert.equal(drained, false, 'drain waits for the accepted SFTP operation')
  held.resolve()
  await listing
  await drain
  assert.equal(drained, true)
  assert.equal(host.lifecycle.inspectActivity().pendingFileOperations, 0)
  assert.equal(host.lifecycle.cancelShutdown('lease-a'), true)

  // A queued save is counted from enqueue and drained on success.
  const sealEntered = Promise.withResolvers()
  const sealHeld = Promise.withResolvers()
  const originalSeal = f.options.credentials.seal
  f.options.credentials.seal = async (plain) => { sealEntered.resolve(); await sealHeld.promise; return originalSeal(plain) }
  const saving = host.saveHost({ host: 'drain.test', username: 'demo', password: 'drain-secret', rememberPassword: true })
  await sealEntered.promise
  assert.equal(host.lifecycle.inspectActivity().pendingMutations, 1)
  host.lifecycle.prepareShutdown('lease-b')
  const saveDrain = host.lifecycle.drainAccepted('lease-b', 5000)
  sealHeld.resolve()
  await saving
  await saveDrain
  assert.equal(host.lifecycle.inspectActivity().pendingMutations, 0)
  host.lifecycle.cancelShutdown('lease-b')

  // A rejected write still returns its count to zero.
  f.options.credentials.seal = async () => { throw new Error('seal refused') }
  await assert.rejects(host.saveHost({ host: 'reject.test', username: 'demo', password: 'x', rememberPassword: true }), /refused/)
  assert.equal(host.lifecycle.inspectActivity().pendingMutations, 0)
})

test('drain times out without losing an accepted save', { timeout: 15000 }, async t => {
  const sealEntered = Promise.withResolvers()
  const sealHeld = Promise.withResolvers()
  const f = await fixture(t)
  const originalSeal = f.options.credentials.seal
  f.options.credentials.seal = async (plain) => { sealEntered.resolve(); await sealHeld.promise; return originalSeal(plain) }
  const host = await f.create()
  const saving = host.saveHost({ host: 'slow.test', username: 'demo', password: 'slow-secret', rememberPassword: true })
  await sealEntered.promise

  host.lifecycle.prepareShutdown('lease-a')
  await assert.rejects(host.lifecycle.drainAccepted('lease-a', 50), rejectedWith('host.lifecycle-drain-timeout'))
  assert.equal(host.lifecycle.inspectActivity().pendingMutations, 1, 'the accepted save is not discarded on timeout')
  sealHeld.resolve()
  await saving
  assert.equal(host.lifecycle.inspectActivity().pendingMutations, 0)
  assert.equal(host.lifecycle.cancelShutdown('lease-a'), true)
})

test('browser work is included in the same Host facts', { timeout: 15000 }, async t => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const host = await f.create()
  // Two opaque client IDs, as an attached browser and the Desktop window would have.
  await host.openTerminal(connection(server, 'first'))
  await host.openTerminal(connection(server, 'second'))
  const snapshot = host.lifecycle.inspectActivity()
  assert.equal(snapshot.activeSessions, 2, 'facts cover every client of this Host, not one window')
})

test('monitor-only polling does not keep a drain busy', { timeout: 15000 }, async t => {
  const server = await startFakeSshServer({ greeting: false, execOutput: monitorProbe() })
  t.after(() => server.close())
  const f = await fixture(t)
  const host = await f.create()
  const session = await host.openTerminal(connection(server))
  const started = await host.startMonitor({ sessionId: session.sessionId, subscriptionId: 'sub-1' }, 'first')
  assert.equal(started.subscriptionId, 'sub-1')
  await until(() => server.exec.commands.some(command => command.includes('PURETERM_MONITOR_V1')), 'monitor probe reached the fixture')

  host.lifecycle.prepareShutdown('lease-a')
  const snapshot = await host.lifecycle.drainAccepted('lease-a', 500)
  assert.deepEqual(
    { connections: snapshot.pendingConnections, files: snapshot.pendingFileOperations, mutations: snapshot.pendingMutations },
    { connections: 0, files: 0, mutations: 0 },
    'an active monitor subscription is not accepted user work',
  )
  assert.equal(host.lifecycle.cancelShutdown('lease-a'), true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/transport.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' })
const { createTransport, createWebSocketTransport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function environment(t) {
  const previousWindow = globalThis.window
  const previousSocket = globalThis.WebSocket
  const instances = []
  class Socket {
    static OPEN = 1
    readyState = 0
    sent = []
    constructor(url) { this.url = url; instances.push(this) }
    open() { this.readyState = 1; this.onopen?.({}) }
    send(text) { this.sent.push(JSON.parse(text)) }
    message(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: 'closed' }) }
  }
  globalThis.WebSocket = Socket
  globalThis.window = { location: new URL('http://127.0.0.1:9000/'), history: { state: null, replaceState() {} } }
  t.after(() => { globalThis.window = previousWindow; globalThis.WebSocket = previousSocket })
  return instances
}

/** A complete six-metric sample: `ready` means no metric is missing. */
function readyUpdate() {
  return {
    sessionId: 's1',
    subscriptionId: 'sub-1',
    sequence: 2,
    status: 'ready',
    snapshot: {
      collectedAt: 1_700_000_000_000,
      cpuPercent: 25,
      memory: { usedBytes: 614_400, totalBytes: 1_024_000, usedPercent: 60 },
      load: { one: 0.5, five: 1, fifteen: 2 },
      disk: { mount: '/', usedBytes: 40_960, totalBytes: 102_400, availableBytes: 51_200, usedPercent: 44.4 },
      net: { receivedBytesPerSecond: 4096, transmittedBytesPerSecond: 2048 },
      uptimeSeconds: 86_400.5,
      issues: {},
    },
  }
}

function factsPayload(sessionId = 's1') {
  return {
    sessionId,
    revision: 1,
    serverHostKey: 'ssh-ed25519',
    cipher: { clientToServer: 'chacha20-poly1305@openssh.com', serverToClient: 'chacha20-poly1305@openssh.com' },
  }
}

/** Drive a transport to the point where events can be delivered. */
async function open(api, instances) {
  const capability = api.getCapabilities()
  instances[0].open()
  await Promise.resolve()
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: {} })
  await capability
}

test('WebSocket loss closes every live terminal tab once', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  const closed = []
  api.onClosed(id => closed.push(id))
  const initial = api.getCapabilities()
  assert.equal(instances[0].url, 'ws://127.0.0.1:9000/ws')
  instances[0].open()
  await Promise.resolve()
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: {} })
  await initial
  for (const id of ['one', 'two', 'three']) instances[0].message({ kind: 'event', name: 'terminal:opened', params: [id, 80, 24] })
  instances[0].message({ kind: 'event', name: 'terminal:closed', params: ['two', 'user closed'] })
  instances[0].close()
  assert.deepEqual(closed, ['two', 'one', 'three'])
})

test('transport loss notifies the client once even without an SSH session and stale sockets cannot notify again', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  const lost = []
  const stop = api.onDisconnected(reason => lost.push(reason))
  const initial = api.keychain.list()
  instances[0].open(); await Promise.resolve()
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: [] })
  await initial
  const oldClose = instances[0].onclose
  instances[0].close()
  assert.equal(lost.length, 1)
  const next = api.keychain.list()
  instances[1].open(); await Promise.resolve()
  oldClose({ code: 1006, reason: 'stale' })
  assert.equal(lost.length, 1)
  instances[1].message({ kind: 'reply', id: instances[1].sent[0].id, ok: true, value: [] })
  await next
  stop(); instances[1].close()
  assert.equal(lost.length, 1)
})

test('Web transport subscriptions unsubscribe and disposal rejects requests without reopening a socket', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  let opened = 0
  let data = 0
  const unsubscribe = api.onOpened(() => opened++)
  api.onData(() => data++)
  const capability = api.getCapabilities()
  instances[0].open()
  await Promise.resolve()
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: { credentialPersistence: 'session', privateKeyPicker: 'browser' } })
  await capability
  instances[0].message({ kind: 'event', name: 'terminal:opened', params: ['first', 80, 24] })
  unsubscribe()
  instances[0].message({ kind: 'event', name: 'terminal:opened', params: ['second', 80, 24] })
  assert.equal(opened, 1)
  const pending = api.hosts.list()
  const rejected = assert.rejects(pending, /卸载/)
  await Promise.resolve()
  api.dispose()
  api.dispose()
  await rejected
  assert.equal(instances[0].readyState, 3)
  assert.equal(instances[0].onmessage, null)
  instances[0].message({ kind: 'event', name: 'terminal:data', params: ['second', { $bytes: 'YQ==' }] })
  assert.equal(data, 0)
  await assert.rejects(api.getCapabilities(), /卸载/)
  api.input('second', 'ignored')
  assert.equal(instances.length, 1)
})

test('disposing during the initial WebSocket handshake cancels its waiting request', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  const rejected = assert.rejects(api.getCapabilities(), /卸载/)
  api.dispose()
  await rejected
  assert.equal(instances[0].readyState, 3)
  assert.equal(instances[0].onopen, null)
})

test('a failed handshake cannot close or reject RPCs belonging to a replacement socket', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  const failed = assert.rejects(api.getCapabilities(), /连不上/)
  const staleClose = instances[0].onclose
  const staleError = instances[0].onerror
  instances[0].onerror({})
  await failed

  const next = api.hosts.list()
  let rejected = false
  void next.catch(() => { rejected = true })
  instances[1].open()
  await Promise.resolve()
  staleClose({ code: 1006, reason: 'old handshake failed' })
  staleError({})
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(rejected, false, 'old socket rejected the replacement request')
  instances[1].message({ kind: 'reply', id: instances[1].sent[0].id, ok: true, value: [] })
  assert.deepEqual(await next, [])
  assert.equal(instances.length, 2)
  assert.equal(instances[0].readyState, 3, 'failed handshake socket was not closed')
  assert.equal(instances[0].onmessage, null)
})

test('stale socket messages cannot resolve new RPCs or emit terminal events', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  let opened = 0
  api.onOpened(() => { opened++ })
  const failed = assert.rejects(api.getCapabilities(), /连不上/)
  const staleMessage = instances[0].onmessage
  const staleOpen = instances[0].onopen
  instances[0].onerror({})
  await failed

  const next = api.hosts.list()
  instances[1].open()
  await Promise.resolve()
  const id = instances[1].sent[0].id
  staleMessage({ data: JSON.stringify({ kind: 'reply', id, ok: true, value: ['stale'] }) })
  staleMessage({ data: JSON.stringify({ kind: 'event', name: 'terminal:opened', params: ['old-session', 80, 24] }) })
  staleOpen({})
  instances[1].message({ kind: 'reply', id, ok: true, value: ['current'] })
  assert.deepEqual(await next, ['current'])
  assert.equal(opened, 0)

  const another = api.hosts.list()
  await Promise.resolve()
  const request = instances[1].sent.at(-1)
  instances[1].message({ kind: 'reply', id: request.id, ok: true, value: [] })
  assert.deepEqual(await another, [])
  assert.equal(instances.length, 2, 'late open replaced the active connection')
})

test('an established socket closes its own session once and cannot disrupt the next connection', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  const closed = []
  api.onClosed((id, reason) => closed.push({ id, reason }))
  const initial = api.getCapabilities()
  instances[0].open()
  await Promise.resolve()
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: {} })
  await initial
  instances[0].message({ kind: 'event', name: 'terminal:opened', params: ['first-session', 80, 24] })
  const oldRequest = assert.rejects(api.hosts.list(), /连接已断开/)
  await Promise.resolve()
  const staleClose = instances[0].onclose
  instances[0].close()
  await oldRequest
  assert.deepEqual(closed.map(event => event.id), ['first-session'])

  const next = api.hosts.list()
  instances[1].open()
  await Promise.resolve()
  staleClose({ code: 1006, reason: 'late close' })
  instances[1].message({ kind: 'reply', id: instances[1].sent[0].id, ok: true, value: [] })
  assert.deepEqual(await next, [])
  assert.equal(closed.length, 1)
  assert.equal(instances[0].onmessage, null)
})

test('Desktop bridge bootstraps lazily and all business calls use its WebSocket', async t => {
  const instances = environment(t)
  let bootstraps = 0
  const ready = []
  globalThis.window.puretermDesktop = {
    bootstrap: async () => { bootstraps++; return { webSocketUrl: 'ws://127.0.0.1:43210/ws' } },
    signalReady: payload => ready.push(payload),
  }
  const api = createTransport()
  t.after(() => api.dispose())
  assert.equal(api.carrier, 'web')
  assert.equal(bootstraps, 0)
  assert.equal(instances.length, 0)
  const payload = { ok: true, hosts: 0, cols: 80, rows: 24 }
  api.signalReady(payload)
  assert.deepEqual(ready, [payload])
  assert.equal(bootstraps, 0)
  assert.equal(instances.length, 0)
  const result = api.hosts.list()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(bootstraps, 1)
  assert.equal(instances[0].url, 'ws://127.0.0.1:43210/ws')
  instances[0].open()
  await Promise.resolve()
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: [] })
  assert.deepEqual(await result, [])
  assert.equal(bootstraps, 1)
})

test('invalid Desktop bootstrap URLs never create a socket', async t => {
  for (const webSocketUrl of [
    'wss://127.0.0.1:43210/ws', 'ws://localhost:43210/ws', 'ws://127.0.0.1:43210/other',
    'ws://user@127.0.0.1:43210/ws', 'ws://127.0.0.1:43210/ws?token=secret',
    'ws://127.0.0.1:43210/ws#fragment', 'ws://127.0.0.1:0/ws',
  ]) {
    const instances = environment(t)
    globalThis.window.puretermDesktop = { bootstrap: async () => ({ webSocketUrl }), signalReady() {} }
    const api = createTransport()
    await assert.rejects(api.hosts.list(), /WebSocket URL/)
    assert.equal(instances.length, 0, webSocketUrl)
    api.dispose()
  }
})

test('bootstrap failure rejects calls and permits a later retry', async t => {
  const instances = environment(t)
  let attempts = 0
  globalThis.window.puretermDesktop = {
    bootstrap: async () => { if (++attempts === 1) throw new Error('startup failed'); return { webSocketUrl: 'ws://127.0.0.1:43210/ws' } },
    signalReady() {},
  }
  const api = createTransport()
  t.after(() => api.dispose())
  await assert.rejects(api.hosts.list(), /startup failed/)
  assert.equal(instances.length, 0)
  const next = api.hosts.list()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts, 2)
  instances[0].open()
  await Promise.resolve()
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: [] })
  assert.deepEqual(await next, [])
})

test('disposing during unresolved bootstrap promptly rejects callers and never creates a socket', async t => {
  const instances = environment(t)
  let finish
  globalThis.window.puretermDesktop = {
    bootstrap: () => new Promise(resolve => { finish = resolve }),
    signalReady() {},
  }
  const api = createTransport()
  const rejected = assert.rejects(api.hosts.list(), /卸载/)
  await Promise.resolve()
  api.dispose()
  await rejected
  finish({ webSocketUrl: 'ws://127.0.0.1:43210/ws' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(instances.length, 0)
})

test('monitor start and stop use the declared wire names and params', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())

  const started = api.monitor.start({ sessionId: 's1', subscriptionId: 'sub-1' })
  instances[0].open()
  await Promise.resolve()
  assert.deepEqual(instances[0].sent[0], {
    kind: 'call', id: 1, method: 'monitor:start', params: [{ sessionId: 's1', subscriptionId: 'sub-1' }],
  })
  instances[0].message({ kind: 'reply', id: 1, ok: true, value: { subscriptionId: 'sub-1', intervalMs: 5000 } })
  assert.deepEqual(await started, { subscriptionId: 'sub-1', intervalMs: 5000 })

  const stopped = api.monitor.stop('sub-1')
  await Promise.resolve()
  const stopCall = instances[0].sent.at(-1)
  assert.equal(stopCall.method, 'monitor:stop')
  assert.deepEqual(stopCall.params, ['sub-1'])
  instances[0].message({ kind: 'reply', id: stopCall.id, ok: true, value: { stopped: true } })
  assert.deepEqual(await stopped, { stopped: true })
})

test('an update that overtakes the start reply still lands, and a malformed one never blocks terminal traffic', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  const updates = []
  const data = []
  api.monitor.onUpdate(update => updates.push(update))
  api.onData((sessionId, chunk) => data.push([sessionId, [...chunk]]))

  const started = api.monitor.start({ sessionId: 's1', subscriptionId: 'sub-1' })
  instances[0].open()
  await Promise.resolve()
  // The event arrives before its reply: the listener was registered before start,
  // so nothing is lost by waiting for the call to resolve.
  instances[0].message({ kind: 'event', name: 'monitor:update', params: [readyUpdate()] })
  assert.equal(updates.length, 1)
  assert.equal(updates[0].snapshot.cpuPercent, 25)
  instances[0].message({ kind: 'reply', id: instances[0].sent[0].id, ok: true, value: { subscriptionId: 'sub-1', intervalMs: 5000 } })
  await started

  // Both payloads ride the same onmessage queue, so a rejected update must not
  // stop the terminal chunk behind it: the user would see a frozen terminal and
  // the cause would be in another plugin.
  instances[0].message({ kind: 'event', name: 'monitor:update', params: [{ ...readyUpdate(), sequence: 0 }] })
  instances[0].message({ kind: 'event', name: 'terminal:data', params: ['s1', { $bytes: 'YQ==' }] })
  assert.equal(updates.length, 1, 'a malformed update was delivered')
  assert.deepEqual(data, [['s1', [97]]], 'a malformed update blocked the terminal chunk behind it')
})

test('session facts have their own path, independent of terminal sessions and of monitor updates', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  const facts = []
  const updates = []
  api.monitor.onSessionFacts(entry => facts.push(entry))
  api.monitor.onUpdate(update => updates.push(update))
  await open(api, instances)

  // No terminal:opened ever arrived and no subscription exists, because the handshake
  // completes before a session becomes usable.
  instances[0].message({ kind: 'event', name: 'session:facts', params: [factsPayload('never-opened')] })
  assert.equal(facts.length, 1)
  assert.equal(facts[0].sessionId, 'never-opened')
  assert.equal(facts[0].serverHostKey, 'ssh-ed25519')
  assert.equal(updates.length, 0, 'facts must not be routed as a monitor update')

  // A rekey carries a higher revision; a malformed set is dropped without disturbing the next one.
  instances[0].message({ kind: 'event', name: 'session:facts', params: [{ ...factsPayload('never-opened'), revision: 2, serverHostKey: 'rsa-sha2-512' }] })
  instances[0].message({ kind: 'event', name: 'session:facts', params: [{ ...factsPayload('never-opened'), revision: 0 }] })
  assert.deepEqual(facts.map(entry => [entry.revision, entry.serverHostKey]), [[1, 'ssh-ed25519'], [2, 'rsa-sha2-512']])

  // Dropping the monitor listener does not disturb the facts path, and vice versa.
  api.monitor.onUpdate(() => {})()
  instances[0].message({ kind: 'event', name: 'session:facts', params: [{ ...factsPayload('never-opened'), revision: 3 }] })
  assert.equal(facts.length, 3)
  assert.equal(updates.length, 0)
})

test('monitor subscriptions unsubscribe, and disposal clears both listener sets', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  const updates = []
  const facts = []
  const stopUpdates = api.monitor.onUpdate(update => updates.push(update))
  api.monitor.onSessionFacts(entry => facts.push(entry))
  await open(api, instances)

  instances[0].message({ kind: 'event', name: 'monitor:update', params: [readyUpdate()] })
  instances[0].message({ kind: 'event', name: 'session:facts', params: [factsPayload()] })
  assert.equal(updates.length, 1)
  assert.equal(facts.length, 1)

  stopUpdates()
  instances[0].message({ kind: 'event', name: 'monitor:update', params: [readyUpdate()] })
  assert.equal(updates.length, 1, 'an unsubscribed monitor update was still delivered')

  const pending = api.hosts.list()
  const rejected = assert.rejects(pending, /卸载/)
  await Promise.resolve()
  api.dispose()
  api.dispose()
  await rejected
  instances[0].message({ kind: 'event', name: 'monitor:update', params: [readyUpdate()] })
  instances[0].message({ kind: 'event', name: 'session:facts', params: [factsPayload()] })
  assert.equal(updates.length, 1)
  assert.equal(facts.length, 1)
  // The request side is closed with the transport, exactly like every other call.
  await assert.rejects(api.monitor.start({ sessionId: 's1', subscriptionId: 'sub-1' }), /卸载/)
  await assert.rejects(api.monitor.stop('sub-1'), /卸载/)
})

test('a monitor update for a session that was never opened is still delivered, because the tab owns the filter', async t => {
  const instances = environment(t)
  const api = createWebSocketTransport()
  t.after(() => api.dispose())
  const updates = []
  api.monitor.onUpdate(update => updates.push(update))
  await open(api, instances)

  // Transport deliberately keeps no per-session monitor state: deciding whether a
  // session, subscription or sequence is still current belongs to the tab, which is
  // the only side that knows which tab is selected.
  instances[0].message({ kind: 'event', name: 'monitor:update', params: [{ ...readyUpdate(), sessionId: 'other-tab' }] })
  assert.deepEqual(updates.map(entry => entry.sessionId), ['other-tab'])
  assert.equal(instances[0].sent.length, 1, 'receiving an event opened a request')
})

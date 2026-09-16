import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/transport.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' })
const { createWebSocketTransport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

function environment(t) {
  const previousWindow = globalThis.window
  const previousSocket = globalThis.WebSocket
  const instances = []
  class Socket {
    static OPEN = 1
    readyState = 0
    sent = []
    constructor() { instances.push(this) }
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

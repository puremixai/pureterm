import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createProcessRpc } from '../dist/electron/runtime/process-rpc.js'

test('private RPC handles reverse requests and bytes, rejects pending calls on disconnect', async () => {
  const a = new EventEmitter(), b = new EventEmitter()
  const channel = (local, remote) => ({
    send: message => queueMicrotask(() => remote.emit('message', structuredClone(message))),
    listen: listener => { local.on('message', listener); return () => local.off('message', listener) },
  })
  const left = createProcessRpc({ channel: channel(a, b), request: (_method, args) => args[0] })
  const right = createProcessRpc({ channel: channel(b, a), request: (method, args) => {
    if (method === 'reverse') return right.call('seal', args)
    if (method === 'pending') return new Promise(() => {})
    throw new Error('unknown operation')
  } })
  try {
    const bytes = new Uint8Array([0, 255, 128, 1])
    assert.deepEqual(await left.call('reverse', [bytes]), bytes)
    await assert.rejects(left.call('invalid'), /unknown operation/)
    const pending = left.call('pending')
    const rejected = assert.rejects(pending, /lost parent/)
    left.close(new Error('lost parent'))
    await rejected
    await assert.rejects(left.call('reverse'), /lost parent/)
    assert.equal(a.listenerCount('message'), 0)
  } finally { left.close(); right.close() }
})

test('invalid versions and late replies do not settle another request', async () => {
  const emitter = new EventEmitter()
  const rpc = createProcessRpc({ timeoutMs: 15, request: () => {}, channel: {
    send: message => {
      emitter.emit('message', { version: 2, kind: 'reply', id: message.id, value: 'wrong version' })
      emitter.emit('message', { version: 1, kind: 'reply', id: message.id + 1, value: 'wrong id' })
    },
    listen: listener => { emitter.on('message', listener); return () => emitter.off('message', listener) },
  } })
  try { await assert.rejects(rpc.call('hang'), /timed out/) }
  finally { rpc.close() }
})

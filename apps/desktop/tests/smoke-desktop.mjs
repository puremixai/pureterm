// Replacement baseline: exercise the compiled application logic, not a copy of it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { resolvePlatformPlan, collectSwitches } from '../dist/electron/runtime/platform-plan.js'
import { createReadinessGate, normalizeReadyPayload } from '../dist/electron/runtime/readiness.js'
import { relaunchSelf } from '../dist/electron/runtime/relaunch.js'
import { createFrameDecoder, encodeFrame, OPCODES, WsProtocolError } from '../dist/electron/carriers/ws-frame.js'
import { encodeWire, decodeWire, isWireCall, isWireNotice } from '../dist/shared/protocol.js'

test('platform defaults keep sandbox/GPU intact and preserve native window/menu behavior', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const plan = resolvePlatformPlan({ platform, env: {} })
    assert.deepEqual(plan.switches, [])
    assert.equal(plan.disableHardwareAcceleration, false)
    assert.equal(plan.quitOnAllWindowsClosed, platform !== 'darwin')
    assert.equal(plan.includeAppMenu, platform === 'darwin')
  }
})

test('explicit flags apply exactly once; values other than 1 are not enabled', () => {
  const existingSwitches = ['disable-gpu', 'no-sandbox']
  const plan = resolvePlatformPlan({ platform: 'win32', existingSwitches,
    env: { SSH_CORDIS_DISABLE_GPU: '1', SSH_CORDIS_DISABLE_SANDBOX: '1' } })
  assert.deepEqual(plan.switches, ['disable-gpu-compositing', 'disable-software-rasterizer'])
  assert.equal(plan.disableHardwareAcceleration, true)
  assert.deepEqual(existingSwitches, ['disable-gpu', 'no-sandbox'])
  assert.deepEqual(resolvePlatformPlan({ platform: 'linux', env: {
    SSH_CORDIS_DISABLE_GPU: 'true', SSH_CORDIS_DISABLE_SANDBOX: '0',
  } }).switches, [])
  assert.equal(resolvePlatformPlan({ platform: 'linux', env: {}, existingSwitches: ['disable-gpu'] }).disableHardwareAcceleration, true)
  assert.deepEqual(collectSwitches(name => ['no-sandbox', 'untracked'].includes(name)), ['no-sandbox'])
})

test('failed readiness may retry, success opens once, late failure cannot undo success', () => {
  const gate = createReadinessGate()
  const actions = []
  gate.onReady(payload => actions.push(payload))
  const removed = gate.onReady(() => assert.fail('unsubscribed action ran'))
  removed(); removed()
  const failed = { ok: false, cols: 0, rows: 0, hosts: 0, error: 'preload unavailable' }
  assert.equal(gate.lastPayload, undefined)
  assert.deepEqual(gate.report(failed), { accepted: true, ready: false })
  assert.deepEqual(actions, [])
  assert.equal(gate.lastPayload, failed)
  const ready = { ok: true, cols: 100, rows: 30, hosts: 2 }
  assert.deepEqual(gate.report(ready), { accepted: true, ready: true })
  gate.onReady(payload => actions.push(payload))
  assert.deepEqual(gate.report(failed), { accepted: false, ready: true })
  assert.deepEqual(actions, [ready, ready])
  assert.equal(gate.lastPayload, ready)
})

test('readiness permits reentrant subscriptions without duplicate callbacks', () => {
  const gate = createReadinessGate()
  const order = []
  gate.onReady(() => {
    order.push('first')
    gate.onReady(() => order.push('nested'))
    assert.equal(gate.report({ ok: true }).accepted, false)
  })
  gate.onReady(() => order.push('second'))
  gate.report({ ok: true, cols: 1, rows: 1, hosts: 0 })
  assert.deepEqual(order, ['first', 'nested', 'second'])
})

test('readiness normalization requires literal true and handles missing/malformed fields', () => {
  assert.deepEqual(normalizeReadyPayload(undefined), { ok: false, cols: 0, rows: 0, hosts: 0 })
  assert.deepEqual(normalizeReadyPayload({ ok: 'true', cols: '100', rows: 'invalid', hosts: '2', error: 'bad' }),
    { ok: false, cols: 100, rows: 0, hosts: 2, error: 'bad' })
  assert.deepEqual(normalizeReadyPayload({ ok: true, error: 7 }), { ok: true, cols: 0, rows: 0, hosts: 0 })
})

function launch(options) {
  return new Promise(resolve => relaunchSelf({ switches: [], log: () => {}, ...options,
    onSuccess: child => resolve({ child }), onFailure: error => resolve({ error }),
  }))
}

test('relaunch transfers a surviving real child and preserves arguments/environment', { timeout: 5000 }, async () => {
  const result = await launch({ execPath: process.execPath, graceMs: 150,
    argv: ['-e', 'if(process.env.RELAUNCH_TEST !== "yes" || process.argv[1] !== "--test-flag") process.exit(9); setInterval(()=>{},1000)', '--'],
    switches: ['--test-flag'], env: { ...process.env, RELAUNCH_TEST: 'yes' },
  })
  assert.ifError(result.error)
  const { child } = result
  try {
    assert.equal(child.exitCode, null)
    assert.ok(child.pid > 0)
  } finally {
    const closed = once(child, 'close')
    child.kill()
    await closed
  }
})

test('relaunch reports missing executable and early exit without handing off ownership', { timeout: 5000 }, async () => {
  const missing = await launch({ execPath: 'ssh-cordis-missing-executable-291381', graceMs: 30 })
  assert.equal(missing.error.code, 'ENOENT')
  const early = await launch({ execPath: process.execPath, argv: ['-e', 'process.exit(17)'], graceMs: 300 })
  assert.match(early.error.message, /exitCode=17/)
  assert.equal(early.child, undefined)
})

// Browser frames must be masked. This fixture is independent from the production encoder,
// whose server frames deliberately have no mask.
function clientFrame(payload, { opcode = OPCODES.binary, fin = true } = {}) {
  const bytes = Buffer.from(payload)
  const size = bytes.length < 126 ? 2 : bytes.length <= 65535 ? 4 : 10
  const header = Buffer.alloc(size + 4)
  header[0] = (fin ? 0x80 : 0) | opcode
  header[1] = 0x80 | (size === 2 ? bytes.length : size === 4 ? 126 : 127)
  if (size === 4) header.writeUInt16BE(bytes.length, 2)
  if (size === 10) header.writeBigUInt64BE(BigInt(bytes.length), 2)
  const mask = Buffer.from([0x01, 0x7f, 0x80, 0xff])
  mask.copy(header, size)
  return Buffer.concat([header, bytes.map((byte, index) => byte ^ mask[index % 4])])
}

test('masked frame decoder handles length boundaries and split header/body input', () => {
  for (const length of [0, 1, 125, 126, 65535, 65536]) {
    const payload = Buffer.alloc(length)
    for (let i = 0; i < length; i++) payload[i] = i % 256
    const frame = clientFrame(payload)
    const decoder = createFrameDecoder()
    for (let i = 0; i < frame.length - 1; i++) {
      // Headers arrive one byte at a time; large bodies use a single chunk.
      const end = i < 13 ? i + 1 : frame.length - 1
      decoder.push(frame.subarray(i, end))
      assert.equal(decoder.read(), undefined)
      i = end - 1
    }
    decoder.push(frame.subarray(-1))
    const decoded = decoder.read()
    assert.equal(decoded.fin, true)
    assert.equal(decoded.opcode, OPCODES.binary)
    assert.deepEqual(decoded.payload, payload)
    assert.equal(decoder.buffered, 0)
    assert.equal(decoder.read(), undefined)
  }
})

test('coalesced frames retain fragment/control metadata and typed-array slices encode exactly', () => {
  const decoder = createFrameDecoder()
  decoder.push(Buffer.concat([
    clientFrame('first', { opcode: OPCODES.text, fin: false }),
    clientFrame('ping', { opcode: OPCODES.ping }),
    clientFrame('last', { opcode: OPCODES.continuation }),
  ]))
  assert.deepEqual([decoder.read(), decoder.read(), decoder.read()].map(frame => [frame.opcode, frame.fin, frame.payload.toString()]),
    [[1, false, 'first'], [9, true, 'ping'], [0, true, 'last']])
  const bytes = new Uint8Array([99, 0, 128, 255, 88])
  assert.deepEqual(encodeFrame(OPCODES.binary, bytes.subarray(1, 4)), Buffer.from([0x82, 3, 0, 128, 255]))
})

test('unmasked and oversized input poison the decoder and cannot be resumed', () => {
  for (const [frame, max, closeCode] of [
    [encodeFrame(OPCODES.text, 'bad'), 100, 1002],
    [clientFrame(Buffer.alloc(129)), 128, 1009],
    [Buffer.from([0x82, 0xff, 0, 0, 0, 1, 0, 0, 0, 0]), 100, 1009],
  ]) {
    const decoder = createFrameDecoder(max)
    decoder.push(frame)
    assert.throws(() => decoder.read(), error => error instanceof WsProtocolError && error.closeCode === closeCode)
    assert.equal(decoder.broken, true)
    const buffered = decoder.buffered
    decoder.push(clientFrame('good'))
    assert.equal(decoder.buffered, buffered)
    assert.equal(decoder.read(), undefined)
  }
})

test('server frame encoding uses 7/16/64-bit lengths without masking', () => {
  for (const size of [125, 126, 65535, 65536]) {
    const frame = encodeFrame(OPCODES.binary, new Uint8Array(size).fill(0xfe))
    assert.equal(frame[1] & 0x80, 0)
    const headerSize = size < 126 ? 2 : size <= 65535 ? 4 : 10
    const decodedSize = headerSize === 2 ? frame[1] : headerSize === 4 ? frame.readUInt16BE(2) : Number(frame.readBigUInt64BE(2))
    assert.equal(decodedSize, size)
    assert.equal(frame.length, size + headerSize)
    assert.equal(frame.at(-1), 0xfe)
  }
})

test('wire binary survives JSON, nesting, empty bytes and large subarray offsets', () => {
  const storage = Uint8Array.from({ length: 100_007 }, (_, index) => index % 256)
  const bytes = storage.subarray(3, 100_004)
  const input = { kind: 'event', params: [null, false, { bytes }, new Uint8Array(), Buffer.from([0, 255, 128])] }
  const output = decodeWire(JSON.parse(JSON.stringify(encodeWire(input))))
  assert.equal(output.kind, 'event')
  assert.deepEqual(output.params.slice(0, 2), [null, false])
  assert.deepEqual(output.params[2].bytes, bytes)
  assert.deepEqual(output.params[3], new Uint8Array())
  assert.deepEqual(output.params[4], new Uint8Array([0, 255, 128]))
  assert.equal(bytes.byteOffset, 3)
})

test('wire decoding preserves business objects with $bytes plus other keys and rejects invalid base64', () => {
  const business = { $bytes: 'not base64', name: 'literal business value' }
  assert.deepEqual(decodeWire(business), business)
  assert.throws(() => decodeWire({ $bytes: '%' }))
  assert.equal(isWireCall(null), false)
  assert.equal(isWireCall({ kind: 'call', id: '1', method: 'hosts:list' }), false)
  assert.equal(isWireCall({ kind: 'call', id: 1, method: 'hosts:list', params: [] }), true)
  assert.equal(isWireNotice({ kind: 'notice', name: 'app:renderer-ready', params: [] }), true)
  assert.equal(isWireNotice({ kind: 'notice', name: 7 }), false)
})

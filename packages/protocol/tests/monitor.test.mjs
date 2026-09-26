import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMonitorUpdate, parseSessionFacts } from '../dist/protocol.js'

const identity = { sessionId: 'session-1', subscriptionId: 'sub-1', sequence: 1 }

function snapshot(overrides = {}) {
  return {
    collectedAt: 1_700_000_000_000,
    cpuPercent: 25,
    memory: { usedBytes: 614_400, totalBytes: 1_024_000, usedPercent: 60 },
    load: { one: 0.5, five: 1, fifteen: 2 },
    disk: { mount: '/', usedBytes: 40_960, totalBytes: 102_400, availableBytes: 51_200, usedPercent: 44.4 },
    net: { receivedBytesPerSecond: 4096, transmittedBytesPerSecond: 2048 },
    uptimeSeconds: 86_400.5,
    issues: {},
    ...overrides,
  }
}

function update(overrides = {}) {
  return { ...identity, status: 'ready', snapshot: snapshot(), ...overrides }
}

test('a complete ready sample keeps every field and reports no issue', () => {
  const parsed = parseMonitorUpdate(update())
  assert.equal(parsed.status, 'ready')
  assert.equal(parsed.sequence, 1)
  assert.equal(parsed.snapshot.cpuPercent, 25)
  assert.equal(parsed.snapshot.uptimeSeconds, 86_400.5)
  assert.deepEqual(parsed.snapshot.net, { receivedBytesPerSecond: 4096, transmittedBytesPerSecond: 2048 })
  assert.deepEqual(parsed.snapshot.issues, {})
  assert.equal(parsed.message, undefined)
})

test('a first probe is partial with exactly the two delta metrics warming up', () => {
  const parsed = parseMonitorUpdate(update({
    status: 'partial',
    snapshot: snapshot({
      cpuPercent: null,
      net: null,
      issues: { cpu: 'warming-up', net: 'warming-up' },
    }),
  }))
  assert.equal(parsed.snapshot.cpuPercent, null)
  assert.equal(parsed.snapshot.issues.cpu, 'warming-up')
  assert.equal(parsed.snapshot.issues.net, 'warming-up')
  // Four of six metrics are available, so the partial rule holds.
  assert.equal(parsed.status, 'partial')
})

test('warming-up is refused for the four metrics that are not deltas', () => {
  for (const metric of ['memory', 'load', 'disk', 'uptime']) {
    assert.throws(
      () => parseMonitorUpdate(update({ status: 'partial', snapshot: snapshot({ [metric]: null, issues: { [metric]: 'warming-up' } }) })),
      /issues/,
      metric,
    )
  }
})

test('the issues object must match the null metrics exactly', () => {
  // A null metric with no reason would read as "this host has no such metric".
  assert.throws(() => parseMonitorUpdate(update({ status: 'partial', snapshot: snapshot({ load: null }) })), /issues/)
  // An issue on a metric that did arrive contradicts the value beside it.
  assert.throws(() => parseMonitorUpdate(update({ status: 'partial', snapshot: snapshot({ issues: { load: 'unavailable' } }) })), /issues/)
  // An unknown metric or code is not a state this design defines.
  assert.throws(() => parseMonitorUpdate(update({ status: 'partial', snapshot: snapshot({ load: null, issues: { swap: 'unavailable' } }) })), /issues/)
  assert.throws(() => parseMonitorUpdate(update({ status: 'partial', snapshot: snapshot({ load: null, issues: { load: 'slow' } }) })), /issues/)
})

test('ready and partial are separated by how many metrics arrived', () => {
  const oneMissing = snapshot({ load: null, issues: { load: 'unavailable' } })
  assert.equal(parseMonitorUpdate(update({ status: 'partial', snapshot: oneMissing })).status, 'partial')
  // Five available is partial; six is ready; claiming ready with a hole is refused.
  assert.throws(() => parseMonitorUpdate(update({ status: 'ready', snapshot: oneMissing })), /ready/)
  const twoMissing = snapshot({ load: null, net: null, issues: { load: 'unavailable', net: 'unavailable' } })
  assert.equal(parseMonitorUpdate(update({ status: 'partial', snapshot: twoMissing })).status, 'partial')
})

test('zero available metrics is an error, never an all-null partial', () => {
  const empty = snapshot({
    cpuPercent: null, memory: null, load: null, disk: null, net: null, uptimeSeconds: null,
    issues: { cpu: 'unavailable', memory: 'unavailable', load: 'unavailable', disk: 'unavailable', net: 'unavailable', uptime: 'unavailable' },
  })
  assert.throws(() => parseMonitorUpdate(update({ status: 'partial', snapshot: empty })), /partial/)
  const parsed = parseMonitorUpdate({ ...identity, status: 'error', snapshot: null, message: '远端没有可用的 /proc。' })
  assert.equal(parsed.snapshot, null)
  assert.equal(parsed.status, 'error')
})

test('error and unsupported carry no snapshot and require a message', () => {
  for (const status of ['error', 'unsupported']) {
    const parsed = parseMonitorUpdate({ ...identity, status, snapshot: null, message: '不是 Linux。' })
    assert.equal(parsed.status, status)
    assert.equal(parsed.snapshot, null)
    assert.equal(parsed.message, '不是 Linux。')
    assert.throws(() => parseMonitorUpdate({ ...identity, status, snapshot: null }), /message/)
    assert.throws(() => parseMonitorUpdate({ ...identity, status, snapshot: null, message: '' }), /message/)
    assert.throws(() => parseMonitorUpdate({ ...identity, status, snapshot: snapshot() }), /snapshot/)
  }
  // A ready or partial event with no snapshot is not a state either.
  assert.throws(() => parseMonitorUpdate({ ...identity, status: 'ready', snapshot: null }), /snapshot/)
})

test('a message is bounded and never required for a successful sample', () => {
  assert.equal(parseMonitorUpdate(update({ message: 'ok' })).message, 'ok')
  assert.throws(() => parseMonitorUpdate(update({ message: 'x'.repeat(513) })), /message/)
  assert.throws(() => parseMonitorUpdate(update({ message: 42 })), /message/)
})

test('identity, sequence and time are validated before anything else', () => {
  assert.throws(() => parseMonitorUpdate({ ...update(), sequence: 0 }), /sequence/)
  assert.throws(() => parseMonitorUpdate({ ...update(), sequence: 1.5 }), /sequence/)
  assert.throws(() => parseMonitorUpdate({ ...update(), sequence: Number.MAX_SAFE_INTEGER + 2 }), /sequence/)
  assert.throws(() => parseMonitorUpdate({ ...update(), sessionId: '' }), /sessionId/)
  assert.throws(() => parseMonitorUpdate({ ...update(), sessionId: 'x'.repeat(129) }), /sessionId/)
  assert.throws(() => parseMonitorUpdate({ ...update(), sessionId: 7 }), /sessionId/)
  for (const subscriptionId of ['', 'has space', 'a/b', 'x'.repeat(65)]) {
    assert.throws(() => parseMonitorUpdate({ ...update(), subscriptionId }), /subscriptionId/, subscriptionId)
  }
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ collectedAt: -1 }) })), /collectedAt/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ collectedAt: 1.5 }) })), /collectedAt/)
  assert.throws(() => parseMonitorUpdate(null), /不合法/)
  assert.throws(() => parseMonitorUpdate('update'), /不合法/)
})

test('percentages outside 0..100 and non-finite numbers are refused, not clamped', () => {
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ cpuPercent: 101 }) })), /cpuPercent/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ cpuPercent: -0.1 }) })), /cpuPercent/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ cpuPercent: Number.NaN }) })), /cpuPercent/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ cpuPercent: Number.POSITIVE_INFINITY }) })), /cpuPercent/)
  assert.equal(parseMonitorUpdate(update({ snapshot: snapshot({ cpuPercent: 0 }) })).snapshot.cpuPercent, 0)
  assert.equal(parseMonitorUpdate(update({ snapshot: snapshot({ cpuPercent: 100 }) })).snapshot.cpuPercent, 100)
})

test('byte counts are non-negative safe integers and memory cannot exceed its total', () => {
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ memory: { usedBytes: -1, totalBytes: 100, usedPercent: 50 } }) })), /memory/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ memory: { usedBytes: 1.5, totalBytes: 100, usedPercent: 50 } }) })), /memory/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ memory: { usedBytes: 101, totalBytes: 100, usedPercent: 50 } }) })), /memory/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ memory: { usedBytes: 10, totalBytes: 0, usedPercent: 50 } }) })), /memory/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ memory: { usedBytes: 10, totalBytes: Number.MAX_SAFE_INTEGER + 2, usedPercent: 50 } }) })), /memory/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ memory: null }) })), /issues/)
})

test('disk allows reserved blocks but not a part larger than the whole', () => {
  // used + available may be less than total: the filesystem keeps reserved blocks.
  const reserved = snapshot({ disk: { mount: '/', usedBytes: 40_960, totalBytes: 102_400, availableBytes: 20_480, usedPercent: 66.6 } })
  assert.equal(parseMonitorUpdate(update({ snapshot: reserved })).snapshot.disk.availableBytes, 20_480)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ disk: { mount: '/', usedBytes: 102_401, totalBytes: 102_400, availableBytes: 1, usedPercent: 50 } }) })), /disk/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ disk: { mount: '/', usedBytes: 1, totalBytes: 102_400, availableBytes: 102_401, usedPercent: 50 } }) })), /disk/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ disk: { mount: '/home', usedBytes: 1, totalBytes: 100, availableBytes: 1, usedPercent: 50 } }) })), /disk/)
})

test('load keeps three finite non-negative values and net keeps two rates', () => {
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ load: { one: -0.1, five: 1, fifteen: 2 } }) })), /load/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ load: { one: Number.NaN, five: 1, fifteen: 2 } }) })), /load/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ load: { one: 1, five: 2 } }) })), /load/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ net: { receivedBytesPerSecond: -1, transmittedBytesPerSecond: 0 } }) })), /net/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ net: { receivedBytesPerSecond: 0 } }) })), /net/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ uptimeSeconds: -1 }) })), /uptimeSeconds/)
  assert.throws(() => parseMonitorUpdate(update({ snapshot: snapshot({ uptimeSeconds: Number.POSITIVE_INFINITY }) })), /uptimeSeconds/)
  assert.equal(parseMonitorUpdate(update({ snapshot: snapshot({ uptimeSeconds: 0 }) })).snapshot.uptimeSeconds, 0)
})

test('a missing nested field is a rejection, not an undefined that leaks to the UI', () => {
  const without = key => {
    const value = snapshot()
    delete value[key]
    return update({ snapshot: value })
  }
  for (const key of ['collectedAt', 'cpuPercent', 'memory', 'load', 'disk', 'net', 'uptimeSeconds', 'issues']) {
    assert.throws(() => parseMonitorUpdate(without(key)), /不合法/, key)
  }
})

const validFacts = {
  sessionId: 'session-1',
  revision: 1,
  serverHostKey: 'rsa-sha2-512',
  cipher: { clientToServer: 'aes128-gcm@openssh.com', serverToClient: 'aes128-gcm@openssh.com' },
}

test('session facts keep the two algorithms the status bar renders', () => {
  const parsed = parseSessionFacts(validFacts)
  assert.deepEqual(parsed, validFacts)
  assert.equal(parsed.cipher.serverToClient, 'aes128-gcm@openssh.com')
  // The prototype's cell is `chacha20-poly1305 · ed25519 · 128 行`, so both of these
  // shapes have to survive: an @-suffixed cipher and a bare host key algorithm.
  assert.equal(parseSessionFacts({ ...validFacts, serverHostKey: 'ssh-ed25519' }).serverHostKey, 'ssh-ed25519')
  assert.equal(parseSessionFacts({ ...validFacts, serverHostKey: 'ssh-rsa' }).serverHostKey, 'ssh-rsa')
  assert.equal(
    parseSessionFacts({ ...validFacts, cipher: { clientToServer: 'chacha20-poly1305@openssh.com', serverToClient: 'aes256-gcm@openssh.com' } }).cipher.clientToServer,
    'chacha20-poly1305@openssh.com',
  )
})

test('session facts drop the payload fields no screen renders', () => {
  // ssh2 hands over kex, mac, compression and lang in the same event. None of them
  // has a cell, so the parsed object is built rather than passed through — a field
  // with no reader is a field no test can hold honest.
  const parsed = parseSessionFacts({
    ...validFacts,
    kex: 'curve25519-sha256@libssh.org',
    software: 'OpenSSH_9.6',
    mac: { clientToServer: 'hmac-sha2-256-etm@openssh.com' },
  })
  assert.deepEqual(Object.keys(parsed).sort(), ['cipher', 'revision', 'serverHostKey', 'sessionId'])
  assert.equal('kex' in parsed, false)
  assert.equal('software' in parsed, false)
  assert.equal('mac' in parsed, false)
})

test('session facts require a live session, a positive revision and three algorithm names', () => {
  assert.throws(() => parseSessionFacts({ ...validFacts, revision: 0 }), /revision/)
  assert.throws(() => parseSessionFacts({ ...validFacts, revision: -1 }), /revision/)
  assert.throws(() => parseSessionFacts({ ...validFacts, revision: 1.5 }), /revision/)
  assert.throws(() => parseSessionFacts({ ...validFacts, sessionId: '' }), /sessionId/)
  assert.throws(() => parseSessionFacts({ ...validFacts, sessionId: 'x'.repeat(129) }), /sessionId/)
  for (const field of ['serverHostKey', 'cipher']) {
    const broken = { ...validFacts, [field]: field === 'cipher' ? { clientToServer: '', serverToClient: 'aes256-gcm@openssh.com' } : '' }
    assert.throws(() => parseSessionFacts(broken), /不合法/, field)
  }
  assert.throws(() => parseSessionFacts({ ...validFacts, cipher: { clientToServer: 'aes256-gcm@openssh.com' } }), /cipher/)
  assert.throws(() => parseSessionFacts({ ...validFacts, cipher: 'aes256-gcm@openssh.com' }), /cipher/)
  assert.throws(() => parseSessionFacts(null), /不合法/)
})

test('an algorithm name is held to the characters SSH actually uses', () => {
  // The server chooses these strings and a status bar renders them, so the field is
  // a bounded token rather than free text.
  for (const hostile of ['aes256\n-gcm', 'aes256 gcm', '<img src=x>', 'aes256-gcm@openssh.com/../etc', 'x'.repeat(129), '密码']) {
    assert.throws(() => parseSessionFacts({ ...validFacts, serverHostKey: hostile }), /不合法/, JSON.stringify(hostile))
  }
  for (const real of ['curve25519-sha256@libssh.org', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'ssh-ed25519', '3des-cbc', 'none']) {
    assert.equal(parseSessionFacts({ ...validFacts, serverHostKey: real }).serverHostKey, real)
  }
})

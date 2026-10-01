import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createUpdateCoordinator } from '../dist/electron/runtime/updates.js'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
/** The coordinator hands over a catalog key plus params; render it the way a reader of the test can check it. */
const said = (key, params) => params ? `${key} ${JSON.stringify(params)}` : key
function fixture(t, overrides = {}) {
  const backend = new EventEmitter()
  const calls = []
  backend.checkForUpdates = async () => { calls.push('check'); backend.emit('update-not-available') }
  backend.quitAndInstall = () => { calls.push('install') }
  const coordinator = createUpdateCoordinator({ backend, enabled: true, initialDelayMs: 100_000,
    // The default preparation is a prepared, graceful shutdown.
    prepareInstall: async (version) => { calls.push(`prepare:${version}`); return { intent: 'update', status: 'ready' } },
    message: (key, params) => { calls.push(said(key, params)) }, ...overrides })
  t.after(() => coordinator.dispose())
  return { backend, calls, coordinator }
}
const installs = calls => calls.filter(call => call === 'install').length

test('concurrent manual checks share one network request and one result', async t => {
  const { coordinator, backend, calls } = fixture(t)
  const pending = deferred()
  backend.checkForUpdates = async () => { calls.push('check'); await pending.promise; backend.emit('update-not-available') }
  const a = coordinator.check()
  const b = coordinator.check(true)
  assert.equal(a, b)
  await tick()
  assert.deepEqual(calls, ['check'])
  pending.resolve()
  await a
  assert.equal(coordinator.phase, 'idle')
  assert.deepEqual(calls, ['check', 'desktop.update.up-to-date'])
  assert.equal(backend.autoInstallOnAppQuit, false)
})

test('a downloaded update installs only after a prepared graceful stop', async t => {
  const order = []
  const prepared = deferred()
  const { coordinator, backend } = fixture(t, {
    prepareInstall: async (version) => {
      order.push(`prepare:${version}`)
      await prepared.promise
      order.push('prepared')
      return { intent: 'update', status: 'ready' }
    },
  })
  backend.quitAndInstall = (...args) => { assert.deepEqual(args, [false, true]); order.push('install') }
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.deepEqual(order, ['prepare:0.2.0'], 'the coordinator asks for preparation, not a bare confirmation')
  assert.equal(coordinator.phase, 'downloaded', 'the phase stays downloaded until the Host is stopped')
  prepared.resolve()
  await coordinator.install()
  assert.deepEqual(order, ['prepare:0.2.0', 'prepared', 'install'])
})

test('a cancelled preparation keeps the downloaded version retryable', async t => {
  let answer = { intent: 'update', status: 'cancelled' }
  const { coordinator, backend, calls } = fixture(t, { prepareInstall: async () => answer })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(coordinator.phase, 'downloaded')
  assert.equal(installs(calls), 0, 'a cancelled preparation must not install')
  answer = { intent: 'update', status: 'ready' }
  await coordinator.install()
  assert.equal(installs(calls), 1, 'the retained download can be installed on a later attempt')
})

test('work admitted during confirmation is caught and re-prepared before installing', async t => {
  let attempt = 0
  const { coordinator, backend, calls } = fixture(t, {
    // The first preparation meets work admitted while the user was confirming: the
    // shutdown coordinator reports failed and keeps the Host usable.
    prepareInstall: async () => (++attempt === 1 ? { intent: 'update', status: 'failed' } : { intent: 'update', status: 'ready' }),
  })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(installs(calls), 0, 'a failed preparation must not install')
  assert.equal(coordinator.phase, 'downloaded')
  await coordinator.install()
  assert.equal(installs(calls), 1, 'the retry re-prepares rather than trusting the stale result')
})

test('a busy ordinary quit does not install', async t => {
  const { coordinator, backend, calls } = fixture(t, { prepareInstall: async () => ({ intent: 'update', status: 'busy' }) })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(installs(calls), 0)
  assert.equal(coordinator.phase, 'downloaded', 'the download stays available for a later attempt')
})

test('a drain failure unlocks without stopping and keeps the download', async t => {
  const { coordinator, backend, calls } = fixture(t, { prepareInstall: async () => ({ intent: 'update', status: 'failed' }) })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(installs(calls), 0)
  assert.equal(coordinator.phase, 'downloaded')
  assert.ok(!calls.includes('desktop.update.install-failed'), 'a preparation failure is not an installer failure')
})

test('a forced termination never invokes the installer', async t => {
  // The shutdown coordinator reports `failed` when an update cannot stop the Host
  // gracefully, so a forced kill can never reach quitAndInstall.
  const { coordinator, backend, calls } = fixture(t, { prepareInstall: async () => ({ intent: 'update', status: 'failed' }) })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(installs(calls), 0)
})

test('disposal while a preparation is pending never installs', async t => {
  const gate = deferred()
  const { coordinator, backend, calls } = fixture(t, { prepareInstall: () => gate.promise })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  coordinator.dispose()
  assert.equal(backend.eventNames().length, 0)
  gate.resolve({ intent: 'update', status: 'ready' })
  await tick()
  assert.equal(installs(calls), 0, 'a late ready result must not install after disposal')
})

test('a new download invalidates an older confirmation', async t => {
  const gate = deferred()
  const { coordinator, backend, calls } = fixture(t, { prepareInstall: () => gate.promise })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  backend.emit('update-downloaded', { version: '0.3.0' })
  await tick()
  gate.resolve({ intent: 'update', status: 'ready' })
  await tick()
  assert.equal(installs(calls), 0, 'a stale confirmation must not install the newer download')
  assert.equal(coordinator.phase, 'downloaded')
})

test('an ordinary-quit decision is never accepted as an update preparation', async t => {
  const { coordinator, backend, calls } = fixture(t, { prepareInstall: async () => ({ intent: 'quit', status: 'ready' }) })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(installs(calls), 0, 'the update requires a same-intent ready decision')
})

test('network failure is recoverable and disabled builds never make requests', async t => {
  const failed = fixture(t)
  failed.backend.checkForUpdates = async () => { throw new Error('offline') }
  await failed.coordinator.check(true)
  assert.equal(failed.coordinator.phase, 'error')
  assert.deepEqual(failed.calls, ['desktop.update.check-failed {"detail":"offline"}'])
  failed.backend.checkForUpdates = async () => failed.backend.emit('update-not-available')
  await failed.coordinator.check(true)
  assert.equal(failed.coordinator.phase, 'idle')
  const disabled = fixture(t, { enabled: false, unavailableReason: 'desktop.update.unavailable-development' })
  await disabled.coordinator.check()
  await disabled.coordinator.check(true)
  assert.equal(disabled.backend.eventNames().length, 0)
  assert.deepEqual(disabled.calls, ['desktop.update.unavailable-development'])
})

test('download rejection is consumed and active downloads are cancelled on disposal', async t => {
  const { coordinator, backend, calls } = fixture(t)
  const download = deferred()
  let cancelled = 0
  backend.checkForUpdates = async () => {
    backend.emit('update-available', { version: '0.2.0' })
    return { downloadPromise: download.promise, cancellationToken: { cancel: () => { cancelled++ } } }
  }
  await coordinator.check(true)
  coordinator.dispose()
  assert.equal(cancelled, 1)
  download.reject(new Error('checksum mismatch'))
  await tick()
  assert.deepEqual(calls, ['desktop.update.downloading {"version":"0.2.0"}'])
})

test('asynchronous installer errors remain observed after Host shutdown and recover once', async t => {
  const order = []
  const { coordinator, backend } = fixture(t, {
    prepareInstall: async () => { order.push('host-stopped'); return { intent: 'update', status: 'ready' } },
    message: (key, params) => { order.push(said(key, params)) },
    onInstallError: async () => { order.push('restart-current-version') },
  })
  backend.quitAndInstall = () => { order.push('install-requested') }
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(coordinator.phase, 'installing')
  backend.emit('error', new Error('signature rejected'))
  backend.emit('error', new Error('duplicate installer error'))
  await tick()
  assert.deepEqual(order, ['host-stopped', 'install-requested', 'desktop.update.install-failed {"detail":"signature rejected"}', 'restart-current-version'])
  assert.equal(coordinator.phase, 'error')
})

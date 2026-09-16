import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createUpdateCoordinator } from '../dist/electron/runtime/updates.js'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(t, overrides = {}) {
  const backend = new EventEmitter()
  const calls = []
  backend.checkForUpdates = async () => { calls.push('check'); backend.emit('update-not-available') }
  backend.quitAndInstall = () => { calls.push('install') }
  const coordinator = createUpdateCoordinator({ backend, enabled: true, initialDelayMs: 100_000,
    beforeInstall: async () => { calls.push('stop-host') },
    confirmInstall: async () => { calls.push('confirm'); return false },
    message: value => { calls.push(value) }, ...overrides })
  t.after(() => coordinator.dispose())
  return { backend, calls, coordinator }
}

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
  assert.deepEqual(calls, ['check', '当前已是最新版本。'])
  assert.equal(backend.autoInstallOnAppQuit, false)
})

test('downloaded update waits for consent and complete Host shutdown before installing', async t => {
  let accept = false
  const stopped = deferred()
  const order = []
  const { coordinator, backend } = fixture(t, {
    confirmInstall: async () => { order.push('confirm'); return accept },
    beforeInstall: async () => { order.push('stopping'); await stopped.promise; order.push('stopped') },
  })
  backend.quitAndInstall = (...args) => { assert.deepEqual(args, [false, true]); order.push('install') }
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(coordinator.phase, 'downloaded')
  assert.deepEqual(order, ['confirm'])
  accept = true
  const a = coordinator.check(true)
  const b = coordinator.install()
  assert.equal(a, b)
  await tick()
  assert.deepEqual(order, ['confirm', 'confirm', 'stopping'])
  stopped.resolve()
  await a
  assert.deepEqual(order, ['confirm', 'confirm', 'stopping', 'stopped', 'install'])
})

test('disposed coordinator removes all subscriptions and ignores a pending confirmation', async t => {
  const consent = deferred()
  const { coordinator, backend, calls } = fixture(t, { confirmInstall: () => consent.promise })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  coordinator.dispose()
  assert.equal(backend.eventNames().length, 0)
  consent.resolve(true)
  await tick()
  await coordinator.check(true)
  assert.deepEqual(calls, [])
})

test('network failure is recoverable and disabled builds never make requests', async t => {
  const failed = fixture(t)
  failed.backend.checkForUpdates = async () => { throw new Error('offline') }
  await failed.coordinator.check(true)
  assert.equal(failed.coordinator.phase, 'error')
  assert.deepEqual(failed.calls, ['检查更新失败：offline'])
  failed.backend.checkForUpdates = async () => failed.backend.emit('update-not-available')
  await failed.coordinator.check(true)
  assert.equal(failed.coordinator.phase, 'idle')
  const disabled = fixture(t, { enabled: false, unavailableReason: 'development build' })
  await disabled.coordinator.check()
  await disabled.coordinator.check(true)
  assert.equal(disabled.backend.eventNames().length, 0)
  assert.deepEqual(disabled.calls, ['development build'])
})

test('Host shutdown failure prevents updater quitAndInstall', async t => {
  const { coordinator, backend, calls } = fixture(t, {
    confirmInstall: async () => true,
    beforeInstall: async () => { throw new Error('Host is still running') },
  })
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(coordinator.phase, 'error')
  assert.deepEqual(calls, ['安装更新失败：Host is still running'])
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
  assert.deepEqual(calls, ['正在下载 PureTerm 0.2.0。'])
})

test('asynchronous installer errors remain observed after Host shutdown and recover once', async t => {
  const order = []
  const { coordinator, backend } = fixture(t, {
    confirmInstall: async () => true,
    beforeInstall: async () => { order.push('host-stopped') },
    message: text => { order.push(text) },
    onInstallError: async () => { order.push('restart-current-version') },
  })
  backend.quitAndInstall = () => { order.push('install-requested') }
  backend.emit('update-downloaded', { version: '0.2.0' })
  await tick()
  assert.equal(coordinator.phase, 'installing')
  backend.emit('error', new Error('signature rejected'))
  backend.emit('error', new Error('duplicate installer error'))
  await tick()
  assert.deepEqual(order, ['host-stopped', 'install-requested', '安装更新失败：signature rejected', 'restart-current-version'])
  assert.equal(coordinator.phase, 'error')
})

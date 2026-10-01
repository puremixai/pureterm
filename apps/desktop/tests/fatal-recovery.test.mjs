import assert from 'node:assert/strict'
import test from 'node:test'
import { createFatalRecoveryCoordinator } from '../dist/electron/runtime/fatal-recovery.js'

const report = (overrides = {}) => ({
  version: 1,
  timestamp: '2026-10-01T12:00:00.000Z',
  appVersion: '0.1.0-alpha.2',
  platform: 'win32',
  architecture: 'x64',
  phase: 'runtime',
  reason: 'unexpected-exit',
  pid: 4242,
  exitCode: 1,
  signal: null,
  ...overrides,
})

/**
 * 一个把每一步都记账的协调器。`order` 是断言顺序的唯一依据：恢复的纪律就是顺序，
 * 而不是「调用过没有」。
 */
function harness(overrides = {}) {
  const state = { record: 0, choose: 0, cleanup: 0, relaunch: 0, exits: [] }
  const order = []
  const options = {
    record: async () => { state.record += 1; order.push('record'); return '/tmp/host-1.json' },
    choose: async () => { state.choose += 1; order.push('choose'); return 'quit' },
    cleanup: async () => { state.cleanup += 1; order.push('cleanup') },
    relaunch: () => { state.relaunch += 1; order.push('relaunch') },
    exit: code => { state.exits.push(code); order.push(`exit:${code}`) },
    log: () => {},
    ...overrides,
  }
  return { coordinator: createFatalRecoveryCoordinator(options), state, order, options }
}

test('three failure events yield one dialog, one cleanup and one relaunch', async () => {
  const h = harness({ choose: async () => { h.state.choose += 1; h.order.push('choose'); return 'restart' } })
  const failure = report()
  // exit / disconnect / close 会各报一次同一件事：只处理第一次。
  await Promise.all([h.coordinator.handle(failure), h.coordinator.handle(failure), h.coordinator.handle(failure)])
  assert.equal(h.state.record, 1, 'one report')
  assert.equal(h.state.choose, 1, 'one prompt')
  assert.equal(h.state.cleanup, 1, 'one cleanup')
  assert.equal(h.state.relaunch, 1, 'one relaunch')
  assert.deepEqual(h.state.exits, [0], 'a restart hands over with exit code 0')
  assert.deepEqual(h.order, ['record', 'choose', 'cleanup', 'relaunch', 'exit:0'])

  // 恢复已经发生过了：后面再来的通知不再弹第二个框。
  await h.coordinator.handle(failure)
  assert.equal(h.state.choose, 1)
  assert.equal(h.state.relaunch, 1)
})

test('quit never relaunches', async () => {
  const h = harness()
  await h.coordinator.handle(report())
  assert.equal(h.state.relaunch, 0)
  assert.deepEqual(h.state.exits, [1], 'quitting after a failure is not a clean run')
  assert.deepEqual(h.order, ['record', 'choose', 'cleanup', 'exit:1'])
})

test('a disposed recovery cannot relaunch', async () => {
  const h = harness({ choose: async () => { h.state.choose += 1; h.order.push('choose'); return 'restart' } })
  const original = h.options.cleanup
  h.options.cleanup = async () => { await original(); h.coordinator.dispose() }
  await h.coordinator.handle(report())
  assert.equal(h.state.cleanup, 1)
  assert.equal(h.state.relaunch, 0, 'the replaced generation must not relaunch')
  assert.deepEqual(h.state.exits, [], 'and must not decide the exit either')

  const fresh = harness()
  fresh.coordinator.dispose()
  await fresh.coordinator.handle(report())
  assert.deepEqual(fresh.order, [], 'a disposed coordinator ignores the failure entirely')
})

test('relaunch waits for cleanup to finish', async () => {
  const h = harness({ choose: async () => { h.state.choose += 1; h.order.push('choose'); return 'restart' } })
  let stopped = false
  h.options.cleanup = async () => {
    h.state.cleanup += 1
    await new Promise(resolve => setTimeout(resolve, 20))
    stopped = true
    h.order.push('cleanup')
  }
  h.options.relaunch = () => {
    assert.equal(stopped, true, 'the Host must be stopped before a new process starts')
    h.state.relaunch += 1
    h.order.push('relaunch')
  }
  await h.coordinator.handle(report())
  assert.deepEqual(h.order, ['record', 'choose', 'cleanup', 'relaunch', 'exit:0'])
})

test('a failed report, prompt or cleanup never blocks recovery', async () => {
  const unwritable = harness({ choose: async () => { unwritable.state.choose += 1; unwritable.order.push('choose'); return 'restart' } })
  unwritable.options.record = async () => { unwritable.state.record += 1; unwritable.order.push('record'); return undefined }
  await unwritable.coordinator.handle(report())
  assert.deepEqual(unwritable.order, ['record', 'choose', 'cleanup', 'relaunch', 'exit:0'],
    'an unwritable report directory still permits restart')

  const silent = harness()
  silent.options.choose = async () => { silent.state.choose += 1; silent.order.push('choose'); throw new Error('no display') }
  await silent.coordinator.handle(report())
  assert.equal(silent.state.relaunch, 0, 'a prompt that cannot be shown never restarts')
  assert.deepEqual(silent.order, ['record', 'choose', 'cleanup', 'exit:1'])

  const stuck = harness()
  stuck.options.cleanup = async () => { stuck.state.cleanup += 1; stuck.order.push('cleanup'); throw new Error('Host did not stop') }
  await stuck.coordinator.handle(report())
  assert.deepEqual(stuck.order, ['record', 'choose', 'cleanup', 'exit:1'],
    'a cleanup that throws still leaves a way out')
})

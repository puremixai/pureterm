import assert from 'node:assert/strict'
import test from 'node:test'
import { createShutdownCoordinator } from '../dist/electron/runtime/shutdown.js'

/*
 * 这些测试全部走**假的** Host：真实的确认对话框和真实的子进程停不下来，
 * 而这里要钉死的是决策顺序——什么时候问、问几次、什么时候还租约、什么时候真的停。
 * 所以确认和 drain 都是可以挂起/失败的注入点，断言的是调用次数和顺序。
 */

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const ZERO = { activeSessions: 0, pendingConnections: 0, pendingFileOperations: 0, pendingMutations: 0 }

function codedError(code) {
  return Object.assign(new Error(`synthetic ${code}`), { code })
}

function fakeHost(overrides = {}) {
  const state = {
    activity: { ...ZERO },
    prepareSnapshot: undefined,
    inspectError: null,
    prepareError: null,
    drainError: null,
    stopError: null,
    cancelResult: true,
    stopResult: { graceful: true, exitCode: 0, signal: null },
    inspectCalls: 0,
    prepareCalls: [],
    drainCalls: [],
    cancelCalls: [],
    stopCalls: 0,
    ...overrides,
  }
  const host = {
    lifecycle: {
      async inspectActivity() {
        state.inspectCalls += 1
        if (state.inspectError) throw state.inspectError
        return { ...state.activity }
      },
      async prepareShutdown(leaseId) {
        state.prepareCalls.push(leaseId)
        if (state.prepareError) throw state.prepareError
        return { ...(state.prepareSnapshot ?? state.activity) }
      },
      async drainAccepted(leaseId, timeoutMs) {
        state.drainCalls.push({ leaseId, timeoutMs })
        if (state.drainError) throw state.drainError
        return { ...state.activity }
      },
      async cancelShutdown(leaseId) {
        state.cancelCalls.push(leaseId)
        return state.cancelResult
      },
    },
    async stop() {
      state.stopCalls += 1
      if (state.stopError) throw state.stopError
      return state.stopResult
    },
  }
  return { host, state }
}

function setup({ confirm, onFailure, generation, drainTimeoutMs } = {}) {
  const owner = { host: undefined }
  const generationRef = { value: generation ?? 1 }
  const confirmations = []
  const failures = []
  const coordinator = createShutdownCoordinator({
    getHost: () => owner.host,
    getGeneration: () => generationRef.value,
    confirm: (request) => {
      confirmations.push(request)
      return confirm ? confirm(request) : Promise.resolve(true)
    },
    onFailure: (error, phase) => { failures.push({ error, phase }); return onFailure?.(error, phase) },
    drainTimeoutMs,
  })
  return { coordinator, owner, generationRef, confirmations, failures }
}

test('cancel keeps the window and WebSocket alive and stops nothing', async () => {
  const { host, state } = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const { coordinator, owner, confirmations } = setup({ confirm: () => Promise.resolve(false) })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'cancelled')
  assert.equal(state.stopCalls, 0, 'a cancelled quit must not stop the Host')
  assert.deepEqual(state.prepareCalls, [], 'cancelling before confirmation never even takes a lease')
  assert.equal(confirmations.length, 1)
  assert.equal(confirmations[0].phase, 'initial')
  assert.equal(confirmations[0].intent, 'quit')
})

test('cancelling after the lease returns it and lets new work be admitted again', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, activeSessions: 1 },
    prepareSnapshot: { ...ZERO, activeSessions: 2 },
  })
  // First confirm (initial) accepts; the post-lease recheck is declined.
  let call = 0
  const { coordinator, owner } = setup({ confirm: () => Promise.resolve(++call === 1) })
  owner.host = host

  const first = await coordinator.prepare('quit')
  assert.equal(first.status, 'cancelled')
  assert.equal(state.prepareCalls.length, 1, 'the lease was taken before the recheck')
  assert.deepEqual(state.cancelCalls, state.prepareCalls, 'the same lease is returned')
  assert.equal(state.stopCalls, 0)

  // Admission is free again: a fresh quit with zero activity proceeds without a lease conflict.
  state.activity = { ...ZERO }
  state.prepareSnapshot = undefined
  const second = await coordinator.prepare('quit')
  assert.equal(second.status, 'ready')
  assert.equal(state.stopCalls, 1)
})

test('new work admitted between inspection and preparation triggers a recheck', async () => {
  const { host, state } = fakeHost({ prepareSnapshot: { ...ZERO, pendingConnections: 1 } })
  const { coordinator, owner, confirmations } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'ready')
  assert.deepEqual(confirmations.map(request => request.phase), ['changed'],
    'a zero-activity inspect followed by a busy lease must re-confirm')
  assert.deepEqual(confirmations[0].activity, { ...ZERO, pendingConnections: 1 })
  assert.equal(state.stopCalls, 1)
})

test('a zero-activity ordinary quit stops without asking', async () => {
  const { host, state } = fakeHost()
  const { coordinator, owner, confirmations } = setup()
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'ready')
  assert.equal(confirmations.length, 0, 'no work means no interruption dialog')
  assert.equal(state.prepareCalls.length, 1, 'admission is still locked before stopping')
  assert.equal(state.stopCalls, 1)
})

test('repeated quit requests confirm and stop exactly once', async () => {
  const { host, state } = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const gate = deferred()
  const { coordinator, owner, confirmations } = setup({ confirm: () => gate.promise })
  owner.host = host

  const first = coordinator.prepare('quit')
  const second = coordinator.prepare('quit')
  assert.equal(first, second, 'identical in-flight requests share one promise')
  gate.resolve(true)
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual([a.status, b.status], ['ready', 'ready'])
  assert.equal(confirmations.length, 1, 'the user is asked once')
  assert.equal(state.stopCalls, 1, 'the Host is stopped once')
})

test('a conflicting update cannot borrow an in-flight ordinary quit', async () => {
  const { host } = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const gate = deferred()
  const { coordinator, owner } = setup({ confirm: () => gate.promise })
  owner.host = host

  const quit = coordinator.prepare('quit')
  const update = await coordinator.prepare('update', '1.2.3')
  assert.equal(update.status, 'busy')
  assert.equal(update.intent, 'update')
  gate.resolve(true)
  assert.equal((await quit).status, 'ready')
})

test('a late confirmation cannot stop a replacement Host', async () => {
  const { host, state } = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const replacement = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const gate = deferred()
  const { coordinator, owner } = setup({ confirm: () => gate.promise })
  owner.host = host

  const decision = coordinator.prepare('quit')
  owner.host = replacement.host // a new Host took over while the dialog was open
  gate.resolve(true)
  assert.equal((await decision).status, 'cancelled')
  assert.equal(state.stopCalls, 0, 'the old Host is not stopped')
  assert.equal(replacement.state.stopCalls, 0, 'the replacement Host is not stopped either')
})

test('a late confirmation cannot stop a replacement document sharing the Host', async () => {
  const { host, state } = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const gate = deferred()
  const { coordinator, owner, generationRef } = setup({ confirm: () => gate.promise })
  owner.host = host

  const decision = coordinator.prepare('quit')
  generationRef.value = 2 // the same Host now backs a new shell generation
  gate.resolve(true)
  assert.equal((await decision).status, 'cancelled')
  assert.equal(state.stopCalls, 0)
})

test('an inspection failure is unknown activity, never an empty snapshot', async () => {
  const { host, state } = fakeHost({ inspectError: new Error('inspect timed out') })
  const { coordinator, owner, confirmations, failures } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'ready')
  assert.equal(confirmations.length, 1)
  assert.equal(confirmations[0].phase, 'unknown')
  assert.equal(confirmations[0].activity, undefined, 'no snapshot is fabricated from a failure')
  assert.ok(failures.length >= 1 && failures.every(entry => entry.phase === 'inspect'),
    'every inspection failure is reported as an inspect failure')
  assert.equal(state.stopCalls, 1)
})

test('a drain timeout on ordinary quit asks for force and cancel releases the lease', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, activeSessions: 1 },
    drainError: codedError('host.lifecycle-drain-timeout'),
  })
  const phases = []
  const { coordinator, owner } = setup({
    confirm: (request) => { phases.push(request.phase); return Promise.resolve(request.phase !== 'force') },
  })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'cancelled')
  assert.deepEqual(phases, ['initial', 'force'])
  assert.equal(state.stopCalls, 0, 'declining the force prompt keeps the Host running')
  assert.equal(state.cancelCalls.length, 1, 'the lease is returned so admission reopens')
})

test('a drain timeout on ordinary quit proceeds once force is accepted', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, activeSessions: 1 },
    drainError: codedError('host.lifecycle-drain-timeout'),
  })
  const { coordinator, owner } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'ready')
  assert.equal(state.stopCalls, 1)
})

test('an update never forces through a drain timeout', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, pendingFileOperations: 1 },
    drainError: codedError('host.lifecycle-drain-timeout'),
  })
  const { coordinator, owner, confirmations } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  const decision = await coordinator.prepare('update', '2.0.0')
  assert.equal(decision.status, 'failed')
  assert.deepEqual(confirmations.map(request => request.phase), ['initial'])
  assert.equal(state.stopCalls, 0)
  assert.equal(state.cancelCalls.length, 1)
})

test('an update requires a graceful stop before it is ready', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, activeSessions: 1 },
    stopResult: { graceful: false, exitCode: 1, signal: 'SIGKILL' },
  })
  const { coordinator, owner, failures } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  const decision = await coordinator.prepare('update', '2.0.0')
  assert.equal(decision.status, 'failed')
  assert.equal(state.stopCalls, 1)
  assert.deepEqual(failures.map(entry => entry.phase), ['stop'])
})

test('an ordinary quit may complete with a non-graceful stop', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, activeSessions: 1 },
    stopResult: { graceful: false, exitCode: 1, signal: 'SIGKILL' },
  })
  const { coordinator, owner } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'ready', 'the user already chose to quit; a killed child still quits')
  assert.equal(state.stopCalls, 1)
})

test('an unacknowledged lease cancellation goes to failure, not a usable page', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, activeSessions: 1 },
    prepareSnapshot: { ...ZERO, activeSessions: 2 },
    cancelResult: false,
  })
  let call = 0
  const { coordinator, owner, failures } = setup({ confirm: () => Promise.resolve(++call === 1) })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'failed')
  assert.equal(state.stopCalls, 0)
  assert.deepEqual(failures.map(entry => entry.phase), ['prepare'])
})

test('a Host already holding another lease reports busy', async () => {
  const { host, state } = fakeHost({
    activity: { ...ZERO, activeSessions: 1 },
    prepareError: codedError('host.lifecycle-busy'),
  })
  const { coordinator, owner } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  const decision = await coordinator.prepare('quit')
  assert.equal(decision.status, 'busy')
  assert.equal(state.stopCalls, 0)
})

test('ready is reserved until cleanup commits, so a stopped Host is not prepared twice', async () => {
  const { host, state } = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const { coordinator, owner, confirmations } = setup({ confirm: () => Promise.resolve(true) })
  owner.host = host

  assert.equal((await coordinator.prepare('quit')).status, 'ready')
  assert.equal((await coordinator.prepare('quit')).status, 'ready', 'the reserved decision is reused')
  assert.equal(confirmations.length, 1, 'no second dialog against the stopped Host')
  assert.equal(state.stopCalls, 1)

  // A different intent against the same reserved Host must not borrow the ready result.
  assert.equal((await coordinator.prepare('update', '9.9.9')).status, 'busy')

  coordinator.dispose()
  owner.host = undefined
  assert.equal((await coordinator.prepare('quit')).status, 'ready', 'after commit there is nothing left to stop')
})

test('disposal during a pending confirmation cancels without stopping', async () => {
  const { host, state } = fakeHost({ activity: { ...ZERO, activeSessions: 1 } })
  const gate = deferred()
  const { coordinator, owner } = setup({ confirm: () => gate.promise })
  owner.host = host

  const decision = coordinator.prepare('quit')
  coordinator.dispose()
  gate.resolve(true)
  assert.equal((await decision).status, 'cancelled')
  assert.equal(state.stopCalls, 0)
})

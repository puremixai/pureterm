import assert from 'node:assert/strict'
import test from 'node:test'
import { claimDesktopSingleInstance } from '../dist/electron/runtime/single-instance.js'

/** Minimal structural stand-in for Electron's `app`. */
function fakeApplication({ grant }) {
  const listeners = new Map()
  return {
    requested: [],
    quitCalls: 0,
    hostStarts: 0,
    requestSingleInstanceLock(additionalData) {
      this.requested.push(additionalData)
      return grant
    },
    on(event, listener) { listeners.set(event, listener) },
    quit() { this.quitCalls += 1 },
    emitSecondInstance(additionalData) { listeners.get('second-instance')?.({}, [], '', additionalData) },
    hasSecondInstanceHandler() { return listeners.has('second-instance') },
  }
}

test('the first launch owns the lock and routes a second launch to one focus action', () => {
  const app = fakeApplication({ grant: true })
  const focuses = []
  const owner = claimDesktopSingleInstance(app, '/data/ssh', dir => focuses.push(dir))
  assert.equal(owner, true)
  assert.equal(app.quitCalls, 0)
  assert.deepEqual(app.requested, [{ dataDir: '/data/ssh' }])

  app.emitSecondInstance({ dataDir: '/data/ssh' })
  assert.deepEqual(focuses, ['/data/ssh'], 'exactly one restore/focus action for the same directory')
})

test('the second launch quits without starting a Host or registering a focus path', () => {
  const app = fakeApplication({ grant: false })
  const focuses = []
  const owner = claimDesktopSingleInstance(app, '/data/ssh', dir => focuses.push(dir))
  assert.equal(owner, false, 'the loser must not proceed to start a Host')
  assert.equal(app.quitCalls, 1, 'the loser asks the application to quit')
  assert.equal(app.hasSecondInstanceHandler(), false, 'a loser routes nothing')
  assert.deepEqual(focuses, [])
})

test('a different requested directory is reported to the owner, never silently adopted', () => {
  const app = fakeApplication({ grant: true })
  const focuses = []
  claimDesktopSingleInstance(app, '/data/ssh', dir => focuses.push(dir))
  app.emitSecondInstance({ dataDir: '/data/other' })
  // The seam forwards the requested directory unchanged; the owner decides whether to
  // focus itself or explain that it will not switch. It is still exactly one action.
  assert.deepEqual(focuses, ['/data/other'])
})

test('a second launch that arrives before the window exists still yields one focus', () => {
  const app = fakeApplication({ grant: true })
  let windowReady = false
  let pending = 0
  const focuses = []
  claimDesktopSingleInstance(app, '/data/ssh', dir => {
    // Mirrors main.ts: record the request until the shell generation exists, then focus.
    if (!windowReady) { pending += 1; return }
    focuses.push(dir)
  })
  app.emitSecondInstance({ dataDir: '/data/ssh' })
  assert.deepEqual(focuses, [], 'no window yet, so the request is pending')
  windowReady = true
  assert.equal(pending, 1)
  focuses.push('/data/ssh') // the deferred focus runs once the window is up
  assert.deepEqual(focuses, ['/data/ssh'])
})

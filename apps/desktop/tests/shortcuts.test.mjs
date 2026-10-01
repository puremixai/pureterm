import assert from 'node:assert/strict'
import test from 'node:test'
import { installDesktopShortcuts, narrowShortcutContext } from '../dist/electron/app/shortcuts.js'

const CONTEXT = {
  terminalTabs: 2, activeTerminal: true, connectedTerminal: true,
  libraryVisible: false, editorOpen: false, modalOpen: false, composing: false,
}
const input = (overrides = {}) => ({
  type: 'keyDown', key: 'w', code: 'KeyW',
  control: true, meta: false, shift: false, alt: false, isComposing: false, isAutoRepeat: false,
  ...overrides,
})

function fakeWindow() {
  const sent = []
  const listeners = new Set()
  const webContents = {
    send: (channel, command) => sent.push({ channel, command }),
    on(event, listener) { if (event === 'before-input-event') listeners.add(listener) },
    removeListener(event, listener) { if (event === 'before-input-event') listeners.delete(listener) },
    isDestroyed: () => false,
  }
  return {
    window: { webContents, isDestroyed: () => false },
    sent,
    listenerCount: () => listeners.size,
    press(inputEvent) {
      let prevented = 0
      const event = { preventDefault: () => { prevented += 1 } }
      for (const listener of listeners) listener(event, inputEvent)
      return prevented
    },
  }
}

test('a consumed native key is prevented once and sends exactly one command', () => {
  const fake = fakeWindow()
  const shortcuts = installDesktopShortcuts(fake.window, 'other')
  shortcuts.reportContext({ ...CONTEXT })
  const prevented = fake.press(input())
  assert.equal(prevented, 1, 'the native key is consumed once')
  assert.deepEqual(fake.sent, [{ channel: 'desktop:shortcut-command', command: 'terminal.close' }])
})

test('a new generation consumes nothing until a valid context arrives', () => {
  const fake = fakeWindow()
  installDesktopShortcuts(fake.window, 'other')
  assert.equal(fake.press(input()), 0, 'no context report means no key is taken from the terminal')
  assert.deepEqual(fake.sent, [])
})

test('AltGr, composition and key-up pass through the native path untouched', () => {
  const fake = fakeWindow()
  const shortcuts = installDesktopShortcuts(fake.window, 'other')
  shortcuts.reportContext({ ...CONTEXT })
  assert.equal(fake.press(input({ alt: true })), 0)
  assert.equal(fake.press(input({ isComposing: true })), 0)
  assert.equal(fake.press(input({ type: 'keyUp' })), 0)
  assert.equal(fake.press(input({ control: true, shift: true })), 0, 'an extra modifier is not a match')
  assert.deepEqual(fake.sent, [])
})

test('the native adapter follows the platform binding table', () => {
  const mac = fakeWindow()
  const shortcuts = installDesktopShortcuts(mac.window, 'mac')
  shortcuts.reportContext({ ...CONTEXT })
  assert.equal(mac.press(input({ key: 'Tab', code: 'Tab', control: true })), 1, 'literal Ctrl+Tab cycles on macOS')
  assert.equal(mac.press(input({ control: false, meta: true })), 1, 'Cmd+W closes on macOS')
  assert.equal(mac.press(input({ control: true, meta: false })), 0, 'Ctrl+W is not the macOS close binding')
})

test('dispatch sends a command and dispose removes the listener', () => {
  const fake = fakeWindow()
  const shortcuts = installDesktopShortcuts(fake.window, 'other')
  shortcuts.reportContext({ ...CONTEXT })
  assert.equal(shortcuts.dispatch('sftp.toggle'), true)
  assert.deepEqual(fake.sent, [{ channel: 'desktop:shortcut-command', command: 'sftp.toggle' }])
  shortcuts.dispose()
  assert.equal(fake.listenerCount(), 0, 'the adapter owns exactly one listener and removes it')
  assert.equal(fake.press(input()), 0)
})

test('an old generation cannot receive commands or late context reports', () => {
  const fake = fakeWindow()
  const shortcuts = installDesktopShortcuts(fake.window, 'other')
  shortcuts.reportContext({ ...CONTEXT })
  shortcuts.dispose()
  // 这一代已经被换掉：迟到的菜单命令不能再落到它身上，按键也不再被它裁决，
  // 上下文上报同样失效 —— 否则一个旧窗口还能替新窗口执行命令。
  assert.equal(shortcuts.dispatch('terminal.close'), false, 'a disposed adapter refuses to dispatch')
  assert.equal(shortcuts.reportContext({ ...CONTEXT, modalOpen: true }), undefined)
  assert.equal(fake.press(input()), 0, 'the removed listener takes no key')
  assert.deepEqual(fake.sent, [], 'nothing reaches the renderer from a disposed generation')
})

test('narrowShortcutContext accepts a full record and rejects anything else', () => {
  assert.deepEqual(narrowShortcutContext({ ...CONTEXT }), CONTEXT)
  assert.equal(narrowShortcutContext(undefined), undefined)
  assert.equal(narrowShortcutContext(null), undefined)
  assert.equal(narrowShortcutContext([]), undefined)
  assert.equal(narrowShortcutContext({ ...CONTEXT, terminalTabs: -1 }), undefined)
  assert.equal(narrowShortcutContext({ ...CONTEXT, terminalTabs: 1.5 }), undefined)
  assert.equal(narrowShortcutContext({ ...CONTEXT, activeTerminal: 'yes' }), undefined)
  assert.equal(narrowShortcutContext({ terminalTabs: 0 }), undefined, 'a partial record is not a context')
})

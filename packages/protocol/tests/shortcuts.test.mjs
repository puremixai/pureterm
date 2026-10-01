import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getShortcutBindings, isShortcutEnabled, resolveShortcut, shortcutKeyLabel, shortcutModifierLabels,
} from '../dist/protocol.js'

const COMMANDS = ['terminal.next', 'terminal.previous', 'terminal.close', 'terminal.focus', 'sftp.toggle', 'hosts.search', 'hosts.dismiss-editor']

const key = (name, options = {}) => ({
  key: name,
  code: options.code ?? (name.length === 1 ? `Key${name.toUpperCase()}` : name),
  ctrl: !!options.ctrl, meta: !!options.meta, shift: !!options.shift, alt: !!options.alt,
  composing: !!options.composing, repeat: !!options.repeat, type: options.type ?? 'keydown',
})
const context = (overrides = {}) => ({
  terminalTabs: 0, activeTerminal: false, connectedTerminal: false,
  libraryVisible: false, editorOpen: false, modalOpen: false, composing: false, ...overrides,
})
const working = context({ terminalTabs: 2, activeTerminal: true, connectedTerminal: true })

test('every workspace command has exactly one binding per platform', () => {
  for (const platform of ['mac', 'other']) {
    const bindings = getShortcutBindings(platform)
    assert.deepEqual(bindings.map(binding => binding.command).sort(), [...COMMANDS].sort())
    assert.equal(new Set(bindings.map(binding => binding.command)).size, bindings.length, 'commands are unique')
    for (const binding of bindings) {
      assert.equal(('key' in binding) !== ('code' in binding), true, `${binding.command} must carry exactly one of key/code`)
    }
  }
})

test('composition and AltGr pass through untouched', () => {
  assert.equal(resolveShortcut(key('w', { ctrl: true, composing: true }), working, 'other'), undefined, 'an IME composition event is never consumed')
  assert.equal(resolveShortcut(key('w', { ctrl: true }), context({ ...working, composing: true }), 'other'), undefined, 'composition context blocks the whole workspace')
  assert.equal(resolveShortcut(key('e', { ctrl: true, alt: true }), working, 'other'), undefined, 'AltGr/Alt belongs to input, not the workspace')
  assert.equal(resolveShortcut(key('w', { ctrl: true, type: 'keyup' }), working, 'other'), undefined, 'key-up never triggers')
})

test('an open editor and a modal retain input', () => {
  const editor = context({ ...working, editorOpen: true })
  assert.equal(resolveShortcut(key('w', { ctrl: true }), editor, 'other'), undefined, 'closing a tab is suppressed while the editor owns input')
  assert.equal(resolveShortcut(key('e', { ctrl: true }), editor, 'other'), undefined, 'the file panel is suppressed while the editor owns input')
  assert.equal(resolveShortcut(key('Escape'), editor, 'other'), 'hosts.dismiss-editor', 'Escape still collapses the editor')
  const modal = context({ ...working, editorOpen: true, modalOpen: true })
  assert.equal(resolveShortcut(key('Escape'), modal, 'other'), undefined, 'a modal keeps Escape for itself')
})

test('Ctrl+K belongs to the host library only', () => {
  assert.equal(resolveShortcut(key('k', { ctrl: true }), context({ libraryVisible: true }), 'other'), 'hosts.search')
  assert.equal(resolveShortcut(key('k', { ctrl: true }), working, 'other'), undefined, 'the terminal keeps Ctrl+K for readline')
})

test('macOS uses literal Ctrl+Tab but Cmd for the primary bindings', () => {
  assert.equal(resolveShortcut(key('Tab', { ctrl: true }), working, 'mac'), 'terminal.next')
  assert.equal(resolveShortcut(key('Tab', { ctrl: true, shift: true }), working, 'mac'), 'terminal.previous')
  assert.equal(resolveShortcut(key('w', { meta: true }), working, 'mac'), 'terminal.close')
  assert.equal(resolveShortcut(key('w', { ctrl: true }), working, 'mac'), undefined, 'Ctrl+W is not the mac close binding')
  assert.equal(resolveShortcut(key('Tab', { meta: true }), working, 'mac'), undefined, 'Cmd+Tab is left to the system')
})

test('a repeated close does not close a second tab, but cycling may repeat', () => {
  assert.equal(resolveShortcut(key('w', { ctrl: true, repeat: true }), working, 'other'), undefined)
  assert.equal(resolveShortcut(key('Tab', { ctrl: true, repeat: true }), working, 'other'), 'terminal.next')
})

test('no active terminal does not close a window and does not focus a terminal', () => {
  assert.equal(resolveShortcut(key('w', { ctrl: true }), context({ terminalTabs: 0 }), 'other'), undefined)
  assert.equal(resolveShortcut(key('`', { ctrl: true, code: 'Backquote' }), context({ terminalTabs: 1 }), 'other'), undefined, 'focus needs an active tab, not just a tab count')
  assert.equal(resolveShortcut(key('`', { ctrl: true, code: 'Backquote' }), working, 'other'), 'terminal.focus')
})

test('tab cycling needs at least one real terminal tab', () => {
  assert.equal(resolveShortcut(key('Tab', { ctrl: true }), context({}), 'other'), undefined)
  assert.equal(resolveShortcut(key('Tab', { ctrl: true }), context({ terminalTabs: 1 }), 'other'), 'terminal.next')
})

test('the file panel requires a connected terminal', () => {
  assert.equal(resolveShortcut(key('e', { ctrl: true }), context({ activeTerminal: true, connectedTerminal: false }), 'other'), undefined)
  assert.equal(resolveShortcut(key('e', { ctrl: true }), working, 'other'), 'sftp.toggle')
})

test('extra modifiers never match a binding', () => {
  assert.equal(resolveShortcut(key('w', { ctrl: true, shift: true }), working, 'other'), undefined)
  assert.equal(resolveShortcut(key('w', { ctrl: true, alt: true }), working, 'other'), undefined)
  assert.equal(resolveShortcut(key('w', { meta: true }), working, 'other'), undefined, 'Cmd+W is not the other-platform close binding')
})

test('isShortcutEnabled agrees with the matcher for menus and help', () => {
  assert.equal(isShortcutEnabled('hosts.search', context({ libraryVisible: true })), true)
  assert.equal(isShortcutEnabled('hosts.search', working), false)
  assert.equal(isShortcutEnabled('terminal.close', context({ activeTerminal: true })), true)
  assert.equal(isShortcutEnabled('terminal.close', context({ terminalTabs: 1 })), false)
  assert.equal(isShortcutEnabled('hosts.dismiss-editor', context({ editorOpen: true })), true)
  assert.equal(isShortcutEnabled('hosts.dismiss-editor', context({})), false)
})

test('help labels read the same bindings the matcher uses', () => {
  assert.deepEqual(shortcutModifierLabels({ command: 'terminal.close', modifiers: ['meta'], key: 'w' }, 'mac'), ['⌘'])
  assert.deepEqual(shortcutModifierLabels({ command: 'terminal.close', modifiers: ['ctrl'], key: 'w' }, 'other'), ['Ctrl'])
  assert.deepEqual(shortcutModifierLabels({ command: 'terminal.previous', modifiers: ['ctrl', 'shift'], key: 'Tab' }, 'mac'), ['Ctrl', 'Shift'])
  assert.equal(shortcutKeyLabel({ command: 'terminal.focus', modifiers: ['ctrl'], code: 'Backquote' }), '`')
  assert.equal(shortcutKeyLabel({ command: 'hosts.dismiss-editor', modifiers: [], key: 'Escape' }), 'Esc')
  assert.equal(shortcutKeyLabel({ command: 'terminal.close', modifiers: ['ctrl'], key: 'w' }), 'W')
})

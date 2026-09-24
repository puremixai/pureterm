import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

// Four colours live outside the stylesheet: the theme-color meta the browser and
// the OS read, the Electron window background painted before the page exists,
// the window-button overlay the native controls sit on, and the overlay height
// that has to match the top bar CSS draws. None of them can import the ramp —
// the main process may not depend on a browser package — so the literals stay
// and this file is what keeps them from drifting.
const ui = (path) => readFile(new URL(path, import.meta.url), 'utf8')

const [tokens, html, chrome, shell] = await Promise.all([
  ui('../src/styles/tokens.css'),
  ui('../src/index.html'),
  ui('../src/styles/chrome.css'),
  ui('../../../apps/desktop/electron/app/shell.ts'),
])

const code = tokens.replace(/\/\*[\s\S]*?\*\//g, '')

function declaration(name) {
  const match = new RegExp(`^[ \\t]*${name}:[ \\t]*(#[0-9a-fA-F]{6})[ \\t]*;`, 'm').exec(code)
  assert.ok(match, `${name} must be a six-digit hex declaration in styles/tokens.css for this check to mean anything`)
  return match[1].toLowerCase()
}

function literal(pattern, label) {
  const match = pattern.exec(shell) ?? pattern.exec(html)
  assert.ok(match, `no ${label} matched; the file moved or the value changed shape`)
  return match[1].toLowerCase()
}

test('the window chrome colours agree with the ramp', () => {
  const chromeGround = declaration('--c-chrome')
  const muted = declaration('--tx-3')
  assert.equal(literal(/name="theme-color" content="(#[0-9a-fA-F]{6})"/, 'the theme-color meta'), chromeGround,
    'index.html theme-color must equal --c-chrome, the ground the top bar paints')
  assert.equal(literal(/backgroundColor:\s*'(#[0-9a-fA-F]{6})'/, 'the Electron backgroundColor'), chromeGround,
    'the window background must equal --c-chrome, or the app flashes a fifth colour before first paint')
  assert.equal(literal(/symbolColor:\s*'(#[0-9a-fA-F]{6})'/, 'the window-button symbolColor'), muted,
    'the window buttons are --tx-3 furniture, not --tx-1 content')
})

test('the overlay height agrees with the top bar the CSS draws', () => {
  // Scoped to the overlay block on purpose: `height:` also appears as the
  // window height four lines earlier, and an unscoped match reports 740.
  const overlay = /titleBarOverlay:\s*\{([^}]*)\}/.exec(shell)
  assert.ok(overlay, 'shell.ts lost its titleBarOverlay block')
  const height = /height:\s*(\d+)/.exec(overlay[1])
  assert.ok(height, 'the titleBarOverlay block lost its height')
  const row = /#app\s*\{[^}]*grid-template-rows:\s*(\d+)px/.exec(chrome)
  const fallback = /env\(titlebar-area-height,\s*(\d+)px\)/.exec(chrome)
  assert.ok(row && fallback, 'chrome.css must keep both a #app grid row and a titlebar-area-height fallback to compare against')
  assert.equal(height[1], row[1], 'the overlay height must equal the #app top row, or the first grid row is wrong')
  assert.equal(height[1], fallback[1], 'the overlay height must equal the top bar fallback, or a window without a titlebar area reports one height and paints another')
})

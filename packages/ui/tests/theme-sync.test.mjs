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

function pixel(name) {
  const match = new RegExp(`^[ \\t]*${name}:[ \\t]*(\\d+)px[ \\t]*;`, 'm').exec(code)
  assert.ok(match, `${name} must be an integer px declaration in styles/tokens.css for this check to mean anything`)
  return match[1]
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
  const chromeHeight = pixel('--chrome-h')
  const row = /#app\s*\{[^}]*grid-template-rows:\s*var\(--chrome-h\)\s+minmax\(0,\s*1fr\)\s+var\(--status-h\);/
    .exec(chrome)
  const fallback = /env\(titlebar-area-height,\s*(\d+)px\)/.exec(chrome)
  assert.ok(row, 'the #app grid must be three rows: var(--chrome-h), the content, then var(--status-h)')
  assert.ok(fallback, 'chrome.css must keep an env(titlebar-area-height, …) fallback to compare against')
  assert.equal(height[1], chromeHeight, 'the overlay height must equal --chrome-h, the only written top-bar height')
  assert.equal(fallback[1], chromeHeight,
    'the fallback must equal --chrome-h; env() cannot read a custom property, so this literal is the one place the number is repeated and this assertion is what ties it')
  assert.equal(pixel('--status-h'), '24', 'the status row is a design decision, not a leftover')
})

// The mark is drawn twice: once as the 18px glyph in the top bar, where CSS owns
// the colour, and once as a favicon, where a data: URI cannot read a custom
// property. Two copies of one glyph is the exact debt this system exists to
// remove, so the path data and both colours are compared instead of trusted.
test('the brand mark and the favicon are the same glyph in the same colours', () => {
  const mark = /class="workspace-mark"[^>]*>([\s\S]*?)<\/span>/.exec(html)
  assert.ok(mark, 'index.html lost the .workspace-mark element')
  const paths = [...mark[1].matchAll(/d="([^"]+)"/g)].map((m) => m[1])
  assert.equal(paths.length, 2, 'the mark is a chevron and a cursor bar, in that order')

  const icon = /rel="icon" href="data:image\/svg\+xml,([^"]+)"/.exec(html)
  assert.ok(icon, 'index.html must carry an inline SVG favicon')
  const svg = decodeURIComponent(icon[1])
  // The URI uses single quotes because the attribute itself uses double ones, so
  // only the path data and the colour value are compared, never the quoting.
  for (const d of paths) assert.ok(svg.includes(d), `the favicon is missing the mark path ${d}`)
  assert.equal(/fill=['"]?(#[0-9a-fA-F]{6})/.exec(svg)?.[1].toLowerCase(), declaration('--c-chrome'),
    'the favicon ground must equal --c-chrome, the ground the top bar paints')
  assert.equal(/stroke=['"]?(#[0-9a-fA-F]{6})/.exec(svg)?.[1].toLowerCase(), declaration('--ac'),
    'the favicon glyph must equal --ac, which is what .workspace-mark colours itself with')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

// Two colours live outside the stylesheet: the theme-color meta the browser and
// the OS read, and the Electron window background painted before the page
// exists. Neither can import the ramp — the main process may not depend on a
// browser package — so the literals stay and this file is what keeps them from
// drifting. Two more used to sit beside them, both belonging to a system-drawn
// titleBarOverlay: the `symbolColor` of its caption glyphs, and the overlay's
// own `color`. Both are gone with the overlay, because the top bar now draws
// those buttons on the platforms that have no native set, takes their colour
// from the ramp, and macOS keeps its own traffic lights.
const ui = (path) => readFile(new URL(path, import.meta.url), 'utf8')

const [tokens, html, chrome, shell, controls, desktop] = await Promise.all([
  ui('../src/styles/tokens.css'),
  ui('../src/index.html'),
  ui('../src/styles/chrome.css'),
  ui('../../../apps/desktop/electron/app/shell.ts'),
  ui('../src/styles/window-controls.css'),
  ui('../src/desktop.css'),
])

// Comments document, they do not declare. This file compares what two sources
// *declare*, and both of them explain themselves in prose that names the very things
// the assertions look for — shell.ts says in a comment why it does not set
// titleBarOverlay, and chrome.css says in a comment why it no longer reads
// env(titlebar-area-*). Reading the raw text would fail on the explanation and pass on
// nothing. Blanking rather than deleting keeps line offsets, and TypeScript's second
// comment form goes too.
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const code = withoutComments(tokens)
const chromeCode = withoutComments(chrome)
const shellCode = withoutComments(shell)
const desktopCode = withoutComments(desktop)

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
  const match = pattern.exec(shellCode) ?? pattern.exec(html)
  assert.ok(match, `no ${label} matched; the file moved or the value changed shape`)
  return match[1].toLowerCase()
}

test('the window chrome colours agree with the ramp', () => {
  const chromeGround = declaration('--c-chrome')
  assert.equal(literal(/name="theme-color" content="(#[0-9a-fA-F]{6})"/, 'the theme-color meta'), chromeGround,
    'index.html theme-color must equal --c-chrome, the ground the top bar paints')
  assert.equal(literal(/backgroundColor:\s*'(#[0-9a-fA-F]{6})'/, 'the Electron backgroundColor'), chromeGround,
    'the window background must equal --c-chrome, or the app flashes a fifth colour before first paint')
})

test('the top bar is the height the token says, and the OS draws nothing in it', () => {
  const chromeHeight = pixel('--chrome-h')
  const row = /#app\s*\{[^}]*grid-template-rows:\s*var\(--chrome-h\)\s+minmax\(0,\s*1fr\)\s+var\(--status-h\);/
    .exec(chromeCode)
  const bar = /\.app-topbar\s*\{[^}]*height:\s*var\(--chrome-h\)/.exec(chromeCode)
  assert.ok(row, 'the #app grid must be three rows: var(--chrome-h), the content, then var(--status-h)')
  assert.ok(bar, 'the top bar must take its height from --chrome-h; a second written height is the drift this catches')
  // Windows/Linux: the bar draws its own minimize/maximize/close, so the shell must not
  // also ask the OS to paint a second set — and it must not inset the bar for buttons
  // that will never arrive. macOS is the third case and keeps its traffic lights, so it
  // gets no self-drawn cluster at all; that half is a platform question and is asserted
  // in apps/desktop/tests/smoke-desktop.mjs.
  assert.doesNotMatch(shellCode, /titleBarOverlay/,
    'shell.ts must not configure titleBarOverlay: the top bar draws those buttons, and two sets is the bug')
  assert.doesNotMatch(chromeCode, /env\(titlebar-area-/,
    'chrome.css must not read titlebar-area-*: with no overlay those env() calls can never resolve')
  assert.match(shellCode, /titleBarStyle:\s*'hidden'/, 'the native title bar stays hidden')
  assert.equal(pixel('--status-h'), '24', 'the status row is a design decision, not a leftover')
  assert.equal(chromeHeight, '40', 'the caption buttons are drawn inside this, so it is a layout contract too')
  // The caption sheet is delivered by the second manifest and by nothing else, so the
  // measurements below read a file the desktop entry really gets and the Web entry
  // really does not.
  assert.match(desktopCode, /@import\s+['"]\.\/styles\/window-controls\.css['"]/,
    'desktop.css must import the caption sheet, or the desktop entry gets buttons with no rules')
})

// The tab strip and the rail items live inside a bar whose height is fixed by
// --chrome-h, so anything taller is painted over the hairline. base.css gives
// every button min-height: 28px, which a bare `height` loses to — that is the
// trap this reads, and why the rail item names min-height as well as height.
// The caption buttons are measured out of window-controls.css rather than
// chrome.css: they moved out of the shared cascade so the Web entry stops
// carrying rules for a window it does not have.
test('the top bar contents fit the height the bar is given', () => {
  const bar = Number(pixel('--chrome-h'))
  const tab = /\.app-tab\s*\{[^}]*min-height:\s*(\d+)px/.exec(chromeCode)
  const item = /\.nav-item\s*\{[^}]*min-height:\s*(\d+)px/.exec(chromeCode)
  const control = /\.window-control\s*\{[^}]*height:\s*(\d+)px[^}]*min-height:\s*(\d+)px/.exec(controls)
  const strip = /\.workspace-tabs\s*\{[^}]*padding:\s*([^;]+);/.exec(chromeCode)
  assert.ok(tab && item, '.app-tab and .nav-item must each set min-height; height alone loses to base.css')
  assert.ok(control, '.window-control must write height and min-height together; height alone loses to base.css')
  assert.ok(Number(tab[1]) <= bar, `.app-tab is ${tab[1]}px tall inside a ${bar}px bar`)
  assert.ok(Number(item[1]) <= bar, `.nav-item is ${item[1]}px tall inside a ${bar}px bar`)
  assert.equal(control[1], control[2],
    'the caption buttons write one number twice on purpose: base.css floors every button at 28px, so a bare height is not what they get')
  assert.ok(Number(control[1]) <= bar, `.window-control is ${control[1]}px tall inside a ${bar}px bar`)
  assert.match(strip[1], /^0 \d/, 'the tab strip must not add vertical padding inside a fixed-height bar')
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

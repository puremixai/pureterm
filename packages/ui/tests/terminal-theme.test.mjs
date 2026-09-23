import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/terminal-view.ts', import.meta.url), 'utf8')

test('the xterm theme reads its colours from the terminal tokens', () => {
  assert.match(source, /getComputedStyle/, 'the xterm theme must be resolved from CSS custom properties')
  assert.match(source, /--term-bg/, 'the terminal background must come from --term-bg')
  assert.match(source, /--term-fg/, 'the foreground must come from --term-fg')
  assert.match(source, /--term-cursor/, 'the cursor must come from --term-cursor')
  assert.match(source, /--term-selection/, 'the selection must come from --term-selection')
})

// The theme object is the seam between CSS and xterm, so it is scanned for
// literals directly: `theme: {` opens it and the first line that closes a brace
// ends it. Everything else in the file, including the ANSI array, is outside.
test('no xterm colour is hard-coded except the ANSI palette', () => {
  const theme = /theme:\s*\{([\s\S]*?)\n\s*\},/.exec(source)
  assert.ok(theme, 'the xterm theme object was not found')
  const literals = theme[1].match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.equal(literals.length, 0, `the theme object must hold only token reads, found ${literals.join(', ')}`)
})

test('cursorAccent survives, because xterm needs it to invert the glyph under the cursor', () => {
  assert.match(source, /cursorAccent:\s*read\('--term-bg'\)/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { DARK, token, triplet } from './token-source.mjs'

const source = await readFile(new URL('../src/terminal-view.ts', import.meta.url), 'utf8')

// The sixteen palette entries, read out of the source rather than copied here:
// a test that re-typed the literals could pass while the array it names drifted.
function ansi() {
  const list = /const ANSI:\s*string\[\]\s*=\s*\[([\s\S]*?)\]/.exec(source)
  assert.ok(list, 'the ANSI array was not found in terminal-view.ts')
  const entries = [...list[1].matchAll(/['"](#[0-9a-fA-F]{3,8})['"]/g)].map((m) => m[1])
  assert.equal(entries.length, 16, `the ANSI array holds ${entries.length} entries, not 16`)
  return entries
}

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

// The family list is CSS material too: a copy here would drift from --font-term
// silently, and that token is the one holding the CJK mono fallbacks a terminal
// needs to draw box-drawing and wide glyphs at all.
test('the terminal font resolves from --font-term instead of a copy of it', () => {
  assert.match(source, /fontFamily:\s*read\('--font-term'\)/,
    'the terminal family must come from --font-term')
  assert.ok(!/fontFamily:\s*['"]/.test(source),
    'terminal-view.ts must not carry a font stack of its own')
})

// Seven of the sixteen ANSI entries are the dark group's own colours wearing a
// second name: red is --err, green is --ok, yellow is --warn, blue is --ac,
// white is --tx-2, brightBlue is --ac-hi and brightWhite is --tx-1. Each is a
// hand-copy that no var() reaches, exactly like --term-cursor — whose tie in
// design-tokens.test.mjs gives the reason in one line: without an assertion a
// palette flip leaves the copy behind in silence. Tied to the dark group alone
// because the ANSI list is dark terminal material in both themes, so retuning a
// light value must not move it. Compared as a triplet, not as a string, so the
// tie survives a legitimate change of notation and still fails a change of hue.
const MIRRORED = [
  [1, 'red', '--err'],
  [2, 'green', '--ok'],
  [3, 'yellow', '--warn'],
  [4, 'blue', '--ac'],
  [7, 'white', '--tx-2'],
  [12, 'brightBlue', '--ac-hi'],
  [15, 'brightWhite', '--tx-1'],
]

test('every ANSI entry that mirrors a token is tied to it', () => {
  const entries = ansi()
  for (const [index, name, tokenName] of MIRRORED) {
    assert.deepEqual(triplet(entries[index]), triplet(token(DARK, tokenName)),
      `ANSI[${index}] ${name} is ${entries[index]} but the dark ${tokenName} is ${token(DARK, tokenName)}: `
      + 'the palette and the token it mirrors moved apart')
  }
})

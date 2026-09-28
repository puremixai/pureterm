import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { DARK, LIGHT, hex, ratio, token, triplet } from './token-source.mjs'

const source = await readFile(new URL('../src/terminal-view.ts', import.meta.url), 'utf8')

// A palette is read out of the source rather than copied here: a test that
// re-typed the literals could pass while the array it names drifted.
function ansi(name) {
  const list = new RegExp(`const ${name}:\\s*string\\[\\]\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(source)
  assert.ok(list, `the ${name} array was not found in terminal-view.ts`)
  const entries = [...list[1].matchAll(/['"](#[0-9a-fA-F]{3,8})['"]/g)].map((m) => m[1])
  assert.equal(entries.length, 16, `${name} holds ${entries.length} entries, not 16`)
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
// literals directly: `themeOf` opens its object after `=> ({` and the first line
// that closes it at the same indent ends it. The palettes are outside it, and so
// is the fold, which is asserted to name positions rather than colours.
function bodyOf(signature) {
  const match = new RegExp(`${signature}[\\s\\S]*?=> \\(\\{([\\s\\S]*?)\\n  \\}\\)`).exec(source)
  assert.ok(match, `${signature} was not found in terminal-view.ts`)
  return match[1]
}

test('no xterm colour is hard-coded outside the two ANSI palettes', () => {
  const theme = bodyOf('const themeOf = \\(\\): ITheme')
  const literals = theme.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.equal(literals.length, 0, `the theme object must hold only token reads, found ${literals.join(', ')}`)
  const fold = bodyOf('const palette = \\(entries: string\\[\\]\\): ITheme')
  const foldLiterals = fold.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.equal(foldLiterals.length, 0, `the palette fold must hand the entries over by position, found ${foldLiterals.join(', ')}`)
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

// A theme xterm resolves once is a theme the switch cannot reach, so the view
// re-reads on demand. Both halves are asserted: the interface method, and the
// one assignment xterm's ThemeService watches.
test('the theme is re-read on demand, not only at construction', () => {
  assert.match(source, /applyTheme\(\): void/, 'TerminalView must expose applyTheme')
  assert.match(source, /terminal\.options\.theme = themeOf\(\)/, 'applyTheme must re-assign the option xterm watches')
  assert.match(source, /probe\.dataset\.theme === 'light'/,
    'the palette must be chosen from the same data-theme the switch writes')
})

// Seven of the dark sixteen are the dark group's own colours wearing a second
// name: red is --err, green is --ok, yellow is --warn, blue is --ac, white is
// --tx-2, brightBlue is --ac-hi and brightWhite is --tx-1. Each is a hand-copy
// that no var() reaches, exactly like --term-cursor — whose tie in
// design-tokens.test.mjs gives the reason in one line: without an assertion a
// palette flip leaves the copy behind in silence. The light palette mirrors six
// of its own group; its brightBlue is deliberately not --ac-hi, because that
// token is the *darker* hover step in the light group while brightBlue has to
// stay the lighter blue. Compared as a triplet, not as a string, so each tie
// survives a legitimate change of notation and still fails a change of hue.
const MIRRORED = [
  ['ANSI_DARK', DARK, [[1, 'red', '--err'], [2, 'green', '--ok'], [3, 'yellow', '--warn'], [4, 'blue', '--ac'],
    [7, 'white', '--tx-2'], [12, 'brightBlue', '--ac-hi'], [15, 'brightWhite', '--tx-1']]],
  ['ANSI_LIGHT', LIGHT, [[1, 'red', '--err'], [2, 'green', '--ok'], [3, 'yellow', '--warn'], [4, 'blue', '--ac'],
    [7, 'white', '--tx-2'], [15, 'brightWhite', '--tx-1']]],
]

test('every ANSI entry that mirrors a token is tied to it', () => {
  for (const [name, selector, ties] of MIRRORED) {
    const entries = ansi(name)
    for (const [index, entry, tokenName] of ties) {
      assert.deepEqual(triplet(entries[index]), triplet(token(selector, tokenName)),
        `${name}[${index}] ${entry} is ${entries[index]} but ${selector} ${tokenName} is ${token(selector, tokenName)}: `
        + 'the palette and the token it mirrors moved apart')
    }
  }
})

// Each palette is measured on the canvas of its own group, which is the ground
// it actually paints. Entry 0 is the one exception, and for opposite reasons in
// the two groups: in the dark one it is deliberately the canvas's shadow step,
// in the light one it is a legible near-black. What the floor really pins is the
// dimmed-prompt colour — entry 8 is what a shell uses for text it wants quiet
// rather than hidden, and the first draft's dark value measured 2.92:1.
test('every ANSI entry a program can print is legible on its own canvas', () => {
  for (const [name, selector] of MIRRORED) {
    const entries = ansi(name)
    const canvas = hex(token(selector, '--term-bg'))
    assert.notDeepEqual(triplet(entries[0]), canvas,
      `${name}[0] must differ from ${selector} --term-bg, or black-on-terminal text is exactly 1.00:1`)
    for (const [index, value] of entries.entries()) {
      if (index === 0) continue
      const got = ratio(hex(value), canvas)
      assert.ok(got >= 3, `${name}[${index}] is ${value} at ${got.toFixed(2)}:1 on ${selector} --term-bg, under the 3:1 floor`)
    }
  }
})

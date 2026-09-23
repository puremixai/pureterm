import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

// Comments document, they do not declare. Stripping them first means an
// explanatory note can never certify a token that no longer exists.
const source = css.replace(/\/\*[\s\S]*?\*\//g, '')

const DARK = ':root'
const LIGHT = '[data-theme="light"]'

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Anchored on the start of a line, so a descendant rule such as
// `[data-theme="light"] .host-row {` cannot be mistaken for the theme block.
function block(selector) {
  const pattern = new RegExp(`^[ \\t]*${escapeRe(selector)}[ \\t]*\\{`, 'gm')
  const opens = [...source.matchAll(pattern)]
  assert.equal(opens.length, 1, `expected exactly one ${selector} rule, found ${opens.length}`)
  const start = opens[0].index + opens[0][0].length
  const close = source.indexOf('}', start)
  assert.notEqual(close, -1, `unterminated ${selector} block`)
  const body = source.slice(start, close)
  assert.ok(!body.includes('{'), `${selector} must be a flat declaration block, not a nested rule`)
  return body
}

function names(text) {
  return [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
}

function hex(text) {
  const value = String(text).trim().replace('#', '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`cannot parse colour: ${JSON.stringify(text)} is not #rgb or #rrggbb`)
  }
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
}

function rgba(text) {
  const match = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/
    .exec(String(text).trim())
  if (!match) throw new Error(`cannot parse colour: ${JSON.stringify(text)} is not rgba(r, g, b, a)`)
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) }
}

// The RGB triplet a colour token contributes, whichever notation it uses.
function triplet(text) {
  return String(text).trim().startsWith('#') ? hex(text) : rgba(text).rgb
}

function luminance(color) {
  const channel = color.map((byte) => {
    const srgb = byte / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2]
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

function token(selector, name) {
  const match = new RegExp(`^[ \\t]*${escapeRe(name)}\\s*:\\s*([^;]+);`, 'm').exec(block(selector))
  assert.ok(match, `missing ${name} in ${selector}`)
  return match[1].trim()
}

function contrast(selector, foreground, background) {
  return ratio(triplet(token(selector, foreground)), triplet(token(selector, background)))
}

const THEMES = [DARK, LIGHT]

const THEME_TOKENS = [
  '--c-inset', '--c-canvas', '--c-chrome', '--c-surface', '--c-raised', '--c-control',
  '--line', '--line-soft', '--line-strong',
  '--tx-1', '--tx-2', '--tx-3', '--tx-4',
  '--ac', '--ac-hi', '--ac-bg', '--ac-fg',
  '--ok', '--warn', '--err', '--idle',
]

// Terminal colours are the one group that stays dark in both themes, so the
// light values must be byte-identical rather than merely similar.
const TERM_TOKENS = ['--term-bg', '--term-fg', '--term-cursor', '--term-selection']

// Metrics are theme-invariant: `:root` and `[data-theme="light"]` match the
// same element, so the light group inherits them. Repeating them would
// recreate the hand-synced duplicate debt this plan exists to remove.
const GLOBAL_TOKENS = [
  '--r-1', '--r-2', '--r-3', '--r-full',
  '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6',
  '--row-h', '--row-h-compact',
  '--z-drawer', '--z-popover', '--z-toast', '--z-dialog',
  '--t-1', '--t-2', '--t-3', '--ease',
]

// The single sanctioned exception: a derived value whose components are
// theme colours, so it has to be recomputed per theme instead of inherited.
const DERIVED_TOKENS = ['--shadow-pop']

test('every theme group declares every colour token', () => {
  for (const selector of THEMES) {
    const declared = new Set(names(block(selector)))
    for (const name of [...THEME_TOKENS, ...TERM_TOKENS]) {
      assert.ok(declared.has(name), `${selector} is missing ${name}`)
    }
  }
})

test('no token is declared only in the light theme', () => {
  const dark = new Set(names(block(DARK)))
  for (const name of new Set(names(block(LIGHT)))) {
    assert.ok(dark.has(name), `${name} exists only in the light theme`)
  }
})

test('theme-invariant metrics live in :root only', () => {
  const dark = new Set(names(block(DARK)))
  const light = new Set(names(block(LIGHT)))
  for (const name of GLOBAL_TOKENS) {
    assert.ok(dark.has(name), `:root is missing ${name}`)
    assert.ok(!light.has(name), `${name} must not be duplicated into the light theme`)
  }
})

test('--shadow-pop is the one theme-varying derived token', () => {
  const perTheme = new Set([...THEME_TOKENS, ...TERM_TOKENS, ...DERIVED_TOKENS])
  for (const name of new Set(names(block(LIGHT)))) {
    assert.ok(perTheme.has(name), `${name} is redeclared per theme but belongs to no category`)
  }
  for (const name of DERIVED_TOKENS) {
    const dark = token(DARK, name)
    assert.notEqual(token(LIGHT, name), dark, `${name} must be recomputed per theme, not inherited`)
  }
})

test('text, accent and status colours clear WCAG AA on their surfaces', () => {
  // Status colours render as 11-12px labels, so they are normal text, not the
  // 3:1 large-graphic floor.
  const pairs = [
    ['--tx-1', '--c-surface', 4.5],
    ['--tx-2', '--c-surface', 4.5],
    ['--tx-3', '--c-surface', 4.5],
    ['--tx-1', '--c-chrome', 4.5],
    ['--ac-fg', '--ac', 4.5],
    ['--ok', '--c-surface', 4.5],
    ['--warn', '--c-surface', 4.5],
    ['--err', '--c-surface', 4.5],
  ]
  for (const selector of THEMES) {
    for (const [fg, bg, minimum] of pairs) {
      const got = contrast(selector, fg, bg)
      assert.ok(got >= minimum, `${selector} ${fg} on ${bg} is ${got.toFixed(2)}:1, needs ${minimum}:1`)
    }
  }
})

test('--tx-4 stays a step weaker than --tx-3 without fading out of use', () => {
  // An ordering guard, not an AA ceiling: raising --tx-4 into AA is progress,
  // letting it fade to nothing is not.
  for (const selector of THEMES) {
    const weakest = contrast(selector, '--tx-4', '--c-surface')
    const muted = contrast(selector, '--tx-3', '--c-surface')
    assert.ok(weakest < muted,
      `${selector} --tx-4 is ${weakest.toFixed(2)}:1 against --tx-3 at ${muted.toFixed(2)}:1; the ramp has collapsed`)
    assert.ok(weakest >= 1.5,
      `${selector} --tx-4 is ${weakest.toFixed(2)}:1 on --c-surface; below 1.5:1 it is invisible, not decorative`)
  }
})

test('--idle clears 3:1 on both grounds that carry a status dot', () => {
  for (const selector of THEMES) {
    for (const surface of ['--c-surface', '--c-chrome']) {
      const got = contrast(selector, '--idle', surface)
      assert.ok(got >= 3, `${selector} --idle on ${surface} is ${got.toFixed(2)}:1, needs 3:1`)
    }
  }
})

test('the terminal group is byte-identical dark and keeps a dark canvas', () => {
  for (const name of TERM_TOKENS) {
    assert.equal(token(LIGHT, name), token(DARK, name),
      `${name} is terminal material: the light theme must not restyle it`)
  }
  for (const selector of THEMES) {
    assert.ok(luminance(hex(token(selector, '--term-bg'))) < 0.02, `${selector} must keep a dark terminal`)
  }
})

test('translucent accent tokens carry the --ac triplet they sit on', () => {
  // Hand-synced on purpose: custom properties are not substituted by
  // getComputedStyle, so terminal-view.ts would read a literal color-mix().
  const darkAc = triplet(token(DARK, '--ac'))
  for (const selector of THEMES) {
    assert.deepEqual(triplet(token(selector, '--ac-bg')), triplet(token(selector, '--ac')),
      `${selector} --ac-bg must use this group's --ac triplet; only its alpha is free`)
    assert.deepEqual(triplet(token(selector, '--term-selection')), darkAc,
      `${selector} --term-selection is dark terminal material and must track the dark --ac triplet`)
  }
})

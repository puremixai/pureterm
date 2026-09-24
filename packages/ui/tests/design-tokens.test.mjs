import assert from 'node:assert/strict'
import test from 'node:test'
// The reader, the colour maths and the comment-stripping live in token-source.mjs
// so that terminal-theme.test.mjs can tie the ANSI palette to the same values
// without keeping a second copy of either.
import { DARK, LIGHT, block, contrastOnTint, hex, luminance, names, ratio, token, triplet } from './token-source.mjs'

function contrast(selector, foreground, background) {
  return ratio(triplet(token(selector, foreground)), triplet(token(selector, background)))
}

const THEMES = [DARK, LIGHT]

// The translucent steps the graphite ramp needs. Each is a colour its theme
// group owns at an alpha, so the register's own shape applies: a step present
// in one group only, or carrying a hex body instead of the triplet of the
// colour it tints, is the failure this ramp is most likely to acquire.
const TINT_TOKENS = [
  '--overlay-soft', '--overlay-hover', '--overlay-press',
  '--ac-line', '--ac-focus',
  '--ok-bg', '--ok-line', '--warn-bg', '--warn-line', '--err-bg', '--err-line',
  '--scrim',
]

const THEME_TOKENS = [
  '--c-inset', '--c-canvas', '--c-chrome', '--c-surface', '--c-raised', '--c-control',
  '--line', '--line-soft', '--line-strong',
  '--tx-1', '--tx-2', '--tx-3', '--tx-4',
  '--ac', '--ac-hi', '--ac-bg', '--ac-fg',
  '--ok', '--warn', '--err', '--idle',
  // The translucent steps: a colour group like any other, because the ground
  // and the text on it are chosen per theme, so both groups must carry both.
  ...TINT_TOKENS,
  '--scroll-thumb', '--scroll-thumb-strong',
]

// Terminal colours are the one group that stays dark in both themes, so the
// light values must be byte-identical rather than merely similar.
const TERM_TOKENS = ['--term-bg', '--term-fg', '--term-cursor', '--term-selection']

// Metrics are theme-invariant: `:root` and `[data-theme="light"]` match the
// same element, so the light group inherits them. Repeating them would
// recreate the hand-synced duplicate debt this plan exists to remove.
const GLOBAL_TOKENS = [
  '--r-1', '--r-2', '--r-3', '--r-4', '--r-full',
  '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6',
  '--row-h', '--row-h-compact',
  '--z-drawer', '--z-popover', '--z-toast', '--z-dialog',
  '--t-1', '--t-2', '--t-3', '--ease',
  // The chrome's own geometry. These are the only place a shell size is written
  // down, and theme-sync.test.mjs ties the Electron title-bar overlay to
  // --chrome-h, so a second copy of a number cannot appear silently.
  '--chrome-h', '--rail-w', '--status-h', '--insp-w',
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
  // Hand-synced on purpose: an unregistered custom property is substituted at
  // computed-value time but never evaluated as a colour, so color-mix() would
  // reach terminal-view.ts's getComputedStyle as a literal string.
  const darkAc = triplet(token(DARK, '--ac'))
  for (const selector of THEMES) {
    assert.deepEqual(triplet(token(selector, '--ac-bg')), triplet(token(selector, '--ac')),
      `${selector} --ac-bg must use this group's --ac triplet; only its alpha is free`)
    assert.deepEqual(triplet(token(selector, '--term-selection')), darkAc,
      `${selector} --term-selection is dark terminal material and must track the dark --ac triplet`)
  }
})

test('--term-cursor carries the accent triplet rather than a hand-copy of it', () => {
  // A third copy of the accent, and the one no consumer reads through var():
  // terminal-view.ts resolves it once through getComputedStyle. Without this
  // tie a palette flip would leave the cursor behind in silence. The terminal
  // group is dark material in both themes, so both track the dark --ac.
  const darkAc = triplet(token(DARK, '--ac'))
  for (const selector of THEMES) {
    assert.deepEqual(triplet(token(selector, '--term-cursor')), darkAc,
      `${selector} --term-cursor must carry the dark --ac triplet`)
  }
})

test('every translucent step carries the triplet of the colour it tints', () => {
  const parents = {
    '--ac-line': '--ac', '--ac-focus': '--ac',
    '--ok-bg': '--ok', '--ok-line': '--ok',
    '--warn-bg': '--warn', '--warn-line': '--warn',
    '--err-bg': '--err', '--err-line': '--err',
  }
  for (const [tint, parent] of Object.entries(parents)) {
    for (const selector of THEMES) {
      assert.deepEqual(triplet(token(selector, tint)), triplet(token(selector, parent)),
        `${selector} ${tint} must be ${parent} at an alpha`)
    }
  }
})

test('translucent steps exist in both theme groups', () => {
  for (const selector of THEMES) {
    for (const name of TINT_TOKENS) assert.ok(names(block(selector)).includes(name), `${selector} is missing ${name}`)
  }
})

// `token()` anchors its lookup at the start of a line while `names()` scans the
// whole block, so a second declaration on one line is counted as declared and
// cannot be read back. That is not hypothetical: editing this file by hand
// produces exactly that shape, and the failures it causes name the wrong token.
test('each theme block declares one token per line', () => {
  for (const selector of THEMES) {
    const offenders = block(selector)
      .split('\n')
      .map((line, offset) => [offset + 1, line])
      .filter(([, line]) => (line.match(/--[a-z0-9-]+\s*:/g) ?? []).length > 1)
    assert.deepEqual(offenders, [],
      `${selector} carries two declarations on one line (offsets within the block):\n` +
      offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n'))
  }
})

// Status labels never paint on a bare surface: `.tag.saved`, `#status.ok`,
// `.keychain-message.err` and `#sftp-hint.ok` all sit on their own tint. The
// bare-ground ratios measured above are therefore the optimistic case, and the
// first light palette passed them while failing in practice.
test('status colours clear AA on their own tint, not only on a bare surface', () => {
  for (const selector of THEMES) {
    for (const [colour, tint] of [['--ok', '--ok-bg'], ['--warn', '--warn-bg'], ['--err', '--err-bg']]) {
      for (const ground of ['--c-surface', '--c-canvas']) {
        const got = contrastOnTint(token(selector, colour), token(selector, tint), token(selector, ground))
        assert.ok(got >= 4.5,
          `${selector} ${colour} on ${tint} over ${ground} is ${got.toFixed(2)}:1, needs 4.5:1`)
      }
    }
  }
})

// --ac on --ac-bg is deliberately absent above: it measures 4.08:1 in the light
// theme, and darkening the accent that far to buy a pair nothing paints would
// cost the primary button its contrast headroom. Accent-coloured text on an
// accent-tinted ground is therefore forbidden, not merely unproven.

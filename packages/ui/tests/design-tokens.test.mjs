import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

function block(selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing token block ${selector}`)
  const body = css.slice(start + selector.length)
  const open = body.indexOf('{')
  const close = body.indexOf('}', open)
  return body.slice(open + 1, close)
}

function names(text) {
  return [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
}

function hex(text) {
  const value = text.trim().replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value.slice(0, 6)
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
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
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block(selector))
  assert.ok(match, `missing ${name} in ${selector}`)
  return match[1].trim()
}

const THEME_TOKENS = [
  '--c-inset', '--c-canvas', '--c-chrome', '--c-surface', '--c-raised', '--c-control',
  '--line', '--line-soft', '--line-strong',
  '--tx-1', '--tx-2', '--tx-3', '--tx-4',
  '--ac', '--ac-hi', '--ac-bg', '--ac-fg',
  '--ok', '--warn', '--err', '--idle',
  '--term-bg', '--term-fg', '--term-cursor', '--term-selection',
]

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

test('both theme groups declare the same colour tokens', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    const declared = new Set(names(block(selector)))
    for (const name of THEME_TOKENS) {
      assert.ok(declared.has(name), `${selector} is missing ${name}`)
    }
  }
  const dark = new Set(names(block(':root')))
  const light = new Set(names(block('[data-theme="light"]')))
  for (const name of light) assert.ok(dark.has(name), `${name} exists only in the light theme`)
})

test('theme-invariant metrics are declared once, in :root only', () => {
  const dark = new Set(names(block(':root')))
  const light = new Set(names(block('[data-theme="light"]')))
  for (const name of GLOBAL_TOKENS) {
    assert.ok(dark.has(name), `:root is missing ${name}`)
    assert.ok(!light.has(name), `${name} must not be duplicated into the light theme`)
  }
})

test('text and accent tokens clear WCAG AA on their surfaces', () => {
  const pairs = [
    ['--tx-1', '--c-surface', 4.5],
    ['--tx-2', '--c-surface', 4.5],
    ['--tx-3', '--c-surface', 4.5],
    ['--tx-1', '--c-chrome', 4.5],
    ['--ac-fg', '--ac', 4.5],
    ['--ok', '--c-surface', 3],
    ['--warn', '--c-surface', 3],
    ['--err', '--c-surface', 3],
  ]
  for (const selector of [':root', '[data-theme="light"]']) {
    for (const [fg, bg, minimum] of pairs) {
      const got = ratio(hex(token(selector, fg)), hex(token(selector, bg)))
      assert.ok(got >= minimum, `${selector} ${fg} on ${bg} is ${got.toFixed(2)}:1, needs ${minimum}:1`)
    }
  }
})

test('--tx-4 stays decorative-only and is expected to fail AA', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    const got = ratio(hex(token(selector, '--tx-4')), hex(token(selector, '--c-surface')))
    assert.ok(got < 4.5, `--tx-4 measured ${got.toFixed(2)}:1; it must not be used for real text`)
  }
})

test('terminal tokens exist in both themes and stay dark', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    assert.ok(luminance(hex(token(selector, '--term-bg'))) < 0.02, `${selector} must keep a dark terminal`)
  }
})

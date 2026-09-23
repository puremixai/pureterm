// Shared reader for packages/ui/src/styles/tokens.css.
//
// Two guards need to read token *values*: design-tokens.test.mjs measures the
// theme groups against each other, and terminal-theme.test.mjs ties the ANSI
// palette in terminal-view.ts to the tokens it mirrors. Neither may keep its own
// copy of the parsing or the colour maths — a hand-synced duplicate is the exact
// debt this plan exists to remove — so it lives here, as the derived partial
// list already lives in partial-list.mjs.
import { readFile } from 'node:fs/promises'

// Comments document, they do not declare. Stripping them first means an
// explanatory note can never certify a token that no longer exists.
export const source = (await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '')

export const DARK = ':root'
export const LIGHT = '[data-theme="light"]'

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Anchored on the start of a line, so a descendant rule such as
// `[data-theme="light"] .host-row {` cannot be mistaken for the theme block.
export function block(selector) {
  const pattern = new RegExp(`^[ \\t]*${escapeRe(selector)}[ \\t]*\\{`, 'gm')
  const opens = [...source.matchAll(pattern)]
  if (opens.length !== 1) {
    throw new Error(`expected exactly one ${selector} rule, found ${opens.length}`)
  }
  const start = opens[0].index + opens[0][0].length
  const close = source.indexOf('}', start)
  if (close === -1) throw new Error(`unterminated ${selector} block`)
  const body = source.slice(start, close)
  if (body.includes('{')) {
    throw new Error(`${selector} must be a flat declaration block, not a nested rule`)
  }
  return body
}

export function names(text) {
  return [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
}

export function hex(text) {
  const value = String(text).trim().replace('#', '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`cannot parse colour: ${JSON.stringify(text)} is not #rgb or #rrggbb`)
  }
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
}

export function rgba(text) {
  const match = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/
    .exec(String(text).trim())
  if (!match) throw new Error(`cannot parse colour: ${JSON.stringify(text)} is not rgba(r, g, b, a)`)
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) }
}

// The RGB triplet a colour token contributes, whichever notation it uses.
export function triplet(text) {
  return String(text).trim().startsWith('#') ? hex(text) : rgba(text).rgb
}

export function luminance(color) {
  const channel = color.map((byte) => {
    const srgb = byte / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2]
}

export function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

export function token(selector, name) {
  const match = new RegExp(`^[ \\t]*${escapeRe(name)}\\s*:\\s*([^;]+);`, 'm').exec(block(selector))
  if (!match) throw new Error(`missing ${name} in ${selector}`)
  return match[1].trim()
}

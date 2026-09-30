import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { en } from '@pureterm/i18n'

const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8')

// Comments document, they do not declare. The markup explains itself in Chinese,
// and this file is looking for user-facing copy — reading the raw text would fail
// on the explanation and pass on nothing. Blanking keeps the offsets.
const markup = html.replace(/<!--[\s\S]*?-->/g, '')

const keys = (attribute) => [...markup.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map((match) => match[1])

test('every key the markup names exists in the catalog', () => {
  const named = [
    ...keys('data-i18n'),
    ...keys('data-i18n-html'),
    ...keys('data-i18n-attr').flatMap((spec) => spec.split(';').map((pair) => pair.slice(pair.indexOf(':') + 1).trim())),
  ]
  assert.ok(named.length > 80, `only ${named.length} keys are named; the markup lost its tagging`)
  const missing = named.filter((key) => !Object.prototype.hasOwnProperty.call(en, key))
  assert.deepEqual(missing, [], 'a data-i18n key with no catalog entry is silently skipped, so the element stays English forever')
})

test('the English shipped in the markup is the English in the catalog', () => {
  // The point of the pairing: index.html cannot drift from `en`. If a message is
  // reworded in the catalog and not here, an English reader sees the new text
  // only after the translate pass runs, which is a flash of the old one.
  const text = [...markup.matchAll(/<([a-z0-9-]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)</g)]
  assert.ok(text.length > 60, `only ${text.length} elements carry translatable text`)
  for (const [, tag, key, shipped] of text) {
    assert.equal(shipped, en[key], `<${tag} data-i18n="${key}"> ships ${JSON.stringify(shipped)} but the catalog says ${JSON.stringify(en[key])}`)
  }
})

test('no user-facing Chinese is left in the markup', () => {
  const cjk = markup.match(/[\u4e00-\u9fff]/g) ?? []
  assert.deepEqual(cjk, [], 'the markup is the English source; any Chinese left in it is a string that never moved to the catalog')
})

test('the language switch ships with the markup it switches', () => {
  assert.match(markup, /<html lang="en">/, 'the document declares English, which is the default the catalog is written in')
  assert.match(markup, /id="locale-toggle"/, 'the switch has to exist or a Chinese reader has no way to reach the Chinese catalog')
})

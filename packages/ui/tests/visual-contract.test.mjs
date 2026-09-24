import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { readPartials, styleImportCount } from './partial-list.mjs'

const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8')
const { manifest, names, css } = await readPartials()

test('the shared UI exposes the mature workspace visual contract', () => {
  assert.match(html, /<div id="app" class="app-shell">/)
  assert.match(html, /class="workspace-mark"/)
  assert.match(html, /class="workspace"/)
  assert.match(html, /<title>PureTerm<\/title>/)

  assert.match(html, /class="app-topbar"/)
  assert.match(html, /id="primary-nav"/)
  assert.match(html, /id="host-search"/)
  assert.match(html, /id="connection-workspace"/)
  assert.match(html, /id="connection-failure"/)
  assert.match(html, /id="failure-log"/)
  assert.match(html, /class="drawer-scroll"/)
  assert.match(html, /class="primary drawer-connect"/)
  assert.match(html, /class="ti ti-server-2"/)
  assert.match(manifest, /@import\s+"@tabler\/icons-webfont\/dist\/tabler-icons\.min\.css"/)

  // Token existence belongs to design-tokens.test.mjs, which reads the theme
  // groups themselves, and so does "every var() names a declared token", which
  // stylesheet-contract.test.mjs measures. Nothing is asserted here that one of
  // those two already covers.

  assert.match(css, /:focus-visible\s*\{/, 'keyboard focus treatment is required')
  assert.match(css, /grid-template-columns:\s*278px\s+minmax\(0,\s*1fr\)/, 'desktop shell needs a stable navigation rail')
  assert.match(css, /\.connection-failure\s*\{/, 'connection failures need a dedicated visual state')
  assert.match(css, /\.app-shell\.session-mode\s+#primary-nav\s*\{/, 'terminal sessions need a focused canvas')
  assert.match(css, /@media\s*\(max-width:\s*620px\)/, 'narrow layouts need an explicit mobile fallback')
})

test('the manifest imports every partial exactly once and in cascade order', async () => {
  const { names, texts } = await readPartials()
  assert.deepEqual(names, ['fonts', 'tokens', 'base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states'],
    'cascade order is load-bearing; change it only with a measured cascade check')
  assert.equal(styleImportCount(manifest), names.length,
    'every @import of a styles/*.css partial must yield a name; a form the parser drops would slip the file out of the contract')
  const seen = new Set()
  for (const name of names) {
    assert.equal(seen.has(name), false, `${name} is imported twice`)
    seen.add(name)
  }
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    assert.ok(!/@import/.test(text), `styles/${name}.css must not @import; put it in style.css`)
  }
})

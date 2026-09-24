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
  assert.match(html, /id="theme-toggle"/, 'the light theme is unreachable without this control')
  assert.match(html, /id="density-toggle"/)
  assert.match(html, /class="status-bar"/)
  assert.match(css, /\.status-bar\s*\{[^}]*var\(--status-h\)/, 'the status bar must be drawn from its token')
  assert.match(html, /id="host-search"/)
  assert.match(html, /id="connection-workspace"/)
  assert.match(html, /id="connection-failure"/)
  assert.match(html, /id="failure-log"/)
  assert.match(html, /class="drawer-scroll"/)
  assert.match(html, /class="primary drawer-connect"/)
  assert.match(html, /id="host-columns"[^>]*class="host-columns"/, 'the hosts table needs a header row to sit above the rows')
  assert.match(html, /id="keychain-columns"[^>]*class="host-columns"/, 'the key table shares that header shape')
  assert.match(css, /\.host-columns,\s*\.host-row \{[^}]*minmax\(0,1\.5fr\)/, 'the header and the rows must share one column template')
  assert.match(css, /#keychain-columns,\s*\.keychain-card \{[^}]*minmax\(0,1\.2fr\)/, 'the key table must share its template the same way')
  // A card is the same row with its columns folded away — all but the address,
  // which is the one thing a name cannot stand in for.
  assert.match(css, /\.card-view \.host-row \.host-cell \{ display: none/, 'a card must not repeat the table columns')
  assert.match(css, /\.card-view \.host-row \.host-cell\.mono \{ display: block/, 'and a card keeps the address it is a name for')
  // A header over an empty table frames nothing. Both screens already toggle the
  // empty element's hidden attribute, so the header follows that rather than a
  // second copy of the count.
  assert.match(css, /:has\(#hosts-empty:not\(\[hidden\]\)\) #host-columns/, 'the hosts header must leave with an empty list')
  assert.match(css, /:has\(#keychain-empty:not\(\[hidden\]\)\) #keychain-columns/, 'and so must the key header')
  // base.css floors every button at 38px, which is exactly --row-h: un-flooring
  // the row's own button is what makes the density switch change a row at all.
  assert.match(css, /#host-list:not\(\.card-view\) \.host-main \{ min-height: 0/, 'a table row must be allowed to shrink below the button floor')
  assert.match(css, /\.keychain-list:not\(\.card-view\) \.keychain-card-main \{ min-height: 0/, 'and so must a key row')
  assert.match(html, /class="ti ti-server-2"/)
  assert.match(manifest, /@import\s+"@tabler\/icons-webfont\/dist\/tabler-icons\.min\.css"/)

  // Token existence belongs to design-tokens.test.mjs, which reads the theme
  // groups themselves, and so does "every var() names a declared token", which
  // stylesheet-contract.test.mjs measures. Nothing is asserted here that one of
  // those two already covers.

  assert.match(css, /:focus-visible\s*\{/, 'keyboard focus treatment is required')
  assert.match(css, /#main\s*\{[^}]*display:\s*grid/, 'the workspace column must be a grid so it can hand its own column to the editor')
  assert.match(css, /\.app-shell\.inspector-open\s+#main\s*\{[^}]*var\(--insp-w\)/, 'the docked editor must be a track of the workspace column, not an overlay')
  // .app-body holds the rail and one workspace column and nothing else. An
  // --insp-w track there is an empty third column, and the editor — a child of
  // #main — stays below the fold of a column it never narrows.
  assert.doesNotMatch(css, /\.app-shell\.inspector-open\s+\.app-body/, 'the editor track belongs to #main, which is its actual grid container')
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

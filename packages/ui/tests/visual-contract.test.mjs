import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
const [html, css] = await Promise.all([
  readFile(new URL('../src/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
])

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
  assert.match(css, /@import\s+"@tabler\/icons-webfont\/dist\/tabler-icons\.min\.css"/)

  for (const token of ['--topbar', '--nav', '--card', '--line', '--text-strong', '--accent']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing design token ${token}`)
  }

  assert.match(css, /:focus-visible\s*\{/, 'keyboard focus treatment is required')
  assert.match(css, /grid-template-columns:\s*278px\s+minmax\(0,\s*1fr\)/, 'desktop shell needs a stable navigation rail')
  assert.match(css, /\.connection-failure\s*\{/, 'connection failures need a dedicated visual state')
  assert.match(css, /\.app-shell\.session-mode\s+#primary-nav\s*\{/, 'terminal sessions need a focused canvas')
  assert.match(css, /@media\s*\(max-width:\s*620px\)/, 'narrow layouts need an explicit mobile fallback')
})

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { serveWebDocument, authorizeDesktopSocket } from '../electron/runtime/web-document.ts'

test('Desktop serves packaged assets before Host startup, with MIME, HEAD and containment checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pureterm-document-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'ui'))
  await writeFile(join(root, 'ui/index.html'), '<main>PureTerm</main>')
  await writeFile(join(root, 'ui/app.js'), 'export const ready = true')
  await writeFile(join(root, 'private.txt'), 'outside')
  const request = (path, method = 'GET') => serveWebDocument(new Request(`pureterm-app://app${path}`, { method }), join(root, 'ui'))
  const page = await request('/')
  assert.equal(page.status, 200)
  assert.equal(await page.text(), '<main>PureTerm</main>')
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
  assert.equal(page.headers.get('cache-control'), 'no-store')
  assert.match((await request('/app.js')).headers.get('content-type'), /javascript/)
  assert.equal(await (await request('/', 'HEAD')).text(), '')
  assert.equal((await request('/', 'POST')).status, 405)
  assert.equal((await request('/%2e%2e%2fprivate.txt')).status, 403)
  assert.equal((await request('/%2e%2e%5cprivate.txt')).status, 403)
  assert.equal((await request('/%')).status, 400)
  assert.equal((await request('/missing.js')).status, 404)
  assert.equal((await serveWebDocument(new Request('pureterm-app://other/'), root)).status, 404)
})

const owner = { webContentsId: 17, hostUrl: 'http://127.0.0.1:43210/?token=browser-secret', desktopToken: 'private-desktop-token' }
const request = { webContentsId: 17, isMainFrame: true, url: 'ws://127.0.0.1:43210/ws', requestHeaders: { Origin: 'pureterm-app://app', Cookie: 'unexpected', Authorization: 'unexpected' } }

test('only the owned application socket receives the private Desktop credential', () => {
  const result = authorizeDesktopSocket(request, owner)
  assert.deepEqual(result, { requestHeaders: { origin: 'http://127.0.0.1:43210', authorization: 'Bearer private-desktop-token' } })
  assert.equal(request.requestHeaders.Cookie, 'unexpected', 'request headers must not be mutated')
  for (const change of [
    { webContentsId: 18 }, { url: 'ws://127.0.0.1:43211/ws' },
    { url: 'ws://example.com:43210/ws' }, { url: 'ws://127.0.0.1:43210/other' },
    { url: 'ws://127.0.0.1:43210/ws?token=other' }, { url: 'ws://user:secret@127.0.0.1:43210/ws' },
  ]) assert.equal(authorizeDesktopSocket({ ...request, ...change }, owner).requestHeaders, undefined)
  assert.deepEqual(authorizeDesktopSocket({ ...request, requestHeaders: { origin: 'https://example.com' } }, owner), { cancel: true })
  assert.deepEqual(authorizeDesktopSocket({ ...request, requestHeaders: {} }, owner), { cancel: true })
  assert.deepEqual(authorizeDesktopSocket(request, undefined), {})
  assert.deepEqual(authorizeDesktopSocket({ ...request, isMainFrame: false }, owner), { cancel: true })
  assert.deepEqual(authorizeDesktopSocket({ ...request, isMainFrame: undefined }, owner), { cancel: true })
})

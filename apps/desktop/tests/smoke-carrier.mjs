import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import test from 'node:test'
import { createHttpCarrier } from '../dist/electron/carriers/carrier-http.js'
import { createDispatcher } from '../dist/electron/bridge/dispatch.js'
import { startFakeSshServer } from './fake-ssh-server.mjs'
import { connection, hostFixture, until } from './integration-helpers.mjs'

// HTTP/WS use independently constructed wire messages; using production encodeWire
// for both directions could hide a symmetric binary encoding bug.
function http(port, path = '/', headers = {}, method = 'GET', upgrade = false) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(3000, () => req.destroy(new Error('HTTP request timeout')))
    if (upgrade) req.on('upgrade', (response, socket) => {
      socket.destroy()
      resolve({ status: response.statusCode, headers: response.headers })
    })
    req.end()
  })
}

async function wireClient(t, url) {
  const socket = new WebSocket(url)
  const messages = []
  socket.addEventListener('message', (event) => messages.push(JSON.parse(event.data)))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket open timeout')) }, 3000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket open failed')) }, { once: true })
  })
  t.after(async () => {
    if (socket.readyState === WebSocket.CLOSED) return
    socket.close()
    await until(() => socket.readyState === WebSocket.CLOSED, 'WebSocket cleanup')
  })
  let sequence = 0
  return {
    messages,
    send: (message) => socket.send(JSON.stringify(message)),
    async call(method, params = []) {
      const id = ++sequence
      socket.send(JSON.stringify({ kind: 'call', id, method, params }))
      return until(() => messages.find((message) => message.kind === 'reply' && message.id === id), `reply to ${method}`)
    },
    notice: (name, params) => socket.send(JSON.stringify({ kind: 'notice', name, params })),
  }
}

async function carrierFixture(t) {
  let carrier
  const fixture = await hostFixture(t, { getRenderer: (id) => carrier?.getRenderer(id), seal: () => undefined, unseal: () => undefined })
  const ready = []
  const picked = []
  const dispatcher = createDispatcher({
    host: fixture.host,
    pickPrivateKey: async (clientId) => { picked.push(clientId); return { path: '/fixture/key', encrypted: false } },
    onReady: (payload, clientId) => ready.push({ payload, clientId }),
  })
  const staticDir = join(fixture.directory, 'renderer')
  await mkdir(staticDir)
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Local carrier fixture</title>', 'utf8')
  await writeFile(join(staticDir, 'app.js'), 'globalThis.carrierFixture = true', 'utf8')
  await writeFile(join(fixture.directory, 'outside.txt'), 'must not be served', 'utf8')
  carrier = await createHttpCarrier({ dispatcher, staticDir, log: () => {} })
  t.after(() => carrier.close())
  return { carrier, host: fixture.host, ready, picked }
}

test('HTTP protects HTML and assets, sets a session cookie, and denies invalid hosts and traversal', { timeout: 15000 }, async (t) => {
  const { carrier } = await carrierFixture(t)
  assert.equal(new URL(carrier.url).hostname, '127.0.0.1')
  assert.equal((await http(carrier.port)).status, 401)
  assert.equal((await http(carrier.port, '/app.js')).status, 401)
  assert.equal((await http(carrier.port, '/?token=wrong')).status, 401)
  const page = await http(carrier.port, `/?token=${carrier.token}`)
  assert.equal(page.status, 200)
  assert.match(page.body, /Local carrier fixture/)
  assert.ok(!page.body.includes(carrier.token), 'bearer token must not be embedded in HTML')
  assert.match(page.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\//)
  assert.equal(page.headers['x-content-type-options'], 'nosniff')
  assert.equal(page.headers['cache-control'], 'no-store')
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
  const cookie = page.headers['set-cookie'][0].split(';')[0]
  const asset = await http(carrier.port, '/app.js', { Cookie: cookie })
  assert.equal(asset.status, 200)
  assert.equal(asset.body, 'globalThis.carrierFixture = true')
  assert.match(asset.headers['content-type'], /javascript/)
  assert.equal((await http(carrier.port, '/', { Cookie: `${cookie}wrong` })).status, 401)
  assert.equal((await http(carrier.port, '/', { Cookie: cookie, Host: 'attacker.invalid' })).status, 403)
  assert.equal((await http(carrier.port, '/%2e%2e%2foutside.txt', { Cookie: cookie })).status, 403)
  assert.equal((await http(carrier.port, '/%zz', { Cookie: cookie })).status, 400)
  assert.equal((await http(carrier.port, '/missing.js', { Cookie: cookie })).status, 404)
  assert.equal((await http(carrier.port, '/', { Cookie: cookie }, 'POST')).status, 405)
})

test('WebSocket upgrade requires credentials and rejects cross-origin cookies and nonloopback Host headers', { timeout: 15000 }, async (t) => {
  const { carrier } = await carrierFixture(t)
  const base = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' }
  const probe = (path, headers = {}) => http(carrier.port, path, { ...base, ...headers }, 'GET', true)
  assert.equal((await probe('/ws')).status, 401)
  assert.equal((await probe('/ws?token=wrong')).status, 401)
  assert.equal((await probe(`/ws?token=${carrier.token}`, { Host: 'attacker.invalid' })).status, 401)
  const cookie = `ssh-cordis-session=${carrier.token}`
  assert.equal((await probe('/ws', { Cookie: cookie, Origin: 'https://attacker.invalid' })).status, 401)
  assert.equal((await probe('/ws', { Cookie: cookie, Origin: `http://127.0.0.1:${carrier.port}` })).status, 101)
  assert.equal((await probe(`/ws?token=${carrier.token}`)).status, 101)
  assert.equal((await probe(`/not-ws?token=${carrier.token}`)).status, 404)
})

test('WebSocket requests use real Host operations, carrier identity, terminal events, and exact SFTP binary bytes', { timeout: 20000 }, async (t) => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const { carrier, host, ready, picked } = await carrierFixture(t)
  const client = await wireClient(t, `ws://127.0.0.1:${carrier.port}/ws?token=${carrier.token}`)
  const saved = await client.call('hosts:save', [{ host: '127.0.0.1', port: server.port, username: server.username, label: 'web fixture' }])
  assert.equal(saved.ok, true)
  assert.equal(saved.value.label, 'web fixture')
  const listed = await client.call('hosts:list')
  assert.deepEqual(listed.value, [saved.value])
  assert.equal((await client.call('hosts:remove', [saved.value.id])).value, true)
  assert.deepEqual(host.listHosts(), [])
  const pick = await client.call('ssh:pick-private-key')
  assert.deepEqual(pick.value, { path: '/fixture/key', encrypted: false })
  assert.match(picked[0], /^ws:\d+$/)
  const readyPayload = { ok: true, hosts: 0, cols: 100, rows: 30 }
  client.notice('app:renderer-ready', [readyPayload])
  await until(() => ready.length, 'renderer readiness notice')
  assert.deepEqual(ready[0], { payload: readyPayload, clientId: picked[0] })
  const open = await client.call('ssh:open', [{ ...connection(server), clientId: 'forged:renderer', cols: 100, rows: 30 }])
  assert.equal(open.ok, true, open.error)
  const { sessionId } = open.value
  await until(() => client.messages.some((message) => message.kind === 'event' && message.name === 'terminal:opened' && message.params[0] === sessionId), 'terminal opened event')
  client.notice('ssh:input', [sessionId, '二进制🙂\n'])
  const terminalBytes = () => Buffer.concat(client.messages.filter((message) => message.kind === 'event' && message.name === 'terminal:data').map((message) => {
    assert.equal(message.params[0], sessionId)
    assert.deepEqual(Object.keys(message.params[1]), ['$bytes'])
    return Buffer.from(message.params[1].$bytes, 'base64')
  }))
  const expected = Buffer.from('echo:二进制🙂\r\n')
  await until(() => terminalBytes().length >= expected.length, 'terminal bytes over WebSocket')
  assert.deepEqual(terminalBytes(), expected)
  client.notice('ssh:resize', [sessionId, 123, 41])
  await until(() => server.terminal.windows.length, 'WebSocket resize mapping')
  assert.deepEqual([server.terminal.windows[0].cols, server.terminal.windows[0].rows], [123, 41])
  assert.equal((await client.call('sftp:mkdir', [sessionId, '.', 'web-dir'])).ok, true)
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index))
  const upload = await client.call('sftp:write', [sessionId, './web-dir', 'all-bytes.bin', { $bytes: bytes.toString('base64') }])
  assert.deepEqual(upload.value, { path: '/home/demo/web-dir/all-bytes.bin', size: 256 })
  assert.deepEqual(server.files.dataOf(upload.value.path), bytes)
  const download = await client.call('sftp:read', [sessionId, upload.value.path])
  assert.equal(download.ok, true)
  assert.equal(download.value.size, 256)
  assert.deepEqual(Object.keys(download.value.bytes), ['$bytes'])
  assert.deepEqual(Buffer.from(download.value.bytes.$bytes, 'base64'), bytes)
  const files = await client.call('sftp:list', [sessionId, './web-dir'])
  assert.deepEqual(files.value.entries.map((entry) => [entry.name, entry.size]), [['all-bytes.bin', 256]])
  assert.equal((await client.call('sftp:remove', [sessionId, upload.value.path])).ok, true)
  assert.equal(server.files.exists(upload.value.path), false)
  assert.equal((await client.call('sftp:remove', [sessionId, './web-dir'])).ok, true)
  const badBytes = await client.call('sftp:write', [sessionId, '.', 'bad.bin', 'not bytes'])
  assert.equal(badBytes.ok, false)
  assert.match(badBytes.error, /Uint8Array/)
  assert.equal(server.files.exists('/home/demo/bad.bin'), false)
  const unknown = await client.call('unknown:method')
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /不认识的请求/)
  const malformed = await client.call('hosts:list', {})
  assert.equal(malformed.ok, false)
  assert.match(malformed.error, /参数必须是数组/)
  client.notice('ssh:close', [sessionId])
  await until(() => client.messages.some((message) => message.name === 'terminal:closed' && message.params[0] === sessionId), 'terminal close event')
  await until(() => server.connections === 0, 'WebSocket close notice releases SSH socket')
})

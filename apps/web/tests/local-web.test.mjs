import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startLocalWeb } from '../dist/server.js'
import { startFakeSshServer } from '../../desktop/tests/fake-ssh-server.mjs'

const main = fileURLToPath(new URL('../dist/main.js', import.meta.url))

async function until(predicate, description, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await delay(10)
  }
  assert.fail(`Timed out waiting for ${description}`)
}

async function tempData(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-web-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function fixture(t) {
  const dataDir = await tempData(t)
  const server = await startLocalWeb({ dataDir, log: () => {} })
  t.after(() => server.dispose())
  return { server, dataDir }
}

function http(url, headers = {}, upgrade = false) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, agent: false }, (response) => {
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
  const address = new URL(url)
  address.protocol = 'ws:'
  address.pathname = '/ws'
  const socket = new WebSocket(address)
  const messages = []
  socket.addEventListener('message', (event) => messages.push(JSON.parse(event.data)))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket open timeout')) }, 3000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket open failed')) }, { once: true })
  })
  const close = async () => {
    if (socket.readyState === WebSocket.CLOSED) return
    socket.close()
    await until(() => socket.readyState === WebSocket.CLOSED, 'WebSocket cleanup')
  }
  t.after(close)
  let sequence = 0
  return {
    messages, close,
    async call(method, params = []) {
      const id = ++sequence
      socket.send(JSON.stringify({ kind: 'call', id, method, params }))
      const reply = await until(() => messages.find((message) => message.kind === 'reply' && message.id === id), `reply to ${method}`)
      assert.equal(reply.ok, true, reply.error)
      return reply.value
    },
    notice: (name, params) => socket.send(JSON.stringify({ kind: 'notice', name, params })),
  }
}

test('standalone Web serves the shared UI only with local authentication', { timeout: 15000 }, async (t) => {
  const { server } = await fixture(t)
  const address = new URL(server.url)
  assert.equal(address.hostname, '127.0.0.1')
  assert.ok(Number(address.port) > 0)
  assert.ok(address.searchParams.get('token'))
  assert.equal((await http(address.origin)).status, 401)
  assert.equal((await http(`${address.origin}/?token=wrong`)).status, 401)
  const page = await http(server.url)
  assert.equal(page.status, 200)
  assert.match(page.body, /<html[\s>]/i)
  assert.match(page.body, /app\.js/)
  assert.match(page.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/)
  const cookie = page.headers['set-cookie'][0].split(';')[0]
  assert.equal((await http(`${address.origin}/app.js`, { Cookie: cookie })).status, 200)
  assert.equal((await http(server.url, { Host: 'attacker.invalid' })).status, 403)
  const upgrade = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' }
  assert.equal((await http(`${address.origin}/ws`, upgrade, true)).status, 401)
  assert.equal((await http(`${address.origin}/ws`, { ...upgrade, Cookie: cookie, Origin: 'https://attacker.invalid' }, true)).status, 401)
  const client = await wireClient(t, server.url)
  assert.deepEqual(await client.call('app:capabilities'), { credentialPersistence: 'session', privateKeyPicker: 'browser' })
  assert.equal(await client.call('ssh:pick-private-key'), undefined)
})

test('standalone Web persists host metadata without passwords, key contents, passphrases or secrets file', { timeout: 15000 }, async (t) => {
  const { server, dataDir } = await fixture(t)
  const client = await wireClient(t, server.url)
  const password = 'web-password-never-persisted'
  const passphrase = 'web-passphrase-never-persisted'
  const privateKey = 'web-private-key-never-persisted'
  const passwordHost = await client.call('hosts:save', [{ host: '127.0.0.1', username: 'password-user', label: 'Password host', password, rememberPassword: true }])
  const keyHost = await client.call('hosts:save', [{ host: '127.0.0.1', username: 'key-user', label: 'Key host', authMethod: 'privateKey', privateKey, passphrase, rememberPassword: true }])
  assert.equal(passwordHost.hasSecret, false)
  assert.equal(keyHost.hasSecret, false)
  assert.equal(JSON.stringify(await client.call('hosts:list')).includes(password), false)
  await client.close()
  await server.dispose()
  const files = await readdir(dataDir)
  assert.ok(files.includes('hosts.json'))
  assert.equal(files.includes('secrets.json'), false)
  for (const name of files) {
    const text = await readFile(join(dataDir, name), 'utf8')
    for (const secret of [password, passphrase, privateKey]) assert.equal(text.includes(secret), false, `${name} leaked ${secret}`)
  }
  const restarted = await startLocalWeb({ dataDir, log: () => {} })
  t.after(() => restarted.dispose())
  const reconnect = await wireClient(t, restarted.url)
  const hosts = await reconnect.call('hosts:list')
  assert.deepEqual(hosts.map((host) => [host.id, host.hasSecret]).sort(), [[passwordHost.id, false], [keyHost.id, false]].sort())
})

test('standalone Web connects to SSH and transfers exact SFTP bytes; page close and server dispose release sessions', { timeout: 20000 }, async (t) => {
  const ssh = await startFakeSshServer({ greeting: false })
  t.after(() => ssh.close())
  const { server } = await fixture(t)
  const client = await wireClient(t, server.url)
  const connection = { host: ssh.host, port: ssh.port, username: ssh.username, password: ssh.password, cols: 100, rows: 30 }
  const { sessionId } = await client.call('ssh:open', [connection])
  client.notice('ssh:input', [sessionId, '本机 Web🙂\n'])
  const output = () => Buffer.concat(client.messages.filter((message) => message.kind === 'event' && message.name === 'terminal:data').map((message) => {
    assert.equal(message.params[0], sessionId)
    return Buffer.from(message.params[1].$bytes, 'base64')
  }))
  const expected = Buffer.from('echo:本机 Web🙂\r\n')
  await until(() => output().length >= expected.length, 'SSH output')
  assert.deepEqual(output(), expected)
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index))
  const upload = await client.call('sftp:write', [sessionId, '.', 'web-roundtrip.bin', { $bytes: bytes.toString('base64') }])
  const download = await client.call('sftp:read', [sessionId, upload.path])
  assert.deepEqual(Buffer.from(download.bytes.$bytes, 'base64'), bytes)
  assert.deepEqual(ssh.files.dataOf(upload.path), bytes)
  assert.ok((await client.call('sftp:list', [sessionId, '.'])).entries.some((entry) => entry.name === 'web-roundtrip.bin'))
  await client.close()
  await until(() => ssh.connections === 0, 'page close releases its SSH connection')
  const second = await wireClient(t, server.url)
  await second.call('ssh:open', [connection])
  assert.equal(ssh.connections, 1)
  await Promise.all([server.dispose(), server.dispose()])
  await until(() => ssh.connections === 0, 'server shutdown releases SSH connection')
  await assert.rejects(http(server.url))
})

function launch(t, args, env = {}) {
  const child = spawn(process.execPath, [main, ...args], { cwd: dirname(main), env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8') })
  child.stderr.on('data', (chunk) => { output += chunk.toString('utf8') })
  let result
  let spawnError
  child.once('error', (error) => { spawnError = error })
  child.once('exit', (code, signal) => { result = { code, signal } })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill() })
  return { child, get output() { return output }, async exited() {
    await until(() => result || spawnError, `CLI exit (${output})`)
    if (spawnError) throw spawnError
    return result
  } }
}

test('Node CLI supports help, rejects invalid/public-listen arguments, and exits on occupied port', { timeout: 20000 }, async (t) => {
  const help = launch(t, ['--help'])
  assert.equal((await help.exited()).code, 0)
  assert.match(help.output, /--port/)
  assert.match(help.output, /--data-dir/)
  for (const args of [['--host', '0.0.0.0'], ['--port', '-1'], ['--port', '65536'], ['--port', '1.2'], ['--port'], ['--data-dir'], ['--unknown']]) {
    const invalid = launch(t, args)
    assert.notEqual((await invalid.exited()).code, 0, `${args} should fail`)
    assert.doesNotMatch(invalid.output, /http:\/\/127\.0\.0\.1:\d+\/\?token=/)
  }
  const { server } = await fixture(t)
  const conflict = launch(t, ['--port', new URL(server.url).port, '--data-dir', await tempData(t)])
  assert.notEqual((await conflict.exited()).code, 0)
  assert.match(conflict.output, /EADDRINUSE/)
})

test('Node CLI starts from an independent process and closes its local listener on termination', { timeout: 15000 }, async (t) => {
  const dataDir = await tempData(t)
  const cli = launch(t, ['--port', '0'], { SSH_CORDIS_WEB_DATA_DIR: dataDir })
  const url = await until(() => cli.output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)?.[0], 'CLI URL')
  assert.equal((await http(url)).status, 200)
  const client = await wireClient(t, url)
  await client.call('hosts:save', [{ host: 'localhost', username: 'cli-test' }])
  assert.ok((await readdir(dataDir)).includes('hosts.json'))
  await client.close()
  cli.child.kill('SIGTERM')
  const exit = await cli.exited()
  if (process.platform !== 'win32') assert.equal(exit.code, 0, cli.output)
  await assert.rejects(http(url))
})

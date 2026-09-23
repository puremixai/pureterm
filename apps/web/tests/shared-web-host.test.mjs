import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { startWebHost } from '@pureterm/transport/web-host'

async function until(predicate, label) {
  const end = Date.now() + 4000
  while (Date.now() < end) {
    const value = predicate()
    if (value) return value
    await delay(10)
  }
  assert.fail(`Timed out waiting for ${label}`)
}

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-shared-web-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const options = {
    staticDir: join(import.meta.dirname, '../../../packages/ui/dist'),
    hostStoreFile: join(directory, 'hosts.json'),
    knownHostsFile: join(directory, 'known-hosts.json'),
    capabilities: { credentialPersistence: 'session', privateKeyPicker: 'browser' },
    log: false,
    ...overrides,
  }
  const server = await startWebHost(options)
  t.after(() => server.dispose())
  return { server, directory, options }
}

async function client(t, url) {
  const address = new URL(url)
  address.protocol = 'ws:'
  address.pathname = '/ws'
  const socket = new WebSocket(address)
  const messages = []
  socket.addEventListener('message', event => messages.push(JSON.parse(event.data)))
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('WebSocket open failed')), { once: true })
  })
  t.after(() => socket.close())
  let id = 0
  return {
    async call(method, params = []) {
      const next = ++id
      socket.send(JSON.stringify({ kind: 'call', id: next, method, params }))
      const reply = await until(() => messages.find(message => message.kind === 'reply' && message.id === next), method)
      assert.equal(reply.ok, true, reply.error)
      return reply.value
    },
    async close() {
      socket.close()
      await until(() => socket.readyState === WebSocket.CLOSED, 'WebSocket close')
    },
  }
}

function http(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { agent: false }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    req.on('error', reject)
    req.end()
  })
}

test('shared Web Host applies injected encrypted credentials to actual host saves', { timeout: 15000 }, async t => {
  const credentials = {
    persistent: true,
    seal: async plain => `sealed:${Buffer.from(plain).toString('base64')}`,
    unseal: async sealed => Buffer.from(sealed.slice(7), 'base64').toString(),
  }
  const { server, directory } = await fixture(t, {
    credentials,
    capabilities: { credentialPersistence: 'encrypted', privateKeyPicker: 'native' },
  })
  const browser = await client(t, server.url)
  assert.deepEqual(await browser.call('app:capabilities'), { credentialPersistence: 'encrypted', privateKeyPicker: 'native' })
  const saved = await browser.call('hosts:save', [{ host: 'localhost', username: 'alice', password: 'fixture-secret', rememberPassword: true }])
  assert.equal(saved.hasSecret, true)
  await server.dispose()
  const secrets = await readFile(join(directory, 'secrets.json'), 'utf8')
  assert.match(secrets, /sealed:/)
  assert.doesNotMatch(secrets, /fixture-secret/)
})

test('failed listen leaves the same data directory reusable after the occupied port clears', { timeout: 15000 }, async t => {
  const { server, options } = await fixture(t)
  await assert.rejects(startWebHost({ ...options, port: server.port }), /EADDRINUSE/)
  await server.dispose()
  const restarted = await startWebHost({ ...options, port: server.port })
  t.after(() => restarted.dispose())
  assert.equal((await http(restarted.url)), 200)
})

test('shutdown delivers the reply for an accepted credential save before closing its socket', { timeout: 15000 }, async t => {
  let releaseSeal
  let sealing = false
  const gate = new Promise(resolve => { releaseSeal = resolve })
  const credentials = {
    persistent: true,
    seal: async plain => { sealing = true; await gate; return `sealed:${Buffer.from(plain).toString('base64')}` },
    unseal: async sealed => Buffer.from(sealed.slice(7), 'base64').toString(),
  }
  const { server } = await fixture(t, { credentials, capabilities: { credentialPersistence: 'encrypted', privateKeyPicker: 'native' } })
  const browser = await client(t, server.url)
  const saving = browser.call('hosts:save', [{ host: 'localhost', username: 'alice', password: 'pending-secret', rememberPassword: true }])
  await until(() => sealing, 'encryption wait')
  const stopping = server.dispose()
  releaseSeal()
  assert.equal((await saving).hasSecret, true)
  await stopping
})

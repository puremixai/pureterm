import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createHost } from '../dist/src/host.js'

export async function until(predicate, description, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await delay(10)
  }
  assert.fail(`Timed out waiting for ${description}`)
}

export function rendererFixture() {
  const events = []
  let alive = true
  const key = randomBytes(32)
  const handle = { id: 'test:renderer', isAlive: () => alive, send: (name, ...params) => { events.push({ name, params }); return alive } }
  return {
    events, id: handle.id,
    disconnect: () => { alive = false },
    // Test-only crypto replaces the OS credential store; no real user keychain is accessed.
    bridge: {
      getRenderer: (id) => id === handle.id ? handle : undefined,
      seal: (plain) => {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
      },
      unseal: (sealed) => {
        try {
          const data = Buffer.from(sealed, 'base64')
          const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
          decipher.setAuthTag(data.subarray(12, 28))
          return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
        } catch { return undefined }
      },
    },
    output: (sessionId) => Buffer.concat(events.filter((event) => event.name === 'terminal:data' && event.params[0] === sessionId).map((event) => {
      assert.ok(event.params[1] instanceof Uint8Array, 'terminal data must stay bytes')
      return Buffer.from(event.params[1])
    })),
  }
}

export async function hostFixture(t, bridge = rendererFixture().bridge) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-integration-'))
  const hosts = []
  const options = {
    bridge,
    hostStoreFile: join(directory, 'hosts.json'),
    secretsFile: join(directory, 'secrets.json'),
    knownHostsFile: join(directory, 'known-hosts.json'),
    ssh: { readyTimeout: 3000, keepaliveInterval: 0 }, log: false,
  }
  t.after(async () => {
    try { for (const host of hosts) await host.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  const create = async () => { const host = await createHost(options); hosts.push(host); return host }
  return { directory, options, create, host: await create() }
}

export function connection(server, clientId = 'test:renderer') {
  return { host: server.host, port: server.port, username: server.username, password: server.password, clientId }
}

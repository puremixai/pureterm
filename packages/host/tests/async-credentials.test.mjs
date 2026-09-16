import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createHost } from '../dist/host.js'
import { startFakeSshServer } from '../../../apps/desktop/tests/fake-ssh-server.mjs'

const seal = (plain) => `test-ciphertext:${Buffer.from(plain).toString('base64')}`
const unseal = (sealed) => Buffer.from(sealed.slice('test-ciphertext:'.length), 'base64').toString('utf8')

async function fixture(t, provider = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-async-credentials-'))
  const gates = []
  const hosts = []
  const alive = new Set(['client'])
  const options = {
    bridge: { getRenderer: (id) => alive.has(id) ? { id, isAlive: () => alive.has(id), send: () => alive.has(id) } : undefined },
    credentials: { persistent: true, seal: async (value) => seal(value), unseal: async (value) => unseal(value), ...provider },
    hostStoreFile: join(directory, 'hosts.json'), secretsFile: join(directory, 'secrets.json'),
    knownHostsFile: join(directory, 'known_hosts.json'), log: false,
    ssh: { readyTimeout: 1000, keepaliveInterval: 0 },
  }
  t.after(async () => {
    for (const gate of gates) gate.resolve()
    try { for (const host of hosts) await host.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  return {
    options, alive,
    gate() { const gate = Promise.withResolvers(); gates.push(gate); return gate },
    async create() { const host = await createHost(options); hosts.push(host); return host },
  }
}

const record = { id: 'saved', host: 'example.test', username: 'demo', password: 'first-password', rememberPassword: true }

test('asynchronous encryption finishes before metadata, ciphertext or public state is committed', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const gate = f.gate()
  const entered = f.gate()
  f.options.credentials.seal = async (plain) => { entered.resolve(); await gate.promise; return seal(plain) }
  const host = await f.create()
  const saving = host.saveHost(record)
  await entered.promise
  assert.deepEqual(host.listHosts(), [])
  assert.equal(existsSync(f.options.hostStoreFile), false)
  assert.equal(existsSync(f.options.secretsFile), false)
  gate.resolve()
  const saved = await saving
  assert.equal(saved.hasSecret, true)
  assert.equal(await host.internals.ctx.sessionStore.secret(saved.id), record.password)
  assert.ok(!(await readFile(f.options.hostStoreFile, 'utf8')).includes(record.password))
  assert.equal(JSON.parse(await readFile(f.options.secretsFile, 'utf8'))[saved.id], seal(record.password))
})

test('a rejected encryption leaves the previous record and files intact and does not poison the mutation queue', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const host = await f.create()
  const original = await host.saveHost(record)
  const metadata = await readFile(f.options.hostStoreFile, 'utf8')
  const ciphertext = await readFile(f.options.secretsFile, 'utf8')
  f.options.credentials.seal = async () => { throw new Error('platform credential service disconnected') }
  await assert.rejects(host.saveHost({ ...record, label: 'must-not-commit', authMethod: 'privateKey', passphrase: 'new-secret' }), /disconnected/)
  assert.deepEqual(host.listHosts(), [original])
  assert.equal(await readFile(f.options.hostStoreFile, 'utf8'), metadata)
  assert.equal(await readFile(f.options.secretsFile, 'utf8'), ciphertext)
  f.options.credentials.seal = async (plain) => seal(plain)
  const next = await host.saveHost({ ...record, label: 'next-save', password: 'replacement' })
  assert.equal(next.label, 'next-save')
  assert.equal(await host.internals.ctx.sessionStore.secret(next.id), 'replacement')
})

test('queued save/remove/save operations preserve invocation order while encryption is pending', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const gate = f.gate()
  const entered = f.gate()
  const encrypted = []
  f.options.credentials.seal = async (plain) => {
    encrypted.push(plain)
    if (plain === record.password) { entered.resolve(); await gate.promise }
    return seal(plain)
  }
  const host = await f.create()
  const first = host.saveHost(record)
  await entered.promise
  const removal = host.removeHost(record.id)
  const replacement = host.saveHost({ ...record, label: 'replacement', authMethod: 'privateKey', passphrase: 'key-passphrase' })
  await delay(20)
  assert.deepEqual(encrypted, [record.password])
  gate.resolve()
  await first
  assert.equal(await removal, true)
  const saved = await replacement
  assert.deepEqual(host.listHosts(), [saved])
  assert.equal(saved.authMethod, 'privateKey')
  assert.equal(await host.internals.ctx.sessionStore.secret(saved.id), 'key-passphrase')
  assert.deepEqual(JSON.parse(await readFile(f.options.secretsFile, 'utf8')), { [saved.id]: seal('key-passphrase') })
})

test('Host disposal drains accepted credential writes and rejects later mutations', { timeout: 5000 }, async (t) => {
  const f = await fixture(t)
  const gate = f.gate()
  const entered = f.gate()
  f.options.credentials.seal = async (plain) => { entered.resolve(); await gate.promise; return seal(plain) }
  const host = await f.create()
  const saving = host.saveHost(record)
  await entered.promise
  let disposed = false
  const disposing = host.dispose().then(() => { disposed = true })
  await delay(20)
  assert.equal(disposed, false)
  await assert.rejects(host.saveHost({ ...record, id: 'late' }), /关闭|disposed/i)
  await assert.rejects(host.removeHost(record.id), /关闭|disposed/i)
  gate.resolve()
  await saving
  await disposing
  const restarted = await f.create()
  assert.equal(restarted.listHosts()[0].hasSecret, true)
  assert.equal(await restarted.internals.ctx.sessionStore.secret(record.id), record.password)
})

test('a restarted Host awaits asynchronous decryption before authenticating a real SSH connection', { timeout: 5000 }, async (t) => {
  const server = await startFakeSshServer({ greeting: false })
  t.after(() => server.close())
  const f = await fixture(t)
  const host = await f.create()
  const saved = await host.saveHost({ host: server.host, port: server.port, username: server.username,
    password: server.password, rememberPassword: true })
  await host.dispose()
  let decrypted = false
  f.options.credentials.unseal = async (value) => { await delay(20); decrypted = true; return unseal(value) }
  const restarted = await f.create()
  const session = await restarted.openTerminal({ host: server.host, port: server.port, username: server.username,
    hostId: saved.id, clientId: 'client', acceptUnknownHostKey: true })
  assert.equal(decrypted, true)
  assert.ok(session.sessionId)
  assert.equal(server.connections, 1)
  await restarted.dispose()
})

for (const action of ['releaseClient', 'dispose']) {
  test(`${action} cancels pending platform decryption without opening an SSH socket`, { timeout: 5000 }, async (t) => {
    const server = await startFakeSshServer({ greeting: false })
    t.after(() => server.close())
    const f = await fixture(t)
    const gate = f.gate()
    const entered = f.gate()
    f.options.credentials.unseal = async (value) => { entered.resolve(); await gate.promise; return unseal(value) }
    const host = await f.create()
    const saved = await host.saveHost({ host: server.host, port: server.port, username: server.username,
      password: server.password, rememberPassword: true })
    const opening = host.openTerminal({ host: server.host, port: server.port, username: server.username,
      hostId: saved.id, clientId: 'client', acceptUnknownHostKey: true })
    const rejected = assert.rejects(opening, /客户端|关闭|断开/)
    await entered.promise
    if (action === 'releaseClient') { f.alive.delete('client'); host.releaseClient('client') }
    else await host.dispose()
    await rejected
    assert.equal(server.connections, 0)
    gate.resolve()
    await delay(30)
    assert.equal(server.connections, 0, 'a late platform result must not resurrect a cancelled connection')
  })
}

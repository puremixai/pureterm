import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHost } from '../dist/host.js'
import { startFakeSshServer } from '../../../apps/desktop/tests/fake-ssh-server.mjs'

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKey = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const passphrase = 'fixture-key-passphrase'
const encryptedKey = pair.privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase }).toString()

async function fixture(t, persistent = true) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-keychain-'))
  const secret = randomBytes(32)
  const credentials = { persistent,
    seal(plain) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', secret, iv)
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return Buffer.concat([iv, data, cipher.getAuthTag()]).toString('base64')
    },
    unseal(sealed) {
      const data = Buffer.from(sealed, 'base64')
      const decipher = createDecipheriv('aes-256-gcm', secret, data.subarray(0, 12))
      decipher.setAuthTag(data.subarray(-16))
      return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString('utf8')
    },
  }
  const hosts = []
  const options = { hostStoreFile: join(directory, 'hosts.json'), knownHostsFile: join(directory, 'known_hosts.json'), credentials, log: false,
    bridge: { getRenderer: id => ({ id, isAlive: () => true, send: () => true }) } }
  t.after(async () => { for (const host of hosts) await host.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { directory, credentials, async create() { const host = await createHost(options); hosts.push(host); return host } }
}

test('keychain encrypts imported keys, exposes only metadata, and connects after restart using a host key reference', async t => {
  const f = await fixture(t)
  const host = await f.create()
  const key = await host.saveKey({ label: 'fixture.pem', privateKey: encryptedKey, passphrase }, 'first')
  assert.equal(key.type, 'RSA')
  assert.match(key.publicKey, /^ssh-rsa /)
  assert.match(key.fingerprint, /^SHA256:/)
  assert.equal(key.hasPassphrase, true)
  assert.equal(key.privateKey, undefined)
  assert.equal(key.passphrase, undefined)
  const server = await startFakeSshServer({ hostKey: privateKey, keyAuthentication: true })
  t.after(() => server.close())
  const saved = await host.saveHost({ host: server.host, port: server.port, username: server.username, authMethod: 'privateKey', keyId: key.id }, 'first')
  assert.equal(saved.keyId, key.id)
  for (const name of await readdir(f.directory)) {
    const text = await readFile(join(f.directory, name), 'utf8')
    assert.ok(!text.includes('PRIVATE KEY') && !text.includes(passphrase), `plaintext in ${name}`)
  }
  await host.dispose()
  const restarted = await f.create()
  assert.deepEqual(restarted.listKeys('second'), [key])
  const session = await restarted.openTerminal({ host: server.host, port: server.port, username: server.username, hostId: saved.id, clientId: 'second', acceptUnknownHostKey: true })
  assert.ok(session.sessionId)
  assert.ok(server.authentications.includes('publickey'))
})

test('key validation rejects public-only, malformed, and incorrectly unlocked keys without committing', async t => {
  const f = await fixture(t)
  const host = await f.create()
  for (const input of [
    { label: 'bad', privateKey: 'not a key' },
    { label: 'public', privateKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    { label: 'locked', privateKey: encryptedKey, passphrase: 'wrong' },
    { label: '', privateKey },
    { label: 'large', privateKey: 'x'.repeat(256 * 1024 + 1) },
  ]) await assert.rejects(host.saveKey(input, 'first'))
  assert.deepEqual(host.listKeys('first'), [])
  assert.deepEqual(await readdir(f.directory), [])
})

test('rename retains key material, replacement validates public key, and failed encryption preserves the vault', async t => {
  const f = await fixture(t)
  const host = await f.create()
  const original = await host.saveKey({ label: 'original', privateKey }, 'first')
  const renamed = await host.saveKey({ id: original.id, label: 'renamed' }, 'first')
  assert.equal(renamed.fingerprint, original.fingerprint)
  assert.equal(renamed.label, 'renamed')
  await assert.rejects(host.saveKey({ id: original.id, label: 'bad', privateKey, publicKey: 'ssh-rsa AAAA' }, 'first'))
  const before = await readFile(join(f.directory, 'keychain.json'), 'utf8')
  f.credentials.seal = () => undefined
  await assert.rejects(host.saveKey({ id: original.id, label: 'must not commit' }, 'first'), /加密/)
  assert.deepEqual(host.listKeys('first'), [renamed])
  assert.equal(await readFile(join(f.directory, 'keychain.json'), 'utf8'), before)
})

test('used keys cannot be removed until host authentication is changed; nonexistent references are rejected', async t => {
  const f = await fixture(t)
  const host = await f.create()
  const key = await host.saveKey({ label: 'used', privateKey }, 'first')
  const input = { host: 'example.test', username: 'demo', authMethod: 'privateKey', keyId: key.id }
  const saved = await host.saveHost(input, 'first')
  await assert.rejects(host.removeKey(key.id, 'first'), /使用/)
  await assert.rejects(host.saveHost({ ...input, keyId: 'missing' }, 'first'), /不存在/)
  await host.saveHost({ ...input, id: saved.id, authMethod: 'password' }, 'first')
  assert.equal(host.listHosts('first')[0].keyId, undefined)
  assert.equal(await host.removeKey(key.id, 'first'), true)
  assert.equal(await host.removeKey(key.id, 'first'), false)
})

test('Web keys and host associations are client-scoped, never persisted, and cleared on release', async t => {
  const f = await fixture(t, false)
  const host = await f.create()
  const key = await host.saveKey({ label: 'temporary', privateKey }, 'first')
  assert.deepEqual(host.listKeys('second'), [])
  await assert.rejects(host.saveHost({ host: 'example.test', username: 'demo', authMethod: 'privateKey', keyId: key.id }, 'second'))
  const saved = await host.saveHost({ host: 'example.test', username: 'demo', authMethod: 'privateKey', keyId: key.id }, 'first')
  assert.equal(host.listHosts('first')[0].keyId, key.id)
  assert.equal(host.listHosts('second')[0].keyId, undefined)
  assert.equal(JSON.parse(await readFile(join(f.directory, 'hosts.json'), 'utf8'))[0].keyId, undefined)
  assert.ok(!(await readdir(f.directory)).includes('keychain.json'))
  host.releaseClient('first')
  assert.deepEqual(host.listKeys('first'), [])
  assert.equal(host.listHosts('first')[0].keyId, undefined)
  assert.equal(saved.keyId, key.id)
})

test('session-only startup refuses a Desktop keychain without altering it', async t => {
  const f = await fixture(t)
  const host = await f.create()
  await host.saveKey({ label: 'desktop', privateKey }, 'first')
  await host.dispose()
  const before = await readFile(join(f.directory, 'keychain.json'), 'utf8')
  f.credentials.persistent = false
  await assert.rejects(f.create(), /独立|目录/)
  assert.equal(await readFile(join(f.directory, 'keychain.json'), 'utf8'), before)
})

test('another Web client changing authentication cannot resurrect a deleted key association', async t => {
  const f = await fixture(t, false)
  const host = await f.create()
  const key = await host.saveKey({ label: 'client A', privateKey }, 'first')
  const saved = await host.saveHost({ host: 'example.test', username: 'demo', authMethod: 'privateKey', keyId: key.id }, 'first')
  await host.saveHost({ ...saved, authMethod: 'password', keyId: '' }, 'second')
  await host.removeKey(key.id, 'first')
  await host.saveHost({ ...saved, authMethod: 'privateKey', keyId: '' }, 'second')
  assert.equal(host.listHosts('first')[0].keyId, undefined)
})

test('explicit Web private-key content overrides a host session key association', async t => {
  const f = await fixture(t, false)
  const host = await f.create()
  const server = await startFakeSshServer({ keyAuthentication: true, greeting: false })
  t.after(() => server.close())
  const key = await host.saveKey({ label: 'not authorized', privateKey }, 'first')
  const saved = await host.saveHost({ host: server.host, port: server.port, username: server.username, authMethod: 'privateKey', keyId: key.id }, 'first')
  const session = await host.openTerminal({ host: saved.host, port: saved.port, username: saved.username, hostId: saved.id,
    privateKey: server.hostKey.toString(), clientId: 'first', acceptUnknownHostKey: true })
  assert.ok(session.sessionId)
})

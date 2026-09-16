import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BrowserPrivateKeySelection,
  MAX_PRIVATE_KEY_BYTES,
  connectionCredentials,
  savedCredentials,
  readBrowserPrivateKey,
  parseRuntimeCapabilities,
} from '../src/credentials.ts'

const browser = { credentialPersistence: 'session', privateKeyPicker: 'browser' }
const desktop = { credentialPersistence: 'encrypted', privateKeyPicker: 'native' }
const fields = {
  authMethod: 'privateKey',
  password: 'page-password',
  passphrase: 'page-passphrase',
  privateKeyPath: 'C:\\fakepath\\id_ed25519',
  hostId: 'saved-host',
}
const privateKey = { name: 'id_ed25519', content: '-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----' }

test('Web saves no password, passphrase, key contents, filename, path, or credential reference', () => {
  assert.deepEqual(savedCredentials(browser, fields, true), { rememberPassword: false })
  assert.deepEqual(savedCredentials(browser, { ...fields, authMethod: 'password' }, true), { rememberPassword: false })
})

test('Web connection sends selected key contents and never browser fake paths or stored credentials', () => {
  assert.deepEqual(connectionCredentials(browser, fields, privateKey), {
    privateKey: privateKey.content,
    passphrase: 'page-passphrase',
  })
  assert.deepEqual(connectionCredentials(browser, { ...fields, authMethod: 'password' }, privateKey), {
    password: 'page-password',
  })
  assert.throws(() => connectionCredentials(browser, fields), /选择私钥/)
})

test('Desktop retains native paths and encrypted credential references without crossing auth modes', () => {
  assert.deepEqual(connectionCredentials(desktop, fields, privateKey), {
    hostId: 'saved-host', privateKeyPath: fields.privateKeyPath, passphrase: 'page-passphrase',
  })
  assert.deepEqual(savedCredentials(desktop, fields, true), {
    rememberPassword: true, privateKeyPath: fields.privateKeyPath, passphrase: 'page-passphrase',
  })
  assert.deepEqual(savedCredentials(desktop, { ...fields, authMethod: 'password' }, true), {
    rememberPassword: true, password: 'page-password',
  })
})

test('changing form invalidates both selected key and an outstanding asynchronous file read', () => {
  const selection = new BrowserPrivateKeySelection()
  const oldRead = selection.begin()
  assert.equal(selection.commit(oldRead, privateKey), true)
  assert.equal(selection.value, privateKey)
  const pendingRead = selection.begin()
  selection.clear()
  assert.equal(selection.value, undefined)
  assert.equal(selection.commit(pendingRead, privateKey), false)
  const newerRead = selection.begin()
  assert.equal(selection.commit(oldRead, privateKey), false)
  assert.equal(selection.commit(newerRead, privateKey), true)
})

test('opening and cancelling the file picker preserves the current key; selecting a replacement clears it', () => {
  const selection = new BrowserPrivateKeySelection()
  selection.commit(selection.begin(), privateKey)
  const cancelledPick = selection.prepare()
  assert.equal(selection.value, privateKey)
  const repeatedPick = selection.prepare()
  assert.equal(selection.isCurrent(cancelledPick), false)
  assert.equal(selection.isCurrent(repeatedPick), true)
  assert.equal(selection.value, privateKey)
  const replacementRead = selection.begin()
  assert.equal(selection.value, undefined)
  assert.equal(selection.commit(cancelledPick, privateKey), false)
  const replacement = { ...privateKey, name: 'replacement' }
  assert.equal(selection.commit(replacementRead, replacement), true)
  assert.equal(selection.value, replacement)
})

test('browser file reader rejects oversize and public keys before retaining any key', async () => {
  let read = false
  await assert.rejects(readBrowserPrivateKey({ name: 'large', size: MAX_PRIVATE_KEY_BYTES + 1, text: async () => { read = true; return privateKey.content } }), /256 KiB/)
  assert.equal(read, false)
  await assert.rejects(readBrowserPrivateKey(new File(['ssh-ed25519 AAAA'], 'id.pub')), /不是私钥/)
  await assert.rejects(readBrowserPrivateKey(new File([], 'empty')), /空文件/)
  await assert.rejects(readBrowserPrivateKey(new File(['-----BEGIN PRIVATE KEY-----\ntruncated'], 'broken')), /不是私钥/)
  assert.deepEqual(await readBrowserPrivateKey(new File([privateKey.content], privateKey.name)), privateKey)
})

test('missing or invalid capabilities fail closed instead of enabling remembered credentials', () => {
  assert.throws(() => parseRuntimeCapabilities(undefined), /能力/)
  assert.throws(() => parseRuntimeCapabilities({ privateKeyPicker: 'native' }), /能力/)
  assert.throws(() => parseRuntimeCapabilities({ credentialPersistence: 'encrypted', privateKeyPicker: 'unknown' }), /能力/)
  assert.deepEqual(parseRuntimeCapabilities(browser), browser)
  assert.deepEqual(parseRuntimeCapabilities(desktop), desktop)
})

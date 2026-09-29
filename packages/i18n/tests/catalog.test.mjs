import assert from 'node:assert/strict'
import test from 'node:test'
import { HOST_ERROR_CODES } from '@pureterm/protocol'
import { en } from '../dist/en.js'
import { zh } from '../dist/zh.js'
import { getLocale, hasKey, isLocale, localeFromTag, setLocale, t, tPlural, tWireError } from '../dist/index.js'

const keys = Object.keys(en)
const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

test('both catalogs carry exactly the same keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), keys.slice().sort(),
    'a key present in one catalog and not the other is a blank string in one language')
  assert.ok(keys.length > 100, `only ${keys.length} keys; the catalog looks truncated`)
})

test('no message is empty, and English carries no Chinese', () => {
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim().length > 0, `en.${key} is empty`)
    assert.doesNotMatch(value, /[\u4e00-\u9fff]/, `en.${key} still holds Chinese: ${value}`)
  }
  for (const [key, value] of Object.entries(zh)) {
    assert.ok(value.trim().length > 0, `zh.${key} is empty`)
  }
})

test('a key uses the same placeholders in both languages', () => {
  // Catches the drift a translator introduces by renaming {count} to {n}: the
  // sentence still renders, it just renders with a placeholder left standing.
  for (const key of keys) {
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]),
      `${key} disagrees about its placeholders between en and zh`)
  }
})

test('every declared host error code has a sentence in both languages', () => {
  // The compile-time assertion in src/index.ts is the real guard; this repeats
  // it at runtime so a build that skips type checking still fails here.
  for (const code of HOST_ERROR_CODES) {
    assert.ok(hasKey(`error.${code}`), `HOST_ERROR_CODES declares ${code} with no error.${code} message`)
  }
})

test('t fills placeholders and leaves an unknown one standing', () => {
  setLocale('en')
  assert.equal(t('error.ssh.connection-error', { detail: 'boom' }), 'Connection error: boom')
  assert.equal(t('error.ssh.connection-error', { other: 'boom' }), 'Connection error: {detail}',
    'a missing param must stay visible rather than silently blanking the sentence')
  assert.equal(t('error.ssh.empty-host'), 'Enter a host address.')
})

test('tPlural picks the side the count asks for', () => {
  setLocale('en')
  assert.equal(tPlural('keychain.usage', 1), '1 host')
  assert.equal(tPlural('keychain.usage', 3), '3 hosts')
  assert.equal(tPlural('hosts.count.saved', 0), '0 saved', 'zero is not one, and English says saved either way')
  setLocale('zh')
  assert.equal(tPlural('keychain.usage', 1), '1 台主机', 'Chinese does not inflect, so both sides read the same')
  assert.equal(tPlural('keychain.usage', 3), '3 台主机')
})

test('the active locale decides which catalog t reads', () => {
  setLocale('zh')
  assert.equal(t('error.ssh.empty-host'), '主机地址不能为空。')
  setLocale('en')
  assert.equal(t('error.ssh.empty-host'), 'Enter a host address.')
  assert.equal(getLocale(), 'en')
})

test('a known error code is translated and an unknown one falls back to its message', () => {
  setLocale('zh')
  assert.equal(tWireError({ code: 'ssh.auth-failed', message: 'raw' }), '认证失败：用户名、密码或私钥不正确。')
  setLocale('en')
  assert.equal(tWireError({ code: 'ssh.dns-failed', params: { host: 'jump.example.com' }, message: 'raw' }),
    'Cannot resolve the host name jump.example.com.')
  // A code this catalog has never heard of still has to render something.
  assert.equal(tWireError({ code: 'something.from.the.future', message: 'raw diagnostic' }), 'raw diagnostic')
})

test('a locale tag narrows to one of the two catalogs', () => {
  assert.equal(localeFromTag('zh-CN'), 'zh')
  assert.equal(localeFromTag('zh-Hans'), 'zh')
  assert.equal(localeFromTag('en-US'), 'en')
  assert.equal(localeFromTag('fr'), 'en', 'a language with no catalog falls back to the source')
  assert.equal(localeFromTag(undefined), 'en')
  assert.ok(isLocale('en') && isLocale('zh'))
  assert.ok(!isLocale('fr') && !isLocale(undefined))
})

test('the sftp action phrases compose into the sentences that use them', () => {
  setLocale('en')
  const describe = t('sftp.action.remove', { path: '/srv/app' })
  assert.equal(t('error.sftp.remove-failed', { describe }),
    'Delete /srv/app failed: the directory may not be empty, or another process is using it. Only empty directories can be deleted.')
  setLocale('zh')
  assert.equal(t('error.sftp.op-unsupported', { label: t('sftp.action-label.mkdir') }),
    '远端 SFTP 服务不支持「建目录」这个操作。')
})

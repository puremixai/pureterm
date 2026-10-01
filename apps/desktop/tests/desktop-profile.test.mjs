import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  bindDesktopProfile,
  DesktopProfileError,
  DESKTOP_PROFILE_FILE,
  sameDesktopProfilePath,
} from '../dist/electron/runtime/desktop-profile.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pureterm-profile-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'ssh-data')
  const userA = join(root, 'user-a')
  const userB = join(root, 'user-b')
  await mkdir(userA, { recursive: true })
  await mkdir(userB, { recursive: true })
  return { root, dataDir, userA, userB, record: join(dataDir, DESKTOP_PROFILE_FILE) }
}

const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex')

test('first claim writes one ownership record and a second claim reuses it', async t => {
  const f = await fixture(t)
  bindDesktopProfile(f.dataDir, f.userA)
  const record = JSON.parse(await readFile(f.record, 'utf8'))
  assert.deepEqual(Object.keys(record).sort(), ['userData', 'version'])
  assert.equal(record.version, 1)
  assert.equal(record.userData, await realpath(f.userA))
  // Exactly one binding is accepted: the same userData claims again without rewriting.
  const before = await digest(f.record)
  bindDesktopProfile(f.dataDir, f.userA)
  assert.equal(await digest(f.record), before)
})

test('a different profile is rejected and the store is left untouched', async t => {
  const f = await fixture(t)
  bindDesktopProfile(f.dataDir, f.userA)
  // Fixture store, as if a Desktop profile had already written hosts and secrets.
  const hosts = join(f.dataDir, 'hosts.json')
  const secrets = join(f.dataDir, 'secrets.json')
  await writeFile(hosts, JSON.stringify([{ id: 'h1', host: 'example.test' }]))
  await writeFile(secrets, JSON.stringify({ h1: 'ciphertext' }))
  const hostsHash = await digest(hosts)
  const secretsHash = await digest(secrets)
  const recordHash = await digest(f.record)

  assert.throws(() => bindDesktopProfile(f.dataDir, f.userB), error => {
    assert.ok(error instanceof DesktopProfileError)
    assert.equal(error.code, 'profile-mismatch')
    return true
  })
  assert.equal(await digest(f.record), recordHash, 'the ownership record must not be rewritten')
  assert.equal(await digest(hosts), hostsHash, 'hosts must not be rewritten on rejection')
  assert.equal(await digest(secrets), secretsHash, 'secrets must not be rewritten on rejection')
  assert.equal(JSON.parse(await readFile(f.record, 'utf8')).userData, await realpath(f.userA))
})

test('alias and case variants resolve to the same binding', async t => {
  const f = await fixture(t)
  bindDesktopProfile(f.dataDir, f.userA)
  // A path that resolves to the same directory (trailing `.` / redundant separators).
  bindDesktopProfile(join(f.dataDir, '.'), f.userA)
  if (process.platform === 'win32') {
    // Windows paths compare case-insensitively, so an upper-cased spelling is the same profile.
    assert.equal(sameDesktopProfilePath(f.userA, f.userA.toUpperCase()), true)
    bindDesktopProfile(f.dataDir, f.userA.toUpperCase())
  }
})

test('a malformed record fails closed', async t => {
  const f = await fixture(t)
  await mkdir(f.dataDir, { recursive: true })
  await writeFile(f.record, 'this is not json')
  assert.throws(() => bindDesktopProfile(f.dataDir, f.userA), error => {
    assert.equal(error.code, 'profile-invalid')
    return true
  })
  // The unusable record is preserved rather than overwritten.
  assert.equal(await readFile(f.record, 'utf8'), 'this is not json')
})

test('a partial record fails closed after the bounded retry', async t => {
  const f = await fixture(t)
  await mkdir(f.dataDir, { recursive: true })
  await writeFile(f.record, '')
  assert.throws(() => bindDesktopProfile(f.dataDir, f.userA), error => {
    assert.equal(error.code, 'profile-invalid')
    return true
  })
})

test('an unusable data directory fails closed with profile-io', async t => {
  const f = await fixture(t)
  // The parent of the requested directory is a file, so it cannot be created.
  await writeFile(join(f.root, 'blocker'), 'x')
  assert.throws(() => bindDesktopProfile(join(f.root, 'blocker', 'ssh-data'), f.userA), error => {
    assert.equal(error.code, 'profile-io')
    return true
  })
})

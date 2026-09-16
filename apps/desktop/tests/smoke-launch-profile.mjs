// Pure profile persistence/decision baseline. Real renderer-ready persistence is checked
// separately by smoke-electron; this file does not claim an Electron relaunch round trip.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReadinessGate } from '../dist/electron/runtime/readiness.js'
import { LAUNCH_PROFILE_VERSION, launchProfilePath, launchProfileDisabled, planProfileSwitches,
  readLaunchProfile, writeLaunchProfile, describeLaunchProfile } from '../dist/electron/runtime/launch-profile.js'

const profile = { version: LAUNCH_PROFILE_VERSION, switches: ['--no-sandbox', '--disable-gpu'],
  sandboxWeakened: true, renderer: { cols: 100, rows: 30 }, hosts: 2, savedAt: '2026-09-16T00:00:00.000Z' }

function temp(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ssh-cordis-profile-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('profile round trip creates missing directories and preserves Unicode without touching global data', t => {
  const path = launchProfilePath(join(temp(t), 'nested', '档案'))
  assert.equal(readLaunchProfile(path), undefined)
  writeLaunchProfile(path, profile)
  assert.deepEqual(readLaunchProfile(path), profile)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), profile)
  assert.match(describeLaunchProfile(profile), /100x30/)
})

test('corrupt, null, empty and incompatible-version profiles are ignored', t => {
  const path = launchProfilePath(temp(t))
  for (const text of ['', '{broken', 'null', '{}', '{"version":999}', '[]']) {
    writeFileSync(path, text, 'utf8')
    assert.equal(readLaunchProfile(path), undefined, text)
  }
})

test('profile reader normalizes malformed optional fields and filters non-string switches', t => {
  const path = launchProfilePath(temp(t))
  writeFileSync(path, JSON.stringify({ version: 1, switches: ['--no-sandbox', 42, null],
    sandboxWeakened: 'true', renderer: { cols: '90', rows: 'bad' }, hosts: '3', savedAt: 7 }), 'utf8')
  assert.deepEqual(readLaunchProfile(path), { version: 1, switches: ['--no-sandbox'],
    sandboxWeakened: false, renderer: { cols: 90, rows: 0 }, hosts: 3, savedAt: '' })
})

test('profile refill only restores the confirmed sandbox fallback, never incidental GPU flags', () => {
  const plan = overrides => planProfileSwitches({ profile, existingSwitches: [], env: {}, ...overrides })
  assert.deepEqual(plan({}), ['no-sandbox'])
  assert.deepEqual(plan({ profile: undefined }), [])
  assert.deepEqual(plan({ profile: { ...profile, sandboxWeakened: false } }), [])
  assert.deepEqual(plan({ profile: { ...profile, switches: ['--disable-gpu'] } }), [])
  assert.deepEqual(plan({ existingSwitches: ['no-sandbox'] }), [])
  for (const key of ['SSH_CORDIS_NO_LAUNCH_PROFILE', 'SSH_CORDIS_DISABLE_SANDBOX', 'SSH_CORDIS_NO_SANDBOX_FALLBACK']) {
    assert.deepEqual(plan({ env: { [key]: '1' } }), [])
    assert.deepEqual(plan({ env: { [key]: '0' } }), ['no-sandbox'])
  }
  assert.equal(launchProfileDisabled({ SSH_CORDIS_NO_LAUNCH_PROFILE: 'true' }), false)
  assert.equal(launchProfileDisabled({ SSH_CORDIS_NO_LAUNCH_PROFILE: '1' }), true)
})

test('readiness-gated profile writes nothing before readiness or on a failed report', t => {
  const path = launchProfilePath(temp(t))
  const gate = createReadinessGate()
  let commits = 0
  gate.onReady(payload => {
    commits++
    writeLaunchProfile(path, { ...profile, hosts: payload.hosts, renderer: { cols: payload.cols, rows: payload.rows } })
  })
  assert.equal(existsSync(path), false)
  gate.report({ ok: false, cols: 0, rows: 0, hosts: 0, error: 'load failed' })
  assert.equal(existsSync(path), false)
  gate.report({ ok: true, cols: 120, rows: 40, hosts: 5 })
  assert.deepEqual(readLaunchProfile(path).renderer, { cols: 120, rows: 40 })
  assert.equal(readLaunchProfile(path).hosts, 5)
  gate.report({ ok: true, cols: 1, rows: 1, hosts: 0 })
  assert.equal(commits, 1)
  assert.equal(readLaunchProfile(path).hosts, 5)
})

test('profile write failure propagates instead of reporting persistence success', t => {
  const parentFile = join(temp(t), 'not-a-directory')
  writeFileSync(parentFile, 'file', 'utf8')
  assert.throws(() => writeLaunchProfile(join(parentFile, 'profile.json'), profile))
})

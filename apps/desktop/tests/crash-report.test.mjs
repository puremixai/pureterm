import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOST_REPORT_MAX_BYTES, HOST_REPORT_RETENTION, writeHostCrashReport } from '../dist/electron/runtime/crash-report.js'

const report = (overrides = {}) => ({
  version: 1,
  timestamp: '2026-10-01T12:00:00.000Z',
  appVersion: '0.1.0-alpha.2',
  platform: 'win32',
  architecture: 'x64',
  phase: 'runtime',
  reason: 'unexpected-exit',
  pid: 4242,
  exitCode: 1,
  signal: null,
  ...overrides,
})

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-crash-report-'))
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  return directory
}

const reports = async (directory) => (await readdir(directory)).filter(name => name.endsWith('.json')).sort()

test('a written report contains exactly the allowlisted fields', async (t) => {
  const directory = await workspace(t)
  const path = await writeHostCrashReport(directory, report())
  assert.ok(path, 'a normal report must be written')
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(Object.keys(parsed).sort(),
    ['appVersion', 'architecture', 'exitCode', 'phase', 'pid', 'platform', 'reason', 'signal', 'timestamp', 'version'])
  assert.equal(parsed.version, 1)
  assert.equal(parsed.reason, 'unexpected-exit')
  assert.equal(parsed.pid, 4242)
  assert.equal(parsed.signal, null)
  assert.ok((await stat(path)).size <= HOST_REPORT_MAX_BYTES, 'a report stays under the byte cap')
})

test('a report payload cannot carry a token, password, path or terminal output', async (t) => {
  const directory = await workspace(t)
  const secrets = {
    token: 'desktop-token-abcdefghijklmnopqrstuvwxyz',
    password: 'hunter2',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
    path: 'C:\\Users\\someone\\.ssh\\id_ed25519',
    stdout: 'remote terminal output',
    stderr: 'stack trace',
    environment: { SSH_AUTH_SOCK: '/run/agent.sock' },
    hostRecord: { host: 'example.internal', username: 'root' },
  }
  const path = await writeHostCrashReport(directory, report(secrets))
  const raw = await readFile(path, 'utf8')
  for (const [key, value] of Object.entries(secrets)) {
    assert.ok(!raw.includes(key), `the report must not carry a ${key} field`)
    assert.ok(!raw.includes(typeof value === 'string' ? value : JSON.stringify(value)),
      `the report must not carry the ${key} value`)
  }
})

test('an unrecognized, malformed or oversized report is refused rather than written', async (t) => {
  const directory = await workspace(t)
  assert.equal(await writeHostCrashReport(directory, report({ version: 2 })), undefined)
  assert.equal(await writeHostCrashReport(directory, report({ reason: 'made-up' })), undefined)
  assert.equal(await writeHostCrashReport(directory, report({ phase: 'later' })), undefined)
  assert.equal(await writeHostCrashReport(directory, report({ timestamp: 'not a date' })), undefined)
  assert.equal(await writeHostCrashReport(directory, report({ exitCode: 'one' })), undefined)
  assert.equal(await writeHostCrashReport(directory, report({ pid: -1 })), undefined)
  assert.equal(await writeHostCrashReport(directory, report({ signal: 'x'.repeat(200) })), undefined,
    'an oversized identifier is not an identifier')
  assert.deepEqual(await reports(directory), [], 'nothing reaches the directory')
})

test('retention keeps exactly five reports and leaves no temporary files', async (t) => {
  const directory = await workspace(t)
  for (let index = 0; index < 8; index++) {
    const path = await writeHostCrashReport(directory, report({ timestamp: `2026-10-01T12:00:0${index}.000Z`, pid: 1000 + index }))
    assert.ok(path, `report ${index} must be written`)
  }
  const kept = await reports(directory)
  assert.equal(kept.length, HOST_REPORT_RETENTION, 'only the newest five reports survive')
  // 序号补齐到定长，文件名按字典序排就等于按时间排：留下的必须是最新的那五份。
  const pids = await Promise.all(kept.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8')).pid))
  assert.deepEqual(pids.sort((a, b) => a - b), [1003, 1004, 1005, 1006, 1007])
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), [],
    'the atomic temp file is renamed away, never left behind')
})

test('concurrent writes serialize: every report lands whole and rotation still holds', async (t) => {
  const directory = await workspace(t)
  const paths = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    writeHostCrashReport(directory, report({ timestamp: `2026-10-01T12:00:${String(index).padStart(2, '0')}.000Z`, pid: 2000 + index }))))
  assert.ok(paths.every(Boolean), 'no concurrent write is lost')
  assert.equal(new Set(paths).size, paths.length, 'every report gets its own file')
  const kept = await reports(directory)
  assert.equal(kept.length, HOST_REPORT_RETENTION)
  for (const name of kept) JSON.parse(await readFile(join(directory, name), 'utf8'))
})

test('an unwritable directory returns undefined instead of blocking recovery', async (t) => {
  const directory = await workspace(t)
  const blocked = join(directory, 'blocked')
  await writeFile(blocked, 'not a directory')
  assert.equal(await writeHostCrashReport(join(blocked, 'host'), report()), undefined)
})

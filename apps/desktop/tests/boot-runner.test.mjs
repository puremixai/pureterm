import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const loader = new URL('./fixtures/mock-electron-boot.mjs', import.meta.url).href
const bootScript = fileURLToPath(new URL('../scripts/boot-check.mjs', import.meta.url))

for (const scenario of ['failure-marker', 'nonzero-exit', 'unhandled-rejection']) {
  test(`boot CLI rejects BOOT-OK followed by ${scenario}`, () => {
    const result = spawnSync(process.execPath, ['--import', loader, bootScript], {
      cwd: appRoot, env: { ...process.env, BOOT_TEST_SCENARIO: scenario },
      encoding: 'utf8', timeout: 5000, windowsHide: true,
    })
    assert.ifError(result.error)
    assert.match(result.stdout, /\[BOOT-OK\]/, 'the stub did not exercise the success marker')
    assert.equal(result.status, 1, result.stdout + result.stderr)
  })
}

test('boot CLI times out after BOOT-OK, reaps its child tree and removes temporary data', () => {
  const result = spawnSync(process.execPath, ['--import', loader, bootScript], {
    cwd: appRoot, env: { ...process.env, BOOT_TEST_SCENARIO: 'timeout-tree' },
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  })
  const pids = [...result.stdout.matchAll(/\[BOOT-(?:PARENT|CHILD)\] (\d+)/g)].map(match => Number(match[1]))
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  try {
    assert.ifError(result.error)
    assert.match(result.stdout, /\[BOOT-OK\]/)
    assert.equal(pids.length, 2, 'the fixture did not start its child tree')
    assert.equal(result.status, 1, result.stdout + result.stderr)
    for (const pid of pids) assert.equal(alive(pid), false, `test process ${pid} survived the runner timeout`)
    const directory = result.stdout.match(/\[BOOT-TEMP\] ([^\r\n]+)/)?.[1]
    assert.ok(directory)
    assert.equal(existsSync(directory), false, 'temporary application data was not removed')
  } finally {
    // Regression failures must still clean the specifically identified fixture PIDs.
    for (const pid of pids.filter(alive)) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
      } else {
        try { process.kill(pid, 'SIGKILL') } catch {}
      }
    }
  }
})

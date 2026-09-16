import assert from 'node:assert/strict'
import test from 'node:test'
import { decideElectronResult as decide } from '../scripts/electron-runner.mjs'

test('runner requires both an explicit success marker and a clean exit', () => {
  assert.equal(decide({ output: '[SMOKE-OK]', exitCode: 0 }).code, 0)
  assert.equal(decide({ output: 'window created', exitCode: 0 }).code, 1)
  assert.equal(decide({ output: '[SMOKE-OK]', exitCode: 1 }).code, 1)
  assert.equal(decide({ output: '[SMOKE-OK]', exitCode: 0, timedOut: true }).code, 1)
  assert.equal(decide({ output: '[SMOKE-OK]', exitCode: 0, signal: 'SIGTERM' }).code, 1)
})

test('runner validates the selected marker and renderer-ready evidence', () => {
  assert.equal(decide({ output: '[SMOKE-OK]', exitCode: 0, successMarker: '[WEB-SMOKE-OK]' }).code, 1)
  assert.equal(decide({ output: '[WEB-SMOKE-OK]', exitCode: 0, successMarker: '[WEB-SMOKE-OK]', requiredMarkers: ['[WEB-READY]'] }).code, 1)
  assert.equal(decide({ output: '[WEB-READY]\n[WEB-SMOKE-OK]', exitCode: 0,
    successMarker: '[WEB-SMOKE-OK]', requiredMarkers: ['[WEB-READY]'] }).code, 0)
})

test('real failures win over success markers and native environment errors in either order', () => {
  for (const failure of ['[SMOKE-FAIL]', '[SMOKE-ERROR]', '[WEB-SMOKE-FAIL]', '[BOOT-FAIL]',
    'ERR_MODULE_NOT_FOUND', 'ERR_FILE_NOT_FOUND', 'Unable to load preload', '[main] 启动失败']) {
    for (const output of [`No usable sandbox\n${failure}\n[SMOKE-OK]`, `${failure}\nMissing X server`]) {
      assert.equal(decide({ output, exitCode: 0 }).code, 1, output)
    }
  }
})

test('environment limitation requires missing binary or a recognized native failure before readiness', () => {
  assert.equal(decide({ binaryMissing: true }).code, 2)
  assert.equal(decide({ output: 'Missing X server or $DISPLAY', exitCode: 1 }).code, 2)
  assert.equal(decide({ output: 'No usable sandbox', exitCode: 1 }).code, 2)
  assert.equal(decide({ output: 'GPU process exited unexpectedly', exitCode: 1 }).code, 1)
  assert.equal(decide({ output: 'No usable sandbox\n[main] 闸门已打开', exitCode: 1 }).code, 1)
  assert.equal(decide({ output: 'No usable sandbox\n[WEB-READY]', exitCode: 1 }).code, 1)
  assert.equal(decide({ timedOut: true }).code, 1)
  assert.equal(decide({ spawnError: new Error('permission denied') }).code, 1)
})

test('nonfatal native warnings do not turn a successful real run into an unsupported result', () => {
  assert.equal(decide({ output: 'Missing X server warning\n[SMOKE-OK]', exitCode: 0 }).code, 0)
})

test('boot success cannot override a failure marker, nonzero exit, signal or timeout', () => {
  const boot = { successMarker: '[BOOT-OK]', requiredMarkers: ['[main] 闸门已打开'],
    output: '[main] 闸门已打开\n[BOOT-OK]', exitCode: 0 }
  assert.equal(decide(boot).code, 0)
  for (const failure of [
    { output: boot.output + '\n[BOOT-FAIL]' },
    { output: '[BOOT-ERROR]\n' + boot.output },
    { exitCode: 9 }, { signal: 'SIGTERM' }, { timedOut: true },
  ]) assert.equal(decide({ ...boot, ...failure }).code, 1)
  assert.equal(decide({ ...boot, output: '[BOOT-OK]' }).code, 1)
})

test('production unhandledRejection log overrides renderer-ready and BOOT-OK with exit zero', () => {
  assert.equal(decide({
    output: '[main] 闸门已打开\n[BOOT-OK]\n[main] unhandledRejection: Error: asynchronous startup failure',
    exitCode: 0, successMarker: '[BOOT-OK]', requiredMarkers: ['[main] 闸门已打开'],
  }).code, 1)
})

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeSshServer } from './fake-ssh-server.mjs'

/*
 * Host 故障之后的恢复验收，跑的是真实主进程和真实恢复路径。
 *
 *   1. 连上假 SSH 服务器，等渲染层挂上「会话丢了」的观察点；
 *   2. 同一个档案再起一个实例：它必须被拒，且不建 Host（恢复期间档案不能被抢走）；
 *   3. SIGKILL 掉 Host，确认渲染层看到会话断开；
 *   4. 主进程写诊断报告、有界清理、显式重启，并以 0 退出；
 *   5. 重启起来的那一份必须用**同一份隔离档案**、且**零个恢复的 SSH 会话**。
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = fileURLToPath(new URL('./electron-recovery-entry.mjs', import.meta.url))
const DENIED = 'another PureTerm instance already owns this profile'
const HOST_READY = /Host child ready pid=(\d+) parent=(\d+)/
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const processExists = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

function cleanEnvironment(extra) {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith('SSH_CORDIS_') || name === 'ELECTRON_RUN_AS_NODE' ||
      ['NODE_OPTIONS', 'NODE_PATH'].includes(name.toUpperCase())) delete env[name]
  }
  return { ...env, SSH_CORDIS_NO_SANDBOX_FALLBACK: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extra }
}

async function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise(resolve => child.once('close', resolve))
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, timeout: 5000 }, () => resolve()))
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
  }
  try { child.kill('SIGKILL') } catch { /* already exited */ }
  await Promise.race([closed, sleep(5000)])
}

function launch(executable, env) {
  const child = spawn(executable, [entry], {
    cwd: projectRoot, env: cleanEnvironment(env), windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  const state = { child, output: '', exited: false, exitCode: null, signal: null }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { state.output += chunk })
  child.stderr.on('data', chunk => { state.output += chunk })
  child.on('exit', (code, signal) => { state.exited = true; state.exitCode = code; state.signal = signal })
  child.on('error', error => { state.output += `\n[spawn error] ${error.message}` })
  return state
}

async function waitFor(state, predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate(state)) return
    if (state.exited && !predicate(state)) throw new Error(`${label}: process exited early (exit=${state.exitCode}, signal=${state.signal})\n${state.output}`)
    await sleep(50)
  }
  throw new Error(`${label}: timed out\n${state.output}`)
}

async function waitForFile(path, label, state, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await sleep(100)
  }
  const listing = (() => { try { return readdirSync(dirname(path)).join(', ') || '<empty>' } catch { return '<unreadable>' } })()
  const entryLog = (() => { try { return readFileSync(join(dirname(path), 'recovery-entry.log'), 'utf8') } catch { return '<no entry log>' } })()
  throw new Error(`${label}: ${path} never appeared\nuser dir holds: ${listing}\nentry log:\n${entryLog}\nowner output:\n${state?.output ?? '<none>'}`)
}

let executable
try {
  executable = (await import('electron')).default
} catch (error) {
  console.log(`[electron-host-recovery] UNSUPPORTED: ${error.message}`)
  process.exitCode = 2
  process.exit(2)
}
if (!existsSync(executable)) {
  console.log('[electron-host-recovery] UNSUPPORTED: the Electron binary is not installed')
  process.exitCode = 2
  process.exit(2)
}

const server = await createFakeSshServer({ keyAuthentication: true })
const root = mkdtempSync(join(tmpdir(), 'pureterm-recovery-smoke-'))
const data = join(root, 'data')
const user = join(root, 'user')
const relaunchResult = join(user, 'recovery-relaunch.json')
const running = []
let relaunchedPid
try {
  const env = {
    SSH_CORDIS_SMOKE: 'recovery', SSH_CORDIS_RECOVERY_CHOICE: 'restart',
    SSH_CORDIS_DATA_DIR: data, SSH_CORDIS_TEST_USER_DATA: user,
    SSH_CORDIS_SMOKE_HOST: server.host, SSH_CORDIS_SMOKE_PORT: String(server.port),
    SSH_CORDIS_SMOKE_USER: server.username, SSH_CORDIS_SMOKE_PASS: server.password,
  }
  const owner = launch(executable, env)
  running.push(owner)
  await waitFor(owner, state => state.output.includes('[RECOVERY-READY]'), 'live session ready')
  assert.match(owner.output, /\[RECOVERY-SESSION\] \{"state":"connected"\}/,
    'the session must be live in the renderer before the failure')

  const identity = owner.output.match(HOST_READY)
  assert.ok(identity, 'missing production Host process identity')
  const hostPid = Number(identity[1])
  assert.notEqual(hostPid, Number(identity[2]), 'the Host must be its own process')
  assert.ok(processExists(hostPid), 'the Host must be running before the failure')

  // 恢复期间档案不能被抢走。归属锁属于**进程**，恢复只是进程里的一段，所以只要第一个
  // 进程还活着，带着同一份档案来的新实例就只能被拒 —— 而且它不该建 Host。
  const intruder = launch(executable, env)
  running.push(intruder)
  await waitFor(intruder, state => state.output.includes(DENIED), 'second-instance denial')
  assert.ok(!intruder.output.includes('Host child ready'), 'a denied launch must not start a Host')
  await killTree(intruder.child)

  process.kill(hostPid, 'SIGKILL')

  await waitFor(owner, state => state.exited, 'recovery hand-off exit')
  assert.equal(owner.exitCode, 0, `the recovery hand-off is a clean exit\n${owner.output}`)
  assert.equal(owner.signal, null)
  assert.ok(owner.output.includes('[main] restarting after a Host failure'), 'the recovery must relaunch')
  assert.ok(owner.output.includes('[main] Host stopped; exiting.'), 'the Host must be stopped before the hand-off')
  assert.ok(!processExists(hostPid), 'the failed Host must be gone')

  // 重启起来的那一份：同一份隔离档案，零个恢复的 SSH 会话。
  await waitForFile(relaunchResult, 'relaunched instance report', owner)
  const relaunched = JSON.parse(readFileSync(relaunchResult, 'utf8'))
  relaunchedPid = relaunched.pid
  assert.equal(relaunched.dataDir, data, 'the relaunch must reuse the isolated data directory')
  assert.equal(relaunched.profileVersion, 1, 'the relaunch must read the same launch profile')
  assert.ok(Number.isSafeInteger(relaunched.hosts) && relaunched.hosts >= 0, 'the saved-host count must survive the restart')
  assert.equal(relaunched.tabs, 0, 'no SSH session may be restored by the restart')

  // 交棒必须是「等旧进程退出再拿锁」，不是「抢锁」：新进程在 Linux 上曾经输给自己的
  // 上一个进程，被当成普通第二实例静默让位——窗口没建、报告没写、用户面前什么都没剩。
  const entryLog = readFileSync(join(user, 'recovery-entry.log'), 'utf8')
  assert.match(entryLog, new RegExp(`hand-off from pid=${owner.child.pid} complete`),
    'the replacement must wait for the process it is taking over from, not race it for the lock')

  // 诊断报告：有界、只含允许字段、不带路径或凭据。
  const reportDirectory = join(user, 'diagnostics', 'host')
  const names = readdirSync(reportDirectory).filter(name => name.endsWith('.json')).sort()
  assert.ok(names.length >= 1 && names.length <= 5, `expected a bounded report set, saw ${names.length}`)
  assert.deepEqual(readdirSync(reportDirectory).filter(name => name.endsWith('.tmp')), [], 'no temp file may be left behind')
  const raw = readFileSync(join(reportDirectory, names[names.length - 1]), 'utf8')
  const report = JSON.parse(raw)
  assert.equal(report.version, 1)
  assert.equal(report.phase, 'runtime')
  assert.equal(report.reason, 'unexpected-exit')
  assert.ok(report.appVersion.length > 0 && report.platform.length > 0 && report.architecture.length > 0)
  assert.ok(report.signal !== null || report.exitCode !== null, 'the report must describe how the Host died')
  assert.ok(!raw.includes(data), 'the report must not carry the data-directory path')
  assert.ok(!raw.includes(server.password), 'the report must not carry a credential')
  assert.ok(!raw.includes(server.username), 'the report must not carry a host record')

  console.log('[electron-host-recovery] PASS: failure observed, report written, restart reused the isolated profile with zero sessions')
} finally {
  for (const state of running) await killTree(state.child)
  if (relaunchedPid) { try { process.kill(relaunchedPid, 'SIGKILL') } catch { /* already exited */ } }
  await server.close()
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { rmSync(root, { recursive: true, force: true }); break }
    catch { await sleep(200) }
  }
}

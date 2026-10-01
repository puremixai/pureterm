import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * Two real Electron processes, three ownership outcomes:
 *   - the same data directory and the same userData: the newcomer loses the
 *     application lock and exits without starting a Host;
 *   - the same data directory but a different userData: the newcomer holds the
 *     lock but is refused by the ownership record, and still starts no Host;
 *   - a different data directory and userData: it starts normally.
 *
 * The real application main is exercised, so this proves the ordering (lock and
 * bind before Host/window) rather than a unit seam alone.
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = fileURLToPath(new URL('./electron-profile-entry.mjs', import.meta.url))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const HOST_READY = '[main] Host child ready'
const DENIED = 'another PureTerm instance already owns this profile'
const REFUSED = '[main] refusing to start'

function cleanEnvironment(extra) {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith('SSH_CORDIS_') || name === 'ELECTRON_RUN_AS_NODE' ||
      ['NODE_OPTIONS', 'NODE_PATH'].includes(name.toUpperCase())) delete env[name]
  }
  return { ...env, SSH_CORDIS_NO_SANDBOX_FALLBACK: '1', SSH_CORDIS_NO_LAUNCH_PROFILE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extra }
}

async function killTree(child) {
  if (!child || (child.exitCode !== null || child.signalCode !== null)) return
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

async function waitFor(state, predicate, label, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate(state.output)) return
    if (state.exited) throw new Error(`${label}: process exited early (exit=${state.exitCode}, signal=${state.signal})\n${state.output}`)
    await sleep(50)
  }
  throw new Error(`${label}: timed out\n${state.output}`)
}

let executable
try {
  executable = (await import('electron')).default
} catch (error) {
  console.log(`[electron-profile] UNSUPPORTED: ${error.message}`)
  process.exitCode = 2
  process.exit(2)
}
if (!existsSync(executable)) {
  console.log('[electron-profile] UNSUPPORTED: the Electron binary is not installed')
  process.exitCode = 2
  process.exit(2)
}

const root = mkdtempSync(join(tmpdir(), 'pureterm-profile-smoke-'))
const dataA = join(root, 'data-a')
const dataB = join(root, 'data-b')
const userA = join(root, 'user-a')
const userB = join(root, 'user-b')
const running = []
try {
  const owner = launch(executable, { SSH_CORDIS_DATA_DIR: dataA, SSH_CORDIS_TEST_USER_DATA: userA })
  running.push(owner)
  await waitFor(owner, output => output.includes(HOST_READY), 'owner Host start')

  const denied = launch(executable, { SSH_CORDIS_DATA_DIR: dataA, SSH_CORDIS_TEST_USER_DATA: userA })
  running.push(denied)
  await waitFor(denied, output => output.includes(DENIED), 'same-profile denial')
  assert.ok(!denied.output.includes(HOST_READY), 'a denied launch must not start a Host')
  await killTree(denied.child)

  const refused = launch(executable, { SSH_CORDIS_DATA_DIR: dataA, SSH_CORDIS_TEST_USER_DATA: userB })
  running.push(refused)
  await waitFor(refused, output => output.includes(REFUSED), 'profile-mismatch refusal')
  assert.ok(!refused.output.includes(HOST_READY), 'a refused profile must not start a Host')
  await killTree(refused.child)

  const separate = launch(executable, { SSH_CORDIS_DATA_DIR: dataB, SSH_CORDIS_TEST_USER_DATA: userB })
  running.push(separate)
  await waitFor(separate, output => output.includes(HOST_READY), 'separate-profile Host start')

  console.log('[electron-profile] PASS: denial, refusal and separate-profile start all observed')
} finally {
  for (const state of running) await killTree(state.child)
  // A released handle can linger for a moment after the process tree is gone.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { rmSync(root, { recursive: true, force: true }); break }
    catch { await sleep(200) }
  }
}

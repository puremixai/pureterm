import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// A native warning must never hide an application failure. Environment limitation is
// reserved for absent Electron or a recognizable failure before the renderer ran.
export function decideElectronResult({ output = '', exitCode, signal, timedOut = false,
  spawnError, binaryMissing = false, successMarker = '[SMOKE-OK]', requiredMarkers = [] }) {
  const applicationFailure = /\[(?:SMOKE|WEB-SMOKE|BOOT)-(?:FAIL|ERROR)\]|ERR_MODULE_NOT_FOUND|Cannot find module|ERR_FILE_NOT_FOUND|Unable to load preload|uncaughtException|UnhandledPromiseRejection|unhandledRejection|\[main\] 启动失败|自动重启失败/i
  if (applicationFailure.test(output)) return { code: 1, reason: 'application failure reported' }
  if (output.includes(successMarker)) {
    if (exitCode !== 0 || signal || timedOut || spawnError) return { code: 1, reason: 'success marker followed by an unsuccessful shutdown' }
    if (requiredMarkers.some(marker => !output.includes(marker))) return { code: 1, reason: 'required readiness evidence missing' }
    return { code: 0, reason: 'required renderer checks completed and Electron exited cleanly' }
  }
  if (binaryMissing) return { code: 2, reason: 'Electron binary is not installed' }
  if (spawnError) return { code: 1, reason: `failed to start Electron: ${spawnError.message}` }
  const rendererRan = /\[main\] 闸门已打开|\[WEB-READY\]|\[SMOKE\]|\[WEB-SMOKE\]/.test(output)
  const nativeFailure = /Missing X server|\$DISPLAY|cannot open display|No usable sandbox|SUID sandbox helper binary|error while loading shared libraries:|Failed to move to new namespace|GPU process isn't usable|The platform failed to initialize/i
  if (!rendererRan && nativeFailure.test(output)) return { code: 2, reason: 'native Chromium rendering environment is unavailable' }
  return { code: 1, reason: timedOut ? 'timeout without successful completion' : `missing success marker (exit=${exitCode}, signal=${signal ?? 'none'})` }
}

function cleanEnvironment(dataDir, extraEnv) {
  const env = { ...process.env }
  // Inherited user launch settings must not make the test use a real host/data directory.
  for (const name of Object.keys(env)) {
    if (name.startsWith('SSH_CORDIS_') || name === 'ELECTRON_RUN_AS_NODE' || ['NODE_OPTIONS', 'NODE_PATH'].includes(name.toUpperCase())) delete env[name]
  }
  return { ...env, ...extraEnv, SSH_CORDIS_DATA_DIR: dataDir,
    SSH_CORDIS_TEST_USER_DATA: join(dataDir, 'electron-user-data'),
    // Relaunch is tested with owned Node children in smoke-desktop. Avoid detached
    // Electron generations so the runner can always reclaim the complete process tree.
    SSH_CORDIS_NO_SANDBOX_FALLBACK: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
}

async function killTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, timeout: 5000 }, () => resolve()))
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
  }
  try { child.kill('SIGKILL') } catch { /* already exited */ }
}

export async function runElectron({ entry, executable: suppliedExecutable, env = {}, timeoutMs = 45_000,
  successMarker = '[SMOKE-OK]', requiredMarkers = [], inspect,
  switches = (process.env.SSH_CORDIS_SMOKE_SWITCHES ?? '').split(/\s+/).filter(Boolean) }) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ssh-cordis-electron-test-'))
  let child
  let timer
  let cleanupTimer
  let interrupted = false
  const interrupt = () => { interrupted = true; if (child) void killTree(child) }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    let executable
    try {
      executable = suppliedExecutable ?? (await import('electron')).default
    } catch (error) {
      return decideElectronResult({ spawnError: error,
        binaryMissing: /Electron failed to install correctly|Cannot find module 'electron'|Cannot find package 'electron'/.test(error.message) })
    }
    if (!existsSync(executable)) return decideElectronResult({ binaryMissing: true })
    let output = ''
    let timedOut = false
    let spawnError
    child = spawn(executable, [...(entry ? [entry] : []), ...switches], {
      cwd: dataDir, env: cleanEnvironment(dataDir, env), windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const absorb = (sink) => chunk => {
      const text = chunk.toString('utf8')
      output += text
      sink.write(text)
    }
    child.stdout.on('data', absorb(process.stdout))
    child.stderr.on('data', absorb(process.stderr))
    child.on('error', error => { spawnError = error })
    const result = await new Promise(resolve => {
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
      timer = setTimeout(() => {
        timedOut = true
        void killTree(child)
        // Bound even an OS-level failure to close inherited handles.
        cleanupTimer = setTimeout(() => {
          child.stdout.destroy(); child.stderr.destroy()
          resolve({ exitCode: child.exitCode, signal: child.signalCode })
        }, 6000)
      }, timeoutMs)
    })
    clearTimeout(timer); clearTimeout(cleanupTimer)
    const outcome = decideElectronResult({ ...result, output, spawnError, timedOut: timedOut || interrupted, successMarker, requiredMarkers })
    if (outcome.code === 0 && inspect) {
      try { await inspect({ dataDir, output }) }
      catch (error) { return { code: 1, reason: `post-run assertion failed: ${error.message}` } }
    }
    return outcome
  } finally {
    clearTimeout(timer); clearTimeout(cleanupTimer)
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    if (child && child.exitCode === null && child.signalCode === null) await killTree(child)
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

export function reportElectronResult(name, result) {
  console.log(`[${name}] ${result.code === 0 ? 'PASS' : result.code === 2 ? 'UNSUPPORTED' : 'FAIL'}: ${result.reason}`)
  process.exitCode = result.code
}

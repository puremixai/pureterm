// 真实主进程的 Host 恢复验收。
//
// 第一次运行：连上假 SSH 服务器，等外面把 Host 杀掉，确认渲染层看到会话断开，然后
// 由**生产**的恢复路径写诊断报告、有界清理、重启。
// 第二次运行（由 app.relaunch 拉起）：确认「同一份隔离档案 + 零个恢复的 SSH 会话」。
//
// 这里不 mock 任何恢复逻辑：报告、协调器、清理、relaunch 全是生产代码。
import assert from 'node:assert/strict'
import { app, ipcMain } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_CHANNELS } from '@pureterm/protocol'

const userData = process.env.SSH_CORDIS_TEST_USER_DATA
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

const markerPath = join(userData, 'recovery-run-once')
const resultPath = join(userData, 'recovery-relaunch.json')
const relaunched = existsSync(markerPath)
// A relaunched process is spawned by `app.relaunch()`, so its stdout is not the smoke's
// pipe. This file is how the harness can still tell how far that instance got.
const logPath = join(userData, 'recovery-entry.log')
const log = message => { try { appendFileSync(logPath, `${new Date().toISOString()} pid=${process.pid} ${message}\n`) } catch { /* diagnostics only */ } }
let window
let deadline

function fail(error) {
  clearTimeout(deadline)
  log(`fail: ${error instanceof Error ? error.message : String(error)}`)
  console.error('[SMOKE-FAIL] host recovery:', error)
  app.exit(1)
}

log(`start relaunched=${relaunched}`)
// If no window ever appears (for example, a lost single-instance lock that ends in a
// quiet quit), fail loudly instead of hanging with nothing on stdout.
const windowWatchdog = setTimeout(() => fail(new Error('no window appeared within 90s')), 90_000)

function whenReady(target) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('renderer never reported ready')), 20_000)
    const listener = (event, payload) => {
      if (event.sender.id !== target.webContents.id) return
      clearTimeout(timer)
      ipcMain.removeListener(DESKTOP_CHANNELS.ready, listener)
      if (payload?.ok) resolve()
      else reject(new Error(payload?.error ?? 'renderer was not ready'))
    }
    ipcMain.on(DESKTOP_CHANNELS.ready, listener)
  })
}

/*
 * 恢复会在几毫秒内拆掉窗口，所以渲染层**当场**看到断线的这一刻没法在这个 harness 里
 * 截获（生产里是那个「重启 / 退出」对话框给了页面时间）。渲染层那半的证据由
 * `packages/ui/tests/transport-lifecycle.test.mjs` 的「WebSocket loss closes every live
 * terminal tab once」确定性地给出；这里只确定性地记录**故障之前**的活会话状态，
 * 之后由重启起来的那一份证明它没有被恢复。
 */
async function observeFailure(target) {
  // 只跑一次：重启起来的那一份看到标记就走 verifyRelaunch。
  writeFileSync(markerPath, String(process.pid))
  await whenReady(target)
  log('first run ready')
  // 走**界面**那条路（表单 + Connect），这样会话是真的挂在终端标签上的：只调
  // `__smoke.api.open` 会在 Host 上开一条 SSH 连接，但界面上没有标签，也就谈不上
  // 「会话丢了」。
  const session = await target.webContents.executeJavaScript(`new Promise(resolve => {
    const set = (id, value) => { document.getElementById(id).value = value }
    document.getElementById('host-new').click()
    set('host', ${JSON.stringify(process.env.SSH_CORDIS_SMOKE_HOST)})
    set('port', ${JSON.stringify(String(process.env.SSH_CORDIS_SMOKE_PORT))})
    set('user', ${JSON.stringify(process.env.SSH_CORDIS_SMOKE_USER)})
    set('pass', ${JSON.stringify(process.env.SSH_CORDIS_SMOKE_PASS)})
    document.getElementById('connect').click()
    const deadline = Date.now() + 15000
    const tick = () => {
      const strip = document.querySelector('.session-tab')
      const state = strip ? strip.dataset.state : null
      if (state === 'connected') { resolve({ state }); return }
      if (Date.now() > deadline) { resolve({ state: state ?? 'missing' }); return }
      setTimeout(tick, 20)
    }
    tick()
  })`)
  assert.equal(session.state, 'connected', 'the session tab must be connected before the failure')
  console.log('[RECOVERY-SESSION] ' + JSON.stringify(session))
  console.log('[RECOVERY-READY]')
}

async function verifyRelaunch(target) {
  await whenReady(target)
  log('relaunch ready')
  const tabs = await target.webContents.executeJavaScript(`document.querySelectorAll('.session-tab').length`)
  const profile = JSON.parse(readFileSync(join(process.env.SSH_CORDIS_DATA_DIR, 'launch-profile.json'), 'utf8'))
  const result = { tabs, profileVersion: profile.version, hosts: profile.hosts, dataDir: process.env.SSH_CORDIS_DATA_DIR, pid: process.pid }
  writeFileSync(resultPath, JSON.stringify(result))
  log('relaunch report written')
  console.log('[RECOVERY-RELAUNCH] ' + JSON.stringify(result))
  clearTimeout(deadline)
  app.quit()
}

app.on('browser-window-created', (_event, created) => {
  if (window) return
  window = created
  clearTimeout(windowWatchdog)
  log('window created')
  created.setFocusable(false)
  created.hide()
  created.on('show', () => created.hide())
  // 被拒绝的第二实例根本不会走到窗口这一步，所以超时也从这里才开始算。
  deadline = setTimeout(() => fail(new Error('host recovery timed out')), 90_000)
  void (relaunched ? verifyRelaunch(created) : observeFailure(created)).catch(fail)
})

await import('../dist/electron/app/main.js')

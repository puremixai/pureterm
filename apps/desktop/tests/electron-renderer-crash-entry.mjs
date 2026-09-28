// Exercise the real main process: a renderer crash must release its generation,
// cancel the child Host's SSH session, and allow normal application shutdown.
import assert from 'node:assert/strict'
import { app, ipcMain } from 'electron'
import { mkdirSync } from 'node:fs'
import { DESKTOP_CHANNELS } from '@pureterm/protocol'

mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
let window
let opening = false
let crashRequested = false
let crashObserved = false
let crashRetry
const deadline = setTimeout(() => fail(new Error('renderer crash cleanup timed out')), 20_000)

function fail(error) {
  clearTimeout(deadline)
  clearInterval(crashRetry)
  console.error('[SMOKE-FAIL] renderer crash:', error)
  app.quit()
}

/*
 * Crash again if one request did not take.
 *
 * forcefullyCrashRenderer() is a request, not a guarantee: on the windows-2025 CI
 * image it has returned without render-process-gone arriving for the whole 20s
 * deadline, while another run on the same image saw it in 8ms. A dropped request
 * must not read as "the production shell failed to release the crashed
 * generation" -- that is exactly what this case exists to prove. So re-issue it on
 * an interval until the crash is observed; observing, the deadline, and the window
 * closing all stop the retry. The assertion and the deadline are unchanged.
 */
function requestCrash() {
  if (crashObserved || !window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.forcefullyCrashRenderer()
}

app.on('browser-window-created', (_event, created) => {
  window = created
  created.setFocusable(false)
  created.hide()
  created.on('show', () => created.hide())
  created.webContents.once('render-process-gone', (_event, details) => {
    crashObserved = true
    clearInterval(crashRetry)
    console.log('[RENDERER-CRASH-OBSERVED] ' + JSON.stringify({ reason: details.reason }))
  })
  created.once('closed', () => {
    clearInterval(crashRetry)
    if (!crashRequested || !crashObserved) { fail(new Error('window closed before the renderer crash')); return }
    clearTimeout(deadline)
    console.log('[RENDERER-CRASH-OK] production shell released the crashed generation')
    // macOS intentionally keeps the application open after its last window closes.
    // End that test instance through the ordinary quit lifecycle as well.
    if (process.platform === 'darwin') setImmediate(() => app.quit())
  })
})

ipcMain.on(DESKTOP_CHANNELS.ready, (event, payload) => {
  if (opening || event.sender.id !== window?.webContents.id) return
  if (!payload?.ok) { fail(new Error(payload?.error ?? 'renderer was not ready')); return }
  opening = true
  void (async () => {
    const config = {
      host: process.env.SSH_CORDIS_SMOKE_HOST, port: Number(process.env.SSH_CORDIS_SMOKE_PORT),
      username: process.env.SSH_CORDIS_SMOKE_USER, password: process.env.SSH_CORDIS_SMOKE_PASS,
      acceptUnknownHostKey: true, cols: 100, rows: 30,
    }
    const session = await window.webContents.executeJavaScript(`window.__smoke.api.open(${JSON.stringify(config)})`)
    assert.ok(session.sessionId)
    console.log('[RENDERER-CRASH-SESSION] ' + JSON.stringify({ sessionId: session.sessionId }))
    crashRequested = true
    requestCrash()
    crashRetry = setInterval(requestCrash, 1_000)
  })().catch(fail)
})

await import('../dist/electron/app/main.js')

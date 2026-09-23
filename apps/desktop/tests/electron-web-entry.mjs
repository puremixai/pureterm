// Real Chromium without preload attaches to the Desktop child Web Host and runs
// the renderer's SSH smoke hook over the production authenticated HTTP/WS carrier.
import assert from 'node:assert/strict'
import { app, BrowserWindow, safeStorage } from 'electron'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startHostProcess } from '../dist/electron/runtime/host-process.js'

const dataDir = process.env.SSH_CORDIS_DATA_DIR
mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
// Keep Electron alive while the child Host finishes its bounded shutdown.
app.on('window-all-closed', () => {})
let hostProcess
let window
let code = 1
let readyTimer
async function main() {
try {
  await app.whenReady()
  hostProcess = await startHostProcess({
    entry: fileURLToPath(new URL('../dist/electron/host/entry.js', import.meta.url)),
    dataDir,
    credentials: { persistent: true,
      seal: plain => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString('base64') : undefined,
      unseal: sealed => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(sealed, 'base64')) : undefined },
    pickPrivateKey: async () => undefined,
  })
  assert.ok(hostProcess.pid > 0 && hostProcess.pid !== process.pid)
  const address = new URL(hostProcess.url)
  assert.equal(address.hostname, '127.0.0.1')
  assert.ok(address.searchParams.has('token'), 'browser URL needs a separate attached-client token')
  assert.notEqual(address.searchParams.get('token'), hostProcess.desktopToken)
  console.log('[WEB-HOST] ' + JSON.stringify({ pid: hostProcess.pid, parent: process.pid }))

  window = new BrowserWindow({ show: false, width: 1120, height: 740, focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  address.searchParams.set('smoke', '1')
  await window.loadURL(address.href)
  const ready = await Promise.race([
    window.webContents.executeJavaScript('window.__smoke?.ready'),
    new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error('web renderer-ready timed out')), 15_000) }),
  ])
  clearTimeout(readyTimer)
  assert.equal(ready?.ok, true, ready?.error ?? 'missing renderer readiness')
  assert.ok(ready.cols > 0 && ready.rows > 0)
  assert.equal(ready.hosts, 0)
  console.log('[WEB-READY] ' + JSON.stringify(ready))
  assert.equal(await window.webContents.executeJavaScript('typeof window.puretermDesktop'), 'undefined', 'attached browser unexpectedly received Desktop preload')
  assert.equal(await window.webContents.executeJavaScript('typeof window.sshAPI'), 'undefined', 'attached browser unexpectedly received SSH IPC')
  assert.equal(await window.webContents.executeJavaScript('document.getElementById("remember").checked && !document.getElementById("remember").disabled'), true)
  assert.equal(await window.webContents.executeJavaScript('document.getElementById("credential-hint").hidden'), true)
  const config = { host: process.env.SSH_CORDIS_SMOKE_HOST, port: Number(process.env.SSH_CORDIS_SMOKE_PORT),
    username: process.env.SSH_CORDIS_SMOKE_USER, password: process.env.SSH_CORDIS_SMOKE_PASS }
  const report = await window.webContents.executeJavaScript(`window.__smoke.run(${JSON.stringify(config)})`)
  console.log('[WEB-SMOKE] ' + JSON.stringify(report))
  assert.equal(report.preload, 'undefined')
  assert.equal(report.error, null)
  assert.equal(report.replacementChars, 0)
  assert.match(report.text, /你好，世界/)
  assert.match(report.text, /echo:ls/)
  assert.deepEqual(report.openedSize, { cols: 100, rows: 30 })
  assert.ok(report.sessionId && report.closedReason)
  code = 0
} catch (error) {
  console.error('[WEB-SMOKE-FAIL]', error)
} finally {
  clearTimeout(readyTimer)
  try {
    window?.destroy()
    await hostProcess?.dispose()
  } catch (error) { code = 1; console.error('[WEB-SMOKE-FAIL] cleanup', error) }
  console.log(code === 0 ? '[WEB-SMOKE-OK]' : '[WEB-SMOKE-FAIL]')
  setTimeout(() => app.exit(code), 300)
}
}
void main()

import { app, BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'

mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
let window
async function main() {
try {
  await app.whenReady()
  window = new BrowserWindow({ show: false, width: 1120, height: 740, focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  window.webContents.on('console-message', (event) => console.log('[CLIENT-RENDERER] ' + event.message))
  await window.loadFile(process.env.PURETERM_CLIENT_TEST_HTML)
  const checks = await window.webContents.executeJavaScript('window.runClientLifecycleChecks()')
  for (const check of checks) console.log('[CLIENT-CHECK] ' + check)
  console.log('[SMOKE-OK] client plugin lifecycle')
  window.destroy()
  app.exit(0)
} catch (error) {
  console.error('[SMOKE-FAIL]', error)
  window?.destroy()
  app.exit(1)
}
}
void main()

// Real Chromium without preload loads the same built renderer over the production
// authenticated HTTP/WS carrier and runs the renderer's existing SSH smoke hook.
import assert from 'node:assert/strict'
import { app, BrowserWindow, safeStorage } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHost } from '@pureterm/host'
import { createCompositeBridge } from '@pureterm/transport/carrier'
import { createDispatcher } from '@pureterm/transport/dispatch'
import { createHttpCarrier } from '@pureterm/transport/carrier-http'

const dataDir = process.env.SSH_CORDIS_DATA_DIR
mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
let host
let carrier
let window
let code = 1
let readyTimer
async function main() {
try {
  await app.whenReady()
  const carriers = []
  host = await createHost({
    hostStoreFile: join(dataDir, 'hosts.json'), knownHostsFile: join(dataDir, 'known_hosts.json'),
    bridge: createCompositeBridge(() => carriers),
    credentials: { persistent: true,
      seal: (plain) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString('base64') : undefined,
      unseal: (sealed) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(sealed, 'base64')) : undefined },
  })
  let acceptReady
  let rejectReady
  const ready = new Promise((resolve, reject) => { acceptReady = resolve; rejectReady = reject })
  // Attach a handler immediately so an early page failure cannot become unhandled.
  void ready.catch(() => {})
  const dispatcher = createDispatcher({ host, capabilities: { credentialPersistence: 'encrypted', privateKeyPicker: 'native' }, pickPrivateKey: async () => undefined, onReady: (payload, clientId) => {
    if (!payload.ok) { rejectReady(new Error(payload.error ?? 'web renderer did not initialize')); return }
    try {
      assert.match(clientId, /^ws:/)
      assert.ok(payload.cols > 0 && payload.rows > 0)
      assert.equal(payload.hosts, 0)
      console.log('[WEB-READY] ' + JSON.stringify(payload))
      acceptReady(payload)
    } catch (error) { rejectReady(error) }
  } })
  carrier = await createHttpCarrier({ dispatcher, onDisconnect: (id) => host.releaseClient(id),
    staticDir: fileURLToPath(new URL('.', import.meta.resolve('@pureterm/ui/index.html'))) })
  carriers.push(carrier)
  window = new BrowserWindow({ show: false, width: 1120, height: 740, focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const url = new URL(carrier.url)
  url.searchParams.set('smoke', '1')
  readyTimer = setTimeout(() => rejectReady(new Error('web renderer-ready timed out')), 15_000)
  await window.loadURL(url.href)
  await ready
  clearTimeout(readyTimer)
  assert.equal(await window.webContents.executeJavaScript('typeof window.sshAPI'), 'undefined', 'Web test accidentally used IPC preload')
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
    await carrier?.dispose()
    await host?.dispose()
  } catch (error) { code = 1; console.error('[WEB-SMOKE-FAIL] cleanup', error) }
  console.log(code === 0 ? '[WEB-SMOKE-OK]' : '[WEB-SMOKE-FAIL]')
  app.exit(code)
}
}
void main()

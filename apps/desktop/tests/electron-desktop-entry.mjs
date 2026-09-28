// Test-only wrapper: the real application main creates its shell and Web Host and
// invokes diagnostics/smoke. Keep its window hidden and its Chromium profile temporary.
import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
let applicationWindow
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false)
  window.hide()
  window.on('show', () => window.hide())
  if (applicationWindow) return
  applicationWindow = window
  window.webContents.once('did-finish-load', () => {
    void (async () => {
      const useCompactWindowChrome = process.platform !== 'darwin'
      assert.equal(window.isMenuBarAutoHide(), useCompactWindowChrome, 'desktop application menu must follow the platform chrome plan')
      if (useCompactWindowChrome) assert.equal(window.isMenuBarVisible(), false, 'desktop application menu must not consume a permanent row')
      // The cluster is built by the renderer after the desktop sheet lands, so this waits
      // for it rather than reading once — and on macOS it waits out the same budget to
      // prove the absence, which is the half of the platform decision that matters most:
      // a second set of buttons beside the traffic lights is the bug this prevents.
      const chrome = await window.webContents.executeJavaScript(`new Promise(resolve => {
        const read = () => {
          const topbar = document.querySelector('.app-topbar')
          const cluster = document.getElementById('window-controls')
          return {
            clusterButtons: cluster ? [...cluster.querySelectorAll('button')].map(button => button.id) : [],
            clusterStyled: !!cluster && getComputedStyle(cluster).marginLeft !== '0px',
            topbarDraggable: getComputedStyle(topbar).getPropertyValue('-webkit-app-region') === 'drag',
          }
        }
        const deadline = Date.now() + 5000
        const tick = () => {
          const seen = read()
          if (seen.clusterButtons.length || Date.now() > deadline) resolve(seen)
          else setTimeout(tick, 25)
        }
        tick()
      })()`)
      const expected = process.platform === 'darwin'
        ? []
        : ['window-minimize', 'window-maximize', 'window-close']
      assert.deepEqual(chrome.clusterButtons, expected,
        'the self-drawn caption cluster follows the platform: macOS keeps its traffic lights, Windows and Linux have none of their own')
      if (expected.length) assert.equal(chrome.clusterStyled, true, 'the cluster must arrive with desktop.css, not as three bare glyphs')
      assert.equal(chrome.topbarDraggable, true, 'the custom top bar must remain a drag region')
      console.log('[WINDOW-CHROME-OK]')
      if (process.env.SSH_CORDIS_SMOKE !== '1') return
      const bootstrap = await window.webContents.executeJavaScript('window.puretermDesktop.bootstrap()')
      assert.deepEqual(Object.keys(bootstrap), ['webSocketUrl'], 'bootstrap must not expose a credential')
      assert.match(bootstrap.webSocketUrl, /^ws:\/\/127\.0\.0\.1:\d+\/ws$/)
      const unauthorized = new BrowserWindow({ show: false, webPreferences: {
        preload: fileURLToPath(new URL('../dist/electron/carriers/preload.cjs', import.meta.url)),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      } })
      try {
        await unauthorized.loadURL('pureterm-app://app/')
        await assert.rejects(unauthorized.webContents.executeJavaScript('window.puretermDesktop.bootstrap()'), /unowned frame/)
        const accepted = await unauthorized.webContents.executeJavaScript(`new Promise(resolve => {
          const socket = new WebSocket(${JSON.stringify(bootstrap.webSocketUrl)});
          socket.onopen = () => { socket.close(); resolve(true); };
          socket.onerror = () => resolve(false);
        })`)
        assert.equal(accepted, false, 'another window must not receive Desktop authorization')
      } finally { unauthorized.destroy() }
      console.log('[DESKTOP-BOUNDARY-OK]')
    })().catch(error => console.error('[WINDOW-CHROME-FAIL]', error))
  })
})
await import('../dist/electron/app/main.js')

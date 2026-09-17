// Test-only wrapper: the real application main still creates its shell/carriers and
// invokes diagnostics/smoke. Keep its window hidden and its Chromium profile temporary.
import assert from 'node:assert/strict'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'

mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false)
  window.hide()
  window.on('show', () => window.hide())
  window.webContents.once('did-finish-load', () => {
    void (async () => {
      const useCompactWindowChrome = process.platform !== 'darwin'
      assert.equal(window.isMenuBarAutoHide(), useCompactWindowChrome, 'desktop application menu must follow the platform chrome plan')
      if (useCompactWindowChrome) assert.equal(window.isMenuBarVisible(), false, 'desktop application menu must not consume a permanent row')
      const chrome = await window.webContents.executeJavaScript(`(() => {
        const topbar = document.querySelector('.app-topbar')
        return {
          overlayAvailable: typeof navigator.windowControlsOverlay === 'object',
          topbarDraggable: getComputedStyle(topbar).getPropertyValue('-webkit-app-region') === 'drag',
        }
      })()`)
      if (process.platform !== 'darwin') assert.equal(chrome.overlayAvailable, true, 'native window controls must remain available in the custom title bar')
      assert.equal(chrome.topbarDraggable, true, 'the custom top bar must remain a drag region')
      console.log('[WINDOW-CHROME-OK]')
    })().catch(error => console.error('[WINDOW-CHROME-FAIL]', error))
  })
})
await import('../dist/electron/app/main.js')

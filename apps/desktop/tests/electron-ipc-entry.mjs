// Test-only wrapper: the real application main still creates its shell/carriers and
// invokes diagnostics/smoke. Keep its window hidden and its Chromium profile temporary.
import { app } from 'electron'
import { mkdirSync } from 'node:fs'

mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false)
  window.hide()
  window.on('show', () => window.hide())
})
await import('../dist/electron/app/main.js')

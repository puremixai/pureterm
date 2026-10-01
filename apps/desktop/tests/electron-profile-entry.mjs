// Test-only long-lived wrapper: bind an isolated userData, keep every window hidden,
// then run the real application main so profile ownership and single-instance
// behaviour are exercised end to end rather than only in a unit seam.
import { app } from 'electron'
import { mkdirSync } from 'node:fs'

const userData = process.env.SSH_CORDIS_TEST_USER_DATA
if (userData) {
  mkdirSync(userData, { recursive: true })
  app.setPath('userData', userData)
}
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false)
  window.hide()
  window.on('show', () => window.hide())
})
await import('../dist/electron/app/main.js')

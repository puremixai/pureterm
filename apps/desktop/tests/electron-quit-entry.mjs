// Test-only long-lived wrapper for the ordinary-quit guard. It binds an isolated
// userData, keeps the window hidden, opens one real SSH session through the UI, and
// then drives a window close. The mode decides whether the guard is answered with
// "cancel" (the window, socket and session must survive) or "accept" (the Host must
// stop and the application must exit). The real application main is exercised, so
// this proves the close/before-quit routing rather than a unit seam alone.
import { app } from 'electron'
import { mkdirSync } from 'node:fs'

const userData = process.env.SSH_CORDIS_TEST_USER_DATA
if (userData) {
  mkdirSync(userData, { recursive: true })
  app.setPath('userData', userData)
}

const mode = process.env.SSH_CORDIS_TEST_QUIT_MODE ?? 'cancel'
const config = {
  host: process.env.SSH_CORDIS_SMOKE_HOST ?? '127.0.0.1',
  port: Number(process.env.SSH_CORDIS_SMOKE_PORT ?? '2222'),
  username: process.env.SSH_CORDIS_SMOKE_USER ?? 'demo',
  password: process.env.SSH_CORDIS_SMOKE_PASS ?? 'demo',
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let firstWindow
let drove = false
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false)
  window.hide()
  window.on('show', () => window.hide())
  if (firstWindow) return
  firstWindow = window
  window.webContents.once('did-finish-load', () => {
    if (drove) return
    drove = true
    void drive(window).catch(error => console.error('[QUIT-ERROR]', error))
  })
})

/** Open a session with the same UI entry points a user clicks. */
async function openSession(window) {
  return window.webContents.executeJavaScript(`(async () => {
    const wait = async (read, what, timeout = 25000) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        const seen = read();
        if (seen) return seen;
        if (Date.now() > deadline) throw new Error('timed out waiting for ' + what);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    await wait(() => document.getElementById('host-new') ? true : null, 'the host editor');
    await wait(() => document.getElementById('connect') && !document.getElementById('connect').disabled ? true : null, 'the host capabilities');
    // The window is hidden, and the terminal treats a hidden document as not ready to
    // lay out. This fixture makes the page look foregrounded, exactly like the monitor
    // smoke does; the product's visibility policy is unchanged.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    try {
      document.getElementById('host-new').click();
      const fill = (id, value) => {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      };
      fill('host', ${JSON.stringify(config.host)});
      fill('port', ${JSON.stringify(String(config.port))});
      fill('user', ${JSON.stringify(config.username)});
      fill('pass', ${JSON.stringify(config.password)});
      fill('host-label', 'Quit fixture');
      document.getElementById('connect').click();
      await wait(() => document.getElementById('status-dot').dataset.state === 'connected' ? true : null, 'the session');
      return { tabs: document.querySelectorAll('.session-tab').length, state: document.getElementById('status-dot').dataset.state };
    } catch (error) {
      return { error: String(error && error.message || error), state: document.getElementById('status-dot')?.dataset.state,
        status: document.getElementById('status-state')?.textContent ?? null,
        banner: [...document.querySelectorAll('[role=alert], .error, .toast')].map(node => node.textContent).join(' | ') };
    } finally {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }
  })()`)
}

async function sessionFacts(window) {
  return window.webContents.executeJavaScript(`({
    connected: document.getElementById('status-dot').dataset.state,
    tabs: document.querySelectorAll('.session-tab').length,
  })`)
}

async function drive(window) {
  const opened = await openSession(window)
  if (opened.error) throw new Error(`could not open the fixture session: ${JSON.stringify(opened)}`)
  const tabs = opened.tabs
  // macOS has no guarded window close (closing a window just releases that page's
  // sessions), so the application-level guard is exercised through app.quit() there.
  const triggerQuit = () => { if (process.platform === 'darwin') app.quit(); else window.close() }
  if (mode === 'cancel') {
    const contentsId = window.webContents.id
    triggerQuit()
    await sleep(1500)
    const alive = !window.isDestroyed()
    const facts = alive ? await sessionFacts(window) : { connected: 'destroyed', tabs: 0 }
    const report = {
      alive,
      sameContents: alive && window.webContents.id === contentsId,
      connected: facts.connected,
      tabs: facts.tabs,
      openedTabs: tabs,
    }
    console.log('[QUIT-CANCEL] ' + JSON.stringify(report))
    console.log('[QUIT-CANCEL-OK]')
    // Let the guard answer "yes" now, so this fixture exits through the same cleanup
    // path instead of leaving an orphaned Host child behind.
    process.env.SSH_CORDIS_QUIT_CONFIRM = 'accept'
    app.quit()
    return
  }
  console.log('[QUIT-ACCEPT-STARTED]')
  triggerQuit()
}

await import('../dist/electron/app/main.js')

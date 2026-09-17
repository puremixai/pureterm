// Chromium is only a test browser here: no preload, Host or Electron IPC carrier.
// The application itself runs in a separate, ordinary Node process.
import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
let window
let code = 1

async function until(predicate, description, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(25)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

const evaluate = (script) => window.webContents.executeJavaScript(script, true)

async function pickBrowserFile(path, button = 'key-pick', resultField = 'key-path') {
  const debug = window.webContents.debugger
  debug.attach('1.3')
  let timer
  let listener
  try {
    await debug.sendCommand('Page.enable')
    await debug.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
    const picker = new Promise((resolve, reject) => {
      listener = (_event, method, params) => { if (method === 'Page.fileChooserOpened') resolve(params) }
      debug.on('message', listener)
      timer = setTimeout(() => reject(new Error('Browser file chooser did not open from the selection button')), 5000)
    })
    await evaluate(`document.getElementById(${JSON.stringify(button)}).click()`)
    const event = await picker
    await debug.sendCommand('DOM.setFileInputFiles', { files: [path], backendNodeId: event.backendNodeId })
  } finally {
    clearTimeout(timer)
    if (listener) debug.removeListener('message', listener)
    if (debug.isAttached()) debug.detach()
  }
  await until(() => evaluate(`document.getElementById(${JSON.stringify(resultField)}).value === ${JSON.stringify(basename(path))}`), 'browser File.text() private-key selection')
}

async function main() {
  try {
    await app.whenReady()
    window = new BrowserWindow({ show: false, width: 1120, height: 740, focusable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    const url = new URL(process.env.PURETERM_TEST_WEB_URL)
    url.searchParams.set('smoke', '1')
    await window.loadURL(url.href)
    await until(() => evaluate('document.getElementById("status").textContent === "就绪"'), 'standalone UI readiness')
    assert.equal(await evaluate('typeof window.sshAPI'), 'undefined')
    assert.equal(await evaluate('document.getElementById("remember").disabled && !document.getElementById("remember").checked'), true)
    assert.equal(await evaluate('document.getElementById("credential-hint").hidden'), false)
    assert.equal(await evaluate('new URL(location.href).searchParams.has("token")'), false)
    console.log('[WEB-READY] standalone Node + browser capabilities ready')

    const config = { host: process.env.SSH_CORDIS_SMOKE_HOST, port: Number(process.env.SSH_CORDIS_SMOKE_PORT),
      username: process.env.SSH_CORDIS_SMOKE_USER, password: process.env.SSH_CORDIS_SMOKE_PASS }
    const report = await evaluate(`window.__smoke.run(${JSON.stringify(config)})`)
    assert.equal(report.preload, 'undefined')
    assert.equal(report.error, null)
    assert.equal(report.replacementChars, 0)
    assert.match(report.text, /你好，世界/)
    assert.match(report.text, /echo:ls/)
    assert.deepEqual(report.openedSize, { cols: 100, rows: 30 })
    assert.ok(report.sessionId && report.closedReason)
    console.log('[WEB-SMOKE] standalone Node SSH roundtrip succeeded')

    for (const label of ['Alpha terminal', 'Beta terminal']) {
      await evaluate(`(() => {
        document.getElementById('host-new').click();
        document.getElementById('host').value = ${JSON.stringify(config.host)};
        document.getElementById('port').value = ${JSON.stringify(String(config.port))};
        document.getElementById('user').value = ${JSON.stringify(config.username)};
        document.getElementById('pass').value = ${JSON.stringify(config.password)};
        document.getElementById('host-label').value = ${JSON.stringify(label)};
        document.getElementById('connect').click();
      })()`)
      await until(() => evaluate('document.getElementById("session-state").className === "connected"'), 'independent SSH tab connection')
    }
    assert.equal(await evaluate('document.querySelectorAll(".session-tab[data-state=connected]").length'), 2)
    const paste = async text => evaluate(`(() => {
      const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(text + '\r')});
      document.querySelector('.terminal-pane:not([hidden]) .xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    })()`)
    const visibleText = 'document.querySelector(".terminal-pane:not([hidden]) .xterm-rows").textContent'
    await paste('beta-only')
    await until(() => evaluate(`${visibleText}.includes('echo:beta-only')`), 'Beta output')
    await evaluate('document.getElementById("hosts-tab").click()')
    assert.equal(await evaluate('document.getElementById("session-workspace").hidden && !document.getElementById("hosts-panel").hidden'), true)
    await evaluate('[...document.querySelectorAll(".session-tab [role=tab]")].find(tab => tab.textContent === "Alpha terminal").click()')
    await paste('alpha-only')
    await until(() => evaluate(`${visibleText}.includes('echo:alpha-only')`), 'Alpha output')
    assert.equal(await evaluate(`${visibleText}.includes('beta-only')`), false)
    await evaluate('document.querySelector(".session-tab.is-active [data-tab-close]").click()')
    assert.equal(await evaluate('document.querySelectorAll(".session-tab[data-state=connected]").length'), 1)
    await paste('beta-still-alive')
    await until(() => evaluate(`${visibleText}.includes('echo:beta-still-alive')`), 'remaining session after closing Alpha')
    await evaluate('document.querySelector(".session-tab.is-active [data-tab-close]").click()')
    console.log('[WEB-MULTI-TAB] real SSH sessions keep separate output and closing one preserves the other')

    // A real browser file input reads a real fixture file. Clicking the actual UI
    // button also checks that file selection remains in its original user gesture.
    await evaluate(`(() => {
      document.getElementById('host-new').click();
      document.getElementById('host').value = ${JSON.stringify(config.host)};
      document.getElementById('port').value = ${JSON.stringify(String(config.port))};
      document.getElementById('user').value = ${JSON.stringify(config.username)};
      const auth = document.getElementById('auth'); auth.value = 'privateKey';
      auth.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await pickBrowserFile(process.env.PURETERM_TEST_PRIVATE_KEY)
    await evaluate(`(() => {
      const label = document.getElementById('host-label'); label.value = 'Browser key host';
      label.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    assert.equal(await evaluate('document.getElementById("key-path").value'), basename(process.env.PURETERM_TEST_PRIVATE_KEY), 'renaming a host must not discard its selected private key')
    await evaluate('document.getElementById("connect").click()')
    await until(() => evaluate('document.getElementById("session-state").className === "connected"'), 'SSH authentication using the browser-selected private key')
    await evaluate(`(() => {
      const text = new DataTransfer();
      text.setData('text/plain', 'browser-key-check\\r');
      document.querySelector('.terminal-pane:not([hidden]) .xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: text,
      }));
    })()`)
    await until(() => evaluate('document.querySelector(".terminal-pane:not([hidden]) .xterm-rows").textContent.includes("echo:browser-key-check")'), 'private-key terminal echo through browser paste')
    await evaluate('document.getElementById("disconnect").click()')
    await until(() => evaluate('document.getElementById("disconnect").disabled'), 'private-key SSH disconnect')
    console.log('[WEB-BROWSER-KEY-AUTH] browser-selected private key authenticated and terminal echo completed')
    await evaluate(`(() => {
      document.getElementById('key-pass').value = 'browser-key-passphrase-never-persist';
      document.getElementById('host-save').click();
    })()`)
    await until(() => evaluate('document.getElementById("status").textContent.startsWith("已保存")'), 'browser metadata save')
    assert.equal(await evaluate('document.querySelectorAll(".tag.saved").length'), 0)
    await window.loadURL(url.href)
    await until(() => evaluate('document.getElementById("status").textContent === "就绪"'), 'page reload readiness')
    await evaluate('document.querySelector("[data-act=edit]").click()')
    assert.deepEqual(await evaluate(`({ key: document.getElementById('key-path').value,
      passphrase: document.getElementById('key-pass').value, password: document.getElementById('pass').value })`),
    { key: '', passphrase: '', password: '' })
    console.log('[WEB-BROWSER-KEY] browser-selected key and passphrase cleared after reload')

    await evaluate(`document.getElementById('nav-keychain').click(); document.getElementById('keychain-new').click()`)
    await pickBrowserFile(process.env.PURETERM_TEST_PRIVATE_KEY, 'keychain-import', 'keychain-label')
    await evaluate(`document.getElementById('keychain-save').click()`)
    await until(() => evaluate(`document.getElementById('keychain-status').textContent.startsWith('密钥已保存')`), 'Keychain import and save')
    assert.equal(await evaluate(`document.getElementById('keychain-private').value`), '')
    assert.match(await evaluate(`document.getElementById('keychain-public').value`), /^ssh-rsa /)
    assert.match(await evaluate(`document.getElementById('keychain-fingerprint').textContent`), /^SHA256:/)
    await evaluate(`(() => {
      document.getElementById('nav-hosts').click();
      document.querySelector('.host-row [data-act=edit]').click();
      const key = document.getElementById('host-keychain'); key.selectedIndex = 1; key.dispatchEvent(new Event('change'));
      document.getElementById('host-save').click();
    })()`)
    await until(() => evaluate(`document.getElementById('status').textContent.startsWith('已保存')`), 'host key association save')
    assert.equal(await evaluate(`document.getElementById('host-direct-key').hidden`), true)
    await evaluate(`document.getElementById('connect').click()`)
    await until(() => evaluate(`document.getElementById('session-state').className === 'connected'`), 'SSH authentication using Keychain ID')
    await paste('keychain-authenticated')
    await until(() => evaluate(`${visibleText}.includes('echo:keychain-authenticated')`), 'Keychain-authenticated SSH terminal echo')
    await evaluate(`document.querySelector('.session-tab.is-active [data-tab-close]').click(); document.getElementById('nav-keychain').click()`)
    await until(() => evaluate(`document.querySelectorAll('.keychain-card').length === 1`), 'saved key list')
    await window.loadURL(url.href)
    await until(() => evaluate('document.getElementById("status").textContent === "就绪"'), 'reload after Keychain authentication')
    await evaluate(`document.getElementById('nav-keychain').click()`)
    await until(() => evaluate(`document.getElementById('keychain-list').getAttribute('aria-busy') === 'false'`), 'refreshed Keychain')
    assert.equal(await evaluate(`document.querySelectorAll('.keychain-card').length`), 0)
    await evaluate(`document.getElementById('nav-hosts').click(); document.querySelector('.host-row [data-act=edit]').click()`)
    assert.equal(await evaluate(`document.getElementById('host-keychain').value`), '')
    console.log('[WEB-KEYCHAIN] file import, public-key derivation, host reference, real SSH echo and refresh cleanup succeeded')
    code = 0
  } catch (error) {
    console.error('[WEB-SMOKE-FAIL]', error)
  } finally {
    window?.destroy()
    console.log(code === 0 ? '[WEB-SMOKE-OK]' : '[WEB-SMOKE-FAIL]')
    app.exit(code)
  }
}

void main()

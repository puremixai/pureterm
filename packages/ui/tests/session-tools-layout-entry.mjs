// 真实样式布局夹具的隔离入口。
//
// Chromium 在这里只是一个测浏览器：没有 preload、没有 Host、没有 Electron IPC 载体。
// 页面是构建出来的 packages/ui/dist/index.html（真 CSS、真字体），只有应用脚本被换成
// 了 session-tools-layout.browser.ts 的 bundle。
//
// 视口由入口设置：函数只读 window.innerWidth 判断宽窄，所以每次调用前先把内容区调
// 到目标尺寸，并等渲染进程真的报出这个尺寸。
import { app, BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'

// 断言要命中 820/821 这条断点，所以内容区必须落在精确的 CSS 像素上。分数缩放会让
// setContentSize(821, 600) 落到 822，因此把设备缩放固定成 1。
app.commandLine.appendSwitch('force-device-scale-factor', '1')

mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 821, height: 600 },
  { width: 820, height: 600 },
  { width: 800, height: 600 },
  { width: 640, height: 480 },
  { width: 620, height: 760 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]
// 每个视口都跑一遍深色英文；移动端补齐浅色，宽屏和窄屏再补齐另一种语言。
const CASES = [
  ...VIEWPORTS.map(viewport => ({ ...viewport, theme: 'dark', locale: 'en' })),
  { width: 1280, height: 800, theme: 'light', locale: 'en' },
  { width: 1280, height: 800, theme: 'dark', locale: 'zh' },
  { width: 1280, height: 800, theme: 'light', locale: 'zh' },
  { width: 800, height: 600, theme: 'light', locale: 'en' },
  { width: 800, height: 600, theme: 'dark', locale: 'zh' },
  { width: 820, height: 600, theme: 'light', locale: 'en' },
  { width: 620, height: 760, theme: 'light', locale: 'en' },
  { width: 390, height: 844, theme: 'light', locale: 'en' },
  { width: 360, height: 800, theme: 'light', locale: 'en' },
]

let window
async function resizeViewport(width, height) {
  window.setContentSize(width, height)
  const sized = await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (window.innerWidth === ${width} && window.innerHeight === ${height}) return { ok: true };
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return { ok: false, width: window.innerWidth, height: window.innerHeight };
  })()`)
  if (!sized.ok) throw new Error(`content viewport never reached ${width}x${height}, stayed at ${sized.width}x${sized.height}`)
}

async function main() {
  try {
    await app.whenReady()
    window = new BrowserWindow({ show: false, width: 1280, height: 800, focusable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    window.webContents.on('console-message', event => console.log('[SESSION-TOOLS-RENDERER] ' + event.message))
    let total = 0
    // The same document and connected Client cross the breakpoint twice.
    // Reloading for each size cannot expose stale inline split tracks or focus loss.
    await window.loadFile(process.env.PURETERM_LAYOUT_TEST_HTML)
    await resizeViewport(1280, 800)
    try {
      const record = checks => {
        for (const check of checks) {
          console.log(`[SESSION-TOOLS-LAYOUT] ${check}`)
          total += 1
        }
      }
      const pointerDown = async () => {
        const point = await window.webContents.executeJavaScript('window.sessionToolsLiveDragTarget()')
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
        window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        record(await window.webContents.executeJavaScript("window.checkSessionToolsLiveDrag('captured')"))
        return point
      }
      record(await window.webContents.executeJavaScript('window.startSessionToolsLiveResizeChecks()'))
      const oldAxis = await pointerDown()
      await resizeViewport(800, 600)
      const staleMove = { x: oldAxis.x + 80, y: oldAxis.y }
      window.webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftbuttondown'], ...staleMove })
      record(await window.webContents.executeJavaScript("window.checkSessionToolsLiveDrag('cancelled')"))
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...staleMove })
      record(await window.webContents.executeJavaScript('window.checkSessionToolsLiveResize()'))
      const newAxis = await pointerDown()
      const freshMove = { x: newAxis.x, y: newAxis.y + 40 }
      window.webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftbuttondown'], ...freshMove })
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...freshMove })
      record(await window.webContents.executeJavaScript("window.checkSessionToolsLiveDrag('moved')"))
      record(await window.webContents.executeJavaScript('window.checkSessionToolsLiveResize()'))
      await resizeViewport(1280, 800)
      record(await window.webContents.executeJavaScript('window.checkSessionToolsLiveResize()'))
    } finally {
      await window.webContents.executeJavaScript('window.disposeSessionToolsLiveResize()')
    }
    for (const testCase of CASES) {
      // 每个用例都重新加载一次页面。夹具是按 id 找元素的，一个文档里连着挂多个客户端
      // 会把上一个用例留下的类名、失败文案和焦点带进下一个用例 —— 本地字宽下看不出来，
      // 换一套字体度量就会让几何断言在第二个用例上翻车。真实应用每次都是从空文档启动的。
      await window.loadFile(process.env.PURETERM_LAYOUT_TEST_HTML)
      await resizeViewport(testCase.width, testCase.height)
      const checks = await window.webContents.executeJavaScript(
        `window.runSessionToolsLayoutChecks(${JSON.stringify({ theme: testCase.theme, locale: testCase.locale })})`)
      for (const check of checks) console.log(`[SESSION-TOOLS-LAYOUT] ${testCase.width}x${testCase.height} ${testCase.theme}/${testCase.locale} ${check}`)
      total += checks.length
    }
    console.log(`[SESSION-TOOLS-LAYOUT] ${total} measurements across ${CASES.length} viewport, theme and language cases plus one live resize sequence`)
    console.log('[SMOKE-OK] styled terminal tools layout')
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error('[SMOKE-FAIL]', error)
    window?.destroy()
    app.exit(1)
  }
}
void main()

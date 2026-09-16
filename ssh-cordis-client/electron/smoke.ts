import { app, type BrowserWindow } from 'electron'

interface SmokeReport {
  preload: string
  sessionId: string | null
  openedSize: { cols: number; rows: number } | null
  text: string
  replacementChars: number
  closedReason: string | null
  error: string | null
}

/**
 * 只用于验证链路：真窗口 + 真 preload + 真渲染进程 + 真 SSH 连接。
 * 由 test/smoke-electron.mjs 启动（它负责起一个本地假 SSH 服务）。
 */
export async function runSmokeTest(window: BrowserWindow): Promise<void> {
  const config = {
    host: process.env.SSH_CORDIS_SMOKE_HOST ?? '127.0.0.1',
    port: Number(process.env.SSH_CORDIS_SMOKE_PORT ?? '2222'),
    username: process.env.SSH_CORDIS_SMOKE_USER ?? 'demo',
    password: process.env.SSH_CORDIS_SMOKE_PASS ?? 'demo',
  }

  let code = 1
  try {
    await new Promise<void>((resolve) => {
      if (!window.webContents.isLoading()) resolve()
      else window.webContents.once('did-finish-load', () => resolve())
    })

    const preloadType = (await window.webContents.executeJavaScript('typeof window.sshAPI')) as string
    const report = (await window.webContents.executeJavaScript(
      `window.__smoke.run(${JSON.stringify(config)})`,
    )) as SmokeReport

    const ok =
      preloadType === 'object' &&
      !!report.sessionId &&
      !report.error &&
      report.replacementChars === 0 &&
      report.text.includes('你好，世界') &&
      report.text.includes('echo:ls') &&
      !!report.closedReason &&
      report.openedSize?.cols === 100 &&
      report.openedSize?.rows === 30

    console.log('[SMOKE] ' + JSON.stringify({ preloadType, ...report }))
    console.log(ok ? '[SMOKE-OK]' : '[SMOKE-FAIL]')
    code = ok ? 0 : 1
  } catch (error) {
    console.error('[SMOKE-ERROR]', error)
  }

  // 留出时间把 stdout 刷出去
  setTimeout(() => app.exit(code), 300)
}

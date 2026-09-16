import { BrowserWindow, type WebContents } from 'electron'
import { pathToFileURL } from 'node:url'

/*
 * ElectronShellGeneration —— 一代窗口。
 *
 * 照 dsh 的 ElectronShellGeneration：BrowserWindow、它的**全部**监听器、加载看门狗、
 * 导航限制、外部链接处理，都由同一个对象独占；释放只能走一个地方——幂等的 release()。
 *
 * 为什么非要这么切：以前这些散在 main.ts 的 createWindow() 里，
 * 监听器挂在 window/webContents 上、看门狗挂在模块变量上。一旦真的创建了第二代
 * （macOS 上关掉窗口再点 Dock 就会走 app.on('activate') → createWindow()），
 * 上一代的监听器没人摘、看门狗没人清，就会留一堆指向已销毁窗口的闭包。
 * 单个窗口的 app 上不会立刻出事，所以这种泄漏最容易一路藏到线上。
 *
 * 约束（dsh 的 generation 规则）：窗口对象、Service 引用都不许跨 generation 缓存。
 * 调用方每次要用窗口，都从当前 generation 上取（见 main.ts 的 currentWindow()）。
 *
 * 这一代**不决定**加载失败之后怎么办：由 onLoadFailure 回调交出去。
 * 换配置重启是进程级决策，不该塞进窗口的生命周期里。
 */

/** 页面多久还没加载出来，就认定「这个环境起不了渲染进程」 */
export const LOAD_WATCHDOG_MS = 20_000

export interface ShellGenerationOptions {
  htmlPath: string
  preloadPath: string
  /** 传给 loadFile 的 query，例如 'smoke=1' */
  search?: string
  /** 页面没能起来（超时 / 加载失败 / 渲染进程崩溃）。只在「还没加载完」时触发。 */
  onLoadFailure(reason: string): void
  /** HTML 解析完成时通知一声。注意这**不等于**应用可用。 */
  onLoaded?(): void
  onRelease?(): void
}

export interface ElectronShellGeneration {
  /** 只用于日志，方便分辨「哪一代」出的问题 */
  readonly id: number
  readonly window: BrowserWindow
  /** did-finish-load 是否发生过 */
  readonly loaded: boolean
  readonly released: boolean
  /** 幂等释放：摘掉所有监听器、清掉看门狗、销毁窗口。重复调用是空操作。 */
  release(): void
}

let generationCounter = 0

export function createShellGeneration(options: ShellGenerationOptions): ElectronShellGeneration {
  const id = ++generationCounter
  const window = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 720,
    minHeight: 420,
    backgroundColor: '#12151b',
    show: true,
    title: 'SSH Cordis Client',
    webPreferences: {
      preload: options.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      // 保住沙箱：preload 因此必须编成 CJS（见 electron/carriers/preload.ts 顶部说明）
      sandbox: true,
      spellcheck: false,
    },
  })

  const disposers: Array<() => void> = []
  /*
   * 统一登记、统一摘除。不留「记得在某处 removeListener」这种靠人自觉的东西。
   *
   * 这里的两次放宽都是刻意的：
   * - 监听器签名用 any[]：Electron 的 on() 是重载的（每个事件名一个签名），
   *   想用一个辅助函数覆盖所有事件类型，只能让参数在边界上放宽，再在回调里自己收窄。
   * - 事件名用 string：同理，没法在辅助函数签名里穷举事件名联合类型，于是把
   *   WebContents | BrowserWindow 放宽成一个最小的结构化接口。类型安全由「调用点紧挨着」保证。
   */
  type AnyEmitter = {
    on(event: string, listener: (...args: any[]) => void): unknown
    removeListener(event: string, listener: (...args: any[]) => void): unknown
  }
  const on = (emitter: WebContents | BrowserWindow, event: string, listener: (...args: any[]) => void): void => {
    const target = emitter as unknown as AnyEmitter
    target.on(event, listener)
    disposers.push(() => target.removeListener(event, listener))
  }

  let loaded = false
  let released = false
  let watchdog: NodeJS.Timeout | undefined
  const clearWatchdog = (): void => {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = undefined
    }
  }

  // 导航限制：终端输出里的链接、拖进来的本地 HTML 文件，都不许把这个窗口导航走。
  // 只允许停在渲染层自己的那份 HTML 上（带 query 也算同一份）。
  const allowedUrl = pathToFileURL(options.htmlPath)
  on(window.webContents, 'will-navigate', (event: Electron.Event, url: string) => {
    let target: URL | undefined
    try {
      target = new URL(url)
    } catch {
      target = undefined
    }
    const samePage = !!target && target.protocol === allowedUrl.protocol && target.pathname === allowedUrl.pathname
    if (samePage) return
    event.preventDefault()
    console.warn(`[shell#${id}] 已拦截窗口导航：${url}`)
  })

  // 外部链接一律不放行：本应用没有任何合法的「新窗口」用途
  window.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[shell#${id}] 已拦截新窗口请求：${url}`)
    return { action: 'deny' }
  })

  // 禁掉窗口级缩放。Ctrl +/- 会改 zoomFactor，xterm 的字体度量随之变化，
  // FitAddon 算出来的 cols/rows 就不再等于真实可视区域，远端排版会错位。
  void window.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
    /* 有些平台不支持，不影响功能 */
  })
  on(window.webContents, 'zoom-changed', (event: Electron.Event) => {
    event.preventDefault()
  })

  // 有些环境不是崩溃而是直接挂死，下面两个事件都不来。兜一个超时。
  watchdog = setTimeout(() => {
    if (loaded || released) return
    options.onLoadFailure(`页面在 ${LOAD_WATCHDOG_MS / 1000} 秒内没有加载完成`)
  }, LOAD_WATCHDOG_MS)

  on(window.webContents, 'did-finish-load', () => {
    loaded = true
    clearWatchdog()
    console.log(`[shell#${id}] 渲染层已加载（HTML 解析完成，不代表应用可用）`)
    options.onLoaded?.()
  })

  on(window.webContents, 'did-fail-load', (_event: Electron.Event, code: number, description: string, _url: string, isMainFrame: boolean) => {
    // -3 = ERR_ABORTED，正常的导航取消，不算失败
    if (!isMainFrame || code === -3) return
    console.error(`[shell#${id}] 页面加载失败：${code} ${description}`)
    if (!loaded) options.onLoadFailure(`${code} ${description}`)
  })

  on(window.webContents, 'render-process-gone', (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
    console.error(`[shell#${id}] 渲染进程退出：${details.reason}（exitCode=${details.exitCode}）`)
    if (!loaded) options.onLoadFailure(`渲染进程退出：${details.reason}`)
    else release()
  })

  // 窗口被关掉就自动释放这一代；调用方不需要记得手动清理
  on(window, 'closed', () => {
    release()
  })

  function release(): void {
    if (released) return
    released = true
    options.onRelease?.()
    clearWatchdog()
    while (disposers.length) {
      try {
        disposers.pop()?.()
      } catch {
        /* 释放阶段的异常不该阻断剩下的一起释放 */
      }
    }
    if (!window.isDestroyed()) window.destroy()
  }

  const search = options.search ?? ''
  void window.loadFile(options.htmlPath, search ? { search } : undefined).catch((error: unknown) => {
    // loadFile 自己失败（路径不对之类）也必须走同一条出口，别让它变成未处理拒绝
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[shell#${id}] loadFile 失败：${message}`)
    if (!loaded && !released) options.onLoadFailure(`loadFile 失败：${message}`)
  })

  return {
    id,
    window,
    get loaded(): boolean {
      return loaded
    },
    get released(): boolean {
      return released
    },
    release,
  }
}

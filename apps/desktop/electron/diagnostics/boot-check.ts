import { writeFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import type { RendererReadyPayload } from '../runtime/readiness.js'

/*
 * 启动自检收尾。
 *
 * launcher-private：这是壳层自己用的工具，不属于任何公共契约（对应 dsh 里
 * desktopRuntime / desktopPnpmBootstrap 那类「启动器内部细节，不导出」的东西）。
 *
 * 判据是主窗口经最小 Desktop IPC 上报的 desktop:renderer-ready，
 * 不是 did-finish-load。就绪上报意味着 WebSocket 已连接 Host、
 * xterm 挂上了、主机列表拉回来了；页面加载只说明 HTML 解析完成。
 */

export interface BootCheckOptions {
  enabled: boolean
  /** 取当前 generation 的窗口（截图用）。已释放/已销毁时返回 undefined。 */
  getWindow(): BrowserWindow | undefined
  /** 截图落盘位置；不设就只验证、不截图 */
  screenshotPath?: string
  /** 就绪之后到超时的宽限：晚于「页面加载看门狗」，别让两者同时报错，只留一个声音 */
  timeoutMs: number
  exit(code: number): void
}

export interface BootCheck {
  /** 启动后立刻布防：到点还没收到就绪信号就判失败退出 */
  arm(): void
  /** 收到渲染层「应用真的起来了」上报。只有第一次生效。 */
  finish(info: RendererReadyPayload): Promise<void>
  cancel(): void
}

/** 等一帧，让 xterm 把首屏画出来 */
const SETTLE_BEFORE_SHOT_MS = 400

export function createBootCheck(options: BootCheckOptions): BootCheck {
  let watchdog: NodeJS.Timeout | undefined
  let finished = false

  const cancel = (): void => {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = undefined
    }
  }

  return {
    arm() {
      if (!options.enabled || watchdog) return
      watchdog = setTimeout(() => {
        watchdog = undefined
        console.error(`[boot] 超时：${options.timeoutMs / 1000} 秒内没收到渲染层的就绪上报。`)
        console.log('[BOOT-FAIL]')
        options.exit(1)
      }, options.timeoutMs)
    },

    async finish(info) {
      if (!options.enabled || finished) return
      finished = true
      cancel()

      const shotPath = options.screenshotPath
      const window = options.getWindow()
      if (info.ok && shotPath && window && !window.isDestroyed()) {
        try {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_BEFORE_SHOT_MS))
          const image = await window.webContents.capturePage()
          writeFileSync(shotPath, image.toPNG())
          console.log(`[boot] 已截图窗口内容：${shotPath}`)
        } catch (error) {
          console.error('[boot] 截图失败:', error)
        }
      }

      console.log(info.ok ? '[BOOT-OK]' : '[BOOT-FAIL]')
      options.exit(info.ok ? 0 : 1)
    },

    cancel,
  }
}

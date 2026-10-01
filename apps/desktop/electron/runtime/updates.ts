import type { MessageKey, MessageParams } from '@pureterm/i18n'
import type { ShutdownDecision } from '@pureterm/protocol'

export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error'
export interface UpdateBackend {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent: boolean, forceRunAfter: boolean): void
}

/** 异常 → 给人看的一句细节。只取 `message`：`String(new Error('x'))` 会多带一个 `Error: `。 */
const detailOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Electron 无关的更新协调器。安装永远等 Host 停稳。
 *
 * 它**不认语言**：每句要说的话都以目录键 + 参数交给 `message`，由桌面适配器
 * 在弹框那一刻用当前语言说出来。协调器只管「什么时候该说哪一句」。
 *
 * 准备安装是**一次**调用：`prepareInstall(version)` 既负责确认（带版本与中断事实），
 * 也负责停 Host，返回 `ShutdownDecision`。只有 intent 相同且 `ready`（也就是 Host
 * 已经 graceful 停稳）才交给 `quitAndInstall`；取消、busy、准备失败都**保留**已下载的
 * 更新、保持当前 Host 可用，绝不把「准备失败」当成「安装失败」。
 */
export function createUpdateCoordinator(options: {
  backend: UpdateBackend
  enabled: boolean
  unavailableReason?: MessageKey
  prepareInstall(version: string): Promise<ShutdownDecision>
  onInstallError?(): void | Promise<void>
  message(key: MessageKey, params?: MessageParams): void | Promise<void>
  onState?(phase: UpdatePhase, detail?: string): void
  initialDelayMs?: number
  intervalMs?: number
}) {
  const backend = options.backend
  backend.autoDownload = true
  backend.autoInstallOnAppQuit = false
  let disposed = false
  let phase: UpdatePhase = options.enabled ? 'idle' : 'disabled'
  let version = ''
  let checking: Promise<void> | undefined
  let installing: Promise<void> | undefined
  let recovering: Promise<void> | undefined
  let manualCheck = false
  let cancelDownload: (() => void) | undefined
  const subscriptions: Array<() => void> = []
  const setState = (state: UpdatePhase, detail?: string) => {
    if (disposed) return
    phase = state
    options.onState?.(state, detail)
  }
  const on = (event: string, handler: (...args: any[]) => void) => {
    backend.on(event, handler)
    subscriptions.push(() => { backend.removeListener(event, handler) })
  }
  const message = (key: MessageKey, params?: MessageParams) => Promise.resolve(options.message(key, params)).catch(error => console.error('[updates]', error))
  const installFailed = (error: unknown): Promise<void> => {
    if (recovering) return recovering
    setState('error', String(error))
    recovering = Promise.resolve().then(async () => {
      await message('desktop.update.install-failed', { detail: detailOf(error) })
      if (!disposed) await options.onInstallError?.()
    }).catch(error => console.error('[updates] Recovery failed:', error))
    return recovering
  }
  function install(): Promise<void> {
    if (installing) return installing
    if (disposed || phase !== 'downloaded') return Promise.resolve()
    recovering = undefined
    const requested = version
    installing = Promise.resolve().then(async () => {
      let decision: ShutdownDecision
      try {
        decision = await options.prepareInstall(requested)
      } catch (error) {
        // 准备阶段的异常是「没准备好」，不是「安装失败」：保留下载，不触发恢复。
        console.error('[updates] install preparation failed:', error)
        if (!disposed && version === requested) setState('downloaded', version)
        return
      }
      // 迟到的答复什么也不许装：协调器可能已被释放，或更新的下载已取代这一次。
      if (disposed) return
      if (version !== requested) { setState('downloaded', version); return }
      if (decision.intent !== 'update' || decision.status !== 'ready') {
        console.log(`[updates] install not prepared (${decision.status}); the download is kept and the Host stays usable.`)
        return
      }
      setState('installing')
      backend.quitAndInstall(false, true)
    }).catch(installFailed).finally(() => { installing = undefined })
    return installing
  }
  if (options.enabled) {
    on('update-available', (info: { version: string }) => { version = info.version; setState('downloading', version) })
    on('update-not-available', () => setState('idle'))
    on('download-progress', (info: { percent: number }) => setState('downloading', `${Math.round(info.percent)}%`))
    on('update-downloaded', (info: { version: string }) => {
      version = info.version
      setState('downloaded', version)
      void install()
    })
    on('error', (error: Error) => {
      if (phase === 'installing') void installFailed(error)
      else setState('error', error.message)
    })
  }
  function check(manual = false): Promise<void> {
    if (disposed) return Promise.resolve()
    if (!options.enabled) return manual ? message(options.unavailableReason ?? 'desktop.update.unavailable') : Promise.resolve()
    if (phase === 'downloaded') return manual ? install() : Promise.resolve()
    if (phase === 'installing') return Promise.resolve()
    if (checking) { manualCheck ||= manual; return checking }
    if (phase === 'downloading') return manual ? message('desktop.update.downloading-then-install', { version }) : Promise.resolve()
    manualCheck = manual
    checking = Promise.resolve().then(async () => {
      setState('checking')
      const result = await backend.checkForUpdates() as {
        downloadPromise?: Promise<unknown> | null
        cancellationToken?: { cancel(): void }
      } | null
      if (result?.downloadPromise) {
        const requestedManually = manualCheck
        cancelDownload = () => result.cancellationToken?.cancel()
        void result.downloadPromise.catch(async error => {
          setState('error', String(error))
          if (!disposed && requestedManually) await message('desktop.update.download-failed', { detail: detailOf(error) })
        }).finally(() => { cancelDownload = undefined })
        if (disposed) cancelDownload?.()
      }
      if (disposed || !manualCheck) return
      if (phase === 'idle' || phase === 'checking') await message('desktop.update.up-to-date')
      else if (phase === 'downloading') await message('desktop.update.downloading', { version })
    }).catch(async error => {
      setState('error', String(error))
      if (!disposed && manualCheck) await message('desktop.update.check-failed', { detail: detailOf(error) })
    }).finally(() => { checking = undefined; manualCheck = false })
    return checking
  }
  const initial = options.enabled ? setTimeout(() => { void check() }, options.initialDelayMs ?? 15_000) : undefined
  const interval = options.enabled ? setInterval(() => { void check() }, options.intervalMs ?? 6 * 60 * 60 * 1000) : undefined
  initial?.unref(); interval?.unref()
  return {
    get phase() { return phase },
    check,
    install,
    dispose() {
      if (disposed) return
      disposed = true
      cancelDownload?.()
      clearTimeout(initial); clearInterval(interval)
      for (const dispose of subscriptions.splice(0)) dispose()
    },
  }
}

export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error'
export interface UpdateBackend {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent: boolean, forceRunAfter: boolean): void
}

/** Electron-independent coordinator. Installing always waits for the Host to stop. */
export function createUpdateCoordinator(options: {
  backend: UpdateBackend
  enabled: boolean
  unavailableReason?: string
  beforeInstall(): Promise<void>
  onInstallError?(): void | Promise<void>
  confirmInstall(version: string): Promise<boolean>
  message(message: string): void | Promise<void>
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
  const message = (text: string) => Promise.resolve(options.message(text)).catch(error => console.error('[updates]', error))
  const installFailed = (error: unknown): Promise<void> => {
    if (recovering) return recovering
    setState('error', String(error))
    recovering = Promise.resolve().then(async () => {
      await message(`安装更新失败：${error instanceof Error ? error.message : String(error)}`)
      if (!disposed) await options.onInstallError?.()
    }).catch(error => console.error('[updates] Recovery failed:', error))
    return recovering
  }
  function install(): Promise<void> {
    if (installing) return installing
    if (disposed || phase !== 'downloaded') return Promise.resolve()
    recovering = undefined
    installing = Promise.resolve().then(async () => {
      if (!await options.confirmInstall(version) || disposed) return
      setState('installing')
      await options.beforeInstall()
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
    if (!options.enabled) return manual ? message(options.unavailableReason ?? '此运行方式不支持自动更新。') : Promise.resolve()
    if (phase === 'downloaded') return manual ? install() : Promise.resolve()
    if (phase === 'installing') return Promise.resolve()
    if (checking) { manualCheck ||= manual; return checking }
    if (phase === 'downloading') return manual ? message(`正在下载 PureTerm ${version}，下载完成后会提示安装。`) : Promise.resolve()
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
          if (!disposed && requestedManually) await message(`下载更新失败：${error instanceof Error ? error.message : String(error)}`)
        }).finally(() => { cancelDownload = undefined })
        if (disposed) cancelDownload?.()
      }
      if (disposed || !manualCheck) return
      if (phase === 'idle' || phase === 'checking') await message('当前已是最新版本。')
      else if (phase === 'downloading') await message(`正在下载 PureTerm ${version}。`)
    }).catch(async error => {
      setState('error', String(error))
      if (!disposed && manualCheck) await message(`检查更新失败：${error instanceof Error ? error.message : String(error)}`)
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

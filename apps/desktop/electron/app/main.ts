import { app, dialog, ipcMain, protocol, safeStorage, session, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { DESKTOP_CHANNELS, HostError, toWireError, type PickedPrivateKey, type RendererReadyPayload, type ShutdownDecision } from '@pureterm/protocol'
import { isLocale, setLocale, t } from '@pureterm/i18n'
import type { CredentialProvider } from '@pureterm/host'
import { createBootCheck } from '../diagnostics/boot-check.js'
import { normalizeReadyPayload } from '@pureterm/transport/readiness'
import { authorizeDesktopSocket, DESKTOP_PAGE, serveWebDocument } from '../runtime/web-document.js'
import { startHostProcess, HostStartupError, type DesktopHostProcess, type HostProcessFailure } from '../runtime/host-process.js'
import { writeHostCrashReport, type HostFailurePhase, type HostFailureReport } from '../runtime/crash-report.js'
import { createFatalRecoveryCoordinator, type FatalRecoveryCoordinator } from '../runtime/fatal-recovery.js'
import { createDesktopUpdates } from './updates.js'
import {
  LAUNCH_PROFILE_VERSION,
  describeLaunchProfile,
  launchProfileDisabled,
  launchProfilePath,
  planProfileSwitches,
  readLaunchProfile,
  writeLaunchProfile,
  type LaunchProfile,
} from '../runtime/launch-profile.js'
import { collectSwitches } from '../runtime/platform-plan.js'
import { applyApplicationMenu, selectPlatformStrategy } from './platform.js'
import { createReadinessGate } from '../runtime/readiness.js'
import { relaunchSelf } from '../runtime/relaunch.js'
import { createShellGeneration, LOAD_WATCHDOG_MS, type ElectronShellGeneration } from './shell.js'
import { resolveDesktopPaths } from '../runtime/paths.js'
import { claimDesktopSingleInstance } from '../runtime/single-instance.js'
import { bindDesktopProfile, DesktopProfileError, sameDesktopProfilePath } from '../runtime/desktop-profile.js'
import { createShutdownCoordinator, type ShutdownConfirmation } from '../runtime/shutdown.js'
import { installDesktopShortcuts, narrowShortcutContext } from './shortcuts.js'

/*
 * Electron 入口拥有窗口、平台能力、资源协议和更新协调。
 * Node 子进程运行与独立 Web 相同的 HTTP/WS Host。
 * SSH/SFTP 业务从所有客户端直接走 WebSocket；私有 RPC 只传平台能力和进程控制。
 * 启动、窗口更替、故障、诊断退出和安装更新都走统一生命周期。
 */

const { rendererDir, preloadScript, hostEntry } = resolveDesktopPaths()
protocol.registerSchemesAsPrivileged([{ scheme: 'pureterm-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }])
const dataDir = process.env.SSH_CORDIS_DATA_DIR ? resolve(process.env.SSH_CORDIS_DATA_DIR) : join(homedir(), '.ssh-cordis')

const bootCheckEnabled = process.env.SSH_CORDIS_BOOT_CHECK === '1'
const profileDisabled = launchProfileDisabled(process.env)
const webCarrierDisabled = process.env.SSH_CORDIS_NO_WEB_CARRIER === '1'
// Installed-package checks use the same isolated Chromium profile as source checks.
if ((bootCheckEnabled || process.env.SSH_CORDIS_SMOKE) && process.env.SSH_CORDIS_TEST_USER_DATA) {
  mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
  app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
  if (process.env.SSH_CORDIS_TEST_HIDE_WINDOW === '1') app.on('browser-window-created', (_event, window) => {
    window.hide()
    window.on('show', () => window.hide())
  })
}

// ─────────────────────────── 单实例与数据目录归属（必须早于档案/凭据/Host/窗口） ───────────────────────────

/**
 * 第二个实例要么聚焦既有窗口，要么被告知它请求的是另一个数据目录。
 * 它**绝不**切换正在运行的 Host——两个 Desktop 进程同时写一份 SSH 目录是数据损坏，
 * 而「切换」在语义上等于把正在跑的会话连同归属一起换掉。
 */
let pendingFocus = false
function focusOwnerWindow(): void {
  const window = currentWindow()
  if (!window) {
    // 启动还没走到窗口那一步：记下来，等窗口建好再聚焦（见 startGeneration）。
    pendingFocus = true
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
function handleSecondInstance(requestedDataDir: string): void {
  if (!sameDesktopProfilePath(requestedDataDir, dataDir)) {
    dialog.showErrorBox(
      t('desktop.second-instance.title'),
      t('desktop.second-instance.other-dir', { dataDir: requestedDataDir }),
    )
    return
  }
  focusOwnerWindow()
}

const ownsInstance = claimDesktopSingleInstance(app, dataDir, handleSecondInstance)
let startupAllowed = ownsInstance

if (!ownsInstance) {
  console.log('[main] another PureTerm instance already owns this profile; this launch exits without starting a Host.')
}

/*
 * 绑定要在读档案、建凭据、开 Host、建窗口**之前**做完，而且必须失败即停：
 * 归属记录一旦与当前 userData 不符，继续启动就是两个进程写同一份 store。
 */
if (ownsInstance) {
  try {
    bindDesktopProfile(dataDir, app.getPath('userData'))
  } catch (error) {
    const code = error instanceof DesktopProfileError ? error.code : 'profile-io'
    const detail = error instanceof Error ? error.message : String(error)
    const body = code === 'profile-mismatch'
      ? t('desktop.profile.mismatch.body', { dataDir, detail })
      : t('desktop.profile.invalid.body', { dataDir, detail })
    console.error(`[main] refusing to start: ${detail}`)
    dialog.showErrorBox(t('desktop.profile.title'), body)
    app.quit()
    startupAllowed = false
  }
}

// ─────────────────────────── 启动决策（必须早于任何窗口创建） ───────────────────────────

const launchProfileFile = launchProfilePath(dataDir)
const storedProfile = profileDisabled ? undefined : readLaunchProfile(launchProfileFile)

/*
 * 启动档案的回填要在选平台策略**之前**做：这样策略会把「--no-sandbox」当成
 * 命令行上本来就有的开关，不会重复追加，日志里也能如实说明它从哪来。
 */
const profileSwitches = planProfileSwitches({
  profile: storedProfile,
  existingSwitches: collectSwitches((name) => app.commandLine.hasSwitch(name)),
  env: process.env,
})
for (const name of profileSwitches) app.commandLine.appendSwitch(name)

/** 平台差异在这里选一次，之后全项目只读（electron/runtime/platform-plan.ts 里有决策的纯逻辑） */
const platform = selectPlatformStrategy()

if (profileDisabled) {
  console.log('[main] SSH_CORDIS_NO_LAUNCH_PROFILE=1: skipping launch-profile reads and writes this run.')
} else if (storedProfile) {
  console.log(`[main] launch profile: ${describeLaunchProfile(storedProfile)}`)
} else {
  console.log('[main] no usable launch profile (first run, or the file is corrupt / version-mismatched).')
}

if (profileSwitches.length) {
  console.warn(
    [
      `[main] the profile says this machine last came up with "${profileSwitches.map((name) => `--${name}`).join(' ')}"; adding it up front,`,
      '[main] which skips the "fail once, then restart automatically" round. The cost is that OS-level process',
      '[main] isolation is relaxed — the renderer still has contextIsolation + nodeIntegration:false + the',
      '[main] preload allowlist.',
      '[main] Set SSH_CORDIS_NO_LAUNCH_PROFILE=1 to take the full path every time.',
    ].join('\n'),
  )
}

// ─────────────────────────── 状态 ───────────────────────────

let shell: ElectronShellGeneration | null = null
let host: DesktopHostProcess | null = null
let hostStarting: Promise<DesktopHostProcess> | undefined
let disposing = false
let bridgeInstalled = false
let shutdownTask: Promise<void> | undefined
let updates: ReturnType<typeof createDesktopUpdates> | undefined
let sandboxFallbackTried = false
// 当前这一代窗口的原生快捷键适配器；跨 generation 不许复用。
let desktopShortcuts: ReturnType<typeof installDesktopShortcuts> | undefined
// 一次被批准的退出：允许随后的 app.quit() 直接通过，不再重复问用户。
let quitCommitted = false
// 正在进行的受保护退出。同一个请求只问一次、只停一次 Host。
let quitTask: Promise<void> | undefined

/**
 * 退出前的唯一确认点。原生对话框的文字来自目录（主进程知道当前语言），
 * Cancel 是默认且取消按钮——「继续退出」必须是用户主动选的那一个。
 *
 * 隔离的 Electron 验收用一个环境变量回答，免得隐藏窗口里弹出一个没人点的原生框。
 * 它只在测试启动器里设置，正常启动永不设置。
 */
async function confirmShutdown(request: ShutdownConfirmation): Promise<boolean> {
  const override = process.env.SSH_CORDIS_QUIT_CONFIRM
  if (override === 'accept') return true
  if (override === 'cancel') return false
  const window = currentWindow()
  // 没有窗口可挂对话框：这是无人值守的退出（渲染进程崩溃、启动失败、诊断运行）。
  // 此时做有界清理就好，绝不弹一个没人能点的原生模态框。
  if (!window) return true
  const title = request.intent === 'update'
    ? t('desktop.shutdown.update-title', { version: request.version ?? '' })
    : t('desktop.shutdown.title')
  const body = request.phase === 'unknown'
    ? t('desktop.shutdown.unknown')
    : t('desktop.shutdown.body', {
        sessions: String(request.activity?.activeSessions ?? 0),
        connections: String(request.activity?.pendingConnections ?? 0),
        files: String(request.activity?.pendingFileOperations ?? 0),
        changes: String(request.activity?.pendingMutations ?? 0),
      })
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title,
    message: title,
    detail: body,
    buttons: [t('desktop.shutdown.cancel'), request.phase === 'force' ? t('desktop.shutdown.force-confirm') : t('desktop.shutdown.confirm')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const result = await dialog.showMessageBox(window, options)
  return result.response === 1
}

const shutdownCoordinator = createShutdownCoordinator({
  getHost: () => host ?? undefined,
  getGeneration: () => shell?.id,
  confirm: confirmShutdown,
  onFailure: (error, phase) => {
    console.error(`[main] shutdown preparation failed during ${phase}:`, error)
  },
})

/** 把子进程的进程事实补齐成一份可落盘的诊断记录：版本、时间、平台、阶段。 */
function hostFailureReport(phase: HostFailurePhase, failure: HostProcessFailure): HostFailureReport {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    phase,
    reason: failure.reason,
    ...(failure.pid === undefined ? {} : { pid: failure.pid }),
    exitCode: failure.exitCode,
    signal: failure.signal,
  }
}

/**
 * Host 故障之后的唯一恢复点。
 *
 * 隔离验收用 `SSH_CORDIS_RECOVERY_CHOICE` 回答，和退出确认同一个套路：隐藏窗口里
 * 不该弹出一个没人能点的原生模态框。正常启动永不设置它。
 *
 * 清理走的就是普通退出那条 shutdown()：它停 Host、摘监听、释放这一代，因此重启
 * 起来的新进程面对的是一个干净的数据目录。清理**先于**重启/退出，顺序由协调器保证。
 */
const fatalRecovery: FatalRecoveryCoordinator = createFatalRecoveryCoordinator({
  record: report => writeHostCrashReport(join(app.getPath('userData'), 'diagnostics', 'host'), report),
  choose: (report, reportPath) => {
    const override = process.env.SSH_CORDIS_RECOVERY_CHOICE
    if (override === 'restart') return Promise.resolve('restart')
    if (override === 'quit') return Promise.resolve('quit')
    // 无人值守的收尾（诊断运行、启动检查、渲染进程崩溃后的清理）不弹框。
    if (disposing || bootCheckEnabled || process.env.SSH_CORDIS_SMOKE) return Promise.resolve('quit')
    const window = currentWindow()
    if (!window) return Promise.resolve('quit')
    const title = t('desktop.host-stopped.title')
    const choice = dialog.showMessageBoxSync(window, {
      type: 'error',
      title,
      message: title,
      detail: [
        t('desktop.host-stopped.body'),
        reportPath ? t('desktop.host-stopped.report', { path: reportPath }) : t('desktop.host-stopped.no-report'),
        t('desktop.host-stopped.detail', { reason: report.reason, exit: report.signal ?? String(report.exitCode) }),
      ].join('\n\n'),
      buttons: [t('desktop.host-stopped.quit'), t('desktop.host-stopped.restart')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return Promise.resolve(choice === 1 ? 'restart' : 'quit')
  },
  cleanup: () => shutdown(),
  // app.relaunch() 把重启排到退出之后；app.exit() 才真的让它发生，并保证新进程继承
  // 同一份启动参数（数据目录、开关、profile）。
  relaunch: () => {
    console.log('[main] restarting after a Host failure')
    app.relaunch()
  },
  exit: code => app.exit(code),
})

/**
 * 一次 Host 故障的入口。三条路（exit/disconnect/close）会各报一次，协调器只认第一次。
 * 在它做任何决定之前，先把在途的退出准备和这一代的快捷键适配器作废：这一代已经完了，
 * 不能再让它替我们停 Host 或执行命令。
 */
function handleHostFailure(phase: HostFailurePhase, failure: HostProcessFailure): void {
  shutdownCoordinator.dispose()
  desktopShortcuts?.dispose()
  desktopShortcuts = undefined
  void fatalRecovery.handle(hostFailureReport(phase, failure))
}

/**
 * 受保护的普通退出。关窗、菜单退出、Cmd+Q 都走这里：
 * 先让协调器检查活动、必要时问用户、停 Host，得到 ready 才提交 app.quit()。
 * 取消或失败则什么都不做——窗口、WebSocket、会话原样留着。
 */
function requestOrdinaryQuit(): Promise<void> {
  if (quitTask) return quitTask
  quitTask = shutdownCoordinator.prepare('quit').then(async (decision) => {
    if (decision.status === 'ready') {
      // 清理放在这里而不是交给 will-quit：一次 preventDefault 后只再 app.quit() 一次，
      // 避免 before-quit 和 will-quit 各自 preventDefault 造成「退不出去」的嵌套。
      await shutdown()
      quitCommitted = true
      app.quit()
      return
    }
    // 取消 / busy / 失败：留着窗口，下一次关闭再问。
    quitTask = undefined
    console.log(`[main] ordinary quit not committed (${decision.status}); the application stays open.`)
  }).catch((error: unknown) => {
    quitTask = undefined
    console.error('[main] ordinary quit preparation threw:', error)
  })
  return quitTask
}

/**
 * 更新安装前的准备：走和普通退出**同一条**协调器，只是 intent 是 'update'。
 * 只有 graceful 停稳（ready）才提交清理并关掉普通退出守卫，随后由更新协调器调用
 * quitAndInstall。取消 / busy / 失败一律保留下载、保持当前 Host 可用。
 */
async function prepareInstall(version: string): Promise<ShutdownDecision> {
  const decision = await shutdownCoordinator.prepare('update', version)
  if (decision.status === 'ready') {
    // 保留 updater（quitAndInstall 还要用它），提交其余清理并让后续 app.quit() 直接通过。
    await shutdown(true)
    quitCommitted = true
  } else {
    console.log(`[main] update install not prepared (${decision.status}); keeping the download and the running Host.`)
  }
  return decision
}

/**
 * 菜单里「检查更新…」的动作。
 *
 * 单独提出来是因为菜单要按语言重建：重建发生在渲染层上报语言之后，那时
 * bootstrap() 里那一次调用早就返回了，回调必须活得比它久。
 */
const checkUpdates = (): void => { void updates?.check(true) }

/**
 * 就绪闸门：想在「应用真能用」之后做的事，必须注册到这里。
 * 目前唯一的使用者是启动档案的提交（见下面 handleReady）。
 */
const readiness = createReadinessGate()

const bootCheck = createBootCheck({
  enabled: bootCheckEnabled,
  getWindow: () => currentWindow(),
  screenshotPath: process.env.SSH_CORDIS_BOOT_SHOT,
  // 比页面加载看门狗晚一步：先让 generation 去报「页面没加载完」，别两个声音同时响
  timeoutMs: LOAD_WATCHDOG_MS + 5_000,
  exit: (code) => { void exitApplication(code) },
})

// 绝不静默：任何漏网的异常都要留下痕迹
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})
process.on('uncaughtException', (error) => {
  console.error('[main] uncaughtException:', error)
})

// ─────────────────────────── 纪律：状态只在表面就绪之后才提交 ───────────────────────────

readiness.onReady((info) => {
  if (profileDisabled) return
  const profile: LaunchProfile = {
    version: LAUNCH_PROFILE_VERSION,
    switches: collectSwitches((name) => app.commandLine.hasSwitch(name)).map((name) => `--${name}`),
    sandboxWeakened: app.commandLine.hasSwitch('no-sandbox'),
    renderer: { cols: info.cols, rows: info.rows },
    hosts: info.hosts,
    savedAt: new Date().toISOString(),
  }
  try {
    writeLaunchProfile(launchProfileFile, profile)
    console.log(`[main] launch profile updated (written only after the surface confirmed usable): ${launchProfileFile}`)
  } catch (error) {
    // 写档案失败不该影响运行：它只是加速手段
    console.error('[main] could not write the launch profile (this run is unaffected):', error)
  }
})

/**
 * 渲染层上报「我真的起来了」。这是闸门唯一的输入源。
 *
 * **只认当前桌面主 frame 的上报**：闸门问的是「这个应用启动成功了吗」，
 * 而应用是那个 Electron 窗口。浏览器客户端（Web 载体）上报的尺寸、主机数是它自己那半边的状态，
 * 拿来解锁「提交启动档案」「跑启动自检截图」都是错的——
 * 一个浏览器标签页不该决定桌面应用算不算启动成功。
 */
function handleReady(payload: RendererReadyPayload): void {
  // 先打日志再进闸门：闸门的动作是同步执行的（比如提交启动档案），
  // 顺序反过来的话，「档案已更新」会出现在「收到上报」前面，读日志的人会懵。
  console.log(`[main] renderer-ready report: ${JSON.stringify(payload)}`)
  const result = readiness.report(payload)
  if (!result.accepted) {
    console.log('[main] report ignored (the gate is already open).')
    return
  }
  if (!result.ready) {
    console.log(`[main] gate stays closed: the renderer reported itself unusable (${payload.error ?? 'no reason given'}).`)
    return
  }
  console.log('[main] gate open: actions registered on the gate now run.')
  void bootCheck.finish(payload)
}

// ─────────────────────────── shell generation ───────────────────────────

/** 当前这一代的窗口。跨 generation 缓存的窗口对象一律不算数，要用就从这里现取。 */
function currentWindow(): BrowserWindow | undefined {
  if (!shell || shell.released) return undefined
  return shell.window.isDestroyed() ? undefined : shell.window
}

/**
 * 起新的一代。**先把上一代释放干净**——
 * 窗口、监听器、看门狗都不许跨 generation 存活（dsh 的 generation 规则）。
 */
function startGeneration(): ElectronShellGeneration {
  shell?.release()
  const generation = createShellGeneration({
    pageUrl: DESKTOP_PAGE,
    preloadPath: preloadScript,
    autoHideMenuBar: platform.autoHideMenuBar,
    search: process.env.SSH_CORDIS_SMOKE ? 'smoke=1' : '',
    onLoadFailure: (reason) => fallbackToNoSandbox(reason),
    /*
     * Windows/Linux：关最后一个窗口等于退出应用，所以先接管这次关闭，走受保护的退出。
     * macOS：关窗只释放这一代（页面及其 WebSocket 会话随之断开），Host 继续活着，
     * 所以直接放行——Cmd+Q / 菜单退出另有应用级守卫。
     */
    onCloseRequested: () => {
      if (platform.quitOnAllWindowsClosed === false) return true
      if (quitCommitted || disposing) return true
      void requestOrdinaryQuit()
      return false
    },
    onRelease: () => { desktopShortcuts?.dispose(); desktopShortcuts = undefined },
  })
  shell = generation
  // 原生快捷键适配器绑定这一代窗口；上一代已在 release() 里摘掉，不会跨代残留。
  desktopShortcuts = installDesktopShortcuts(generation.window, platform.platform === 'darwin' ? 'mac' : 'other')
  console.log(`[main] created shell generation #${generation.id}`)
  // 第二次启动可能在窗口存在之前就到了；那时 focusOwnerWindow 只记了标记。
  if (pendingFocus) {
    pendingFocus = false
    focusOwnerWindow()
  }
  return generation
}

/**
 * 受限容器（CI、无 user namespace、被宿主沙箱包裹的环境）里 Chromium 的**进程沙箱**
 * 会初始化失败，窗口永远出不来。麻烦的是它的表象是 GPU 崩溃——
 * `GPU process exited unexpectedly` → `FATAL: GPU process isn't usable. Goodbye.`
 * ——因为 GPU 进程本身也在沙箱里跑，所以极易被误判成「没有显卡」，
 * 然后一直在 --disable-gpu 这个错误方向上折腾。
 *
 * 这里不等用户猜：一旦发现页面在渲染进程起来之前就失败，就自动以 --no-sandbox 重启一次。
 * 只重启一次（sandboxFallbackTried 兜底），避免死循环。
 */
function fallbackToNoSandbox(reason: string): void {
  if (sandboxFallbackTried) return
  if (app.commandLine.hasSwitch('no-sandbox')) return
  if (process.env.SSH_CORDIS_DISABLE_SANDBOX === '1') return
  if (process.env.SSH_CORDIS_NO_SANDBOX_FALLBACK === '1') return
  sandboxFallbackTried = true

  console.error(
    [
      `[main] the renderer process would not start (${reason}).`,
      "[main] The usual cause is that Chromium's process sandbox cannot initialize in this restricted environment;",
      '[main] note that a GPU process crash is often just its symptom, not a graphics problem.',
      '[main] Restarting once with --no-sandbox: the renderer still has contextIsolation + nodeIntegration:false +',
      '[main] the preload allowlist, but OS-level process isolation is gone.',
      '[main] Set SSH_CORDIS_NO_SANDBOX_FALLBACK=1 to turn the automatic restart off.',
    ].join('\n'),
  )

  // 子进程由 relaunchSelf 负责到底：只有它真的起来了才退当前进程。
  // 起了新的却留下旧的、或者两个都没了，都是不能接受的。
  relaunchSelf({
    switches: ['--no-sandbox'],
    onSuccess: (child) => {
      child.unref()
      void exitApplication(0)
    },
    onFailure: (error) => {
      console.error(
        [
          `[main] automatic restart failed: ${error.message}`,
          '[main] the current process keeps running (the window may be empty). Retry by hand:',
          '[main]   electron dist/electron/app/main.js --no-sandbox',
        ].join('\n'),
      )
    },
  })
}

// ─────────────────────────── 凭据（平台能力，不属于任何载体） ───────────────────────────

/**
 * 加解密归**这台机器**（Windows DPAPI / macOS Keychain），不归哪条通道，
 * 所以它是壳层注入给所有载体的共用实现：拿不到系统密钥就返回 undefined，
 * 由上层决定「不保存」，绝不退化成明文落盘。
 *
 * `credentialPersistence` 报的是实测结果而不是平台名。没有 keyring 的 Linux
 * 上 `safeStorage` 会退到 `basic_text` 后端，那是明文，等于没有加密；此时上报
 * `'session'` 才对——否则界面会照常给出「记住凭据」，而写入必然失败。
 */
function createCredentials(): CredentialProvider {
  const encryptionAvailable = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable()
        && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    } catch {
      return false
    }
  }

  return {
    persistent: true,
    // 惰性求值：系统密钥可能在进程活着的期间才变得可用（例如 keyring 稍后解锁），
    // 所以这里报的是「此刻」，不是构造那一刻。
    get credentialPersistence() { return encryptionAvailable() ? 'encrypted' : 'session' },
    seal: (plain) => (encryptionAvailable() ? safeStorage.encryptString(plain).toString('base64') : undefined),
    unseal: (sealed) => {
      if (!encryptionAvailable()) return undefined
      try {
        return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
      } catch {
        return undefined
      }
    },
  }
}

// ─────────────────────────── 选私钥文件 ───────────────────────────

/**
 * 弹对话框选私钥文件。
 *
 * 为什么这件事必须在主进程做：渲染层是 nodeIntegration:false，本来就读不了文件；
 * 而且我们要的只是**路径**——私钥内容在连接那一刻由 ssh 服务现读，
 * 既不经渲染层转手，也不落我们自己的盘。
 *
 * 顺手看一眼这把钥匙的形态（是不是私钥、有没有口令），
 * 让界面能提前提示「这把有口令」，而不是等连接失败再回来猜。
 *
 * 两个载体共用它：Web 载体下用户也是在自己的浏览器里点「选择…」，
 * 但对话框弹在**运行后端这台机器**上（因为它要给的正是这台机器上的路径）。
 */
async function pickPrivateKey(clientId: string): Promise<PickedPrivateKey | undefined> {
  // The child validates that this WebSocket client remains alive around the dialog.
  // All clients now use the same carrier; bind the native dialog to an available shell.
  const parent = currentWindow()

  const dialogOptions: Electron.OpenDialogOptions = {
    title: t('desktop.pick-key.title'),
    defaultPath: join(homedir(), '.ssh'),
    // 不设 filters：私钥常常没有扩展名（id_ed25519），加了过滤器反而看不见
    properties: ['openFile', 'showHiddenFiles'],
  }
  const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
  if (result.canceled || !result.filePaths.length) return undefined

  const path = result.filePaths[0]
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    // 失败以**码**回渲染层：这句话要在渲染层用当前语言说出来，主进程不知道是哪门语言
    return { path, error: toWireError(new HostError('ssh.key-file-unreadable',
      { path, reason: (error as NodeJS.ErrnoException).code ?? 'unknown' }, `read ${path}: ${(error as Error).message}`)) }
  }

  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(content)) {
    return { path, error: toWireError(new HostError('ssh.key-unrecognized')) }
  }
  // OpenSSH 新格式的加密私钥带 kdf/bcrypt 标记；老 PEM 格式的头部含 ENCRYPTED
  const encrypted = /ENCRYPTED|bcrypt|kdf/i.test(content)
  return { path, encrypted }
}

// ─────────────────────────── 语言 ───────────────────────────

/**
 * 渲染层报来它此刻显示的语言。
 *
 * 偏好归渲染层：只有它有那个开关，也只有它存着（localStorage 主进程读不到）。
 * 主进程这边另有一批要看语言的界面 —— 应用菜单、原生选私钥对话框、更新对话框 ——
 * 所以由渲染层上报。
 *
 * 收到之后**立刻重建菜单**：菜单是这一侧唯一常驻可见的文字，晚一步重建就会留下
 * 一个和页面说着不同语言的菜单。启动到上报之间菜单是英文，与「英文是目录的源语言」
 * 一致。
 *
 * 值来自边界之外，所以先收窄再采信：收不窄就当没这回事，不改语言也不重建菜单。
 */
function applyLocale(locale: unknown): void {
  if (!isLocale(locale)) return
  setLocale(locale)
  applyApplicationMenu(checkUpdates)
}

function assertApplicationSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const window = currentWindow()
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected Desktop request from an unowned frame')
  }
  const url = new URL(event.senderFrame.url)
  if (url.protocol !== 'pureterm-app:' || url.host !== 'app' || url.pathname !== '/') {
    throw new Error('Rejected Desktop request from an unexpected document')
  }
}

/** Only bootstrap and readiness cross renderer IPC; business traffic uses the shared Web Host. */
function installDesktopBridge(): void {
  bridgeInstalled = true
  protocol.handle('pureterm-app', request => serveWebDocument(request, rendererDir))
  ipcMain.handle(DESKTOP_CHANNELS.bootstrap, async event => {
    assertApplicationSender(event)
    const backend = await hostStarting
    assertApplicationSender(event)
    if (!backend || disposing) throw new Error('Desktop Host is unavailable')
    const url = new URL('/ws', backend.url)
    url.protocol = 'ws:'
    return { webSocketUrl: url.href }
  })
  ipcMain.on(DESKTOP_CHANNELS.ready, (event, payload: unknown) => {
    try { assertApplicationSender(event); handleReady(normalizeReadyPayload(payload)) }
    catch (error) { console.error('[main] rejected renderer-ready report:', error instanceof Error ? error.message : String(error)) }
  })
  ipcMain.on(DESKTOP_CHANNELS.locale, (event, locale: unknown) => {
    try { assertApplicationSender(event); applyLocale(locale) }
    catch (error) { console.error('[main] rejected locale report:', error instanceof Error ? error.message : String(error)) }
  })
  // 快捷键上下文来自渲染层，但只有**当前窗口的主 frame** 报的才算数：一个浏览器标签页
  // 或别的 frame 不该决定桌面应用哪些快捷键可用。形状不合法就整份丢弃。
  ipcMain.on(DESKTOP_CHANNELS.shortcutContext, (event, context: unknown) => {
    try {
      assertApplicationSender(event)
      const narrowed = narrowShortcutContext(context)
      if (narrowed) desktopShortcuts?.reportContext(narrowed)
    } catch (error) { console.error('[main] rejected shortcut context report:', error instanceof Error ? error.message : String(error)) }
  })
  // The top bar draws its own minimize/maximize/close, so these three are the
  // only window commands in the app. Each one re-reads currentWindow() rather
  // than closing over a window: a generation swap between the click and the
  // command must not move a destroyed window.
  const windowCommand = (channel: string, act: (window: BrowserWindow) => void): void => {
    ipcMain.on(channel, event => {
      try {
        assertApplicationSender(event)
        const window = currentWindow()
        if (window) act(window)
      } catch (error) { console.error('[main] rejected window command:', error instanceof Error ? error.message : String(error)) }
    })
  }
  windowCommand(DESKTOP_CHANNELS.windowMinimize, window => window.minimize())
  // One channel for both directions: which of maximize/restore applies is the
  // window's own state, and only this side can read it.
  windowCommand(DESKTOP_CHANNELS.windowToggleMaximize, window => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  windowCommand(DESKTOP_CHANNELS.windowClose, window => window.close())
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    const window = currentWindow()
    callback(authorizeDesktopSocket({ ...details, isMainFrame: !!window && details.frame === window.webContents.mainFrame }, host && window ? {
      webContentsId: window.webContents.id, hostUrl: host.url, desktopToken: host.desktopToken,
    } : undefined))
  })
}

// ─────────────────────────── 启动 / 退出 ───────────────────────────

async function bootstrap(): Promise<void> {
  // 丢锁的实例、或归属校验失败的实例：绝不建 Host、绝不建窗口。
  if (!startupAllowed) return
  installDesktopBridge()
  hostStarting = startHostProcess({
    entry: hostEntry,
    dataDir,
    credentials: createCredentials(),
    pickPrivateKey,
    browserAccess: !webCarrierDisabled,
    onExit: (error, failure) => {
      console.error('[main] Host child exited unexpectedly:', error)
      handleHostFailure('runtime', failure)
    },
  })
  const generation = startGeneration()
  bootCheck.arm()
  try {
    host = await hostStarting
  } catch (error) {
    // 启动期失败发生在 onExit 生效之前，所以它只能靠抛出来。交给同一个恢复点，
    // 而不是在这里直接退出：用户该有同样的「重启 / 退出」选择。
    if (error instanceof HostStartupError) {
      console.error('[main] Host failed to start:', error.message)
      handleHostFailure('startup', error.failure)
      return
    }
    throw error
  }
  if (disposing) return
  if (webCarrierDisabled) console.log('[main] the plain-browser entry is disabled; Desktop uses its internal Web Host.')
  else console.log(`[main] carrier ready: web (browser entry ${host.url})`)
  updates = createDesktopUpdates(prepareInstall, async () => {
    // Some platforms report installation failures asynchronously after quitAndInstall.
    // Keep the updater alive until then and restart the current version after the error dialog.
    app.relaunch()
    await exitApplication(1)
  })
  applyApplicationMenu(checkUpdates)
  console.log(`[main] Host child ready pid=${host.pid} parent=${process.pid}. Data directory: ${dataDir}`)

  if (app.commandLine.hasSwitch('no-sandbox')) {
    console.warn('[main] running with --no-sandbox: the Chromium process sandbox is off (renderer isolation is not).')
  }

  if (process.env.SSH_CORDIS_SMOKE === '1') {
    const { runSmokeTest } = await import('../diagnostics/smoke.js')
    await runSmokeTest(generation.window, code => { void exitApplication(code) })
  }
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[main] startup failed:', error)
  void exitApplication(1)
})

app.on('activate', () => {
  // macOS：关掉窗口后再点 Dock 图标 → 起新的一代（旧的那代已经被 release 了）
  if (host && !disposing && !currentWindow()) startGeneration()
})

app.on('window-all-closed', () => {
  if (!disposing && platform.quitOnAllWindowsClosed) app.quit()
})

/*
 * 应用级退出守卫。macOS 的 Cmd+Q / 菜单退出、以及任何 app.quit() 都会先到这里。
 * 它和窗口关闭守卫共用同一个 requestOrdinaryQuit()，所以两条路只会问一次、停一次。
 * `quitCommitted` 让被批准的那次 app.quit() 直接通过；`will-quit` 才是真正的清理。
 */
app.on('before-quit', (event) => {
  if (quitCommitted || disposing) return
  event.preventDefault()
  void requestOrdinaryQuit()
})

// Release the page and bootstrap handlers, then stop the child Web Host before exiting.
app.on('will-quit', (event) => {
  if (disposing && !host) return
  event.preventDefault()
  void shutdown().catch(error => console.error('[main] shutdown cleanup failed:', error)).finally(() => app.quit())
})

// 真正退出之后，恢复协调器不再有下一句话可说。放在这里而不是 shutdown()：清理本身
// 是恢复流程的一步，在它中途把协调器释放掉，重启那一步就会被自己取消。
app.on('quit', () => fatalRecovery.dispose())

function shutdown(preserveUpdater = false): Promise<void> {
  if (!preserveUpdater) updates?.dispose()
  if (shutdownTask) return shutdownTask
  disposing = true
  // 提交退出决策：协调器不再保留「已 ready」的结果，也不再接受新的准备请求。
  shutdownCoordinator.dispose()
  shutdownTask = Promise.resolve().then(async () => {
    shell?.release()
    shell = null
    bootCheck.cancel()
    ipcMain.removeHandler(DESKTOP_CHANNELS.bootstrap)
    ipcMain.removeAllListeners(DESKTOP_CHANNELS.ready)
    for (const channel of [DESKTOP_CHANNELS.locale, DESKTOP_CHANNELS.shortcutContext, DESKTOP_CHANNELS.windowMinimize, DESKTOP_CHANNELS.windowToggleMaximize, DESKTOP_CHANNELS.windowClose]) {
      ipcMain.removeAllListeners(channel)
    }
    session.defaultSession.webRequest.onBeforeSendHeaders(null)
    if (bridgeInstalled) {
      bridgeInstalled = false
      protocol.unhandle('pureterm-app')
    }
    try {
      const pending = host ?? await hostStarting?.catch(() => undefined)
      await pending?.dispose()
    } catch (error) {
      console.error('[main] could not dispose the Host:', error)
      throw error
    } finally {
      host = null
    }
    console.log('[main] Host stopped; exiting.')
  })
  return shutdownTask
}

async function exitApplication(code: number): Promise<void> {
  try { await shutdown() }
  finally { app.exit(code) }
}

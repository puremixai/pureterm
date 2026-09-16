import { app, dialog, safeStorage, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { PickedPrivateKey, RendererReadyPayload } from '@pureterm/protocol'
import { createHost, type Host, type CredentialProvider } from '@pureterm/host'
import { createBootCheck } from '../diagnostics/boot-check.js'
import { createCompositeBridge, type Carrier } from '@pureterm/transport/carrier'
import { createHttpCarrier } from '@pureterm/transport/carrier-http'
import { createIpcCarrier, ipcClientId } from '../carriers/carrier-ipc.js'
import { createDispatcher } from '@pureterm/transport/dispatch'
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
import { applyApplicationMenu, platformStrategy, selectPlatformStrategy } from './platform.js'
import { createReadinessGate } from '../runtime/readiness.js'
import { relaunchSelf } from '../runtime/relaunch.js'
import { createShellGeneration, LOAD_WATCHDOG_MS, type ElectronShellGeneration } from './shell.js'
import { resolveDesktopPaths } from '../runtime/paths.js'

/*
 * Electron 壳。职责只有四件：
 *   1. 启动前把配置定下来（平台策略 + 启动档案）
 *   2. 拥有 shell generation（窗口的生命周期）
 *   3. 装配**载体**，把渲染层的往来转给 Cordis 宿主
 *   4. 退出时按顺序收尾
 *
 * 这里**没有**任何 SSH 逻辑，也没有 dsh 那套 agent 平面。
 * 具体实现分别落在 platform*.ts / shell.ts / readiness.ts / launch-profile.ts / relaunch.ts，
 * 那些是「怎么做」，本文件只负责「按什么顺序做」。
 *
 * ── 关于「载体」─────────────────────────────────────────────────
 * 「渲染层」不等于「Electron 的窗口」。渲染层与宿主之间隔着一个协议（shared/protocol.ts），
 * 谁把它搬运过去就是载体（carrier）：
 *   - carrier-ipc.ts：桌面端默认，ipcMain ↔ preload，客户端 id `ipc:<webContentsId>`
 *   - carrier-http.ts：本机 HTTP + WebSocket，浏览器直接打开同一个产物，客户端 id `ws:<id>`
 * 两个同时活着，共用**同一个** dispatcher（electron/bridge/dispatch.ts）和同一棵插件树。
 * 加第二个载体时 `src/` 一行都没改——这是「解耦」是否成真的判据。
 */

const { rendererDir, rendererHtml, preloadScript } = resolveDesktopPaths()
const dataDir = process.env.SSH_CORDIS_DATA_DIR ? resolve(process.env.SSH_CORDIS_DATA_DIR) : join(homedir(), '.ssh-cordis')

const bootCheckEnabled = process.env.SSH_CORDIS_BOOT_CHECK === '1'
const profileDisabled = launchProfileDisabled(process.env)
const webCarrierDisabled = process.env.SSH_CORDIS_NO_WEB_CARRIER === '1'

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
  console.log('[main] SSH_CORDIS_NO_LAUNCH_PROFILE=1：本次不读也不写启动档案。')
} else if (storedProfile) {
  console.log(`[main] 读到启动档案：${describeLaunchProfile(storedProfile)}`)
} else {
  console.log('[main] 没有可用的启动档案（首次运行，或档案损坏/版本不符）。')
}

if (profileSwitches.length) {
  console.warn(
    [
      `[main] 档案显示这台机器上次是靠「${profileSwitches.map((name) => `--${name}`).join(' ')}」起来的，本次启动前直接带上，`,
      '[main] 省掉「先失败一次、再自动重启一轮」。代价是操作系统级的进程隔离被放宽了——',
      '[main] 渲染层仍有 contextIsolation + nodeIntegration:false + preload 白名单三重隔离。',
      '[main] 想每次都走完整流程请设 SSH_CORDIS_NO_LAUNCH_PROFILE=1。',
    ].join('\n'),
  )
}

// ─────────────────────────── 状态 ───────────────────────────

let shell: ElectronShellGeneration | null = null
let host: Host | null = null
let carriers: Carrier[] = []
let disposing = false
let sandboxFallbackTried = false

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
  exit: (code) => app.exit(code),
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
    console.log(`[main] 启动档案已更新（表面确认可用之后才写）：${launchProfileFile}`)
  } catch (error) {
    // 写档案失败不该影响运行：它只是加速手段
    console.error('[main] 启动档案写入失败（不影响本次运行）:', error)
  }
})

/**
 * 渲染层上报「我真的起来了」。这是闸门唯一的输入源。
 *
 * **只认 IPC 载体的上报**：闸门问的是「这个应用启动成功了吗」，
 * 而应用是那个 Electron 窗口。浏览器客户端（Web 载体）上报的尺寸、主机数是它自己那半边的状态，
 * 拿来解锁「提交启动档案」「跑启动自检截图」都是错的——
 * 一个浏览器标签页不该决定桌面应用算不算启动成功。
 */
function handleReady(payload: RendererReadyPayload, clientId: string): void {
  const window = currentWindow()
  const fromEmbeddedRenderer = !!window && !window.isDestroyed() && clientId === ipcClientId(window.webContents.id)
  if (!fromEmbeddedRenderer) {
    console.log(`[main] 忽略来自 ${clientId} 的就绪上报（闸门只认窗口里的渲染层）。`)
    return
  }

  // 先打日志再进闸门：闸门的动作是同步执行的（比如提交启动档案），
  // 顺序反过来的话，「档案已更新」会出现在「收到上报」前面，读日志的人会懵。
  console.log(`[main] 渲染层就绪上报：${JSON.stringify(payload)}`)
  const result = readiness.report(payload)
  if (!result.accepted) {
    console.log('[main] 该上报被忽略（闸门已经开过了）。')
    return
  }
  if (!result.ready) {
    console.log(`[main] 闸门保持关闭：渲染层报告自己不可用（${payload.error ?? '未给出原因'}）。`)
    return
  }
  console.log('[main] 闸门已打开：注册在闸门上的动作现在执行。')
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
    htmlPath: rendererHtml,
    preloadPath: preloadScript,
    search: process.env.SSH_CORDIS_SMOKE ? 'smoke=1' : '',
    onLoadFailure: (reason) => fallbackToNoSandbox(reason),
  })
  shell = generation
  console.log(`[main] 已创建 shell generation #${generation.id}`)
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
      `[main] 渲染进程起不来（${reason}）。`,
      '[main] 最常见的原因是 Chromium 的进程沙箱在当前受限环境里无法初始化；',
      '[main] 注意 GPU 进程崩溃往往只是它的表象，别误判成显卡问题。',
      '[main] 将以 --no-sandbox 重启一次：渲染层仍有 contextIsolation + nodeIntegration:false +',
      '[main] preload 白名单三重隔离，但少了操作系统级的进程隔离。',
      '[main] 不想自动重启请设 SSH_CORDIS_NO_SANDBOX_FALLBACK=1。',
    ].join('\n'),
  )

  // 子进程由 relaunchSelf 负责到底：只有它真的起来了才退当前进程。
  // 起了新的却留下旧的、或者两个都没了，都是不能接受的。
  relaunchSelf({
    switches: ['--no-sandbox'],
    onSuccess: (child) => {
      child.unref()
      app.exit(0)
    },
    onFailure: (error) => {
      console.error(
        [
          `[main] 自动重启失败：${error.message}`,
          '[main] 当前进程继续运行（窗口可能是空的）。可以手动重试：',
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
 */
function createCredentials(): CredentialProvider {
  const encryptionAvailable = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  return {
    persistent: true,
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
  const window = currentWindow()
  // 只有窗口里的渲染层才把对话框挂到窗口上；浏览器客户端没有可挂的窗口，
  // 这时用无父窗口的对话框（否则一个后台标签页会让模态框把整个窗口锁住）
  const parent =
    window && !window.isDestroyed() && clientId === ipcClientId(window.webContents.id) ? window : undefined

  const dialogOptions: Electron.OpenDialogOptions = {
    title: '选择私钥文件',
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
    return { path, error: `读不到这个文件：${(error as Error).message}` }
  }

  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(content)) {
    return { path, error: '这个文件看起来不是私钥（没有找到 PRIVATE KEY 头）。' }
  }
  // OpenSSH 新格式的加密私钥带 kdf/bcrypt 标记；老 PEM 格式的头部含 ENCRYPTED
  const encrypted = /ENCRYPTED|bcrypt|kdf/i.test(content)
  return { path, encrypted }
}

// ─────────────────────────── 装配载体 ───────────────────────────

/**
 * 载体在这里按顺序装起来。顺序其实只有一处讲究：
 * **桥要先于宿主存在**，而载体要等 dispatcher（它依赖宿主）才能建。
 * 所以桥拿到的是「取载体列表的函数」而不是列表本身（见 createCompositeBridge）。
 */
async function installCarriers(currentHost: Host): Promise<void> {
  const dispatcher = createDispatcher({ host: currentHost, pickPrivateKey, onReady: handleReady,
    capabilities: { credentialPersistence: 'encrypted', privateKeyPicker: 'native' } })

  carriers.push(createIpcCarrier({ dispatcher, getWindow: currentWindow }))
  console.log('[main] 载体已就绪：ipc（桌面窗口）。')

  if (webCarrierDisabled) {
    console.log('[main] SSH_CORDIS_NO_WEB_CARRIER=1：本次不启动 Web 载体。')
    return
  }

  try {
    const web = await createHttpCarrier({
      onDisconnect: (clientId) => currentHost.releaseClient(clientId),
      dispatcher,
      staticDir: rendererDir,
    })
    carriers.push(web)
    console.log(
      [
        `[main] 载体已就绪：web（浏览器入口 ${web.url}）`,
        `[main]   只监听 127.0.0.1:${web.port}，token 每次启动重新生成。`,
        '[main]   拿到这条地址的人就能操作这台机器上的 SSH 会话——别往外发。',
      ].join('\n'),
    )
  } catch (error) {
    // Web 载体起不来不该影响桌面端：它是并集，不是替代
    console.error(`[main] Web 载体启动失败（桌面端不受影响）: ${(error as Error).message}`)
  }
}

// ─────────────────────────── 启动 / 退出 ───────────────────────────

async function bootstrap(): Promise<void> {
  applyApplicationMenu()
  const generation = startGeneration()

  host = await createHost({
    bridge: createCompositeBridge(() => carriers),
    credentials: createCredentials(),
    hostStoreFile: join(dataDir, 'hosts.json'),
    knownHostsFile: join(dataDir, 'known_hosts.json'),
  })
  await installCarriers(host)
  console.log(`[main] 宿主已就绪。数据目录：${dataDir}`)

  if (app.commandLine.hasSwitch('no-sandbox')) {
    console.warn('[main] 本次以 --no-sandbox 运行：Chromium 进程沙箱已关闭（渲染层隔离仍在）。')
  }

  bootCheck.arm()

  if (process.env.SSH_CORDIS_SMOKE) {
    const { runSmokeTest } = await import('../diagnostics/smoke.js')
    await runSmokeTest(generation.window)
  }
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[main] 启动失败:', error)
  app.exit(1)
})

app.on('activate', () => {
  // macOS：关掉窗口后再点 Dock 图标 → 起新的一代（旧的那代已经被 release 了）
  if (!currentWindow()) startGeneration()
})

app.on('window-all-closed', () => {
  if (platform.quitOnAllWindowsClosed) app.quit()
})

// 退出顺序：释放窗口（摘监听器、停看门狗）→ 卸载体 → 卸插件树（关掉所有 SSH 连接）→ 真退出
app.on('will-quit', (event) => {
  shell?.release()
  shell = null
  if (!host || disposing) return

  event.preventDefault()
  disposing = true
  const pending = host
  host = null
  const closing = carriers
  carriers = []

  // 先卸载体再卸宿主：载体一停就不会再有新的请求进来，
  // 这时去关 SSH 连接才是「收尾」而不是「跟还在跑的请求抢资源」。
  void (async () => {
    for (const carrier of closing) {
      try {
        await carrier.dispose()
      } catch (error) {
        console.error(`[main] 载体 ${carrier.name} 卸载失败:`, error)
      }
    }
    try {
      await pending.dispose()
    } catch (error) {
      console.error('[main] 宿主卸载失败:', error)
    } finally {
      app.quit()
    }
  })()
})

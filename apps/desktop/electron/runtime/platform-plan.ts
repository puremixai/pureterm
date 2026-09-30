/*
 * 平台策略的**纯决策层**。故意不 import electron。
 *
 * 为什么值得单独切一层：dsh 把平台差异收在 ElectronPlatformStrategy 里、
 * 启动时选一次，之后业务代码里不再出现 process.platform。我们照做，
 * 但把「怎么选」和「把选择施加到 app 上」分开写——
 * 前者是纯函数，可以脱离 Electron 单测（见 tests/smoke-desktop.mjs），
 * 后者必须碰 app，只能靠端到端验证。
 *
 * 分工：
 *   platform-plan.ts（本文件）  纯决策：给定 platform / env / 已有开关 → 该追加什么
 *   platform.ts                 施加：appendSwitch / disableHardwareAcceleration / 菜单
 */

/** 我们会关心、并且会读回来的 Chromium 开关。不在这个表里的开关一律不管。 */
export const TRACKED_SWITCHES = [
  'no-sandbox',
  'disable-gpu',
  'disable-gpu-compositing',
  'disable-software-rasterizer',
] as const

/** 无 GPU / 远程桌面 / 虚拟机上 GPU 进程会反复崩溃并让 Electron 直接 FATAL 退出 */
const GPU_SWITCHES = ['disable-gpu', 'disable-gpu-compositing', 'disable-software-rasterizer'] as const

/** 从任意「能回答有没有某个开关」的东西上采集开关。传 app.commandLine 进来即可。 */
export function collectSwitches(has: (name: string) => boolean): string[] {
  return TRACKED_SWITCHES.filter((name) => has(name))
}

/**
 * 顶栏要不要自己画最小化/最大化/关闭。
 *
 * 窗口是 `titleBarStyle: 'hidden'`，所以三平台的差别在于**谁画那三个按钮**：
 * macOS 的红绿灯由系统保留在左上角，顶栏再画一套就是两套；Windows/Linux 的同一个
 * 设置不给任何原生按钮，顶栏不画就没有关窗入口。
 *
 * 这个决定写在纯决策层，而不是渲染层：渲染层只认桥带不带 `windowControls` 这一项，
 * 于是「谁画」只有一个地方回答。preload 拿 process.platform 调它，smoke-desktop.mjs
 * 拿它单测 —— preload 本身在沙箱里，脱离 Electron 测不了。
 */
export function drawsOwnWindowControls(platform: NodeJS.Platform): boolean {
  return platform !== 'darwin'
}

export interface PlatformPlanInput {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** 命令行上**已经存在**的开关（用 collectSwitches 采） */
  existingSwitches?: readonly string[]
}

export interface PlatformPlan {
  platform: NodeJS.Platform
  /** 要在启动时追加的 Chromium 开关（已去重、已剔除命令行上已有的） */
  switches: string[]
  /** 是否关掉硬件加速 */
  disableHardwareAcceleration: boolean
  /** 关掉最后一个窗口后是否退出应用。macOS 习惯是留在 Dock 里，其他平台直接退。 */
  quitOnAllWindowsClosed: boolean
  /** 是否包含 macOS 的 App 菜单（Cmd+Q / Hide / About） */
  includeAppMenu: boolean
  /** Windows/Linux 上菜单保留快捷键能力，但不占用一整行界面。 */
  autoHideMenuBar: boolean
  /** 顶栏是否自绘最小化/最大化/关闭。macOS 由系统画红绿灯，所以是 false。 */
  selfDrawnWindowControls: boolean
  /** 为什么这么选。写进启动日志——环境相关的决定最怕「不知道为什么」。 */
  reasons: string[]
}

export function resolvePlatformPlan(input: PlatformPlanInput): PlatformPlan {
  const existing = new Set(input.existingSwitches ?? [])
  const switches: string[] = []
  const reasons: string[] = []

  const disableHardwareAcceleration = input.env.SSH_CORDIS_DISABLE_GPU === '1'
  if (disableHardwareAcceleration) {
    for (const name of GPU_SWITCHES) switches.push(name)
    reasons.push('SSH_CORDIS_DISABLE_GPU=1 -> disabling hardware acceleration (terminal rendering does not need the GPU)')
  } else if (existing.has('disable-gpu')) {
    reasons.push('the command line already carries --disable-gpu; keeping it and disabling hardware acceleration')
  }

  if (input.env.SSH_CORDIS_DISABLE_SANDBOX === '1') {
    if (existing.has('no-sandbox')) {
      reasons.push('SSH_CORDIS_DISABLE_SANDBOX=1, but the command line already carries --no-sandbox')
    } else {
      switches.push('no-sandbox')
      reasons.push('SSH_CORDIS_DISABLE_SANDBOX=1 -> disabling the Chromium process sandbox')
    }
  }

  const isMac = input.platform === 'darwin'
  reasons.push(
    isMac
      ? 'macOS: stay in the Dock after the last window closes; install the minimal application menu (without it Cmd+C/Cmd+V are dead in the terminal)'
      : 'not macOS: quit when the last window closes; no macOS App menu',
  )
  reasons.push(
    isMac
      ? 'macOS: the system draws the traffic lights in the top-left, so the top bar draws no window buttons'
      : 'not macOS: titleBarStyle:hidden brings no native buttons, so the top bar draws minimize/maximize/close',
  )

  return {
    platform: input.platform,
    // 去重；命令行上已经有的不重复追加（重复 appendSwitch 会让日志骗人）
    switches: [...new Set(switches)].filter((name) => !existing.has(name)),
    // 保守起见：命令行上明确带了 --disable-gpu 时也关掉硬件加速，语义才一致
    disableHardwareAcceleration: disableHardwareAcceleration || existing.has('disable-gpu'),
    quitOnAllWindowsClosed: !isMac,
    includeAppMenu: isMac,
    autoHideMenuBar: !isMac,
    selfDrawnWindowControls: drawsOwnWindowControls(input.platform),
    reasons,
  }
}

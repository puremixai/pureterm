import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/*
 * 启动档案（last-known-good）。
 *
 * 记的是一件事：**这台机器上，上次是哪套 Chromium 配置真的跑起来了**。
 * 有了它，第二次启动就能直接带上正确的开关，不必再「先失败一次、再自动重启一轮」。
 *
 * 纪律（dsh 启动顺序第 7 步）：档案只在**表面加载成功之后**才提交。
 * 提交动作挂在就绪闸门上（见 electron/runtime/readiness.ts），不在窗口创建时写——
 * 否则一个起不来的配置会被记成「可用」，下次启动直接把它当默认值用，越错越深。
 *
 * 纯 fs 操作，不 import electron：可以脱离 Electron 单测。
 */

export const LAUNCH_PROFILE_VERSION = 1

export interface LaunchProfile {
  version: typeof LAUNCH_PROFILE_VERSION
  /** 上次跑起来的开关（带 -- 前缀，给人看的） */
  switches: string[]
  /** 机器可读的那一位：上次是靠放宽进程沙箱跑起来的 */
  sandboxWeakened: boolean
  /** 渲染层回报的实际终端尺寸，用于未来判断「上次窗口是不是正常初始化了」 */
  renderer: { cols: number; rows: number }
  hosts: number
  savedAt: string
}

export function launchProfilePath(dataDir: string): string {
  return join(dataDir, 'launch-profile.json')
}

export function readLaunchProfile(file: string): LaunchProfile | undefined {
  try {
    if (!existsSync(file)) return undefined
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LaunchProfile> | null
    // 版本对不上就当没有：档案是加速手段，不是数据源，没有它也能启动
    if (!parsed || parsed.version !== LAUNCH_PROFILE_VERSION) return undefined
    const renderer = parsed.renderer ?? { cols: 0, rows: 0 }
    return {
      version: LAUNCH_PROFILE_VERSION,
      switches: Array.isArray(parsed.switches) ? parsed.switches.filter((item) => typeof item === 'string') : [],
      sandboxWeakened: parsed.sandboxWeakened === true,
      renderer: { cols: Number(renderer.cols) || 0, rows: Number(renderer.rows) || 0 },
      hosts: Number(parsed.hosts) || 0,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    }
  } catch {
    // 文件损坏按「没有档案」处理，绝不因为一个缓存文件启动不了
    return undefined
  }
}

export function writeLaunchProfile(file: string, profile: LaunchProfile): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(profile, null, 2), { mode: 0o600 })
}

/** 关掉档案的读写（给需要确定性环境的 CI / 测试用：同一次运行里读到上一轮的档案会让结果不可复现） */
export function launchProfileDisabled(env: NodeJS.ProcessEnv): boolean {
  return env.SSH_CORDIS_NO_LAUNCH_PROFILE === '1'
}

export interface PlanProfileSwitchesInput {
  profile: LaunchProfile | undefined
  existingSwitches: readonly string[]
  env: NodeJS.ProcessEnv
}

/**
 * 这次启动前要不要按档案补开关。返回要追加的开关（空数组 = 不动）。
 *
 * 只在档案明确记着「上次是靠放宽沙箱起来的」时才回填，并且要求：
 *   - 命令行上没有 --no-sandbox（有了就是重复）
 *   - 没设 SSH_CORDIS_DISABLE_SANDBOX=1（那是显式带开关，不需要档案帮忙）
 *   - 没设 SSH_CORDIS_NO_SANDBOX_FALLBACK=1（语义就是「不要自动处理沙箱问题」）
 *   - 没设 SSH_CORDIS_NO_LAUNCH_PROFILE=1（完全不读档案）
 *
 * 注意这里**只**回填沙箱这一位。硬件加速之类的开关不进档案回填队列：
 * 那些是用户显式表达的意图，不该被上一次的偶然结果改写。
 */
export function planProfileSwitches(input: PlanProfileSwitchesInput): string[] {
  if (launchProfileDisabled(input.env)) return []
  if (input.env.SSH_CORDIS_DISABLE_SANDBOX === '1') return []
  if (input.env.SSH_CORDIS_NO_SANDBOX_FALLBACK === '1') return []

  const profile = input.profile
  if (!profile?.sandboxWeakened) return []
  if (input.existingSwitches.includes('no-sandbox')) return []

  // 只有这两个开关是「因为这台机器上次起不来」才记下来的，可以安全回填
  if (!profile.switches.includes('--no-sandbox')) return []

  return ['no-sandbox']
}

/** 把档案说成人话，写进启动日志 */
export function describeLaunchProfile(profile: LaunchProfile): string {
  const switches = profile.switches.length ? profile.switches.join(' ') : '(无额外开关)'
  const sandbox = profile.sandboxWeakened ? '放宽了进程沙箱' : '沙箱完好'
  return `${switches}｜${sandbox}｜终端 ${profile.renderer.cols}x${profile.renderer.rows}｜主机 ${profile.hosts} 个｜记录于 ${profile.savedAt || '未知时间'}`
}

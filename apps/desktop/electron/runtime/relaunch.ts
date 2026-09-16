import { spawn, type ChildProcess } from 'node:child_process'

/*
 * 以新配置重启自己，并且**真的管住这个子进程**。
 *
 * 两条纪律：
 *
 * 1. 不用 app.relaunch()。它不让新进程继承 stdio，重启后的日志从终端里消失，
 *    等于把问题藏起来——用户和 CI 都看不到后续发生了什么。
 *
 * 2. 子进程由这里独占，并且只有它**确实起来了**才交出去（dsh 的 subprocess service 思路：
 *    起进程的人负责这棵进程树的死活）。以前是 spawn 完立刻 app.exit(0)：
 *    万一 spawn 自己失败（可执行文件没了、权限不对），结果是
 *    「既没起来新的，又把旧的关了」——用户面前什么都没了，还没有任何输出。
 *    现在的顺序是：等 'spawn' → 宽限期内确认还活着 → 才 onSuccess。
 *
 * 不 import electron：退出行为由调用方通过 onSuccess/onFailure 注入，因此可以单测。
 */

export interface RelaunchOptions {
  /** 追加到当前命令行的开关，例如 ['--no-sandbox'] */
  switches: string[]
  execPath?: string
  /** 默认 process.argv.slice(1)：保留原来的入口脚本和参数 */
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  /**
   * 新进程确认存活后调用。**子进程的所有权在这里交出去**——
   * 生产实现是 child.unref() + app.exit(0)；测试实现可以杀掉它收尾。
   */
  onSuccess(child: ChildProcess): void
  /** 新进程没起来时调用。此时**不退出**，当前进程继续活着，把问题留在可见的位置。 */
  onFailure(error: Error): void
  /** 启动后等多久确认它没有立刻死掉。0 = 不做存活检查。 */
  graceMs?: number
  log?(message: string): void
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export function relaunchSelf(options: RelaunchOptions): void {
  const log = options.log ?? ((message: string) => console.log(message))
  const execPath = options.execPath ?? process.execPath
  const argv = options.argv ?? process.argv.slice(1)
  const graceMs = options.graceMs ?? 400
  const args = [...argv, ...options.switches]

  log(`[relaunch] 准备以「${options.switches.join(' ') || '无开关'}」重启：${execPath} ${args.join(' ')}`)

  let child: ChildProcess
  try {
    child = spawn(execPath, args, {
      // 新进程的输出仍然打在同一个终端 / 管道上：重启不该让日志断掉
      stdio: 'inherit',
      env: options.env ?? process.env,
      // 脱离当前进程组：父进程退出后新进程不会被连带终止
      detached: true,
    })
  } catch (error) {
    options.onFailure(toError(error))
    return
  }

  let settled = false
  const succeed = (): void => {
    if (settled) return
    if (graceMs > 0 && child.exitCode === null && child.signalCode === null) {
      // 宽限期到了还活着，认定为起来了
      settled = true
      options.onSuccess(child)
      return
    }
    if (graceMs > 0) {
      settled = true
      options.onFailure(
        new Error(`新进程启动后立刻退出（exitCode=${child.exitCode ?? 'null'}，signal=${child.signalCode ?? 'null'}）。`),
      )
      return
    }
    settled = true
    options.onSuccess(child)
  }

  child.once('spawn', () => {
    if (graceMs > 0) setTimeout(succeed, graceMs)
    else succeed()
  })

  // 用 on 而不是 once：spawn 之后的 'error'（比如 kill 失败）也要有出口，
  // 否则会变成未处理的 'error' 事件把进程掀掉。
  child.on('error', (error: Error) => {
    if (settled) {
      log(`[relaunch] 新进程后续报错（已交接，仅记录）：${error.message}`)
      return
    }
    settled = true
    options.onFailure(error)
  })
}

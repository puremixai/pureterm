import { spawn, type ChildProcess } from 'node:child_process'

/*
 * 以新配置重启自己，并且**真的管住这个子进程**。
 *
 * 三条纪律：
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
 * 3. 交棒的那一份要**等我们退出再拿单实例锁**（见 waitForHandoff）。任何「先 spawn
 *    新进程、再退出旧进程」的重启都会让新进程抢不到锁、被当成普通第二实例静默让位
 *    ——用户面前同样什么都没剩下，而且一句日志都没有（app.relaunch() 在 Linux 上
 *    就是这么把 Host 故障恢复变成「什么都不剩」的）。
 *
 * 不 import electron：退出行为由调用方通过 onSuccess/onFailure 注入，因此可以单测。
 */

/**
 * 交棒时旧进程留给新进程的环境变量：值是即将退出的那个进程的 pid。
 * 新进程靠它知道「单实例锁现在还在别人手里，但那个人正在退出」。
 */
export const RELAUNCH_HANDOFF_ENV = 'SSH_CORDIS_RELAUNCH_FROM'

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

  log(`[relaunch] about to restart with "${options.switches.join(' ') || 'no switches'}": ${execPath} ${args.join(' ')}`)

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
        new Error(`The new process exited immediately after starting (exitCode=${child.exitCode ?? 'null'}, signal=${child.signalCode ?? 'null'}).`),
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
      log(`[relaunch] the new process reported a later error (already handed over, recording only): ${error.message}`)
      return
    }
    settled = true
    options.onFailure(error)
  })
}

export interface HandoffWaitOptions {
  /** 最多等多久。超时就不等了，照常去抢锁（抢不到就按普通第二实例让位）。 */
  budgetMs?: number
  /** 两次检查之间的间隔。 */
  intervalMs?: number
  /** 判断进程是否还在；默认 `process.kill(pid, 0)`。注入是为了单测。 */
  isAlive?(pid: number): boolean
  now?(): number
  sleep?(ms: number): void
  log?(message: string): void
}

/** `kill(pid, 0)` 只问「还在不在」，不真的发信号；EPERM 说明进程还在，只是我们没权限问。 */
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// 同步睡眠：这条路径必须发生在 Electron 的 ready 之前（见下），不能用 await。
const sleepCell = new Int32Array(new SharedArrayBuffer(4))
function sleepSync(ms: number): void { Atomics.wait(sleepCell, 0, 0, ms) }

/**
 * 等交棒给我们的那个旧进程退出，然后才轮到我们去拿单实例锁。
 *
 * 锁不是「抢」来的，是等它空出来自然拿到的：旧进程一退出，Electron 就释放锁，
 * 新进程的第一次 `requestSingleInstanceLock()` 就能成功。
 *
 * 同步等待是刻意的。它必须发生在读档案、`appendSwitch`、建窗口之前，而 Electron 的
 * `ready` 可能在那之前就到达；阻塞主线程期间消息循环不转，正好保证这些顺序。
 * 超时（默认 5s）不是错误：那说明旧进程没按时退出，我们照常去抢锁，抢不到就让位。
 */
export function waitForHandoff(pid: number, options: HandoffWaitOptions = {}): boolean {
  const budgetMs = options.budgetMs ?? 5_000
  const intervalMs = options.intervalMs ?? 25
  const isAlive = options.isAlive ?? defaultIsAlive
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepSync
  const log = options.log ?? (() => {})
  if (!Number.isInteger(pid) || pid <= 0) return true

  const deadline = now() + budgetMs
  let waited = 0
  while (isAlive(pid)) {
    if (now() >= deadline) {
      log(`[relaunch] the process we are taking over from (pid=${pid}) is still alive after ${waited}ms; trying the lock anyway.`)
      return false
    }
    sleep(intervalMs)
    waited += intervalMs
  }
  log(`[relaunch] hand-off from pid=${pid} complete after ~${waited}ms`)
  return true
}

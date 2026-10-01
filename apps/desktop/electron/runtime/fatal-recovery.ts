import type { HostFailureReport } from './crash-report.js'

/*
 * Host 故障之后的**唯一**恢复点。
 *
 * 一次故障会从好几条路同时被听见：子进程 exit、IPC disconnect、close。它们描述的是
 * 同一件事，所以这里只认第一次：后面来的通知既不重复写报告，也不重复问用户，更不会
 * 弹出第二个对话框。这也是「一次故障 = 一次决定」的全部含义。
 *
 * 顺序写死为：记录 → 询问 → 清理 → 重启或退出。清理必须**先于**重启/退出完成，
 * 否则新旧两个进程会同时写同一个数据目录。反过来，记录失败、询问失败、清理失败
 * 都不许把恢复卡住：崩溃之后最不该发生的事，是用户既退不出去也重启不了。
 */

export type FatalRecoveryChoice = 'restart' | 'quit'

export interface FatalRecoveryOptions {
  /** 写一份有界的诊断记录；返回落盘路径，写不成返回 undefined。 */
  record(report: HostFailureReport): Promise<string | undefined>
  /** 询问用户。默认实现之外的任何失败都按 quit 处理。 */
  choose(report: HostFailureReport, reportPath: string | undefined): Promise<FatalRecoveryChoice>
  /** 停 Host、释放这一代。必须在重启/退出之前完成。 */
  cleanup(): Promise<void>
  /** 交棒给新进程；退出由实现负责（app.relaunch 之后还要 exit）。 */
  relaunch(): void
  exit(code: number): void
  log?(message: string): void
}

export interface FatalRecoveryCoordinator {
  handle(failure: HostFailureReport): Promise<void>
  dispose(): void
}

export function createFatalRecoveryCoordinator(options: FatalRecoveryOptions): FatalRecoveryCoordinator {
  const log = options.log ?? ((message: string) => console.error(message))
  let disposed = false
  let active: Promise<void> | undefined

  async function recover(failure: HostFailureReport): Promise<void> {
    const reportPath = await options.record(failure).catch(() => undefined)
    if (disposed) return

    let choice: FatalRecoveryChoice
    try {
      choice = await options.choose(failure, reportPath)
    } catch (error) {
      log(`[recovery] could not ask the user; quitting instead: ${describe(error)}`)
      choice = 'quit'
    }
    if (disposed) return

    try {
      await options.cleanup()
    } catch (error) {
      // 清理失败也要往下走：留在原地意味着 Host 可能已经没了，窗口却还在。
      log(`[recovery] cleanup failed: ${describe(error)}`)
    }
    if (disposed) return

    if (choice === 'restart') {
      options.relaunch()
      options.exit(0)
      return
    }
    options.exit(1)
  }

  return {
    handle(failure) {
      // 已经释放：这一代不做任何决定，交给真正在收尾的那条路。
      if (disposed) return Promise.resolve()
      // 同一次故障会被 exit/disconnect/close 各报一次，只处理第一次。
      if (active) return active
      active = recover(failure).catch(error => {
        log(`[recovery] failed: ${describe(error)}`)
      })
      return active
    },
    dispose() {
      disposed = true
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

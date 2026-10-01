import type { HostActivitySnapshot, HostStopResult, ShutdownDecision, ShutdownIntent } from '@pureterm/protocol'
import type { DesktopHostProcess } from './host-process.js'

/*
 * 普通退出的**唯一**决策点。
 *
 * 关窗、菜单退出、Cmd+Q、更新安装都想「停 Host 然后退出」。它们各自问一遍用户、
 * 各自去停同一个 Host，就会出现两个对话框、两次停进程、以及一个迟到的对话框
 * 把**换过一代**的 Host 停掉。所以这里把整条链路收成一次 prepare()：
 *
 *   inspect → confirm(有活动时) → 拿租约 → drain → 锁内复查 → stop → ready
 *
 * 几条刻意写死的规则：
 *   - 同一 Host/代/intent/version 的并发请求共享一个 promise；不同 intent 或版本一律 busy，
 *     绝不借用别人的 ready（否则「更新」会拿着「退出」的确认去装包）。
 *   - 每个 await 之后都重新核对「还是不是同一个 Host、同一代、没被 dispose」。
 *     代换了或已释放，就把租约还回去并报 cancelled，绝不替新 Host 做决定。
 *   - ready 之后把决定**保留**到调用方提交清理，避免对着已经停掉的 Host 再准备一次。
 *   - 普通退出遇到 drain 超时可以再弹一次「仍要退出」；更新绝不 force-through。
 *   - 更新只有在 graceful 停进程后才 ready；否则 failed，绝不把强杀当成安装成功。
 */

export interface ShutdownConfirmation {
  intent: ShutdownIntent
  version?: string
  activity?: HostActivitySnapshot
  phase: 'initial' | 'changed' | 'unknown' | 'force'
}

/** 决策只依赖 Host 的公开生命周期面和 stop()，方便用假的 Host 做快速单测。 */
export type ShutdownHost = Pick<DesktopHostProcess, 'lifecycle' | 'stop'>

export interface ShutdownCoordinatorOptions {
  getHost(): ShutdownHost | undefined
  getGeneration(): number | undefined
  confirm(request: ShutdownConfirmation): Promise<boolean>
  onFailure(error: unknown, phase: 'inspect' | 'prepare' | 'drain' | 'stop'): void | Promise<void>
  /** drain 预算，毫秒。默认 5_000，与协议里的约定一致。 */
  drainTimeoutMs?: number
}

export interface ShutdownCoordinator {
  prepare(intent: ShutdownIntent, version?: string): Promise<ShutdownDecision>
  dispose(): void
}

const DEFAULT_DRAIN_MS = 5_000
const ACTIVITY_KEYS = ['activeSessions', 'pendingConnections', 'pendingFileOperations', 'pendingMutations'] as const

const ZERO_ACTIVITY: HostActivitySnapshot = {
  activeSessions: 0,
  pendingConnections: 0,
  pendingFileOperations: 0,
  pendingMutations: 0,
}

function hasActivity(activity: HostActivitySnapshot): boolean {
  return ACTIVITY_KEYS.some((key) => activity[key] > 0)
}

function grewAbove(next: HostActivitySnapshot, previous: HostActivitySnapshot): boolean {
  return ACTIVITY_KEYS.some((key) => next[key] > previous[key])
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

interface RequestKey {
  host: ShutdownHost
  generation: number | undefined
  intent: ShutdownIntent
  version: string | undefined
}

export function createShutdownCoordinator(options: ShutdownCoordinatorOptions): ShutdownCoordinator {
  const drainMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_MS
  let disposed = false
  let leaseCounter = 0
  let active: { key: RequestKey; promise: Promise<ShutdownDecision> } | undefined
  let reserved: { key: RequestKey; decision: ShutdownDecision } | undefined

  const sameKey = (a: RequestKey, b: RequestKey): boolean =>
    a.host === b.host && a.generation === b.generation && a.intent === b.intent && a.version === b.version

  /** 上报失败，但绝不让上报本身把决策流程打断。 */
  async function report(error: unknown, phase: 'inspect' | 'prepare' | 'drain' | 'stop'): Promise<void> {
    try {
      await options.onFailure(error, phase)
    } catch (reportingError) {
      console.error('[shutdown] failure reporting itself failed:', reportingError)
    }
  }

  /**
   * 还回自己的租约。`cancelShutdown` 返回 false 说明这个租约已经不是我们的了
   * （Host 重启或更晚的租约接管）——那是必须显式恢复的状态，不是「取消成功」。
   *
   * `status` 区分两种放弃：用户主动取消是 `cancelled`，准备过程本身失败是 `failed`。
   * 两者都要把租约还回去，让准入重新打开。
   */
  async function release(
    host: ShutdownHost,
    leaseId: string,
    intent: ShutdownIntent,
    status: 'cancelled' | 'failed' = 'cancelled',
  ): Promise<ShutdownDecision> {
    try {
      if (await host.lifecycle.cancelShutdown(leaseId)) return { intent, status }
      await report(new Error('the Host did not acknowledge the lease cancellation'), 'prepare')
      return { intent, status: 'failed' }
    } catch (error) {
      await report(error, 'prepare')
      return { intent, status: 'failed' }
    }
  }

  async function run(key: RequestKey): Promise<ShutdownDecision> {
    const { host, intent, version } = key
    const owned = (): boolean =>
      !disposed && options.getHost() === host && options.getGeneration() === key.generation

    // 1. 检查活动。检查失败是「未知」，绝不是「零」——不能拿一个空快照骗用户说没有工作。
    let activity: HostActivitySnapshot | undefined
    let unknown = false
    try {
      activity = await host.lifecycle.inspectActivity()
    } catch (error) {
      unknown = true
      await report(error, 'inspect')
    }
    if (!owned()) return { intent, status: 'cancelled' }

    // 2. 有活动、未知，或本来就是更新：先让用户确认。零活动的普通退出不打扰。
    if (intent === 'update' || unknown || !activity || hasActivity(activity)) {
      const accepted = await options.confirm({ intent, version, activity, phase: unknown ? 'unknown' : 'initial' })
      if (!owned() || !accepted) return { intent, status: 'cancelled' }
    }

    // 3. 拿租约，同步关掉准入。此后不再有新工作进来。
    const leaseId = `shutdown-${++leaseCounter}-${Date.now().toString(36)}`
    let snapshot: HostActivitySnapshot
    try {
      snapshot = await host.lifecycle.prepareShutdown(leaseId)
    } catch (error) {
      if (errorCode(error) === 'host.lifecycle-busy') return { intent, status: 'busy' }
      await report(error, 'prepare')
      return { intent, status: 'failed' }
    }
    if (!owned()) return release(host, leaseId, intent)

    // 4. 检查与拿租约之间溜进来的工作：事实变多了就得再确认一次。
    if (!unknown && activity && grewAbove(snapshot, activity)) {
      const accepted = await options.confirm({ intent, version, activity: snapshot, phase: 'changed' })
      if (!owned() || !accepted) return release(host, leaseId, intent)
    }

    // 5. 等有限工作排空。
    try {
      await host.lifecycle.drainAccepted(leaseId, drainMs)
    } catch (error) {
      const timeout = errorCode(error) === 'host.lifecycle-drain-timeout'
      if (!(timeout && intent === 'quit')) {
        await report(error, 'drain')
        return release(host, leaseId, intent, 'failed')
      }
      // 普通退出可以再问一次「仍要退出」；取消就把租约还回去，窗口和会话都留着。
      const forced = await options.confirm({ intent, version, activity: snapshot, phase: 'force' })
      if (!owned() || !forced) return release(host, leaseId, intent)
    }
    if (!owned()) return release(host, leaseId, intent)

    // 6. 锁内复查：租约期间不该再涨，但真涨了就必须让用户知道。
    try {
      const after = await host.lifecycle.inspectActivity()
      if (grewAbove(after, snapshot)) {
        const accepted = await options.confirm({ intent, version, activity: after, phase: 'changed' })
        if (!owned() || !accepted) return release(host, leaseId, intent)
      }
    } catch (error) {
      // 已经在锁内、用户也已确认，复查失败不该反过来阻止一次退出。
      await report(error, 'inspect')
    }
    if (!owned()) return release(host, leaseId, intent)

    // 7. 停 Host。
    let result: HostStopResult
    try {
      result = await host.stop()
    } catch (error) {
      await report(error, 'stop')
      return { intent, status: 'failed' }
    }

    // 8. 更新只在 graceful 停进程后才算准备好；普通退出允许非 graceful（用户已经决定退出）。
    if (intent === 'update' && !result.graceful) {
      await report(new Error('the Host did not stop gracefully; refusing to install the update'), 'stop')
      return { intent, status: 'failed' }
    }
    return { intent, status: 'ready' }
  }

  return {
    prepare(intent, version) {
      const host = options.getHost()
      // 没有 Host（启动失败、已经清理）：没什么可停的，退出可以直接走。
      if (!host) return Promise.resolve({ intent, status: 'ready' })
      const key: RequestKey = { host, generation: options.getGeneration(), intent, version }

      if (reserved) {
        return Promise.resolve(sameKey(reserved.key, key) ? reserved.decision : { intent, status: 'busy' })
      }
      if (active) {
        return sameKey(active.key, key) ? active.promise : Promise.resolve({ intent, status: 'busy' })
      }

      const promise = run(key).then(
        (decision) => {
          active = undefined
          // ready 之后保留决定，直到调用方用 dispose() 提交清理。
          if (!disposed && decision.status === 'ready') reserved = { key, decision }
          return decision
        },
        (error: unknown) => {
          active = undefined
          throw error
        },
      )
      active = { key, promise }
      return promise
    },
    dispose() {
      disposed = true
      active = undefined
      reserved = undefined
    },
  }
}

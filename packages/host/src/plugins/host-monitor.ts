import { Service, type Context } from 'cordis'
import {
  EVENTS,
  MONITOR_METRICS,
  type MonitorStartRequest,
  type MonitorStartResult,
  type MonitorStopResult,
  type MonitorUpdate,
} from '@pureterm/protocol'
import type { ExecResult } from '../services/ssh.js'
import { LINUX_MONITOR_COMMAND, parseLinuxProbe, toMonitorSnapshot, type PreviousSample } from '../monitoring/linux.js'

declare module 'cordis' {
  interface Context {
    hostMonitor: HostMonitor
  }
}

/** 一次探测的截止时间，从申请通道之前开始算。 */
const PROBE_TIMEOUT = 3000
/** 一个 /proc 帧远小于这个数；超了说明远端在往这条通道上灌别的东西。 */
const PROBE_MAX_BYTES = 65536
/** 探测**完成**之后到下一次探测的间隔，不是两次开始之间的间隔。 */
const INTERVAL_MS = 5000
/** 协议对 message 的上限。 */
const MAX_MESSAGE = 512

type Draft = Omit<MonitorUpdate, 'sessionId' | 'subscriptionId' | 'sequence'>

/**
 * 一个客户端当前生效的订阅。
 *
 * 记录对象本身**不会被复用**：换一次订阅就是一个新对象。所以「这个对象还是
 * `subscriptions` 里那个」就是「这一代还是当前这一代」，异步续作不必再比对一个
 * 数字代数——比对一个数字和比对一次身份，前者多一个能写错的地方。
 */
interface Subscription {
  clientId: string
  sessionId: string
  subscriptionId: string
  /** 从 1 开始，每次激活重置。 */
  sequence: number
  /** 上一次成功探测的基线；整对保留或整对清空，见 monitoring/linux.ts。 */
  baseline: PreviousSample | null
  timer: NodeJS.Timeout | null
  /** 取消在途探测。它只关 exec 自己那条通道，不动会话。 */
  abort: AbortController
  stopped: boolean
  /** 远端不是 Linux：只发一次 unsupported，不再自动探测。 */
  finished: boolean
}

function describe(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).trim()
  // 协议要求 error/unsupported 带非空 message：一个空字符串会让界面无从解释。
  const message = text || '监控探测失败。'
  return message.length > MAX_MESSAGE ? message.slice(0, MAX_MESSAGE) : message
}

/**
 * HostMonitor —— 订阅策略、调度、取消、基线、事件投递。
 *
 * 它只做编排：把命令交给 `SshService.exec`，把输出交给 `monitoring/linux.ts`，
 * 把结果交给 `RendererService`。三条边界各自可测，谁也不替谁做决定。
 *
 * 归属不由自己记账：会话属于谁由 TerminalBridge 回答（它是唯一持有那张表的人）。
 * 这里只问，不存——存下来的归属关系会在会话关闭之后继续成立。
 */
export class HostMonitor extends Service {
  static inject = ['ssh', 'terminal', 'renderer']

  /** 每个客户端至多一条记录。 */
  private readonly subscriptions = new Map<string, Subscription>()
  private stopped = false

  constructor(ctx: Context) {
    super(ctx, 'hostMonitor')

    // 会话没了，挂在它上面的订阅就没有对象了。abort 掉在途的探测，
    // 否则那一轮要等到自己的超时才结束，而结果已经没有人要了。
    this.ctx.on('ssh/session-closed', (sessionId: string) => this.retireSession(sessionId))
    // 插件卸载和 Host 关闭走同一条幂等路径。
    this.ctx.effect(() => () => this.shutdown(), 'hostMonitor.shutdown')
  }

  get size(): number {
    return this.subscriptions.size
  }

  /**
   * 建立订阅。
   *
   * 有意**不等**第一次探测：远端可能慢、可能失败，而界面必须立刻知道自己已经订阅
   * 成功了。记录的登记和旧记录的退役都在第一次 `await` 之前完成，所以同一个
   * WebSocket 上的请求不可能互相插队。
   */
  async start(request: MonitorStartRequest, clientId: string): Promise<MonitorStartResult> {
    if (this.stopped) throw new Error('MONITOR_UNAVAILABLE')
    const { sessionId, subscriptionId } = request
    const current = this.subscriptions.get(clientId)

    // 同一个 ID 配同一个会话：幂等。既不重置序号，也不重开一轮探测。
    if (current && current.subscriptionId === subscriptionId && current.sessionId === sessionId) {
      return { subscriptionId, intervalMs: INTERVAL_MS }
    }
    // 一个 ID 挂在两个会话上会让「按 ID 停止」有歧义。
    if (current && current.subscriptionId === subscriptionId) {
      throw new Error('这个订阅 ID 已经用在另一个会话上了。')
    }
    /*
     * 归属检查在替换任何东西**之前**：一个非法请求不能把已经生效的订阅顶掉。
     * 两个问题都要问——会话还活着并且属于这个客户端，以及客户端自己还在。
     */
    if (!this.ctx.terminal.ownsSession(sessionId, clientId)) throw new Error('这个会话不存在，或不属于当前客户端。')
    if (!this.ctx.renderer.isAlive(clientId)) throw new Error('客户端已断开连接。')

    this.retire(clientId)
    const record: Subscription = {
      clientId, sessionId, subscriptionId, sequence: 0, baseline: null, timer: null,
      abort: new AbortController(), stopped: false, finished: false,
    }
    this.subscriptions.set(clientId, record)
    void this.probe(record)
    return { subscriptionId, intervalMs: INTERVAL_MS }
  }

  /**
   * 停止订阅。
   *
   * 只认调用方自己的 ID：别人的、不存在的，一律回答「没有停掉任何东西」，
   * 而不是告诉它那个 ID 属于谁。停止是幂等的。
   */
  async stop(subscriptionId: string, clientId: string): Promise<MonitorStopResult> {
    const record = this.subscriptions.get(clientId)
    if (!record || record.subscriptionId !== subscriptionId) return { stopped: false }
    this.retire(clientId)
    return { stopped: true }
  }

  /** 客户端断开：先于它的终端被释放调用。 */
  releaseClient(clientId: string): void {
    this.retire(clientId)
  }

  /** 幂等：卸载、Host 关闭、重复调用都走这里。 */
  shutdown(): void {
    if (this.stopped) return
    this.stopped = true
    for (const clientId of [...this.subscriptions.keys()]) this.retire(clientId)
  }

  private isCurrent(record: Subscription): boolean {
    return !record.stopped && this.subscriptions.get(record.clientId) === record
  }

  /**
   * 现在还该不该探测这个会话。
   *
   * 会话关了、客户端走了、插件停了，答案都是「不该」。放在每次探测之前问，
   * 而不是只在建立订阅时问一次：中间隔着 5 秒，足够发生任何一件事。
   */
  private eligible(record: Subscription): boolean {
    if (this.stopped) return false
    if (!this.ctx.renderer.isAlive(record.clientId)) return false
    return this.ctx.terminal.ownsSession(record.sessionId, record.clientId)
  }

  private retire(clientId: string): boolean {
    const record = this.subscriptions.get(clientId)
    if (!record) return false
    this.subscriptions.delete(clientId)
    // 先标记再收尾：任何已经在路上的续作都会在下一个检查点上看到 stopped。
    record.stopped = true
    if (record.timer) {
      clearTimeout(record.timer)
      record.timer = null
    }
    // 只取消这条探测通道。会话、终端和 SFTP 都还挂在同一个连接上。
    record.abort.abort()
    return true
  }

  private retireSession(sessionId: string): void {
    for (const record of [...this.subscriptions.values()]) {
      if (record.sessionId === sessionId) this.retire(record.clientId)
    }
  }

  /**
   * 一轮探测。
   *
   * 每个 `await` 之后都要重新确认自己还是当前订阅：这中间可能已经被 stop、
   * 被新订阅替换、被客户端断开、或者整棵插件树被卸载。
   */
  private async probe(record: Subscription): Promise<void> {
    if (!this.isCurrent(record)) return
    let draft: Draft
    try {
      const result = await this.ctx.ssh.exec(record.sessionId, LINUX_MONITOR_COMMAND, {
        timeout: PROBE_TIMEOUT,
        maxBytes: PROBE_MAX_BYTES,
        signal: record.abort.signal,
      })
      if (!this.isCurrent(record)) return
      draft = this.interpret(record, result)
    } catch (error) {
      if (!this.isCurrent(record)) return
      /*
       * 一次失败不改变订阅：连接可能只是抖了一下，下一轮照常。
       * 但基线必须清掉——隔着一次失败的两个样本之间的增量，包含了一段没人量过的
       * 时间，用它算出来的速率是错的。
       */
      record.baseline = null
      draft = { status: 'error', snapshot: null, message: describe(error) }
    }
    if (!this.publish(record, draft)) return
    if (record.finished) return
    this.schedule(record)
  }

  /** 把一次 exec 的结果翻译成要发出去的事件。抛错表示这一轮整体失败。 */
  private interpret(record: Subscription, result: ExecResult): Draft {
    // 被信号杀掉说明命令没有跑完，帧再完整也是残缺的。
    if (result.signal) throw new Error(`远端采集命令被信号 ${result.signal} 终止。`)
    // 没有退出状态是可以接受的（有些服务器不发），但一个非零状态不行：
    // 脚本最后一条就是打印 END，非零意味着它没走到那里。
    if (result.code !== null && result.code !== 0) throw new Error(`远端采集命令以退出码 ${result.code} 结束。`)

    const probe = parseLinuxProbe(result.stdout)
    if (probe.os !== 'Linux') {
      // 说清楚是哪一种系统，然后停手。手动重试会开一个新的订阅。
      record.finished = true
      return { status: 'unsupported', snapshot: null, message: `这台主机的操作系统是 ${probe.os}，暂不支持资源监控。` }
    }

    const snapshot = toMonitorSnapshot(probe, record.baseline, Date.now())
    const available = MONITOR_METRICS.filter(metric => snapshot.issues[metric] === undefined).length
    if (available === 0) {
      // 六个指标一个都没读到：这不是一张空表，而是这次探测整体失败。
      record.baseline = null
      return { status: 'error', snapshot: null, message: '远端没有给出任何可用的指标。' }
    }
    // 只有两个计数器都在时才留基线：它们共用一个时间戳，缺一个就整对作废。
    record.baseline = probe.cpu && probe.net
      ? { collectedAt: snapshot.collectedAt, cpu: probe.cpu, net: probe.net }
      : null
    return { status: available === MONITOR_METRICS.length ? 'ready' : 'partial', snapshot }
  }

  private publish(record: Subscription, draft: Draft): boolean {
    const delivered = this.ctx.renderer.send(record.clientId, EVENTS.monitorUpdate, {
      sessionId: record.sessionId,
      subscriptionId: record.subscriptionId,
      sequence: ++record.sequence,
      ...draft,
    } satisfies MonitorUpdate)
    // 送不到就等于这个客户端已经不在了。更新是订阅的一部分，跟着订阅一起收掉。
    if (!delivered) this.retire(record.clientId)
    return delivered
  }

  private schedule(record: Subscription): void {
    if (record.stopped || this.stopped) return
    if (!this.eligible(record)) {
      this.retire(record.clientId)
      return
    }
    record.timer = setTimeout(() => {
      record.timer = null
      void this.probe(record)
    }, INTERVAL_MS)
  }
}

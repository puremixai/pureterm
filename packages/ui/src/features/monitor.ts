import { Service, type Context } from 'cordis'
import type { MonitorSnapshot, MonitorUpdate } from '@pureterm/protocol'
import { ClientScope } from '../client-runtime.js'
import { errorCode, errorMessage } from '../failure-diagnostics.js'
import { messageKey, messageText, resolveMessage, type MessageText } from '../message-text.js'
import { createMonitorPanel, type MonitorPanel, type MonitorPanelState, type MonitorStatus, type NetSample } from '../monitor-panel.js'
import type { TerminalTab } from '../services/terminal.js'

declare module 'cordis' { interface Context { clientMonitor: ClientMonitor } }

/** 宿主每 5 秒探测一次；连续三轮没有新快照就说明这一路断了，标为过期而不是继续当实时。 */
const STALE_MS = 15000
/** 过期检查的节奏。只在真的有订阅时才有事可做。 */
const STALE_TICK = 5000
/** 走势线保留的样本数。60 帧 × 5 秒 = 5 分钟，够看出一个形状又不至于把内存拖长。 */
const HISTORY_LIMIT = 60

/** 一次采集的结果。`loading` 是「已经订阅、还没等到第一个快照」。 */
type CollectionStatus = 'loading' | 'ready' | 'partial' | 'unsupported' | 'error'

/**
 * 一个标签页的监控状态。
 *
 * 它跟着**标签页**走，不跟着会话走：切走再切回来，用户看到的还是同一抽屉数字。
 * 但 `sessionId` 一变（重连拿到了新会话）就整份清空 —— 新会话没有历史快照，
 * 把上一代的读数留在屏幕上等于把两台机器的数字混在一起。
 */
interface TabMonitor {
  sessionId: string | null
  open: boolean
  paused: boolean
  status: CollectionStatus
  snapshot: MonitorSnapshot | null
  /** 快照**到达本地**的时刻。过期按它算，不按远端的 collectedAt —— 两块表可以不一样。 */
  receivedAt: number
  /** 这一代订阅收到的网络速率序列，画走势用。换会话或换订阅都从头开始。 */
  history: NetSample[]
  /**
   * 面板底下那一行。存 key 或远端原文：它是常驻的（一次失败不改写上一张快照，
   * 由这一行说明这一轮没读到），所以换语言之后得能重说一遍。
   */
  message: MessageText | undefined
}

/**
 * 一次订阅。
 *
 * 记录对象不复用：换一次订阅就是一个新对象，所以「这个对象还是 `current` 里那个」
 * 就是「这一代还是当前这一代」，异步续作不必再比对一个数字代数。
 */
interface Subscription {
  tabId: string
  sessionId: string
  subscriptionId: string
  /** 已经接受过的最大序号：更小的序号是迟到的事件，不能重绘当前订阅。 */
  sequence: number
  /** start 是否已经被回答。退役一个还没被回答的订阅要等回复到了再停，见 retire。 */
  acknowledged: boolean
  retired: boolean
  stopped: boolean
  state: TabMonitor
}

/**
 * 一次激活一个订阅 ID。
 *
 * 每次激活都要新 ID：宿主按 ID 认订阅，复用同一个 ID 会让上一代的迟到事件和这一代
 * 分不开。`crypto.randomUUID` 只在安全上下文里有（三个入口都在），但一个纯展示层
 * 不该因为上下文判定失败就整块不工作，所以留了退路。
 */
let subscriptionSequence = 0
function newSubscriptionId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `monitor-${++subscriptionSequence}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * ClientMonitor —— 会话资源指标的客户端。
 *
 * 它只做编排：什么时候该订阅、什么时候该退订、收到的事件还算不算数、这个面板怎么画。
 * 它不解析协议负载（transport 已经校验过了），不跑定时器去问远端（宿主按自己的节奏
 * 推），也不算任何指标（计算全在 host 的 monitoring/linux.ts）。
 *
 * 会话事实**不在这里**：cipher 和 host key 是连接期的常量，由 ClientChrome 直接从
 * transport 取，所以卸载这个插件不会让状态栏空掉。
 */
export class ClientMonitor extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal']
  private readonly scope: ClientScope
  private readonly panel: MonitorPanel
  private readonly toggle: HTMLButtonElement
  private readonly tabs = new Map<string, TabMonitor>()
  private current: Subscription | null = null
  /** 上一次广播出去的抽屉开合，用来只在真的变化时才发一条 drawer-change。 */
  private announced = false

  constructor(ctx: Context) {
    super(ctx, 'clientMonitor')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    /*
     * 开关由这个插件建、也由它拆：它住在会话栏里（`#sftp-toggle` 左边），但它的生命
     * 属于监控 —— 卸载监控插件时这一颗按钮必须跟着走，而不是留在页面上按一个已经
     * 没有订阅的面板。
     */
    this.toggle = view.document.createElement('button')
    this.toggle.type = 'button'
    this.toggle.id = 'monitor-toggle'
    this.toggle.className = 'ghost small'
    this.toggle.disabled = true
    view.element('sftp-toggle').before(this.toggle)
    this.panel = createMonitorPanel(view.element('session-monitor'), this.toggle, {
      toggleOpen: () => this.setOpen(!this.activeState()?.open),
      togglePaused: () => this.setPaused(!this.activeState()?.paused),
      retry: () => this.retry(),
    })
    this.scope.onDispose(() => {
      if (this.current) this.retire(this.current, true)
      this.tabs.clear()
      this.panel.dispose()
      this.toggle.remove()
      view.element('session-workspace').classList.remove('monitor-open')
    })

    const api = ctx.clientTransport.api
    // 校验失败的事件在 transport 里就被丢掉了，所以这里拿到的每一条都是合法负载。
    ctx.effect(() => api.monitor.onUpdate(update => this.accept(update)), 'monitor.updates')

    /*
     * 采样开关的四个来源合成一次 sync：切标签页、连接状态变化、文档可见性变化、
     * 标签关闭。四件事各自触发，但「现在该不该采」只有一个答案。
     */
    ctx.on('client/session-change', () => this.sync())
    ctx.on('client/connection-change', () => this.sync())
    // 换语言：sync() 是幂等的，而且以 render 收尾，所以重跑一遍就够了 —— 状态文字、
    // 指标名、开关的字形说明、以及底下那一行（存的是 key）都会跟着变。
    ctx.on('client/locale-change', () => this.sync())
    ctx.on('client/tab-closed', tabId => {
      if (this.current?.tabId === tabId) this.retire(this.current)
      this.tabs.delete(tabId)
      this.sync()
    })
    /*
     * 资源面板和文件面板共用右侧那一格抽屉，同一时刻只开一个。文件面板先打开时这里
     * 收起来 —— 只对「别人刚打开」这件事作反应，自己的开合由 sync 广播出去。
     */
    ctx.on('client/drawer-change', (drawer, open) => {
      if (!this.scope.alive) return
      if (drawer === 'files' && open && this.activeState()?.open) this.setOpen(false)
    })
    this.scope.listen(view.document, 'visibilitychange', () => this.sync())
    /*
     * 过期不靠事件驱动：远端停止推送时本地什么都不会发生，所以得有人过一会儿问一次
     * 「上一次快照是什么时候」。只在有订阅时才有事做，没有订阅的那 5 秒是一次空转。
     */
    ctx.effect(() => {
      const timer = setInterval(() => {
        if (this.current) this.render(this.current.state, this.tabOf(this.current))
      }, STALE_TICK)
      return () => clearInterval(timer)
    }, 'monitor.stale')

    this.sync()
  }

  /** 当前标签页的监控状态；没有标签页时是 null。只读，不建。 */
  private activeState(): TabMonitor | null {
    const tab = this.ctx.clientTerminal.active
    return tab ? this.tabs.get(tab.id) ?? null : null
  }

  private tabOf(subscription: Subscription): TerminalTab | undefined {
    return this.ctx.clientTerminal.tabs.find(tab => tab.id === subscription.tabId)
  }

  private stateOf(tab: TerminalTab): TabMonitor {
    let state = this.tabs.get(tab.id)
    if (!state) {
      // 默认收起、未暂停：刚打开的会话在用户展开之前不采集任何东西。
      state = { sessionId: null, open: false, paused: false, status: 'loading', snapshot: null, receivedAt: 0, history: [], message: undefined }
      this.tabs.set(tab.id, state)
    }
    return state
  }

  private setOpen(open: boolean): void {
    const state = this.activeState()
    if (!state) return
    state.open = open
    this.sync()
  }

  private setPaused(paused: boolean): void {
    const state = this.activeState()
    if (!state) return
    state.paused = paused
    this.sync()
  }

  /**
   * 「现在就要一组新数字」。
   *
   * 它同时展开并清掉手动暂停，因为这两个状态下按钮本来无事可做 —— 一个点了没反应的
   * 重试比一个不存在更糟。新订阅 = 新 ID = 宿主的 CPU 与网络基线重来，这正是重试的
   * 意思：上一组增量算不出来，换一组重新开始。
   */
  private retry(): void {
    const state = this.activeState()
    if (!state) return
    state.open = true
    state.paused = false
    if (this.current) this.retire(this.current)
    this.sync()
  }

  /**
   * 采集的准入条件，四个都要成立。
   *
   * 「可见、展开、未暂停、当前选中的已连接标签页」——少任何一个都不该有一条探测在
   * 远端跑，因为那意味着终端的宽度和远端的进程都在为一个看不见的面板付出代价。
   */
  private eligible(tab: TerminalTab | undefined, state: TabMonitor | null): boolean {
    if (!this.scope.alive || !tab || !state) return false
    if (!tab.sessionId || tab.state !== 'connected') return false
    if (!state.open || state.paused) return false
    return !this.ctx.clientView.document.hidden
  }

  /** 把「该采」和「正在采」对齐。它是幂等的，所以每个事件都可以直接调它。 */
  private sync(): void {
    if (!this.scope.alive) return
    const tab = this.ctx.clientTerminal.active
    const state = tab ? this.stateOf(tab) : null

    // 会话换了（重连、切到别的会话）就丢掉上一代的实时状态：新会话没有历史快照。
    if (tab && state && state.sessionId !== tab.sessionId) {
      state.sessionId = tab.sessionId
      state.status = 'loading'
      state.snapshot = null
      state.receivedAt = 0
      state.history = []
      state.message = undefined
    }

    const open = !!state?.open
    // 抽屉那一格和把手归 ClientSftp 画，它按这条广播重新判断；这里只负责自己的工作区类。
    this.ctx.clientView.element('session-workspace').classList.toggle('monitor-open', open)

    const wanted = this.eligible(tab, state)
    const same = this.current && tab && state
      && this.current.tabId === tab.id && this.current.sessionId === tab.sessionId
    if (this.current && !(wanted && same)) this.retire(this.current)
    if (wanted && !this.current) this.begin(tab!, state!)
    this.render(state, tab)
    /*
     * 广播排在 render 之后：`#session-monitor` 的 hidden 是 render 写的，而 ClientSftp
     * 靠读它决定共用的把手露不露面 —— 先广播的话，它在抽屉还没画出来时就判断了一次，
     * 把手会留在隐藏状态，直到下一次偶然的 sync。
     */
    if (open !== this.announced) {
      this.announced = open
      this.ctx.emit('client/drawer-change', 'monitor', open)
    }
  }

  private begin(tab: TerminalTab, state: TabMonitor): void {
    const subscriptionId = newSubscriptionId()
    const subscription: Subscription = {
      tabId: tab.id, sessionId: tab.sessionId!, subscriptionId,
      sequence: 0, acknowledged: false, retired: false, stopped: false, state,
    }
    this.current = subscription
    // 界面立刻知道自己已经订阅成功，不等第一个快照 —— 远端可能慢，也可能失败。
    state.status = 'loading'
    state.message = undefined
    // 新订阅 = 宿主那边 CPU 与网络基线重来，所以走势也从头画。
    state.history = []
    this.render(state, tab)
    void this.ctx.clientTransport.api.monitor.start({ sessionId: subscription.sessionId, subscriptionId }).then(
      () => {
        subscription.acknowledged = true
        // 回复迟到：这一代早就被退役了，但它已经在宿主那里登记过，得停掉。
        if (subscription.retired) this.stop(subscription)
      },
      error => {
        if (this.current !== subscription) return
        this.current = null
        /*
         * 宿主里没有监控插件是一种**可预期**的状态，不是异常：报「不支持」让界面
         * 说清楚，而不是让用户对着一句内部错误码猜。远端不是 Linux 走的是另一条
         * 路（start 成功、随后来一条 unsupported 事件）。
         */
        const unavailable = errorCode(error) === 'host.monitor-unavailable'
        state.status = unavailable ? 'unsupported' : 'error'
        state.message = errorMessage(error)
        this.render(state, tab)
      },
    )
  }

  /**
   * 退役一次订阅。
   *
   * 还没被回答的订阅留给回复那条路来停：现在停会和 start 抢在同一个 socket 上，
   * 谁先到就决定了要不要发这条 stop，而宿主对同一个 ID 只会认第一次。已停过的
   * 订阅不重复停 —— 停止是幂等的，但重复的请求会让「停了几次」这件事没法断言。
   */
  private retire(subscription: Subscription, force = false): void {
    if (subscription.retired) return
    subscription.retired = true
    if (this.current === subscription) this.current = null
    if (force || subscription.acknowledged) this.stop(subscription)
  }

  private stop(subscription: Subscription): void {
    if (subscription.stopped) return
    subscription.stopped = true
    // 停不掉不是用户的问题：这个订阅已经不属于任何人了，宿主也会在会话关闭时收掉它。
    void this.ctx.clientTransport.api.monitor.stop(subscription.subscriptionId).catch(() => {})
  }

  /**
   * 收下一条更新。
   *
   * 三道过滤都是身份，不是内容：会话、订阅 ID、序号。切走再切回来会拿到新的订阅 ID，
   * 上一代的迟到事件因此在这一步就被挡掉，永远不会重绘当前这一行。
   */
  private accept(update: MonitorUpdate): void {
    const subscription = this.current
    if (!subscription || subscription.retired) return
    if (update.sessionId !== subscription.sessionId) return
    if (update.subscriptionId !== subscription.subscriptionId) return
    if (update.sequence <= subscription.sequence) return
    subscription.sequence = update.sequence

    const state = subscription.state
    // 原因是一个错误码加它的参数，所以存的是 key —— 切一次语言，这一行跟着变。
    const reason = update.error ? errorMessage(update.error) : undefined
    if (update.status === 'error') {
      // 一次失败不改写上一张快照：它带着自己的时间戳留着，由状态文字说明这一轮没读到。
      state.status = 'error'
      state.message = reason ?? messageKey('monitor.detail.error')
    } else if (update.status === 'unsupported') {
      state.status = 'unsupported'
      state.snapshot = null
      state.receivedAt = 0
      state.history = []
      state.message = reason
    } else {
      state.status = update.status
      state.snapshot = update.snapshot
      state.receivedAt = Date.now()
      state.message = undefined
      // 走势只收真正量到的网络读数：预热那一轮 net 是 null，不该在图上记一个 0。
      if (update.snapshot?.net) {
        state.history.push({
          received: update.snapshot.net.receivedBytesPerSecond,
          transmitted: update.snapshot.net.transmittedBytesPerSecond,
        })
        if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT)
      }
    }
    this.render(state, this.tabOf(subscription))
  }

  /**
   * 面板要画的那个状态。
   *
   * 采集状态和展示状态不是一回事：`loading` 在收起时画成「已暂停」，因为那一刻
   * 真的没有东西在跑，画成「读取中」是在替一个不存在的探测说话。过期只在**正在
   * 采集**时才算 —— 暂停时数字不动是用户自己选的，不是数据过期。
   */
  private display(tab: TerminalTab, state: TabMonitor): MonitorPanelState {
    return {
      status: this.statusOf(tab, state),
      snapshot: state.snapshot,
      open: state.open,
      paused: state.paused,
      available: !!tab.sessionId,
      history: state.history,
      // 在这里解析：面板拿到的是一句现成的文本，而 render 在换语言时会被再叫一次。
      message: resolveMessage(state.message),
    }
  }

  private statusOf(tab: TerminalTab, state: TabMonitor): MonitorStatus {
    if (!tab.sessionId) return tab.state === 'connecting' ? 'idle' : 'disconnected'
    if (state.status === 'unsupported') return 'unsupported'
    if (!state.open || state.paused || this.ctx.clientView.document.hidden) return 'paused'
    if (state.snapshot && Date.now() - state.receivedAt > STALE_MS) return 'stale'
    return state.status
  }

  private render(state: TabMonitor | null, tab: TerminalTab | undefined): void {
    if (!this.scope.alive) return
    this.panel.render(state && tab
      ? this.display(tab, state)
      : { status: 'idle', snapshot: null, open: false, paused: false, available: false, history: [] })
  }
}

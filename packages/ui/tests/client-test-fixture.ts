import type { SshApi, HostRecord, KeyRecord, MonitorStartRequest, MonitorStartResult, MonitorStopResult, MonitorUpdate, RendererReadyPayload, SessionFacts } from '@pureterm/protocol'

import type { TerminalView } from '../src/terminal-view.js'



/**
 * 一份可控的假 SSH/SFTP/监控载体。
 *
 * 浏览器生命周期夹具和 T04 的真实样式夹具共用它：两边都要能挂住一条请求、合成
 * 一条监控事件、数一数开了几次会话，而复制一份 fake transport 只会让两边慢慢跑偏。
 * 这里没有 Node 依赖，所以浏览器和 Node 都能 import。
 */
export const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

/** 一个失败的线上形状。`message` 永远在，它是这个失败不依赖语言的那一面。 */
export const wire = (code: string, params?: Record<string, string | number>) => ({ code, ...(params ? { params } : {}), message: code })

export interface FakeTerminal extends TerminalView {
  disposed: number
  themeCalls: number
  inputs: Set<(data: string) => void>
  writes: unknown[]
  resizeListeners: Set<(size: { cols: number; rows: number }) => void>
}

export interface FakeMonitor {
  starts: MonitorStartRequest[]
  stops: string[]
  /** 当前活着的订阅：收到 start、还没被 stop 的 ID。 */
  active: Set<string>
  /** 挂起未答的 start，按调用顺序。holding 为 true 时 start 不自动回复。 */
  held: Array<{ request: MonitorStartRequest; resolve: () => void; reject: (error: Error) => void }>
  holding: boolean
  /** 非 null 时 start 直接失败，用来造 MONITOR_UNAVAILABLE。 */
  rejection: ReturnType<typeof wire> | null
  start(request: MonitorStartRequest): Promise<MonitorStartResult>
  stop(subscriptionId: string): Promise<MonitorStopResult>
  /** 让所有挂起的 start 回复。 */
  release(): void
  /** 让所有挂起的 start 失败。 */
  fail(message: string): void
  /** 一个订阅被停了几次。停止是幂等的，但重复的请求会让这条断言失去意义。 */
  stopsOf(subscriptionId: string): number
  /** 合成一条 monitor:update。 */
  update(update: MonitorUpdate): void
  /** 合成一条 session:facts。 */
  facts(facts: SessionFacts): void
}

export interface ClientFixture {
  api: SshApi
  hosts: HostRecord[]
  keys: KeyRecord[]
  stats: {
    disposed: number
    opens: number
    inputs: number
    closes: number
    lists: number
    ready: RendererReadyPayload[]
    /** 每一次 api.resize 的实际参数；T04 用它证明适配发给了同一个会话。 */
    resizes: Array<{ sessionId: string; cols: number; rows: number }>
  }
  listeners: {
    opened: Set<(...args: any[]) => void>
    data: Set<(...args: any[]) => void>
    closed: Set<(...args: any[]) => void>
    disconnected: Set<(...args: any[]) => void>
    updates: Set<(...args: any[]) => void>
    facts: Set<(...args: any[]) => void>
  }
  terminals: FakeTerminal[]
  terminalFactory: () => FakeTerminal
  emit: (name: keyof ClientFixture['listeners'], ...args: unknown[]) => void
  monitor: FakeMonitor
}

export function fixture(): ClientFixture {

  const listeners = { opened: new Set<(...args: any[]) => void>(), data: new Set<(...args: any[]) => void>(), closed: new Set<(...args: any[]) => void>(), disconnected: new Set<(...args: any[]) => void>(), updates: new Set<(...args: any[]) => void>(), facts: new Set<(...args: any[]) => void>() }

  const stats = { disposed: 0, opens: 0, inputs: 0, closes: 0, lists: 0, ready: [] as RendererReadyPayload[], resizes: [] as Array<{ sessionId: string; cols: number; rows: number }> }

  const subscribe = (name: keyof typeof listeners, listener: (...args: any[]) => void) => { listeners[name].add(listener); return () => { listeners[name].delete(listener) } }

  const emit = (name: keyof typeof listeners, ...args: unknown[]) => { for (const listener of listeners[name]) listener(...args) }

  /*
   * 监控 fixture。观测面有三样：可控的 start 回复（能挂住、能让它失败）、当前活着的
   * 订阅集合、以及合成的事件源。默认「立刻同意」而且默认折叠，所以现有生命周期检查
   * 一条 start 都不会发出来 —— 这正是折叠默认要保证的事。
   */
  const monitor: FakeMonitor = {

    starts: [] as MonitorStartRequest[],

    stops: [] as string[],

    /** 当前活着的订阅：收到 start、还没被 stop 的 ID。 */
    active: new Set<string>(),

    /** 挂起未答的 start，按调用顺序。holding 为 true 时 start 不自动回复。 */
    held: [] as Array<{ request: MonitorStartRequest; resolve: () => void; reject: (error: Error) => void }>,

    holding: false,

    /** 非 null 时 start 直接失败，用来造 MONITOR_UNAVAILABLE。 */
    rejection: null as ReturnType<typeof wire> | null,

    async start(request: MonitorStartRequest): Promise<MonitorStartResult> {
      monitor.starts.push(request)
      if (monitor.rejection) throw Object.assign(new Error(monitor.rejection.message), monitor.rejection)
      monitor.active.add(request.subscriptionId)
      if (monitor.holding) await new Promise<void>((resolve, reject) => { monitor.held.push({ request, resolve, reject }) })
      return { subscriptionId: request.subscriptionId, intervalMs: 5000 }
    },

    async stop(subscriptionId: string): Promise<MonitorStopResult> {
      monitor.stops.push(subscriptionId)
      return { stopped: monitor.active.delete(subscriptionId) }
    },

    /** 让所有挂起的 start 回复。 */
    release(): void { for (const entry of monitor.held.splice(0)) entry.resolve() },

    /** 让所有挂起的 start 失败。 */
    fail(message: string): void { for (const entry of monitor.held.splice(0)) entry.reject(new Error(message)) },

    /** 一个订阅被停了几次。停止是幂等的，但重复的请求会让这条断言失去意义。 */
    stopsOf(subscriptionId: string): number { return monitor.stops.filter(stop => stop === subscriptionId).length },

    /** 合成一条 monitor:update。 */
    update(update: MonitorUpdate): void { emit('updates', update) },

    /** 合成一条 session:facts。 */
    facts(facts: SessionFacts): void { emit('facts', facts) },

  }

  const hosts: HostRecord[] = [{ id: 'fixture', label: 'Fixture', host: 'localhost', username: 'demo', port: 22, authMethod: 'password', hasSecret: false, updatedAt: '' }]

  const keys: KeyRecord[] = []

  const api: SshApi = {

    carrier: 'web', getCapabilities: async () => ({ credentialPersistence: 'session', privateKeyPicker: 'browser' }),

    open: async () => { const sessionId = `test-${++stats.opens}`; emit('opened', sessionId, 80, 24); return { sessionId, host: 'localhost', cols: 80, rows: 24 } },

    close: id => { stats.closes++; emit('closed', id, wire('host.session-closed')) },

    input: () => { stats.inputs++ }, resize: (sessionId, cols, rows) => { stats.resizes.push({ sessionId, cols, rows }) }, pickPrivateKey: async () => undefined,

    onOpened: listener => subscribe('opened', listener), onData: listener => subscribe('data', listener), onClosed: listener => subscribe('closed', listener),

    onDisconnected: listener => subscribe('disconnected', listener),

    hosts: { list: async () => hosts, save: async () => hosts[0]!, remove: async () => true },

    keychain: { list: async () => [...keys], save: async request => {

      const record = { id: request.id ?? `key-${keys.length}`, label: request.label, type: 'RSA', publicKey: 'ssh-rsa fixture', fingerprint: 'SHA256:fixture', hasPassphrase: !!request.passphrase, updatedAt: '' }

      const index = keys.findIndex(key => key.id === record.id)

      if (index < 0) keys.push(record); else keys[index] = record

      return record

    }, remove: async id => { const index = keys.findIndex(key => key.id === id); if (index >= 0) keys.splice(index, 1); return index >= 0 } },

    sftp: { list: async () => { stats.lists++; return { path: '/home', parent: '/', entries: [] } }, read: async () => ({ path: '', size: 0, bytes: new Uint8Array() }),

      write: async () => ({ path: '', size: 0 }), mkdir: async () => {}, remove: async () => {} },

    monitor: {
      start: request => monitor.start(request),
      stop: subscriptionId => monitor.stop(subscriptionId),
      onUpdate: (listener: (update: MonitorUpdate) => void) => subscribe('updates', listener),
      onSessionFacts: (listener: (facts: SessionFacts) => void) => subscribe('facts', listener),
    },

    signalReady: payload => { stats.ready.push(payload) }, dispose: () => { stats.disposed++ },

  }

  const terminals: FakeTerminal[] = []

  const terminalFactory = (): FakeTerminal => {

    const inputs = new Set<(data: string) => void>()

    const resizeListeners = new Set<(size: { cols: number; rows: number }) => void>()

    const device = { cols: 80, rows: 24, disposed: 0, themeCalls: 0, inputs, resizeListeners, writes: [] as unknown[],

      write(data: unknown) { this.writes.push(data) }, focus() {}, fit() {}, text: () => '',

      applyTheme() { this.themeCalls++ },

      onData(listener: (data: string) => void) { inputs.add(listener); return { dispose: () => { inputs.delete(listener) } } },

      onResize(listener: (size: { cols: number; rows: number }) => void) { resizeListeners.add(listener); return { dispose: () => { resizeListeners.delete(listener) } } },

      dispose() { this.disposed++ },

    }

    terminals.push(device)

    return device

  }

  return { api, hosts, keys, stats, listeners, terminals, terminalFactory, emit, monitor }

}

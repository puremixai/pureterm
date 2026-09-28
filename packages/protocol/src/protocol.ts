/**
 * Shared UI ⇄ Host business protocol and minimal Desktop shell channels.
 *
 * Business methods, notices and events use WebSocket in Desktop and standalone
 * Web. Electron IPC carries only bootstrap and renderer readiness. Keeping both
 * channel sets here prevents the UI, Host and Desktop shell from drifting.
 *
 * This file has no imports so browser, Node and Electron consumers can share it.
 * The WebSocket carrier assigns opaque client IDs; Host never interprets a
 * webContents ID.
 */

/** 请求/响应：客户端发方法 + 参数，服务端回值或抛错。 */
export const METHODS = {
  appCapabilities: 'app:capabilities',
  sshOpen: 'ssh:open',
  sshPickPrivateKey: 'ssh:pick-private-key',
  hostsList: 'hosts:list',
  hostsSave: 'hosts:save',
  hostsRemove: 'hosts:remove',
  keysList: 'keys:list',
  keysSave: 'keys:save',
  keysRemove: 'keys:remove',
  sftpList: 'sftp:list',
  sftpRead: 'sftp:read',
  sftpWrite: 'sftp:write',
  sftpMkdir: 'sftp:mkdir',
  sftpRemove: 'sftp:remove',
  monitorStart: 'monitor:start',
  monitorStop: 'monitor:stop',
} as const

/** 单向通知：客户端发完就走，不回值（回值了也没人接）。 */
export const NOTICES = {
  sshInput: 'ssh:input',
  sshResize: 'ssh:resize',
  sshClose: 'ssh:close',
  appReady: 'app:renderer-ready',
  appDispose: 'app:dispose-client',
} as const

/**
 * Minimal Electron shell coordination; business traffic always uses WebSocket.
 *
 * The three window channels exist because the top bar draws its own minimize,
 * maximize and close buttons. Only the main process can move a window, so the
 * renderer has to ask — and because it draws them, the shell must not also ask
 * Windows or Linux to paint a second set (see shell.ts). macOS keeps its traffic
 * lights, so it never asks for these three.
 */
export const DESKTOP_CHANNELS = {
  bootstrap: 'desktop:bootstrap',
  ready: 'desktop:renderer-ready',
  windowMinimize: 'desktop:window-minimize',
  windowToggleMaximize: 'desktop:window-toggle-maximize',
  windowClose: 'desktop:window-close',
} as const

/** 服务端推给客户端的事件。客户端只订阅，不回应。 */
export const EVENTS = {
  terminalOpened: 'terminal:opened',
  terminalData: 'terminal:data',
  terminalClosed: 'terminal:closed',
  monitorUpdate: 'monitor:update',
  sessionFacts: 'session:facts',
} as const

export type MethodName = (typeof METHODS)[keyof typeof METHODS]
export type NoticeName = (typeof NOTICES)[keyof typeof NOTICES]
export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

// ── 跨边界的数据形状 ──────────────────────────────────────────────

export type AuthMethod = 'password' | 'privateKey'

export interface HostRecord {
  id: string
  label: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** 只记路径，不记私钥本体 */
  privateKeyPath?: string
  keyId?: string
  hasSecret: boolean
  updatedAt: string
}

export interface TerminalOpenResult {
  sessionId: string
  host: string
  cols: number
  rows: number
}

/** 渲染层开终端的请求。注意这里**没有** clientId：身份由载体认定，客户端无法自称。 */
export interface TerminalOpenRequest {
  host: string
  port?: number
  username: string
  authMethod?: AuthMethod
  password?: string
  privateKey?: string
  privateKeyPath?: string
  /** Resolve a Keychain key inside Host; saved private material never returns to the UI. */
  keyId?: string
  passphrase?: string
  hostId?: string
  acceptUnknownHostKey?: boolean
  cols?: number
  rows?: number
  term?: string
}

/** 渲染层上报「我初始化完成了」。宿主据此开就绪闸门。 */
export interface RendererReadyPayload {
  ok: boolean
  hosts: number
  cols: number
  rows: number
  error?: string
}

/** 选私钥文件的结果。error 存在时界面直接显示，path 仍然回填，方便用户自己看。 */
export interface PickedPrivateKey {
  path: string
  encrypted?: boolean
  error?: string
}

export interface HostSaveRequest {
  id?: string
  label?: string
  host: string
  port?: number
  username: string
  password?: string
  authMethod?: AuthMethod
  privateKeyPath?: string
  /** Empty string explicitly switches back to a directly selected key file. */
  keyId?: string
  passphrase?: string
  rememberPassword?: boolean
}

export const MAX_PRIVATE_KEY_BYTES = 256 * 1024

/** Public key metadata only. Private keys and passphrases are write-only. */
export interface KeyRecord {
  id: string
  label: string
  type: string
  publicKey: string
  fingerprint: string
  hasPassphrase: boolean
  updatedAt: string
}

export interface KeySaveRequest {
  id?: string
  label: string
  /** Omit when renaming an existing key without replacing its private material. */
  privateKey?: string
  passphrase?: string
  /** Optional verification; Host derives the public key when omitted. */
  publicKey?: string
}

// ── SFTP ─────────────────────────────────────────────────────────
//
// 传的是**字节**，不是本地路径：早先想过让后端接一个「本地路径」然后
// 用 ssh2 的 fastGet/fastPut——那样在 Web 载体下就把文件放到**后端那台机器**上了
// （用户可能正坐在另一台机器前用浏览器），而且还要在后端开一个本地文件对话框。
// 现在整份内容走 base64 + JSON 过线，两端各自处理「本地文件」：
// Electron 里有 Blob 下载，浏览器里也有 Blob 下载，同一个渲染层产物、零分叉。
//
// 代价是**整个文件都在内存里**，所以有上限（见 MAX_TRANSFER_BYTES）。

/**
 * 单次传输的字节上限。
 *
 * 为什么是 4 MiB：文件内容要过一遍 base64 打标签（膨胀 4/3），再加上 JSON 的壳；
 * 而 WebSocket 载体单条报文的上限是 8 MiB（`packages/transport/src/ws-frame.ts` 的 MAX_MESSAGE_BYTES）。
 * 4 MiB 的原文约合 5.4 MiB 的报文，留了余量。**这不是随手取的一个「够用」的数**：
 * 越过这条线，Web 载体上会先断在帧解码那一步，报的是「报文过大」而不是「文件太大」，
 * 用户根本查不出来。
 *
 * 定义在这里而不是后端：**两端都要用**——后端拿它做最后一道闸门，
 * 渲染层拿它在点「下载」之前就说清楚（列表里本来就有 size，不必白跑一趟再被拒）。
 * 一个数只有一份定义，才不会两边对不上。
 */
export const MAX_TRANSFER_BYTES = 4 * 1024 * 1024

/**
 * 远端目录里的一项。
 *
 * `path` 是**后端拼好的**绝对路径，不是让界面自己拼：远端路径是 POSIX，
 * 而界面跑在哪个操作系统上不由我们决定；何况拼错一次就会去操作另一个文件。
 */
export interface SftpEntry {
  name: string
  /** 拼好的远端绝对路径，可直接回传给 read/remove */
  path: string
  isDirectory: boolean
  isSymlink: boolean
  /** 字节数。目录和符号链接上这个值没有意义 */
  size: number
  /** 秒级 Unix 时间戳（SFTP 的 attrs.mtime 就是秒） */
  mtime: number
  /** 权限位。低 9 位是 rwx；对端没给属性时是 0 */
  mode: number
}

export interface SftpDir {
  /** 对端 realpath 之后的绝对路径，不一定是请求里那一个（`.` 会解成 home） */
  path: string
  /**
   * 上一级的绝对路径；已经在根上时是 null。
   *
   * 由后端算好一并返回，而不是让界面从 path 里切一段：**「上一级」是远端路径的语义**，
   * 规则只能有一份。界面自己切的话，根目录、`~` 展开后的路径、末尾多余的斜杠
   * 这几种情况都得各写一遍，而写错的后果是「点上级去了一个莫名其妙的地方」。
   */
  parent: string | null
  entries: SftpEntry[]
}

export interface SftpReadResult {
  path: string
  /** 实际送出的字节数。故意不抄 stat 的 size：两者不等时，用户该看到真实发生的事 */
  size: number
  bytes: Uint8Array
}

export interface SftpWriteResult {
  /** 真正写进去的绝对路径 */
  path: string
  size: number
}

// ── 会话监控 ──────────────────────────────────────────────────────
//
// 一台远端 Linux 主机的资源指标，以及它这条连接的握手事实。两者形状不同，
// 因为生命周期不同：指标是每 5,000 ms 一次的快照，会变、需要订阅、会被取消；
// 握手事实在一条连接内固定不变，只在 rekey 时重发，所以没有订阅也没有定时器
// —— 把常量塞进轮询流里，只会让「每个 ready 字段都是新的」这句话同时有两个意思。

export interface MonitorStartRequest {
  sessionId: string
  subscriptionId: string
}

export interface MonitorStartResult {
  subscriptionId: string
  /** 探测完成之后到下一次探测的间隔，不是周期起点之间的间隔 */
  intervalMs: 5000
}

export interface MonitorStopResult {
  stopped: boolean
}

/** 一条指标。null 表示这一次没量到，不等于 0；issues 里必须有对应的原因。 */
export type MonitorMetric = 'cpu' | 'memory' | 'load' | 'disk' | 'net' | 'uptime'

/** `warming-up` 只给 CPU 和网络：只有它们是两个样本的增量。 */
export type MonitorIssue = 'warming-up' | 'unavailable' | 'invalid-data'

export interface MonitorSnapshot {
  /** 本地 Host 的 Unix 时间，毫秒 */
  collectedAt: number
  cpuPercent: number | null
  memory: { usedBytes: number; totalBytes: number; usedPercent: number } | null
  load: { one: number; five: number; fifteen: number } | null
  disk: { mount: '/'; usedBytes: number; totalBytes: number; availableBytes: number; usedPercent: number } | null
  net: { receivedBytesPerSecond: number; transmittedBytesPerSecond: number } | null
  /** 远端**主机**的 uptime，不是本会话的时长 */
  uptimeSeconds: number | null
  issues: Partial<Record<MonitorMetric, MonitorIssue>>
}

export interface MonitorUpdate {
  sessionId: string
  subscriptionId: string
  sequence: number
  status: 'ready' | 'partial' | 'unsupported' | 'error'
  snapshot: MonitorSnapshot | null
  /** 远端可控文本：按文本渲染，绝不当作标记语言。上限 512 字符 */
  message?: string
}

export interface SessionFacts {
  sessionId: string
  /** 每个会话每次握手自增，所以 rekey 会用更高的值取代更早的一组 */
  revision: number
  /** ssh2 协商出的算法名，不是指纹。用户在 TOFU 时确认过的指纹留在 known_hosts */
  serverHostKey: string
  /** 两个方向各自协商。打印时按 cs，只有两者不同才把 sc 也显示出来 */
  cipher: { clientToServer: string; serverToClient: string }
}

export const MONITOR_METRICS: readonly MonitorMetric[] = ['cpu', 'memory', 'load', 'disk', 'net', 'uptime']
export const MONITOR_ISSUES: readonly MonitorIssue[] = ['warming-up', 'unavailable', 'invalid-data']

/** 会话 ID 的上下限，start 请求与事件用同一套。 */
export const MAX_SESSION_ID_LENGTH = 128
/** 订阅 ID 的字符集：UI 每次激活新建一个 UUID。 */
export const SUBSCRIPTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_MESSAGE_LENGTH = 512
/** 算法名由服务端选择，却要进状态栏，所以只收算法名真正会用的字符。 */
const ALGORITHM_PATTERN = /^[A-Za-z0-9@._+-]{1,128}$/

const isSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const isPositiveSafeInteger = (value: unknown): value is number => isSafeInteger(value) && value > 0
const isNonNegativeSafeInteger = (value: unknown): value is number => isSafeInteger(value) && value >= 0
const isNonNegativeFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function fail(what: string): never {
  throw new Error(`监控负载不合法：${what}`)
}

function checkIdentity(value: Record<string, unknown>, what: string): void {
  if (typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > MAX_SESSION_ID_LENGTH) {
    fail(`${what}的 sessionId`)
  }
  if (typeof value.subscriptionId !== 'string' || !SUBSCRIPTION_ID_PATTERN.test(value.subscriptionId)) {
    fail(`${what}的 subscriptionId`)
  }
}

/** 百分比只收 0..100 的有限值，且**拒绝**而不是夹紧：夹紧会把坏数据画成一个像样的数字。 */
function checkPercent(value: unknown, what: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) fail(what)
}

function parseMemory(value: unknown): MonitorSnapshot['memory'] {
  if (value === null) return null
  if (!isRecord(value)) fail('memory')
  const { usedBytes, totalBytes, usedPercent } = value
  if (!isPositiveSafeInteger(totalBytes)) fail('memory.totalBytes')
  if (!isNonNegativeSafeInteger(usedBytes) || usedBytes > totalBytes) fail('memory.usedBytes')
  checkPercent(usedPercent, 'memory.usedPercent')
  return { usedBytes, totalBytes, usedPercent }
}

function parseLoad(value: unknown): MonitorSnapshot['load'] {
  if (value === null) return null
  if (!isRecord(value)) fail('load')
  for (const key of ['one', 'five', 'fifteen'] as const) {
    if (!isNonNegativeFinite(value[key])) fail(`load.${key}`)
  }
  return { one: value.one as number, five: value.five as number, fifteen: value.fifteen as number }
}

function parseDisk(value: unknown): MonitorSnapshot['disk'] {
  if (value === null) return null
  if (!isRecord(value)) fail('disk')
  const { mount, usedBytes, totalBytes, availableBytes, usedPercent } = value
  if (mount !== '/') fail('disk.mount')
  if (!isPositiveSafeInteger(totalBytes)) fail('disk.totalBytes')
  // 保留块让 used + available 可以小于 total，但各自都不能超过它。
  if (!isNonNegativeSafeInteger(usedBytes) || usedBytes > totalBytes) fail('disk.usedBytes')
  if (!isNonNegativeSafeInteger(availableBytes) || availableBytes > totalBytes) fail('disk.availableBytes')
  checkPercent(usedPercent, 'disk.usedPercent')
  return { mount: '/', usedBytes, totalBytes, availableBytes, usedPercent }
}

function parseNet(value: unknown): MonitorSnapshot['net'] {
  if (value === null) return null
  if (!isRecord(value)) fail('net')
  const { receivedBytesPerSecond, transmittedBytesPerSecond } = value
  if (!isNonNegativeFinite(receivedBytesPerSecond)) fail('net.receivedBytesPerSecond')
  if (!isNonNegativeFinite(transmittedBytesPerSecond)) fail('net.transmittedBytesPerSecond')
  return { receivedBytesPerSecond, transmittedBytesPerSecond }
}

function parseIssues(
  value: unknown,
  available: Readonly<Record<MonitorMetric, boolean>>,
): { issues: MonitorSnapshot['issues']; count: number } {
  if (!isRecord(value)) fail('issues')
  const issues: MonitorSnapshot['issues'] = {}
  for (const key of Object.keys(value)) {
    if (!(MONITOR_METRICS as readonly string[]).includes(key)) fail(`issues.${key}`)
  }
  let count = 0
  for (const metric of MONITOR_METRICS) {
    const issue = value[metric]
    if (issue === undefined) continue
    if (!(MONITOR_ISSUES as readonly string[]).includes(issue as string)) fail(`issues.${metric}`)
    // 只有增量指标能说「预热中」：内存、负载、磁盘、uptime 一次就读得出来。
    if (issue === 'warming-up' && metric !== 'cpu' && metric !== 'net') fail(`issues.${metric}`)
    // 判定规则：可用指标不得带 issue，为 null 的指标必须恰好带一个。
    // 于是 issues 的键集合与 null 指标的集合完全一致，谁多谁少都是坏数据。
    if (available[metric]) fail(`issues.${metric}`)
    issues[metric] = issue as MonitorIssue
    count++
  }
  return { issues, count }
}

function parseSnapshot(value: unknown): { snapshot: MonitorSnapshot; available: number } {
  if (!isRecord(value)) fail('snapshot')
  if (!isNonNegativeSafeInteger(value.collectedAt)) fail('snapshot.collectedAt')
  if (value.cpuPercent !== null) checkPercent(value.cpuPercent, 'cpuPercent')
  if (value.uptimeSeconds !== null && !isNonNegativeFinite(value.uptimeSeconds)) fail('uptimeSeconds')
  const snapshot: MonitorSnapshot = {
    collectedAt: value.collectedAt,
    cpuPercent: value.cpuPercent as number | null,
    memory: parseMemory(value.memory),
    load: parseLoad(value.load),
    disk: parseDisk(value.disk),
    net: parseNet(value.net),
    uptimeSeconds: value.uptimeSeconds as number | null,
    issues: {},
  }
  const present = {
    cpu: snapshot.cpuPercent !== null,
    memory: snapshot.memory !== null,
    load: snapshot.load !== null,
    disk: snapshot.disk !== null,
    net: snapshot.net !== null,
    uptime: snapshot.uptimeSeconds !== null,
  }
  const available = MONITOR_METRICS.filter(metric => present[metric]).length
  const { issues, count } = parseIssues(value.issues, present)
  // 每个为 null 的指标都要有原因，否则「没量到」会读成「没有这一项」。
  if (count !== MONITOR_METRICS.length - available) fail('issues 与 null 指标不匹配')
  snapshot.issues = issues
  return { snapshot, available }
}

/**
 * 校验一个监控事件。UI transport 捕获这里的异常并忽略整条事件。
 *
 * 状态与快照必须自洽，所以数量规则也在这里判定：`ready` 是六个指标全可用且
 * issues 为空，`partial` 是一到五个可用，零个可用不是「全 null 的 partial」
 * 而是 `snapshot: null` 的 `error`。
 */
export function parseMonitorUpdate(value: unknown): MonitorUpdate {
  if (!isRecord(value)) fail('update')
  checkIdentity(value, 'update')
  if (!isPositiveSafeInteger(value.sequence)) fail('sequence')
  const status = value.status
  if (status !== 'ready' && status !== 'partial' && status !== 'unsupported' && status !== 'error') fail('status')
  let message: string | undefined
  if (value.message !== undefined) {
    if (typeof value.message !== 'string' || value.message.length > MAX_MESSAGE_LENGTH) fail('message')
    message = value.message
  }
  if (status === 'error' || status === 'unsupported') {
    if (value.snapshot !== null) fail(`${status} 的 snapshot`)
    if (!message) fail(`${status} 的 message`)
    return {
      sessionId: value.sessionId as string,
      subscriptionId: value.subscriptionId as string,
      sequence: value.sequence,
      status,
      snapshot: null,
      ...(message ? { message } : {}),
    }
  }
  if (value.snapshot === null || value.snapshot === undefined) fail(`${status} 的 snapshot`)
  const { snapshot, available } = parseSnapshot(value.snapshot)
  if (status === 'ready' && available !== MONITOR_METRICS.length) fail('ready 的指标数量')
  if (status === 'partial' && (available < 1 || available >= MONITOR_METRICS.length)) fail('partial 的指标数量')
  return {
    sessionId: value.sessionId as string,
    subscriptionId: value.subscriptionId as string,
    sequence: value.sequence,
    status,
    snapshot,
    ...(message ? { message } : {}),
  }
}

/**
 * 校验一组会话事实。和 `parseMonitorUpdate` 一样不得有任何导入。
 *
 * 返回的是**构建出来**的对象，不是原负载：`kex`、mac、compression、software
 * 都在同一份 ssh2 负载里，但没有一个界面会渲染它们，没有读取方的字段就是
 * 没有测试能钉住的字段。
 */
export function parseSessionFacts(value: unknown): SessionFacts {
  if (!isRecord(value)) fail('session facts')
  if (typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > MAX_SESSION_ID_LENGTH) {
    fail('session facts 的 sessionId')
  }
  if (!isPositiveSafeInteger(value.revision)) fail('revision')
  const serverHostKey = value.serverHostKey
  if (typeof serverHostKey !== 'string' || !ALGORITHM_PATTERN.test(serverHostKey)) fail('serverHostKey')
  if (!isRecord(value.cipher)) fail('cipher')
  const { clientToServer, serverToClient } = value.cipher
  if (typeof clientToServer !== 'string' || !ALGORITHM_PATTERN.test(clientToServer)) fail('cipher.clientToServer')
  if (typeof serverToClient !== 'string' || !ALGORITHM_PATTERN.test(serverToClient)) fail('cipher.serverToClient')
  return {
    sessionId: value.sessionId,
    revision: value.revision,
    serverHostKey,
    cipher: { clientToServer, serverToClient },
  }
}

// ── 渲染层要用的那份 API ──────────────────────────────────────────
//
// Shared by the browser UI and the Desktop shell. Business operations use the
// same WebSocket API in both entry points; the Desktop bridge only bootstraps it.

export type CarrierKind = 'web'

export interface DesktopBootstrap {
  webSocketUrl: string
}

export interface DesktopBridge {
  bootstrap(): Promise<DesktopBootstrap>
  signalReady(payload: RendererReadyPayload): void
  /**
   * The top bar's three self-drawn window buttons, where the platform draws none.
   *
   * Optional, and absent for two different reasons that the renderer treats the
   * same way — by not drawing the cluster at all rather than drawing it inert:
   * a browser tab (the standalone Web entry) has no window to minimize, and macOS
   * keeps its own traffic lights under titleBarStyle: 'hidden'. Which platform
   * gets them is `drawsOwnWindowControls` in the Desktop's platform plan.
   *
   * `toggleMaximize` is one call rather than maximize/restore because the main
   * process is the only side that knows which of the two the window is in.
   */
  windowControls?: {
    minimize(): void
    toggleMaximize(): void
    close(): void
  }
}

/** 宿主能力与入口无关：Desktop 的浏览器入口也支持系统凭据与原生选文件。 */
export interface RuntimeCapabilities {
  credentialPersistence: 'encrypted' | 'session'
  privateKeyPicker: 'native' | 'browser'
}

export interface SshApi {
  /** 给状态栏用：现在走的是哪个载体（排查问题时第一眼要看的东西） */
  readonly carrier: CarrierKind
  getCapabilities(): Promise<RuntimeCapabilities>
  open(payload: TerminalOpenRequest): Promise<TerminalOpenResult>
  input(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  close(sessionId: string): void
  pickPrivateKey(): Promise<PickedPrivateKey | undefined>
  onOpened(listener: (sessionId: string, cols: number, rows: number) => void): () => void
  onData(listener: (sessionId: string, chunk: Uint8Array) => void): () => void
  onClosed(listener: (sessionId: string, reason: string) => void): () => void
  /** Carrier connection loss, including when no SSH terminal is open. */
  onDisconnected(listener: (reason: string) => void): () => void
  /** Release this client's subscriptions and transport resources. */
  dispose(): void
  hosts: {
    list(): Promise<HostRecord[]>
    save(input: HostSaveRequest): Promise<HostRecord>
    remove(id: string): Promise<boolean>
  }
  keychain: {
    list(): Promise<KeyRecord[]>
    save(input: KeySaveRequest): Promise<KeyRecord>
    remove(id: string): Promise<boolean>
  }
  /**
   * 远端文件。全部作用在**已经打开的会话**上（SFTP 是新开一个子系统通道，
   * 不是新建一个连接），所以每个方法都要 sessionId。
   *
   * 「已存在的东西」按路径说，「要新建的东西」按「在哪、叫什么」说——
   * 这不是随手定的：`write` / `mkdir` 若收一个完整路径，界面就得自己拼
   * 「当前目录 + 名字」，于是 POSIX 的路径规则要在渲染层和后端各实现一遍，
   * 两边一旦不一致就会静默地操作到另一个文件。改成「目录 + 名字」之后，
   * 拼接只发生在后端一处，而且“名字必须单独一段”这条校验顺理成章地落在那里——
   * 它同时是一道安全边界：名字里带着 `../../` 也建不到别处去。
   */
  sftp: {
    /** path 传 `.` 就是从 home 开始：SFTP 子系统的初始目录就是用户的 home */
    list(sessionId: string, path: string): Promise<SftpDir>
    read(sessionId: string, path: string): Promise<SftpReadResult>
    /** dir 必须是已存在的目录（默认 `.`）；name 必须是单独一段，不能带 `/` */
    write(sessionId: string, dir: string, name: string, bytes: Uint8Array): Promise<SftpWriteResult>
    mkdir(sessionId: string, dir: string, name: string): Promise<void>
    /** 目录还是文件由后端 stat 决定，调用方不用报（它拿到的可能是过期信息） */
    remove(sessionId: string, path: string): Promise<void>
  }
  /**
   * 远端主机指标与会话事实。
   *
   * `start`/`stop` 是请求，`onUpdate`/`onSessionFacts` 是两条**互相独立**的事件流：
   * 事实没有请求侧——客户端没有什么要问的，而且无论有没有客户端想要，握手结果
   * 都已经存在——所以这里没有 `sessionFacts()` 方法，事实也不会启动、停止或
   * 门控任何订阅。取消订阅就是调用 `onUpdate`/`onSessionFacts` 返回的那个函数。
   */
  monitor: {
    start(request: MonitorStartRequest): Promise<MonitorStartResult>
    stop(subscriptionId: string): Promise<MonitorStopResult>
    onUpdate(listener: (update: MonitorUpdate) => void): () => void
    onSessionFacts(listener: (facts: SessionFacts) => void): () => void
  }
  signalReady(payload: RendererReadyPayload): void
}

// ── WebSocket 载体的线格式 ────────────────────────────────────────
//
// 载体只搬这些东西，不理解业务。请求/响应用 id 配对，事件与通知不分 id
// ——因为事件是广播，没人会等它回。

export interface WireCall {
  kind: 'call'
  id: number
  method: string
  params: unknown[]
}

export interface WireNotice {
  kind: 'notice'
  name: string
  params: unknown[]
}

export type WireReply = { kind: 'reply'; id: number; ok: true; value: unknown } | { kind: 'reply'; id: number; ok: false; error: string }

export interface WireEvent {
  kind: 'event'
  name: string
  params: unknown[]
}

export type WireInbound = WireCall | WireNotice
export type WireOutbound = WireReply | WireEvent

export function isWireCall(message: unknown): message is WireCall {
  const candidate = message as WireCall | null
  return !!candidate && candidate.kind === 'call' && typeof candidate.id === 'number' && typeof candidate.method === 'string'
}

export function isWireNotice(message: unknown): message is WireNotice {
  const candidate = message as WireNotice | null
  return !!candidate && candidate.kind === 'notice' && typeof candidate.name === 'string'
}

// ── 字节在 JSON 里的表示 ──────────────────────────────────────────
//
// 终端输出是**字节**（`terminal:data` 的 payload 是 Buffer），而 JSON 只有
// number/string/object。`JSON.stringify(new Uint8Array([1,2]))` 会得到 `{"0":1,"1":2}`
// ——一个既不是字节也不是数组的东西，静默地把数据搞坏。
//
// 所以过线前统一打标签：`Uint8Array` → `{ $bytes: <base64> }`，递归处理对象的成员。
// 选 base64 而不是「转成数组」：数组会膨胀 3~4 倍且要多一轮 JSON 数字解析；
// 选它而不是「二进制帧」：协议保持「一律 JSON」，载体不用按事件名分叉。
// 本机 loopback 上这点编码开销（几 KB 级）可以忽略。
//
// 注意 `btoa`/`atob` 在浏览器和 Node 16+ 都是全局的，所以这里不需要 import
// （这个文件不许 import 任何东西，见文件头）。

export const BYTES_TAG = '$bytes'

/** 一次转换的字节数。防止 `String.fromCharCode(...big)` 把调用栈撑爆。 */
const BYTES_CHUNK = 0x8000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += BYTES_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BYTES_CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function isTaggedBytes(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  // 只有一个键才认：免得把恰好含 $bytes 字段的业务对象当成字节
  return Object.keys(candidate).length === 1 && typeof candidate[BYTES_TAG] === 'string'
}

/** 出线：Uint8Array → { $bytes }。数组与普通对象逐项递归，其余原样。 */
export function encodeWire(value: unknown): unknown {
  if (isBytes(value)) return { [BYTES_TAG]: bytesToBase64(value) }
  if (Array.isArray(value)) return value.map(encodeWire)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source)) out[key] = encodeWire(source[key])
    return out
  }
  return value
}

/** 入线：{ $bytes } → Uint8Array。与 encodeWire 对称。 */
export function decodeWire(value: unknown): unknown {
  if (isTaggedBytes(value)) return base64ToBytes(value[BYTES_TAG])
  if (Array.isArray(value)) return value.map(decodeWire)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source)) out[key] = decodeWire(source[key])
    return out
  }
  return value
}

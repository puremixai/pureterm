/**
 * 渲染层 ⇄ 壳：**唯一的**协议定义处。
 *
 * 为什么必须单独一个文件：以前通道名在 `electron/app/main.ts`（`ipcMain.handle('ssh:open', …)`）
 * 和 `electron/carriers/preload.ts`（`ipcRenderer.invoke('ssh:open')`）里各写了一遍字面量。
 * 两处一漂移，症状就是「界面点了没反应」——最难查的一类错，而且换载体时
 * （IPC → WebSocket）还得保证两边一个字都不差。现在名字只定义一次，载体只是搬运工。
 *
 * 三条纪律：
 *  1. **这个文件不许 import 任何东西**——Node、Electron、DOM 都不行。
 *     它同时被主进程（tsconfig.main）、渲染层（tsconfig.renderer，`types: []`）和测试引用，
 *     任何一侧的全局对象漏进来都会让另一侧编不过。
 *  2. 名字只在这里定义。载体与业务代码一律用常量，不许再写字面量。
 *  3. 客户端身份是**不透明的字符串** `clientId`，不是 Electron 的 webContents id——
 *     载体负责把「谁在说话」映射成这个 id，领域层只当它是个句柄。
 */

/** 请求/响应：客户端发方法 + 参数，服务端回值或抛错。 */
export const METHODS = {
  appCapabilities: 'app:capabilities',
  sshOpen: 'ssh:open',
  sshPickPrivateKey: 'ssh:pick-private-key',
  hostsList: 'hosts:list',
  hostsSave: 'hosts:save',
  hostsRemove: 'hosts:remove',
  sftpList: 'sftp:list',
  sftpRead: 'sftp:read',
  sftpWrite: 'sftp:write',
  sftpMkdir: 'sftp:mkdir',
  sftpRemove: 'sftp:remove',
} as const

/** 单向通知：客户端发完就走，不回值（回值了也没人接）。 */
export const NOTICES = {
  sshInput: 'ssh:input',
  sshResize: 'ssh:resize',
  sshClose: 'ssh:close',
  appReady: 'app:renderer-ready',
} as const

/** 服务端推给客户端的事件。客户端只订阅，不回应。 */
export const EVENTS = {
  terminalOpened: 'terminal:opened',
  terminalData: 'terminal:data',
  terminalClosed: 'terminal:closed',
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
  passphrase?: string
  rememberPassword?: boolean
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
 * 而 WebSocket 载体单条报文的上限是 8 MiB（`electron/carriers/ws-frame.ts` 的 MAX_MESSAGE_BYTES）。
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

// ── 渲染层要用的那份 API ──────────────────────────────────────────
//
// 放这里而**不是** renderer/transport.ts：preload（跑在 Node 侧、没有 DOM 类型）
// 也要按它来实现 IPC 载体，而 renderer/ 的文件引用 DOM。放在这个「谁都 import 得到、
// 自己谁也不 import」的文件里，两边才能共用同一个定义。

export type CarrierKind = 'ipc' | 'web'

/** 宿主能力与 IPC/WebSocket 载体无关：Desktop 的浏览器入口也支持系统凭据与原生选文件。 */
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
  onOpened(listener: (sessionId: string, cols: number, rows: number) => void): void
  onData(listener: (sessionId: string, chunk: Uint8Array) => void): void
  onClosed(listener: (sessionId: string, reason: string) => void): void
  hosts: {
    list(): Promise<HostRecord[]>
    save(input: HostSaveRequest): Promise<HostRecord>
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

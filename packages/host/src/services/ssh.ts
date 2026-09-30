import { Service, type Context } from 'cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Socket } from 'node:net'
import type { Client as SshClient, ClientChannel, ConnectConfig, NegotiatedAlgorithms, PseudoTtyOptions, SFTPWrapper } from 'ssh2'
import { StringDecoder } from 'node:string_decoder'
import { HostError, type SessionFacts } from '@pureterm/protocol'
import { HostKeyStore } from './host-key-store.js'

/*
 * ssh2 是 CommonJS，且它的 module.exports 无法被 Node 的命名导出探测识别
 * （实测 `import { Client } from 'ssh2'` 会抛 "Named export 'Client' not found"），
 * 所以运行时值用 createRequire 取，类型仍然来自 @types/ssh2。
 */
const nodeRequire = createRequire(import.meta.url)
const { Client } = nodeRequire('ssh2') as typeof import('ssh2')

declare module 'cordis' {
  interface Context {
    ssh: SshService
  }
  interface Events {
    /** 新会话建立。广播语义：谁关心谁订阅，不参与调用链。 */
    'ssh/session-opened'(sessionId: string, target: string): void
    /** 会话结束（正常关闭 / 断线 / 出错）。reason 永远非空，不允许静默消失。 */
    'ssh/session-closed'(sessionId: string, reason: HostError): void
    /** 首次记录某主机的密钥（TOFU）。 */
    'ssh/host-key-learned'(target: string, fingerprint: string): void
    /**
     * 握手完成（初次或 rekey）。广播语义，谁关心谁订阅。
     *
     * 事实放在会话记录上，所以**初次握手时这个事件还没有接收方**：握手在
     * ready 之前完成，而会话要到 ready 之后才登记。那不是漏发，而是「此刻
     * 还没有任何客户端拥有这个会话」；TerminalBridge 会在 terminal:opened 时
     * 把已存的事实补上。这里只负责在 rekey 时把新的一组广播出去。
     */
    'ssh/session-facts'(facts: SessionFacts): void
  }
}

export interface SshServiceConfig {
  knownHostsFile: string
  readyTimeout?: number
  keepaliveInterval?: number
}

export interface SshConnectOptions {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
  /**
   * 私钥文件路径。没有 privateKey 内容时按这个路径**现读**。
   *
   * 有意只存路径、不存内容：私钥是用户自己 `~/.ssh` 下的文件，
   * 复制一份到我们的数据目录等于把同一把钥匙多放一处，还没有原来那份的权限管理。
   */
  privateKeyPath?: string
  passphrase?: string
  /** 是否接受首次见到的主机密钥（TOFU）。默认 true；未知密钥永远会先被记录。 */
  acceptUnknownHostKey?: boolean
  /** 客户端断开或 Host 退出时取消仍在进行的连接。 */
  signal?: AbortSignal
}

/**
 * 读私钥文件。只读一次、不缓存——私钥不是我们的数据，用完即弃。
 *
 * 路径和 errno 都进 params，所以界面说的是「哪个文件、为什么」——而 errno 本身
 * 进 `message`，那是给日志看的、不做本地化的那一面。
 */
function readPrivateKey(path: string | undefined): string | undefined {
  if (!path) return undefined
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new HostError('ssh.key-file-unreadable', { path, reason: code ?? 'unknown' }, `read ${path}: ${(error as Error).message}`)
  }
}

export interface PtySize {
  cols: number
  rows: number
  term?: string
}

export interface SshSessionInfo {
  id: string
  host: string
  port: number
  username: string
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
  signal?: string
}

interface InternalSession extends SshSessionInfo {
  client: SshClient
  /** 由 Host 持有真实 socket，半关闭时也能强制释放，不依赖 ssh2.destroy 的可写判断。 */
  socket: Socket
  shell?: ClientChannel
  /** 已开好的 SFTP 子系统通道。按会话缓存，见 sftpSession() */
  sftp?: SFTPWrapper
  /** 正在开的那一次。并发请求共用它，不然会开出两条通道、其中一条再没人关 */
  sftpOpening?: Promise<SFTPWrapper>
  /**
   * 这个会话上还没结束的 exec。
   *
   * 会话被丢弃时要一次性拒绝它们：连接没了之后它们永远不会再收到数据，
   * 让调用方一直等到超时，等于把「连接断了」报成「命令太慢」。
   */
  execs: Set<(reason: HostError) => void>
  /** 最近一次握手的协商结果。ssh2 只在 handshake 事件里给一次，所以必须自己存。 */
  facts?: SessionFacts
  /**
   * 这个连接上唯一的 handshake 监听器。
   *
   * 存下来是为了能精确摘掉它：会话结束时不摘的话，一个反复重连的客户端会在
   * Host 已经丢弃的那些 client 上越积越多。
   */
  handshakeListener: (negotiated: NegotiatedAlgorithms) => void
  closed: boolean
}

/**
 * ssh2 的协商结果 -> 协议里的会话事实。
 *
 * 只取状态栏会渲染的三项。`kex`、mac、compression、lang 在同一份负载里，
 * 但没有任何界面会显示它们，而远端软件版本根本不在这个事件里。
 * 三项缺一就不发：状态栏宁可空着，也不要一个由 undefined 变来的算法名。
 */
function toSessionFacts(sessionId: string, revision: number, negotiated: NegotiatedAlgorithms | undefined): SessionFacts | null {
  const serverHostKey = negotiated?.serverHostKey
  const clientToServer = negotiated?.cs?.cipher
  const serverToClient = negotiated?.sc?.cipher
  if (!serverHostKey || !clientToServer || !serverToClient) return null
  return { sessionId, revision, serverHostKey, cipher: { clientToServer, serverToClient } }
}

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 把 ssh2 的英文底层错误认成一个**错误码**。
 *
 * 这里匹配的仍然是句子，但匹配的是 **ssh2 自己的话**，不是宿主写的话：`ECONNREFUSED`、
 * `Cannot parse privateKey`、`Unable to start subsystem` 都是库吐出来的原文，没有
 * 第二份可对。认出来之后返回 `{code, params}`，句子由文案目录按当前语言给 ——
 * 从前这里返回的是一句中文散文，跨线之后渲染层只能原样显示，也就没法翻译。
 *
 * 认不出来的一律落到 `ssh.failed`，原文进 `message`（只进日志、以及渲染层遇到
 * 不认识的码时的兜底）。绝不猜：`ssh.failed` 是「连接失败」而不是「认证失败」。
 *
 * `context` 只影响「通道开不起来」这一类：ssh2 对子系统被拒和命令被拒报的是同一句
 * `Channel open failure`，但两件事的下一步完全不同（一个要改 sshd_config 的
 * `Subsystem sftp`，一个要看 ForceCommand / MaxSessions）。所以由调用方说明这是
 * 哪条通道，而不是让文案替用户猜。其它分支与 context 无关。
 *
 * 导出是为了能对**真实的 ssh2 文案**做表驱动测试（`tests/smoke-host.mjs`）：
 * 这些字符串是精确匹配出来的，抄错一个词就会静默失效、把失败报成 `ssh.failed`，
 * 而那正是已经犯过的错。纯函数，没有副作用。
 */
export function classifySshError(error: Error, host: string, port: number, context?: 'sftp' | 'exec'): HostError {
  const detail = error?.message ?? String(error)
  const at = { host, port }
  if (/All configured authentication methods failed/i.test(detail)) {
    return new HostError('ssh.auth-failed', undefined, detail)
  }
  // 「有口令但没给」要用户去填口令，「文件根本不是密钥」要用户换文件，「口令不对」才是猜错——
  // 三种得给三种不同的下一步动作，糊成一句「无法解析」用户不知道该怎么办。
  // 注意顺序：② 必须在 ③ 之前，因为 client 侧统一包成 `Cannot parse privateKey: <真因>`，③ 也能命中。
  if (/encrypted .*key detected, but no passphrase given/i.test(detail)) {
    return new HostError('ssh.key-passphrase-needed', undefined, detail)
  }
  if (/Unsupported key format|does not contain a \(valid\) private key/i.test(detail)) {
    return new HostError('ssh.key-unrecognized', undefined, detail)
  }
  if (
    /Cannot parse privateKey|Decryption failed|bad passphrase|Invalid key|integrity check failed|Failed to generate information to decrypt key/i.test(
      detail,
    )
  ) {
    return new HostError('ssh.key-unparseable', undefined, detail)
  }
  // TCP 通了、但对方在给出 SSH 横幅之前就断开。这条最容易把人带偏：用户会以为是密钥不对，
  // 其实连认证都还没走到。所以它是一个**单独的码**，不是「连接失败」的一种说法。
  if (/Connection lost before handshake/i.test(detail)) {
    return new HostError('ssh.banner-before-handshake', at, detail)
  }
  /*
   * 非交互命令通道开不起来。和 SFTP 那条共用同一句 ssh2 文案，所以必须靠 context
   * 分开：对探测说「SFTP 子系统没开」会把用户指向一个与失败无关的配置项。
   */
  if (context === 'exec' && /Channel open failure|Unable to exec|exec request failed/i.test(detail)) {
    return new HostError('ssh.exec-channel-refused', at, detail)
  }
  /*
   * SFTP 子系统开不起来。**这是「连上了但功能用不了」，不是认证失败**，
   * 所以必须和连接错误分开说：用户会以为是密码不对，然后去反复重填密码。
   * 这两句文案只可能来自子系统请求本身，所以不需要 context 就能认定。
   */
  if (/Unable to start subsystem|establishing SFTP session|SFTP session termination/i.test(detail)) {
    return new HostError('ssh.sftp-subsystem-unavailable', at, detail)
  }
  /*
   * 通道被拒，但调用方没说这是哪条通道（终端、SFTP 之外的情形）。
   * 这个码只能描述事实，不能替用户猜是哪一项配置的问题。
   */
  if (/Channel open failure/i.test(detail)) {
    return new HostError('ssh.channel-refused', at, detail)
  }
  if (/ECONNREFUSED/i.test(detail)) {
    return new HostError('ssh.connection-refused', at, detail)
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(detail)) {
    return new HostError('ssh.dns-failed', { host }, detail)
  }
  if (/ETIMEDOUT|Timed out while waiting|Timed out/i.test(detail)) {
    return new HostError('ssh.timeout', at, detail)
  }
  if (/Host verification failed|Host key verification failed/i.test(detail)) {
    return new HostError('ssh.host-key-verification-failed', at, detail)
  }
  if (/Socket closed|ECONNRESET/i.test(detail)) {
    return new HostError('ssh.connection-reset', at, detail)
  }
  return new HostError('ssh.failed', { ...at, detail }, detail)
}

/**
 * SshService —— 连接引擎。
 * 只做“连上去、开通道、收字节、把错误说清楚”，不碰 Electron，也不碰渲染层。
 */
export class SshService extends Service {
  private readonly sessions = new Map<string, InternalSession>()
  private readonly hostKeys: HostKeyStore
  private readonly readyTimeout: number
  private readonly keepaliveInterval: number
  private counter = 0

  constructor(ctx: Context, config: SshServiceConfig) {
    super(ctx, 'ssh')
    this.hostKeys = new HostKeyStore(config.knownHostsFile)
    this.readyTimeout = config.readyTimeout ?? 20_000
    this.keepaliveInterval = config.keepaliveInterval ?? 15_000

    // 卸载插件时兜底清理所有连接
    this.ctx.effect(
      () => () => {
        for (const session of [...this.sessions.values()]) {
          session.closed = true
          session.client.off('handshake', session.handshakeListener)
          try {
            session.client.end()
          } catch {
            /* 关闭阶段的异常不阻断卸载 */
          } finally {
            session.socket.destroy()
          }
        }
        this.sessions.clear()
      },
      'ssh.disposeAll',
    )
  }

  get size(): number {
    return this.sessions.size
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  list(): SshSessionInfo[] {
    return [...this.sessions.values()].map(({ id, host, port, username }) => ({ id, host, port, username }))
  }

  /**
   * 某个会话的握手事实。未知或已关闭的会话返回 null。
   *
   * 有意**不**加进 `SshSessionInfo`：`list()` 是公开的会话列表，而事实只在
   * 「这条连接上发生过什么」这个意义下属于会话，不该跟着列表一起被抄来抄去。
   */
  facts(sessionId: string): SessionFacts | null {
    return this.sessions.get(sessionId)?.facts ?? null
  }

  /**
   * 这个会话上还有几个 exec 没结束。
   *
   * 存在的理由是让「在途操作被清理干净」可以被断言，而不是只能相信一个已经
   * resolve 的 Promise。HostMonitor 的停止路径同样靠它确认自己没有留下在途探测。
   */
  pendingExecs(sessionId: string): number {
    return this.sessions.get(sessionId)?.execs.size ?? 0
  }

  knownHosts(): unknown {
    return this.hostKeys.list()
  }

  forgetHostKey(host: string, port: number): boolean {
    return this.hostKeys.forget(host, port)
  }

  async connect(options: SshConnectOptions): Promise<SshSessionInfo> {
    if (options.signal?.aborted) throw new HostError('ssh.client-disconnected')
    const host = options.host?.trim()
    const port = options.port ?? 22
    if (!host) throw new HostError('ssh.empty-host')
    if (!options.username) throw new HostError('ssh.empty-username')

    // 私钥内容优先用调用方给的；否则按路径现读（读不到时错误里带着文件名和原因）
    const privateKey = options.privateKey ?? readPrivateKey(options.privateKeyPath)
    if (!options.password && !privateKey && !process.env.SSH_AUTH_SOCK) {
      throw new HostError('ssh.missing-credential')
    }

    const acceptUnknown = options.acceptUnknownHostKey ?? true
    const verifier: { error?: HostError; learned?: string } = {}

    const config: ConnectConfig = {
      host,
      port,
      username: options.username,
      readyTimeout: this.readyTimeout,
      keepaliveInterval: this.keepaliveInterval,
      keepaliveCountMax: 3,
      // hostVerifier 必须在 connect() 之前注册；同步返回 boolean
      hostVerifier: (key: Buffer): boolean => {
        const verdict = this.hostKeys.check(host, port, key)
        if (verdict.status === 'match') return true
        if (verdict.status === 'changed') {
          verifier.error = new HostError('ssh.host-key-changed', {
            host, port, known: verdict.knownFingerprint ?? '', received: verdict.fingerprint,
          })
          return false
        }
        if (!acceptUnknown) {
          verifier.error = new HostError('ssh.first-connection', { fingerprint: verdict.fingerprint })
          return false
        }
        verifier.learned = this.hostKeys.remember(host, port, key)
        return true
      },
    }

    if (options.password) config.password = options.password
    if (privateKey) {
      config.privateKey = privateKey
      if (options.passphrase) config.passphrase = options.passphrase
    } else if (process.env.SSH_AUTH_SOCK) {
      config.agent = process.env.SSH_AUTH_SOCK
    }

    const socket = new Socket()
    config.sock = socket
    const client = new Client()
    const id = `ssh-${++this.counter}`

    /*
     * 握手在 ready **之前**完成，所以监听器必须在这之前挂上。
     *
     * 而且每个连接只有这一个：rekey 会让同一个监听器再响一次，而不是再挂一个。
     * 事实先攒在局部变量里，因为此刻会话还没登记 —— 那意味着还没有任何客户端
     * 拥有它，没有接收方。等 ready 之后登记会话时再把它挂上去。
     */
    const handshake: { facts?: SessionFacts } = {}
    const handshakeListener = (negotiated: NegotiatedAlgorithms): void => {
      const facts = toSessionFacts(id, (handshake.facts?.revision ?? 0) + 1, negotiated)
      if (!facts) return
      handshake.facts = facts
      const session = this.sessions.get(id)
      if (!session) return
      session.facts = facts
      this.ctx.emit('ssh/session-facts', facts)
    }
    client.on('handshake', handshakeListener)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        client.off('ready', onReady)
        client.off('error', onError)
        client.off('close', onClose)
        socket.off('error', onSocketError)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (error: HostError): void => {
        if (settled) return
        settled = true
        cleanup()
        // 失败的连接没有会话接管它，监听器必须在这里摘掉：留着的话，被取消的
        // 那几次握手会在永远不存在的会话上继续攒监听器。
        client.off('handshake', handshakeListener)
        // 被取消的握手没有会话接管它，销毁阶段也必须有 error 监听器。
        client.on('error', () => {})
        socket.on('error', () => {})
        socket.destroy()
        reject(error)
      }
      const onReady = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const onError = (error: Error): void => fail(verifier.error ?? classifySshError(error, host, port))
      const onSocketError = (error: Error): void => fail(classifySshError(error, host, port))
      const onClose = (): void => fail(new HostError('ssh.handshake-closed'))
      const onAbort = (): void => fail(new HostError('ssh.client-disconnected'))
      client.once('ready', onReady)
      client.once('error', onError)
      client.once('close', onClose)
      socket.once('error', onSocketError)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) { onAbort(); return }
      try {
        // ssh2 接管正在连接的 socket；先连接使其正确识别 connecting 状态。
        socket.connect({ host, port })
        client.connect(config)
      } catch (error) {
        // connect() 会把「私钥解析不了」这类问题**同步抛出**（不是走 error 事件），
        // 所以这条路径也必须过一遍翻译，否则用户看到的是 `Cannot parse privateKey: ...` 原文。
        const cause = error instanceof Error ? error : new Error(String(error))
        fail(verifier.error ?? classifySshError(cause, host, port))
      }
    })

    const session: InternalSession = {
      id, host, port, username: options.username, client, socket,
      execs: new Set(), handshakeListener, closed: false,
    }
    if (handshake.facts) session.facts = handshake.facts
    this.sessions.set(id, session)

    // ready 之后的长生命周期错误：必须有出口
    client.on('error', (error: Error) => this.drop(id, classifySshError(error, host, port)))
    client.on('close', () => this.drop(id, new HostError('ssh.connection-closed')))
    client.on('end', () => this.drop(id, new HostError('ssh.server-disconnected')))

    if (verifier.learned) this.ctx.emit('ssh/host-key-learned', `${host}:${port}`, verifier.learned)
    this.ctx.emit('ssh/session-opened', id, `${host}:${port}`)
    return { id, host, port, username: options.username }
  }

  /**
   * 申请一个交互式 shell。pty 参数必须带上：term 决定远端用不用 256 色，
   * cols/rows 决定远端第一帧的排版宽度（否则远端永远停在 80x24）。
   */
  async shell(sessionId: string, size: Partial<PtySize> = {}, signal?: AbortSignal): Promise<ClientChannel> {
    const session = this.requireSession(sessionId)
    const cols = clamp(size.cols, 20, 500, DEFAULT_COLS)
    const rows = clamp(size.rows, 5, 200, DEFAULT_ROWS)
    const pty: PseudoTtyOptions = {
      term: size.term ?? 'xterm-256color',
      cols,
      rows,
      width: cols * 8,
      height: rows * 18,
    }

    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      let settled = false
      const onAbort = (): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        reject(new HostError('ssh.client-disconnected'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { onAbort(); return }
      session.client.shell(pty, (error, channel) => {
        if (settled) { channel?.close(); return }
        settled = true
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(classifySshError(error, session.host, session.port))
        else resolve(channel)
      })
    })
    session.shell = stream
    return stream
  }

  /**
   * 在已有会话上开一个 SFTP 子系统通道。
   *
   * **按会话缓存**，不是每次现开：readdir / stat / read / write 全走这一条通道。
   * 每个操作现开一个的话，光浏览一次目录就要多两轮子系统握手，而且服务端会先受不了
   * ——OpenSSH 默认 MaxSessions 是 10，用光了报的是「通道打不开了」，
   * 完全看不出是「我们开得太随意」。
   *
   * 并发的两次请求（同时点下载和刷新）共用同一个 Promise：不共用就会开出两条通道，
   * 其中一条没有任何引用、也不会被关掉。
   */
  async sftpSession(sessionId: string): Promise<SFTPWrapper> {
    const session = this.requireSession(sessionId)
    if (session.sftp) return session.sftp

    if (!session.sftpOpening) {
      session.sftpOpening = new Promise<SFTPWrapper>((resolve, reject) => {
        session.client.sftp((error, sftp) => {
          if (error) reject(classifySshError(error, session.host, session.port, 'sftp'))
          else resolve(sftp)
        })
      })
    }

    try {
      const sftp = await session.sftpOpening
      session.sftp = sftp
      // 通道自己断掉（对端关掉子系统、连接抖了一下）要把缓存清掉。
      // 留着它的话，之后每一次操作都会打在一个死通道上，而 ssh2 报的错
      // 完全看不出是这个原因；清掉之后下次操作会自然地重开一条。
      sftp.once('close', () => {
        if (session.sftp === sftp) session.sftp = undefined
      })
      return sftp
    } finally {
      // 无论成功还是失败都清掉：失败时留着它就再也不会重试了
      session.sftpOpening = undefined
    }
  }

  /**
   * 在已有会话上跑一条非交互命令。
   *
   * 四条约束都是为了让监控探测不会把 Host 拖垮：
   *
   * 1. **超时从申请通道之前开始算。** 原来的计时器是在 ssh2 的回调里才起的，
   *    也就是「通道已经拿到」之后 —— 一个卡在打开通道的命令永远不会超时，而这
   *    恰好是探测最可能卡住的地方。
   * 2. **stdout 与 stderr 一起计数。** 只算 stdout 的话，一个往 stderr 灌数据的
   *    命令可以无限撑大内存，而探测命令出错时写的就是 stderr。
   * 3. **超限是拒绝，不是截断。** `ExecResult` 因此没有 `truncated` 了：一个被
   *    悄悄截断的 `/proc` 帧会被解析器当成格式错误，报出来的原因是「远端数据不
   *    合法」，而真正发生的是「我们自己把它切了」。
   * 4. **取消只关这一条通道。** 绝不 `client.end()`：终端和 SFTP 都挂在同一个
   *    连接上，探测失败不该把用户正在打字的会话一起带走。
   */
  async exec(
    sessionId: string,
    command: string,
    options: { maxBytes?: number; timeout?: number; signal?: AbortSignal } = {},
  ): Promise<ExecResult> {
    const session = this.requireSession(sessionId)
    const maxBytes = options.maxBytes ?? 1 << 20
    const { timeout, signal } = options

    return await new Promise<ExecResult>((resolve, reject) => {
      const outDecoder = new StringDecoder('utf8')
      const errDecoder = new StringDecoder('utf8')
      const out: string[] = []
      const err: string[] = []
      let channel: ClientChannel | null = null
      let stderr: NodeJS.ReadableStream | null = null
      let timer: NodeJS.Timeout | null = null
      let bytes = 0
      let code: number | null = null
      let signalName: string | undefined
      let settled = false

      /** 摘掉自己加的那些监听器。不用 removeAllListeners：那会连 ssh2 自己的内部监听一起摘掉。 */
      const detach = (): void => {
        if (channel) {
          channel.off('data', onData)
          channel.off('exit', onExit)
          channel.off('close', onClose)
          channel.off('error', onError)
        }
        stderr?.off('data', onStderr)
      }

      /**
       * 唯一的结束路径。四条出口（成功关闭、超时、取消、出错）都必须经过它，
       * 否则就会留下一个定时器、一个监听器，或者一条没人持有的通道。
       */
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        if (timer) { clearTimeout(timer); timer = null }
        signal?.removeEventListener('abort', onAbort)
        session.execs.delete(cancel)
        detach()
        finish()
      }

      const closeChannel = (): void => {
        try { channel?.close() } catch { /* 通道可能已经关了 */ }
      }
      const cancel = (error: HostError): void => settle(() => { closeChannel(); reject(error) })
      const onAbort = (): void => cancel(new HostError('ssh.exec-cancelled'))
      const onData = (chunk: Buffer): void => {
        if (settled) return
        bytes += chunk.length
        if (bytes > maxBytes) { cancel(new HostError('ssh.exec-output-limit', { limit: maxBytes })); return }
        out.push(outDecoder.write(chunk))
      }
      const onStderr = (chunk: Buffer): void => {
        if (settled) return
        bytes += chunk.length
        if (bytes > maxBytes) { cancel(new HostError('ssh.exec-output-limit', { limit: maxBytes })); return }
        err.push(errDecoder.write(chunk))
      }
      const onExit = (exitCode: number | null, exitSignal?: string): void => {
        code = exitCode
        signalName = exitSignal
      }
      const onClose = (): void => settle(() => {
        out.push(outDecoder.end())
        err.push(errDecoder.end())
        resolve({ stdout: out.join(''), stderr: err.join(''), code, signal: signalName })
      })
      const onError = (streamError: Error): void => settle(() => reject(classifySshError(streamError, session.host, session.port)))

      session.execs.add(cancel)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (timeout) timer = setTimeout(() => cancel(new HostError('ssh.exec-timeout', { timeout })), timeout)
      if (signal?.aborted) { onAbort(); return }

      session.client.exec(command, (error, opened) => {
        if (error) {
          settle(() => reject(classifySshError(error, session.host, session.port, 'exec')))
          return
        }
        // 超时或取消之后才到的通道：它没有任何人持有，必须当场关掉，
        // 否则远端会一直为我们保留一个打开的命令通道。
        if (settled) {
          try { opened.close() } catch { /* 已经关了 */ }
          return
        }
        channel = opened
        stderr = opened.stderr
        opened.on('data', onData)
        opened.stderr.on('data', onStderr)
        opened.on('exit', onExit)
        opened.on('close', onClose)
        opened.on('error', onError)
      })
    })
  }

  /** 主动断开：统一走 drop，保证只发一次 session-closed */
  dispose(sessionId: string, reason: HostError = new HostError('host.session-closed')): void {
    this.drop(sessionId, reason)
  }

  private requireSession(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new HostError('ssh.session-gone')
    return session
  }

  private drop(sessionId: string, reason: HostError): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.closed = true
    // 先拒在途的 exec，再拆连接：反过来的话，通道关闭会让它们以「拿到了半截
    // 输出」结束，而真正的消息是「连接断了」。
    for (const cancel of [...session.execs]) cancel(new HostError('ssh.exec-session-closed'))
    session.client.off('handshake', session.handshakeListener)
    try {
      session.client.end()
    } catch {
      /* 忽略关闭异常 */
    } finally {
      // 不等待远端 FIN；Client.destroy() 在已经 end() 的 socket 上可能直接跳过。
      session.socket.destroy()
    }
    this.ctx.emit('ssh/session-closed', sessionId, reason)
  }
}

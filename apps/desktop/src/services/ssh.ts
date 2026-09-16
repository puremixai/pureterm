import { Service, type Context } from 'cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Client as SshClient, ClientChannel, ConnectConfig, PseudoTtyOptions, SFTPWrapper } from 'ssh2'
import { StringDecoder } from 'node:string_decoder'
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
    'ssh/session-closed'(sessionId: string, reason: string): void
    /** 首次记录某主机的密钥（TOFU）。 */
    'ssh/host-key-learned'(target: string, fingerprint: string): void
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
}

/**
 * 读私钥文件。只读一次、不缓存——私钥不是我们的数据，用完即弃。
 * 读不到时给的是「哪个文件、为什么」，而不是把 ENOENT 直接抛给用户。
 */
function readPrivateKey(path: string | undefined): string | undefined {
  if (!path) return undefined
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const reason =
      code === 'ENOENT' ? '文件不存在' : code === 'EACCES' ? '没有读取权限' : (error as Error).message
    throw new Error(`读不到私钥文件：${path}（${reason}）。`)
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
  truncated: boolean
}

interface InternalSession extends SshSessionInfo {
  client: SshClient
  shell?: ClientChannel
  /** 已开好的 SFTP 子系统通道。按会话缓存，见 sftpSession() */
  sftp?: SFTPWrapper
  /** 正在开的那一次。并发请求共用它，不然会开出两条通道、其中一条再没人关 */
  sftpOpening?: Promise<SFTPWrapper>
  closed: boolean
}

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 把 ssh2 的英文底层错误翻译成用户能看懂、且能据此行动的信息。
 *
 * 导出是为了能对**真实的 ssh2 文案**做表驱动测试（`tests/smoke-host.mjs`）：
 * 这些字符串是精确匹配出来的，抄错一个词就会静默失效、把英文原文漏给用户，
 * 而那正是已经犯过的错。纯函数，没有副作用。
 */
export function normalizeSshError(error: Error, host: string, port: number): Error {
  const message = error?.message ?? String(error)
  if (/All configured authentication methods failed/i.test(message)) {
    return new Error('认证失败：用户名、密码或私钥不正确。')
  }
  // 「有口令但没给」要用户去填口令，「文件根本不是密钥」要用户换文件，「口令不对」才是猜错——
  // 三种得给三种不同的下一步动作，糊成一句「无法解析」用户不知道该怎么办。
  // 注意顺序：② 必须在 ③ 之前，因为 client 侧统一包成 `Cannot parse privateKey: <真因>`，③ 也能命中。
  if (/encrypted .*key detected, but no passphrase given/i.test(message)) {
    return new Error('这把私钥有口令保护，请在「私钥口令」里填上。')
  }
  if (/Unsupported key format|does not contain a \(valid\) private key/i.test(message)) {
    return new Error('这个文件不是可识别的私钥（支持 OpenSSH / PEM 格式），请重新选一个。')
  }
  if (
    /Cannot parse privateKey|Decryption failed|bad passphrase|Invalid key|integrity check failed|Failed to generate information to decrypt key/i.test(
      message,
    )
  ) {
    return new Error('私钥无法解析：口令可能不对，或这不是 OpenSSH/PEM 格式的私钥。')
  }
  // TCP 通了、但对方在给出 SSH 横幅之前就断开。这条最容易把人带偏：用户会以为是密钥不对，
  // 其实连认证都还没走到。所以必须明说「与密钥无关」并给出该查什么。
  if (/Connection lost before handshake/i.test(message)) {
    return new Error(
      `${host}:${port} 的 TCP 连接建立了，但对方在送出 SSH 横幅之前就断开了。` +
        `这一步还没到认证，所以不是密钥或密码的问题。` +
        `常见原因：这个端口上跑的不是 SSH 服务；对端安全组/防火墙只放通了 TCP 却丢弃数据；` +
        `或对端瞬时不稳（隔几秒重试一次通常就好）。`,
    )
  }
  /*
   * SFTP 子系统开不起来。**这是「连上了但功能用不了」，不是认证失败**，
   * 所以必须和连接错误分开说：用户会以为是密码不对，然后去反复重填密码。
   * ssh2 在这里的文案有三条（子系统请求被拒 / 子系统起完立刻退出 / 通道直接被拒），
   * 三条都要接住——少接一条就会把英文原文漏给用户。
   */
  if (
    /Unable to start subsystem|establishing SFTP session|SFTP session termination|Channel open failure/i.test(message)
  ) {
    return new Error(
      `${host}:${port} 连上了、登录也成功了，但这台服务器没能开起 SFTP 子系统。` +
        `常见原因：sshd_config 里的 \`Subsystem sftp\` 被注释掉了（OpenSSH 默认是开的，` +
        `很多精简镜像会关掉）；或者这个账号被 ForceCommand/ChrootDirectory 限制，` +
        `不允许开子系统。终端本身仍然可以用。`,
    )
  }
  if (/ECONNREFUSED/i.test(message)) {
    return new Error(`无法连接 ${host}:${port}：目标端口拒绝连接（服务未启动或被防火墙拦截）。`)
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new Error(`无法解析主机名 ${host}。`)
  }
  if (/ETIMEDOUT|Timed out while waiting|Timed out/i.test(message)) {
    return new Error(`连接 ${host}:${port} 超时：网络不可达，或端口被丢弃。`)
  }
  if (/Host verification failed|Host key verification failed/i.test(message)) {
    return new Error(`主机密钥校验失败：${host}:${port} 的密钥与本地记录不一致。`)
  }
  if (/Socket closed|ECONNRESET/i.test(message)) {
    return new Error(`与 ${host}:${port} 的连接被重置。`)
  }
  return new Error(`${host}:${port} 连接失败：${message}`)
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
          try {
            session.client.end()
          } catch {
            /* 关闭阶段的异常不阻断卸载 */
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

  knownHosts(): unknown {
    return this.hostKeys.list()
  }

  forgetHostKey(host: string, port: number): boolean {
    return this.hostKeys.forget(host, port)
  }

  async connect(options: SshConnectOptions): Promise<SshSessionInfo> {
    const host = options.host?.trim()
    const port = options.port ?? 22
    if (!host) throw new Error('主机地址不能为空。')
    if (!options.username) throw new Error('用户名不能为空。')

    // 私钥内容优先用调用方给的；否则按路径现读（读不到时错误里带着文件名和原因）
    const privateKey = options.privateKey ?? readPrivateKey(options.privateKeyPath)
    if (!options.password && !privateKey && !process.env.SSH_AUTH_SOCK) {
      throw new Error('缺少认证凭据：填密码、选私钥文件，或让 ssh-agent 先加载好密钥。')
    }

    const acceptUnknown = options.acceptUnknownHostKey ?? true
    const verifier: { error?: Error; learned?: string } = {}

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
          verifier.error = new Error(
            `主机密钥已改变，可能是中间人攻击。\n  本地记录：${verdict.knownFingerprint}\n  本次收到：${verdict.fingerprint}\n` +
              `确认无误后，删除 ${this.hostKeys.file} 中该主机的记录再重连。`,
          )
          return false
        }
        if (!acceptUnknown) {
          verifier.error = new Error(`首次连接该主机，指纹为 ${verdict.fingerprint}（当前策略要求显式确认）。`)
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

    const client = new Client()
    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        client.off('error', onError)
        resolve()
      }
      // reject 只在这一段生效；ready 之后会换成长期错误处理，绝不吞错
      const onError = (error: Error): void => {
        client.off('ready', onReady)
        reject(verifier.error ?? normalizeSshError(error, host, port))
      }
      client.once('ready', onReady)
      client.once('error', onError)
      try {
        client.connect(config)
      } catch (error) {
        client.off('ready', onReady)
        client.off('error', onError)
        // connect() 会把「私钥解析不了」这类问题**同步抛出**（不是走 error 事件），
        // 所以这条路径也必须过一遍翻译，否则用户看到的是 `Cannot parse privateKey: ...` 原文。
        const cause = error instanceof Error ? error : new Error(String(error))
        reject(verifier.error ?? normalizeSshError(cause, host, port))
      }
    })

    const id = `ssh-${++this.counter}`
    const session: InternalSession = { id, host, port, username: options.username, client, closed: false }
    this.sessions.set(id, session)

    // ready 之后的长生命周期错误：必须有出口
    client.on('error', (error: Error) => this.drop(id, `连接错误：${error.message}`))
    client.on('close', () => this.drop(id, '连接已关闭'))
    client.on('end', () => this.drop(id, '服务器主动断开连接'))

    if (verifier.learned) this.ctx.emit('ssh/host-key-learned', `${host}:${port}`, verifier.learned)
    this.ctx.emit('ssh/session-opened', id, `${host}:${port}`)
    return { id, host, port, username: options.username }
  }

  /**
   * 申请一个交互式 shell。pty 参数必须带上：term 决定远端用不用 256 色，
   * cols/rows 决定远端第一帧的排版宽度（否则远端永远停在 80x24）。
   */
  async shell(sessionId: string, size: Partial<PtySize> = {}): Promise<ClientChannel> {
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
      session.client.shell(pty, (error, channel) => {
        if (error) reject(normalizeSshError(error, session.host, session.port))
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
          if (error) reject(normalizeSshError(error, session.host, session.port))
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

  async exec(sessionId: string, command: string, options: { maxBytes?: number; timeout?: number } = {}): Promise<ExecResult> {
    const session = this.requireSession(sessionId)
    const maxBytes = options.maxBytes ?? 1 << 20

    return await new Promise<ExecResult>((resolve, reject) => {
      session.client.exec(command, (error, channel) => {
        if (error) {
          reject(normalizeSshError(error, session.host, session.port))
          return
        }
        const outDecoder = new StringDecoder('utf8')
        const errDecoder = new StringDecoder('utf8')
        const out: string[] = []
        const err: string[] = []
        let bytes = 0
        let truncated = false
        let code: number | null = null
        let signal: string | undefined
        let settled = false

        const timer = options.timeout
          ? setTimeout(() => {
              if (settled) return
              settled = true
              channel.close()
              reject(new Error(`命令执行超时（${options.timeout}ms）。`))
            }, options.timeout)
          : null

        const done = (): void => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          out.push(outDecoder.end())
          err.push(errDecoder.end())
          resolve({ stdout: out.join(''), stderr: err.join(''), code, signal, truncated })
        }

        channel.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > maxBytes) truncated = true
          if (!truncated) out.push(outDecoder.write(chunk))
        })
        channel.stderr.on('data', (chunk: Buffer) => {
          if (!truncated) err.push(errDecoder.write(chunk))
        })
        channel.on('exit', (exitCode: number | null, signalName?: string) => {
          code = exitCode
          signal = signalName
        })
        channel.on('close', done)
        channel.on('error', (streamError: Error) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          reject(streamError)
        })
      })
    })
  }

  /** 主动断开：统一走 drop，保证只发一次 session-closed */
  dispose(sessionId: string, reason = '会话已关闭'): void {
    this.drop(sessionId, reason)
  }

  private requireSession(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('会话不存在或已关闭，请重新连接。')
    return session
  }

  private drop(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.closed = true
    try {
      session.client.end()
    } catch {
      /* 忽略关闭异常 */
    }
    this.ctx.emit('ssh/session-closed', sessionId, reason)
  }
}

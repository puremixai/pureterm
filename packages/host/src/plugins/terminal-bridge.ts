import { Service, type Context } from 'cordis'
import type { ClientChannel } from 'ssh2'
import { EVENTS, type TerminalOpenRequest, type TerminalOpenResult } from '@pureterm/protocol'

declare module 'cordis' {
  interface Context {
    terminal: TerminalBridge
  }
}

/**
 * 开终端的入参 = 协议里的请求 + **载体认定的**客户端身份。
 *
 * `clientId` 由载体填入，渲染层无法自称：IPC 载体填 `event.sender` 映射出的 id，
 * WebSocket 载体填连接 id。领域层只把它当不透明句柄——
 * 早先这里是个 number 的 `webContentsId`（Electron 的渲染进程 id），
 * 那等于把 Electron 的概念写进了领域层，换载体就得改 src/。
 */
export type TerminalOpenPayload = TerminalOpenRequest & { clientId: string }

export type { TerminalOpenResult }

interface Bridge {
  sessionId: string
  clientId: string
  shell: ClientChannel
  queue: Buffer[]
  bytes: number
  paused: boolean
  timer: NodeJS.Timeout | null
}

const FLUSH_INTERVAL = 16
const HIGH_WATER = 512 * 1024
const LOW_WATER = 64 * 1024

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Cancel the connection promptly even while its platform credential RPC is pending. */
function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new Error('客户端已断开连接或 Host 已关闭。'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

/**
 * TerminalBridge —— ssh2 通道 <-> 渲染层 xterm.js 的字节桥。
 *
 * 三条纪律：
 * 1. 传字节不传字符串。UTF-8 多字节字符会被 SSH 分包切开，逐块 toString() 必出乱码；
 *    直接发 Buffer（IPC 走结构化克隆变成 Uint8Array），交给 xterm 自带的流式解码器。
 * 2. 合并 + 背压。cat 大文件会瞬间产生上万条消息，按 16ms 合并，超过水位就 pause 通道。
 * 3. 每个会话都有出口。连接失败、断线、shell 关闭、渲染层消失，都必须带 reason 通知渲染层。
 */
export class TerminalBridge extends Service {
  static inject = ['ssh', 'renderer', 'sessionStore']

  private readonly bridges = new Map<string, Bridge>()
  private readonly openings = new Map<AbortController, string>()
  private stopped = false

  constructor(ctx: Context) {
    super(ctx, 'terminal')

    // 只看一次：ssh2 侧的会话结束（断线/错误/主动关闭）统一在这里收尾
    this.ctx.on('ssh/session-closed', (sessionId: string, reason: string) => {
      this.close(sessionId, reason)
    })

    this.ctx.effect(
      () => () => {
        this.stopped = true
        for (const controller of this.openings.keys()) controller.abort()
        for (const bridge of [...this.bridges.values()]) {
          if (bridge.timer) clearTimeout(bridge.timer)
          this.bridges.delete(bridge.sessionId)
        }
      },
      'terminal.disposeAll',
    )
  }

  get size(): number {
    return this.bridges.size
  }

  releaseClient(clientId: string): void {
    for (const [controller, owner] of this.openings) {
      if (owner === clientId) controller.abort()
    }
    for (const bridge of [...this.bridges.values()]) {
      if (bridge.clientId === clientId) this.close(bridge.sessionId, '客户端已断开连接。')
    }
  }

  shutdown(): void {
    if (this.stopped) return
    this.stopped = true
    for (const controller of this.openings.keys()) controller.abort()
    for (const bridge of [...this.bridges.values()]) this.close(bridge.sessionId, 'Host 已关闭。')
  }

  async open(payload: TerminalOpenPayload): Promise<TerminalOpenResult> {
    const clientId = payload.clientId
    if (this.stopped) throw new Error('Host 已关闭，无法建立新连接。')
    if (!this.ctx.renderer.isAlive(clientId)) throw new Error('渲染进程不可用。')

    const cols = payload.cols ?? 100
    const rows = payload.rows ?? 30
    let createdSessionId: string | undefined
    const controller = new AbortController()
    this.openings.set(controller, clientId)
    const ssh = this.ctx.ssh
    const renderer = this.ctx.renderer
    const assertClientAvailable = (): void => {
      if (this.stopped || controller.signal.aborted || !renderer.isAlive(clientId)) {
        throw new Error('客户端已断开连接或 Host 已关闭。')
      }
    }
    const abortSession = (): void => {
      if (createdSessionId) ssh.dispose(createdSessionId, '客户端已断开连接。')
    }
    controller.signal.addEventListener('abort', abortSession, { once: true })

    try {
      const stored = payload.hostId ? this.ctx.sessionStore.get(payload.hostId) : undefined

      // 认证方式的三级推断：请求里显式给的 → 已保存主机的记录 → 看有没有带私钥
      const authMethod =
        payload.authMethod ??
        stored?.authMethod ??
        (payload.privateKey || payload.privateKeyPath ? 'privateKey' : 'password')
      const privateKeyPath = payload.privateKeyPath ?? stored?.privateKeyPath

      /*
       * 密文槽里只有一份凭据，它属于哪种认证由 authMethod 决定：
       * 密码认证时它是密码，私钥认证时它是私钥口令。所以这里必须按方式取，
       * 不能「先当密码试、不行再当口令」——那会把一份凭据用在错误的位置上。
       */
      const saved = payload.hostId ? await withAbort(this.ctx.sessionStore.secret(payload.hostId), controller.signal) : undefined
      assertClientAvailable()
      const password = authMethod === 'password' ? payload.password ?? saved : undefined
      const passphrase = authMethod === 'privateKey' ? payload.passphrase ?? saved : undefined

      if (authMethod === 'privateKey') {
        if (!payload.privateKey && !privateKeyPath) throw new Error('请选择私钥文件（或粘贴私钥内容）。')
      } else if (!password && stored?.authMethod === 'password' && stored.hasSecret) {
        throw new Error('已保存的密码无法解密（系统密钥可能已变更），请重新输入密码。')
      }

      const session = await ssh.connect({
        host: payload.host,
        port: payload.port,
        username: payload.username,
        password,
        privateKey: payload.privateKey,
        privateKeyPath,
        passphrase,
        acceptUnknownHostKey: payload.acceptUnknownHostKey,
        signal: controller.signal,
      })
      const sessionId = session.id
      createdSessionId = sessionId
      assertClientAvailable()

      const shell = await ssh.shell(sessionId, { cols, rows, term: payload.term }, controller.signal)
      assertClientAvailable()
      const bridge: Bridge = { sessionId, clientId, shell, queue: [], bytes: 0, paused: false, timer: null }
      this.bridges.set(sessionId, bridge)

      shell.on('data', (chunk: Buffer) => this.push(bridge, chunk))
      shell.on('close', () => this.close(sessionId, '远端 shell 已关闭。'))
      shell.on('error', (error: Error) => this.close(sessionId, `通道错误：${error.message}`))

      if (!renderer.send(clientId, EVENTS.terminalOpened, sessionId, cols, rows)) {
        this.close(sessionId, '客户端已断开连接。')
        throw new Error('客户端已断开连接。')
      }
      return { sessionId, host: session.host, cols, rows }
    } catch (error) {
      const message = errorMessage(error)
      if (createdSessionId) ssh.dispose(createdSessionId, message)
      // 双通道报错：事件通知界面 + reject 让 invoke 也拿到（谁在等谁就收到）
      renderer.send(clientId, EVENTS.terminalClosed, createdSessionId ?? '', message)
      throw new Error(message)
    } finally {
      controller.signal.removeEventListener('abort', abortSession)
      this.openings.delete(controller)
    }
  }

  input(sessionId: string, data: string): void {
    const bridge = this.bridges.get(sessionId)
    if (!bridge) return
    try {
      bridge.shell.write(data)
    } catch (error) {
      this.close(sessionId, `写入失败：${errorMessage(error)}`)
    }
  }

  /** ssh2 的签名是 setWindow(rows, cols, height, width) —— 序别写反 */
  resize(sessionId: string, cols: number, rows: number): void {
    const bridge = this.bridges.get(sessionId)
    if (!bridge) return
    try {
      bridge.shell.setWindow(Math.max(5, rows), Math.max(20, cols), 0, 0)
    } catch (error) {
      this.close(sessionId, `调整窗口失败：${errorMessage(error)}`)
    }
  }

  close(sessionId: string, reason = '会话已关闭。'): void {
    const bridge = this.bridges.get(sessionId)
    if (!bridge) return
    // 先删再收尾，避免 ssh/session-closed 回调重入
    this.bridges.delete(sessionId)
    if (bridge.timer) {
      clearTimeout(bridge.timer)
      bridge.timer = null
    }
    this.flush(bridge)
    this.ctx.ssh.dispose(sessionId, reason)
    this.ctx.renderer.send(bridge.clientId, EVENTS.terminalClosed, sessionId, reason)
  }

  private push(bridge: Bridge, chunk: Buffer): void {
    bridge.queue.push(chunk)
    bridge.bytes += chunk.length
    if (!bridge.timer) bridge.timer = setTimeout(() => this.flush(bridge), FLUSH_INTERVAL)

    if (!bridge.paused && bridge.bytes > HIGH_WATER) {
      bridge.paused = true
      bridge.shell.pause()
    }
  }

  private flush(bridge: Bridge): void {
    if (bridge.timer) {
      clearTimeout(bridge.timer)
      bridge.timer = null
    }
    if (bridge.queue.length) {
      const payload = bridge.queue.length === 1 ? bridge.queue[0]! : Buffer.concat(bridge.queue, bridge.bytes)
      bridge.queue = []
      bridge.bytes = 0
      const delivered = this.ctx.renderer.send(bridge.clientId, EVENTS.terminalData, bridge.sessionId, payload)
      if (!delivered) {
        this.close(bridge.sessionId, '渲染进程已关闭。')
        return
      }
    }
    if (bridge.paused && bridge.bytes < LOW_WATER) {
      bridge.paused = false
      try {
        bridge.shell.resume()
      } catch {
        /* 通道可能已关闭 */
      }
    }
  }
}

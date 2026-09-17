import {
  EVENTS,
  METHODS,
  NOTICES,
  decodeWire,
  encodeWire,
  type HostRecord,
  type PickedPrivateKey,
  type RuntimeCapabilities,
  type SshApi,
  type SftpDir,
  type SftpReadResult,
  type SftpWriteResult,
  type TerminalOpenResult,
  type WireCall,
  type WireNotice,
} from '@pureterm/protocol'
import { withoutBootstrapToken } from './bootstrap-url.js'

export type { SshApi }

interface SmokeReport {
  preload: string
  sessionId: string | null
  openedSize: { cols: number; rows: number } | null
  text: string
  replacementChars: number
  closedReason: string | null
  error: string | null
}

export type { SmokeReport }

declare global {
  interface Window {
    /**
     * preload 注入的 IPC 载体接口。
     * **没有它**（用浏览器打开 http://127.0.0.1:… 时）就落到 WebSocket 载体——
     * 这份产物在两种载体下是同一个文件，区别只在有没有这个全局对象。
     */
    sshAPI?: SshApi
    __smoke?: {
      run(config: { host: string; port: number; username: string; password: string }): Promise<SmokeReport>
    }
  }
}

/**
 * 选载体。判断依据只有一条：preload 有没有把 `window.sshAPI` 放上去。
 *
 * 不写成「是不是 Electron」是因为那要嗅 userAgent，而 userAgent 是能骗的、
 * 也会随 Electron 版本变；「preload 注入过没有」是结构性的事实。
 * 两种情况下 app.ts 拿到的是**同一个接口**（shared/protocol.ts 的 SshApi）。
 */
export function createTransport(): SshApi {
  const injected = window.sshAPI
  return injected ?? createWebSocketTransport()
}

// ── WebSocket 载体 ────────────────────────────────────────────────
//
// IPC 载体不在这里再包一层：preload 暴露出来的形状就是 SshApi，
// 多包一层只是多一次转发、多一个可能和 preload 走形的机会。

/**
 * 浏览器里的那份 SshApi，走 `ws://<当前 host>/ws`，协议与桌面端**完全同一个**。
 *
 * 三件事要在这里做对：
 * 1. **连接是按需建立的，但订阅必须先记住**。页面加载时就会 onOpened/onData/onClosed，
 *    那时连接可能还没建。所以订阅只看本地数组，连接在第一次真正需要时（列主机/开终端）才建。
 * 2. **请求要按 id 配对**，且**先登记再发送**——先 send 再登记的话，
 *    本机回包够快时就会「回复比登记先到」，然后那个 Promise 永远挂着。
 * 3. **断开要让上层知道**。socket 一断，所有在途请求立刻 reject，
 *    并且通知当前会话已结束——否则界面会停在「已连接」而远端其实已经没了。
 */
export function createWebSocketTransport(): SshApi {
  // Subsequent HTTP requests and the first WebSocket use the HttpOnly session cookie.
  const cleanedUrl = withoutBootstrapToken(window.location.href)
  if (cleanedUrl) window.history.replaceState(window.history.state, '', cleanedUrl)
  const openedListeners = new Set<(sessionId: string, cols: number, rows: number) => void>()
  const dataListeners = new Set<(sessionId: string, chunk: Uint8Array) => void>()
  const closedListeners = new Set<(sessionId: string, reason: string) => void>()

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let nextId = 1
  let socket: WebSocket | null = null
  let connecting: Promise<WebSocket> | null = null
  const currentSessions = new Set<string>()
  let disposed = false
  let openingSocket: WebSocket | null = null
  let rejectOpening: ((error: Error) => void) | null = null
  let connectionGeneration = 0

  const clearSocketHandlers = (ws: WebSocket): void => {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
  }

  const emitClosed = (sessionId: string, reason: string): void => {
    for (const listener of closedListeners) listener(sessionId, reason)
  }

  const failAllPending = (reason: string): void => {
    for (const [, entry] of pending) entry.reject(new Error(reason))
    pending.clear()
  }

  const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

  function connect(): Promise<WebSocket> {
    if (disposed) return Promise.reject(new Error('客户端已卸载。'))
    if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket)
    if (connecting) return connecting

    const generation = ++connectionGeneration
    const isCurrent = (): boolean => !disposed && generation === connectionGeneration
    connecting = new Promise<WebSocket>((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(url)
      openingSocket = ws
      rejectOpening = reject
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        if (!isCurrent()) { clearSocketHandlers(ws); ws.close(); return }
        settled = true
        openingSocket = null
        rejectOpening = null
        socket = ws
        resolve(ws)
      }

      ws.onerror = () => {
        if (!isCurrent() || settled) return
        settled = true
        connectionGeneration++
        connecting = null
        openingSocket = null
        rejectOpening = null
        // Retire the failed handshake before permitting a retry. Its queued close,
        // message or open callback must never affect the replacement connection.
        clearSocketHandlers(ws)
        ws.close()
        reject(new Error(`连不上本机后端（${url}）。地址或 token 可能已经失效——重启应用后会换新的。`))
      }

      ws.onclose = (event) => {
        if (!isCurrent()) return
        connectionGeneration++
        clearSocketHandlers(ws)
        const wasCurrent = socket === ws
        if (wasCurrent) socket = null
        if (openingSocket === ws) openingSocket = null
        rejectOpening = null
        connecting = null
        const reason = `与后端的连接已断开（${event.code}${event.reason ? ` ${event.reason}` : ''}）。`
        failAllPending(reason)
        if (!settled) {
          settled = true
          reject(new Error(reason))
          return
        }
        // 断线要让当前会话跟着结束，否则界面会停在「已连接」
        if (wasCurrent) {
          const sessions = [...currentSessions]
          currentSessions.clear()
          for (const session of sessions) emitClosed(session, reason)
        }
      }

      ws.onmessage = (event) => {
        if (!isCurrent() || socket !== ws) return
        if (typeof event.data !== 'string') return
        let message: unknown
        try {
          message = JSON.parse(event.data)
        } catch {
          console.error('[transport] 收到不是 JSON 的报文，已忽略。')
          return
        }
        handleInbound(message)
      }
    })

    return connecting
  }

  function handleInbound(message: unknown): void {
    // 收窄成「可能是什么」的形状，而不是直接当 WireReply 那个联合类型用：
    // 联合类型里 `error` 只在一个分支上，直接读会编不过；
    // 也不该为了编过去就到处加断言——那等于把校验关掉。
    const candidate = message as {
      kind?: unknown
      id?: unknown
      ok?: unknown
      value?: unknown
      error?: unknown
      name?: unknown
      params?: unknown
    }

    if (candidate.kind === 'reply' && typeof candidate.id === 'number') {
      const entry = pending.get(candidate.id)
      if (!entry) return
      pending.delete(candidate.id)
      if (candidate.ok === true) entry.resolve(decodeWire(candidate.value))
      else entry.reject(new Error(typeof candidate.error === 'string' ? candidate.error : '后端报了一个没有说明的错误。'))
      return
    }
    if (candidate.kind !== 'event' || typeof candidate.name !== 'string') return

    const params = (decodeWire(candidate.params) ?? []) as unknown[]
    if (candidate.name === EVENTS.terminalOpened) {
      currentSessions.add(String(params[0]))
      for (const listener of openedListeners) listener(String(params[0]), Number(params[1]), Number(params[2]))
      return
    }
    if (candidate.name === EVENTS.terminalData) {
      const chunk = params[1]
      if (!(chunk instanceof Uint8Array)) return
      for (const listener of dataListeners) listener(String(params[0]), chunk)
      return
    }
    if (candidate.name === EVENTS.terminalClosed) {
      const sessionId = String(params[0] ?? '')
      currentSessions.delete(sessionId)
      for (const listener of closedListeners) listener(sessionId, String(params[1] ?? ''))
    }
  }

  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    const ws = await connect()
    if (disposed) throw new Error('客户端已卸载。')
    const id = nextId++
    // 显式标成 WireCall：线格式就是协议文件里那个类型，不靠「看着像」对齐
    const wire: WireCall = { kind: 'call', id, method, params }
    return new Promise<unknown>((resolve, reject) => {
      // 先登记再发送：反过来的话本机回包可能比登记还快
      pending.set(id, { resolve, reject })
      try { ws.send(JSON.stringify(encodeWire(wire))) }
      catch (error) { pending.delete(id); reject(error) }
    })
  }

  const notify = (name: string, params: unknown[]): void => {
    if (disposed) return
    const wire: WireNotice = { kind: 'notice', name, params }
    // 一律挂到 connect() 这条链上：同一个 Promise 的 then 按注册顺序执行，
    // 所以「先 input 再 close」这种顺序不会被打乱
    void connect()
      .then((ws) => {
        if (disposed) return
        ws.send(JSON.stringify(encodeWire(wire)))
      })
      .catch((error: unknown) => { if (!disposed) console.error('[transport] 发送通知失败：', error) })
  }

  return {
    carrier: 'web',
    getCapabilities: () => call(METHODS.appCapabilities, []) as Promise<RuntimeCapabilities>,

    open: (payload) => call(METHODS.sshOpen, [payload]) as Promise<TerminalOpenResult>,
    input: (sessionId, data) => notify(NOTICES.sshInput, [sessionId, data]),
    resize: (sessionId, cols, rows) => notify(NOTICES.sshResize, [sessionId, cols, rows]),
    close: (sessionId) => notify(NOTICES.sshClose, [sessionId]),
    pickPrivateKey: () => call(METHODS.sshPickPrivateKey, []) as Promise<PickedPrivateKey | undefined>,

    onOpened: (listener) => {
      openedListeners.add(listener)
      return () => { openedListeners.delete(listener) }
    },
    onData: (listener) => {
      dataListeners.add(listener)
      return () => { dataListeners.delete(listener) }
    },
    onClosed: (listener) => {
      closedListeners.add(listener)
      return () => { closedListeners.delete(listener) }
    },

    hosts: {
      list: () => call(METHODS.hostsList, []) as Promise<HostRecord[]>,
      save: (input) => call(METHODS.hostsSave, [input]) as Promise<HostRecord>,
      remove: (id) => call(METHODS.hostsRemove, [id]) as Promise<boolean>,
    },

    /*
     * 远端文件。返回值里的字节由 handleInbound → decodeWire 解回 Uint8Array，
     * 上传的字节由 encodeWire 打成 `{ $bytes }` 过线——两条都在协议层，
     * 这里只是 call 一下，不做任何编码判断。
     */
    sftp: {
      list: (sessionId, path) => call(METHODS.sftpList, [sessionId, path]) as Promise<SftpDir>,
      read: (sessionId, path) => call(METHODS.sftpRead, [sessionId, path]) as Promise<SftpReadResult>,
      write: (sessionId, dir, name, bytes) =>
        call(METHODS.sftpWrite, [sessionId, dir, name, bytes]) as Promise<SftpWriteResult>,
      mkdir: (sessionId, dir, name) => call(METHODS.sftpMkdir, [sessionId, dir, name]) as Promise<void>,
      remove: (sessionId, path) => call(METHODS.sftpRemove, [sessionId, path]) as Promise<void>,
    },

    signalReady: (payload) => notify(NOTICES.appReady, [payload]),
    dispose() {
      if (disposed) return
      disposed = true
      connectionGeneration++
      failAllPending('客户端已卸载。')
      rejectOpening?.(new Error('客户端已卸载。'))
      rejectOpening = null
      for (const ws of new Set([socket, openingSocket])) {
        if (!ws) continue
        clearSocketHandlers(ws)
        ws.close()
      }
      socket = openingSocket = null
      connecting = null
      currentSessions.clear()
      openedListeners.clear()
      dataListeners.clear()
      closedListeners.clear()
    },
  }
}

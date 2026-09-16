import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { decodeWire, encodeWire, isWireCall, isWireNotice, type WireEvent, type WireReply } from '../../shared/protocol.js'
import type { RendererHandle } from '../../src/host.js'
import type { Carrier } from './carrier.js'
import type { Dispatcher } from '../bridge/dispatch.js'
import { createWsServer, type WsConnection } from './ws-server.js'

/*
 * Web 载体：本机 HTTP + WebSocket，跑的是**同一个协议**（shared/protocol.ts）。
 *
 * 为什么要有它：渲染层与壳解耦之后，「渲染层」不该再隐含「必须是 Electron 的 BrowserWindow」。
 * 加了它，同一个 `dist/renderer` 产物既能被 Electron 加载（走 IPC 载体），
 * 也能被浏览器加载（走这个载体）——**两条路共用一份协议、一个 dispatcher、一棵插件树**。
 * 解耦是不是真的，判据就是：加这个载体没有改动 `src/` 里的任何一行。
 *
 * ── 安全约束（每一条都是必须的，不是加固）──────────────────────────
 * 1. **只绑 127.0.0.1**，端口随机（传 0 让系统给）。绝不绑 0.0.0.0——
 *    这是「本机可用」和「局域网里谁都能连」的区别。
 * 2. **token 是必须的，HTML 也要**。早先的想法是「只有 WS 要 token」，那是错的：
 *    本机任何进程 `GET /` 就能把页面（连带页面里的 token）拿走。
 *    现在的流程是——带 `?token=` 打开页面 → 服务端下发 HttpOnly 的 SameSite 会话 cookie
 *    → 之后静态资源与 WS 升级都凭 cookie。token 不进 JS，也不留在地址栏给 Referer 带走。
 * 3. **校验 Origin 与 Host**。Origin 用来挡「别家页面拿你的浏览器当跳板」，
 *    Host 用来挡 DNS rebinding（恶意域名解析到 127.0.0.1）。
 * 4. **CSP + nosniff + no-store**：终端是能显示任意远端文本的地方，别给它多余的权限。
 *
 * ── 它不是「另一条更弱的路」─────────────────────────────────────
 * 同一个 token 才能连上，连上之后能做的事与桌面端完全一样（都走同一个 dispatcher）。
 * 所以打印这个地址时也要说清楚：拿到地址的人 = 能操作这台机器的 SSH。
 */

export const WS_CLIENT_PREFIX = 'ws:'
export const SESSION_COOKIE = 'ssh-cordis-session'

/** 会话 cookie 与 token 同值；token 本身是 192 位随机数 */
const TOKEN_BYTES = 24

export interface HttpCarrierOptions {
  dispatcher: Dispatcher
  /** 渲染层产物目录（dist/renderer） */
  staticDir: string
  /** 端口。默认 0 = 让系统挑一个空闲端口（随机端口本身就是一层保护） */
  port?: number
  /** 绑定的地址。**默认且推荐 127.0.0.1**；改了就等于把 SSH 出口开到网络上 */
  host?: string
  log?: (line: string) => void
}

export interface HttpCarrier extends Carrier {
  readonly port: number
  readonly token: string
  /** 控制台里给用户打开的那条地址（带 token） */
  readonly url: string
  close(): Promise<void>
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}

/*
 * 页面的 CSP。
 * `connect-src` 必须显式写上 ws://127.0.0.1:*：端口是随机的，而 `'self'` 对 ws: 的支持
 * 在各浏览器上不一致，写一个通配端口最稳。
 * `form-action 'none'`：工具栏那个 <form> 只是拿来收 submit 事件的（已 preventDefault），
 * 永远不该真的提交到任何地方。
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // xterm 运行时会创建 <style> 注入主题与视口样式
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function createHttpCarrier(options: HttpCarrierOptions): Promise<HttpCarrier> {
  const log = options.log ?? ((line: string): void => console.log(line))
  const staticDir = resolve(options.staticDir)
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const bindHost = options.host ?? '127.0.0.1'
  const connections = new Map<number, WsConnection>()
  let port = -1

  // ── 鉴权 ────────────────────────────────────────────────────────
  //
  // 两条凭据路：查询串里的 `?token=`（初次打开页面 / 没有 cookie 罐的脚本客户端）
  // 和会话 cookie（页面打开之后的一切）。都按 timing-safe 比较。
  const queryTokenOk = (url: URL): boolean => {
    const fromQuery = url.searchParams.get('token')
    return !!fromQuery && safeEqual(fromQuery, token)
  }

  const cookieOk = (req: IncomingMessage): boolean => {
    const fromCookie = readCookie(req.headers.cookie, SESSION_COOKIE)
    return !!fromCookie && safeEqual(fromCookie, token)
  }

  const parseUrl = (req: IncomingMessage): URL | undefined => {
    try {
      return new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    } catch {
      return undefined
    }
  }

  /**
   * Host 头必须是回环地址。DNS rebinding 的攻击面就是「浏览器以为在跟 evil.com 说话，
   * 实际连到了我们的端口」——那条路径上 Host 会是 evil.com。
   */
  const hostAllowed = (req: IncomingMessage): boolean => {
    const header = req.headers.host
    if (!header) return false
    const name = header.replace(/:\d+$/, '').toLowerCase()
    return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
  }

  /*
   * Origin 校验。
   *
   * 分两种情况，因为「客户端」有两种：
   * - 浏览器：Origin 一定有，且必须是我们自己的 origin；
   * - 脚本（冒烟测试用的 Node 内置 WebSocket）：可能不带 Origin，或带一个无意义的值。
   *
   * 所以不是「Origin 不对就拒」，而是「Origin 不对就必须另外拿出 token」——
   * 跨站页面永远拿不到 token，这一条才是真正的门槛。
   */
  const originAcceptable = (req: IncomingMessage, url: URL): boolean => {
    const origin = req.headers.origin
    if (!origin) return true
    if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) return true
    return queryTokenOk(url)
  }

  const applyHeaders = (response: ServerResponse): void => {
    response.setHeader('Content-Security-Policy', CSP)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Cache-Control', 'no-store')
  }

  const deny = (response: ServerResponse, status: number, message: string): void => {
    applyHeaders(response)
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(message)
  }

  // ── WebSocket ──────────────────────────────────────────────────
  const ws = createWsServer({
    authorize: (req) => {
      if (!hostAllowed(req)) {
        log('[carrier:web] 拒绝了 Host 不是回环地址的升级请求')
        return false
      }
      const url = parseUrl(req)
      if (!url) return false
      if (!originAcceptable(req, url)) {
        log(`[carrier:web] 拒绝了来自 ${String(req.headers.origin)} 的升级请求（Origin 不匹配且没带 token）`)
        return false
      }
      if (!queryTokenOk(url) && !cookieOk(req)) return false
      return true
    },
    onOpen: (connection) => {
      connections.set(connection.id, connection)
      log(`[carrier:web] 客户端 #${connection.id} 已连接（当前 ${connections.size} 条）`)
    },
    onMessage: (connection, text) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        connection.close(1003, '报文不是合法 JSON')
        return
      }
      handleInbound(connection, parsed)
    },
    onClose: (connection) => {
      connections.delete(connection.id)
      log(`[carrier:web] 客户端 #${connection.id} 断开（当前 ${connections.size} 条）`)
    },
    log,
  })

  function handleInbound(connection: WsConnection, message: unknown): void {
    const clientId = `${WS_CLIENT_PREFIX}${connection.id}`

    const send = (payload: WireReply): void => {
      connection.send(JSON.stringify(encodeWire(payload)))
    }

    if (isWireCall(message)) {
      const decoded = decodeWire(message.params)
      if (!Array.isArray(decoded)) {
        send({ kind: 'reply', id: message.id, ok: false, error: '参数必须是数组。' })
        return
      }
      options.dispatcher
        .call(message.method, decoded, clientId)
        .then((value) => send({ kind: 'reply', id: message.id, ok: true, value }))
        .catch((error: unknown) => send({ kind: 'reply', id: message.id, ok: false, error: errorMessage(error) }))
      return
    }

    if (isWireNotice(message)) {
      const decoded = decodeWire(message.params)
      // notify 会抛：ws-server 捕获后按 1011 断开。协议不匹配就该显式失败，不能静默吞掉
      options.dispatcher.notify(message.name, Array.isArray(decoded) ? decoded : [], clientId)
      return
    }

    connection.close(1003, '不认识的报文')
  }

  // ── HTTP 静态资源 ──────────────────────────────────────────────
  const serveStatic = async (response: ServerResponse, pathname: string): Promise<void> => {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      deny(response, 400, '路径编码不合法。')
      return
    }
    const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
    const target = resolve(staticDir, relative)
    // 目录穿越：解析后必须仍在 staticDir 之下
    if (target !== staticDir && !target.startsWith(staticDir + sep)) {
      deny(response, 403, '不允许访问这个路径。')
      return
    }

    try {
      const body = await readFile(target)
      applyHeaders(response)
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      deny(response, 404, '没有这个资源。')
    }
  }

  const handler = (req: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      if (!hostAllowed(req)) {
        deny(response, 403, '只接受回环地址访问。')
        return
      }
      if (req.method !== 'GET') {
        deny(response, 405, '只支持 GET。')
        return
      }
      const url = parseUrl(req)
      if (!url) {
        deny(response, 400, '请求地址不合法。')
        return
      }
      if (!queryTokenOk(url) && !cookieOk(req)) {
        // 不区分「token 错」和「没带 token」：不给出任何可用于试探的差异
        deny(
          response,
          401,
          '需要 token。请用启动日志里那条带 token 的地址打开，而不是手输端口。\n' +
            '（token 每次启动都会重新生成。）\n',
        )
        return
      }

      // 用 ?token= 打开时顺手落一个会话 cookie：之后静态资源与 WS 都凭它，
      // token 就不用一直挂在地址栏上（也免得被 Referer 带出去）
      if (url.searchParams.get('token')) {
        response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`)
      }

      await serveStatic(response, url.pathname)
    })().catch((error: unknown) => {
      log(`[carrier:web] 处理请求失败：${errorMessage(error)}`)
      if (!response.headersSent) deny(response, 500, '内部错误。')
      else response.end()
    })
  }

  const server: Server = createServer(handler)

  server.on('upgrade', (req, socket, head) => {
    const url = parseUrl(req)
    if (!url || url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    ws.handleUpgrade(req, socket, head)
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(options.port ?? 0, bindHost, () => {
      const address = server.address()
      port = typeof address === 'object' && address ? address.port : -1
      resolvePromise()
    })
  })

  const closeServer = async (): Promise<void> => {
    ws.close()
    connections.clear()
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise())
      // 挂着的 keep-alive 连接会让 close 一直不回；我们自己不留长连接
      server.closeAllConnections?.()
    })
  }

  return {
    name: 'web',

    port,
    token,
    url: `http://${bindHost}:${port}/?token=${token}`,

    getRenderer(clientId: string): RendererHandle | undefined {
      if (!clientId.startsWith(WS_CLIENT_PREFIX)) return undefined
      const id = Number(clientId.slice(WS_CLIENT_PREFIX.length))
      if (!Number.isInteger(id)) return undefined
      const connection = connections.get(id)
      if (!connection) return undefined

      return {
        id: clientId,
        isAlive: () => !connection.closed,
        send: (event, ...args) => {
          const payload: WireEvent = { kind: 'event', name: event, params: args }
          return connection.send(JSON.stringify(encodeWire(payload)))
        },
      }
    },

    close: closeServer,
    dispose: closeServer,
  }
}

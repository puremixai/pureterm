import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { decodeWire, encodeWire, isWireCall, isWireNotice, type WireEvent, type WireReply } from '@pureterm/protocol'
import type { RendererHandle } from '@pureterm/host'
import type { Carrier } from './carrier.js'
import type { Dispatcher } from './dispatch.js'
import { createWsServer, type WsConnection } from './ws-server.js'

/*
 * Web 载体：本机 HTTP + WebSocket，使用共享协议。
 *
 * Desktop 子进程和独立 Web 入口都使用它。Desktop 主窗口通过自定义 scheme
 * 加载共享 UI，再连到这个 WebSocket；普通浏览器通过它的 HTTP 入口加载同一份 UI。
 * 所有业务请求共用一个 dispatcher 和 Host 插件树。
 *
 * ── 安全约束（每一条都是必须的，不是加固）──────────────────────────
 * 1. **只绑 127.0.0.1**，端口随机（传 0 让系统给）。绝不绑 0.0.0.0——
 *    这是「本机可用」和「局域网里谁都能连」的区别。
 * 2. **所有 HTTP/WS 请求都要认证**。普通浏览器用查询 token 换取 HttpOnly
 *    SameSite 会话 cookie；Desktop 主进程使用单独的 bearer token。
 * 3. **校验 Origin 与 Host**。Origin 用来挡「别家页面拿你的浏览器当跳板」，
 *    Host 用来挡 DNS rebinding（恶意域名解析到 127.0.0.1）。
 * 4. **CSP + nosniff + no-store**：终端是能显示任意远端文本的地方，别给它多余的权限。
 *
 * ── 它不是「另一条更弱的路」─────────────────────────────────────
 * 通过认证后都走同一个 dispatcher。
 * 所以打印这个地址时也要说清楚：拿到地址的人 = 能操作这台机器的 SSH。
 */

export const WS_CLIENT_PREFIX = 'ws:'
export const SESSION_COOKIE = 'ssh-cordis-session'

/** 会话 cookie 与 token 同值；token 本身是 192 位随机数 */
const TOKEN_BYTES = 24

export interface HttpCarrierOptions {
  dispatcher: Dispatcher
  /** 共享 UI 产物目录（packages/ui/dist）。 */
  staticDir: string
  /** 端口。默认 0 = 让系统挑一个空闲端口（随机端口本身就是一层保护） */
  port?: number
  /** 兼容显式配置；只接受 127.0.0.1。 */
  host?: string
  /** Private Desktop credential created in the Host child; Electron main injects it into WS requests. */
  desktopToken?: string
  /** Whether the ordinary browser query token and cookie may authenticate. */
  browserAccess?: boolean
  /** 客户端断开时回收其 SSH 会话，包括正在握手的连接。 */
  onDisconnect?: (clientId: string) => void
  log?: (line: string) => void
}

export interface HttpCarrier extends Carrier {
  readonly port: number
  readonly token: string
  /** 普通浏览器可访问时带查询 token；禁用时只返回 loopback 地址。 */
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
  const browserAccess = options.browserAccess !== false
  const bindHost = options.host ?? '127.0.0.1'
  if (bindHost !== '127.0.0.1') throw new Error('Web 服务只允许监听 127.0.0.1。')
  const connections = new Map<number, WsConnection>()
  let port = -1

  // ── 鉴权 ────────────────────────────────────────────────────────
  //
  // 普通浏览器使用查询串 token 或会话 cookie；Desktop 使用单独的 bearer。
  // Token 值按 timing-safe 比较。
  const queryTokenOk = (url: URL): boolean => {
    if (!browserAccess) return false
    const fromQuery = url.searchParams.get('token')
    return !!fromQuery && safeEqual(fromQuery, token)
  }

  const cookieOk = (req: IncomingMessage): boolean => {
    if (!browserAccess) return false
    // Browser cookies are shared across ports; Desktop and standalone Web must coexist.
    const fromCookie = readCookie(req.headers.cookie, `${SESSION_COOKIE}-${port}`)
    return !!fromCookie && safeEqual(fromCookie, token)
  }

  const desktopBearerOk = (req: IncomingMessage): boolean => {
    if (!options.desktopToken) return false
    const authorization = req.headers.authorization
    const match = typeof authorization === 'string' ? /^Bearer (.+)$/i.exec(authorization) : null
    return !!match && safeEqual(match[1]!, options.desktopToken)
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
   * Browser and Desktop upgrades must come from this local origin. Node clients
   * may omit Origin, but a supplied foreign Origin is never accepted.
   */
  const originAcceptable = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin
    if (!origin) return true
    if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) return true
    return false
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
      if (!originAcceptable(req)) {
        log(`[carrier:web] 拒绝了来自 ${String(req.headers.origin)} 的升级请求（Origin 不匹配）`)
        return false
      }
      if (!desktopBearerOk(req) && !queryTokenOk(url) && !cookieOk(req)) return false
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
      options.onDisconnect?.(`${WS_CLIENT_PREFIX}${connection.id}`)
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
      if (!originAcceptable(req)) {
        deny(response, 403, 'Origin 不匹配。')
        return
      }
      const desktopAuthorized = desktopBearerOk(req)
      if (!desktopAuthorized && !queryTokenOk(url) && !cookieOk(req)) {
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
      if (!desktopAuthorized && queryTokenOk(url)) {
        response.setHeader('Set-Cookie', `${SESSION_COOKIE}-${port}=${token}; HttpOnly; SameSite=Strict; Path=/`)
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
    url: browserAccess ? `http://${bindHost}:${port}/?token=${token}` : `http://${bindHost}:${port}/`,

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

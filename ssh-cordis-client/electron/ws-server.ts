import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { OPCODES, WsProtocolError, createFrameDecoder, encodeFrame, type FrameDecoder } from './ws-frame.js'

/*
 * 最小 WebSocket 服务端：握手 + 拆帧 + 生命周期。够我们用，多的不写。
 *
 * 分工：帧的字节级编解码在 ws-frame.ts（纯函数，可单测），
 * 这里只负责「什么时候读、读到的东西怎么变成一条消息、连接什么时候算结束」。
 *
 * **鉴权在本模块之外**：`authorize` 在 upgraded 之前被调用，返回 false 就连 101 都不发。
 * 所以未授权的连接进不到解析器。
 */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 由客户端的 Sec-WebSocket-Key 算出应答值（RFC 6455 §4.2.2）。 */
export function acceptKey(clientKey: string): string {
  return createHash('sha1')
    .update(clientKey + WS_GUID)
    .digest('base64')
}

export interface WsConnection {
  readonly id: number
  readonly remote: string
  /** 返回 false 表示这条连接已经没了（调用方据此收尾，而不是继续往空气里写） */
  send(data: string | Uint8Array): boolean
  close(code?: number, reason?: string): void
  readonly closed: boolean
}

export interface WsCloseInfo {
  code: number
  reason: string
  /** true = 对端正常关闭或我们主动关；false = 传输层出错 / 超时 */
  clean: boolean
}

export interface WsServerOptions {
  /** 握手前的准入判断。返回 false → 回 401 并断开。**唯一的鉴权入口**。 */
  authorize(req: IncomingMessage): boolean
  onOpen(connection: WsConnection): void
  /** 只会有文本帧，且已通过 JSON 解析（构造 carrier 时负责）。空的/坏帧在这里就被挡掉。 */
  onMessage(connection: WsConnection, text: string): void
  onClose(connection: WsConnection, info: WsCloseInfo): void
  /** 心跳间隔；<=0 关掉。默认 30 秒。 */
  pingIntervalMs?: number
  log?: (line: string) => void
}

export interface WsServer {
  /** 供 http.Server 的 'upgrade' 事件直接挂上；返回 false 表示这条升级请求已被拒绝。 */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean
  readonly size: number
  close(): void
}

interface Session {
  connection: WsConnection
  decoder: FrameDecoder
  socket: Duplex
  /** 分片消息：起始帧的 opcode + 已累积的片 */
  fragments: Buffer[] | null
  fragmentOpcode: number
  bytes: number
  sawPong: number
}

export function createWsServer(options: WsServerOptions): WsServer {
  const log = options.log ?? ((): void => undefined)
  const pingIntervalMs = options.pingIntervalMs ?? 30_000
  const sessions = new Map<number, Session>()
  let nextId = 1
  let heartbeat: NodeJS.Timeout | undefined

  const reject = (socket: Duplex, status: number, message: string): false => {
    // 还没升级成 WebSocket，所以这里只能用裸 HTTP 回一个响应
    socket.write(
      `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Bad Request'}\r\n` +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        `Content-Length: ${Buffer.byteLength(message)}\r\n` +
        'Connection: close\r\n\r\n' +
        message,
    )
    socket.destroy()
    return false
  }

  const end = (session: Session, info: WsCloseInfo): void => {
    const { connection } = session
    if (connection.closed) return
    ;(connection as { closed: boolean }).closed = true
    sessions.delete(connection.id)
    if (sessions.size === 0 && heartbeat) {
      clearInterval(heartbeat)
      heartbeat = undefined
    }
    try {
      options.onClose(connection, info)
    } catch (error) {
      log(`[ws] onClose 抛错：${(error as Error).message}`)
    }
  }

  const destroy = (session: Session, code: number, reason: string, clean: boolean): void => {
    const { socket } = session
    if (!session.connection.closed) {
      try {
        socket.write(encodeFrame(OPCODES.close, closePayload(code, reason)))
      } catch {
        /* 对端可能已经没了 */
      }
      end(session, { code, reason, clean })
    }
    try {
      socket.end()
    } catch {
      /* 同上 */
    }
    // 对端不回 close 也不能把 socket 永远挂着
    const guard = setTimeout(() => socket.destroy(), 1_000)
    guard.unref?.()
  }

  const handleFrame = (session: Session, frame: { fin: boolean; opcode: number; payload: Buffer }): void => {
    const { connection } = session

    // 控制帧：不分片、不带长度超 125 的负载
    if (frame.opcode >= 0x8) {
      if (!frame.fin || frame.payload.length > 125) {
        destroy(session, 1002, '控制帧非法', false)
        return
      }
      if (frame.opcode === OPCODES.ping) {
        try {
          session.socket.write(encodeFrame(OPCODES.pong, frame.payload))
        } catch {
          destroy(session, 1011, '写心跳应答失败', false)
        }
        return
      }
      if (frame.opcode === OPCODES.pong) {
        session.sawPong = Date.now()
        return
      }
      // close：回一个 close 再断（RFC 要求尽量回声，语义上不回也不算错）
      const { code, reason } = parseClosePayload(frame.payload)
      destroy(session, code === 1005 ? 1000 : code, reason, true)
      return
    }

    if (frame.opcode === OPCODES.continuation) {
      if (!session.fragments) {
        destroy(session, 1002, '没有起始帧的续帧', false)
        return
      }
      session.fragments.push(frame.payload)
      session.bytes += frame.payload.length
      if (session.bytes > 8 * 1024 * 1024) {
        destroy(session, 1009, '消息过大', false)
        return
      }
      if (!frame.fin) return
      const whole = Buffer.concat(session.fragments, session.bytes)
      const opcode = session.fragmentOpcode
      session.fragments = null
      session.bytes = 0
      deliver(session, opcode, whole)
      return
    }

    if (frame.opcode !== OPCODES.text && frame.opcode !== OPCODES.binary) {
      destroy(session, 1002, `未知操作码 0x${frame.opcode.toString(16)}`, false)
      return
    }

    if (!frame.fin) {
      session.fragments = [frame.payload]
      session.fragmentOpcode = frame.opcode
      session.bytes = frame.payload.length
      return
    }

    deliver(session, frame.opcode, frame.payload)
  }

  const deliver = (session: Session, opcode: number, payload: Buffer): void => {
    if (opcode !== OPCODES.text) {
      // 协议规定客户端→服务端一律 JSON 文本；收到二进制说明对端不是我们的人
      destroy(session, 1003, '只接受文本帧', false)
      return
    }
    try {
      options.onMessage(session.connection, payload.toString('utf8'))
    } catch (error) {
      log(`[ws] onMessage 抛错：${(error as Error).message}`)
      destroy(session, 1011, '内部错误', false)
    }
  }

  const startHeartbeat = (): void => {
    if (heartbeat || pingIntervalMs <= 0) return
    heartbeat = setInterval(() => {
      const now = Date.now()
      for (const session of [...sessions.values()]) {
        // 两个心跳周期没动静就当对端已经不在了（浏览器会自动回 pong）
        if (now - session.sawPong > pingIntervalMs * 2) {
          log(`[ws] ${session.connection.remote} 心跳超时，断开。`)
          destroy(session, 1001, '心跳超时', false)
          continue
        }
        session.sawPong = Date.now()
        try {
          session.socket.write(encodeFrame(OPCODES.ping))
        } catch {
          destroy(session, 1011, '写心跳失败', false)
        }
      }
    }, pingIntervalMs)
    heartbeat.unref?.()
  }

  return {
    get size(): number {
      return sessions.size
    },

    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      const upgrade = String(req.headers.upgrade ?? '').toLowerCase()
      if (upgrade !== 'websocket') return reject(socket, 400, '不是 WebSocket 升级请求。')
      const key = req.headers['sec-websocket-key']
      if (typeof key !== 'string' || !key) return reject(socket, 400, '缺少 Sec-WebSocket-Key。')
      if (String(req.headers['sec-websocket-version'] ?? '') !== '13') return reject(socket, 400, '只支持 WebSocket 13。')

      // 唯一的鉴权点：不通过就连 101 都不发
      if (!options.authorize(req)) {
        log(`[ws] 拒绝了未授权的升级请求（${req.socket.remoteAddress ?? '未知地址'}）`)
        return reject(socket, 401, '未授权：请使用控制台里带 token 的地址打开。')
      }

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
      )
      // 升级之后这就是个裸字节通道了，别让 Nagle 把小块终端输出攒起来
      const netSocket = socket as unknown as { setNoDelay?: (on: boolean) => void; remoteAddress?: string }
      netSocket.setNoDelay?.(true)

      const id = nextId++
      const session: Session = {
        connection: {
          id,
          remote: String(netSocket.remoteAddress ?? '未知地址'),
          closed: false,
          send: (data) => {
            if (session.connection.closed) return false
            try {
              // 已经编码好的帧（心跳/关闭）直接透传，否则当消息正文编码成文本帧
              const frame = data instanceof Uint8Array && data.length >= 2 && (data[0]! & 0x80) !== 0 ? Buffer.from(data) : encodeFrame(OPCODES.text, data)
              socket.write(frame)
              return true
            } catch {
              destroy(session, 1011, '写入失败', false)
              return false
            }
          },
          close: (code = 1000, reason = '') => destroy(session, code, reason, true),
        },
        decoder: createFrameDecoder(),
        socket,
        fragments: null,
        fragmentOpcode: 0,
        bytes: 0,
        sawPong: Date.now(),
      }

      sessions.set(id, session)
      startHeartbeat()
      log(`[ws] 客户端 #${id} 已连接（来自 ${session.connection.remote}，当前 ${sessions.size} 条）`)

      try {
        options.onOpen(session.connection)
      } catch (error) {
        log(`[ws] onOpen 抛错：${(error as Error).message}`)
        destroy(session, 1011, '内部错误', false)
        return true
      }

      socket.on('data', (chunk: Buffer) => {
        if (session.connection.closed) return
        try {
          session.decoder.push(chunk)
          for (;;) {
            const frame = session.decoder.read()
            if (!frame) break
            handleFrame(session, frame)
            if (session.connection.closed) return
          }
        } catch (error) {
          if (error instanceof WsProtocolError) {
            log(`[ws] 客户端 #${id} 协议错误：${error.message}`)
            destroy(session, error.closeCode, error.message, false)
            return
          }
          log(`[ws] 客户端 #${id} 读取异常：${(error as Error).message}`)
          destroy(session, 1011, '读取失败', false)
        }
      })

      socket.on('error', (error: Error) => {
        if (session.connection.closed) return
        log(`[ws] 客户端 #${id} 连接错误：${error.message}`)
        socket.destroy()
        end(session, { code: 1006, reason: error.message, clean: false })
      })

      socket.on('close', () => {
        if (!session.connection.closed) end(session, { code: 1006, reason: '连接中断', clean: false })
      })

      // 升级请求可能已经带来了正文
      if (head?.length) {
        session.decoder.push(head)
        for (;;) {
          let frame
          try {
            frame = session.decoder.read()
          } catch (error) {
            if (error instanceof WsProtocolError) destroy(session, error.closeCode, error.message, false)
            break
          }
          if (!frame) break
          handleFrame(session, frame)
          if (session.connection.closed) break
        }
      }

      return true
    },

    close(): void {
      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeat = undefined
      }
      for (const session of [...sessions.values()]) destroy(session, 1001, '服务端关闭', true)
      sessions.clear()
    },
  }
}

/** 关闭帧的负载：2 字节大端码 + 可选 UTF-8 原因 */
function closePayload(code: number, reason: string): Buffer {
  const text = Buffer.from(reason, 'utf8').subarray(0, 123)
  const payload = Buffer.alloc(2 + text.length)
  payload.writeUInt16BE(code, 0)
  text.copy(payload, 2)
  return payload
}

/** 1005 = 「没有码」（RFC 里的保留值，不能出现在线上） */
function parseClosePayload(payload: Buffer): { code: number; reason: string } {
  if (payload.length < 2) return { code: 1005, reason: '' }
  return { code: payload.readUInt16BE(0), reason: payload.subarray(2).toString('utf8') }
}

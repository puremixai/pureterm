/*
 * RFC 6455 帧编解码 —— 只实现我们两端真的会用到的那部分。
 *
 * 为什么不引 `ws`：本机的 `npm install` 会被 SIGTERM 打断（见技能
 * `node-modules-npm-sigterm-repair`），而且在「客户端就是浏览器原生 WebSocket」的前提下，
 * 服务端只需要握手 + 拆帧两件事。自己实现的代价是几百行，收益是零新增依赖、
 * 且这段逻辑是**纯函数**、能在普通 Node 里单测（`smoke-desktop.mjs`）。
 *
 * 更要紧的一点：**鉴权发生在握手之前**（见 carrier-http.ts）。没通过 token 校验的连接
 * 根本进不到这个解析器，所以它的输入面只有「本机已授权的客户端」。
 *
 * 覆盖：掩码（客户端必带）、7/16/64 位长度、分片续帧、ping/pong/close 控制帧、超长消息拒绝。
 * 不覆盖：扩展协商（permessage-deflate 等一律不协商）、非 UTF-8 校验（交给上层 JSON.parse）。
 */

export const OPCODES = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const

/** 单条消息上限。终端输出再大也不该长这样，超过就是有人在灌垃圾。 */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024

/** 协议级错误：握手后遇到这种错只能断开，没法「跳过这一帧继续」。 */
export class WsProtocolError extends Error {
  constructor(
    message: string,
    /** RFC 6455 的关闭码，1002 = protocol error，1009 = message too big */
    readonly closeCode: number,
  ) {
    super(message)
    this.name = 'WsProtocolError'
  }
}

export interface WsFrame {
  fin: boolean
  opcode: number
  payload: Buffer
}

const EMPTY = Buffer.alloc(0)

/**
 * 服务端 → 客户端：**不掩码**（RFC 6455 §5.1，服务端发出的帧必须不带掩码）。
 */
export function encodeFrame(opcode: number, payload: Uint8Array | string = EMPTY): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)

  let header: Buffer
  if (body.length < 126) {
    header = Buffer.alloc(2)
    header[1] = body.length
  } else if (body.length < 0x10000) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(body.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    // 高 32 位恒为 0：JS 的 Buffer 长度本来也到不了 4 GiB
    header.writeUInt32BE(Math.floor(body.length / 0x100000000), 2)
    header.writeUInt32BE(body.length >>> 0, 6)
  }
  header[0] = 0x80 | (opcode & 0x0f)

  return body.length ? Buffer.concat([header, body]) : header
}

export interface FrameDecoder {
  /** 送进一段字节；内部按需缓存半个帧。 */
  push(chunk: Buffer): void
  /** 取一个完整帧；不够一个帧时返回 undefined。协议错误抛 WsProtocolError。 */
  read(): WsFrame | undefined
  /** 已缓存但还没凑成帧的字节数 */
  readonly buffered: number
  /** 已废弃的解码器不能再喂数据（读错之后调用方应当直接断开） */
  readonly broken: boolean
}

export function createFrameDecoder(maxMessageBytes: number = MAX_MESSAGE_BYTES): FrameDecoder {
  // 显式写成 Buffer（而不是由 EMPTY 推断）：Buffer.concat / subarray 的泛型参数
  // 在 @types/node 里会因为 ArrayBufferLike 与 ArrayBuffer 的差别而不兼容
  let buffer: Buffer = EMPTY
  let broken = false

  return {
    get buffered(): number {
      return buffer.length
    },
    get broken(): boolean {
      return broken
    },

    push(chunk: Buffer): void {
      if (broken) return
      if (!chunk.length) return
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
    },

    read(): WsFrame | undefined {
      if (broken) return undefined
      if (buffer.length < 2) return undefined

      const first = buffer[0]!
      const second = buffer[1]!
      const fin = (first & 0x80) !== 0
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2

      if (length === 126) {
        if (buffer.length < offset + 2) return undefined
        length = buffer.readUInt16BE(offset)
        offset += 2
      } else if (length === 127) {
        if (buffer.length < offset + 8) return undefined
        const high = buffer.readUInt32BE(offset)
        const low = buffer.readUInt32BE(offset + 4)
        offset += 8
        if (high !== 0 || low > maxMessageBytes) {
          broken = true
          throw new WsProtocolError('帧长度超出上限', 1009)
        }
        length = low
      }

      if (length > maxMessageBytes) {
        broken = true
        throw new WsProtocolError(`单帧 ${length} 字节，超过上限 ${maxMessageBytes}`, 1009)
      }

      // 客户端发来的帧**必须**带掩码；不带就是有人在手搓协议
      if (!masked) {
        broken = true
        throw new WsProtocolError('客户端帧未加掩码', 1002)
      }

      if (buffer.length < offset + 4 + length) return undefined
      const mask = buffer.subarray(offset, offset + 4)
      offset += 4

      const payload = Buffer.allocUnsafe(length)
      for (let index = 0; index < length; index += 1) {
        payload[index] = buffer[offset + index]! ^ mask[index & 3]!
      }
      buffer = buffer.subarray(offset + length)

      return { fin, opcode, payload }
    },
  }
}

import {
  METHODS,
  NOTICES,
  MAX_SESSION_ID_LENGTH,
  SUBSCRIPTION_ID_PATTERN,
  type KeySaveRequest,
  type PickedPrivateKey,
  type RendererReadyPayload,
  type RuntimeCapabilities,
} from '@pureterm/protocol'
import type { Host, HostInput, TerminalOpenPayload } from '@pureterm/host'
import { normalizeReadyPayload } from './readiness.js'

/*
 * 协议 → 公共契约 的唯一映射处。
 *
 * WebSocket carrier 把线上的方法名和参数交到这里，统一映射到 Host 公共 API。
 * Desktop 与独立 Web 共用这一份映射，避免入口之间的业务语义漂移。
 *
 * 这个文件**不 import electron**：载体依赖它，它不依赖载体。
 * 因此可以脱离 Electron 测试业务分发。
 */

export interface Dispatcher {
  /** 请求/响应。载体负责把 clientId 认定好再传进来。 */
  call(method: string, params: unknown[], clientId: string): Promise<unknown>
  /** 单向通知。没有回值，出错只能在日志里看。 */
  notify(name: string, params: unknown[], clientId: string): void
}

export interface DispatcherOptions {
  host: Host
  capabilities: RuntimeCapabilities
  /**
   * 弹系统文件对话框选私钥。
   *
   * Desktop Web Host 注入原生对话框。独立 Web 声明 browser 能力，
   * 由页面读取文件内容，此回调返回 undefined。clientId 用于确认调用者仍可用。
   */
  pickPrivateKey(clientId: string): Promise<PickedPrivateKey | undefined>
  /**
   * 渲染层上报「我起来了」。
   *
   * 独立 Web 可通过 WebSocket notice 使用此回调；Desktop 主窗口通过最小 IPC
   * 直接向 Electron main 上报。Host 不参与 Desktop 就绪闸门。
   */
  onReady(payload: RendererReadyPayload, clientId: string): void
}

/** 参数一律来自边界之外，收窄不了就报出来——绝不猜。 */
function asObject(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} 的第一个参数应当是一个对象。`)
  return value as Record<string, unknown>
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new Error(`${where} 期望一个字符串参数，收到 ${typeof value}。`)
  return value
}

function asNumber(value: unknown, where: string): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`${where} 期望一个数字参数，收到 ${String(value)}。`)
  return numeric
}

/**
 * 字节参数。
 *
 * 收窄成 Uint8Array，**不接受字符串**：上传的内容走线时被打了 `{ $bytes }` 标签，
 * WebSocket 载体已经解回 Uint8Array 了。
 * 如果哪一天这里拿到的是字符串，说明有人绕过了编码那一步——那时把它
 * 当 UTF-8 收下也许「看起来能跑」，但二进制文件会被静默改坏，所以宁可当场报出来。
 */
function asBytes(value: unknown, where: string): Uint8Array {
  if (value instanceof Uint8Array) return value
  throw new Error(`${where} 期望一段字节（Uint8Array），收到 ${Object.prototype.toString.call(value)}。`)
}

/**
 * 只收约定的字段。
 *
 * 监控的 start 请求曾经被想成「顺手把 clientId 也带上」——那是**自称身份**，
 * 而身份只能由载体认定。命令、路径、刷新间隔同理：任何一个被收下，SshApi 就从
 * 「订阅资源指标」变成了「在远端执行任意东西」。
 */
function rejectExtraFields(payload: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) throw new Error(`${where} 不接受字段「${key}」。`)
  }
}

/** 会话 ID：非空、有上限。上限来自协议常量，不在这里另抄一个数字。 */
function asSessionId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value || value.length > MAX_SESSION_ID_LENGTH) {
    throw new Error(`${where} 的会话 ID 不合法。`)
  }
  return value
}

/** 订阅 ID：UI 每次激活新建一个 UUID，字符集由协议定义。 */
function asSubscriptionId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !SUBSCRIPTION_ID_PATTERN.test(value)) {
    throw new Error(`${where} 的订阅 ID 不合法。`)
  }
  return value
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const { host } = options

  return {
    async call(method, params, clientId) {
      switch (method) {
        case METHODS.appCapabilities:
          return options.capabilities
        case METHODS.sshOpen: {
          const payload = asObject(params[0], 'ssh:open')
          // clientId 由载体认定后**在这里**并入，客户端的自称一律被忽略
          // （TerminalOpenRequest 里根本没有这个字段，见 shared/protocol.ts）
          return host.openTerminal({ ...payload, clientId } as unknown as TerminalOpenPayload)
        }
        case METHODS.sshPickPrivateKey:
          return options.pickPrivateKey(clientId)
        case METHODS.hostsList:
          return host.listHosts(clientId)
        case METHODS.hostsSave:
          return host.saveHost(asObject(params[0], 'hosts:save') as unknown as HostInput, clientId)
        case METHODS.hostsRemove:
          return host.removeHost(asString(params[0], 'hosts:remove'))
        case METHODS.keysList:
          return host.listKeys(clientId)
        case METHODS.keysSave:
          return host.saveKey(asObject(params[0], 'keys:save') as unknown as KeySaveRequest, clientId)
        case METHODS.keysRemove:
          return host.removeKey(asString(params[0], 'keys:remove'), clientId)
        /*
         * SFTP 五条。参数一律「先收窄、再往下传」：这里收到的东西来自边界之外，
         * 猜错一次就是拿一个 undefined 去操作远端文件。
         */
        case METHODS.sftpList:
          return host.sftpList(asString(params[0], 'sftp:list'), asString(params[1], 'sftp:list'))
        case METHODS.sftpRead:
          return host.sftpRead(asString(params[0], 'sftp:read'), asString(params[1], 'sftp:read'))
        case METHODS.sftpWrite:
          return host.sftpWrite(
            asString(params[0], 'sftp:write'),
            asString(params[1], 'sftp:write'),
            asString(params[2], 'sftp:write'),
            asBytes(params[3], 'sftp:write'),
          )
        case METHODS.sftpMkdir:
          return host.sftpMkdir(
            asString(params[0], 'sftp:mkdir'),
            asString(params[1], 'sftp:mkdir'),
            asString(params[2], 'sftp:mkdir'),
          )
        case METHODS.sftpRemove:
          return host.sftpRemove(asString(params[0], 'sftp:remove'), asString(params[1], 'sftp:remove'))
        /*
         * 监控两条。`clientId` 同样由载体认定后并入，请求体里出现它就直接报错——
         * 一个能被客户端自称的身份，等于没有身份。
         */
        case METHODS.monitorStart: {
          const payload = asObject(params[0], 'monitor:start')
          rejectExtraFields(payload, ['sessionId', 'subscriptionId'], 'monitor:start')
          return host.startMonitor({
            sessionId: asSessionId(payload.sessionId, 'monitor:start'),
            subscriptionId: asSubscriptionId(payload.subscriptionId, 'monitor:start'),
          }, clientId)
        }
        case METHODS.monitorStop:
          return host.stopMonitor(asSubscriptionId(params[0], 'monitor:stop'), clientId)
        default:
          throw new Error(`不认识的请求：${method}`)
      }
    },

    notify(name, params, clientId) {
      switch (name) {
        case NOTICES.appDispose:
          host.releaseClient(clientId)
          return
        case NOTICES.sshInput:
          host.input(asString(params[0], 'ssh:input'), asString(params[1], 'ssh:input'))
          return
        case NOTICES.sshResize:
          host.resize(asString(params[0], 'ssh:resize'), asNumber(params[1], 'ssh:resize'), asNumber(params[2], 'ssh:resize'))
          return
        case NOTICES.sshClose:
          host.close(asString(params[0], 'ssh:close'))
          return
        case NOTICES.appReady:
          options.onReady(normalizeReadyPayload(params[0]), clientId)
          return
        default:
          throw new Error(`不认识的通知：${name}`)
      }
    },
  }
}

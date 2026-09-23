import { Service, type Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    renderer: RendererService
  }
}

/**
 * 一个已连接的渲染层客户端。
 *
 * `id` 是**载体给的、不透明的**字符串：WebSocket 载体填 `ws:3`，
 * 测试可填自己的 id。领域层只把它当句柄转手，不解释、不拆解、不比较大小。
 *
 * 为什么是这个形状：早先这里叫 `webContentsId: number`——Electron 的渲染进程 id
 * 直接进了领域层的公共契约。字面上「插件层不 import electron」是成立的，
 * 但概念漏了过去，后果是**只要换载体就得改 src/**，那载体就不是可替换的实现。
 */
export interface RendererHandle {
  readonly id: string
  isAlive(): boolean
  /** 返回 false 表示这个客户端已经没了，调用方据此收尾，而不是继续往空气里写 */
  send(event: string, ...args: unknown[]): boolean
}

/**
 * 载体接缝。WebSocket 载体实现它：把「谁在说话」映射成一个 RendererHandle。
 *
 * 这个接口里**没有任何 Electron 类型**，所以插件树可以脱离 Electron 单测
 * （`tests/smoke-host.mjs` 用的就是这个接口的假实现），
 * 也是「渲染层与壳解耦」在领域侧的落点。
 */
export interface RendererBridge {
  /** 按不透明 id 找客户端；找不到返回 undefined。**不许跨 generation 缓存** */
  getRenderer(clientId: string): RendererHandle | undefined
}

/**
 * RendererService —— 插件树与渲染层之间唯一的桥。
 *
 * 提供客户端存活检查和消息投递；凭据存储独立通过 CredentialProvider 注入。
 */
export class RendererService extends Service {
  constructor(
    ctx: Context,
    private readonly bridge: RendererBridge,
  ) {
    super(ctx, 'renderer')
  }

  getRenderer(clientId: string): RendererHandle | undefined {
    return this.bridge.getRenderer(clientId)
  }

  isAlive(clientId: string): boolean {
    const renderer = this.bridge.getRenderer(clientId)
    return !!renderer && renderer.isAlive()
  }

  /** 返回 false 表示这个客户端已经不在了 */
  send(clientId: string, event: string, ...args: unknown[]): boolean {
    const renderer = this.bridge.getRenderer(clientId)
    if (!renderer || !renderer.isAlive()) return false
    try {
      return renderer.send(event, ...args)
    } catch {
      return false
    }
  }
}

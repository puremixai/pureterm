import type { RendererBridge, RendererHandle } from '@pureterm/host'

/*
 * 载体（carrier）与「合成桥」。
 *
 * 载体负责识别客户端并把 Host 事件发回它。目前业务载体只有
 * carrier-http.ts：本机 HTTP + WebSocket，客户端 id 是 `ws:<连接序号>`。
 *
 * 合成桥按 clientId 查询已装配的载体。这样 `RendererService` 只认识
 * 不透明 id，不需要知道入口如何创建载体。
 *
 * 注意 `seal` / `unseal` **不在载体接口里**：加解密是这台机器的平台能力
 * （Windows DPAPI / macOS Keychain），不是「哪条通道」的性质。
 * 运行入口将 CredentialProvider 直接注入 Host；合成桥仅处理客户端事件。
 *
 * 这个文件**不 import electron**：只用 RendererHandle 这个结构接口。
 */

export interface Carrier {
  /** 只用于日志：「哪个载体的客户端断了」 */
  readonly name: string
  /** 认领一个 clientId。不是自己的就返回 undefined——**不许猜**。 */
  getRenderer(clientId: string): RendererHandle | undefined
  /** 卸载载体；HTTP/WS 载体需要异步关闭服务器。 */
  dispose(): void | Promise<void>
}

/**
 * 把若干载体合成插件树唯一认识的那个 `RendererBridge`。
 *
 * `carriers` 传的是**取列表的函数**而不是列表本身：载体是等宿主起来之后才装配的，
 * 而桥要先进 `createHost`。传函数就不会被一个创建顺序问题绑住。
 */
export function createCompositeBridge(carriers: () => readonly Carrier[]): RendererBridge {
  return {
    getRenderer(clientId: string): RendererHandle | undefined {
      for (const carrier of carriers()) {
        const handle = carrier.getRenderer(clientId)
        if (handle) return handle
      }
      return undefined
    },
  }
}

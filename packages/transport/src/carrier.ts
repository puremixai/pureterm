import type { RendererBridge, RendererHandle } from '@pureterm/host'

/*
 * 载体（carrier）与「合成桥」。
 *
 * 一个载体 = 「能让渲染层说话的通道 + 它能提供哪些客户端」。目前两个：
 *   - carrier-ipc.ts：Electron 的 ipcMain/ipcRenderer，客户端 id 是 `ipc:<webContentsId>`
 *   - carrier-http.ts：本机 HTTP + WebSocket，客户端 id 是 `ws:<连接序号>`
 *
 * 两个可以同时活着，所以领域层拿到的 `RendererBridge` 必须是**合成**的：
 * 按 clientId 问每一个载体，谁认识就归谁。这样 `RendererService` 仍然是
 * 「按不透明 id 找客户端」这一个语义，插件树完全不需要知道有几个载体。
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
  /** 卸载。IPC 载体是同步的（摘监听器），Web 载体要关服务器所以返回 Promise。 */
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

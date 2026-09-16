import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { METHODS, NOTICES } from '../../shared/protocol.js'
import type { RendererHandle } from '../../src/host.js'
import type { Carrier } from './carrier.js'
import type { Dispatcher } from '../bridge/dispatch.js'

/*
 * Electron IPC 载体：把 ipcMain 的往来翻译成协议调用。
 *
 * 这个载体存在的意义不止「让 Electron 那套能跑」——它还是**默认**载体：
 * 桌面应用里渲染层和主进程在同一个进程组、同一条 contextBridge 上，
 * 没有端口、没有 token、没有第二个攻击面。Web 载体是给「想在浏览器里用同一个后端」
 * 准备的**并集**，不是替代。
 *
 * 客户端身份：`ipc:<webContentsId>`。**只有这里**知道这个映射；
 * 领域层拿到的是一个不透明字符串（见 src/services/renderer.ts 的说明）。
 */

export const IPC_CLIENT_PREFIX = 'ipc:'

export function ipcClientId(webContentsId: number): string {
  return `${IPC_CLIENT_PREFIX}${webContentsId}`
}

export interface IpcCarrierOptions {
  dispatcher: Dispatcher
  /** 现取当前 generation 的窗口。**不许缓存窗口对象**（跨 generation 缓存是明令禁止的） */
  getWindow: () => BrowserWindow | undefined
}

export function createIpcCarrier(options: IpcCarrierOptions): Carrier {
  const registered: Array<{ channel: string; kind: 'handle' | 'on' }> = []

  /**
   * 只有**当前 generation 的主框架**能调。
   *
   * 为什么值得多这一道：ipcMain 是进程级的，任何 webContents（将来某个预览面板、
   * 某个被误开的 iframe）都能往这些通道上发消息。校验来源之后，
   * 「谁能指挥 SSH 会话」这个问题就有了明确答案。
   */
  const senderOf = (event: IpcMainEvent | IpcMainInvokeEvent, where: string): string => {
    const window = options.getWindow()
    if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id) {
      throw new Error(`${where} 的调用者不是当前窗口。`)
    }
    return ipcClientId(event.sender.id)
  }

  for (const name of Object.values(METHODS)) {
    ipcMain.handle(name, (event: IpcMainInvokeEvent, ...params: unknown[]) =>
      options.dispatcher.call(name, params, senderOf(event, name)),
    )
    registered.push({ channel: name, kind: 'handle' })
  }

  for (const name of Object.values(NOTICES)) {
    ipcMain.on(name, (event: IpcMainEvent, ...params: unknown[]) => {
      try {
        options.dispatcher.notify(name, params, senderOf(event, name))
      } catch (error) {
        // 通知没有回执，出错只能留在日志里；但**绝不静默**
        console.error(`[ipc] ${name} 失败：`, error)
      }
    })
    registered.push({ channel: name, kind: 'on' })
  }

  return {
    name: 'ipc',

    getRenderer(clientId: string): RendererHandle | undefined {
      if (!clientId.startsWith(IPC_CLIENT_PREFIX)) return undefined
      const window = options.getWindow()
      if (!window || window.isDestroyed()) return undefined
      const contents = window.webContents
      if (contents.isDestroyed()) return undefined
      if (String(contents.id) !== clientId.slice(IPC_CLIENT_PREFIX.length)) return undefined

      return {
        id: clientId,
        isAlive: () => !contents.isDestroyed(),
        send: (event, ...args) => {
          if (contents.isDestroyed()) return false
          try {
            contents.send(event, ...args)
            return true
          } catch {
            return false
          }
        },
      }
    },

    dispose(): void {
      while (registered.length) {
        const entry = registered.pop()
        if (!entry) continue
        if (entry.kind === 'handle') ipcMain.removeHandler(entry.channel)
        else ipcMain.removeAllListeners(entry.channel)
      }
    },
  }
}

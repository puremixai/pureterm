import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, METHODS, NOTICES, type PickedPrivateKey, type SshApi } from '@pureterm/protocol'

/**
 * 这个文件被编译成 dist/electron/carriers/preload.cjs（CJS）。
 * 原因：Electron 的 preload 会忽略 package.json 里的 "type": "module"，
 * ESM preload 必须用 .mjs 且要求 sandbox: false。用 .cjs 可以保住 sandbox: true。
 * 这里是渲染层唯一的 Node 能力入口，只做转发，不放任何业务逻辑。
 *
 * 通道名一律从 shared/protocol 取，**不再写字面量**：
 * 以前 invoke 的字符串在这里、handle 的字符串在 main.ts，两处一漂移就是
 * 「界面点了没反应」——最难查的一类错，而且加 Web 载体时还得保证两条路一个字都不差。
 */

type ChannelListener<T extends unknown[]> = (...args: T) => void

const subscribe = <T extends unknown[]>(channel: string, listener: ChannelListener<T>): void => {
  ipcRenderer.on(channel, (_event, ...args) => listener(...(args as T)))
}

/**
 * IPC 载体的渲染层接口。
 *
 * 类型上必须与 `shared/protocol.ts` 的 `SshApi` 一致——这是刻意的：
 * 浏览器里打开同一份产物时，`renderer/transport.ts` 会用 WebSocket 实现**同一个接口**，
 * 于是 app.ts 完全不需要知道自己在哪条载体上。
 */
const sshAPI: SshApi = {
  carrier: 'ipc',
  getCapabilities: () => ipcRenderer.invoke(METHODS.appCapabilities),

  open: (payload) => ipcRenderer.invoke(METHODS.sshOpen, payload),
  input: (sessionId, data) => ipcRenderer.send(NOTICES.sshInput, sessionId, data),
  resize: (sessionId, cols, rows) => ipcRenderer.send(NOTICES.sshResize, sessionId, cols, rows),
  close: (sessionId) => ipcRenderer.send(NOTICES.sshClose, sessionId),

  /**
   * 弹系统文件对话框选私钥。只拿得到**路径**——私钥内容由主进程在连接那一刻现读，
   * 不经渲染层转手，也不落我们自己的盘。
   */
  pickPrivateKey: () => ipcRenderer.invoke(METHODS.sshPickPrivateKey) as Promise<PickedPrivateKey | undefined>,

  onOpened: (listener) => subscribe<[string, number, number]>(EVENTS.terminalOpened, listener),
  onData: (listener) => subscribe<[string, Uint8Array]>(EVENTS.terminalData, listener),
  onClosed: (listener) => subscribe<[string, string]>(EVENTS.terminalClosed, listener),

  hosts: {
    list: () => ipcRenderer.invoke(METHODS.hostsList),
    save: (input) => ipcRenderer.invoke(METHODS.hostsSave, input),
    remove: (id) => ipcRenderer.invoke(METHODS.hostsRemove, id),
  },

  /**
   * 远端文件。
   *
   * 注意这里**没有**「本地文件对话框」：下载的文件由渲染层自己用 Blob 存下来，
   * 上传的文件由渲染层自己用 `<input type="file">` 读。所以这条路在桌面端和
   * 浏览器端是同一条——不必为 Web 载体另写一份「文件到底存到哪台机器上」的逻辑。
   * 上传的字节走结构化克隆过去，本来就是 Uint8Array，不需要再编码。
   */
  sftp: {
    list: (sessionId, path) => ipcRenderer.invoke(METHODS.sftpList, sessionId, path),
    read: (sessionId, path) => ipcRenderer.invoke(METHODS.sftpRead, sessionId, path),
    write: (sessionId, dir, name, bytes) => ipcRenderer.invoke(METHODS.sftpWrite, sessionId, dir, name, bytes),
    mkdir: (sessionId, dir, name) => ipcRenderer.invoke(METHODS.sftpMkdir, sessionId, dir, name),
    remove: (sessionId, path) => ipcRenderer.invoke(METHODS.sftpRemove, sessionId, path),
  },

  /** 渲染层真正初始化完成时上报，供宿主做启动自检（did-finish-load 不足以说明应用可用）。 */
  signalReady: (payload) => ipcRenderer.send(NOTICES.appReady, payload),
}

contextBridge.exposeInMainWorld('sshAPI', sshAPI)

import { Context } from 'cordis'
import { dirname, join } from 'node:path'
import { RendererService, type RendererBridge } from './services/renderer.js'
import { SshService, type SshServiceConfig } from './services/ssh.js'
import { SessionStore, type HostInput, type HostRecord } from './plugins/session-store.js'
import { HostLog } from './plugins/host-log.js'
import { TerminalBridge, type TerminalOpenPayload, type TerminalOpenResult } from './plugins/terminal-bridge.js'
import { SftpBridge, type SftpDir, type SftpReadResult, type SftpWriteResult } from './plugins/sftp-bridge.js'

export interface HostOptions {
  /** 宿主与渲染层之间的桥；主进程传真实 Electron 实现，测试传假实现 */
  bridge: RendererBridge
  hostStoreFile: string
  /** 密文单独一个文件（0600）。不传就取 hostStoreFile 同目录下的 secrets.json。 */
  secretsFile?: string
  knownHostsFile: string
  /** 可选：覆盖 SSH 引擎的超时/keepalive 等参数 */
  ssh?: Partial<Omit<SshServiceConfig, 'knownHostsFile'>>
  /** 观测日志出口；传 false 关掉 */
  log?: ((line: string) => void) | false
}

/**
 * 公共契约用到的数据形状，从**公共契约模块**再导出一次。
 * 目的是让壳层（`electron/`）import 一句 `../src/host.js` 就够，
 * 不必知道 `plugins/` 下有哪几个文件——插件的文件布局是内部事。
 */
export type { HostInput, HostRecord } from './plugins/session-store.js'
export type { RendererBridge, RendererHandle } from './services/renderer.js'
export type { TerminalOpenPayload, TerminalOpenResult } from './plugins/terminal-bridge.js'
export type { SftpDir, SftpEntry, SftpReadResult, SftpWriteResult } from './plugins/sftp-bridge.js'

/**
 * Host —— 宿主对外的**公共契约**。
 *
 * 只有这里的成员是可以被壳层（Electron main / IPC）使用的。
 * 插件树的内部（ctx）放在 internals 下，并且明确标注只给测试与诊断脚本。
 *
 * 这条边界是照 dsh 划的：它对外只导出 `dsh-plugin-desktop/profile-service` 和 `pnpm`
 * 两个契约，desktopRuntime / bootstrap / Electron 可执行文件路径这些启动器内部细节一律不导出。
 * 一旦壳层开始直接摸 ctx.ssh / ctx.terminal，插件就从「可替换的实现」退化成「公开 API」——
 * 之后任何一次内部重构都会变成破坏性变更。
 */
export interface Host {
  openTerminal(payload: TerminalOpenPayload): Promise<TerminalOpenResult>
  input(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  close(sessionId: string): void
  listHosts(): HostRecord[]
  saveHost(input: HostInput): HostRecord
  removeHost(id: string): boolean
  /**
   * 远端文件。全部作用在**已打开的会话**上，所以都要 sessionId。
   *
   * 这五个方法就是「SFTP 是一个新能力」的全部证据：能力 = 公共契约上的一个洞。
   * 加它们的时候，载体层（carrier-ipc / carrier-http）一个字都没改——
   * 那是这条边界成立的判据。
   */
  sftpList(sessionId: string, path: string): Promise<SftpDir>
  sftpRead(sessionId: string, path: string): Promise<SftpReadResult>
  sftpWrite(sessionId: string, dir: string, name: string, bytes: Uint8Array): Promise<SftpWriteResult>
  sftpMkdir(sessionId: string, dir: string, name: string): Promise<void>
  sftpRemove(sessionId: string, path: string): Promise<void>
  /** 卸载整棵插件树（关掉所有连接）。可重复调用。 */
  dispose(): Promise<void>
  /**
   * 内部视图。**只给测试与诊断脚本**，壳层不要碰——
   * 需要新能力就把它加到 Host 上，而不是从这里绕过去。
   */
  readonly internals: HostInternals
}

export interface HostInternals {
  /** 整棵插件树的根 context */
  ctx: Context
  /** 卸载完毕。用来断言「插件真的被收干净了」。 */
  readonly disposed: boolean
}

/**
 * 宿主入口：一个 Node.js 进程 + 一棵插件树。
 * 这里没有任何 Electron 的运输逻辑，也没有 dsh 那套 agent 平面。
 * 用到的 Cordis 能力只有四样：Context / Service / inject / ctx.effect。
 *
 * 装配顺序无关紧要：inject 会让插件等服务就绪后自动激活。
 * 但「记录日志」不在装配范围里，它被抽成了一个插件（HostLog）——
 * 想换出口/关掉它就传 log，而不是改这个函数。
 */
export async function createHost(options: HostOptions): Promise<Host> {
  const root = new Context()
  const secretsFile = options.secretsFile ?? join(dirname(options.hostStoreFile), 'secrets.json')

  await root.plugin(RendererService, options.bridge)
  await root.plugin(SessionStore, { file: options.hostStoreFile, secretsFile })
  await root.plugin(SshService, { knownHostsFile: options.knownHostsFile, ...options.ssh })
  await root.plugin(TerminalBridge)
  await root.plugin(SftpBridge)
  if (options.log !== false) await root.plugin(HostLog, options.log ? { sink: options.log } : {})

  let disposed = false
  return {
    openTerminal: (payload) => root.terminal.open(payload),
    input: (sessionId, data) => root.terminal.input(sessionId, data),
    resize: (sessionId, cols, rows) => root.terminal.resize(sessionId, cols, rows),
    close: (sessionId) => root.terminal.close(sessionId, '用户断开连接。'),
    listHosts: () => root.sessionStore.list(),
    saveHost: (input) => root.sessionStore.save(input),
    removeHost: (id) => root.sessionStore.remove(id),
    sftpList: (sessionId, path) => root.sftp.list(sessionId, path),
    sftpRead: (sessionId, path) => root.sftp.read(sessionId, path),
    sftpWrite: (sessionId, dir, name, bytes) => root.sftp.write(sessionId, dir, name, bytes),
    sftpMkdir: (sessionId, dir, name) => root.sftp.mkdir(sessionId, dir, name),
    sftpRemove: (sessionId, path) => root.sftp.remove(sessionId, path),
    dispose: async () => {
      if (disposed) return
      disposed = true
      await root.fiber.dispose()
    },
    internals: {
      ctx: root,
      get disposed(): boolean {
        return disposed
      },
    },
  }
}

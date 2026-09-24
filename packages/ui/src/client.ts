import { Context, type Fiber } from 'cordis'
import type { RendererReadyPayload, SshApi } from '@pureterm/protocol'
import { ClientView, cleanError } from './client-runtime.js'
import { ClientTransport } from './services/transport.js'
import { ClientTerminal } from './services/terminal.js'
import { ClientHosts } from './features/hosts.js'
import { ClientKeychain } from './features/keychain.js'
import { ClientSftp } from './features/sftp.js'
import { ClientChrome } from './services/chrome.js'
import { ClientToasts } from './services/toasts.js'
import { ClientApplication } from './features/readiness.js'
import type { TerminalFactory } from './terminal-view.js'

export interface ClientOptions { document?: Document; api?: SshApi; terminalFactory?: TerminalFactory }
export interface Client {
  readonly context: Context
  readonly scopes: Readonly<Record<'view' | 'toasts' | 'transport' | 'terminal' | 'keychain' | 'hosts' | 'sftp' | 'chrome' | 'application', Fiber>>
  readonly ready: Promise<RendererReadyPayload>
  dispose(): Promise<void>
}

const mounted = new WeakMap<Document, Client>()

/** Desktop and Web mount exactly the same dependency graph; only the transport is supplied by the entry. */
export function createClient(options: ClientOptions = {}): Client {
  const document = options.document ?? globalThis.document
  if (mounted.has(document)) throw new Error('此文档已有客户端，请先 dispose 再重新挂载。')
  const context = new Context()
  let disposed = false
  let disposal: Promise<void> | undefined
  let settleStopped!: (payload: RendererReadyPayload) => void
  const stopped = new Promise<RendererReadyPayload>(resolve => { settleStopped = resolve })
  const scopes = {
    view: context.plugin(ClientView, { document }),
    // 通知要排在所有会 notify 的服务之前：挂载循环是按这里的成绩单依次 await 的。
    toasts: context.plugin(ClientToasts),
    transport: context.plugin(ClientTransport, { api: options.api }),
    terminal: context.plugin(ClientTerminal, { terminalFactory: options.terminalFactory }),
    keychain: context.plugin(ClientKeychain),
    hosts: context.plugin(ClientHosts),
    sftp: context.plugin(ClientSftp),
    chrome: context.plugin(ClientChrome),
    application: context.plugin(ClientApplication),
  }
  // A pending Cordis fiber can await before its dependencies exist. Wait in dependency
  // order so readiness cannot overtake provider activation during the first mount.
  const mounting = (async (): Promise<RendererReadyPayload> => {
    for (const scope of Object.values(scopes)) {
      await scope
      if (disposed) return stopped
    }
    return context.clientApplication.ready
  })().catch(error => ({ ok: false, hosts: 0, cols: 0, rows: 0, error: cleanError(error) }))
  const ready = Promise.race([stopped, mounting])
  const client: Client = {
    context, scopes, ready,
    dispose() {
      if (disposal) return disposal
      disposed = true
      settleStopped({ ok: false, hosts: 0, cols: 0, rows: 0, error: '客户端已卸载。' })
      disposal = context.fiber.dispose().finally(() => { if (mounted.get(document) === client) mounted.delete(document) })
      return disposal
    },
  }
  mounted.set(document, client)
  context.effect(() => {
    const onPageHide = (): void => { void client.dispose() }
    document.defaultView?.addEventListener('pagehide', onPageHide)
    return () => document.defaultView?.removeEventListener('pagehide', onPageHide)
  }, 'client.document')
  void ready.then(payload => {
    if (!payload.ok && !disposed) {
      const element = document.getElementById('status')
      if (element) { element.textContent = payload.error ?? '客户端初始化失败。'; element.className = 'err' }
    }
  })
  return client
}

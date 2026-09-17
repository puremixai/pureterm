import { Service, type Context } from 'cordis'
import type { RendererReadyPayload } from '@pureterm/protocol'
import { ClientScope, cleanError } from '../client-runtime.js'
import type { SmokeReport } from '../transport.js'

declare module 'cordis' { interface Context { clientApplication: ClientApplication } }

export class ClientApplication extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal', 'clientHosts', 'clientSftp']
  readonly scope: ClientScope
  readonly ready: Promise<RendererReadyPayload>

  constructor(ctx: Context) {
    super(ctx, 'clientApplication')
    this.scope = new ClientScope(ctx)
    const stopped = new Promise<RendererReadyPayload>(resolve => this.scope.onDispose(() => resolve({ ok: false, hosts: 0, cols: 0, rows: 0, error: '客户端已卸载。' })))
    this.ready = Promise.race([this.initialize(), stopped])
    const window = ctx.clientView.window
    if (new URLSearchParams(window.location.search).get('smoke') === '1') {
      const probe = { run: (config: { host: string; port: number; username: string; password: string }) => this.smoke(config) }
      window.__smoke = probe
      this.scope.onDispose(() => { if (window.__smoke === probe) delete window.__smoke })
    }
  }

  private async initialize(): Promise<RendererReadyPayload> {
    try {
      await this.ctx.clientHosts.ready
      if (!this.scope.alive) return { ok: false, hosts: 0, cols: 0, rows: 0, error: '客户端已卸载。' }
      await this.ctx.clientTerminal.settleLayout()
      if (!this.scope.alive) return { ok: false, hosts: 0, cols: 0, rows: 0, error: '客户端已卸载。' }
      const terminal = this.ctx.clientTerminal.terminal
      const payload = { ok: true, hosts: this.ctx.clientHosts.count, cols: terminal.cols, rows: terminal.rows }
      this.ctx.clientView.status('就绪')
      this.ctx.clientTransport.api.signalReady(payload)
      return payload
    } catch (error) {
      const message = cleanError(error)
      const payload = { ok: false, hosts: 0, cols: 0, rows: 0, error: message }
      if (this.scope.alive) { this.ctx.clientView.status(message, 'err'); this.ctx.clientTransport.api.signalReady(payload) }
      return payload
    }
  }

  private async smoke(config: { host: string; port: number; username: string; password: string }): Promise<SmokeReport> {
    const report: SmokeReport = { preload: typeof this.ctx.clientView.window.sshAPI, sessionId: null, openedSize: null,
      text: '', replacementChars: 0, closedReason: null, error: null }
    const api = this.ctx.clientTransport.api
    let unsubscribe: (() => void) | undefined
    let unregister: (() => void) | undefined
    try {
      const result = await this.ctx.clientTerminal.open({ ...config, cols: 100, rows: 30, term: 'xterm-256color' })
      if (!result) throw new Error('终端连接失败')
      const terminal = this.ctx.clientTerminal.active!.terminal
      report.sessionId = result.sessionId
      report.openedSize = { cols: result.cols, rows: result.rows }
      if (!await this.scope.delay(800)) throw new Error('客户端已卸载。')
      api.input(result.sessionId, 'ls\r')
      if (!await this.scope.delay(400)) throw new Error('客户端已卸载。')
      api.resize(result.sessionId, 120, 40)
      if (!await this.scope.delay(200)) throw new Error('客户端已卸载。')
      const closed = new Promise<string>(resolve => { unsubscribe = api.onClosed((id, reason) => { if (id === result.sessionId) resolve(reason) }) })
      unregister = this.scope.cancelOnDispose(() => unsubscribe?.())
      api.close(result.sessionId)
      report.closedReason = await Promise.race([closed, this.scope.delay(1500).then(() => null)])
      if (!await this.scope.delay(250)) throw new Error('客户端已卸载。')
      report.text = terminal.text()
      report.replacementChars = (report.text.match(/\uFFFD/g) ?? []).length
    } catch (error) { report.error = cleanError(error) }
    finally { unsubscribe?.(); unregister?.() }
    return report
  }
}

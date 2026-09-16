import { Service, type Context } from 'cordis'
import type { TerminalOpenRequest, TerminalOpenResult } from '@pureterm/protocol'
import { ClientScope, cleanError } from '../client-runtime.js'
import { createTerminalView, type TerminalFactory, type TerminalView } from '../terminal-view.js'

declare module 'cordis' {
  interface Context { clientTerminal: ClientTerminal }
  interface Events {
    'client/session-change'(sessionId: string | null): void
    'client/connection-change'(): void
  }
}

export class ClientTerminal extends Service {
  static inject = ['clientView', 'clientTransport']
  readonly scope: ClientScope
  readonly terminal: TerminalView
  sessionId: string | null = null
  connecting = false

  constructor(ctx: Context, options: { terminalFactory?: TerminalFactory } = {}) {
    super(ctx, 'clientTerminal')
    this.scope = new ClientScope(ctx)
    const { clientView: view, clientTransport: transport } = ctx
    const api = transport.api
    const container = view.element('terminal')
    this.terminal = (options.terminalFactory ?? createTerminalView)(container)
    this.scope.onDispose(() => {
      if (this.sessionId) api.close(this.sessionId)
      this.sessionId = null
      this.terminal.dispose()
      container.replaceChildren()
    })
    ctx.effect(() => api.onOpened((id, cols, rows) => {
      if (!this.scope.alive) return
      this.sessionId = id
      view.status(`已连接（远端 pty ${cols}×${rows}）`, 'ok')
      this.terminal.focus()
      api.resize(id, this.terminal.cols, this.terminal.rows)
      ctx.emit('client/session-change', id)
      ctx.emit('client/connection-change')
    }), 'terminal.opened')
    ctx.effect(() => api.onData((id, chunk) => { if (this.scope.alive && id === this.sessionId) this.terminal.write(chunk) }), 'terminal.data')
    ctx.effect(() => api.onClosed((id, reason) => {
      if (!this.scope.alive) return
      if (!id || id !== this.sessionId) return
      this.sessionId = null
      this.banner(reason ? `连接已结束：${reason}` : '连接已结束。', '33')
      view.status(reason || '已断开', 'err')
      ctx.emit('client/session-change', null)
      ctx.emit('client/connection-change')
    }), 'terminal.closed')
    ctx.effect(() => {
      const listener = this.terminal.onData(data => { if (this.sessionId) api.input(this.sessionId, data) })
      return () => listener.dispose()
    }, 'terminal.input')
    ctx.effect(() => {
      const listener = this.terminal.onResize(({ cols, rows }) => { if (this.sessionId) api.resize(this.sessionId, cols, rows) })
      return () => listener.dispose()
    }, 'terminal.resize')
    this.scope.listen(view.element('disconnect'), 'click', () => this.disconnect())
    // Observe the actual terminal container, including SFTP drawer and credential notice changes.
    ctx.effect(() => {
      const observer = new ResizeObserver(() => this.fit())
      observer.observe(container)
      return () => observer.disconnect()
    }, 'terminal.layout')
  }

  fit(): void {
    if (!this.scope.alive) return
    const { width, height } = this.ctx.clientView.element('terminal').getBoundingClientRect()
    if (width < 40 || height < 40) return
    try { this.terminal.fit() } catch (error) { console.warn('[renderer] fit 失败', error) }
  }

  settleLayout(): Promise<boolean> {
    const window = this.ctx.clientView.window
    if (!this.scope.alive) return Promise.resolve(false)
    return new Promise(resolve => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        window.cancelAnimationFrame(frame)
        clearTimeout(timer)
        unregister()
        if (this.scope.alive) { this.fit(); this.terminal.focus() }
        resolve(this.scope.alive)
      }
      const frame = window.requestAnimationFrame(finish)
      const timer = setTimeout(finish, 250)
      const unregister = this.scope.cancelOnDispose(finish)
    })
  }

  banner(text: string, color = '36'): void {
    for (const line of text.split('\n')) this.terminal.write(`\x1b[${color}m${line}\x1b[0m\r\n`)
  }

  async open(payload: TerminalOpenRequest): Promise<TerminalOpenResult | undefined> {
    if (this.sessionId || this.connecting || !this.scope.alive) return undefined
    this.connecting = true
    this.ctx.emit('client/connection-change')
    const address = `${payload.username}@${payload.host}:${payload.port ?? 22}`
    this.ctx.clientView.status(`正在连接 ${address} …`, 'pending')
    this.banner(`── 正在连接 ${address} ──`)
    const api = this.ctx.clientTransport.api
    try {
      const result = await api.open({ ...payload, cols: this.terminal.cols, rows: this.terminal.rows, term: 'xterm-256color' })
      if (!this.scope.alive) { api.close(result.sessionId); return undefined }
      this.sessionId = result.sessionId
      return result
    } catch (error) {
      if (this.scope.alive) {
        this.sessionId = null
        const message = cleanError(error)
        this.banner(message, '31')
        this.ctx.clientView.status(message, 'err')
      }
      return undefined
    } finally {
      if (this.scope.alive) { this.connecting = false; this.ctx.emit('client/connection-change') }
    }
  }

  disconnect(): void { if (this.sessionId) this.ctx.clientTransport.api.close(this.sessionId) }
}

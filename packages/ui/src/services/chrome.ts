import { Service, type Context } from 'cordis'
import { VERSION } from '../lib/version.js'

declare module 'cordis' { interface Context { clientChrome: ClientChrome } }

const STATE_TEXT: Record<string, string> = {
  connecting: '连接中', connected: '已连接', disconnected: '已断开', failed: '连接失败',
}

/**
 * The 24px status bar.
 *
 * Only four fields, because only four values exist to show: the Host reports no
 * negotiated cipher, no remote key type and no session uptime, and an
 * approximation of any of them in a status bar is worse than an empty slot.
 */
export class ClientChrome extends Service {
  static inject = ['clientView', 'clientTerminal']

  constructor(ctx: Context) {
    super(ctx, 'clientChrome')
    const view = ctx.clientView
    view.element('status-version').textContent = `v${VERSION}`
    ctx.on('client/connection-change', () => this.render())
    ctx.on('client/session-change', () => this.render())
    ctx.on('client/tab-closed', () => this.render())
    ctx.on('client/terminal-resize', () => this.render())
    this.render()
  }

  private render(): void {
    const view = this.ctx.clientView
    const tab = this.ctx.clientTerminal.active
    const dot = view.element('status-dot')
    if (!tab) {
      dot.dataset.state = ''
      view.element('status-state').textContent = '主机库'
      view.element('status-endpoint').textContent = `${this.ctx.clientTerminal.tabs.length} 个会话标签`
      view.element('status-size').textContent = '—'
      return
    }
    dot.dataset.state = tab.state
    view.element('status-state').textContent = STATE_TEXT[tab.state] ?? tab.state
    view.element('status-endpoint').textContent = `${tab.request.username}@${tab.request.host}:${tab.request.port ?? 22}`
    view.element('status-size').textContent = `${tab.terminal.cols}×${tab.terminal.rows}`
  }
}

import { Service, type Context } from 'cordis'
import { ClientScope } from '../client-runtime.js'
import { VERSION } from '../lib/version.js'

declare module 'cordis' { interface Context { clientChrome: ClientChrome } }

const STATE_TEXT: Record<string, string> = {
  connecting: '连接中', connected: '已连接', disconnected: '已断开', failed: '连接失败',
}

const CHROME_KEY = 'pureterm.chrome'
interface ChromePrefs { theme?: 'dark' | 'light'; density?: 'comfortable' | 'compact' }

/** One key for both choices: two independent keys would let a partial write leave a
 *  remembered theme and a lost density, which reads as the switch being broken. */
function readPrefs(storage: Storage): ChromePrefs {
  try { return JSON.parse(storage.getItem(CHROME_KEY) ?? '{}') as ChromePrefs } catch { return {} }
}

/**
 * The 24px status bar, the theme and the row density.
 *
 * Only four status fields, because only four values exist to show: the Host
 * reports no negotiated cipher, no remote key type and no session uptime, and an
 * approximation of any of them in a status bar is worse than an empty slot.
 */
export class ClientChrome extends Service {
  static inject = ['clientView', 'clientTerminal']
  private readonly scope: ClientScope

  constructor(ctx: Context) {
    super(ctx, 'clientChrome')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    view.element('status-version').textContent = `v${VERSION}`
    const html = view.document.documentElement
    const storage = view.window.localStorage
    const prefs = readPrefs(storage)
    const theme = view.element<HTMLButtonElement>('theme-toggle')
    const density = view.element<HTMLButtonElement>('density-toggle')
    const apply = (): void => {
      if (prefs.theme) html.dataset.theme = prefs.theme
      if (prefs.density) html.dataset.density = prefs.density
      theme.setAttribute('aria-pressed', String(prefs.theme === 'light'))
      theme.setAttribute('aria-label', prefs.theme === 'light' ? '切换到深色主题' : '切换到浅色主题')
      theme.firstElementChild!.className = `ti ${prefs.theme === 'light' ? 'ti-sun' : 'ti-moon'}`
      density.setAttribute('aria-pressed', String(prefs.density === 'compact'))
      density.setAttribute('aria-label', prefs.density === 'compact' ? '切换到舒适行高' : '切换到紧凑行高')
      density.firstElementChild!.className = `ti ${prefs.density === 'compact' ? 'ti-arrows-maximize' : 'ti-arrows-minimize'}`
    }
    const save = (): void => {
      // A storage denial costs the choice, not the session: the switch still
      // works for this page, it just will not be remembered.
      try { storage.setItem(CHROME_KEY, JSON.stringify(prefs)) } catch { /* blocked or full */ }
    }
    this.scope.listen(theme, 'click', () => {
      prefs.theme = prefs.theme === 'light' ? 'dark' : 'light'
      save()
      apply()
    })
    this.scope.listen(density, 'click', () => {
      prefs.density = prefs.density === 'compact' ? 'comfortable' : 'compact'
      save()
      apply()
    })
    ctx.on('client/connection-change', () => this.render())
    ctx.on('client/session-change', () => this.render())
    ctx.on('client/tab-closed', () => this.render())
    ctx.on('client/terminal-resize', () => this.render())
    apply()
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

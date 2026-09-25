import { Service, type Context } from 'cordis'
import type { DesktopBridge } from '@pureterm/protocol'
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
 * Every field is a value the renderer already owns. The Host reports no
 * negotiated cipher, no remote host key type, no session uptime and no transfer
 * rate, so those slots stay absent rather than filled with a plausible number:
 * an approximation in a status bar is worse than an empty space, because the
 * user has no way to tell which one they are reading.
 */
export class ClientChrome extends Service {
  static inject = ['clientView', 'clientTerminal', 'clientSftp']
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
    // 顶栏自绘的最小化/最大化/关闭。它只属于「系统自己不画按钮」的桌面端 —— Web 端
    // 没有窗口可控，macOS 的红绿灯由系统画在左上角，两种情况下桥都不带这一项（见
    // platform-plan.ts 的 drawsOwnWindowControls）。所以这里既没有 markup 可揭，也
    // 没有一组点不动的按钮留在页面上：节点和样式都是这一刻才来的。
    const windowControls = view.window.puretermDesktop?.windowControls
    if (windowControls) this.mountWindowControls(windowControls)
    ctx.on('client/connection-change', () => this.render())
    ctx.on('client/session-change', () => this.render())
    ctx.on('client/tab-closed', () => this.render())
    ctx.on('client/terminal-resize', () => this.render())
    ctx.on('client/files-change', () => this.render())
    apply()
    this.render()
  }

  /**
   * 顶栏右端那三个按钮：样式先落地，节点后建。
   *
   * 顺序是刻意的。先建节点的话，在 desktop.css 到达之前会有一帧是三个没有样式的字形
   * 挤在 40px 的栏里，正好是这套样式存在要避免的样子。sheet 没拿到时也建 —— 按钮没
   * 样式，比 Windows/Linux 上没有关窗入口轻。
   *
   * 节点是建的，不是揭的：`#window-controls` 不在 index.html 里。Web 端没有窗口可控，
   * 就不该连三个按钮和它们的规则一起带上，而这份 markup 是两个入口共用的。
   */
  private mountWindowControls(controls: NonNullable<DesktopBridge['windowControls']>): void {
    const view = this.ctx.clientView
    const link = view.document.createElement('link')
    link.rel = 'stylesheet'
    link.href = './desktop.css'
    const mount = (): void => {
      if (!this.scope.alive) return
      const cluster = view.document.createElement('div')
      cluster.id = 'window-controls'
      cluster.className = 'window-controls'
      const add = (id: string, label: string, glyph: string, act: () => void, close = false): void => {
        const button = view.document.createElement('button')
        button.type = 'button'
        button.id = id
        button.className = close ? 'window-control is-close' : 'window-control'
        // 字形直接写在按钮里，`aria-label` 覆盖它 —— 不写的话可访问名字会是「–」。
        button.textContent = glyph
        button.title = label
        button.setAttribute('aria-label', `${label}窗口`)
        this.scope.listen(button, 'click', act)
        cluster.append(button)
      }
      add('window-minimize', '最小化', '–', () => controls.minimize())
      add('window-maximize', '最大化', '▢', () => controls.toggleMaximize())
      add('window-close', '关闭', '✕', () => controls.close(), true)
      const actions = view.document.querySelector('.topbar-actions')
      if (!actions) throw new Error('缺少元素 .topbar-actions')
      actions.append(cluster)
      // 节点是这里建的，就由这里拆：不拆的话，客户端重挂一次就会在顶栏里叠出第二组
      // 同 id 的按钮，而 getElementById 只会拿到第一组。样式表留着不动 —— 它是文档级
      // 资产，拆了只会让下一次挂载重新取一遍。
      this.scope.onDispose(() => cluster.remove())
    }
    this.scope.listen(link, 'load', mount)
    this.scope.listen(link, 'error', mount)
    view.document.head.append(link)
  }

  private render(): void {
    const view = this.ctx.clientView
    const tab = this.ctx.clientTerminal.active
    const tabs = this.ctx.clientTerminal.tabs
    const dot = view.element('status-dot')
    // 「第几个会话」和标签栏是同一件事的两种说法，所以它在没有会话时也有话说。
    view.element('status-session').textContent = tab
      ? `会话 ${tabs.findIndex(item => item.id === tab.id) + 1} / ${tabs.length}`
      : `${tabs.length} 个会话`
    if (!tab) {
      dot.dataset.state = ''
      view.element('status-state').textContent = '主机库'
      view.element('status-endpoint').textContent = '—'
      view.element('status-size').textContent = '—'
      view.element('status-hint').textContent = ''
      return
    }
    dot.dataset.state = tab.state
    view.element('status-state').textContent = STATE_TEXT[tab.state] ?? tab.state
    view.element('status-endpoint').textContent = `${tab.request.username}@${tab.request.host}:${tab.request.port ?? 22}`
    view.element('status-size').textContent = `${tab.terminal.cols}×${tab.terminal.rows}`
    // 只有真成立的话才写：文件表没开就没有竖线，也就没有可拖的东西。
    const hints = ['Ctrl W 关闭标签']
    if (this.ctx.clientSftp.open) hints.unshift('拖动竖线可调整比例')
    view.element('status-hint').textContent = hints.join(' · ')
  }
}

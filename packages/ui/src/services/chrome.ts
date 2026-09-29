import { Service, type Context } from 'cordis'
import type { DesktopBridge, SessionFacts } from '@pureterm/protocol'
import { getLocale, isLocale, setLocale, t, tPlural, type Locale, type MessageKey } from '@pureterm/i18n'
import { ClientScope } from '../client-runtime.js'
import { translateDocument } from '../i18n-dom.js'
import { VERSION } from '../lib/version.js'

declare module 'cordis' { interface Context { clientChrome: ClientChrome } }

const STATE_KEY: Record<string, MessageKey> = {
  connecting: 'chrome.state.connecting', connected: 'chrome.state.connected',
  disconnected: 'chrome.state.disconnected', failed: 'chrome.state.failed',
}

const CHROME_KEY = 'pureterm.chrome'
interface ChromePrefs {
  theme?: 'dark' | 'light'
  density?: 'comfortable' | 'compact'
  locale?: Locale
}

/** 记住的握手事实条数上限。够覆盖「事件先到、会话后登记」的顺序，又不会无限长。 */
const FACTS_LIMIT = 8

/** One key for every choice: independent keys would let a partial write leave a
 *  remembered theme and a lost density, which reads as the switch being broken. */
function readPrefs(storage: Storage): ChromePrefs {
  try { return JSON.parse(storage.getItem(CHROME_KEY) ?? '{}') as ChromePrefs } catch { return {} }
}

/** 两个方向协商出同一个 cipher 时只写一个名字，不同才把另一个也写出来。 */
function cipherText(cipher: SessionFacts['cipher']): string {
  return cipher.clientToServer === cipher.serverToClient
    ? cipher.clientToServer
    : `${cipher.clientToServer} → ${cipher.serverToClient}`
}

/**
 * The 24px status bar, the theme and the row density.
 *
 * Every field is a value the renderer already owns. Two of the four slots this
 * bar used to leave empty are now filled from the SSH handshake: the negotiated
 * cipher and the server host key algorithm, which arrive on `session:facts` and
 * never change within a connection. They come straight from the transport rather
 * than from ClientMonitor, so unloading the monitor plugin cannot blank them.
 *
 * Two slots stay empty, and for different reasons. The session's own uptime is
 * not reported anywhere — the snapshot carries the **host's** uptime, which is a
 * different figure, and one must not be printed as the other. The transfer rate
 * has no channel at all. An approximation in a status bar is worse than an empty
 * space, because the user has no way to tell which one they are reading.
 */
export class ClientChrome extends Service {
  static inject = ['clientView', 'clientTerminal', 'clientSftp', 'clientTransport']
  private readonly scope: ClientScope
  /**
   * 握手事实按 sessionId 存。**比 ClientMonitor 先活、比它后死**：它不属于监控，
   * 卸载监控插件不该让状态栏空掉，所以这一份不能放在那个插件里。
   */
  private readonly facts = new Map<string, SessionFacts>()

  constructor(ctx: Context) {
    super(ctx, 'clientChrome')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    view.element('status-version').textContent = `v${VERSION}`
    ctx.effect(() => ctx.clientTransport.api.monitor.onSessionFacts(facts => this.record(facts)), 'chrome.session-facts')
    const html = view.document.documentElement
    const storage = view.window.localStorage
    const prefs = readPrefs(storage)
    // English is the default, because English is the catalog's source language.
    // A stored choice always wins, so the one click a Chinese reader makes is
    // remembered from then on.
    if (!isLocale(prefs.locale)) prefs.locale = 'en'
    const theme = view.element<HTMLButtonElement>('theme-toggle')
    const density = view.element<HTMLButtonElement>('density-toggle')
    const locale = view.element<HTMLButtonElement>('locale-toggle')
    const apply = (): void => {
      if (prefs.theme) html.dataset.theme = prefs.theme
      if (prefs.density) html.dataset.density = prefs.density
      theme.setAttribute('aria-pressed', String(prefs.theme === 'light'))
      theme.setAttribute('aria-label', t(prefs.theme === 'light' ? 'chrome.theme.to-dark' : 'chrome.theme.to-light'))
      theme.title = t('chrome.theme.title')
      theme.firstElementChild!.className = `ti ${prefs.theme === 'light' ? 'ti-sun' : 'ti-moon'}`
      density.setAttribute('aria-pressed', String(prefs.density === 'compact'))
      density.setAttribute('aria-label', t(prefs.density === 'compact' ? 'chrome.density.to-comfortable' : 'chrome.density.to-compact'))
      density.title = t('chrome.density.title')
      density.firstElementChild!.className = `ti ${prefs.density === 'compact' ? 'ti-arrows-maximize' : 'ti-arrows-minimize'}`
      // 语言必须先落到 t() 上、再翻译文档，反过来会把上一门语言又写回去。
      const current: Locale = prefs.locale ?? 'en'
      setLocale(current)
      html.lang = current === 'zh' ? 'zh-CN' : 'en'
      html.dataset.locale = current
      locale.setAttribute('aria-pressed', String(current === 'zh'))
      locale.setAttribute('aria-label', t(current === 'zh' ? 'chrome.locale.to-en' : 'chrome.locale.to-zh'))
      locale.title = t('chrome.locale.title')
      translateDocument(view.document)
    }
    const save = (): void => {
      // A storage denial costs the choice, not the session: the switch still
      // works for this page, it just will not be remembered.
      try { storage.setItem(CHROME_KEY, JSON.stringify(prefs)) } catch { /* blocked or full */ }
    }
    /**
     * 主题换完之后广播一次。终端在构造时把 CSS 变量读成了 xterm 的主题对象，
     * 之后不会再自己看 `data-theme`，所以这条事件是它唯一的重读机会 —— 必须
     * 排在 `apply()` 后面，否则它读到的是上一组的计算值。密度开关不广播：它
     * 动的 `--row-h` 不在终端的配色里。
     */
    const announceTheme = (): void => {
      ctx.emit('client/theme-change', prefs.theme === 'light' ? 'light' : 'dark')
    }
    /**
     * 语言换完之后广播一次。静态 markup 由 apply() 自己翻译，但**已经画出来的**
     * 动态文案不会自己变：标签名、主机列表、密钥列表、失败页、资源面板各自在
     * render() 里拼句子，所以每一处都要听这条事件重画一次。密度开关同样不广播 ——
     * 它换的是一行的高度，没有一句话跟着变。
     */
    const announceLocale = (): void => {
      ctx.emit('client/locale-change', getLocale())
    }
    this.scope.listen(theme, 'click', () => {
      prefs.theme = prefs.theme === 'light' ? 'dark' : 'light'
      save()
      apply()
      announceTheme()
    })
    this.scope.listen(density, 'click', () => {
      prefs.density = prefs.density === 'compact' ? 'comfortable' : 'compact'
      save()
      apply()
    })
    this.scope.listen(locale, 'click', () => {
      prefs.locale = prefs.locale === 'zh' ? 'en' : 'zh'
      save()
      apply()
      announceLocale()
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
    ctx.on('client/drawer-change', () => this.render())
    // 状态栏那几格是拼出来的（「会话 1 / 2」「主机库」「Ctrl W 关闭标签」），所以
    // 换语言也得重画它 —— 静态 markup 由 apply() 自己翻译，这几格不在里面。
    ctx.on('client/locale-change', () => this.render())
    apply()
    // 开局也广播一次：ClientTerminal 排在 ClientChrome 前面挂载，它的空闲终端
    // 是在 `data-theme` 落地之前构造的，所以「记住的浅色主题」也要靠这条事件
    // 才能到达它。挂载顺序保证了这里发声时监听方已经就位。
    announceTheme()
    // 同一个理由，同一段顺序：主机、密钥、SFTP、监控都在 ClientChrome 之前构造，
    // 它们构造时画出来的那批文案是默认语言的，要靠这条事件改成记住的那一门。
    announceLocale()
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
        button.setAttribute('aria-label', t('window.control', { label }))
        this.scope.listen(button, 'click', act)
        cluster.append(button)
      }
      add('window-minimize', t('window.minimize'), '–', () => controls.minimize())
      add('window-maximize', t('window.maximize'), '▢', () => controls.toggleMaximize())
      add('window-close', t('window.close'), '✕', () => controls.close(), true)
      const actions = view.document.querySelector('.topbar-actions')
      if (!actions) throw new Error('The document is missing .topbar-actions')
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

  /**
   * 收下一条握手事实。
   *
   * 只有**更高**的 revision 才算新：rekey 会用更高的值取代更早的一组，重复的或更低
   * 的是迟到的事件。事实可能在会话登记之前到达（宿主在 terminal:opened 之后立刻发
   * 它，而 tab 的 sessionId 要等 open 的回复），所以这里先存下来，由下一次 render
   * 按当前会话取用；上限之外的按插入顺序丢弃，一个从未打开的会话不会永远占着位置。
   */
  private record(facts: SessionFacts): void {
    const held = this.facts.get(facts.sessionId)
    if (held && held.revision >= facts.revision) return
    this.facts.set(facts.sessionId, facts)
    while (this.facts.size > FACTS_LIMIT) {
      const oldest = this.facts.keys().next().value
      if (oldest === undefined) break
      this.facts.delete(oldest)
    }
    this.render()
  }

  private render(): void {
    const view = this.ctx.clientView
    const tab = this.ctx.clientTerminal.active
    const tabs = this.ctx.clientTerminal.tabs
    const dot = view.element('status-dot')
    // 握手事实按当前会话取；没有会话、或者事实还没到，就是一条破折号 —— 和
    // #status-endpoint 在没有会话时一样，而不是留一个空格让人猜那里本来有没有东西。
    const facts = tab?.sessionId ? this.facts.get(tab.sessionId) : undefined
    view.element('status-cipher').textContent = facts ? cipherText(facts.cipher) : '—'
    view.element('status-key').textContent = facts ? facts.serverHostKey : '—'
    // 「第几个会话」和标签栏是同一件事的两种说法，所以它在没有会话时也有话说。
    view.element('status-session').textContent = tab
      ? t('chrome.sessions.position', { index: tabs.findIndex(item => item.id === tab.id) + 1, total: tabs.length })
      : tPlural('chrome.sessions', tabs.length)
    if (!tab) {
      dot.dataset.state = ''
      view.element('status-state').textContent = t('chrome.status.hosts')
      view.element('status-endpoint').textContent = '—'
      view.element('status-size').textContent = '—'
      view.element('status-hint').textContent = ''
      return
    }
    dot.dataset.state = tab.state
    const stateKey = STATE_KEY[tab.state]
    view.element('status-state').textContent = stateKey ? t(stateKey) : tab.state
    view.element('status-endpoint').textContent = `${tab.request.username}@${tab.request.host}:${tab.request.port ?? 22}`
    view.element('status-size').textContent = `${tab.terminal.cols}×${tab.terminal.rows}`
    // 只有真成立的话才写：两格抽屉都没开就没有竖线，也就没有可拖的东西。
    const hints = [t('chrome.hint.close-tab')]
    if (this.ctx.clientSftp.open || !view.element('session-monitor').hidden) hints.unshift(t('chrome.hint.drag-split'))
    view.element('status-hint').textContent = hints.join(' · ')
  }
}

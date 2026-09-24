import { Service, type Context } from 'cordis'
import type { TerminalOpenRequest, TerminalOpenResult } from '@pureterm/protocol'
import { ClientScope, cleanError, DomListeners } from '../client-runtime.js'
import { createTerminalView, type TerminalFactory, type TerminalView } from '../terminal-view.js'

export type TabState = 'connecting' | 'connected' | 'disconnected' | 'failed'
export interface TerminalTab {
  readonly id: string
  readonly title: string
  readonly request: TerminalOpenRequest
  readonly terminal: TerminalView
  readonly container: HTMLElement
  sessionId: string | null
  state: TabState
  message: string
  logs: string[]
}
interface OwnedTab extends TerminalTab {
  button: HTMLButtonElement
  label: HTMLElement
  strip: HTMLElement
  listeners: DomListeners
  release(): void
  attempt: number
}
interface EarlyEvents { chunks: Uint8Array[]; bytes: number; closed?: string }

declare module 'cordis' {
  interface Context { clientTerminal: ClientTerminal }
  interface Events {
    'client/session-change'(sessionId: string | null): void
    'client/connection-change'(): void
    'client/tab-closed'(tabId: string): void
    'client/terminal-resize'(size: { cols: number; rows: number }): void
    'client/edit-connection'(request: TerminalOpenRequest, title: string): void
    'client/keychain-change'(): void
  }
}

/** Each tab owns one terminal and one SSH session. Hosts is a persistent, separate page. */
export class ClientTerminal extends Service {
  static inject = ['clientView', 'clientTransport']
  readonly scope: ClientScope
  private readonly owned = new Map<string, OwnedTab>()
  private readonly bySession = new Map<string, OwnedTab>()
  private readonly early = new Map<string, EarlyEvents>()
  private readonly factory: TerminalFactory
  private idle: { terminal: TerminalView; container: HTMLElement } | null
  private activeId: string | null = null
  private libraryPage: 'hosts' | 'keychain' = 'hosts'
  private nextId = 0
  private opening = 0
  private stopped = false

  constructor(ctx: Context, options: { terminalFactory?: TerminalFactory } = {}) {
    super(ctx, 'clientTerminal')
    this.scope = new ClientScope(ctx)
    this.factory = options.terminalFactory ?? createTerminalView
    const view = ctx.clientView
    const api = ctx.clientTransport.api
    this.idle = this.createPane()
    this.scope.onDispose(() => {
      this.stopped = true
      for (const tab of this.owned.values()) {
        if (tab.sessionId) api.close(tab.sessionId)
        tab.release()
      }
      this.owned.clear()
      this.bySession.clear()
      this.early.clear()
      this.idle?.terminal.dispose()
      this.idle?.container.remove()
      this.idle = null
      this.activeId = null
      view.element('session-workspace').hidden = true
      view.element('hosts-panel').hidden = false
      view.element('app').classList.remove('session-mode')
    })
    ctx.effect(() => api.onOpened(id => {
      // The opened event may precede the RPC reply. Never associate it with the active tab.
      if (this.stopped) { api.close(id); return }
      if (this.opening && !this.bySession.has(id)) this.early.set(id, { chunks: [], bytes: 0 })
    }), 'terminal.opened')
    ctx.effect(() => api.onData((id, chunk) => {
      if (this.stopped) return
      const tab = this.bySession.get(id)
      if (tab) { tab.terminal.write(chunk); return }
      const pending = this.early.get(id)
      if (!pending) return
      if (pending.bytes + chunk.byteLength > 1024 * 1024) {
        pending.closed = '连接初始化期间输出过多，请重新连接。'
        api.close(id)
        return
      }
      pending.chunks.push(chunk)
      pending.bytes += chunk.byteLength
    }), 'terminal.data')
    ctx.effect(() => api.onClosed((id, reason) => {
      if (this.stopped || !id) return
      const tab = this.bySession.get(id)
      if (tab) this.ended(tab, reason)
      else {
        const pending = this.early.get(id)
        if (pending) pending.closed = reason || '连接已结束。'
      }
    }), 'terminal.closed')
    this.scope.listen(view.element('hosts-tab'), 'click', () => this.select(null, this.libraryPage))
    this.scope.listen(view.element('disconnect'), 'click', () => this.disconnect())
    for (const id of ['session-reconnect', 'failure-retry']) {
      this.scope.listen(view.element(id), 'click', () => { if (this.active) void this.retry(this.active.id) })
    }
    this.scope.listen(view.element('failure-close'), 'click', () => { if (this.active) this.closeTab(this.active.id) })
    this.scope.listen(view.element('failure-edit'), 'click', () => {
      const tab = this.active
      if (!tab) return
      ctx.emit('client/edit-connection', { ...tab.request }, tab.title)
    })
    this.scope.listen(view.element('failure-copy'), 'click', () => void this.copyLogs())
    this.scope.listen(view.element('workspace-tabs'), 'keydown', event => {
      const key = event as KeyboardEvent
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key.key)) return
      const ids = [null, ...this.owned.keys()]
      const index = ids.indexOf(this.activeId)
      const next = key.key === 'Home' ? 0 : key.key === 'End' ? ids.length - 1
        : (index + (key.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length
      key.preventDefault()
      this.select(ids[next]!, this.libraryPage)
      ;(this.active ? this.owned.get(this.active.id)!.button : view.element('hosts-tab')).focus()
    })
    this.scope.listen(view.document, 'keydown', event => {
      const key = event as KeyboardEvent
      if (!(key.ctrlKey || key.metaKey) || view.element<HTMLDialogElement>('shortcuts-dialog').open) return
      if (key.key === 'Tab') {
        key.preventDefault()
        key.stopPropagation()
        const ids = [null, ...this.owned.keys()]
        this.select(ids[(ids.indexOf(this.activeId) + (key.shiftKey ? -1 : 1) + ids.length) % ids.length]!, this.libraryPage)
      } else if (key.key.toLowerCase() === 'w' && this.active) {
        key.preventDefault()
        key.stopPropagation()
        this.closeTab(this.active.id)
      }
    }, true)
    ctx.effect(() => {
      const observer = new ResizeObserver(() => this.fit())
      observer.observe(view.element('terminal'))
      return () => observer.disconnect()
    }, 'terminal.layout')
    this.select(null)
  }

  get tabs(): readonly TerminalTab[] { return [...this.owned.values()] }
  get active(): TerminalTab | undefined { return this.activeId ? this.owned.get(this.activeId) : undefined }
  get sessionId(): string | null { return this.active?.sessionId ?? null }
  get connecting(): boolean { return this.active?.state === 'connecting' }
  get terminal(): TerminalView { return this.active?.terminal ?? this.idle?.terminal ?? this.owned.values().next().value!.terminal }

  private createPane() {
    const container = this.ctx.clientView.document.createElement('div')
    container.className = 'terminal-pane'
    container.hidden = true
    this.ctx.clientView.element('terminal').append(container)
    return { container, terminal: this.factory(container) }
  }

  private createTab(request: TerminalOpenRequest, title: string): OwnedTab {
    const pane = this.idle ?? this.createPane()
    this.idle = null
    const doc = this.ctx.clientView.document
    const id = `terminal-tab-${++this.nextId}`
    const strip = doc.createElement('div')
    strip.className = 'session-tab'
    const button = doc.createElement('button')
    button.type = 'button'
    button.id = id
    button.className = 'app-tab'
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', `pane-${id}`)
    const dot = doc.createElement('span')
    dot.className = 'tab-state-dot'
    dot.setAttribute('aria-hidden', 'true')
    const label = doc.createElement('span')
    label.className = 'tab-title'
    label.textContent = title
    button.append(dot, label)
    const close = doc.createElement('button')
    close.type = 'button'
    close.className = 'tab-close'
    close.dataset.tabClose = id
    close.setAttribute('aria-label', `关闭标签 ${title}`)
    close.title = '关闭标签 (Ctrl+W)'
    close.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i>'
    strip.append(button, close)
    this.ctx.clientView.element('workspace-tabs').append(strip)
    pane.container.id = `pane-${id}`
    pane.container.setAttribute('role', 'tabpanel')
    pane.container.setAttribute('aria-labelledby', id)
    const listeners = new DomListeners()
    const tab: OwnedTab = { id, title, request: { ...request }, ...pane, button, label, strip, listeners,
      sessionId: null, state: 'connecting', message: '正在连接…', logs: [], attempt: 0,
      release: () => { listeners.clear(); data.dispose(); resize.dispose(); pane.terminal.dispose(); pane.container.remove(); strip.remove() },
    }
    const data = pane.terminal.onData(value => { if (tab.sessionId) this.ctx.clientTransport.api.input(tab.sessionId, value) })
    const resize = pane.terminal.onResize(({ cols, rows }) => {
      if (tab.id === this.activeId) this.ctx.emit('client/terminal-resize', { cols, rows })
      if (tab.sessionId) this.ctx.clientTransport.api.resize(tab.sessionId, cols, rows)
    })
    listeners.add(button, 'click', () => this.select(id))
    listeners.add(close, 'click', () => this.closeTab(id))
    listeners.add(strip, 'auxclick', event => { if (event.button === 1) { event.preventDefault(); this.closeTab(id) } })
    this.owned.set(id, tab)
    this.select(id)
    return tab
  }

  select(id: string | null, page: 'hosts' | 'keychain' = 'hosts'): void {
    if (this.stopped || (id !== null && !this.owned.has(id))) return
    this.activeId = id
    if (!id) this.libraryPage = page
    this.render()
    ;(id ? this.owned.get(id)!.strip : this.ctx.clientView.element('hosts-tab')).scrollIntoView({ block: 'nearest', inline: 'nearest' })
    this.ctx.emit('client/session-change', this.sessionId)
    this.ctx.emit('client/connection-change')
    void this.settleLayout()
  }

  private render(): void {
    if (this.stopped) return
    const view = this.ctx.clientView
    const active = this.active
    const app = view.element('app')
    app.classList.toggle('session-mode', !!active)
    view.element('hosts-panel').hidden = !!active || this.libraryPage !== 'hosts'
    view.element('keychain-panel').hidden = !!active || this.libraryPage !== 'keychain'
    view.element('nav-hosts').classList.toggle('active', this.libraryPage === 'hosts')
    view.element('nav-keychain').classList.toggle('active', this.libraryPage === 'keychain')
    view.element('library-tab-title').textContent = this.libraryPage === 'keychain' ? 'Keychain' : 'Hosts'
    view.element('session-workspace').hidden = !active
    if (active || this.libraryPage === 'keychain') {
      app.classList.remove('inspector-open')
      view.element('connection-workspace').hidden = true
    }
    const hosts = view.element('hosts-tab')
    hosts.setAttribute('aria-controls', this.libraryPage === 'keychain' ? 'keychain-panel' : 'hosts-panel')
    hosts.classList.toggle('is-active', !active)
    hosts.setAttribute('aria-selected', String(!active))
    hosts.tabIndex = active ? -1 : 0
    for (const tab of this.owned.values()) {
      const selected = tab.id === this.activeId
      tab.strip.dataset.state = tab.state
      tab.strip.classList.toggle('is-active', selected)
      tab.button.setAttribute('aria-selected', String(selected))
      tab.button.tabIndex = selected ? 0 : -1
      tab.button.title = `${tab.title} · ${tab.request.username}@${tab.request.host}:${tab.request.port ?? 22} · ${tab.message}`
      tab.container.hidden = !selected || tab.state === 'failed'
    }
    const failed = active?.state === 'failed'
    view.element('connection-failure').hidden = !failed
    view.element('terminal').hidden = !!failed
    if (!active) return
    view.element('session-address').textContent = `${active.request.username}@${active.request.host}:${active.request.port ?? 22}`
    view.element('session-state').textContent = active.message
    view.element('session-state').className = active.state
    view.element<HTMLButtonElement>('disconnect').disabled = !active.sessionId
    view.element('session-reconnect').hidden = active.state !== 'disconnected'
    if (failed) {
      view.element('failure-title').textContent = active.title
      view.element('failure-endpoint').textContent = `SSH ${active.request.host}:${active.request.port ?? 22}`
      view.element('failure-avatar').textContent = active.request.authMethod === 'privateKey' ? 'KEY' : 'SSH'
      const log = view.element('failure-log')
      log.replaceChildren()
      for (const [index, entry] of active.logs.entries()) {
        const row = view.document.createElement('div')
        row.className = 'failure-log-entry' + (index === active.logs.length - 1 ? ' is-error' : '')
        row.textContent = entry
        log.append(row)
      }
      view.element('failure-copy').textContent = '复制日志'
    }
  }

  private changed(tab: OwnedTab): void {
    this.render()
    if (tab.id === this.activeId) this.ctx.emit('client/session-change', this.sessionId)
    this.ctx.emit('client/connection-change')
  }

  async open(request: TerminalOpenRequest, title = request.host): Promise<TerminalOpenResult | undefined> {
    if (!this.scope.alive || this.stopped) return
    return this.connectTab(this.createTab(request, title))
  }

  async retry(id: string): Promise<TerminalOpenResult | undefined> {
    const tab = this.owned.get(id)
    if (!tab || tab.state === 'connecting' || tab.sessionId) return
    this.select(id)
    return this.connectTab(tab)
  }

  private async connectTab(tab: OwnedTab): Promise<TerminalOpenResult | undefined> {
    const attempt = ++tab.attempt
    const api = this.ctx.clientTransport.api
    const current = () => !this.stopped && this.owned.get(tab.id) === tab && tab.attempt === attempt
    tab.state = 'connecting'
    tab.message = '正在连接…'
    tab.logs = [`正在连接 ${tab.request.host}:${tab.request.port ?? 22}`]
    tab.terminal.write('\x1b[2J\x1b[H\x1b[3J')
    tab.terminal.write(`\x1b[36m── ${tab.request.username}@${tab.request.host}:${tab.request.port ?? 22} ──\x1b[0m\r\n`)
    this.changed(tab)
    this.opening++
    try {
      // Each RPC reply binds its own session, even if several handshakes finish out of order.
      const result = await api.open({ ...tab.request, cols: tab.request.cols ?? tab.terminal.cols,
        rows: tab.request.rows ?? tab.terminal.rows, term: 'xterm-256color' })
      const early = this.early.get(result.sessionId)
      this.early.delete(result.sessionId)
      if (!current()) { api.close(result.sessionId); return }
      tab.sessionId = result.sessionId
      tab.state = 'connected'
      tab.message = '已连接'
      this.bySession.set(result.sessionId, tab)
      for (const chunk of early?.chunks ?? []) tab.terminal.write(chunk)
      if (early?.closed !== undefined) this.ended(tab, early.closed)
      else this.changed(tab)
      if (tab.id === this.activeId) void this.settleLayout()
      return result
    } catch (error) {
      if (current()) {
        tab.sessionId = null
        tab.state = 'failed'
        tab.message = '连接失败'
        tab.logs.push(cleanError(error))
        this.changed(tab)
      }
      return undefined
    } finally {
      this.opening--
      if (!this.opening) this.early.clear()
    }
  }

  private ended(tab: OwnedTab, reason: string): void {
    if (tab.sessionId) this.bySession.delete(tab.sessionId)
    tab.sessionId = null
    tab.state = 'disconnected'
    tab.message = reason || '连接已结束'
    tab.terminal.write(`\r\n\x1b[33m连接已结束：${tab.message}\x1b[0m\r\n`)
    this.changed(tab)
  }

  disconnect(): void {
    const tab = this.active && this.owned.get(this.active.id)
    if (!tab?.sessionId) return
    const sessionId = tab.sessionId
    this.ended(tab, '用户断开连接。')
    this.ctx.clientTransport.api.close(sessionId)
  }

  closeTab(id: string): void {
    const tab = this.owned.get(id)
    if (!tab) return
    const ids = [...this.owned.keys()]
    const index = ids.indexOf(id)
    const sessionId = tab.sessionId
    this.owned.delete(id)
    if (sessionId) this.bySession.delete(sessionId)
    tab.sessionId = null
    tab.release()
    if (sessionId) this.ctx.clientTransport.api.close(sessionId)
    this.ctx.emit('client/tab-closed', id)
    if (this.activeId === id) this.select(ids[index + 1] ?? ids[index - 1] ?? null)
    else this.render()
  }

  fit(): void {
    const tab = this.active
    if (!tab || this.stopped || tab.container.hidden) return
    const { width, height } = tab.container.getBoundingClientRect()
    if (width < 40 || height < 40) return
    try { tab.terminal.fit() } catch (error) { console.warn('[renderer] fit 失败', error) }
  }

  settleLayout(): Promise<boolean> {
    const window = this.ctx.clientView.window
    if (!this.scope.alive || this.stopped) return Promise.resolve(false)
    return new Promise(resolve => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        window.cancelAnimationFrame(frame)
        clearTimeout(timer)
        unregister()
        if (this.scope.alive && !this.stopped) { this.fit(); if (this.active?.state === 'connected') this.active.terminal.focus() }
        resolve(this.scope.alive && !this.stopped)
      }
      const frame = window.requestAnimationFrame(finish)
      const timer = setTimeout(finish, 250)
      const unregister = this.scope.cancelOnDispose(finish)
    })
  }

  private async copyLogs(): Promise<void> {
    const tab = this.active
    if (!tab) return
    const button = this.ctx.clientView.element('failure-copy')
    try {
      await this.ctx.clientView.window.navigator.clipboard.writeText(tab.logs.join('\n'))
      if (this.active?.id !== tab.id || this.stopped) return
      button.textContent = '已复制'
      if (await this.scope.delay(1600) && this.active?.id === tab.id) button.textContent = '复制日志'
    } catch {
      if (!this.stopped && this.active?.id === tab.id) button.textContent = '复制失败，请选中日志复制'
    }
  }
}

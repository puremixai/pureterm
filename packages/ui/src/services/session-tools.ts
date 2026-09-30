import { Service, type Context } from 'cordis'
import { t, type MessageKey } from '@pureterm/i18n'
import { ClientScope } from '../client-runtime.js'
import type { TerminalTab } from './terminal.js'

export type SessionToolId = 'files' | 'monitor'

/**
 * 一个工具往共享轨上注册的东西。
 *
 * 功能只描述「我是谁、我的按钮长什么样、我现在能不能用」，开合、按钮节点、面板槽位和
 * 分隔条都由 ClientSessionTools 持有 —— 记两份就会出现「面板说开着而槽位关着」。
 */
export interface SessionToolDefinition {
  readonly id: SessionToolId
  readonly buttonId: 'sftp-toggle' | 'monitor-toggle'
  readonly panelId: 'sftp' | 'session-monitor'
  readonly iconClass: 'ti ti-folder' | 'ti ti-activity'
  readonly labelKey: MessageKey
  available(tab: TerminalTab | undefined): boolean
}

/** 有效可见状态的三元组。功能监听方读到的是已经落定的状态，不是「将要变成」。 */
export interface SessionToolsChange {
  readonly tabId: string | null
  readonly sessionId: string | null
  readonly tool: SessionToolId | null
}

declare module 'cordis' {
  interface Context { clientSessionTools: ClientSessionTools }
  interface Events { 'client/session-tools-change'(change: SessionToolsChange): void }
}

/** 固定顺序：文件在前、监控在后，和两个功能的装配顺序无关。 */
const ORDER: readonly SessionToolId[] = ['files', 'monitor']

/** 侧向分栏的默认比例，取自原型的 1.35fr : 1fr（含 5px 把手）。 */
const DEFAULT_SPLIT = 0.574
/** 两侧各自的下界，与 terminal.css 里 minmax 的那两个数一致，改一处要改两处。 */
const MIN_TERMINAL = 0.22
const MAX_TERMINAL = 0.78
const NARROW = '(max-width: 820px)'

interface Registration {
  readonly definition: SessionToolDefinition
  readonly button: HTMLButtonElement
}

/**
 * ClientSessionTools —— 终端工作区右侧那一条常驻的工具轨。
 *
 * 它管三件事：**选哪个工具**（按 TerminalTab.id 记住）、**图标按钮**（谁注册谁有一颗，
 * 属性由这里改写）、以及**共用的面板槽位和分隔条**（同一时刻最多一格开着）。它不认识
 * 文件，也不认识监控：两个功能各自持有自己的业务数据和请求，只通过 register() 和
 * isOpen() 接入。
 *
 * 有效可见状态是「当前标签页已连接 + 该工具已注册且可用 + 用户选过它」。少了任何一条
 * activeTool 就是 null —— 于是管理页面、连接中、失败、断开时面板都收起，图标栏留下。
 */
export class ClientSessionTools extends Service {
  static inject = ['clientView', 'clientTerminal']
  private readonly scope: ClientScope
  private readonly registrations = new Map<SessionToolId, Registration>()
  /** 每个终端标签记一个选择，键是 TerminalTab.id —— 不写 localStorage，也不写主机记录。 */
  private readonly remembered = new Map<string, SessionToolId>()
  private active: SessionToolId | null = null
  private announced: SessionToolsChange = { tabId: null, sessionId: null, tool: null }

  constructor(ctx: Context) {
    super(ctx, 'clientSessionTools')
    this.scope = new ClientScope(ctx)
    ctx.on('client/session-change', () => this.sync())
    ctx.on('client/connection-change', () => this.sync())
    ctx.on('client/tab-closed', tabId => { this.remembered.delete(tabId); this.sync() })
    // 换语言：按钮上的名字和提示是拼出来的，静态 markup 由 ClientChrome 自己翻译。
    ctx.on('client/locale-change', () => this.paint())
    this.scope.onDispose(() => {
      for (const { button } of this.registrations.values()) button.remove()
      this.registrations.clear()
      this.remembered.clear()
      this.active = null
      const view = ctx.clientView
      view.element('session-tools').replaceChildren()
      view.element('session-tool-panel').hidden = true
      view.element('session-grip').hidden = true
      view.element('session-workspace').classList.remove('files-open', 'monitor-open')
    })
    this.installGrip()
    this.sync()
  }

  /** 当前有效可见的工具；没有选中标签、没连上、工具没注册或不可用时为 null。 */
  get activeTool(): SessionToolId | null { return this.active }

  isOpen(id: SessionToolId): boolean { return this.active === id }

  /**
   * 注册一个工具，返回幂等的注销函数。
   *
   * 重复注册同一个仍然活着的工具是开发错误（两颗同 id 的按钮只会让 getElementById
   * 拿到第一颗）；重复注销是安全的。
   */
  register(definition: SessionToolDefinition): () => void {
    if (this.registrations.has(definition.id)) {
      throw new Error(`The ${definition.id} tool is already registered.`)
    }
    const document = this.ctx.clientView.document
    const button = document.createElement('button')
    button.type = 'button'
    button.id = definition.buttonId
    button.className = 'session-tool'
    button.disabled = true
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-controls', definition.panelId)
    const glyph = document.createElement('i')
    glyph.className = definition.iconClass
    glyph.setAttribute('aria-hidden', 'true')
    button.append(glyph)
    const onClick = (): void => this.toggle(definition.id)
    button.addEventListener('click', onClick)
    this.registrations.set(definition.id, { definition, button })
    this.order()
    this.sync()
    let released = false
    return () => {
      if (released) return
      released = true
      button.removeEventListener('click', onClick)
      button.remove()
      this.registrations.delete(definition.id)
      // 这个工具的记忆选择在所有标签上一起清掉：留下它只会让下一次注册悄悄替用户
      // 重新打开一个面板。
      for (const [tabId, tool] of [...this.remembered]) if (tool === definition.id) this.remembered.delete(tabId)
      this.sync()
    }
  }

  /** 展开 / 收起 / 换成另一个工具。不可用或没注册的工具直接忽略。 */
  toggle(id: SessionToolId): void {
    const registration = this.registrations.get(id)
    const tab = this.ctx.clientTerminal.active
    if (!registration || !tab || !registration.definition.available(tab)) return
    if (this.active === id) this.remembered.delete(tab.id)
    else this.remembered.set(tab.id, id)
    this.sync()
  }

  /** 面板上的「收起」：清掉当前标签的记忆选择，下次打开这个标签就是收起状态。 */
  close(): void {
    const tab = this.ctx.clientTerminal.active
    if (tab) this.remembered.delete(tab.id)
    this.sync()
  }

  private effective(tab: TerminalTab | undefined): SessionToolId | null {
    if (!tab) return null
    const remembered = this.remembered.get(tab.id)
    if (!remembered) return null
    const registration = this.registrations.get(remembered)
    if (!registration) return null
    return registration.definition.available(tab) ? remembered : null
  }

  private order(): void {
    const rail = this.ctx.clientView.element('session-tools')
    rail.replaceChildren(...ORDER.flatMap(id => {
      const registration = this.registrations.get(id)
      return registration ? [registration.button] : []
    }))
  }

  private sync(): void {
    if (!this.scope.alive) return
    const view = this.ctx.clientView
    const tab = this.ctx.clientTerminal.active
    const active = this.effective(tab)
    this.active = active
    // 槽位和每一格面板的可见性都只由这里写：功能自己的 render 不许覆盖它们。
    view.element('session-tool-panel').hidden = active === null
    for (const { definition } of this.registrations.values()) {
      view.element(definition.panelId).hidden = active !== definition.id
    }
    this.paint()
    view.element('session-grip').hidden = active === null
    this.paintSplit()
    // 这两条类是给级联读的：哪一格开着决定 .session-content 是几列。图标栏不在比例里。
    const workspace = view.element('session-workspace')
    workspace.classList.toggle('files-open', active === 'files')
    workspace.classList.toggle('monitor-open', active === 'monitor')
    const change: SessionToolsChange = { tabId: tab?.id ?? null, sessionId: tab?.sessionId ?? null, tool: active }
    // 事件排在 DOM 之后：功能监听方读到的必须是已经落定的状态，否则会绕出互相关闭。
    if (change.tabId !== this.announced.tabId || change.sessionId !== this.announced.sessionId || change.tool !== this.announced.tool) {
      this.announced = change
      this.ctx.emit('client/session-tools-change', change)
    }
  }

  /**
   * 只改属性和文字，不重建节点。
   *
   * 重建会让正在被键盘操作的那颗按钮失去焦点，而后台更新（一次采样、一次目录刷新）
   * 不该动用户的焦点 —— 这和监控面板「更新只改文字」是同一条规矩。
   */
  private paint(): void {
    const tab = this.ctx.clientTerminal.active
    for (const { definition, button } of this.registrations.values()) {
      const available = definition.available(tab)
      const open = this.active === definition.id
      button.disabled = !available
      button.setAttribute('aria-expanded', String(open))
      button.setAttribute('aria-label', t(definition.labelKey))
      button.title = available ? t(definition.labelKey) : t('session.tools.unavailable')
      button.classList.toggle('is-active', open)
    }
  }

  /**
   * 分隔条。它住在终端和面板之间，量的是 #session-content —— 图标栏和分隔条本身都不
   * 属于那两块内容，所以比例里不含它们。
   */
  private installGrip(): void {
    const view = this.ctx.clientView
    const grip = view.element('session-grip')
    const content = view.element('session-content')
    let drag: { start: number; ratio: number; span: number; vertical: boolean } | null = null
    const narrow = (): boolean => view.window.matchMedia(NARROW).matches
    this.scope.listen(grip, 'pointerdown', event => {
      const pointer = event as PointerEvent
      const vertical = narrow()
      const box = content.getBoundingClientRect()
      drag = {
        start: vertical ? pointer.clientY : pointer.clientX,
        ratio: this.currentRatio(),
        span: (vertical ? box.height : box.width) || 1,
        vertical,
      }
      grip.setPointerCapture(pointer.pointerId)
      event.preventDefault()
    })
    this.scope.listen(grip, 'pointermove', event => {
      if (!drag) return
      const pointer = event as PointerEvent
      const moved = (drag.vertical ? pointer.clientY - drag.start : pointer.clientX - drag.start) / drag.span
      this.ctx.clientTerminal.setSplit(this.clamp(drag.ratio + moved))
      this.paintSplit()
    })
    const release = (event: Event): void => {
      if (!drag) return
      drag = null
      grip.releasePointerCapture((event as PointerEvent).pointerId)
    }
    this.scope.listen(grip, 'pointerup', release)
    this.scope.listen(grip, 'pointercancel', release)
    // 只有鼠标能拖的分隔条，对键盘用户等于不存在。步长 2%，Shift 10%，Home 回默认。
    this.scope.listen(grip, 'keydown', event => {
      const key = event as KeyboardEvent
      const step = key.shiftKey ? 0.1 : 0.02
      if (key.key === 'ArrowLeft' || key.key === 'ArrowUp') this.ctx.clientTerminal.setSplit(this.clamp(this.currentRatio() - step))
      else if (key.key === 'ArrowRight' || key.key === 'ArrowDown') this.ctx.clientTerminal.setSplit(this.clamp(this.currentRatio() + step))
      else if (key.key === 'Home') this.ctx.clientTerminal.setSplit(null)
      else return
      event.preventDefault()
      this.paintSplit()
    })
  }

  private currentRatio(): number { return this.ctx.clientTerminal.active?.split ?? DEFAULT_SPLIT }

  private clamp(ratio: number): number { return Math.min(MAX_TERMINAL, Math.max(MIN_TERMINAL, ratio)) }

  /** 比例只存在 tab 上，所以这里每次都从 tab 读，屏幕上不会有第二个值。 */
  private paintSplit(): void {
    const view = this.ctx.clientView
    const grip = view.element('session-grip')
    const content = view.element('session-content')
    const narrow = view.window.matchMedia(NARROW).matches
    const stored = this.ctx.clientTerminal.active?.split ?? null
    const ratio = this.clamp(stored ?? DEFAULT_SPLIT)
    const percent = Math.round(ratio * 100)
    // 分隔条自己的朝向跟着当前生效的那条网格轴走：宽屏竖着分栏，窄屏横着分栏。
    grip.setAttribute('aria-orientation', narrow ? 'horizontal' : 'vertical')
    grip.setAttribute('aria-label', t('session.tools.grip.label'))
    grip.setAttribute('aria-valuenow', String(percent))
    grip.setAttribute('aria-valuemin', String(Math.round(MIN_TERMINAL * 100)))
    grip.setAttribute('aria-valuemax', String(Math.round(MAX_TERMINAL * 100)))
    grip.setAttribute('aria-valuetext', t('session.tools.grip.value', { percent }))
    // 跨断点时清掉不再使用的那条内联网格轴，否则收起的槽位会留下一段空的轨道。
    if (narrow) {
      content.style.gridTemplateColumns = ''
      content.style.gridTemplateRows = stored === null
        ? ''
        : `minmax(120px, ${(ratio * 100).toFixed(3)}fr) var(--grip-w) minmax(160px, ${((1 - ratio) * 100).toFixed(3)}fr)`
      return
    }
    content.style.gridTemplateRows = ''
    content.style.gridTemplateColumns = stored === null
      ? ''
      : `minmax(240px, ${(ratio * 100).toFixed(3)}fr) var(--grip-w) minmax(220px, ${((1 - ratio) * 100).toFixed(3)}fr)`
  }
}

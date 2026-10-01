import { Service, type Context } from 'cordis'
import {
  getShortcutBindings, isShortcutEnabled, resolveShortcut,
  type ShortcutBinding, type ShortcutCommand, type ShortcutContext, type ShortcutInput, type ShortcutPlatform,
} from '@pureterm/protocol'
import { ClientScope } from '../client-runtime.js'

declare module 'cordis' { interface Context { clientShortcuts: ClientShortcuts } }

interface Registration {
  handler: () => void
  enabled: () => boolean
}

/*
 * 工作区命令的唯一注册表。
 *
 * 它同时是两条路的**汇合点**：
 *   - 有 Desktop 桥（Electron）时，主进程的 before-input-event 用同一张绑定表裁决按键，
 *     只把命令送进来；这一侧不再听 DOM，所以同一次按键不可能执行两次。
 *   - 没有桥（独立 Web / 浏览器入口）时，这一侧自己听 document 的 keydown。
 *
 * 无论命令从哪条路来，`execute()` 都会**当场**再查一次 `isShortcutEnabled`：主进程
 * 手里的上下文可能已经旧了，而此刻能不能执行只有这一侧知道。
 *
 * 上下文由两块拼成：界面可见性（这一侧读 DOM）和终端状态（终端服务 push，避免和它
 * 互相注入成环）。输入法组合状态也由这一侧听。
 */
export class ClientShortcuts extends Service {
  static inject = ['clientView']
  readonly scope: ClientScope
  private readonly registry = new Map<ShortcutCommand, Registration>()
  private readonly platform: ShortcutPlatform
  private composing = false
  private readonly contextState: ShortcutContext = {
    terminalTabs: 0, activeTerminal: false, connectedTerminal: false,
    libraryVisible: false, editorOpen: false, modalOpen: false, composing: false,
  }

  constructor(ctx: Context) {
    super(ctx, 'clientShortcuts')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    const bridge = view.window.puretermDesktop?.shortcuts
    if (bridge) {
      this.platform = bridge.platform
      const unsubscribe = bridge.onCommand(command => { this.execute(command) })
      this.scope.onDispose(unsubscribe)
    } else {
      this.platform = detectShortcutPlatform(view.window)
      this.scope.listen(view.document, 'keydown', event => {
        const command = resolveShortcut(toShortcutInput(event as KeyboardEvent), this.context, this.platform)
        if (!command) return
        const key = event as KeyboardEvent
        key.preventDefault()
        key.stopPropagation()
        this.execute(command)
      }, true)
    }
    this.scope.listen(view.document, 'compositionstart', () => this.updateContext({ composing: true }), true)
    this.scope.listen(view.document, 'compositionend', () => this.updateContext({ composing: false }), true)
    ctx.on('client/session-change', () => this.sync())
    this.sync()
  }

  get bindings(): readonly ShortcutBinding[] { return getShortcutBindings(this.platform) }
  get shortcutsPlatform(): ShortcutPlatform { return this.platform }
  get context(): ShortcutContext { return { ...this.contextState } }

  /** 某个命令此刻是否有归属且被允许。菜单和帮助用它决定是否可用。 */
  isEnabled(command: ShortcutCommand): boolean {
    const registration = this.registry.get(command)
    return !!registration && registration.enabled() && isShortcutEnabled(command, this.context)
  }

  register(command: ShortcutCommand, handler: () => void, enabled: () => boolean = () => true): () => void {
    this.registry.set(command, { handler, enabled })
    const dispose = (): void => { if (this.registry.get(command)?.handler === handler) this.registry.delete(command) }
    this.scope.onDispose(dispose)
    return dispose
  }

  /** 合并外部推来的上下文（终端状态、输入法组合状态），并把最新快照上报给主进程。 */
  updateContext(patch: Partial<ShortcutContext>): void {
    Object.assign(this.contextState, patch)
    this.report()
  }

  /** 从当前界面可见性重算上下文。界面自己改了面板/编辑器/对话框之后调用它。 */
  sync(): void {
    const view = this.ctx.clientView
    this.contextState.libraryVisible = !view.element('hosts-panel').hidden
    this.contextState.editorOpen = !view.element('connection-workspace').hidden
    this.contextState.modalOpen = view.element<HTMLDialogElement>('shortcuts-dialog').open
    this.report()
  }

  /** 执行一个命令；返回是否真的执行了。 */
  execute(command: ShortcutCommand): boolean {
    const registration = this.registry.get(command)
    if (!registration || !registration.enabled() || !isShortcutEnabled(command, this.context)) return false
    registration.handler()
    return true
  }

  private report(): void {
    this.ctx.clientView.window.puretermDesktop?.shortcuts?.reportContext(this.context)
  }
}

function toShortcutInput(event: KeyboardEvent): ShortcutInput {
  return {
    key: event.key, code: event.code,
    ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey,
    composing: event.isComposing, repeat: event.repeat, type: 'keydown',
  }
}

/** 独立 Web 没有主进程，平台只能从浏览器自己报的字符串里认。 */
function detectShortcutPlatform(window: Window): ShortcutPlatform {
  const navigator = window.navigator as Navigator & { userAgentData?: { platform?: string } }
  const label = navigator.userAgentData?.platform ?? navigator.platform ?? ''
  return /mac/i.test(label) ? 'mac' : 'other'
}

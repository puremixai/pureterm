/*
 * 工作区快捷键的**中立**定义：命令、上下文、绑定表和匹配器。
 *
 * 这里不 import DOM、Node 或 Electron：浏览器把 KeyboardEvent 收窄成 `ShortcutInput`，
 * Electron 主进程把 `before-input-event` 收窄成同一个记录，两边都拿这一张表回答
 * 「这个键是哪个命令」。于是 DOM 路径、原生路径和帮助文案不可能各说各话。
 *
 * 匹配刻意做得很严：修饰键必须**完全**相等（多按一个 Shift 就不算），Alt/AltGr 一律
 * 放行给输入法，keyup 不触发，输入法组合期间整块让路。终端的 Ctrl+C/Ctrl+V、readline
 * 的按键都不在这张表里，所以它们原样到达远端。
 */

/** 全部工作区命令。既是类型来源，也是跨线校验用的运行时白名单。 */
export const SHORTCUT_COMMANDS = [
  'terminal.next', 'terminal.previous', 'terminal.close',
  'terminal.focus', 'sftp.toggle', 'hosts.search', 'hosts.dismiss-editor',
] as const

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number]

export function isShortcutCommand(value: unknown): value is ShortcutCommand {
  return typeof value === 'string' && (SHORTCUT_COMMANDS as readonly string[]).includes(value)
}

export type ShortcutPlatform = 'mac' | 'other'

/** 修饰键集合；`primary` 在绑定表里按平台解析成 meta（macOS）或 ctrl（其他）。 */
export type ShortcutModifier = 'ctrl' | 'meta' | 'shift'

/**
 * 归一化后的按键记录。两个入口各自把自己的事件收窄成它：
 * 浏览器读 KeyboardEvent 的 key/code/ctrlKey/metaKey/shiftKey/altKey/isComposing/repeat，
 * Electron 主进程读 before-input-event 的同名字段。
 */
export interface ShortcutInput {
  key: string
  code: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  composing: boolean
  repeat: boolean
  type: 'keydown' | 'keyup'
}

/** 命令是否可用只由这些布尔/计数决定，和界面无关。 */
export interface ShortcutContext {
  /** 标签栏里有多少个终端标签（含「主页」这一格之外的真实标签）。 */
  terminalTabs: number
  /** 当前有没有一个活动终端标签（含连接中/失败的标签）。 */
  activeTerminal: boolean
  /** 当前活动标签是否已连接（SFTP 等依赖会话的能力）。 */
  connectedTerminal: boolean
  /** 主机库那一屏是否可见。 */
  libraryVisible: boolean
  /** 主机编辑器是否打开。 */
  editorOpen: boolean
  /** 是否有模态框（例如快捷键帮助）打开。 */
  modalOpen: boolean
  /** 输入法是否正在组合。 */
  composing: boolean
}

/** 恰好有一个 `key` 或 `code`：`key` 按字符匹配，`code` 按物理键位匹配。 */
export type ShortcutBinding = {
  command: ShortcutCommand
  modifiers: readonly ShortcutModifier[]
} & ({ key: string; code?: never } | { code: string; key?: never })

const PRIMARY: ShortcutModifier = 'meta'
const SECONDARY: ShortcutModifier = 'ctrl'

/**
 * 绑定表。Ctrl+Tab / Ctrl+Shift+Tab 在所有平台都用**字面 Ctrl**（不是 primary）：
 * 帮助里那句「macOS 上用 ⌘ 代替 Ctrl」曾经把这一条也说错了。
 */
export function getShortcutBindings(platform: ShortcutPlatform): readonly ShortcutBinding[] {
  const primary = platform === 'mac' ? PRIMARY : SECONDARY
  return [
    { command: 'terminal.next', modifiers: ['ctrl'], key: 'Tab' },
    { command: 'terminal.previous', modifiers: ['ctrl', 'shift'], key: 'Tab' },
    { command: 'terminal.close', modifiers: [primary], key: 'w' },
    { command: 'terminal.focus', modifiers: [primary], code: 'Backquote' },
    { command: 'sftp.toggle', modifiers: [primary], key: 'e' },
    { command: 'hosts.search', modifiers: [primary], key: 'k' },
    { command: 'hosts.dismiss-editor', modifiers: [], key: 'Escape' },
  ]
}

/**
 * 命令在当前上下文里是否可用。菜单和帮助用它做同样的判断，界面命令执行前再查一次，
 * 这样即使主进程拿着稍旧的上下文提示，也不会执行一个此刻不该执行的动作。
 */
export function isShortcutEnabled(command: ShortcutCommand, context: ShortcutContext): boolean {
  // 输入法组合或模态框期间，整块让路。
  if (context.composing || context.modalOpen) return false
  // 编辑器打开时只留「收起编辑器」，其余工作区快捷键让给输入。
  if (command === 'hosts.dismiss-editor') return context.editorOpen
  if (context.editorOpen) return false
  switch (command) {
    case 'terminal.next':
    case 'terminal.previous':
      // 至少要有一个真实终端标签才值得循环；只有「主页」时不抢 Ctrl+Tab。
      return context.terminalTabs > 0
    case 'terminal.close':
    case 'terminal.focus':
      return context.activeTerminal
    case 'sftp.toggle':
      return context.connectedTerminal
    case 'hosts.search':
      return context.libraryVisible
  }
}

function modifiersMatch(binding: ShortcutBinding, input: ShortcutInput): boolean {
  const wanted = new Set(binding.modifiers)
  return input.ctrl === wanted.has('ctrl') && input.meta === wanted.has('meta') && input.shift === wanted.has('shift')
}

function keyMatches(binding: ShortcutBinding, input: ShortcutInput): boolean {
  return typeof binding.code === 'string' ? binding.code === input.code : binding.key.toLowerCase() === input.key.toLowerCase()
}

/**
 * 把一次按键解析成命令，或 `undefined`。返回 `undefined` 表示这次按键不属于工作区，
 * 必须原样放行（输入法、AltGr、keyup、修饰键不完全匹配、上下文不允许）。
 */
export function resolveShortcut(input: ShortcutInput, context: ShortcutContext, platform: ShortcutPlatform): ShortcutCommand | undefined {
  if (input.type !== 'keydown') return undefined
  // Alt/AltGr 留给输入法和远端；输入法组合期间一律不抢。
  if (input.alt || input.composing || context.composing) return undefined
  for (const binding of getShortcutBindings(platform)) {
    if (!modifiersMatch(binding, input) || !keyMatches(binding, input)) continue
    if (!isShortcutEnabled(binding.command, context)) continue
    // 长按不重复触发破坏性动作：按住 Ctrl+W 不该关掉一排标签。
    if (input.repeat && binding.command === 'terminal.close') continue
    return binding.command
  }
  return undefined
}

/** 人读的修饰键标签，供帮助界面拼 <kbd>。 */
export function shortcutModifierLabels(binding: ShortcutBinding, platform: ShortcutPlatform): string[] {
  return binding.modifiers.map(modifier => {
    if (modifier === 'shift') return 'Shift'
    if (modifier === 'ctrl') return 'Ctrl'
    return platform === 'mac' ? '⌘' : 'Ctrl'
  })
}

/** 人读的按键标签（`code` 绑定取物理键的写法）。 */
export function shortcutKeyLabel(binding: ShortcutBinding): string {
  if (typeof binding.code === 'string') return binding.code === 'Backquote' ? '`' : binding.code
  const key = binding.key
  if (key === 'Escape') return 'Esc'
  if (key.length === 1) return key.toUpperCase()
  return key
}

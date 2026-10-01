import type { BrowserWindow, Input } from 'electron'
import { DESKTOP_CHANNELS, resolveShortcut, type ShortcutCommand, type ShortcutContext, type ShortcutInput, type ShortcutPlatform } from '@pureterm/protocol'

/*
 * 桌面侧的原生按键适配器，绑定到**一代**窗口。
 *
 * 为什么不让渲染层自己听 DOM：Electron 的 `before-input-event` 在事件到达页面之前就能
 * 裁决，而且菜单和原生输入共享同一条路。主进程用和 Web 完全相同的绑定表解析按键，
 * 命中就 `preventDefault()` 并把**命令**（不是按键）发给渲染层，于是同一次按键只会
 * 执行一次。渲染层再按**此刻**的上下文复核一遍，不信任主进程手里可能过期的提示。
 *
 * 新的一代在收到第一份合法上下文之前**不裁决任何按键**：默认值会让 Ctrl+K 在终端里
 * 被抢走，宁可先什么都不做。反过来，`dispose()` 之后这一代彻底失声 —— 监听器摘掉，
 * 迟到的上下文上报和菜单命令都不再接受。
 */
export interface DesktopShortcuts {
  reportContext(context: ShortcutContext): void
  dispatch(command: ShortcutCommand): boolean
  dispose(): void
}

export function installDesktopShortcuts(window: BrowserWindow, platform: ShortcutPlatform): DesktopShortcuts {
  let context: ShortcutContext | undefined
  let disposed = false
  const onInput = (event: Electron.Event, input: Input): void => {
    if (disposed || !context) return
    const command = resolveShortcut(toShortcutInput(input), context, platform)
    if (!command) return
    event.preventDefault()
    if (!window.isDestroyed()) window.webContents.send(DESKTOP_CHANNELS.shortcutCommand, command)
  }
  window.webContents.on('before-input-event', onInput)
  return {
    // 释放之后这一代就不存在了：迟到的上下文上报、菜单命令都不能再落到它身上，
    // 否则一个被换掉的窗口还能替新窗口决定执行什么。
    reportContext(next) { if (!disposed) context = next },
    dispatch(command) {
      if (disposed || window.isDestroyed()) return false
      window.webContents.send(DESKTOP_CHANNELS.shortcutCommand, command)
      return true
    },
    dispose() {
      disposed = true
      context = undefined
      // 窗口可能在 release 之前就被销毁了（用户关窗、崩溃清理）。那时 `window.webContents`
      // 这个取值本身就会抛「Object has been destroyed」，所以先问窗口，再问它的 webContents。
      if (window.isDestroyed() || window.webContents.isDestroyed()) return
      window.webContents.removeListener('before-input-event', onInput)
    },
  }
}

function toShortcutInput(input: Input): ShortcutInput {
  return {
    key: input.key, code: input.code,
    ctrl: input.control, meta: input.meta, shift: input.shift, alt: input.alt,
    composing: input.isComposing, repeat: input.isAutoRepeat,
    type: input.type === 'keyUp' ? 'keyup' : 'keydown',
  }
}

const BOOLEAN_KEYS = ['activeTerminal', 'connectedTerminal', 'libraryVisible', 'editorOpen', 'modalOpen', 'composing'] as const

/**
 * 收窄一份来自渲染层的上下文。值来自边界之外，所以先验形状再采信：不是合法的
 * 七字段记录就当没有上报，绝不拿一个半成品去裁决按键。
 */
export function narrowShortcutContext(value: unknown): ShortcutContext | undefined {
  const record = value as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined
  const tabs = record.terminalTabs
  if (typeof tabs !== 'number' || !Number.isSafeInteger(tabs) || tabs < 0) return undefined
  for (const key of BOOLEAN_KEYS) if (typeof record[key] !== 'boolean') return undefined
  return {
    terminalTabs: tabs,
    activeTerminal: record.activeTerminal as boolean,
    connectedTerminal: record.connectedTerminal as boolean,
    libraryVisible: record.libraryVisible as boolean,
    editorOpen: record.editorOpen as boolean,
    modalOpen: record.modalOpen as boolean,
    composing: record.composing as boolean,
  }
}

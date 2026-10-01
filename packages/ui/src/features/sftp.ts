import { Service, type Context } from 'cordis'
import { MAX_TRANSFER_BYTES, type SftpDir, type SftpEntry } from '@pureterm/protocol'
import { t } from '@pureterm/i18n'
import { ClientScope } from '../client-runtime.js'
import { errorMessage } from '../failure-diagnostics.js'
import { messageKey, messageText, resolveMessage, type MessageText } from '../message-text.js'
import { createSftpPanel, type SftpView } from '../sftp-panel.js'
import { readFileBytes, saveBytes } from '../local-file.js'
import { formatBytes } from '../format.js'

declare module 'cordis' { interface Context { clientSftp: ClientSftp } }

interface FileState {
  tabId: string
  sessionId: string
  directory: SftpDir | null
  navigation: number
  busy: boolean
  /**
   * 面板底下那一行提示。**存的是 key 不是句子**：它会一直留在屏幕上（「正在下载
   * x …」「已删除 y。」），换语言之后得能重说一遍，而不是停在上一门语言里。
   */
  hint: MessageText
  kind: 'ok' | 'err' | 'pending' | ''
}

/** Every session retains its directory, requests and busy state; the panel slot, the tool selection and the splitter are shared. */
export class ClientSftp extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal', 'clientSessionTools', 'clientShortcuts']
  readonly scope: ClientScope
  private readonly panel: SftpView
  private readonly states = new Map<string, FileState>()
  private renderedSession: string | null = null

  constructor(ctx: Context) {
    super(ctx, 'clientSftp')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    const element = view.element('sftp')
    this.panel = createSftpPanel(element, {
      onNavigate: path => { const state = this.current(); if (state) void this.load(state, path) },
      onRefresh: () => { const state = this.current(); if (state) void this.load(state, state.directory?.path ?? '.') },
      onDownload: entry => void this.download(entry),
      onDelete: entry => void this.remove(entry),
      onUpload: file => void this.upload(file),
      onCreate: name => void this.mkdir(name),
      onClose: () => this.ctx.clientSessionTools.close(),
    })
    // 图标栏那一颗按钮归共享服务，但它的生命跟着这个功能：注销时按钮一起消失，
    // 各标签记下的「文件」选择也一起清掉。
    this.scope.onDispose(ctx.clientSessionTools.register({
      id: 'files',
      buttonId: 'sftp-toggle',
      panelId: 'sftp',
      iconClass: 'ti ti-folder',
      labelKey: 'session.tools.files',
      available: tab => !!tab && tab.state === 'connected' && !!tab.sessionId,
    }))
    this.scope.onDispose(() => {
      this.states.clear()
      this.panel.dispose()
      element.hidden = true
    })
    // Ctrl/Cmd+E 归这里，因为「文件」这个语义是这个功能的。开合本身交给共享服务，
    // 所以面板收起／展开和点击图标走的是同一条路。按键的裁决交给统一的快捷键注册表
    // （Desktop 走原生、Web 走 DOM），这里只声明「有连接的会话时才可用」。
    this.scope.onDispose(ctx.clientShortcuts.register(
      'sftp.toggle',
      () => ctx.clientSessionTools.toggle('files'),
      () => !!ctx.clientTerminal.sessionId,
    ))
    ctx.on('client/session-change', () => this.sync())
    ctx.on('client/connection-change', () => this.sync())
    // 换语言：整块面板重画一遍。提示行存的是 key，所以它会跟着变；行上的按钮、
    // 列和面包屑由 render() 重建。
    ctx.on('client/locale-change', () => this.sync())
    ctx.on('client/tab-closed', tabId => {
      for (const [id, state] of this.states) if (state.tabId === tabId) this.states.delete(id)
      this.sync()
    })
    /*
     * 工具选择变了。展开时才按需拉一次当前目录；已经加载过的目录不重复请求，收起时
     * 什么都不做 —— 槽位的 hidden 由共享服务写，这里只管自己的业务数据。
     */
    ctx.on('client/session-tools-change', change => {
      if (!this.scope.alive) return
      if (change.tool === 'files') {
        const state = this.current()
        if (state && !state.directory && !state.busy) void this.load(state, '.')
      }
      this.sync()
    })
    this.sync()
  }

  /**
   * 当前会话的文件面板开着吗。委托给共享服务：它才是「哪一格开着」的唯一真相，
   * 这里不再存第二份。
   */
  get open(): boolean { return this.ctx.clientSessionTools.isOpen('files') }

  private current(): FileState | null {
    const tab = this.ctx.clientTerminal.active
    if (!this.scope.alive || !tab?.sessionId) return null
    let state = this.states.get(tab.sessionId)
    if (!state) {
      state = { tabId: tab.id, sessionId: tab.sessionId, directory: null, navigation: 0,
        busy: false, hint: messageKey('sftp.hint.closed'), kind: '' }
      this.states.set(tab.sessionId, state)
    }
    return state
  }

  private live(state: FileState): boolean {
    return this.scope.alive && this.states.get(state.sessionId) === state &&
      this.ctx.clientTerminal.tabs.some(tab => tab.id === state.tabId && tab.sessionId === state.sessionId)
  }

  private sync(): void {
    if (!this.scope.alive) return
    for (const [id, state] of this.states) if (!this.live(state)) this.states.delete(id)
    const state = this.current()
    if (this.renderedSession !== (state?.sessionId ?? null)) {
      this.panel.setEnabled(false)
      this.panel.setBusy(false)
      this.panel.render(null)
      this.renderedSession = state?.sessionId ?? null
    }
    this.panel.setEnabled(!!state)
    if (state) {
      this.panel.setBusy(state.busy)
      this.panel.render(state.directory)
      const hint = resolveMessage(state.hint)
      if (hint) this.panel.setHint(hint, state.kind)
    }
    this.ctx.clientTerminal.fit()
  }

  private show(state: FileState): void {
    if (this.current() === state) this.sync()
  }

  private async load(state: FileState, path: string): Promise<boolean> {
    if (!this.live(state)) return false
    const revision = ++state.navigation
    state.busy = true
    state.hint = messageKey('sftp.hint.loading', { path })
    state.kind = 'pending'
    this.show(state)
    try {
      const directory = await this.ctx.clientTransport.api.sftp.list(state.sessionId, path)
      if (!this.live(state) || state.navigation !== revision) return false
      state.directory = directory
      state.hint = messageText('')
      return true
    } catch (error) {
      if (this.live(state) && state.navigation === revision) { state.hint = errorMessage(error); state.kind = 'err' }
      return false
    } finally {
      if (this.live(state) && state.navigation === revision) { state.busy = false; this.show(state) }
    }
  }

  private async action(state: FileState, hint: MessageText, run: () => Promise<MessageText>): Promise<void> {
    if (!this.live(state) || state.busy) return
    const navigation = state.navigation
    state.busy = true
    state.hint = hint
    state.kind = 'pending'
    this.show(state)
    try {
      const message = await run()
      if (this.live(state) && navigation === state.navigation) { state.hint = message; state.kind = 'ok' }
    } catch (error) {
      if (this.live(state) && navigation === state.navigation) { state.hint = errorMessage(error); state.kind = 'err' }
    } finally {
      if (this.live(state) && navigation === state.navigation) { state.busy = false; this.show(state) }
    }
  }

  private async refreshAfter(state: FileState, directory: string): Promise<void> {
    if (!this.live(state)) return
    state.directory = await this.ctx.clientTransport.api.sftp.list(state.sessionId, directory)
  }

  private async download(entry: SftpEntry): Promise<void> {
    const state = this.current()
    if (!state) return
    if (entry.size > MAX_TRANSFER_BYTES) {
      state.hint = messageKey('sftp.error.too-large', { limit: formatBytes(MAX_TRANSFER_BYTES) })
      state.kind = 'err'
      this.show(state)
      return
    }
    await this.action(state, messageKey('sftp.hint.downloading', { name: entry.name }), async () => {
      const result = await this.ctx.clientTransport.api.sftp.read(state.sessionId, entry.path)
      if (this.live(state)) this.ctx.effect(() => saveBytes(result.bytes, entry.name), 'sftp.download')
      return messageKey('sftp.status.downloaded', { name: entry.name, size: formatBytes(result.size) })
    })
  }

  private async upload(file: File): Promise<void> {
    const state = this.current()
    if (!state) return
    if (file.size > MAX_TRANSFER_BYTES) {
      state.hint = messageKey('sftp.error.too-large', { limit: formatBytes(MAX_TRANSFER_BYTES) })
      state.kind = 'err'
      this.show(state)
      return
    }
    const directory = state.directory?.path ?? '.'
    await this.action(state, messageKey('sftp.hint.uploading', { name: file.name, directory }), async () => {
      const bytes = await readFileBytes(file)
      if (!this.live(state)) return messageText('')
      const result = await this.ctx.clientTransport.api.sftp.write(state.sessionId, directory, file.name, bytes)
      await this.refreshAfter(state, directory)
      return messageKey('sftp.status.uploaded', { name: file.name, size: formatBytes(result.size) })
    })
  }

  private async mkdir(name: string): Promise<void> {
    const state = this.current()
    if (!state) return
    const directory = state.directory?.path ?? '.'
    await this.action(state, messageKey('sftp.hint.creating', { name }), async () => {
      await this.ctx.clientTransport.api.sftp.mkdir(state.sessionId, directory, name)
      await this.refreshAfter(state, directory)
      return messageKey('sftp.status.created', { name })
    })
  }

  private async remove(entry: SftpEntry): Promise<void> {
    const state = this.current()
    if (!state) return
    const question = entry.isDirectory
      ? t('sftp.confirm.delete-dir', { path: entry.path })
      : t('sftp.confirm.delete-file', { path: entry.path })
    if (!this.ctx.clientView.window.confirm(question)) return
    const directory = state.directory?.path ?? '.'
    await this.action(state, messageKey('sftp.hint.deleting', { path: entry.path }), async () => {
      await this.ctx.clientTransport.api.sftp.remove(state.sessionId, entry.path)
      await this.refreshAfter(state, directory)
      return messageKey('sftp.status.deleted', { name: entry.name })
    })
  }
}

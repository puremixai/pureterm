import { Service, type Context } from 'cordis'
import { MAX_TRANSFER_BYTES, type SftpDir, type SftpEntry } from '@pureterm/protocol'
import { ClientScope, cleanError } from '../client-runtime.js'
import { createSftpPanel, type SftpView } from '../sftp-panel.js'
import { readFileBytes, saveBytes } from '../local-file.js'
import { formatBytes } from '../format.js'

declare module 'cordis' { interface Context { clientSftp: ClientSftp } }

interface FileState {
  tabId: string
  sessionId: string
  directory: SftpDir | null
  navigation: number
  open: boolean
  busy: boolean
  hint: string
  kind: 'ok' | 'err' | 'pending' | ''
}

/** The panel is shared, while every session retains its directory, requests and open state. */
export class ClientSftp extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal']
  readonly scope: ClientScope
  private readonly panel: SftpView
  private readonly states = new Map<string, FileState>()
  private renderedSession: string | null = null

  constructor(ctx: Context) {
    super(ctx, 'clientSftp')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    const element = view.element('sftp')
    const toggle = view.element<HTMLButtonElement>('sftp-toggle')
    this.panel = createSftpPanel(element, {
      onNavigate: path => { const state = this.current(); if (state) void this.load(state, path) },
      onRefresh: () => { const state = this.current(); if (state) void this.load(state, state.directory?.path ?? '.') },
      onDownload: entry => void this.download(entry),
      onDelete: entry => void this.remove(entry),
      onUpload: file => void this.upload(file),
      onCreate: name => void this.mkdir(name),
      onClose: () => this.setOpen(false),
    })
    this.scope.onDispose(() => {
      this.states.clear()
      this.panel.dispose()
      element.hidden = true
      toggle.disabled = true
      view.element('session-workspace').classList.remove('files-open')
    })
    this.scope.listen(toggle, 'click', () => { if (ctx.clientTerminal.sessionId) this.setOpen(element.hidden) })
    ctx.on('client/session-change', () => this.sync())
    ctx.on('client/connection-change', () => this.sync())
    ctx.on('client/tab-closed', tabId => {
      for (const [id, state] of this.states) if (state.tabId === tabId) this.states.delete(id)
      this.sync()
    })
    this.sync()
  }

  private current(): FileState | null {
    const tab = this.ctx.clientTerminal.active
    if (!this.scope.alive || !tab?.sessionId) return null
    let state = this.states.get(tab.sessionId)
    if (!state) {
      state = { tabId: tab.id, sessionId: tab.sessionId, directory: null, navigation: 0,
        open: false, busy: false, hint: '打开文件面板以浏览远端目录。', kind: '' }
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
    const view = this.ctx.clientView
    if (this.renderedSession !== (state?.sessionId ?? null)) {
      this.panel.setEnabled(false)
      this.panel.setBusy(false)
      this.panel.render(null)
      this.renderedSession = state?.sessionId ?? null
    }
    this.panel.setEnabled(!!state)
    const open = !!state?.open
    view.element('sftp').hidden = !open
    view.element('session-workspace').classList.toggle('files-open', open)
    const toggle = view.element<HTMLButtonElement>('sftp-toggle')
    toggle.disabled = !state
    toggle.textContent = open ? '收起文件' : '文件'
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-controls', 'sftp')
    if (state) {
      this.panel.setBusy(state.busy)
      this.panel.render(state.directory)
      if (state.hint) this.panel.setHint(state.hint, state.kind)
    }
    this.ctx.clientTerminal.fit()
  }

  private show(state: FileState): void {
    if (this.current() === state) this.sync()
  }

  private setOpen(open: boolean): void {
    const state = this.current()
    if (!state) return
    state.open = open
    this.sync()
    if (open && !state.directory && !state.busy) void this.load(state, '.')
  }

  private async load(state: FileState, path: string): Promise<boolean> {
    if (!this.live(state)) return false
    const revision = ++state.navigation
    state.busy = true
    state.hint = `正在读取 ${path} …`
    state.kind = 'pending'
    this.show(state)
    try {
      const directory = await this.ctx.clientTransport.api.sftp.list(state.sessionId, path)
      if (!this.live(state) || state.navigation !== revision) return false
      state.directory = directory
      state.hint = ''
      return true
    } catch (error) {
      if (this.live(state) && state.navigation === revision) { state.hint = cleanError(error); state.kind = 'err' }
      return false
    } finally {
      if (this.live(state) && state.navigation === revision) { state.busy = false; this.show(state) }
    }
  }

  private async action(state: FileState, hint: string, run: () => Promise<string>): Promise<void> {
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
      if (this.live(state) && navigation === state.navigation) { state.hint = cleanError(error); state.kind = 'err' }
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
    if (entry.size > MAX_TRANSFER_BYTES) { state.hint = `文件超过单次传输上限 ${formatBytes(MAX_TRANSFER_BYTES)}。`; state.kind = 'err'; this.show(state); return }
    await this.action(state, `正在下载 ${entry.name} …`, async () => {
      const result = await this.ctx.clientTransport.api.sftp.read(state.sessionId, entry.path)
      if (this.live(state)) this.ctx.effect(() => saveBytes(result.bytes, entry.name), 'sftp.download')
      return `已下载「${entry.name}」（${formatBytes(result.size)}）。`
    })
  }

  private async upload(file: File): Promise<void> {
    const state = this.current()
    if (!state) return
    if (file.size > MAX_TRANSFER_BYTES) { state.hint = `文件超过单次传输上限 ${formatBytes(MAX_TRANSFER_BYTES)}。`; state.kind = 'err'; this.show(state); return }
    const directory = state.directory?.path ?? '.'
    await this.action(state, `正在上传 ${file.name} 到 ${directory} …`, async () => {
      const bytes = await readFileBytes(file)
      if (!this.live(state)) return ''
      const result = await this.ctx.clientTransport.api.sftp.write(state.sessionId, directory, file.name, bytes)
      await this.refreshAfter(state, directory)
      return `已上传「${file.name}」（${formatBytes(result.size)}）。`
    })
  }

  private async mkdir(name: string): Promise<void> {
    const state = this.current()
    if (!state) return
    const directory = state.directory?.path ?? '.'
    await this.action(state, `正在新建 ${name} …`, async () => {
      await this.ctx.clientTransport.api.sftp.mkdir(state.sessionId, directory, name)
      await this.refreshAfter(state, directory)
      return `已新建目录「${name}」。`
    })
  }

  private async remove(entry: SftpEntry): Promise<void> {
    const state = this.current()
    if (!state || !this.ctx.clientView.window.confirm(`删除远端${entry.isDirectory ? '目录' : '文件'}「${entry.path}」？此操作不可恢复。`)) return
    const directory = state.directory?.path ?? '.'
    await this.action(state, `正在删除 ${entry.path} …`, async () => {
      await this.ctx.clientTransport.api.sftp.remove(state.sessionId, entry.path)
      await this.refreshAfter(state, directory)
      return `已删除「${entry.name}」。`
    })
  }
}

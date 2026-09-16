import { Service, type Context } from 'cordis'
import { MAX_TRANSFER_BYTES, type SftpDir, type SftpEntry } from '@pureterm/protocol'
import { ClientScope, cleanError } from '../client-runtime.js'
import { createSftpPanel, type SftpView } from '../sftp-panel.js'
import { readFileBytes, saveBytes } from '../local-file.js'
import { formatBytes } from '../format.js'

declare module 'cordis' { interface Context { clientSftp: ClientSftp } }

/** SFTP owns its view, navigation state and asynchronous result lifetime. */
export class ClientSftp extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal']
  readonly scope: ClientScope
  private readonly panel: SftpView
  private directory: SftpDir | null = null
  private navigation = 0

  constructor(ctx: Context) {
    super(ctx, 'clientSftp')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    const element = view.element('sftp')
    const toggle = view.element<HTMLButtonElement>('sftp-toggle')
    this.panel = createSftpPanel(element, {
      onNavigate: path => void this.load(path),
      onRefresh: () => void this.load(this.directory?.path ?? '.'),
      onDownload: entry => void this.download(entry),
      onDelete: entry => void this.remove(entry),
      onUpload: file => void this.upload(file),
      onCreate: name => void this.mkdir(name),
      onClose: () => this.setOpen(false),
    })
    this.scope.onDispose(() => {
      this.navigation++
      this.directory = null
      this.panel.dispose()
      element.hidden = true
      toggle.disabled = true
      toggle.textContent = '文件'
    })
    this.scope.listen(toggle, 'click', () => { if (ctx.clientTerminal.sessionId) this.setOpen(element.hidden) })
    ctx.on('client/session-change', sessionId => {
      this.navigation++
      this.directory = null
      this.panel.setEnabled(!!sessionId)
      toggle.disabled = !sessionId
      if (!sessionId) this.setOpen(false)
      else this.panel.setHint('点「文件」可以浏览远端目录。')
    })
    this.panel.setEnabled(!!ctx.clientTerminal.sessionId)
    toggle.disabled = !ctx.clientTerminal.sessionId
  }

  private live(session: string): boolean { return this.scope.alive && this.ctx.clientTerminal.sessionId === session }
  private currentSession(): string | null {
    if (!this.scope.alive) return null
    const session = this.ctx.clientTerminal.sessionId
    if (!session) this.panel.setHint('还没有连接，先连上一台主机。', 'err')
    return session
  }

  private setOpen(open: boolean): void {
    if (!this.scope.alive) return
    const view = this.ctx.clientView
    view.element('sftp').hidden = !open
    view.element('sftp-toggle').textContent = open ? '收起文件' : '文件'
    this.ctx.clientTerminal.fit()
    if (open && this.ctx.clientTerminal.sessionId) void this.load(this.directory?.path ?? '.')
  }

  private async load(path: string): Promise<boolean> {
    const session = this.currentSession()
    if (!session) return false
    const navigation = ++this.navigation
    this.panel.setBusy(true)
    this.panel.render(null)
    this.panel.setHint(`正在读取 ${path} …`, 'pending')
    try {
      const directory = await this.ctx.clientTransport.api.sftp.list(session, path)
      if (!this.live(session) || navigation !== this.navigation) return false
      this.directory = directory
      this.panel.render(directory)
      return true
    } catch (error) {
      if (this.live(session) && navigation === this.navigation) { this.panel.render(this.directory); this.panel.setHint(cleanError(error), 'err') }
      return false
    } finally {
      if (this.live(session) && navigation === this.navigation) this.panel.setBusy(false)
    }
  }

  private async download(entry: SftpEntry): Promise<void> {
    const session = this.currentSession()
    if (!session) return
    if (entry.size > MAX_TRANSFER_BYTES) { this.panel.setHint(`「${entry.name}」有 ${formatBytes(entry.size)}，超过单次传输上限 ${formatBytes(MAX_TRANSFER_BYTES)}。大文件先用终端里的 scp / rsync 取。`, 'err'); return }
    this.panel.setBusy(true)
    this.panel.setHint(`正在下载 ${entry.name} …`, 'pending')
    try {
      const result = await this.ctx.clientTransport.api.sftp.read(session, entry.path)
      if (!this.live(session)) return
      this.ctx.effect(() => saveBytes(result.bytes, entry.name), 'sftp.download')
      this.panel.setHint(`已下载「${entry.name}」（${formatBytes(result.size)}）。`, 'ok')
    } catch (error) { if (this.live(session)) this.panel.setHint(cleanError(error), 'err') }
    finally { if (this.live(session)) this.panel.setBusy(false) }
  }

  private async upload(file: File): Promise<void> {
    const session = this.currentSession()
    if (!session) return
    if (file.size > MAX_TRANSFER_BYTES) { this.panel.setHint(`「${file.name}」有 ${formatBytes(file.size)}，超过单次传输上限 ${formatBytes(MAX_TRANSFER_BYTES)}。请换个小一点的文件。`, 'err'); return }
    const directory = this.directory?.path ?? '.'
    this.panel.setBusy(true)
    this.panel.setHint(`正在上传 ${file.name} 到 ${directory} …`, 'pending')
    try {
      const bytes = await readFileBytes(file)
      if (!this.live(session)) return
      const result = await this.ctx.clientTransport.api.sftp.write(session, directory, file.name, bytes)
      if (!this.live(session)) return
      const refreshed = await this.load(directory)
      if (this.live(session)) this.panel.setHint(refreshed ? `已上传「${file.name}」到 ${directory}（${formatBytes(result.size)}）。` : `「${file.name}」已经传上去了，但列表没刷新成功。`, refreshed ? 'ok' : 'err')
    } catch (error) { if (this.live(session)) this.panel.setHint(cleanError(error), 'err') }
    finally { if (this.live(session)) this.panel.setBusy(false) }
  }

  private async mkdir(name: string): Promise<void> {
    const session = this.currentSession()
    if (!session) return
    const directory = this.directory?.path ?? '.'
    this.panel.setBusy(true)
    this.panel.setHint(`正在新建 ${directory}/${name} …`, 'pending')
    try {
      await this.ctx.clientTransport.api.sftp.mkdir(session, directory, name)
      if (!this.live(session)) return
      const refreshed = await this.load(directory)
      if (this.live(session)) this.panel.setHint(refreshed ? `已新建目录「${name}」。` : `目录「${name}」建好了，但列表没刷新成功。`, refreshed ? 'ok' : 'err')
    } catch (error) { if (this.live(session)) this.panel.setHint(cleanError(error), 'err') }
    finally { if (this.live(session)) this.panel.setBusy(false) }
  }

  private async remove(entry: SftpEntry): Promise<void> {
    const session = this.currentSession()
    if (!session || !this.ctx.clientView.window.confirm(`删除远端${entry.isDirectory ? '目录' : '文件'}「${entry.path}」？此操作不可恢复。`)) return
    this.panel.setBusy(true)
    this.panel.setHint(`正在删除 ${entry.path} …`, 'pending')
    try {
      await this.ctx.clientTransport.api.sftp.remove(session, entry.path)
      if (!this.live(session)) return
      const refreshed = await this.load(this.directory?.path ?? '.')
      if (this.live(session)) this.panel.setHint(refreshed ? `已删除「${entry.name}」。` : `「${entry.name}」删掉了，但列表没刷新成功。`, refreshed ? 'ok' : 'err')
    } catch (error) { if (this.live(session)) this.panel.setHint(cleanError(error), 'err') }
    finally { if (this.live(session)) this.panel.setBusy(false) }
  }
}

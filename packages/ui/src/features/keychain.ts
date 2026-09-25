import { Service, type Context } from 'cordis'
import { MAX_PRIVATE_KEY_BYTES, type KeyRecord, type KeySaveRequest } from '@pureterm/protocol'
import { ClientScope, cleanError, DomListeners } from '../client-runtime.js'
import { saveBytes } from '../local-file.js'
import { formatBytes } from '../format.js'

declare module 'cordis' { interface Context { clientKeychain: ClientKeychain } }

/** Write-only private material; navigation and terminal tabs never own the saved secrets. */
export class ClientKeychain extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal', 'clientToasts']
  readonly ready: Promise<void>
  private readonly scope: ClientScope
  private readonly cards = new DomListeners()
  private keys: KeyRecord[] = []
  private selectedId: string | null = null
  private editingId: string | null = null
  private revision = 0
  private listRevision = 0
  private busy = false
  private operation = 0
  private dirty = false
  private available = false
  private sessionOnly = true
  private hostCounts: Record<string, number> = {}

  constructor(ctx: Context) {
    super(ctx, 'clientKeychain')
    this.scope = new ClientScope(ctx)
    this.scope.listen(this.el('nav-keychain'), 'click', () => { ctx.clientTerminal.select(null, 'keychain'); void this.refresh() })
    ctx.on('client/transport-lost', () => {
      this.revision++
      this.listRevision++
      this.operation++
      this.dirty = false
      this.clearPrivate()
      this.value('keychain-label', '')
      this.value('keychain-public', '')
      this.editingId = this.selectedId = null
      this.el('keychain-editor').hidden = true
      if (this.sessionOnly) this.keys = []
      this.setBusy(false)
      this.renderSummary()
      this.render()
      this.el('keychain-list').setAttribute('aria-busy', 'false')
      this.notice(this.sessionOnly ? '与后端断开，临时密钥和草稿已清除。重新连接后请再次导入密钥。' : '与后端断开，未保存的草稿已清除。已加密保存的密钥不受影响。', true)
      ctx.emit('client/keychain-change')
    })
    ctx.on('client/host-counts', counts => { this.hostCounts = counts; this.render() })
    this.scope.listen(this.el('keychain-new'), 'click', () => this.edit())
    this.scope.listen(this.el('keychain-close'), 'click', () => this.close())
    this.scope.listen(this.el('keychain-search'), 'input', () => this.render())
    this.scope.listen(this.el('keychain-view'), 'click', () => {
      const cards = this.el('keychain-list').classList.toggle('card-view')
      this.el('keychain-view').setAttribute('aria-pressed', String(cards))
    })
    this.scope.listen(this.el('keychain-editor'), 'submit', event => { event.preventDefault(); void this.save() })
    this.scope.listen(this.el('keychain-delete'), 'click', () => void this.remove())
    this.scope.listen(this.el('keychain-copy'), 'click', () => void this.copyPublicKey())
    this.scope.listen(this.el('keychain-download'), 'click', () => this.downloadPublicKey())
    this.scope.listen(this.el('keychain-reload'), 'click', () => void this.refresh())
    this.scope.listen(this.el('keychain-import'), 'click', () => { this.el<HTMLInputElement>('keychain-file').value = ''; this.el('keychain-file').click() })
    this.scope.listen(this.el('keychain-file'), 'change', () => {
      const input = this.el<HTMLInputElement>('keychain-file')
      const file = input.files?.[0]
      input.value = ''
      if (file) void this.importFile(file)
    })
    const drop = this.el('keychain-drop')
    this.scope.listen(drop, 'dragover', event => { event.preventDefault(); if (!this.busy) drop.classList.add('is-dragging') })
    this.scope.listen(drop, 'dragleave', () => drop.classList.remove('is-dragging'))
    this.scope.listen(drop, 'drop', event => {
      event.preventDefault(); drop.classList.remove('is-dragging')
      const files = (event as DragEvent).dataTransfer?.files
      if (files?.length !== 1) { this.status('请一次导入一个私钥文件。', 'err'); return }
      void this.importFile(files[0]!)
    })
    // Never navigate the Electron/browser page to a dropped local file.
    for (const event of ['dragover', 'drop']) this.scope.listen(this.el('keychain-editor'), event, event => event.preventDefault())
    for (const id of ['keychain-label', 'keychain-private', 'keychain-public', 'keychain-passphrase']) {
      this.scope.listen(this.el(id), 'input', () => {
        this.dirty = true
        this.revision++
        if (id === 'keychain-private') {
          const current = this.keys.find(key => key.id === this.editingId)
          if (current && this.value('keychain-public') === current.publicKey) this.value('keychain-public', '')
          this.el<HTMLInputElement>('keychain-passphrase').disabled = !!this.editingId && !this.value('keychain-private').trim()
        }
        if (id === 'keychain-label') this.render()
        if (id !== 'keychain-label') this.renderSummary()
      })
    }
    this.scope.listen(ctx.clientView.document, 'keydown', event => {
      if ((event as KeyboardEvent).key === 'Escape' && !this.el('keychain-panel').hidden && !this.el('keychain-editor').hidden) this.close()
    })
    this.scope.onDispose(() => {
      this.revision++
      this.operation++
      this.cards.clear()
      this.keys = []
      this.clearPrivate()
      this.el('keychain-editor').hidden = true
      this.el('keychain-panel').hidden = true
      this.el('keychain-list').replaceChildren()
      this.el<HTMLButtonElement>('keychain-new').disabled = true
    })
    this.setBusy(false)
    this.ready = this.initialize()
  }

  get records(): readonly KeyRecord[] { return this.keys }
  private el<T extends HTMLElement = HTMLElement>(id: string): T { return this.ctx.clientView.element<T>(id) }
  private value(id: string, value?: string): string {
    const field = this.el<HTMLInputElement | HTMLTextAreaElement>(id)
    if (value !== undefined) field.value = value
    return field.value
  }
  private status(message: string, kind = ''): void {
    this.el('keychain-status').textContent = message
    this.el('keychain-status').className = `keychain-message ${kind}`
  }
  private clearPrivate(): void {
    for (const id of ['keychain-private', 'keychain-passphrase', 'keychain-file']) this.value(id, '')
  }

  private async initialize(): Promise<void> {
    try {
      const capabilities = await this.ctx.clientTransport.capabilities
      if (!this.scope.alive) return
      this.available = true
      this.sessionOnly = capabilities.credentialPersistence === 'session'
      this.el<HTMLButtonElement>('keychain-new').disabled = false
      this.el('keychain-policy').textContent = capabilities.credentialPersistence === 'encrypted'
        ? '私钥和口令通过系统加密保存在本机。' : '仅当前会话：刷新页面或关闭连接后，密钥将被清除，不会保存到磁盘。'
      await this.refresh()
    } catch (error) { if (this.scope.alive) this.notice(cleanError(error), true) }
  }

  private notice(message: string, error = false): void {
    this.el('keychain-notice').textContent = message
    this.el('keychain-notice').className = `keychain-message ${error ? 'err' : ''}`
    this.el('keychain-reload').hidden = !error
  }

  async refresh(): Promise<void> {
    if (!this.available || !this.scope.alive) return
    const revision = ++this.listRevision
    this.el('keychain-list').setAttribute('aria-busy', 'true')
    try {
      const keys = await this.ctx.clientTransport.api.keychain.list()
      if (!this.scope.alive || revision !== this.listRevision) return
      this.keys = keys
      this.notice('')
      this.render()
      this.ctx.emit('client/keychain-change')
    } catch (error) { if (this.scope.alive && revision === this.listRevision) this.notice(cleanError(error), true) }
    finally { if (this.scope.alive && revision === this.listRevision) this.el('keychain-list').setAttribute('aria-busy', 'false') }
  }

  private render(): void {
    this.cards.clear()
    const list = this.el('keychain-list')
    list.replaceChildren()
    const query = this.value('keychain-search').trim().toLocaleLowerCase()
    const visible = this.keys.filter(key => `${key.label} ${key.type} ${key.fingerprint}`.toLocaleLowerCase().includes(query))
    this.el('keychain-count').textContent = query ? `${visible.length} / ${this.keys.length} keys` : `${this.keys.length} keys`
    const draft = !this.el('keychain-editor').hidden && !this.editingId
    if (draft) this.card(null, this.value('keychain-label') || '添加名称…', '待保存', list)
    for (const key of visible) this.card(key, key.label, `Type ${key.type}`, list)
    const empty = this.el('keychain-empty')
    empty.hidden = visible.length > 0 || draft
    empty.querySelector('h2')!.textContent = query ? '没有匹配的密钥' : '还没有密钥'
    empty.querySelector('p')!.textContent = query ? '试试名称、类型或指纹中的其他关键词。' : '点击「新建密钥」，粘贴或导入私钥文件。保存后可在主机认证设置中选择使用。'
  }

  private cell(className: string, text: string, title = ''): HTMLElement {
    const element = this.ctx.clientView.document.createElement('span')
    element.className = `host-cell ${className}`
    element.textContent = text
    if (title) element.title = title
    return element
  }

  /** 关联主机数由 ClientHosts 在每次刷新后广播 —— 反向注入会成环。 */
  private associationCount(id: string): number {
    return this.hostCounts[id] ?? 0
  }

  private card(key: KeyRecord | null, label: string, subtitle: string, list: HTMLElement): void {
    const doc = this.ctx.clientView.document
    const row = doc.createElement('li')
    const active = key ? key.id === this.selectedId : this.selectedId === null
    row.className = `keychain-card${active ? ' active' : ''}${key ? '' : ' draft'}`
    row.dataset.id = key?.id ?? 'draft'
    const main = doc.createElement('button')
    main.type = 'button'; main.className = 'keychain-card-main'
    main.setAttribute('aria-pressed', String(active))
    const avatar = doc.createElement('span')
    avatar.className = 'keychain-avatar'; avatar.innerHTML = '<i class="ti ti-key" aria-hidden="true"></i>'
    const content = doc.createElement('span'); content.className = 'host-content'
    const title = doc.createElement('span'); title.className = 'host-label'; title.textContent = label
    const sub = doc.createElement('span'); sub.className = 'keychain-card-sub'; sub.textContent = subtitle
    content.append(title, sub); main.append(avatar, content); row.append(main)
    if (key) {
      const usage = this.associationCount(key.id)
      row.append(
        this.cell('', key.type),
        this.cell('mono', key.fingerprint.replace(/^SHA256:/, '')),
        this.cell('when', usage ? `${usage} host${usage === 1 ? '' : 's'}` : '未使用', usage ? '' : '尚无主机使用这把密钥'),
        this.cell('', new Date(key.updatedAt).toLocaleDateString()),
      )
    } else {
      // 草稿卡片保留四个单元格，否则正在新建密钥时列会塌。
      row.append(this.cell('', '—'), this.cell('mono', '—'), this.cell('when', '—'), this.cell('', '—'))
    }
    main.title = key ? `${label}\n${key.fingerprint}` : label
    this.cards.add(main, 'click', () => {
      this.selectedId = key?.id ?? null
      // Selection must not replace the focused card or invalidate a keyboard user's next Tab.
      for (const card of list.querySelectorAll<HTMLElement>('.keychain-card')) {
        const selected = card.dataset.id === (this.selectedId ?? 'draft')
        card.classList.toggle('active', selected)
        card.querySelector('.keychain-card-main')!.setAttribute('aria-pressed', String(selected))
      }
    })
    if (key) {
      const edit = doc.createElement('button')
      edit.type = 'button'; edit.className = 'keychain-card-edit tool-icon'; edit.dataset.act = 'edit'
      edit.setAttribute('aria-label', `编辑密钥 ${label}`); edit.title = '编辑密钥'
      edit.innerHTML = '<i class="ti ti-pencil" aria-hidden="true"></i>'
      this.cards.add(edit, 'click', () => this.edit(key))
      row.append(edit)
    }
    list.append(row)
  }

  private canDiscard(): boolean { return !this.busy && (!this.dirty || this.ctx.clientView.window.confirm('放弃尚未保存的密钥修改？')) }
  private edit(key?: KeyRecord): void {
    if (!this.available || !this.canDiscard()) return
    this.revision++
    this.editingId = this.selectedId = key?.id ?? null
    this.dirty = false
    this.clearPrivate()
    this.value('keychain-label', key?.label ?? '')
    this.value('keychain-public', key?.publicKey ?? '')
    this.el('keychain-editor').hidden = false
    this.el('keychain-title').textContent = key ? '编辑密钥' : '新建密钥'
    this.el('keychain-delete').hidden = !key
    this.el('keychain-details').hidden = !key
    this.el('keychain-required').hidden = !!key
    this.el<HTMLTextAreaElement>('keychain-private').required = !key
    this.el<HTMLTextAreaElement>('keychain-private').placeholder = key ? '已安全保存。留空保留原私钥；粘贴新私钥可替换。' : '粘贴完整的私钥内容'
    this.el<HTMLInputElement>('keychain-passphrase').disabled = !!key
    if (key) {
      this.el('keychain-fingerprint').textContent = key.fingerprint
      this.el('keychain-type').textContent = `${key.type}${key.hasPassphrase ? ' · 有口令保护' : ''}`
    }
    this.status('')
    this.renderSummary()
    this.render()
    this.el('keychain-label').focus()
  }

  private close(): void {
    if (!this.canDiscard()) return
    this.revision++
    this.dirty = false
    this.clearPrivate()
    this.el('keychain-editor').hidden = true
    this.renderSummary()
    this.render()
    this.el('keychain-new').focus()
  }

  /**
   * 草稿阶段能诚实说出来的那几件事。
   *
   * 「PEM 有效」这句话页面说不了：解析私钥的是 Host，客户端只有一条 `BEGIN … PRIVATE
   * KEY` 的正则，拿它当校验结论就是在编。所以这里只报手里真有的 —— 字节数、口令状态、
   * 公钥的来源 —— 而「私钥有效」那枚标签只出现在已保存的密钥上，因为那是 Host 已经
   * 校验过的事实。
   */
  private renderSummary(): void {
    const summary = this.el('keychain-summary')
    const privateKey = this.value('keychain-private')
    const facts: string[] = []
    if (privateKey) {
      facts.push(formatBytes(new TextEncoder().encode(privateKey).length))
      facts.push(this.value('keychain-passphrase') ? '有口令保护' : '未加密')
      facts.push(this.value('keychain-public').trim() ? '已提供公钥，保存时校验是否匹配' : '公钥由私钥自动生成')
    }
    summary.textContent = facts.join(' · ')
    summary.hidden = facts.length === 0
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    this.el<HTMLFieldSetElement>('keychain-fields').disabled = busy
    for (const id of ['keychain-save', 'keychain-delete', 'keychain-close']) this.el<HTMLButtonElement>(id).disabled = busy
    this.el<HTMLButtonElement>('keychain-new').disabled = busy || !this.available
    this.el('keychain-save').textContent = busy ? '处理中…' : '保存密钥'
  }

  private async save(): Promise<void> {
    if (this.busy || !this.available || !this.el<HTMLFormElement>('keychain-editor').reportValidity()) return
    const revision = this.revision
    const input: KeySaveRequest = { id: this.editingId ?? undefined, label: this.value('keychain-label').trim(),
      privateKey: this.value('keychain-private').trim() || undefined, publicKey: this.value('keychain-public').trim() || undefined,
      passphrase: this.value('keychain-passphrase') || undefined }
    if ([input.privateKey, input.publicKey].some(value => value && new TextEncoder().encode(value).length > MAX_PRIVATE_KEY_BYTES)) {
      this.status('密钥内容超过 256 KiB，请确认粘贴的是密钥文件内容。', 'err')
      return
    }
    const operation = ++this.operation
    this.listRevision++
    this.setBusy(true)
    this.status('正在校验并保存密钥…')
    try {
      const saved = await this.ctx.clientTransport.api.keychain.save(input)
      if (!this.scope.alive || revision !== this.revision) return
      this.clearPrivate()
      this.dirty = false
      this.setBusy(false)
      this.keys = [...this.keys.filter(key => key.id !== saved.id), saved]
      this.edit(saved)
      this.status('', 'ok')
      this.ctx.clientToasts.notify({ title: '密钥已保存', detail: '可在主机的认证设置里选用' })
      this.ctx.emit('client/keychain-change')
      await this.refresh()
    } catch (error) { if (this.scope.alive && revision === this.revision) this.status(cleanError(error), 'err') }
    finally { if (this.scope.alive && operation === this.operation) this.setBusy(false) }
  }

  private async importFile(file: File): Promise<void> {
    if (this.busy) return
    const revision = ++this.revision
    const operation = ++this.operation
    this.setBusy(true)
    try {
      if (!file.size || file.size > MAX_PRIVATE_KEY_BYTES) throw new Error('请选择非空且不超过 256 KiB 的私钥文件。')
      const content = await file.text()
      if (!this.scope.alive || revision !== this.revision) return
      if (new TextEncoder().encode(content).length > MAX_PRIVATE_KEY_BYTES) throw new Error('私钥内容超过 256 KiB。')
      this.value('keychain-private', content)
      this.value('keychain-public', '')
      this.value('keychain-passphrase', '')
      if (!this.value('keychain-label').trim()) this.value('keychain-label', file.name)
      this.el<HTMLInputElement>('keychain-passphrase').disabled = false
      this.dirty = true
      this.renderSummary()
      this.render()
      this.status(`已读取「${file.name}」。若有口令请填写，然后保存。`)
      this.el('keychain-passphrase').focus()
    } catch (error) { if (this.scope.alive && revision === this.revision) this.status(cleanError(error), 'err') }
    finally { if (this.scope.alive && operation === this.operation) this.setBusy(false) }
  }

  private async remove(): Promise<void> {
    const key = this.keys.find(key => key.id === this.editingId)
    if (this.busy || !key || !this.ctx.clientView.window.confirm(`删除密钥「${key.label}」？本机保存的私钥及口令将被移除，此操作无法撤销。`)) return
    const operation = ++this.operation
    this.listRevision++
    this.setBusy(true)
    try {
      await this.ctx.clientTransport.api.keychain.remove(key.id)
      if (!this.scope.alive || operation !== this.operation) return
      this.dirty = false
      this.setBusy(false)
      this.close()
      await this.refresh()
      if (this.scope.alive && operation === this.operation) this.notice(`已删除「${key.label}」。`)
    } catch (error) { if (this.scope.alive && operation === this.operation) this.status(cleanError(error), 'err') }
    finally { if (this.scope.alive && operation === this.operation) this.setBusy(false) }
  }

  private async copyPublicKey(): Promise<void> {
    const key = this.keys.find(key => key.id === this.editingId)
    if (!key) return
    try { await this.ctx.clientView.window.navigator.clipboard.writeText(key.publicKey); if (this.scope.alive) this.status('公钥已复制。', 'ok') }
    catch { if (this.scope.alive) this.status('复制失败，请选中公钥内容手动复制。', 'err') }
  }

  /**
   * 导出成 .pub 文件，走的是和 SFTP 下载同一条路（Blob + `<a download>`），
   * 所以桌面端和浏览器端不分叉，也不需要额外的原生能力。
   */
  private downloadPublicKey(): void {
    const key = this.keys.find(key => key.id === this.editingId)
    if (!key) return
    // 标签是用户自己写的，可能带路径分隔符；带 `/` 的 download 值会被实现当成
    // 路径处理，落下来的名字就不是用户看到的那个。
    const name = `${key.label.replace(/[\\/]/g, '_')}.pub`
    const bytes = new TextEncoder().encode(`${key.publicKey}\n`)
    this.ctx.effect(() => saveBytes(bytes, name), 'keychain.pub')
    this.status(`已导出 ${name}。`, 'ok')
  }
}

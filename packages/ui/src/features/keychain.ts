import { Service, type Context } from 'cordis'
import { MAX_PRIVATE_KEY_BYTES, type KeyRecord, type KeySaveRequest } from '@pureterm/protocol'
import { t, tPlural } from '@pureterm/i18n'
import { ClientScope, cleanError, DomListeners } from '../client-runtime.js'
import { messageKey, resolveMessage, type MessageText } from '../message-text.js'
import { saveBytes } from '../local-file.js'
import { formatBytes, formatTime } from '../format.js'

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
      this.notice(messageKey(this.sessionOnly ? 'keys.notice.disconnected-session' : 'keys.notice.disconnected'), true)
      ctx.emit('client/keychain-change')
    })
    ctx.on('client/host-counts', counts => { this.hostCounts = counts; this.render() })
    // 换语言之后要重画三样：策略说明（常驻）、编辑器头部（标题、占位、类型片）、
    // 以及列表本身（卡片副标题、用量列、空态都是拼出来的）。
    ctx.on('client/locale-change', () => {
      if (!this.scope.alive) return
      this.renderPolicy()
      this.renderEditor()
      this.paintNotice()
      this.render()
    })
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
      if (files?.length !== 1) { this.status(t('keys.error.one-file'), 'err'); return }
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
    // markup 里那一句「Loading keys…」是给脚本还没跑起来的那一帧的；这里接手之后
    // 它就走目录，于是记住的语言在第一次答复到达之前就已经生效。
    this.notice(messageKey('keys.status.loading'))
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
      this.renderPolicy()
      await this.refresh()
    } catch (error) { if (this.scope.alive) this.notice({ text: cleanError(error) }, true) }
  }

  /** 凭据怎么存这一句是常驻说明，所以它得跟着语言走，而不是在 initialize 里写死。 */
  private renderPolicy(): void {
    if (!this.available) return
    this.el('keychain-policy').textContent = this.sessionOnly ? t('keys.policy.session') : t('keys.policy.encrypted')
  }

  private noticeMessage: MessageText = { text: '' }
  private noticeError = false

  private notice(message: MessageText, error = false): void {
    this.noticeMessage = message
    this.noticeError = error
    this.paintNotice()
  }

  /**
   * 通知那一行的画法。
   *
   * 单独一个方法是因为它必须能被重画：断开连接那条通知是**常驻**的（要等下一次
   * 成功刷新才消失），它说的又是一句要紧的话 —— 临时密钥被清了。所以它存的是
   * key，换语言之后重画一次就跟着变。
   */
  private paintNotice(): void {
    this.el('keychain-notice').textContent = resolveMessage(this.noticeMessage)
    this.el('keychain-notice').className = `keychain-message ${this.noticeError ? 'err' : ''}`
    this.el('keychain-reload').hidden = !this.noticeError
  }

  async refresh(): Promise<void> {
    if (!this.available || !this.scope.alive) return
    const revision = ++this.listRevision
    this.el('keychain-list').setAttribute('aria-busy', 'true')
    try {
      const keys = await this.ctx.clientTransport.api.keychain.list()
      if (!this.scope.alive || revision !== this.listRevision) return
      this.keys = keys
      this.notice({ text: '' })
      this.render()
      this.ctx.emit('client/keychain-change')
    } catch (error) { if (this.scope.alive && revision === this.listRevision) this.notice({ text: cleanError(error) }, true) }
    finally { if (this.scope.alive && revision === this.listRevision) this.el('keychain-list').setAttribute('aria-busy', 'false') }
  }

  private render(): void {
    this.cards.clear()
    const list = this.el('keychain-list')
    list.replaceChildren()
    const query = this.value('keychain-search').trim().toLocaleLowerCase()
    const visible = this.keys.filter(key => `${key.label} ${key.type} ${key.fingerprint}`.toLocaleLowerCase().includes(query))
    this.el('keychain-count').textContent = query
      ? t('keys.count.filtered', { visible: visible.length, total: this.keys.length })
      : t('keys.count', { count: this.keys.length })
    const draft = !this.el('keychain-editor').hidden && !this.editingId
    if (draft) this.card(null, this.value('keychain-label') || t('keys.draft.name'), t('keys.draft.subtitle'), list)
    for (const key of visible) this.card(key, key.label, t('keys.card.type', { type: key.type }), list)
    const empty = this.el('keychain-empty')
    empty.hidden = visible.length > 0 || draft
    empty.querySelector('h2')!.textContent = query ? t('keys.empty.filtered.title') : t('keys.empty.title')
    empty.querySelector('p')!.textContent = query ? t('keys.empty.filtered.body') : t('keys.empty.none')
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
    // 卡片里的指纹是名称栏的最后一行，和主机卡片里的地址同一处：表格的 .host-cell.mono
    // 是行网格的一行，只能落在头像底下，而且贴着卡片左边缘 —— 那一格没有表格那圈内边距
    // 兜着。挂在 .host-content 上，名称、类型和指纹才共用同一条左边线。表格视图把它
    // 关掉，指纹由表格自己那一列负责。卡片和表格共用同一个值，所以先剥掉前缀再分发。
    const fingerprint = key ? key.fingerprint.replace(/^SHA256:/, '') : '—'
    const print = doc.createElement('span'); print.className = 'keychain-card-fingerprint'; print.textContent = fingerprint
    content.append(title, sub, print); main.append(avatar, content); row.append(main)
    if (key) {
      const usage = this.associationCount(key.id)
      row.append(
        this.cell('', key.type),
        this.cell('mono', fingerprint),
        this.cell('when', usage ? tPlural('keychain.usage', usage) : t('keys.usage.none'),
          usage ? '' : t('keys.usage.none-title')),
        // updatedAt 是 ISO 串，而 formatTime 收秒（SFTP 的 attrs.mtime 那种）。
        // 两处日期因此都是同一个房子格式，而不是各自 toLocaleDateString()。
        this.cell('', formatTime(Math.floor(Date.parse(key.updatedAt) / 1000))),
      )
    } else {
      // 草稿卡片保留四个单元格，否则正在新建密钥时列会塌。
      row.append(this.cell('', '—'), this.cell('mono', fingerprint), this.cell('when', '—'), this.cell('', '—'))
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
      edit.setAttribute('aria-label', t('keys.edit-aria', { label })); edit.title = t('keys.edit')
      edit.innerHTML = '<i class="ti ti-pencil" aria-hidden="true"></i>'
      this.cards.add(edit, 'click', () => this.edit(key))
      row.append(edit)
    }
    list.append(row)
  }

  private canDiscard(): boolean { return !this.busy && (!this.dirty || this.ctx.clientView.window.confirm(t('keys.confirm.discard'))) }
  private edit(key?: KeyRecord): void {
    if (!this.available || !this.canDiscard()) return
    this.revision++
    this.editingId = this.selectedId = key?.id ?? null
    this.dirty = false
    this.clearPrivate()
    this.value('keychain-label', key?.label ?? '')
    this.value('keychain-public', key?.publicKey ?? '')
    this.el('keychain-editor').hidden = false
    this.el('keychain-delete').hidden = !key
    this.el('keychain-details').hidden = !key
    this.el('keychain-required').hidden = !!key
    this.el<HTMLTextAreaElement>('keychain-private').required = !key
    this.el<HTMLInputElement>('keychain-passphrase').disabled = !!key
    this.renderEditor()
    this.status('')
    this.renderSummary()
    this.render()
    this.el('keychain-label').focus()
  }

  /**
   * 编辑器头部那几句。**由 editingId 决定，不由这一次点击决定** —— 换语言时要能
   * 只凭当前状态重画一遍，所以它读的是 `this.editingId`，而不是某个传进来的参数。
   */
  private renderEditor(): void {
    const key = this.keys.find(entry => entry.id === this.editingId)
    this.el('keychain-title').textContent = key ? t('keys.edit') : t('keys.editor.new')
    this.el<HTMLTextAreaElement>('keychain-private').placeholder =
      key ? t('keys.placeholder.private-keep') : t('keys.placeholder.private')
    if (key) {
      this.el('keychain-fingerprint').textContent = key.fingerprint
      this.el('keychain-type').textContent = key.hasPassphrase
        ? t('keys.type.with-passphrase', { type: key.type })
        : key.type
    }
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
      facts.push(this.value('keychain-passphrase') ? t('keys.summary.passphrase') : t('keys.summary.plain'))
      facts.push(this.value('keychain-public').trim() ? t('keys.summary.public-given') : t('keys.summary.public-generated'))
    }
    summary.textContent = facts.join(' · ')
    summary.hidden = facts.length === 0
  }

  private setBusy(busy: boolean): void {
    this.busy = busy
    this.el<HTMLFieldSetElement>('keychain-fields').disabled = busy
    for (const id of ['keychain-save', 'keychain-delete', 'keychain-close']) this.el<HTMLButtonElement>(id).disabled = busy
    this.el<HTMLButtonElement>('keychain-new').disabled = busy || !this.available
    this.el('keychain-save').textContent = busy ? t('keys.save.busy') : t('keys.save')
  }

  private async save(): Promise<void> {
    if (this.busy || !this.available || !this.el<HTMLFormElement>('keychain-editor').reportValidity()) return
    const revision = this.revision
    const input: KeySaveRequest = { id: this.editingId ?? undefined, label: this.value('keychain-label').trim(),
      privateKey: this.value('keychain-private').trim() || undefined, publicKey: this.value('keychain-public').trim() || undefined,
      passphrase: this.value('keychain-passphrase') || undefined }
    if ([input.privateKey, input.publicKey].some(value => value && new TextEncoder().encode(value).length > MAX_PRIVATE_KEY_BYTES)) {
      this.status(t('keys.error.content-too-large'), 'err')
      return
    }
    const operation = ++this.operation
    this.listRevision++
    this.setBusy(true)
    this.status(t('keys.status.saving'))
    try {
      const saved = await this.ctx.clientTransport.api.keychain.save(input)
      if (!this.scope.alive || revision !== this.revision) return
      this.clearPrivate()
      this.dirty = false
      this.setBusy(false)
      this.keys = [...this.keys.filter(key => key.id !== saved.id), saved]
      this.edit(saved)
      this.status('', 'ok')
      this.ctx.clientToasts.notify({ title: t('keys.toast.saved'), detail: t('keys.toast.saved-detail') })
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
      if (!file.size || file.size > MAX_PRIVATE_KEY_BYTES) throw new Error(t('keys.error.file-size'))
      const content = await file.text()
      if (!this.scope.alive || revision !== this.revision) return
      if (new TextEncoder().encode(content).length > MAX_PRIVATE_KEY_BYTES) throw new Error(t('keys.error.content-size'))
      this.value('keychain-private', content)
      this.value('keychain-public', '')
      this.value('keychain-passphrase', '')
      if (!this.value('keychain-label').trim()) this.value('keychain-label', file.name)
      this.el<HTMLInputElement>('keychain-passphrase').disabled = false
      this.dirty = true
      this.renderSummary()
      this.render()
      this.status(t('keys.status.imported', { name: file.name }))
      this.el('keychain-passphrase').focus()
    } catch (error) { if (this.scope.alive && revision === this.revision) this.status(cleanError(error), 'err') }
    finally { if (this.scope.alive && operation === this.operation) this.setBusy(false) }
  }

  private async remove(): Promise<void> {
    const key = this.keys.find(key => key.id === this.editingId)
    if (this.busy || !key || !this.ctx.clientView.window.confirm(t('keys.confirm.delete', { label: key.label }))) return
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
      if (this.scope.alive && operation === this.operation) this.notice(messageKey('keys.notice.deleted', { label: key.label }))
    } catch (error) { if (this.scope.alive && operation === this.operation) this.status(cleanError(error), 'err') }
    finally { if (this.scope.alive && operation === this.operation) this.setBusy(false) }
  }

  private async copyPublicKey(): Promise<void> {
    const key = this.keys.find(key => key.id === this.editingId)
    if (!key) return
    try { await this.ctx.clientView.window.navigator.clipboard.writeText(key.publicKey); if (this.scope.alive) this.status(t('keys.status.copied'), 'ok') }
    catch { if (this.scope.alive) this.status(t('keys.error.copy'), 'err') }
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
    this.status(t('keys.status.downloaded', { name }), 'ok')
  }
}

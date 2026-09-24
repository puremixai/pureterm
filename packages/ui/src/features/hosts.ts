import { Service, type Context } from 'cordis'
import type { AuthMethod, HostRecord, HostSaveRequest, RuntimeCapabilities, TerminalOpenRequest } from '@pureterm/protocol'
import { ClientScope, cleanError } from '../client-runtime.js'
import { createHostList, type HostListView } from '../host-list.js'
import { BrowserPrivateKeySelection, connectionCredentials, savedCredentials, readBrowserPrivateKey } from '../credentials.js'

declare module 'cordis' { interface Context { clientHosts: ClientHosts } }

/** Host metadata, credential form and native/browser key selection belong to one feature scope. */
export class ClientHosts extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal', 'clientKeychain', 'clientToasts']
  readonly scope: ClientScope
  readonly ready: Promise<void>
  private readonly list: HostListView
  private hosts: HostRecord[] = []
  private selectedId: string | null = null
  private editingId: string | null = null
  private capabilities: RuntimeCapabilities | null = null
  private readonly browserKey = new BrowserPrivateKeySelection()
  private pickerRevision = 0
  private formRevision = 0
  private listRevision = 0
  private query = ''
  private readonly pendingForms = new Set<number>()

  constructor(ctx: Context) {
    super(ctx, 'clientHosts')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    this.list = createHostList(view.element('host-list'), {
      onSelect: record => this.selectHost(record),
      onEdit: record => this.applyHost(record),
      onConnect: record => {
        this.applyHost(record)
        void this.connect()
      },
      onDelete: record => void this.remove(record.id),
    })
    this.scope.onDispose(() => {
      this.browserKey.clear()
      this.list.dispose()
      for (const id of ['pass', 'key-pass', 'key-path', 'private-key-file']) this.input(id).value = ''
      for (const id of ['connect', 'host-save', 'key-pick', 'remember']) this.input(id).disabled = true
    })
    this.scope.listen(view.element('toolbar'), 'submit', event => { event.preventDefault(); void this.connect() })
    this.scope.listen(view.element('connect'), 'click', () => void this.connect())
    this.scope.listen(view.element('host-new'), 'click', () => this.startNew())
    this.scope.listen(view.element('hosts-retry'), 'click', () => { void this.refresh().catch(() => {}) })
    this.scope.listen(view.element('connection-close'), 'click', () => this.closeWorkspace())
    for (const id of ['workspace-home', 'nav-hosts']) this.scope.listen(view.element(id), 'click', () => { ctx.clientTerminal.select(null); this.closeWorkspace() })
    this.scope.listen(view.element('host-view-toggle'), 'click', () => {
      // The class and the reported state are derived from one value, so they
      // cannot disagree the way a separate boolean field could.
      const cards = view.element('host-list').classList.toggle('card-view')
      view.element('host-view-toggle').setAttribute('aria-pressed', String(cards))
    })
    const shortcuts = view.element<HTMLDialogElement>('shortcuts-dialog')
    for (const id of ['shortcuts-open', 'nav-shortcuts']) this.scope.listen(view.element(id), 'click', () => shortcuts.showModal())
    this.scope.listen(view.element('shortcuts-close'), 'click', () => shortcuts.close())
    this.scope.onDispose(() => shortcuts.close())
    this.scope.listen(view.document, 'keydown', event => {
      const key = event as KeyboardEvent
      if (shortcuts.open) return
      if (key.key === 'Escape' && !view.element('connection-workspace').hidden) this.closeWorkspace()
    }, true)
    ctx.on('client/edit-connection', (request, title) => this.editConnection(request, title))
    this.scope.listen(view.element('host-search'), 'input', () => {
      this.query = this.input('host-search').value.trim().toLocaleLowerCase()
      this.renderHostList()
      this.updateButtons()
    })
    this.scope.listen(view.element('host-save'), 'click', () => {
      void this.save().then(record => {
        if (!this.scope.alive) return
        if (record) { view.status('', 'ok'); this.ctx.clientToasts.notify({ title: '已保存主机', detail: record.label }) }
        else { view.status('保存前请先把主机地址和用户名填上', 'err'); this.input(this.input('host').value.trim() ? 'user' : 'host').focus() }
      }).catch(error => { if (this.scope.alive) view.status(cleanError(error), 'err') })
    })
    this.scope.listen(view.element('host-delete'), 'click', () => { if (this.editingId) void this.remove(this.editingId) })
    this.scope.listen(view.element('auth'), 'change', () => { this.formRevision++; this.clearBrowserKey(); this.syncAuth(); this.updateButtons() })
    for (const id of ['host', 'port', 'user']) this.scope.listen(view.element(id), 'input', () => { this.formRevision++; this.clearBrowserKey(); this.updateButtons() })
    for (const id of ['pass', 'key-pass', 'remember', 'host-label']) {
      this.scope.listen(view.element(id), 'input', () => { this.formRevision++ })
      this.scope.listen(view.element(id), 'change', () => { this.formRevision++ })
    }
    this.scope.listen(view.element('key-pick'), 'click', () => this.pickKey())
    this.scope.listen(view.element('private-key-file'), 'change', () => this.readKey())
    this.scope.listen(view.element('host-keychain'), 'change', () => {
      this.formRevision++
      this.browserKey.clear()
      this.input('key-path').value = this.input('key-pass').value = ''
      this.syncAuth()
    })
    ctx.on('client/keychain-change', () => this.syncKeys())
    ctx.on('client/transport-lost', () => {
      if (this.capabilities?.credentialPersistence !== 'session') return
      this.formRevision++
      this.listRevision++
      this.clearBrowserKey()
      this.input('pass').value = ''
      this.hosts = this.hosts.map(({ keyId: _key, ...host }) => host)
      this.syncKeys('')
      this.renderHostList()
    })
    ctx.on('client/connection-change', () => this.updateButtons())
    this.clearForm()
    this.updateButtons()
    this.ready = this.initialize()
    void this.ready.catch(() => {})
  }

  get count(): number { return this.hosts.length }
  get records(): readonly HostRecord[] { return this.hosts }
  private input<T extends HTMLElement = HTMLInputElement>(id: string): T { return this.ctx.clientView.element<T>(id) }
  private auth(): AuthMethod { return this.input('auth').value === 'privateKey' ? 'privateKey' : 'password' }

  private async initialize(): Promise<void> {
    // 列表在飞的时候占住行高，而不是先空一下再长出来。
    this.renderSkeleton()
    this.capabilities = await this.ctx.clientTransport.capabilities
    if (!this.scope.alive) return
    this.input('remember').checked = this.capabilities.credentialPersistence === 'encrypted'
    this.ctx.clientView.element('credential-hint').hidden = this.capabilities.credentialPersistence !== 'session'
    // 能力关着不是失败：这台机器上「密码留空也能连」这件事不成立，得常驻说一句，
    // 而不是等用户每次保存都撞上一次。
    const degraded = this.input('hosts-degraded')
    degraded.hidden = this.capabilities.credentialPersistence === 'encrypted'
    degraded.textContent = this.capabilities.credentialPersistence === 'session'
      ? '本机 Web 不保存凭据：主机列表会留下，密码与私钥口令只在这个页面里有效。'
      : '这台机器上的凭据存储不可用，主机可以连，但每次都要重填凭据。'
    this.syncAuth()
    await this.ctx.clientKeychain.ready
    if (!this.scope.alive) return
    this.syncKeys()
    await this.refresh()
  }

  private syncKeys(selected = this.input('host-keychain').value): void {
    const select = this.input<HTMLSelectElement>('host-keychain')
    select.replaceChildren()
    const option = (value: string, label: string): void => {
      const element = this.ctx.clientView.document.createElement('option')
      element.value = value; element.textContent = label; select.append(element)
    }
    option('', '使用本地私钥文件…')
    for (const key of this.ctx.clientKeychain.records) option(key.id, `${key.label} · ${key.type}`)
    if (selected && !this.ctx.clientKeychain.records.some(key => key.id === selected)) option(selected, '密钥不可用，请重新选择')
    select.value = selected
    this.syncAuth()
  }

  private savedSecret(): boolean {
    if (this.capabilities?.credentialPersistence !== 'encrypted') return false
    const record = this.hosts.find(host => host.id === this.editingId)
    return !!record?.hasSecret && record.authMethod === this.auth()
  }

  private syncAuth(): void {
    const method = this.auth()
    const view = this.ctx.clientView
    view.element('cred-password').hidden = method !== 'password'
    view.element('cred-key').hidden = method !== 'privateKey'
    const keychain = method === 'privateKey' && !!this.input('host-keychain').value
    view.element('host-direct-key').hidden = keychain
    view.element('host-keychain-hint').hidden = !keychain
    view.element('remember-label').parentElement!.hidden = keychain
    view.element('remember-label').textContent = this.capabilities?.credentialPersistence === 'session' ? '仅当前页面' : method === 'privateKey' ? '记住口令' : '记住密码'
    const saved = this.savedSecret()
    this.input('pass').placeholder = saved ? '使用已保存的密码' : ''
    this.input('key-pass').placeholder = saved ? '使用已保存的口令' : ''
  }

  private updateButtons(): void {
    if (!this.scope.alive) return
    this.input('connect').disabled = !this.capabilities || this.pendingForms.has(this.formRevision)
    this.input('host-save').disabled = !this.capabilities
    this.input('key-pick').disabled = !this.capabilities
    this.input('remember').disabled = this.capabilities?.credentialPersistence !== 'encrypted'
    this.input('host-delete').disabled = !this.editingId
  }

  private openWorkspace(): void {
    this.ctx.clientTerminal.select(null)
    const view = this.ctx.clientView
    view.element('app').classList.add('inspector-open')
    view.element('connection-workspace').hidden = false
    view.element('status').hidden = false
  }

  private closeWorkspace(): void {
    const view = this.ctx.clientView
    view.element('app').classList.remove('inspector-open')
    view.element('connection-workspace').hidden = true
  }

  private editConnection(request: TerminalOpenRequest, title: string): void {
    this.startNew()
    this.editingId = request.hostId ?? null
    this.selectedId = request.hostId ?? null
    this.input('host').value = request.host
    this.input('port').value = String(request.port ?? 22)
    this.input('user').value = request.username
    this.input('host-label').value = title
    this.input('auth').value = request.authMethod ?? 'password'
    this.input('pass').value = request.password ?? ''
    this.input('key-pass').value = request.passphrase ?? ''
    this.input('key-path').value = request.privateKeyPath ?? ''
    this.syncKeys(request.keyId ?? '')
    if (request.privateKey && this.capabilities?.privateKeyPicker === 'browser') {
      this.browserKey.commit(this.browserKey.begin(), { name: '当前会话私钥', content: request.privateKey })
      this.input('key-path').value = '当前会话私钥'
    }
    this.syncAuth()
    this.list.select(this.selectedId)
    this.syncMode()
    this.updateButtons()
    this.input('host').focus()
  }

  private visibleHosts(): HostRecord[] {
    if (!this.query) return this.hosts
    return this.hosts.filter(record => `${record.label} ${record.host} ${record.username}:${record.port}`.toLocaleLowerCase().includes(this.query))
  }

  private renderHostList(): void {
    const visible = this.visibleHosts()
    const empty = this.ctx.clientView.element('hosts-empty')
    empty.hidden = visible.length > 0
    empty.innerHTML = this.hosts.length > 0 && visible.length === 0
      ? '没有匹配的主机。<br />换个关键词再试试。'
      : '还没有保存的主机。<br />点击「新建主机」开始建立连接。'
    const count = this.ctx.clientView.element('host-count')
    count.textContent = this.query && visible.length !== this.hosts.length ? `${visible.length} / ${this.hosts.length} hosts` : `${this.hosts.length} hosts`
    this.list.render(visible, this.selectedId, this.ctx.clientKeychain.records)
  }

  private syncMode(): void {
    const record = this.hosts.find(host => host.id === this.editingId)
    const mode = this.ctx.clientView.element('form-mode')
    mode.textContent = record ? `Edit ${record.label}` : 'New Host'
    mode.classList.toggle('editing', !!record)
  }

  /** 骨架行用 .skeleton-row 而不是 .host-row：占位符不该满足真行的断言，
   *  否则行的形状改坏了也测不出来。 */
  private renderSkeleton(count = 5): void {
    const view = this.ctx.clientView
    const list = view.element('host-list')
    list.textContent = ''
    view.element('hosts-empty').hidden = true
    for (let index = 0; index < count; index += 1) {
      const item = view.document.createElement('li')
      item.className = 'skeleton-row'
      item.setAttribute('aria-hidden', 'true')
      const bar = view.document.createElement('span')
      bar.className = `skeleton-bar w${(index % 3) + 1}`
      item.append(bar)
      list.append(item)
    }
  }

  private setListError(title: string, detail: string): void {
    const block = this.ctx.clientView.element('hosts-error')
    block.hidden = false
    block.querySelector<HTMLElement>('.list-error-title')!.textContent = title
    block.querySelector<HTMLElement>('.list-error-detail')!.textContent = detail
  }

  private async refresh(keepId?: string | null, formRevision = this.formRevision): Promise<void> {
    const listRevision = ++this.listRevision
    let hosts: HostRecord[]
    this.ctx.clientView.element('hosts-error').hidden = true
    try {
      hosts = await this.ctx.clientTransport.api.hosts.list()
    } catch (error) {
      // 「后端不可用」和「这一次操作失败了」是两件事：前者要求重连或重启，后者
      // 只要再试一次。混成一句红字，用户两种都无从下手。
      this.setListError('主机列表读不出来，后端可能已经断开。', cleanError(error))
      throw error
    }
    if (!this.scope.alive || listRevision !== this.listRevision) return
    this.hosts = hosts
    // Keychain 的「关联主机」列要这份计数；它不能反过来注入本 feature，
    // 因为本 feature 已经注入了它 —— 事件是唯一不成环的通道。
    const counts: Record<string, number> = {}
    for (const host of hosts) if (host.keyId) counts[host.keyId] = (counts[host.keyId] ?? 0) + 1
    this.ctx.emit('client/host-counts', counts)
    // A list reply may arrive after the user has moved to another form.
    if (formRevision === this.formRevision) {
      if (keepId !== undefined) { this.editingId = keepId; this.selectedId = keepId }
      if (this.editingId && !hosts.some(host => host.id === this.editingId)) this.editingId = null
    }
    if (this.selectedId && !hosts.some(host => host.id === this.selectedId)) this.selectedId = null
    this.renderHostList()
    this.syncMode()
    this.updateButtons()
  }

  private applyHost(record: HostRecord): void {
    if (!this.scope.alive) return
    this.openWorkspace()
    this.formRevision++
    this.browserKey.clear()
    this.editingId = record.id
    this.selectedId = record.id
    this.input('host-label').value = record.label
    this.input('host').value = record.host
    this.input('port').value = String(record.port)
    this.input('user').value = record.username
    this.input('auth').value = record.authMethod
    this.input('key-path').value = this.capabilities?.privateKeyPicker === 'browser' ? '' : record.privateKeyPath ?? ''
    this.syncKeys(record.keyId ?? '')
    this.input('pass').value = this.input('key-pass').value = ''
    this.syncAuth()
    this.list.select(this.selectedId)
    this.syncMode()
    this.updateButtons()
    const hint = this.savedSecret() ? record.authMethod === 'privateKey' ? '，口令留空即使用已保存的' : '，密码留空即使用已保存的' : ''
    this.ctx.clientView.status(`已选择「${record.label}」${hint}`)
  }

  private selectHost(record: HostRecord): void {
    if (!this.scope.alive) return
    this.selectedId = record.id
    this.list.select(this.selectedId)
  }

  private clearForm(): void {
    this.formRevision++
    this.browserKey.clear()
    for (const id of ['host', 'host-label', 'user', 'key-path', 'pass', 'key-pass', 'private-key-file', 'host-keychain']) this.input(id).value = ''
    this.input('port').value = '22'
    this.input('auth').value = 'password'
    this.syncAuth()
  }

  private startNew(): void {
    this.openWorkspace()
    this.editingId = null
    this.selectedId = null
    this.clearForm()
    this.input('remember').checked = this.capabilities?.credentialPersistence === 'encrypted'
    this.list.select(this.selectedId)
    this.syncMode()
    this.updateButtons()
    this.ctx.clientView.status('新建主机：填好地址和用户名后点「保存」')
    this.input('host').focus()
  }

  private credentials() {
    return { authMethod: this.auth(), privateKeyPath: this.input('key-path').value.trim(), password: this.input('pass').value,
      passphrase: this.input('key-pass').value, hostId: this.editingId ?? undefined, keyId: this.input('host-keychain').value || undefined }
  }

  private saveRequest(): HostSaveRequest | null {
    if (!this.scope.alive || !this.capabilities) throw new Error('尚未确认本机后端的凭据能力，暂时无法保存。')
    const host = this.input('host').value.trim()
    const username = this.input('user').value.trim()
    if (!host || !username) return null
    return { id: this.editingId ?? undefined, label: this.input('host-label').value.trim() || undefined, host, username,
      port: Number(this.input('port').value) || 22, authMethod: this.auth(), keyId: this.auth() === 'privateKey' ? this.input('host-keychain').value : '',
      ...savedCredentials(this.capabilities, this.credentials(), this.input('remember').checked) }
  }

  private async save(request = this.saveRequest(), revision = this.formRevision): Promise<HostRecord | null> {
    if (!request) return null
    const record = await this.ctx.clientTransport.api.hosts.save(request)
    if (!this.scope.alive) return null
    await this.refresh(record.id, revision)
    return record
  }

  private async remove(id: string): Promise<void> {
    if (!this.scope.alive) return
    const record = this.hosts.find(host => host.id === id)
    const label = record?.label ?? '这台主机'
    const view = this.ctx.clientView
    if (!view.window.confirm(`删除「${label}」？${record?.hasSecret ? '它保存的凭据也会一并删除。' : ''}`)) return
    try {
      await this.ctx.clientTransport.api.hosts.remove(id)
      if (!this.scope.alive) return
      if (this.editingId === id) { this.editingId = null; this.clearForm() }
      if (this.selectedId === id) this.selectedId = null
      await this.refresh(this.editingId)
      if (this.scope.alive) this.ctx.clientToasts.notify({ title: '已删除主机', detail: label })
    } catch (error) { if (this.scope.alive) view.status(cleanError(error), 'err') }
  }

  private async connect(): Promise<void> {
    if (!this.scope.alive || !this.capabilities) return
    const terminal = this.ctx.clientTerminal
    if (this.pendingForms.has(this.formRevision)) return
    const host = this.input('host').value.trim()
    const username = this.input('user').value.trim()
    const method = this.auth()
    const missing = !host ? ['请填写主机地址', 'host'] : !username ? ['请填写用户名', 'user']
      : method === 'privateKey' && !this.input('host-keychain').value && (this.capabilities.privateKeyPicker === 'browser' ? !this.browserKey.value : !this.input('key-path').value.trim())
        ? ['请先选择私钥文件', 'key-pick'] : method === 'password' && !this.input('pass').value && !this.savedSecret() ? ['请填写密码', 'pass'] : undefined
    if (missing) { this.ctx.clientView.status(missing[0]!, 'err'); this.input(missing[1]!).focus(); return }
    const revision = this.formRevision
    const credentialFilled = !!this.input(method === 'privateKey' ? 'key-pass' : 'pass').value
    const remember = this.capabilities.credentialPersistence === 'encrypted' && this.input('remember').checked
    const saveRequest = remember && credentialFilled ? this.saveRequest() : null
    this.pendingForms.add(revision)
    const result = await terminal.open({ host, port: Number(this.input('port').value) || 22, username, authMethod: method,
      ...connectionCredentials(this.capabilities, this.credentials(), this.browserKey.value) }, this.input('host-label').value.trim() || host)
    this.pendingForms.delete(revision)
    this.updateButtons()
    if (!result || !this.scope.alive || revision !== this.formRevision || !saveRequest || !this.input('remember').checked) return
    try { await this.save(saveRequest, revision) } catch (error) {
      if (!this.scope.alive) return
      // 两轨都要：内联那行说明「这次没存上」，通知保证离开表单之后仍然看得见。
      this.ctx.clientView.status(`已连接，但保存主机失败：${cleanError(error)}`, 'err')
      this.ctx.clientToasts.notify({ title: '已连接，但保存失败', detail: cleanError(error), kind: 'err' })
    }
  }

  private clearBrowserKey(): void {
    this.browserKey.clear()
    if (this.capabilities?.privateKeyPicker === 'browser') for (const id of ['key-path', 'key-pass', 'private-key-file']) this.input(id).value = ''
  }

  private pickKey(): void {
    if (!this.scope.alive || !this.capabilities) return
    const revision = this.browserKey.prepare()
    if (this.capabilities.privateKeyPicker === 'browser') {
      this.pickerRevision = revision
      this.input('private-key-file').value = ''
      this.input('private-key-file').click()
      return
    }
    const view = this.ctx.clientView
    void this.ctx.clientTransport.api.pickPrivateKey().then(picked => {
      if (!this.scope.alive || !picked || !this.browserKey.isCurrent(revision)) return
      this.formRevision++
      this.input('key-path').value = picked.path
      if (picked.error) { view.status(picked.error, 'err'); return }
      if (picked.encrypted) { this.input('key-pass').focus(); view.status('这把私钥有口令保护，请在「私钥口令」里填上。', 'pending') }
      else { this.input('key-pass').value = ''; view.status('已选择私钥（未加密，口令留空即可）。', 'ok') }
    }).catch(error => { if (this.scope.alive) view.status(cleanError(error), 'err') })
  }

  private readKey(): void {
    const input = this.input('private-key-file')
    const file = input.files?.[0]
    input.value = ''
    if (!this.scope.alive || !file || !this.browserKey.isCurrent(this.pickerRevision)) return
    this.formRevision++
    const revision = this.browserKey.begin()
    this.input('key-path').value = this.input('key-pass').value = ''
    const view = this.ctx.clientView
    void readBrowserPrivateKey(file).then(selected => {
      if (!this.scope.alive || !this.browserKey.commit(revision, selected)) return
      this.input('key-path').value = selected.name
      this.input('key-pass').focus()
      view.status('私钥仅在当前页面使用。若有口令请填写，未加密则留空。', 'ok')
    }).catch(error => { if (this.scope.alive && this.browserKey.isCurrent(revision)) view.status(cleanError(error), 'err') })
  }
}

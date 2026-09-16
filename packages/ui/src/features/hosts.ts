import { Service, type Context } from 'cordis'
import type { AuthMethod, HostRecord, HostSaveRequest, RuntimeCapabilities } from '@pureterm/protocol'
import { ClientScope, cleanError } from '../client-runtime.js'
import { createHostList, type HostListView } from '../host-list.js'
import { BrowserPrivateKeySelection, connectionCredentials, savedCredentials, readBrowserPrivateKey } from '../credentials.js'

declare module 'cordis' { interface Context { clientHosts: ClientHosts } }

/** Host metadata, credential form and native/browser key selection belong to one feature scope. */
export class ClientHosts extends Service {
  static inject = ['clientView', 'clientTransport', 'clientTerminal']
  readonly scope: ClientScope
  readonly ready: Promise<void>
  private readonly list: HostListView
  private hosts: HostRecord[] = []
  private editingId: string | null = null
  private capabilities: RuntimeCapabilities | null = null
  private readonly browserKey = new BrowserPrivateKeySelection()
  private pickerRevision = 0
  private formRevision = 0
  private listRevision = 0

  constructor(ctx: Context) {
    super(ctx, 'clientHosts')
    this.scope = new ClientScope(ctx)
    const view = ctx.clientView
    this.list = createHostList(view.element('host-list'), {
      onSelect: record => this.applyHost(record),
      onConnect: record => {
        if (ctx.clientTerminal.sessionId || ctx.clientTerminal.connecting) return
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
    this.scope.listen(view.element('host-save'), 'click', () => {
      void this.save().then(record => {
        if (!this.scope.alive) return
        if (record) view.status(`已保存「${record.label}」`, 'ok')
        else { view.status('保存前请先把主机地址和用户名填上', 'err'); this.input(this.input('host').value.trim() ? 'user' : 'host').focus() }
      }).catch(error => { if (this.scope.alive) view.status(cleanError(error), 'err') })
    })
    this.scope.listen(view.element('host-delete'), 'click', () => { if (this.editingId) void this.remove(this.editingId) })
    this.scope.listen(view.element('auth'), 'change', () => { this.formRevision++; this.clearBrowserKey(); this.syncAuth(); this.updateButtons() })
    for (const id of ['host', 'port', 'user']) this.scope.listen(view.element(id), 'input', () => { this.formRevision++; this.clearBrowserKey() })
    for (const id of ['pass', 'key-pass', 'remember']) {
      this.scope.listen(view.element(id), 'input', () => { this.formRevision++ })
      this.scope.listen(view.element(id), 'change', () => { this.formRevision++ })
    }
    this.scope.listen(view.element('key-pick'), 'click', () => this.pickKey())
    this.scope.listen(view.element('private-key-file'), 'change', () => this.readKey())
    ctx.on('client/connection-change', () => this.updateButtons())
    this.clearForm()
    this.updateButtons()
    this.ready = this.initialize()
    void this.ready.catch(() => {})
  }

  get count(): number { return this.hosts.length }
  private input(id: string): HTMLInputElement { return this.ctx.clientView.element<HTMLInputElement>(id) }
  private auth(): AuthMethod { return this.input('auth').value === 'privateKey' ? 'privateKey' : 'password' }

  private async initialize(): Promise<void> {
    this.capabilities = await this.ctx.clientTransport.capabilities
    if (!this.scope.alive) return
    this.input('remember').checked = this.capabilities.credentialPersistence === 'encrypted'
    this.ctx.clientView.element('credential-hint').hidden = this.capabilities.credentialPersistence !== 'session'
    this.syncAuth()
    await this.refresh()
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
    view.element('remember-label').textContent = this.capabilities?.credentialPersistence === 'session' ? '仅当前页面' : method === 'privateKey' ? '记住口令' : '记住密码'
    const saved = this.savedSecret()
    this.input('pass').placeholder = saved ? '使用已保存的密码' : ''
    this.input('key-pass').placeholder = saved ? '使用已保存的口令' : ''
  }

  private updateButtons(): void {
    if (!this.scope.alive) return
    const terminal = this.ctx.clientTerminal
    this.input('connect').disabled = !this.capabilities || terminal.connecting || !!terminal.sessionId
    this.input('host-save').disabled = !this.capabilities || terminal.connecting
    this.input('key-pick').disabled = !this.capabilities || terminal.connecting
    this.input('remember').disabled = this.capabilities?.credentialPersistence !== 'encrypted'
    this.input('disconnect').disabled = !terminal.sessionId
    this.input('host-delete').disabled = !this.editingId
  }

  private syncMode(): void {
    const record = this.hosts.find(host => host.id === this.editingId)
    const mode = this.ctx.clientView.element('form-mode')
    mode.textContent = record ? `编辑「${record.label}」` : '新建主机'
    mode.classList.toggle('editing', !!record)
  }

  private async refresh(keepId?: string | null, formRevision = this.formRevision): Promise<void> {
    const listRevision = ++this.listRevision
    const hosts = await this.ctx.clientTransport.api.hosts.list()
    if (!this.scope.alive || listRevision !== this.listRevision) return
    this.hosts = hosts
    // A list reply may arrive after the user has moved to another form.
    if (formRevision === this.formRevision) {
      if (keepId !== undefined) this.editingId = keepId
      if (this.editingId && !hosts.some(host => host.id === this.editingId)) this.editingId = null
    }
    this.ctx.clientView.element('hosts-empty').hidden = hosts.length > 0
    this.list.render(hosts, this.editingId)
    this.syncMode()
    this.updateButtons()
  }

  private applyHost(record: HostRecord): void {
    if (!this.scope.alive) return
    this.formRevision++
    this.browserKey.clear()
    this.editingId = record.id
    this.input('host').value = record.host
    this.input('port').value = String(record.port)
    this.input('user').value = record.username
    this.input('auth').value = record.authMethod
    this.input('key-path').value = this.capabilities?.privateKeyPicker === 'browser' ? '' : record.privateKeyPath ?? ''
    this.input('pass').value = this.input('key-pass').value = ''
    this.syncAuth()
    this.list.select(this.editingId)
    this.syncMode()
    this.updateButtons()
    const hint = this.savedSecret() ? record.authMethod === 'privateKey' ? '，口令留空即使用已保存的' : '，密码留空即使用已保存的' : ''
    this.ctx.clientView.status(`已选择「${record.label}」${hint}`)
  }

  private clearForm(): void {
    this.formRevision++
    this.browserKey.clear()
    for (const id of ['host', 'user', 'key-path', 'pass', 'key-pass', 'private-key-file']) this.input(id).value = ''
    this.input('port').value = '22'
    this.input('auth').value = 'password'
    this.syncAuth()
  }

  private startNew(): void {
    this.editingId = null
    this.clearForm()
    this.input('remember').checked = this.capabilities?.credentialPersistence === 'encrypted'
    this.list.select(null)
    this.syncMode()
    this.updateButtons()
    this.ctx.clientView.status('新建主机：填好地址和用户名后点「保存」')
    this.input('host').focus()
  }

  private credentials() {
    return { authMethod: this.auth(), privateKeyPath: this.input('key-path').value.trim(), password: this.input('pass').value,
      passphrase: this.input('key-pass').value, hostId: this.editingId ?? undefined }
  }

  private saveRequest(): HostSaveRequest | null {
    if (!this.scope.alive || !this.capabilities) throw new Error('尚未确认本机后端的凭据能力，暂时无法保存。')
    const host = this.input('host').value.trim()
    const username = this.input('user').value.trim()
    if (!host || !username) return null
    return { id: this.editingId ?? undefined, host, username,
      port: Number(this.input('port').value) || 22, authMethod: this.auth(),
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
      await this.refresh(this.editingId)
      if (this.scope.alive) view.status(`已删除「${label}」`)
    } catch (error) { if (this.scope.alive) view.status(cleanError(error), 'err') }
  }

  private async connect(): Promise<void> {
    if (!this.scope.alive || !this.capabilities) return
    const terminal = this.ctx.clientTerminal
    if (terminal.sessionId || terminal.connecting) return
    const host = this.input('host').value.trim()
    const username = this.input('user').value.trim()
    const method = this.auth()
    const missing = !host ? ['请填写主机地址', 'host'] : !username ? ['请填写用户名', 'user']
      : method === 'privateKey' && (this.capabilities.privateKeyPicker === 'browser' ? !this.browserKey.value : !this.input('key-path').value.trim())
        ? ['请先选择私钥文件', 'key-pick'] : method === 'password' && !this.input('pass').value && !this.savedSecret() ? ['请填写密码', 'pass'] : undefined
    if (missing) { this.ctx.clientView.status(missing[0]!, 'err'); this.input(missing[1]!).focus(); return }
    const revision = this.formRevision
    const credentialFilled = !!this.input(method === 'privateKey' ? 'key-pass' : 'pass').value
    const remember = this.capabilities.credentialPersistence === 'encrypted' && this.input('remember').checked
    const saveRequest = remember && credentialFilled ? this.saveRequest() : null
    const result = await terminal.open({ host, port: Number(this.input('port').value) || 22, username, authMethod: method,
      ...connectionCredentials(this.capabilities, this.credentials(), this.browserKey.value) })
    if (!result || !this.scope.alive || revision !== this.formRevision || !saveRequest || !this.input('remember').checked) return
    try { await this.save(saveRequest, revision) } catch (error) { if (this.scope.alive) this.ctx.clientView.status(`已连接，但保存主机失败：${cleanError(error)}`, 'err') }
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

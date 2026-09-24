import { createClient } from '../src/client.js'
import { mountPageClient } from '../src/page-client.js'
import { ClientTransport } from '../src/services/transport.js'
import { VERSION } from '../src/lib/version.js'
import type { SshApi, HostRecord, HostSaveRequest, KeyRecord, KeySaveRequest, RendererReadyPayload, SftpDir, TerminalOpenResult, TerminalOpenRequest } from '@pureterm/protocol'
import type { TerminalView } from '../src/terminal-view.js'

const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement
const click = (id: string): void => input(id).click()
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

function fixture() {
  const listeners = { opened: new Set<(...args: any[]) => void>(), data: new Set<(...args: any[]) => void>(), closed: new Set<(...args: any[]) => void>(), disconnected: new Set<(...args: any[]) => void>() }
  const stats = { disposed: 0, opens: 0, inputs: 0, closes: 0, lists: 0, ready: [] as RendererReadyPayload[] }
  const subscribe = (name: keyof typeof listeners, listener: (...args: any[]) => void) => { listeners[name].add(listener); return () => { listeners[name].delete(listener) } }
  const emit = (name: keyof typeof listeners, ...args: unknown[]) => { for (const listener of listeners[name]) listener(...args) }
  const hosts: HostRecord[] = [{ id: 'fixture', label: 'Fixture', host: 'localhost', username: 'demo', port: 22, authMethod: 'password', hasSecret: false, updatedAt: '' }]
  const keys: KeyRecord[] = []
  const api: SshApi = {
    carrier: 'web', getCapabilities: async () => ({ credentialPersistence: 'session', privateKeyPicker: 'browser' }),
    open: async () => { const sessionId = `test-${++stats.opens}`; emit('opened', sessionId, 80, 24); return { sessionId, host: 'localhost', cols: 80, rows: 24 } },
    close: id => { stats.closes++; emit('closed', id, 'closed') },
    input: () => { stats.inputs++ }, resize: () => {}, pickPrivateKey: async () => undefined,
    onOpened: listener => subscribe('opened', listener), onData: listener => subscribe('data', listener), onClosed: listener => subscribe('closed', listener),
    onDisconnected: listener => subscribe('disconnected', listener),
    hosts: { list: async () => hosts, save: async () => hosts[0]!, remove: async () => true },
    keychain: { list: async () => [...keys], save: async request => {
      const record = { id: request.id ?? `key-${keys.length}`, label: request.label, type: 'RSA', publicKey: 'ssh-rsa fixture', fingerprint: 'SHA256:fixture', hasPassphrase: !!request.passphrase, updatedAt: '' }
      const index = keys.findIndex(key => key.id === record.id)
      if (index < 0) keys.push(record); else keys[index] = record
      return record
    }, remove: async id => { const index = keys.findIndex(key => key.id === id); if (index >= 0) keys.splice(index, 1); return index >= 0 } },
    sftp: { list: async () => { stats.lists++; return { path: '/home', parent: '/', entries: [] } }, read: async () => ({ path: '', size: 0, bytes: new Uint8Array() }),
      write: async () => ({ path: '', size: 0 }), mkdir: async () => {}, remove: async () => {} },
    signalReady: payload => { stats.ready.push(payload) }, dispose: () => { stats.disposed++ },
  }
  const terminals: Array<TerminalView & { disposed: number; inputs: Set<(data: string) => void>; writes: unknown[]; resizeListeners: Set<(size: { cols: number; rows: number }) => void> }> = []
  const terminalFactory = () => {
    const inputs = new Set<(data: string) => void>()
    const resizeListeners = new Set<(size: { cols: number; rows: number }) => void>()
    const device = { cols: 80, rows: 24, disposed: 0, inputs, resizeListeners, writes: [] as unknown[],
      write(data: unknown) { this.writes.push(data) }, focus() {}, fit() {}, text: () => '',
      onData(listener: (data: string) => void) { inputs.add(listener); return { dispose: () => { inputs.delete(listener) } } },
      onResize(listener: (size: { cols: number; rows: number }) => void) { resizeListeners.add(listener); return { dispose: () => { resizeListeners.delete(listener) } } },
      dispose() { this.disposed++ },
    }
    terminals.push(device)
    return device
  }
  return { api, hosts, keys, stats, listeners, terminals, terminalFactory, emit }
}

function fill() { input('host').value = 'localhost'; input('user').value = 'demo'; input('pass').value = 'password' }
function hostAction(id: string, action = '.host-main') { document.querySelector<HTMLButtonElement>(`.host-row[data-id="${id}"] ${action}`)!.click() }
function editHost(id: string) { hostAction(id, '[data-act="edit"]') }
function change(id: string, value: string) { input(id).value = value; input(id).dispatchEvent(new Event('input', { bubbles: true })) }

async function runChecks() {
  const observed = new Set<ResizeObserver>()
  const NativeObserver = window.ResizeObserver
  const nativeConfirm = window.confirm
  window.ResizeObserver = class extends NativeObserver {
    override observe(target: Element, options?: ResizeObserverOptions) { observed.add(this); super.observe(target, options) }
    override disconnect() { observed.delete(this); super.disconnect() }
  }
  let client: ReturnType<typeof createClient> | undefined
  let page: ReturnType<typeof mountPageClient> | undefined
  let releasePageDisposal: (() => void) | undefined
  const checks: string[] = []
  try {
    const vault = fixture()
    const savedKeys: KeySaveRequest[] = []
    const saveKey = vault.api.keychain.save
    vault.api.keychain.save = async request => { savedKeys.push(request); return saveKey(request) }
    client = createClient({ api: vault.api, terminalFactory: vault.terminalFactory })
    assert((await client.ready).ok, 'keychain client failed readiness')
    click('nav-keychain'); await tick()
    assert(!input('keychain-panel').hidden && input('hosts-panel').hidden, 'Keychain must be a separate library page')
    click('keychain-new')
    change('keychain-label', 'test.pem'); change('keychain-private', 'fixture-private-key'); change('keychain-passphrase', 'fixture-passphrase')
    click('keychain-save'); await tick(); await tick()
    assert(vault.keys.length === 1 && savedKeys[0]?.privateKey === 'fixture-private-key', 'save must pass private material to the backend')
    assert(input('keychain-private').value === '' && input('keychain-passphrase').value === '', 'save must clear write-only material from the editor')
    click('keychain-close')
    const keyCard = document.querySelector<HTMLButtonElement>('.keychain-card-main')!
    keyCard.focus(); keyCard.click()
    assert(input('keychain-editor').hidden, 'single click must select a key without opening its editor')
    assert(document.activeElement === keyCard, 'selecting a key must retain keyboard focus')
    document.querySelector<HTMLButtonElement>('.keychain-card-edit')!.click()
    assert(!input('keychain-editor').hidden && input('keychain-label').value === 'test.pem', 'Edit must open the selected key')
    change('keychain-label', 'renamed.pem'); click('keychain-save'); await tick(); await tick()
    assert(savedKeys[1]?.id === vault.keys[0]!.id && savedKeys[1]?.privateKey === undefined, 'rename must retain the server-side private key')
    click('keychain-close'); change('keychain-search', 'no-match')
    assert(document.querySelectorAll('.keychain-card').length === 0 && !input('keychain-empty').hidden, 'key search must filter real records')
    change('keychain-search', ''); click('keychain-view')
    assert(input('keychain-list').classList.contains('card-view'), 'key list toggle must update layout')
    click('keychain-view'); click('nav-hosts'); click('host-new'); fill()
    input('auth').value = 'privateKey'; input('auth').dispatchEvent(new Event('change'))
    input('host-keychain').value = vault.keys[0]!.id; input('host-keychain').dispatchEvent(new Event('change'))
    let keyConnection: TerminalOpenRequest | undefined
    const open = vault.api.open
    vault.api.open = async request => { keyConnection = request; return open(request) }
    click('connect'); await tick()
    assert(keyConnection?.keyId === vault.keys[0]!.id && !keyConnection.privateKey && !keyConnection.passphrase, 'connection must use only the selected key ID')
    assert(document.querySelectorAll('.session-tab').length === 1 && input('keychain-panel').hidden, 'key authentication must still open an independent terminal tab')
    click('nav-keychain'); await tick()
    assert(vault.stats.closes === 0, 'visiting Keychain must not close the SSH session')
    document.querySelector<HTMLButtonElement>('.keychain-card-edit')!.click()
    window.confirm = () => true
    click('keychain-delete'); await tick(); await tick()
    assert(vault.keys.length === 0 && input('keychain-editor').hidden, 'delete must update the list and close its editor')
    window.confirm = nativeConfirm
    await client.dispose()
    checks.push('Keychain create, safe rename, explicit Edit, search, list view, delete, and host-key tab connection')

    const importing = fixture()
    client = createClient({ api: importing.api, terminalFactory: importing.terminalFactory })
    assert((await client.ready).ok, 'key import client failed readiness')
    click('nav-keychain'); click('keychain-new')
    const files = new DataTransfer()
    files.items.add(new File(['fixture-content'], 'dropped.pem'))
    input('keychain-drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files }))
    await tick()
    assert(input('keychain-private').value === 'fixture-content' && input('keychain-label').value === 'dropped.pem', 'drop must read file content and infer its label')
    importing.api.keychain.save = async () => { throw new Error('invalid private key') }
    click('keychain-save'); await tick()
    assert(input('keychain-status').textContent?.includes('invalid private key') && input('keychain-private').value === 'fixture-content', 'validation failure must remain actionable without losing input')
    let oversizedCalls = 0
    importing.api.keychain.save = async () => { oversizedCalls++; throw new Error('must not reach transport') }
    change('keychain-private', 'x'.repeat(256 * 1024 + 1)); click('keychain-save'); await tick()
    assert(oversizedCalls === 0 && input('keychain-status').textContent?.includes('256 KiB'), 'oversized pasted keys must be rejected before transport to avoid losing active sockets')
    await client.dispose()
    assert(input('keychain-private').value === '', 'disposal must clear an unsaved imported private key')
    checks.push('Keychain drop import, server validation errors, and private-material disposal')

    const keyRace = fixture()
    client = createClient({ api: keyRace.api, terminalFactory: keyRace.terminalFactory })
    assert((await client.ready).ok, 'key save race failed readiness')
    click('nav-keychain'); await tick(); click('keychain-new')
    change('keychain-label', 'first'); change('keychain-private', 'fixture')
    const oldKeyList = deferred<KeyRecord[]>()
    keyRace.api.keychain.list = () => oldKeyList.promise
    click('keychain-save'); await tick()
    const newKeySave = deferred<KeyRecord>()
    keyRace.api.keychain.save = () => newKeySave.promise
    change('keychain-label', 'second'); click('keychain-save'); await tick()
    oldKeyList.resolve([...keyRace.keys]); await tick()
    assert(input('keychain-save').disabled && input('keychain-new').disabled, 'old refresh completion must not unlock a newer save')
    const newKeyRecord = { ...keyRace.keys[0]!, label: 'second', fingerprint: 'SHA256:second' }
    keyRace.api.keychain.list = async () => [newKeyRecord]
    newKeySave.resolve(newKeyRecord); await tick(); await tick()
    assert(input('keychain-label').value === 'second' && input('keychain-fingerprint').textContent === 'SHA256:second', 'the new save must keep its own editor response')
    await client.dispose()
    checks.push('Keychain refresh completion cannot unlock a newer operation or lose its response')

    const lostKeys = fixture()
    lostKeys.keys.push({ id: 'temporary-key', label: 'temporary', type: 'RSA', publicKey: 'ssh-rsa fixture', fingerprint: 'SHA256:fixture', hasPassphrase: false, updatedAt: '' })
    lostKeys.hosts[0] = { ...lostKeys.hosts[0]!, authMethod: 'privateKey', keyId: 'temporary-key' }
    client = createClient({ api: lostKeys.api, terminalFactory: lostKeys.terminalFactory })
    assert((await client.ready).ok, 'disconnect keychain client failed readiness')
    editHost('fixture')
    assert(input('host-keychain').value === 'temporary-key', 'fixture must select a session key')
    click('nav-keychain'); await tick(); click('keychain-new')
    change('keychain-label', 'draft'); change('keychain-private', 'unsaved-private-material'); change('keychain-passphrase', 'unsaved-passphrase')
    lostKeys.emit('disconnected', 'fixture transport loss')
    assert(input('keychain-private').value === '' && input('keychain-passphrase').value === '', 'socket loss without page disposal must clear session key drafts')
    assert(document.querySelectorAll('.keychain-card').length === 0 && input('host-keychain').value === '', 'socket loss must clear cached keys and the current host selection')
    click('nav-hosts'); editHost('fixture')
    assert(input('host-keychain').value === '', 'editing a cached host after socket loss must not revive its key association')
    await client.dispose()
    checks.push('Web transport loss clears key drafts, cached cards and host associations without page reload')

    const soleEntry = fixture()
    client = createClient({ api: soleEntry.api, terminalFactory: soleEntry.terminalFactory })
    assert((await client.ready).ok, 'single-entry client failed readiness')
    assert(document.getElementById('host-new'), 'New Host must remain available as the only host-creation entry')
    for (const id of ['tab-new', 'terminal-new', 'nav-new', 'quick-connect']) {
      assert(!document.getElementById(id), `${id} must not duplicate the New Host creation flow`)
    }
    click('host-new')
    assert(!input('connection-workspace').hidden, 'New Host must still open a blank host form')
    click('connection-close')
    await client.dispose()
    checks.push('New Host is the only visible entry for creating a host')

    const gestures = fixture()
    gestures.hosts[0]!.hasSecret = true
    gestures.api.getCapabilities = async () => ({ credentialPersistence: 'encrypted', privateKeyPicker: 'native' })
    client = createClient({ api: gestures.api, terminalFactory: gestures.terminalFactory })
    assert((await client.ready).ok, 'host-gesture client failed readiness')
    const host = document.querySelector<HTMLButtonElement>('.host-main')!
    host.click()
    assert(input('connection-workspace').hidden, 'single-clicking a host must only select its card, not open the editor')
    assert(document.querySelector('.host-row')?.classList.contains('active'), 'single-clicking a host must visibly select its card')
    assert(gestures.stats.opens === 0, 'single-clicking a host must not open an SSH session')
    editHost('fixture')
    assert(!input('connection-workspace').hidden && input('host').value === 'localhost', 'the explicit Edit action must open the matching host editor')
    click('connection-close')
    const sameHost = document.querySelector<HTMLButtonElement>('.host-main')!
    sameHost.click()
    sameHost.click()
    sameHost.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await tick()
    assert(gestures.stats.opens === 1 && document.querySelectorAll('[role="tab"]').length === 2,
      'double-clicking a host must open a new terminal tab')
    const sized = gestures.terminals.at(-1)!
    // xterm updates its own cols/rows and *then* emits, and the status bar reads
    // the live getter rather than the payload, so the fixture has to do the same.
    sized.cols = 132
    sized.rows = 41
    for (const listener of sized.resizeListeners) listener({ cols: 132, rows: 41 })
    await tick()
    assert(input('status-size').textContent === '132×41', 'the status bar must follow the active terminal size')
    await client.dispose()
    checks.push('single-click selects, Edit opens the editor, and double-click connects in a new tab')

    const chrome = fixture()
    client = createClient({ api: chrome.api, terminalFactory: chrome.terminalFactory })
    assert((await client.ready).ok, 'chrome client failed readiness')
    const shell = document.documentElement
    assert(!shell.hasAttribute('data-theme'), 'a first run must carry no stored theme')
    assert(input('status-version').textContent === `v${VERSION}`, 'the status bar must render the generated version')
    assert(input('status-size').textContent === '—', 'no session means no terminal size to claim')
    click('theme-toggle')
    assert(shell.dataset.theme === 'light', 'the theme switch must write data-theme on <html>')
    assert(document.getElementById('theme-toggle')!.getAttribute('aria-pressed') === 'true',
      'the switch must report its own state')
    click('density-toggle')
    assert(shell.dataset.density === 'compact', 'the density switch must write data-density')
    const remembered = JSON.parse(window.localStorage.getItem('pureterm.chrome') ?? '{}')
    assert(remembered.theme === 'light' && remembered.density === 'compact',
      'both choices must persist under one key, so a partial write cannot desynchronise them')
    await client.dispose()
    client = createClient({ api: chrome.api, terminalFactory: chrome.terminalFactory })
    assert((await client.ready).ok, 'restored chrome client failed readiness')
    assert(shell.dataset.theme === 'light' && shell.dataset.density === 'compact',
      'a remount must restore both choices from storage')
    window.localStorage.removeItem('pureterm.chrome')
    delete shell.dataset.theme
    delete shell.dataset.density
    await client.dispose()
    checks.push('the status bar renders real fields, and both chrome switches persist across a remount')

    const multiple = fixture()
    client = createClient({ api: multiple.api, terminalFactory: multiple.terminalFactory })
    assert((await client.ready).ok, 'tab client failed readiness')
    click('host-view-toggle')
    assert(input('host-list').classList.contains('card-view') && input('host-view-toggle').getAttribute('aria-pressed') === 'true', 'the toggle must move the hosts list to card view and report it')
    click('host-view-toggle')
    assert(!input('host-list').classList.contains('card-view') && input('host-view-toggle').getAttribute('aria-pressed') === 'false', 'and return the list to the table')
    // The table is the whole point of the screen, so its shape is asserted rather
    // than eyeballed: six grid children per row, and the 认证 column in the same
    // language as the header it sits under. Only the DOM is checked here — this
    // harness strips the stylesheet, so the card view's display rules live in
    // visual-contract.test.mjs instead.
    const columns = document.querySelector('.host-row')!
    assert(columns.children.length === 6, `a host row is the header's six tracks, not ${columns.children.length}`)
    assert(columns.querySelector('.host-cell.auth')!.textContent === '密码', 'the auth column must name the method in the UI language')
    assert(columns.querySelector('.host-cell.when')!.textContent === '从未', 'a host that was never updated must say so rather than print an empty date')
    click('shortcuts-open')
    assert((input('shortcuts-dialog') as unknown as HTMLDialogElement).open, 'shortcuts action must open its help dialog')
    click('shortcuts-close')
    assert(!(input('shortcuts-dialog') as unknown as HTMLDialogElement).open, 'shortcuts dialog must close')
    fill(); click('connect'); await tick()
    assert(document.querySelectorAll('[role="tab"]').length === 2, 'connecting a host must create a separate tab next to Hosts')
    click('hosts-tab'); click('host-new'); fill(); input('host').value = 'second.example'; click('connect'); await tick()
    assert(multiple.stats.opens === 2 && document.querySelectorAll('[role="tab"]').length === 3, 'second host must open independently')
    multiple.emit('data', 'test-1', new Uint8Array([65]))
    multiple.emit('data', 'test-2', new Uint8Array([66]))
    assert(multiple.terminals[0]!.writes.some(value => value instanceof Uint8Array && value[0] === 65), 'background tab lost its output')
    assert(!multiple.terminals[0]!.writes.some(value => value instanceof Uint8Array && value[0] === 66), 'second session wrote to first terminal')
    assert(multiple.terminals[1]!.writes.some(value => value instanceof Uint8Array && value[0] === 66), 'second tab lost its output')
    const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('.session-tab [role="tab"]')]
    const fileRequests: string[] = []
    const pendingDirectory = deferred<SftpDir>()
    multiple.api.sftp.list = async (id, path) => {
      fileRequests.push(id + ':' + path)
      if (id === 'test-1') return pendingDirectory.promise
      return { path: '/second', parent: '/', entries: [] }
    }
    tabButtons[0]!.click(); click('sftp-toggle'); await tick()
    tabButtons[1]!.click(); click('sftp-toggle'); await tick()
    // 一个文件带权限位、一个目录不带：模式列要在两种情况下都说得对。
    pendingDirectory.resolve({ path: '/first', parent: '/', entries: [
      { name: 'deploy.sh', path: '/first/deploy.sh', isDirectory: false, isSymlink: false, size: 1842, mtime: 1_758_300_000, mode: 0o755 },
      { name: 'logs', path: '/first/logs', isDirectory: true, isSymlink: false, size: 4096, mtime: 1_758_300_000, mode: 0 },
    ] } as SftpDir); await tick()
    assert(input('sftp-path').value === '/second', 'background directory result leaked into another tab')
    tabButtons[0]!.click()
    assert(!input('sftp').hidden && input('sftp-path').value === '/first', 'switching tabs must restore each file panel directory')
    // 分栏把手：可聚焦的分隔条，键盘走得动，而且比例是各个会话自己的。
    // 断言不钉在列上 —— 测试窗口可能落在 820 以下，那时它按行分栏。
    const grip = document.querySelector<HTMLElement>('.session-grip')!
    assert(!!grip, 'an open file table must come with a grip')
    assert(grip.getAttribute('role') === 'separator' && grip.getAttribute('aria-orientation') === 'vertical', 'the grip must announce itself as a separator')
    assert(grip.tabIndex === 0, 'a grip nobody can focus is a border')
    const template = () => input('sftp').parentElement!.getAttribute('style') ?? ''
    const firstValue = Number(grip.getAttribute('aria-valuenow'))
    assert(firstValue > 20 && firstValue < 80, `the default ratio must sit inside the clamp, got ${firstValue}`)
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    assert(Number(grip.getAttribute('aria-valuenow')) === firstValue + 2, 'ArrowRight moves the split by two points')
    assert(/--grip-w/.test(template()), 'the moved ratio is written back as a track, not a width')
    for (let step = 0; step < 40; step += 1) grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    assert(Number(grip.getAttribute('aria-valuenow')) === 78, 'the drag stops at the clamp, so no pane can vanish')
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    assert(template() === '' && grip.getAttribute('aria-valuenow') === '57', 'Home returns to the CSS default rather than a JS copy of it')
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }))
    assert(Number(grip.getAttribute('aria-valuenow')) === 47, 'Shift steps are ten points, for a long drag back')
    tabButtons[1]!.click(); await tick()
    assert(Number(document.querySelector<HTMLElement>('.session-grip')!.getAttribute('aria-valuenow')) === 57, 'another session must not inherit this one’s ratio')
    tabButtons[0]!.click(); await tick()
    assert(Number(document.querySelector<HTMLElement>('.session-grip')!.getAttribute('aria-valuenow')) === 47, 'and this one must still have its own')
    assert(fileRequests.join(',') === 'test-1:.,test-2:.', 'file panel requests used the wrong SSH session')
    // 文件表是第三张表格：五行列、模式是八进制、对端没给属性时不谎报成 000。
    const fileRows = document.querySelectorAll('.file-row')
    assert(fileRows.length === 2, 'each entry is one row')
    assert(fileRows[0]!.children.length === 5, `a file row is name, size, mode, modified, actions, not ${fileRows[0]!.children.length}`)
    assert(fileRows[0]!.querySelector('.file-mode')!.textContent === '755', 'mode renders as octal digits')
    assert(fileRows[1]!.querySelector('.file-mode')!.textContent === '—', 'a peer that sent no mode must not read as 000')
    assert(fileRows[1]!.querySelector('.file-size')!.textContent === '—', 'a directory size is not a number of bytes')
    // 面包屑：可点的是上一跳，当前目录不是按钮；根上没得跳就把整行让出来。
    const crumbs = document.querySelector<HTMLElement>('.sftp-crumbs')!
    assert(!!crumbs, 'a browsed directory must show where it is')
    const hops = crumbs.querySelectorAll('button')
    assert(hops.length === 1 && hops[0]!.textContent === '/', '/first has exactly one hop, and it is the root')
    assert(crumbs.querySelector('.is-current')!.textContent === 'first', 'the last crumb is where you are, and is not a button')
    hops[0]!.click(); await tick()
    assert(fileRequests.includes('test-1:/'), 'clicking a hop asks for exactly that path, not a guess at one')
    multiple.api.sftp.list = async () => ({ path: '/', parent: null, entries: [] }) as unknown as typeof multiple.api.sftp.list
    click('sftp-refresh'); await tick()
    assert(document.querySelector<HTMLElement>('.sftp-crumbs')!.hidden, 'at the root there is no hop, so the strip gives its row back')
    // 对齐要在真的级联里量：这个 harness 把 <link rel=stylesheet> 剥掉了，
    // 所以这里只断言 DOM 形状，列宽由计划文档任务 3 步骤 7 的实测量负责。
    document.querySelector<HTMLButtonElement>('[data-tab-close]')!.click(); await tick()
    assert(multiple.stats.closes === 1 && multiple.terminals[0]!.disposed === 1 && multiple.terminals[1]!.disposed === 0, 'closing one tab must only release its session')
    click('hosts-tab')
    assert(!input('hosts-panel').hidden && input('session-workspace').hidden, 'Hosts must remain a separate usable page')
    await client.dispose()
    assert(multiple.stats.closes === 2 && multiple.terminals[1]!.disposed === 1, 'client disposal must release every remaining tab')
    checks.push('each connection opens a distinct tab with independent output, navigation and disposal')

    const concurrent = fixture()
    const pendingOpens: Array<{ request: TerminalOpenRequest; result: ReturnType<typeof deferred<TerminalOpenResult>> }> = []
    const released: string[] = []
    concurrent.api.open = request => { const result = deferred<TerminalOpenResult>(); pendingOpens.push({ request, result }); return result.promise }
    concurrent.api.close = id => { released.push(id); concurrent.emit('closed', id, 'closed') }
    client = createClient({ api: concurrent.api, terminalFactory: concurrent.terminalFactory })
    assert((await client.ready).ok, 'concurrent client failed readiness')
    fill(); click('connect'); await tick()
    click('host-new'); fill(); input('host').value = 'second.example'; click('connect'); await tick()
    assert(pendingOpens.length === 2, 'opening one host must not block another handshake')
    concurrent.emit('opened', 'later-request', 80, 24)
    concurrent.emit('data', 'later-request', new Uint8Array([66]))
    pendingOpens[1]!.result.resolve({ sessionId: 'later-request', host: 'second.example', cols: 80, rows: 24 }); await tick()
    concurrent.emit('opened', 'earlier-request', 80, 24)
    concurrent.emit('data', 'earlier-request', new Uint8Array([65]))
    pendingOpens[0]!.result.resolve({ sessionId: 'earlier-request', host: 'localhost', cols: 80, rows: 24 }); await tick()
    assert(concurrent.terminals[0]!.writes.some(value => value instanceof Uint8Array && value[0] === 65), 'early output was not bound by the matching RPC reply')
    assert(concurrent.terminals[1]!.writes.some(value => value instanceof Uint8Array && value[0] === 66), 'out-of-order handshake lost second output')
    assert(client.context.clientTerminal.sessionId === 'later-request', 'background handshake completion stole the active tab')
    click('host-new'); fill(); click('connect'); await tick()
    const cancelledId = client.context.clientTerminal.active!.id
    client.context.clientTerminal.closeTab(cancelledId)
    concurrent.emit('opened', 'cancelled', 80, 24)
    pendingOpens[2]!.result.resolve({ sessionId: 'cancelled', host: 'localhost', cols: 80, rows: 24 }); await tick()
    assert(released.includes('cancelled') && client.context.clientTerminal.tabs.length === 2, 'closing a pending tab left a late SSH connection alive')
    concurrent.emit('closed', 'earlier-request', 'remote ended')
    assert(client.context.clientTerminal.tabs[0]!.state === 'disconnected' && concurrent.terminals[0]!.disposed === 0, 'remote disconnect must retain scrollback until the tab is closed')
    await client.dispose()
    checks.push('concurrent handshakes, early output, cancelled tabs and background disconnects stay isolated')

    const failures = fixture()
    const attempts: TerminalOpenRequest[] = []
    failures.api.open = async request => { attempts.push({ ...request }); throw new Error('fixture connection refused') }
    client = createClient({ api: failures.api, terminalFactory: failures.terminalFactory })
    assert((await client.ready).ok, 'failure client failed readiness')
    fill(); click('connect'); await tick()
    const failedId = client.context.clientTerminal.active!.id
    assert(!input('connection-failure').hidden, 'connection error did not appear in its tab')
    click('host-new'); fill(); input('host').value = 'unrelated.example'
    client.context.clientTerminal.select(failedId); click('failure-retry'); await tick()
    assert(attempts.length === 2 && attempts[1]!.host === 'localhost' && client.context.clientTerminal.tabs.length === 1, 'retry must use the failed tab snapshot and reuse its tab')
    click('failure-edit')
    assert(input('host').value === 'localhost' && !input('connection-workspace').hidden, 'Edit host used an unrelated form')
    await client.dispose()
    checks.push('failed tabs keep their own retry credentials and editing context')

    const first = fixture()
    client = createClient({ api: first.api, terminalFactory: first.terminalFactory })
    const initialReady = await client.ready
    assert(initialReady.ok, `initial client failed readiness: ${JSON.stringify(initialReady)}`)
    assert(first.listeners.opened.size === 1 && first.listeners.data.size === 1 && first.listeners.closed.size === 1, 'terminal subscriptions must be singular')
    assert(client.context.clientHosts && client.context.clientSftp && client.context.clientApplication, 'feature services missing')
    fill(); click('connect'); await tick()
    assert(first.stats.opens === 1, 'connect should dispatch exactly once')
    for (const listener of first.terminals[0]!.inputs) listener('ls\r')
    assert(first.stats.inputs === 1, 'terminal input should dispatch exactly once')
    click('sftp-toggle'); await tick()
    assert(first.stats.lists === 1, 'SFTP scope did not react to the active session')
    const detachedRow = document.querySelector<HTMLButtonElement>('.host-main')!
    const detachedRefresh = input('sftp-refresh')
    const waiting = client.context.clientApplication.scope.delay(30_000)
    const fitting = client.context.clientTerminal.settleLayout()
    await client.dispose()
    assert(await waiting === false && await fitting === false, 'scope timers/animation frames did not cancel promptly')
    assert(first.stats.disposed === 1 && first.terminals[0]!.disposed === 1, 'transport and terminal were not disposed exactly once')
    assert(Object.values(first.listeners).every(set => set.size === 0), 'transport subscriptions leaked')
    assert(first.terminals[0]!.inputs.size === 0 && first.terminals[0]!.resizeListeners.size === 0, 'terminal subscriptions leaked')
    assert(observed.size === 0, 'ResizeObserver leaked')
    detachedRow.click(); detachedRefresh.click()
    input('connect').dispatchEvent(new MouseEvent('click'))
    assert(first.stats.opens === 1 && first.stats.lists === 1, 'disposed DOM listeners still invoked RPC')
    checks.push('root disposal releases DOM, terminal, transport, observers, timers and frames')

    const second = fixture()
    client = createClient({ api: second.api, terminalFactory: second.terminalFactory })
    assert((await client.ready).ok, 'remount failed readiness')
    fill(); click('connect'); await tick()
    assert(second.stats.opens === 1 && first.stats.opens === 1, 'remount duplicated connect handlers')
    first.emit('data', 'test-1', new Uint8Array([97]))
    assert(!second.terminals[0]!.writes.some(value => value instanceof Uint8Array), 'old transport reached the new terminal')
    checks.push('remount receives one handler per action and ignores old transports')

    await client.scopes.transport.dispose()
    await tick()
    assert(second.terminals[0]!.disposed === 1 && observed.size === 0, 'removing transport did not unload dependent terminal')
    assert(document.querySelector('#sftp-refresh') === null && input('connect').disabled, 'dependent feature views remained active')
    const replacement = fixture()
    await client.context.plugin(ClientTransport, { api: replacement.api })
    for (let index = 0; index < 20 && !client.context.clientApplication; index++) await tick()
    assert((await client.context.clientApplication.ready).ok, 'dependent scopes failed to reactivate')
    fill(); click('connect'); await tick()
    assert(replacement.stats.opens === 1, 'replacement transport did not own remounted handlers')
    checks.push('Cordis dependency removal unloads feature scopes and replacement reactivates them')
    await client.dispose()

    const pending = fixture()
    const capability = deferred<{ credentialPersistence: 'session'; privateKeyPicker: 'browser' }>()
    pending.api.getCapabilities = () => capability.promise
    client = createClient({ api: pending.api, terminalFactory: pending.terminalFactory })
    await tick()
    await client.dispose()
    assert(!(await client.ready).ok, 'disposed client remained pending/ready')
    capability.resolve({ credentialPersistence: 'session', privateKeyPicker: 'browser' })
    await tick()
    assert(pending.stats.ready.length === 0, 'late capabilities revived a disposed feature')
    checks.push('disposal while capabilities are pending cannot revive UI or signal ready')

    const late = fixture()
    const listing = deferred<{ path: string; parent: null; entries: [] }>()
    late.api.sftp.list = () => listing.promise
    client = createClient({ api: late.api, terminalFactory: late.terminalFactory })
    assert((await client.ready).ok, 'late-result client failed readiness')
    fill(); click('connect'); await tick(); click('sftp-toggle')
    await client.dispose()
    const next = fixture()
    client = createClient({ api: next.api, terminalFactory: next.terminalFactory })
    assert((await client.ready).ok, 'client after pending SFTP failed readiness')
    listing.resolve({ path: '/stale-result', parent: null, entries: [] })
    await tick()
    assert(input('sftp-path').value === '' && input('sftp').hidden, 'late SFTP result mutated the next mount')
    checks.push('late SFTP results cannot update a later mount')
    await client.dispose()

    for (const nextForm of ['new', 'existing']) {
      const saving = fixture()
      const other = { ...saving.hosts[0]!, id: 'other', label: 'Other', host: 'other.example' }
      saving.hosts.push(other)
      const saved: HostSaveRequest[] = []
      saving.api.hosts.save = async request => { saved.push(request); return { ...saving.hosts[0]!, ...request, id: request.id ?? 'saved-new' } }
      client = createClient({ api: saving.api, terminalFactory: saving.terminalFactory })
      assert((await client.ready).ok, 'save-race client failed readiness')
      editHost('fixture')
      const refresh = deferred<HostRecord[]>()
      saving.api.hosts.list = () => refresh.promise
      click('host-save'); await tick()
      assert(saved.length === 1, 'first host save did not start')
      if (nextForm === 'new') { click('host-new'); fill() } else editHost('other')
      saving.api.hosts.list = async () => saving.hosts
      refresh.resolve(saving.hosts); await tick()
      click('host-save'); await tick()
      assert(saved.length === 2 && saved[1]!.id === (nextForm === 'new' ? undefined : 'other'), `late save refresh reassigned ${nextForm} form to the old host`)
      assert(saved[1]!.host === (nextForm === 'new' ? 'localhost' : other.host), 'late refresh changed visible host fields')
      checks.push(`save refresh preserves the ${nextForm} form selected while its host list is pending`)
      await client.dispose()
    }

    const removing = fixture()
    removing.hosts.push({ ...removing.hosts[0]!, id: 'other', label: 'Other', host: 'other.example' },
      { ...removing.hosts[0]!, id: 'third', label: 'Third', host: 'third.example' })
    const afterDelete: HostSaveRequest[] = []
    removing.api.hosts.save = async request => { afterDelete.push(request); return { ...removing.hosts[0]!, ...request, id: request.id! } }
    client = createClient({ api: removing.api, terminalFactory: removing.terminalFactory })
    assert((await client.ready).ok, 'delete-race client failed readiness')
    editHost('other')
    const removedList = deferred<HostRecord[]>()
    removing.api.hosts.list = () => removedList.promise
    window.confirm = () => true
    hostAction('fixture', '[data-act="delete"]'); await tick()
    editHost('third')
    removing.hosts.shift()
    removing.api.hosts.list = async () => removing.hosts
    removedList.resolve(removing.hosts); await tick()
    click('host-save'); await tick()
    assert(afterDelete[0]?.id === 'third' && afterDelete[0]?.host === 'third.example', 'late delete refresh reassigned the currently edited host')
    checks.push('delete refresh preserves a host selected while its host list is pending')
    window.confirm = nativeConfirm
    await client.dispose()

    for (const changed of ['password', 'passphrase', 'remember', 'snapshot']) {
      const authenticating = fixture()
      authenticating.api.getCapabilities = async () => ({ credentialPersistence: 'encrypted', privateKeyPicker: 'native' })
      authenticating.api.pickPrivateKey = async () => ({ path: '/fixture/key', encrypted: true })
      const opening = deferred<TerminalOpenResult>()
      let authentication: TerminalOpenRequest | undefined
      authenticating.api.open = request => { authentication = request; return opening.promise }
      const automaticSaves: HostSaveRequest[] = []
      authenticating.api.hosts.save = async request => { automaticSaves.push(request); return authenticating.hosts[0]! }
      client = createClient({ api: authenticating.api, terminalFactory: authenticating.terminalFactory })
      assert((await client.ready).ok, 'credential-race client failed readiness')
      fill()
      if (changed === 'passphrase') {
        input('auth').value = 'privateKey'; input('auth').dispatchEvent(new Event('change'))
        click('key-pick'); await tick(); change('key-pass', 'authenticated-passphrase')
      }
      click('connect'); await tick()
      assert(authentication, 'credential-race connection did not start')
      if (changed === 'password') change('pass', 'different-password')
      if (changed === 'passphrase') change('key-pass', 'different-passphrase')
      if (changed === 'remember') { input('remember').checked = false; input('remember').dispatchEvent(new Event('change')) }
      // Even changes without an input event must never substitute credentials after authentication.
      if (changed === 'snapshot') input('pass').value = 'different-password'
      opening.resolve({ sessionId: 'credential-race', host: 'localhost', cols: 80, rows: 24 })
      await tick()
      if (changed === 'snapshot') assert(automaticSaves.length === 1 && automaticSaves[0]!.password === authentication!.password,
        'auto-save reread a password that was not used for authentication')
      else assert(automaticSaves.length === 0, `auto-save ignored a ${changed} change while connecting`)
      checks.push(changed === 'snapshot' ? 'auto-save persists the authenticated credential snapshot' : `changing ${changed} while connecting cancels auto-save`)
      await client.dispose()
    }

    const disposal = deferred<void>()
    releasePageDisposal = () => disposal.resolve()
    const pageFixtures: ReturnType<typeof fixture>[] = []
    page = mountPageClient(() => {
      const device = fixture()
      pageFixtures.push(device)
      const instance = createClient({ api: device.api, terminalFactory: device.terminalFactory })
      return pageFixtures.length === 1 ? { ...instance, dispose: async () => { await disposal.promise; await instance.dispose() } } : instance
    })
    assert((await page.client.ready).ok, 'page entry failed readiness')
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    await tick()
    assert(pageFixtures.length === 1, 'normal pageshow duplicated the initial mount')
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await tick()
    assert(pageFixtures.length === 1, 'restoration mounted before old disposal completed')
    disposal.resolve()
    for (let attempt = 0; attempt < 20 && pageFixtures.length === 1; attempt++) await tick()
    assert(pageFixtures.length === 2 && (await page.client.ready).ok, 'cached page did not remount once after disposal')
    fill(); click('connect'); await tick()
    assert(pageFixtures[0]!.stats.opens === 0 && pageFixtures[1]!.stats.opens === 1, 'restored page did not reconnect through one fresh client')
    await page.dispose()
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await tick()
    assert(pageFixtures.length === 2, 'disposed page entry retained its restore listener')
    checks.push('cached page restoration waits for disposal, remounts once and releases entry listeners')
    return checks
  } finally { releasePageDisposal?.(); await page?.dispose(); await client?.dispose(); window.ResizeObserver = NativeObserver; window.confirm = nativeConfirm }
}

Object.assign(window, { runClientLifecycleChecks: runChecks })

import { createClient } from '../src/client.js'

import { mountPageClient } from '../src/page-client.js'

import { ClientTransport } from '../src/services/transport.js'

import { VERSION } from '../src/lib/version.js'

import type { SshApi, HostRecord, HostSaveRequest, KeyRecord, KeySaveRequest, MonitorSnapshot, MonitorStartRequest, MonitorStartResult, MonitorStopResult, MonitorUpdate, RendererReadyPayload, SessionFacts, SftpDir, TerminalOpenResult, TerminalOpenRequest } from '@pureterm/protocol'

import type { TerminalView } from '../src/terminal-view.js'



const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message) }

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

// Some nodes are built after a stylesheet lands rather than shipped in index.html, so a
// tick is not enough to see them: this waits for the node, and fails loudly rather than
// asserting on a race. `absent` is the mirror image, for the cases where the whole point
// is that nothing appears.
async function waitFor<T>(read: () => T | null | undefined, description: string, timeout = 2000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`等待超时：${description}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement

const click = (id: string): void => input(id).click()

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }



function fixture() {

  const listeners = { opened: new Set<(...args: any[]) => void>(), data: new Set<(...args: any[]) => void>(), closed: new Set<(...args: any[]) => void>(), disconnected: new Set<(...args: any[]) => void>(), updates: new Set<(...args: any[]) => void>(), facts: new Set<(...args: any[]) => void>() }

  const stats = { disposed: 0, opens: 0, inputs: 0, closes: 0, lists: 0, ready: [] as RendererReadyPayload[] }

  const subscribe = (name: keyof typeof listeners, listener: (...args: any[]) => void) => { listeners[name].add(listener); return () => { listeners[name].delete(listener) } }

  const emit = (name: keyof typeof listeners, ...args: unknown[]) => { for (const listener of listeners[name]) listener(...args) }

  /*
   * 监控 fixture。观测面有三样：可控的 start 回复（能挂住、能让它失败）、当前活着的
   * 订阅集合、以及合成的事件源。默认「立刻同意」而且默认折叠，所以现有生命周期检查
   * 一条 start 都不会发出来 —— 这正是折叠默认要保证的事。
   */
  const monitor = {

    starts: [] as MonitorStartRequest[],

    stops: [] as string[],

    /** 当前活着的订阅：收到 start、还没被 stop 的 ID。 */
    active: new Set<string>(),

    /** 挂起未答的 start，按调用顺序。holding 为 true 时 start 不自动回复。 */
    held: [] as Array<{ request: MonitorStartRequest; resolve: () => void; reject: (error: Error) => void }>,

    holding: false,

    /** 非 null 时 start 直接失败，用来造 MONITOR_UNAVAILABLE。 */
    rejection: null as string | null,

    async start(request: MonitorStartRequest): Promise<MonitorStartResult> {
      monitor.starts.push(request)
      if (monitor.rejection) throw new Error(monitor.rejection)
      monitor.active.add(request.subscriptionId)
      if (monitor.holding) await new Promise<void>((resolve, reject) => { monitor.held.push({ request, resolve, reject }) })
      return { subscriptionId: request.subscriptionId, intervalMs: 5000 }
    },

    async stop(subscriptionId: string): Promise<MonitorStopResult> {
      monitor.stops.push(subscriptionId)
      return { stopped: monitor.active.delete(subscriptionId) }
    },

    /** 让所有挂起的 start 回复。 */
    release(): void { for (const entry of monitor.held.splice(0)) entry.resolve() },

    /** 让所有挂起的 start 失败。 */
    fail(message: string): void { for (const entry of monitor.held.splice(0)) entry.reject(new Error(message)) },

    /** 一个订阅被停了几次。停止是幂等的，但重复的请求会让这条断言失去意义。 */
    stopsOf(subscriptionId: string): number { return monitor.stops.filter(stop => stop === subscriptionId).length },

    /** 合成一条 monitor:update。 */
    update(update: MonitorUpdate): void { emit('updates', update) },

    /** 合成一条 session:facts。 */
    facts(facts: SessionFacts): void { emit('facts', facts) },

  }

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

    monitor: {
      start: request => monitor.start(request),
      stop: subscriptionId => monitor.stop(subscriptionId),
      onUpdate: (listener: (update: MonitorUpdate) => void) => subscribe('updates', listener),
      onSessionFacts: (listener: (facts: SessionFacts) => void) => subscribe('facts', listener),
    },

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

  return { api, hosts, keys, stats, listeners, terminals, terminalFactory, emit, monitor }

}



function fill() { input('host').value = 'localhost'; input('user').value = 'demo'; input('pass').value = 'password' }

function hostAction(id: string, action = '.host-main') { document.querySelector<HTMLButtonElement>(`.host-row[data-id="${id}"] ${action}`)!.click() }

function editHost(id: string) { hostAction(id, '[data-act="edit"]') }

function change(id: string, value: string) { input(id).value = value; input(id).dispatchEvent(new Event('input', { bubbles: true })) }

/*
 * 监控条的观测面。全部按 DOM 读，不碰 ClientMonitor 的内部状态：这个 harness 剥掉了
 * 样式表，所以「面板说了什么、画了什么」才是能在这里证明的东西。
 */
const monitorRoot = (): HTMLElement => document.getElementById('session-monitor')!
const monitorStatus = (): string | undefined => monitorRoot().dataset.status
const monitorText = (id: string): string => document.getElementById(id)!.textContent ?? ''
const monitorField = (metric: string): HTMLElement => document.querySelector<HTMLElement>(`#session-monitor .monitor-field[data-metric="${metric}"]`)!
const monitorValue = (metric: string): string => monitorField(metric).querySelector('.monitor-value')!.textContent ?? ''
const monitorIssue = (metric: string): string | undefined => monitorField(metric).dataset.issue

/** 一张六个指标都在的快照：每个值都取整，好让断言写成一个字面量。 */
function fullSnapshot(collectedAt = Date.now()): MonitorSnapshot {
  return {
    collectedAt, cpuPercent: 12.5,
    memory: { usedBytes: 614400, totalBytes: 1024000, usedPercent: 60 },
    load: { one: 0.5, five: 1, fifteen: 2 },
    disk: { mount: '/', usedBytes: 40960, totalBytes: 102400, availableBytes: 51200, usedPercent: 40 },
    net: { receivedBytesPerSecond: 4096, transmittedBytesPerSecond: 2048 },
    uptimeSeconds: 86400, issues: {},
  }
}

/** 第一轮：CPU 和网络是增量指标，还没有基线。 */
function warmUpSnapshot(collectedAt = Date.now()): MonitorSnapshot {
  return { ...fullSnapshot(collectedAt), cpuPercent: null, net: null, issues: { cpu: 'warming-up', net: 'warming-up' } }
}

/**
 * 按下 document.hidden 并派发 visibilitychange。
 *
 * 产品代码读的就是这一个 getter，所以测试要能控制它 —— 而控制它的正确方式是覆盖
 * getter 并在断言之后删掉覆盖，不是给产品加一个能绕过可见性策略的开关。
 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

function restoreHidden(): void {
  delete (document as unknown as Record<string, unknown>).hidden
  document.dispatchEvent(new Event('visibilitychange'))
}



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

    assert(gestures.stats.opens === 1 && document.querySelectorAll('[role="tab"]').length === 1,

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

    // 窗口按钮整组是桌面独有的，而且只在系统自己不画按钮的平台上出现（macOS 的红绿灯
    // 由系统画，桥因此不带这一项）。所以这一节先断言「没有桥就一个节点都没有」，再断言
    // 桥来了之后它出现、点得动、并且随客户端一起走。
    assert(!document.getElementById('window-controls'), '独立 Web 入口不该有窗口按钮，一个节点都不该有')

    const windowCalls: string[] = []

    window.puretermDesktop = {
      bootstrap: async () => ({ webSocketUrl: 'ws://127.0.0.1:1/ws' }),
      signalReady() {},
      windowControls: {
        minimize: () => windowCalls.push('minimize'),
        toggleMaximize: () => windowCalls.push('maximize'),
        close: () => windowCalls.push('close'),
      },
    }

    client = createClient({ api: chrome.api, terminalFactory: chrome.terminalFactory })

    assert((await client.ready).ok, 'desktop chrome client failed readiness')

    // 节点是等 desktop.css 落地之后才建的，所以这里等它而不是赌一个 tick 够用。
    const cluster = await waitFor(() => document.getElementById('window-controls'), 'the caption cluster')

    assert(cluster.parentElement?.classList.contains('topbar-actions') === true,
      'the cluster belongs to the top bar action row, which is the only thing it may append to')

    assert([...cluster.querySelectorAll('button')].map(button => button.id).join(',')
      === 'window-minimize,window-maximize,window-close',
      'the cluster is minimize, maximize and close, in that order')

    assert(cluster.querySelectorAll('.window-control').length === 3, 'every button in the cluster takes the caption style')

    click('window-minimize')

    click('window-maximize')

    click('window-close')

    assert(windowCalls.join(',') === 'minimize,maximize,close', 'each button must reach its own window command')

    await client.dispose()

    assert(!document.getElementById('window-controls'),
      '释放客户端要把这一组一起收走，否则重挂一次就会在顶栏里叠出第二组同 id 的按钮')

    delete window.puretermDesktop

    checks.push('the caption cluster exists only with the desktop bridge, and its three buttons reach the window commands')



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

    // 通知只收「已经发生的事」：保存成功这句话原来写在表单里，用户早就离开那张表单了。
    click('host-new'); fill(); click('host-save'); await tick()
    const toast = document.querySelector<HTMLElement>('.toast')!
    assert(!!toast, 'saving a host must announce itself where the user can still see it')
    assert(toast.getAttribute('role') === 'status', 'a normal notice must not interrupt a screen reader')
    assert(toast.querySelector('.toast-title')!.textContent!.includes('已保存'), 'the toast names what happened')
    assert(toast.querySelector('.toast-detail')!.textContent === 'Fixture', 'and names the record it happened to, not the form')
    assert(input('status').textContent === '', 'the form line goes quiet once the news moved out of it')
    toast.click()
    assert(!document.querySelector('.toast'), 'a notice you have read gets out of the way when clicked')
    click('nav-shortcuts')

    assert((input('shortcuts-dialog') as unknown as HTMLDialogElement).open, 'shortcuts action must open its help dialog')

    click('shortcuts-close')

    assert(!(input('shortcuts-dialog') as unknown as HTMLDialogElement).open, 'shortcuts dialog must close')

    fill(); click('connect'); await tick()

    assert(document.querySelectorAll('[role="tab"]').length === 1, 'the tab strip holds only session tabs; the library has none')

    click('workspace-home'); click('host-new'); fill(); input('host').value = 'second.example'; click('connect'); await tick()

    assert(multiple.stats.opens === 2 && document.querySelectorAll('[role="tab"]').length === 2, 'second host must open independently')

    // 会话不该把外壳拆掉。这条以前在 chrome.css 里：`.session-mode` 隐藏 `#primary-nav`
    // 并把 `.app-body` 收成一列，于是连上主机之后主框架看起来丢了。harness 剥掉了样式表，
    // 所以这里量 DOM —— `#app` 上没有那个类，轨道节点也就没有 hidden。
    assert(!input('app').classList.contains('session-mode'), 'a session must not put the shell into a rail-less mode')
    assert(!input('primary-nav').hidden, 'the rail stays on screen while a session is open')

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

    click('workspace-home')

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



    // 骨架必须在一个可控的 pending 上测：共享固件的 list 是立刻 resolve 的，
    // 否则断言测的只是「Promise 还没跑完」这种时序运气。
    const slow = fixture()
    const hold = deferred<HostRecord[]>()
    slow.api.hosts.list = async () => hold.promise
    const slowClient = createClient({ api: slow.api, terminalFactory: slow.terminalFactory })
    await tick()
    assert(document.querySelectorAll('.skeleton-row').length >= 3, '还在读的列表要给出占位行')
    assert(!document.querySelector('.host-row'), '数据没到之前不该有真行')
    assert(input('hosts-empty').hidden, '读的过程中不能让空态先跳出来一下')
    assert(document.querySelectorAll('.list-error').length === 2, '错误与降级两块骨架都在页上')
    hold.resolve(slow.api.hosts === undefined ? [] : [{ id: 's', label: 'S', host: 'h', username: 'u', port: 22, authMethod: 'password', hasSecret: false, updatedAt: '' }])
    await tick()
    assert(!document.querySelector('.skeleton-row'), '占位行让位给真行')
    assert(document.querySelectorAll('.host-row').length === 1, '真行到了')
    assert(input('hosts-empty').hidden, '有了一行之后空态必须退场')
    await slowClient.dispose()
    // 后端读不出来：说清楚是「这一件事没成」，并且给出再试一次的入口。
    const brokenApi = fixture()
    brokenApi.api.hosts.list = async () => { throw new Error('后端不在') }
    const brokenClient = createClient({ api: brokenApi.api, terminalFactory: brokenApi.terminalFactory })
    await tick()
    assert(!input('hosts-error').hidden, '一个读不出来的列表必须说出来，而不是安静地空着')
    assert(input('hosts-error').querySelector('.list-error-title')!.textContent!.includes('读不出来'), '说的是列表读不出来')
    assert(input('hosts-error').querySelector('.list-error-detail')!.textContent === '后端不在', '底层那句原文跟着走')
    await brokenClient.dispose()

    const failures = fixture()

    const attempts: TerminalOpenRequest[] = []

    // 照抄 ssh2 真正的措辞：这一句要能分诊到 TCP，而不是靠兜底路径显示。

    failures.api.open = async request => { attempts.push({ ...request }); throw new Error('connect ECONNREFUSED ::1:22') }

    client = createClient({ api: failures.api, terminalFactory: failures.terminalFactory })

    assert((await client.ready).ok, 'failure client failed readiness')

    fill(); click('connect'); await tick()

    const failedId = client.context.clientTerminal.active!.id

    assert(!input('connection-failure').hidden, 'connection error did not appear in its tab')

    click('host-new'); fill(); input('host').value = 'unrelated.example'

    client.context.clientTerminal.select(failedId); click('failure-retry'); await tick()

    assert(attempts.length === 2 && attempts[1]!.host === 'localhost' && client.context.clientTerminal.tabs.length === 1, 'retry must use the failed tab snapshot and reuse its tab')

    // 路线要说的是「死在哪一格」：四格里只有一格是红的，它左边全绿，连接线在断点处断开。

    const failPage = input('connection-failure')

    const nodes = [...failPage.querySelectorAll<HTMLElement>('.failure-route-node')]

    assert(nodes.length === 4, `the route draws four nodes, not ${nodes.length}`)

    assert(!failPage.classList.contains('route-collapsed'), 'a classified failure must draw the route')

    assert(nodes.filter(n => n.classList.contains('is-failed')).map(n => n.dataset.stage).join() === 'tcp', 'ECONNREFUSED must fail the TCP node')

    assert(nodes[0]!.classList.contains('is-passed') && !nodes[2]!.classList.contains('is-passed'), 'what got through is marked through, what never ran is not')

    const lines = [...failPage.querySelectorAll<HTMLElement>('.failure-route-line')]

    // 断开的是**通向左边那一格已通、向右进入失败格**的那根线：TCP 失败时第 0 根就断，

    // 后面两根什么都还没走，既不是实线也不是断线。

    assert(lines.length === 3, `four nodes are joined by three links, not ${lines.length}`)

    assert(lines[0]!.classList.contains('is-break'), 'the link entering the failed node is the broken one')

    assert(!lines[1]!.classList.contains('is-break') && !lines[1]!.classList.contains('is-through'), 'a link to a stage that never ran claims nothing')

    assert(input('failure-stage').textContent!.includes('TCP'), 'the stage is also stated in words, since the route is aria-hidden')

    assert(input('failure-suggestion').textContent!.includes('sshd'), 'and the page says what to do next')

    assert(failPage.querySelectorAll('.failure-log-no').length === failPage.querySelectorAll('.failure-log-entry').length, 'every log line has a gutter number')

    // 认不出来就整条收起，而不是留一排含义不明的灰点。

    failures.api.open = async request => { attempts.push({ ...request }); throw new Error('a failure nobody has categorised') }

    client.context.clientTerminal.select(failedId); click('failure-retry'); await tick()

    assert(failPage.classList.contains('route-collapsed'), 'an unclassifiable failure must collapse the route')

    assert(nodes.every(n => !n.classList.contains('is-failed') && !n.classList.contains('is-passed')), 'collapsed means no node claims anything')

    assert(input('failure-stage').textContent === '' && input('failure-suggestion').textContent === '', 'and the two text lines go quiet with it')

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

    // 监控注入的也是 transport，所以它必须跟着走 —— 而不是留在页面上按一个已经没有
    // 载体的订阅。这一条和上面那条是同一件事的两种观测面。
    assert(document.querySelector('#monitor-toggle') === null, 'removing transport did not unload the dependent monitor')

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


    /*
     * 监控：默认折叠、展开才采集、折叠就退订。
     *
     * 这是本增量里唯一一处「用户什么都不做、行为就变了」的地方 —— 一个刚打开的会话
     * 不该在远端跑起一条每 5 秒一次的采集命令 —— 所以它值得一条自己的检查。
     */
    const monitoring = fixture()

    client = createClient({ api: monitoring.api, terminalFactory: monitoring.terminalFactory })

    assert((await client.ready).ok, 'monitoring client failed readiness')

    const monitored: string[] = []

    const openSession = monitoring.api.open

    monitoring.api.open = async request => { const result = await openSession(request); monitored.push(result.sessionId); return result }

    fill(); click('connect'); await tick()

    assert(monitoring.monitor.starts.length === 0, 'a freshly opened session must not start monitoring while the panel is collapsed')

    assert(!monitorRoot().hidden && input('monitor-toggle').getAttribute('aria-expanded') === 'false', 'the monitor row is present and collapsed')

    assert(input('monitor-body').hidden, 'collapsed means the figures are not drawn')

    assert(monitorStatus() === 'paused', 'a collapsed panel says it is paused rather than pretending to read')

    // 展开只改属性和文字，不抢焦点：终端仍然是聚焦的那一个。
    const pane = document.querySelector<HTMLElement>('.terminal-pane:not([hidden])')!

    pane.tabIndex = -1; pane.focus()

    click('monitor-toggle'); await tick()

    assert(document.activeElement === pane, 'expanding the row must not move focus out of the terminal')

    assert(monitoring.monitor.starts.length === 1, 'expanding must start exactly one subscription')

    const activation = monitoring.monitor.starts[0]!

    assert(activation.sessionId === monitored[0] && /^[A-Za-z0-9_-]{1,64}$/.test(activation.subscriptionId), 'the subscription names the connected session with an ID the wire contract accepts')

    assert(monitorStatus() === 'loading', 'an expanded panel with no snapshot yet is loading')

    // 第一轮：CPU 和网络是增量指标，还没有基线。
    monitoring.monitor.update({ sessionId: monitored[0]!, subscriptionId: activation.subscriptionId, sequence: 1, status: 'partial', snapshot: warmUpSnapshot() })

    await tick()

    assert(monitorStatus() === 'partial', 'a frame whose two delta metrics are warming up is partial')

    assert(monitorIssue('cpu') === 'warming-up' && monitorIssue('net') === 'warming-up', 'only CPU and network warm up, because only they are deltas')

    assert(monitorValue('cpu') === '—' && monitorValue('net') === '—', 'a warm-up metric is a dash, never a zero')

    assert(monitorValue('memory').includes('60.0%') && monitorValue('load') === '0.50 1.00 2.00', 'the metrics that are ready are drawn with their units')

    // 第二轮：六个指标都在。
    monitoring.monitor.update({ sessionId: monitored[0]!, subscriptionId: activation.subscriptionId, sequence: 2, status: 'ready', snapshot: fullSnapshot() })

    await tick()

    assert(monitorStatus() === 'ready' && monitorIssue('cpu') === undefined, 'a complete frame is ready and carries no issue')

    assert(monitorValue('cpu') === '12.5%', 'cpu is drawn as a percentage')

    assert(monitorValue('uptime') === '1 天 0 小时', 'the host uptime is drawn in readable units, not raw seconds')

    assert(monitorValue('net').includes('↓') && monitorValue('net').includes('↑') && monitorValue('net').includes('KB/s'), 'throughput carries a direction and a unit')

    // 快照里带着**主机**的 uptime，而状态栏那一格不许拿它顶替会话时长。
    assert(document.getElementById('status-uptime') === null, 'the host uptime must not be printed as a session uptime')

    /*
     * 更新只改文字和属性，不重建节点。这不是性能考虑：一次重建就会让正在被键盘
     * 操作的那个按钮失去焦点，而「后台采样不动焦点」正是这一行存在的条件。
     */
    const toggle = input('monitor-toggle')

    toggle.focus()

    monitoring.monitor.update({ sessionId: monitored[0]!, subscriptionId: activation.subscriptionId, sequence: 3, status: 'ready', snapshot: fullSnapshot() })

    await tick()

    assert(document.activeElement === toggle, 'a sample must not rebuild the row and drop keyboard focus')

    // 折叠 = 退订，而不是让它在看不见的地方继续跑。
    click('monitor-toggle'); await tick()

    assert(monitoring.monitor.stopsOf(activation.subscriptionId) === 1, 'collapsing must stop the subscription exactly once')

    assert(!monitoring.monitor.active.has(activation.subscriptionId), 'a stopped subscription is no longer live')

    assert(monitorStatus() === 'paused', 'collapsing shows paused rather than the last sample as if it were live')

    assert(monitorValue('cpu') === '12.5%', 'the last values stay on screen while paused')

    // 再展开 = 新一代订阅：宿主的 CPU 与网络基线必须重来。
    click('monitor-toggle'); await tick()

    assert(monitoring.monitor.starts.length === 2 && monitoring.monitor.starts[1]!.subscriptionId !== activation.subscriptionId, 'a new activation is a new subscription ID')

    assert(monitoring.monitor.active.size === 1, 'exactly one subscription is live at a time')

    await client.dispose()

    checks.push('the monitor is collapsed by default, collects on expand, retires on collapse, and draws warm-up and ready frames')



    /*
     * 就绪不是「远端已经答话」。监控在本地能力之外，所以一条挂住的 start 不该让应用
     * 迟到自己 ready，也不该让终端少一格。
     */
    const pendingReply = fixture()

    pendingReply.monitor.holding = true

    client = createClient({ api: pendingReply.api, terminalFactory: pendingReply.terminalFactory })

    const pendingReplyReady = await client.ready

    assert(pendingReplyReady.ok, 'readiness must not wait for a monitor reply')

    fill(); click('connect'); await tick(); click('monitor-toggle'); await tick()

    assert(pendingReply.monitor.held.length === 1, 'the start request is in flight')

    assert(monitorStatus() === 'loading', 'a pending start is loading, not an error')

    assert((await client.ready).ok, 'readiness still holds while the first sample is pending')

    pendingReply.monitor.release(); await tick()

    assert(monitorStatus() === 'loading', 'a reply alone produces no snapshot')

    await client.dispose()

    // 宿主里没有监控插件：可预期，不是坏了。
    const absent = fixture()

    absent.monitor.rejection = 'MONITOR_UNAVAILABLE'

    client = createClient({ api: absent.api, terminalFactory: absent.terminalFactory })

    assert((await client.ready).ok, 'client without a monitor plugin failed readiness')

    fill(); click('connect'); await tick(); click('monitor-toggle'); await tick()

    assert(monitorStatus() === 'unsupported', 'a host without the monitor plugin renders unsupported, not broken')

    assert(monitorText('monitor-detail').includes('不支持'), 'and it says so in words rather than showing a code')

    await client.dispose()

    // 远端不是 Linux 走的是另一条路：start 成功，随后来一条 unsupported 事件。
    const nonLinux = fixture()

    client = createClient({ api: nonLinux.api, terminalFactory: nonLinux.terminalFactory })

    assert((await client.ready).ok, 'non-Linux client failed readiness')

    const nonLinuxSessions: string[] = []

    const openNonLinux = nonLinux.api.open

    nonLinux.api.open = async request => { const result = await openNonLinux(request); nonLinuxSessions.push(result.sessionId); return result }

    fill(); click('connect'); await tick(); click('monitor-toggle'); await tick()

    const nonLinuxSubscription = nonLinux.monitor.starts.at(-1)!

    nonLinux.monitor.update({ sessionId: nonLinuxSessions[0]!, subscriptionId: nonLinuxSubscription.subscriptionId, sequence: 1, status: 'unsupported', snapshot: null, message: '这台主机的操作系统是 Windows，暂不支持资源监控。' })

    await tick()

    assert(monitorStatus() === 'unsupported', 'a remote non-Linux target is unsupported after a successful start')

    assert(monitorValue('cpu') === '—', 'an unsupported target shows no invented numbers')

    // 一次失败不改写上一张快照：它带着自己的时间戳留着，由状态文字说明这一轮没读到。
    nonLinux.monitor.update({ sessionId: nonLinuxSessions[0]!, subscriptionId: nonLinuxSubscription.subscriptionId, sequence: 2, status: 'ready', snapshot: fullSnapshot() })

    await tick()

    nonLinux.monitor.update({ sessionId: nonLinuxSessions[0]!, subscriptionId: nonLinuxSubscription.subscriptionId, sequence: 3, status: 'error', message: '远端采集命令超时。' })

    await tick()

    assert(monitorStatus() === 'error', 'a failed probe is an error')

    assert(monitorText('monitor-detail') === '远端采集命令超时。', 'and it shows the reason the host gave')

    assert(monitorValue('cpu') === '12.5%', 'an error keeps the last sample rather than blanking the row')

    await client.dispose()

    checks.push('readiness never waits for a probe, and unsupported/error states render without invented numbers')



    /*
     * 切标签页。每一代订阅都有自己的 ID，所以上一代的迟到事件在这一步就被挡掉。
     */
    const switching = fixture()

    client = createClient({ api: switching.api, terminalFactory: switching.terminalFactory })

    assert((await client.ready).ok, 'tab-switch client failed readiness')

    const switched: string[] = []

    const openSwitch = switching.api.open

    switching.api.open = async request => { const result = await openSwitch(request); switched.push(result.sessionId); return result }

    const tabs = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]

    fill(); click('connect'); await tick()

    click('host-new'); fill(); input('host').value = 'second.example'; click('connect'); await tick()

    assert(switched.length === 2 && tabs().length === 2, 'the switch check needs two sessions')

    // 第二个会话是刚建的，也就是当前标签页。
    click('monitor-toggle'); await tick()

    const secondTab = switching.monitor.starts.at(-1)!

    assert(secondTab.sessionId === switched[1], 'the second tab subscribes its own session')

    tabs()[0]!.click(); await tick()

    assert(switching.monitor.stopsOf(secondTab.subscriptionId) === 1, 'leaving a tab stops its subscription exactly once')

    click('monitor-toggle'); await tick()

    const firstTab = switching.monitor.starts.at(-1)!

    assert(firstTab.sessionId === switched[0] && firstTab.subscriptionId !== secondTab.subscriptionId, 'the first tab subscribes its own session under a new ID')

    // 上一代的事件什么都不属于：会话对不上，订阅 ID 也对不上。
    switching.monitor.update({ sessionId: switched[1]!, subscriptionId: secondTab.subscriptionId, sequence: 5, status: 'ready', snapshot: fullSnapshot() })

    await tick()

    assert(monitorStatus() === 'loading', 'an event from a retired subscription must not repaint the current one')

    // 当前订阅的重复序号和更早的序号同样被忽略。
    switching.monitor.update({ sessionId: switched[0]!, subscriptionId: firstTab.subscriptionId, sequence: 2, status: 'ready', snapshot: fullSnapshot() })

    switching.monitor.update({ sessionId: switched[0]!, subscriptionId: firstTab.subscriptionId, sequence: 2, status: 'error', message: '重复的序号' })

    switching.monitor.update({ sessionId: switched[0]!, subscriptionId: firstTab.subscriptionId, sequence: 1, status: 'error', message: '更早的序号' })

    await tick()

    assert(monitorStatus() === 'ready' && monitorValue('cpu') === '12.5%', 'a duplicate or older sequence must not repaint the row')

    // 迟到的 start 回复：展开之后立刻切走，回复才到。
    tabs()[1]!.click(); await tick()

    click('monitor-toggle'); await tick()

    switching.monitor.holding = true

    tabs()[0]!.click(); await tick()

    assert(switching.monitor.held.length === 1, 'the switch back to the first tab starts a subscription that is still unanswered')

    const lateReply = switching.monitor.held[0]!.request.subscriptionId

    tabs()[1]!.click(); await tick()

    assert(switching.monitor.stopsOf(lateReply) === 0, 'an unanswered subscription is not stopped before its reply arrives')

    switching.monitor.release(); await tick()

    assert(switching.monitor.stopsOf(lateReply) === 1, 'a start reply that lands after eligibility was lost stops that obsolete ID exactly once')

    assert(switching.monitor.active.size === 0, 'no subscription is left live after the switch')

    switching.monitor.holding = false

    await client.dispose()

    checks.push('tab switching retires the old subscription, and late events, sequences and replies cannot repaint the new one')



    /*
     * 连点折叠/暂停/恢复。每一次激活都是新订阅，每一次退役都只停一次。
     */
    const pacing = fixture()

    client = createClient({ api: pacing.api, terminalFactory: pacing.terminalFactory })

    assert((await client.ready).ok, 'pacing client failed readiness')

    fill(); click('connect'); await tick(); click('monitor-toggle'); await tick()

    click('monitor-pause'); await tick()

    assert(monitorStatus() === 'paused' && input('monitor-pause').getAttribute('aria-pressed') === 'true', 'the pause control reports the state it is in')

    assert(pacing.monitor.active.size === 0, 'pausing retires the subscription')

    click('monitor-pause'); await tick()

    assert(monitorStatus() === 'loading' && pacing.monitor.active.size === 1, 'resuming starts a new subscription')

    click('monitor-toggle'); await tick(); click('monitor-toggle'); await tick()

    click('monitor-pause'); await tick(); click('monitor-pause'); await tick()

    assert(pacing.monitor.active.size === 1, `rapid toggling must leave exactly one live subscription, found ${pacing.monitor.active.size}`)

    assert(pacing.monitor.starts.length === 4, `four activations are four subscriptions, found ${pacing.monitor.starts.length}`)

    assert(new Set(pacing.monitor.starts.map(start => start.subscriptionId)).size === 4, 'every activation gets its own ID')

    assert(pacing.monitor.starts.slice(0, 3).every(start => pacing.monitor.stopsOf(start.subscriptionId) === 1), 'every retired subscription is stopped exactly once')

    assert(pacing.monitor.stopsOf(pacing.monitor.starts[3]!.subscriptionId) === 0, 'the one still-live subscription has not been stopped')

    await client.dispose()

    checks.push('rapid collapse, pause and resume leave one live subscription, one stop each, and no duplicate timers')



    /*
     * 可见性。隐藏时**在远端**停采，不是只在本地不画；回到可见时立刻按快照的时间戳
     * 判定过期，而不是把一张二十秒前的数字当成实时。
     */
    const visibility = fixture()

    client = createClient({ api: visibility.api, terminalFactory: visibility.terminalFactory })

    assert((await client.ready).ok, 'visibility client failed readiness')

    const visibleSessions: string[] = []

    const openVisible = visibility.api.open

    visibility.api.open = async request => { const result = await openVisible(request); visibleSessions.push(result.sessionId); return result }

    fill(); click('connect'); await tick(); click('monitor-toggle'); await tick()

    const visible = visibility.monitor.starts.at(-1)!

    visibility.monitor.update({ sessionId: visibleSessions[0]!, subscriptionId: visible.subscriptionId, sequence: 1, status: 'ready', snapshot: fullSnapshot() })

    await tick()

    assert(monitorStatus() === 'ready', 'the visible tab collects')

    setHidden(true); await tick()

    assert(visibility.monitor.stopsOf(visible.subscriptionId) === 1, 'a hidden document retires the subscription')

    assert(monitorStatus() === 'paused', 'a hidden document shows paused, not a live sample')

    const realNow = Date.now

    const sampledAt = realNow()

    Date.now = () => sampledAt + 20000

    setHidden(false); await tick()

    assert(visibility.monitor.starts.length === 2, 'becoming visible again starts a new subscription')

    assert(monitorStatus() === 'stale', 'a retained sample older than 15 seconds is stale, not live')

    Date.now = realNow

    const resumed = visibility.monitor.starts.at(-1)!

    visibility.monitor.update({ sessionId: visibleSessions[0]!, subscriptionId: resumed.subscriptionId, sequence: 1, status: 'ready', snapshot: fullSnapshot() })

    await tick()

    assert(monitorStatus() === 'ready', 'a fresh sample clears the stale mark')

    setHidden(true); await tick()

    assert(visibility.monitor.stopsOf(resumed.subscriptionId) === 1, 'hiding again retires the new subscription')

    restoreHidden(); await tick()

    await client.dispose()

    checks.push('visibility loss retires the subscription, and a retained sample goes stale before the next one arrives')



    /*
     * 断开、重连、关标签页。重连拿到的是**新会话**，所以旧数字一个都不能留下。
     */
    const ending = fixture()

    client = createClient({ api: ending.api, terminalFactory: ending.terminalFactory })

    assert((await client.ready).ok, 'ending client failed readiness')

    const endedSessions: string[] = []

    const openEnding = ending.api.open

    ending.api.open = async request => { const result = await openEnding(request); endedSessions.push(result.sessionId); return result }

    fill(); click('connect'); await tick(); click('monitor-toggle'); await tick()

    const beforeEnd = ending.monitor.starts.at(-1)!

    ending.monitor.update({ sessionId: endedSessions[0]!, subscriptionId: beforeEnd.subscriptionId, sequence: 1, status: 'ready', snapshot: fullSnapshot() })

    await tick()

    assert(monitorValue('cpu') === '12.5%', 'the connected session draws its sample')

    click('disconnect'); await tick()

    assert(ending.monitor.stopsOf(beforeEnd.subscriptionId) === 1, 'disconnecting retires the subscription')

    assert(monitorStatus() === 'disconnected', 'a closed session says the connection ended')

    click('session-reconnect'); await tick()

    assert(endedSessions.length === 2 && endedSessions[1] !== endedSessions[0], 'reconnecting gets a new session ID')

    assert(monitorStatus() === 'loading', 'a new session never inherits the old live status')

    assert(monitorValue('cpu') === '—', 'and it never inherits the old numbers either')

    const afterEnd = ending.monitor.starts.at(-1)!

    assert(afterEnd.sessionId === endedSessions[1], 'the new subscription names the new session')

    document.querySelector<HTMLButtonElement>('[data-tab-close]')!.click(); await tick()

    assert(ending.monitor.stopsOf(afterEnd.subscriptionId) === 1, 'closing a tab retires its subscription')

    assert(monitorStatus() === 'idle' && monitorValue('cpu') === '—', 'a closed tab leaves neither a status nor numbers behind')

    await client.dispose()

    checks.push('disconnect, reconnect with a new session ID and tab close all retire the subscription and clear the per-tab numbers')



    /*
     * 卸载监控插件。终端、SFTP、就绪和状态栏那两格都不属于它，所以它们必须活着。
     */
    const removal = fixture()

    client = createClient({ api: removal.api, terminalFactory: removal.terminalFactory })

    assert((await client.ready).ok, 'removal client failed readiness')

    const removalSessions: string[] = []

    const openRemoval = removal.api.open

    removal.api.open = async request => { const result = await openRemoval(request); removalSessions.push(result.sessionId); return result }

    fill(); click('connect'); await tick(); click('monitor-toggle'); await tick()

    const removed = removal.monitor.starts.at(-1)!

    removal.monitor.update({ sessionId: removalSessions[0]!, subscriptionId: removed.subscriptionId, sequence: 1, status: 'ready', snapshot: fullSnapshot() })

    removal.monitor.facts({ sessionId: removalSessions[0]!, revision: 1, serverHostKey: 'ssh-ed25519', cipher: { clientToServer: 'chacha20-poly1305@openssh.com', serverToClient: 'chacha20-poly1305@openssh.com' } })

    await tick()

    assert(monitorValue('cpu') === '12.5%' && input('status-key').textContent === 'ssh-ed25519', 'the monitor and the facts path are both live before the unload')

    await client.scopes.monitor.dispose()

    assert(removal.monitor.stopsOf(removed.subscriptionId) === 1, 'unloading the monitor retires its subscription')

    assert(monitorRoot().children.length === 0, 'the panel unmounts with its plugin')

    for (const listener of removal.terminals[0]!.inputs) listener('still-alive\r')

    assert(removal.stats.inputs === 1, 'the terminal still accepts input after the monitor is unloaded')

    click('sftp-toggle'); await tick()

    assert(removal.stats.lists === 1 && document.querySelector('#sftp-refresh') !== null, 'SFTP still lists after the monitor is unloaded')

    assert(input('status-cipher').textContent === 'chacha20-poly1305@openssh.com', 'unloading the monitor must not blank the cipher cell')

    assert(input('status-key').textContent === 'ssh-ed25519', 'nor the host key cell')

    assert((await client.ready).ok, 'readiness never waited for the monitor')

    await client.dispose()

    checks.push('unloading the monitor plugin leaves the terminal, SFTP, readiness and the status bar facts working')



    /*
     * 会话事实。cipher 与 host key 是连接期的常量，所以它们进状态栏那一格，不进每
     * 5 秒刷一次的监控行 —— 而这一块同时证明它们的路径不经过监控插件。
     */
    const facts = fixture()

    client = createClient({ api: facts.api, terminalFactory: facts.terminalFactory })

    assert((await client.ready).ok, 'facts client failed readiness')

    const cipher = 'chacha20-poly1305@openssh.com'

    const factSessions: string[] = []

    const openFacts = facts.api.open

    facts.api.open = async request => {
      const result = await openFacts(request)
      // 事实先于**客户端登记这个会话**到达：宿主在 terminal:opened 之后立刻发它，而
      // tab 的 sessionId 要等 open 的回复。所以它必须被缓冲，而不是被丢掉。
      facts.monitor.facts({ sessionId: result.sessionId, revision: 1, serverHostKey: 'ssh-ed25519', cipher: { clientToServer: cipher, serverToClient: cipher } })
      factSessions.push(result.sessionId)
      return result
    }

    fill(); click('connect'); await tick()

    assert(input('status-cipher').textContent === cipher, 'an equal cipher pair renders as a single name')

    assert(input('status-key').textContent === 'ssh-ed25519', 'the host key algorithm has its own cell')

    // rekey：更高的 revision 取代更早的一组，两个方向不同就把两个都写出来。
    facts.monitor.facts({ sessionId: factSessions[0]!, revision: 2, serverHostKey: 'rsa-sha2-512', cipher: { clientToServer: 'aes256-gcm@openssh.com', serverToClient: cipher } })

    await tick()

    assert(input('status-cipher').textContent === `aes256-gcm@openssh.com → ${cipher}`, 'an asymmetric negotiation shows both directions')

    assert(input('status-key').textContent === 'rsa-sha2-512', 'and the new host key replaces the old one')

    // 重复的和更低的 revision 都是迟到的事件。
    facts.monitor.facts({ sessionId: factSessions[0]!, revision: 2, serverHostKey: 'ssh-rsa', cipher: { clientToServer: 'none', serverToClient: 'none' } })

    facts.monitor.facts({ sessionId: factSessions[0]!, revision: 1, serverHostKey: 'ssh-rsa', cipher: { clientToServer: 'none', serverToClient: 'none' } })

    // 客户端从未见过打开的会话：这一条事实不属于任何一格。
    facts.monitor.facts({ sessionId: 'never-opened', revision: 9, serverHostKey: 'ssh-dss', cipher: { clientToServer: 'none', serverToClient: 'none' } })

    await tick()

    assert(input('status-key').textContent === 'rsa-sha2-512', 'a repeated, older or unknown-session revision must not repaint the cells')

    await client.dispose()

    checks.push('session facts fill the cipher and host-key cells, survive a rekey and ignore stale revisions')

    return checks

  } finally { releasePageDisposal?.(); await page?.dispose(); await client?.dispose(); window.ResizeObserver = NativeObserver; window.confirm = nativeConfirm; restoreHidden() }

}



Object.assign(window, { runClientLifecycleChecks: runChecks })

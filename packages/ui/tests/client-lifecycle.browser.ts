import { createClient } from '../src/client.js'
import { mountPageClient } from '../src/page-client.js'
import { ClientTransport } from '../src/services/transport.js'
import type { SshApi, HostRecord, HostSaveRequest, RendererReadyPayload, TerminalOpenResult, TerminalOpenRequest } from '@pureterm/protocol'
import type { TerminalView } from '../src/terminal-view.js'

const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement
const click = (id: string): void => input(id).click()
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

function fixture() {
  const listeners = { opened: new Set<(...args: any[]) => void>(), data: new Set<(...args: any[]) => void>(), closed: new Set<(...args: any[]) => void>() }
  const stats = { disposed: 0, opens: 0, inputs: 0, closes: 0, lists: 0, ready: [] as RendererReadyPayload[] }
  const subscribe = (name: keyof typeof listeners, listener: (...args: any[]) => void) => { listeners[name].add(listener); return () => { listeners[name].delete(listener) } }
  const emit = (name: keyof typeof listeners, ...args: unknown[]) => { for (const listener of listeners[name]) listener(...args) }
  const hosts: HostRecord[] = [{ id: 'fixture', label: 'Fixture', host: 'localhost', username: 'demo', port: 22, authMethod: 'password', hasSecret: false, updatedAt: '' }]
  const api: SshApi = {
    carrier: 'web', getCapabilities: async () => ({ credentialPersistence: 'session', privateKeyPicker: 'browser' }),
    open: async () => { const sessionId = `test-${++stats.opens}`; emit('opened', sessionId, 80, 24); return { sessionId, host: 'localhost', cols: 80, rows: 24 } },
    close: id => { stats.closes++; emit('closed', id, 'closed') },
    input: () => { stats.inputs++ }, resize: () => {}, pickPrivateKey: async () => undefined,
    onOpened: listener => subscribe('opened', listener), onData: listener => subscribe('data', listener), onClosed: listener => subscribe('closed', listener),
    hosts: { list: async () => hosts, save: async () => hosts[0]!, remove: async () => true },
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
  return { api, hosts, stats, listeners, terminals, terminalFactory, emit }
}

function fill() { input('host').value = 'localhost'; input('user').value = 'demo'; input('pass').value = 'password' }
function hostAction(id: string, action = '.host-main') { document.querySelector<HTMLButtonElement>(`.host-row[data-id="${id}"] ${action}`)!.click() }
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
    assert(second.terminals[0]!.writes.length === 1, 'old transport reached the new terminal')
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
      hostAction('fixture')
      const refresh = deferred<HostRecord[]>()
      saving.api.hosts.list = () => refresh.promise
      click('host-save'); await tick()
      assert(saved.length === 1, 'first host save did not start')
      if (nextForm === 'new') { click('host-new'); fill() } else hostAction('other')
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
    hostAction('other')
    const removedList = deferred<HostRecord[]>()
    removing.api.hosts.list = () => removedList.promise
    window.confirm = () => true
    hostAction('fixture', '[data-act="delete"]'); await tick()
    hostAction('third')
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

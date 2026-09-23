import { fork } from 'node:child_process'
import type { CredentialProvider } from '@pureterm/host'
import type { PickedPrivateKey } from '@pureterm/protocol'
import { createProcessRpc } from './process-rpc.js'

export interface DesktopHostProcess {
  readonly pid: number
  readonly url: string
  readonly desktopToken: string
  dispose(): Promise<void>
}

export async function startHostProcess(options: {
  entry: string
  dataDir: string
  credentials: CredentialProvider
  pickPrivateKey(clientId: string): Promise<PickedPrivateKey | undefined>
  browserAccess?: boolean
  onExit?(error: Error): void
  execPath?: string
  env?: NodeJS.ProcessEnv
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
}): Promise<DesktopHostProcess> {
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' }
  for (const key of Object.keys(env)) {
    if (['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase())) delete env[key]
  }
  const child = fork(options.entry, [], {
    execPath: options.execPath ?? process.execPath, execArgv: [], env,
    serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  })
  child.stdout?.on('data', chunk => process.stdout.write(`[host] ${chunk}`))
  child.stderr?.on('data', chunk => process.stderr.write(`[host] ${chunk}`))
  let stopping: Promise<void> | undefined
  let exited = false
  let started = false
  let failureReported = false
  let finishExit!: () => void
  const exit = new Promise<void>(resolve => { finishExit = resolve })
  const rpc = createProcessRpc({
    channel: {
      send(message, callback) {
        if (!child.connected) throw new Error('Host IPC disconnected')
        child.send(message as object, error => callback(error))
      },
      listen(listener) { child.on('message', listener); return () => { child.off('message', listener) } },
    },
    request(method, args) {
      if (method === 'platform:seal' && typeof args[0] === 'string') return options.credentials.seal(args[0])
      if (method === 'platform:unseal' && typeof args[0] === 'string') return options.credentials.unseal(args[0])
      if (method === 'platform:pick-key' && typeof args[0] === 'string') return options.pickPrivateKey(args[0])
      throw new Error(`Unknown platform request: ${method}`)
    },
    onError: error => console.error('[host-process]', error),
  })
  const fail = (error: Error): void => {
    rpc.close(error)
    if (started && !stopping && !failureReported) {
      failureReported = true
      options.onExit?.(error)
    }
  }
  child.once('error', fail)
  child.once('disconnect', () => fail(new Error('Desktop Host disconnected')))
  child.once('exit', (code, signal) => {
    exited = true
    finishExit()
    fail(new Error(`Desktop Host exited (${signal ?? code})`))
  })
  // Failed spawn emits error/close without exit (for example an absent executable).
  child.once('close', () => {
    if (exited) return
    exited = true
    finishExit()
    fail(new Error('Desktop Host failed to start'))
  })
  function dispose(): Promise<void> {
    if (stopping) return stopping
    // Schedule the body after assigning stopping: a synchronous disconnect must be expected.
    stopping = Promise.resolve().then(async () => {
      if (!exited && child.connected) {
        await rpc.call('host:shutdown', [], options.shutdownTimeoutMs ?? 5_000).catch(() => {})
      }
      if (!exited && !await waitForExit(exit, 500)) {
        child.kill('SIGTERM')
        if (!await waitForExit(exit, 1_000)) child.kill('SIGKILL')
        if (!await waitForExit(exit, 2_000)) throw new Error('Desktop Host did not terminate')
      }
      rpc.close(new Error('Desktop Host stopped'))
    })
    return stopping
  }
  let ready: { pid: number; url: string; desktopToken: string }
  try {
    ready = await rpc.call<typeof ready>('host:start', [options.dataDir, options.browserAccess ?? true], options.startupTimeoutMs ?? 15_000)
    if (ready?.pid !== child.pid || exited || !child.connected ||
      !isLoopbackWebHostUrl(ready.url, options.browserAccess ?? true) ||
      !isSecureToken(ready.desktopToken) || new URL(ready.url).searchParams.get('token') === ready.desktopToken) {
      throw new Error('Invalid Desktop Host handshake')
    }
    started = true
  } catch (error) {
    await dispose().catch(cleanupError => console.error('[host-process] Startup cleanup failed:', cleanupError))
    throw error
  }
  return { pid: child.pid!, url: ready.url, desktopToken: ready.desktopToken, dispose }
}

function isLoopbackWebHostUrl(value: unknown, browserAccess: boolean): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      Number.isInteger(Number(url.port)) && Number(url.port) > 0 &&
      url.username === '' && url.password === '' && url.pathname === '/' && url.hash === '' &&
      (browserAccess
        ? url.searchParams.size === 1 && isSecureToken(url.searchParams.get('token'))
        : url.search === '')
  } catch { return false }
}

function isSecureToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(value) &&
    Buffer.from(value, 'base64url').length >= 24
}

async function waitForExit(exit: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([exit.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

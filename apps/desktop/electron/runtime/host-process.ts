import { fork } from 'node:child_process'
import type { CredentialProvider } from '@pureterm/host'
import type { HostActivitySnapshot, HostStopResult, PickedPrivateKey, RemoteHostLifecycle } from '@pureterm/protocol'
import type { HostFailureReason } from './crash-report.js'
import { createProcessRpc } from './process-rpc.js'

/**
 * 子进程这一侧**实际观测到**的故障事实：只有进程事实，没有消息文本。
 * 上层把它补齐版本/时间/平台，变成一份可以落盘的诊断记录。
 */
export interface HostProcessFailure {
  reason: HostFailureReason
  pid?: number
  exitCode: number | null
  signal: string | null
}

/**
 * 启动期失败的出口。启动失败发生在 `onExit` 能生效之前（那时还没有 `started`），
 * 所以它只能靠抛出，并且必须自己带上同样的进程事实。
 */
export class HostStartupError extends Error {
  readonly failure: HostProcessFailure
  constructor(message: string, failure: HostProcessFailure) {
    super(message)
    this.name = 'HostStartupError'
    this.failure = failure
  }
}

export interface DesktopHostProcess {
  readonly pid: number
  readonly url: string
  readonly desktopToken: string
  /** Accepted-work facts and the shutdown admission lease, over the private channel. */
  readonly lifecycle: RemoteHostLifecycle
  /** Bounded stop; reports whether the child acknowledged and exited cleanly. */
  stop(): Promise<HostStopResult>
  /** Compatible cleanup wrapper around the same idempotent stop operation. */
  dispose(): Promise<void>
}

export async function startHostProcess(options: {
  entry: string
  dataDir: string
  credentials: CredentialProvider
  pickPrivateKey(clientId: string): Promise<PickedPrivateKey | undefined>
  browserAccess?: boolean
  onExit?(error: Error, failure: HostProcessFailure): void
  execPath?: string
  env?: NodeJS.ProcessEnv
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  /** Inspection/preparation/cancellation RPC budget. Drain adds a 1s margin. */
  lifecycleTimeoutMs?: number
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
  let stopping: Promise<HostStopResult> | undefined
  let exited = false
  let started = false
  let failureReported = false
  let exitCode: number | null = null
  let exitSignal: string | null = null
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
      // 子进程据此上报能力，而不是自己断定「桌面端就能加密」：加解密属于父进程，
      // 只有它知道这台机器此刻拿不拿得到系统密钥。
      if (method === 'platform:capabilities') return { credentialPersistence: options.credentials.credentialPersistence }
      if (method === 'platform:seal' && typeof args[0] === 'string') return options.credentials.seal(args[0])
      if (method === 'platform:unseal' && typeof args[0] === 'string') return options.credentials.unseal(args[0])
      if (method === 'platform:pick-key' && typeof args[0] === 'string') return options.pickPrivateKey(args[0])
      throw new Error(`Unknown platform request: ${method}`)
    },
    onError: error => console.error('[host-process]', error),
  })
  // 进程事实只来自这里：退出码、信号、pid，加上「为什么会这样」。
  const facts = (reason: HostFailureReason): HostProcessFailure => ({
    reason, exitCode, signal: exitSignal,
    ...(child.pid === undefined ? {} : { pid: child.pid }),
  })
  // 最后一次观测到的进程事实。启动期失败也记下来，好让抛出的 HostStartupError 说清原因。
  let lastFailure: HostProcessFailure | undefined
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined
  const fail = (error: Error, reason: HostFailureReason): void => {
    // 只报第一次：exit / disconnect / close 说的是同一件事。
    if (failureReported) return
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = undefined }
    lastFailure = facts(reason)
    rpc.close(error)
    if (started && !stopping) {
      failureReported = true
      options.onExit?.(error, lastFailure)
    }
  }
  child.once('error', (error: Error) => fail(error, 'spawn-error'))
  child.once('exit', (code, signal) => {
    exited = true
    exitCode = code
    exitSignal = signal
    finishExit()
    fail(new Error(`Desktop Host exited (${signal ?? code})`), 'unexpected-exit')
  })
  /*
   * 通道往往比进程先断。如果这时立刻按「IPC 断开」上报，退出码和信号就丢了 —— 而
   * 那正是诊断最想知道的东西。所以给 exit 一个很短的窗口；窗口到了进程还活着，
   * 才说明真的只是通道断了。
   */
  child.once('disconnect', () => {
    disconnectTimer = setTimeout(() => fail(new Error('Desktop Host disconnected'), 'ipc-disconnect'), 100)
    disconnectTimer.unref?.()
  })
  // Failed spawn emits error/close without exit (for example an absent executable).
  child.once('close', () => {
    if (exited) return
    exited = true
    finishExit()
    fail(new Error('Desktop Host failed to start'), 'spawn-error')
  })
  /**
   * Bounded stop. Records whether the child acknowledged and how it exited, so a
   * forced or dead child is never reported as a graceful completion. Multiple
   * stop/dispose calls share one operation.
   */
  function stop(): Promise<HostStopResult> {
    if (stopping) return stopping
    // Schedule the body after assigning stopping: a synchronous disconnect must be expected.
    stopping = Promise.resolve().then(async () => {
      let acknowledged = false
      if (!exited && child.connected) {
        acknowledged = await rpc.call('host:shutdown', [], options.shutdownTimeoutMs ?? 5_000).then(() => true, () => false)
      }
      if (!exited && !await waitForExit(exit, 500)) {
        child.kill('SIGTERM')
        if (!await waitForExit(exit, 1_000)) child.kill('SIGKILL')
        if (!await waitForExit(exit, 2_000)) throw new Error('Desktop Host did not terminate')
      }
      rpc.close(new Error('Desktop Host stopped'))
      return { graceful: acknowledged && exitCode === 0 && exitSignal === null, exitCode, signal: exitSignal }
    })
    return stopping
  }
  function dispose(): Promise<void> {
    return stop().then(() => undefined)
  }
  const lifecycleTimeout = options.lifecycleTimeoutMs ?? 2_000
  const lifecycle: RemoteHostLifecycle = {
    async inspectActivity() {
      return asActivity(await rpc.call('host:inspect-activity', [], lifecycleTimeout))
    },
    async prepareShutdown(leaseId) {
      return asActivity(await rpc.call('host:prepare-shutdown', [leaseId], lifecycleTimeout))
    },
    async drainAccepted(leaseId, timeoutMs) {
      // Give the child's own budget the last word: the RPC timeout only bounds a stuck child.
      return asActivity(await rpc.call('host:drain-accepted', [leaseId, timeoutMs], timeoutMs + 1_000))
    },
    async cancelShutdown(leaseId) {
      const value = await rpc.call('host:cancel-shutdown', [leaseId], lifecycleTimeout)
      if (typeof value !== 'boolean') throw new Error('Invalid Host lifecycle reply')
      return value
    },
  }
  let ready: { pid: number; url: string; desktopToken: string }
  try {
    ready = await rpc.call<typeof ready>('host:start', [options.dataDir, options.browserAccess ?? true], options.startupTimeoutMs ?? 15_000)
    if (ready?.pid !== child.pid || exited || !child.connected ||
      !isLoopbackWebHostUrl(ready.url, options.browserAccess ?? true) ||
      !isSecureToken(ready.desktopToken) || new URL(ready.url).searchParams.get('token') === ready.desktopToken) {
      throw new HostStartupError('Invalid Desktop Host handshake', facts('handshake-invalid'))
    }
    started = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 事实要在 dispose() **之前**取：收尾会杀掉还活着的子进程，那之后 exitCode 就不再是
    // 「启动失败那一刻」的真相了。子进程自己已经死掉/断线时用它的记录，否则只能从
    // RPC 的失败里认超时。
    const startup = error instanceof HostStartupError
      ? error
      : new HostStartupError(message, lastFailure ?? facts(/timed out/i.test(message) ? 'startup-timeout' : 'spawn-error'))
    await dispose().catch(cleanupError => console.error('[host-process] Startup cleanup failed:', cleanupError))
    throw startup
  }
  return { pid: child.pid!, url: ready.url, desktopToken: ready.desktopToken, lifecycle, stop, dispose }
}

/** The activity reply must be exactly four finite nonnegative integers. */
function asActivity(value: unknown): HostActivitySnapshot {
  const record = value as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid Host activity reply')
  for (const key of ['activeSessions', 'pendingConnections', 'pendingFileOperations', 'pendingMutations']) {
    const count = record[key]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid Host activity reply')
  }
  return {
    activeSessions: record.activeSessions as number,
    pendingConnections: record.pendingConnections as number,
    pendingFileOperations: record.pendingFileOperations as number,
    pendingMutations: record.pendingMutations as number,
  }
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

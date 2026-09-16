import { fork } from 'node:child_process'
import type { CredentialProvider, RendererBridge } from '@pureterm/host'
import type { PickedPrivateKey, RendererReadyPayload } from '@pureterm/protocol'
import type { Dispatcher } from '@pureterm/transport/dispatch'
import { createProcessRpc } from './process-rpc.js'

export interface DesktopHostProcess {
  readonly pid: number
  readonly dispatcher: Dispatcher
  releaseClient(clientId: string): void
  dispose(): Promise<void>
}

export async function startHostProcess(options: {
  entry: string
  dataDir: string
  bridge: RendererBridge
  credentials: CredentialProvider
  pickPrivateKey(clientId: string): Promise<PickedPrivateKey | undefined>
  onReady(payload: RendererReadyPayload, clientId: string): void
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
      if (method === 'platform:pick-key' && typeof args[0] === 'string') {
        if (!options.bridge.getRenderer(args[0])?.isAlive()) throw new Error('Client is no longer connected')
        return options.pickPrivateKey(args[0])
      }
      throw new Error(`Unknown platform request: ${method}`)
    },
    notice(method, args) {
      const [clientId, event, params] = args
      if (method === 'client:event' && typeof clientId === 'string' && typeof event === 'string' && Array.isArray(params)) {
        const renderer = options.bridge.getRenderer(clientId)
        if (!renderer?.isAlive() || !renderer.send(event, ...params)) rpc.notify('client:gone', [clientId])
      } else if (method === 'client:ready' && typeof clientId === 'string') {
        options.onReady(args[1] as RendererReadyPayload, clientId)
      }
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
  try {
    const ready = await rpc.call<{ pid: number }>('host:start', [options.dataDir], options.startupTimeoutMs ?? 15_000)
    if (ready.pid !== child.pid || exited || !child.connected) throw new Error('Invalid Desktop Host handshake')
    started = true
  } catch (error) {
    await dispose().catch(cleanupError => console.error('[host-process] Startup cleanup failed:', cleanupError))
    throw error
  }
  const assertClient = (clientId: string): void => {
    if (stopping || !options.bridge.getRenderer(clientId)?.isAlive()) throw new Error('Client is no longer connected')
  }
  return {
    pid: child.pid!,
    dispatcher: {
      call(method, params, clientId) {
        try { assertClient(clientId) } catch (error) { return Promise.reject(error) }
        return rpc.call('host:call', [method, params, clientId])
      },
      notify(name, params, clientId) {
        assertClient(clientId)
        rpc.notify('host:notice', [name, params, clientId])
      },
    },
    releaseClient: clientId => { rpc.notify('client:gone', [clientId]) },
    dispose,
  }
}

async function waitForExit(exit: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([exit.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

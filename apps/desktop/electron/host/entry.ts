import { join } from 'node:path'
import { createHost, type Host } from '@pureterm/host'
import { createDispatcher, type Dispatcher } from '@pureterm/transport/dispatch'
import { createProcessRpc } from '../runtime/process-rpc.js'

if (!process.send) throw new Error('Desktop Host must be launched with a private IPC channel')
let host: Host | undefined
let dispatcher: Dispatcher | undefined
let starting: Promise<void> | undefined
let stopping: Promise<void> | undefined
const clients = new Set<string>()
const rpc = createProcessRpc({
  channel: {
    send(message, callback) {
      if (!process.connected) throw new Error('Desktop parent disconnected')
      process.send!(message as object, error => callback(error))
    },
    listen(listener) { process.on('message', listener); return () => { process.off('message', listener) } },
  },
  async request(method, args) {
    if (method === 'host:shutdown') { await shutdown(); return true }
    if (stopping) throw new Error('Desktop Host is stopping')
    if (method === 'host:start') {
      if (starting || typeof args[0] !== 'string') throw new Error('Invalid Host initialization')
      const dataDir = args[0]
      starting = (async () => {
        host = await createHost({
          bridge: { getRenderer(id) {
            if (!clients.has(id)) return undefined
            return { id, isAlive: () => clients.has(id) && process.connected && !stopping,
              send: (event, ...params) => clients.has(id) && rpc.notify('client:event', [id, event, params]) }
          } },
          credentials: { persistent: true,
            seal: plain => rpc.call<string | undefined>('platform:seal', [plain]),
            unseal: sealed => rpc.call<string | undefined>('platform:unseal', [sealed]) },
          hostStoreFile: join(dataDir, 'hosts.json'), knownHostsFile: join(dataDir, 'known_hosts.json'),
        })
        dispatcher = createDispatcher({ host,
          capabilities: { credentialPersistence: 'encrypted', privateKeyPicker: 'native' },
          pickPrivateKey: id => rpc.call('platform:pick-key', [id]),
          onReady: (payload, id) => { rpc.notify('client:ready', [id, payload]) },
        })
      })()
      await starting
      return { pid: process.pid }
    }
    if (method === 'host:call') {
      const [name, params, id] = parseCall(args)
      clients.add(id)
      return dispatcher!.call(name, params, id)
    }
    throw new Error(`Unknown Host request: ${method}`)
  },
  notice(method, args) {
    if (method === 'client:gone' && typeof args[0] === 'string') {
      clients.delete(args[0]); host?.releaseClient(args[0])
    } else if (method === 'host:notice' && !stopping) {
      const [name, params, id] = parseCall(args)
      clients.add(id)
      dispatcher!.notify(name, params, id)
    }
  },
  onError: error => console.error('[host]', error.message),
})

function parseCall(args: unknown[]): [string, unknown[], string] {
  if (!dispatcher || typeof args[0] !== 'string' || !Array.isArray(args[1]) || typeof args[2] !== 'string') throw new Error('Invalid Host call')
  return [args[0], args[1], args[2]]
}

function shutdown(): Promise<void> {
  if (stopping) return stopping
  stopping = Promise.resolve().then(async () => {
    await starting?.catch(() => {})
    clients.clear()
    await host?.dispose()
    // The reply must flush before disconnecting; parent also bounds this shutdown.
    setTimeout(() => { rpc.close(); if (process.connected) process.disconnect?.(); process.exit(0) }, 20)
  })
  return stopping
}

process.once('disconnect', () => {
  rpc.close(new Error('Desktop parent disconnected'))
  const deadline = setTimeout(() => process.exit(1), 5_000)
  void shutdown().finally(() => { clearTimeout(deadline); process.exit(0) })
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void shutdown() })
process.once('uncaughtException', error => { console.error(error); rpc.close(error); void shutdown() })
process.once('unhandledRejection', error => { console.error(error); rpc.close(new Error(String(error))); void shutdown() })

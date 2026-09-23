import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWebHost, type WebHost } from '@pureterm/transport/web-host'
import { createProcessRpc } from '../runtime/process-rpc.js'

if (!process.send) throw new Error('Desktop Host must be launched with a private IPC channel')
let host: WebHost | undefined
let starting: Promise<void> | undefined
let stopping: Promise<void> | undefined
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
      if (starting || typeof args[0] !== 'string' || typeof args[1] !== 'boolean') throw new Error('Invalid Host initialization')
      const dataDir = args[0]
      const browserAccess = args[1]
      const desktopToken = randomBytes(24).toString('base64url')
      starting = (async () => {
        host = await startWebHost({
          staticDir: dirname(fileURLToPath(import.meta.resolve('@pureterm/ui/index.html'))),
          hostStoreFile: join(dataDir, 'hosts.json'),
          knownHostsFile: join(dataDir, 'known_hosts.json'),
          credentials: {
            persistent: true,
            seal: plain => rpc.call<string | undefined>('platform:seal', [plain]),
            unseal: sealed => rpc.call<string | undefined>('platform:unseal', [sealed]),
          },
          capabilities: { credentialPersistence: 'encrypted', privateKeyPicker: 'native' },
          desktopToken,
          browserAccess,
          pickPrivateKey: id => rpc.call('platform:pick-key', [id]),
          onReady: () => {},
          log: false,
        })
      })()
      await starting
      return { pid: process.pid, url: host!.url, desktopToken }
    }
    throw new Error(`Unknown Host request: ${method}`)
  },
  onError: error => console.error('[host]', error.message),
})

function shutdown(): Promise<void> {
  if (stopping) return stopping
  stopping = Promise.resolve().then(async () => {
    await starting?.catch(() => {})
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

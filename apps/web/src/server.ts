import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHost } from '@pureterm/host'
import { createCompositeBridge, type Carrier } from '@pureterm/transport/carrier'
import { createHttpCarrier } from '@pureterm/transport/carrier-http'
import { createDispatcher } from '@pureterm/transport/dispatch'

export interface LocalWebOptions {
  /** 0 lets the OS allocate an available loopback port. */
  port?: number
  /** Independent Web profile; Desktop retains its existing data directory. */
  dataDir?: string
  log?: ((line: string) => void) | false
}

export interface LocalWebServer {
  readonly url: string
  readonly port: number
  readonly dataDir: string
  /** Stop accepting clients, then close all SSH sessions. Safe to call concurrently. */
  dispose(): Promise<void>
}

/** A local Node entry point using the same Host, protocol and UI as Desktop. */
export async function startLocalWeb(options: LocalWebOptions = {}): Promise<LocalWebServer> {
  const port = options.port ?? 0
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口必须是 0 到 65535 之间的整数。')
  const dataDir = resolve(options.dataDir ?? join(homedir(), '.ssh-cordis', 'web'))
  const staticDir = dirname(fileURLToPath(import.meta.resolve('@pureterm/ui/index.html')))
  const log = options.log === false ? (): void => {} : options.log ?? ((line: string): void => console.log(line))
  const carriers: Carrier[] = []
  const host = await createHost({
    bridge: createCompositeBridge(() => carriers),
    hostStoreFile: join(dataDir, 'hosts.json'),
    knownHostsFile: join(dataDir, 'known-hosts.json'),
    log: options.log === false ? false : log,
  })

  try {
    const dispatcher = createDispatcher({
      host,
      capabilities: { credentialPersistence: 'session', privateKeyPicker: 'browser' },
      pickPrivateKey: async () => undefined,
      onReady: () => {},
    })
    const carrier = await createHttpCarrier({
      dispatcher,
      staticDir,
      port,
      onDisconnect: (clientId) => host.releaseClient(clientId),
      log,
    })
    carriers.push(carrier)
    let disposal: Promise<void> | undefined
    return {
      url: carrier.url,
      port: carrier.port,
      dataDir,
      dispose() {
        disposal ??= (async () => {
          try {
            await carrier.dispose()
          } finally {
            carriers.length = 0
            await host.dispose()
          }
        })()
        return disposal
      },
    }
  } catch (error) {
    await host.dispose()
    throw error
  }
}

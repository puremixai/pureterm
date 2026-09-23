import { createHost, type CredentialProvider } from '@pureterm/host'
import type { PickedPrivateKey, RendererReadyPayload, RuntimeCapabilities } from '@pureterm/protocol'
import { createCompositeBridge, type Carrier } from './carrier.js'
import { createHttpCarrier } from './carrier-http.js'
import { createDispatcher } from './dispatch.js'

export interface WebHostOptions {
  staticDir: string
  hostStoreFile: string
  knownHostsFile: string
  credentials?: CredentialProvider
  capabilities: RuntimeCapabilities
  port?: number
  desktopToken?: string
  browserAccess?: boolean
  pickPrivateKey?: (clientId: string) => Promise<PickedPrivateKey | undefined>
  onReady?: (payload: RendererReadyPayload, clientId: string) => void
  log?: ((line: string) => void) | false
}

export interface WebHost {
  readonly url: string
  readonly port: number
  dispose(): Promise<void>
}

/** Assemble a single Host and loopback WebSocket carrier for either local entry point. */
export async function startWebHost(options: WebHostOptions): Promise<WebHost> {
  const carriers: Carrier[] = []
  const bridge = createCompositeBridge(() => carriers)
  const host = await createHost({
    bridge,
    hostStoreFile: options.hostStoreFile,
    knownHostsFile: options.knownHostsFile,
    credentials: options.credentials,
    log: options.log,
  })

  try {
    const dispatcher = createDispatcher({
      host,
      capabilities: options.capabilities,
      pickPrivateKey: async clientId => {
        if (!bridge.getRenderer(clientId)?.isAlive()) return undefined
        const picked = await options.pickPrivateKey?.(clientId)
        return bridge.getRenderer(clientId)?.isAlive() ? picked : undefined
      },
      onReady: (payload, clientId) => {
        if (bridge.getRenderer(clientId)?.isAlive()) options.onReady?.(payload, clientId)
      },
    })
    const carrier = await createHttpCarrier({
      dispatcher,
      staticDir: options.staticDir,
      port: options.port,
      desktopToken: options.desktopToken,
      browserAccess: options.browserAccess,
      onDisconnect: clientId => host.releaseClient(clientId),
      log: options.log === false ? () => {} : options.log,
    })
    carriers.push(carrier)
    let disposal: Promise<void> | undefined
    return {
      url: carrier.url,
      port: carrier.port,
      dispose() {
        disposal ??= (async () => {
          try {
            // Host drains accepted saves while their WebSocket replies can still be sent.
            await host.dispose()
          } finally {
            await carrier.dispose()
            carriers.length = 0
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

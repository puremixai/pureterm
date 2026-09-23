import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWebHost } from '@pureterm/transport/web-host'

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
  const webHost = await startWebHost({
    staticDir,
    hostStoreFile: join(dataDir, 'hosts.json'),
    knownHostsFile: join(dataDir, 'known-hosts.json'),
    capabilities: { credentialPersistence: 'session', privateKeyPicker: 'browser' },
    port,
    log: options.log,
  })
  return { url: webHost.url, port: webHost.port, dataDir, dispose: () => webHost.dispose() }
}

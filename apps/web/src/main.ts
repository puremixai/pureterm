import { startLocalWeb, type LocalWebServer } from './server.js'

const HELP = `PureTerm local Web

Usage: node apps/web/dist/main.js [--port N] [--data-dir PATH]

  --port N          loopback port, default 0 (let the OS pick one)
  --data-dir PATH   host data directory, default ~/.ssh-cordis/web
  --help            show this help

SSH_CORDIS_WEB_DATA_DIR also sets the data directory.
The server listens on 127.0.0.1 only. Open the printed address to use it; passwords and private keys are not persisted.
Press Ctrl+C to stop the server and its SSH sessions.
`

interface Arguments {
  help: boolean
  port?: number
  dataDir?: string
}

function parseArguments(args: string[]): Arguments {
  const result: Arguments = { help: false }
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--help') {
      result.help = true
      continue
    }
    if (argument !== '--port' && argument !== '--data-dir') throw new Error(`Unknown argument: ${argument}`)
    if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}`)
    seen.add(argument)
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value.`)
    if (argument === '--port') {
      const port = Number(value)
      if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('The port must be an integer between 0 and 65535.')
      result.port = port
    } else {
      result.dataDir = value
    }
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }

  let server: LocalWebServer | undefined
  let stopRequested = false
  const removeSignals = (): void => {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
  const stop = (): void => {
    stopRequested = true
    if (!server) return
    void server.dispose().catch((error: unknown) => {
      console.error(`[pureterm:web] shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }).finally(removeSignals)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    server = await startLocalWeb({ port: args.port, dataDir: args.dataDir ?? (process.env.SSH_CORDIS_WEB_DATA_DIR || undefined) })
    if (stopRequested) {
      await server.dispose()
      removeSignals()
      return
    }
    console.log(`[pureterm:web] ${server.url}`)
    console.log('[pureterm:web] Open the address above in a browser on this machine; passwords and private keys are used only by the current page. Press Ctrl+C to stop.')
  } catch (error) {
    removeSignals()
    throw error
  }
}

void main().catch((error: unknown) => {
  console.error(`[pureterm:web] startup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

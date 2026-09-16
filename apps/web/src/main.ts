import { startLocalWeb, type LocalWebServer } from './server.js'

const HELP = `PureTerm 本机 Web

用法：node apps/web/dist/main.js [--port N] [--data-dir PATH]

  --port N          本机端口，默认 0（自动分配）
  --data-dir PATH   主机信息目录，默认 ~/.ssh-cordis/web
  --help            显示帮助

也可通过 SSH_CORDIS_WEB_DATA_DIR 设置数据目录。
服务仅监听 127.0.0.1。打开打印的地址即可使用；密码和私钥不会持久保存。
按 Ctrl+C 关闭服务和 SSH 会话。
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
    if (argument !== '--port' && argument !== '--data-dir') throw new Error(`不认识的参数：${argument}`)
    if (seen.has(argument)) throw new Error(`参数重复：${argument}`)
    seen.add(argument)
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${argument} 需要一个值。`)
    if (argument === '--port') {
      const port = Number(value)
      if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口必须是 0 到 65535 之间的整数。')
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
      console.error(`[pureterm:web] 关闭失败：${error instanceof Error ? error.message : String(error)}`)
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
    console.log('[pureterm:web] 在本机浏览器打开上方地址；密码和私钥仅用于当前页面。按 Ctrl+C 关闭。')
  } catch (error) {
    removeSignals()
    throw error
  }
}

void main().catch((error: unknown) => {
  console.error(`[pureterm:web] 启动失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

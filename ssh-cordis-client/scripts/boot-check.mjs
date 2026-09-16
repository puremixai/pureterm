import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

/**
 * 启动自检：验证 `npm start` 那条路径上应用**真的起来了**。
 *
 * 与 smoke:electron 的分工：
 *   - boot  （本文件）：应用自己的生产代码路径能不能跑起来（preload 通、xterm 挂载、主机列表拉回来）。
 *   - smoke：在此之上再驱动一次真实的 SSH 会话，验证字节流不乱码。
 *
 * 关键：默认**不**施加任何 Chromium 开关——就是 `npm start` 的真实条件。
 * 受限容器里这会让应用走到「检测到沙箱失败 → 自动以 --no-sandbox 重启」那条路，
 * 正是要验证的行为。若应用起不来，它会一直失败，本脚本也就一直不通过。
 *
 * 退出码：0 = 应用起来了 · 1 = 没起来
 */
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = mkdtempSync(join(tmpdir(), 'ssh-cordis-boot-'))

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const extraSwitches = (process.env.SSH_CORDIS_BOOT_SWITCHES ?? '').split(' ').filter(Boolean)
// 截图落在 dist/ 下（构建产物目录），不污染源码树
const shotPath = process.env.SSH_CORDIS_BOOT_SHOT ?? join(projectRoot, 'dist', 'boot-check.png')

console.log(`[boot] 启动应用（不施加额外开关${extraSwitches.length ? `，除了 ${extraSwitches.join(' ')}` : ''}）…`)

const child = spawn(electronPath, ['.', ...extraSwitches], {
  cwd: projectRoot,
  env: {
    ...env,
    SSH_CORDIS_BOOT_CHECK: '1',
    SSH_CORDIS_BOOT_SHOT: shotPath,
    SSH_CORDIS_DATA_DIR: dataDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
const absorb = (stream, sink) => (chunk) => {
  const text = chunk.toString()
  output += text
  sink.write(text)
}
child.stdout.on('data', absorb(child.stdout, process.stdout))
child.stderr.on('data', absorb(child.stderr, process.stderr))

let timedOut = false
const timer = setTimeout(() => {
  timedOut = true
  console.error('[boot] 超时，强制结束')
  child.kill()
}, 60_000)

// 用 close 而不是 exit：应用检测到沙箱失败时会以 --no-sandbox 重启自己，
// 新进程继承同一组 stdio 句柄，只有等管道真正关闭才说明所有输出都收完了。
const exitCode = await new Promise((resolve) => child.on('close', resolve))
clearTimeout(timer)

rmSync(dataDir, { recursive: true, force: true })

const bootOk = output.includes('[BOOT-OK]')
const relaunched = output.includes('将以 --no-sandbox 重启一次') || output.includes('--no-sandbox 运行')

console.log('\n' + '─'.repeat(60))
if (bootOk) {
  console.log('应用启动成功：渲染层已就绪，preload 与 IPC 全通。')
  if (existsSync(shotPath)) console.log(`窗口截图：${shotPath}`)
  if (relaunched) {
    console.log('（应用是自动以 --no-sandbox 重启后跑起来的——当前受限环境里 Chromium 沙箱初始化不了。）')
  }
  process.exit(0)
}

console.log(timedOut ? '应用启动失败：超时，没等到就绪信号。' : `应用启动失败（退出码 ${exitCode}），没收到 [BOOT-OK]。`)
process.exit(1)

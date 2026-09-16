/**
 * Electron 渲染环境诊断。
 *
 * 用途：当 `smoke:electron` 返回退出码 2（环境不支持）时，用这个脚本找出
 * 「这台机器上到底哪套 Chromium 开关能让渲染进程真正跑起来」。
 * 它不依赖本项目构建产物——只开一个带 data: URL 的最小窗口，所以能把
 * 「Chromium 起不来」和「我们的代码有问题」彻底分开。
 *
 * 用法：
 *   node scripts/diagnose-electron.mjs                 # 跑内置的开关组合
 *   node scripts/diagnose-electron.mjs -- "--foo" "--bar"   # 只试指定组合
 *
 * 输出每个组合的时间线：app 就绪 → 窗口创建 → 页面加载 → 渲染进程是否存活 → IPC 是否可用。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const MINIMAL_MAIN = `
const { app, BrowserWindow, ipcMain } = require('electron')
const log = (m) => { console.log('[probe] ' + m) }
process.on('uncaughtException', (e) => { log('uncaughtException: ' + e.message) })
app.whenReady().then(async () => {
  log('app-ready')
  const win = new BrowserWindow({
    width: 600, height: 400, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  log('window-created')
  win.webContents.on('did-finish-load', () => log('did-finish-load'))
  win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load: ' + code + ' ' + desc))
  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone: ' + d.reason + ' exit=' + d.exitCode))
  try {
    await win.loadURL('data:text/html,<html><body><h1>probe</h1></body></html>')
    log('loadURL-resolved')
    const title = await win.webContents.executeJavaScript('document.body.innerText.trim()')
    log('renderer-executed: "' + title + '"')
    log('RESULT-OK')
  } catch (e) {
    log('RESULT-FAIL: ' + e.message)
  }
  setTimeout(() => app.exit(0), 200)
}).catch((e) => { log('bootstrap-failed: ' + e.message); app.exit(3) })
`

const DEFAULT_SETS = [
  { name: '不加开关', switches: [] },
  { name: '--in-process-gpu', switches: ['--in-process-gpu'] },
  { name: '全关 GPU 软件渲染', switches: ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'] },
  { name: '--no-sandbox', switches: ['--no-sandbox'] },
  { name: '--no-sandbox + --disable-dev-shm-usage', switches: ['--no-sandbox', '--disable-dev-shm-usage'] },
  { name: '关 GPU + --no-sandbox', switches: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] },
  { name: 'SwiftShader (ANGLE) + 允许不安全回退', switches: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] },
  { name: 'SwiftShader (GL) + 允许不安全回退', switches: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] },
  { name: '关 Vulkan + 关 GPU', switches: ['--disable-features=Vulkan', '--disable-gpu', '--no-sandbox'] },
  { name: '--disable-gpu-sandbox + --no-sandbox', switches: ['--disable-gpu-sandbox', '--no-sandbox'] },
]

const argv = process.argv.slice(2)
const sets = argv.length
  ? [{ name: `自定义 (${argv.join(' ')})`, switches: argv }]
  : DEFAULT_SETS

// electron 二进制需要一个「应用目录」：临时目录里放 package.json + main.js
const appDir = mkdtempSync(join(tmpdir(), 'electron-probe-'))
writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'probe', version: '0.0.0', main: 'main.js' }))
writeFileSync(join(appDir, 'main.js'), MINIMAL_MAIN)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const results = []

function probe(set) {
  return new Promise((resolve) => {
    const child = spawn(electronPath, ['.', ...set.switches], {
      cwd: appDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let timedOut = false
    const absorb = (chunk) => {
      output += chunk.toString()
    }
    child.stdout.on('data', absorb)
    child.stderr.on('data', absorb)

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 20_000)

    child.on('exit', () => {
      clearTimeout(timer)
      const ok = output.includes('RESULT-OK')
      const steps = ['app-ready', 'window-created', 'did-finish-load', 'loadURL-resolved', 'renderer-executed']
      const reached = steps.filter((s) => output.includes(s))
      resolve({ ok, timedOut, reached, output })
    })
  })
}

console.log(`使用 electron: ${electronPath}\n`)

for (const set of sets) {
  process.stdout.write(`[诊断] ${set.name} ... `)
  const result = await probe(set)
  let verdict
  if (result.ok) verdict = '✅ 渲染进程可用'
  else if (result.timedOut) verdict = '⏱  挂死（超时）'
  else verdict = '❌ 渲染进程起不来'

  const progress = result.reached.length ? `已到达: ${result.reached.join(' → ')}` : '窗口都没创建成功'
  console.log(`${verdict}\n         ${progress}`)
  results.push({ set, ...result })
}

rmSync(appDir, { recursive: true, force: true })

const working = results.filter((r) => r.ok)
console.log('\n' + '─'.repeat(60))
if (working.length) {
  console.log(`可用组合 ${working.length} 个：`)
  for (const r of working) console.log(`  ${r.set.name}  →  ${JSON.stringify(r.set.switches)}`)
  console.log('\n把这套开关交给端到端测试即可：')
  const pick = working[0].set.switches.join(' ')
  console.log(`  SSH_CORDIS_SMOKE_SWITCHES="${pick}" npm run smoke:electron`)
  if (!pick) console.log('  （不加开关就行，直接 npm run smoke:electron）')
} else {
  console.log('没有任何组合能让渲染进程跑起来 —— 这台机器缺少可用的 Chromium 渲染上下文。')
  console.log('这不是代码问题，请换一台带图形界面的机器跑端到端测试。')
  console.log('宿主机层测试不依赖渲染进程，随时可以跑：npm run smoke:host')
}
process.exit(working.length ? 0 : 2)

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, openSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

/**
 * 启动桌面应用，并让它脱离当前进程独立存活。
 *
 * 为什么要有这个脚本，而不是直接 `npm start`：
 *   - `npm start` 在当前终端里前台跑；被工具调用时，命令一「结束」，
 *     整棵进程树会被一起回收，应用跟着消失。
 *   - 这里用 detached + unref + stdio 落盘，把应用交出去当一个独立进程。
 *
 * **这个脚本不做开关决策。** 早先它默认硬带 `--no-sandbox`，那是错的：
 *   - 「这台机器需不需要放宽沙箱」是应用自己的判断（electron/runtime/platform-plan.ts 负责
 *     运行时决策，启动档案 electron/runtime/launch-profile.ts 负责记住上次的结果）；
 *     脚本替它决定，等于让那套机制在 `npm run launch` 这条路上彻底失效——
 *     因为 planProfileSwitches 看到命令行上已经有 --no-sandbox，就正确地什么都不做。
 *   - 更糟的是档案会在建档时记下 `sandboxWeakened: true`，而用户从没选择过它。
 *
 * 所以现在脚本只做两件事：把用户显式给的参数原样透传，以及**读**档案来预告这次会用
 * 哪套配置。真正的回填由应用在创建窗口之前完成（electron/app/main.ts 的「启动决策」段）。
 *
 * 用法：
 *   node scripts/launch.mjs                       # 让应用自己决定（推荐）
 *   node scripts/launch.mjs -- --no-sandbox       # 显式指定，原样透传给 electron
 *   node scripts/launch.mjs -- --in-process-gpu   # 任意 electron 开关都行
 *   SSH_CORDIS_LAUNCH_VERIFY=1 node scripts/launch.mjs   # 等到日志出现终态再退出
 */
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const mainScript = join(projectRoot, manifest.main)
const logPath = join(projectRoot, 'dist', 'launch.log')

if (!existsSync(mainScript)) {
  console.error(`找不到 ${mainScript}，先跑 npm run build。`)
  process.exit(1)
}

const extra = process.argv.slice(2).filter((arg) => arg !== '--')

const env = { ...process.env }
// 宿主环境预设了这个，会让 electron 二进制退化成普通 Node（没有窗口）
delete env.ELECTRON_RUN_AS_NODE

// ─────────────────────────── 预告：这次会用哪套配置 ───────────────────────────

/** 与 electron/app/main.ts 保持一致：环境变量优先，否则 ~/.ssh-cordis */
const dataDir = env.SSH_CORDIS_DATA_DIR ? resolve(env.SSH_CORDIS_DATA_DIR) : join(homedir(), '.ssh-cordis')

/*
 * 用动态 import 而不是顶层静态 import：dist 还没构建时，静态 import 会以
 * ERR_MODULE_NOT_FOUND 直接炸掉，上面那句「先跑 npm run build」就永远说不出口。
 * 这里读的是编译产物，也就是**应用自己用的那份逻辑**，不复制一份判断规则——
 * 复制出来的规则迟早会和真身走散。
 */
const { readLaunchProfile, planProfileSwitches, describeLaunchProfile, launchProfilePath } = await import(
  new URL('../dist/electron/runtime/launch-profile.js', import.meta.url).href
)

const profileFile = launchProfilePath(dataDir)
const profile = readLaunchProfile(profileFile)
const existingSwitches = extra
  .filter((arg) => arg.startsWith('--'))
  .map((arg) => arg.replace(/^--/, '').split('=')[0])
const fromProfile = planProfileSwitches({ profile, existingSwitches, env })

if (env.SSH_CORDIS_NO_LAUNCH_PROFILE === '1') {
  console.log('启动档案：已按 SSH_CORDIS_NO_LAUNCH_PROFILE=1 关闭读写。')
} else if (profile) {
  console.log(`启动档案：${describeLaunchProfile(profile)}`)
  console.log(`          ${profileFile}`)
} else {
  console.log(`启动档案：无（首次运行，或文件损坏 / 版本不符）：${profileFile}`)
}

console.log(
  fromProfile.length
    ? `按档案回填：${fromProfile.map((name) => `--${name}`).join(' ')}（应用会在建窗口之前自己追加，不是这个脚本加的）`
    : '按档案回填：无。要不要放宽沙箱，交给应用自己判断。',
)

// ─────────────────────────── 启动 ───────────────────────────

const log = openSync(logPath, 'w')
const child = spawn(electronPath, [mainScript, ...extra], {
  cwd: projectRoot,
  env,
  detached: true,
  stdio: ['ignore', log, log],
})
child.unref()

console.log(`已启动：pid=${child.pid}  透传参数=${extra.join(' ') || '(无)'}`)
console.log(`日志：${logPath}`)

if (env.SSH_CORDIS_LAUNCH_VERIFY !== '1') process.exit(0)

// ─────────────────────────── 启动后验证 ───────────────────────────
//
// 为什么不只盯 pid：受限环境里第一次启动会走「失败 → 自动带上 --no-sandbox 重启」，
// 重启必然换 pid。盯着旧 pid 只会得出「已消失 ❌」这个错误结论——明明应用已经在
// 第二代里跑起来了。所以改成看日志里的**终态**，pid 只当辅助线索。
//
// pid 仍然有用：在这个脚本自己还活着的时候，子进程不该被宿主回收。
// 所以「还没出现回退迹象、pid 就没了」= 真的崩了，可以立刻收工，不必等满超时。

const waitSeconds = Number(env.SSH_CORDIS_LAUNCH_WAIT) || 60
const deadlineMs = Math.max(5, waitSeconds) * 1000
const READY_MARKER = '[main] 闸门已打开'
const FALLBACK_MARKER = '将以 --no-sandbox 重启一次'
const APPLIED_MARKER = '本次启动前直接带上'
const COMMIT_MARKER = '启动档案已更新'
const FAILURE_MARKERS = ['[BOOT-FAIL]', '自动重启失败']

const alive = (pid) => {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    return out.includes(String(pid))
  } catch {
    return false
  }
}

const readLog = () => {
  try {
    return readFileSync(logPath, 'utf8')
  } catch {
    return ''
  }
}

const startedAt = Date.now()
let text = ''
let outcome = null
let relaunched = false
let lastLivenessCheck = 0

while (Date.now() - startedAt < deadlineMs) {
  await new Promise((done) => setTimeout(done, 500))
  text = readLog()

  if (text.includes(READY_MARKER)) {
    outcome = 'ok'
    break
  }
  const failed = FAILURE_MARKERS.find((marker) => text.includes(marker))
  if (failed) {
    outcome = 'fail'
    break
  }
  if (text.includes(FALLBACK_MARKER)) relaunched = true

  const now = Date.now()
  if (!relaunched && now - lastLivenessCheck >= 2_000) {
    lastLivenessCheck = now
    if (!alive(child.pid)) {
      outcome = 'died'
      break
    }
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

if (outcome === 'ok') {
  const route = relaunched
    ? '第一代起不来 → 自动带上 --no-sandbox 重启'
    : text.includes(APPLIED_MARKER)
      ? '按启动档案直接带上开关，省掉了失败那一轮'
      : '沙箱完好，一次成功'
  console.log(`\n✅ 应用已就绪（${elapsed}s）`)
  console.log(`   恢复路径：${route}`)
  console.log(`   档案提交：${text.includes(COMMIT_MARKER) ? '已写（在表面确认可用之后）' : '未写（档案被关掉，或渲染层没回报）'}`)
} else if (outcome === 'fail') {
  console.log(`\n❌ 启动失败（${elapsed}s），日志里出现了失败标记。`)
} else if (outcome === 'died') {
  console.log(`\n❌ 进程在还没有任何回退迹象时就不见了（${elapsed}s，pid=${child.pid}）。`)
  console.log('   这不是被宿主回收——这个脚本还活着，子进程不该被收。按崩溃处理。')
} else {
  console.log(`\n⚠️  ${waitSeconds}s 内没等到终态：pid=${child.pid} ${alive(child.pid) ? '仍在' : '已不在'}。`)
}

console.log('--- launch.log ---')
console.log(text.trim() || '(空)')

process.exit(outcome === 'ok' ? 0 : 1)

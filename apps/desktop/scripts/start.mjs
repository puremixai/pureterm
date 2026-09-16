import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

/**
 * 不经过 npm 的启动入口：`node scripts/start.mjs`
 *
 * 为什么需要它：本机 npm 的入口在三种 shell 里各有各的毛病，`npm start` 不一定能跑起来——
 *   - Git Bash：无扩展名的 `npm` 是 `#!/usr/bin/env bash` 脚本，而 shim 里没有 /usr/bin/env，
 *     报 `No such file or directory`（这句话看着像「npm 没装」，其实不是）。
 *   - PowerShell：解析到 `npm.ps1`，受执行策略约束。
 *   - cmd.exe：得靠 `npm.cmd`，能用，但那是三条路里唯一一条。
 * 而 `node` 一定在 PATH 上（本机就是 managed node）。所以把入口收在 node 上，
 * 三种 shell 下都是同一条命令：
 *
 *   node scripts/start.mjs
 *
 * 参数原样透传给 electron：`node scripts/start.mjs -- --no-sandbox`
 *
 * 与 launch.mjs 的分工：
 *   - start.mjs（本文件）：**前台**跑，日志就在你眼前，Ctrl+C 结束。对应 `npm start`。
 *   - launch.mjs：**脱离终端**跑，日志落 dist/launch.log，关掉终端也不退出。
 * 两者都不做开关决策——那归应用自己（platform-plan.ts + launch-profile.ts）。
 *
 * 环境变量：
 *   SSH_CORDIS_SKIP_BUILD=1   跳过构建直接用 dist/（默认每次都构建，和 npm start 一致）
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeExe = process.execPath
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const mainScript = join(projectRoot, manifest.main)

const env = { ...process.env }
// 宿主环境可能预设了这个，会让 electron 二进制退化成普通 Node（没有窗口）
delete env.ELECTRON_RUN_AS_NODE

/** 根构建器按共享包依赖顺序构建，不依赖 npm 的 shell shim。 */
function build() {
  const steps = [
    { name: 'build:desktop', script: join(projectRoot, '..', '..', 'scripts', 'build.mjs'), args: ['--desktop'] },
  ]

  for (const step of steps) {
    if (!existsSync(step.script)) {
      console.error(`找不到 ${step.script}，先跑一次 npm install（缺依赖）。`)
      process.exit(1)
    }
    const result = spawnSync(nodeExe, [step.script, ...step.args], {
      cwd: projectRoot,
      stdio: 'inherit',
      env,
    })
    if (result.status !== 0) {
      console.error(`[start] ${step.name} 失败（退出码 ${result.status}），中止启动。`)
      process.exit(result.status ?? 1)
    }
  }
}

if (env.SSH_CORDIS_SKIP_BUILD === '1') {
  if (!existsSync(mainScript)) {
    console.error(`SSH_CORDIS_SKIP_BUILD=1 但 ${mainScript} 不存在，去掉这个变量再跑。`)
    process.exit(1)
  }
  console.log('[start] 跳过构建（SSH_CORDIS_SKIP_BUILD=1）')
} else {
  build()
}

const extra = process.argv.slice(2).filter((arg) => arg !== '--')
console.log(`[start] 启动 electron：${mainScript}${extra.length ? ' ' + extra.join(' ') : ''}`)

// 前台跑，stdio 直接继承：日志就在用户眼前，Ctrl+C 能结束。
// 不用 app.relaunch() / detached ——那是 launch.mjs 的活，这里要的就是「看得见」。
const child = spawn(electronPath, [mainScript, ...extra], {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
})

// 用 close 而不是 exit：exit 可能早于最后一块输出被读到（比如 [BOOT-OK] 这种尾行）
const code = await new Promise((resolve) => {
  child.on('close', resolve)
  child.on('error', (error) => {
    console.error(`[start] 无法启动 electron：${error.message}`)
    resolve(1)
  })
})

process.exit(code ?? 0)

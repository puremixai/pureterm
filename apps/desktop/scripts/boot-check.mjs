import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, reportElectronResult, runElectron } from './electron-runner.mjs'

// Exercise the production main, preload and renderer from a temporary cwd/profile.
// The hidden test entry only prevents focus stealing and isolates Electron userData.
// Automatic detached sandbox fallback is disabled by the shared runner so every
// process remains owned and can be reclaimed on timeout. Explicit switches still work.
// Exit codes: 0 verified startup, 1 failure, 2 unavailable native Electron environment.
const switches = (process.env.SSH_CORDIS_BOOT_SWITCHES ?? '').split(/\s+/).filter(Boolean)
const shotPath = resolve(process.env.SSH_CORDIS_BOOT_SHOT ?? join(projectRoot, 'dist', 'boot-check.png'))

console.log(`[boot] 启动隔离自检（隐藏窗口${switches.length ? `，额外开关 ${switches.join(' ')}` : ''}）…`)
let screenshotCreated = false
const result = await runElectron({
  entry: fileURLToPath(new URL('../tests/electron-boot-entry.mjs', import.meta.url)),
  env: { SSH_CORDIS_BOOT_CHECK: '1', SSH_CORDIS_BOOT_SHOT: shotPath },
  switches,
  timeoutMs: 60_000,
  successMarker: '[BOOT-OK]',
  requiredMarkers: ['[main] 闸门已打开'],
  inspect: ({ output }) => { screenshotCreated = output.includes(`[boot] 已截图窗口内容：${shotPath}`) },
})
reportElectronResult('boot', result)
if (result.code === 0 && screenshotCreated && existsSync(shotPath)) console.log(`窗口截图：${shotPath}`)

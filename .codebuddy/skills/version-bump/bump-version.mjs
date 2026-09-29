#!/usr/bin/env node
/**
 * PureTerm 版本号推进：把「改 VERSION.txt + 全部 workspace package.json +
 * package-lock.json」这一步机械化，再跑两个生成器，最后交给 release:check 兜底。
 *
 * 用法：
 *   node bump-version.mjs 0.1.0-alpha.2 [--dry-run] [--force]
 *
 * 它**刻意不做**下面这些，因为它们需要判断而不是机械替换：
 *   - 把 [Unreleased] 的条目挪进带日期的版本段（CHANGELOG.md 与 CHANGELOG_zh.md 都要）
 *   - 判断这个版本该不该发、阶段推进是否合规
 *   - 打 tag、推 tag、触发发布流程
 *
 * 为什么需要这个脚本：`scripts/convert-changelog.js --sync-version` 只读
 * VERSION.txt 写 packages/ui/src/lib/version.ts，它**不碰任何 package.json 或
 * lockfile**。版本号要动的地方一共九处（VERSION.txt、七个 manifest、lockfile），
 * 手工同步漏一处就只能靠 `npm run release:check` 报错时才发现。
 *
 * 幂等性与安全性：所有 JSON 文件都用 `JSON.stringify(value, null, 2) + '\n'`
 * 回写——实测这八个文件当前正是这个格式，因此除了版本号本身不会产生任何 diff。
 * `--dry-run` 只报告将要改什么，一个字节都不写。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 从当前目录向上找到仓库根：同时有 VERSION.txt 与 scripts/changelog.mjs 的那一层。 */
function findRoot(start) {
  let directory = start
  for (;;) {
    if (existsSync(join(directory, 'VERSION.txt')) && existsSync(join(directory, 'scripts', 'changelog.mjs'))) return directory
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`不是 PureTerm 仓库：从 ${start} 向上找不到 VERSION.txt 与 scripts/changelog.mjs`)
    directory = parent
  }
}

/** SemVer 2.0.0 优先级比较。只比较，不解析 build metadata（它不参与排序）。 */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] }
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    const left = a.pre[i]
    const right = b.pre[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) { if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1; continue }
    // 数字标识符的优先级低于字母标识符。
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

const argv = process.argv.slice(2)
const flags = new Set(argv.filter(item => item.startsWith('--')))
const positional = argv.filter(item => !item.startsWith('--'))
const unknown = [...flags].filter(item => !['--dry-run', '--force'].includes(item))
if (unknown.length || positional.length !== 1) {
  console.error('用法: node bump-version.mjs <新版本> [--dry-run] [--force]')
  console.error('  例: node bump-version.mjs 0.1.0-alpha.2')
  process.exit(2)
}
const next = positional[0]
const dryRun = flags.has('--dry-run')
const force = flags.has('--force')

const root = findRoot(process.cwd())
const changelog = await import(pathToFileURL(join(root, 'scripts', 'changelog.mjs')).href)

const relativeToRoot = absolute => relative(root, absolute).split(sep).join('/')

if (!changelog.VERSION_PATTERN.test(next)) {
  console.error(`无效版本号: ${next}`)
  console.error('版本号必须是 SemVer 2.0.0，例如 0.1.0-alpha.2、0.1.0-beta.1、0.1.0-rc.1、0.1.0。')
  process.exit(1)
}

const current = changelog.readSourceVersion(root)
const manifests = changelog.readProjectVersions(root)
const currentParsed = parseVersion(current)
const nextParsed = parseVersion(next)

// 已发布的版本号绝不复用：changelog 里已经有这个版本段就停下。
const existing = changelog.readChangelog(root).entries.find(entry => entry.version === next)
if (existing && !force) {
  console.error(`CHANGELOG.md 里已经有 [${next}] 版本段（日期 ${existing.date ?? '缺失'}）。`)
  console.error('已发布的版本号不复用。确认要重做请加 --force。')
  process.exit(1)
}
if (compareVersions(nextParsed, currentParsed) === 0 && !force) {
  console.error(`版本号已经是 ${current}，没有可推进的东西。`)
  process.exit(1)
}
if (compareVersions(nextParsed, currentParsed) < 0 && !force) {
  console.error(`新版本 ${next} 低于当前版本 ${current}。`)
  console.error('版本号只能向前推进。确认要回退请加 --force。')
  process.exit(1)
}

// lockfile 里的 key 是相对仓库根、以 / 分隔的目录，根 manifest 的 key 是空串。
const lockKeyOf = manifest => {
  const path = relativeToRoot(manifest.path)
  if (path === 'package.json') return ''
  return path.slice(0, -'package.json'.length).replace(/[\\/]+$/, '')
}

const lockPath = join(root, 'package-lock.json')
if (!existsSync(lockPath)) {
  console.error(`缺少 lockfile: ${lockPath}`)
  process.exit(1)
}
const lockfile = JSON.parse(readFileSync(lockPath, 'utf8'))
for (const manifest of manifests) {
  const key = lockKeyOf(manifest)
  if (lockfile.packages?.[key] === undefined) {
    console.error(`package-lock.json 里没有 ${key || '(root)'} 这一项，lockfile 与 workspace 已经不同步。`)
    console.error('先跑一次 `npm install` 让 lockfile 追上，再重试。')
    process.exit(1)
  }
}

const targets = [
  join(root, 'VERSION.txt'),
  ...manifests.map(manifest => manifest.path),
  lockPath,
]

if (dryRun) {
  console.log(`[dry-run] ${current} → ${next}`)
  console.log(`  VERSION.txt`)
  for (const manifest of manifests) console.log(`  ${relativeToRoot(manifest.path).padEnd(30)} ${manifest.name}  ${manifest.version} → ${next}`)
  console.log(`  package-lock.json              ${manifests.length} 个 packages 项 + 顶层 version`)
  console.log('未写入任何文件。去掉 --dry-run 才会真正执行。')
  process.exit(0)
}

writeFileSync(join(root, 'VERSION.txt'), `${next}\n`, 'utf8')
for (const manifest of manifests) {
  const value = JSON.parse(readFileSync(manifest.path, 'utf8'))
  value.version = next
  writeFileSync(manifest.path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
lockfile.version = next
if (lockfile.packages?.[''] !== undefined) lockfile.packages[''].version = next
for (const manifest of manifests) lockfile.packages[lockKeyOf(manifest)].version = next
writeFileSync(lockPath, `${JSON.stringify(lockfile, null, 2)}\n`, 'utf8')

console.log(`${current} → ${next}`)
console.log(`  写入 ${targets.length} 个文件：VERSION.txt、${manifests.length} 个 manifest、package-lock.json`)

// 两个生成器，然后是权威的一致性检查。
const { spawnSync } = await import('node:child_process')
for (const args of [['scripts/convert-changelog.js'], ['scripts/convert-changelog.js', '--sync-version'], ['scripts/changelog.mjs', '--check']]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`\n失败：node ${args.join(' ')}（退出码 ${result.status}）`)
    process.exit(result.status ?? 1)
  }
}

console.log(`
版本号已同步。还需要手工完成的部分——脚本不会替你做：

  1. 把 CHANGELOG.md 里 [Unreleased] 的条目挪进新的 \`## [${next}] - <日期>\` 段。
  2. 在 CHANGELOG_zh.md 里做同样的搬运，保持完整镜像。
  3. 提交（两个 changelog + VERSION.txt + 七个 manifest + lockfile + 两个生成产物）。
  4. 只有 \`npm run verify\`、\`npm run verify:electron\` 和 Windows 包验收都过了才打 tag。
     源码版本不带 v，tag 带：\`git tag v${next}\`。`)

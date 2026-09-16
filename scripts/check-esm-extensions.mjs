import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * 为什么需要这个检查：
 * cordis 4.0.0-rc.10 的 .d.ts 用的是无扩展名相对导入（export * from './context'），
 * 在 moduleResolution: NodeNext 下会被静默丢弃，导致 Service/Context 全部“不存在”。
 * 所以本项目改用 Bundler 解析。代价是 tsc 不再强制“相对导入必须带 .js 后缀”，
 * 而这恰恰是 Node ESM 的硬要求 —— 于是用这个脚本把这条约束补回来。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targets = ['packages/host/src', 'packages/protocol/src', 'packages/transport/src', 'apps/web/src', 'apps/desktop/electron']
const allowed = ['.js', '.cjs', '.mjs', '.json']
const pattern = /(?:from\s*|import\s*\(\s*|import\s+)['"](\.[^'"]*)['"]/g

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (full.endsWith('.ts')) files.push(full)
  }
  return files
}

const offenders = []
for (const target of targets) {
  for (const file of walk(join(root, target))) {
    if (file.endsWith('.d.ts')) continue
    const relativeFile = relative(root, file).replace(/\\/g, '/')
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1]
      if (allowed.some((extension) => specifier.endsWith(extension))) continue
      offenders.push(`${relativeFile}: ${specifier}`)
    }
  }
}

if (offenders.length) {
  console.error('以下相对导入缺少显式扩展名（Node ESM 会 ERR_MODULE_NOT_FOUND）：')
  for (const offender of offenders) console.error(`  - ${offender}`)
  process.exit(1)
}

console.log('ok  相对导入全部带显式扩展名（Node ESM 可解析）')

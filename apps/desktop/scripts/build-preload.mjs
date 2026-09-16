import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'dist', 'electron', 'carriers')

mkdirSync(outDir, { recursive: true })

/*
 * preload 必须打成 CommonJS：
 * Electron 的 preload 会忽略 package.json 的 "type": "module"，
 * 想让 preload 用 ESM 就必须叫 .mjs 且 sandbox: false。
 * 打成 .cjs 可以保住 sandbox: true —— 安全性优先。
 */
await build({
  entryPoints: [join(root, 'electron', 'carriers', 'preload.ts')],
  outfile: join(outDir, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
})

console.log('[build:preload] 产物: dist/electron/carriers/preload.cjs (CommonJS)')

import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'dist', 'renderer')

mkdirSync(outDir, { recursive: true })

const result = await build({
  entryPoints: [join(root, 'renderer', 'app.ts')],
  outfile: join(outDir, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  metafile: true,
})

// HTML 与产物放在同一目录，script/link 用同目录相对路径，避免“两套路径互相矛盾”
copyFileSync(join(root, 'renderer', 'index.html'), join(outDir, 'index.html'))

const outputs = Object.keys(result.metafile.outputs)
console.log('[build:renderer] 产物:', outputs.map((p) => p.replace(root, '')).join(', '))

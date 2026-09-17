import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../packages/ui')
mkdirSync(resolve(root, 'dist'), { recursive: true })
await build({
  entryPoints: [resolve(root, 'src/app.ts')], outfile: resolve(root, 'dist/app.js'),
  bundle: true, format: 'esm', platform: 'browser', target: ['chrome120'],
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  sourcemap: true, logLevel: 'info',
})
copyFileSync(resolve(root, 'src/index.html'), resolve(root, 'dist/index.html'))

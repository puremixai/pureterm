import { build } from 'esbuild'
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runElectron, reportElectronResult } from '../../../apps/desktop/scripts/electron-runner.mjs'

/*
 * 真实样式布局冒烟。和生命周期冒烟不同，这一支**保留构建产物里的 CSS 和字体**：
 * 把 packages/ui/dist/ 整个复制到临时目录，只把应用脚本换成布局夹具的 bundle，
 * 于是量到的是真正会画到屏幕上的几何。
 *
 * 单独运行时先 `npm run build:shared`；verify:electron 总入口里已经有构建步骤。
 */
const parent = await mkdtemp(join(tmpdir(), 'pureterm-session-tools-layout-'))
const directory = join(parent, 'app')
try {
  await cp(fileURLToPath(new URL('../dist/', import.meta.url)), directory, { recursive: true })
  await build({ entryPoints: [fileURLToPath(new URL('./session-tools-layout.browser.ts', import.meta.url))], bundle: true,
    outfile: join(directory, 'layout.js'), format: 'iife', platform: 'browser', target: 'chrome120' })
  const html = (await readFile(join(directory, 'index.html'), 'utf8'))
    .replace('<script type="module" src="./app.js"></script>', '<script src="./layout.js"></script>')
  await writeFile(join(directory, 'index.html'), html)
  const result = await runElectron({ entry: fileURLToPath(new URL('./session-tools-layout-entry.mjs', import.meta.url)),
    env: { PURETERM_LAYOUT_TEST_HTML: join(directory, 'index.html') },
    requiredMarkers: ['[SESSION-TOOLS-LAYOUT]'], timeoutMs: 180_000 })
  reportElectronResult('session-tools-layout', result)
} finally { await rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }

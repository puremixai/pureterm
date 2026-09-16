import { build } from 'esbuild'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runElectron, reportElectronResult } from '../../../apps/desktop/scripts/electron-runner.mjs'

const directory = await mkdtemp(join(tmpdir(), 'pureterm-client-lifecycle-'))
try {
  await build({ entryPoints: [fileURLToPath(new URL('./client-lifecycle.browser.ts', import.meta.url))], bundle: true,
    outfile: join(directory, 'lifecycle.js'), format: 'iife', platform: 'browser', target: 'chrome120' })
  const html = (await readFile(new URL('../src/index.html', import.meta.url), 'utf8'))
    .replace('<link rel="stylesheet" href="./app.css" />', '')
    .replace('<script type="module" src="./app.js"></script>', '<script src="./lifecycle.js"></script>')
  await writeFile(join(directory, 'index.html'), html)
  const result = await runElectron({ entry: fileURLToPath(new URL('./client-lifecycle-entry.mjs', import.meta.url)),
    env: { PURETERM_CLIENT_TEST_HTML: join(directory, 'index.html') }, requiredMarkers: ['[CLIENT-CHECK]'] })
  reportElectronResult('client-lifecycle', result)
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }

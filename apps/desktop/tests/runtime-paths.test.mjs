import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const application = fileURLToPath(new URL('..', import.meta.url))
const pathsModule = new URL('../dist/electron/runtime/paths.js', import.meta.url)

test('runtime asset paths are independent of the launch working directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pureterm-other-cwd-'))
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      'const { resolveDesktopPaths } = await import(process.argv[1]); console.log(JSON.stringify(resolveDesktopPaths()))',
      pathsModule.href], { cwd, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      distDir: join(application, 'dist'),
      rendererDir: fileURLToPath(new URL('.', import.meta.resolve('@pureterm/ui/index.html'))).replace(/[\\/]$/, ''),
      rendererHtml: fileURLToPath(import.meta.resolve('@pureterm/ui/index.html')),
      preloadScript: join(application, 'dist', 'electron', 'carriers', 'preload.cjs'),
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a clean build supplies the package entry, renderer references and CommonJS preload', async () => {
  const { resolveDesktopPaths } = await import(pathsModule.href)
  const paths = resolveDesktopPaths()
  const manifest = JSON.parse(readFileSync(join(application, 'package.json'), 'utf8'))
  for (const path of [join(application, manifest.main), paths.rendererHtml, paths.preloadScript]) {
    assert.ok(existsSync(path), `Missing built runtime artifact: ${path}`)
  }
  const html = readFileSync(paths.rendererHtml, 'utf8')
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) {
    assert.ok(existsSync(join(paths.rendererDir, match[1])), `Missing renderer asset: ${match[1]}`)
  }
  // The sandboxed preload is CJS; Node must be able to parse it as such.
  const parsed = spawnSync(process.execPath, ['--check', paths.preloadScript], { encoding: 'utf8' })
  assert.equal(parsed.status, 0, parsed.stderr)
})

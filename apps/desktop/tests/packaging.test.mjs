import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { stageDesktop } from '../../../scripts/stage-desktop.mjs'

function write(root, name, content) {
  const file = join(root, name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pureterm-package-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, 'package.json', { version: '0.2.0', private: true, workspaces: ['apps/*', 'packages/*'] })
  write(root, 'apps/desktop/package.json', {
    name: '@pureterm/desktop', version: '0.2.0', type: 'module', main: 'dist/electron/app/main.js',
    dependencies: { '@pureterm/host': '*', '@pureterm/protocol': '*', '@pureterm/transport': '*', '@pureterm/ui': '*', 'electron-updater': '6.8.9' },
  })
  write(root, 'apps/desktop/dist/electron/app/main.js', "import { values } from '@pureterm/host'; console.log(JSON.stringify(values))")
  write(root, 'apps/desktop/dist/electron/host/entry.js', "import '@pureterm/host'")
  write(root, 'apps/desktop/dist/electron/carriers/preload.cjs', '// preload')
  for (const name of ['host', 'protocol', 'transport', 'ui']) {
    write(root, `packages/${name}/package.json`, {
      name: `@pureterm/${name}`, version: '0.2.0', type: 'module', exports: name === 'ui' ? { './index.html': './dist/index.html' } : './dist/index.js',
      dependencies: name === 'host' ? { cordis: '^4.0.0-rc.10', ssh2: '^1.17.0' } : name === 'ui' ? { missingBrowserOnlyDependency: '*' } : {},
    })
    write(root, `packages/${name}/dist/index.js`, '// compiled module')
    write(root, `packages/${name}/src/unshipped.ts`, '// source must stay outside package')
  }
  write(root, 'packages/host/dist/index.js', "import cordis from 'cordis'; import ssh from 'ssh2'; export const values = [cordis, ssh]")
  write(root, 'packages/ui/dist/index.html', '<script src="./app.js"></script>')
  write(root, 'packages/ui/dist/app.js', '// bundled frontend')
  for (const [name, version, dependencies] of [
    ['cordis', '4.0.0-rc.10', { shared: '^1.0.0' }],
    ['ssh2', '1.17.0', { shared: '^2.0.0' }],
    ['electron-updater', '6.8.9', {}],
    ['shared', '1.0.0', {}],
    ['ssh2/node_modules/shared', '2.0.0', {}],
  ]) {
    write(root, `node_modules/${name}/package.json`, {
      name: name.split('/').at(-1), version, main: 'index.js', dependencies,
      optionalDependencies: name === 'ssh2' ? { 'cpu-features': '*' } : {},
    })
    write(root, `node_modules/${name}/index.js`, name === 'cordis' || name === 'ssh2' ? "module.exports = require('shared')" : `module.exports = '${version}'`)
    write(root, `node_modules/${name}/LICENSE`, 'Fixture license')
  }
  write(root, 'node_modules/ssh2/lib/crypto/build/Release/sshcrypto.node', 'not a real native binary')
  write(root, 'node_modules/ssh2/lib/crypto/poly1305.js', '// runtime resource')
  write(root, 'node_modules/cpu-features/package.json', { name: 'cpu-features', version: '0.0.10' })
  write(root, 'node_modules/cpu-features/index.js', "throw new Error('optional dependency must not load')")
  return root
}

test('staging is self-contained, preserves nested dependency versions and excludes optional native modules', t => {
  const root = fixture(t)
  const staged = stageDesktop(root)
  const manifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies['electron-updater'], '6.8.9')
  assert.equal(manifest.dependencies['@pureterm/host'], '0.2.0')
  assert.equal(existsSync(join(staged, 'node_modules/@pureterm/host/src')), false)
  assert.equal(existsSync(join(staged, 'node_modules/cpu-features')), false)
  assert.equal(existsSync(join(staged, 'node_modules/@pureterm/host/node_modules/ssh2/lib/crypto/build/Release/sshcrypto.node')), false)
  const externalFiles = []
  function walk(directory) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      assert.equal(lstatSync(path).isSymbolicLink(), false, path)
      if (lstatSync(path).isDirectory()) walk(path)
      else externalFiles.push(path)
    }
  }
  walk(staged)
  assert.ok(externalFiles.some(file => file.endsWith('poly1305.js')))
  assert.ok(externalFiles.some(file => file.endsWith('LICENSE')))
  assert.ok(externalFiles.every(file => !file.endsWith('.node')))
  assert.deepEqual(JSON.parse(readFileSync(join(staged, 'node_modules/@pureterm/ui/package.json'), 'utf8')).dependencies, {})
  const result = spawnSync(process.execPath, [join(staged, manifest.main)], { cwd: tmpdir(), encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), ['1.0.0', '2.0.0'])
  const asset = spawnSync(process.execPath, ['--input-type=module', '-e', `console.log(import.meta.resolve('@pureterm/ui/index.html', ${JSON.stringify(pathToFileURL(join(staged, manifest.main)).href)}))`], { cwd: staged, encoding: 'utf8', windowsHide: true })
  assert.equal(asset.status, 0, asset.stderr)
  assert.ok(asset.stdout.includes('/.release/app/node_modules/@pureterm/ui/dist/index.html'))
})

test('missing installed production dependencies fail staging rather than shipping an incomplete app', t => {
  const root = fixture(t)
  rmSync(join(root, 'node_modules/electron-updater'), { recursive: true })
  assert.throws(() => stageDesktop(root), /Missing installed dependency: electron-updater/)
})

test('staging requires the separately built Host child entry', t => {
  const root = fixture(t)
  rmSync(join(root, 'apps/desktop/dist/electron/host/entry.js'))
  assert.throws(() => stageDesktop(root), /Missing built runtime artifact.*host.*entry/)
})

test('dependency links cannot silently escape into the packaged application', t => {
  const root = fixture(t)
  symlinkSync(join(root, 'packages/ui'), join(root, 'node_modules/cordis/linked-source'), 'junction')
  assert.throws(() => stageDesktop(root), /Unexpected symbolic link/)
})

test('a linked staging parent is rejected before writing or deleting outside the workspace', t => {
  const root = fixture(t)
  const outside = mkdtempSync(join(tmpdir(), 'pureterm-package-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  write(outside, 'app/keep.txt', 'do not delete')
  symlinkSync(outside, join(root, '.release'), 'junction')
  assert.throws(() => stageDesktop(root), /Staging directory must stay inside/)
  assert.equal(readFileSync(join(outside, 'app/keep.txt'), 'utf8'), 'do not delete')
})

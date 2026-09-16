import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const mode = process.argv[2]
if (process.argv.length > 3 || (mode && !['--shared', '--web', '--desktop'].includes(mode))) throw new Error('Usage: node scripts/build.mjs [--shared|--web|--desktop]')
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
function clean(project) {
  const target = resolve(root, project, 'dist')
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Build output must stay in workspace')
  rmSync(target, { recursive: true, force: true })
}
function compile(project, config = 'tsconfig.json') {
  clean(project)
  run(require.resolve('typescript/bin/tsc'), ['-p', resolve(root, project, config)])
}
for (const name of ['protocol', 'host', 'transport']) compile(`packages/${name}`)
clean('packages/ui')
run(resolve(root, 'scripts/build-ui.mjs'))
if (mode !== '--shared' && mode !== '--desktop') compile('apps/web')
if (mode !== '--shared' && mode !== '--web') {
  compile('apps/desktop', 'tsconfig.main.json')
  run(resolve(root, 'apps/desktop/scripts/build-preload.mjs'))
}

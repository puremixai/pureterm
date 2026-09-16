import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
for (const config of ['packages/protocol', 'packages/host', 'packages/transport', 'packages/ui', 'apps/web', 'apps/desktop']) {
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', `${config}/tsconfig.json`, '--noEmit'], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
for (const script of ['check-boundaries', 'check-esm-extensions']) {
  const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

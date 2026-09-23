import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const checker = fileURLToPath(new URL('../../../scripts/check-boundaries.mjs', import.meta.url))

function check(files) {
  const root = mkdtempSync(join(tmpdir(), 'pureterm-boundaries-'))
  try {
    for (const directory of ['packages/host/src', 'packages/protocol/src', 'packages/ui/src', 'packages/transport/src', 'apps/web/src', 'apps/desktop/electron']) mkdirSync(join(root, directory), { recursive: true })
    for (const [name, source] of Object.entries(files)) {
      const path = join(root, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, source, 'utf8')
    }
    const result = spawnSync(process.execPath, [checker, '--root', root], { encoding: 'utf8' })
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('accepts Electron adapters and type-only access through the Host facade', () => {
  const result = check({
    'apps/desktop/electron/app/main.ts': "import { app } from 'electron'; import { createHost } from '@pureterm/host'",
    'apps/desktop/electron/carriers/preload.ts': "import { ipcRenderer, contextBridge } from 'electron'",
    'apps/desktop/electron/diagnostics/boot-check.ts': "import type { BrowserWindow } from 'electron'",
    'apps/desktop/electron/host/entry.ts': "import { createHost } from '@pureterm/host'; import '../runtime/process-rpc.js'",
    'packages/transport/src/dispatch.ts': "import type { Host } from '@pureterm/host'",
    'apps/web/src/server.ts': "import { startWebHost } from '@pureterm/transport/web-host'",
    'packages/host/src/host.ts': "import { Context } from 'cordis'",
    'packages/ui/src/app.ts': "import { Terminal } from '@xterm/xterm'; import type { SshApi } from '@pureterm/protocol'",
    'packages/protocol/src/protocol.ts': "export interface SshApi {} // import 'electron' is a comment",
  })
  assert.equal(result.status, 0, result.output)
})

const violations = [
  ['apps/desktop/electron/host/entry.ts', "import '../app/platform.js'", 'Node Host entry may only import'],
  ['apps/desktop/electron/host/entry.ts', "import { app } from 'electron'", 'Electron is restricted'],
  ['apps/web/src/main.ts', "import { app } from 'electron'", 'Electron is restricted'],
  ['apps/web/src/server.ts', "import '../../desktop/electron/app/main.js'", 'Relative source imports'],
  ['packages/host/src/host.ts', "import '@pureterm/transport/carrier-http'", 'allowed public export'],
  ['packages/transport/src/dispatch.ts', "import '@pureterm/host/dist/plugins/session-store.js'", 'allowed public export'],
  ['packages/host/src/ssh.ts', "import type { BrowserWindow } from 'electron'", 'Electron is restricted'],
  ['apps/desktop/electron/runtime/plan.ts', "export { app } from 'electron'", 'Electron is restricted'],
  ['packages/transport/src/dispatch.ts', "await import('electron')", 'Electron is restricted'],
  ['packages/transport/src/carrier-http.ts', "const electron = require('electron')", 'Electron is restricted'],
  ['apps/desktop/electron/runtime/plan.ts', "import { createRequire as cr } from 'node:module'; const load = cr(import.meta.url); load('electron')", 'Electron is restricted'],
  ['apps/desktop/electron/runtime/plan.ts', "import * as Module from 'node:module'; const load = Module.createRequire(import.meta.url); load('electron')", 'Electron is restricted'],
  ['apps/desktop/electron/runtime/plan.ts', "import Module from 'node:module'; const load = Module.createRequire(import.meta.url); load('electron')", 'Electron is restricted'],
  ['apps/desktop/electron/runtime/plan.ts', "import { createRequire } from 'node:module'; createRequire(import.meta.url)('electron')", 'Electron is restricted'],
  ['packages/host/src/ssh.ts', "import '../electron/app/main.js'", 'Relative source imports'],
  ['packages/ui/src/app.ts', "import { readFile } from 'node:fs'", 'Browser must not import'],
  ['packages/ui/src/app.ts', "import type { ReadStream } from 'fs'", 'Browser must not import'],
  ['packages/ui/src/app.ts', "import type { Host } from '@pureterm/host'", 'allowed public export'],
  ['packages/protocol/src/protocol.ts', "import type { Host } from '@pureterm/host'", 'Shared protocol must not import'],
  ['packages/transport/src/carrier-http.ts', "import type { RendererHandle } from '../../src/services/renderer.js'", 'Relative source imports'],
  ['packages/transport/src/dispatch.ts', "import '../app/main.js'", 'Relative source imports'],
  ['apps/desktop/electron/runtime/plan.ts', "import '../carriers/preload.js'", 'Runtime may only import'],
  ['apps/desktop/electron/app/main.ts', 'host.internals.ctx.ssh.connect()', 'Host.internals is diagnostics-only'],
  ['apps/desktop/electron/app/main.ts', "host['internals'].ctx.ssh.connect()", 'Host.internals is diagnostics-only'],
  ['apps/desktop/electron/app/main.ts', 'const { internals } = host; internals.ctx.ssh.connect()', 'Host.internals is diagnostics-only'],
  ['apps/desktop/electron/app/main.ts', 'const { internals: hidden } = host; hidden.ctx.ssh.connect()', 'Host.internals is diagnostics-only'],
  ['apps/desktop/electron/app/main.ts', "const { ['internals']: hidden } = host", 'Host.internals is diagnostics-only'],
  ['apps/desktop/electron/app/main.ts', 'let internals; ({ internals } = host)', 'Host.internals is diagnostics-only'],
  ['apps/desktop/electron/app/main.ts', 'let leaked; ({ internals: leaked } = host)', 'Host.internals is diagnostics-only'],
  ['packages/ui/src/app.ts', 'const moduleName = choose(); await import(moduleName)', 'Module specifier must be a literal'],
]

for (const [name, source, expected] of violations) {
  test(`rejects ${name}: ${source}`, () => {
    const result = check({ [name]: source })
    assert.equal(result.status, 1, result.output)
    assert.ok(result.output.includes(expected), result.output)
    assert.ok(result.output.includes(`${name}:`), result.output)
  })
}

test('checks a facade re-export instead of accepting a hidden transitive Electron dependency', () => {
  const result = check({
    'packages/ui/src/app.ts': "import '../shared/leak.js'",
    'packages/protocol/src/leak.ts': "export { app } from 'electron'",
  })
  assert.equal(result.status, 1)
  assert.match(result.output, /packages\/protocol\/src\/leak.ts:/)
})

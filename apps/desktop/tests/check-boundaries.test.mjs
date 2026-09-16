import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const checker = fileURLToPath(new URL('../scripts/check-boundaries.mjs', import.meta.url))

function check(files) {
  const root = mkdtempSync(join(tmpdir(), 'pureterm-boundaries-'))
  try {
    for (const directory of ['src', 'shared', 'renderer', 'electron']) mkdirSync(join(root, directory))
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
    'electron/app/main.ts': "import { app } from 'electron'; import { createHost } from '../../src/host.js'",
    'electron/carriers/carrier-ipc.ts': "import { ipcMain } from 'electron'",
    'electron/carriers/preload.ts': "import { contextBridge } from 'electron'",
    'electron/diagnostics/boot-check.ts': "import type { BrowserWindow } from 'electron'",
    'electron/bridge/dispatch.ts': "import type { Host } from '../../src/host.js'",
    'src/host.ts': "import { Context } from 'cordis'",
    'renderer/app.ts': "import { Terminal } from '@xterm/xterm'; import type { SshApi } from '../shared/protocol.js'",
    'shared/protocol.ts': "export interface SshApi {} // import 'electron' is a comment",
  })
  assert.equal(result.status, 0, result.output)
})

const violations = [
  ['src/ssh.ts', "import type { BrowserWindow } from 'electron'", 'Electron is restricted'],
  ['electron/runtime/plan.ts', "export { app } from 'electron'", 'Electron is restricted'],
  ['electron/bridge/dispatch.ts', "await import('electron')", 'Electron is restricted'],
  ['electron/carriers/carrier-http.ts', "const electron = require('electron')", 'Electron is restricted'],
  ['electron/runtime/plan.ts', "import { createRequire as cr } from 'node:module'; const load = cr(import.meta.url); load('electron')", 'Electron is restricted'],
  ['electron/runtime/plan.ts', "import * as Module from 'node:module'; const load = Module.createRequire(import.meta.url); load('electron')", 'Electron is restricted'],
  ['electron/runtime/plan.ts', "import Module from 'node:module'; const load = Module.createRequire(import.meta.url); load('electron')", 'Electron is restricted'],
  ['electron/runtime/plan.ts', "import { createRequire } from 'node:module'; createRequire(import.meta.url)('electron')", 'Electron is restricted'],
  ['src/ssh.ts', "import '../electron/app/main.js'", 'Host may only import'],
  ['renderer/app.ts', "import { readFile } from 'node:fs'", 'Browser must not import'],
  ['renderer/app.ts', "import type { ReadStream } from 'fs'", 'Browser must not import'],
  ['renderer/app.ts', "import type { Host } from '../src/host.js'", 'Browser may only import'],
  ['shared/protocol.ts', "import type { Host } from '../src/host.js'", 'Shared protocol must not import'],
  ['electron/carriers/carrier-http.ts', "import type { RendererHandle } from '../../src/services/renderer.js'", 'Use src/host.ts'],
  ['electron/bridge/dispatch.ts', "import '../app/main.js'", 'Bridge may only import'],
  ['electron/runtime/plan.ts', "import '../carriers/carrier-ipc.js'", 'Runtime may only import'],
  ['electron/app/main.ts', 'host.internals.ctx.ssh.connect()', 'Host.internals is diagnostics-only'],
  ['electron/app/main.ts', "host['internals'].ctx.ssh.connect()", 'Host.internals is diagnostics-only'],
  ['electron/app/main.ts', 'const { internals } = host; internals.ctx.ssh.connect()', 'Host.internals is diagnostics-only'],
  ['electron/app/main.ts', 'const { internals: hidden } = host; hidden.ctx.ssh.connect()', 'Host.internals is diagnostics-only'],
  ['electron/app/main.ts', "const { ['internals']: hidden } = host", 'Host.internals is diagnostics-only'],
  ['electron/app/main.ts', 'let internals; ({ internals } = host)', 'Host.internals is diagnostics-only'],
  ['electron/app/main.ts', 'let leaked; ({ internals: leaked } = host)', 'Host.internals is diagnostics-only'],
  ['renderer/app.ts', 'const moduleName = choose(); await import(moduleName)', 'Module specifier must be a literal'],
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
    'renderer/app.ts': "import '../shared/leak.js'",
    'shared/leak.ts': "export { app } from 'electron'",
  })
  assert.equal(result.status, 1)
  assert.match(result.output, /shared\/leak.ts:/)
})

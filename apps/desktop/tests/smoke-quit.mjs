import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createFakeSshServer } from './fake-ssh-server.mjs'
import { runElectron } from '../scripts/electron-runner.mjs'

/*
 * Ordinary-quit guard, end to end. One real Electron process opens one real SSH
 * session, then closes its window:
 *   - answered "cancel": the window, its webContents and the live session must all
 *     survive, and no Host stop may have happened;
 *   - answered "accept": the Host must stop and the application must exit cleanly.
 * The answer comes from SSH_CORDIS_QUIT_CONFIRM, the same seam the native dialog
 * would otherwise fill in; the isolated fake SSH server keeps this local.
 */
const server = await createFakeSshServer({ execOutput: '' })
const entry = fileURLToPath(new URL('./electron-quit-entry.mjs', import.meta.url))
const base = {
  SSH_CORDIS_SMOKE_HOST: server.host,
  SSH_CORDIS_SMOKE_PORT: String(server.port),
  SSH_CORDIS_SMOKE_USER: server.username,
  SSH_CORDIS_SMOKE_PASS: server.password,
}
let failed = false
const fail = (name, result) => {
  failed = true
  console.log(`[electron-quit-${name}] FAIL: ${result.reason} (exit=${result.exitCode}, signal=${result.signal})`)
}
try {
  const cancel = await runElectron({
    entry,
    env: { ...base, SSH_CORDIS_TEST_QUIT_MODE: 'cancel', SSH_CORDIS_QUIT_CONFIRM: 'cancel' },
    successMarker: '[QUIT-CANCEL-OK]',
    requiredMarkers: ['[main] Host child ready', '[QUIT-CANCEL-OK]'],
    timeoutMs: 90_000,
    inspect: ({ output }) => {
      const line = output.split(/\r?\n/).find(item => item.startsWith('[QUIT-CANCEL] '))
      assert.ok(line, 'missing structured cancel report')
      const report = JSON.parse(line.slice('[QUIT-CANCEL] '.length))
      assert.equal(report.alive, true, 'a cancelled close must leave the window alive')
      assert.equal(report.sameContents, true, 'the same webContents must survive a cancelled close')
      assert.equal(report.connected, 'connected', 'the SSH session must still be connected after a cancelled close')
      assert.ok(report.openedTabs >= 1, 'the fixture must have opened a session')
      assert.equal(report.tabs, report.openedTabs, 'the session tab must survive a cancelled close')
    },
  })
  if (cancel.code === 0) console.log('[electron-quit-cancel] PASS: a cancelled close kept the window, webContents and session alive')
  else fail('cancel', cancel)

  const accept = await runElectron({
    entry,
    env: { ...base, SSH_CORDIS_TEST_QUIT_MODE: 'accept', SSH_CORDIS_QUIT_CONFIRM: 'accept' },
    successMarker: '[QUIT-ACCEPT-STARTED]',
    requiredMarkers: ['[main] Host child ready', '[QUIT-ACCEPT-STARTED]', '[main] Host stopped; exiting.'],
    timeoutMs: 90_000,
  })
  if (accept.code === 0) console.log('[electron-quit-accept] PASS: an accepted close stopped the Host before application exit')
  else fail('accept', accept)
} finally {
  await server.close()
}
process.exitCode = failed ? 1 : 0

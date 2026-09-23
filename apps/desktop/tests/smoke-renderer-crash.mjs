import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createFakeSshServer } from './fake-ssh-server.mjs'
import { until } from './integration-helpers.mjs'
import { runElectron, reportElectronResult } from '../scripts/electron-runner.mjs'

const processExists = (pid) => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }
const server = await createFakeSshServer({ greeting: false })
try {
  const result = await runElectron({
    entry: fileURLToPath(new URL('./electron-renderer-crash-entry.mjs', import.meta.url)),
    env: { SSH_CORDIS_SMOKE: 'probe', SSH_CORDIS_SMOKE_HOST: server.host, SSH_CORDIS_SMOKE_PORT: String(server.port),
      SSH_CORDIS_SMOKE_USER: server.username, SSH_CORDIS_SMOKE_PASS: server.password },
    successMarker: '[RENDERER-CRASH-OK]',
    requiredMarkers: ['[main] 闸门已打开', '[RENDERER-CRASH-SESSION]', '[RENDERER-CRASH-OBSERVED]'],
    inspect: async ({ output }) => {
      const match = output.match(/Host 子进程已就绪 pid=(\d+) parent=(\d+)/)
      assert.ok(match, 'missing production Host process identity')
      const hostPid = Number(match[1])
      assert.notEqual(hostPid, Number(match[2]))
      await until(() => server.connections === 0, 'renderer-crash SSH cleanup')
      assert.equal(processExists(hostPid), false, 'the Host child survived application shutdown')
      assert.ok(output.indexOf('[RENDERER-CRASH-SESSION]') < output.indexOf('[RENDERER-CRASH-OBSERVED]'))
      assert.ok(output.indexOf('[RENDERER-CRASH-OBSERVED]') < output.indexOf('[RENDERER-CRASH-OK]'))
    },
  })
  reportElectronResult('electron-renderer-crash', result)
} finally {
  await server.close()
}

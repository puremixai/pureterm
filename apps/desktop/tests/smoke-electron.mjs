import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createFakeSshServer } from './fake-ssh-server.mjs'
import { runElectron, reportElectronResult } from '../scripts/electron-runner.mjs'

const server = await createFakeSshServer()
try {
  const result = await runElectron({
    entry: fileURLToPath(new URL('./electron-ipc-entry.mjs', import.meta.url)),
    env: { SSH_CORDIS_SMOKE: '1', SSH_CORDIS_SMOKE_HOST: server.host, SSH_CORDIS_SMOKE_PORT: String(server.port),
      SSH_CORDIS_SMOKE_USER: server.username, SSH_CORDIS_SMOKE_PASS: server.password },
    requiredMarkers: ['[main] 闸门已打开', '启动档案已更新'],
    inspect: ({ dataDir, output }) => {
      const profile = JSON.parse(readFileSync(join(dataDir, 'launch-profile.json'), 'utf8'))
      assert.equal(profile.version, 1)
      assert.ok(profile.renderer.cols > 0 && profile.renderer.rows > 0)
      assert.equal(profile.hosts, 0)
      assert.ok(output.indexOf('渲染层就绪上报') < output.indexOf('启动档案已更新'), 'profile committed before renderer-ready')
      const line = output.split(/\r?\n/).find(item => item.startsWith('[SMOKE] '))
      assert.ok(line, 'missing structured SSH report')
      const report = JSON.parse(line.slice('[SMOKE] '.length))
      assert.equal(report.preloadType, 'object')
      assert.equal(report.error, null)
      assert.equal(report.replacementChars, 0)
      assert.match(report.text, /你好，世界/)
      assert.match(report.text, /echo:ls/)
      assert.deepEqual(report.openedSize, { cols: 100, rows: 30 })
      assert.ok(report.sessionId && report.closedReason)
    },
  })
  reportElectronResult('electron-ipc', result)
} finally {
  await server.close()
}

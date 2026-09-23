import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createFakeSshServer } from './fake-ssh-server.mjs'
import { runElectron, reportElectronResult } from '../scripts/electron-runner.mjs'

const server = await createFakeSshServer({ keyAuthentication: true })
try {
  const result = await runElectron({
    entry: fileURLToPath(new URL('./electron-desktop-entry.mjs', import.meta.url)),
    env: { SSH_CORDIS_SMOKE: '1', SSH_CORDIS_SMOKE_HOST: server.host, SSH_CORDIS_SMOKE_PORT: String(server.port),
      SSH_CORDIS_SMOKE_USER: server.username, SSH_CORDIS_SMOKE_PASS: server.password, SSH_CORDIS_SMOKE_KEYCHAIN: server.hostKey.toString() },
    requiredMarkers: ['[main] 闸门已打开', '启动档案已更新', '[WINDOW-CHROME-OK]', '[DESKTOP-BOUNDARY-OK]', '[KEYCHAIN-WEB-OK]'],
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
      assert.equal(report.page, 'pureterm-app://app')
      assert.equal(report.carrier, 'web')
      assert.equal(report.error, null)
      assert.equal(report.replacementChars, 0)
      assert.match(report.text, /你好，世界/)
      assert.match(report.text, /echo:ls/)
      assert.deepEqual(report.openedSize, { cols: 100, rows: 30 })
      assert.ok(report.sessionId && report.closedReason)
      const keychain = readFileSync(join(dataDir, 'keychain.json'), 'utf8')
      assert.ok(!keychain.includes('PRIVATE KEY'))
      assert.ok(!keychain.includes(server.hostKey.toString().split('\n')[1]))
      assert.equal(JSON.parse(keychain).entries.length, 1)
      assert.ok(JSON.parse(keychain).entries[0].sealed)
      assert.ok(server.authentications.includes('publickey'))
    },
  })
  reportElectronResult('electron-desktop', result)
} finally {
  await server.close()
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createFakeSshServer } from './fake-ssh-server.mjs'
import { monitorProbe, READY_EXPECTATIONS } from './monitor-probe.mjs'
import { runElectron, reportElectronResult } from '../scripts/electron-runner.mjs'

// 夹具里放一个文件，好让监控验收在**同一条连接**上还能证明 SFTP 列目录是活的：
// 空目录列出来也是空，那分不清「列了」和「没列」。
const server = await createFakeSshServer({
  keyAuthentication: true,
  files: { 'monitor-fixture.txt': 'monitor fixture\n' },
  execOutput: monitorProbe(),
})
try {
  const result = await runElectron({
    entry: fileURLToPath(new URL('./electron-desktop-entry.mjs', import.meta.url)),
    env: { SSH_CORDIS_SMOKE: '1', SSH_CORDIS_SMOKE_MONITOR: '1',
      SSH_CORDIS_SMOKE_HOST: server.host, SSH_CORDIS_SMOKE_PORT: String(server.port),
      SSH_CORDIS_SMOKE_USER: server.username, SSH_CORDIS_SMOKE_PASS: server.password, SSH_CORDIS_SMOKE_KEYCHAIN: server.hostKey.toString() },
    requiredMarkers: ['[main] 闸门已打开', '启动档案已更新', '[WINDOW-CHROME-OK]', '[DESKTOP-BOUNDARY-OK]', '[KEYCHAIN-WEB-OK]', '[MONITOR-SMOKE-OK]'],
    // 监控验收要在一条连接上等两轮探测（第二轮补齐 CPU 与网络），比原来的流程长。
    timeoutMs: 90_000,
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
      // 监控验收：定值读数对着夹具的第二帧，网络速率只断言形状（它取决于真实间隔）。
      const monitorLine = output.split(/\r?\n/).find(item => item.startsWith('[MONITOR-SMOKE] '))
      assert.ok(monitorLine, 'missing structured monitor report')
      const monitor = JSON.parse(monitorLine.slice('[MONITOR-SMOKE] '.length))
      assert.equal(monitor.collapsed, true, 'the monitor row must start collapsed')
      assert.equal(monitor.beforeExpand, '已暂停', 'a collapsed row reports paused, not loading')
      assert.notEqual(monitor.facts.cipher, '—', 'the cipher cell must be filled from session facts')
      assert.notEqual(monitor.facts.key, '—', 'the host-key cell must be filled from session facts')
      assert.equal(monitor.first, READY_EXPECTATIONS.memory, 'the first snapshot is already partial')
      assert.equal(monitor.ready.cpu, READY_EXPECTATIONS.cpu)
      assert.equal(monitor.ready.memory, READY_EXPECTATIONS.memory)
      assert.equal(monitor.ready.load, READY_EXPECTATIONS.load)
      assert.equal(monitor.ready.disk, READY_EXPECTATIONS.disk)
      assert.equal(monitor.ready.uptime, READY_EXPECTATIONS.uptime)
      assert.match(monitor.ready.net, /^↓ .+\/s ↑ .+\/s$/)
      assert.ok(monitor.files >= 1, 'SFTP listed the fixture file on the monitored session')
      // 独立的第三份证据：探测确实以 exec 到达了夹具，而不是被本地伪造出来。
      assert.ok(server.exec.commands.some(command => command.includes('PURETERM_MONITOR_V1')),
        'the monitor probe must reach the SSH fixture as an exec')
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

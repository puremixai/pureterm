import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
    // 密钥库那一步的标记取决于这台机器能不能加密，所以不放进 requiredMarkers，
    // 改在 inspect 里断言「两者恰好出现一个」——见下面。
    requiredMarkers: ['[main] gate open', 'launch profile updated', '[WINDOW-CHROME-OK]', '[DESKTOP-BOUNDARY-OK]', '[MONITOR-SMOKE-OK]'],
    // 监控验收要在一条连接上等两轮探测（第二轮补齐 CPU 与网络），比原来的流程长。
    timeoutMs: 90_000,
    inspect: ({ dataDir, output }) => {
      const profile = JSON.parse(readFileSync(join(dataDir, 'launch-profile.json'), 'utf8'))
      assert.equal(profile.version, 1)
      assert.ok(profile.renderer.cols > 0 && profile.renderer.rows > 0)
      assert.equal(profile.hosts, 0)
      assert.ok(output.indexOf('renderer-ready report') < output.indexOf('launch profile updated'), 'profile committed before renderer-ready')
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
      assert.equal(monitor.beforeExpand, 'Paused', 'a collapsed row reports paused, not loading')
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
      /*
       * 工具轨：终端工作区里的一列，只有两颗工具按钮，同一时刻最多一格面板，
       * 而且管理页上整块跟着工作区退场。按钮 id 的顺序也在这里钉住 —— 顺序由
       * ClientSessionTools 的 ORDER 决定，与两个功能的装配顺序无关。
       */
      assert.equal(monitor.rail.closed.local, true, 'the rail must be a descendant of the terminal workspace')
      assert.deepEqual(monitor.rail.closed.onRail, ['sftp-toggle', 'monitor-toggle'], 'the rail holds exactly Files then Monitor')
      assert.deepEqual(monitor.rail.closed.expanded,
        { 'sftp-toggle': 'false', 'monitor-toggle': 'false' }, 'a new session starts with both tools collapsed')
      assert.deepEqual(monitor.rail.closed.controls,
        { 'sftp-toggle': 'sftp', 'monitor-toggle': 'session-monitor' }, 'each tool controls its own panel')
      assert.equal(monitor.rail.closed.named, true, 'icon-only rail buttons must still carry an accessible name')
      assert.equal(monitor.rail.closed.toolbarDuplicates, 0, 'the toolbar must not keep duplicate tool entries')
      assert.equal(monitor.rail.closed.files || monitor.rail.closed.monitor, false, 'a new session starts with no panel')
      assert.deepEqual([monitor.rail.monitor.files, monitor.rail.monitor.monitor], [false, true], 'Monitor replaces the closed slot')
      assert.deepEqual([monitor.rail.monitor.expanded['monitor-toggle'], monitor.rail.monitor.expanded['sftp-toggle']],
        ['true', 'false'], 'the open tool reports aria-expanded')
      assert.deepEqual([monitor.rail.files.files, monitor.rail.files.monitor], [true, false], 'Files replaces Monitor in the one slot')
      assert.equal(monitor.rail.files.local && monitor.rail.monitor.local, true, 'the rail stays terminal-local across tool switches')
      assert.equal(monitor.rail.management.workspaceHidden, true, 'the terminal workspace leaves the management page')
      assert.equal(monitor.rail.management.railVisible, false, 'the rail must not remain on a management page')
      assert.equal(monitor.rail.management.panelVisible, false, 'the panel must not remain on a management page')
      // 独立的第三份证据：探测确实以 exec 到达了夹具，而不是被本地伪造出来。
      assert.ok(server.exec.commands.some(command => command.includes('PURETERM_MONITOR_V1')),
        'the monitor probe must reach the SSH fixture as an exec')
      /*
       * 方向相反的另一份证据：监控会话上那次粘贴确实到了夹具。
       *
       * 渲染层那边只能等到「回显回来了」（见 diagnostics/smoke.ts，隐藏窗口不产帧，
       * 所以不看 DOM）。回显本身已经隐含了输入到达远端，但那是从**同一侧**推出来的；
       * 这一条把输入的到达交给夹具自己记账，粘贴那一端就不再是自说自话。
       */
      assert.ok(server.terminal.inputs.some(chunk => chunk.includes('monitor-alive')),
        'the paste dispatched through the real terminal must reach the SSH fixture')
      /*
       * 密钥库那一半的断言取决于这台机器能不能加密，而这一点由 Host 上报，冒烟据此
       * 只打印两个标记之一。两者必须**恰好**出现一个：都出现说明两条路径都跑了，
       * 都不出现说明那一步根本没执行——两种都是缺陷，不是「跳过」。
       */
      const encrypted = output.includes('[KEYCHAIN-WEB-OK]')
      const sessionOnly = output.includes('[KEYCHAIN-SESSION-OK]')
      assert.ok(encrypted !== sessionOnly,
        `exactly one keychain outcome must be reported (encrypted=${encrypted}, session=${sessionOnly})`)
      if (encrypted) {
        const keychain = readFileSync(join(dataDir, 'keychain.json'), 'utf8')
        assert.ok(!keychain.includes('PRIVATE KEY'))
        assert.ok(!keychain.includes(server.hostKey.toString().split('\n')[1]))
        assert.equal(JSON.parse(keychain).entries.length, 1)
        assert.ok(JSON.parse(keychain).entries[0].sealed)
        assert.ok(server.authentications.includes('publickey'))
      } else {
        // 没有系统加密：一个密钥都不许存下来，明文更不许出现。
        const path = join(dataDir, 'keychain.json')
        if (existsSync(path)) {
          const raw = readFileSync(path, 'utf8')
          assert.ok(!raw.includes('PRIVATE KEY'), 'a refused save must not write the private key')
          assert.equal(JSON.parse(raw).entries.length, 0, 'a refused save must not add a keychain entry')
        }
        assert.ok(!server.authentications.includes('publickey'),
          'no private-key authentication may happen without a stored key')
      }
    },
  })
  reportElectronResult('electron-desktop', result)
} finally {
  await server.close()
}

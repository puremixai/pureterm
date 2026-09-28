import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startFakeSshServer } from '../../desktop/tests/fake-ssh-server.mjs'
import { monitorProbe, READY_EXPECTATIONS } from '../../desktop/tests/monitor-probe.mjs'
import { runElectron, reportElectronResult } from '../../desktop/scripts/electron-runner.mjs'

const directory = await mkdtemp(join(tmpdir(), 'pureterm-web-browser-'))
const dataDir = join(directory, 'profile')
const keyFile = join(directory, 'browser-only-private-key.pem')
// 夹具里放一个文件，好让监控验收在**同一条连接**上还能证明 SFTP 列目录是活的；
// 探测帧每次推进，CPU 与网络才能在第二轮从预热走到齐全。
const ssh = await startFakeSshServer({
  keyAuthentication: true,
  files: { 'monitor-fixture.txt': 'monitor fixture\n' },
  execOutput: monitorProbe(),
})
let child
let exit
let nodeOutput = ''
let result = { code: 1, reason: 'browser smoke did not complete' }

async function until(predicate, description, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await delay(20)
  }
  throw new Error(`Timed out waiting for ${description}\n${nodeOutput}`)
}

try {
  await writeFile(keyFile, ssh.hostKey, { mode: 0o600 })
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('SSH_CORDIS_') || key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS') delete env[key]
  child = spawn(process.execPath, [fileURLToPath(new URL('../dist/main.js', import.meta.url)), '--data-dir', dataDir],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (text) => { nodeOutput += text })
  child.stderr.on('data', (text) => { nodeOutput += text })
  child.once('error', (error) => { exit = { error } })
  child.once('close', (code, signal) => { exit = { code, signal } })
  const url = await until(() => {
    if (exit) throw new Error(`Node Web exited before becoming ready: ${JSON.stringify(exit)}\n${nodeOutput}`)
    return nodeOutput.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)?.[0]
  }, 'Node Web startup URL')
  result = await runElectron({
    entry: fileURLToPath(new URL('./electron-entry.mjs', import.meta.url)),
    env: { PURETERM_TEST_WEB_URL: url, PURETERM_TEST_PRIVATE_KEY: keyFile,
      SSH_CORDIS_SMOKE_HOST: ssh.host, SSH_CORDIS_SMOKE_PORT: String(ssh.port),
      SSH_CORDIS_SMOKE_USER: ssh.username, SSH_CORDIS_SMOKE_PASS: ssh.password },
    successMarker: '[WEB-SMOKE-OK]', requiredMarkers: ['[WEB-READY]', '[WEB-MULTI-TAB]', '[WEB-BROWSER-KEY-AUTH]', '[WEB-BROWSER-KEY]', '[WEB-KEYCHAIN]', '[WEB-MONITOR-OK]'],
    // 监控验收要在一条连接上等两轮探测（第二轮补齐 CPU 与网络），比原来的流程长。
    timeoutMs: 120_000,
    inspect: ({ output }) => {
      const line = output.split(/\r?\n/).find(item => item.startsWith('[WEB-MONITOR] '))
      assert.ok(line, 'missing structured monitor report')
      const monitor = JSON.parse(line.slice('[WEB-MONITOR] '.length))
      assert.equal(monitor.collapsed, true, 'the monitor row must start collapsed')
      assert.notEqual(monitor.facts.cipher, '—', 'the cipher cell must be filled from session facts')
      assert.notEqual(monitor.facts.key, '—', 'the host-key cell must be filled from session facts')
      assert.equal(monitor.first, READY_EXPECTATIONS.memory, 'the first snapshot is already partial')
      assert.equal(monitor.ready.cpu, READY_EXPECTATIONS.cpu)
      assert.equal(monitor.ready.memory, READY_EXPECTATIONS.memory)
      assert.equal(monitor.ready.load, READY_EXPECTATIONS.load)
      assert.equal(monitor.ready.disk, READY_EXPECTATIONS.disk)
      assert.equal(monitor.ready.uptime, READY_EXPECTATIONS.uptime)
      assert.match(monitor.ready.net, /^↓ .+\/s ↑ .+\/s$/)
      assert.ok(monitor.listing.files >= 1, 'SFTP listed the fixture file on the monitored session')
      // 独立的第三份证据：探测确实以 exec 到达了夹具，而不是被本地伪造出来。
      assert.ok(ssh.exec.commands.some(command => command.includes('PURETERM_MONITOR_V1')),
        'the monitor probe must reach the SSH fixture as an exec')
    },
  })
  if (result.code === 0) {
    assert.ok(ssh.authentications.includes('publickey'), 'browser connection must complete signed public-key authentication')
    const files = await readdir(dataDir)
    assert.ok(files.includes('hosts.json'))
    assert.equal(files.includes('secrets.json'), false)
    assert.equal(files.includes('keychain.json'), false)
    for (const name of files) {
      const text = await readFile(join(dataDir, name), 'utf8')
      assert.equal(text.includes('browser-key-passphrase-never-persist'), false)
      assert.equal(text.includes('PRIVATE KEY'), false)
    }
    const hosts = JSON.parse(await readFile(join(dataDir, 'hosts.json'), 'utf8'))
    assert.equal(hosts.length, 1)
    assert.equal(hosts[0].username, ssh.username)
    assert.equal(hosts[0].authMethod, 'privateKey')
    assert.equal(hosts[0].privateKeyPath, undefined)
    assert.equal(hosts[0].keyId, undefined)
  }
} catch (error) {
  console.error('[WEB-SMOKE-FAIL]', error)
  result = { code: 1, reason: error.message }
} finally {
  if (child && !exit) {
    child.kill('SIGTERM')
    try { await until(() => exit, 'Node Web shutdown', 5000) }
    catch { child.kill('SIGKILL'); result = { code: 1, reason: 'Node Web did not shut down' } }
  }
  await ssh.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  reportElectronResult('standalone-web-browser', result)
}

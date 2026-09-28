/*
 * 监控与握手事实在**真实载体**上的行为：真 Web Host、真 WebSocket、真 SSH fixture。
 *
 * 这一层要证的是 HostMonitor 单测证不了的东西——两个 WebSocket 客户端之间不会串，
 * 畸形请求不会把有效订阅顶掉，探测失败不会把终端和 SFTP 一起带走，以及会话事实
 * 不随监控插件一起被卸载。这些都是**装配层**的性质。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startWebHost } from '@pureterm/transport/web-host'
// 相对路径而不是包子路径：host 包的 exports 只放行入口，插件文件是内部布局。
import { HostMonitor } from '../../../packages/host/dist/plugins/host-monitor.js'
import { startFakeSshServer } from '../../desktop/tests/fake-ssh-server.mjs'

const STATIC_DIR = dirname(fileURLToPath(import.meta.resolve('@pureterm/ui/index.html')))

/**
 * 一份完整的 Linux 帧，六个指标都在，八个 CPU 计数器与脚本真正打印的列数一致。
 *
 * 计数器必须随每次探测前进：两个一模一样的样本算不出速率，会被正确地判成
 * `invalid-data` 而不是 `ready`——那不是夹具想要的「第二次就好了」。
 */
function linuxFrame(step) {
  return [
    'PURETERM_MONITOR_V1',
    'OS', 'Linux', 'STATUS 0',
    'CPU', `cpu ${100 + step * 10} 0 100 ${800 + step * 100} 0 0 0 0`, 'STATUS 0',
    'MEMORY', 'MemTotal: 1000 kB', 'MemAvailable: 400 kB', 'STATUS 0',
    'LOAD', '0.5 1 2 1/234 5678', 'STATUS 0',
    'DISK', 'Filesystem 1024-blocks Used Available Capacity Mounted on', '/dev/root 100 40 50 45% /', 'STATUS 0',
    'NET', `${4096 + step * 1024} ${2048 + step * 512}`, 'STATUS 0',
    'UPTIME', '86400.5', 'STATUS 0',
    'END', '',
  ].join('\n')
}

async function until(predicate, description, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await delay(10)
  }
  assert.fail(`Timed out waiting for ${description}`)
}

async function fixture(t, serverOptions = {}) {
  const ssh = await startFakeSshServer({ greeting: false, ...serverOptions })
  t.after(() => ssh.close())
  const dataDir = await mkdtemp(join(tmpdir(), 'pureterm-monitoring-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const webHost = await startWebHost({
    staticDir: STATIC_DIR,
    hostStoreFile: join(dataDir, 'hosts.json'),
    knownHostsFile: join(dataDir, 'known-hosts.json'),
    capabilities: { credentialPersistence: 'session', privateKeyPicker: 'browser' },
    port: 0,
    log: false,
  })
  t.after(() => webHost.dispose())
  return { ssh, webHost }
}

async function wireClient(t, url) {
  const address = new URL(url)
  address.protocol = 'ws:'
  address.pathname = '/ws'
  const socket = new WebSocket(address)
  const messages = []
  socket.addEventListener('message', event => messages.push(JSON.parse(event.data)))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket open timeout')) }, 3000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket open failed')) }, { once: true })
  })
  t.after(async () => {
    if (socket.readyState === WebSocket.CLOSED) return
    socket.close()
    await until(() => socket.readyState === WebSocket.CLOSED, 'WebSocket cleanup')
  })

  let sequence = 0
  const raw = async (method, params = []) => {
    const id = ++sequence
    socket.send(JSON.stringify({ kind: 'call', id, method, params }))
    return await until(() => messages.find(message => message.kind === 'reply' && message.id === id), `reply to ${method}`)
  }
  return {
    messages,
    raw,
    async call(method, params = []) {
      const reply = await raw(method, params)
      assert.equal(reply.ok, true, reply.error)
      return reply.value
    },
    /** 同一个方法，但期望它被拒绝，返回错误文本。 */
    async rejected(method, params = []) {
      const reply = await raw(method, params)
      assert.equal(reply.ok, false, `${method} should have been rejected`)
      return reply.error
    },
    notice: (name, params) => socket.send(JSON.stringify({ kind: 'notice', name, params })),
    /** 原样的 params，`terminal:data` 这种多参数事件用它。 */
    events: name => messages.filter(message => message.kind === 'event' && message.name === name).map(message => message.params),
    /** 只带一个负载的事件（monitor:update / session:facts）解包后的负载。 */
    payloads: name => messages.filter(message => message.kind === 'event' && message.name === name).map(message => message.params[0]),
  }
}

const connection = ssh => ({ host: ssh.host, port: ssh.port, username: ssh.username, password: ssh.password, cols: 100, rows: 30 })
/** 每次探测都前进一格计数器，这样第二轮才真的能算出速率。 */
function serveFrames() {
  let step = 0
  return ({ accept }) => { const stream = accept(); stream.write(linuxFrame(step++)); stream.exit(0); stream.end() }
}
const hang = ({ accept }) => { accept() }

test('only the owning client receives updates, and a foreign client cannot start or stop them', { timeout: 30000 }, async t => {
  const { ssh, webHost } = await fixture(t, { onExec: serveFrames() })
  const owner = await wireClient(t, webHost.url)
  const foreign = await wireClient(t, webHost.url)
  const { sessionId } = await owner.call('ssh:open', [connection(ssh)])

  const started = await owner.call('monitor:start', [{ sessionId, subscriptionId: 'sub-owner' }])
  assert.deepEqual(started, { subscriptionId: 'sub-owner', intervalMs: 5000 })

  const first = await until(() => owner.payloads('monitor:update')[0], 'the owner first update')
  assert.equal(first.sessionId, sessionId)
  assert.equal(first.subscriptionId, 'sub-owner')
  assert.equal(first.sequence, 1)
  // 第一轮 CPU 和网络还没有基线，所以是 partial；另外四个指标已经拿到了。
  assert.equal(first.status, 'partial')
  assert.deepEqual(first.snapshot.issues, { cpu: 'warming-up', net: 'warming-up' })
  assert.equal(first.snapshot.memory.usedPercent, 60)
  assert.equal(first.snapshot.uptimeSeconds, 86400.5)

  // 别人的会话：开始和停止都不该被允许，而且回答里不能透露出这个订阅属于谁。
  assert.match(await foreign.rejected('monitor:start', [{ sessionId, subscriptionId: 'sub-foreign' }]), /不属于|不存在/)
  assert.deepEqual(await foreign.call('monitor:stop', ['sub-owner']), { stopped: false })
  assert.deepEqual(await foreign.call('monitor:stop', ['sub-foreign']), { stopped: false })

  // 被拒绝的停止请求不能动到所有者那条订阅：它必须继续出事件。
  await until(() => owner.payloads('monitor:update')[1], 'the owner second update', 15000)
  const updates = owner.payloads('monitor:update')
  assert.deepEqual(updates.map(update => update.sequence), [1, 2])
  // 第二条拿到了基线，所以六个指标都可用。
  assert.equal(updates[1].status, 'ready')
  assert.deepEqual(updates[1].snapshot.issues, {})
  // 全程没有一条事件流到另一个客户端。
  assert.deepEqual(foreign.payloads('monitor:update'), [])
  assert.deepEqual(foreign.payloads('session:facts'), [])
})

test('malformed monitor requests are rejected and cannot disturb a live subscription', { timeout: 30000 }, async t => {
  const { ssh, webHost } = await fixture(t, { onExec: serveFrames() })
  const client = await wireClient(t, webHost.url)
  const { sessionId } = await client.call('ssh:open', [connection(ssh)])
  await client.call('monitor:start', [{ sessionId, subscriptionId: 'live' }])
  await until(() => client.payloads('monitor:update')[0], 'the first update')

  /*
   * 每一个都曾经是「顺手加上去很方便」的字段。clientId 尤其是：收下它就等于让
   * 客户端自称身份，而这套载体存在的意义就是身份由载体认定。
   */
  assert.match(await client.rejected('monitor:start', [{ sessionId, subscriptionId: 'x', clientId: 'foreign' }]), /不接受字段/)
  assert.match(await client.rejected('monitor:start', [{ sessionId, subscriptionId: 'x', command: 'rm -rf /' }]), /不接受字段/)
  assert.match(await client.rejected('monitor:start', [{ sessionId, subscriptionId: 'x', intervalMs: 1 }]), /不接受字段/)
  assert.match(await client.rejected('monitor:start', [{ sessionId, subscriptionId: 'x', path: '/etc/passwd' }]), /不接受字段/)
  // 订阅 ID 的字符集与长度由协议定：UI 每次激活新建一个 UUID。
  assert.match(await client.rejected('monitor:start', [{ sessionId, subscriptionId: 'has space' }]), /订阅 ID/)
  assert.match(await client.rejected('monitor:start', [{ sessionId, subscriptionId: 'x'.repeat(65) }]), /订阅 ID/)
  assert.match(await client.rejected('monitor:start', [{ sessionId, subscriptionId: '' }]), /订阅 ID/)
  // 会话 ID 非空且不超过 128 个字符。
  assert.match(await client.rejected('monitor:start', [{ sessionId: '', subscriptionId: 'x' }]), /会话 ID/)
  assert.match(await client.rejected('monitor:start', [{ sessionId: 'x'.repeat(129), subscriptionId: 'x' }]), /会话 ID/)
  assert.match(await client.rejected('monitor:start', ['not-an-object']), /对象/)
  assert.match(await client.rejected('monitor:stop', ['has space']), /订阅 ID/)

  // 全部被拒之后，原来的订阅必须还在跑，序号接着往下走。
  await until(() => client.payloads('monitor:update')[1], 'the live subscription surviving invalid requests', 15000)
  assert.deepEqual(client.payloads('monitor:update').map(update => [update.subscriptionId, update.sequence]), [['live', 1], ['live', 2]])
})

test('a server that closes the channel without an exit status still yields a snapshot', { timeout: 20000 }, async t => {
  // 有的服务器关通道时不发 exit-status。那不是失败——帧本身是完整的，四个非增量
  // 指标都拿到了，只有 CPU 和网络在等基线。
  const { ssh, webHost } = await fixture(t, { onExec: ({ accept }) => { const stream = accept(); stream.write(linuxFrame(0)); stream.end() } })
  const client = await wireClient(t, webHost.url)
  const { sessionId } = await client.call('ssh:open', [connection(ssh)])
  await client.call('monitor:start', [{ sessionId, subscriptionId: 'no-exit' }])

  const update = await until(() => client.payloads('monitor:update')[0], 'the update from a server without an exit status')
  assert.equal(update.status, 'partial')
  assert.deepEqual(update.snapshot.issues, { cpu: 'warming-up', net: 'warming-up' })
  assert.equal(update.snapshot.memory.usedPercent, 60)
  assert.equal(update.snapshot.uptimeSeconds, 86400.5)
  assert.equal(update.message, undefined)
})

test('session facts reach the owner before any monitoring is started', { timeout: 20000 }, async t => {
  const { ssh, webHost } = await fixture(t)
  const owner = await wireClient(t, webHost.url)
  const foreign = await wireClient(t, webHost.url)
  const { sessionId } = await owner.call('ssh:open', [connection(ssh)])

  const facts = await until(() => owner.payloads('session:facts')[0], 'the owner session facts')
  assert.equal(facts.sessionId, sessionId)
  assert.equal(facts.revision, 1)
  assert.match(facts.serverHostKey, /^[A-Za-z0-9@._+-]+$/)
  assert.match(facts.cipher.clientToServer, /^[A-Za-z0-9@._+-]+$/)
  // 事实先于任何监控订阅存在：状态栏不依赖监控。
  assert.deepEqual(owner.payloads('monitor:update'), [])
  assert.deepEqual(foreign.payloads('session:facts'), [])

  // 不拥有这个会话的客户端也拿不到它的事实——事实走的是 terminal:opened 那条路由。
  await delay(50)
  assert.deepEqual(foreign.messages.filter(message => message.kind === 'event').map(message => message.name), [])
})

test('a monitor timeout leaves the terminal and SFTP working', { timeout: 30000 }, async t => {
  const { ssh, webHost } = await fixture(t, { onExec: hang })
  const client = await wireClient(t, webHost.url)
  const { sessionId } = await client.call('ssh:open', [connection(ssh)])

  await client.call('monitor:start', [{ sessionId, subscriptionId: 'slow' }])
  // 探测自己的截止时间是 3 秒：一条卡住的远端命令不该把会话一起带走。
  const update = await until(() => client.payloads('monitor:update')[0], 'the timeout update', 12000)
  assert.equal(update.status, 'error')
  assert.equal(update.snapshot, null)
  assert.match(update.message, /超时/)

  // 终端仍然能打字。
  client.notice('ssh:input', [sessionId, 'still-alive\n'])
  await until(
    () => client.events('terminal:data').some(params => Buffer.from(params[1].$bytes, 'base64').toString().includes('echo:still-alive')),
    'terminal output after a monitor timeout',
  )

  // SFTP 也仍然能用，而且是同一字节不差。
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index))
  const upload = await client.call('sftp:write', [sessionId, '.', 'after-timeout.bin', { $bytes: bytes.toString('base64') }])
  const download = await client.call('sftp:read', [sessionId, upload.path])
  assert.deepEqual(Buffer.from(download.bytes.$bytes, 'base64'), bytes)

  // 停止之后不留下任何在途探测。
  assert.deepEqual(await client.call('monitor:stop', ['slow']), { stopped: true })
})

test('unloading the monitor plugin leaves the facts path and the terminal running', { timeout: 30000 }, async t => {
  const { ssh, webHost } = await fixture(t)
  const client = await wireClient(t, webHost.url)
  const first = await client.call('ssh:open', [connection(ssh)])
  await until(() => client.payloads('session:facts')[0], 'facts for the first session')

  /*
   * 卸载监控插件。会话事实由 TerminalBridge 发，所以它必须活下来——状态栏的
   * 算法格子不是监控的一部分，监控插件从来不是一条它只是观察的会话事实的拥有者。
   */
  const runtime = webHost.internals.host.internals.ctx.registry.get(HostMonitor)
  assert.ok(runtime, 'the monitor plugin must be part of the assembled Host')
  for (const fiber of [...runtime.fibers]) await fiber.dispose()

  assert.match(await client.rejected('monitor:start', [{ sessionId: first.sessionId, subscriptionId: 'after-unload' }]), /MONITOR_UNAVAILABLE/)
  assert.deepEqual(await client.call('monitor:stop', ['after-unload']), { stopped: false })

  // 终端照常。
  client.notice('ssh:input', [first.sessionId, 'no-monitor\n'])
  await until(
    () => client.events('terminal:data').some(params => Buffer.from(params[1].$bytes, 'base64').toString().includes('echo:no-monitor')),
    'terminal output after unloading the monitor plugin',
  )

  // 新开的会话仍然会拿到事实：这条路和监控插件没有关系。
  const second = await client.call('ssh:open', [connection(ssh)])
  const facts = await until(() => client.payloads('session:facts').find(facts => facts.sessionId === second.sessionId), 'facts for a session opened after the unload')
  assert.equal(facts.revision, 1)
  assert.equal(facts.sessionId, second.sessionId)
})

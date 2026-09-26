/*
 * HostMonitor 的策略测试。
 *
 * 这里**不连真实 SSH**：ssh / terminal / renderer 三个提供方都是受控的 Cordis 服务，
 * 时钟用 node:test 的 mock timers。理由是这一层要证明的是调度与生命周期——「多久探一次、
 * 谁有资格探、停止之后还剩什么」——而真实握手和真实 /proc 已经在别的文件里证过了。
 * 把两者混在一起，任何一次失败都要先猜是哪一层的错。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context, Service } from 'cordis'
import { MONITOR_METRICS } from '@pureterm/protocol'
import { createHost } from '../dist/host.js'
import { HostMonitor } from '../dist/plugins/host-monitor.js'

/** setTimeout 被 mock 之后，这是唯一还能把微任务续作推到底的办法。 */
const settle = () => new Promise(resolve => setImmediate(resolve))

const ok = (name, payload) => [name, ...payload, 'STATUS 0']
const failed = name => [name, 'STATUS 1']

/** 六个指标全部可用的 Linux 分节。 */
const linuxSections = () => [
  ok('CPU', ['cpu 100 0 100 800 0 0 0 0 0 0']),
  ok('MEMORY', ['MemTotal: 1000 kB', 'MemAvailable: 400 kB']),
  ok('LOAD', ['0.5 1 2 1/234 5678']),
  ok('DISK', ['Filesystem 1024-blocks Used Available Capacity Mounted on', '/dev/root 100 40 50 45% /']),
  ok('NET', ['4096 2048']),
  ok('UPTIME', ['86400.5']),
]

/** 第二轮：CPU 多用了 50/200，网络多收了 20,480 / 多发了 10,240 字节。 */
const NEXT_SECTIONS = () => replace(linuxSections(), 'CPU', ok('CPU', ['cpu 150 0 150 900 0 0 0 0 0 0']))
  .map(section => section[0] === 'NET' ? ok('NET', ['24576 12288']) : section)

function replace(sections, name, replacement) {
  return sections.map(section => (section[0] === name ? replacement : section))
}

function frame(sections, os = 'Linux') {
  return ['PURETERM_MONITOR_V1', 'OS', os, 'STATUS 0', ...sections.flat(), 'END', ''].join('\n')
}

class FakeSsh extends Service {
  constructor(ctx, config) {
    super(ctx, 'ssh')
    this.config = config
    this.calls = []
    this.running = 0
    this.maxConcurrent = 0
  }

  async exec(sessionId, command, options = {}) {
    this.calls.push({ sessionId, command, options })
    this.running++
    this.maxConcurrent = Math.max(this.maxConcurrent, this.running)
    try {
      return await this.config.exec(sessionId, command, options)
    } finally {
      this.running--
    }
  }

  pendingExecs() {
    return this.running
  }
}

class FakeTerminal extends Service {
  constructor(ctx, config) {
    super(ctx, 'terminal')
    this.config = config
    this.queries = []
  }

  ownsSession(sessionId, clientId) {
    this.queries.push([sessionId, clientId])
    return this.config.owns(sessionId, clientId)
  }
}

class FakeRenderer extends Service {
  constructor(ctx, config) {
    super(ctx, 'renderer')
    this.config = config
    this.sent = []
  }

  isAlive(clientId) {
    return this.config.alive.has(clientId)
  }

  send(clientId, event, ...args) {
    if (!this.config.alive.has(clientId)) return false
    if (this.config.deliver === false) return false
    this.sent.push({ clientId, event, args })
    return true
  }

  updates() {
    return this.sent.filter(entry => entry.event === 'monitor:update').map(entry => entry.args[0])
  }
}

/**
 * 一棵只有监控所需服务的插件树。
 *
 * `owns` 默认「谁开的就是谁的」，测试可以覆盖成别的答案来验证归属检查。
 */
async function fixture(t, options = {}) {
  const root = new Context()
  const alive = new Set(options.alive ?? ['first', 'second'])
  const owners = options.owners ?? new Map([['ssh-1', 'first'], ['ssh-2', 'second']])
  const owns = options.owns ?? ((sessionId, clientId) => owners.get(sessionId) === clientId)
  const frames = options.frames ?? [frame(linuxSections()), frame(NEXT_SECTIONS())]
  let index = 0

  const sshConfig = {
    exec: options.exec ?? (async () => {
      const stdout = frames[Math.min(index++, frames.length - 1)]
      return { stdout, stderr: '', code: 0 }
    }),
  }
  await root.plugin(FakeSsh, sshConfig)
  await root.plugin(FakeTerminal, { owns })
  await root.plugin(FakeRenderer, { alive, deliver: options.deliver })
  await root.plugin(HostMonitor)
  t.after(async () => { await root.fiber.dispose() })

  return {
    root,
    monitor: root.hostMonitor,
    ssh: root.ssh,
    terminal: root.terminal,
    renderer: root.renderer,
    alive,
    owns,
  }
}

const START = { sessionId: 'ssh-1', subscriptionId: 'sub-1' }

test('the first probe runs immediately with the fixed command and bounded options', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, ssh, renderer } = await fixture(t)

  const started = await monitor.start(START, 'first')
  assert.deepEqual(started, { subscriptionId: 'sub-1', intervalMs: 5000 })
  // start 不等远端：调用返回时探测才刚发出去。
  assert.equal(ssh.calls.length, 1)

  await settle()
  assert.equal(ssh.calls.length, 1)
  const [call] = ssh.calls
  assert.equal(call.sessionId, 'ssh-1')
  assert.match(call.command, /^LC_ALL=C; export LC_ALL\n/)
  assert.match(call.command, /PURETERM_MONITOR_V1/)
  assert.equal(call.options.timeout, 3000)
  assert.equal(call.options.maxBytes, 65536)
  assert.equal(call.options.signal instanceof AbortSignal, true)

  const [update] = renderer.updates()
  assert.equal(update.sessionId, 'ssh-1')
  assert.equal(update.subscriptionId, 'sub-1')
  assert.equal(update.sequence, 1)
  assert.equal(update.snapshot.collectedAt, 1_000_000)
})

test('the next probe waits 5,000 ms after the previous one finished', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()
  assert.equal(ssh.calls.length, 1)

  // 间隔从**完成**之后开始算，不是从开始算：慢探测不该让下一次提前。
  t.mock.timers.tick(4999)
  await settle()
  assert.equal(ssh.calls.length, 1)

  t.mock.timers.tick(1)
  await settle()
  assert.equal(ssh.calls.length, 2)
  assert.equal(ssh.maxConcurrent, 1)
})

test('a probe that is still running is never overlapped by the next tick', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  let release
  const { monitor, ssh } = await fixture(t, {
    exec: () => new Promise(resolve => {
      release = () => resolve({ stdout: frame(linuxSections()), stderr: '', code: 0 })
    }),
  })
  await monitor.start(START, 'first')
  await settle()
  assert.equal(ssh.calls.length, 1)

  // 第一次还没回来：即使时间推过好几轮，也不该再开一条命令通道。
  t.mock.timers.tick(60_000)
  await settle()
  assert.equal(ssh.calls.length, 1)
  assert.equal(ssh.maxConcurrent, 1)

  release()
  await settle()
  assert.equal(ssh.calls.length, 1)
  // 完成后才排下一轮。
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(ssh.calls.length, 2)
})

test('the first sample is partial with both warm-ups, and the second is ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()

  const [first] = renderer.updates()
  // 只有 CPU 和网络是增量指标，所以只有它们能说「预热中」。
  assert.equal(first.status, 'partial')
  assert.deepEqual(first.snapshot.issues, { cpu: 'warming-up', net: 'warming-up' })
  assert.equal(first.snapshot.cpuPercent, null)
  assert.equal(first.snapshot.net, null)
  assert.equal(first.snapshot.memory.usedPercent, 60)
  assert.deepEqual(first.snapshot.load, { one: 0.5, five: 1, fifteen: 2 })
  assert.equal(first.snapshot.uptimeSeconds, 86400.5)

  t.mock.timers.tick(5000)
  await settle()
  const second = renderer.updates()[1]
  assert.equal(second.status, 'ready')
  assert.deepEqual(second.snapshot.issues, {})
  assert.equal(second.snapshot.cpuPercent, 50)
  // 20,480 字节 / 5,000 ms 与 10,240 字节 / 5,000 ms。
  assert.deepEqual(second.snapshot.net, { receivedBytesPerSecond: 4096, transmittedBytesPerSecond: 2048 })
  assert.equal(second.sequence, 2)
})

test('one missing metric is partial with exactly one issue', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const withoutDisk = sections => frame(replace(sections, 'DISK', failed('DISK')))
  const { monitor, renderer } = await fixture(t, {
    frames: [withoutDisk(linuxSections()), withoutDisk(NEXT_SECTIONS())],
  })
  await monitor.start(START, 'first')
  await settle()

  // 第一轮还带着两个预热，所以「只缺一个指标」要到第二轮才看得见。
  t.mock.timers.tick(5000)
  await settle()
  const update = renderer.updates()[1]
  assert.equal(update.status, 'partial')
  assert.deepEqual(update.snapshot.issues, { disk: 'unavailable' })
  assert.equal(update.snapshot.disk, null)
  assert.equal(MONITOR_METRICS.length - Object.keys(update.snapshot.issues).length, 5)
})

test('a non-Linux target is unsupported once, and probing stops there', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, ssh, renderer } = await fixture(t, { frames: [frame([], 'Darwin')] })
  await monitor.start(START, 'first')
  await settle()

  const [update] = renderer.updates()
  assert.equal(update.status, 'unsupported')
  assert.equal(update.snapshot, null)
  assert.match(update.message, /Darwin/)

  // 不再自动探测：手动重试会开一个新的订阅。
  t.mock.timers.tick(60_000)
  await settle()
  assert.equal(ssh.calls.length, 1)
  assert.equal(renderer.updates().length, 1)
})

test('a failed probe is error, retried, and it resets both baselines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const frames = [frame(linuxSections()), frame(NEXT_SECTIONS())]
  let attempt = 0
  const { monitor, renderer } = await fixture(t, {
    exec: async () => {
      const step = attempt++
      if (step === 0) throw new Error('命令执行超时（3000ms）。')
      return { stdout: frames[Math.min(step - 1, frames.length - 1)], stderr: '', code: 0 }
    },
  })
  await monitor.start(START, 'first')
  await settle()
  assert.equal(renderer.updates()[0].status, 'error')
  assert.equal(renderer.updates()[0].snapshot, null)
  assert.match(renderer.updates()[0].message, /超时/)

  // 失败之后照常重试。
  t.mock.timers.tick(5000)
  await settle()
  const second = renderer.updates()[1]
  assert.equal(second.status, 'partial')
  // 基线被清掉了，所以第二轮仍然是预热——隔着一轮失败的两个样本之间有一段没人量过的时间。
  assert.deepEqual(second.snapshot.issues, { cpu: 'warming-up', net: 'warming-up' })

  t.mock.timers.tick(5000)
  await settle()
  const third = renderer.updates()[2]
  // 第三轮才拿第二轮当基线：CPU 和网络都从零开始重新算。
  assert.equal(third.status, 'ready')
  assert.deepEqual(third.snapshot.issues, {})
})

test('a nonzero exit status or a signal fails the probe even with a complete frame', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const frames = [frame(linuxSections()), frame(NEXT_SECTIONS())]
  let attempt = 0
  const { monitor, renderer } = await fixture(t, {
    exec: async () => {
      const step = attempt++
      // 帧本身是完整的：这说明「整体失败」不是靠解析器猜出来的，而是命令自己的结论。
      if (step === 1) return { stdout: frames[0], stderr: '', code: 3 }
      if (step === 2) return { stdout: frames[0], stderr: '', code: null, signal: 'TERM' }
      return { stdout: frames[Math.min(step, 1)], stderr: '', code: 0 }
    },
  })
  await monitor.start(START, 'first')
  await settle()
  assert.equal(renderer.updates()[0].status, 'partial')

  t.mock.timers.tick(5000)
  await settle()
  assert.equal(renderer.updates()[1].status, 'error')
  assert.match(renderer.updates()[1].message, /退出码 3/)

  t.mock.timers.tick(5000)
  await settle()
  assert.equal(renderer.updates()[2].status, 'error')
  assert.match(renderer.updates()[2].message, /信号 TERM/)

  // 每一次失败都清掉基线，所以恢复之后的第一轮又是预热，而不是拿两次失败之间的增量当速率。
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(renderer.updates()[3].status, 'partial')
  assert.deepEqual(renderer.updates()[3].snapshot.issues, { cpu: 'warming-up', net: 'warming-up' })
})

test('an omitted exit status is accepted when the frame is complete', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer } = await fixture(t, {
    exec: async () => ({ stdout: frame(linuxSections()), stderr: '', code: null }),
  })
  await monitor.start(START, 'first')
  await settle()
  // 有些服务器不发 exit-status。帧完整就够了，不必因此判成失败。
  assert.equal(renderer.updates()[0].status, 'partial')
  assert.deepEqual(Object.keys(renderer.updates()[0].snapshot.issues).sort(), ['cpu', 'net'])
})

test('starting a second subscription retires the first one and resets the sequence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()
  const firstSignal = ssh.calls[0].options.signal
  assert.equal(firstSignal.aborted, false)

  await monitor.start({ sessionId: 'ssh-1', subscriptionId: 'sub-2' }, 'first')
  // 旧订阅被取消：它的在途探测即使回来也不会发出去。
  assert.equal(firstSignal.aborted, true)
  await settle()

  const updates = renderer.updates()
  assert.equal(updates.length, 2)
  assert.equal(updates[0].subscriptionId, 'sub-1')
  assert.equal(updates[1].subscriptionId, 'sub-2')
  // 新订阅从 1 重新开始，而且两个指标都回到预热。
  assert.equal(updates[1].sequence, 1)
  assert.deepEqual(updates[1].snapshot.issues, { cpu: 'warming-up', net: 'warming-up' })
  assert.equal(monitor.size, 1)
})

test('repeating the same start is idempotent and does not restart the stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()
  assert.equal(ssh.calls[0].options.signal.aborted, false)

  const again = await monitor.start(START, 'first')
  assert.deepEqual(again, { subscriptionId: 'sub-1', intervalMs: 5000 })
  await settle()
  assert.equal(renderer.updates().length, 1, 'a repeated start must not produce a second stream')
  assert.equal(ssh.calls[0].options.signal.aborted, false, 'a repeated start must not cancel the live probe')

  t.mock.timers.tick(5000)
  await settle()
  // 序号接着走，说明确实是同一条订阅。
  assert.equal(renderer.updates()[1].sequence, 2)
})

test('reusing a live subscription ID for another session is rejected', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()

  await assert.rejects(monitor.start({ sessionId: 'ssh-2', subscriptionId: 'sub-1' }, 'first'), /订阅 ID/)
  // 被拒绝的请求不能动到已经生效的那条订阅。
  assert.equal(ssh.calls[0].options.signal.aborted, false)
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(renderer.updates()[1].sequence, 2)
})

test('a session the client does not own is rejected without disturbing the live one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()

  await assert.rejects(monitor.start({ sessionId: 'ssh-2', subscriptionId: 'sub-9' }, 'first'), /不属于/)
  // 归属检查发生在替换之前：非法请求不能顶掉有效订阅。
  assert.equal(ssh.calls[0].options.signal.aborted, false)
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(renderer.updates().at(-1).subscriptionId, 'sub-1')
  assert.equal(monitor.size, 1)
})

test('a client that has gone away cannot start monitoring', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, alive } = await fixture(t)
  alive.delete('first')
  await assert.rejects(monitor.start(START, 'first'), /断开/)
  assert.equal(monitor.size, 0)
})

test('an old stop cannot stop the replacement subscription', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()
  await monitor.start({ sessionId: 'ssh-1', subscriptionId: 'sub-2' }, 'first')
  await settle()

  // 迟到的停止请求带的是上一个 ID：它只能停掉它自己那一代。
  assert.deepEqual(await monitor.stop('sub-1', 'first'), { stopped: false })
  const signal = ssh.calls.at(-1).options.signal
  assert.equal(signal.aborted, false)
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(renderer.updates().at(-1).subscriptionId, 'sub-2')
})

test('stop is idempotent and only answers for the caller own subscription', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()

  assert.deepEqual(await monitor.stop('sub-1', 'second'), { stopped: false })
  assert.deepEqual(await monitor.stop('sub-1', 'first'), { stopped: true })
  assert.deepEqual(await monitor.stop('sub-1', 'first'), { stopped: false })
  assert.equal(monitor.size, 0)

  // 停止之后时钟再怎么走都不该有新事件。
  const seen = renderer.updates().length
  t.mock.timers.tick(60_000)
  await settle()
  assert.equal(renderer.updates().length, seen)
})

test('stopping while a probe is pending aborts it and suppresses its completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  let aborted = 0
  const { monitor, renderer, ssh } = await fixture(t, {
    exec: (sessionId, command, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted++
        reject(new Error('命令执行已取消。'))
      }, { once: true })
    }),
  })
  await monitor.start(START, 'first')
  await settle()
  assert.equal(ssh.calls.length, 1)

  assert.deepEqual(await monitor.stop('sub-1', 'first'), { stopped: true })
  await settle()
  assert.equal(aborted, 1, 'the in-flight probe must be cancelled, not left to its deadline')
  assert.equal(renderer.updates().length, 0, 'a cancelled probe must publish nothing')
  assert.equal(ssh.pendingExecs(), 0)
})

test('a session that closes retires its subscription without waiting for the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  let aborted = 0
  const { monitor, root, ssh } = await fixture(t, {
    exec: (sessionId, command, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { aborted++; reject(new Error('命令执行已取消。')) }, { once: true })
    }),
  })
  await monitor.start(START, 'first')
  await settle()

  root.emit('ssh/session-closed', 'ssh-1', '连接已关闭')
  await settle()
  assert.equal(aborted, 1)
  assert.equal(monitor.size, 0)
  assert.equal(ssh.pendingExecs(), 0)
})

test('a renderer that stops accepting updates retires the subscription', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer, alive, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()

  // 客户端走了：投递失败，订阅跟着一起收掉。
  alive.delete('first')
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(renderer.updates().length, 1)
  assert.equal(monitor.size, 0)
  assert.equal(ssh.pendingExecs(), 0)
})

test('a renderer that disappears mid-flight clears every resource', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, root, alive, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await settle()

  // 客户端在探测之间消失：所有权检查在每次探测之前都会重问。
  alive.delete('first')
  root.terminal.config.owns = () => false
  t.mock.timers.tick(5000)
  await settle()
  assert.equal(monitor.size, 0)
  assert.equal(ssh.pendingExecs(), 0)
})

test('shutdown is idempotent and leaves no pending probe or timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  let aborted = 0
  const { monitor, renderer, ssh } = await fixture(t, {
    exec: (sessionId, command, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { aborted++; reject(new Error('命令执行已取消。')) }, { once: true })
    }),
  })
  await monitor.start(START, 'first')
  await settle()

  monitor.shutdown()
  monitor.shutdown()
  await settle()
  assert.equal(aborted, 1)
  assert.equal(monitor.size, 0)

  // 卸载之后连时钟都不该再产生任何东西。
  t.mock.timers.tick(60_000)
  await settle()
  assert.equal(renderer.updates().length, 0)
  assert.equal(ssh.calls.length, 1)
  await assert.rejects(monitor.start(START, 'first'), /MONITOR_UNAVAILABLE/)
})

test('releasing a client clears only that client', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const { monitor, renderer, ssh } = await fixture(t)
  await monitor.start(START, 'first')
  await monitor.start({ sessionId: 'ssh-2', subscriptionId: 'sub-2' }, 'second')
  await settle()
  assert.equal(monitor.size, 2)

  monitor.releaseClient('first')
  assert.equal(monitor.size, 1)
  assert.equal(ssh.calls[0].options.signal.aborted, true)
  assert.equal(ssh.calls[1].options.signal.aborted, false)

  t.mock.timers.tick(5000)
  await settle()
  const owners = new Set(renderer.updates().map(update => update.subscriptionId))
  assert.deepEqual([...owners].sort(), ['sub-1', 'sub-2'])
  assert.equal(renderer.updates().filter(update => update.subscriptionId === 'sub-1').length, 1)
  assert.equal(renderer.updates().filter(update => update.subscriptionId === 'sub-2').length, 2)
})

test('without the monitor plugin the public contract still answers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-monitor-plugin-'))
  const host = await createHost({
    bridge: { getRenderer: id => ({ id, isAlive: () => true, send: () => true }) },
    hostStoreFile: join(directory, 'hosts.json'),
    secretsFile: join(directory, 'secrets.json'),
    knownHostsFile: join(directory, 'known_hosts.json'),
    ssh: { readyTimeout: 8000, keepaliveInterval: 0 },
    log: false,
  })
  t.after(async () => {
    try { await host.dispose() } finally { await rm(directory, { recursive: true, force: true }) }
  })

  const monitor = host.internals.ctx.hostMonitor
  assert.equal(typeof monitor.start, 'function')
  /*
   * 卸载监控插件——这是唯一能造出「服务不存在」这个状态的办法。
   *
   * 不能走 `monitor.ctx.fiber`：服务实例上的 `ctx` 是一个 tracker 属性，指向**访问者**
   * 的上下文，从 root 访问拿到的就是 root 的 fiber，卸掉它等于把整棵树拆了。
   * 所以从 registry 里取这个插件自己的 fiber。
   */
  const runtime = host.internals.ctx.registry.get(HostMonitor)
  assert.equal(runtime.fibers.length, 1)
  for (const fiber of [...runtime.fibers]) await fiber.dispose()
  assert.equal(host.internals.ctx.hostMonitor, undefined)

  // 缺插件是一种**可预期的**状态：给稳定的错误码，不抛类型错误，也不影响其它能力。
  await assert.rejects(host.startMonitor(START, 'first'), /MONITOR_UNAVAILABLE/)
  assert.deepEqual(await host.stopMonitor('sub-1', 'first'), { stopped: false })
  assert.equal(typeof host.openTerminal, 'function')
  assert.deepEqual(host.listHosts('first'), [])
})

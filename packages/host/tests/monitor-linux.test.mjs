/*
 * Linux 采集器的纯函数测试。
 *
 * 分两层：`parseLinuxProbe` 只认帧、不算数；`toMonitorSnapshot` 只算增量、不认帧。
 * 所以 CPU 百分比和网络速率必须由两个样本喂出来，而「第一个样本」是 warming-up。
 *
 * 期望值全部写成**字面算式**（`40 / 90 * 100`），不是从被测代码里取出来的数：
 * 用解析器生成期望值，等于让解析器给自己判卷。
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { MONITOR_METRICS, parseMonitorUpdate } from '@pureterm/protocol'
import { LINUX_MONITOR_COMMAND, parseLinuxProbe, toMonitorSnapshot } from '../dist/monitoring/linux.js'

const run = promisify(execFile)

/** 跑一个 shell；这个 shell 不存在时返回 null，好让测试在只有 sh 的机器上也能跑。 */
async function tryShell(shell, script) {
  try {
    const { stdout } = await run(shell, ['-c', script])
    return stdout
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * 跑脚本里产某一节的那两行（读文件的那行 + 打印的那行），只把 /proc 路径指向 fixture。
 *
 * 被测的是随包发出去的脚本原文——不是抄来的一份——因为「脚本读哪一行、打印哪几列」
 * 这些决定恰恰只在脚本里，解析器的单测看不到它们。
 */
async function runSection(directory, procPath, marker, fixtureText) {
  const lines = LINUX_MONITOR_COMMAND.split('\n')
  const read = lines.find(line => line.includes(procPath))
  const print = lines.find(line => line.includes(`'${marker}`))
  assert.ok(read && print, `the shipped command must have a ${marker} section reading ${procPath}`)
  const file = join(directory, basename(procPath))
  await writeFile(file, fixtureText)
  const { stdout } = await run('sh', ['-c', `${read.replace(procPath, file)}\n${print}`])
  return stdout
}

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pureterm-monitor-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

const HEADER = 'PURETERM_MONITOR_V1'

/** 一帧：可选的 shell 前缀、OS 分节、若干分节、END。 */
function frame(sections, { os = 'Linux', prefix = [], end = true } = {}) {
  const lines = [...prefix, HEADER, 'OS', os, 'STATUS 0']
  for (const [name, payload, status = 0] of sections) lines.push(name, ...payload, `STATUS ${status}`)
  if (end) lines.push('END')
  return `${lines.join('\n')}\n`
}

const CPU = 'cpu 150 0 150 900 0 0 0 0 0 0'
const MEMORY = ['MemTotal: 1000 kB', 'MemAvailable: 400 kB']
const LOAD = '0.5 1 2 1/234 5678'
const DISK = ['Filesystem 1024-blocks Used Available Capacity Mounted on', '/dev/root 100 40 50 45% /']
const NET = '4096 2048'
const UPTIME = '86400.5'

/** 全部可用的 Linux 分节，顺序就是脚本产出的顺序。 */
const allSections = () => [
  ['CPU', [CPU]],
  ['MEMORY', MEMORY],
  ['LOAD', [LOAD]],
  ['DISK', DISK],
  ['NET', [NET]],
  ['UPTIME', [UPTIME]],
]

/** 只替换某几个分节，其余保持可用。 */
const withSections = replacements => allSections().map(section => replacements[section[0]] ?? section)

/** 六个指标全部量不到的一帧：命令成功，但每一节都是空的。 */
const allFailedSections = () =>
  allSections().map(([name]) => [name, [], 0])

const CPU_BEFORE = [100n, 0n, 100n, 800n, 0n, 0n, 0n, 0n]
const CPU_AFTER = [150n, 0n, 150n, 900n, 0n, 0n, 0n, 0n]
const baseline = (collectedAt, cpu, net) => ({ collectedAt, cpu, net })
const READY_BASELINE = baseline(1_000_000, CPU_BEFORE, [4096n, 2048n])

test('a complete Linux frame parses into counters, fields and no issues', () => {
  const probe = parseLinuxProbe(frame(allSections()))

  assert.equal(probe.os, 'Linux')
  // 八个聚合计数器。payload 里还有 guest / guest_nice 两列，它们不属于总量。
  assert.deepEqual(probe.cpu, CPU_AFTER)
  assert.deepEqual(probe.net, [4096n, 2048n])
  assert.equal(probe.uptimeSeconds, 86400.5)
  // load 是三个原始值，不换算成百分比，也不假设核数。
  assert.deepEqual(probe.load, { one: 0.5, five: 1, fifteen: 2 })
  // 1,000 kB 总量、400 kB 可用 -> 600 kB 已用。
  assert.deepEqual(probe.memory, { usedBytes: 600 * 1024, totalBytes: 1000 * 1024, usedPercent: 60 })
  /*
   * 保留块：used 40 + available 50 = 90，不等于 total 100。所以百分比的分母是
   * used + available，不是 total —— 用 total 算出来是 40%，一个看起来很正常、
   * 却把保留块当成已用空间的数。
   */
  assert.deepEqual(probe.disk, {
    mount: '/', usedBytes: 40 * 1024, totalBytes: 100 * 1024, availableBytes: 50 * 1024,
    usedPercent: 40 / 90 * 100,
  })
  assert.notEqual(probe.disk.usedPercent, 40)
  // 六个指标全在，issues 必须恰好是空的。
  assert.deepEqual(probe.issues, {})
  assert.deepEqual(Object.keys(probe.issues), [])
})

test('the CPU guest columns are carried in the payload but never added to the totals', () => {
  const withGuests = 'cpu 150 0 150 900 0 0 0 0 400 500'
  const probe = parseLinuxProbe(frame(withSections({ CPU: ['CPU', [withGuests]] })))
  // 400/500 是 guest/guest_nice，已经含在 user/nice 里，再加一遍就是重复计数。
  assert.deepEqual(probe.cpu, CPU_AFTER)

  // 用百分比把这条规则顶到可见处：把 guest 加进总量会得到另一个数。
  const snapshot = toMonitorSnapshot(probe, READY_BASELINE, 1_002_000)
  assert.equal(snapshot.cpuPercent, 50)
  const naive = parseLinuxProbe(frame(withSections({ CPU: ['CPU', ['cpu 150 0 150 900 0 0 0 0 400 500']] })))
  assert.deepEqual(naive.cpu, probe.cpu)
})

test('CPU is a delta of two samples, and the first sample cannot produce one', () => {
  const probe = parseLinuxProbe(frame(allSections()))

  const first = toMonitorSnapshot(probe, null, 1_000_000)
  assert.equal(first.cpuPercent, null)
  // 没有基线不是「零负载」，也不是坏数据。
  assert.equal(first.issues.cpu, 'warming-up')

  // 1000 -> 1200 总计，800 -> 900 空闲，所以 200 里 100 是忙的。
  const next = toMonitorSnapshot(probe, READY_BASELINE, 1_002_000)
  assert.equal(next.cpuPercent, 50)
  assert.equal('cpu' in next.issues, false)

  // 计数器回退（机器重启 / 计数器回绕）不是速率，也不该被当成 0。
  const backwards = baseline(1_000_000, [900n, 0n, 900n, 5000n, 0n, 0n, 0n, 0n], [4096n, 2048n])
  const reset = toMonitorSnapshot(probe, backwards, 1_002_000)
  assert.equal(reset.cpuPercent, null)
  assert.equal(reset.issues.cpu, 'invalid-data')

  // 总量没有变化时没有可分的份额。
  const stalled = baseline(1_000_000, CPU_AFTER, [4096n, 2048n])
  assert.equal(toMonitorSnapshot(probe, stalled, 1_002_000).cpuPercent, null)
})

test('network throughput needs two samples and never sums the two directions', () => {
  const probe = parseLinuxProbe(frame(withSections({ NET: ['NET', ['12288 6144']] })))

  const first = toMonitorSnapshot(probe, null, 1_000_000)
  assert.equal(first.net, null)
  assert.equal(first.issues.net, 'warming-up')

  // 8,192 字节 / 2,000 ms -> 4,096 B/s；4,096 字节 / 2,000 ms -> 2,048 B/s。
  const next = toMonitorSnapshot(probe, READY_BASELINE, 1_002_000)
  assert.deepEqual(next.net, { receivedBytesPerSecond: 4096, transmittedBytesPerSecond: 2048 })

  // 其中一个方向回退，整对速率作废：半对数字比没有数字更误导。
  const wrapped = parseLinuxProbe(frame(withSections({ NET: ['NET', ['1024 6144']] })))
  const after = toMonitorSnapshot(wrapped, READY_BASELINE, 1_002_000)
  assert.equal(after.net, null)
  assert.equal(after.issues.net, 'invalid-data')

  // 时间没有前进，除数就是 0。
  const sameInstant = toMonitorSnapshot(probe, READY_BASELINE, 1_000_000)
  assert.equal(sameInstant.net, null)
  assert.equal(sameInstant.issues.net, 'invalid-data')
})

test('the NET payload is already the summed pair, so the parser must not re-sum anything', () => {
  const probe = parseLinuxProbe(frame(withSections({ NET: ['NET', ['12288 6144']] })))
  // 原样取两个整数：任何「再加一遍」的实现在这里都会得到别的数。
  assert.deepEqual(probe.net, [12288n, 6144n])

  /*
   * 求和规则只存在于 shell 脚本里。如果以后有人把它改成逐接口输出，解析器必须
   * 拒绝，而不是在第二个地方再实现一次求和——那样 `lo` 的排除规则就会有两份。
   */
  const perInterface = parseLinuxProbe(frame(withSections({ NET: ['NET', ['4096 2048', '8192 4096']] })))
  assert.equal(perInterface.net, null)
  assert.equal(perInterface.issues.net, 'invalid-data')
})

test('the shipped command excludes loopback and sums the remaining interfaces', async t => {
  /*
   * `lo` 的排除和跨接口求和写在脚本里，macOS 上跑不了 /proc，所以这里把脚本里
   * 读 /proc/net/dev 的那一行原样取出来，只把路径指向 fixture —— 被测的 awk 程序
   * 是随包发出去的那一份，不是抄来的一份。
   *
   * lo 的计数刻意开得很大：如果哪一天它被算进来，这里的和会明显对不上。
   */
  const line = LINUX_MONITOR_COMMAND.split('\n').find(candidate => candidate.includes('/proc/net/dev'))
  assert.ok(line, 'the shipped command must read /proc/net/dev')

  const directory = await scratch(t)
  const file = join(directory, 'dev')
  await writeFile(file, [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo: 999999999 1 0 0 0 0 0 0 888888888 1 0 0 0 0 0 0',
    '  eth0: 4096 1 0 0 0 0 0 0 2048 1 0 0 0 0 0 0',
    ' wlan0: 8192 1 0 0 0 0 0 0 4096 1 0 0 0 0 0 0',
    '',
  ].join('\n'))

  const { stdout } = await run('sh', ['-c', `${line.replace('/proc/net/dev', file)}\nprintf '%s' "$net"`])
  assert.equal(stdout, '12288 6144')

  // 同一个 payload 喂进解析器，得到的就是这两个整数本身。
  const probe = parseLinuxProbe(frame(withSections({ NET: ['NET', [stdout]] })))
  assert.deepEqual(probe.net, [12288n, 6144n])
})

test('the shipped CPU section reads the aggregate row and drops the guest columns', async t => {
  const directory = await scratch(t)
  const stdout = await runSection(directory, '/proc/stat', 'CPU', [
    'cpu  150 0 150 900 0 0 0 0 400 500',
    'cpu0 75 0 75 450 0 0 0 0 200 250',
    'cpu1 75 0 75 450 0 0 0 0 200 250',
    'intr 12345',
    '',
  ].join('\n'))

  // 第一行（聚合行）而不是 cpu0；guest / guest_nice 两列不出现在输出里。
  assert.equal(stdout, 'CPU\ncpu 150 0 150 900 0 0 0 0\nSTATUS 0\n')
  const payload = stdout.trimEnd().split('\n').slice(1, -1)
  assert.deepEqual(parseLinuxProbe(frame(withSections({ CPU: ['CPU', payload] }))).cpu, CPU_AFTER)
})

test('the shipped memory section prints only the two lines it needs', async t => {
  const directory = await scratch(t)
  const total = 'MemTotal:       16384000 kB'
  const available = 'MemAvailable:    9876543 kB'
  const stdout = await runSection(directory, '/proc/meminfo', 'MEMORY', [
    total,
    'MemFree:         1234567 kB',
    available,
    'Buffers:          123456 kB',
    '',
  ].join('\n'))
  // 只要这两行：把整个 /proc/meminfo 发回来会让每次探测都逼近字节上限。
  assert.equal(stdout, `MEMORY\n${total}\n${available}\nSTATUS 0\n`)

  // 老内核没有 MemAvailable：awk 仍然成功，缺字段由解析器判成 unavailable。
  const legacy = await runSection(directory, '/proc/meminfo', 'MEMORY', `${total}\nMemFree: 1 kB\n`)
  assert.equal(legacy, `MEMORY\n${total}\nSTATUS 0\n`)
  const probe = parseLinuxProbe(frame(withSections({ MEMORY: ['MEMORY', legacy.trimEnd().split('\n').slice(1, -1)] })))
  assert.equal(probe.memory, null)
  assert.equal(probe.issues.memory, 'unavailable')

  // 连 MemTotal 都读不到：这一节必须报失败，而不是产出一个空载荷。
  const broken = await runSection(directory, '/proc/meminfo', 'MEMORY', 'MemFree: 1 kB\n')
  assert.equal(broken, 'MEMORY\n\nSTATUS 1\n')
})

test('root disk parsing tolerates the spacing different df implementations use', () => {
  // BusyBox 的 `df -Pk /` 与 GNU 的列宽不同，行内还有多余空格。
  const busybox = ['Disk /dev/root 100 40 50 45% /', 'Filesystem 1K-blocks Used Available Use% Mounted on']
  const probe = parseLinuxProbe(frame(withSections({ DISK: ['DISK', busybox] })))
  assert.deepEqual(probe.disk, {
    mount: '/', usedBytes: 40 * 1024, totalBytes: 100 * 1024, availableBytes: 50 * 1024,
    usedPercent: 40 / 90 * 100,
  })

  // 只有表头、没有数据行时是「量不到」，不是零。
  const headerOnly = parseLinuxProbe(frame(withSections({ DISK: ['DISK', [DISK[0]]] })))
  assert.equal(headerOnly.disk, null)
  assert.equal(headerOnly.issues.disk, 'unavailable')
})

test('a section that failed is unavailable, and its payload is ignored', () => {
  const probe = parseLinuxProbe(frame(withSections({ LOAD: ['LOAD', ['0.5 1 2'], 1] })))
  assert.equal(probe.load, null)
  assert.equal(probe.issues.load, 'unavailable')
  // 其余指标不受影响：这是「部分可用」，不是整帧失败。
  assert.deepEqual(probe.memory, { usedBytes: 600 * 1024, totalBytes: 1000 * 1024, usedPercent: 60 })
  assert.equal(probe.uptimeSeconds, 86400.5)
})

test('a missing MemAvailable is unavailable, and a malformed one is invalid data', () => {
  const missing = parseLinuxProbe(frame(withSections({ MEMORY: ['MEMORY', ['MemTotal: 1000 kB']] })))
  assert.equal(missing.memory, null)
  // 缺字段就是没量到；用 MemFree 顶替会给出一个不同的、看起来同样合理的数。
  assert.equal(missing.issues.memory, 'unavailable')

  // 本地化的千位分隔符：`1.000` 不是 1000，读错一位就是三个数量级。
  const localized = parseLinuxProbe(frame(withSections({ MEMORY: ['MEMORY', ['MemTotal: 1.000 kB', 'MemAvailable: 400 kB']] })))
  assert.equal(localized.memory, null)
  assert.equal(localized.issues.memory, 'invalid-data')

  // 可用大于总量只可能是坏数据。
  const impossible = parseLinuxProbe(frame(withSections({ MEMORY: ['MEMORY', ['MemTotal: 1000 kB', 'MemAvailable: 4000 kB']] })))
  assert.equal(impossible.memory, null)
  assert.equal(impossible.issues.memory, 'invalid-data')
})

test('uptime and load reject non-numeric or impossible payloads instead of guessing', () => {
  const comma = parseLinuxProbe(frame(withSections({ UPTIME: ['UPTIME', ['86400,5']] })))
  assert.equal(comma.uptimeSeconds, null)
  assert.equal(comma.issues.uptime, 'invalid-data')

  const negative = parseLinuxProbe(frame(withSections({ UPTIME: ['UPTIME', ['-1']] })))
  assert.equal(negative.uptimeSeconds, null)
  assert.equal(negative.issues.uptime, 'invalid-data')

  const empty = parseLinuxProbe(frame(withSections({ UPTIME: ['UPTIME', []] })))
  assert.equal(empty.uptimeSeconds, null)
  assert.equal(empty.issues.uptime, 'unavailable')

  const shortLoad = parseLinuxProbe(frame(withSections({ LOAD: ['LOAD', ['0.5 1']] })))
  assert.equal(shortLoad.load, null)
  assert.equal(shortLoad.issues.load, 'invalid-data')
})

test('excessive integers are refused rather than rounded onto the wire', () => {
  // 21 位：超出 64 位无符号整数的正常范围，也超出安全 JavaScript 整数。
  const huge = parseLinuxProbe(frame(withSections({ CPU: ['CPU', ['cpu 150 0 150 900 0 0 0 99999999999999999999999']] })))
  assert.equal(huge.cpu, null)
  assert.equal(huge.issues.cpu, 'invalid-data')

  const hugeNet = parseLinuxProbe(frame(withSections({ NET: ['NET', ['99999999999999999999999 1']] })))
  assert.equal(hugeNet.net, null)
  assert.equal(hugeNet.issues.net, 'invalid-data')

  // 20 位能读进来（BigInt 不丢精度），但一旦换算成字节就会溢出安全整数。
  const wide = parseLinuxProbe(frame(withSections({ MEMORY: ['MEMORY', ['MemTotal: 99999999999999999999 kB', 'MemAvailable: 1 kB']] })))
  assert.equal(wide.memory, null)
  assert.equal(wide.issues.memory, 'invalid-data')
})

test('a non-Linux target ends after its OS section', () => {
  const probe = parseLinuxProbe(frame([], { os: 'Darwin' }))
  assert.equal(probe.os, 'Darwin')
  assert.equal(probe.cpu, null)
  assert.equal(probe.memory, null)
  assert.equal(probe.load, null)
  assert.equal(probe.disk, null)
  assert.equal(probe.net, null)
  assert.equal(probe.uptimeSeconds, null)
  // HostMonitor 会据此发布 unsupported；在采集器这一层，六个指标就是都没量到。
  assert.deepEqual(probe.issues, {
    cpu: 'unavailable', memory: 'unavailable', load: 'unavailable',
    disk: 'unavailable', net: 'unavailable', uptime: 'unavailable',
  })
})

test('a banner before the frame is skipped, and CRLF frames parse the same way', () => {
  const prefix = ['Last login: Tue Sep 26 10:00:00 2026 from 10.0.0.2']
  const probe = parseLinuxProbe(frame(allSections(), { prefix }))
  assert.deepEqual(probe.cpu, CPU_AFTER)
  assert.deepEqual(probe.issues, {})

  const crlf = frame(allSections()).replace(/\n/g, '\r\n')
  assert.deepEqual(parseLinuxProbe(crlf), probe)
})

test('malformed framing is rejected rather than parsed leniently', () => {
  const cases = {
    'no frame at all': 'Last login: nothing here\n',
    'duplicate frame': `${frame(allSections())}${frame(allSections())}`,
    'out of order sections': frame([['MEMORY', MEMORY], ['CPU', [CPU]], ['LOAD', [LOAD]], ['DISK', DISK], ['NET', [NET]], ['UPTIME', [UPTIME]]]),
    'missing status line': frame([['CPU', [CPU]], ['MEMORY', ['MemTotal: 1000 kB']]]),
    'truncated after OS': frame([], {}).replace(/\nEND\n$/, '\n'),
    'content after END': `${frame(allSections())}unexpected\n`,
    'status out of range': frame([['CPU', [CPU]], ...allSections().slice(1)]).replace('STATUS 0\nMEMORY', 'STATUS 300\nMEMORY'),
    'OS with two payload lines': frame([], { os: 'Linux\nextra' }),
    'non-Linux followed by Linux sections': frame(allSections(), { os: 'Darwin' }),
  }
  for (const [name, output] of Object.entries(cases)) {
    assert.throws(() => parseLinuxProbe(output), new RegExp('监控'), name)
  }
})

test('every missing metric produces exactly one issue, and none when all six are available', () => {
  const failed = {
    CPU: ['CPU', [], 1], MEMORY: ['MEMORY', [], 1], LOAD: ['LOAD', [], 1],
    DISK: ['DISK', [], 1], NET: ['NET', [], 1], UPTIME: ['UPTIME', [], 1],
  }

  const complete = toMonitorSnapshot(parseLinuxProbe(frame(allSections())), READY_BASELINE, 1_002_000)
  assert.deepEqual(complete.issues, {})
  assert.equal(MONITOR_METRICS.length, 6)

  for (const metric of MONITOR_METRICS) {
    const section = metric.toUpperCase()
    const probe = parseLinuxProbe(frame(withSections({ [section]: failed[section] })))
    const snapshot = toMonitorSnapshot(probe, READY_BASELINE, 1_002_000)
    assert.deepEqual(Object.keys(snapshot.issues), [metric], `${metric} must be the only issue`)
    assert.equal(snapshot.issues[metric], 'unavailable')
    // 恰好少一个指标：其余五个都还在。
    assert.equal(MONITOR_METRICS.filter(key => snapshot.issues[key] === undefined).length, 5)
  }
})

test('the snapshot survives the wire validator it will be sent through', () => {
  const snapshot = toMonitorSnapshot(parseLinuxProbe(frame(allSections())), READY_BASELINE, 1_002_000)
  const identity = { sessionId: 'ssh-1', subscriptionId: 'sub-1', sequence: 1 }

  // 六个指标全在 -> ready。
  const ready = parseMonitorUpdate({ ...identity, status: 'ready', snapshot })
  assert.deepEqual(ready.snapshot, snapshot)

  // 少一个 -> partial，且 issue 恰好一个。
  const partialSnapshot = toMonitorSnapshot(
    parseLinuxProbe(frame(withSections({ LOAD: ['LOAD', [], 1] }))), READY_BASELINE, 1_002_000,
  )
  const partial = parseMonitorUpdate({ ...identity, status: 'partial', snapshot: partialSnapshot })
  assert.equal(partial.status, 'partial')
  assert.deepEqual(partial.snapshot.issues, { load: 'unavailable' })

  // 一个都量不到 -> error：snapshot 必须是 null 并带上原因，而不是一张全 null 的表。
  const empty = toMonitorSnapshot(parseLinuxProbe(frame(allFailedSections())), null, 1_002_000)
  assert.equal(MONITOR_METRICS.every(metric => empty.issues[metric] === 'unavailable'), true)
  const error = parseMonitorUpdate({ ...identity, status: 'error', snapshot: null, message: '这台主机没有给出任何可用的指标。' })
  assert.equal(error.snapshot, null)
  // 全 null 的快照不能冒充 error 的载荷：那样界面上会出现六个空槽而不是一句原因。
  assert.throws(() => parseMonitorUpdate({ ...identity, status: 'error', snapshot: empty, message: 'x' }), /snapshot/)
})

test('the shipped command is one fixed POSIX script with no interpolation', () => {
  // 两个字符：反斜杠 + n。脚本里的 `\n` 是交给 printf 的，不是真的换行。
  const ESCAPED_NEWLINE = '\\n'
  assert.match(LINUX_MONITOR_COMMAND, /^LC_ALL=C; export LC_ALL\n/)
  for (const marker of ['OS', 'CPU', 'MEMORY', 'LOAD', 'DISK', 'NET', 'UPTIME', 'END']) {
    assert.ok(
      LINUX_MONITOR_COMMAND.includes(`'${marker}${ESCAPED_NEWLINE}`),
      `the command must print the ${marker} marker`,
    )
  }
  assert.match(LINUX_MONITOR_COMMAND, /PURETERM_MONITOR_V1/)
  // 每一节都以自己的退出状态收尾，失败的命令不能伪装成一次成功的空测量。
  assert.equal((LINUX_MONITOR_COMMAND.match(/STATUS %s\\n/g) ?? []).length, 7)
  // 没有参数、没有变量插值、没有临时文件。
  assert.doesNotMatch(LINUX_MONITOR_COMMAND, /\$\{/)
  assert.doesNotMatch(LINUX_MONITOR_COMMAND, /\bmktemp\b|\/tmp\//)
})

test('the shipped command is valid POSIX sh and its frame is one this parser accepts', async () => {
  /*
   * 真跑一遍随包发出去的那份脚本，而不是只对字符串做断言。
   *
   * macOS 上得到的是设计里那帧只有 OS 的 Darwin 帧；Linux 上会得到完整帧。两种都
   * 证明同一件事：脚本是可执行的 POSIX sh，且它产出的帧格式与解析器完全一致。
   * 远端登录 shell 是 sh / bash / zsh 中的哪一种不该改变结果，所以三种都试。
   */
  let ran = 0
  for (const shell of ['sh', 'bash', 'zsh']) {
    const stdout = await tryShell(shell, LINUX_MONITOR_COMMAND)
    if (stdout === null) continue
    ran++
    const probe = parseLinuxProbe(stdout)
    assert.ok(probe.os.length > 0, `${shell} produced no OS name`)
    if (probe.os === 'Linux') {
      // 真在 Linux 上跑：量不到也必须是带原因的 null，不能凭空消失。
      for (const metric of MONITOR_METRICS) {
        if (probe.issues[metric] !== undefined) assert.equal(probe.issues[metric], 'unavailable')
      }
    } else {
      assert.equal(probe.cpu, null)
      assert.equal(MONITOR_METRICS.every(metric => probe.issues[metric] === 'unavailable'), true)
    }
  }
  assert.ok(ran > 0, 'at least one POSIX shell must be available to run the shipped command')
})

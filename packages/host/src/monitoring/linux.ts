import type { MonitorSnapshot } from '@pureterm/protocol'

/*
 * Linux 采集器：一帧文本进，一份快照出。
 *
 * 全程纯函数，不碰 SSH、不碰渲染层、不读本地文件——「把远端输出变成数字」和
 * 「怎么拿到这份输出」是两件事，混在一起就没法用固定输入把算法钉死。
 *
 * 三条贯穿全文的取舍：
 * 1. **量不到就是 null，不是 0。** 每个 null 都必须在 issues 里带上原因，因为
 *    0% 的 CPU 和「没读到 /proc/stat」在界面上长得一模一样。
 * 2. **缺字段和坏字段要分开说。** 缺 = unavailable（这台机器没给），坏 = invalid-data
 *    （给了但读不懂）。两者的下一步动作不同：一个是换指标，一个是修解析。
 * 3. **BigInt 只在内部。** 线上字节必须是安全 JavaScript 整数，溢出算「量不到」，
 *    不是一个四舍五入过的数。
 */

/** 八个聚合 CPU 计数器：user, nice, system, idle, iowait, irq, softirq, steal。 */
export type CpuCounters = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
/** 非 `lo` 接口的累计接收、发送字节数之和。 */
export type NetCounters = readonly [bigint, bigint]

/**
 * 上一次成功探测的基线。
 *
 * CPU 和网络共用一个时间戳，所以是一整个对象而不是两个参数：两次采样时刻不同的
 * 基线会算出一个**从未发生过**的速率，而那个数看起来完全正常。
 */
export interface PreviousSample {
  collectedAt: number
  cpu: CpuCounters
  net: NetCounters
}

export interface LinuxProbe {
  os: string
  cpu: CpuCounters | null
  memory: MonitorSnapshot['memory']
  load: MonitorSnapshot['load']
  disk: MonitorSnapshot['disk']
  net: NetCounters | null
  uptimeSeconds: number | null
  issues: MonitorSnapshot['issues']
}

type Issues = MonitorSnapshot['issues']

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
/** 十进制的位数上限：再多就不可能是真实的计数器值，只可能是坏数据。 */
const DECIMAL = /^[0-9]{1,20}$/
/** 小数：不接受 `+5`、`.5`、`5.`、`1e5`，也不接受 `86400,5` 这种本地化写法。 */
const DECIMAL_NUMBER = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const SECTION_NAMES = ['OS', 'CPU', 'MEMORY', 'LOAD', 'DISK', 'NET', 'UPTIME'] as const
/** 分节顺序。TS 的 `includes` 不收 string，所以留一份宽类型视图给帧校验用。 */
const SECTION_ORDER: readonly string[] = SECTION_NAMES
const FRAME_HEADER = 'PURETERM_MONITOR_V1'
const STATUS_LINE = /^STATUS ([0-9]{1,3})$/

/**
 * 固定脚本。整条作为 `SshService.exec` 的 command 传过去，不再套一层 `sh -c` 引号。
 *
 * 结构是「一节一行标记 + 载荷 + 自己的退出状态」。带上退出状态是必需的：没有它，
 * 一次失败的读取（`/proc` 没挂上、`df` 不认识这个参数）会产出一个空载荷，而空载荷
 * 和「这台机器真的没有这个字段」长得一模一样。
 *
 * `uname -s` 不是 Linux 时，只留 OS 一节就收尾：其余分节的字段在别的系统上语义
 * 完全不同，硬读一遍只会把「不支持」说成「量不到」。
 */
export const LINUX_MONITOR_COMMAND: string = [
  'LC_ALL=C; export LC_ALL',
  "printf 'PURETERM_MONITOR_V1\\n'",
  'os=$(uname -s 2>/dev/null); os_status=$?',
  "printf 'OS\\n%s\\nSTATUS %s\\n' \"$os\" \"$os_status\"",
  'if [ "$os_status" -ne 0 ] || [ "$os" != Linux ]; then',
  "  printf 'END\\n'",
  '  exit 0',
  'fi',
  // 第一行就是聚合的 `cpu` 行。多读的两个 guest 列只用来占位，不打印。
  'read -r cpu_tag cpu_user cpu_nice cpu_system cpu_idle cpu_iowait cpu_irq cpu_softirq cpu_steal cpu_guest cpu_guest_nice < /proc/stat 2>/dev/null; cpu_status=$?',
  "printf 'CPU\\ncpu %s %s %s %s %s %s %s %s\\nSTATUS %s\\n' \"$cpu_user\" \"$cpu_nice\" \"$cpu_system\" \"$cpu_idle\" \"$cpu_iowait\" \"$cpu_irq\" \"$cpu_softirq\" \"$cpu_steal\" \"$cpu_status\"",
  // 只要这两行；MemAvailable 缺失时 awk 仍然成功，缺字段由解析器判定。
  "memory=$(awk '/^MemTotal:/{print; t=1} /^MemAvailable:/{print; a=1} END{if (!t) exit 1}' /proc/meminfo 2>/dev/null); memory_status=$?",
  "printf 'MEMORY\\n%s\\nSTATUS %s\\n' \"$memory\" \"$memory_status\"",
  "load=$(awk '{print $1 \" \" $2 \" \" $3; exit}' /proc/loadavg 2>/dev/null); load_status=$?",
  "printf 'LOAD\\n%s\\nSTATUS %s\\n' \"$load\" \"$load_status\"",
  'disk=$(df -Pk / 2>/dev/null); disk_status=$?',
  "printf 'DISK\\n%s\\nSTATUS %s\\n' \"$disk\" \"$disk_status\"",
  /*
   * 跨接口求和，并在这里排除 `lo`。放在脚本里的理由：这样求和规则只有一份，
   * 解析器拿到的就是一个已经算好的 `rx tx` 对。`lo` 是回环，把它算进吞吐量会让
   * 本机内部的流量看起来像网络流量。
   *
   * 数字用 awk 的 double 累加，超过 2^53 会丢精度；解析器的安全整数检查会把
   * 那种值判成坏数据（量不到），而不是拿一个略微不对的速率去画图。
   */
  'net=$(awk \'NF >= 10 { name=$1; sub(/:$/, "", name); if (name != "" && name != "lo" && $2 ~ /^[0-9]+$/ && $10 ~ /^[0-9]+$/) { rx += $2; tx += $10 } } END { printf "%d %d\\n", rx, tx }\' /proc/net/dev 2>/dev/null); net_status=$?',
  "printf 'NET\\n%s\\nSTATUS %s\\n' \"$net\" \"$net_status\"",
  "uptime=$(awk 'NR == 1 {print $1; exit}' /proc/uptime 2>/dev/null); uptime_status=$?",
  "printf 'UPTIME\\n%s\\nSTATUS %s\\n' \"$uptime\" \"$uptime_status\"",
  "printf 'END\\n'",
].join('\n')

interface Section {
  payload: string[]
  /** 该节的命令是否成功。失败时载荷一律不读。 */
  ok: boolean
}

/** 帧结构本身不合法。这类错误不是「某个指标量不到」，而是整次探测没有可信输出。 */
function invalidFrame(what: string): never {
  throw new Error(`监控输出不是可识别的数据帧：${what}`)
}

/**
 * 读出帧里的分节。
 *
 * 只允许在第一个帧标记之前出现前缀行（远端登录横幅就是那样来的），标记之后的一切
 * 都必须严格符合约定：分节顺序固定、每节以 STATUS 收尾、END 之后不许再有内容。
 * 宽松解析在这里是有害的——把一段错位的内容读成某个指标的值，比直接失败更糟。
 */
function readFrame(stdout: string): { os: string; sections: Map<string, Section> } {
  const lines = stdout.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
  const header = lines.indexOf(FRAME_HEADER)
  if (header < 0) invalidFrame('没有找到起始标记')
  if (lines.indexOf(FRAME_HEADER, header + 1) >= 0) invalidFrame('出现了重复的帧')

  const sections = new Map<string, Section>()
  let cursor = header + 1
  let os: string | null = null

  for (const name of SECTION_NAMES) {
    if (lines[cursor] !== name) {
      invalidFrame(`期望 ${name} 分节，实际读到「${lines[cursor] ?? '（输出已结束）'}」`)
    }
    cursor++
    const payload: string[] = []
    let status: number | null = null
    while (cursor < lines.length) {
      const line = lines[cursor]!
      const matched = STATUS_LINE.exec(line)
      if (matched) {
        status = Number(matched[1])
        cursor++
        break
      }
      // 遇到下一个分节标记或 END，说明这一节没有收尾状态。
      if (SECTION_ORDER.includes(line) || line === 'END') break
      payload.push(line)
      cursor++
    }
    if (status === null) invalidFrame(`${name} 分节没有结束状态行`)
    if (status > 255) invalidFrame(`${name} 分节的退出状态超出范围`)
    sections.set(name, { payload, ok: status === 0 })

    if (name === 'OS') {
      const named = payload.filter(line => line.trim() !== '')
      if (status !== 0 || named.length !== 1) invalidFrame('OS 分节不可用')
      os = named[0]!.trim()
      // 非 Linux：脚本在这一节之后就收尾了，后面的分节不该出现。
      if (os !== 'Linux') break
    }
  }

  if (lines[cursor] !== 'END') invalidFrame('没有找到结束标记')
  cursor++
  if (lines.slice(cursor).some(line => line.trim() !== '')) invalidFrame('结束标记之后还有内容')
  if (os === null) invalidFrame('缺少 OS 分节')
  return { os, sections }
}

/** 把一节的载荷摊平成 token。空行不参与。 */
function tokensOf(section: Section): string[] {
  return section.payload.flatMap(line => line.trim().split(/\s+/)).filter(token => token !== '')
}

function toCounters(token: string | undefined): bigint | null {
  if (!token || !DECIMAL.test(token)) return null
  return BigInt(token)
}

/** BigInt -> 安全整数。超界返回 null：线上字节宁可缺失，也不要一个被取整的数。 */
function toSafeNumber(value: bigint): number | null {
  const magnitude = value < 0n ? -value : value
  return magnitude > MAX_SAFE ? null : Number(value)
}

/** 只在最后的百分比边界上夹一下浮点误差，不夹真正的越界（越界在前面已被拒绝）。 */
function clampPercent(value: number): number {
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function readCpu(section: Section, issues: Issues): CpuCounters | null {
  if (!section.ok) {
    issues.cpu = 'unavailable'
    return null
  }
  const tokens = tokensOf(section)
  // 命令成功却一个字段都没有：字段是缺的，不是坏的。
  if (tokens.length === 0) {
    issues.cpu = 'unavailable'
    return null
  }
  // 载荷里还有 guest / guest_nice 两列；它们已经计入 user / nice，所以只取前八个。
  if (tokens[0] !== 'cpu' || tokens.length < 9) {
    issues.cpu = 'invalid-data'
    return null
  }
  const counters: bigint[] = []
  for (let index = 1; index <= 8; index++) {
    const value = toCounters(tokens[index])
    if (value === null) {
      issues.cpu = 'invalid-data'
      return null
    }
    counters.push(value)
  }
  return counters as unknown as CpuCounters
}

/** 读 `MemTotal: 1000 kB` 这样的行。单位只认 kB，认不出就不猜。 */
function readKb(line: string): bigint | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens.length < 2 || tokens.length > 3) return null
  if (tokens.length === 3 && tokens[2] !== 'kB') return null
  return toCounters(tokens[1])
}

function readMemory(section: Section, issues: Issues): MonitorSnapshot['memory'] {
  if (!section.ok) {
    issues.memory = 'unavailable'
    return null
  }
  const totalLine = section.payload.find(line => line.startsWith('MemTotal:'))
  const availableLine = section.payload.find(line => line.startsWith('MemAvailable:'))
  // 缺 MemAvailable 就是缺：用 MemFree 顶替会给出另一个同样「合理」的数。
  if (!totalLine || !availableLine) {
    issues.memory = 'unavailable'
    return null
  }
  const totalKb = readKb(totalLine)
  const availableKb = readKb(availableLine)
  if (totalKb === null || availableKb === null || totalKb <= 0n || availableKb > totalKb) {
    issues.memory = 'invalid-data'
    return null
  }
  const totalBytes = totalKb * 1024n
  const usedBytes = (totalKb - availableKb) * 1024n
  const total = toSafeNumber(totalBytes)
  const used = toSafeNumber(usedBytes)
  if (total === null || used === null) {
    issues.memory = 'invalid-data'
    return null
  }
  return { usedBytes: used, totalBytes: total, usedPercent: clampPercent(100 * used / total) }
}

function readLoad(section: Section, issues: Issues): MonitorSnapshot['load'] {
  if (!section.ok) {
    issues.load = 'unavailable'
    return null
  }
  const tokens = tokensOf(section)
  if (tokens.length === 0) {
    issues.load = 'unavailable'
    return null
  }
  if (tokens.length < 3) {
    issues.load = 'invalid-data'
    return null
  }
  const values: number[] = []
  for (let index = 0; index < 3; index++) {
    const token = tokens[index]!
    if (!DECIMAL_NUMBER.test(token)) {
      issues.load = 'invalid-data'
      return null
    }
    values.push(Number(token))
  }
  // 三个原始值，不换算成百分比，也不假设核数。
  return { one: values[0]!, five: values[1]!, fifteen: values[2]! }
}

/**
 * 从 `df -Pk /` 里找挂载点为 `/` 的数据行。
 *
 * **从右往左取**：文件系统名可能含空格，但挂载点不会。表头那行的最后一列是 `on`，
 * 自然被排除。
 */
function readDiskRow(section: Section): { total: string; used: string; available: string } | null {
  for (const line of section.payload) {
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < 6 || tokens[tokens.length - 1] !== '/') continue
    return {
      total: tokens[tokens.length - 5]!,
      used: tokens[tokens.length - 4]!,
      available: tokens[tokens.length - 3]!,
    }
  }
  return null
}

function readDisk(section: Section, issues: Issues): MonitorSnapshot['disk'] {
  if (!section.ok) {
    issues.disk = 'unavailable'
    return null
  }
  const row = readDiskRow(section)
  if (!row) {
    issues.disk = 'unavailable'
    return null
  }
  const totalKb = toCounters(row.total)
  const usedKb = toCounters(row.used)
  const availableKb = toCounters(row.available)
  if (totalKb === null || usedKb === null || availableKb === null || totalKb <= 0n || usedKb + availableKb <= 0n) {
    issues.disk = 'invalid-data'
    return null
  }
  const totalBytes = totalKb * 1024n
  const usedBytes = usedKb * 1024n
  const availableBytes = availableKb * 1024n
  const total = toSafeNumber(totalBytes)
  const used = toSafeNumber(usedBytes)
  const available = toSafeNumber(availableBytes)
  const denominator = toSafeNumber((usedKb + availableKb) * 1024n)
  if (total === null || used === null || available === null || denominator === null || used > total || available > total) {
    issues.disk = 'invalid-data'
    return null
  }
  // 保留块让 used + available 可以小于 total，所以分母是 used + available。
  return { mount: '/', usedBytes: used, totalBytes: total, availableBytes: available, usedPercent: clampPercent(100 * used / denominator) }
}

function readNet(section: Section, issues: Issues): NetCounters | null {
  if (!section.ok) {
    issues.net = 'unavailable'
    return null
  }
  const tokens = tokensOf(section)
  if (tokens.length === 0) {
    issues.net = 'unavailable'
    return null
  }
  // 恰好两个整数。逐接口的行在这里会被拒绝，而不是被二次求和。
  if (tokens.length !== 2) {
    issues.net = 'invalid-data'
    return null
  }
  const received = toCounters(tokens[0])
  const transmitted = toCounters(tokens[1])
  if (received === null || transmitted === null) {
    issues.net = 'invalid-data'
    return null
  }
  return [received, transmitted]
}

function readUptime(section: Section, issues: Issues): number | null {
  if (!section.ok) {
    issues.uptime = 'unavailable'
    return null
  }
  const tokens = tokensOf(section)
  if (tokens.length === 0) {
    issues.uptime = 'unavailable'
    return null
  }
  if (tokens.length !== 1 || !DECIMAL_NUMBER.test(tokens[0]!)) {
    issues.uptime = 'invalid-data'
    return null
  }
  return Number(tokens[0])
}

/**
 * 解析一次探测的输出。
 *
 * 帧结构不合法时抛出（整次探测没有可信输出）；帧合法但某一节读不出来时，那一个
 * 指标为 null 并带上原因，其余指标照常可用。
 */
export function parseLinuxProbe(stdout: string): LinuxProbe {
  const { os, sections } = readFrame(stdout)
  const issues: Issues = {}
  const section = (name: string): Section => sections.get(name) ?? { payload: [], ok: false }

  const cpu = readCpu(section('CPU'), issues)
  const memory = readMemory(section('MEMORY'), issues)
  const load = readLoad(section('LOAD'), issues)
  const disk = readDisk(section('DISK'), issues)
  const net = readNet(section('NET'), issues)
  const uptimeSeconds = readUptime(section('UPTIME'), issues)

  return { os, cpu, memory, load, disk, net, uptimeSeconds, issues }
}

/** 两个样本之间的 CPU 占用率。没有可用的基线就返回 null，绝不编一个 0。 */
function cpuPercentOf(current: CpuCounters, previous: PreviousSample): number | null {
  const deltas: bigint[] = []
  for (let index = 0; index < 8; index++) {
    const delta = current[index] - previous.cpu[index]
    // 计数器回退意味着机器重启或计数器回绕，两种都不是速率。
    if (delta < 0n) return null
    deltas.push(delta)
  }
  const total = deltas.reduce((sum, value) => sum + value, 0n)
  if (total <= 0n) return null
  const idle = deltas[3]! + deltas[4]!
  const busy = total - idle
  if (busy < 0n) return null
  const active = toSafeNumber(busy)
  const whole = toSafeNumber(total)
  if (active === null || whole === null) return null
  return clampPercent(100 * active / whole)
}

/** 单个方向的字节速率。回退或时间不前进都返回 null。 */
function rateOf(current: bigint, previous: bigint, elapsedMs: number): number | null {
  const delta = current - previous
  if (delta < 0n) return null
  const scaled = toSafeNumber(delta * 1000n)
  if (scaled === null) return null
  const rate = scaled / elapsedMs
  return Number.isFinite(rate) ? rate : null
}

function netRatesOf(current: NetCounters, previous: PreviousSample, collectedAt: number): MonitorSnapshot['net'] {
  const elapsed = collectedAt - previous.collectedAt
  // 时间没有前进就没有除数；两个方向共用一个时间戳，所以整对一起作废。
  if (!Number.isSafeInteger(elapsed) || elapsed <= 0) return null
  const received = rateOf(current[0], previous.net[0], elapsed)
  const transmitted = rateOf(current[1], previous.net[1], elapsed)
  if (received === null || transmitted === null) return null
  return { receivedBytesPerSecond: received, transmittedBytesPerSecond: transmitted }
}

/**
 * 把一次探测加上基线，变成要发出去的快照。
 *
 * `previous` 是有意设计成**一整对**的：CPU 和网络共用 `collectedAt`，所以基线要么
 * 两个方向都能用，要么整对作废。只有一半的基线会算出一个从未发生过的速率。
 */
export function toMonitorSnapshot(probe: LinuxProbe, previous: PreviousSample | null, collectedAt: number): MonitorSnapshot {
  const issues: Issues = { ...probe.issues }

  const cpuPercent = probe.cpu && previous ? cpuPercentOf(probe.cpu, previous) : null
  // 有计数器却没算出百分比：没有基线是「预热中」，有基线是这一对样本不能用。
  if (probe.cpu && cpuPercent === null) issues.cpu = previous ? 'invalid-data' : 'warming-up'

  const net = probe.net && previous ? netRatesOf(probe.net, previous, collectedAt) : null
  if (probe.net && net === null) issues.net = previous ? 'invalid-data' : 'warming-up'

  return {
    collectedAt,
    cpuPercent,
    memory: probe.memory,
    load: probe.load,
    disk: probe.disk,
    net,
    uptimeSeconds: probe.uptimeSeconds,
    issues,
  }
}

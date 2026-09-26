/*
 * 监控验收用的 Linux 探测帧。
 *
 * 这不是从产品代码里导出的格式，而是**照着契约手写的第二份**：宿主测试
 * （`packages/host/tests/host-monitor.test.mjs`）就是这么做的，理由是「期望值必须是
 * 字面计算结果，不能由被测解析器生成」。这里同一份理由再成立一次——如果帧由
 * `monitoring/linux.ts` 生成，那这套验收就只是在证明它和自己一致。
 *
 * 帧必须**每次探测都推进**，而且不能只是「最后一帧重复」。CPU 和网络是增量指标：
 * 同一对计数器两次探测的差值为零，会被正确地判成 `invalid-data`。这不只是预热那一轮
 * 的事——暂停后继续、点重试都会在宿主那里开一次新订阅并重置基线，于是第一轮又变成
 * 预热。一个有限的帧列表会让这些路径永远回不到 ready，而它们恰恰是要验收的路径。
 *
 * 只有 CPU 的比例、内存、负载、磁盘和 uptime 是可断言的定值；网络速率取决于两次
 * 探测的真实间隔，验收里只断言形状，不断言数字。
 */
const HEADER = 'PURETERM_MONITOR_V1'
const ok = (name, lines) => [name, ...lines, 'STATUS 0']

function frame(step) {
  return [
    HEADER,
    'OS', 'Linux', 'STATUS 0',
    // 每轮 user +50、system +50、idle +100：忙增量和总增量之比恒为 100/200。
    ...ok('CPU', [`cpu ${100 + step * 50} 0 ${100 + step * 50} ${800 + step * 100} 0 0 0 0 0 0`]),
    ...ok('MEMORY', ['MemTotal: 1000 kB', 'MemAvailable: 400 kB']),
    ...ok('LOAD', ['0.5 1 2 1/234 5678']),
    ...ok('DISK', ['Filesystem 1024-blocks Used Available Capacity Mounted on', '/dev/root 100 40 50 45% /']),
    // 每轮多收 20,480、多发 10,240 字节，速率取决于真实间隔。
    ...ok('NET', [`${4096 + step * 20480} ${2048 + step * 10240}`]),
    ...ok('UPTIME', ['86400.5']),
    'END', '',
  ].join('\n')
}

/** 交给夹具的 `execOutput`：每次探测推进一轮，于是每个新订阅的第二轮都是 ready。 */
export function monitorProbe() {
  let step = 0
  return () => frame(step++)
}

/** 定值断言用的期望读数，对应任意一个订阅的第二轮。就是面板画出来的那串字。 */
export const READY_EXPECTATIONS = {
  // 忙增量 100 / 总增量 200：idle 每轮 +100，user 和 system 各 +50。
  cpu: '50.0%',
  // 1000 kB 里可用 400 kB，即用了 60% = 614,400 字节。
  memory: '60.0%（600 KB / 1000 KB）',
  load: '0.50 1.00 2.00',
  // 分母是 used + available = 90，不是 total：保留块让 used + available 可以小于 total。
  disk: '44.4%（40 KB / 100 KB）',
  uptime: '1 天 0 小时',
}

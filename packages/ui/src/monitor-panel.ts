import type { MonitorIssue, MonitorMetric, MonitorSnapshot } from '@pureterm/protocol'
import { DomListeners } from './client-runtime.js'
import { formatBytes } from './format.js'

/**
 * 监控条。**只做两件事：把一次快照画成一行字段、把行上的动作翻译成回调。**
 *
 * 和 sftp-panel.ts 同一条纪律：它不认识 `api`、不认识通道名，也不记自己当前在哪个
 * 会话 —— 展开/暂停是 ClientMonitor 的状态（它要拿这两个值决定采不采集），这里的
 * 输入就是一个 `MonitorPanelState`。记两份就会出现「面板说已暂停而订阅还在跑」。
 *
 * 骨架只建一次，`render` 只改文字和属性。这不是性能考虑：每次更新重建节点会让
 * 正在被键盘操作的那个按钮失去焦点，而设计要的正是「后台更新不动焦点」。
 */

/**
 * 面板要画的状态。
 *
 * `idle` 涵盖连接中/没有会话，`paused` 是折叠、手动暂停、文档不可见、切到别的标签页
 * 这四种「此刻不采集」的统称 —— 它们对用户是同一件事：数字停了，且不是坏了。
 */
export type MonitorStatus =
  | 'idle' | 'loading' | 'ready' | 'partial' | 'paused'
  | 'unsupported' | 'error' | 'disconnected' | 'stale'

export interface MonitorPanelState {
  status: MonitorStatus
  snapshot: MonitorSnapshot | null
  expanded: boolean
  paused: boolean
  message?: string
}

export interface MonitorPanelActions {
  toggleExpanded(): void
  togglePaused(): void
  retry(): void
}

export interface MonitorPanel {
  render(state: MonitorPanelState): void
  dispose(): void
}

const STATUS_TEXT: Record<MonitorStatus, string> = {
  idle: '未开始',
  loading: '读取中…',
  ready: '已更新',
  partial: '部分可用',
  paused: '已暂停',
  unsupported: '不支持监控',
  error: '读取失败',
  disconnected: '连接已结束',
  stale: '数据已过期',
}

/** 一个指标为 null 时，`issues` 里必有它的原因；原因直接说给用户，不写「错误」。 */
const ISSUE_TEXT: Record<MonitorIssue, string> = {
  'warming-up': '需要两个样本，正在预热',
  unavailable: '远端没有提供这一项',
  'invalid-data': '远端给出的读数无法解析',
}

/**
 * 顺序就是读的顺序：先看谁在忙，再看内存和负载，最后是磁盘、网络和主机运行时间。
 *
 * 标签用中文而 CPU 保留缩写：CPU 是这台机器上唯一一个中文里不写「处理器」的词，
 * 而「内存」比 MEM 更好认。单位都跟着数值走，不另设一列。
 */
const FIELDS: ReadonlyArray<{ metric: MonitorMetric; label: string }> = [
  { metric: 'cpu', label: 'CPU' },
  { metric: 'memory', label: '内存' },
  { metric: 'load', label: '负载' },
  { metric: 'disk', label: '磁盘 /' },
  { metric: 'net', label: '网络' },
  { metric: 'uptime', label: '主机运行' },
]

const DASH = '—'

/** 百分比留一位小数：整位数看不出 CPU 从 12% 走到 13%，两位在 11px 字号下就糊了。 */
const percent = (value: number): string => `${value.toFixed(1)}%`
const rate = (bytesPerSecond: number): string => `${formatBytes(bytesPerSecond)}/s`

/**
 * 秒 → 人能读的时长。
 *
 * 只给两级单位：`主机运行 3 天 4 小时` 是答案，`3 天 4 小时 12 分 6 秒` 是把时钟
 * 抄了一遍。这是**主机**的 uptime，不是本会话的时长。
 */
function duration(seconds: number): string {
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days) return `${days} 天 ${hours} 小时`
  if (hours) return `${hours} 小时 ${minutes} 分`
  if (minutes) return `${minutes} 分 ${total % 60} 秒`
  return `${total} 秒`
}

function clock(milliseconds: number): string {
  const date = new Date(milliseconds)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 一个指标这一轮读到的值。null 不画成 0，画成破折号并让原因可查。 */
function valuesOf(snapshot: MonitorSnapshot): Record<MonitorMetric, string> {
  return {
    cpu: snapshot.cpuPercent === null ? DASH : percent(snapshot.cpuPercent),
    memory: snapshot.memory === null ? DASH
      : `${percent(snapshot.memory.usedPercent)}（${formatBytes(snapshot.memory.usedBytes)} / ${formatBytes(snapshot.memory.totalBytes)}）`,
    load: snapshot.load === null ? DASH
      : `${snapshot.load.one.toFixed(2)} ${snapshot.load.five.toFixed(2)} ${snapshot.load.fifteen.toFixed(2)}`,
    disk: snapshot.disk === null ? DASH
      : `${percent(snapshot.disk.usedPercent)}（${formatBytes(snapshot.disk.usedBytes)} / ${formatBytes(snapshot.disk.totalBytes)}）`,
    net: snapshot.net === null ? DASH
      : `↓ ${rate(snapshot.net.receivedBytesPerSecond)} ↑ ${rate(snapshot.net.transmittedBytesPerSecond)}`,
    uptime: snapshot.uptimeSeconds === null ? DASH : duration(snapshot.uptimeSeconds),
  }
}

export function createMonitorPanel(element: HTMLElement, actions: MonitorPanelActions): MonitorPanel {
  const listeners = new DomListeners()
  const document = element.ownerDocument
  element.replaceChildren()

  const row = document.createElement('div')
  row.className = 'monitor-row'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.id = 'monitor-toggle'
  toggle.className = 'monitor-toggle ghost small'
  toggle.setAttribute('aria-controls', 'monitor-body')
  const glyph = document.createElement('i')
  glyph.className = 'ti ti-activity'
  glyph.setAttribute('aria-hidden', 'true')
  const caption = document.createElement('span')
  caption.textContent = '资源'
  toggle.append(glyph, caption)

  // 这一格**不**挂 aria-live：每 5 秒播报一次读数会把终端变成不能用的东西。
  // 状态的含义由文字本身承担，颜色只是重复一遍，所以色觉障碍下也不丢信息。
  const state = document.createElement('span')
  state.id = 'monitor-state'
  state.className = 'monitor-state'

  const body = document.createElement('div')
  body.id = 'monitor-body'
  body.className = 'monitor-body'
  const cells = new Map<MonitorMetric, { field: HTMLElement; value: HTMLElement }>()
  for (const { metric, label } of FIELDS) {
    const field = document.createElement('span')
    field.className = 'monitor-field'
    field.dataset.metric = metric
    const name = document.createElement('span')
    name.className = 'monitor-label'
    name.textContent = label
    const value = document.createElement('span')
    value.className = 'monitor-value'
    value.textContent = DASH
    field.append(name, value)
    body.append(field)
    cells.set(metric, { field, value })
  }

  const fill = document.createElement('span')
  fill.className = 'monitor-fill'

  const detail = document.createElement('span')
  detail.id = 'monitor-detail'
  detail.className = 'monitor-detail'

  const buttons = document.createElement('div')
  buttons.className = 'monitor-actions'
  const pause = document.createElement('button')
  pause.type = 'button'
  pause.id = 'monitor-pause'
  pause.className = 'ghost small'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.id = 'monitor-retry'
  retry.className = 'ghost small'
  retry.textContent = '重试'
  buttons.append(pause, retry)

  row.append(toggle, state, body, fill, detail, buttons)
  element.append(row)

  listeners.add(toggle, 'click', () => actions.toggleExpanded())
  listeners.add(pause, 'click', () => actions.togglePaused())
  listeners.add(retry, 'click', () => actions.retry())

  return {
    render(next: MonitorPanelState): void {
      const live = next.status !== 'idle' && next.status !== 'disconnected'
      element.dataset.status = next.status
      element.classList.toggle('is-expanded', next.expanded)
      toggle.setAttribute('aria-expanded', String(next.expanded))
      toggle.title = next.expanded ? '收起资源监控' : '展开资源监控'
      body.hidden = !next.expanded
      state.textContent = STATUS_TEXT[next.status]

      pause.disabled = !live
      pause.setAttribute('aria-pressed', String(next.paused))
      pause.textContent = next.paused ? '继续' : '暂停'
      pause.title = next.paused ? '继续采集资源指标' : '暂停采集资源指标'
      retry.disabled = !live

      /*
       * 每个快照当作**一次完整观测**：六个字段全部来自同一张快照，绝不把上一轮的
       * 内存和这一轮的 CPU 拼在一起。没有快照时整行是破折号。
       */
      const values = next.snapshot ? valuesOf(next.snapshot) : null
      for (const { metric } of FIELDS) {
        const cell = cells.get(metric)!
        const issue = next.snapshot?.issues[metric]
        cell.value.textContent = values ? values[metric] : DASH
        if (issue) cell.field.dataset.issue = issue
        else delete cell.field.dataset.issue
        cell.field.title = issue ? ISSUE_TEXT[issue] : ''
      }

      // 报错时先说为什么，其余时候说这组数字是什么时候取的。远端文本走 textContent。
      detail.textContent = next.message ?? (next.snapshot ? `采样于 ${clock(next.snapshot.collectedAt)}` : '')
    },
    dispose(): void {
      listeners.clear()
      element.replaceChildren()
      element.classList.remove('is-expanded')
      delete element.dataset.status
    },
  }
}

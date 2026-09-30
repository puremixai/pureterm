import type { MonitorIssue, MonitorMetric, MonitorSnapshot } from '@pureterm/protocol'
import { t, type MessageKey } from '@pureterm/i18n'
import { DomListeners } from './client-runtime.js'
import { formatBytes, formatRate } from './format.js'

/**
 * 资源面板。**只做两件事：把一次快照画成一组分区、把分区上的动作翻译成回调。**
 *
 * 和 sftp-panel.ts 同一条纪律：它不认识 `api`、不认识通道名，也不记自己当前在哪个
 * 会话 —— 开合/暂停是 ClientMonitor 的状态（它要拿这两个值决定采不采集），这里的
 * 输入就是一个 `MonitorPanelState`。记两份就会出现「面板说已暂停而订阅还在跑」。
 *
 * 形态参考远端文件抽屉：右侧一格、面板头一行、下面是可滚动的分区。每个指标是一段
 * `.monitor-field`，CPU/内存/磁盘各带一条占用条，网络带一条由本地累积样本画出的走势
 * 线。骨架只建一次，`render` 只改文字、属性和路径点 —— 每次更新重建节点会让正在被
 * 键盘操作的那个按钮失去焦点，而设计要的正是「后台更新不动焦点」。
 */

/**
 * 面板要画的状态。
 *
 * `idle` 涵盖连接中/没有会话，`paused` 是抽屉收起、手动暂停、文档不可见、切到别的
 * 标签页这四种「此刻不采集」的统称 —— 它们对用户是同一件事：数字停了，且不是坏了。
 */
export type MonitorStatus =
  | 'idle' | 'loading' | 'ready' | 'partial' | 'paused'
  | 'unsupported' | 'error' | 'disconnected' | 'stale'

/** 网络走势里的一帧：收、发两个方向各一个速率。客户端本地累积，不是协议的一部分。 */
export interface NetSample { received: number; transmitted: number }

export interface MonitorPanelState {
  status: MonitorStatus
  snapshot: MonitorSnapshot | null
  open: boolean
  paused: boolean
  /** 有没有可用会话。没有时开关置灰，而不是让用户点开一个空抽屉。 */
  available: boolean
  /** 最近若干帧的网络速率，用于画走势线。空数组表示还画不出线。 */
  history: readonly NetSample[]
  /**
   * 面板底下那一行。**已经解析成句子的文本**，不是 key：面板每次 render 都重画它，
   * 而 render 在换语言时也会被叫一次，所以调用方在那一刻解析出来的就是新语言。
   * 内容本身可能来自远端（宿主报的原文），那部分原样转述。
   */
  message?: string
}

export interface MonitorPanelActions {
  toggleOpen(): void
  togglePaused(): void
  retry(): void
}

export interface MonitorPanel {
  render(state: MonitorPanelState): void
  dispose(): void
}

/**
 * 状态文字。存的是 key，由 render 解析 —— 换语言时面板会重画一次，而这一格是
 * 用户判断「现在读到没有」的唯一依据。
 */
const STATUS_KEY: Record<MonitorStatus, MessageKey> = {
  idle: 'monitor.status.idle',
  loading: 'monitor.status.loading',
  ready: 'monitor.status.ready',
  partial: 'monitor.status.partial',
  paused: 'monitor.status.paused',
  unsupported: 'monitor.status.unsupported',
  error: 'monitor.status.error',
  disconnected: 'monitor.status.disconnected',
  stale: 'monitor.status.stale',
}

/** 一个指标为 null 时，`issues` 里必有它的原因；原因直接说给用户，不写「错误」。 */
const ISSUE_KEY: Record<MonitorIssue, MessageKey> = {
  'warming-up': 'monitor.issue.warming-up',
  unavailable: 'monitor.issue.unavailable',
  'invalid-data': 'monitor.issue.invalid-data',
}

/**
 * 顺序就是读的顺序：先看谁在忙，再看内存和负载，最后是磁盘、网络和主机运行时间。
 *
 * 标签都走目录：CPU 是唯一一个两种语言写法相同的，但也照样进目录，这样这一行
 * 没有例外。单位都跟着数值走，不另设一列。`bar` 的那三项各画一条占用条；网络画
 * 走势线，负载和运行时间是标量，没有可比较的满格。
 */
const FIELDS: ReadonlyArray<{ metric: MonitorMetric; labelKey: MessageKey; bar: boolean }> = [
  { metric: 'cpu', labelKey: 'monitor.field.cpu', bar: true },
  { metric: 'memory', labelKey: 'monitor.field.memory', bar: true },
  { metric: 'load', labelKey: 'monitor.field.load', bar: false },
  { metric: 'disk', labelKey: 'monitor.field.disk', bar: true },
  { metric: 'net', labelKey: 'monitor.field.net', bar: false },
  { metric: 'uptime', labelKey: 'monitor.field.uptime', bar: false },
]

const DASH = '—'
/** 走势线的坐标系。固定 100×30，靠 preserveAspectRatio 拉伸到抽屉宽度。 */
const SPARK_WIDTH = 100
const SPARK_HEIGHT = 30

/** 百分比留一位小数：整位数看不出 CPU 从 12% 走到 13%，两位在 11px 字号下就糊了。 */
const percent = (value: number): string => `${value.toFixed(1)}%`

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
  if (days) return t('monitor.duration.days', { days, hours })
  if (hours) return t('monitor.duration.hours', { hours, minutes })
  if (minutes) return t('monitor.duration.minutes', { minutes, seconds: total % 60 })
  return t('monitor.duration.seconds', { seconds: total })
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
    memory: snapshot.memory === null ? DASH : t('monitor.value.usage', {
      percent: percent(snapshot.memory.usedPercent),
      used: formatBytes(snapshot.memory.usedBytes),
      total: formatBytes(snapshot.memory.totalBytes),
    }),
    load: snapshot.load === null ? DASH
      : `${snapshot.load.one.toFixed(2)} ${snapshot.load.five.toFixed(2)} ${snapshot.load.fifteen.toFixed(2)}`,
    disk: snapshot.disk === null ? DASH : t('monitor.value.usage', {
      percent: percent(snapshot.disk.usedPercent),
      used: formatBytes(snapshot.disk.usedBytes),
      total: formatBytes(snapshot.disk.totalBytes),
    }),
    net: snapshot.net === null ? DASH : t('monitor.value.net', {
      down: formatRate(snapshot.net.receivedBytesPerSecond),
      up: formatRate(snapshot.net.transmittedBytesPerSecond),
    }),
    uptime: snapshot.uptimeSeconds === null ? DASH : duration(snapshot.uptimeSeconds),
  }
}

/** 占用条要填多少。没有读数就是 0，而不是把上一次的宽度留在那里。 */
function fillPercent(snapshot: MonitorSnapshot, metric: MonitorMetric): number {
  if (metric === 'cpu') return snapshot.cpuPercent ?? 0
  if (metric === 'memory') return snapshot.memory?.usedPercent ?? 0
  if (metric === 'disk') return snapshot.disk?.usedPercent ?? 0
  return 0
}

/** 两条方向线共用一个纵轴刻度，否则「收得比发得少」会被各自的满格画反。 */
function sparkMax(history: readonly NetSample[]): number {
  let max = 0
  for (const sample of history) max = Math.max(max, sample.received, sample.transmitted)
  return max
}

function sparkPoints(history: readonly NetSample[], pick: (sample: NetSample) => number, max: number): string {
  if (history.length < 2) return ''
  const step = SPARK_WIDTH / (history.length - 1)
  return history
    .map((sample, index) => {
      const ratio = max > 0 ? pick(sample) / max : 0
      return `${(index * step).toFixed(2)},${(SPARK_HEIGHT - ratio * SPARK_HEIGHT).toFixed(2)}`
    })
    .join(' ')
}

function button(document: Document, id: string, text: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.id = id
  element.className = 'ghost small'
  element.textContent = text
  return element
}

export function createMonitorPanel(
  root: HTMLElement,
  toggle: HTMLButtonElement,
  actions: MonitorPanelActions,
): MonitorPanel {
  const listeners = new DomListeners()
  const document = root.ownerDocument
  root.replaceChildren()

  // 开关住在会话栏里，但归这个面板管：字形和文字都由 render 按开合改写。
  toggle.replaceChildren()
  const glyph = document.createElement('i')
  glyph.className = 'ti ti-activity'
  glyph.setAttribute('aria-hidden', 'true')
  const caption = document.createElement('span')
  toggle.append(glyph, caption)

  const head = document.createElement('header')
  head.className = 'panel-head'
  const title = document.createElement('span')
  title.className = 'panel-title'
  title.textContent = t('monitor.title')
  // 这一格**不**挂 aria-live：每 5 秒播报一次读数会把终端变成不能用的东西。
  // 状态的含义由文字本身承担，颜色只是重复一遍，所以色觉障碍下也不丢信息。
  const state = document.createElement('span')
  state.id = 'monitor-state'
  state.className = 'monitor-state'
  const pause = button(document, 'monitor-pause', t('monitor.pause'))
  const retry = button(document, 'monitor-retry', t('common.retry'))
  const close = button(document, 'monitor-close', t('common.collapse'))
  head.append(title, state, pause, retry, close)

  const body = document.createElement('div')
  body.id = 'monitor-body'
  body.className = 'monitor-body'
  type Cell = { field: HTMLElement; name: HTMLElement; value: HTMLElement; fill: HTMLElement | null; spark: SVGSVGElement | null }
  const cells = new Map<MonitorMetric, Cell>()
  for (const { metric, labelKey, bar } of FIELDS) {
    const field = document.createElement('section')
    field.className = 'monitor-field'
    field.dataset.metric = metric

    const line = document.createElement('div')
    line.className = 'monitor-field-head'
    const name = document.createElement('span')
    name.className = 'monitor-label'
    name.textContent = t(labelKey)
    const value = document.createElement('span')
    value.className = 'monitor-value'
    value.textContent = DASH
    line.append(name, value)
    field.append(line)

    let fill: HTMLElement | null = null
    if (bar) {
      const track = document.createElement('div')
      track.className = 'monitor-bar'
      // 占用条只是把同一格里的百分比再画一遍，读屏由数值本身承担。
      track.setAttribute('aria-hidden', 'true')
      fill = document.createElement('span')
      fill.className = 'monitor-bar-fill'
      track.append(fill)
      field.append(track)
    }

    let spark: SVGSVGElement | null = null
    if (metric === 'net') {
      spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      spark.setAttribute('class', 'monitor-spark')
      spark.setAttribute('viewBox', `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`)
      // 拉伸到抽屉宽度而不是等比缩放：走势读的是形状，不是像素比例。
      spark.setAttribute('preserveAspectRatio', 'none')
      spark.setAttribute('aria-hidden', 'true')
      for (const kind of ['received', 'transmitted'] as const) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        line.setAttribute('class', `monitor-spark-line is-${kind}`)
        line.dataset.direction = kind
        spark.append(line)
      }
      field.append(spark)
    }

    body.append(field)
    cells.set(metric, { field, name, value, fill, spark })
  }

  const detail = document.createElement('p')
  detail.id = 'monitor-detail'
  detail.className = 'monitor-detail'

  body.append(detail)
  root.append(head, body)

  listeners.add(toggle, 'click', () => actions.toggleOpen())
  listeners.add(close, 'click', () => actions.toggleOpen())
  listeners.add(pause, 'click', () => actions.togglePaused())
  listeners.add(retry, 'click', () => actions.retry())

  return {
    render(next: MonitorPanelState): void {
      const live = next.status !== 'idle' && next.status !== 'disconnected'
      root.dataset.status = next.status
      root.classList.toggle('is-open', next.open)
      root.hidden = !next.open
      toggle.disabled = !next.available
      toggle.setAttribute('aria-expanded', String(next.open))
      toggle.setAttribute('aria-controls', 'session-monitor')
      toggle.title = t(next.open ? 'monitor.toggle.hide-title' : 'monitor.toggle.show-title')
      caption.textContent = t(next.open ? 'monitor.toggle.hide' : 'monitor.toggle.show')
      body.hidden = !next.open
      title.textContent = t('monitor.title')
      state.textContent = t(STATUS_KEY[next.status])

      pause.disabled = !live
      pause.setAttribute('aria-pressed', String(next.paused))
      pause.textContent = t(next.paused ? 'monitor.resume' : 'monitor.pause')
      pause.title = t(next.paused ? 'monitor.resume.title' : 'monitor.pause.title')
      retry.disabled = !live
      retry.textContent = t('common.retry')
      close.textContent = t('common.collapse')

      /*
       * 每个快照当作**一次完整观测**：六个字段全部来自同一张快照，绝不把上一轮的
       * 内存和这一轮的 CPU 拼在一起。没有快照时整行是破折号。
       */
      const values = next.snapshot ? valuesOf(next.snapshot) : null
      for (const { metric, labelKey } of FIELDS) {
        const cell = cells.get(metric)!
        const issue = next.snapshot?.issues[metric]
        cell.name.textContent = t(labelKey)
        cell.value.textContent = values ? values[metric] : DASH
        if (issue) cell.field.dataset.issue = issue
        else delete cell.field.dataset.issue
        cell.field.title = issue ? t(ISSUE_KEY[issue]) : ''
        if (cell.fill) {
          const width = next.snapshot && !issue ? fillPercent(next.snapshot, metric) : 0
          cell.fill.style.width = `${width}%`
        }
      }

      // 走势线：两个方向共用刻度，收用实线、发用虚线，和数值里的 ↓ / ↑ 对得上。
      const spark = cells.get('net')!.spark
      if (spark) {
        const max = sparkMax(next.history)
        const received = spark.querySelector<SVGPolylineElement>('.is-received')!
        const transmitted = spark.querySelector<SVGPolylineElement>('.is-transmitted')!
        received.setAttribute('points', sparkPoints(next.history, sample => sample.received, max))
        transmitted.setAttribute('points', sparkPoints(next.history, sample => sample.transmitted, max))
        // SVG 元素没有 HTML 的 hidden 属性，所以走属性，由全局 [hidden] 规则收起。
        if (next.history.length < 2) spark.setAttribute('hidden', '')
        else spark.removeAttribute('hidden')
      }

      // 报错时先说为什么，其余时候说这组数字是什么时候取的。远端文本走 textContent。
      detail.textContent = next.message ?? (next.snapshot ? t('monitor.detail.sampled', { time: clock(next.snapshot.collectedAt) }) : '')
    },
    dispose(): void {
      listeners.clear()
      toggle.replaceChildren()
      root.replaceChildren()
      root.classList.remove('is-open')
      root.hidden = true
      delete root.dataset.status
    },
  }
}

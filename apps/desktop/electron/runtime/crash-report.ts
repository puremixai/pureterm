import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * 一份**只包含允许字段**的 Host 故障记录。
 *
 * 诊断的价值在于「能带走」，而能带走的前提是它不可能夹带秘密。所以这里不是
 * 「挑几个字段删掉」，而是反过来：从白名单**重建**一份新对象，输入里多出来的
 * token、密码、路径、终端输出根本没有机会进入 JSON。
 *
 * 写入也必须自己扛得住：目录建不出来、盘满了、权限不对，一律返回 undefined，
 * 绝不把恢复流程拖住 —— 崩溃之后最重要的事是让用户还能重启或退出。
 */

export type HostFailureReason =
  | 'spawn-error' | 'handshake-invalid' | 'startup-timeout' | 'ipc-disconnect'
  | 'unexpected-exit' | 'shutdown-timeout' | 'lifecycle-control-failed' | 'update-handoff-failed'

export type HostFailurePhase = 'startup' | 'runtime' | 'update'

export interface HostFailureReport {
  version: 1
  /** ISO-8601，UTC。 */
  timestamp: string
  appVersion: string
  platform: string
  architecture: string
  phase: HostFailurePhase
  reason: HostFailureReason
  pid?: number
  exitCode: number | null
  signal: string | null
}

/** 每个目录最多留几份。再多也只是把磁盘当日志用。 */
export const HOST_REPORT_RETENTION = 5
/** 单份报告的上限。字段本来都很短，这是「输入来自外面」时的兜底。 */
export const HOST_REPORT_MAX_BYTES = 64 * 1024

const REASONS: readonly HostFailureReason[] = [
  'spawn-error', 'handshake-invalid', 'startup-timeout', 'ipc-disconnect',
  'unexpected-exit', 'shutdown-timeout', 'lifecycle-control-failed', 'update-handoff-failed',
]
const PHASES: readonly HostFailurePhase[] = ['startup', 'runtime', 'update']
/** 标识类字段的长度上限。超过它就不是一个标识，而是一段被塞进来的内容。 */
const MAX_TEXT = 64
const REPORT_NAME = /^host-.+\.json$/

let sequence = 0

/** 同一个目录上的写入排成一队：轮换按文件名排序，两笔并发会互相踩。 */
const queues = new Map<string, Promise<unknown>>()

function serialize<T>(directory: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(directory) ?? Promise.resolve()
  const next = previous.then(task, task)
  queues.set(directory, next.then(() => undefined, () => undefined))
  return next
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT) return undefined
  return value
}

function count(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined
  return value
}

/**
 * 从白名单重建报告。任何不合法或不认识的取值都让整份报告作废 —— 一份半对的
 * 诊断记录比没有更糟，它会让人以为已经看到了全部事实。
 */
function sanitize(report: HostFailureReport): HostFailureReport | undefined {
  const record = report as unknown as Record<string, unknown> | null
  if (!record || typeof record !== 'object') return undefined
  if (record.version !== 1) return undefined
  const reason = REASONS.find(candidate => candidate === record.reason)
  const phase = PHASES.find(candidate => candidate === record.phase)
  if (!reason || !phase) return undefined
  const timestamp = text(record.timestamp)
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return undefined
  const appVersion = text(record.appVersion)
  const platform = text(record.platform)
  const architecture = text(record.architecture)
  if (!appVersion || !platform || !architecture) return undefined
  const exitCode = count(record.exitCode)
  const signal = record.signal === null ? null : text(record.signal)
  if (exitCode === undefined || signal === undefined) return undefined
  let pid: number | undefined
  if (record.pid !== undefined) {
    const value = count(record.pid)
    if (value === null || value === undefined || value < 0) return undefined
    pid = value
  }
  return {
    version: 1, timestamp, appVersion, platform, architecture, phase, reason,
    ...(pid === undefined ? {} : { pid }), exitCode, signal,
  }
}

/** 文件名里的时间戳不能带 `:` 和 `.`（Windows 上不允许），换掉之后仍然按字典序排。 */
function stamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-')
}

/** 只轮换本写入器自己的 `host-*.json`，目录和别的文件一概不动。 */
async function rotate(directory: string): Promise<void> {
  const names = (await readdir(directory)).filter(name => REPORT_NAME.test(name)).sort()
  for (const name of names.slice(0, Math.max(0, names.length - HOST_REPORT_RETENTION))) {
    await rm(join(directory, name), { force: true })
  }
}

export function writeHostCrashReport(directory: string, report: HostFailureReport): Promise<string | undefined> {
  return serialize(directory, async () => {
    let temporary: string | undefined
    try {
      const payload = sanitize(report)
      if (!payload) return undefined
      const json = JSON.stringify(payload, null, 2)
      if (Buffer.byteLength(json, 'utf8') > HOST_REPORT_MAX_BYTES) return undefined
      await mkdir(directory, { recursive: true, mode: 0o700 })
      // 序号补齐到定长：文件名要按字典序排就等于按时间排，否则 `-10` 会排到 `-2` 前面。
      const name = `host-${stamp(payload.timestamp)}-${String(++sequence).padStart(6, '0')}.json`
      const target = join(directory, name)
      // 先写临时文件再改名：读到的永远是一份完整的报告，不是写了一半的。
      temporary = join(directory, `.${name}.tmp`)
      await writeFile(temporary, json, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, target)
      await rotate(directory)
      return target
    } catch {
      if (temporary) await rm(temporary, { force: true }).catch(() => undefined)
      return undefined
    }
  })
}

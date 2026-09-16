import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type HostKeyStatus = 'match' | 'unknown' | 'changed'

export interface HostKeyVerdict {
  status: HostKeyStatus
  fingerprint: string
  knownFingerprint?: string
}

export interface KnownHostEntry {
  host: string
  port: number
  fingerprint: string
  addedAt: string
  lastSeenAt: string
}

/** OpenSSH 风格的指纹：SHA256: + base64(sha256(key))，去掉尾部 = */
export function fingerprintOf(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

/**
 * TOFU（首次信任）主机密钥库。
 * - 首次见到某主机：记为 unknown，由调用方决定是否接受
 * - 已记录且一致：match
 * - 已记录但不一致：changed —— 这是中间人攻击的信号，必须硬失败
 */
export class HostKeyStore {
  private entries: KnownHostEntry[] = []

  constructor(public readonly file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (Array.isArray(parsed)) this.entries = parsed as KnownHostEntry[]
    } catch {
      // 文件损坏时按“空库”处理，不阻断连接
      this.entries = []
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2), { mode: 0o600 })
  }

  check(host: string, port: number, key: Buffer): HostKeyVerdict {
    const fingerprint = fingerprintOf(key)
    const found = this.entries.find((entry) => entry.host === host && entry.port === port)
    if (!found) return { status: 'unknown', fingerprint }
    if (found.fingerprint !== fingerprint) {
      return { status: 'changed', fingerprint, knownFingerprint: found.fingerprint }
    }
    found.lastSeenAt = new Date().toISOString()
    return { status: 'match', fingerprint }
  }

  remember(host: string, port: number, key: Buffer): string {
    const fingerprint = fingerprintOf(key)
    const now = new Date().toISOString()
    const found = this.entries.find((entry) => entry.host === host && entry.port === port)
    if (found) {
      found.fingerprint = fingerprint
      found.lastSeenAt = now
    } else {
      this.entries.push({ host, port, fingerprint, addedAt: now, lastSeenAt: now })
    }
    this.persist()
    return fingerprint
  }

  forget(host: string, port: number): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((entry) => !(entry.host === host && entry.port === port))
    if (this.entries.length === before) return false
    this.persist()
    return true
  }

  list(): readonly KnownHostEntry[] {
    return this.entries
  }
}

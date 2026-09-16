import { Service, type Context } from 'cordis'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CredentialProvider } from '../credentials.js'

declare module 'cordis' {
  interface Context {
    sessionStore: SessionStore
  }
}

/**
 * 落盘结构（hosts.json）：**只有非密文**。
 * 这个文件的定位是「可以放心备份 / 同步 / 给人看」——里面有任何密文都不合适。
 */
interface StoredHost {
  id: string
  label: string
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath?: string
  updatedAt: string
  /** 兼容字段：早期版本把密文塞在这里，读到就迁移走（见 migrateLegacySecrets） */
  sealedSecret?: string
}

/** secrets.json：id → 密文。单独一个文件、0600，不进元数据。 */
type SealedSecrets = Record<string, string>

/** 发给渲染层的结构：没有 secret，只有 hasSecret 标志 */
export interface HostRecord {
  id: string
  label: string
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath?: string
  hasSecret: boolean
  updatedAt: string
}

export interface HostInput {
  id?: string
  label?: string
  host: string
  port?: number
  username: string
  /** 密码认证时的凭据 */
  password?: string
  authMethod?: 'password' | 'privateKey'
  /** 私钥认证时**只存路径**：私钥本体是用户自己的文件，我们不复制一份到自己这边 */
  privateKeyPath?: string
  /** 私钥认证时的凭据（私钥口令） */
  passphrase?: string
  /**
   * 勾选后才会把凭据加密落盘。
   *
   * 名字里带 Password 是历史原因，实际含义是「记住这份凭据」——
   * 密码认证时存的是密码，私钥认证时存的是私钥口令。两者共用一个密文槽（见 save）。
   */
  rememberPassword?: boolean
}

export interface SessionStoreConfig {
  /** 主机元数据（非密文） */
  file: string
  /** 密文。必须和元数据分开：元数据要备份/同步的时候不能把密文一起带走。 */
  secretsFile: string
  credentials: CredentialProvider
}

function makeId(host: string, port: number, username: string): string {
  return createHash('sha1').update(`${username}@${host}:${port}`).digest('hex').slice(0, 10)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    // 文件损坏按「空」处理，不阻断启动
    return fallback
  }
}

/** 在创建插件树前验证，避免无持久化入口迁移或覆盖 Desktop 的旧密文。 */
export function assertSessionStoreCompatible(config: SessionStoreConfig): void {
  if (config.credentials.persistent) return
  if (existsSync(config.secretsFile)) {
    throw new Error('此数据目录含有已保存凭据，请为本机 Web 使用独立的数据目录。')
  }
  const hosts = readJson<unknown>(config.file, [])
  if (Array.isArray(hosts) && hosts.some((host) => host && typeof host === 'object' && 'sealedSecret' in host)) {
    throw new Error('此数据目录含有旧版凭据密文，请使用 Desktop 读取，并为本机 Web 选择独立的数据目录。')
  }
}

/**
 * SessionStore —— 主机列表持久化。
 *
 * 两件纪律：
 * 1. **密文与元数据分文件**（secrets.json / hosts.json，都 0600）。
 *    混在一起的话，「把我的主机列表导出来备份一下」就变成了「把密文也拷一份到别处」。
 * 2. 持久化入口使用注入的系统凭据提供器加密；本次会话模式不访问凭据文件。
 *    解出来的明文只在本进程内用于连接，绝不回传渲染层（HostRecord 里只有 hasSecret）。
 */
export class SessionStore extends Service {
  private readonly file: string
  private readonly secretsFile: string
  private readonly credentials: CredentialProvider
  private hosts: StoredHost[] = []
  private secrets: SealedSecrets = {}

  constructor(ctx: Context, config: SessionStoreConfig) {
    super(ctx, 'sessionStore')
    this.file = config.file
    this.secretsFile = config.secretsFile
    this.credentials = config.credentials
    this.load()
  }

  private load(): void {
    const parsed = readJson<unknown>(this.file, [])
    this.hosts = Array.isArray(parsed) ? (parsed as StoredHost[]) : []

    if (!this.credentials.persistent) {
      this.hosts = this.hosts.map(({ privateKeyPath: _path, ...host }) => host)
      return
    }

    const secrets = readJson<unknown>(this.secretsFile, {})
    this.secrets = secrets && typeof secrets === 'object' && !Array.isArray(secrets) ? (secrets as SealedSecrets) : {}

    this.migrateLegacySecrets()
  }

  /** 早期版本的 hosts.json 里带着 sealedSecret；读到就搬到 secrets.json，别让元数据文件继续藏密文。 */
  private migrateLegacySecrets(): void {
    let moved = 0
    for (const host of this.hosts) {
      const legacy = host.sealedSecret
      if (!legacy) continue
      if (!this.secrets[host.id]) this.secrets[host.id] = legacy
      delete host.sealedSecret
      moved += 1
    }
    if (!moved) return
    // 先写密文再写元数据：中途失败也只会出现「密文在、元数据还指着旧的」，不会丢密码
    this.persistSecrets()
    this.persistHosts()
    console.log(`[sessionStore] 已把 ${moved} 条密文从 hosts.json 迁移到 secrets.json。`)
  }

  private persistHosts(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.hosts, null, 2), { mode: 0o600 })
  }

  private persistSecrets(): void {
    if (!this.credentials.persistent) return
    mkdirSync(dirname(this.secretsFile), { recursive: true })
    writeFileSync(this.secretsFile, JSON.stringify(this.secrets, null, 2), { mode: 0o600 })
  }

  private persist(): void {
    this.persistHosts()
    this.persistSecrets()
  }

  private toRecord(host: StoredHost): HostRecord {
    const { sealedSecret: _legacy, ...rest } = host
    return { ...rest, hasSecret: this.credentials.persistent && !!this.secrets[host.id] }
  }

  list(): HostRecord[] {
    return this.hosts.map((host) => this.toRecord(host)).sort((a, b) => a.label.localeCompare(b.label))
  }

  get(id: string): HostRecord | undefined {
    const found = this.hosts.find((host) => host.id === id)
    return found ? this.toRecord(found) : undefined
  }

  save(input: HostInput): HostRecord {
    const host = input.host?.trim()
    if (!host) throw new Error('主机地址不能为空。')
    const port = input.port ?? 22
    const username = input.username?.trim()
    if (!username) throw new Error('用户名不能为空。')

    const id = input.id ?? makeId(host, port, username)
    const now = new Date().toISOString()
    let record = this.hosts.find((item) => item.id === id)

    if (!record) {
      record = { id, label: input.label?.trim() || `${username}@${host}`, host, port, username, authMethod: 'password', updatedAt: now }
      this.hosts.push(record)
    }
    record.label = input.label?.trim() || record.label
    record.host = host
    record.port = port
    record.username = username
    record.updatedAt = now

    // 认证方式变了就把旧凭据丢掉：密文槽只有一份，密码和私钥口令不能混着放。
    // 不然换方式之后会拿旧密码去当新方式的口令用，报出来的是「认证失败」这种查不出所以然的话。
    const previousAuth = record.authMethod
    record.authMethod = input.authMethod ?? record.authMethod
    if (input.authMethod && input.authMethod !== previousAuth) delete this.secrets[id]
    if (this.credentials.persistent) record.privateKeyPath = input.privateKeyPath ?? record.privateKeyPath
    else delete record.privateKeyPath

    // 凭据槽存的是「当前认证方式对应的那一份」：密码认证存密码，私钥认证存口令。
    // 私钥本体永远不进这里——它已经在用户自己的 ~/.ssh 下，再存一份只是多一个泄露面。
    const credential = record.authMethod === 'privateKey' ? input.passphrase : input.password
    if (this.credentials.persistent && input.rememberPassword && credential) {
      const sealed = this.credentials.seal(credential)
      // 拿不到系统密钥就不落盘，而不是退化成明文
      if (sealed) this.secrets[id] = sealed
    } else if (credential === '') {
      delete this.secrets[id]
    }

    this.persist()
    return this.toRecord(record)
  }

  remove(id: string): boolean {
    const before = this.hosts.length
    this.hosts = this.hosts.filter((host) => host.id !== id)
    if (this.hosts.length === before) return false
    // 主机没了，密文也没理由留着
    delete this.secrets[id]
    this.persist()
    return true
  }

  /** 仅主进程可用；解密失败返回 undefined 并提示重填 */
  secret(id: string): string | undefined {
    if (!this.credentials.persistent) return undefined
    const sealed = this.secrets[id]
    if (!sealed) return undefined
    return this.credentials.unseal(sealed)
  }
}

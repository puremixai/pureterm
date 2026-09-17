import { Service, type Context } from 'cordis'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { MAX_PRIVATE_KEY_BYTES, type KeyRecord, type KeySaveRequest } from '@pureterm/protocol'
import type { CredentialProvider } from '../credentials.js'

const { utils } = createRequire(import.meta.url)('ssh2') as typeof import('ssh2')

declare module 'cordis' { interface Context { keychain: Keychain } }

interface KeyMaterial { privateKey: string; passphrase?: string }
interface KeyEntry { record: KeyRecord; sealed?: string; material?: KeyMaterial }
interface KeychainConfig { file: string; credentials: CredentialProvider }

/** A dedicated atomic vault: every on-disk entry is entirely system-encrypted. */
export class Keychain extends Service {
  readonly ready: Promise<void>
  private readonly entries = new Map<string, KeyEntry>()
  private readonly sessions = new Map<string, Map<string, KeyEntry>>()

  constructor(ctx: Context, private readonly config: KeychainConfig) {
    super(ctx, 'keychain')
    this.ready = this.load()
    ctx.effect(() => () => { this.entries.clear(); this.sessions.clear() }, 'keychain.clear')
  }

  private async load(): Promise<void> {
    if (!existsSync(this.config.file)) return
    if (!this.config.credentials.persistent) throw new Error('此目录含有 Desktop 密钥库，请为 Web 使用独立的数据目录。')
    const data = JSON.parse(readFileSync(this.config.file, 'utf8'))
    if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error('密钥库格式无效，未覆盖原文件。')
    for (const item of data.entries) {
      if (typeof item?.id !== 'string' || typeof item?.sealed !== 'string') throw new Error('密钥库记录无效。')
      const plain = await this.config.credentials.unseal(item.sealed)
      if (!plain) throw new Error('无法解密密钥库，请检查系统加密服务。')
      const { record } = JSON.parse(plain) as { record: KeyRecord }
      if (!record || record.id !== item.id || typeof record.label !== 'string' || typeof record.publicKey !== 'string') throw new Error('密钥库记录无效。')
      this.entries.set(item.id, { record, sealed: item.sealed })
    }
  }

  private records(clientId: string): Map<string, KeyEntry> {
    if (this.config.credentials.persistent) return this.entries
    let records = this.sessions.get(clientId)
    if (!records) this.sessions.set(clientId, records = new Map())
    return records
  }

  list(clientId: string): KeyRecord[] {
    return [...this.records(clientId).values()].map(entry => ({ ...entry.record })).sort((a, b) => a.label.localeCompare(b.label))
  }

  has(id: string, clientId: string): boolean { return this.records(clientId).has(id) }
  releaseClient(clientId: string): void { this.sessions.delete(clientId) }

  private async material(entry: KeyEntry): Promise<KeyMaterial> {
    if (entry.material) return { ...entry.material }
    const plain = entry.sealed && await this.config.credentials.unseal(entry.sealed)
    if (!plain) throw new Error('无法解密已保存的私钥，请检查系统加密服务或重新导入。')
    const data = JSON.parse(plain) as KeyMaterial
    return { privateKey: data.privateKey, passphrase: data.passphrase }
  }

  async secret(id: string, clientId: string): Promise<KeyMaterial> {
    const entry = this.records(clientId).get(id)
    if (!entry) throw new Error('选择的密钥不存在或已离开当前会话，请在 Keychain 中重新导入。')
    return this.material(entry)
  }

  /** Mutations are serialized with host associations by the public Host facade. */
  async save(input: KeySaveRequest, clientId: string): Promise<KeyRecord> {
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.trim().length > 200) throw new Error('请填写密钥名称（最多 200 字符）。')
    if (input.id !== undefined && typeof input.id !== 'string') throw new Error('密钥 ID 无效。')
    for (const name of ['privateKey', 'publicKey', 'passphrase'] as const) {
      if (input[name] !== undefined && typeof input[name] !== 'string') throw new Error('密钥字段必须是文本。')
      if (input[name] && Buffer.byteLength(input[name], 'utf8') > (name === 'passphrase' ? 4096 : MAX_PRIVATE_KEY_BYTES)) {
        throw new Error(name === 'passphrase' ? '私钥口令过长。' : '密钥内容超过 256 KiB。')
      }
    }
    const entries = this.records(clientId)
    const previous = input.id ? entries.get(input.id) : undefined
    if (input.id && !previous) throw new Error('密钥不存在，请刷新列表。')
    if (!previous && entries.size >= 500) throw new Error('密钥库最多保存 500 把密钥。')
    const material = input.privateKey?.trim()
      ? { privateKey: input.privateKey.trim(), passphrase: input.passphrase || undefined }
      : previous ? await this.material(previous) : undefined
    if (!material?.privateKey) throw new Error('请粘贴私钥或导入私钥文件。')
    if (Buffer.byteLength(material.privateKey, 'utf8') > MAX_PRIVATE_KEY_BYTES) throw new Error('私钥超过 256 KiB。')
    if ((material.passphrase?.length ?? 0) > 4096) throw new Error('私钥口令过长。')
    // ssh2 returns an array for modern OpenSSH private keys, despite its type declaration.
    const parsed = utils.parseKey(material.privateKey, material.passphrase)
    if (parsed instanceof Error) throw new Error('无法解析私钥：请检查格式；加密私钥需填写正确口令。')
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key?.isPrivateKey()) throw new Error('需要私钥，不能只导入公钥。')
    const publicBytes: Buffer = key.getPublicSSH()
    const publicKey = `${key.type} ${publicBytes.toString('base64')}`
    if (input.publicKey?.trim() && input.publicKey.trim().split(/\s+/).slice(0, 2).join(' ') !== publicKey) {
      throw new Error('公钥与私钥不匹配。可留空，由系统自动生成公钥。')
    }
    const record: KeyRecord = {
      id: previous?.record.id ?? randomUUID(), label: input.label.trim(),
      type: key.type === 'ssh-rsa' ? 'RSA' : key.type === 'ssh-ed25519' ? 'ED25519' : key.type.startsWith('ecdsa-') ? 'ECDSA' : key.type,
      publicKey, fingerprint: `SHA256:${createHash('sha256').update(publicBytes).digest('base64').replace(/=+$/, '')}`,
      hasPassphrase: !!material.passphrase, updatedAt: new Date().toISOString(),
    }
    const entry: KeyEntry = { record }
    if (this.config.credentials.persistent) {
      entry.sealed = await this.config.credentials.seal(JSON.stringify({ record, ...material }))
      if (!entry.sealed) throw new Error('系统加密不可用，密钥未保存；不会使用明文存储。')
    } else entry.material = material
    const next = new Map(entries).set(record.id, entry)
    this.persist(next)
    entries.set(record.id, entry)
    return { ...record }
  }

  remove(id: string, clientId: string): boolean {
    const entries = this.records(clientId)
    if (!entries.has(id)) return false
    const next = new Map(entries)
    next.delete(id)
    this.persist(next)
    entries.delete(id)
    return true
  }

  private persist(entries: Map<string, KeyEntry>): void {
    if (!this.config.credentials.persistent) return
    mkdirSync(dirname(this.config.file), { recursive: true })
    const temporary = `${this.config.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, entries: [...entries].map(([id, entry]) => ({ id, sealed: entry.sealed })) }), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.config.file)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }
}

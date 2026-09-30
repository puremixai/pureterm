import { Service, type Context } from 'cordis'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { HostError, MAX_PRIVATE_KEY_BYTES, type KeyRecord, type KeySaveRequest } from '@pureterm/protocol'
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
    if (!this.config.credentials.persistent) throw new HostError('keychain.desktop-store-in-web')
    const data = JSON.parse(readFileSync(this.config.file, 'utf8'))
    if (data?.version !== 1 || !Array.isArray(data.entries)) throw new HostError('keychain.invalid-store')
    for (const item of data.entries) {
      if (typeof item?.id !== 'string' || typeof item?.sealed !== 'string') throw new HostError('keychain.invalid-record')
      const plain = await this.config.credentials.unseal(item.sealed)
      if (!plain) throw new HostError('keychain.decrypt-failed')
      const { record } = JSON.parse(plain) as { record: KeyRecord }
      if (!record || record.id !== item.id || typeof record.label !== 'string' || typeof record.publicKey !== 'string') throw new HostError('keychain.invalid-record')
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
    if (!plain) throw new HostError('keychain.material-undecryptable')
    const data = JSON.parse(plain) as KeyMaterial
    return { privateKey: data.privateKey, passphrase: data.passphrase }
  }

  async secret(id: string, clientId: string): Promise<KeyMaterial> {
    const entry = this.records(clientId).get(id)
    if (!entry) throw new HostError('keychain.entry-missing')
    return this.material(entry)
  }

  /** Mutations are serialized with host associations by the public Host facade. */
  async save(input: KeySaveRequest, clientId: string): Promise<KeyRecord> {
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.trim().length > 200) throw new HostError('keychain.label-required')
    if (input.id !== undefined && typeof input.id !== 'string') throw new HostError('keychain.id-invalid')
    for (const name of ['privateKey', 'publicKey', 'passphrase'] as const) {
      if (input[name] !== undefined && typeof input[name] !== 'string') throw new HostError('keychain.field-not-text')
      if (input[name] && Buffer.byteLength(input[name], 'utf8') > (name === 'passphrase' ? 4096 : MAX_PRIVATE_KEY_BYTES)) {
        throw new HostError(name === 'passphrase' ? 'keychain.passphrase-too-long' : 'keychain.content-too-large')
      }
    }
    const entries = this.records(clientId)
    const previous = input.id ? entries.get(input.id) : undefined
    if (input.id && !previous) throw new HostError('keychain.not-found')
    if (!previous && entries.size >= 500) throw new HostError('keychain.limit-reached')
    const material = input.privateKey?.trim()
      ? { privateKey: input.privateKey.trim(), passphrase: input.passphrase || undefined }
      : previous ? await this.material(previous) : undefined
    if (!material?.privateKey) throw new HostError('keychain.material-required')
    if (Buffer.byteLength(material.privateKey, 'utf8') > MAX_PRIVATE_KEY_BYTES) throw new HostError('keychain.private-key-too-large')
    if ((material.passphrase?.length ?? 0) > 4096) throw new HostError('keychain.passphrase-too-long')
    // ssh2 returns an array for modern OpenSSH private keys, despite its type declaration.
    const parsed = utils.parseKey(material.privateKey, material.passphrase)
    if (parsed instanceof Error) throw new HostError('keychain.parse-failed', undefined, parsed.message)
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key?.isPrivateKey()) throw new HostError('keychain.public-only')
    const publicBytes: Buffer = key.getPublicSSH()
    const publicKey = `${key.type} ${publicBytes.toString('base64')}`
    if (input.publicKey?.trim() && input.publicKey.trim().split(/\s+/).slice(0, 2).join(' ') !== publicKey) {
      throw new HostError('keychain.public-mismatch')
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
      if (!entry.sealed) throw new HostError('keychain.encryption-unavailable')
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

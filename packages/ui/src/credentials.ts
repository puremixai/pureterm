import type { AuthMethod, HostSaveRequest, RuntimeCapabilities, TerminalOpenRequest } from '@pureterm/protocol'

export interface CredentialFields {
  authMethod: AuthMethod
  password: string
  passphrase: string
  privateKeyPath: string
  hostId?: string
}

export interface BrowserPrivateKey {
  name: string
  content: string
}

export const MAX_PRIVATE_KEY_BYTES = 256 * 1024

/** Validate the response before allowing credential-sensitive controls to become usable. */
export function parseRuntimeCapabilities(value: unknown): RuntimeCapabilities {
  const candidate = value as Partial<RuntimeCapabilities> | null
  const credentialPersistence = candidate?.credentialPersistence
  const privateKeyPicker = candidate?.privateKeyPicker
  if (
    (credentialPersistence !== 'encrypted' && credentialPersistence !== 'session') ||
    (privateKeyPicker !== 'native' && privateKeyPicker !== 'browser')
  ) throw new Error('无法确认本机后端的凭据能力，请重新启动应用并刷新页面。')
  return { credentialPersistence, privateKeyPicker }
}

export function savedCredentials(capabilities: RuntimeCapabilities, fields: CredentialFields, remember: boolean): Partial<HostSaveRequest> {
  if (capabilities.credentialPersistence === 'session') return { rememberPassword: false }
  return fields.authMethod === 'privateKey'
    ? {
      rememberPassword: remember,
      ...(capabilities.privateKeyPicker === 'native' ? { privateKeyPath: fields.privateKeyPath || undefined } : {}),
      passphrase: fields.passphrase || undefined,
    }
    : { rememberPassword: remember, password: fields.password || undefined }
}

export function connectionCredentials(
  capabilities: RuntimeCapabilities,
  fields: CredentialFields,
  selectedKey?: BrowserPrivateKey,
): Partial<TerminalOpenRequest> {
  const credentials: Partial<TerminalOpenRequest> = {}
  if (capabilities.credentialPersistence === 'encrypted' && fields.hostId) credentials.hostId = fields.hostId
  if (fields.authMethod === 'privateKey') {
    if (capabilities.privateKeyPicker === 'browser') {
      if (!selectedKey) throw new Error('请先选择私钥文件')
      credentials.privateKey = selectedKey.content
    } else if (fields.privateKeyPath) credentials.privateKeyPath = fields.privateKeyPath
    if (fields.passphrase) credentials.passphrase = fields.passphrase
  } else if (fields.password) credentials.password = fields.password
  return credentials
}

/** A form revision prevents a delayed File.text() from attaching a key to another host. */
export class BrowserPrivateKeySelection {
  private revision = 0
  private selected?: BrowserPrivateKey

  get value(): BrowserPrivateKey | undefined { return this.selected }

  clear(): void {
    this.revision += 1
    this.selected = undefined
  }

  /** Opening a picker invalidates earlier reads but cancellation must retain the current key. */
  prepare(): number {
    this.revision += 1
    return this.revision
  }

  begin(): number {
    this.clear()
    return this.revision
  }

  isCurrent(revision: number): boolean { return revision === this.revision }

  commit(revision: number, key: BrowserPrivateKey): boolean {
    if (!this.isCurrent(revision)) return false
    this.selected = key
    return true
  }
}

export async function readBrowserPrivateKey(file: Pick<File, 'name' | 'size' | 'text'>): Promise<BrowserPrivateKey> {
  if (file.size === 0) throw new Error('私钥是空文件，请重新选择。')
  if (file.size > MAX_PRIVATE_KEY_BYTES) throw new Error('私钥文件超过 256 KiB，请确认选择的是私钥文件。')
  const content = await file.text()
  const header = content.match(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----/)
  if (!header || !content.includes(`-----END ${header[1]}-----`)) {
    throw new Error('这个文件看起来不是私钥（需要完整的 PRIVATE KEY 头和尾）。')
  }
  return { name: file.name, content }
}

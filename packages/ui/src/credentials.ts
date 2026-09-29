import type { AuthMethod, HostSaveRequest, RuntimeCapabilities, TerminalOpenRequest } from '@pureterm/protocol'
import { t } from '@pureterm/i18n'

export interface CredentialFields {
  authMethod: AuthMethod
  password: string
  passphrase: string
  privateKeyPath: string
  hostId?: string
  keyId?: string
}

export interface BrowserPrivateKey {
  name: string
  content: string
}

export { MAX_PRIVATE_KEY_BYTES } from '@pureterm/protocol'
import { MAX_PRIVATE_KEY_BYTES } from '@pureterm/protocol'

/** Validate the response before allowing credential-sensitive controls to become usable. */
export function parseRuntimeCapabilities(value: unknown): RuntimeCapabilities {
  const candidate = value as Partial<RuntimeCapabilities> | null
  const credentialPersistence = candidate?.credentialPersistence
  const privateKeyPicker = candidate?.privateKeyPicker
  if (
    (credentialPersistence !== 'encrypted' && credentialPersistence !== 'session') ||
    (privateKeyPicker !== 'native' && privateKeyPicker !== 'browser')
  ) throw new Error(t('credentials.error.capabilities'))
  return { credentialPersistence, privateKeyPicker }
}

export function savedCredentials(capabilities: RuntimeCapabilities, fields: CredentialFields, remember: boolean): Partial<HostSaveRequest> {
  if (fields.authMethod === 'privateKey' && fields.keyId) return { keyId: fields.keyId, rememberPassword: false }
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
    if (fields.keyId) { credentials.keyId = fields.keyId; return credentials }
    if (capabilities.privateKeyPicker === 'browser') {
      if (!selectedKey) throw new Error(t('hosts.error.choose-key'))
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
  if (file.size === 0) throw new Error(t('credentials.error.empty-key'))
  if (file.size > MAX_PRIVATE_KEY_BYTES) throw new Error(t('credentials.error.key-too-large'))
  const content = await file.text()
  const header = content.match(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----/)
  if (!header || !content.includes(`-----END ${header[1]}-----`)) {
    throw new Error(t('credentials.error.not-a-key'))
  }
  return { name: file.name, content }
}

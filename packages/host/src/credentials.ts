/** 凭据的持久化能力由运行入口提供，与 IPC / WebSocket 无关。 */
export interface CredentialProvider {
  readonly persistent: boolean
  /** 不可加密时返回 undefined，不允许退化为明文落盘。 */
  seal(plain: string): string | undefined | Promise<string | undefined>
  unseal(sealed: string): string | undefined | Promise<string | undefined>
}

/** 独立本机 Web 的默认策略：凭据只随本次连接传入，不读写凭据文件。 */
export const sessionOnlyCredentials: CredentialProvider = Object.freeze({
  persistent: false,
  seal: () => undefined,
  unseal: () => undefined,
})

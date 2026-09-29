/** 凭据的持久化能力由运行入口提供，与 IPC / WebSocket 无关。 */
export interface CredentialProvider {
  readonly persistent: boolean
  /**
   * 这台机器**此刻**能不能真正加密，也就是客户端该被告知哪一种凭据策略。
   *
   * 和 `persistent` 不是一回事：`persistent` 说的是「这个入口打算持久化」，桌面端
   * 即使拿不到系统密钥也仍然是 true，因为它照样拥有自己的凭据库和数据目录；这里
   * 说的是「系统密钥现在拿得到」。在拿不到的那一刻上报 `'encrypted'` 就是在承诺
   * 一件做不到的事——界面会照常给出「记住凭据」，然后写入失败。
   */
  readonly credentialPersistence: 'encrypted' | 'session'
  /** 不可加密时返回 undefined，不允许退化为明文落盘。 */
  seal(plain: string): string | undefined | Promise<string | undefined>
  unseal(sealed: string): string | undefined | Promise<string | undefined>
}

/** 独立本机 Web 的默认策略：凭据只随本次连接传入，不读写凭据文件。 */
export const sessionOnlyCredentials: CredentialProvider = Object.freeze({
  persistent: false,
  credentialPersistence: 'session',
  seal: () => undefined,
  unseal: () => undefined,
})

import { isWireError, type HostErrorCode } from '@pureterm/protocol'
import { hasKey, tWireError, type MessageKey } from '@pureterm/i18n'
// 显式 `.ts` 而不是 `.js`：这个模块被 node --test 直接加载（见 tests/），而 Node 的
// 类型剥离不会把 `.js` 说明符改写成 `.ts`。UI 源码不在 check-esm-extensions 的
// 目标列表里，所以这里不违反对其它包的那条约定。
import { resolveMessage, type MessageText } from './message-text.ts'

/**
 * 失败的分诊。
 *
 * **只做一件事：把宿主报的错误码读成「死在哪一步 + 下一步做什么」。**
 *
 * 这份表从前读的是宿主的**中文句子**（十四个正则），因为那时跨线的失败就是一句
 * 中文散文，渲染层只有那句话可读。代价是它成了「契约的第二次表述」：宿主改一个
 * 措辞，这里就静默失配，页面把一个已经说清楚的失败塌成一个点。现在宿主报的是
 * `{code, params}`，所以这里是**一次映射**而不是一次转述 —— 而且它是穷尽的：
 * `HOST_ERROR_CODES` 里每一个码都在表里，漏一个会被测试挡住，不会静默塌掉。
 *
 * 结论那句 `title` **存的是 key 不是句子**：失败页是「算一次、之后一直画」的，
 * 存句子的话用户在失败之后切一次语言，页面会停在上一门语言里 —— 而那正是他最
 * 需要读懂的一屏。句子由渲染时 `t()` 解析。
 */
/** 七个阶段。画出来的只有四个节点，折叠见 NODE_OF。 */
export const STAGES = ['local', 'address', 'tcp', 'handshake', 'keyexchange', 'auth', 'session'] as const
export type Stage = (typeof STAGES)[number]

/** 画在路线上的节点数：index.html 里 .failure-route-node 的个数。 */
export const NODE_COUNT = 4

/**
 * 七个阶段折到四个节点：本机 / TCP / 密钥交换 / 认证。
 *
 * 这张表是那次折叠唯一的实现处。少了它，渲染就会拿 STAGES 的下标去点 DOM ——
 * 于是 TCP 失败点亮「密钥交换」，而 `session`（认证之后）根本没有对应的格子。
 * 说错在哪里的诊断页比没有诊断页更坏。
 */
export const NODE_OF: Record<Stage, number> = {
  local: 0,
  address: 1,
  tcp: 1,
  // 横幅之前就没动静：管子通了，SSH 没通。归到 TCP 那一格，不冒充密钥交换失败。
  handshake: 1,
  keyexchange: 2,
  auth: 3,
  // 认证之后的失败（SFTP 子系统起不来）：四个格子全都是绿的，这才是实话。
  session: NODE_COUNT,
}

const STAGE_KEY: Record<Stage, MessageKey> = {
  local: 'failure.stage.local',
  address: 'failure.stage.address',
  tcp: 'failure.stage.tcp',
  handshake: 'failure.stage.handshake',
  keyexchange: 'failure.stage.keyexchange',
  auth: 'failure.stage.auth',
  session: 'failure.stage.session',
}

/**
 * 「下一步做什么」的类别。
 *
 * 它比码粗：`ssh.key-unparseable`、`ssh.key-file-unreadable`、`ssh.key-unrecognized`
 * 说的**发生了什么**各不相同（所以标题按码给），但**下一步该做什么**是同一件 ——
 * 去检查那把私钥。把建议也按码拆成一百多句，只会得到一堆互相抄的近义句。
 */
export type Cause =
  | 'incomplete' | 'cancelled' | 'dns' | 'port-refused' | 'port-dropped' | 'reset'
  | 'banner' | 'host-key-changed' | 'host-key-unknown' | 'algorithm' | 'auth'
  | 'key-unusable' | 'session-gone' | 'sftp-unavailable'

const CAUSE_KEY: Record<Cause, MessageKey> = {
  incomplete: 'failure.cause.incomplete.suggestion',
  cancelled: 'failure.cause.cancelled.suggestion',
  dns: 'failure.cause.dns.suggestion',
  'port-refused': 'failure.cause.port-refused.suggestion',
  'port-dropped': 'failure.cause.port-dropped.suggestion',
  reset: 'failure.cause.reset.suggestion',
  banner: 'failure.cause.banner.suggestion',
  'host-key-changed': 'failure.cause.host-key-changed.suggestion',
  'host-key-unknown': 'failure.cause.host-key-unknown.suggestion',
  algorithm: 'failure.cause.algorithm.suggestion',
  auth: 'failure.cause.auth.suggestion',
  'key-unusable': 'failure.cause.key-unusable.suggestion',
  'session-gone': 'failure.cause.session-gone.suggestion',
  'sftp-unavailable': 'failure.cause.sftp-unavailable.suggestion',
}

/**
 * 每一个码死在哪一步、下一步该做什么。
 *
 * `stage: null` 是**真的**「这不是连接失败」，不是「还没填」：密钥库、远端文件、
 * 资源采集和边界校验的失败都跟那条四节点的路线无关，路线整条塌掉比点亮一个
 * 无关的格子诚实。`cause: null` 同理 —— 没有可说的下一步。
 *
 * 表的穷尽性由测试钉住（`host-message-census.test.mjs`）：`HOST_ERROR_CODES` 里
 * 每加一个码，这里不加一行就红。
 */
const CODE_INFO: Record<HostErrorCode, { stage: Stage | null; cause: Cause | null }> = {
  // ── ssh：连接与认证 ──
  // 本地前置条件：地址、用户名、凭据、私钥文件。这些都发生在任何网络动作之前，
  // 所以路线停在第一个节点，而不是「认证失败」。
  'ssh.empty-host': { stage: 'local', cause: 'incomplete' },
  'ssh.empty-username': { stage: 'local', cause: 'incomplete' },
  'ssh.missing-credential': { stage: 'local', cause: 'incomplete' },
  'ssh.key-file-unreadable': { stage: 'local', cause: 'key-unusable' },
  'ssh.client-disconnected': { stage: 'local', cause: 'cancelled' },
  'ssh.auth-failed': { stage: 'auth', cause: 'auth' },
  'ssh.key-passphrase-needed': { stage: 'auth', cause: 'key-unusable' },
  'ssh.key-unrecognized': { stage: 'auth', cause: 'key-unusable' },
  'ssh.key-unparseable': { stage: 'auth', cause: 'key-unusable' },
  'ssh.banner-before-handshake': { stage: 'handshake', cause: 'banner' },
  'ssh.exec-channel-refused': { stage: 'session', cause: null },
  'ssh.sftp-subsystem-unavailable': { stage: 'session', cause: 'sftp-unavailable' },
  'ssh.channel-refused': { stage: 'session', cause: null },
  'ssh.connection-refused': { stage: 'tcp', cause: 'port-refused' },
  'ssh.dns-failed': { stage: 'address', cause: 'dns' },
  'ssh.timeout': { stage: 'tcp', cause: 'port-dropped' },
  // 「密钥与记录不一致」和「ssh2 自己的校验失败」是两件事，但下一步是同一件：
  // 先确认服务器是不是真的换过密钥。所以两个码、一句建议。
  'ssh.host-key-changed': { stage: 'keyexchange', cause: 'host-key-changed' },
  'ssh.host-key-verification-failed': { stage: 'keyexchange', cause: 'host-key-changed' },
  // TOFU：这不是「密钥不对」，是「还没信过它」。策略要求显式确认时宿主就是这么拒的，
  // 所以它归在密钥交换那一格，建议是给确认而不是换密钥。
  'ssh.first-connection': { stage: 'keyexchange', cause: 'host-key-unknown' },
  'ssh.connection-reset': { stage: 'tcp', cause: 'reset' },
  'ssh.handshake-closed': { stage: 'handshake', cause: 'banner' },
  // ready 之后才断的：四个节点全都过了，这是会话中途掉的线。
  'ssh.connection-error': { stage: 'session', cause: null },
  'ssh.connection-closed': { stage: 'session', cause: null },
  'ssh.server-disconnected': { stage: 'session', cause: null },
  'ssh.session-closed': { stage: 'session', cause: null },
  'ssh.session-gone': { stage: 'session', cause: 'session-gone' },
  // 采集探测的四条。它们只出现在资源抽屉里，跟连接路线无关。
  'ssh.exec-cancelled': { stage: 'session', cause: null },
  'ssh.exec-output-limit': { stage: 'session', cause: null },
  'ssh.exec-timeout': { stage: 'session', cause: null },
  'ssh.exec-session-closed': { stage: 'session', cause: null },
  // 认不出来的兜底：整条塌掉，而不是猜一段。
  'ssh.failed': { stage: null, cause: null },
  // ── sftp：远端文件 ──
  'sftp.bad-name': { stage: null, cause: null },
  'sftp.no-such-file': { stage: null, cause: null },
  'sftp.no-such-directory': { stage: null, cause: null },
  'sftp.permission-denied': { stage: null, cause: null },
  'sftp.permission-denied-plain': { stage: null, cause: null },
  'sftp.op-unsupported': { stage: null, cause: null },
  'sftp.remove-failed': { stage: null, cause: null },
  'sftp.mkdir-failed': { stage: null, cause: null },
  'sftp.write-failed': { stage: null, cause: null },
  'sftp.failed-rejected': { stage: null, cause: null },
  'sftp.is-directory': { stage: null, cause: null },
  'sftp.download-too-large': { stage: null, cause: null },
  'sftp.upload-too-large': { stage: null, cause: null },
  'sftp.no-such-path': { stage: null, cause: null },
  'sftp.failed': { stage: null, cause: null },
  // ── keychain：密钥库 ──
  'keychain.desktop-store-in-web': { stage: null, cause: null },
  'keychain.invalid-store': { stage: null, cause: null },
  'keychain.invalid-record': { stage: null, cause: null },
  'keychain.decrypt-failed': { stage: null, cause: null },
  'keychain.material-undecryptable': { stage: null, cause: null },
  'keychain.entry-missing': { stage: null, cause: null },
  'keychain.label-required': { stage: null, cause: null },
  'keychain.id-invalid': { stage: null, cause: null },
  'keychain.field-not-text': { stage: null, cause: null },
  'keychain.passphrase-too-long': { stage: null, cause: null },
  'keychain.content-too-large': { stage: null, cause: null },
  'keychain.not-found': { stage: null, cause: null },
  'keychain.limit-reached': { stage: null, cause: null },
  'keychain.material-required': { stage: null, cause: null },
  'keychain.private-key-too-large': { stage: null, cause: null },
  'keychain.parse-failed': { stage: null, cause: null },
  'keychain.public-only': { stage: null, cause: null },
  'keychain.public-mismatch': { stage: null, cause: null },
  'keychain.encryption-unavailable': { stage: null, cause: null },
  // ── host：门面、终端桥、会话库 ──
  'host.closed': { stage: null, cause: null },
  'host.closed-mutation': { stage: null, cause: null },
  'host.closed-monitor': { stage: null, cause: null },
  'host.shutdown': { stage: 'local', cause: 'cancelled' },
  'host.client-closed': { stage: null, cause: null },
  'host.client-gone': { stage: null, cause: null },
  'host.client-disconnected': { stage: 'local', cause: 'cancelled' },
  'host.renderer-gone': { stage: 'local', cause: 'cancelled' },
  'host.renderer-closed': { stage: 'local', cause: 'cancelled' },
  'host.password-undecryptable': { stage: 'local', cause: 'key-unusable' },
  'host.key-required': { stage: 'local', cause: 'incomplete' },
  'host.key-id-invalid': { stage: null, cause: null },
  'host.key-missing': { stage: null, cause: null },
  'host.key-in-use': { stage: null, cause: null },
  'host.session-not-owned': { stage: null, cause: null },
  'host.subscription-in-use': { stage: null, cause: null },
  'host.shell-closed': { stage: 'session', cause: null },
  'host.channel-error': { stage: 'session', cause: null },
  'host.write-failed': { stage: 'session', cause: null },
  'host.resize-failed': { stage: 'session', cause: null },
  'host.session-closed': { stage: 'session', cause: null },
  'host.user-disconnected': { stage: 'local', cause: 'cancelled' },
  'host.monitor-unavailable': { stage: null, cause: null },
  'host.store-has-credentials': { stage: null, cause: null },
  'host.store-has-legacy-credentials': { stage: null, cause: null },
  // ── monitor：资源采集 ──
  'monitor.probe-signalled': { stage: null, cause: null },
  'monitor.probe-exit-code': { stage: null, cause: null },
  'monitor.unsupported-os': { stage: null, cause: null },
  'monitor.no-metrics': { stage: null, cause: null },
  'monitor.probe-failed': { stage: null, cause: null },
  'monitor.frame.no-header': { stage: null, cause: null },
  'monitor.frame.duplicate': { stage: null, cause: null },
  'monitor.frame.expected-section': { stage: null, cause: null },
  'monitor.frame.missing-status': { stage: null, cause: null },
  'monitor.frame.status-range': { stage: null, cause: null },
  'monitor.frame.os-unavailable': { stage: null, cause: null },
  'monitor.frame.no-end-marker': { stage: null, cause: null },
  'monitor.frame.trailing-content': { stage: null, cause: null },
  'monitor.frame.missing-os': { stage: null, cause: null },
  // ── 载体、派发与兜底 ──
  'transport.params-not-array': { stage: null, cause: null },
  'transport.disconnected': { stage: 'session', cause: null },
  'dispatch.arg-not-object': { stage: null, cause: null },
  'dispatch.arg-not-string': { stage: null, cause: null },
  'dispatch.arg-not-number': { stage: null, cause: null },
  'dispatch.arg-not-bytes': { stage: null, cause: null },
  'dispatch.extra-field': { stage: null, cause: null },
  'dispatch.bad-session-id': { stage: null, cause: null },
  'dispatch.bad-subscription-id': { stage: null, cause: null },
  'dispatch.unknown-request': { stage: null, cause: null },
  'dispatch.unknown-notice': { stage: null, cause: null },
  'internal': { stage: null, cause: null },
}

export interface Failure {
  /** null = 认不出来。此时路线整条塌掉，而不是猜一段。 */
  stage: Stage | null
  /** 断在第几个节点；-1 表示塌了，NODE_COUNT 表示四个节点都过了。 */
  breakAt: number
  title: MessageText
  /** null = 没有可说的下一步（认不出来的失败就是这样）。 */
  suggestion: MessageKey | null
}

/**
 * 从任意异常里取出错误码。
 *
 * 「认不出来」是版本错位，不是程序错误：一个新版后端报的码，旧版界面按
 * `internal` 处理，仍然有一句话可读，而不是抛在 catch 里。
 */
export function errorCode(error: unknown): string {
  return isWireError(error) ? error.code : 'internal'
}

/**
 * 没有码可查的失败，照它自己说的那句话读。
 *
 * 走到这里的是**本机抛的**东西：一句 `new Error(…)`、一个 `TypeError`。它没有身份，
 * 所以不能塌成一句「内部错误」—— 那句话把原因一起丢掉，而这条路径上原文往往就是唯一
 * 的线索。只剥掉 Electron 给异常套的前缀：`desktop:bootstrap` 是本机唯一还走 IPC 的
 * 调用，它的拒绝会带上 `Error invoking remote method '…': Error: `，那是实现细节。
 */
function localText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

/**
 * 一个失败 → 界面上那一句话，**存成 key 而不是句子**。
 *
 * 存 key 是必须的：这些字要留在屏幕上（一个文件行的提示、一条常驻通知、失败页的
 * 标题），存句子的话用户切一次语言，它们就停在上一门语言里。参数（路径、主机名）
 * 一起存，因为同一句话在不同对象上读起来不同。
 *
 * 认不出的码退回 `message` —— 那句话是**不做本地化**的诊断原文，可读但不漂亮，
 * 好过一片空白。这条规则在 `@pureterm/i18n` 的 `tWireError` 里只有一份。
 */
export function errorMessage(error: unknown): MessageText {
  if (typeof error === 'string') {
    const key = `error.${error}`
    return hasKey(key) ? { key: key as MessageKey } : { text: tWireError({ code: error as HostErrorCode, message: error }) }
  }
  if (!isWireError(error)) return { text: localText(error) }
  const key = `error.${error.code}`
  return hasKey(key)
    ? { key: key as MessageKey, ...(error.params ? { params: error.params } : {}) }
    : { text: tWireError(error) }
}

/** 一个失败该在界面上被读成哪句话。内联位置（提示、通知、提示条）用这一句。 */
export function errorText(error: unknown): string {
  return resolveMessage(errorMessage(error))
}

export function stageKey(stage: Stage): MessageKey {
  return STAGE_KEY[stage]
}

/**
 * 分诊：错误码 → 路线 + 标题 + 建议。
 *
 * 标题按**码**给（每一个码一句话），建议按**类别**给（同一类失败下一步是同一件事）。
 * 认不出来的码塌掉整条路线 —— 那意味着版本错位，猜一段比不画更坏。
 */
export function diagnose(error: unknown): Failure {
  const code = errorCode(error)
  const title = errorMessage(error)
  const info = (CODE_INFO as Record<string, { stage: Stage | null; cause: Cause | null } | undefined>)[code]
  if (!info || info.stage === null) {
    return { stage: null, breakAt: -1, title, suggestion: info?.cause ? CAUSE_KEY[info.cause] : null }
  }
  return {
    stage: info.stage,
    breakAt: NODE_OF[info.stage],
    title,
    suggestion: info.cause ? CAUSE_KEY[info.cause] : null,
  }
}

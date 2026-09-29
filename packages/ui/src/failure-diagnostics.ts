import type { MessageKey } from '@pureterm/i18n'

/**
 * 连接失败的分诊。
 *
 * **只做一件事：把宿主已经写好的那句话读成「死在哪一步 + 下一步做什么」。**
 *
 * 为什么在页面里做而不是让宿主报一个阶段码：`packages/host/src/services/ssh.ts`
 * 的 `normalizeSshError` 已经判定过一遍了 —— 它知道这是解析、TCP、横幅、密钥交换
 * 还是认证，而且已经用中文把它说出来（「TCP 连接建立了，但对方在送出 SSH 横幅之前就
 * 断开了」「连上了、登录也成功了，但这台服务器没能开起 SFTP 子系统」）。要一个阶段码
 * 就得改 `@pureterm/protocol` 的 `WireReply.error`（今天是裸字符串）、transport 的
 * 拍平、client 侧重建 Error，以及那一整套消费方与文档；而信息本身早就在消息里了。
 *
 * 代价是这是一份**契约的第二次表述**，所以它必须由测试钉住：
 * `packages/ui/tests/failure-diagnostics.test.mjs` 里每条中文都照抄宿主，
 * 宿主改措辞就会在这里红一次。
 *
 * 结论那两句（title / suggestion）**存的是 key 不是句子**：失败页是「算一次、之后
 * 一直画」的，存句子的话用户在失败之后切一次语言，页面会停在上一门语言里 —— 而
 * 那正是他最需要读懂的一屏。句子由渲染时 `t()` 解析。
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

export interface Failure {
  /** null = 认不出来。此时路线整条塌掉，而不是猜一段。 */
  stage: Stage | null
  /** 断在第几个节点；-1 表示塌了，NODE_COUNT 表示四个节点都过了。 */
  breakAt: number
  title: MessageKey
  /** null = 没有可说的下一步（认不出来的失败就是这样）。 */
  suggestion: MessageKey | null
}

/**
 * 表里的中文照抄 ssh.ts，英文是 :183 兜底路径会原样带出来的底层文案。
 *
 * 匹配的仍然是**句子**而不是错误码：宿主那边要到 Phase C 才改发 `{code, params}`，
 * 在那之前页面只有这句话可读。所以这张表读的是宿主当前的说法，认不出来就整条塌掉，
 * 不猜。
 */
const KNOWN: Array<{ test: RegExp; stage: Stage; title: MessageKey; suggestion: MessageKey }> = [
  { test: /主机地址不能为空|用户名不能为空|缺少认证凭据/, stage: 'local', title: 'failure.cause.incomplete.title', suggestion: 'failure.cause.incomplete.suggestion' },
  { test: /客户端已断开连接/, stage: 'local', title: 'failure.cause.cancelled.title', suggestion: 'failure.cause.cancelled.suggestion' },
  { test: /无法解析主机名|ENOTFOUND|EAI_AGAIN/, stage: 'address', title: 'failure.cause.dns.title', suggestion: 'failure.cause.dns.suggestion' },
  { test: /目标端口拒绝连接|ECONNREFUSED/, stage: 'tcp', title: 'failure.cause.port-refused.title', suggestion: 'failure.cause.port-refused.suggestion' },
  { test: /超时|ETIMEDOUT|Timed out/, stage: 'tcp', title: 'failure.cause.port-dropped.title', suggestion: 'failure.cause.port-dropped.suggestion' },
  { test: /连接被重置|Socket closed|ECONNRESET/, stage: 'tcp', title: 'failure.cause.reset.title', suggestion: 'failure.cause.reset.suggestion' },
  { test: /握手完成前|送出 SSH 横幅之前|Connection lost before handshake/, stage: 'handshake', title: 'failure.cause.banner.title', suggestion: 'failure.cause.banner.suggestion' },
  { test: /主机密钥已改变|主机密钥校验失败|Host verification failed|Host key verification failed/, stage: 'keyexchange', title: 'failure.cause.host-key-changed.title', suggestion: 'failure.cause.host-key-changed.suggestion' },
  // TOFU：这不是「密钥不对」，是「还没信过它」。策略要求显式确认时宿主就是这么拒的，
  // 所以它归在密钥交换那一格，建议是给确认而不是换密钥。
  { test: /首次连接该主机|当前策略要求显式确认/, stage: 'keyexchange', title: 'failure.cause.host-key-unknown.title', suggestion: 'failure.cause.host-key-unknown.suggestion' },
  { test: /Unable to negotiate|no matching|invalid algorithm|kex identities/, stage: 'keyexchange', title: 'failure.cause.algorithm.title', suggestion: 'failure.cause.algorithm.suggestion' },
  { test: /认证失败|Permission denied|All configured authentication methods failed/, stage: 'auth', title: 'failure.cause.auth.title', suggestion: 'failure.cause.auth.suggestion' },
  { test: /口令|passphrase|Cannot parse privateKey|privateKey|Decryption failed|Unsupported key format|私钥无法解析|不是可识别的私钥|读不到私钥文件/, stage: 'auth', title: 'failure.cause.key-unusable.title', suggestion: 'failure.cause.key-unusable.suggestion' },
  // 会话已经没了：登录、密钥交换全都在它之前成功过，所以四个格子都该是绿的。
  { test: /会话不存在或已关闭/, stage: 'session', title: 'failure.cause.session-gone.title', suggestion: 'failure.cause.session-gone.suggestion' },
  { test: /SFTP 子系统|Unable to start subsystem|establishing SFTP session|Channel open failure/, stage: 'session', title: 'failure.cause.sftp-unavailable.title', suggestion: 'failure.cause.sftp-unavailable.suggestion' },
]

export function stageKey(stage: Stage): MessageKey {
  return STAGE_KEY[stage]
}

export function diagnose(message: string): Failure {
  const hit = KNOWN.find((entry) => entry.test.test(message))
  if (!hit) return { stage: null, breakAt: -1, title: 'failure.unknown.title', suggestion: null }
  return { stage: hit.stage, breakAt: NODE_OF[hit.stage], title: hit.title, suggestion: hit.suggestion }
}

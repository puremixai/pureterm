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

export interface Failure {
  /** null = 认不出来。此时路线整条塌掉，而不是猜一段。 */
  stage: Stage | null
  /** 断在第几个节点；-1 表示塌了，NODE_COUNT 表示四个节点都过了。 */
  breakAt: number
  title: string
  suggestion: string
}

/** 表里的中文照抄 ssh.ts，英文是 :183 兜底路径会原样带出来的底层文案。 */
const KNOWN: Array<{ test: RegExp; stage: Stage; title: string; suggestion: string }> = [
  { test: /主机地址不能为空|用户名不能为空|缺少认证凭据/, stage: 'local', title: '还没开始连', suggestion: '先把地址、用户名和一种凭据填齐。' },
  { test: /客户端已断开连接/, stage: 'local', title: '这次连接被取消了', suggestion: '换了标签页或等太久会导致这个；再点一次「重新连接」。' },
  { test: /无法解析主机名|ENOTFOUND|EAI_AGAIN/, stage: 'address', title: '域名没解析出来', suggestion: '检查拼写；这台机器解析不了就直接填 IP。' },
  { test: /目标端口拒绝连接|ECONNREFUSED/, stage: 'tcp', title: '端口没人听', suggestion: '确认 sshd 在跑、端口号对，以及安全组放通了它。' },
  { test: /超时|ETIMEDOUT|Timed out/, stage: 'tcp', title: '端口被丢弃', suggestion: 'TCP 一直没应答：通常是防火墙丢包，或那个 IP 到不了。' },
  { test: /连接被重置|Socket closed|ECONNRESET/, stage: 'tcp', title: '连接被中断', suggestion: '对端或中间设备掐断了连接；隔几秒重试一次看看是否稳定。' },
  { test: /握手完成前|送出 SSH 横幅之前|Connection lost before handshake/, stage: 'handshake', title: '握手前就被断开', suggestion: '这一步与密钥无关。最常见的原因是这个端口上跑的不是 SSH 服务。' },
  { test: /主机密钥已改变|主机密钥校验失败|Host verification failed|Host key verification failed/, stage: 'keyexchange', title: '主机密钥与记录不符', suggestion: '可能是中间人攻击。确认服务器确实重装或换过密钥之后，再清除本地记录。' },
  { test: /Unable to negotiate|no matching|invalid algorithm|kex identities/, stage: 'keyexchange', title: '算法协商不上', suggestion: '双方没有共同的密钥交换或加密算法；通常需要升级服务端的 OpenSSH。' },
  { test: /认证失败|Permission denied|All configured authentication methods failed/, stage: 'auth', title: '认证被拒', suggestion: '用户名与密码/私钥的配对不对。注意很多服务器禁止 root 用密码登录。' },
  { test: /口令|passphrase|Cannot parse privateKey|privateKey|Decryption failed|Unsupported key format|私钥无法解析|不是可识别的私钥|读不到私钥文件/, stage: 'auth', title: '私钥用不了', suggestion: '加密私钥要给口令；格式不支持或读不到就重新选一份 OpenSSH 格式的私钥。' },
  { test: /SFTP 子系统|Unable to start subsystem|establishing SFTP session|Channel open failure/, stage: 'session', title: 'SFTP 开不起来', suggestion: '登录本身是好的，终端可以继续用；sshd_config 里的 Subsystem sftp 可能被关掉了。' },
]

const LABEL: Record<Stage, string> = {
  local: '本机',
  address: '解析',
  tcp: 'TCP',
  handshake: '横幅',
  keyexchange: '密钥交换',
  auth: '认证',
  session: '会话',
}

export function stageLabel(stage: Stage): string {
  return LABEL[stage]
}

export function diagnose(message: string): Failure {
  const hit = KNOWN.find((entry) => entry.test.test(message))
  if (!hit) return { stage: null, breakAt: -1, title: '连接失败', suggestion: '' }
  return { stage: hit.stage, breakAt: NODE_OF[hit.stage], title: hit.title, suggestion: hit.suggestion }
}

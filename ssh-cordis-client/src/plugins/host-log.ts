import { Service, type Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    hostLog: HostLog
  }
}

export interface HostLogOptions {
  /** 日志出口。默认写 stdout；传 false 关掉（测试里想要干净输出时用）。 */
  sink?: ((line: string) => void) | false
}

/**
 * HostLog —— 观测插件：把 ssh/* 事件写成一行行日志。
 *
 * 为什么不继续写在 createHost 里：**装配**（把插件装进树）和**记录**（观察运行时）是两件事。
 * 记录可以换出口、可以关掉、可以被别的订阅者取代；装配不行。
 * 抽成插件之后它还跟着插件树一起 dispose —— 不会留下一堆挂在 root 上、
 * 指向已销毁服务的悬空监听（这在「重复创建宿主」的场景里会真的泄漏。
 *
 * 顺带把它做成一个示例：插件层该怎么消费事件。
 * 事件是**广播**语义（谁关心谁订阅），请求/响应一律走服务方法返回 Promise。
 */
export class HostLog extends Service {
  constructor(ctx: Context, options: HostLogOptions = {}) {
    super(ctx, 'hostLog')

    const sink = options.sink ?? ((line: string) => console.log(line))
    if (sink === false) return

    this.ctx.on('ssh/session-opened', (sessionId: string, target: string) => {
      sink(`[host] ${sessionId} 已连接 ${target}`)
    })
    this.ctx.on('ssh/session-closed', (sessionId: string, reason: string) => {
      sink(`[host] ${sessionId} 已结束：${reason}`)
    })
    this.ctx.on('ssh/host-key-learned', (target: string, fingerprint: string) => {
      sink(`[host] 首次记录 ${target} 的主机密钥指纹 ${fingerprint}`)
    })
  }
}

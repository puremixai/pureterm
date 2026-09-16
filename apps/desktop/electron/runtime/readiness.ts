/*
 * 就绪闸门。纯逻辑，不 import electron（可脱离 Electron 单测）。
 *
 * 纪律来自 dsh 的启动顺序第 7 步：
 *   「Web surface 成功加载后才创建托盘并提交 profile 的 last-known-good 状态。」
 *
 * 关键在「才」字。以前我们是渲染层一上报就 console.log 一句，然后什么都不做——
 * 上报本身没有任何约束力，任何想「等应用真能用了再干」的代码都只能自己再判一次。
 * 现在把这件事变成结构：想在就绪后做的事必须注册到闸门上，闸门没开就不会执行。
 *
 * 「就绪」的判定标准是渲染层自己回报 app:renderer-ready 且 ok:true —— 它意味着
 * preload 通了、IPC 能调、xterm 挂上了、主机列表拉回来了。
 * 而 did-finish-load 只说明 HTML 解析完了，不足以作为提交依据。
 */

import type { RendererReadyPayload } from '../../shared/protocol.js'

export type { RendererReadyPayload }

/**
 * 把载体送上来的**任意**东西收窄成一份可信的上报。
 *
 * 为什么必须过这一道：上报会带着 cols/rows 被写进 launch-profile.json，
 * 而它来自渲染层——渲染层可能因为 bug 传了 undefined/字符串，
 * 也可能（走 Web 载体时）来自一个我们没写过的客户端。宁可收窄成 0，
 * 也不要让一个 NaN 混进档案里，那会让「窗口是否正常初始化」这条证据失效。
 */
export function normalizeReadyPayload(payload: unknown): RendererReadyPayload {
  const raw = (payload ?? {}) as Record<string, unknown>
  const info: RendererReadyPayload = {
    ok: raw.ok === true,
    hosts: Number(raw.hosts) || 0,
    cols: Number(raw.cols) || 0,
    rows: Number(raw.rows) || 0,
  }
  if (typeof raw.error === 'string' && raw.error) info.error = raw.error
  return info
}

export interface ReadinessReport {
  /** 本次上报是否被接受（就绪之后再上报一律忽略） */
  accepted: boolean
  /** 收到本次上报后闸门是否已经打开 */
  ready: boolean
}

export interface ReadinessGate {
  readonly isReady: boolean
  /** 最后一次被接受的上报内容 */
  readonly lastPayload: RendererReadyPayload | undefined
  /** 注册「闸门开了才允许执行」的动作；已经开了就立即执行。返回退订函数。 */
  onReady(action: (payload: RendererReadyPayload) => void): () => void
  /** 渲染层上报。ok:false 不会解锁闸门，允许之后重试（比如重连成功后回报成功）。 */
  report(payload: RendererReadyPayload): ReadinessReport
}

export function createReadinessGate(): ReadinessGate {
  let ready = false
  let last: RendererReadyPayload | undefined
  const pending: Array<(payload: RendererReadyPayload) => void> = []

  return {
    get isReady(): boolean {
      return ready
    },
    get lastPayload(): RendererReadyPayload | undefined {
      return last
    },

    onReady(action) {
      if (ready && last) {
        action(last)
        return () => {
          /* 已经执行过，没有可退订的 */
        }
      }
      pending.push(action)
      return () => {
        const index = pending.indexOf(action)
        if (index >= 0) pending.splice(index, 1)
      }
    },

    report(payload) {
      // 就绪是不可逆的：一旦确认过就不会再变，重复上报直接忽略，
      // 免得一个迟到的失败上报把「已提交的 last-known-good」推翻。
      if (ready) return { accepted: false, ready: true }
      last = payload
      if (!payload.ok) return { accepted: true, ready: false }

      ready = true
      // 先清空再执行：动作里如果再注册 onReady，会走「已就绪立即执行」那条路，
      // 不会在遍历中被 push 到同一个数组里。
      const queued = pending.splice(0, pending.length)
      for (const action of queued) action(payload)
      return { accepted: true, ready: true }
    },
  }
}

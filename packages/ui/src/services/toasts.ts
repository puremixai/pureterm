import { Service, type Context } from 'cordis'
import { ClientScope } from '../client-runtime.js'

export interface ToastNotice {
  title: string
  /** 一行 mono 细节：地址、指纹、文件名。标题说做了什么，这一行说是对谁做的。 */
  detail?: string
  kind?: 'ok' | 'err'
}

/** 一条通知活多久。没有假时钟可测，所以这条常量不在任何测试里被断言。 */
const SHOWING = 5_000
/** 最多同时挂几条。 */
const MAX = 3

/**
 * 右下角的事件通知。
 *
 * 存在的理由：`view.status()` 写的是连接表单里的 `#status`，而「已保存 web-01」
 * 这种话讲完的时候，用户往往早就离开了那个表单。所以**已经发生的事**走这里。
 *
 * 反过来也成立，而且这一半更重要：字段校验、常驻说明、以及「点保存前先把地址填上」
 * 这类必须跟着焦点走的话，仍然留在表单里。会自动消失的东西不能当说明书用 ——
 * 那正是 hosts.ts 里 `status()` 的三种用法，这里只搬走其中一种。
 */
export class ClientToasts extends Service {
  static inject = ['clientView']
  private readonly scope: ClientScope
  private readonly host: HTMLElement | null
  private items: HTMLElement[] = []

  constructor(ctx: Context) {
    super(ctx, 'clientToasts')
    this.scope = new ClientScope(ctx)
    // element() 在找不到 id 时会抛：漏了 #toasts 就是一次带名字的启动失败，
    // 而不是一条默默不显示的通知。
    this.host = ctx.clientView.element('toasts')
    this.scope.onDispose(() => {
      for (const element of this.items) element.remove()
      this.items = []
    })
  }

  notify(notice: ToastNotice): void {
    const host = this.host
    if (!host || !this.scope.alive) return
    const document = this.ctx.clientView.document
    const element = document.createElement('div')
    const error = notice.kind === 'err'
    element.className = `toast${error ? ' is-err' : ''}`
    // 普通通报走 role=status（礼貌播报，打断性低），失败走 role=alert（立刻播）。
    element.setAttribute('role', error ? 'alert' : 'status')

    const bar = document.createElement('span')
    bar.className = 'toast-bar'
    bar.setAttribute('aria-hidden', 'true')

    const copy = document.createElement('span')
    const title = document.createElement('span')
    title.className = 'toast-title'
    title.textContent = notice.title
    copy.append(title)
    if (notice.detail) {
      const detail = document.createElement('span')
      detail.className = 'toast-detail'
      detail.textContent = notice.detail
      copy.append(detail)
    }
    element.append(bar, copy)

    // 读过就能赶走：一条挡住右下角的通知不该需要等它自己消失。
    this.scope.listen(element, 'click', () => this.dismiss(element))
    host.append(element)
    this.items.push(element)
    // 一次失败的批量操作能产出十几条；盖住整个工作区的通知栈不是反馈，是阻碍。
    while (this.items.length > MAX) this.dismiss(this.items[0]!)

    // scope.delay 而不是 setTimeout：remount 之后还活着的计时器会把一条通知挂到
    // 已经不存在的界面上，而套件里恰好有一条测的就是这个。
    void this.scope.delay(SHOWING).then(active => { if (active) this.dismiss(element) })
  }

  private dismiss(element: HTMLElement): void {
    this.items = this.items.filter(item => item !== element)
    element.remove()
  }
}

declare module 'cordis' { interface Context { clientToasts: ClientToasts } }

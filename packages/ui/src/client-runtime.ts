import { Service, type Context } from 'cordis'

/** Resources are owned by the plugin's Cordis fiber, including unfinished async UI work. */
export class ClientScope {
  alive = true
  private readonly pending = new Set<() => void>()

  constructor(readonly ctx: Context) {
    ctx.effect(() => () => {
      this.alive = false
      for (const cancel of [...this.pending]) cancel()
      this.pending.clear()
    }, 'client.scope')
  }

  onDispose(cleanup: () => void): void { this.ctx.effect(() => cleanup, 'client.resource') }

  listen(target: EventTarget, event: string, listener: (event: Event) => void, capture = false): void {
    this.ctx.effect(() => {
      target.addEventListener(event, listener, capture)
      return () => target.removeEventListener(event, listener, capture)
    }, `client.listener:${event}`)
  }

  cancelOnDispose(cancel: () => void): () => void {
    this.pending.add(cancel)
    return () => { this.pending.delete(cancel) }
  }

  delay(milliseconds: number): Promise<boolean> {
    if (!this.alive) return Promise.resolve(false)
    return new Promise((resolve) => {
      const finish = (active: boolean): void => { clearTimeout(timer); unregister(); resolve(active) }
      const timer = setTimeout(() => finish(this.alive), milliseconds)
      const unregister = this.cancelOnDispose(() => finish(false))
    })
  }
}

export interface ClientViewOptions { document: Document }

declare module 'cordis' { interface Context { clientView: ClientView } }

export class ClientView extends Service {
  readonly document: Document
  readonly window: Window

  constructor(ctx: Context, options: ClientViewOptions) {
    super(ctx, 'clientView')
    this.document = options.document
    if (!options.document.defaultView) throw new Error('客户端需要一个已挂载的浏览器文档。')
    this.window = options.document.defaultView
  }

  element<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.document.getElementById(id)
    if (!element) throw new Error(`缺少元素 #${id}`)
    return element as T
  }

  status(text: string, kind: 'ok' | 'err' | 'pending' | '' = ''): void {
    const element = this.element('status')
    element.textContent = text
    element.className = kind
  }
}

export function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

/** A view can replace row nodes repeatedly without retaining their listeners until app exit. */
export class DomListeners {
  private cleanups: Array<() => void> = []

  add<K extends keyof HTMLElementEventMap>(target: HTMLElement, event: K, listener: (event: HTMLElementEventMap[K]) => void): void {
    target.addEventListener(event, listener as EventListener)
    this.cleanups.push(() => target.removeEventListener(event, listener as EventListener))
  }

  clear(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
  }
}

import { createClient, type Client } from './client.js'

/** The page outlives a client scope when the browser restores it from its back/forward cache. */
export function mountPageClient(mount: () => Client = () => createClient(), view: Window = window) {
  let client = mount()
  let alive = true
  let revision = 0
  let restoring: Promise<void> = Promise.resolve()
  const onHide = (): void => { revision++; void client.dispose() }
  const onShow = (event: PageTransitionEvent): void => {
    if (!event.persisted) return
    const current = ++revision
    const previous = client
    restoring = restoring.then(async () => {
      await previous.dispose()
      if (alive && current === revision) client = mount()
    }).catch(error => { console.error('[client] 恢复页面失败：', error) })
  }
  view.addEventListener('pagehide', onHide)
  view.addEventListener('pageshow', onShow)
  return {
    get client(): Client { return client },
    async dispose(): Promise<void> {
      alive = false
      revision++
      view.removeEventListener('pagehide', onHide)
      view.removeEventListener('pageshow', onShow)
      await client.dispose()
      await restoring
    },
  }
}

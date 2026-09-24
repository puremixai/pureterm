import type { HostRecord, KeyRecord } from '@pureterm/protocol'
import { DomListeners } from './client-runtime.js'

/**
 * 主机列表。**只做两件事：把记录画成行、把行上的动作翻译成回调。**
 *
 * 为什么单独一个文件（和 transport.ts 同一个理由）：`app.ts` 管的是「终端会话的生命周期」，
 * 主机列表管的是「有哪些主机、每一行能干什么」。混在一起之后，改一个行内按钮的样式
 * 得先把连接流程读一遍。这里的对外接口只有「渲染」一个方法，加上四个回调，
 * 具体做选中还是连接由调用方决定——列表自己不知道有终端这回事。
 *
 * 和协议层的关系：这里只吃 `HostRecord`，不认识 `hosts:list` 这类通道名，
 * 也不认识 `api`。数据从哪来是 app.ts 的事。
 */
export interface HostListHandlers {
  /** 单击行：只移动卡片高亮，不打开编辑器 */
  onSelect(record: HostRecord): void
  /** 按「编辑」：把这条记录装进表单 */
  onEdit(record: HostRecord): void
  /** 双击行：直接用这条记录连接 */
  onConnect(record: HostRecord): void
  /** 按「删除」 */
  onDelete(record: HostRecord): void
}

export interface HostListView {
  dispose(): void
  /** 重画。`selectedId` 命中的那一行高亮；命中不了就都不高亮。 */
  render(records: HostRecord[], selectedId: string | null, keys?: readonly KeyRecord[]): void
  /**
   * 只移动高亮，**不重建行**。
   *
   * 为什么非要单独一个方法：选中会在单击时发生，而「连接」挂在双击上。
   * 单击时整表重建的话，用户正按着的那个按钮就换成新元素了，
   * 双击的第二下落在另一个对象上——`dblclick` 是不是还发得出来，
   * 就变成「看浏览器实现」的事。不重建，这个问题根本不存在。
   */
  select(selectedId: string | null): void
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

function cell(className: string, text: string, title?: string): HTMLSpanElement {
  const element = span(`host-cell ${className}`, text)
  if (title) element.title = title
  return element
}

/**
 * 认证列要说的是「这台机器能不能连上」：凭据在密钥库里，还是在本机一个文件路径上。
 * 算法名不在 HostRecord 上，只在 KeyRecord.type 上，所以传进来的密钥清单可能查不到
 * ——查不到就退化成 `key · keychain`，而不是编一个算法名。
 */
function authFor(record: HostRecord, keys: readonly KeyRecord[]): { text: string; kind: 'keychain' | 'file' | 'password' } {
  if (record.authMethod !== 'privateKey') return { text: 'password', kind: 'password' }
  if (record.keyId) {
    const type = keys.find(key => key.id === record.keyId)?.type?.toLowerCase()
    return { text: type ? `${type} · keychain` : 'key · keychain', kind: 'keychain' }
  }
  return { text: 'private key · 本机文件', kind: 'file' }
}

/** updatedAt 是保存时间，不是连接时间 —— 后端没有最后连接时间，列名也就叫「更新」。 */
function relative(iso: string): string {
  if (!iso) return '从未'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return new Date(then).toLocaleDateString()
}

function buildRow(record: HostRecord, handlers: HostListHandlers, listeners: DomListeners, keys: readonly KeyRecord[]): HTMLLIElement {
  const item = document.createElement('li')
  item.className = 'host-row'
  item.dataset.id = record.id

  // 主区域用 <button> 而不是 <div>：这样键盘能 Tab 到、回车能选中，
  // 不用自己补 role/tabindex/keydown 三件套。
  const main = document.createElement('button')
  main.type = 'button'
  main.className = 'host-main'
  main.title = '单击选中，双击连接'
  main.setAttribute('aria-label', `${record.label}，${record.username}@${record.host}:${record.port}，单击选中，双击连接`)

  const avatar = span('host-avatar', record.authMethod === 'privateKey' ? 'KEY' : 'SSH')
  avatar.setAttribute('aria-hidden', 'true')
  const content = document.createElement('span')
  content.className = 'host-content'
  // 名称与「已存凭据」并排，所以它们共用 .host-top 这根 flex 行；
  // 直接塞进 .host-content 会让徽标落到名称下面，卡片上就变成三行。
  const top = document.createElement('span')
  top.className = 'host-top'
  top.append(span('host-label', record.label))
  main.append(avatar, content)

  listeners.add(main, 'click', () => handlers.onSelect(record))
  listeners.add(main, 'dblclick', () => handlers.onConnect(record))

  const auth = authFor(record, keys)
  const saved = record.hasSecret ? span('tag saved', '已存凭据') : null
  if (saved) saved.title = '凭据已加密保存在本机，连接时可留空'

  const actions = document.createElement('span')
  actions.className = 'host-actions'
  actions.append(miniButton('编辑', 'edit', false, () => handlers.onEdit(record), listeners))
  actions.append(miniButton('删除', 'delete', true, () => handlers.onDelete(record), listeners))

  if (saved) top.append(saved)
  content.append(top)
  item.append(main,
    cell('mono', `${record.host}:${record.port}`),
    cell('', record.username),
    cell(`auth auth-${auth.kind}`, auth.text),
    cell('when', relative(record.updatedAt)),
    actions)
  return item
}

function miniButton(label: string, action: string, danger: boolean, onClick: () => void, listeners: DomListeners): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = danger ? 'mini danger' : 'mini'
  button.dataset.act = action
  button.textContent = label
  listeners.add(button, 'click', (event) => {
    // 行上的动作按钮必须把事件截住：不然「删除」会先冒泡成一次选中，
    // 表单被装进一条马上要删掉的记录，状态就乱了。
    event.stopPropagation()
    onClick()
  })
  return button
}

export function createHostList(container: HTMLElement, handlers: HostListHandlers): HostListView {
  const listeners = new DomListeners()
  // 记着「id → 行元素」，移动高亮时就不必再去翻 DOM（选择器写错也不会静默失效）
  const rows = new Map<string, HTMLLIElement>()

  const applySelected = (selectedId: string | null): void => {
    for (const [id, item] of rows) item.classList.toggle('active', id === selectedId)
  }

  return {
    dispose() { listeners.clear(); rows.clear(); container.replaceChildren() },
    render(records, selectedId, keys = []) {
      // 整棵重建而不是做 diff：主机数量是「人手维护」的量级（几十条顶天），
      // 重建的代价可以忽略，换来的是「列表永远等于最后一次拿到的数据」这条简单性质。
      // 监听器跟着旧元素一起被丢掉，不需要手动解绑。
      container.textContent = ''
      listeners.clear()
      rows.clear()
      for (const record of records) {
        const item = buildRow(record, handlers, listeners, keys)
        rows.set(record.id, item)
        container.append(item)
      }
      applySelected(selectedId)
    },

    select(selectedId) {
      applySelected(selectedId)
    },
  }
}

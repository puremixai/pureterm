import type { HostRecord } from '../shared/protocol.js'

/**
 * 主机列表。**只做两件事：把记录画成行、把行上的动作翻译成回调。**
 *
 * 为什么单独一个文件（和 transport.ts 同一个理由）：`app.ts` 管的是「终端会话的生命周期」，
 * 主机列表管的是「有哪些主机、每一行能干什么」。混在一起之后，改一个行内按钮的样式
 * 得先把连接流程读一遍。这里的对外接口只有「渲染」一个方法，加上三个回调，
 * 具体做选中还是连接由调用方决定——列表自己不知道有终端这回事。
 *
 * 和协议层的关系：这里只吃 `HostRecord`，不认识 `hosts:list` 这类通道名，
 * 也不认识 `api`。数据从哪来是 app.ts 的事。
 */
export interface HostListHandlers {
  /** 选中（单击行，或按「编辑」）：把这条记录装进表单 */
  onSelect(record: HostRecord): void
  /** 双击行：直接用这条记录连接 */
  onConnect(record: HostRecord): void
  /** 按「删除」 */
  onDelete(record: HostRecord): void
}

export interface HostListView {
  /** 重画。`selectedId` 命中的那一行高亮；命中不了就都不高亮。 */
  render(records: HostRecord[], selectedId: string | null): void
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

function miniButton(label: string, action: string, danger: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = danger ? 'mini danger' : 'mini'
  button.dataset.act = action
  button.textContent = label
  button.addEventListener('click', (event) => {
    // 行上的动作按钮必须把事件截住：不然「删除」会先冒泡成一次选中，
    // 表单被装进一条马上要删掉的记录，状态就乱了。
    event.stopPropagation()
    onClick()
  })
  return button
}

function buildRow(record: HostRecord, handlers: HostListHandlers): HTMLLIElement {
  const item = document.createElement('li')
  item.className = 'host-row'
  item.dataset.id = record.id

  // 主区域用 <button> 而不是 <div>：这样键盘能 Tab 到、回车能选中，
  // 不用自己补 role/tabindex/keydown 三件套。
  const main = document.createElement('button')
  main.type = 'button'
  main.className = 'host-main'
  main.title = '双击连接'
  main.setAttribute('aria-label', `${record.label}，${record.username}@${record.host}:${record.port}，双击连接`)

  const top = document.createElement('span')
  top.className = 'host-top'
  top.append(span('host-label', record.label))
  top.append(span('tag', record.authMethod === 'privateKey' ? '私钥' : '密码'))
  // 「已存凭据」只在真的有密文时出现——它是「密码留空也能连」的唯一依据，
  // 用户得看得见，否则会以为必须每次重填。
  if (record.hasSecret) {
    const saved = span('tag saved', '已存凭据')
    saved.title = '凭据已加密保存在本机，连接时可留空'
    top.append(saved)
  }

  main.append(top)
  main.append(span('host-sub', `${record.username}@${record.host}:${record.port}`))

  main.addEventListener('click', () => handlers.onSelect(record))
  main.addEventListener('dblclick', () => handlers.onConnect(record))

  const actions = document.createElement('span')
  actions.className = 'host-actions'
  actions.append(miniButton('编辑', 'edit', false, () => handlers.onSelect(record)))
  actions.append(miniButton('删除', 'delete', true, () => handlers.onDelete(record)))

  item.append(main, actions)
  return item
}

export function createHostList(container: HTMLElement, handlers: HostListHandlers): HostListView {
  // 记着「id → 行元素」，移动高亮时就不必再去翻 DOM（选择器写错也不会静默失效）
  const rows = new Map<string, HTMLLIElement>()

  const applySelected = (selectedId: string | null): void => {
    for (const [id, item] of rows) item.classList.toggle('active', id === selectedId)
  }

  return {
    render(records, selectedId) {
      // 整棵重建而不是做 diff：主机数量是「人手维护」的量级（几十条顶天），
      // 重建的代价可以忽略，换来的是「列表永远等于最后一次拿到的数据」这条简单性质。
      // 监听器跟着旧元素一起被丢掉，不需要手动解绑。
      container.textContent = ''
      rows.clear()
      for (const record of records) {
        const item = buildRow(record, handlers)
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

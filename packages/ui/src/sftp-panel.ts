import type { SftpDir, SftpEntry } from '@pureterm/protocol'
import { formatBytes, formatTime } from './format.js'
import { cell } from './host-list.js'
import { DomListeners } from './client-runtime.js'

/**
 * 远端文件面板。**只做两件事：把目录画成行、把行上的动作翻译成回调。**
 *
 * 和 host-list.ts 同一条纪律，理由也一样：app.ts 管的是「会话的生命周期」，
 * 这里管的是「这个目录里有什么、每一项能干什么」。它不认识 `api`，不认识通道名，
 * 也**不记自己当前在哪个目录**——路径是 app.ts 的状态（刷新、上级、上传都要用它），
 * 这里的输入就是一个 `SftpDir`。一记两份，就会出现「面板显示 A 而刷新拉的是 B」。
 *
 * 它拿到的入口是整个 `#sftp` 元素，子元素在自己内部按 id 找：
 * 面板的骨架（路径条、动作按钮、列表、空态）全归它管，`index.html` 里只留一个 `<section>`，
 * 于是「这个面板长什么样」只有一处定义，不必在两个文件之间来回对。
 */
export interface SftpHandlers {
  /** 去这个路径。进入某目录、点「上级」、在路径条里回车，都是这一件事 */
  onNavigate(path: string): void
  /** 重新拉当前目录 */
  onRefresh(): void
  onDownload(entry: SftpEntry): void
  onDelete(entry: SftpEntry): void
  onUpload(file: File): void
  onCreate(name: string): void
  onClose(): void
}

export interface SftpView {
  dispose(): void
  /** 画一个目录；传 null = 没有会话（未连接 / 已断开） */
  render(dir: SftpDir | null): void
  /** 面板内的提示/报错。不复用状态栏那条，因为它说的是终端的事 */
  setHint(text: string, kind?: 'ok' | 'err' | 'pending' | ''): void
  /** 有远端操作在跑：禁掉会重入的动作（连点两次删除是真的会删两次） */
  setBusy(busy: boolean): void
  /** 有没有可用会话。没会话时整面板置灰，而不是清空——用户能看到「这里还能用」 */
  setEnabled(enabled: boolean): void
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

function tag(text: string, extra = ''): HTMLSpanElement {
  return span(extra ? `tag ${extra}` : 'tag', text)
}

/**
 * 权限位取低 12 位（含 setuid/gid/sticky）。
 *
 * 0 不是 000 权限，而是「对端没给这个属性」（sftp-bridge.ts:455 把缺失的 attrs
 * 一律落成 0）—— 把不知道画成没人可读，是比空白更糟的谎。
 */
function octalMode(mode: number): string {
  if (!mode) return '—'
  return (mode & 0o7777).toString(8).padStart(3, '0')
}

function button(id: string, label: string, className: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.id = id
  element.className = className
  element.textContent = label
  return element
}

function must<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const element = root.querySelector<T>(`#${id}`)
  if (!element) throw new Error(`远端文件面板缺少元素 #${id}`)
  return element
}

export function createSftpPanel(root: HTMLElement, handlers: SftpHandlers): SftpView {
  const listeners = new DomListeners()
  const rowListeners = new DomListeners()
  const body = document.createElement('div')
  body.id = 'sftp-body'

  const head = document.createElement('header')
  head.className = 'panel-head'

  const title = span('panel-title', '远端文件')
  // 路径做成可输入的：要去 /var/log 不该靠一层层点进去。回车才跳转——
  // 失焦也跳的话，用户点到别处就会莫名其妙换目录。
  const pathInput = document.createElement('input')
  pathInput.id = 'sftp-path'
  pathInput.spellcheck = false
  pathInput.placeholder = '连上之后可以在这里浏览远端文件'
  pathInput.disabled = true

  const upButton = button('sftp-up', '上级', 'ghost small')
  const refreshButton = button('sftp-refresh', '刷新', 'ghost small')
  const mkdirButton = button('sftp-mkdir', '新建文件夹', 'ghost small')
  const uploadButton = button('sftp-upload', '上传…', 'ghost small')
  const closeButton = button('sftp-close', '收起', 'ghost small')

  // 上传入口。放在这里而不是让壳弹系统对话框：浏览器里也有 <input type="file">，
  // 于是桌面端和 Web 载体走的是同一个控件、同一段代码。
  const fileInput = document.createElement('input')
  fileInput.id = 'sftp-file'
  fileInput.type = 'file'
  fileInput.hidden = true

  head.append(title, pathInput, upButton, refreshButton, mkdirButton, uploadButton, closeButton, fileInput)

  /*
   * 新文件夹的名字用**页面内的输入框**收，不用 window.prompt。
   *
   * 这不是风格选择：**Electron 不支持 window.prompt**（`alert` / `confirm` 都实现了，
   * 唯独 `prompt` 因为要同步返回一个字符串而没实现）。用它的话桌面端点下去什么都不发生，
   * 没有报错、也没有对话框——而浏览器里偏偏又是好的，于是这类问题会被记成
   * 「桌面端偶发」查很久。顺带这样还更好用：起名字时列表还在眼前。
   */
  const createBar = document.createElement('div')
  createBar.id = 'sftp-create'
  createBar.hidden = true
  const createName = document.createElement('input')
  createName.id = 'sftp-create-name'
  createName.spellcheck = false
  createName.placeholder = '新文件夹的名字'
  const createOk = button('sftp-create-ok', '创建', 'ghost small')
  const createCancel = button('sftp-create-cancel', '取消', 'ghost small')
  createBar.append(span('panel-title', '新建文件夹'), createName, createOk, createCancel)

  const columns = document.createElement('div')
  columns.id = 'sftp-columns'
  columns.className = 'file-columns'
  // 列标题只是给眼睛对齐用的；每一行自己带完整语义，所以这里不重复播报。
  columns.setAttribute('aria-hidden', 'true')
  for (const label of ['名称', '大小', '模式', '修改时间', '']) columns.append(document.createElement('span'))

  const list = document.createElement('ul')
  list.id = 'sftp-list'
  list.setAttribute('aria-label', '远端目录内容')

  const hint = document.createElement('p')
  hint.id = 'sftp-hint'
  hint.className = 'empty'
  hint.textContent = '连上之后可以在这里浏览远端文件。'

  body.append(columns, list, hint)
  root.textContent = ''
  root.append(head, createBar, body)

  /*
   * 三个状态位。行按钮是每次 render 重建的，所以禁用的判定必须由一个
   * 「重新算一遍」的函数统一施加，而不是在 render 时按当时的值写死——
   * 否则忙碌中刷新出来的新行会是可点的。
   */
  let busy = false
  let enabled = false
  let current: SftpDir | null = null
  let rowButtons: HTMLButtonElement[] = []

  const headButtons = [upButton, refreshButton, mkdirButton, uploadButton, createOk, createCancel]

  const closeCreateBar = (): void => {
    createBar.hidden = true
    createName.value = ''
  }

  function syncDisabled(): void {
    for (const element of headButtons) element.disabled = !enabled || busy
    for (const element of rowButtons) element.disabled = !enabled || busy
    // 「上级」还要看有没有上一级：已经在根上就没什么可上的
    upButton.disabled = !enabled || busy || !current?.parent
    createName.disabled = !enabled || busy
    // 起名字的条已经展开时，就把「新建文件夹」收起来：同一件事不需要两个入口
    mkdirButton.hidden = !createBar.hidden
    pathInput.disabled = !enabled || busy
    // 「收起」任何时候都能按：它不改远端状态，忙碌时也该能把面板收起来
    closeButton.disabled = false
  }

  function buildRow(entry: SftpEntry): HTMLLIElement {
    const item = document.createElement('li')
    item.className = 'file-row'
    item.dataset.path = entry.path

    const main = document.createElement('button')
    main.type = 'button'
    main.className = 'file-main'
    // 完整路径在列表里放不下（而且远端的路径可能很长），鼠标停一下能看到
    main.title = entry.path

    const top = document.createElement('span')
    top.className = 'file-top'
    top.append(span('file-name', entry.name))
    if (entry.isDirectory) top.append(tag('目录'))
    // 软链单独标出来：它的类型是「跟着目标走」的，用户需要知道这一行不是本体
    if (entry.isSymlink) top.append(tag('链接', 'link'))

    // 大小、模式、时间是行的孩子而不是按钮的孩子：它们是表格里的那些列，
    // 得和列标题对得上，而按钮里的内容对不到列上。
    main.append(top)
    // 目录的大小没有意义（不是 0，是「不适用」），写 0 会让人以为它是空目录
    item.append(main,
      cell('file-size', entry.isDirectory ? '—' : formatBytes(entry.size)),
      cell('file-mode', octalMode(entry.mode), entry.mode ? `八进制 ${(entry.mode & 0o7777).toString(8)}` : '对端没有给出权限属性'),
      cell('file-time', formatTime(entry.mtime)))

    const actions = document.createElement('span')
    actions.className = 'file-actions'
    // 目录的主动作是「进去」，文件的主动作是「取下来」——按钮文字按结果说，不按类型说
    const primaryLabel = entry.isDirectory ? '打开' : '下载'
    const primary = document.createElement('button')
    primary.type = 'button'
    primary.className = 'mini'
    primary.dataset.act = entry.isDirectory ? 'open' : 'download'
    primary.textContent = primaryLabel
    rowListeners.add(primary, 'click', (event) => {
      event.stopPropagation()
      fire()
    })

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'mini danger'
    remove.dataset.act = 'delete'
    remove.textContent = '删除'
    rowListeners.add(remove, 'click', (event) => {
      // 行按钮必须截住事件，不然「删除」会先冒泡成一次双击/单击
      event.stopPropagation()
      handlers.onDelete(entry)
    })

    function fire(): void {
      if (entry.isDirectory) handlers.onNavigate(entry.path)
      else handlers.onDownload(entry)
    }

    // 双击 = 主动作，和主机列表一致（列表中双击的语义由行自己决定，界面不必学两套）
    rowListeners.add(main, 'dblclick', () => fire())

    actions.append(primary, remove)
    item.append(actions)

    rowButtons.push(main, primary, remove)
    return item
  }

  listeners.add(upButton, 'click', () => {
    if (current?.parent) handlers.onNavigate(current.parent)
  })
  listeners.add(refreshButton, 'click', () => handlers.onRefresh())
  listeners.add(mkdirButton, 'click', () => {
    createBar.hidden = false
    createName.focus()
    syncDisabled()
  })
  listeners.add(createCancel, 'click', () => {
    closeCreateBar()
    syncDisabled()
  })
  const submitCreate = (): void => {
    const name = createName.value.trim()
    // 空名字不提交：交给后端会得到一句「名字不对」，但用户其实只是还没填
    if (!name) {
      createName.focus()
      return
    }
    // 先把条收起来再提交：失败时错误会显示在下面的提示里，而名字也没必要留着——
    // 留着它反而挡住列表，用户下一步多半是去改别的
    closeCreateBar()
    syncDisabled()
    handlers.onCreate(name)
  }
  listeners.add(createOk, 'click', submitCreate)
  listeners.add(createName, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitCreate()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCreateBar()
      syncDisabled()
    }
  })
  listeners.add(uploadButton, 'click', () => fileInput.click())
  listeners.add(closeButton, 'click', () => handlers.onClose())

  listeners.add(fileInput, 'change', () => {
    const file = fileInput.files?.[0]
    // 立刻清空：不清的话，连着上传同一个文件第二次不会触发 change——
    // 用户会以为「上传成功但什么都没发生」
    fileInput.value = ''
    if (file) handlers.onUpload(file)
  })

  listeners.add(pathInput, 'keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const target = pathInput.value.trim()
    if (target) handlers.onNavigate(target)
  })

  syncDisabled()

  return {
    dispose() { listeners.clear(); rowListeners.clear(); root.replaceChildren() },
    render(dir) {
      current = dir
      pathInput.value = dir?.path ?? ''
      pathInput.title = dir?.path ?? ''
      list.textContent = ''
      rowListeners.clear()
      rowButtons = []
      // 每次都把提示恢复成中性样式：上一次可能是一句报错（红的），
      // 而这次是一句普通的「目录是空的」，留着红色会让用户以为又出错了
      hint.className = 'empty'

      if (!dir) {
        hint.hidden = false
        hint.textContent = enabled ? '正在读取目录…' : '连上之后可以在这里浏览远端文件。'
        syncDisabled()
        return
      }

      for (const entry of dir.entries) list.append(buildRow(entry))

      // 空态的提示和「正在读」用的是同一个元素：同时只可能有一句是真话，
      // 两处各写一句就会出现「已加载完但还是写着正在读」
      hint.hidden = dir.entries.length > 0
      hint.textContent = dir.entries.length ? '' : '这个目录是空的。'
      syncDisabled()
    },

    setHint(text, kind = '') {
      hint.hidden = false
      hint.textContent = text
      hint.className = `empty ${kind}`.trim()
    },

    setBusy(next) {
      busy = next
      syncDisabled()
    },

    setEnabled(next) {
      enabled = next
      if (!next) {
        rowListeners.clear()
        current = null
        closeCreateBar()
        pathInput.value = ''
        list.textContent = ''
        rowButtons = []
        hint.hidden = false
        hint.className = 'empty'
        hint.textContent = '连上之后可以在这里浏览远端文件。'
      }
      syncDisabled()
    },
  }
}

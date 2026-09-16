import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { MAX_TRANSFER_BYTES, type HostRecord, type RuntimeCapabilities, type SftpDir, type SftpEntry, type TerminalOpenRequest } from '@pureterm/protocol'
import { createTransport, type SmokeReport } from './transport.js'
import { createHostList } from './host-list.js'
import { createSftpPanel } from './sftp-panel.js'
import { readFileBytes, saveBytes } from './local-file.js'
import { formatBytes } from './format.js'
import { BrowserPrivateKeySelection, connectionCredentials, savedCredentials, readBrowserPrivateKey, parseRuntimeCapabilities } from './credentials.js'
import './style.css'
import '@xterm/xterm/css/xterm.css'

/**
 * 渲染层与后端之间的一切都走这个对象。
 *
 * 它落在哪条载体上由**载体的存在与否**决定，不由本文件决定：
 * Electron 里 preload 注入了 `window.sshAPI` → IPC；浏览器里打开同一份产物 → WebSocket。
 * 所以除了冒烟测试那一处探针，本文件里不出现 `window.sshAPI`，也不出现 `WebSocket`
 * ——那种写法迟早会在「桌面端能跑、浏览器里白屏」的时候才暴露出来。
 */
const api = createTransport()

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (!element) throw new Error(`缺少元素 #${id}`)
  return element as T
}

const toolbar = $<HTMLFormElement>('toolbar')
const hostListElement = $<HTMLUListElement>('host-list')
const hostsEmpty = $<HTMLParagraphElement>('hosts-empty')
const newHostButton = $<HTMLButtonElement>('host-new')
const formMode = $<HTMLSpanElement>('form-mode')
const hostInput = $<HTMLInputElement>('host')
const portInput = $<HTMLInputElement>('port')
const userInput = $<HTMLInputElement>('user')
const passInput = $<HTMLInputElement>('pass')
const authSelect = $<HTMLSelectElement>('auth')
const keyPathInput = $<HTMLInputElement>('key-path')
const keyPassInput = $<HTMLInputElement>('key-pass')
const keyPickButton = $<HTMLButtonElement>('key-pick')
const credPasswordRow = $<HTMLDivElement>('cred-password')
const credKeyRow = $<HTMLDivElement>('cred-key')
const rememberLabel = $<HTMLSpanElement>('remember-label')
const rememberCheck = $<HTMLInputElement>('remember')
const credentialHint = $<HTMLParagraphElement>('credential-hint')
const privateKeyFile = $<HTMLInputElement>('private-key-file')
const connectButton = $<HTMLButtonElement>('connect')
const disconnectButton = $<HTMLButtonElement>('disconnect')
const saveButton = $<HTMLButtonElement>('host-save')
const deleteButton = $<HTMLButtonElement>('host-delete')
const sftpToggle = $<HTMLButtonElement>('sftp-toggle')
const sftpPanelElement = $<HTMLElement>('sftp')
const statusElement = $<HTMLDivElement>('status')
const terminalContainer = $<HTMLDivElement>('terminal')

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  lineHeight: 1.2,
  scrollback: 5000,
  fontFamily: 'Cascadia Mono, Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", monospace',
  theme: {
    background: '#12151b',
    foreground: '#d7dce5',
    cursor: '#7fe3ff',
    selectionBackground: '#2f3b4d',
  },
})
const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
term.open(terminalContainer)

let sessionId: string | null = null
let connecting = false
let closedHook: ((reason: string) => void) | null = null
let capabilities: RuntimeCapabilities | null = null
const browserKey = new BrowserPrivateKeySelection()
let pickerRevision = 0

/**
 * 主机列表的内存快照。
 *
 * 列表、表单、「按 id 找一条记录」全部读它，不再为每件事单独打一次 IPC——
 * 同一份数据取两次就可能取到两个版本（保存后、删除后尤其明显），
 * 而列表和表单显示不一致时，用户没法判断到底哪个是真的。
 */
let hosts: HostRecord[] = []
/** 表单现在对应哪台已保存的主机；null = 正在新建。这一条决定「保存」是覆盖还是新增。 */
let editingId: string | null = null

function safeFit(): void {
  const { width, height } = terminalContainer.getBoundingClientRect()
  if (width < 40 || height < 40) return
  try {
    fitAddon.fit()
  } catch (error) {
    console.warn('[renderer] fit 失败', error)
  }
}

/**
 * 等布局稳下来、把终端量准，再继续后面的启动流程。
 *
 * 为什么不能只是 rAF 排一下就去上报：上报「应用可用」的 Promise 和那一帧
 * 是两条互不相干的异步链，谁先到完全不确定。refreshHosts 那次 IPC 往返要是跑在前头，
 * 上报里带的 term.cols/rows 就还是 xterm 的默认 80x24——而这两个数字会被写进
 * launch-profile.json，当作「上次窗口是否正常初始化」的证据。放任它变成随机值，
 * 闸门也就跟着失去意义：**没量过尺寸的终端不算「能用」**。
 *
 * 兜底超时：窗口万一不出帧（不可见 / 被冻结），上报也不能永远等下去，宁可量不准。
 */
function settleLayout(timeoutMs = 250): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      safeFit()
      term.focus()
      resolve()
    }
    requestAnimationFrame(finish)
    setTimeout(finish, timeoutMs)
  })
}

function setStatus(text: string, kind: 'ok' | 'err' | 'pending' | '' = ''): void {
  statusElement.textContent = text
  statusElement.className = kind
}

function banner(text: string, color: '31' | '33' | '36' = '36'): void {
  for (const line of text.split('\n')) term.write(`\x1b[${color}m${line}\x1b[0m\r\n`)
}

/** ipcRenderer.invoke 的 rejection 会带 "Error invoking remote method 'x': Error: " 前缀，去掉它 */
function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

function updateButtons(): void {
  connectButton.disabled = !capabilities || connecting || !!sessionId
  saveButton.disabled = !capabilities || connecting
  keyPickButton.disabled = !capabilities || connecting
  rememberCheck.disabled = capabilities?.credentialPersistence !== 'encrypted'
  disconnectButton.disabled = !sessionId
  // 「删除」删的是当前编辑的那台；没在看已保存的主机时它没有意义，置灰而不是隐掉——
  // 按钮位置固定，用户才能预期它一直在那儿
  deleteButton.disabled = !editingId
  // 远端文件是「这条会话」的功能：没有会话就没有远端可看。
  // 置灰而不是藏起来，理由同上——也让用户知道这个能力存在、连上就能用。
  sftpToggle.disabled = !sessionId
}

// ── 宿主 → 渲染层 ───────────────────────────────────────────────

api.onOpened((id, cols, rows) => {
  sessionId = id
  setStatus(`已连接（远端 pty ${cols}×${rows}）`, 'ok')
  updateButtons()
  term.focus()
  // 本地 fit() 发生在连接之前，那次 resize 会被丢掉；这里必须主动补一次真实尺寸
  api.resize(id, term.cols, term.rows)
  // 新会话没有「上一个目录」，下一次打开抽屉要从 home 重新读
  sftpDir = null
  sftpPanel.setEnabled(true)
  // 故意**不自动展开**抽屉：一连上就弹出一列文件会挤掉终端的高度，
  // 而绝大多数时候用户连上就是先敲命令。能力在那儿，按「文件」就能用。
  sftpPanel.setHint('点「文件」可以浏览远端目录。')
})

api.onData((id, chunk) => {
  if (id !== sessionId) return
  // 传的是字节而不是字符串：多字节字符被 SSH 分包切开也不会乱码
  term.write(chunk)
})

api.onClosed((id, reason) => {
  if (closedHook) {
    closedHook(reason)
    closedHook = null
  }
  // id 为空 = 连接阶段就失败了，那条路径由 open() 的 reject 负责报错，避免重复刷屏
  if (!id || id !== sessionId) return
  sessionId = null
  banner(reason ? `连接已结束：${reason}` : '连接已结束。', '33')
  setStatus(reason || '已断开', 'err')
  updateButtons()
  /*
   * 会话没了，远端文件面板必须**立刻收掉**，不能留着上一次那份列表：
   * 那份列表现在既点不动、也不代表任何东西，而它看起来完全正常——
   * 用户会以为「文件还在那儿，只是操作没反应」。
   */
  sftpDir = null
  sftpPanel.setEnabled(false)
  setSftpOpen(false)
})

// ── 渲染层 → 宿主 ───────────────────────────────────────────────

term.onData((data) => {
  if (sessionId) api.input(sessionId, data)
})

term.onResize(({ cols, rows }) => {
  if (sessionId) api.resize(sessionId, cols, rows)
})

// ── 交互 ────────────────────────────────────────────────────────

type AuthMethod = 'password' | 'privateKey'

function currentAuth(): AuthMethod {
  return authSelect.value === 'privateKey' ? 'privateKey' : 'password'
}

/**
 * 当前表单能不能「留空用已保存的凭据」。
 *
 * 三个条件缺一不可：选中了某台已保存的主机、它存过凭据、**存的凭据跟当前认证方式是同一种**。
 * 第三个条件是关键：密文槽只有一份，密码认证时存的是密码、私钥认证时存的是口令。
 * 编辑时若把方式从密码切成私钥而界面还说「留空就行」，那份密码就会被拿去做私钥口令——
 * 报回来的是「认证失败」这种查不出所以然的话。所以这里每次都重新算，不缓存成变量。
 */
function hasUsableSavedSecret(): boolean {
  if (capabilities?.credentialPersistence !== 'encrypted') return false
  const record = editingId ? hosts.find((item) => item.id === editingId) : undefined
  return !!record && record.hasSecret && record.authMethod === currentAuth()
}

/**
 * 按认证方式切换凭据行，并刷新占位提示。
 *
 * 用显隐而不是增删 DOM：用户切过去看一眼再切回来，填了一半的值不该被丢掉。
 * （`hidden` 能真的藏住整行，靠的是 style.css 里那条 `[hidden]{display:none!important}`——
 * `.row` 是 display:flex，会盖掉浏览器默认行为。）
 *
 * 占位提示放在这里算而不是在选中主机时算一次：用户切了认证方式，提示也得跟着改口。
 */
function syncAuthRows(): void {
  const method = currentAuth()
  credPasswordRow.hidden = method !== 'password'
  credKeyRow.hidden = method !== 'privateKey'
  rememberLabel.textContent = capabilities?.credentialPersistence === 'session'
    ? '仅当前页面'
    : method === 'privateKey' ? '记住口令' : '记住密码'
  const saved = hasUsableSavedSecret()
  passInput.placeholder = saved ? '使用已保存的密码' : ''
  keyPassInput.placeholder = saved ? '使用已保存的口令' : ''
}

/**
 * 拉一次主机列表，重画左栏。
 *
 * `keepId` 是三态，别把它当成可选参数顺手填：
 *  - 不传   —— 保持当前选中（普通刷新）
 *  - 传 id  —— 选中这一条（存完新主机后，光标应该落在刚存的那条上）
 *  - 传 null—— 取消选中，回到「新建」态（把当前这条删掉之后）
 */
async function refreshHosts(keepId?: string | null): Promise<void> {
  hosts = await api.hosts.list()
  if (keepId !== undefined) editingId = keepId
  // 记录可能已经不在列表里了（外部改过数据目录、或刚才被删掉），
  // 悬空的选中会让「保存」写进一条不存在的记录，直接落回新建态更安全
  if (editingId && !hosts.some((item) => item.id === editingId)) editingId = null
  hostsEmpty.hidden = hosts.length > 0
  hostList.render(hosts, editingId)
  syncMode()
  updateButtons()
}

/** 把「现在是在新建、还是在改哪一台」说给用户听 */
function syncMode(): void {
  const record = editingId ? hosts.find((item) => item.id === editingId) : undefined
  formMode.textContent = record ? `编辑「${record.label}」` : '新建主机'
  formMode.classList.toggle('editing', !!record)
}

/**
 * 把一条已保存的主机装进表单。
 *
 * 凭据字段一律清空：密文只存在主进程里，渲染层拿不到也不该拿到。
 * 「清空 + 占位提示（使用已保存的密码）」表达的正是「留空 = 用存好的那份」，
 * 而不是「这里没有密码」。
 *
 * 只调 `select` 移动高亮，不整表重建 —— 本函数会在双击的第一下里被调用，
 * 重建会把第二下要落上去的元素换掉（原因见 host-list.ts 里 select 的注释）。
 */
function applyHost(record: HostRecord): void {
  browserKey.clear()
  editingId = record.id
  hostInput.value = record.host
  portInput.value = String(record.port)
  userInput.value = record.username
  authSelect.value = record.authMethod
  keyPathInput.value = capabilities?.privateKeyPicker === 'browser' ? '' : record.privateKeyPath ?? ''
  passInput.value = ''
  keyPassInput.value = ''
  // 必须先摆好 editingId 和 authSelect 再调它：占位提示依赖这两者
  syncAuthRows()

  const hint = hasUsableSavedSecret() ? (record.authMethod === 'privateKey' ? '，口令留空即使用已保存的' : '，密码留空即使用已保存的') : ''

  hostList.select(editingId)
  syncMode()
  updateButtons()
  setStatus(`已选择「${record.label}」${hint}`)
}

/** 把表单恢复成「什么都没填」。不动 editingId —— 清理输入和切换模式是两件事 */
function clearForm(): void {
  browserKey.clear()
  hostInput.value = ''
  portInput.value = '22'
  userInput.value = ''
  authSelect.value = 'password'
  keyPathInput.value = ''
  passInput.value = ''
  keyPassInput.value = ''
  syncAuthRows()
}

/** 「新建」：清空并取消选中，之后「保存」走的就是新增那条路 */
function startNewHost(): void {
  editingId = null
  clearForm()
  rememberCheck.checked = capabilities?.credentialPersistence === 'encrypted'
  hostList.select(null)
  syncMode()
  updateButtons()
  setStatus('新建主机：填好地址和用户名后点「保存」')
  hostInput.focus()
}

/** 删除一台主机。列表行上的「删除」和表单里的「删除」共用这一条路。 */
async function removeHost(id: string): Promise<void> {
  const record = hosts.find((item) => item.id === id)
  const label = record?.label ?? '这台主机'
  // 密文会跟着一起删掉，且不可恢复，所以要问一句；没存凭据的就不必打扰
  const warning = record?.hasSecret ? '它保存的凭据也会一并删除。' : ''
  if (!window.confirm(`删除「${label}」？${warning}`)) return
  try {
    await api.hosts.remove(id)
    if (editingId === id) {
      editingId = null
      clearForm()
    }
    await refreshHosts(editingId)
    setStatus(`已删除「${label}」`)
  } catch (error: unknown) {
    setStatus(cleanError(error), 'err')
  }
}

/**
 * 保存表单里的主机。返回保存后的记录；表单不完整时返回 null。
 *
 * 不在这里写状态栏文案、也不抛「请填写…」：它有两个调用方——
 * 「保存」按钮（要报错）和连接成功后的顺手记住（不该插话，此时用户在等的是「已连接」）。
 * 该说什么由调用方决定。
 */
async function saveCurrentHost(): Promise<HostRecord | null> {
  if (!capabilities) throw new Error('尚未确认本机后端的凭据能力，暂时无法保存。')
  const host = hostInput.value.trim()
  const username = userInput.value.trim()
  if (!host || !username) return null
  const method = currentAuth()
  const record = await api.hosts.save({
    // 带 id = 覆盖那条记录（编辑）；不带 = 新增一条。新建和编辑的区别只有这一处。
    id: editingId ?? undefined,
    host,
    port: Number(portInput.value) || 22,
    username,
    authMethod: method,
    ...savedCredentials(capabilities, currentCredentials(), rememberCheck.checked),
  })
  // 存完跟着选中它：表单随即从「新建」变成「编辑「…」」，
  // 再点一次「保存」就是覆盖这条，不会又新增一条出来
  await refreshHosts(record.id)
  return record
}

function currentCredentials() {
  return {
    authMethod: currentAuth(),
    privateKeyPath: keyPathInput.value.trim(),
    password: passInput.value,
    passphrase: keyPassInput.value,
    hostId: editingId ?? undefined,
  }
}

async function connect(): Promise<void> {
  if (!capabilities || sessionId || connecting) return
  const host = hostInput.value.trim()
  const port = Number(portInput.value) || 22
  const username = userInput.value.trim()
  const password = passInput.value
  const method = currentAuth()
  const privateKeyPath = keyPathInput.value.trim()

  if (!host) {
    setStatus('请填写主机地址', 'err')
    hostInput.focus()
    return
  }
  if (!username) {
    setStatus('请填写用户名', 'err')
    userInput.focus()
    return
  }
  if (method === 'privateKey') {
    if (capabilities.privateKeyPicker === 'browser' ? !browserKey.value : !privateKeyPath) {
      setStatus('请先选择私钥文件', 'err')
      keyPickButton.focus()
      return
    }
  } else if (!password && !hasUsableSavedSecret()) {
    setStatus('请填写密码', 'err')
    passInput.focus()
    return
  }

  connecting = true
  updateButtons()
  setStatus(`正在连接 ${username}@${host}:${port} …`, 'pending')
  banner(`── 正在连接 ${username}@${host}:${port} ──`)

  // 按认证方式只带该带的那份凭据：另一份留空，免得把密码误当私钥口令用
  const payload: TerminalOpenRequest = {
    host,
    port,
    username,
    authMethod: method,
    ...connectionCredentials(capabilities, currentCredentials(), browserKey.value),
    cols: term.cols,
    rows: term.rows,
    term: 'xterm-256color',
  }
  try {
    const result = await api.open(payload)
    sessionId = result.sessionId
    // 只在该记住的凭据真的填了才落盘：私钥没有口令时没什么可记的
    const credentialFilled = method === 'privateKey' ? !!keyPassInput.value : !!password
    if (capabilities.credentialPersistence === 'encrypted' && rememberCheck.checked && credentialFilled) await saveCurrentHost()
  } catch (error) {
    const message = cleanError(error)
    sessionId = null
    // 不再自己加「连接失败：」前缀：ssh 服务返回的每一条都是自洽的整句（自带主机和原因），
    // 外面再裹一层会变成「连接失败：认证失败：…」这种双重前缀。
    banner(message, '31')
    setStatus(message, 'err')
  } finally {
    connecting = false
    updateButtons()
  }
}

function disconnect(): void {
  if (sessionId) api.close(sessionId)
}

toolbar.addEventListener('submit', (event) => {
  event.preventDefault()
  void connect()
})
connectButton.addEventListener('click', () => void connect())
disconnectButton.addEventListener('click', disconnect)

/**
 * 左栏列表的接线。三件事各自直白地映射到一个动作，判断都在别处：
 * 单点/编辑按钮 → 装进表单；双击 → 装进表单再连；删除 → 走和表单里同一个 removeHost。
 *
 * 双击必须是「先装表单再连」：connect() 读的是表单里的值。
 * 不先摆好这条记录，双击就变成了「拿上一次填的东西去连另一台」。
 */
const hostList = createHostList(hostListElement, {
  onSelect: (record) => applyHost(record),
  onConnect: (record) => {
    if (sessionId || connecting) return
    applyHost(record)
    void connect()
  },
  onDelete: (record) => void removeHost(record.id),
})

newHostButton.addEventListener('click', () => startNewHost())

authSelect.addEventListener('change', () => {
  clearBrowserKey()
  syncAuthRows()
  updateButtons()
})

function clearBrowserKey(): void {
  browserKey.clear()
  if (capabilities?.privateKeyPicker === 'browser') {
    keyPathInput.value = ''
    keyPassInput.value = ''
    privateKeyFile.value = ''
  }
}

// A selected key belongs to this host form, including its address and SSH identity.
for (const input of [hostInput, portInput, userInput]) input.addEventListener('input', clearBrowserKey)

keyPickButton.addEventListener('click', () => {
  if (!capabilities) return
  const revision = browserKey.prepare()
  if (capabilities.privateKeyPicker === 'browser') {
    pickerRevision = revision
    privateKeyFile.value = ''
    // click must remain inside the original user gesture, before any await/RPC.
    privateKeyFile.click()
    return
  }
  void api
    .pickPrivateKey()
    .then((picked) => {
      if (!picked || !browserKey.isCurrent(revision)) return
      keyPathInput.value = picked.path
      if (picked.error) {
        setStatus(picked.error, 'err')
        return
      }
      // 提前把「这把有口令」说出来，比让用户连到一半才失败再回来猜好
      if (picked.encrypted) {
        keyPassInput.focus()
        setStatus('这把私钥有口令保护，请在「私钥口令」里填上。', 'pending')
      } else {
        keyPassInput.value = ''
        setStatus('已选择私钥（未加密，口令留空即可）。', 'ok')
      }
    })
    .catch((error: unknown) => setStatus(cleanError(error), 'err'))
})

privateKeyFile.addEventListener('change', () => {
  const file = privateKeyFile.files?.[0]
  privateKeyFile.value = ''
  if (!file || !browserKey.isCurrent(pickerRevision)) return
  const revision = browserKey.begin()
  keyPathInput.value = ''
  keyPassInput.value = ''
  void readBrowserPrivateKey(file)
    .then((selected) => {
      if (!browserKey.commit(revision, selected)) return
      keyPathInput.value = selected.name
      keyPassInput.focus()
      setStatus('私钥仅在当前页面使用。若有口令请填写，未加密则留空。', 'ok')
    })
    .catch((error: unknown) => {
      if (browserKey.isCurrent(revision)) setStatus(cleanError(error), 'err')
    })
})

saveButton.addEventListener('click', () => {
  void saveCurrentHost()
    .then((record) => {
      if (!record) {
        setStatus('保存前请先把主机地址和用户名填上', 'err')
        if (!hostInput.value.trim()) hostInput.focus()
        else userInput.focus()
        return
      }
      setStatus(`已保存「${record.label}」`, 'ok')
    })
    .catch((error: unknown) => setStatus(cleanError(error), 'err'))
})

// 表单里的「删除」删的就是当前选中的那台；和在列表行上按「删除」走同一条路
deleteButton.addEventListener('click', () => {
  if (editingId) void removeHost(editingId)
})

// ── 远端文件（SFTP）──────────────────────────────────────────────

/**
 * 面板当前显示的目录 = 对端 realpath 之后的结果，不是我们请求的那个。
 * 请求 `.` 时它会变成 home 的绝对路径，所以「现在在哪」只能以返回值为准。
 * null = 还没成功读过任何目录。
 */
let sftpDir: SftpDir | null = null

const sftpPanel = createSftpPanel(sftpPanelElement, {
  onNavigate: (path) => void loadDirectory(path),
  onRefresh: () => void loadDirectory(sftpDir?.path ?? '.'),
  onDownload: (entry) => void downloadEntry(entry),
  onDelete: (entry) => void deleteEntry(entry),
  onUpload: (file) => void uploadFile(file),
  onCreate: (name) => void createFolder(name),
  onClose: () => setSftpOpen(false),
})

/**
 * 展开/收起文件抽屉。
 *
 * 收起来时**故意不清空内容**：用户收起是为了看终端，再打开时还该看到刚才那个目录，
 * 而不是又从头加载一遍（还会丢掉滚动位置）。
 *
 * 展开/收起都会改变终端的高度，所以必须重新 fit 一次：xterm 的行列数是按可用高度
 * 算出来的，不重量的话远端还以为自己有那么多行，光标会跑到可视区外面去。
 */
function setSftpOpen(open: boolean): void {
  sftpPanelElement.hidden = !open
  sftpToggle.textContent = open ? '收起文件' : '文件'
  safeFit()
  if (open && sessionId) void loadDirectory(sftpDir?.path ?? '.')
}

sftpToggle.addEventListener('click', () => {
  if (!sessionId) return
  setSftpOpen(sftpPanelElement.hidden)
})

/**
 * 面板上的每个动作都先过这一道。
 *
 * 正常路径下面板在没会话时是整片禁用的，走不到这里；但「按钮被禁用了」是**界面状态**，
 * 不该让领域调用去依赖它的正确性——漏禁一个按钮就会变成一次拿 undefined 当 sessionId
 * 的远端操作，而那种错误在对端看起来完全是另一回事。
 */
function currentSession(): string | null {
  if (sessionId) return sessionId
  sftpPanel.setHint('还没有连接，先连上一台主机。', 'err')
  return null
}

/**
 * 读一个目录画到面板上。返回这次读成功了没有——
 * 调用方（上传/新建/删除）要在「操作成功」和「刷新失败」之间说清楚哪个是真的。
 *
 * 失败时**把上一次的列表放回去**（`render(sftpDir)`）、只把错误写在提示里：
 * 手滑打错一个字不该把用户刚才看到的东西清掉，那要重新一层层点回去。
 */
async function loadDirectory(path: string): Promise<boolean> {
  const id = currentSession()
  if (!id) return false
  sftpPanel.setBusy(true)
  // 先画成「正在读」：远端目录可能是几百项、也可能是跨洋的，静悄悄转一会儿用户会以为卡了
  sftpPanel.render(null)
  sftpPanel.setHint(`正在读取 ${path} …`, 'pending')
  try {
    const dir = await api.sftp.list(id, path)
    sftpDir = dir
    sftpPanel.render(dir)
    return true
  } catch (error: unknown) {
    sftpPanel.render(sftpDir)
    sftpPanel.setHint(cleanError(error), 'err')
    return false
  } finally {
    sftpPanel.setBusy(false)
  }
}

async function downloadEntry(entry: SftpEntry): Promise<void> {
  const id = currentSession()
  if (!id) return
  // 上限在**点下去之前**就判：列表里本来就有大小，没必要白跑一趟、等一个文件传过来再被后端拒。
  // 上限和判据都取自协议里的同一个常量，两边的数字不可能对不上。
  if (entry.size > MAX_TRANSFER_BYTES) {
    sftpPanel.setHint(
      `「${entry.name}」有 ${formatBytes(entry.size)}，超过单次传输上限 ${formatBytes(MAX_TRANSFER_BYTES)}。` +
        `大文件先用终端里的 scp / rsync 取。`,
      'err',
    )
    return
  }
  sftpPanel.setBusy(true)
  sftpPanel.setHint(`正在下载 ${entry.name} …`, 'pending')
  try {
    const result = await api.sftp.read(id, entry.path)
    // 存盘由渲染层自己做（Blob 下载），所以桌面端和浏览器端是同一条路，
    // 文件都落在用户自己这台机器上——不会跑到后端那台去
    saveBytes(result.bytes, entry.name)
    sftpPanel.setHint(`已下载「${entry.name}」（${formatBytes(result.size)}）。`, 'ok')
  } catch (error: unknown) {
    sftpPanel.setHint(cleanError(error), 'err')
  } finally {
    sftpPanel.setBusy(false)
  }
}

async function uploadFile(file: File): Promise<void> {
  const id = currentSession()
  if (!id) return
  if (file.size > MAX_TRANSFER_BYTES) {
    sftpPanel.setHint(
      `「${file.name}」有 ${formatBytes(file.size)}，超过单次传输上限 ${formatBytes(MAX_TRANSFER_BYTES)}。` +
        `分块流式上传还没做，先换个小一点的文件。`,
      'err',
    )
    return
  }
  // 上传到**面板现在显示的那个目录**（不是用户自己填的路径）：所见即所得
  const dir = sftpDir?.path ?? '.'
  sftpPanel.setBusy(true)
  sftpPanel.setHint(`正在上传 ${file.name} 到 ${dir} …`, 'pending')
  try {
    const bytes = await readFileBytes(file)
    const result = await api.sftp.write(id, dir, file.name, bytes)
    const refreshed = await loadDirectory(dir)
    sftpPanel.setHint(
      refreshed
        ? `已上传「${file.name}」到 ${dir}（${formatBytes(result.size)}）。`
        : `「${file.name}」已经传上去了（${formatBytes(result.size)}），但列表没刷新成功。`,
      refreshed ? 'ok' : 'err',
    )
  } catch (error: unknown) {
    sftpPanel.setHint(cleanError(error), 'err')
  } finally {
    sftpPanel.setBusy(false)
  }
}

async function createFolder(name: string): Promise<void> {
  const id = currentSession()
  if (!id) return
  const dir = sftpDir?.path ?? '.'
  sftpPanel.setBusy(true)
  sftpPanel.setHint(`正在新建 ${dir}/${name} …`, 'pending')
  try {
    await api.sftp.mkdir(id, dir, name)
    const refreshed = await loadDirectory(dir)
    sftpPanel.setHint(
      refreshed ? `已新建目录「${name}」。` : `目录「${name}」建好了，但列表没刷新成功。`,
      refreshed ? 'ok' : 'err',
    )
  } catch (error: unknown) {
    sftpPanel.setHint(cleanError(error), 'err')
  } finally {
    sftpPanel.setBusy(false)
  }
}

async function deleteEntry(entry: SftpEntry): Promise<void> {
  const id = currentSession()
  if (!id) return
  // 远端删除不可恢复（不进回收站），所以必须问一句，并且把路径说全——
  // 在树状目录里删东西，「同名文件」是很常见的情况
  if (!window.confirm(`删除远端${entry.isDirectory ? '目录' : '文件'}「${entry.path}」？此操作不可恢复。`)) return
  sftpPanel.setBusy(true)
  sftpPanel.setHint(`正在删除 ${entry.path} …`, 'pending')
  try {
    await api.sftp.remove(id, entry.path)
    const refreshed = await loadDirectory(sftpDir?.path ?? '.')
    sftpPanel.setHint(
      refreshed ? `已删除「${entry.name}」。` : `「${entry.name}」删掉了，但列表没刷新成功。`,
      refreshed ? 'ok' : 'err',
    )
  } catch (error: unknown) {
    sftpPanel.setHint(cleanError(error), 'err')
  } finally {
    sftpPanel.setBusy(false)
  }
}

let resizeTimer = 0
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(safeFit, 80)
})

// ── 冒烟测试钩子（仅 ?smoke=1 时挂载）────────────────────────────

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function readTerminal(): string {
  const buffer = term.buffer.active
  const lines: string[] = []
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)
    if (line) lines.push(line.translateToString(true))
  }
  return lines.join('\n')
}

if (new URLSearchParams(window.location.search).get('smoke') === '1') {
  window.__smoke = {
    async run(config): Promise<SmokeReport> {
      const report: SmokeReport = {
        preload: typeof window.sshAPI,
        sessionId: null,
        openedSize: null,
        text: '',
        replacementChars: 0,
        closedReason: null,
        error: null,
      }
      try {
        const result = await api.open({ ...config, cols: 100, rows: 30, term: 'xterm-256color' })
        report.sessionId = result.sessionId
        report.openedSize = { cols: result.cols, rows: result.rows }
        await delay(800)
        api.input(result.sessionId, 'ls\r')
        await delay(400)
        api.resize(result.sessionId, 120, 40)
        await delay(200)
        const closed = new Promise<string>((resolve) => {
          closedHook = resolve
        })
        api.close(result.sessionId)
        report.closedReason = await Promise.race([closed, delay(1500).then(() => null)])
        await delay(250)
        report.text = readTerminal()
        report.replacementChars = (report.text.match(/\uFFFD/g) ?? []).length
      } catch (error) {
        report.error = cleanError(error)
      }
      return report
    },
  }
}

// ── 启动 ────────────────────────────────────────────────────────

// 先把凭据行摆正（默认密码认证），再去做任何异步的事
syncAuthRows()
updateButtons()

// 上报「应用真的可用」：preload 通了、IPC 能调、xterm 挂载了**并且已经量准尺寸**、
// 主机列表拉回来了。宿主用它做启动自检（npm run boot）和启动档案的提交闸门，
// 比 did-finish-load 可靠得多——后者只说明 HTML 解析完了。
//
// 顺序是有意的：先 settleLayout 再 refreshHosts，两条链串成一条，
// 否则上报可能带着还没量过的终端尺寸跑出去（见上面 settleLayout 的说明）。
void (async () => {
  try {
    capabilities = parseRuntimeCapabilities(await api.getCapabilities())
    rememberCheck.checked = capabilities.credentialPersistence === 'encrypted'
    credentialHint.hidden = capabilities.credentialPersistence !== 'session'
    syncAuthRows()
    // The Web credential notice changes the terminal's height; measure after it is visible.
    await settleLayout()
    await refreshHosts()
    setStatus('就绪')
    api.signalReady({ ok: true, hosts: hosts.length, cols: term.cols, rows: term.rows })
  } catch (error: unknown) {
    capabilities = null
    updateButtons()
    const message = cleanError(error)
    setStatus(message, 'err')
    api.signalReady({ ok: false, hosts: 0, cols: term.cols, rows: term.rows, error: message })
  }
})()

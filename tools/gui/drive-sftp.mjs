/**
 * PureTerm desktop 的桌面端端到端验证：远端文件（SFTP）。
 *
 * 为什么不塞进 `apps/desktop/tests/smoke-*.mjs`：这条路上有**三个原生模态窗口**——
 * 上传的文件选择框、下载的保存框、删除的 confirm。它们是操作系统的框
 * （或 Chromium 自己的模态层），不是页面的一部分，在进程内自动化里一点就卡死
 * （`smoke:electron` 里的钩子点一下「下载」就再也回不来了）。所以这一层只能外部驱动：
 * 页面内的动作走 CDP，模态窗口用 SendInput 填路径 / 敲回车。
 *
 * 两条纪律：
 *
 * ① **坐标不靠肉眼估**。所有点击目标都由页面自己用 getBoundingClientRect 量出来，
 *    再交给 CDP 的 Input.dispatchMouseEvent（走 Chromium 的命中测试），
 *    而不是 element.click()——后者会绕过「这个元素真的在鼠标底下吗」，
 *    而那正是「界面上看得见却点不动」这类问题的所在。
 *
 * ② **「模态窗口起来了」不靠猜**。同时看两个互相独立的信号：
 *      信号 A（操作系统那一侧）：顶层窗口名单里多出一个之前没有的 HWND；
 *      信号 B（页面那一侧）：渲染进程连续两次不回应求值——被模态层挡住时它就是这样。
 *    两个都等不到才判失败；收尾时要求两个都消失，才继续往下走。
 *
 * 断言方向也是两条线：**界面说成了** 与 **对端真的变成了那个样子**。
 * 只断言前者等于没测（界面可能只是乐观地写了句「已上传」）；
 * 只断言后者也等于没测（可能走的根本不是这条路）。两条都有，才算这条链是通的。
 *
 * 用法：
 *   node drive-sftp.mjs           跑完自己收尾（杀 Electron、删临时数据目录）
 *   node drive-sftp.mjs --keep    留着应用不杀，方便接着看现场
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeSshServer } from '../../apps/desktop/tests/fake-ssh-server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const ROOT = join(REPO_ROOT, 'apps', 'desktop')
const requireDesktop = createRequire(join(ROOT, 'package.json'))
const electronPath = process.env.PURETERM_ELECTRON || requireDesktop('electron')
const APP_MAIN = join(ROOT, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).main)
const SHOTS = join(HERE, 'shots')
const CAPTURE = join(HERE, 'capture.cjs')
const CROP = join(HERE, 'crop.py')
const DRIVE = join(HERE, 'drive.py')
const PYTHON = process.env.PURETERM_PYTHON || 'python'
const TITLE = process.env.PURETERM_WINDOW || 'SSH Cordis Client'
const DEBUG_PORT = 9333
const KEEP = process.argv.includes('--keep')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const show = (path) => String(path).replace(/\\/g, '/')

// ── 夹具 ────────────────────────────────────────────────────────

/** 256 个字节值各来一个：文本比对在它身上一定会漏，只有逐字节才说得清 */
const ALL_BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
const README = '第一行\n第二行\n'
const UPLOAD_NAME = '上传给我的.txt'
const UPLOAD_TEXT = '这是从本地传上去的内容。\n'
const NEW_FOLDER = '新建的目录'

/** 期望的列表顺序：目录在前，各自按小写名排 */
const EXPECTED_ORDER = 'data|empty-dir|notes|all-bytes.bin|latest|readme.txt|部署说明.md'

const results = []
let currentSection = ''
let cdp = null
let child = null
let server = null
let dataDir = ''
let workDir = ''
let uploadPath = ''
let downloadPath = ''
let screenSize = { w: 1920, h: 1080 }
const appLog = []

// ── 断言 ────────────────────────────────────────────────────────

function section(title) {
  currentSection = title
  console.log(`\n── ${title} ──`)
}

function check(name, ok, detail = '') {
  results.push({ section: currentSection, name, ok: !!ok, detail: ok ? '' : detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : `\n        ${detail}`}`)
}

// ── 入口 ────────────────────────────────────────────────────────

async function main() {
  server = await startFakeSshServer({
    files: {
      '/home/demo': null,
      '/home/demo/readme.txt': README,
      '/home/demo/部署说明.md': '# 部署\n\n带上这个文件。\n',
      '/home/demo/all-bytes.bin': ALL_BYTES,
      '/home/demo/notes': null,
      '/home/demo/notes/todo.md': '# 待办\n',
      '/home/demo/data': null,
      '/home/demo/empty-dir': null,
    },
    symlinks: { '/home/demo/latest': '/home/demo/notes/todo.md' },
  })
  console.log(`[e2e] 假 SSH 服务 127.0.0.1:${server.port}（${server.username}/${server.password}）`)

  dataDir = mkdtempSync(join(tmpdir(), 'cordis-e2e-data-'))
  workDir = mkdtempSync(join(tmpdir(), 'cordis-e2e-work-'))
  uploadPath = join(workDir, '上传给我的.txt')
  downloadPath = join(workDir, '下载回来的.bin')
  writeFileSync(uploadPath, UPLOAD_TEXT, 'utf8')

  // 用户真实的数据目录：整个脚本跑完必须和跑之前一模一样
  const REAL_DATA_DIR = join(homedir(), '.ssh-cordis')
  const realDataBefore = snapshotDir(REAL_DATA_DIR)

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.SSH_CORDIS_DATA_DIR = dataDir
  // 观察真实行为：不许替应用做开关决策，也不许因为环境而悄悄放宽沙箱
  env.SSH_CORDIS_NO_SANDBOX_FALLBACK = '1'

  const captureEnv = { ...process.env }
  delete captureEnv.ELECTRON_RUN_AS_NODE
  screenSize = JSON.parse(execFileSync(PYTHON, [DRIVE, 'screen'], { encoding: 'utf8' }))

  child = spawn(electronPath, [APP_MAIN, `--remote-debugging-port=${DEBUG_PORT}`], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  })
  child.stdout.on('data', (chunk) => appLog.push(String(chunk)))
  child.stderr.on('data', (chunk) => appLog.push(String(chunk)))

  let exitCode = 1
  try {
    await run({ captureEnv })
    exitCode = results.every((r) => r.ok) ? 0 : 1
  } catch (error) {
    check('GUI 验收流程完整执行', false, error instanceof Error ? error.message : String(error))
    console.log(`\n[e2e] 中断：${error instanceof Error ? error.message : String(error)}`)
    if (appLog.length) console.log(`[e2e] 应用输出：\n${appLog.join('').trim().slice(0, 2000)}`)
    exitCode = 1
  } finally {
    if (KEEP) {
      console.log(`[e2e] --keep：应用留着（pid ${child.pid}，调试端口 ${DEBUG_PORT}）`)
    } else {
      await shutdown()
    }
    const same = JSON.stringify(realDataBefore) === JSON.stringify(snapshotDir(REAL_DATA_DIR))
    check(`用户真实数据目录 ${show(REAL_DATA_DIR)} 一字未改`, same)
    if (results.some((r) => !r.ok)) exitCode = 1

    const passed = results.filter((r) => r.ok).length
    console.log(`\n[汇总] ${passed}/${results.length} 通过`)
    for (const item of results) if (!item.ok) console.log(`   ✗ [${item.section}] ${item.name}\n     ${item.detail}`)
    mkdirSync(SHOTS, { recursive: true })
    writeFileSync(
      join(SHOTS, 'e2e-sftp-state.json'),
      JSON.stringify({ passed, total: results.length, dataDir, workDir, results }, null, 2),
    )
    await server.close().catch(() => {})
    if (!KEEP) {
      rmSync(dataDir, { recursive: true, force: true })
      console.log(`[e2e] 临时数据目录已删；上传/下载用的样本留在 ${show(workDir)}`)
    }
    process.exit(exitCode)
  }
}

function snapshotDir(dir) {
  if (!existsSync(dir)) return null
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const info = statSync(join(dir, name))
      return `${name}:${info.size}:${Math.round(info.mtimeMs)}`
    })
}

async function shutdown() {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'pipe' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    /* 已经没了 */
  }
  await sleep(500)
}

// ── 主流程 ──────────────────────────────────────────────────────

async function run({ captureEnv }) {
  const page = await findTarget()
  console.log(`[e2e] 已连上调试端口：${page.url}`)
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  await waitFor(`!!document.getElementById('connect')`, '页面加载完成')
  await sleep(500)
  await focusApp()

  // ── 阶段零：连上假服务器 ──────────────────────────────────────
  section('阶段零 · 连上')
  await fill('#host', '127.0.0.1')
  await fill('#port', String(server.port))
  await fill('#user', server.username)
  await fill('#pass', server.password)
  await evaluate(`document.getElementById('remember').checked = false`)
  await click('#connect')
  await waitFor(`document.getElementById('status').className === 'ok'`, '连接成功')
  console.log(`[e2e] 状态栏：${await evaluate(`document.getElementById('status').textContent`)}`)
  check('连上之后「文件」按钮从灰变可用', !(await evaluate(`document.getElementById('sftp-toggle').disabled`)))

  // ── 阶段一：打开抽屉、列目录 ──────────────────────────────────
  section('阶段一 · 点「文件」→ 抽屉展开 → 列目录')
  check('初始状态抽屉是收起的', await evaluate(`document.getElementById('sftp').hidden === true`))
  await click('#sftp-toggle')
  await waitFor(`document.getElementById('sftp').hidden === false`, '抽屉展开')
  check('点「文件」之后抽屉展开了（说明那一下真的落在按钮上）', true)

  await waitFor(`document.querySelectorAll('#sftp-list .file-row').length > 0`, '目录内容渲染出来')
  const listed = await rows()
  const pathShown = await evaluate(`document.getElementById('sftp-path').value`)
  console.log(`[e2e] 路径条：${pathShown}`)
  for (const row of listed) {
    console.log(`       ${row.name.padEnd(18)} ${row.size.padStart(8)}  ${row.time}  [${row.actions.join(' ')}]`)
  }

  check('路径条显示的是 realpath 之后的绝对路径（请求的是 "."）', pathShown === '/home/demo', `实得「${pathShown}」`)
  check(
    '中文名、目录、文件、软链都出来了',
    listed.some((r) => r.name === '部署说明.md') && listed.some((r) => r.name === 'notes') && listed.some((r) => r.name === 'latest'),
    `实得 ${listed.map((r) => r.name).join('|')}`,
  )
  check('目录排在最前面，各自按名字排（软链跟着目标当文件排）', listed.map((r) => r.name).join('|') === EXPECTED_ORDER, `实得 ${listed.map((r) => r.name).join('|')}`)
  check('没有 . 和 ..（服务端是会给的，我们滤掉了）', !listed.some((r) => r.name === '.' || r.name === '..'))
  check('目录的大小显示「—」而不是 0', listed.find((r) => r.name === 'notes').size === '—')
  check(
    '目录行是「打开」、文件行是「下载」',
    listed.find((r) => r.name === 'notes').actions[0] === '打开' &&
      listed.find((r) => r.name === 'readme.txt').actions[0] === '下载',
    JSON.stringify(listed.map((r) => [r.name, r.actions])),
  )
  check('时间解成了年份而不是 1970（说明按秒解了）', /^20\d\d-/.test(listed.find((r) => r.name === 'readme.txt').time))
  check('每行的 data-path 是后端拼好的绝对路径', listed.every((r) => r.path.startsWith('/home/demo/')))
  check(
    '软链标了「链接」，而且类型跟着目标走（latest → 文件，主动作是「下载」）',
    listed.find((r) => r.name === 'latest').tags.includes('链接') &&
      listed.find((r) => r.name === 'latest').actions[0] === '下载',
    JSON.stringify(listed.find((r) => r.name === 'latest')),
  )
  check(
    '服务端侧：走的是真 SFTP（REALPATH / OPENDIR / READDIR 都在）',
    ['REALPATH', 'OPENDIR', 'READDIR'].every((name) => server.sftp.requests.includes(name)),
    `实得 ${[...new Set(server.sftp.requests)].join(',')}`,
  )
  await shot('s1-sftp-listed', { captureEnv })

  // ── 阶段二：进目录 / 回上级 ──────────────────────────────────
  section('阶段二 · 进目录、回上级')
  await clickRow('notes', 'open')
  await waitFor(`document.getElementById('sftp-path').value === '/home/demo/notes'`, '进入 notes')
  const inside = await rows()
  check('点「打开」真的进了子目录（路径条与列表都对）', inside.length === 1 && inside[0].name === 'todo.md', `实得 ${inside.map((r) => r.name).join('|')}`)
  check('在子目录里「上级」按钮是可用的', !(await evaluate(`document.getElementById('sftp-up').disabled`)))

  await click('#sftp-up')
  await waitFor(`document.getElementById('sftp-path').value === '/home/demo'`, '回到 home')
  check('点「上级」回到了 home', (await rows()).length === listed.length)

  // ── 阶段三：上传（原生文件选择框）───────────────────────────
  section('阶段三 · 上传（要过原生文件选择框）')
  const writesBefore = server.sftp.writes.length
  const uploadOk = await withModal('#sftp-upload', '上传的文件选择框', async ({ captureEnv: cap }) => {
    await shot('s2-upload-dialog', { captureEnv: cap, screen: true })
    const dialog = firstDialog()
    check('点「上传…」弹出的是操作系统的文件选择框（class #32770）', !!dialog, '系统里没找到 #32770 窗口')
    if (dialog) console.log(`[e2e] 对话框：${dialog.title || '(无标题)'}`)
    osKey('ctrl+a')
    osType(uploadPath)
    await sleep(300)
    osKey('enter')
  }, { captureEnv })

  if (uploadOk) {
    await waitFor(`/已上传「${UPLOAD_NAME}」/.test(document.getElementById('sftp-hint').textContent)`, '出现「已上传」提示')
    check('界面上说上传成功了', true)
    const after = await rows()
    check('上传之后列表里出现了这个文件', after.some((r) => r.name === UPLOAD_NAME), `实得 ${after.map((r) => r.name).join('|')}`)

    // 对端侧的证据：逐字节比，不比文本
    let remoteBytes = null
    try {
      remoteBytes = server.files.dataOf(`/home/demo/${UPLOAD_NAME}`)
    } catch (error) {
      check('服务端侧：远端真的多了这个文件', false, String(error))
    }
    if (remoteBytes) {
      const want = Buffer.from(UPLOAD_TEXT, 'utf8')
      check(
        '服务端侧：远端文件内容与本地逐字节一致',
        remoteBytes.equals(want),
        `远端 ${remoteBytes.length} 字节 / 本地 ${want.length} 字节`,
      )
      check('服务端侧：WRITE 真的发生过', server.sftp.writes.length > writesBefore, `实得 ${JSON.stringify(server.sftp.writes)}`)
    }
  }
  await shot('s3-sftp-uploaded', { captureEnv })

  // ── 阶段四：下载（原生保存框 + 逐字节比对）──────────────────
  section('阶段四 · 下载（要过原生保存框，且比对字节）')
  if (existsSync(downloadPath)) rmSync(downloadPath, { force: true })
  const downloadOk = await withModal(rowSelector('all-bytes.bin', 'download'), '下载的保存框', async ({ captureEnv: cap }) => {
    await shot('s4-save-dialog', { captureEnv: cap, screen: true })
    check('点「下载」弹出的是操作系统的保存框', !!firstDialog(), '系统里没找到 #32770 窗口')
    osKey('ctrl+a')
    osType(downloadPath)
    await sleep(300)
    osKey('enter')
  }, { captureEnv })

  if (downloadOk) {
    await waitFor(`/已下载「all-bytes.bin」/.test(document.getElementById('sftp-hint').textContent)`, '出现「已下载」提示')
    check('界面上说下载成功了', true)
    // 文件由浏览器写盘，落盘可能晚一点
    for (let i = 0; i < 30 && !existsSync(downloadPath); i += 1) await sleep(200)
    if (existsSync(downloadPath)) {
      const got = readFileSync(downloadPath)
      check(
        '落盘的字节与远端逐字节一致（256 个字节值一个不差）',
        got.equals(ALL_BYTES),
        `本地 ${got.length} 字节 / 远端 ${ALL_BYTES.length} 字节`,
      )
    } else {
      check('落盘的字节与远端逐字节一致', false, `没找到 ${show(downloadPath)}——保存框里填的路径没生效？`)
      const stray = join(homedir(), 'Downloads')
      if (existsSync(stray)) console.log(`[e2e] Downloads 里最近几项：${readdirSync(stray).slice(-6).join(', ')}`)
    }
    await shot('s5-sftp-downloaded', { captureEnv })
  }

  // ── 阶段五：新建文件夹（行内输入框）─────────────────────────
  section('阶段五 · 新建文件夹（行内输入框，不是 window.prompt）')
  await click('#sftp-mkdir')
  await waitFor(`document.getElementById('sftp-create').hidden === false`, '起名条展开')
  check('点「新建文件夹」后起名条展开、原按钮让位（同一件事不要两个入口）', await evaluate(`document.getElementById('sftp-mkdir').hidden === true`))
  check('起名输入框拿到了焦点（可以直接敲字）', await evaluate(`document.activeElement?.id === 'sftp-create-name'`))
  const mkdirsBefore = server.sftp.mkdirs.length
  await fill('#sftp-create-name', NEW_FOLDER)
  await key('Enter')
  await waitFor(`/已新建目录「${NEW_FOLDER}」/.test(document.getElementById('sftp-hint').textContent)`, '出现「已新建目录」提示')
  check('界面上说建好了', true)
  await waitFor(`document.getElementById('sftp-create').hidden === true`, '起名条收起')
  check('提交之后起名条自己收起来了', true)
  const afterMkdir = await rows()
  check('列表里出现了新目录，并且标了「目录」', afterMkdir.some((r) => r.name === NEW_FOLDER && r.tags.includes('目录')), `实得 ${afterMkdir.map((r) => r.name).join('|')}`)
  check('服务端侧：MKDIR 真的发生过', server.sftp.mkdirs.length > mkdirsBefore, `实得 ${JSON.stringify(server.sftp.mkdirs)}`)
  check(
    '服务端侧：名字是当成单独一段拼在目录后面的（不是把整条路径原样传下去）',
    server.sftp.mkdirs.at(-1) === `/home/demo/${NEW_FOLDER}`,
    `实得 ${server.sftp.mkdirs.at(-1)}`,
  )
  check('服务端侧：新建出来的是目录，不是文件', server.files.isDir(`/home/demo/${NEW_FOLDER}`))
  await shot('s6-sftp-mkdir', { captureEnv })

  // ── 阶段六：删除（window.confirm）───────────────────────────
  section('阶段六 · 删除（要过 confirm）')
  const removalsBefore = server.sftp.removals.length
  const deleteOk = await withModal(
    rowSelector(UPLOAD_NAME, 'delete'),
    '删除确认框',
    async ({ captureEnv: cap }) => {
      await shot('s7-delete-confirm', { captureEnv: cap, screen: true })
      osKey('enter')
    },
    { captureEnv },
  )

  if (deleteOk) {
    await waitFor(`/已删除「${UPLOAD_NAME}」/.test(document.getElementById('sftp-hint').textContent)`, '出现「已删除」提示')
    check('界面上说删掉了', true)
    const afterDelete = await rows()
    check('列表里那个文件没了', !afterDelete.some((r) => r.name === UPLOAD_NAME), `实得 ${afterDelete.map((r) => r.name).join('|')}`)
    check('服务端侧：REMOVE 真的发生过', server.sftp.removals.length > removalsBefore, `实得 ${JSON.stringify(server.sftp.removals)}`)
    check('服务端侧：远端那个文件真的不存在了', !server.files.exists(`/home/demo/${UPLOAD_NAME}`))
  }

  // 顺带验一条安全边界：删链接不能变成删它指向的东西
  const todoBefore = server.files.exists('/home/demo/notes/todo.md')
  const linkOk = await withModal(rowSelector('latest', 'delete'), '删除软链的确认框', async () => osKey('enter'), { captureEnv })
  if (linkOk) {
    await waitFor(`/已删除「latest」/.test(document.getElementById('sftp-hint').textContent)`, '软链删除提示')
    check(
      '删软链只删了链接本身，链接指向的文件还在',
      !server.files.exists('/home/demo/latest') && todoBefore && server.files.exists('/home/demo/notes/todo.md'),
      `latest=${server.files.exists('/home/demo/latest')} target=${server.files.exists('/home/demo/notes/todo.md')}`,
    )
  }
  await shot('s8-sftp-deleted', { captureEnv })

  // ── 阶段七：断开 ────────────────────────────────────────────
  section('阶段七 · 断开')
  await click('#disconnect')
  await waitFor(`document.getElementById('sftp').hidden === true`, '抽屉收起')
  check('断开后抽屉自动收起', true)
  check('断开后「文件」按钮变灰', await evaluate(`document.getElementById('sftp-toggle').disabled`))
  check('断开后面板被清空（不留上一次那份看起来还正常的列表）', await evaluate(`document.querySelectorAll('#sftp-list .file-row').length === 0`))
  check('断开后没有多开 SFTP 通道（整场只开过一条）', server.sftp.channels === 1, `实得 ${server.sftp.channels}`)
  await shot('s9-sftp-disconnected', { captureEnv })
}

/**
 * 点一个会弹模态窗口的东西，跑一段操作它的代码，再等它关掉。
 *
 * 三段都做成一个整体，是因为它们**必须**连在一起：中间任何一步失败，
 * 后面都不该再往里敲键——那时候焦点在哪没人知道，盲敲一个路径回车可能
 * 就打进应用的表单里去了。
 */
async function withModal(selector, description, body, { captureEnv }) {
  const before = windowIds()
  try {
    await focusApp()
    const rect = await rectOf(selector)
    fireClickAt(rect.x, rect.y)
    await waitForModal(before, description)
  } catch (error) {
    check(`${description}：没起来`, false, String(error))
    return false
  }
  try {
    await body({ captureEnv })
  } catch (error) {
    check(`${description}：操作它的时候出错`, false, String(error))
    // 出错了也把框收掉：留着它的话，后面每一步的键都会打进这个框里，
    // 报出来的错会离真正的原因越来越远
    osKey('esc')
  }
  const gone = await waitModalGone(description)
  if (!gone) check(`${description}：没关掉`, false, '还开着，后面的断言可能不准')
  return true
}

// ── CDP ─────────────────────────────────────────────────────────

async function findTarget(timeout = 40000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const targets = await response.json()
      const page =
        targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
        targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error(`等不到调试端口 ${DEBUG_PORT} 上的页面目标`)
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('open', () =>
      resolve({
        send(method, params, timeout = 20000) {
          const id = nextId++
          ws.send(JSON.stringify({ id, method, params }))
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              pending.delete(id)
              rej(new Error(`CDP ${method} 超时 ${timeout}ms（渲染进程可能被模态窗口挡住了）`))
            }, timeout)
            pending.set(id, {
              res: (value) => {
                clearTimeout(timer)
                res(value)
              },
              rej: (error) => {
                clearTimeout(timer)
                rej(error)
              },
            })
          })
        },
        /** 只发不等回应：点了就会弹模态窗口，等回应等于等它关掉 */
        fire(method, params) {
          ws.send(JSON.stringify({ id: nextId++, method, params }))
        },
        close: () => ws.close(),
      }),
    )
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.rej(new Error(message.error.message))
      else entry.res(message.result)
    })
  })
}

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(`页面里求值失败：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
  }
  return result.result.value
}

/** 求值，但允许超时：用来判「渲染进程还在不在回话」 */
async function evaluateQuiet(expression, timeout) {
  try {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, timeout)
    return { ok: true, value: result.result.value }
  } catch {
    return { ok: false }
  }
}

async function waitFor(expression, description, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(150)
  }
  throw new Error(`等不到：${description}`)
}

// ── 页面动作 ────────────────────────────────────────────────────

/** 元素中心的**视口坐标**。CDP 的输入事件就是按视口算的，不必换算屏幕坐标 */
async function rectOf(selector, nth = 0) {
  const rect = await evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})][${nth}]
    if (!node) return null
    const r = node.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return { zero: true }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  })()`)
  if (!rect) throw new Error(`找不到元素：${selector}（第 ${nth} 个）`)
  if (rect.zero) throw new Error(`元素尺寸为 0，点不到：${selector}`)
  return rect
}

function fireClickAt(x, y) {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: 1 }
  cdp.fire('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 })
  cdp.fire('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  cdp.fire('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
}

async function clickAt(x, y) {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: 1 }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
  await sleep(160)
}

async function click(selector, { nth = 0 } = {}) {
  const rect = await rectOf(selector, nth)
  await clickAt(rect.x, rect.y)
  return rect
}

/** SendInput 是往**当前焦点**敲的，不是往某个窗口敲的，所以先切前台 */
function osKey(combo) {
  execFileSync(PYTHON, [DRIVE, 'key', combo], { stdio: 'pipe' })
}

function osType(text) {
  execFileSync(PYTHON, [DRIVE, 'type', text], { stdio: 'pipe' })
}

/** 页面内的按键（不走 SendInput）：起名条的 Enter 就走这条 */
async function key(name) {
  if (name !== 'Enter') throw new Error(`没实现的按键：${name}`)
  const code = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...code })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...code })
  await sleep(200)
}

/** 往输入框里填值：先真点一下拿到焦点，再用 CDP 的 insertText */
async function fill(selector, text) {
  await click(selector)
  await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    node.focus()
    node.select?.()
    node.value = ''
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await cdp.send('Input.insertText', { text })
}

async function rows() {
  const raw = await evaluate(`JSON.stringify([...document.querySelectorAll('#sftp-list .file-row')].map((row) => ({
    name: row.querySelector('.file-name').textContent,
    size: row.querySelector('.file-size').textContent,
    time: row.querySelector('.file-time').textContent,
    tags: [...row.querySelectorAll('.tag')].map((t) => t.textContent),
    actions: [...row.querySelectorAll('.file-actions button')].map((b) => b.textContent),
    path: row.dataset.path,
  })))`)
  return JSON.parse(raw)
}

function rowSelector(name, act) {
  return `#sftp-list .file-row[data-path$="/${name}"] .file-actions button[data-act="${act}"]`
}

function clickRow(name, act) {
  return click(rowSelector(name, act))
}

// ── 顶层窗口 / 模态窗口 ─────────────────────────────────────────

function listWindows() {
  const out = execFileSync(PYTHON, [DRIVE, 'wins'], { encoding: 'utf8' })
  const list = []
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)x(\d+)\s+@(-?\d+),(-?\d+)\s*(.*)$/)
    if (m) list.push({ hwnd: m[1], w: Number(m[2]), h: Number(m[3]), x: Number(m[4]), y: Number(m[5]), title: m[6].trim() })
  }
  return list
}

function windowIds() {
  return new Set(listWindows().map((w) => w.hwnd))
}

function listDialogs() {
  return execFileSync(PYTHON, [DRIVE, 'dialogs'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

let lastDialogs = []
function firstDialog() {
  return lastDialogs.find((d) => d.title) ?? lastDialogs[0] ?? null
}

function focusApp() {
  try {
    execFileSync(PYTHON, [DRIVE, 'focus', TITLE], { stdio: 'pipe' })
  } catch {
    /* 窗口还没出来 */
  }
}

/**
 * 等模态窗口起来。三个判据依次放宽，任意一个成立就算：
 *   A 冒出了 Win32 标准对话框（#32770）——文件打开/保存框就是它，最硬的证据；
 *   B 渲染进程连续两次不回应求值——被模态层挡住时它就是这样；
 *   C 冒出了新顶层窗口、但既不是 #32770、渲染进程也没被挡住——留 1 秒确认它还在，
 *     就当它是模态层（Chromium 自己的对话框属于这一类），并把这条不确定性记下来。
 * 只看 A 会漏掉 Chromium 的模态层；只看 B 会把一次普通卡顿误判成对话框起来了。
 */
async function waitForModal(before, description, timeout = 20000) {
  const deadline = Date.now() + timeout
  let blockedStreak = 0
  let unclassifiedAt = 0
  while (Date.now() < deadline) {
    const added = [...windowIds()].filter((id) => !before.has(id))
    if (added.length) {
      const dialogs = listDialogs()
      if (dialogs.length) {
        lastDialogs = dialogs
        console.log(`[e2e] ${description}：冒出标准对话框「${dialogs.map((d) => d.title || '(无标题)').join(' / ')}」`)
        return 'dialog'
      }
      if (!unclassifiedAt) {
        unclassifiedAt = Date.now()
        console.log(`[e2e] ${description}：多了 ${added.length} 个非标准对话框的顶层窗口，确认一下是不是它`)
      } else if (Date.now() - unclassifiedAt > 1000) {
        lastDialogs = []
        console.log(`[e2e] ${description}：按「多出来的窗口就是模态层」处理（未分类，{}）`.replace('{}', added.join(',')))
        return 'window'
      }
    }
    const probe = await evaluateQuiet('1', 450)
    blockedStreak = probe.ok ? 0 : blockedStreak + 1
    if (blockedStreak >= 2) {
      lastDialogs = listDialogs()
      console.log(`[e2e] ${description}：渲染进程已被挡住（页面这一侧的证据）`)
      return 'blocked'
    }
    await sleep(80)
  }
  throw new Error(`点了之后没等到模态窗口：${description}`)
}

/** 等它关掉：要求新窗口没了**且**渲染进程重新回话 */
async function waitModalGone(description, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const probe = await evaluateQuiet('1', 800)
    if (probe.ok && listDialogs().length === 0) return true
    await sleep(200)
  }
  console.log(`[e2e] ${description}：似乎还开着`)
  return false
}

// ── 截图 ────────────────────────────────────────────────────────

function shot(name, { captureEnv, screen = false } = {}) {
  mkdirSync(SHOTS, { recursive: true })
  const windowRect = listWindows().find((w) => w.title.includes(TITLE))
  const width = screen ? screenSize.w : (windowRect?.w ?? 1120)
  const height = screen ? screenSize.h : (windowRect?.h ?? 740)
  const out = execFileSync(electronPath, [CAPTURE, SHOTS, screen ? '@screen' : TITLE, String(width), String(height), name], {
    stdio: 'pipe',
    env: captureEnv,
    timeout: 90000,
  })
  const raw = out.toString().trim()
  // capture.cjs 的第一行是「抓到「X」 WxH → 路径」，所以路径要按 '→' 取，不能整行当路径
  const file = raw.match(/→\s*(\S.*\.png)\s*$/m)?.[1]?.trim()
  if (!file) throw new Error(`没从 capture.cjs 的输出里认出截图路径：${raw}`)
  console.log(`     截图 → ${show(file)}`)

  // 整屏抓会把用户桌面上别的窗口一起拍进来（和这次验证无关，也没必要留在证据里）。
  // 裁到「应用窗口 ∪ 对话框」：既保留了「这是系统框、浮在应用上面」这层信息，又去掉了杂物。
  if (!screen) return
  const boxes = [windowRect, ...lastDialogs.map((d) => ({ x: d.rect[0], y: d.rect[1], w: d.rect[2] - d.rect[0], h: d.rect[3] - d.rect[1] }))]
    .filter(Boolean)
  if (!boxes.length) return
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  const pad = 18
  const cropped = execFileSync(
    PYTHON,
    [CROP, file, String(left - pad), String(top - pad), String(right - left + pad * 2), String(bottom - top + pad * 2)],
    { encoding: 'utf8' },
  ).trim()
  console.log(`     ${cropped}`)
}

await main()

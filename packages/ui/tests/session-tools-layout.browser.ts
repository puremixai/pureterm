import { HostError } from '@pureterm/protocol'

import { createClient } from '../src/client.js'

import { fixture } from './client-test-fixture.js'



/*
 * 真实样式下的终端工具栏。
 *
 * 生命周期夹具（client-lifecycle.browser.ts）把样式表剥掉，证明的是行为归属；
 * 这一支保留构建出来的 app.css、字体和真实 xterm，证明的是**画出来的几何**：
 * 图标栏是不是工作区里的一列、是不是 52px、开合换格时动不动、宽窄两种网格轴、
 * 面板主体是不是自己滚、真实终端有没有拿到正数尺寸。
 *
 * 它由 session-tools-layout-entry.mjs 在隔离 Electron 里按视口、主题、语言逐个调用。
 * 函数只读当前视口（window.innerWidth），不自己改窗口大小 —— 那件事归入口。
 */

const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message) }

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

const fill = (): void => {
  ;(element<HTMLInputElement>('host')).value = 'localhost'
  ;(element<HTMLInputElement>('user')).value = 'demo'
  ;(element<HTMLInputElement>('pass')).value = 'password'
}

async function until<T>(read: () => T | null | undefined, description: string, timeout = 5000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

export interface SessionToolsLayoutOptions { theme: 'dark' | 'light'; locale: 'en' | 'zh' }

/** 两个矩形在 1 CSS 像素内视为同一个位置；小数像素不该让断言翻车。 */
const sameBox = (a: DOMRect, b: DOMRect): boolean =>
  Math.abs(a.left - b.left) <= 1 && Math.abs(a.top - b.top) <= 1 &&
  Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1

const formatBox = (box: DOMRect): string =>
  `${box.left.toFixed(1)},${box.top.toFixed(1)} ${box.width.toFixed(1)}x${box.height.toFixed(1)}`

/** 计算值里 `grid-template-*` 没写出来时是 `none`，按一条轨道算。 */
const tracks = (value: string): number => {
  const trimmed = value.trim()
  return trimmed === '' || trimmed === 'none' ? 1 : trimmed.split(/\s+/).length
}

/**
 * 这一支全是几何断言，只报「动了」而不报动到哪儿，等于没法诊断。把布局视口一起带上：
 * client 比 inner 小就说明有滚动条挤进来了，scroll 超出 client 就是溢出。
 */
const layoutContext = (): string => {
  const root = document.documentElement
  return `inner=${window.innerWidth}x${window.innerHeight} client=${root.clientWidth}x${root.clientHeight} scroll=${root.scrollWidth}x${root.scrollHeight}`
}

export async function runSessionToolsLayoutChecks(options: SessionToolsLayoutOptions): Promise<string[]> {
  const checks: string[] = []
  const where = `${window.innerWidth}x${window.innerHeight} ${options.theme}/${options.locale}`
  const say = (text: string): string => `${text} @ ${where}`

  // 主题和语言是 chrome 服务从这一个键读的，所以先落盘再挂载。
  localStorage.setItem('pureterm.chrome', JSON.stringify({ theme: options.theme, locale: options.locale }))
  const app = fixture()
  // 不给 terminalFactory：这一支要的就是默认的真实 xterm。
  const client = createClient({ api: app.api })
  try {
    assert((await client.ready).ok, say('the client reached readiness'))
    await document.fonts.ready

    const terminal = client.context.clientTerminal
    const rail = element('session-tools')
    const workspace = element('session-workspace')
    const content = element('session-content')
    const primary = element('session-primary')
    const grip = element('session-grip')

    assert(workspace.contains(rail), say('the styled rail stays inside the terminal workspace'))
    assert(document.documentElement.dataset.theme === options.theme, say('the requested theme is on the root'))
    assert(document.documentElement.dataset.locale === options.locale, say('the requested locale is on the root'))

    // 工作区在有会话之前是 hidden 的，量到的会是一个 0×0 的盒子，所以先连上再量。
    fill()
    element('connect').click()
    await until(() => terminal.active?.state === 'connected', say('the session to connect'))
    await terminal.settleLayout()

    const connected = terminal.active!
    assert(connected.terminal.cols > 0 && connected.terminal.rows > 0,
      say(`the real terminal reports a positive size, got ${connected.terminal.cols}x${connected.terminal.rows}`))
    checks.push('a real xterm reports positive columns and rows')

    const collapsedRail = rail.getBoundingClientRect()
    assert(Math.abs(collapsedRail.width - 52) <= 1, say(`real CSS gives the rail 52px, got ${collapsedRail.width.toFixed(1)}`))
    assert(document.documentElement.scrollWidth <= window.innerWidth + 1,
      say(`the viewport has no outer horizontal overflow (${document.documentElement.scrollWidth} > ${window.innerWidth})`))

    const buttons = [...rail.querySelectorAll<HTMLElement>('.session-tool')]
    assert(buttons.length === 2, say(`the rail holds two tools, got ${buttons.length}`))
    for (const button of buttons) {
      const box = button.getBoundingClientRect()
      assert(Math.abs(box.width - 34) <= 1 && Math.abs(box.height - 34) <= 1,
        say(`a rail button is 34px square, got ${box.width.toFixed(1)}x${box.height.toFixed(1)}`))
    }
    checks.push('the styled rail is terminal-local, 52px wide, with two 34px buttons and no outer overflow')

    const narrow = window.innerWidth <= 820
    const collapsedPrimary = primary.getBoundingClientRect()

    element('sftp-toggle').click()
    await terminal.settleLayout()
    assert(!element('sftp').hidden, say('Files opens into the shared slot'))
    assert(grip.getAttribute('aria-orientation') === (narrow ? 'horizontal' : 'vertical'), say('the grip follows the active axis'))
    const grid = getComputedStyle(content)
    const columnTracks = tracks(grid.gridTemplateColumns)
    const rowTracks = tracks(grid.gridTemplateRows)
    assert(narrow ? columnTracks === 1 && rowTracks === 3 : columnTracks === 3 && rowTracks === 1,
      say(`the grid uses ${narrow ? 'rows' : 'columns'} (columns=${columnTracks}, rows=${rowTracks})`))
    assert(sameBox(collapsedRail, rail.getBoundingClientRect()),
      say(`the rail does not move when Files opens (${formatBox(collapsedRail)} -> ${formatBox(rail.getBoundingClientRect())}; ${layoutContext()})`))
    const filesPrimary = primary.getBoundingClientRect()
    if (narrow) assert(filesPrimary.height < collapsedPrimary.height - 1, say('a narrow panel takes height from the terminal'))
    else assert(filesPrimary.width < collapsedPrimary.width - 1, say('a wide panel takes width from the terminal'))
    assert(getComputedStyle(element('sftp-body')).overflowY === 'auto', say('the file body owns its own scroll'))
    assert(getComputedStyle(rail).overflow === 'hidden', say('the rail never scrolls with the panel'))
    checks.push('Files opens on the active axis, shrinks the terminal, and scrolls inside its own body')

    element('monitor-toggle').click()
    await terminal.settleLayout()
    assert(!element('session-monitor').hidden && element('sftp').hidden, say('Monitor replaces Files in the one slot'))
    assert(sameBox(collapsedRail, rail.getBoundingClientRect()),
      say(`the rail does not move when the tool switches (${formatBox(collapsedRail)} -> ${formatBox(rail.getBoundingClientRect())}; ${layoutContext()})`))
    assert(getComputedStyle(element('monitor-body')).overflowY === 'auto', say('the monitor body owns its own scroll'))
    checks.push('switching to Monitor keeps the rail in place and scrolls inside its own body')

    element('monitor-toggle').click()
    await terminal.settleLayout()
    assert(element('session-tool-panel').hidden && grip.hidden, say('collapsing hides the slot and the grip'))
    assert(sameBox(collapsedPrimary, primary.getBoundingClientRect()),
      say(`collapsing restores the terminal box (${formatBox(collapsedPrimary)} -> ${formatBox(primary.getBoundingClientRect())}; ${layoutContext()})`))
    checks.push('collapsing restores the terminal box and hides the slot and grip')

    // 展开／收起只是重新适配同一块 xterm，不能开第二条 SSH，也不能换终端对象。
    const sessionId = connected.sessionId
    const terminalView = connected.terminal
    element('sftp-toggle').click()
    await terminal.settleLayout()
    assert(connected.sessionId === sessionId && connected.terminal === terminalView,
      say('opening a tool preserves the session and the xterm'))
    assert(app.stats.opens === 1, say(`no tool switch opens another SSH session (opens=${app.stats.opens})`))
    const resizes = app.stats.resizes
    assert(resizes.length > 0, say('fitting the terminal reports a size to the session'))
    assert(resizes.every(entry => entry.sessionId === sessionId), say('every reported size belongs to the same session'))
    assert(resizes.every(entry => entry.cols > 0 && entry.rows > 0), say('every reported size is positive'))
    checks.push('expand/collapse refits the same session with no reconnect and no new terminal')

    // 键盘焦点要看得见。隐藏窗口里 document 没有焦点，Chromium 的 :focus / :focus-visible
    // 都不会命中（它以前提是文档聚焦），所以这里证明的是两件能证的事：按钮接得住焦点，
    // 以及**构建出来的样式表里那条可见焦点规则确实加载了、用的就是 --ring**。
    // 生命周期夹具剥掉了样式表，看不到这条规则；这条检查补的正是那一半。
    element('sftp-toggle').focus()
    assert(document.activeElement === element('sftp-toggle'), say('a rail button takes focus'))
    const focusRule = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      .find(rule => (rule as CSSStyleRule).selectorText === '.session-tool:focus-visible') as CSSStyleRule | undefined
    assert(!!focusRule, say('the styled sheet carries a :focus-visible rule for the rail button'))
    assert(focusRule.style.boxShadow.includes('--ring'), say('the focus rule draws the --ring token'))
    assert(getComputedStyle(document.documentElement).getPropertyValue('--ring').trim() !== '', say('the --ring token resolves in this theme'))
    checks.push('a rail button takes focus and the styled sheet draws its --ring focus ring')

    // 失败界面只在终端那一列里，永远盖不到图标栏。
    app.api.open = async () => { throw new HostError('ssh.connection-refused', { host: 'localhost', port: 22 }, 'connect ECONNREFUSED ::1:22') }
    element('workspace-home').click()
    element('host-new').click()
    fill()
    element('connect').click()
    const failure = await until(() => (element('connection-failure').hidden ? null : element('connection-failure')), say('the failure view to appear'))
    await terminal.settleLayout()
    const failureBox = failure.getBoundingClientRect()
    const railBox = rail.getBoundingClientRect()
    assert(failureBox.right <= railBox.left + 1,
      say(`the failure view stops before the rail (${failureBox.right.toFixed(1)} > ${railBox.left.toFixed(1)})`))
    assert(!rail.hidden, say('a failed tab still shows the rail'))
    assert(element<HTMLButtonElement>('sftp-toggle').disabled && element<HTMLButtonElement>('monitor-toggle').disabled,
      say('a failed tab disables the tools'))
    checks.push('the failure view stays inside the terminal column and never covers the rail')

    return checks
  } finally {
    await client.dispose()
  }
}

Object.assign(window, { runSessionToolsLayoutChecks })

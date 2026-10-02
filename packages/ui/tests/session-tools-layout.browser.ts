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

    const assertNoDocumentOverflow = (state: string): void => {
      const root = document.documentElement
      assert(root.scrollWidth <= window.innerWidth + 1 && root.scrollHeight <= window.innerHeight + 1,
        say(`${state} keeps scrolling inside the workspace (${layoutContext()})`))
    }
    const inside = (box: DOMRect, bounds: DOMRect): boolean =>
      box.width > 0 && box.height > 0 && box.left >= bounds.left - 1 && box.top >= bounds.top - 1 &&
      box.right <= bounds.right + 1 && box.bottom <= bounds.bottom + 1
    const assertReachable = (control: HTMLElement, state: string): void => {
      const box = control.getBoundingClientRect()
      assert(box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 &&
        box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1,
      say(`${state} keeps #${control.id} inside the viewport (${formatBox(box)})`))
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      assert(!!hit && control.contains(hit), say(`${state} leaves #${control.id} uncovered and reachable`))
    }
    const assertPreferences = (state: string): void => {
      for (const id of ['theme-toggle', 'density-toggle', 'locale-toggle']) {
        const control = element<HTMLButtonElement>(id)
        assertReachable(control, state)
        control.focus()
        assert(document.activeElement === control, say(`${state} allows keyboard focus on #${id}`))
      }
    }
    const assertHostColumns = (state: string): void => {
      const columns = element('host-columns')
      const row = document.querySelector<HTMLElement>('.host-row')!
      assert(!!row && getComputedStyle(columns).display !== 'none', say(`${state} has a saved host table`))
      const rowBox = row.getBoundingClientRect()
      const rowCenter = rowBox.top + rowBox.height / 2
      const headerCenter = columns.getBoundingClientRect().top + columns.getBoundingClientRect().height / 2
      for (let index = 0; index < 5; index += 1) {
        const header = columns.children[index] as HTMLElement
        const cell = row.children[index] as HTMLElement
        const headerVisible = getComputedStyle(header).display !== 'none'
        const cellVisible = getComputedStyle(cell).display !== 'none'
        assert(headerVisible === cellVisible, say(`${state} hides column ${index + 1} together with its heading`))
        if (!headerVisible) continue
        const headerBox = header.getBoundingClientRect()
        const cellBox = cell.getBoundingClientRect()
        assert(Math.abs(headerBox.left - cellBox.left) <= 1 && Math.abs(headerBox.width - cellBox.width) <= 1,
          say(`${state} aligns column ${index + 1} (${formatBox(headerBox)} / ${formatBox(cellBox)})`))
        assert(Math.abs(headerBox.top + headerBox.height / 2 - headerCenter) <= 1 &&
          Math.abs(cellBox.top + cellBox.height / 2 - rowCenter) <= 1,
        say(`${state} keeps column ${index + 1} on the same row instead of an implicit extra grid row`))
        assert(inside(cellBox, rowBox), say(`${state} keeps column ${index + 1} inside its saved host row`))
      }
      for (const action of row.querySelectorAll<HTMLElement>('[data-act]')) {
        assert(inside(action.getBoundingClientRect(), rowBox), say(`${state} keeps ${action.dataset.act} inside its action column`))
      }
    }

    const mainBox = element('main').getBoundingClientRect()
    assert(mainBox.height > window.innerHeight / 2 && mainBox.width > 0,
      say(`the workspace has a definite usable size (${formatBox(mainBox)})`))
    assert(inside(element('hosts-panel').getBoundingClientRect(), mainBox), say('the host library fits the workspace'))
    assertPreferences('host library')
    assertHostColumns('host library')
    assertNoDocumentOverflow('host library')
    checks.push('saved host headings and rows align without implicit columns or document overflow; preferences remain reachable')

    element('host-new').click()
    const editor = element('connection-workspace')
    // Measure the resting layout after the entry motion finishes.
    await Promise.all(editor.getAnimations().map(animation => animation.finished.catch(() => {})))
    const editorBox = editor.getBoundingClientRect()
    assert(inside(editorBox, element('main').getBoundingClientRect()) && editorBox.height >= mainBox.height - 1,
      say(`the editor occupies the workspace height and stays inside its bounds (${formatBox(editorBox)} within ${formatBox(element('main').getBoundingClientRect())})`))
    for (const id of ['connection-close', 'host-save', 'connect']) assertReachable(element(id), 'host editor')
    const fields = editor.querySelector<HTMLElement>('.drawer-scroll')!
    const footer = editor.querySelector<HTMLElement>('.drawer-footer')!
    const fieldsBox = fields.getBoundingClientRect()
    assert(fieldsBox.height > 0 && fieldsBox.bottom <= footer.getBoundingClientRect().top + 1,
      say('scrollable host fields leave the editor footer reachable'))
    assert(getComputedStyle(fields).overflowY === 'auto', say('host fields own their vertical scroll'))
    fields.scrollTop = fields.scrollHeight
    if (fields.scrollHeight > fields.clientHeight + 1) {
      assert(fields.scrollTop > 0, say('overflowing host fields can be scrolled inside the editor'))
    }
    assertPreferences('host editor')
    if (window.innerWidth > 900) assertHostColumns('docked host editor')
    assertNoDocumentOverflow('host editor')
    element('connection-close').click()
    assert(editor.hidden, say('the visible editor close action returns to the host library'))
    assert(sameBox(mainBox, element('main').getBoundingClientRect()), say('closing the editor preserves the workspace bounds'))
    checks.push('the host editor has bounded height, scrollable fields, reachable footer and close controls')

    // 工作区在有会话之前是 hidden 的，量到的会是一个 0×0 的盒子，所以先连上再量。
    fill()
    element('connect').click()
    await until(() => terminal.active?.state === 'connected', say('the session to connect'))
    await terminal.settleLayout()

    const connected = terminal.active!
    assertPreferences('terminal session')
    assertNoDocumentOverflow('terminal session')
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
    assert(inside(element('sftp').getBoundingClientRect(), workspace.getBoundingClientRect()),
      say(`Files stays inside the terminal workspace (${formatBox(element('sftp').getBoundingClientRect())} within ${formatBox(workspace.getBoundingClientRect())})`))
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
    assert(inside(element('session-monitor').getBoundingClientRect(), workspace.getBoundingClientRect()),
      say(`Monitor stays inside the terminal workspace (${formatBox(element('session-monitor').getBoundingClientRect())} within ${formatBox(workspace.getBoundingClientRect())})`))
    assert(sameBox(collapsedRail, rail.getBoundingClientRect()),
      say(`the rail does not move when the tool switches (${formatBox(collapsedRail)} -> ${formatBox(rail.getBoundingClientRect())}; ${layoutContext()})`))
    assert(getComputedStyle(element('monitor-body')).overflowY === 'auto', say('the monitor body owns its own scroll'))
    checks.push('switching to Monitor keeps the rail in place and scrolls inside its own body')

    grip.dispatchEvent(new KeyboardEvent('keydown', { key: narrow ? 'ArrowUp' : 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }))
    await terminal.settleLayout()
    assert(grip.getAttribute('aria-valuenow') === '47', say('the keyboard splitter moves the user ratio away from its default'))

    element('monitor-toggle').click()
    await terminal.settleLayout()
    assert(element('session-tool-panel').hidden && grip.hidden, say('collapsing hides the slot and the grip'))
    assert(sameBox(collapsedPrimary, primary.getBoundingClientRect()),
      say(`collapsing a user-adjusted split restores the terminal box (${formatBox(collapsedPrimary)} -> ${formatBox(primary.getBoundingClientRect())}; ${layoutContext()})`))
    assert(content.style.gridTemplateColumns === '' && content.style.gridTemplateRows === '',
      say('collapsing clears both inline grid axes'))
    assert(connected.split !== null, say('collapsing retains the tab\'s user ratio for reopening'))
    checks.push('collapsing a user-adjusted split restores the full terminal box and hides the slot and grip')

    // 展开／收起只是重新适配同一块 xterm，不能开第二条 SSH，也不能换终端对象。
    const sessionId = connected.sessionId
    const terminalView = connected.terminal
    element('sftp-toggle').click()
    await terminal.settleLayout()
    assert(grip.getAttribute('aria-valuenow') === '47', say('reopening restores the tab\'s user-adjusted ratio'))
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

type DragCheck = 'captured' | 'cancelled' | 'moved'
let liveResize: {
  check(): Promise<string[]>
  dragTarget(): { x: number; y: number }
  checkDrag(stage: DragCheck): Promise<string[]>
  dispose(): Promise<void>
} | null = null

/** Electron changes the viewport between checks while this Client stays mounted. */
async function startSessionToolsLiveResizeChecks(): Promise<string[]> {
  assert(liveResize === null, 'the live-resize fixture must start unmounted')
  localStorage.setItem('pureterm.chrome', JSON.stringify({ theme: 'dark', locale: 'en' }))
  const app = fixture()
  const client = createClient({ api: app.api })
  try {
    assert((await client.ready).ok, 'the live-resize client reached readiness')
    await document.fonts.ready
    fill()
    element('connect').click()
    const terminal = client.context.clientTerminal
    await until(() => terminal.active?.state === 'connected', 'the live-resize session to connect')
    await terminal.settleLayout()
    const connected = terminal.active!
    const sessionId = connected.sessionId
    const terminalView = connected.terminal
    element('sftp-toggle').click()
    await terminal.settleLayout()
    const grip = element('session-grip')
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }))
    await terminal.settleLayout()
    let ratio = connected.split!
    const focused = await until(() => document.getElementById('sftp-refresh'), 'the Files refresh control')
    focused.focus()
    assert(document.activeElement === focused, 'the Files control starts with keyboard focus')
    let previous: { box: DOMRect; cols: number; rows: number; resizes: number } | null = null
    let pointerId: number | null = null
    let dragStartRatio = ratio
    liveResize = {
      dispose: () => client.dispose(),
      dragTarget() {
        pointerId = null
        dragStartRatio = connected.split!
        grip.addEventListener('pointerdown', event => { pointerId = event.pointerId }, { once: true })
        const box = grip.getBoundingClientRect()
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
      },
      async checkDrag(stage) {
        if (stage === 'captured') {
          await until(() => pointerId !== null && grip.hasPointerCapture(pointerId), 'a real pointer drag to capture the splitter')
          return ['a real pointer drag captures the splitter']
        }
        assert(pointerId !== null, 'the pointer check follows a real pointerdown')
        await until(() => !grip.hasPointerCapture(pointerId!), 'the splitter to release pointer capture')
        if (stage === 'cancelled') {
          assert(connected.split === dragStartRatio, 'crossing the breakpoint cancels the old-axis drag before later pointer movement')
          return ['crossing the breakpoint releases capture and ignores movement from the old-axis drag']
        }
        await until(() => connected.split !== null && connected.split > dragStartRatio + 0.025,
          'a fresh pointer drag to move the separator on its new axis')
        ratio = connected.split!
        return ['a fresh drag on the new axis adjusts the split and releases capture on pointerup']
      },
      async check() {
        const where = `${window.innerWidth}x${window.innerHeight}`
        const narrow = window.innerWidth <= 820
        const content = element('session-content')
        const primary = element('session-primary')
        // Do not call settleLayout here: this check must observe automatic
        // ResizeObserver fitting and must not move focus into the terminal itself.
        await until(() => {
          const grid = getComputedStyle(content)
          return grip.getAttribute('aria-orientation') === (narrow ? 'horizontal' : 'vertical') &&
            tracks(grid.gridTemplateColumns) === (narrow ? 1 : 3) && tracks(grid.gridTemplateRows) === (narrow ? 3 : 1)
        }, `live ${where} to update the grid axis and separator orientation`)
        assert((narrow ? content.style.gridTemplateColumns : content.style.gridTemplateRows) === '',
          `live ${where} clears the stale inline grid axis`)
        assert(terminal.active === connected && connected.sessionId === sessionId && connected.terminal === terminalView && app.stats.opens === 1,
          `live ${where} preserves the tab, SSH session and xterm instance`)
        assert(connected.split === ratio && grip.getAttribute('aria-valuenow') === String(Math.round(ratio * 100)),
          `live ${where} preserves the user-selected split ratio`)
        const box = primary.getBoundingClientRect()
        const contentBox = content.getBoundingClientRect()
        const gripBox = grip.getBoundingClientRect()
        const actualRatio = narrow ? box.height / (contentBox.height - gripBox.height) : box.width / (contentBox.width - gripBox.width)
        assert(Math.abs(actualRatio - ratio) < 0.015, `live ${where} draws the remembered ratio (${actualRatio.toFixed(3)} vs ${ratio.toFixed(3)})`)
        const panelBox = element('sftp').getBoundingClientRect()
        assert(panelBox.left >= contentBox.left - 1 && panelBox.top >= contentBox.top - 1 &&
          panelBox.right <= contentBox.right + 1 && panelBox.bottom <= contentBox.bottom + 1,
        `live ${where} keeps Files inside the split content`)
        if (previous) {
          const before = previous
          await until(() => app.stats.resizes.length > before.resizes &&
            (Math.abs(box.width - before.box.width) < 1 || (box.width > before.box.width ? terminalView.cols > before.cols : terminalView.cols < before.cols)) &&
            (Math.abs(box.height - before.box.height) < 1 || (box.height > before.box.height ? terminalView.rows > before.rows : terminalView.rows < before.rows)),
          `live ${where} to automatically fit xterm to its changed width and height`)
        }
        assert(terminalView.cols > 0 && terminalView.rows > 0, `live ${where} has a positive terminal size`)
        const latest = app.stats.resizes.at(-1)!
        assert(latest.sessionId === sessionId && latest.cols === terminalView.cols && latest.rows === terminalView.rows,
          `live ${where} reports the fitted dimensions to the same SSH session`)
        // Include the existing 250ms layout fallback window when checking focus.
        await new Promise(resolve => setTimeout(resolve, 300))
        assert(document.activeElement === focused, `live ${where} keeps keyboard focus in Files after resize work settles`)
        assert(document.documentElement.scrollWidth <= window.innerWidth + 1 && document.documentElement.scrollHeight <= window.innerHeight + 1,
          `live ${where} has no document overflow`)
        previous = { box, cols: terminalView.cols, rows: terminalView.rows, resizes: app.stats.resizes.length }
        return [`live ${where} preserves the adjusted split, session and focus while switching grid axes and automatically fitting xterm`]
      },
    }
    return await liveResize.check()
  } catch (error) {
    liveResize = null
    await client.dispose()
    throw error
  }
}

async function checkSessionToolsLiveResize(): Promise<string[]> {
  assert(liveResize !== null, 'the live-resize fixture must be mounted')
  return liveResize!.check()
}

async function disposeSessionToolsLiveResize(): Promise<void> {
  const active = liveResize
  liveResize = null
  await active?.dispose()
}

function sessionToolsLiveDragTarget(): { x: number; y: number } {
  assert(liveResize !== null, 'the live-resize fixture must be mounted')
  return liveResize!.dragTarget()
}

async function checkSessionToolsLiveDrag(stage: DragCheck): Promise<string[]> {
  assert(liveResize !== null, 'the live-resize fixture must be mounted')
  return liveResize!.checkDrag(stage)
}

Object.assign(window, {
  runSessionToolsLayoutChecks, startSessionToolsLiveResizeChecks, checkSessionToolsLiveResize,
  disposeSessionToolsLiveResize, sessionToolsLiveDragTarget, checkSessionToolsLiveDrag,
})

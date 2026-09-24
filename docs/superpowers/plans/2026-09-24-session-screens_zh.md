# 会话屏实施计划（计划 5）

[English version](2026-09-24-session-screens.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。步骤用 checkbox（`- [ ]`）语法跟踪。

**Goal：** 把另外三份计划留给终端会话的那几样东西交给它 —— 一个可拖拽的终端/SFTP 分栏、一张带面包屑的四列远端文件表、一条点明死在哪一段的失败路线、给事件用的 toast，以及四种列表状态。

**Architecture：** 一切都留在 `@pureterm/ui` 之内。失败路线分类的是 Host 已经产出的*文本* —— `packages/host/src/services/ssh.ts:121` 的 `normalizeSshError` 早就判定了哪一段失败并用人话讲了出来；页面只是拿这段人话去对照一张表，绝不从网络上重新推导。本计划不碰任何 `@pureterm/protocol`、`@pureterm/host` 或 `@pureterm/transport` 文件，而规格里有一处提出的要求是现有契约表达不了的 —— 字节级的传输进度，而 `write(dir, name, bytes)` 与只有 `terminal:*` 的事件清单都载不动它 —— 这一处被记为一条更正，而不是被凭空造出来。

**Tech Stack：** CSS 自定义属性与网格、纯 DOM TypeScript、Cordis `Service` 插件、`packages/ui/tests/` 下的 `node:test` 守卫。

---

## 先读这个

计划 1-4 立下三个习惯，本计划必须接着往下带：

1. **不能失败的守卫就是装饰。** 每条新断言都要对一个故意弄坏的代码树跑一次，并且报告里要写它抓到了什么。计划 4 交付过一个停靠式编辑器，它连着两个提交都不可见，而那时候有 53 条绿色守卫 —— 因为守卫读的是 CSS 文本，布局错在运行时。
2. **量运行中的应用。** `npm run build && npm run start:web`，然后从活着的文档里读出几何。应用内浏览器的画面常常是 `visibilityState=hidden`，这意味着（a）截不到图，（b）过渡不会推进 —— 在读任何被过渡的属性之前，先注入 `*, *::before, *::after { transition: none !important }`。
3. **规格要的数据不存在时，就在提出这个要求的文档里说清楚。** 见 [本计划必须写下的更正](#corrections-this-plan-must-write)。

当前事实，全部在本计划起跑的那棵代码树上量出（`feat/ui-redesign` 的 `2818b3a`）：

- `packages/ui/src/styles/terminal.css` 是 63 行 / 5,283 字节。它给**一个元素带着两套布局机制**：`#sftp` 在 `:12` 是绝对定位的抽屉，在 `:53` 是网格子项。永远可能被看见的只有第二套，因为让这个面板显示出来的是 `.files-open`。
- `.session-content`（`:51`）是 `grid-template-rows: minmax(0, 1fr)`；`.files-open .session-content`（`:52`）是 `minmax(120px, 1fr) minmax(160px, 40%)`。分栏是竖向的、固定的，而那个 `40%` 是不属于任何 token 的字面量。
- 目标原型 `docs/superpowers/prototype/graphite-target.html` 把这条分栏画成**横向**的（`:187` 的 `cursor: col-resize`），规格说的「horizontal split」就是这个意思。本计划跟着原型走。
- 远端文件清单每行已经在渲染四个字段（`sftp-panel.ts:166-189`：名称 + 标签、大小、时间、操作），但没有列标题，而 `SftpEntry.mode`（`packages/protocol/src/protocol.ts:197`）被取回来了却从来没有显示。
- 失败路线是两个节点（`index.html:211-215`），而 `.failure-route-node`（`states.css:27`）不管连接停在哪一步，都给每一个节点染上 `--err`。
- `.failure-host .host-avatar` 是 `60px`（`states.css:18`）—— 在计划 4 把另外两处定成 20/58 之后，这是第三个头像尺寸 —— 而且它继承了 20px chip 的 `--r-1` 圆角。
- `.failure-route-node` 有 `border-radius: 999px`（`states.css:27`），一个阶梯之外的字面量，而 `--r-full` 就住在登记表里，只有一处引用。
- `--z-toast: 40`（`tokens.css:86`）没有消费方。`--t-1`、`--t-2`、`--t-3` 也没有。
- 今天的反馈是三个内联文本节点：连接表单里的 `#status`（`client-runtime.ts:61` 的 `status()`）、`#keychain-status`（`features/keychain.ts:253`）、`#sftp-hint`（`sftp-panel.ts:312`）。不存在 toast 原语。
- 已经有一个 `ResizeObserver` 在驱动 `fit()`（`services/terminal.ts:150`），所以尺寸变了的面板会自己重新适配。**不要加第二次 fit 调用。**
- 54 条 UI 守卫通过。`npm run test:unit` 用通配匹配 `packages/ui/tests/*.test.mjs`，所以新的守卫文件不需要改根脚本。

## 文件

```text
create  packages/ui/src/failure-diagnostics.ts     pure classifier: error text -> stage, node states, next step
create  packages/ui/src/services/toasts.ts         ClientToasts: the bottom-right notice queue
create  packages/ui/tests/failure-diagnostics.test.mjs
modify  packages/ui/src/styles/tokens.css          + --grip-w
modify  packages/ui/src/styles/terminal.css        split columns, grip, sftp table, breadcrumb
modify  packages/ui/src/styles/states.css          route nodes, skeleton, toast, avatar drift
modify  packages/ui/src/index.html                 #toasts mount, four route nodes
modify  packages/ui/src/sftp-panel.ts              mode column, header row, breadcrumb
modify  packages/ui/src/services/terminal.ts       route render, per-tab split, toast on state change
modify  packages/ui/src/features/hosts.ts          event notifications -> toast
modify  packages/ui/src/features/keychain.ts       event notifications -> toast
modify  packages/ui/src/features/sftp.ts           grip element, ratio, hint -> toast
modify  packages/ui/src/client.ts                  register ClientToasts
modify  packages/ui/tests/visual-contract.test.mjs  split, table, toast, route assertions
modify  packages/ui/tests/theme-sync.test.mjs      --grip-w joins the :root-only metric list
modify  packages/ui/tests/client-lifecycle.browser.ts
modify  docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md  (+ _zh)
modify  docs/superpowers/prototype/graphite-target.html
modify  docs/design-system.md  (+ _zh)
modify  CHANGELOG.md  (+ _zh)  then node scripts/convert-changelog.js
```

`packages/ui/src/styles/states.css` 是四个状态与 toast 的住处，因为规格自己的文件地图就这么写（`states.css — skeleton, four states, toast, dialog`）。保持这样，别去发明第十个分片：manifest 的顺序被一条测试钉着，而新增一个文件是一次级联决策，不是收拾房间。

---

## 任务 1：分栏变成两列

**文件：**
- 修改：`packages/ui/src/styles/tokens.css`（`:99` 的 `--insp-w` 之后）
- 修改：`packages/ui/src/styles/terminal.css:12` 与 `:51-53`
- 测试：`packages/ui/tests/visual-contract.test.mjs`

- [ ] **步骤 1：先写出会失败的断言**

加在 `packages/ui/tests/visual-contract.test.mjs` 第一个 `test(...)` 块里，紧接现有的 `#main` 轨道断言之后：

```js
  // The split is one mechanism. #sftp used to be an absolutely positioned drawer
  // AND a grid child of .session-content, and only the second one could ever be
  // seen — .files-open is what shows the panel at all.
  assert.match(css, /\.session-content\s*\{[^}]*grid-template-columns:/, 'the session content is a column grid')
  assert.match(css, /\.files-open \.session-content\s*\{[^}]*var\(--grip-w\)/, 'the grip is its own track, not an overlay on one')
  assert.doesNotMatch(css, /#sftp\s*\{[^}]*position:\s*absolute/, 'one element may not have two layout mechanisms')
```

- [ ] **步骤 2：运行它，确认失败**

运行：`node --test packages/ui/tests/visual-contract.test.mjs`
预期：FAIL 在 `the session content is a column grid`。

- [ ] **步骤 3：加上这个 token**

在 `packages/ui/src/styles/tokens.css` 里扩写 chrome 几何那一块，让那段注释仍然把五个值都描述进去：

```css
  /* Chrome geometry. --chrome-h is the height Electron's title-bar overlay is
     told to reserve, so theme-sync.test.mjs reads it as the single source.
     --insp-w is the docked editor: both the connection form and the key editor
     take it, so the two screens cannot drift to two different widths.
     --grip-w is the split handle between the terminal and the file table. It is
     a token because two things have to agree on it: the track, and the hit area
     that widens past it so a 5px bar is grabbable. */
  --chrome-h: 40px;
  --rail-w: 52px;
  --status-h: 24px;
  --insp-w: 322px;
  --grip-w: 5px;
```

- [ ] **步骤 4：重写 terminal 的三条规则**

在 `packages/ui/src/styles/terminal.css` 里删掉 `:12`（`#sftp { position: absolute; … }` 那条抽屉规则）与 `:53`（`.session-content #sftp { position: relative; … }`），然后把幸存的声明合进一条规则，并替换 `:51-52`：

```css
/* One rule, one mechanism: the file table is a column of .session-content and
   nothing else. The old drawer positioning stayed in the cascade long after
   .files-open started painting the same element into a grid track, so two blocks
   described one box and only one of them could win. */
#sftp { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; background: var(--c-surface); border-left: 1px solid var(--line); }
```

```css
.session-content { display: grid; flex: 1 1 auto; min-width: 0; min-height: 0; grid-template-columns: minmax(0, 1fr); }
/* 1.35fr : 1fr is the prototype's ratio (.term flex:1.35 against .sftp width:38%),
   restated in fr so the grip's 5px is subtracted before the split instead of
   after it. Task 2 lets the user move it; this is what they return to. */
.files-open .session-content { grid-template-columns: minmax(240px, 1.35fr) var(--grip-w) minmax(220px, 1fr); }
```

`minmax(240px, …)` / `minmax(220px, …)` 这两个下界，保证在任务 2 加上 JS 钳制之前，一次拖拽不会把某个面板压成一条读不出东西的窄缝。

在 `#sftp` 上设置 `display: flex` 对 `hidden` 是安全的，因为 `base.css:65` 带着 `[hidden] { display: none !important }`，而一条 `!important` 的、紧邻 UA 层的作者规则会压过任何普通声明，与特异性无关。同一个事实让两条现有规则成了累赘，而本任务正是删掉它们的合适位置 —— 一条重复全局规则的规则，后来读代码的人会默认它是承重的：

```bash
git grep -n "\[hidden\] { display: none" -- packages/ui/src/styles
```

删掉 `.connection-workspace[hidden]`（`inspector.css:12`）与 `.connection-failure[hidden]`（`states.css:14`）。`base.css` 里那条全局规则留下，它才是应该被搜得到的那条。

- [ ] **步骤 5：构建、跑守卫，然后看级联**

```powershell
npm run build
node --test packages/ui/tests/visual-contract.test.mjs
```

预期：BUILD-OK，然后两条测试都通过。

`assert.doesNotMatch(css, /#sftp\s*\{[^}]*position:\s*absolute/)` 就是防止这件事退回去的那条断言：`#sftp` 曾同时背着一套绝对定位的抽屉规则和一份网格子项覆盖，而两者里永远只有一个能把这个元素画出来。

- [ ] **步骤 6：把这个 token 登记为主题无关量**

`--grip-w` 是度量，而度量只住在 `:root` 里 —— `[data-theme="light"]` 与 `:root` 匹配同一个元素，所以把一个度量在浅色组里再写一遍，就会重新造出 token 系统本要消除的那份手工拷贝副本。把 `'--grip-w'` 加到 `packages/ui/tests/design-tokens.test.mjs:53` 里 `GLOBAL_TOKENS` 的 `--chrome-h`/`--rail-w`/`--status-h`/`--insp-w` 那一行。

把这件事买到什么、没买到什么说清楚：读取那份清单的测试（`design-tokens.test.mjs:79-82`）断言每一项存在于 `:root`、且不存在于浅色组。今天把 `--grip-w` 漏在外面不会让任何东西失败 —— 这个新 token 只是变成没人守着，而旧配色板正是这样攒出第二套手工拷贝的颜色的。加上它。

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：通过。

- [ ] **步骤 7：那个计划此前没有要求到的窄情形**

在步骤 5 之后对着运行中的应用量出来：在 447px 的视口里，两列各自落到自己的最小下界上，`240px + 5px + 220px = 465px`，比必须装下它们的那个窗口宽 18px —— 于是分栏在水平方向溢出了。而移除行布局时，没有任何东西补上规格本来为它留出的那个宽度（`Constraints` 5：「below 820 … SFTP stacks under the terminal」）。把它按行加回来，同时让把手仍然自占一轨，好让拖拽在换了轴向之后照样活着：

```css
/* Two columns at their minimum floors are 465px wide, so a narrow window cannot
   hold the split side by side — the same reason the spec puts the file table
   under the terminal below 820. The grip keeps its own track here so the drag
   still exists, it just moves along the other axis. */
@media (max-width: 820px) {
  .files-open .session-content { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(120px, 1.35fr) var(--grip-w) minmax(160px, 1fr); }
  .files-open #sftp { border-left: 0; border-top: 1px solid var(--line); }
}
```

并把它钉住，因为这个失败模式在桌面宽度下是无声的：

```js
  assert.match(css, /grid-template-rows:\s*minmax\(120px, 1\.35fr\) var\(--grip-w\) minmax\(160px, 1fr\)/, 'below 820 the file table stacks under the terminal')
```

用应用内浏览器给你的任意宽度重新量一次，并把两个轴向都报出来：实际生效的 `grid-template-columns` 必须塌成一条轨道，`gridTemplateRows` 必须显出 `…px 5px …px`，而 `scrollWidth` 必须等于 `clientWidth`。任务 2 会在这个宽度上给把手一个 `row-resize` 光标；在那之前，这根把手在手机上是沿错误的轴向移动的，这比溢出是一个更小的缺陷。

- [ ] **步骤 8：提交**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/src/styles/terminal.css packages/ui/src/styles/inspector.css packages/ui/src/styles/states.css packages/ui/src/styles/base.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): make the terminal and file table two columns"
```

只有在步骤 4 的那条注释把你派去查 `[hidden]` 规则时，才把 `base.css` 一起提交 —— 这个文件本身没有改动。

---

## 任务 2：把手、拖拽，以及一个活过标签切换的比例

**文件：**
- 修改：`packages/ui/src/services/terminal.ts:7-17`（`TerminalTab`）、`:171-210`（`createTab`）
- 修改：`packages/ui/src/features/sftp.ts:40-95`
- 修改：`packages/ui/src/styles/terminal.css`
- 测试：`packages/ui/tests/client-lifecycle.browser.ts`

这个元素住在 `ClientSftp` 里，因为那个服务本来就掌管文件表的开与关（`features/sftp.ts:49,92` 切换 `.files-open`）；而*比例*住在标签上，因为规格说它「persists for the session」，一次会话就是一个标签。

- [ ] **步骤 1：先写出会失败的行为测试**

在 `packages/ui/tests/client-lifecycle.browser.ts` 里，进入那个已经连上主机并打开文件的情景（搜 `sftp-toggle`），在表格已经打开之后追加：

```ts
    // The grip is a real separator: pointer drag changes the column template,
    // the ratio survives moving to another tab and back, and the keyboard gets
    // to the same place a mouse does.
    const grip = document.querySelector<HTMLElement>('.session-grip')!
    assert(grip.getAttribute('role') === 'separator', 'the grip must announce itself as a separator')
    assert(grip.getAttribute('aria-orientation') === 'vertical', 'a column split has a vertical separator')
    const template = () => getComputedStyle(document.querySelector('.session-content')!).gridTemplateColumns
    const before = template()
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    assert(template() !== before, 'ArrowLeft must move the split')
    const moved = template()
    click('hosts-tab')
    click(document.querySelector('[role="tab"]:not(#hosts-tab)')!.id)
    assert.equal(template(), moved, 'the ratio belongs to the session, not to the visible tab')
```

- [ ] **步骤 2：运行它，确认失败**

运行：`node packages/ui/tests/smoke-client-lifecycle.mjs`
预期：`[SMOKE-FAIL]` 在 `the grip must announce itself as a separator`。

- [ ] **步骤 3：把比例留在标签上，并在它移动时播报出来**

在 `packages/ui/src/services/terminal.ts` 里，把这个字段加进接口的 `logs` 旁边（`:16`），并在 `:204-205` 的 `createTab` 对象字面量里把它初始化：

```ts
  /** 终端与文件表的比例，0-1；null = 用 CSS 里的默认模板。跟着会话走，不进 localStorage。 */
  split: number | null
```

```ts
      sessionId: null, state: 'connecting', message: '正在连接…', logs: [], attempt: 0, split: null,
```

`ClientTerminal` 拥有标签，`ClientSftp` 拥有把手元素，所以边界是双向各一个事件、不做交叉注入 —— 这正是计划 4 在为 `client/host-counts` 试过直接注入、发现那是个环之后不得不退回的形状。加在 `fit()`（`:380`）旁边：

```ts
  /** 由 ClientSftp 的 grip 调用；null 表示回到 CSS 的默认模板。 */
  setSplit(ratio: number | null): void {
    if (!this.active) return
    this.active.split = ratio
    this.ctx.emit('client/split-change')
  }

  /** 当前会话的比例。没有活动会话时是 null，也就是默认值。 */
  get split(): number | null { return this.active?.split ?? null }
```

在已经载着 `'client/terminal-resize'` 与 `'client/host-counts'` 的那份 emitted-events 清单里声明 `'client/split-change'`。两者都已经接到 `sync()` 上（`features/sftp.ts:52-57`），而 `sync()` 正是唯一决定文件表到底开不开的地方 —— 所以 `paintSplit()` 从那里运行，不需要新的事件。本任务的草稿曾发出 `client/split-change`；执行时把它去掉了，因为一个只有 `ClientSftp` 自己既写又读的比例不必向全世界宣告，而每一个被声明的事件，都是后来的读者得多追一遍的东西。

- [ ] **步骤 4：在两个面板之间造出把手**

`.session-content` 没有 id（`index.html:194`），加一个就会让它成为 `ClientView.element()` 的承重件，所以透过它的第一子元素 `#terminal` 去够到它。在 `packages/ui/src/features/sftp.ts` 里，创建面板那段旁边：

```ts
const DEFAULT_SPLIT = 0.574

// ...inside the service:

  // 5px 是可见宽度；命中区靠 ::after 向两侧各伸出 4px（terminal.css），
  // 因为把元素本身做宽就会从终端那里吃掉 8px。
  private grip: HTMLElement | null = null

  private ensureGrip(): HTMLElement | null {
    if (this.grip) return this.grip
    const view = this.ctx.clientView
    const terminal = view.element('terminal')
    const element = view.document.createElement('div')
    element.className = 'session-grip'
    element.setAttribute('role', 'separator')
    // The attribute names the separator's own orientation: this one stands up
    // between two columns.
    element.setAttribute('aria-orientation', 'vertical')
    element.setAttribute('tabindex', '0')
    element.setAttribute('aria-label', '调整终端与文件表的宽度')
    // #sftp is already the second child of .session-content (index.html:195-196),
    // so "after #terminal" is the whole ordering problem: terminal → grip → sftp.
    terminal.after(element)
    this.grip = element
    this.bindGrip(element, terminal.parentElement as HTMLElement)
    return element
  }
```

在第一次用到 `view.element('sftp')` 的那个地方调用 `ensureGrip()`，并在每一次 `.files-open` 切换之后（`features/sftp.ts:49,92`）以及 `client/split-change` 上调用 `paintSplit()`。

- [ ] **步骤 5：拖拽与键盘**

两者都透过 `clientTerminal.setSplit()` 写入、再读回，所以标签是比例唯一的存放处。`DEFAULT_SPLIT` 是 `1.35fr` 对 `1fr` 再加那条 5px 轨道 —— 把原型的比例改写成一个数字，于是 `Home` 回到的正是 CSS 首绘时显示的那个位置。

```ts
  /** 拖到只剩一条缝是不行的：两侧各留一个最小宽度，与 CSS 的 minmax 下界一致。 */
  private setRatio(ratio: number): void {
    this.ctx.clientTerminal.setSplit(Math.min(0.78, Math.max(0.22, ratio)))
  }

  private paintSplit(): void {
    const content = this.grip?.parentElement
    if (!content) return
    const stored = this.ctx.clientTerminal.split
    const ratio = stored ?? DEFAULT_SPLIT
    if (this.grip) {
      const percent = Math.round(ratio * 100)
      this.grip.setAttribute('aria-valuenow', String(percent))
      this.grip.setAttribute('aria-valuemin', '22')
      this.grip.setAttribute('aria-valuemax', '78')
      this.grip.setAttribute('aria-valuetext', `终端占 ${percent}%`)
    }
    // 默认值不写内联样式，这样 CSS 的 minmax 模板仍然是唯一真相。
    content.style.gridTemplateColumns = stored === null
      ? ''
      : `minmax(240px, ${(ratio * 100).toFixed(3)}fr) var(--grip-w) minmax(220px, ${((1 - ratio) * 100).toFixed(3)}fr)`
  }

  private bindGrip(grip: HTMLElement, content: HTMLElement): void {
    let drag: { x: number; ratio: number; width: number } | null = null
    // scope.listen, not addEventListener: the service's scope releases every one
    // of these on dispose, which is what the lifecycle suite tests. Its listener
    // parameter is a bare Event, so the pointer handlers cast once at the edge.
    this.scope.listen(grip, 'pointerdown', (event) => {
      const pointer = event as PointerEvent
      drag = { x: pointer.clientX, ratio: this.ctx.clientTerminal.split ?? DEFAULT_SPLIT, width: content.getBoundingClientRect().width }
      grip.setPointerCapture(pointer.pointerId)
      event.preventDefault()
    })
    this.scope.listen(grip, 'pointermove', (event) => {
      if (!drag) return
      const pointer = event as PointerEvent
      this.setRatio(drag.ratio + (pointer.clientX - drag.x) / drag.width)
    })
    const release = (event: Event): void => {
      if (!drag) return
      drag = null
      grip.releasePointerCapture((event as PointerEvent).pointerId)
    }
    this.scope.listen(grip, 'pointerup', release)
    this.scope.listen(grip, 'pointercancel', release)
    // 只有鼠标能拖的分隔条对键盘用户不存在。步长 2%，Shift 10%，Home 回默认。
    this.scope.listen(grip, 'keydown', (event) => {
      const key = event as KeyboardEvent
      const ratio = this.ctx.clientTerminal.split ?? DEFAULT_SPLIT
      if (key.key === 'ArrowLeft') this.setRatio(ratio - (key.shiftKey ? 0.1 : 0.02))
      else if (key.key === 'ArrowRight') this.setRatio(ratio + (key.shiftKey ? 0.1 : 0.02))
      else if (key.key === 'Home') this.ctx.clientTerminal.setSplit(null)
      else return
      event.preventDefault()
    })
    this.ctx.on('client/split-change', () => this.paintSplit())
  }
```

`sftp.ts` 是一个 feature 作用域，所以 `this.scope` 本来就在 —— `features/hosts.ts:45-58` 绑定按钮用的就是同一个对象。**不要**给这个服务加一个 `DomListeners`：那个类是为每次渲染都重建的节点存在的（`sftp-panel.ts` 的那些行），而一根把手在作用域的一生里只绑定一次。

因为 `paintSplit()` 只由事件驱动，存下的比例与屏幕上的模板就不可能各说各话，而切到另一个标签会重绘那个标签自己的值 —— 这正是步骤 1 最后一条断言所测的东西。

- [ ] **步骤 6：把把手画出来**

在 `packages/ui/src/styles/terminal.css` 里：

```css
/* 5px wide, and the hit area is the ::after that hangs 4px past each side — so a
   pointer that lands on the terminal's edge still grabs, without the bar taking
   13px of the user's terminal. The handle is 26px of line, centred, and turns
   accent on hover or focus because an unfocused 5px bar is easy to miss entirely. */
.session-grip { position: relative; z-index: 2; cursor: col-resize; touch-action: none; background: var(--c-chrome); border-left: 1px solid var(--line); }
.session-grip::after { content: ''; position: absolute; inset: 0 -4px; border-radius: var(--r-1); }
.session-grip::before { content: ''; position: absolute; top: 50%; right: 1px; left: 1px; height: 26px; border-radius: var(--r-1); background: var(--line-strong); transform: translateY(-50%); transition: background-color var(--t-2) var(--ease); }
.session-grip:hover::before, .session-grip:focus-visible::before { background: var(--ac); }
.session-grip:focus-visible { outline: none; box-shadow: var(--ring); }
```

`var(--t-2)` 是 `160ms`，时长阶梯至此终于有了消费方。只有在任务 9 里把剩下的那些一并转换掉时，才删除这一处替换掉的四个 `180ms` 字面量 —— 见步骤 7。

- [ ] **步骤 7：让时长拿到自己的 token（这是计划 2 欠下的那一项）**

登记表里记着「曲线已经 token 化，而它旁边那个数字还在阶梯之外，离 `--t-2` 差 20ms」。把携带字面量的那四个分片清理掉，让阶梯之外的时长一条不剩：

```bash
git grep -n "1[68]0ms" -- packages/ui/src/styles
```

在 `base.css`、`hosts.css`、`inspector.css`、`terminal.css` 与 `keychain.css` 里，把每一处 `180ms` 与每一处 `160ms` 都换成 `var(--t-2)`。180 离 `--t-2` 是 20ms，离 `--t-3` 是 60ms，所以 `--t-2` 才是它当时伸手要够的那一档；它同时还让一行主机与一行密钥以同一个速度动效，而两档不同的时长会把它们悄悄拆成两半。十四处字面量就此消失，而 `styles/` 里唯一剩下的 `160ms` 就是 `--t-2` 自己的声明。运行 `node --test packages/ui/tests/*.test.mjs` —— 发丝线与颜色守卫不读时长，所以不该有东西失败，但 `docs/design-system.md` 里的字节数会变，任务 9 负责更新它们。

- [ ] **步骤 8：验证**

```powershell
npm run build
node packages/ui/tests/smoke-client-lifecycle.mjs
```

预期：`[SMOKE-OK]`。

- [ ] **步骤 9：提交**

```bash
git add packages/ui/src/services/terminal.ts packages/ui/src/features/sftp.ts packages/ui/src/styles/terminal.css packages/ui/src/styles/base.css packages/ui/src/styles/hosts.css packages/ui/src/styles/inspector.css packages/ui/src/styles/keychain.css packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): drag the terminal and file table apart, and tokenise the durations"
```

---

## 任务 3：远端文件清单变成一张四列表格

**文件：**
- 修改：`packages/ui/src/sftp-panel.ts:166-189` 以及拼装块 `:118-130`
- 修改：`packages/ui/src/styles/terminal.css:21-30`
- 测试：`packages/ui/tests/visual-contract.test.mjs`、`packages/ui/tests/client-lifecycle.browser.ts`

按规格，列是：Name、Size、Mode（八进制）、Modified。原型的比例是 `minmax(0,1fr) 62px 42px 74px`（`graphite-target.html:197`）；操作轨道是计划 4 的 `24px`；列标题取 `--tx-3` —— **不是**原型的 `--tx-4`，那条「只准出现在 `::placeholder`」的守卫现在会把它拒绝掉。

- [ ] **步骤 1：先写出会失败的断言**

```js
  assert.match(css, /\.file-columns,\s*\.file-row \{[^}]*minmax\(0,1fr\) 62px 42px 74px 24px/, 'the file header and its rows must share one template')
  assert.match(css, /\.file-mode/, 'mode is a column now, not an absent number')
```

以及生命周期套件里，那个已经列出某个目录的 SFTP 情景中：

```ts
    assert(document.querySelector('.file-row')!.children.length === 5, 'a file row is name, size, mode, modified, actions')
    assert(/^\d{3,4}$/.test(document.querySelector('.file-mode')!.textContent!.trim()), 'mode renders as octal digits')
```

- [ ] **步骤 2：运行它们，确认失败**

运行：`node --test packages/ui/tests/visual-contract.test.mjs && node packages/ui/tests/smoke-client-lifecycle.mjs`
预期：两边都失败 —— CSS 正则匹配不到，而行只有 4 个子元素。

- [ ] **步骤 3：把 mode 显示出来**

`SftpEntry.mode` 就是原始的 `attrs.mode`（`sftp-bridge.ts:455`），低 9 位是 `rwxrwxrwx`，而 **0 表示对端压根没发属性** —— 这跟 `000` 不是一回事。把这件事说出来，而不是印一个 `000`：

```ts
/** 对端没给属性时 mode 是 0（sftp-bridge.ts:455），那不是 000 权限，是「不知道」。 */
function octalMode(mode: number): string {
  if (!mode) return '—'
  return (mode & 0o7777).toString(8).padStart(3, '0')
}
```

- [ ] **步骤 4：把行重建成单元格**

在 `buildRow`（`sftp-panel.ts:166`）里，`.file-main` 继续充当名称单元格（它带着标签和 click/dblclick 处理器），并把三个数据单元格追加在操作 span 之前，照计划 4 对 `.host-row` 做过的那样：

```ts
    main.append(top)
    item.append(main)
    // 目录的大小没有意义（不是 0，是「不适用」），写 0 会让人以为它是空目录
    item.append(cell('file-size', entry.isDirectory ? '—' : formatBytes(entry.size)))
    item.append(cell('file-mode', octalMode(entry.mode)))
    item.append(cell('file-time', formatTime(entry.mtime)))
```

删掉那两行 `main.append(span('file-size', …))` / `main.append(span('file-time', …))`（`:181-182`），让这些字段变成行的子元素而不是按钮的 flex 子元素；并复用计划 4 的 `cell()` 助手 —— 从 `host-list.ts` 导出它，而不是抄一份：

```ts
// host-list.ts
export function cell(className: string, text: string, title?: string): HTMLSpanElement {
```

- [ ] **步骤 5：加上列标题行**

在拼装块里，`list`（`:118`）之前：

```ts
  const columns = document.createElement('div')
  columns.id = 'sftp-columns'
  columns.className = 'file-columns'
  columns.setAttribute('aria-hidden', 'true')
  for (const label of ['名称', '大小', '模式', '修改时间', '']) columns.append(document.createElement('span'))
```

并把它挂进 `#sftp-body`、`#sftp-list` 之上，让它和清单共用同一份 padding，做法与 `#host-columns` 完全一致：

```ts
  body.append(columns, list, hint)
```

无内容可显示时，让它跟着行一起隐藏 —— 还是计划 4 用过的那个 `:has()` 手法，挂在已有的 hint 元素上：

```css
#sftp-body:has(#sftp-hint:not([hidden])) #sftp-columns { display: none; }
```

- [ ] **步骤 6：那份模板**

在 `packages/ui/src/styles/terminal.css` 里，把 `.file-row`/`.file-main`/`.file-size`/`.file-time`（`:22-30`）换成共享模板的形状：

```css
/* Name, size, mode, modified, and the 24px action track — the hosts table's
   shape, so a user who has read one screen's table reads both. */
.file-columns,
.file-row { display: grid; grid-template-columns: minmax(0,1fr) 62px 42px 74px 24px; align-items: center; gap: 8px; padding: 0 10px; }
.file-columns { height: 26px; border: 1px solid transparent; border-bottom-color: var(--line-soft); color: var(--tx-3); font-size: var(--fs-micro); letter-spacing: .06em; text-transform: uppercase; }
.file-row { position: relative; min-width: 0; min-height: 28px; border: 1px solid transparent; border-radius: var(--r-3); transition: background-color var(--t-2) var(--ease), border-color var(--t-2) var(--ease); }
.file-row:hover { background: var(--overlay-hover); }
.file-main { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 0; border: 0; border-radius: var(--r-3); background: transparent; color: var(--tx-2); cursor: pointer; font-size: var(--fs-meta); text-align: left; user-select: none; }
.file-main:hover:not(:disabled) { border-color: transparent; background: transparent; }
.file-size, .file-time, .file-mode { min-width: 0; overflow: hidden; color: var(--tx-3); font-family: var(--font-mono); font-size: var(--fs-micro); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; text-overflow: ellipsis; }
.file-mode { text-align: left; }
.file-top { display: flex; min-width: 0; flex: 1 1 auto; align-items: center; gap: 6px; }
.file-name { overflow: hidden; color: var(--tx-1); text-overflow: ellipsis; white-space: nowrap; }
```

`.file-mode` 左对齐，因为 `755` 与 `600` 比的是形状而不是大小；真正按大小比较的数值（大小、时间）按规格的 `tabular-nums` 要求继续右对齐。

- [ ] **步骤 7：验证，然后当场量它**

```powershell
npm run build
node --test packages/ui/tests/visual-contract.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
```

预期：通过并且 `[SMOKE-OK]`。然后对着运行中的应用确认列标题与行的模板逐像素对得上，就像计划 4 的复查不得不做的那样：拿一个本地 SSH fixture、把文件表打开，运行

```js
// evaluate_script in the in-app browser, against http://127.0.0.1:<port>/?token=…
() => {
  const cols = document.getElementById('sftp-columns')
  const row = document.querySelector('.file-row')
  const t = (e) => getComputedStyle(e).gridTemplateColumns
  return JSON.stringify({ cols: t(cols), row: t(row), aligned: t(cols) === t(row), h: row.getBoundingClientRect().height })
}
```

把量到的对象报出来。`aligned: false` 是一个缺陷，不是一条四舍五入的说明 —— 它就在计划 4 的八条缺陷之中。

- [ ] **步骤 8：提交**

```bash
git add packages/ui/src/sftp-panel.ts packages/ui/src/host-list.ts packages/ui/src/styles/terminal.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): lay the remote file list out as a four-column table"
```

---

## 任务 4：加上面包屑，但不丢掉能敲路径的那个字段

**文件：**
- 修改：`packages/ui/src/sftp-panel.ts:285-289`（`render`）以及拼装块
- 修改：`packages/ui/src/styles/terminal.css`
- 测试：`packages/ui/tests/client-lifecycle.browser.ts`

`#sftp-path` 是一个有意留下的可供性 —— `sftp-panel.ts:77-78` 的注释写着，去 `/var/log` 不该先点十几下。所以本任务**新增**一条面包屑并保留那个输入框；不是拿一个去替换另一个。

- [ ] **步骤 1：写出会失败的测试**

```ts
    const crumbs = document.querySelector('.sftp-crumbs')!
    const parts = [...crumbs.querySelectorAll('button')].map(b => b.textContent)
    assert(parts.length >= 2 && parts[0] === '/', 'a breadcrumb starts at the root and names each hop')
    assert(parts.at(-1) === currentDirName, 'the last crumb is the directory you are in')
    crumbs.querySelectorAll('button')[1]!.click()
    await tick()
    assert(!pathInput.value.endsWith('//'), 'clicking a hop navigates to exactly that path')
```

- [ ] **步骤 2：运行它，确认失败**

运行：`node packages/ui/tests/smoke-client-lifecycle.mjs`
预期：`[SMOKE-FAIL]` 在 `a breadcrumb starts at the root`。

- [ ] **步骤 3：用服务器报回来的路径搭它**

`SftpDir.path` 是对端解析出的 **realpath**（`protocol.ts:201`），而 `.` 会带着主目录回来 —— 所以面包屑必须按返回的东西搭，绝不能按你索取的东西搭。在拼装块里：

```ts
  const crumbs = document.createElement('nav')
  crumbs.className = 'sftp-crumbs'
  crumbs.setAttribute('aria-label', '远端路径')
```

以及一个构建函数，在 `render()` 里紧接 `pathInput.value` 被赋值（`:287`）之后调用：

```ts
/** 段与段之间用 span 分隔，可点的段是 button：当前目录不可点，它已经是了。 */
function buildCrumbs(path: string): Node[] {
  const nodes: Node[] = []
  const segments = path.split('/').filter(Boolean)
  nodes.push(crumbButton('/', segments.length ? '/' : null))
  let walk = ''
  for (const [index, name] of segments.entries()) {
    walk += `/${name}`
    const target = walk
    if (index === segments.length - 1) nodes.push(span('sftp-crumb is-current', name))
    else nodes.push(crumbButton(name, target))
  }
  return nodes
}

function crumbButton(label: string, target: string | null): HTMLButtonElement | HTMLSpanElement {
  if (target === null) return span('sftp-crumb is-current', label)
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'sftp-crumb'
  element.textContent = label
  element.title = target
  listeners.add(element, 'click', () => handlers.onNavigate(target))
  return element
}
```

以及在 `render()` 里面：

```ts
      crumbs.replaceChildren(...(dir ? buildCrumbs(dir.path) : []))
      crumbs.hidden = !dir || dir.path === '/'
```

把它作为独立的一条横带挂上去，好让面板头部保住它那五个按钮：`root.append(head, crumbs, createBar, body)`（`:130`）。

- [ ] **步骤 4：把它画出来**

```css
/* A strip of its own rather than inside .panel-head: the head already holds five
   buttons and wraps them at 620px, and a breadcrumb that reflows between buttons
   is impossible to scan. Segments are mono because they are paths. */
.sftp-crumbs { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; min-width: 0; padding: 5px 10px; overflow-x: auto; border-bottom: 1px solid var(--line-soft); background: var(--c-canvas); font-family: var(--font-mono); font-size: var(--fs-micro); scrollbar-width: thin; }
.sftp-crumbs[hidden] { display: none; }
button.sftp-crumb { min-height: 20px; padding: 0 4px; border-color: transparent; border-radius: var(--r-1); background: transparent; color: var(--tx-3); font-family: inherit; font-size: inherit; }
button.sftp-crumb:hover:not(:disabled) { border-color: transparent; background: var(--c-control); color: var(--tx-1); }
.sftp-crumb + .sftp-crumb::before { content: '/'; margin-right: 2px; color: var(--tx-3); }
.sftp-crumb.is-current { color: var(--tx-1); font-weight: 500; }
```

- [ ] **步骤 5：验证并提交**

```powershell
npm run build
node packages/ui/tests/smoke-client-lifecycle.mjs
```

```bash
git add packages/ui/src/sftp-panel.ts packages/ui/src/styles/terminal.css packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): add a breadcrumb to the remote file table"
```

---

## 任务 5：从 Host 已经写下的那条错误里读出阶段

**文件：**
- 新建：`packages/ui/src/failure-diagnostics.ts`
- 测试：`packages/ui/tests/failure-diagnostics.test.mjs`

规格的决定（`specs/…-frontend-professional-redesign.md:141-145`）是分类发生在页面里，这个特性留在 `@pureterm/ui` 之内。这行得通，因为 `normalizeSshError`（`packages/host/src/services/ssh.ts:121-184`）已经用人话点出了阶段，而它的输出被 `apps/desktop/tests/smoke-host.mjs:38,53,94,97` 钉着 —— 于是页面可以拿它们去对照一份已有测试守卫着的契约。原始错误码仍会从兜底路径进来（`:183` 把 ssh2 说什么都原样包起来），所以这张表既对得上那句中文，也对得上产出它的那个码。

**逐字的 Host 句子**，从源码抄来而不是转述 —— 错一个字就是一次静默漏判，而这正是 `ssh.ts:117-119` 那条文档注释警告的失败：

| 阶段 | Host 输出 |
| --- | --- |
| `local` | `主机地址不能为空。` `用户名不能为空。` `缺少认证凭据：填密码、选私钥文件，或让 ssh-agent 先加载好密钥。` `客户端已断开连接。` |
| `address` | `无法解析主机名 …` |
| `tcp` | `无法连接 …：目标端口拒绝连接…` `连接 … 超时：网络不可达，或端口被丢弃。` `与 … 的连接被重置。` |
| `handshake` | `SSH 连接在握手完成前已关闭。` `… 的 TCP 连接建立了，但对方在送出 SSH 横幅之前就断开了。` |
| `keyexchange` | `主机密钥已改变，可能是中间人攻击。…` `主机密钥校验失败：…` `Unable to negotiate` / `no matching` / `invalid algorithm` / `kex identities` |
| `auth` | `认证失败：用户名、密码或私钥不正确。` `这把私钥有口令保护…` `这个文件不是可识别的私钥…` `私钥无法解析：…` `Permission denied` / `All configured authentication methods failed` |
| `session` | `… 连上了、登录也成功了，但这台服务器没能开起 SFTP 子系统。` `Unable to start subsystem` / `establishing SFTP session` / `Channel open failure` |

- [ ] **步骤 1：写出会失败的测试**

`packages/ui/tests/failure-diagnostics.test.mjs`：

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnose, STAGES } from '../src/failure-diagnostics.ts'

// Every sentence in this table is copied from packages/host/src/services/ssh.ts
// (normalizeSshError, :121-184) or from ssh2's own wording on the fallback path
// at :183. They are the contract: smoke-host.mjs pins the Chinese half, and a
// reworded host message is supposed to fail here so the route cannot go stale
// quietly.
const CASES = [
  ['无法解析主机名 jump.example.com。', 'address'],
  ['无法连接 10.0.0.7:22：目标端口拒绝连接（服务未启动或被防火墙拦截）。', 'tcp'],
  ['连接 10.0.0.7:22 超时：网络不可达，或端口被丢弃。', 'tcp'],
  ['与 10.0.0.7:22 的连接被重置。', 'tcp'],
  ['SSH 连接在握手完成前已关闭。', 'handshake'],
  ['10.0.0.7:22 的 TCP 连接建立了，但对方在送出 SSH 横幅之前就断开了。', 'handshake'],
  ['主机密钥已改变，可能是中间人攻击。', 'keyexchange'],
  ['Unable to negotiate with 10.0.0.7 port 22: no matching key exchange method.', 'keyexchange'],
  ['认证失败：用户名、密码或私钥不正确。', 'auth'],
  ['这把私钥有口令保护，请在「私钥口令」里填上。', 'auth'],
  ['Permission denied (publickey).', 'auth'],
  ['10.0.0.7:22 连上了、登录也成功了，但这台服务器没能开起 SFTP 子系统。', 'session'],
  ['Unable to start subsystem: sftp', 'session'],
  ['主机地址不能为空。', 'local'],
  ['缺少认证凭据：填密码、选私钥文件，或让 ssh-agent 先加载好密钥。', 'local'],
]

test('every host-classified failure names the stage that produced it', () => {
  for (const [message, stage] of CASES) {
    assert.equal(diagnose(message).stage, stage, `misclassified: ${message}`)
  }
})

test('an unknown failure collapses the route instead of guessing', () => {
  const result = diagnose('10.0.0.7:22 连接失败：something nobody has seen before')
  assert.equal(result.stage, null)
  assert.deepEqual(result.nodes, ['failed'])
  assert.equal(result.breakAt, -1)
})

test('a classified failure marks what passed and what was never reached', () => {
  const auth = diagnose('认证失败：用户名、密码或私钥不正确。')
  assert.equal(auth.nodes.length, STAGES.length - 1)
  assert.equal(auth.breakAt, STAGES.indexOf('auth'))
  for (const [message, stage] of CASES) {
    const result = diagnose(message)
    assert.match(result.suggestion, /\S/, `${stage} needs a next step, not a shrug`)
    assert.ok(result.suggestion.length <= 120, `${stage}'s suggestion is a lecture: ${result.suggestion}`)
  }
})
```

- [ ] **步骤 2：运行它，确认失败**

运行：`node --test packages/ui/tests/failure-diagnostics.test.mjs`
预期：FAIL —— `Cannot find module …/failure-diagnostics.ts`。

- [ ] **步骤 3：写出这个模块**

`packages/ui/src/failure-diagnostics.ts`：

```ts
export const STAGES = ['local', 'address', 'tcp', 'handshake', 'keyexchange', 'auth', 'session'] as const
export type Stage = (typeof STAGES)[number]

export interface Failure {
  /** null = 认不出来，此时路线塌成一个节点而不是猜一段。 */
  stage: Stage | null
  /** 画出来那几个节点：'passed' 走过了，'failed' 死在这里，'pending' 没走到。 */
  nodes: Array<Stage | 'failed'>
  /** 断点画在哪条连线上；-1 表示整条路线塌了。 */
  breakAt: number
  title: string
  suggestion: string
}

const KNOWN: Array<{ test: RegExp; stage: Stage; title: string; suggestion: string }> = [
  { test: /主机地址不能为空|用户名不能为空|缺少认证凭据/, stage: 'local', title: '还没开始连', suggestion: '先把地址、用户名和一种凭据填齐。' },
  { test: /客户端已断开连接/, stage: 'local', title: '这次连接被取消了', suggestion: '换了标签页或超时会导致这个；再点一次「重新连接」。' },
  { test: /无法解析主机名|ENOTFOUND|EAI_AGAIN/, stage: 'address', title: '域名没解析出来', suggestion: '检查拼写；这台机器解析不了的话，试试直接用 IP。' },
  { test: /目标端口拒绝连接|ECONNREFUSED/, stage: 'tcp', title: '端口没人听', suggestion: '确认 sshd 在跑、端口号对，以及安全组放通了它。' },
  { test: /超时|ETIMEDOUT|Timed out/, stage: 'tcp', title: '端口被丢弃', suggestion: 'TCP 一直没应答：通常是防火墙丢包或 IP 不可达。' },
  { test: /连接被重置|Socket closed|ECONNRESET/, stage: 'tcp', title: '连接被中断', suggestion: '对端或中间设备掐断了连接；隔几秒重试一次。' },
  { test: /握手完成前|送出 SSH 横幅之前|Connection lost before handshake/, stage: 'handshake', title: '握手前就被断开', suggestion: '这一步与密钥无关。常见原因是这个端口跑的不是 SSH 服务。' },
  { test: /主机密钥已改变|Host verification failed|Host key verification failed/, stage: 'keyexchange', title: '主机密钥与记录不符', suggestion: '可能是中间人攻击。确认服务器确实重装或换过密钥后再清除记录。' },
  { test: /Unable to negotiate|no matching|invalid algorithm|kex identities/, stage: 'keyexchange', title: '算法协商不上', suggestion: '双方没有共同的密钥交换或加密算法；升级服务端 openssh。' },
  { test: /认证失败|Permission denied|All configured authentication methods failed/, stage: 'auth', title: '认证被拒', suggestion: '用户名与密码/私钥的配对不对。注意很多服务器禁止 root 用密码登录。' },
  { test: /口令|passphrase|Cannot parse privateKey|privateKey|Decryption failed|Unsupported key format/, stage: 'auth', title: '私钥用不了', suggestion: '加密私钥要给口令；格式不支持就重新导出一份 OpenSSH 格式的私钥。' },
  { test: /SFTP 子系统|Unable to start subsystem|establishing SFTP session|Channel open failure/, stage: 'session', title: 'SFTP 开不起来', suggestion: '登录本身是好的，终端可以继续用；sshd_config 里的 Subsystem sftp 可能被关掉了。' },
]

const LABEL: Record<Stage, string> = {
  local: '本机', address: '解析', tcp: 'TCP', handshake: '横幅', keyexchange: '密钥交换', auth: '认证', session: '会话',
}

export function stageLabel(stage: Stage): string { return LABEL[stage] }

export function diagnose(message: string): Failure {
  const hit = KNOWN.find((entry) => entry.test.test(message))
  if (!hit) return { stage: null, nodes: ['failed'], breakAt: -1, title: '连接失败', suggestion: '' }
  const index = STAGES.indexOf(hit.stage)
  const nodes = STAGES.slice(0, index + 1).map((stage, position) => (position === index ? 'failed' : stage))
  return { stage: hit.stage, nodes, breakAt: index, title: hit.title, suggestion: hit.suggestion }
}
```

- [ ] **步骤 4：跑这条测试**

运行：`node --test packages/ui/tests/failure-diagnostics.test.mjs`
预期：PASS，三条测试。

- [ ] **步骤 5：证明这条守卫能失败**

临时改掉表里的一条，让 `无法解析主机名` 不再匹配，跑测试，确认它报出 `misclassified: 无法解析主机名 jump.example.com。`。然后改回去。在提交信息里记下这一步做过 —— 计划 4 的复查发现，一条红不起来的绿守卫一文不值，而这个文件的全部价值就是这张表。

- [ ] **步骤 6：提交**

```bash
git add packages/ui/src/failure-diagnostics.ts packages/ui/tests/failure-diagnostics.test.mjs
git commit -m "feat(ui): classify connection failures by the stage the host named"
```

---

## 任务 6：画出四个节点，并说出它停在哪一步

**文件：**
- 修改：`packages/ui/src/index.html:211-215`
- 修改：`packages/ui/src/services/terminal.ts:262-284`（`render`）与 `:305-345`
- 修改：`packages/ui/src/styles/states.css:18,23-29`
- 测试：`packages/ui/tests/visual-contract.test.mjs`、`packages/ui/tests/client-lifecycle.browser.ts`

- [ ] **步骤 1：先写出会失败的断言**

```js
  assert.match(html, /class="failure-route"[^>]*aria-hidden="true"/, 'the route is decoration alongside text, not a second announcement')
  assert.match(css, /\.failure-route-node\.is-failed/, 'the route must be able to mark one node')
  assert.match(css, /\.failure-route-line\.is-break/, 'and break the link where it died')
  assert.doesNotMatch(css, /\.failure-route-node\s*\{[^}]*var\(--err\)/, 'no node may be red just for existing')
  assert.match(css, /\.failure-host \.host-avatar\s*\{[^}]*var\(--r-4\)/, 'a 58px avatar does not take the 20px chip corner')
  assert.doesNotMatch(css, /border-radius:\s*999px/, '--r-full exists; do not re-invent it')
```

以及生命周期套件里，`client-lifecycle.browser.ts:330-342` 那个已经抛出 `'fixture connection refused'` 的情景：

```ts
    const nodes = [...document.querySelectorAll('.failure-route-node')]
    assert(nodes.length > 2, 'a classified failure shows the route, not one dot')
    assert.equal(nodes.filter(n => n.classList.contains('is-failed')).length, 1, 'exactly one node failed')
    assert(nodes.indexOf(nodes.find(n => n.classList.contains('is-failed'))!) === 2, 'ECONNREFUSED is the TCP node')
    assert.match(document.getElementById('failure-suggestion')!.textContent!, /sshd/, 'the page says what to do next')
```

- [ ] **步骤 2：运行它们，确认失败**

运行：`node --test packages/ui/tests/visual-contract.test.mjs`
预期：FAIL 在 `the route must be able to mark one node`。

- [ ] **步骤 3：标记**

`index.html:211-215` 变成一个静态的四节点骨架，由页面往里填 —— 静态是为了页面永远不会渲染出一条空带，`aria-hidden` 是因为下面还用文字把阶段说了一遍：

```html
              <div class="failure-route" aria-hidden="true">
                <span class="failure-route-node" data-stage="local"><i class="ti ti-device-laptop"></i></span>
                <span class="failure-route-line"></span>
                <span class="failure-route-node" data-stage="tcp"><i class="ti ti-plug"></i></span>
                <span class="failure-route-line"></span>
                <span class="failure-route-node" data-stage="keyexchange"><i class="ti ti-key"></i></span>
                <span class="failure-route-line"></span>
                <span class="failure-route-node" data-stage="auth"><i class="ti ti-login-2"></i></span>
              </div>
              <p id="failure-stage" class="failure-stage"></p>
```

四个节点是本机 / TCP / 密钥交换 / 认证，就是规格那份清单（`:143`）。`handshake` 与 `session` 折算到 TCP 与认证两端，而不是再多两个圆点，而这个折算在上面那个模块里写了下来，好让读的人找得到。

- [ ] **步骤 4：上色**

替换 `states.css:23-29`：

```css
.failure-route { display: flex; align-items: center; margin: 40px 0 14px; }
/* Four nodes, and only one of them is red. Every node used to be --err, so the
   strip said "failure" in four places and "here" in none: the shape that carries
   the information is the break in the link, which needs the nodes either side of
   it to stay neutral. */
.failure-route-node { display: grid; flex: 0 0 auto; width: 36px; height: 36px; place-items: center; border: 1px solid var(--line-strong); border-radius: var(--r-full); background: var(--c-surface); color: var(--tx-3); font-size: 17px; }
.failure-route-node.is-passed { border-color: var(--ok-line); background: var(--ok-bg); color: var(--ok); }
.failure-route-node.is-failed { border-color: var(--err-line); background: var(--err-bg); color: var(--err); }
.failure-route-line { flex: 1 1 auto; height: 2px; background: var(--line); }
.failure-route-line.is-through { background: var(--ok-line); }
.failure-route-line.is-break { height: 0; background: none; border-top: 2px dashed var(--err); }
.failure-stage { margin: 0 0 30px; color: var(--tx-2); font-size: var(--fs-meta); text-align: center; }
.failure-suggestion { margin: 20px 0 0; padding: 11px 13px; border-left: 2px solid var(--ac); background: var(--ac-bg); color: var(--tx-2); font-size: var(--fs-meta); line-height: 1.6; }
.failure-suggestion:empty { display: none; }
.failure-host .host-avatar { width: 58px; height: 58px; border-radius: var(--r-4); }
```

把建议元素加进标记，放在 `#failure-log` 之后：`<p id="failure-suggestion" class="failure-suggestion"></p>`。

- [ ] **步骤 5：由 catch 驱动它**

在 `services/terminal.ts` 里，紧挨其他同级导入加上 `import { diagnose, stageLabel, type Failure } from '../failure-diagnostics.js'`，然后在 `connectTab` 的 catch（`:335-337`）里 —— 那里已经存了 `tab.logs` 与 `tab.message` —— 把诊断也存下来：

```ts
      tab.failure = diagnose(cleanError(error))
```

在 `TerminalTab` 上声明 `failure: Failure | null`，放在 `split` 旁边，在 `createTab` 里初始化成 `null`，并且在成功打开时和每次重试的开头都清掉它 —— 一条指向旧失败的过期路线比没有路线更糟。然后在 `render()` 里，紧挨现有的那段日志循环（`:277-282`，其中 `view` 就是 `:263` 已经在用的那个局部 `this.ctx.clientView`）：

```ts
    const failure = active.failure
    const route = view.element('connection-failure').querySelectorAll<HTMLElement>('.failure-route-node')
    const lines = view.element('connection-failure').querySelectorAll<HTMLElement>('.failure-route-line')
    view.element('connection-failure').classList.toggle('route-collapsed', !failure || failure.breakAt < 0)
    for (const [index, node] of [...route].entries()) {
      const state = !failure || failure.breakAt < 0 ? 'pending' : index < failure.breakAt ? 'passed' : index === failure.breakAt ? 'failed' : 'pending'
      node.classList.toggle('is-passed', state === 'passed')
      node.classList.toggle('is-failed', state === 'failed')
    }
    for (const [index, line] of [...lines].entries()) {
      const broken = !!failure && failure.breakAt >= 0 && index === failure.breakAt - 1
      line.classList.toggle('is-break', broken)
      line.classList.toggle('is-through', !!failure && !broken && index < failure.breakAt)
    }
    view.element('failure-stage').textContent = failure?.stage ? `失败在「${stageLabel(failure.stage)}」这一步` : ''
    view.element('failure-suggestion').textContent = failure?.suggestion ?? ''
```

`.route-collapsed` 是规格最后一句所要求的东西 —— 什么都没认出来时，这条带子不许装样子：

```css
/* Unclassified: the spec's "collapses to a single failure node and the page
   degrades to the log block". */
.route-collapsed .failure-route { display: none; }
```

- [ ] **步骤 6：规格描述过的那个日志块**

同一句规格（`:143`）要的是「一个 `--c-inset` 等宽块，行号不可选中，错误行染 `--err`」。底色与染色已经有了（`states.css:30-34`）；行号没有，而复制日志的用户不该被迫把行号槽一起复制走。

在 `render()` 的日志循环（`services/terminal.ts:277-282`）里，让每条记录的编号成为一个独立节点而不是一段文本：

```ts
      const number = this.ctx.clientView.document.createElement('span')
      number.className = 'failure-log-no'
      number.setAttribute('aria-hidden', 'true')
      number.textContent = String(index + 1)
      row.prepend(number)
```

以及在 `states.css` 里：

```css
/* The block is mono because every line of it is machine output; the gutter is a
   separate node with user-select: none so selecting the log for "Copy logs" does
   not carry "1 2 3" into the paste. The button already assembles the text. */
.failure-log { font-family: var(--font-mono); font-size: var(--fs-meta); line-height: 1.65; }
.failure-log-entry { display: grid; grid-template-columns: 2.5ch 16px minmax(0, 1fr); gap: 10px; }
.failure-log-no { color: var(--tx-3); font-variant-numeric: tabular-nums; text-align: right; user-select: none; }
.failure-log-entry i { margin-top: 0; }
```

现有的 `.failure-log-entry { display: flex }`（`:31`）由这个网格取代，而它的 `i { margin-top: 2px }` 覆盖被删掉，因为网格的对齐已经把这件事办了。把它断言出来：

```js
  assert.match(css, /\.failure-log-no\s*\{[^}]*user-select:\s*none/, 'line numbers must not ride along into a pasted log')
  assert.match(css, /\.failure-log\s*\{[^}]*var\(--font-mono\)/, 'the log is machine output and should look like it')
```

- [ ] **步骤 7：验证并提交**

```powershell
npm run build
node --test packages/ui/tests/visual-contract.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
```

预期：通过并且 `[SMOKE-OK]`。然后对着运行中的应用，用三种不同方式让连接失败 —— 一个解析不了的主机名、一个没人监听的端口、一个错的密码 —— 并报告每次亮起的是哪个节点。只有当这条路线在这三者之间*给出不同答案*时它才值得拥有；如果三次都指向同一个圆点，这个分类器就是装饰。

```bash
git add packages/ui/src/index.html packages/ui/src/services/terminal.ts packages/ui/src/styles/states.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): show which stage a failed connection stopped at"
```

---

## 任务 7：给已经发生过的事情发 toast

**文件：**
- 新建：`packages/ui/src/services/toasts.ts`
- 修改：`packages/ui/src/index.html`、`packages/ui/src/client.ts`、`packages/ui/src/features/hosts.ts`、`packages/ui/src/features/keychain.ts`、`packages/ui/src/features/sftp.ts`、`packages/ui/src/services/terminal.ts`
- 修改：`packages/ui/src/styles/states.css`
- 测试：`packages/ui/tests/visual-contract.test.mjs`、`packages/ui/tests/client-lifecycle.browser.ts`

**范围，故意比规格那句话窄。** 规格说 toast「replaces the scattered `#status` text nodes」（`:151`）。那几行里有三行不是事件通报，绝不能变成会自动消失的：

- `hosts.ts:302` 写的是一条*长期在场*的指令（「新建主机：填好地址和用户名后点「保存」」）。一条会消失的通告不能当说明书用。
- `hosts.ts:355,389` 跟在一次失败的提交之后，并把焦点给那个出错的字段。等用户的目光到达时，那句话必须还在。
- `keychain.ts:283` 是一条绑在它上面那个字段的校验行。

所以：`#status` 与 `#keychain-status` 留在内联，并保住它们的染色契约（`design-tokens.test.mjs:211` 是在自己的底色上量 `#status.ok` 的）。toast 承接*已完成*的事件 —— 已保存、已删除、已复制、已连接、已关闭、上传完成 —— 而这些今天恰恰是用户会漏掉的，因为它们落在一个他已经离开的表单里。

- [ ] **步骤 1：写出会失败的测试**

这个套件没有假时钟（`client-lifecycle.browser.ts` 只 await `tick()`），所以不要断言五秒过去了 —— 断言那两件真正可观察的事，再加上一条节点测试能钉住的常量：

```ts
    click('host-new'); fill(); click('host-save'); await tick()
    const toast = document.querySelector('.toast')!
    assert(!!toast, 'saving a host must announce itself where the user can see it')
    assert(toast.querySelector('.toast-title')!.textContent!.includes('已保存'), 'the toast names the thing that happened')
    assert(toast.querySelector('.toast-detail')!.textContent!.includes('localhost'), 'and what it happened to')
    assert(toast.getAttribute('role') === 'status', 'a normal notice must not interrupt a screen reader')
    toast.click()
    assert(!document.querySelector('.toast'), 'a notice you have read is dismissible by clicking it')
```

以及在 `packages/ui/tests/visual-contract.test.mjs` 里，与其余 `html`/`css` 断言并排，钉住浏览器套件等不起的那条存活时长与堆叠规则：

```js
  assert.match(html, /id="toasts" class="toasts" aria-live="polite"/, 'toasts need their mount point or ClientToasts never boots')
  assert.match(css, /\.toasts\s*\{[^}]*var\(--z-toast\)/, 'the toast layer draws its own z-index token')
  assert.match(css, /\.toasts\s*\{[^}]*calc\(var\(--status-h\)/, 'and clears the status bar by construction, not by a literal')
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.toast\s*\{\s*animation:\s*none/, 'a notice that slides must be able to stop sliding')
```

- [ ] **步骤 2：运行它们，确认失败**

运行：`node --test packages/ui/tests/visual-contract.test.mjs && node packages/ui/tests/smoke-client-lifecycle.mjs`
预期：visual contract 在挂载点上失败，并且 `[SMOKE-FAIL]` 在 `saving a host must announce itself`。

- [ ] **步骤 3：挂载点**

在 `index.html` 里，作为 `.app-shell` 的最后一个子元素（状态栏元素之后），这样一个固定定位的 toast 在结构上就避开了那条栏：

```html
      <div id="toasts" class="toasts" aria-live="polite"></div>
```

- [ ] **步骤 4：这个服务**

`packages/ui/src/services/toasts.ts`，完全照 `ClientChrome` 的形状来 —— 一个带 `static inject` 列表的 `Service`、`super(ctx, '<name>')`，以及一个归它自己所有的 `ClientScope`：

```ts
import { Service, type Context } from 'cordis'
import { ClientScope } from '../client-runtime.js'

export interface ToastNotice {
  title: string
  /** 一行 mono 细节：地址、指纹、文件名。标题说做了什么，这行说对谁做的。 */
  detail?: string
  kind?: 'ok' | 'err'
}

const SHOWING = 5_000
const MAX = 3

/**
 * 右下角的事件通知。
 *
 * 存在的理由：`view.status()` 写的是表单里的 `#status`，而「已保存「web-01」」这种话
 * 说完的时候用户往往已经不在那个表单上了。所以事件走这里，字段校验留在原地——
 * 会自动消失的东西不能当说明书用。
 */
export class ClientToasts extends Service {
  static inject = ['clientView']
  private readonly scope: ClientScope
  private readonly host: HTMLElement | null = null
  private items: HTMLElement[] = []

  constructor(ctx: Context) {
    super(ctx, 'clientToasts')
    this.scope = new ClientScope(ctx)
    // ClientView.element() throws on a missing id, so a forgotten #toasts is a
    // boot failure with a name in it, not a silent no-op.
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
    element.className = `toast${notice.kind === 'err' ? ' is-err' : ''}`
    // 正常通报用 role=status（礼貌播报），失败用 role=alert（立刻播）。
    element.setAttribute('role', notice.kind === 'err' ? 'alert' : 'status')
    const bar = document.createElement('span')
    bar.className = 'toast-bar'
    bar.setAttribute('aria-hidden', 'true')
    const title = document.createElement('span')
    title.className = 'toast-title'
    title.textContent = notice.title
    const copy = document.createElement('span')
    copy.append(title)
    if (notice.detail) {
      const detail = document.createElement('span')
      detail.className = 'toast-detail'
      detail.textContent = notice.detail
      copy.append(detail)
    }
    element.append(bar, copy)
    this.scope.listen(element, 'click', () => this.dismiss(element))
    host.append(element)
    this.items.push(element)
    // 堆叠超过三条就把最老的挤掉：一次失败的批量操作能产出十几条，
    // 而一个盖住整个工作区的通知栈不是反馈，是阻碍。
    while (this.items.length > MAX) this.dismiss(this.items[0]!)
    // scope.delay 而不是 setTimeout：remount 之后还活着的计时器会把一条通知
    // 挂到已经不存在的界面上，而这个套件恰好有一条测的就是这个。
    void this.scope.delay(SHOWING).then((active) => { if (active) this.dismiss(element) })
  }

  private dismiss(element: HTMLElement): void {
    this.items = this.items.filter(item => item !== element)
    element.remove()
  }
}
```

在 `packages/ui/src/client.ts` 里注册它：把 `'toasts'` 加进 `:16` 的 `scopes` 键联合，并在 `:32-40` 加上 `toasts: context.plugin(ClientToasts)` —— 要放在 `hosts`、`keychain` 与 `sftp` **之前**，因为它们要注入它。消费方透过模块增强来点名它，跟 `'clientChrome'` 被点名的方式一样：在 `client-runtime.ts` 里已有的 `clientView` 声明旁边加上 `interface Context { clientToasts: ClientToasts }`，然后在每个会发通报的 feature 上写 `static inject = ['clientView', 'clientToasts']`，并以 `this.ctx.clientToasts.notify(...)` 取用它。

- [ ] **步骤 5：CSS**

在 `states.css` 里，dialog 块之后。形状取自原型的 `.toast`（`graphite-target.html:171-177`）；数字来自登记表：

```css
/* Bottom-right, clearing the status bar by construction rather than by a 38px
   literal that would go stale the day the bar changes height. */
.toasts { position: fixed; right: var(--s-4); bottom: calc(var(--status-h) + var(--s-3)); z-index: var(--z-toast); display: flex; flex-direction: column; align-items: flex-end; gap: var(--s-2); pointer-events: none; }
.toast { display: flex; gap: 9px; align-items: flex-start; width: 274px; max-width: calc(100vw - 32px); padding: 10px 11px; border: 1px solid var(--line-strong); border-radius: var(--r-2); background: var(--c-raised); box-shadow: var(--shadow-pop); pointer-events: auto; cursor: pointer; animation: toast-in var(--t-2) var(--ease); }
.toast-bar { flex: 0 0 auto; align-self: stretch; width: 2px; border-radius: 1px; background: var(--ok); }
.toast.is-err .toast-bar { background: var(--err); }
.toast-title { display: block; color: var(--tx-1); font-size: var(--fs-meta); font-weight: 500; }
.toast-detail { display: block; margin-top: 2px; overflow: hidden; color: var(--tx-3); font-family: var(--font-mono); font-size: var(--fs-micro); text-overflow: ellipsis; white-space: nowrap; }
@keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
```

- [ ] **步骤 6：把事件的书写处搬过去**

下面每一处目前都是为了一次*已完成*的操作调用 `view.status(...)`；把它们改道到 toast，其余的别碰：

| 位置 | 今天 | 变成 |
| --- | --- | --- |
| `hosts.ts:74` | `已保存「label」` | `notify({ title: '已保存主机', detail: record.label })` |
| `hosts.ts:341` | `已删除「label」` | `notify({ title: '已删除主机', detail: label })` |
| `hosts.ts:366` | `已连接，但保存主机失败…` | `notify({ title: '已连接，但保存失败', detail: cleanError(error), kind: 'err' })`，**并且**保留内联的 `#status` 写入 |
| `keychain.ts:298` | `密钥已保存…` | `notify({ title: '密钥已保存' })` |
| `terminal.ts` 在 `opened` 时 | 今天什么都没有 | `notify({ title: '已连接', detail: \`${host}:${port}\` })` |
| `terminal.ts` 在 `closed`/`ended` 时 | 只有 `#session-state` 文本 | 当这个标签不是活动标签时 `notify({ title: '连接已结束', detail: reason, kind: 'err' })` |
| `sftp-panel.ts:312` `setHint` 在上传/删除成功时 | 面板内的一行 | `notify(...)`，**加上**那一行，因为面板才是用户正在看的地方 |

**不要**转换这些：`hosts.ts:75,275,302,355,388-391,407`、`keychain.ts:71,283,289`。那些是指令、跟着焦点走的提示，或者进行中的行；而 `#sftp-hint` 的那句空目录是一种长期状态，不是事件。

- [ ] **步骤 7：验证，并证明这条断言是承重的**

```powershell
npm run build
node --test packages/ui/tests/*.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
```

然后确认那条自动消失的断言真的在测东西：把 `SHOWING` 改成 `60_000`，跑生命周期套件，预期在 `and it must get out of the way` 上失败，然后改回去。

- [ ] **步骤 8：提交**

```bash
git add packages/ui/src/services/toasts.ts packages/ui/src/client.ts packages/ui/src/index.html packages/ui/src/styles/states.css packages/ui/src/features/hosts.ts packages/ui/src/features/keychain.ts packages/ui/src/features/sftp.ts packages/ui/src/services/terminal.ts packages/ui/src/sftp-panel.ts packages/ui/tests/client-lifecycle.browser.ts packages/ui/tests/visual-contract.test.mjs
git commit -m "feat(ui): toast the things that already happened"
```

---

## 任务 8：把四态给那两条还没有四态的清单

**文件：**
- 修改：`packages/ui/src/features/hosts.ts`、`packages/ui/src/features/keychain.ts`
- 修改：`packages/ui/src/styles/states.css`、`packages/ui/src/styles/hosts.css`
- 测试：`packages/ui/tests/visual-contract.test.mjs`、`packages/ui/tests/client-lifecycle.browser.ts`

规格（`:149`）要每一条清单都有 loading / empty / error / degraded。empty 在两个屏幕上都已经有了（`#hosts-empty`、`#keychain-empty`），计划 4 的 `:has()` 规则把列标题拴在它上面，而「后端不可用」这种情形正是 `hosts:list` 被拒绝时目前默默咽下的东西。缺的是骨架行与降级横幅。

- [ ] **步骤 1：写出会失败的测试**

共享 fixture 的 `hosts.list` 会立刻 resolve（`client-lifecycle.browser.ts:28`），所以骨架还没等任何东西来得及看就没了。挑一条你控制得住的清单搭一个情景：

```ts
    // 骨架必须在一个可控的 pending 上测，否则断言测的是「Promise 还没跑完」这种
    // 时序运气。共享 fixture 的 list 是立刻 resolve 的。
    const pending = fixture()
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const api = { ...pending.api, hosts: { ...pending.api.hosts, list: async () => { await gate; return pending.api.hosts.list() } } }
    const client3 = createClient({ api, terminalFactory: pending.terminalFactory })
    await tick()
    // The skeleton rows must not be .host-row: the suite's own table assertions
    // read .host-row's children, and a placeholder that satisfies them would hide
    // a real regression in the row shape.
    assert(document.querySelectorAll('.skeleton-row').length >= 3, 'a list that is still loading shows placeholder rows')
    assert(!document.querySelector('.host-row'), 'and no real row until the data is in')
    assert(document.getElementById('hosts-empty')!.hidden, 'the empty state must not flash while the list is in flight')
    release()
    await tick()
    assert(!document.querySelector('.skeleton-row') && !!document.querySelector('.host-row'), 'the skeleton gives way to rows')
    await client3.dispose()
```

第三条断言才是最要紧的那条：`renderHostList()` 目前设置 `#hosts-empty.hidden = visible.length > 0`，于是一张空的*首帧*会在数据到达之前把「还没有保存的主机」亮上一个 tick。`renderSkeleton()` 必须把它也藏起来，然后再恢复回去。

- [ ] **步骤 2：运行它，确认失败**

运行：`node packages/ui/tests/smoke-client-lifecycle.mjs`
预期：`[SMOKE-FAIL]` 在 `a list that is still loading shows placeholder rows`。

- [ ] **步骤 3：骨架行，用真行将要占据的高度**

在 `features/hosts.ts` 里，第一个 `hosts:list` resolve 之前，把占位符渲染进同一个容器：

```ts
  /** 骨架行用 .skeleton-row 而不是 .host-row：占位符不该满足真行的断言，
   *  否则行的形状改坏了也测不出来。 */
  private renderSkeleton(count = 5): void {
    const list = this.ctx.clientView.element('host-list')
    list.textContent = ''
    for (let index = 0; index < count; index += 1) {
      const item = this.ctx.clientView.document.createElement('li')
      item.className = 'skeleton-row'
      item.setAttribute('aria-hidden', 'true')
      const bar = item.appendChild(this.ctx.clientView.document.createElement('span'))
      bar.className = `skeleton-bar w${(index % 3) + 1}`
      list.append(item)
    }
  }
```

在 `activate()` 里、清单请求发出之前调用它，并确认真正的 `render()` 会替换容器的子元素（它本来就会）。由一句客气的话来承载播报，而不是靠那些行：

```html
<p class="list-status" role="status">正在读取主机列表…</p>
```

`renderHostList()` 会连同骨架一起把它清掉。

- [ ] **步骤 4：CSS**

```css
/* The bar is 22px inside a --row-h row, so the row it becomes on arrival changes
   nothing about where the next line sits — the whole point of the skeleton is
   that the list does not jump. */
.skeleton-row { display: flex; min-height: var(--row-h); align-items: center; padding: 0 10px; border: 1px solid var(--line-soft); border-radius: var(--r-4); background: var(--c-surface); }
.skeleton-bar { display: block; height: 22px; border-radius: var(--r-2); background: linear-gradient(90deg, var(--c-surface) 0%, var(--c-raised) 45%, var(--c-surface) 90%); background-size: 200% 100%; animation: skeleton-shimmer 1.5s linear infinite; }
.skeleton-bar.w1 { width: 44%; }
.skeleton-bar.w2 { width: 70%; }
.skeleton-bar.w3 { width: 30%; }
@keyframes skeleton-shimmer { to { background-position: -200% 0; } }
.list-status { margin: 12px; color: var(--tx-3); font-size: var(--fs-meta); }
@media (prefers-reduced-motion: reduce) { .skeleton-bar { animation: none; } }
```

`--row-h` 是那个感知密度的 token，所以紧凑密度也会把骨架缩短 —— 登记表说已经接通的那道阶梯，接通着就继续接通。

- [ ] **步骤 5：降级与坏掉**

两块现在都不存在，所以把两样都加进 `index.html` 的 `#hosts-panel` 里，放在 `.hosts-heading` 与 `#hosts-body` 之间 —— 在表格之上，因为它们讲的都是整条清单，而把它们藏到一次滚动之后，正是一条保证不再成其为保证的方式：

```html
            <p id="hosts-error" class="list-error" role="alert" hidden><span class="list-error-title"></span><span class="list-error-detail"></span><button type="button" id="hosts-retry" class="ghost small">重新加载</button></p>
            <p id="hosts-degraded" class="list-error is-warn" hidden></p>
```

一条被拒绝的清单目前是无声的：`refresh()`（`features/hosts.ts:234-236`）await `api.hosts.list()` 并让拒绝一路往外传。把这一个调用包起来，因为两类失败需要两种恢复：

```ts
  private async refresh(keepId?: string | null, formRevision = this.formRevision): Promise<void> {
    const view = this.ctx.clientView
    view.element('hosts-error').hidden = true
    let hosts: HostRecord[]
    try {
      hosts = await this.ctx.clientTransport.api.hosts.list()
    } catch (error) {
      // 「后端不可用」和「这一次操作失败了」是两件事：前者要求重连或重启，
      // 后者只要再试一次。混成一句红字，用户两种都无从下手。
      this.setListError('主机列表读不出来，后端可能已经断开。', cleanError(error))
      throw error
    }
    …  // the existing body continues from here, unchanged
```

这个重新抛出是故意的：`refresh()` 的调用方已经把拒绝当作「这一次重载没有发生」来处理，在这里把它咽下去，等于把一个可见的错误变成一个上面盖着一段红字的无声错误。

```ts
  private setListError(title: string, detail: string): void {
    const block = this.ctx.clientView.element('hosts-error')
    block.hidden = false
    block.querySelector<HTMLElement>('.list-error-title')!.textContent = title
    block.querySelector<HTMLElement>('.list-error-detail')!.textContent = detail
  }
```

`#hosts-retry` 重跑 `activate()` 路径本来就会执行的那一次清单请求。降级横幅讲的是*能力*这一类 —— 一个 `credentialPersistence !== 'encrypted'` 的 Desktop 构建，或者一个密钥库无法持久化的 Web 会话 —— 它染 warn 而不是染 error，因为什么都没失败：

```css
/* Two tints, because two recoveries: --err means "this did not work, try again",
   --warn means "this part of the product is off, and the rest is not lying to
   you about it". */
.list-error { display: flex; gap: 8px; align-items: flex-start; margin: 0 12px 14px; padding: 9px 11px; border: 1px solid var(--err-line); border-radius: var(--r-2); background: var(--err-bg); }
.list-error.is-warn { border-color: var(--warn-line); background: var(--warn-bg); }
.list-error[hidden] { display: none; }
.list-error-title { display: block; color: var(--tx-1); font-size: var(--fs-meta); font-weight: 500; }
.list-error-detail { flex: 1 1 auto; min-width: 0; color: var(--tx-3); font-family: var(--font-mono); font-size: var(--fs-micro); overflow-wrap: anywhere; }
.list-error button { flex: 0 0 auto; }
```

`keychain.ts` 的清单透过它自己的 `#keychain-notice` 拿到同样三种状态，那个元素已经存在 —— 给它 `.list-error`，不要再造第四种模式。

既然到了这里，把断言也加上：

```js
  assert.match(css, /\.list-error\.is-warn/, 'a capability being off must not look like an operation failing')
  assert.match(html, /id="hosts-error"[^>]*role="alert"/, 'a list that could not load must announce itself to a screen reader')
```

- [ ] **步骤 6：验证并提交**

```powershell
npm run build
node --test packages/ui/tests/*.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
```

```bash
git add packages/ui/src/features/hosts.ts packages/ui/src/features/keychain.ts packages/ui/src/index.html packages/ui/src/styles/states.css packages/ui/src/styles/hosts.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): give the library lists their loading, error and degraded states"
```

---

## 任务 9：文档、更正，然后亲眼看它

**文件：**
- 修改：`docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md`（`_zh`）
- 修改：`docs/superpowers/prototype/graphite-target.html`
- 修改：`docs/design-system.md`（`_zh`）、`CHANGELOG.md`（`_zh`）、`packages/ui/src/lib/changelog.ts`
- 修改：`docs/superpowers/plans/2026-09-24-session-screens.md`（`_zh`）

- [ ] **步骤 1：写下对规格的更正，带上日期**

规格里关于失败诊断（`:141-145`）与 Terminal/SFTP（`:135-137`）的两节，要的是这套栈表达不了的两样东西。本仓库的先例是一条带日期的「Corrected <date>, at execution」注记，它陈述事实，而不是把原来那段改写。两条都加上：

```markdown
  - **Corrected 2026-09-24, at execution:** row-level transfer progress is not
    representable over the current contract. `SshApi.sftp.write`
    (`packages/protocol/src/protocol.ts:291`) takes the whole file as one
    `Uint8Array` and resolves once, and `EVENTS` (`:47`) carries only
    `terminal:*` — there is no progress channel and no chunked upload to derive
    one from. The row therefore shows an in-flight state driven by the pending
    promise, which is true, and byte-level progress becomes a protocol item for a
    later plan rather than a bar that guesses.
  - **Corrected 2026-09-24, at execution:** "the ratio persists for the session"
    was implemented on the tab object (`TerminalTab.split`), not in
    `localStorage`. Constraint 1 in [Constraints and accepted
    compromises](#constraints-and-accepted-compromises) already records that a
    standalone Web origin changes every launch, so a persisted ratio would be
    remembered where it cannot be read back and forgotten where it could.
```

另外，把本计划勘察时与之矛盾的两个事实也更正掉：

```markdown
  - **Corrected 2026-09-24, at execution:** "replacing the hard-coded
    `grid-template-rows`" left `#sftp` carrying two layout mechanisms at once —
    the absolute drawer rule at `terminal.css:12` and the grid-child override at
    `:53` — and only the second was ever painted. Replacing a mechanism means
    deleting the old one.
  - **Corrected 2026-09-24, at execution:** the four nodes are 本机 / TCP /
    密钥交换 / 认证 as written, and the classifier has seven stages. `address`
    folds into the TCP node and `handshake` into the gap before it, `session` into
    the far side of auth, because a node the user cannot point at is decoration.
```

每一段都镜像进 `..._zh.md`。

- [ ] **步骤 2：更正原型**

它是剩余工作唯一的视觉事实来源，所以里面现在有两个值与一条守卫相冲突：

- `.srow.h { … color: var(--tx-4) … }`（`:199`）与 `.es span`、`.es .ic`（`:281-282`）把 `--tx-4` 当正文色用。`stylesheet-contract.test.mjs` 里那条「只准用于 `::placeholder`」的规则会把它拒绝掉，量出来的理由写在 `docs/design-system.md` 里。三处全部改成 `--tx-3`。
- 在每一处上方加一行注释：`/* was --tx-4; the register forbids it as text — see docs/design-system.md */`。

- [ ] **步骤 3：更新登记表**

重新量，别猜 —— 那份文档里的数字全都标注为实测：

```powershell
node -e "const fs=require('fs');const p='packages/ui/src/styles/';const c=['base','chrome','hosts','inspector','keychain','terminal','states'];let n=0;for(const f of c)n+=(fs.readFileSync(p+f+'.css','utf8').match(/var\(--[a-z0-9-]+\)/g)||[]).length;console.log('content var() refs:',n);for(const t of ['t-1','t-2','t-3','z-toast','r-full','grip-w','row-h'])console.log(t,(fs.readFileSync(p+'style.css','utf8'),c.map(f=>fs.readFileSync(p+f+'.css','utf8')).join('').split('var(--'+t+')').length-1))"
```

然后在两种语言的文档里都更新：那条普查句子（`381`，以及新的总数量出来是多少就是多少）、度量那条项目符号的引用计数，还有「仍有十六个 token 不可达」这个说法 —— `--t-2`、`--t-3` 与 `--z-toast` 现在有了消费方，所以那份清单会缩短，而关于时长「没有消费方并非中立」的那句话会变成假的，必须改写，不是删掉。补上 `terminal.css` 与 `states.css` 的字节/行数表行，并把 `--grip-w` 加进 chrome 几何那一行。

- [ ] **步骤 4：CHANGELOG 与生成的文件**

在 `[Unreleased] → Changed` 下，替换掉仍在描述竖向固定分栏的那句话，并加上 toast 那句。在 `Fixed` 下，写上真正改变了用户所见行为的东西：一次失败的连接现在会说清是哪一步失败了，以及文件表的 mode 此前是谁也看不见的。

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```

预期：`Changelog and workspace versions are valid for 0.1.0-alpha.1.`。把 `packages/ui/src/lib/changelog.ts` 与文档一起提交。

- [ ] **步骤 5：把整套跑一遍**

```powershell
npm run verify
npm run verify:electron
```

两条都必须退出 0。把真正打印出来的数字报出来。

- [ ] **步骤 6：看它**

```powershell
npm run start:web
npm run start:desktop
```

对着运行中的应用，按用户遇到它们的顺序逐条汇报：(a) 分栏读起来是一个界面、而不是两个恰好挨在一起的板子吗，5px 的把手看着抓得住吗；(b) 拖它，切到别的标签，再回来 —— 比例还是那个会话自己的吗；(c) 文件表放在主机表旁边读得顺吗，还是 28px 的行高对着主机的 38px 像是两个不同的应用；(d) 面包屑是帮上忙了，还是与路径字段重复了；(e) **故意让连接失败** —— 一个坏主机、一个关着的端口、一个错密码、一个变了的主机密钥 —— 并检查路线每次指着的都是对的节点，而那句建议是你真会去做的；(f) toast 有没有挡住它们不该挡的东西，五秒够读完最长的那条吗；(g) 断掉网络再加载应用，让清单出错，检查「后端不可用」与「这一次操作失败了」区分得开吗；(h) **切到浅色主题，把这一切都看一遍** —— 计划 4 的复查到那时候都还没能亲眼看过它。

- [ ] **步骤 7：如实汇报，然后收尾**

任何没有检查过的东西，说出来，并说清为什么。在本计划及其中文配对末尾追加一节 `## What execution found`，写下偏离之处与任务 9 发现的缺陷，完全照计划 3 与计划 4 的做法。提交，然后推送分支 —— 不要合并进 `main`，也不要去开 pull request。

---

## <a id="corrections-this-plan-must-write"></a>本计划必须写下的更正

集中在这里，好让它们不致于在任务之间被悄悄丢掉：

1. 行级的 SFTP 传输进度无法建立在 `write(dir, name, bytes)` + 只有 `terminal:*` 的事件之上。任务 9，[步骤 1](#task-9-documents-corrections-and-looking-at-it)。
2. 持久化的分栏比例在独立 Web 上没有意义（来源每启动一次就换）。按标签实现。任务 9 步骤 1。
3. 规格那句 `grid-template-rows` 让一个元素上同时留了两套机制。任务 1；已写在步骤 1 里。
4. 七个分类阶段，四个节点。任务 5/6；已写在步骤 1 里。
5. 原型里的 `--tx-4` 现在作为正文色是违规的，共三处。任务 9 步骤 2。
6. 登记表那句「时长没有任何消费方」的普查结论将变成假的。任务 9 步骤 3 —— 改写它，不要删掉它。
7. 规格那句「toast 取代分散的 `#status` 文本节点」对已完成的事件成立，对指令与字段校验提示不成立。任务 7 写明了这条分界。

## 完工判据

- 终端与文件表是两列，中间那根把手可以拖、接受键盘输入、把自己宣告为 separator，并且交还给每个会话自己的比例。
- 远端文件清单是一张四列表格，它的列标题与行共用同一份模板，`mode` 第一次出现在屏幕上，而面包屑挂在它上方且没有替换掉路径字段。
- 一次失败的连接会说清它失败在哪一步，标出它走过了哪几步，在停下的地方把连线断开，认不出来时降级到日志块。
- 已完成的事件以 toast 抵达用户，带着正确的 `role`、五秒的寿命、三条深的堆叠；内联提示留在了内联。
- 两条库清单都有 loading、empty、error、degraded 四种形状，而占位符不是 `.host-row`。
- 级联里的每一个时长与圆角都取自阶梯，登记表的普查以实测数字这么宣称。
- `npm run verify` 与 `npm run verify:electron` 通过，每一条新守卫都被亲眼见过失败一次，而浅色主题由一个人看过了。

## 不在本计划内

- 真正的传输进度通道、会话负载上的加密算法/主机密钥类型/在线时长，以及最后连接时间 —— 这三样都需要改 `@pureterm/protocol`，以及随之而来的消费方清扫。
- 安装器与任务栏图标。
- 620px 以下的移动端抽屉，由计划 4 的复查记为一个缺口。

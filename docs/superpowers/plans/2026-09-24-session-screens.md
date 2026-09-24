# Session Screens Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the terminal session its split, table, diagnostics and feedback that the other three plans left for it — a draggable terminal/SFTP split, a four-column remote file table with a breadcrumb, a failure route that names the stage that died, toasts for events, and the four list states.

**Architecture:** Everything stays inside `@pureterm/ui`. The failure route classifies the *text* the Host already produces — `packages/host/src/services/ssh.ts:121` `normalizeSshError` has already decided which stage failed and said so in prose; the page reads that prose against a table and never re-derives it from the network. No `@pureterm/protocol`, `@pureterm/host` or `@pureterm/transport` file is touched by this plan, and the one place where the spec asks for something the current contract cannot express — byte-level transfer progress, which `write(dir, name, bytes)` and a `terminal:*`-only event list cannot carry — is recorded as a correction instead of invented.

**Tech Stack:** CSS custom properties and grid, plain DOM TypeScript, Cordis `Service` plugins, `node:test` guards under `packages/ui/tests/`.

---

## Read this first

Plans 1-4 established three habits this plan is required to continue:

1. **A guard that cannot fail is decoration.** Every new assertion gets run against a deliberately broken tree once, and the report says what it caught. Plan 4 shipped a docked editor that was invisible for two commits with 53 green guards, because the guard read CSS text and the layout was wrong at runtime.
2. **Measure the running app.** `npm run build && npm run start:web`, then read geometry out of the live document. The in-app browser's surface is often `visibilityState=hidden`, which means (a) no screenshots and (b) transitions do not advance — inject `*, *::before, *::after { transition: none !important }` before reading any transitioned property.
3. **When the spec asks for data that does not exist, say so in the document that asked.** See [Corrections this plan must write](#corrections-this-plan-must-write).

Current facts, measured on the tree this plan starts from (`feat/ui-redesign` at `2818b3a`):

- `packages/ui/src/styles/terminal.css` is 63 lines / 5,283 bytes. It carries **two layout mechanisms for one element**: `#sftp` is an absolutely positioned drawer at `:12` and a grid child at `:53`. Only the second can ever be seen, because `.files-open` is what shows the panel.
- `.session-content` (`:51`) is `grid-template-rows: minmax(0, 1fr)`; `.files-open .session-content` (`:52`) is `minmax(120px, 1fr) minmax(160px, 40%)`. The split is vertical, fixed, and the `40%` is a literal that no token owns.
- The target prototype `docs/superpowers/prototype/graphite-target.html` draws the split **horizontally** (`cursor: col-resize` at `:187`), which is what the spec's "horizontal split" means. This plan follows the prototype.
- The remote file list already renders four fields per row (`sftp-panel.ts:166-189`: name + tags, size, time, actions) but has no header, and `SftpEntry.mode` (`packages/protocol/src/protocol.ts:197`) is fetched and never shown.
- The failure route is two nodes (`index.html:211-215`) and `.failure-route-node` (`states.css:27`) paints every one of them `--err` regardless of where the connection stopped.
- `.failure-host .host-avatar` is `60px` (`states.css:18`) — a third avatar size after Plan 4 fixed the other two to 20/58 — and it inherits the 20px chip's `--r-1` corner.
- `.failure-route-node` has `border-radius: 999px` (`states.css:27`), an off-ladder literal, while `--r-full` sits in the register with one reference.
- `--z-toast: 40` (`tokens.css:86`) has no consumer. Neither do `--t-1`, `--t-2`, `--t-3`.
- Feedback today is three inline text nodes: `#status` in the connection form (`client-runtime.ts:61` `status()`), `#keychain-status` (`features/keychain.ts:253`), `#sftp-hint` (`sftp-panel.ts:312`). No toast primitive exists.
- A `ResizeObserver` already drives `fit()` (`services/terminal.ts:150`), so a resized pane refits itself. **Do not add a second fit call.**
- 54 UI guards pass. `npm run test:unit` globs `packages/ui/tests/*.test.mjs`, so a new guard file needs no root script change.

## Files

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
modify  packages/ui/src/features/sftp.ts           grip element, ratio, split paint
modify  packages/ui/src/client.ts                  register ClientToasts
modify  packages/ui/tests/visual-contract.test.mjs  split, table, toast, route assertions
modify  packages/ui/tests/theme-sync.test.mjs      --grip-w joins the :root-only metric list
modify  packages/ui/tests/client-lifecycle.browser.ts
modify  docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md  (+ _zh)
modify  docs/superpowers/prototype/graphite-target.html
modify  docs/design-system.md  (+ _zh)
modify  CHANGELOG.md  (+ _zh)  then node scripts/convert-changelog.js
```

`packages/ui/src/styles/states.css` is where the four states and the toast live because the spec's own file map says so (`states.css — skeleton, four states, toast, dialog`). Keep it that way rather than inventing a tenth partial: the manifest order is pinned by a test and adding a file is a cascade decision, not a tidy-up.

---

## Task 1: The split becomes two columns

**Files:**
- Modify: `packages/ui/src/styles/tokens.css` (the chrome-geometry block, after `--insp-w`)
- Modify: `packages/ui/src/styles/terminal.css` — the `#sftp` drawer rule, `.session-content`, `.files-open .session-content` and the `#sftp` grid-child override
- Modify: `packages/ui/src/styles/inspector.css:12`, `packages/ui/src/styles/states.css:14` — the two redundant `[hidden]` rules Step 4 deletes
- Modify: `packages/ui/tests/design-tokens.test.mjs:53` — the `GLOBAL_TOKENS` list Step 6 extends
- Test: `packages/ui/tests/visual-contract.test.mjs`

- [ ] **Step 1: Write the failing assertions**

Add inside the first `test(...)` block in `packages/ui/tests/visual-contract.test.mjs`, after the existing `#main` track assertions:

```js
  // The split is one mechanism. #sftp used to be an absolutely positioned drawer
  // AND a grid child of .session-content, and only the second one could ever be
  // seen — .files-open is what shows the panel at all.
  assert.match(css, /\.session-content\s*\{[^}]*grid-template-columns:/, 'the session content is a column grid')
  assert.match(css, /\.files-open \.session-content\s*\{[^}]*var\(--grip-w\)/, 'the grip is its own track, not an overlay on one')
  assert.doesNotMatch(css, /#sftp\s*\{[^}]*position:\s*absolute/, 'one element may not have two layout mechanisms')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test packages/ui/tests/visual-contract.test.mjs`
Expected: FAIL on `the session content is a column grid`.

- [ ] **Step 3: Add the token**

In `packages/ui/src/styles/tokens.css`, extend the chrome-geometry block so the comment still describes all five values:

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

- [ ] **Step 4: Rewrite the three terminal rules**

In `packages/ui/src/styles/terminal.css`, delete `:12` (the `#sftp { position: absolute; … }` drawer rule) and `:53` (`.session-content #sftp { position: relative; … }`), then put the surviving declarations into one rule and replace `:51-52`:

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

The `minmax(240px, …)` / `minmax(220px, …)` floors are what keep a drag from collapsing a pane into an unreadable sliver before Task 2 adds the JS clamp.

Setting `display: flex` on `#sftp` is safe against `hidden` because `base.css:65` carries `[hidden] { display: none !important }`, and an `!important` UA-adjacent author rule beats any plain declaration regardless of specificity. That same fact makes two existing rules dead weight, and this task is the right place to remove them — a rule that duplicates a global is a rule a future reader will assume is load-bearing:

```bash
git grep -n "\[hidden\] { display: none" -- packages/ui/src/styles
```

Delete `.connection-workspace[hidden]` (`inspector.css:12`) and `.connection-failure[hidden]` (`states.css:14`). The global in `base.css` stays, and is the thing that should be findable.

- [ ] **Step 5: Build, run the guards, look at the cascade**

```powershell
npm run build
node --test packages/ui/tests/visual-contract.test.mjs
```

Expected: BUILD-OK, then both tests pass.

`assert.doesNotMatch(css, /#sftp\s*\{[^}]*position:\s*absolute/)` is the assertion that keeps this from regressing: `#sftp` carried an absolute-drawer rule and a grid-child override at once, and only one of them could ever paint the element.

- [ ] **Step 6: Register the token as theme-invariant**

`--grip-w` is a metric, and metrics live in `:root` only — `[data-theme="light"]` and `:root` match the same element, so repeating a metric in the light group would recreate the hand-copied duplicate the token system exists to remove. Add `'--grip-w'` to the `--chrome-h`/`--rail-w`/`--status-h`/`--insp-w` line of `GLOBAL_TOKENS` in `packages/ui/tests/design-tokens.test.mjs:53`.

Be clear about what this does and does not buy: the test that reads that list (`design-tokens.test.mjs:79-82`) asserts each entry is present in `:root` and absent from the light group. Leaving `--grip-w` out would not fail anything today — the new token would simply be unguarded, which is how the old palette acquired its second set of hand-copied colours. Add it.

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: pass.

- [ ] **Step 7: The narrow case, which the plan had not asked for**

Measured on the running app after Step 5: at a 447px viewport the two columns resolve to their own minimum floors, `240px + 5px + 220px = 465px`, which is 18px wider than the window that has to hold them — so the split overflowed horizontally. Removing the row layout had no replacement for the width the spec reserves it for (`Constraints` 5: "below 820 … SFTP stacks under the terminal"). Add it back as rows, keeping the grip as its own track so the drag survives the axis change:

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

and pin it, because the failure mode is silent at desktop widths:

```js
  assert.match(css, /grid-template-rows:\s*minmax\(120px, 1\.35fr\) var\(--grip-w\) minmax\(160px, 1fr\)/, 'below 820 the file table stacks under the terminal')
```

Re-measure at whatever width the in-app browser gives you and report both axes: the used `grid-template-columns` must collapse to one track, `gridTemplateRows` must show `…px 5px …px`, and `scrollWidth` must equal `clientWidth`. Task 2 gives the grip a `row-resize` cursor at this width; until then the handle moves in the wrong axis on a phone, which is a smaller defect than overflowing.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/src/styles/terminal.css packages/ui/src/styles/inspector.css packages/ui/src/styles/states.css packages/ui/src/styles/base.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): make the terminal and file table two columns"
```

Commit `base.css` only if Step 4's comment sent you there to look up the `[hidden]` rule — the file itself does not change.

---

## Task 2: The grip, the drag, and a ratio that survives a tab switch

**Files:**
- Modify: `packages/ui/src/services/terminal.ts:7-17` (`TerminalTab`), `:171-210` (`createTab`)
- Modify: `packages/ui/src/features/sftp.ts:40-95`
- Modify: `packages/ui/src/styles/terminal.css`
- Test: `packages/ui/tests/client-lifecycle.browser.ts`

The element lives in `ClientSftp` because that service already owns the open/close of the file table (`features/sftp.ts:49,92` toggle `.files-open`); the *ratio* lives on the tab because the spec says it "persists for the session", and a session is a tab.

- [ ] **Step 1: Write the failing behaviour test**

In `packages/ui/tests/client-lifecycle.browser.ts`, inside the scenario that already connects a host and opens files (search for `sftp-toggle`), add after the table is open:

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

- [ ] **Step 2: Run it to verify it fails**

Run: `node packages/ui/tests/smoke-client-lifecycle.mjs`
Expected: `[SMOKE-FAIL]` on `the grip must announce itself as a separator`.

- [ ] **Step 3: Keep the ratio on the tab, and announce when it moves**

In `packages/ui/src/services/terminal.ts`, add the field to the interface next to `logs` (`:16`), and initialise it in the `createTab` object literal at `:204-205`:

```ts
  /** 终端与文件表的比例，0-1；null = 用 CSS 里的默认模板。跟着会话走，不进 localStorage。 */
  split: number | null
```

```ts
      sessionId: null, state: 'connecting', message: '正在连接…', logs: [], attempt: 0, split: null,
```

`ClientTerminal` owns tabs, `ClientSftp` owns the grip element, so the boundary is an event in each direction and no cross-injection — the same shape Plan 4 had to fall back to for `client/host-counts` after a direct injection turned out to be a cycle. Add beside `fit()` (`:380`):

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

There is no event to declare: the ratio is written and read inside one service. `session-change` and `tab-closed` are already wired to `sync()` (`features/sftp.ts:52-57`), and `sync()` is the one place that decides whether the
file table is open at all — so `paintSplit()` runs from there and no new event is needed. The draft of this task
emitted `client/split-change`; execution dropped it, because a ratio that only `ClientSftp` both writes and reads
does not need to be announced to the world, and every declared event is one more thing a later reader has to trace.

- [ ] **Step 4: Build the grip between the two panes**

`.session-content` has no id (`index.html:194`) and adding one would make it load-bearing for `ClientView.element()`, so reach it through `#terminal`, which is its first child. In `packages/ui/src/features/sftp.ts`, next to where the panel is created:

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

Call `ensureGrip()` from the same place `view.element('sftp')` is first used, and call `paintSplit()` after every `.files-open` toggle (`features/sftp.ts:49,92`) and on `client/split-change`.

- [ ] **Step 5: The drag and the keyboard**

Both write through `clientTerminal.setSplit()` and read back, so the tab is the only place a ratio is stored. `DEFAULT_SPLIT` is `1.35fr` against `1fr` plus the 5px track — the prototype's ratio restated as a number, so `Home` returns to what the CSS shows on first paint.

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

`sftp.ts` is a feature scope, so `this.scope` is already there — the same object `features/hosts.ts:45-58` binds its buttons through. Do **not** add a `DomListeners` to this service: that class exists for nodes rebuilt on every render (`sftp-panel.ts`'s rows), and a grip is bound once for the life of the scope.

Because `paintSplit()` is driven only by the event, a stored ratio and the on-screen template cannot disagree, and moving to another tab repaints that tab's own value — which is exactly what Step 1's last assertion tests.

- [ ] **Step 6: Draw the grip**

In `packages/ui/src/styles/terminal.css`:

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

`var(--t-2)` is `160ms`, which finally gives the duration ladder a consumer. Step 7 converts every remaining literal in the same sweep, so no half-tokenised duration survives the commit.

- [ ] **Step 7: Give the durations their token (this is the deferred Plan 2 item)**

The design register records that "the curve is tokenised while the number beside it is off the ladder, 20ms away from `--t-2`". Retire the literals in the four partials that carry them, so no off-ladder duration survives:

```bash
git grep -n "1[68]0ms" -- packages/ui/src/styles
```

Replace every `180ms` and every `160ms` with `var(--t-2)`, in `base.css`, `hosts.css`, `inspector.css`, `terminal.css`
and `keychain.css`. 180 is 20ms from `--t-2` and 60ms from `--t-3`, so `--t-2` is the rung it was reaching for; it also
keeps a host row and a key row animating at the same speed, which two different rungs would silently split. Fourteen
literals go, and the only `160ms` left in `styles/` is the declaration of `--t-2` itself. Run `node --test packages/ui/tests/*.test.mjs` — the hairline and colour guards do not read durations, so nothing should fail but the byte counts in `docs/design-system.md` change and Task 9 updates them.

- [ ] **Step 8: Verify**

```powershell
npm run build
node packages/ui/tests/smoke-client-lifecycle.mjs
```

Expected: `[SMOKE-OK]`.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/services/terminal.ts packages/ui/src/features/sftp.ts packages/ui/src/styles/terminal.css packages/ui/src/styles/base.css packages/ui/src/styles/hosts.css packages/ui/src/styles/inspector.css packages/ui/src/styles/keychain.css packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): drag the terminal and file table apart, and tokenise the durations"
```

---

## Task 3: The remote file list becomes a four-column table

**Files:**
- Modify: `packages/ui/src/sftp-panel.ts:166-189` and the assembly block `:118-130`
- Modify: `packages/ui/src/styles/terminal.css:21-30`
- Test: `packages/ui/tests/visual-contract.test.mjs`, `packages/ui/tests/client-lifecycle.browser.ts`

Columns, per the spec: Name, Size, Mode (octal), Modified. The prototype's proportions are `minmax(0,1fr) 62px 42px 74px` (`graphite-target.html:197`); the actions track is Plan 4's `24px`, and the header takes `--tx-3` — **not** the prototype's `--tx-4`, which the placeholder-only guard now rejects.

- [ ] **Step 1: Write the failing assertions**

```js
  assert.match(css, /\.file-columns,\s*\.file-row \{[^}]*minmax\(0,1fr\) 62px 42px 74px 24px/, 'the file header and its rows must share one template')
  assert.match(css, /\.file-mode/, 'mode is a column now, not an absent number')
```

and in the lifecycle suite, in the SFTP scenario that already lists a directory:

```ts
    assert(document.querySelector('.file-row')!.children.length === 5, 'a file row is name, size, mode, modified, actions')
    assert(/^\d{3,4}$/.test(document.querySelector('.file-mode')!.textContent!.trim()), 'mode renders as octal digits')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test packages/ui/tests/visual-contract.test.mjs && node packages/ui/tests/smoke-client-lifecycle.mjs`
Expected: both fail — the CSS regex has no match, and the row has 4 children.

- [ ] **Step 3: Show the mode**

`SftpEntry.mode` is the raw `attrs.mode` (`sftp-bridge.ts:455`), low 9 bits are `rwxrwxrwx`, and **0 means the peer sent no attributes** — which is not the same as `000`. Say so rather than printing `000`:

```ts
/** 对端没给属性时 mode 是 0（sftp-bridge.ts:455），那不是 000 权限，是「不知道」。 */
function octalMode(mode: number): string {
  if (!mode) return '—'
  return (mode & 0o7777).toString(8).padStart(3, '0')
}
```

- [ ] **Step 4: Rebuild the row as cells**

In `buildRow` (`sftp-panel.ts:166`), keep `.file-main` as the name cell (it carries the tags and the click/dblclick handlers) and append the three data cells before the actions span, mirroring what Plan 4 did to `.host-row`:

```ts
    main.append(top)
    item.append(main)
    // 目录的大小没有意义（不是 0，是「不适用」），写 0 会让人以为它是空目录
    item.append(cell('file-size', entry.isDirectory ? '—' : formatBytes(entry.size)))
    item.append(cell('file-mode', octalMode(entry.mode)))
    item.append(cell('file-time', formatTime(entry.mtime)))
```

Delete the two `main.append(span('file-size', …))` / `main.append(span('file-time', …))` lines (`:181-182`) so the fields become row children instead of flex children of the button, and reuse Plan 4's `cell()` helper — export it from `host-list.ts` rather than copy it:

```ts
// host-list.ts
export function cell(className: string, text: string, title?: string): HTMLSpanElement {
```

- [ ] **Step 5: Add the header row**

In the assembly block, before `list` (`:118`):

```ts
  const columns = document.createElement('div')
  columns.id = 'sftp-columns'
  columns.className = 'file-columns'
  columns.setAttribute('aria-hidden', 'true')
  for (const label of ['名称', '大小', '模式', '修改时间', '']) columns.append(document.createElement('span'))
```

and mount it inside `#sftp-body`, above `#sftp-list`, so it shares the list's padding exactly the way `#host-columns` does:

```ts
  body.append(columns, list, hint)
```

Hide it with the rows when there is nothing to show — the same `:has()` trick Plan 4 used, keyed on the existing hint element:

```css
#sftp-body:has(#sftp-hint:not([hidden])) #sftp-columns { display: none; }
```

- [ ] **Step 6: The template**

In `packages/ui/src/styles/terminal.css`, replace `.file-row`/`.file-main`/`.file-size`/`.file-time` (`:22-30`) with the shared-template shape:

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

`.file-mode` is left-aligned because `755` and `600` compare by shape, not by magnitude; the numerics that are compared by magnitude (size, time) stay right-aligned per the spec's `tabular-nums` requirement.

- [ ] **Step 7: Verify, then measure it live**

```powershell
npm run build
node --test packages/ui/tests/visual-contract.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
```

Expected: pass and `[SMOKE-OK]`. Then confirm against the running app that the header and row templates agree to the pixel, the way Plan 4's review had to: with a local SSH fixture and the file table open, run

```js
// evaluate_script in the in-app browser, against http://127.0.0.1:<port>/?token=…
() => {
  const cols = document.getElementById('sftp-columns')
  const row = document.querySelector('.file-row')
  const t = (e) => getComputedStyle(e).gridTemplateColumns
  return JSON.stringify({ cols: t(cols), row: t(row), aligned: t(cols) === t(row), h: row.getBoundingClientRect().height })
}
```

Report the measured object. `aligned: false` is a defect, not a rounding note — it was one of Plan 4's eight.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/sftp-panel.ts packages/ui/src/host-list.ts packages/ui/src/styles/terminal.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): lay the remote file list out as a four-column table"
```

---

## Task 4: The breadcrumb, without losing the type-a-path field

**Files:**
- Modify: `packages/ui/src/sftp-panel.ts:285-289` (`render`) and the assembly block
- Modify: `packages/ui/src/styles/terminal.css`
- Test: `packages/ui/tests/client-lifecycle.browser.ts`

`#sftp-path` is a deliberate affordance — the comment at `sftp-panel.ts:77-78` says going to `/var/log` should not require clicking down a dozen times. So this task **adds** a breadcrumb and keeps the input; it does not replace one with the other.

- [ ] **Step 1: Write the failing test**

```ts
    const crumbs = document.querySelector('.sftp-crumbs')!
    const parts = [...crumbs.querySelectorAll('button')].map(b => b.textContent)
    assert(parts.length >= 2 && parts[0] === '/', 'a breadcrumb starts at the root and names each hop')
    assert(parts.at(-1) === currentDirName, 'the last crumb is the directory you are in')
    crumbs.querySelectorAll('button')[1]!.click()
    await tick()
    assert(!pathInput.value.endsWith('//'), 'clicking a hop navigates to exactly that path')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node packages/ui/tests/smoke-client-lifecycle.mjs`
Expected: `[SMOKE-FAIL]` on `a breadcrumb starts at the root`.

- [ ] **Step 3: Build it from the path the server reported**

`SftpDir.path` is the **realpath** the peer resolved (`protocol.ts:201`), and `.` comes back as the home directory — so the crumbs must be built from what came back, never from what was asked for. In the assembly block:

```ts
  const crumbs = document.createElement('nav')
  crumbs.className = 'sftp-crumbs'
  crumbs.setAttribute('aria-label', '远端路径')
```

and a builder called from `render()` right after `pathInput.value` is set (`:287`):

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

and inside `render()`:

```ts
      crumbs.replaceChildren(...(dir ? buildCrumbs(dir.path) : []))
      crumbs.hidden = !dir || dir.path === '/'
```

Mount it as its own strip so the panel head keeps its five buttons: `root.append(head, crumbs, createBar, body)` (`:130`).

- [ ] **Step 4: Draw it**

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

- [ ] **Step 5: Verify and commit**

```powershell
npm run build
node packages/ui/tests/smoke-client-lifecycle.mjs
```

```bash
git add packages/ui/src/sftp-panel.ts packages/ui/src/styles/terminal.css packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): add a breadcrumb to the remote file table"
```

---

## Task 5: Read the stage out of the error the Host already wrote

**Files:**
- Create: `packages/ui/src/failure-diagnostics.ts`
- Test: `packages/ui/tests/failure-diagnostics.test.mjs`

The spec's decision (`specs/…-frontend-professional-redesign.md:141-145`) is that classification happens in the page and the feature stays inside `@pureterm/ui`. This works because `normalizeSshError` (`packages/host/src/services/ssh.ts:121-184`) already names the stage in prose, and its outputs are pinned by `apps/desktop/tests/smoke-host.mjs:38,53,94,97` — so the page can match them against a contract that a test already protects. Raw codes still arrive on the fallback path (`:183` wraps whatever ssh2 said), so the table matches both the Chinese sentence and the code that produced it.

**The verbatim Host sentences**, copied from the source rather than paraphrased — a wrong character is a silent miss, which is the exact failure the doc comment at `ssh.ts:117-119` warns about:

| stage | Host output |
| --- | --- |
| `local` | `主机地址不能为空。` `用户名不能为空。` `缺少认证凭据：填密码、选私钥文件，或让 ssh-agent 先加载好密钥。` `客户端已断开连接。` |
| `address` | `无法解析主机名 …` |
| `tcp` | `无法连接 …：目标端口拒绝连接…` `连接 … 超时：网络不可达，或端口被丢弃。` `与 … 的连接被重置。` |
| `handshake` | `SSH 连接在握手完成前已关闭。` `… 的 TCP 连接建立了，但对方在送出 SSH 横幅之前就断开了。` |
| `keyexchange` | `主机密钥已改变，可能是中间人攻击。…` `主机密钥校验失败：…` `Unable to negotiate` / `no matching` / `invalid algorithm` / `kex identities` |
| `auth` | `认证失败：用户名、密码或私钥不正确。` `这把私钥有口令保护…` `这个文件不是可识别的私钥…` `私钥无法解析：…` `Permission denied` / `All configured authentication methods failed` |
| `session` | `… 连上了、登录也成功了，但这台服务器没能开起 SFTP 子系统。` `Unable to start subsystem` / `establishing SFTP session` / `Channel open failure` |

- [ ] **Step 1: Write the failing test**

`packages/ui/tests/failure-diagnostics.test.mjs`:

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
  assert.equal(result.breakAt, -1)
})

test('every stage folds onto one of the four drawn nodes', () => {
  // The nodes in index.html are 本机 / TCP / 密钥交换 / 认证. These four numbers
  // are the fold; a stage that maps to an index nobody renders is the bug this
  // assertion exists to keep out.
  assert.equal(diagnose('无法解析主机名 x。').breakAt, 1, 'DNS belongs to the TCP node')
  assert.equal(diagnose('SSH 连接在握手完成前已关闭。').breakAt, 1, 'a banner that never arrived is still the TCP node')
  assert.equal(diagnose('认证失败：用户名、密码或私钥不正确。').breakAt, 3)
  assert.equal(diagnose('Unable to start subsystem: sftp').breakAt, 4, 'past auth: all four nodes passed')
  for (const [message] of CASES) {
    const at = diagnose(message).breakAt
    assert.ok(at >= 0 && at <= 4, `${message} maps outside the drawn route: ${at}`)
  }
})

test('a classified failure carries a next step', () => {
  for (const [message, stage] of CASES) {
    const result = diagnose(message)
    assert.match(result.suggestion, /\S/, `${stage} needs a next step, not a shrug`)
    assert.ok(result.suggestion.length <= 120, `${stage}'s suggestion is a lecture: ${result.suggestion}`)
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/ui/tests/failure-diagnostics.test.mjs`
Expected: FAIL — `Cannot find module …/failure-diagnostics.ts`.

- [ ] **Step 3: Write the module**

`packages/ui/src/failure-diagnostics.ts`:

```ts
export const STAGES = ['local', 'address', 'tcp', 'handshake', 'keyexchange', 'auth', 'session'] as const
export type Stage = (typeof STAGES)[number]

export interface Failure {
  /** null = 认不出来，此时路线整条塌掉，而不是猜一段。 */
  stage: Stage | null
  /** 断在哪个节点：0..3；4 = 四个节点都过了（认证之后才失败）；-1 = 塌了。 */
  breakAt: number
  title: string
  suggestion: string
}

/**
 * 七个阶段画到四个节点上，这张表就是那次折叠的唯一实现处。
 *
 * 节点只有四个（本机 / TCP / 密钥交换 / 认证），阶段有七个，所以必须有人负责说
 * 「address 属于 TCP 那一格」。不折叠的话 index 会直接拿 STAGES 的下标去点 DOM，
 * 于是 TCP 失败会把「密钥交换」点亮 —— 一个说错在哪里的诊断页比没有诊断页更坏。
 */
export const NODE_OF: Record<Stage, number> = {
  local: 0, address: 1, tcp: 1, handshake: 1, keyexchange: 2, auth: 3, session: 4,
}
export const NODE_COUNT = 4

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
  if (!hit) return { stage: null, breakAt: -1, title: '连接失败', suggestion: '' }
  return { stage: hit.stage, breakAt: NODE_OF[hit.stage], title: hit.title, suggestion: hit.suggestion }
}
```

- [ ] **Step 4: Run the test**

Run: `node --test packages/ui/tests/failure-diagnostics.test.mjs`
Expected: PASS, three tests.

- [ ] **Step 5: Prove the guard can fail**

Change one table entry temporarily so `无法解析主机名` no longer matches, run the test, and confirm it reports `misclassified: 无法解析主机名 jump.example.com。`. Revert. Record in the commit message that this was done — Plan 4's review found that a green guard which cannot go red is worth nothing, and this file's whole value is the table.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/failure-diagnostics.ts packages/ui/tests/failure-diagnostics.test.mjs
git commit -m "feat(ui): classify connection failures by the stage the host named"
```

---

## Task 6: Draw four nodes and say where it stopped

**Files:**
- Modify: `packages/ui/src/index.html:211-215`
- Modify: `packages/ui/src/services/terminal.ts:262-284` (`render`) and `:305-345`
- Modify: `packages/ui/src/styles/states.css:18,23-29`
- Test: `packages/ui/tests/visual-contract.test.mjs`, `packages/ui/tests/client-lifecycle.browser.ts`

- [ ] **Step 1: Write the failing assertions**

```js
  assert.match(html, /class="failure-route"[^>]*aria-hidden="true"/, 'the route is decoration alongside text, not a second announcement')
  assert.match(css, /\.failure-route-node\.is-failed/, 'the route must be able to mark one node')
  assert.match(css, /\.failure-route-line\.is-break/, 'and break the link where it died')
  assert.doesNotMatch(css, /\.failure-route-node\s*\{[^}]*var\(--err\)/, 'no node may be red just for existing')
  assert.match(css, /\.failure-host \.host-avatar\s*\{[^}]*var\(--r-4\)/, 'a 58px avatar does not take the 20px chip corner')
  assert.doesNotMatch(css, /border-radius:\s*999px/, '--r-full exists; do not re-invent it')
```

and in the lifecycle suite, in the scenario at `client-lifecycle.browser.ts:330-342` that already throws `'fixture connection refused'`:

```ts
    const nodes = [...document.querySelectorAll('.failure-route-node')]
    assert(nodes.length === 4, 'the route is the four drawn stages')
    assert.equal(nodes.filter(n => n.classList.contains('is-failed')).length, 1, 'exactly one node failed')
    assert([...nodes].findIndex(n => n.classList.contains('is-failed')) === 1, 'ECONNREFUSED must light the TCP node, not the key-exchange one')
    assert.match(document.getElementById('failure-suggestion')!.textContent!, /sshd/, 'the page says what to do next')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test packages/ui/tests/visual-contract.test.mjs`
Expected: FAIL on `the route must be able to mark one node`.

- [ ] **Step 3: Markup**

`index.html:211-215` becomes a static four-node skeleton that the page fills in — static so the page never renders an empty strip, and `aria-hidden` because the stage is also stated in words below it:

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

The four nodes are 本机 / TCP / 密钥交换 / 认证, which is the spec's list (`:143`). `handshake` and `session` fold onto the TCP and auth ends rather than becoming two more dots, and the fold is written down in the module above so a reader can find it.

- [ ] **Step 4: Paint it**

Replace `states.css:23-29`:

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

Add the suggestion element to the markup, after `#failure-log`: `<p id="failure-suggestion" class="failure-suggestion"></p>`.

- [ ] **Step 5: Drive it from the catch**

In `services/terminal.ts`, add `import { diagnose, stageLabel, type Failure } from '../failure-diagnostics.js'` beside the other sibling imports, then in `connectTab`'s catch (`:335-337`) — which already stores `tab.logs` and `tab.message` — store the diagnosis too:

```ts
      tab.failure = diagnose(cleanError(error))
```

Declare `failure: Failure | null` on `TerminalTab` next to `split`, initialise it to `null` in `createTab`, and clear it both on a successful open and at the top of a retry — a stale route pointing at the old failure is worse than no route. Then in `render()`, next to the existing log loop (`:277-282`, where `view` is the local `this.ctx.clientView` that `:263` already uses):

```ts
    const failure = active.failure
    const route = view.element('connection-failure').querySelectorAll<HTMLElement>('.failure-route-node')
    const lines = view.element('connection-failure').querySelectorAll<HTMLElement>('.failure-route-line')
    view.element('connection-failure').classList.toggle('route-collapsed', !failure || failure.breakAt < 0)
    for (const [index, node] of [...route].entries()) {
      // breakAt === 4 (an after-auth failure) makes every node 'passed', which
      // is the honest picture: the route worked, something downstream did not.
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

`.route-collapsed` is what the spec's last sentence asks for — when nothing is recognised, the strip must not pretend:

```css
/* Unclassified: the spec's "collapses to a single failure node and the page
   degrades to the log block". */
.route-collapsed .failure-route { display: none; }
```

- [ ] **Step 6: The log block the spec described**

The same spec sentence (`:143`) asks for "a `--c-inset` mono block with non-selectable line numbers and error lines tinted `--err`". The ground and the tint already exist (`states.css:30-34`); the numbers do not, and a user copying a log should not have to copy the gutter with it.

In `render()`'s log loop (`services/terminal.ts:277-282`), give each entry its number as a separate node rather than as text:

```ts
      const number = this.ctx.clientView.document.createElement('span')
      number.className = 'failure-log-no'
      number.setAttribute('aria-hidden', 'true')
      number.textContent = String(index + 1)
      row.prepend(number)
```

and in `states.css`:

```css
/* The block is mono because every line of it is machine output; the gutter is a
   separate node with user-select: none so selecting the log for "Copy logs" does
   not carry "1 2 3" into the paste. The button already assembles the text. */
.failure-log { font-family: var(--font-mono); font-size: var(--fs-meta); line-height: 1.65; }
.failure-log-entry { display: grid; grid-template-columns: 2.5ch 16px minmax(0, 1fr); gap: 10px; }
.failure-log-no { color: var(--tx-3); font-variant-numeric: tabular-nums; text-align: right; user-select: none; }
.failure-log-entry i { margin-top: 0; }
```

The existing `.failure-log-entry { display: flex }` (`:31`) is replaced by the grid, and its `i { margin-top: 2px }` override is deleted because the grid's alignment does that job. Assert it:

```js
  assert.match(css, /\.failure-log-no\s*\{[^}]*user-select:\s*none/, 'line numbers must not ride along into a pasted log')
  assert.match(css, /\.failure-log\s*\{[^}]*var\(--font-mono\)/, 'the log is machine output and should look like it')
```

- [ ] **Step 7: Verify and commit**

```powershell
npm run build
node --test packages/ui/tests/visual-contract.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
```

Expected: pass and `[SMOKE-OK]`. Then fail a connection against the running app three different ways — a hostname that will not resolve, a port nothing listens on, and a wrong password — and report which node lit up each time. The route is only worth having if it *disagrees* between those three; if all three point at the same dot, the classifier is decorative.

```bash
git add packages/ui/src/index.html packages/ui/src/services/terminal.ts packages/ui/src/styles/states.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): show which stage a failed connection stopped at"
```

---

## Task 7: Toasts for the things that already happened

**Files:**
- Create: `packages/ui/src/services/toasts.ts`
- Modify: `packages/ui/src/index.html`, `packages/ui/src/client.ts`, `packages/ui/src/features/hosts.ts`, `packages/ui/src/features/keychain.ts`, `packages/ui/src/features/sftp.ts`, `packages/ui/src/services/terminal.ts`
- Modify: `packages/ui/src/styles/states.css`
- Test: `packages/ui/tests/visual-contract.test.mjs`, `packages/ui/tests/client-lifecycle.browser.ts`

**Scope, deliberately narrower than the spec's sentence.** The spec says a toast "replaces the scattered `#status` text nodes" (`:151`). Three of those lines are not event notifications and must not become auto-dismissing:

- `hosts.ts:302` sets a *standing* instruction ("新建主机：填好地址和用户名后点「保存」"). A notice that vanishes is not an instruction.
- `hosts.ts:355,389` follow a failed submit by focusing the offending field. The message has to still be there when the user's eyes arrive.
- `keychain.ts:283` is a validation line tied to the field above it.

So: `#status` and `#keychain-status` stay inline and keep their tint contract (`design-tokens.test.mjs:211` measures `#status.ok` on its own ground). Toasts take the *completed* events — saved, deleted, copied, connected, closed, upload finished — which today are the ones a user misses because they land in a form they have already left.

- [ ] **Step 1: Write the failing test**

The suite has no fake clock (`client-lifecycle.browser.ts` only awaits `tick()`), so do not assert that five seconds passed — assert the two things that are actually observable and one constant that a node test can pin:

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

and in `packages/ui/tests/visual-contract.test.mjs`, alongside the other `html`/`css` assertions, pin the lifetime and the stack rules that the browser suite cannot wait out:

```js
  assert.match(html, /id="toasts" class="toasts" aria-live="polite"/, 'toasts need their mount point or ClientToasts never boots')
  assert.match(css, /\.toasts\s*\{[^}]*var\(--z-toast\)/, 'the toast layer draws its own z-index token')
  assert.match(css, /\.toasts\s*\{[^}]*calc\(var\(--status-h\)/, 'and clears the status bar by construction, not by a literal')
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.toast\s*\{\s*animation:\s*none/, 'a notice that slides must be able to stop sliding')
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test packages/ui/tests/visual-contract.test.mjs && node packages/ui/tests/smoke-client-lifecycle.mjs`
Expected: the visual contract fails on the mount point, and `[SMOKE-FAIL]` on `saving a host must announce itself`.

- [ ] **Step 3: The mount point**

In `index.html`, as the last child of `.app-shell` (after the status bar element), so a fixed-position toast clears the bar by construction:

```html
      <div id="toasts" class="toasts" aria-live="polite"></div>
```

- [ ] **Step 4: The service**

`packages/ui/src/services/toasts.ts`, following `ClientChrome`'s shape exactly — a `Service` with a `static inject` list, `super(ctx, '<name>')`, and a `ClientScope` it owns:

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

Register it in `packages/ui/src/client.ts`: add `'toasts'` to the `scopes` key union at `:16`, and add `toasts: context.plugin(ClientToasts)` at `:32-40` — **before** `hosts`, `keychain` and `sftp`, because they inject it. Consumers name it through the module augmentation the same way `'clientChrome'` is named: add `interface Context { clientToasts: ClientToasts }` beside the existing `clientView` declaration in `client-runtime.ts`, then `static inject = ['clientView', 'clientToasts']` on each feature that notifies, and reach it as `this.ctx.clientToasts.notify(...)`.

- [ ] **Step 5: The CSS**

In `states.css`, after the dialog block. The prototype's `.toast` (`graphite-target.html:171-177`) is the shape; the numbers come from the register:

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

- [ ] **Step 6: Move the event writers**

Each of these currently calls `view.status(...)` for a *completed* action; route them at the toast and leave the rest alone:

| site | today | becomes |
| --- | --- | --- |
| `hosts.ts:74` | `已保存「label」` | `notify({ title: '已保存主机', detail: record.label })` |
| `hosts.ts:341` | `已删除「label」` | `notify({ title: '已删除主机', detail: label })` |
| `hosts.ts:366` | `已连接，但保存主机失败…` | `notify({ title: '已连接，但保存失败', detail: cleanError(error), kind: 'err' })` **and** keep the inline `#status` write |
| `keychain.ts:298` | `密钥已保存…` | `notify({ title: '密钥已保存' })` |
| `terminal.ts` on `opened` | nothing today | `notify({ title: '已连接', detail: \`${host}:${port}\` })` |
| `terminal.ts` on `closed`/`ended` | `#session-state` text only | `notify({ title: '连接已结束', detail: reason, kind: 'err' })` when the tab is not the active one |
| `sftp-panel.ts:312` `setHint` on upload/delete success | in-panel line | `notify(...)` **plus** the line, since the panel is where the user is looking |

Do **not** convert: `hosts.ts:75,275,302,355,388-391,407`, `keychain.ts:71,283,289`. Those are instructions, focus-linked prompts, or in-progress lines, and `#sftp-hint`'s empty-directory line is a standing state, not an event.

- [ ] **Step 7: Verify, and prove the assertion is load-bearing**

```powershell
npm run build
node --test packages/ui/tests/*.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
```

Then prove the two assertions that are load-bearing. Make `dismiss()` a no-op and expect the suite to fail on `a notice you have read is dismissible by clicking it`; make `notify()` always write `role="status"` and expect the failure on `a normal notice must not interrupt a screen reader`. Revert both. `SHOWING` itself is not asserted anywhere: no fake clock exists in this suite, so a five-second wait would be the slowest test in the repo and would still only prove the timer fired once. Say so in the report rather than implying the lifetime is covered.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/services/toasts.ts packages/ui/src/client.ts packages/ui/src/index.html packages/ui/src/styles/states.css packages/ui/src/features/hosts.ts packages/ui/src/features/keychain.ts packages/ui/src/features/sftp.ts packages/ui/src/services/terminal.ts packages/ui/src/sftp-panel.ts packages/ui/tests/client-lifecycle.browser.ts packages/ui/tests/visual-contract.test.mjs
git commit -m "feat(ui): toast the things that already happened"
```

---

## Task 8: The four states, on the two lists that do not have them

**Files:**
- Modify: `packages/ui/src/features/hosts.ts`, `packages/ui/src/features/keychain.ts`
- Modify: `packages/ui/src/styles/states.css`, `packages/ui/src/styles/hosts.css`
- Test: `packages/ui/tests/visual-contract.test.mjs`, `packages/ui/tests/client-lifecycle.browser.ts`

The spec (`:149`) wants loading / empty / error / degraded on every list. Empty exists on both screens (`#hosts-empty`, `#keychain-empty`), Plan 4's `:has()` rule ties the header to it, and the backend-unavailable case is what `hosts:list` rejection currently does silently. What is missing is the skeleton and the degraded banner.

- [ ] **Step 1: Write the failing test**

The shared fixture's `hosts.list` resolves immediately (`client-lifecycle.browser.ts:28`), so a skeleton would be gone before anything can look. Build one scenario on a list you control:

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

The third assertion is the one that matters most: `renderHostList()` currently sets `#hosts-empty.hidden = visible.length > 0`, so an empty *first* frame would show "还没有保存的主机" for one tick before the data arrives. `renderSkeleton()` has to hide it too, and restore it.

- [ ] **Step 2: Run it to verify it fails**

Run: `node packages/ui/tests/smoke-client-lifecycle.mjs`
Expected: `[SMOKE-FAIL]` on `a list that is still loading shows placeholder rows`.

- [ ] **Step 3: Skeleton rows, at the height the real rows will take**

In `features/hosts.ts`, before the first `hosts:list` resolves, render placeholders into the same container:

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

Call it from `activate()` before the list request, and make sure the real `render()` replaces the container's children (it already does). One polite line carries the announcement instead of the rows:

```html
<p class="list-status" role="status">正在读取主机列表…</p>
```

which `renderHostList()` clears along with the skeleton.

- [ ] **Step 4: The CSS**

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

`--row-h` is the density-aware token, so compact density shortens the skeleton too — the ladder the design register says is now live stays live.

- [ ] **Step 5: Degraded versus broken**

Neither block exists yet, so add both to `index.html` inside `#hosts-panel`, between `.hosts-heading` and `#hosts-body` — above the table, because both are about the list as a whole and hiding them behind a scroll is how a guarantee stops being one:

```html
            <p id="hosts-error" class="list-error" role="alert" hidden><span class="list-error-title"></span><span class="list-error-detail"></span><button type="button" id="hosts-retry" class="ghost small">重新加载</button></p>
            <p id="hosts-degraded" class="list-error is-warn" hidden></p>
```

A rejected list is currently silent: `refresh()` (`features/hosts.ts:234-236`) awaits `api.hosts.list()` and lets the rejection travel. Wrap that one call, because the two kinds of failure need different recoveries:

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

The re-throw is deliberate: `refresh()`'s callers already treat a rejection as "this reload did not happen", and swallowing it here would turn a visible error into a silent one with a red paragraph on top.

```ts
  private setListError(title: string, detail: string): void {
    const block = this.ctx.clientView.element('hosts-error')
    block.hidden = false
    block.querySelector<HTMLElement>('.list-error-title')!.textContent = title
    block.querySelector<HTMLElement>('.list-error-detail')!.textContent = detail
  }
```

`#hosts-retry` re-runs the same list request the `activate()` path already performs. The degraded banner is the *capability* case — a Desktop build whose `credentialPersistence !== 'encrypted'`, or a Web session whose keychain cannot persist — and it is warn-tinted rather than error-tinted because nothing has failed:

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

The `keychain.ts` list gets the same three states through its own `#keychain-notice`, which already exists — give it `.list-error` rather than a fourth pattern.

Add the assertions while you are here:

```js
  assert.match(css, /\.list-error\.is-warn/, 'a capability being off must not look like an operation failing')
  assert.match(html, /id="hosts-error"[^>]*role="alert"/, 'a list that could not load must announce itself to a screen reader')
```

- [ ] **Step 6: Verify and commit**

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

## Task 9: Documents, corrections, and looking at it

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` (`_zh`)
- Modify: `docs/superpowers/prototype/graphite-target.html`
- Modify: `docs/design-system.md` (`_zh`), `CHANGELOG.md` (`_zh`), `packages/ui/src/lib/changelog.ts`
- Modify: `docs/superpowers/plans/2026-09-24-session-screens.md` (`_zh`)

- [ ] **Step 1: Write the spec corrections, dated**

The spec's sections on failure diagnostics (`:141-145`) and Terminal/SFTP (`:135-137`) asked for two things the stack cannot express. The precedent in this repo is a dated "Corrected <date>, at execution" note that states the fact rather than rewriting the paragraph. Add both:

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

Also correct the two facts this plan's exploration contradicted:

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

Mirror every paragraph into `..._zh.md`.

- [ ] **Step 1b: Re-sync the Chinese pair**

`2026-09-24-session-screens_zh.md` was translated from an earlier revision of this file, and this plan has since changed twice on its own account: the `@media (max-width: 820px)` stack step and the stage→node fold both landed after the translation was taken. Re-run the block-by-block sync and report the delimiter, checkbox and heading counts for the two files, as the repo rule requires the pair to be complete rather than approximately equivalent.

- [ ] **Step 2: Correct the prototype**

It is the single visual source of truth for the remaining work, so two values in it now contradict a guard:

- `.srow.h { … color: var(--tx-4) … }` (`:199`) and `.es span`, `.es .ic` (`:281-282`) use `--tx-4` as text. The `::placeholder`-only rule in `stylesheet-contract.test.mjs` rejects that, and the measured reasons are in `docs/design-system.md`. Change all three to `--tx-3`.
- Add a one-line comment above each: `/* was --tx-4; the register forbids it as text — see docs/design-system.md */`.

- [ ] **Step 3: Update the register**

Re-measure rather than guess — the numbers in that document are labelled as measurements:

```powershell
node -e "const fs=require('fs');const p='packages/ui/src/styles/';const c=['base','chrome','hosts','inspector','keychain','terminal','states'];let n=0;for(const f of c)n+=(fs.readFileSync(p+f+'.css','utf8').match(/var\(--[a-z0-9-]+\)/g)||[]).length;console.log('content var() refs:',n);for(const t of ['t-1','t-2','t-3','z-toast','r-full','grip-w','row-h'])console.log(t,(fs.readFileSync(p+'style.css','utf8'),c.map(f=>fs.readFileSync(p+f+'.css','utf8')).join('').split('var(--'+t+')').length-1))"
```

Then update, in both language files: the census sentence (`381` and whatever the new total is), the metric bullet's reference count, and the "sixteen tokens still unreachable" claim — `--t-2`, `--t-3` and `--z-toast` now have consumers, so that list shrinks and the sentence about "no consumer is not neutral" for durations becomes false and must be rewritten, not deleted. Add the byte/line table rows for `terminal.css` and `states.css`, and add `--grip-w` to the chrome-geometry row.

- [ ] **Step 4: CHANGELOG, and the generated files**

Under `[Unreleased] → Changed`, replace the sentence that still describes the vertical fixed split, and add the toast sentence. Under `Fixed`, add what genuinely changed behaviour for a user: that a failed connection now says which step failed, and that the file table showed a mode no one could see.

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```

Expected: `Changelog and workspace versions are valid for 0.1.0-alpha.1.` Commit `packages/ui/src/lib/changelog.ts` with the documents.

- [ ] **Step 5: Run the whole thing**

```powershell
npm run verify
npm run verify:electron
```

Both must exit 0. Report the numbers that actually printed.

- [ ] **Step 6: Look at it**

```powershell
npm run start:web
npm run start:desktop
```

Against the running app, report on each, in the order a user would meet them: (a) does the split feel like one surface rather than two panels that happen to touch, and does the grip read as grabbable at 5px; (b) drag it, switch tabs, come back — is the ratio the session's own; (c) is the file table readable next to the hosts table, or does 28px row height against the hosts' 38px look like two different apps; (d) does the breadcrumb help or duplicate the path field; (e) **fail a connection on purpose** — a bad host, a closed port, a wrong password, a host key changed — and check the route points at the right node every time and that the suggestion is something you would act on; (f) do toasts cover anything they should not, and is five seconds long enough to read the longest one; (g) load the app with the network cut so the list errors, and check "backend unavailable" is distinguishable from "this one operation failed"; (h) **switch to the light theme and look at all of it** — Plan 4's review still could not get eyes on it.

- [ ] **Step 7: Report honestly, then finish**

Anything not checked, say so and say why. Append a `## What execution found` section to this plan and its translation with the deviations and the defects Task 9 finds, exactly as Plans 3 and 4 do. Commit, then push the branch — do not merge to `main` and do not open a pull request.

---

## <a id="corrections-this-plan-must-write"></a>Corrections this plan must write

Collected here so none of them gets quietly dropped between tasks:

1. Row-level SFTP transfer progress cannot be built on `write(dir, name, bytes)` + `terminal:*`-only events. Task 9, [Step 1](#task-9-documents-corrections-and-looking-at-it).
2. A persisted split ratio is pointless on standalone Web (rotating origin). Implemented per-tab. Task 9 Step 1.
3. The spec's `grid-template-rows` sentence left two mechanisms on one element. Task 1; documented in Step 1.
4. Seven classified stages, four nodes. Task 5/6; documented in Step 1.
5. `--tx-4` in the prototype is now illegal as text, in three places. Task 9 Step 2.
6. The design register's "the durations have no consumers" census line becomes false. Task 9 Step 3 — rewrite it, do not delete it.
7. The spec's "a toast replaces the scattered `#status` nodes" is true for completed events and false for instructions and field-validation prompts. Task 7 states the split.

## Done criteria

- The terminal and the file table are two columns with a grip that drags, takes keyboard input, announces itself as a separator, and returns each session's own ratio.
- The remote file list is a four-column table whose header shares its template with its rows, `mode` is on screen for the first time, and the breadcrumb sits above it without replacing the path field.
- A failed connection names the step it failed at, marks the steps it got through, breaks the line where it stopped, and degrades to the log block when it cannot tell.
- Completed events reach the user as toasts with the right `role`, a five-second life, and a three-deep stack; inline prompts stayed inline.
- Both library lists have loading, empty, error and degraded shapes, and the placeholders are not `.host-row`.
- Every duration and radius in the cascade comes from the ladder, and the register's census says so with measured numbers.
- `npm run verify` and `npm run verify:electron` pass, each new guard has been seen to fail, and the light theme has been looked at by a human.

## Not in this plan

- A real transfer-progress channel, cipher/host-key-type/uptime on the session payload, and last-connected — all three need a `@pureterm/protocol` change and the consumer sweep that comes with it.
- Installer and taskbar icons.
- The mobile drawer below 620px, recorded as a gap by Plan 4's review.

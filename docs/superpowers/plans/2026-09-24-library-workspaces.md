# Library Workspaces Implementation Plan

[中文版本](2026-09-24-library-workspaces_zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hosts and Keychain read as instrument panels — a five-column table with a header row, an editing surface that docks into the grid instead of covering the list, a persistent encryption banner, and one breakpoint set shared by both screens.

**Architecture:** The `.app-body` grid gains a third track driven by a new `--insp-w` token, so the connection editor stops being an `position: absolute; inset: 0` overlay and becomes a column that the hosts panel is never padded against. `host-list.ts` keeps its `<li class="host-row" data-id>` / `<button class="host-main">` / `[data-act]` shape — every one of those is asserted by the lifecycle test — and adds four sibling cells that line up with a new header row through one shared `grid-template-columns` declaration. Card view survives as an explicit `.card-view` class, which **inverts the default** and therefore requires the two lifecycle assertions about the view toggle to be updated, not deleted.

**Tech Stack:** CSS custom properties, grid templates, TypeScript DOM construction, Node's built-in test runner, the Electron-driven `client-lifecycle.browser.ts` behaviour suite.

**Target design:** `docs/superpowers/prototype/graphite-target.html`, screens ① and ③.

---

## Prerequisites and current facts

Read `AGENTS.md`, `docs/design-system.md`, and the "What execution found" section at the end of each of the three completed plans. Verified against the tree at `efe5947`:

- `HostRecord` (`packages/protocol/src/protocol.ts:61-73`) is `{ id, label, host, port, username, authMethod, privateKeyPath?, keyId?, hasSecret, updatedAt }`. **There is no last-connected timestamp.** `updatedAt` is the save time, written by `packages/host/src/plugins/session-store.ts:226,233`, and nothing in the UI renders it today. The design's "Last connected" column therefore cannot be built honestly; this plan ships an **Updated** column and corrects the spec.
- Key source is decidable from the record: `keyId` means keychain, `privateKeyPath` means a local file, and `session-store.ts:243-244` deletes `privateKeyPath` whenever `keyId` is set, so they are mutually exclusive. Both are dropped for password auth, and both are absent when `credentialPersistence !== 'encrypted'`.
- The algorithm name is **not** on the host record. It is on `KeyRecord.type` (`protocol.ts:135-143`), and `ClientKeychain` already exposes `get records(): readonly KeyRecord[]` (`features/keychain.ts:104`) to a service that already injects it (`features/hosts.ts:11`). So a host's Auth cell can resolve `keyId → type`, and must degrade to `key · keychain` when the key list has not loaded or the id is stale.
- The editor is today `index.html` `#connection-workspace` → `#toolbar`, styled `position: absolute; inset: 0 0 0 auto; width: min(500px, calc(100% - 14px))` (`inspector.css:9,14`) inside `#main { position: relative; overflow: hidden }` (`hosts.css:10`). Three rules exist only to push the hosts panel out of its way: `hosts.css:65` `padding-right: 516px` at ≥1450, `:72` and `:83` undoing that below 820 and 620.
- `.drawer-open` on `#app` is added at `features/hosts.ts:172`, removed at `:179` and at `services/terminal.ts:240`. No test asserts the class name.
- The Keychain editor is **already a docked flex column**: `keychain.css:36` `.keychain-editor { flex: 0 0 clamp(360px, 28vw, 500px); border-left }`. It is the pattern to copy, and the two editors should end up the same width from the same token.
- `#keychain-policy` is **not** the invisible empty node the spec claims: `features/keychain.ts:126-127` writes it with one of two strings once capabilities resolve. The spec sentence gets a dated correction, not a silent rewrite.
- Breakpoints in the files this plan touches: `hosts.css` 1250 / 1450 / 820 / 620 (and a **second** `@media (max-width: 620px)` block at `:86-89` that overrides the first one's `#main` and `#hosts-panel` rules); `keychain.css` 1100 / 900 plus container queries at 1200 and 630; `inspector.css` 820 / 620. The agreed target is three: **1100 / 820 / 620**.
- Selectors the lifecycle suite asserts and that must survive: `.host-row[data-id]`, `.host-main`, `[data-act="edit"]`, `[data-act="delete"]`, `.host-row.active`, `.keychain-card`, `.keychain-card-main`, `.keychain-card-edit`, `#connection-workspace` `.hidden`, `#keychain-editor` `.hidden`, `#hosts-panel`, `#keychain-panel`. Ids read through the test's `input()` helper are listed at `client-lifecycle.browser.ts` and none may be renamed — `ClientView.element()` throws on a missing id (`client-runtime.ts:55-59`).
- Two assertions **do** change, because the default view inverts: `client-lifecycle.browser.ts:249-251` (`#host-list.list-view` after one toggle click) and `:98` (`#keychain-list.list-view`). Task 5 rewrites them to the new class with the same meaning — "the toggle moved the list to the other view".
- `visual-contract.test.mjs:36` regex-asserts `.app-body`'s two-track grid verbatim; Task 1 updates it in the same commit that changes the grid.

## Commands

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run build
npm run verify
npm run verify:electron
npm run release:check
```

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/ui/src/styles/tokens.css` | `--insp-w`. | Modify |
| `packages/ui/tests/design-tokens.test.mjs` | Metric parity for the new step. | Modify |
| `packages/ui/src/styles/chrome.css` | The three-track `.app-body` grid. | Modify |
| `packages/ui/tests/visual-contract.test.mjs` | The grid assertion. | Modify |
| `packages/ui/src/styles/inspector.css` | Editor as a docked column; shared field/section language. | Modify |
| `packages/ui/src/styles/hosts.css` | Table columns, header row, card view, breakpoints. | Modify |
| `packages/ui/src/styles/keychain.css` | Key table columns, banner, breakpoints. | Modify |
| `packages/ui/src/host-list.ts` | Five cells per row, Auth resolution, relative date. | Modify |
| `packages/ui/src/features/hosts.ts` | `inspector-open`, view state as a field, Auth input. | Modify |
| `packages/ui/src/features/keychain.ts` | Table cells, view state, banner. | Modify |
| `packages/ui/src/services/terminal.ts` | The other `drawer-open` remover. | Modify |
| `packages/ui/src/index.html` | Header rows, toggle labels. | Modify |
| `packages/ui/tests/client-lifecycle.browser.ts` | Column, dock and toggle behaviour. | Modify |
| `docs/…`, `CHANGELOG*.md`, `packages/ui/src/lib/changelog.ts` | Record it. | Modify |

---

### Task 1: The Inspector width token and the three-track grid

**Files:**
- Modify: `packages/ui/src/styles/tokens.css` (after `--status-h`)
- Modify: `packages/ui/tests/design-tokens.test.mjs:44-56`
- Modify: `packages/ui/src/styles/chrome.css:98`
- Modify: `packages/ui/tests/visual-contract.test.mjs:36`

- [ ] **Step 1: Teach the metric guard**

In `design-tokens.test.mjs`, extend the comment and the list so the chrome group reads:

```js
  // The chrome's own geometry. These are the only place a shell size is written
  // down, and theme-sync.test.mjs ties the Electron title-bar overlay to
  // --chrome-h, so a second copy of a number cannot appear silently.
  '--chrome-h', '--rail-w', '--status-h', '--insp-w',
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test "packages/ui/tests/design-tokens.test.mjs"`
Expected: FAIL — `:root is missing --insp-w`.

- [ ] **Step 3: Declare it**

In `tokens.css`, change the geometry block to:

```css
  /* Chrome geometry. --chrome-h is the height Electron's title-bar overlay is
     told to reserve, so theme-sync.test.mjs reads it as the single source.
     --insp-w is the docked editor: both the connection form and the key editor
     take it, so the two screens cannot drift to two different widths. */
  --chrome-h: 40px;
  --rail-w: 52px;
  --status-h: 24px;
  --insp-w: 322px;
```

- [ ] **Step 4: Move the grid onto it, with the dock as a state**

In `chrome.css`, replace the `.app-body` line with:

```css
.app-body { display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); min-height: 0; overflow: hidden; }
/* The editor is a track, not a layer: when it opens the list narrows instead of
   being covered, so no rule anywhere has to know the editor's width in order to
   push content out of its way. */
.app-shell.inspector-open .app-body { grid-template-columns: var(--rail-w) minmax(0, 1fr) var(--insp-w); }
```

- [ ] **Step 5: Update the grid assertion**

In `visual-contract.test.mjs`, replace line 36 with:

```js
  assert.match(css, /grid-template-columns:\s*var\(--rail-w\)\s+minmax\(0,\s*1fr\)\s+var\(--insp-w\)/, 'the docked editor must be a grid track, not an overlay')
  assert.match(css, /\.app-shell\.inspector-open\s+\.app-body\s*\{[^}]*var\(--insp-w\)/, 'the third track must appear only while the editor is open')
```

- [ ] **Step 6: Run the guards and commit**

```powershell
node --test "packages/ui/tests/*.test.mjs"
```
```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs packages/ui/src/styles/chrome.css packages/ui/tests/visual-contract.test.mjs
git commit -m "feat(ui): add the inspector width token and the docked grid track"
```

---

### Task 2: Dock the connection editor

**Files:**
- Modify: `packages/ui/src/styles/inspector.css:9-16,80-92`
- Modify: `packages/ui/src/styles/hosts.css:10,60-89`
- Modify: `packages/ui/src/features/hosts.ts:172,179`
- Modify: `packages/ui/src/services/terminal.ts:240`

- [ ] **Step 1: Make the workspace a column instead of a layer**

In `inspector.css`, replace lines 8-16 (the `/* Connection workbench */` comment through `.connection-workspace.is-session #toolbar`) with:

```css
/* Connection workbench. Docked, not overlaid: the hosts list stays visible and
   narrows, which is what the old padding-right compensation was faking. */
.connection-workspace { display: none; min-width: 0; min-height: 0; overflow: hidden; }
.app-shell.inspector-open .connection-workspace { display: flex; }
.connection-workspace[hidden] { display: none !important; }
#toolbar { display: flex; width: 100%; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; padding: 0; border-left: 1px solid var(--line); background: var(--c-surface); }
.connection-workspace.is-session { display: block; pointer-events: auto; }
.connection-workspace.is-session #toolbar { display: none; }
```

`#main` keeps `position: relative` (the failure view is still absolutely placed inside it), but loses the job of being the drawer's containing block.

- [ ] **Step 2: Delete the three compensation rules**

In `hosts.css`, delete:
- the whole `@media (min-width: 1450px)` block (the `padding-right: 516px` rule);
- `.app-shell.drawer-open #hosts-panel { padding-right: 16px; }` from the 820 block;
- `.app-shell.drawer-open #hosts-panel { padding-right: 10px; }` from the first 620 block.

- [ ] **Step 3: Rename the state**

In `packages/ui/src/features/hosts.ts`, change line 172 from

```ts
    this.ctx.clientView.element('app').classList.add('drawer-open')
```

to

```ts
    this.ctx.clientView.element('app').classList.add('inspector-open')
```

and line 179 from `remove('drawer-open')` to `remove('inspector-open')`. In `services/terminal.ts:240`, change `app.classList.remove('drawer-open')` to `app.classList.remove('inspector-open')`.

- [ ] **Step 4: Prove the old name is gone**

```powershell
git grep -n "drawer-open" -- packages apps
```
Expected: no output.

- [ ] **Step 5: Verify**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
```
Expected: all green. The lifecycle suite is the real check here — it asserts `#connection-workspace.hidden` at four sites, and a dock that never opens fails them.

```powershell
npm run verify:electron
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/styles/inspector.css packages/ui/src/styles/hosts.css packages/ui/src/features/hosts.ts packages/ui/src/services/terminal.ts
git commit -m "feat(ui): dock the connection editor into the app grid"
```

---

### Task 3: The hosts table

**Files:**
- Modify: `packages/ui/src/host-list.ts`
- Modify: `packages/ui/src/styles/hosts.css`
- Modify: `packages/ui/src/index.html:69-73`

- [ ] **Step 1: Add the header row to the markup**

In `index.html`, replace the `#hosts-body` block (lines 69-73) with:

```html
            <div id="hosts-body">
              <div id="host-columns" class="host-columns" role="presentation">
                <span>名称</span><span>地址</span><span>用户</span><span>认证</span><span>更新</span><span></span>
              </div>
              <ul id="host-list" aria-label="已保存的主机"></ul>
              <p id="hosts-empty" class="empty">还没有保存的主机。<br />点击「新建主机」开始建立连接。</p>
            </div>
```

`role="presentation"` because the columns are decoration for a list that is already labelled; a real `<th>` would need the rows to be a table, and the rows must stay `<li>` for the lifecycle selectors.

- [ ] **Step 2: Give a row its four extra cells**

In `host-list.ts`, replace `buildRow` (lines 69-114) with:

```ts
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
  content.append(span('host-label', record.label))
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

  item.append(main,
    cell('mono', `${record.host}:${record.port}`),
    cell('', record.username),
    cell(`auth auth-${auth.kind}`, auth.text),
    cell('when', relative(record.updatedAt)),
    actions)
  if (saved) item.querySelector('.host-content')!.append(saved)
  return item
}
```

Add `KeyRecord` to the protocol import at line 1:

```ts
import type { HostRecord, KeyRecord } from '@pureterm/protocol'
```

and drop `toneFor` (lines 48-52) — it produced `tone-0`…`tone-3`, which no rule has read since the palette flip.

- [ ] **Step 3: Thread the key list through the view**

In `host-list.ts`, change the handler-facing signature and the render call:

```ts
export interface HostListView {
  dispose(): void
  /** 重画。`selectedId` 命中的那一行高亮；命中不了就都不高亮。 */
  render(records: HostRecord[], selectedId: string | null, keys?: readonly KeyRecord[]): void
  select(selectedId: string | null): void
}
```

and inside the returned object:

```ts
    render(records, selectedId, keys = []) {
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
```

- [ ] **Step 4: Pass it from the feature**

`features/hosts.ts` renders the list in exactly one place. Line 221 changes from

```ts
    this.list.render(visible, this.selectedId)
```

to

```ts
    this.list.render(visible, this.selectedId, this.ctx.clientKeychain.records)
```

and the key list is already injected (`features/hosts.ts:11` lists `clientKeychain` in `static inject`).

- [ ] **Step 5: Style the table**

In `hosts.css`, replace lines 3-7 (the `#host-list.list-view` block and the pressed toggle) with:

```css
/* One column template, shared by the header and the rows, so the two can never
   drift apart by a fourth value nobody noticed. */
.host-columns,
.host-row { display: grid; grid-template-columns: minmax(0,1.5fr) 1.2fr .9fr 1fr 1fr 24px; align-items: center; gap: 12px; }
.host-columns { height: 26px; padding: 0 10px; color: var(--tx-4); font-size: var(--fs-micro); letter-spacing: .06em; text-transform: uppercase; border-bottom: 1px solid var(--line-soft); }
.host-cell { min-width: 0; overflow: hidden; color: var(--tx-2); font-size: var(--fs-meta); text-overflow: ellipsis; white-space: nowrap; }
.host-cell.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.host-cell.when { color: var(--tx-3); }
.auth-keychain { color: var(--tx-2); }
.auth-file { color: var(--tx-3); }
.auth-password { color: var(--tx-3); }
#host-view-toggle[aria-pressed="true"] { background: var(--c-control); }
```

Then replace the `#host-list` rule (line 36) and the card-view rules so cards are the opt-in:

```css
#host-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; margin: 0; padding: 0 12px; list-style: none; }
#host-list.card-view { grid-template-columns: repeat(3, minmax(220px, 1fr)); gap: 16px; }
#host-list.card-view .host-row { grid-template-columns: minmax(0, 1fr); align-items: flex-start; min-height: 91px; }
#host-list.card-view .host-row .host-cell { display: none; }
#host-list.card-view .host-avatar { width: 59px; height: 59px; }
#host-list.card-view .host-content { gap: 6px; }
```

and in `.host-row` (line 41) change `min-height: 91px` to `min-height: var(--row-h)` and `padding: 0 10px` onto `.host-main` as `padding: 0` — the row's own grid supplies the spacing. Keep `.host-row`, `.host-row:hover`, `.host-row.active`, `.host-avatar`, `.host-label`, `.tag`, `.host-actions` and the `button.mini` rules exactly as they are.

- [ ] **Step 6: Flip the hosts toggle in the same commit**

The `.card-view` rules above are dead until the button produces that class, and the class it produces today (`list-view`) has no rules left — so the rename ships with the CSS, not two commits later. In `features/hosts.ts`, replace the handler at lines 50-53 with:

```ts
    this.scope.listen(view.element('host-view-toggle'), 'click', () => {
      // The class and the reported state are derived from one value, so they
      // cannot disagree the way a separate boolean field could.
      const cards = view.element('host-list').classList.toggle('card-view')
      view.element('host-view-toggle').setAttribute('aria-pressed', String(cards))
    })
```

Then in `client-lifecycle.browser.ts`, replace lines 249-251 with the pair of gestures the new default implies:

```ts
    click('host-view-toggle')
    assert(document.getElementById('host-list')!.classList.contains('card-view'), 'the toggle must move the hosts list to card view')
    assert(input('host-view-toggle').getAttribute('aria-pressed') === 'true', 'the toggle must report card view is on')
    click('host-view-toggle')
    assert(!document.getElementById('host-list')!.classList.contains('card-view'), 'the toggle must return the list to the table')
    assert(input('host-view-toggle').getAttribute('aria-pressed') === 'false', 'and report it')
```

The assertion is about the toggle working, not about which view is the default, so it keeps its meaning while the default moves underneath it.

- [ ] **Step 7: Verify**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
node packages/ui/tests/smoke-client-lifecycle.mjs
```
Expected: PASS. `client-lifecycle.browser.ts` still finds `.host-row[data-id]`, `.host-main` and `[data-act="edit"]` because the element shapes are unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/host-list.ts packages/ui/src/features/hosts.ts packages/ui/src/index.html packages/ui/src/styles/hosts.css packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): lay the hosts list out as a five-column table"
```

---

### Task 4: The keychain table and its banner

**Files:**
- Modify: `packages/ui/src/features/keychain.ts:153-203`
- Modify: `packages/ui/src/styles/keychain.css`
- Modify: `packages/ui/src/index.html:76-92`

- [ ] **Step 1: Add the header row**

In `index.html`, inside `.keychain-content`, immediately before `<ul id="keychain-list" …>`, insert:

```html
                <div id="keychain-columns" class="host-columns" role="presentation">
                  <span>名称</span><span>类型</span><span>指纹 SHA256</span><span>关联</span><span>创建</span>
                </div>
```

- [ ] **Step 2: Give a key card its cells**

`card()` at `features/keychain.ts:169-203` builds `<li class="keychain-card">` → `.keychain-card-main` button, then `row.append(main)`, then the optional `.keychain-card-edit`, then `list.append(row)`. Insert the four cells between the main button and the edit button.

First add two helpers just above `card()`:

```ts
  private cell(className: string, text: string, title = ''): HTMLElement {
    const element = this.ctx.clientView.document.createElement('span')
    element.className = `host-cell ${className}`
    element.textContent = text
    if (title) element.title = title
    return element
  }

  /** 关联主机数从主机列表算，而不是让后端多长一个字段：记录本来就在渲染层手里。 */
  private associationCount(id: string): number {
    return this.ctx.clientHosts.records.filter(host => host.keyId === id).length
  }
```

Then inside `card()`, replace the single line `row.append(main)` with:

```ts
    row.append(main)
    if (key) {
      const usage = this.associationCount(key.id)
      row.append(
        this.cell('', key.type),
        this.cell('mono', key.fingerprint.replace(/^SHA256:/, '')),
        this.cell('when', usage ? `${usage} host${usage === 1 ? '' : 's'}` : '未使用', usage ? '' : '尚无主机使用这把密钥'),
        this.cell('', new Date(key.updatedAt).toLocaleDateString()),
      )
    } else {
      row.append(this.cell('', '—'), this.cell('mono', '—'), this.cell('when', '—'), this.cell('', '—'))
    }
```

The draft card keeps four cells so the grid does not collapse its columns when a key is being created.

- [ ] **Step 3: Expose the host records**

`associationCount` reads a list `ClientKeychain` does not currently own. `features/hosts.ts:15` holds `private hosts: HostRecord[] = []` and already exposes `get count()` at line 109; add the sibling getter there:

```ts
  get records(): readonly HostRecord[] { return this.hosts }
```

and let `ClientKeychain` reach it by extending `static inject` at `keychain.ts:9`:

```ts
  static inject = ['clientView', 'clientTransport', 'clientTerminal', 'clientHosts']
```

This is a renderer-internal read of another renderer feature's cache, not a new transport surface: both live in `@pureterm/ui`, and `features/hosts.ts:11` already proves the reverse direction is established practice.

- [ ] **Step 4: Style it, and reuse the one column template**

In `keychain.css`, give the key rows and their header the five-column template. Note that the `<ul>` itself stays a single-column stack of rows — only the card and the header carry the columns:

```css
/* Five columns, the same shape the hosts table uses, so moving between the two
   screens does not re-learn a grid. The list stays one row per line. */
#keychain-columns,
.keychain-card { grid-template-columns: minmax(0,1.2fr) 1fr 1.5fr 62px 74px; }
```

Keep every existing `.keychain-card*` selector and class name. Then point the editor at the shared token by replacing `keychain.css:36`'s `flex: 0 0 clamp(360px, 28vw, 500px)` with:

```css
.keychain-editor { flex: 0 0 var(--insp-w); }
```

- [ ] **Step 5: Make the banner persistent and visible**

`#keychain-policy` is already written at `keychain.ts:126-127`; it is styled at `keychain.css:12` as a plain paragraph. Turn it into the banner the design asks for by replacing that rule with:

```css
/* The never-plaintext guarantee is the one thing a user cannot infer from the
   UI, so it is a banner above the list rather than a line of small text. */
#keychain-policy { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; padding: 8px 10px;
  color: var(--tx-2); font-size: var(--fs-meta); background: var(--c-surface);
  border: 1px solid var(--line); border-left: 2px solid var(--ac); border-radius: var(--r-2); }
```

- [ ] **Step 6: Flip the keychain toggle with its CSS**

Same reason as the hosts toggle: `.card-view` is dead and `list-view` is gone the moment Step 4 lands. Replace the `#keychain-view` handler in `features/keychain.ts` with:

```ts
    this.scope.listen(view.element('keychain-view'), 'click', () => {
      const cards = view.element('keychain-list').classList.toggle('card-view')
      view.element('keychain-view').setAttribute('aria-pressed', String(cards))
    })
```

and in `client-lifecycle.browser.ts` line 98, which asserts the old class after one click:

```ts
    assert(input('keychain-list').classList.contains('card-view'), 'the key list toggle must reach card view')
```

- [ ] **Step 7: Verify and commit**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
node packages/ui/tests/smoke-client-lifecycle.mjs
npm run typecheck
```
```bash
git add packages/ui/src/features/keychain.ts packages/ui/src/features/hosts.ts packages/ui/src/index.html packages/ui/src/styles/keychain.css packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): lay the keychain list out as a table and promote its policy banner"
```

---

### Task 5: Name the toggle for what it does, and retire the old class

Both toggles now ship with their own table, so what is left is the language: the two buttons describe the view you are *leaving*, and `list-view` must be gone from the tree entirely or the next reader will look for rules that no longer exist.

**Files:**
- Modify: `packages/ui/src/index.html:57,81`
- Modify: `packages/ui/tests/visual-contract.test.mjs`

- [ ] **Step 1: Assert the table structurally before touching prose**

In `visual-contract.test.mjs`, add to the first test after the `#connection-failure` assertion:

```js
  assert.match(html, /id="host-columns"[^>]*class="host-columns"/, 'the hosts table needs a header row to sit above the rows')
  assert.match(html, /id="keychain-columns"[^>]*class="host-columns"/, 'the key table shares that header shape')
  assert.match(css, /\.host-columns,\s*\.host-row \{ display: grid;[^}]*minmax\(0,1\.5fr\)/, 'the header and the rows must share one column template')
```

Run: `node --test "packages/ui/tests/visual-contract.test.mjs"`
Expected: PASS — Tasks 3 and 4 created these. If the first two fail, the ids or the class order drifted; fix the markup rather than the assertion, because the assertion is the thing that keeps the two tables one design.

- [ ] **Step 2: Make both buttons name what a click produces**

In `index.html`, replace the hosts toggle (line 57):

```html
                <button type="button" id="host-view-toggle" class="tool-icon" aria-label="切换到卡片视图" aria-pressed="false" title="切换到卡片视图"><i class="ti ti-list" aria-hidden="true"></i></button>
```

and the keychain toggle (line 81):

```html
                  <button type="button" id="keychain-view" class="tool-icon" aria-label="切换到卡片视图" aria-pressed="false" title="切换到卡片视图"><i class="ti ti-list" aria-hidden="true"></i></button>
```

Both now say what will happen, and the icon is the list glyph because the button is what leaves the list — the pressed background from `hosts.css` and `keychain.css` carries the other half of the state.

- [ ] **Step 3: Prove the old class is gone**

```powershell
git grep -n "list-view" -- packages apps docs
```
Expected: no output. `list-view` was the only name for the stacked layout, and both screens now reach it by not having `card-view`.

- [ ] **Step 4: Verify and commit**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
npm run verify:electron
```
```bash
git add packages/ui/src/index.html packages/ui/tests/visual-contract.test.mjs
git commit -m "fix(ui): name the view toggles for the view they switch to"
```

---

### Task 6: Three breakpoints

The touched partials currently carry 1250 / 1450 / 1100 / 900 / 820 / 620 plus two container queries, and `hosts.css` has **two** `@media (max-width: 620px)` blocks where the second silently overrides the first. Collapse to 1100 / 820 / 620.

**Files:**
- Modify: `packages/ui/src/styles/hosts.css:60-89`
- Modify: `packages/ui/src/styles/keychain.css:14,15,63-68,70`
- Modify: `packages/ui/src/styles/inspector.css:80-92`

- [ ] **Step 1: Merge the duplicate 620 block in hosts.css**

Replace everything from `@media (max-width: 1250px)` (line 60) to the end of the file with:

```css
@media (max-width: 1100px) {
  #host-list.card-view { grid-template-columns: repeat(2, minmax(190px, 1fr)); }
}

@media (max-width: 820px) {
  .dashboard-toolbar { align-items: flex-start; flex-direction: column; }
  .dashboard-tools { align-self: flex-end; }
  #host-list.card-view { grid-template-columns: minmax(0, 1fr); }
  .host-columns,
  .host-row { grid-template-columns: minmax(0,1.6fr) 1fr 24px; }
  /* Row children are main, address, user, auth, updated, actions — so the two
     that go are nth-child(3) and (4), and the header drops its third and fourth
     spans to match. Name, address and the actions stay. */
  .host-row .host-cell:nth-child(3), .host-row .host-cell:nth-child(4),
  .host-columns span:nth-child(3), .host-columns span:nth-child(4) { display: none; }
}

@media (max-width: 620px) {
  #main { min-height: 0; overflow: hidden; }
  #hosts-panel { height: 100%; min-height: 0; overflow: auto; padding: 12px 10px 24px; }
  .host-search-row { margin-bottom: 18px; }
  .dashboard-toolbar { margin-bottom: 20px; }
  .dashboard-actions { max-width: 100%; flex-wrap: wrap; }
  .hosts-heading { margin-right: 6px; margin-left: 6px; }
  #host-list { padding: 0 6px; }
}
```

The 820 rule drops the User and Auth columns rather than shrinking them to unreadable width; Name, Address and the actions stay. The two 620 blocks are now one, and it keeps the *second* block's `overflow: hidden` model, which was the one actually winning.

- [ ] **Step 2: Bring keychain.css onto the same three**

In `keychain.css`, replace the two `@container` queries (lines 14-15) and the `@media (max-width: 1100px)` and `@media (max-width: 900px)` blocks with:

```css
@media (max-width: 1100px) {
  #keychain-columns,
  .keychain-card { grid-template-columns: minmax(0,1.2fr) 1fr 1.5fr; }
  /* Card children are main, type, fingerprint, usage, created, edit — so the two
     that go at three columns are nth-child(4) and (5). */
  .keychain-card .host-cell:nth-child(4), .keychain-card .host-cell:nth-child(5),
  #keychain-columns span:nth-child(4), #keychain-columns span:nth-child(5) { display: none; }
  .keychain-editor { position: absolute; inset: 0 0 0 auto; z-index: 6; width: min(var(--insp-w), 100%); }
}

@media (max-width: 820px) {
  #keychain-columns,
  .keychain-card { grid-template-columns: minmax(0,1fr) 24px; }
  .keychain-card .host-cell, #keychain-columns span:not(:first-child) { display: none; }
}
```

`.keychain-dashboard` keeps `position: relative` so the 1100 overlay fallback has a containing block; delete the old 900 and 630 rules.

- [ ] **Step 3: Inspector keeps 820 and 620 only**

In `inspector.css`, the 820 block's `#toolbar { width: … }` rule is now wrong for a docked column — delete that width line and keep the block only if it still says something; then reduce the 620 block to:

```css
@media (max-width: 620px) {
  .credential-row { display: flex; align-items: stretch; }
  .credential-row .field { flex: 1 1 100%; }
  .key-row > button { flex: 1 1 120px; align-self: end; }
  .toolbar-head { min-height: 76px; padding-left: 16px; }
  .drawer-scroll, .drawer-footer { padding-right: 16px; padding-left: 16px; }
}
```

- [ ] **Step 4: Prove the retired breakpoints are gone**

```powershell
git grep -n "max-width: 1250\|min-width: 1450\|max-width: 900\|max-width: 630\|min-width: 1200" -- packages/ui/src/styles
```
Expected: no output. Then confirm each remaining partial names only the three:

```powershell
git grep -c "1100\|820\|620" -- packages/ui/src/styles
```

- [ ] **Step 5: Verify and commit**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
```
```bash
git add packages/ui/src/styles/hosts.css packages/ui/src/styles/keychain.css packages/ui/src/styles/inspector.css
git commit -m "refactor(ui): collapse the workspace breakpoints to three"
```

---

### Task 7: Documents, record, and look

**Files:**
- Modify: `docs/design-system.md`, `docs/design-system_zh.md`
- Modify: `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` + `_zh.md`
- Modify: `CHANGELOG.md`, `CHANGELOG_zh.md`
- Modify: `packages/ui/src/lib/changelog.ts` (generated)

- [ ] **Step 1: Correct two spec claims, as dated annotations**

In the spec's `## Hosts workspace`, append:

```md
  - **Corrected 2026-09-24, at execution:** the fifth column is **Updated**, not "Last connected". `HostRecord` carries `updatedAt`, which the session store writes on save, and no last-connection timestamp exists anywhere in the protocol or the Host. Adding one is a `@pureterm/protocol` change with its own plan.
```

and in `## Keychain workspace`, append:

```md
  - **Corrected 2026-09-24, at execution:** `#keychain-policy` was not an invisible empty node — `features/keychain.ts` writes it with one of two strings once capabilities resolve. It was still promoted to a banner, because a line of small text under a heading is not the same thing as a guarantee the user can see.
```

Mirror both in the `_zh.md` spec.

- [ ] **Step 2: Update the design-system document**

In `docs/design-system.md`: add `--insp-w` to the Chrome geometry row of the metrics table and to the `:root` arithmetic (75 → 76, metrics 24 → 25); correct the breakpoint sentence if one names the old set; recompute the consumer census with the same method the previous two plans used — read the partials, count `var(--x)` — rather than editing numbers down. Then re-run the byte and line column for the four partials that changed.

- [ ] **Step 3: Record the user-visible change**

`CHANGELOG.md` under `### Changed`:

```md
- Hosts and Keychain are now tables with a header row: name, address, user, authentication and last-saved date for hosts; name, type, fingerprint, associated hosts and creation date for keys. Card view is one click away and no longer the default. The authentication column says whether a key came from the keychain or a local file, which is the fact that decides whether a host is usable.
- The connection editor docks into the window instead of covering the host list, at the same 322px as the key editor, and the two now share one width token.
- Breakpoints across the workspace screens collapse from six to three (1100 / 820 / 620). Below 820 the hosts table drops the user and authentication columns rather than squeezing them.
```

under `### Fixed`:

```md
- Two `@media (max-width: 620px)` blocks in the hosts stylesheet were silently overriding each other's scroll model; there is now one.
```

Mirror in `CHANGELOG_zh.md`, then:

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```

- [ ] **Step 4: Commit the documents**

```bash
git add docs/ CHANGELOG.md CHANGELOG_zh.md packages/ui/src/lib/
git commit -m "docs(ui): record the library workspace rebuild"
```

- [ ] **Step 5: Look at it**

This step changes nothing and must not be skipped.

```powershell
npm run start:web
npm run start:desktop
```

Against the running app, report on each: (a) does the five-column table read as one object, and is the header row's relationship to the rows obvious; (b) is the Auth column actually the thing you look at first when deciding whether to connect; (c) with the editor docked, does the hosts list stay readable and does selecting a row while editing behave; (d) at 1100 and 820, do the dropped columns go quietly rather than looking truncated; (e) does the keychain banner read as a guarantee instead of decoration; (f) **switch to the light theme and look at all of it** — the light group has never been seen by a human eye, and Plan 3's notes say so; (g) click the card-view toggle and check the two views are both deliberate.

- [ ] **Step 6: Report honestly**

Anything not checked, say so. A value changed under a green suite is how the old palette acquired its second set of hand-copied colours once already: if the table reads wrong because of a token, write the measured pair into the report and open it as a correction, do not silently re-pick the number.

---

## Done criteria

- `--insp-w` is the only written editor width, shared by the connection form and the key editor, and it is a `:root`-only metric the parity guard knows about.
- Hosts and Keychain render as five-column tables with a header row that shares their column template, and every selector the lifecycle suite relies on still resolves — the suite grew assertions rather than losing them.
- Card view is opt-in on both screens and the toggle's reported state cannot disagree with the class it sets.
- `git grep` finds no `drawer-open`, no 1250/1450/900/630 breakpoint, and no second 620 block in `hosts.css`.
- The spec carries two dated corrections instead of being quietly rewritten.
- `npm run verify` and `npm run verify:electron` pass, and the light theme has been looked at.

## Not in this plan

- Plan 5: the session screens — the draggable terminal/SFTP split, the four states, toasts replacing `#status`, and failure diagnostics with the four-node route.
- A last-connected timestamp, and the `@pureterm/protocol` change that would expose cipher, host key type and uptime.
- Installer icons.

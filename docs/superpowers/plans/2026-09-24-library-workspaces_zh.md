# 各屏工作区实施计划

[English version](2026-09-24-library-workspaces.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。步骤用 checkbox（`- [ ]`）语法跟踪。

**Goal：** 让 Hosts 与 Keychain 读起来像仪器面板 —— 一张带列标题的五列表格、一个嵌进网格而不遮住清单的编辑面、一条常驻的加密横幅，以及两个屏幕共用的一套断点。

**Architecture：** `.app-body` 网格由新的 `--insp-w` token 驱动出第三轨，于是连接编辑器不再是 `position: absolute; inset: 0` 覆盖层，而是一轨 —— 再没有哪条规则需要为了躲开它而知道它的宽度。`host-list.ts` 保留 `<li class="host-row" data-id>` / `<button class="host-main">` / `[data-act]` 的形状 —— 每一个都被生命周期测试断言着 —— 只新增四个同级单元格，与新的列标题行透过同一份 `grid-template-columns` 声明对齐。卡片视图作为显式的 `.card-view` 存活，这**反转了默认视图**，因此关于视图开关的两条生命周期断言必须被更新，而不是被删掉。

**Tech Stack：** CSS 自定义属性、网格模板、TypeScript DOM 构造、Node 内置测试运行器、Electron 驱动的 `client-lifecycle.browser.ts` 行为套件。

**目标设计：** `docs/superpowers/prototype/graphite-target.html` 第 ① 与 ③ 屏。

---

## 前置知识与当前事实

请读 `AGENTS.md`、`docs/design-system.md`，以及已完成的三份计划末尾的「执行所发现的」一节。以下均在提交 `efe5947` 的代码树上核实：

- `HostRecord`（`packages/protocol/src/protocol.ts:61-73`）是 `{ id, label, host, port, username, authMethod, privateKeyPath?, keyId?, hasSecret, updatedAt }`。**任何地方都没有最后连接时间。** `updatedAt` 是保存时间，由 `packages/host/src/plugins/session-store.ts:226,233` 写入，而 UI 今天哪也没渲染它。因此设计里的「Last connected」一列无法诚实地建立；本计划交付的是 **Updated** 列，并更正规格。
- 密钥来源可以从记录判定：`keyId` 表示密钥库，`privateKeyPath` 表示本机文件，而 `session-store.ts:243-244` 在 `keyId` 存在时会删掉 `privateKeyPath`，所以两者互斥；密码认证时两者都被丢弃，且当 `credentialPersistence !== 'encrypted'` 时两者都不存在。
- 算法名**不在**主机记录上，而在 `KeyRecord.type`（`protocol.ts:135-143`）上；`ClientKeychain` 已经暴露 `get records(): readonly KeyRecord[]`（`features/keychain.ts:104`），而 `ClientHosts` 本就注入了它（`features/hosts.ts:11`）。所以主机的认证单元格能把 `keyId → type` 查出来，查不到时必须退化成 `key · keychain`。
- 编辑器今天是 `index.html` 的 `#connection-workspace` → `#toolbar`，样式为 `position: absolute; inset: 0 0 0 auto; width: min(500px, calc(100% - 14px))`（`inspector.css:9,14`），定位父级是 `#main { position: relative; overflow: hidden }`（`hosts.css:10`）。有三条规则存在的唯一理由就是把主机面板推开：`hosts.css:65` 在 ≥1450 处 `padding-right: 516px`，`:72` 与 `:83` 在 820 与 620 以下又把它撤销。
- `#app` 上的 `.drawer-open` 在 `features/hosts.ts:172` 添加、`:179` 移除，另在 `services/terminal.ts:240` 移除。没有任何测试断言这个类名。
- Keychain 编辑器**已经**是嵌在 flex 里的一轨：`keychain.css:36` `.keychain-editor { flex: 0 0 clamp(360px, 28vw, 500px); border-left }`。它就是可抄的形状，而两个编辑面最后应当同宽并来自同一个 token。
- `#keychain-policy` **不是**规格所说的「用户永远看不见的空文本节点」：`features/keychain.ts:126-127` 在能力解析后用它写入两句之一。规格那句要加带日期的更正，而不是悄悄改写。
- 本计划触及的文件里的断点：`hosts.css` 1250 / 1450 / 820 / 620（而且 `:86-89` 还有**第二个** `@media (max-width: 620px)` 块，把第一个块的 `#main` 与 `#hosts-panel` 规则覆盖掉）；`keychain.css` 1100 / 900 加两条容器查询 1200 与 630；`inspector.css` 820 / 620。商定的目标是三个：**1100 / 820 / 620**。
- 生命周期套件断言、且必须存活的 selector：`.host-row[data-id]`、`.host-main`、`[data-act="edit"]`、`[data-act="delete"]`、`.host-row.active`、`.keychain-card`、`.keychain-card-main`、`.keychain-card-edit`、`#connection-workspace` 的 `.hidden`、`#keychain-editor` 的 `.hidden`、`#hosts-panel`、`#keychain-panel`。测试用 `input()` 助手读取的 id 全列在 `client-lifecycle.browser.ts` 中，一个都不能改名 —— `ClientView.element()` 遇到缺失 id 会抛错（`client-runtime.ts:55-59`）。
- 有两条断言**确实**要改，因为默认视图反转了：`client-lifecycle.browser.ts:249-251`（点一次开关后 `#host-list.list-view`）与 `:98`（`#keychain-list.list-view`）。任务 3 与任务 4 把它们改写成新类，含义不变 —— 「开关把清单切到了另一种视图」。
- `visual-contract.test.mjs:36` 逐字正则断言 `.app-body` 的两轨网格；任务 1 在改网格的同一个提交里更新它。

## 命令

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run build
npm run verify
npm run verify:electron
npm run release:check
```

## 文件结构

| 文件 | 职责 | 改动 |
| --- | --- | --- |
| `packages/ui/src/styles/tokens.css` | `--insp-w`。 | 修改 |
| `packages/ui/tests/design-tokens.test.mjs` | 新档位的度量一致性。 | 修改 |
| `packages/ui/src/styles/chrome.css` | 三轨 `.app-body` 网格。 | 修改 |
| `packages/ui/tests/visual-contract.test.mjs` | 网格断言。 | 修改 |
| `packages/ui/src/styles/inspector.css` | 编辑器成为嵌入轨；共享的字段/分区语言。 | 修改 |
| `packages/ui/src/styles/hosts.css` | 表格列、列标题行、卡片视图、断点。 | 修改 |
| `packages/ui/src/styles/keychain.css` | 密钥表列、横幅、断点。 | 修改 |
| `packages/ui/src/host-list.ts` | 每行五个单元格、认证解析、相对日期。 | 修改 |
| `packages/ui/src/features/hosts.ts` | `inspector-open`、视图状态、认证输入。 | 修改 |
| `packages/ui/src/features/keychain.ts` | 表格单元格、视图状态、横幅。 | 修改 |
| `packages/ui/src/services/terminal.ts` | 另一处 `drawer-open` 移除点。 | 修改 |
| `packages/ui/src/index.html` | 列标题行、开关标签。 | 修改 |
| `packages/ui/tests/client-lifecycle.browser.ts` | 列、嵌入轨与开关行为。 | 修改 |
| `docs/…`、`CHANGELOG*.md`、`packages/ui/src/lib/changelog.ts` | 记录。 | 修改 |

---

### 任务 1：Inspector 宽度 token 与三轨网格

**文件：**
- 修改：`packages/ui/src/styles/tokens.css`（`--status-h` 之后）
- 修改：`packages/ui/tests/design-tokens.test.mjs:44-56`
- 修改：`packages/ui/src/styles/chrome.css:98`
- 修改：`packages/ui/tests/visual-contract.test.mjs:36`

- [ ] **步骤 1：先教度量守卫**

在 `design-tokens.test.mjs` 里，把注释与列表改成：

```js
  // The chrome's own geometry. These are the only place a shell size is written
  // down, and theme-sync.test.mjs ties the Electron title-bar overlay to
  // --chrome-h, so a second copy of a number cannot appear silently.
  '--chrome-h', '--rail-w', '--status-h', '--insp-w',
```

- [ ] **步骤 2：运行它，确认失败**

运行：`node --test "packages/ui/tests/design-tokens.test.mjs"`
预期：FAIL —— `:root is missing --insp-w`。

- [ ] **步骤 3：声明它**

在 `tokens.css` 中，把几何块改为：

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

- [ ] **步骤 4：把网格搬到它上面，并把编辑面做成一个状态**

在 `chrome.css` 中，把 `.app-body` 那行替换为：

```css
.app-body { display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); min-height: 0; overflow: hidden; }
/* The editor is a track, not a layer: when it opens the list narrows instead of
   being covered, so no rule anywhere has to know the editor's width in order to
   push content out of its way. */
.app-shell.inspector-open .app-body { grid-template-columns: var(--rail-w) minmax(0, 1fr) var(--insp-w); }
```

- [ ] **步骤 5：更新网格断言**

在 `visual-contract.test.mjs` 中，把第 36 行替换为：

```js
  assert.match(css, /grid-template-columns:\s*var\(--rail-w\)\s+minmax\(0,\s*1fr\)\s+var\(--insp-w\)/, 'the docked editor must be a grid track, not an overlay')
  assert.match(css, /\.app-shell\.inspector-open\s+\.app-body\s*\{[^}]*var\(--insp-w\)/, 'the third track must appear only while the editor is open')
```

- [ ] **步骤 6：跑守卫并提交**

```powershell
node --test "packages/ui/tests/*.test.mjs"
```
```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs packages/ui/src/styles/chrome.css packages/ui/tests/visual-contract.test.mjs
git commit -m "feat(ui): add the inspector width token and the docked grid track"
```

---

### 任务 2：把连接编辑器嵌进网格

**文件：**
- 修改：`packages/ui/src/styles/inspector.css:9-16,80-92`
- 修改：`packages/ui/src/styles/hosts.css:10,60-89`
- 修改：`packages/ui/src/features/hosts.ts:172,179`
- 修改：`packages/ui/src/services/terminal.ts:240`

- [ ] **步骤 1：让工作区变成一轨而不是一个层**

在 `inspector.css` 中，把第 8-16 行（`/* Connection workbench */` 注释到 `.connection-workspace.is-session #toolbar`）替换为：

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

`#main` 保留 `position: relative`（失败视图仍要绝对定位在它内部），但不再充当抽屉的包含块。

- [ ] **步骤 2：删掉三条补偿规则**

在 `hosts.css` 中删除：
- 整个 `@media (min-width: 1450px)` 块（`padding-right: 516px`）；
- 820 块里的 `.app-shell.drawer-open #hosts-panel { padding-right: 16px; }`；
- 第一个 620 块里的 `.app-shell.drawer-open #hosts-panel { padding-right: 10px; }`。

- [ ] **步骤 3：改名**

在 `packages/ui/src/features/hosts.ts` 中，把第 172 行从

```ts
    this.ctx.clientView.element('app').classList.add('drawer-open')
```

改为

```ts
    this.ctx.clientView.element('app').classList.add('inspector-open')
```

第 179 行的 `remove('drawer-open')` 改为 `remove('inspector-open')`。在 `services/terminal.ts:240` 把 `app.classList.remove('drawer-open')` 改为 `app.classList.remove('inspector-open')`。

- [ ] **步骤 4：证明旧名已死**

```powershell
git grep -n "drawer-open" -- packages apps
```
预期：无输出。

- [ ] **步骤 5：验证**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
```
预期：全绿。真正的检查是生命周期套件 —— 它在四处断言 `#connection-workspace.hidden`，一个永远打不开的嵌入轨会让它们失败。

```powershell
npm run verify:electron
```

- [ ] **步骤 6：提交**

```bash
git add packages/ui/src/styles/inspector.css packages/ui/src/styles/hosts.css packages/ui/src/features/hosts.ts packages/ui/src/services/terminal.ts
git commit -m "feat(ui): dock the connection editor into the app grid"
```

---

### 任务 3：主机表格

**文件：**
- 修改：`packages/ui/src/host-list.ts`
- 修改：`packages/ui/src/styles/hosts.css`
- 修改：`packages/ui/src/index.html:69-73`
- 修改：`packages/ui/tests/client-lifecycle.browser.ts:249-251`

- [ ] **步骤 1：给 markup 加列标题行**

在 `index.html` 中，把 `#hosts-body` 块（第 69-73 行）替换为：

```html
            <div id="hosts-body">
              <div id="host-columns" class="host-columns" role="presentation">
                <span>名称</span><span>地址</span><span>用户</span><span>认证</span><span>更新</span><span></span>
              </div>
              <ul id="host-list" aria-label="已保存的主机"></ul>
              <p id="hosts-empty" class="empty">还没有保存的主机。<br />点击「新建主机」开始建立连接。</p>
            </div>
```

`role="presentation"` 是因为这几列对一个已经带标签的清单而言是装饰；用真正的 `<th>` 就要求行是表格单元，而行必须留在 `<li>` 里以维持生命周期 selector。

- [ ] **步骤 2：给一行加上四个额外单元格**

在 `host-list.ts` 中，把 `buildRow`（第 69-114 行）替换为：

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

第 1 行的协议导入加上 `KeyRecord`：

```ts
import type { HostRecord, KeyRecord } from '@pureterm/protocol'
```

并删掉 `toneFor`（第 48-52 行）—— 它产出的 `tone-0`…`tone-3` 自配色翻转起没有任何规则读取。

- [ ] **步骤 3：把密钥清单穿过视图接口**

在 `host-list.ts` 中，改对外签名与 render 实现：

```ts
export interface HostListView {
  dispose(): void
  /** 重画。`selectedId` 命中的那一行高亮；命中不了就都不高亮。 */
  render(records: HostRecord[], selectedId: string | null, keys?: readonly KeyRecord[]): void
  select(selectedId: string | null): void
}
```

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

- [ ] **步骤 4：从 feature 把它传进来**

`features/hosts.ts` 只在一处渲染清单。第 221 行从

```ts
    this.list.render(visible, this.selectedId)
```

改为

```ts
    this.list.render(visible, this.selectedId, this.ctx.clientKeychain.records)
```

密钥清单已经注入（`features/hosts.ts:11` 的 `static inject` 里有 `clientKeychain`）。

- [ ] **步骤 5：给表格上样式**

在 `hosts.css` 中，把第 3-7 行（`#host-list.list-view` 那组与按下态）替换为：

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

然后把 `#host-list` 规则（第 36 行）与卡片视图规则改成以卡片为选项：

```css
#host-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; margin: 0; padding: 0 12px; list-style: none; }
#host-list.card-view { grid-template-columns: repeat(3, minmax(220px, 1fr)); gap: 16px; }
#host-list.card-view .host-row { grid-template-columns: minmax(0, 1fr); align-items: flex-start; min-height: 91px; }
#host-list.card-view .host-row .host-cell { display: none; }
#host-list.card-view .host-avatar { width: 59px; height: 59px; }
#host-list.card-view .host-content { gap: 6px; }
```

并在 `.host-row`（第 41 行）把 `min-height: 91px` 改为 `min-height: var(--row-h)`，把 `.host-main` 的内边距归零 —— 行的网格自己负责间距。`.host-row`、`.host-row:hover`、`.host-row.active`、`.host-avatar`、`.host-label`、`.tag`、`.host-actions` 与 `button.mini` 规则**原样保留**。

- [ ] **步骤 6：在同一个提交里翻转主机开关**

上面的 `.card-view` 规则在按钮产出该类之前是死的，而它今天产出的 `list-view` 已经没有规则 —— 所以改名必须与 CSS 同批落地。在 `features/hosts.ts` 中，把第 50-53 行的处理器替换为：

```ts
    this.scope.listen(view.element('host-view-toggle'), 'click', () => {
      // The class and the reported state are derived from one value, so they
      // cannot disagree the way a separate boolean field could.
      const cards = view.element('host-list').classList.toggle('card-view')
      view.element('host-view-toggle').setAttribute('aria-pressed', String(cards))
    })
```

然后在 `client-lifecycle.browser.ts` 中把第 249-251 行替换成一对与新默认视图相称的动作：

```ts
    click('host-view-toggle')
    assert(document.getElementById('host-list')!.classList.contains('card-view'), 'the toggle must move the hosts list to card view')
    assert(input('host-view-toggle').getAttribute('aria-pressed') === 'true', 'the toggle must report card view is on')
    click('host-view-toggle')
    assert(!document.getElementById('host-list')!.classList.contains('card-view'), 'the toggle must return the list to the table')
    assert(input('host-view-toggle').getAttribute('aria-pressed') === 'false', 'and report it')
```

这条断言说的是开关好不好用，不是哪个视图是默认，所以默认值换了它仍然成立。

- [ ] **步骤 7：验证**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
node packages/ui/tests/smoke-client-lifecycle.mjs
```
预期：通过。`client-lifecycle.browser.ts` 仍能找到 `.host-row[data-id]`、`.host-main` 与 `[data-act="edit"]`，因为元素形状没变。

- [ ] **步骤 8：提交**

```bash
git add packages/ui/src/host-list.ts packages/ui/src/features/hosts.ts packages/ui/src/index.html packages/ui/src/styles/hosts.css packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): lay the hosts list out as a five-column table"
```

---

### 任务 4：密钥表格与它的横幅

**文件：**
- 修改：`packages/ui/src/features/keychain.ts:153-203`
- 修改：`packages/ui/src/features/hosts.ts:109`
- 修改：`packages/ui/src/styles/keychain.css`
- 修改：`packages/ui/src/index.html:76-92`
- 修改：`packages/ui/tests/client-lifecycle.browser.ts:98`

- [ ] **步骤 1：加列标题行**

在 `index.html` 的 `.keychain-content` 里，紧接 `<ul id="keychain-list" …>` 之前插入：

```html
                <div id="keychain-columns" class="host-columns" role="presentation">
                  <span>名称</span><span>类型</span><span>指纹 SHA256</span><span>关联</span><span>创建</span>
                </div>
```

- [ ] **步骤 2：给密钥卡片加单元格**

`card()`（`features/keychain.ts:169-203`）构造 `<li class="keychain-card">` → `.keychain-card-main` 按钮，然后 `row.append(main)`，然后可选的 `.keychain-card-edit`，最后 `list.append(row)`。单元格插在 main 按钮与编辑按钮之间。

先在 `card()` 上方加两个助手：

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

然后在 `card()` 内，把单行 `row.append(main)` 替换为：

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

草稿卡片保留四个单元格，这样正在新建密钥时列不会塌。

- [ ] **步骤 3：暴露主机记录**

`associationCount` 读的是 `ClientKeychain` 目前拿不到的列表。`features/hosts.ts:15` 有 `private hosts: HostRecord[] = []`，并在第 109 行已经暴露 `get count()`；在它旁边加同构的 getter：

```ts
  get records(): readonly HostRecord[] { return this.hosts }
```

再让 `ClientKeychain` 能取到它，把 `keychain.ts:9` 的 `static inject` 扩成：

```ts
  static inject = ['clientView', 'clientTransport', 'clientTerminal', 'clientHosts']
```

这是渲染层内部读另一个渲染 feature 的缓存，不是新的传输面：两者都在 `@pureterm/ui` 里，而 `features/hosts.ts:11` 已经证明反方向的注入是既有做法。

- [ ] **步骤 4：上样式，并复用同一份列模板**

在 `keychain.css` 中，给密钥行与它的列标题五列模板。注意 `<ul>` 本身仍是「一行一条」的堆叠 —— 只有卡片与列标题带列：

```css
/* Five columns, the same shape the hosts table uses, so moving between the two
   screens does not re-learn a grid. The list stays one row per line. */
#keychain-columns,
.keychain-card { grid-template-columns: minmax(0,1.2fr) 1fr 1.5fr 62px 74px; }
```

现有的 `.keychain-card*` selector 与类名全部保留。然后把 `keychain.css:36` 的 `flex: 0 0 clamp(360px, 28vw, 500px)` 换成指向共享 token：

```css
.keychain-editor { flex: 0 0 var(--insp-w); }
```

- [ ] **步骤 5：让横幅常驻可见**

`#keychain-policy` 已在 `keychain.ts:126-127` 被写入；它在 `keychain.css:12` 只是一个普通段落样式。把它换成设计要的横幅：

```css
/* The never-plaintext guarantee is the one thing a user cannot infer from the
   UI, so it is a banner above the list rather than a line of small text. */
#keychain-policy { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; padding: 8px 10px;
  color: var(--tx-2); font-size: var(--fs-meta); background: var(--c-surface);
  border: 1px solid var(--line); border-left: 2px solid var(--ac); border-radius: var(--r-2); }
```

- [ ] **步骤 6：连同 CSS 一起翻转密钥开关**

理由与主机开关相同：步骤 4 一落地，`.card-view` 是死的而 `list-view` 已不存在。把 `features/keychain.ts` 里 `#keychain-view` 的处理器替换为：

```ts
    this.scope.listen(view.element('keychain-view'), 'click', () => {
      const cards = view.element('keychain-list').classList.toggle('card-view')
      view.element('keychain-view').setAttribute('aria-pressed', String(cards))
    })
```

并把 `client-lifecycle.browser.ts:98`（点一次后断言旧类的那行）改为：

```ts
    assert(input('keychain-list').classList.contains('card-view'), 'the key list toggle must reach card view')
```

- [ ] **步骤 7：验证并提交**

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

### 任务 5：让开关说出它会切到哪一视图，并退役旧类

两个开关现在都随自己的表格落地了，剩下的是措辞：两个按钮描述的是你**正要离开**的视图，而 `list-view` 必须从树里彻底消失，否则下一个读者会去找已经不存在的规则。

**文件：**
- 修改：`packages/ui/src/index.html:57,81`
- 修改：`packages/ui/tests/visual-contract.test.mjs`

- [ ] **步骤 1：先结构性地断言表格，再改文案**

在 `visual-contract.test.mjs` 第一条测试里，`#connection-failure` 断言之后加入：

```js
  assert.match(html, /id="host-columns"[^>]*class="host-columns"/, 'the hosts table needs a header row to sit above the rows')
  assert.match(html, /id="keychain-columns"[^>]*class="host-columns"/, 'the key table shares that header shape')
  assert.match(css, /\.host-columns,\s*\.host-row \{ display: grid;[^}]*minmax\(0,1\.5fr\)/, 'the header and the rows must share one column template')
```

运行：`node --test "packages/ui/tests/visual-contract.test.mjs"`
预期：通过 —— 是任务 3 与 4 造出来的。如果前两条失败，说明 id 或类顺序漂了；改 markup 而不是改断言，因为正是这条断言让两张表保持同一个设计。

- [ ] **步骤 2：让两个按钮命名一次点击的产物**

在 `index.html` 中替换主机开关（第 57 行）：

```html
                <button type="button" id="host-view-toggle" class="tool-icon" aria-label="切换到卡片视图" aria-pressed="false" title="切换到卡片视图"><i class="ti ti-list" aria-hidden="true"></i></button>
```

`#keychain-view`（第 81 行）用同样的措辞。两者现在都说会发生什么；图标仍是列表字形，因为这个按钮就是「离开清单」的那一下，而 `hosts.css` 与 `keychain.css` 里的按下底色承担另一半状态。

- [ ] **步骤 3：证明旧类已死**

```powershell
git grep -n "list-view" -- packages apps docs
```
预期：无输出。`list-view` 曾是堆叠布局唯一的名字，而现在两个屏幕靠「没有 `card-view`」到达它。

- [ ] **步骤 4：验证并提交**

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

### 任务 6：三个断点

被触及的分片目前带着 1250 / 1450 / 1100 / 900 / 820 / 620 加两条容器查询，而 `hosts.css` 里有**两个** `@media (max-width: 620px)` 块，第二个悄悄覆盖第一个。收敛到 1100 / 820 / 620。

**文件：**
- 修改：`packages/ui/src/styles/hosts.css:60-89`
- 修改：`packages/ui/src/styles/keychain.css:14,15,63-68,70`
- 修改：`packages/ui/src/styles/inspector.css:80-92`

- [ ] **步骤 1：合并 hosts.css 里重复的 620 块**

把从 `@media (max-width: 1250px)`（第 60 行）到文件结尾的全部内容替换为：

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

820 规则是**丢掉**用户与认证两列，而不是把它们挤到读不下；名称、地址与操作按钮保留。两个 620 块现在只有一个，且留下的是原本真正生效的那套 `overflow: hidden` 模型。

- [ ] **步骤 2：把 keychain.css 收到同样三个**

在 `keychain.css` 中，把两条 `@container`（第 14-15 行）以及 `@media (max-width: 1100px)` 与 `@media (max-width: 900px)` 各块替换为：

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

`.keychain-dashboard` 保留 `position: relative`，好让 1100 的覆盖式回退有包含块；删掉旧的 900 与 630 规则。

- [ ] **步骤 3：inspector 只留 820 与 620**

在 `inspector.css` 中，820 块里的 `#toolbar { width: … }` 对嵌入轨已经不对了 —— 删掉那条宽度规则，若该块不再说任何事就整块删除；然后把 620 块收敛为：

```css
@media (max-width: 620px) {
  .credential-row { display: flex; align-items: stretch; }
  .credential-row .field { flex: 1 1 100%; }
  .key-row > button { flex: 1 1 120px; align-self: end; }
  .toolbar-head { min-height: 76px; padding-left: 16px; }
  .drawer-scroll, .drawer-footer { padding-right: 16px; padding-left: 16px; }
}
```

- [ ] **步骤 4：证明退役的断点没了**

```powershell
git grep -n "max-width: 1250\|min-width: 1450\|max-width: 900\|max-width: 630\|min-width: 1200" -- packages/ui/src/styles
```
预期：无输出。再确认每个分片只提到三个：

```powershell
git grep -c "1100\|820\|620" -- packages/ui/src/styles
```

- [ ] **步骤 5：验证并提交**

```powershell
npm run build
node --test "packages/ui/tests/*.test.mjs"
```
```bash
git add packages/ui/src/styles/hosts.css packages/ui/src/styles/keychain.css packages/ui/src/styles/inspector.css
git commit -m "refactor(ui): collapse the workspace breakpoints to three"
```

---

### 任务 7：文档、记录，以及看它

**文件：**
- 修改：`docs/design-system.md`、`docs/design-system_zh.md`
- 修改：`docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` + `_zh.md`
- 修改：`CHANGELOG.md`、`CHANGELOG_zh.md`
- 修改：`packages/ui/src/lib/changelog.ts`（生成物）

- [ ] **步骤 1：以带日期的注解更正规格里的两句**

在规格 `## Hosts workspace` 下追加：

```md
  - **Corrected 2026-09-24, at execution:** the fifth column is **Updated**, not "Last connected". `HostRecord` carries `updatedAt`, which the session store writes on save, and no last-connection timestamp exists anywhere in the protocol or the Host. Adding one is a `@pureterm/protocol` change with its own plan.
```

在 `## Keychain workspace` 下追加：

```md
  - **Corrected 2026-09-24, at execution:** `#keychain-policy` was not an invisible empty node — `features/keychain.ts` writes it with one of two strings once capabilities resolve. It was still promoted to a banner, because a line of small text under a heading is not the same thing as a guarantee the user can see.
```

两句都在 `_zh.md` 里做对应中文。

- [ ] **步骤 2：更新设计系统文档**

在 `docs/design-system.md` 里：把 `--insp-w` 加进度量表的 Chrome geometry 行，以及 `:root` 那笔账（75 → 76，度量 24 → 25）；若有句子提到旧断点集合则更正；用前两份计划同一套方法重算消费者普查 —— 读分片、数 `var(--x)` —— 而不是手工改数字；再为改动的那四个分片重跑字节与行号列。

- [ ] **步骤 3：记录用户可见的变化**

`CHANGELOG.md` 的 `### Changed` 下：

```md
- Hosts and Keychain are now tables with a header row: name, address, user, authentication and last-saved date for hosts; name, type, fingerprint, associated hosts and creation date for keys. Card view is one click away and no longer the default. The authentication column says whether a key came from the keychain or a local file, which is the fact that decides whether a host is usable.
- The connection editor docks into the window instead of covering the host list, at the same 322px as the key editor, and the two now share one width token.
- Breakpoints across the workspace screens collapse from six to three (1100 / 820 / 620). Below 820 the hosts table drops the user and authentication columns rather than squeezing them.
```

`### Fixed` 下：

```md
- Two `@media (max-width: 620px)` blocks in the hosts stylesheet were silently overriding each other's scroll model; there is now one.
```

`CHANGELOG_zh.md` 做对应中文，然后：

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```

- [ ] **步骤 4：提交文档**

```bash
git add docs/ CHANGELOG.md CHANGELOG_zh.md packages/ui/src/lib/
git commit -m "docs(ui): record the library workspace rebuild"
```

- [ ] **步骤 5：看它**

本步骤不改动任何东西，且不得跳过。

```powershell
npm run start:web
npm run start:desktop
```

对着运行中的应用逐条报告：(a) 五列表格是否读起来像一个整体，列标题行与行的关系是否一目了然；(b) 决定要不要连的时候，认证列是不是你第一个看的东西；(c) 编辑器嵌入后主机清单是否仍可读，边编辑边选中另一行时的行为对不对；(d) 在 1100 与 820 下，被丢掉的列是安静地消失还是看起来像被截断；(e) 密钥库横幅读起来像不像一个保证而非装饰；(f) **切到浅色主题把上面全部看一遍** —— 浅色分组从未被任何人的眼睛看过，计划三的笔记就是这么写的；(g) 点卡片视图开关，确认两种视图都是刻意的。

- [ ] **步骤 6：如实报告**

任何没能检查的，直说。在一套全绿测试下面改值是当年那份色板长出自己第二套手工拷贝颜色的方式：如果表格读起来不对且原因出在某个 token，把实测配对写进报告并作为更正提出，不要悄悄换一个数。

---

## 完工判据

- `--insp-w` 是唯一书写编辑面宽度的地方，连接表单与密钥编辑器共用，且它是奇偶守卫认识的 `:root` 专属度量。
- Hosts 与 Keychain 渲染为带列标题行的五列表格，列标题与行共用同一份列模板；生命周期套件依赖的每个 selector 仍然解析得到 —— 套件是长了断言而不是丢了断言。
- 卡片视图在两个屏幕都是选项，且开关上报的状态不可能与它设置的类不一致。
- `git grep` 找不到 `drawer-open`，找不到 1250/1450/900/630 断点，`hosts.css` 里也没有第二个 620 块。
- 规格带着两处带日期的更正，而不是被悄悄改写。
- `npm run verify` 与 `npm run verify:electron` 通过，且浅色主题被人看过。

## 不在本计划内

- 计划五：会话各屏 —— 可拖拽的终端/SFTP 分栏、四态、取代 `#status` 的 toast，以及带四节点路由的失败诊断。
- 最后连接时间，以及那个会暴露协商加密算法、主机密钥类型与在线时长的 `@pureterm/protocol` 改动。
- 安装包图标。

---

## 执行所发现的

任务 1-6 按计划各自一 commit 落地：`272de5a` 编辑面 token 与网格轨道、`a87eebf` 嵌入的连接编辑器、`c3c3826` 主机表格、`790c9e6` 密钥库表格与保证条、`9c78652` 视图切换的措辞、`39caebe` 三个断点。三处偏离计划文本，且三处都是计划写错而不是执行走样：

- 630px 与 1200px 两条 `@container` 保留了下来。计划把它们列进六个待合并的断点，但它们管的是 `.keychain-main` **内部**的卡片网格，不是表格；换成媒体查询就变成按视口决定，而卡片每行几张属于容器。它们是整张级联里仅存的两个容器查询。
- 掉列规则加了 `#host-list:not(.card-view)` 与 `.keychain-list:not(.card-view)` 作用域。没有这个 `:not()`，820px 的规则会伸手进卡片网格，把卡片规则刚给它的形状覆盖掉。
- 密钥→主机的关联计数靠 `ClientHosts` 每次刷新后发出的 `client/host-counts` 事件传递，而不是 `ClientKeychain → ClientHosts` 的注入。反向的那条边本来就存在，再直连就是一个 Cordis 在 bootstrap 阶段就会拒绝的环。

**任务 7 发现八处缺陷，八处都已修复。** 它们没有一处能被全绿的测试套件照出来，前两处只有在运行中的应用里才看得见。

- **嵌入的连接编辑器根本不存在。** `.app-shell.inspector-open .app-body { grid-template-columns: … var(--insp-w) }` 给一个只有导航轨道和 `#main` 两个子元素的网格加了第三条轨道。表单是 `#main` 的子元素，永远不会进入那条轨道：它被画在 `y: 748`，处在一个 708px 高、被 `overflow: hidden` 裁掉的列里，完全在视口之下，而那条 322px 轨道只涂了页面底色。修复前实测 `workspace: [52, 748, 706, 1039]`。轨道移到真正的网格容器 `#main` 上之后，编辑器解析为 `[758, 40, 322, 708]` —— 与密钥编辑器占据的是同一个盒子，而这正是引入 `--insp-w` 想要兑现的那句话。现在有两道守卫钉住结构而不是意图：`#main` 必须是网格、轨道必须落在 `#main` 上、`.app-body` 上出现 `--insp-w` 即失败。
- **标题行没有对在自己的列上。** `0 12px` 的内缩挂在 `#host-list` 上，而 `#host-columns` 是它的兄弟元素，于是两个盒子相差 9px，`fr` 单位解析于不同的宽度。内缩移到 `#hosts-body`，标题行补上透明侧边框，使它的 border 盒子与一行等宽。两张表现在逐位报告相同的 `grid-template-columns`，`aligned: true`。
- **主机头像还是卡片的那个尺寸。** `.host-avatar` 的基础规则是 59px，于是每个表格行量出来 61px —— 比它自己点名的 38px `--row-h` 还高。基础档现在是 `--r-1` 的 20px 徽标，卡片视图再设回 58px 方块。
- **……而卡片头像带着徽标的圆角。** 卡片视图覆盖了尺寸却没覆盖圆角，于是 59px 方块带着 `--r-1` 的 3px，紧挨着密钥卡片的 58px `--r-4`。两者现在都是 58px `--r-4`；密钥卡片自己的内边距（`13px 8px 13px 15px`）同样是主机卡片那份的两像素漂移版本，现在也一致了。
- **密钥库头像的两个尺寸被任务 5 调了个方向。** `58px` 写在基础规则里、`40px` 写在 `.card-view` 上，那是卡片还是唯一形态时写下的。表格成为默认形态之后，每一行密钥都变成 41px 高，旁边的主机行是 39px。基础档现在是 `--r-2` 的 26px —— 图标需要这么大，而主机表里的 `SSH` 文字徽标 20px 就够 —— 卡片取回 58px 方块。
- **密钥表把类型说了两遍。** `.keychain-card-sub` 在名字下面印 `Type ed25519`，而它旁边那一列 类型 印的是 `ed25519`；也正是那第二行让行高变成两行。子标题现在表格隐藏、卡片显示，与主机卡片对待地址行的方式一致。
- **列标题不可读。** `.host-columns` 设的是 `color: var(--tx-4)`：暗色底面上 2.88:1、浅色底面上 2.61:1，而它是 11px 大写字母。`--tx-4` 在文档里就是非 AA 档，合法性表早就写明了；连续两次复查都抓到外壳控件伸手去拿它（计划三抓到的是 2.28:1 的导航图标）。现在是 `--tx-3`，实测暗色 5.16:1、浅色 4.55:1，并且 `stylesheet-contract.test.mjs` 会拒绝任何选择器不是 `::placeholder` 的 `color: var(--tx-4)`。
- **密度开关改了一个 token，没有改任何几何。** `base.css` 给每个 `button` 都设 `min-height: 38px`，而那恰好是舒适档的 `--row-h`，于是行内的按钮把行托住了，紧凑档什么也没发生。实测：修复前两种模式都是 39px，修复后舒适 39px、紧凑 30px —— 做法是在表格视图里解除 `.host-main` 与 `.keychain-card-main` 的下限。这与计划三里压过 `.nav-item { height: 34px }` 的是同一对属性。

同一趟复查还发现两件小事：空表上方悬着一条标题行，什么也没框住，于是两条标题现在都靠 `:has(#…-empty:not([hidden]))` 隐去，而不是再抄一份计数；认证列印的是协议自己的词表 —— `password`、`private key · 本机文件` —— 夹在一张其余全是中文的表里，现在读作 密码 / 密钥库 · ed25519 / 本机文件，算法名保留是因为它是专有名词。

**查不了的部分，以及为什么它比上面这张清单更要紧。** 截图依旧不可用：内置面板报告 `visibilityState=hidden`，因此本文每个颜色值都是注入 `transition: none` 之后由 `getComputedStyle` 读出的，浅色主题仍然是一堆数字而不是一个人的观感。窄屏各档**未经测量**：内置视口固定 1080px，而在静态原型上好用的 iframe 装不下运行中的应用 —— 回环主机拒绝被嵌入（`X-Frame-Options`/CSP，这是正确行为），于是 1100/900/820/620 四档只由级联推理证明，没有浏览器证据。具体说，新增的 `max-width: 900px` 编辑器覆盖层没有在浏览器里验证过；而 620px 以下它的 `position: absolute; inset: 0` 解析于一个高度由内容决定的 `#main`，所以手机宽度下抽屉会跟着背后的列表长，而不是跟着视口。这条作为缺口记录，没有闭眼改。本环境里始终没能通过运行中的 Web 主机真正创建一把密钥 —— 保存后没有产生行，也没有留下日志 —— 因此密钥库表格是在草稿行上测的：它共享同样六条轨道，但不经过指纹与关联单元格。

`npm run verify` 与 `npm run verify:electron` 均退出 0；含四道新增断言在内，54 条 UI 守卫通过；生命周期套件的宿主表格检查现在断言那六条轨道与认证措辞，而不是相信一张截图。

# 外壳重建实施计划

[English version](2026-09-24-chrome-rebuild.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 重建应用外壳 —— 52px 图标轨道、一条承载品牌标记与会话标签的 40px 顶栏、一条 24px 状态栏，以及真正可用的主题与密度开关 —— 让浅色主题变得可达，并让外壳读起来像一件度量过的仪器，而不是一摞面板。

**Architecture：** 三个几何 token（`--chrome-h`、`--rail-w`、`--status-h`）成为外壳所有高度唯一的书写处，包括 Electron 标题栏覆盖层的高度 —— `theme-sync.test.mjs` 已经把它和 CSS 拴在一起，现在改为从 token 表读取。新的 `ClientChrome` Cordis 服务负责状态栏与两个开关；它订阅终端服务已经发出的内部事件，外加一个新的 resize 事件，并把两个选择存进 `localStorage` —— 本代码库目前完全没有使用它。

**Tech Stack：** CSS 自定义属性、Cordis `Service` 插件、TypeScript（仅浏览器的 `@pureterm/ui`）、Node 内置测试运行器、Electron `titleBarOverlay`、Tabler 图标字体。

**Target design：** `docs/superpowers/prototype/graphite-target.html` —— 打开它，在那里切换主题与密度，然后照着做。它读取真实的 `tokens.css`，所以是同一个事实来源。

---

## 前置知识与当前事实

开始前请读 `AGENTS.md`、`docs/architecture.md`、`docs/design-system.md`，以及前两份计划
（`2026-09-23-token-foundation.md`、`2026-09-24-graphite-palette-flip.md`）。

以下均在提交 `36b7c2c` 的代码树上核实：

- `packages/ui/src/styles/tokens.css` 是唯一允许持有颜色字面量的文件，`:root` 声明 72 个自定义
  属性。度量按契约与主题无关：`:root` 与 `[data-theme="light"]` 匹配同一个元素，所以写两遍一个
  度量就是这套体系本要消除的手工同步债务。`design-tokens.test.mjs` 用 `GLOBAL_TOKENS` 强制这一点。
- `[data-theme="light"]` 与 `[data-density="compact"]` 存在于 `tokens.css`，而**没有任何代码写它
  们**。`grep -rn "data-theme" packages/ui/src apps/desktop apps/web` 只返回那个选择器以及解释它
  的注释。本计划让两者都可达。
- 外壳几何目前是三个手工拷贝的数字：`styles/chrome.css:5,19` 的 `grid-template-rows: 76px` 与
  `env(titlebar-area-height, 76px)`，以及 `apps/desktop/electron/app/shell.ts:70` 的 `height: 76`。
  让三者相等的是 `theme-sync.test.mjs:45-57`。
- 轨道是 `278px`（`chrome.css:107`），并在 1250px 处有一个 `232px` 覆盖（`:110`），而
  `visual-contract.test.mjs:32` 断言字面量 `278px`。
- `#nav-toggle` 与 `.nav-collapsed` 是活的（`index.html:23`、`features/hosts.ts:50-54`、
  `chrome.css:104-105`）；`.window-control`、`.update-pill`、`.workspace-chevron` 与
  `.app-shell.failure-mode` 是**死 CSS** —— 没有 markup、也没有代码点名它们。
  `failure-mode` 只被移除（`services/terminal.ts:229`），从未被添加。
- 会话标签在 `services/terminal.ts:165-210` 构造并追加到 `#workspace-tabs`；`.nav-item.active`
  在 `services/terminal.ts:232-233` 切换。
- `ClientView.element(id)`（`client-runtime.ts:55-59`）在 id 缺失时**抛错**，所以本计划读取的每
  个元素都必须在同一个或更早的任务里进入 `index.html`。
- 服务注册在 `packages/ui/src/client.ts:15`（`scopes` 的键联合）与 `:31-39`
  （`context.plugin(...)` 列表）。`features/readiness.ts:9` 列出哪些 provider 参与就绪门控；
  `ClientChrome` **不得**加进去，因为状态栏不是就绪条件，加上去会让一个外壳 bug 阻塞整个应用。
- 状态栏数据，逐字段核实：连接状态可得（`TabState`，`services/terminal.ts:6`，外加
  `tab.message`）；`user@host:port` 可从 `tab.request` 得到；终端 `cols × rows` 可得
  （`terminal-view.ts:5-6`）；应用版本可得且目前**没有任何导入方**（`lib/version.ts:2`）。
  在线时长、协商加密算法与远端主机密钥类型**任何地方都不可得** —— `SshSessionInfo` 只有
  `{id, host, port, username}`（`packages/host/src/services/ssh.ts:79-84`），且没有代码读取 ssh2
  的协商状态。SFTP 传输速率也不可得：传输是整文件单次 RPC（`features/sftp.ts:161-184`）。
- `packages/` 里没有任何地方使用 `localStorage`；CSP 是
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`（`index.html:11-14`）。
  `script-src 'self'` 禁止常用的内联预绘制主题脚本，因此已存的浅色主题会在 `app.js` 运行后的一帧
  之后才生效。这一点被接受并被记录，而不是被绕过。
- 已核实 `@tabler/icons-webfont` 中存在的图标名：`ti-sun`、`ti-moon`、`ti-arrows-minimize`、
  `ti-arrows-maximize`。`ti-rows`、`ti-density`、`ti-layout-density` 不存在 —— 不要凭空造。

## 命令

在仓库根目录执行。`npm run test:unit` 跑所有工作区套件；外壳守卫是 `packages/ui/tests/` 下的五个文件。

```powershell
node --test "packages/ui/tests/design-tokens.test.mjs"
node --test "packages/ui/tests/theme-sync.test.mjs"
node --test "packages/ui/tests/visual-contract.test.mjs"
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run verify
npm run verify:electron
npm run release:check
```

## 文件结构

| 文件 | 职责 | 改动 |
| --- | --- | --- |
| `packages/ui/src/styles/tokens.css` | 三个外壳几何 token。 | 修改 |
| `packages/ui/tests/design-tokens.test.mjs` | 让度量一致性守卫认识它们。 | 修改 |
| `packages/ui/src/styles/chrome.css` | 顶栏、轨道、状态栏，以及承载它们的网格。 | 修改 |
| `packages/ui/src/index.html` | 轨道标签改为 `aria-label`、品牌 SVG、favicon、顶栏控件、状态栏 markup。 | 修改 |
| `packages/ui/tests/theme-sync.test.mjs` | 覆盖层高度与 favicon 颜色改从 token 表读取。 | 修改 |
| `apps/desktop/electron/app/shell.ts` | 76px 覆盖层变成 40px。 | 修改 |
| `packages/ui/tests/visual-contract.test.mjs` | 轨道断言从字面量移到 token。 | 修改 |
| `packages/ui/src/features/hosts.ts` | 失去 `#nav-toggle` 处理器。 | 修改 |
| `packages/ui/src/services/terminal.ts` | 发出 `client/terminal-resize`；去掉死类名写入。 | 修改 |
| `packages/ui/src/services/chrome.ts` | 状态栏内容、主题开关、密度开关。 | 新建 |
| `packages/ui/src/client.ts` | 挂载 `ClientChrome`。 | 修改 |
| `packages/ui/tests/client-lifecycle.browser.ts` | 行为：状态字段、主题持久化、密度。 | 修改 |
| `docs/design-system.md` + `_zh.md`、`CHANGELOG.md` + `_zh.md`、`docs/architecture.md` + `_zh.md` | 记录新状态。 | 修改 |

---

### 任务 1：三个几何 token

**文件：**
- 修改：`packages/ui/src/styles/tokens.css:91`（`--ease` 之后）
- 修改：`packages/ui/tests/design-tokens.test.mjs:44-50`

- [ ] **步骤 1：先扩展守卫里的度量清单**

在 `packages/ui/tests/design-tokens.test.mjs` 中，把 `GLOBAL_TOKENS` 整块替换为：

```js
const GLOBAL_TOKENS = [
  '--r-1', '--r-2', '--r-3', '--r-4', '--r-full',
  '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6',
  '--row-h', '--row-h-compact',
  '--z-drawer', '--z-popover', '--z-toast', '--z-dialog',
  '--t-1', '--t-2', '--t-3', '--ease',
  // The chrome's own geometry. These three are the only place a shell height is
  // written down, and theme-sync.test.mjs ties the Electron title-bar overlay to
  // --chrome-h, so a fourth copy of 40px cannot appear silently.
  '--chrome-h', '--rail-w', '--status-h',
]
```

- [ ] **步骤 2：运行它，确认失败**

运行：`node --test "packages/ui/tests/design-tokens.test.mjs"`
预期：FAIL —— `theme-invariant metrics live in :root only` 里报 `:root is missing --chrome-h`。

- [ ] **步骤 3：声明它们**

在 `packages/ui/src/styles/tokens.css` 中，紧接 `--ease` 那行之后、`--font-ui` 之前的空行之前插入：

```css
  /* Chrome geometry. --chrome-h is the height Electron's title-bar overlay is
     told to reserve, so theme-sync.test.mjs reads it as the single source. */
  --chrome-h: 40px;
  --rail-w: 52px;
  --status-h: 24px;
```

- [ ] **步骤 4：再跑一次守卫**

运行：`node --test "packages/ui/tests/design-tokens.test.mjs"`
预期：PASS，14 条测试。如果 `--shadow-pop is the one theme-varying derived token` 失败，说明新
token 被写进了浅色块而不是 `:root`。

- [ ] **步骤 5：提交**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): add the chrome geometry tokens"
```

---

### 任务 2：把网格、顶栏与 Electron 覆盖层改到新几何

`#app` 网格的第三行在本任务加入，因此状态栏 markup 必须等到任务 5 才出现。在这两个任务之间，应用
渲染的是 40px 顶栏且没有状态行 —— 视觉上不完整但结构正确；不要在它们之间跑 Electron 入口测试。

**文件：**
- 修改：`packages/ui/src/styles/chrome.css:1-10,13-25,107-111`
- 修改：`apps/desktop/electron/app/shell.ts:66-72`
- 修改：`packages/ui/tests/theme-sync.test.mjs:20-26,45-57`
- 修改：`packages/ui/tests/visual-contract.test.mjs:32`

- [ ] **步骤 1：把高度断言移到 token 表上**

在 `packages/ui/tests/theme-sync.test.mjs` 中，紧接现有 `declaration()` 函数（它只匹配十六进制）之后加入：

```js
function pixel(name) {
  const match = new RegExp(`^[ \\t]*${name}:[ \\t]*(\\d+)px[ \\t]*;`, 'm').exec(code)
  assert.ok(match, `${name} must be an integer px declaration in styles/tokens.css for this check to mean anything`)
  return match[1]
}
```

然后把 `test('the overlay height agrees with the top bar the CSS draws', ...)` 里从
`const overlay = ...` 到测试结束的部分替换为：

```js
  const overlay = /titleBarOverlay:\s*\{([^}]*)\}/.exec(shell)
  assert.ok(overlay, 'shell.ts lost its titleBarOverlay block')
  const height = /height:\s*(\d+)/.exec(overlay[1])
  assert.ok(height, 'the titleBarOverlay block lost its height')
  const chromeHeight = pixel('--chrome-h')
  const row = /#app\s*\{[^}]*grid-template-rows:\s*var\(--chrome-h\)\s+minmax\(0,\s*1fr\)\s+var\(--status-h\);/
    .exec(chrome)
  const fallback = /env\(titlebar-area-height,\s*(\d+)px\)/.exec(chrome)
  assert.ok(row, 'the #app grid must be three rows: var(--chrome-h), the content, then var(--status-h)')
  assert.ok(fallback, 'chrome.css must keep an env(titlebar-area-height, …) fallback to compare against')
  assert.equal(height[1], chromeHeight, 'the overlay height must equal --chrome-h, the only written top-bar height')
  assert.equal(fallback[1], chromeHeight,
    'the fallback must equal --chrome-h; env() cannot read a custom property, so this literal is the one place the number is repeated and this assertion is what ties it')
  assert.equal(pixel('--status-h'), '24', 'the status row is a design decision, not a leftover')
```

- [ ] **步骤 2：运行它，确认失败**

运行：`node --test "packages/ui/tests/theme-sync.test.mjs"`
预期：FAIL —— `the #app grid must be three rows: …`。

- [ ] **步骤 3：重写网格与顶栏**

在 `packages/ui/src/styles/chrome.css` 中，把第 1-25 行（`#app` 与 `.app-topbar` 两块，保留文件头注释）替换为：

```css
/* Application shell — the #app grid, top bar, workspace and session tabs, the
   navigation rail, the status bar, and the state classes on .app-shell that
   reshape them. Heights come from --chrome-h and --status-h; the one literal
   inside env() below is the number Electron reserves for its overlay, and
   theme-sync.test.mjs is what keeps it equal to the token. */
#app {
  display: grid;
  grid-template-rows: var(--chrome-h) minmax(0, 1fr) var(--status-h);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--c-canvas);
}

/* Application chrome */
.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  width: env(titlebar-area-width, 100%);
  height: env(titlebar-area-height, 40px);
  margin-left: env(titlebar-area-x, 0px);
  padding: 0 8px 0 12px;
  background: var(--c-chrome);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
}
```

然后把 `.app-body` 规则及其 1250px 覆盖（第 107-111 行）替换为：

```css
.app-body { display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); min-height: 0; overflow: hidden; }
```

- [ ] **步骤 4：把同一个高度告诉 Electron**

在 `apps/desktop/electron/app/shell.ts` 中，把覆盖层块里的 `height: 76,` 改为：

```ts
      titleBarOverlay: {
        color: '#0e1013',
        symbolColor: '#7d838d',
        height: 40,
      },
```

- [ ] **步骤 5：把轨道断言从字面量移开**

在 `packages/ui/tests/visual-contract.test.mjs` 中，把第 32 行替换为：

```js
  assert.match(css, /grid-template-columns:\s*var\(--rail-w\)\s+minmax\(0,\s*1fr\)/, 'desktop shell needs a stable navigation rail')
```

- [ ] **步骤 6：跑全部 UI 守卫**

运行：`node --test "packages/ui/tests/*.test.mjs"`
预期：PASS。`stylesheet-contract.test.mjs` 必须保持绿色：本步骤没有新增颜色字面量。

- [ ] **步骤 7：构建、类型检查，然后提交**

```powershell
npm run build
npm run typecheck
```
```bash
git add packages/ui/src/styles/chrome.css apps/desktop/electron/app/shell.ts packages/ui/tests/theme-sync.test.mjs packages/ui/tests/visual-contract.test.mjs
git commit -m "feat(ui): drive the shell geometry from tokens"
```

---

### 任务 3：图标轨道

轨道不再是 278px 的带文字列表，而变成 52px 的图标。可见文字从 markup 中移除，因此可访问名称必须
在同一次编辑里移到 `aria-label` —— 一个唯一文字被 `display: none` 隐藏的按钮根本没有名字。

**文件：**
- 修改：`packages/ui/src/index.html:35-41`
- 修改：`packages/ui/src/styles/chrome.css:113-122,131-141,143-154,177-181`

- [ ] **步骤 1：重写导航 markup**

把 `packages/ui/src/index.html` 第 35-41 行（整个 `<nav id="primary-nav">` 元素）替换为：

```html
        <nav id="primary-nav" class="primary-nav" aria-label="主导航">
          <button type="button" id="nav-hosts" class="nav-item active" aria-label="Hosts" title="Hosts"><span class="nav-icon" aria-hidden="true"><i class="ti ti-server-2"></i></span></button>
          <button type="button" id="nav-keychain" class="nav-item" aria-label="密钥管理" title="密钥管理"><span class="nav-icon" aria-hidden="true"><i class="ti ti-key"></i></span></button>
          <div class="nav-divider" aria-hidden="true"></div>
          <button type="button" id="nav-shortcuts" class="nav-item" aria-label="快捷键" title="快捷键"><span class="nav-icon" aria-hidden="true"><i class="ti ti-keyboard"></i></span></button>
        </nav>
```

`.nav-footer` 消失：它的内容（"Local workspace" 与状态点）属于任务 5 的状态栏，而 52px 轨道里的
页脚既放不下文字也放不下点。

- [ ] **步骤 2：重写轨道规则**

把 `packages/ui/src/styles/chrome.css` 第 113-122 行（从 `/* The rail and the top bar` 注释到
`.nav-status-dot`）替换为：

```css
/* The rail and the top bar are one ground, so they separate by hairline rather
   than by two different tints, which is how the old palette read as a skin. */
.primary-nav { display: flex; min-height: 0; flex: none; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0; background: var(--c-chrome); border-right: 1px solid var(--line); }
.nav-divider { width: 20px; height: 1px; margin: 6px 0; background: var(--line); }
.nav-item { position: relative; display: grid; width: 34px; height: 34px; place-items: center; padding: 0; border-color: transparent; border-radius: var(--r-2); background: transparent; color: var(--tx-4); font-size: 18px; line-height: 1; }
.nav-item:hover:not(:disabled) { color: var(--tx-2); border-color: transparent; background: var(--c-raised); }
.nav-item.active { color: var(--ac); background: var(--ac-bg); }
/* The active marker sits outside the button box, on the hairline, because a
   34px square cannot carry a 2px inset without moving its icon off centre. */
.nav-item.active::before { content: ''; position: absolute; top: 9px; bottom: 9px; left: -10px; width: 2px; border-radius: 1px; background: var(--ac); }
.nav-item:focus-visible { outline: none; box-shadow: var(--ring); }
.nav-icon { display: grid; place-items: center; width: auto; color: inherit; font-size: inherit; font-weight: 400; }
```

- [ ] **步骤 3：删除轨道的响应式覆盖**

在 `packages/ui/src/styles/chrome.css` 中，820px 块（第 131-141 行）目前为一个它不再需要的宽度
重排轨道。把整个 `@media (max-width: 820px)` 块替换为它仍然需要的顶栏内边距：

```css
@media (max-width: 820px) {
  .app-topbar { padding-left: 10px; }
  .workspace-switcher { min-width: 44px; width: 44px; padding: 0 10px; }
  .workspace-copy, .workspace-chevron { display: none; }
}
```

然后在 620px 块（第 143-154 行）里删除四条轨道专属规则（`.primary-nav { … }`、
`.nav-item { … }`、两条 `.nav-item span …` 规则以及 `.nav-footer { … }`），保留 `body`、
`#app`、`.app-topbar`、`.topbar-actions`、`.app-body` 与 `.app-tab` 规则。

- [ ] **步骤 4：确认守卫与构建**

运行：`node --test "packages/ui/tests/*.test.mjs"`
预期：PASS。`visual-contract.test.mjs:23` 仍能找到 `class="ti ti-server-2"`，因为轨道保留了那个图标。

```powershell
npm run build
```

- [ ] **步骤 5：提交**

```bash
git add packages/ui/src/index.html packages/ui/src/styles/chrome.css
git commit -m "feat(ui): collapse the navigation sidebar into a 52px icon rail"
```

---

### 任务 4：删除死外壳

四条规则点名的东西都不存在。删掉它们才能让任务 7 的控件成为外壳里仅有的按钮，而且现在删比继续
解释便宜。

**文件：**
- 修改：`packages/ui/src/index.html:23`
- 修改：`packages/ui/src/features/hosts.ts:50-54`
- 修改：`packages/ui/src/styles/chrome.css:33-51,104-105,100-101,84,125-127`

- [ ] **步骤 1：从 markup 删除开关**

从 `packages/ui/src/index.html` 删除这一行（第 23 行）：

```html
          <button type="button" id="nav-toggle" class="icon-button topbar-menu" aria-label="展开或收起主导航" aria-expanded="true"><i class="ti ti-menu-2" aria-hidden="true"></i></button>
```

- [ ] **步骤 2：删除它的处理器**

在 `packages/ui/src/features/hosts.ts` 中删除这五行（50-54）：

```ts
    this.scope.listen(view.element('nav-toggle'), 'click', () => {
      if (ctx.clientTerminal.active) ctx.clientTerminal.select(null)
      const collapsed = view.element('app').classList.toggle('nav-collapsed')
      view.element('nav-toggle').setAttribute('aria-expanded', String(!collapsed))
    })
```

它上面那一行已经覆盖了真正要紧的行为：`for (const id of ['workspace-home',
'nav-hosts']) … ctx.clientTerminal.select(null)`。删除这个开关不会把会话视图困住。

- [ ] **步骤 3：删除死 CSS**

在 `packages/ui/src/styles/chrome.css` 中：
- 在共享的 `.icon-button, .window-control` 规则里去掉每一处 `, .window-control` 选择器部分，让该
  块变成 `.icon-button { … }` 与 `.icon-button:hover:not(:disabled) { … }`，并删除随后的两条
  `.window-control` 规则（`min-width: 38px …` 与 `.window-control.close:hover …`）。
- 删除 `.topbar-menu { margin-right: 2px; font-size: 24px; }`。
- 删除两条 `.app-shell.nav-collapsed` 规则及其注释。
- 删除两条 `.update-pill` 规则与 `.workspace-chevron` 规则。
- 删除 `.app-shell.failure-mode` 整块（注释加两条规则）。没有任何代码添加那个类：
  `services/terminal.ts:229` 只移除它，而失败视图由 `:255` 的
  `view.element('connection-failure').hidden` 驱动。

- [ ] **步骤 4：删除那条死类名写入**

在 `packages/ui/src/services/terminal.ts:229` 删除：

```ts
    app.classList.remove('failure-mode')
```

- [ ] **步骤 5：证明没有东西引用它们**

```powershell
git grep -n "nav-toggle\|nav-collapsed\|window-control\|update-pill\|failure-mode\|topbar-menu" -- packages apps docs
```
预期：无输出。如果 `docs/design-system.md` 或某份计划提到它们，先别动文档 —— 带日期的计划文件是
历史；`docs/design-system.md` 在任务 8 里统一修正。

- [ ] **步骤 6：验证并提交**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
```
```bash
git add packages/ui/src/index.html packages/ui/src/features/hosts.ts packages/ui/src/styles/chrome.css packages/ui/src/services/terminal.ts
git commit -m "refactor(ui): delete chrome CSS that names nothing"
```

---

### 任务 5：品牌标记、favicon 与状态栏外壳

标记与 favicon 是同一个图形的两份，所以它们靠测试拴在一起而不是靠承诺：`theme-sync.test.mjs`
比较路径数据，以及 favicon 必须内联的那两个颜色。

**文件：**
- 修改：`packages/ui/src/index.html:14-17,25,40,176-184`
- 修改：`packages/ui/tests/theme-sync.test.mjs:34-43`
- 修改：`packages/ui/src/styles/chrome.css`

- [ ] **步骤 1：先写出失败的连线**

在 `packages/ui/tests/theme-sync.test.mjs` 末尾追加这条测试：

```js
// The mark is drawn twice: once as the 18px glyph in the top bar, where CSS owns
// the colour, and once as a favicon, where a data: URI cannot read a custom
// property. Two copies of one glyph is the exact debt this system exists to
// remove, so the path data and both colours are compared instead of trusted.
test('the brand mark and the favicon are the same glyph in the same colours', () => {
  const mark = /class="workspace-mark"[^>]*>([\s\S]*?)<\/span>/.exec(html)
  assert.ok(mark, 'index.html lost the .workspace-mark element')
  const paths = [...mark[1].matchAll(/d="([^"]+)"/g)].map((m) => m[1])
  assert.equal(paths.length, 2, 'the mark is a chevron and a cursor bar, in that order')

  const icon = /rel="icon" href="data:image\/svg\+xml,([^"]+)"/.exec(html)
  assert.ok(icon, 'index.html must carry an inline SVG favicon')
  const svg = decodeURIComponent(icon[1])
  // The URI uses single quotes because the attribute itself uses double ones, so
  // only the path data and the colour value are compared, never the quoting.
  for (const d of paths) assert.ok(svg.includes(d), `the favicon is missing the mark path ${d}`)
  assert.equal(/fill=['"]?(#[0-9a-fA-F]{6})/.exec(svg)?.[1].toLowerCase(), declaration('--c-chrome'),
    'the favicon ground must equal --c-chrome, the ground the top bar paints')
  assert.equal(/stroke=['"]?(#[0-9a-fA-F]{6})/.exec(svg)?.[1].toLowerCase(), declaration('--ac'),
    'the favicon glyph must equal --ac, which is what .workspace-mark colours itself with')
})
```

运行：`node --test "packages/ui/tests/theme-sync.test.mjs"`
预期：FAIL —— `the mark is a chevron and a cursor bar, in that order`，因为该元素现在装的是文字
`PT`，贡献不出路径数据。

- [ ] **步骤 2：用 SVG 标记替换文字标记**

在 `packages/ui/src/index.html:25`，把

```html
            <span class="workspace-mark" aria-hidden="true">PT</span>
```

替换为

```html
            <span class="workspace-mark" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 4l4 4-4 4"/><path d="M8.5 12.5h5"/></svg></span>
```

- [ ] **步骤 3：加上 favicon**

在 `packages/ui/src/index.html` 中，紧接 `<title>` 那行之后插入：

```html
    <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Crect%20width='16'%20height='16'%20rx='3'%20fill='%230e1013'/%3E%3Cg%20fill='none'%20stroke='%235aaeff'%20stroke-width='1.8'%20stroke-linecap='round'%3E%3Cpath%20d='M3%204l4%204-4%204'/%3E%3Cpath%20d='M8.5%2012.5h5'/%3E%3C/g%3E%3C/svg%3E" />
```

`img-src 'self' data:` 已经允许它，而 data URI 意味着两个入口都不必新服务一个文件。这两个颜色是
此处仅有的字面量，步骤 1 的测试就是让它们保持诚实的东西。

- [ ] **步骤 4：把标记样式化成一个图形盒**

在 `packages/ui/src/styles/chrome.css` 中，把 `.workspace-mark, .app-tab-mark` 规则替换为：

```css
.workspace-mark,
.app-tab-mark {
  display: grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-1);
  background: var(--c-control);
  color: var(--ac);
}
```

并删除后面那条 `.app-tab-mark { width: 18px; … font-size: 8px; }` 覆盖 —— 它存在是为了把文字标记
在标签里缩小，而 SVG 本来就是 18px。

- [ ] **步骤 5：跑那条连线**

运行：`node --test "packages/ui/tests/theme-sync.test.mjs"`
预期：PASS，3 条测试。

- [ ] **步骤 6：加上状态栏 markup**

在 `packages/ui/src/index.html` 中，把下面这块插入 `#app` 闭合 `</div>` 之前（当前是第 220 行，
即关闭 `.app-body` 的那个 `</div>` 之后）：

```html
      <footer class="status-bar" aria-label="工作区状态">
        <span class="status-item"><span id="status-dot" class="status-dot" aria-hidden="true"></span><span id="status-state">正在启动…</span></span>
        <span class="status-sep" aria-hidden="true">│</span>
        <span id="status-endpoint" class="status-item mono">—</span>
        <span class="status-sep" aria-hidden="true">│</span>
        <span id="status-size" class="status-item mono">—</span>
        <span class="status-fill"></span>
        <span id="status-workspace" class="status-item">本地工作区</span>
        <span class="status-sep" aria-hidden="true">│</span>
        <span id="status-version" class="status-item mono">—</span>
      </footer>
```

- [ ] **步骤 7：加上状态栏 CSS**

追加到 `packages/ui/src/styles/chrome.css`：

```css
/* Status bar. Every field here is a value the renderer already owns; the
   cipher, host key type and uptime this design originally asked for are not
   reported by the Host at all, so they are absent rather than faked. */
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--status-h);
  padding: 0 10px;
  background: var(--c-chrome);
  border-top: 1px solid var(--line);
  color: var(--tx-3);
  font-size: var(--fs-micro);
  line-height: 1;
}

.status-bar b { color: var(--tx-2); font-weight: 400; }
.status-item { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.status-fill { flex: 1 1 auto; }
.status-sep { color: var(--line-strong); }
.status-dot { width: 7px; height: 7px; border-radius: var(--r-full); background: var(--idle); }
.status-dot[data-state="connected"] { background: var(--ok); }
.status-dot[data-state="connecting"] { background: var(--warn); }
.status-dot[data-state="failed"],
.status-dot[data-state="disconnected"] { background: var(--err); }
```

- [ ] **步骤 8：检查细线下限仍然成立**

运行：`node --test "packages/ui/tests/stylesheet-contract.test.mjs"`
预期：PASS。`.status-bar` 在 `--c-chrome` 底面上设了一道 `--line` 边框，量得 1.323:1 —— 高于守卫
强制的 1.1 下限。

- [ ] **步骤 9：提交**

```bash
git add packages/ui/src/index.html packages/ui/src/styles/chrome.css packages/ui/tests/theme-sync.test.mjs
git commit -m "feat(ui): add the brand mark, favicon and status bar shell"
```

---

### 任务 6：填状态栏

`ClientChrome` 拥有那四个真实存在的字段。它还需要一个终端服务尚未发出的事件，尺寸字段才不会过期。

**文件：**
- 修改：`packages/ui/src/services/terminal.ts:31-35,203`
- 新建：`packages/ui/src/services/chrome.ts`
- 修改：`packages/ui/src/client.ts:15,31-39`

- [ ] **步骤 1：发出尺寸**

在 `packages/ui/src/services/terminal.ts` 的 `Events` 接口里，`'client/tab-closed'(tabId: string): void`
之后加入：

```ts
    'client/terminal-resize'(size: { cols: number; rows: number }): void
```

并把第 203 行的每标签 resize 接线从

```ts
    const resize = pane.terminal.onResize(({ cols, rows }) => { if (tab.sessionId) this.ctx.clientTransport.api.resize(tab.sessionId, cols, rows) })
```

改为

```ts
    const resize = pane.terminal.onResize(({ cols, rows }) => {
      if (tab.id === this.activeId) this.ctx.emit('client/terminal-resize', { cols, rows })
      if (tab.sessionId) this.ctx.clientTransport.api.resize(tab.sessionId, cols, rows)
    })
```

只对活动标签发事件，是因为状态栏描述的是可见的那个终端，而其它标签在各自的 pane 里保留自己的真实尺寸。

- [ ] **步骤 2：写服务**

新建 `packages/ui/src/services/chrome.ts`：

```ts
import { Service, type Context } from 'cordis'
import { VERSION } from '../lib/version.js'

declare module 'cordis' { interface Context { clientChrome: ClientChrome } }

const STATE_TEXT: Record<string, string> = {
  connecting: '连接中', connected: '已连接', disconnected: '已断开', failed: '连接失败',
}

/**
 * The 24px status bar, the theme and the row density.
 *
 * Only four fields, because only four values exist to show: the Host reports no
 * negotiated cipher, no remote key type and no session uptime, and an
 * approximation of any of them in a status bar is worse than an empty slot.
 */
export class ClientChrome extends Service {
  static inject = ['clientView', 'clientTerminal']

  constructor(ctx: Context) {
    super(ctx, 'clientChrome')
    const view = ctx.clientView
    view.element('status-version').textContent = `v${VERSION}`
    ctx.on('client/connection-change', () => this.render())
    ctx.on('client/session-change', () => this.render())
    ctx.on('client/tab-closed', () => this.render())
    ctx.on('client/terminal-resize', () => this.render())
    this.render()
  }

  private render(): void {
    const view = this.ctx.clientView
    const tab = this.ctx.clientTerminal.active
    const dot = view.element('status-dot')
    if (!tab) {
      dot.dataset.state = ''
      view.element('status-state').textContent = '主机库'
      view.element('status-endpoint').textContent = `${this.ctx.clientTerminal.tabs.length} 个会话标签`
      view.element('status-size').textContent = '—'
      return
    }
    dot.dataset.state = tab.state
    view.element('status-state').textContent = STATE_TEXT[tab.state] ?? tab.state
    view.element('status-endpoint').textContent = `${tab.request.username}@${tab.request.host}:${tab.request.port ?? 22}`
    view.element('status-size').textContent = `${tab.terminal.cols}×${tab.terminal.rows}`
  }
}
```

- [ ] **步骤 3：挂载它**

在 `packages/ui/src/client.ts` 中，与其它 service 导入并列加入：

```ts
import { ClientChrome } from './services/chrome.js'
```

把第 15 行 `scopes` 键联合里加上 `'chrome'`，使其读作

```ts
  readonly scopes: Readonly<Record<'view' | 'transport' | 'terminal' | 'keychain' | 'hosts' | 'sftp' | 'chrome' | 'application', Fiber>>
```

并在 `scopes` 对象的 `sftp` 之后注册：

```ts
    chrome: context.plugin(ClientChrome),
```

**不要**把 `clientChrome` 加进 `features/readiness.ts:9`：状态栏不是就绪条件，用它门控会让一个
外壳 bug 阻塞整个应用。

- [ ] **步骤 4：类型检查并跑守卫**

```powershell
npm run typecheck
node --test "packages/ui/tests/*.test.mjs"
```
预期：两者都干净。`visual-contract.test.mjs` 通过，因为服务读取的每个 id 现在都存在于 markup 中。

- [ ] **步骤 5：提交**

```bash
git add packages/ui/src/services/chrome.ts packages/ui/src/services/terminal.ts packages/ui/src/client.ts
git commit -m "feat(ui): report connection state, endpoint, size and version in the status bar"
```

---

### 任务 7：主题与密度开关

两个开关各自写 `<html>` 上的一个属性并记住选择。`lib/version.ts` 在任务 6 得到它的第一个导入方，
而 `localStorage` 在本任务得到它在这个代码库里的第一个 —— 没有现成的设置服务可以扩展。

**文件：**
- 修改：`packages/ui/src/index.html:21-32`
- 修改：`packages/ui/src/services/chrome.ts`
- 修改：`packages/ui/tests/visual-contract.test.mjs`
- 修改：`packages/ui/tests/client-lifecycle.browser.ts`

- [ ] **步骤 1：把控件加进顶栏**

在 `packages/ui/src/index.html` 中，把 `<header class="app-topbar">` 元素的结尾部分（目前
`#workspace-tabs` 之后只有一个 `</div>`）改成，使 header 以下面这段收尾：

```html
        </div>
        <div class="topbar-actions">
          <button type="button" id="theme-toggle" class="icon-button" aria-label="切换到浅色主题" aria-pressed="false" title="主题"><i class="ti ti-moon" aria-hidden="true"></i></button>
          <button type="button" id="density-toggle" class="icon-button" aria-label="切换到紧凑行高" aria-pressed="false" title="行高密度"><i class="ti ti-arrows-minimize" aria-hidden="true"></i></button>
        </div>
      </header>
```

`.topbar-actions` 在 `chrome.css` 里早已存在，直到此刻之前都是死代码。

- [ ] **步骤 2：在行为测试里先声明失败**

`packages/ui/tests/client-lifecycle.browser.ts` 是一个长长的 `runChecks()`，由一串形状相同的场景块
组成：造 fixture、`createClient`、断言、`await client.dispose()`、`checks.push('…')`。在
`checks.push('New Host is the only visible entry for creating a host')` 那行（当前第 185 行）之后
加入一个新块：

先在文件的导入区加上 `import { VERSION } from '../src/lib/version.js'` —— 断言字面版本字符串会让
每次发版都变成一次测试改动。

```ts
    const chrome = fixture()
    client = createClient({ api: chrome.api, terminalFactory: chrome.terminalFactory })
    assert((await client.ready).ok, 'chrome client failed readiness')
    const html = document.documentElement
    assert(!html.hasAttribute('data-theme'), 'a first run must carry no stored theme')
    assert(input('status-version').textContent === `v${VERSION}`, 'the status bar must render the generated version')
    click('theme-toggle')
    assert(html.dataset.theme === 'light', 'the theme switch must write data-theme on <html>')
    assert(document.getElementById('theme-toggle')!.getAttribute('aria-pressed') === 'true',
      'the switch must report its own state')
    click('density-toggle')
    assert(html.dataset.density === 'compact', 'the density switch must write data-density')
    const remembered = JSON.parse(window.localStorage.getItem('pureterm.chrome') ?? '{}')
    assert(remembered.theme === 'light' && remembered.density === 'compact',
      'both choices must persist under one key, so a partial write cannot desynchronise them')
    await client.dispose()
    client = createClient({ api: chrome.api, terminalFactory: chrome.terminalFactory })
    assert((await client.ready).ok, 'restored chrome client failed readiness')
    assert(html.dataset.theme === 'light' && html.dataset.density === 'compact',
      'a remount must restore both choices from storage')
    window.localStorage.removeItem('pureterm.chrome')
    delete html.dataset.theme
    delete html.dataset.density
    checks.push('the status bar renders real fields, and both chrome switches persist across a remount')
```

然后把尺寸字段加进已有的多标签场景：在它的
`assert(gestures.stats.opens === 1 …)` 一类连接断言之后，驱动 fixture 自己的 resize 监听并检查状态栏跟随：

```ts
    const device = gestures.terminals.at(-1)!
    for (const listener of device.resizeListeners) listener({ cols: 132, rows: 41 })
    await tick()
    assert(input('status-size').textContent === '132×41', 'the status bar must follow the active terminal size')
```

运行：`npm run verify:electron`
预期：如果更早的场景留下了值，会以 `a first run must carry no stored theme` 失败；否则以
`the theme switch must write data-theme on <html>` 失败 —— 控件此刻还没有行为。

- [ ] **步骤 3：实现开关**

在 `packages/ui/src/services/chrome.ts` 中，类之上加入：

```ts
const CHROME_KEY = 'pureterm.chrome'
interface ChromePrefs { theme?: 'dark' | 'light'; density?: 'comfortable' | 'compact' }

/** One key for both choices: two independent keys would let a partial write leave a
 *  remembered theme and a lost density, which reads as the switch being broken. */
function readPrefs(storage: Storage): ChromePrefs {
  try { return JSON.parse(storage.getItem(CHROME_KEY) ?? '{}') as ChromePrefs } catch { return {} }
}
```

并在构造函数里、`this.render()` 之前加入：

```ts
    const html = view.document.documentElement
    const storage = view.window.localStorage
    const prefs = readPrefs(storage)
    const theme = view.element<HTMLButtonElement>('theme-toggle')
    const density = view.element<HTMLButtonElement>('density-toggle')
    const apply = (): void => {
      if (prefs.theme) html.dataset.theme = prefs.theme
      if (prefs.density) html.dataset.density = prefs.density
      theme.setAttribute('aria-pressed', String(prefs.theme === 'light'))
      theme.setAttribute('aria-label', prefs.theme === 'light' ? '切换到深色主题' : '切换到浅色主题')
      theme.firstElementChild?.className = `ti ${prefs.theme === 'light' ? 'ti-sun' : 'ti-moon'}`
      density.setAttribute('aria-pressed', String(prefs.density === 'compact'))
      density.setAttribute('aria-label', prefs.density === 'compact' ? '切换到舒适行高' : '切换到紧凑行高')
      density.firstElementChild?.className = `ti ${prefs.density === 'compact' ? 'ti-arrows-maximize' : 'ti-arrows-minimize'}`
    }
    const save = (): void => { try { storage.setItem(CHROME_KEY, JSON.stringify(prefs)) } catch { /* a private-mode quota denial costs the choice, not the session */ } }
    this.scope.listen(theme, 'click', () => {
      prefs.theme = prefs.theme === 'light' ? 'dark' : 'light'
      html.dataset.theme = prefs.theme
      save()
      apply()
    })
    this.scope.listen(density, 'click', () => {
      prefs.density = prefs.density === 'compact' ? 'comfortable' : 'compact'
      html.dataset.density = prefs.density
      save()
      apply()
    })
    apply()
```

`this.scope` 在这个服务上还不存在。加上导入 `import { ClientScope } from '../client-runtime.js'`、
字段声明 `private readonly scope: ClientScope`，并在构造函数的**第一条语句**处赋值
`this.scope = new ClientScope(ctx)` —— 与 `features/readiness.ts:14` 的 `ClientApplication` 完全
一致。不要用 `this.ctx` 初始化字段：此时基类 `Service` 确实已经设好了 `ctx`，但这个包里每一个服务
都取构造函数参数，跟着它们是为了让模式可读。

- [ ] **步骤 4：断言开关在结构上存在**

在 `packages/ui/tests/visual-contract.test.mjs` 中，第一条测试里 `#primary-nav` 断言之后加入：

```js
  assert.match(html, /id="theme-toggle"/, 'the light theme is unreachable without this control')
  assert.match(html, /id="density-toggle"/)
  assert.match(html, /class="status-bar"/)
  assert.match(css, /\.status-bar\s*\{[^}]*var\(--status-h\)/, 'the status bar must be drawn from its token')
```

运行：`node --test "packages/ui/tests/visual-contract.test.mjs"`
预期：PASS。

这两个控件不需要任何 CSS：`.topbar-actions` 已经是一行 flex（`chrome.css:30-31`），而
`.app-topbar button` 已经退出了拖拽区（`chrome.css:27`），这正是让它们在可拖拽的栏里保持可点击的
东西。

- [ ] **步骤 5：验证行为**

```powershell
npm run build
npm run verify:electron
```
预期：PASS，包括重新挂载之后那条恢复主题的断言。

- [ ] **步骤 6：提交**

```bash
git add packages/ui/src/index.html packages/ui/src/services/chrome.ts packages/ui/src/styles/chrome.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): ship the theme and density switches"
```

---

### 任务 8：修正文档

设计系统文档现在有三处写着浅色主题不可达、开关不存在。任务 7 之后这些都不成立，而在这个主题的
唯一权威文件里写一句假话比不写更糟。

**文件：**
- 修改：`docs/design-system.md`、`docs/design-system_zh.md`
- 修改：`docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` + `_zh.md`
- 修改：`CHANGELOG.md`、`CHANGELOG_zh.md`
- 修改：`packages/ui/src/lib/changelog.ts`（生成物）

- [ ] **步骤 1：重写可达性声明**

在 `docs/design-system.md` 的 `## Theme mechanism` 里，以
`**The switch does not exist yet.**` 开头的那条改为：

```md
- **The switch exists.** `#theme-toggle` and `#density-toggle` in the top bar are written by
  `packages/ui/src/services/chrome.ts`, which sets `data-theme` and `data-density` on `<html>` and
  remembers both under the single `pureterm.chrome` key. A first run carries no `data-theme` at all
  and so resolves to the `:root` group. Because `script-src 'self'` forbids an inline pre-paint
  script, a stored light theme is applied one frame after `app.js` runs: the top bar paints dark,
  then flips. That flash is the price of the CSP, and it is accepted rather than worked around.
```

然后在 `## Known gaps` 里删除以
`The light theme has no switch, so no cell of the light columns…` 开头的那条，并修正列出
`--overlay-soft`、`--overlay-press`、`--ac-focus` 与十四个度量的那条消费者普查：其中三个度量
（`--chrome-h`、`--rail-w`、`--status-h`）现在在 `chrome.css` 里有了调用点，因此计数与清单都要变。
用翻转时同一套方法重算 —— 读分片、数 `var(--x)` —— 而不是手工改数字。

- [ ] **步骤 2：修正规格对状态栏的承诺**

在 `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md`（及其 `_zh.md`）里找到列出
加密算法、主机密钥类型与在线时长的那句状态栏描述，替换为：

```md
The status bar carries only what the renderer actually receives: connection state,
`user@host:port`, terminal `cols×rows`, and the app version. Negotiated cipher, remote host key
type and session uptime were in the original design and are **not** available — the Host reports
`{id, host, port, username}` for a session and never reads ssh2's negotiated state. Exposing them
is a `@pureterm/protocol` change with its own plan, not a UI task.
```

中文版对应改为：

```md
状态栏只承载渲染层真正收到的东西：连接状态、`user@host:port`、终端 `cols×rows`、应用版本。协商
加密算法、远端主机密钥类型与会话在线时长在最初的设计里出现过，但**拿不到** —— Host 对一个会话只
报告 `{id, host, port, username}`，从不读取 ssh2 的协商状态。把它们暴露出来是一个
`@pureterm/protocol` 改动，需要自己的计划，不是 UI 任务。
```

- [ ] **步骤 3：记录用户可见的变化**

在 `CHANGELOG.md` 的 `## [Unreleased]` → `### Changed` 下加入：

```md
- Rebuild the application chrome: the navigation sidebar becomes a 52px icon rail, the top bar
  drops from 76px to 40px and now carries the brand mark, the session tabs and two new switches,
  and a 24px status bar reports connection state, endpoint, terminal size and version. The
  desktop window's title-bar overlay follows the new height.
- Add a theme switch and a row-density switch. The light theme is now reachable in the running app,
  and both choices are remembered. Because the page's Content-Security-Policy forbids an inline
  pre-paint script, a stored light theme applies one frame after start.
```

并在 `### Fixed` 下加入：

```md
- The status bar shows only fields the backend actually reports. Negotiated cipher, remote host key
  type and session uptime are absent rather than approximated; exposing them needs a protocol
  change.
```

两条都在 `CHANGELOG_zh.md` 里做对应中文。

- [ ] **步骤 4：重新生成元数据并检查链接**

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```
```bash
git diff --check
```
预期：`Changelog and workspace versions are valid for 0.1.0-alpha.1.` 且没有空白错误。
然后打开你改过的每个相对链接与 `#anchor`，逐一确认可以解析 —— 本仓库没有 markdown-link 脚本，
所以靠人工检查。

- [ ] **步骤 5：提交**

```bash
git add docs/ CHANGELOG.md CHANGELOG_zh.md packages/ui/src/lib/
git commit -m "docs(ui): record the chrome rebuild"
```

---

### 任务 9：看它

本任务不改动任何东西，且不得跳过。计划二的任务 7 只完成了一部分，因为浏览器表面反复消失；这一次
要决定浅色主题是不是真的。

- [ ] **步骤 1：走过两个入口**

```powershell
npm run start:web
npm run start:desktop
```

- [ ] **步骤 2：检查这次重建会造成的具体失效模式**

对着运行中的应用逐条报告：(a) 没有文字的 52px 轨道是否仍可导航 —— 三个图标是否读得出是
Hosts / Keychain / 快捷键，活动标记是否落在那条细线上而不是悬在半空；(b) 40px 顶栏是否仍然像一条
可以拖动的标题栏，以及在窗口允许的最窄宽度下窗口按钮是否会压到会话标签；(c) 浅色主题第一次真正
出现在屏幕上时，细线、`--c-control` 字段面与 `--tx-3` 弱化文字是否站得住；(d) 终端在浅色外壳里
是否保持深色且没有可见接缝；(e) 状态栏 11px 文字在你的显示器上 100% 是否可读，拖动窗口时
`cols×rows` 是否更新；(f) 已存浅色主题带来的那一帧深色闪烁，读起来像 bug 还是像启动过程；
(g) 行高从 54px 变成 34px 之后，图标轨道的悬停态是否仍读得出是悬停。

- [ ] **步骤 3：确认桌面几何**

在 Windows 上跑 `npm run start:desktop`，检查原生标题按钮是否落在 40px 覆盖层之内，以及顶栏有没有
任何部分被操作系统绘制。然后在 125% 缩放下重复检查 —— 那是色板翻转复核时使用的缩放。

- [ ] **步骤 4：如实报告**

任何没能检查的，直说。任何重建让界面变差的条目进入计划四的前置清单，而不是在这里重调 —— 尤其是
如果浅色主题暴露出某个底面或细线是只为深色挑的，把它作为一个 token 修正写下来并附上实测配对，
不要悄悄改动十四条测试都在断言的取值。

---

## 完工判据

- `--chrome-h`、`--rail-w`、`--status-h` 是外壳几何唯一的书写处，且 `theme-sync.test.mjs` 把
  Electron 覆盖层与 `env()` 回退值拴到 `--chrome-h`。
- 轨道在任何宽度下都是 52px，`#nav-toggle`、`.nav-collapsed`、`.window-control`、
  `.update-pill`、`.workspace-chevron` 与 `.app-shell.failure-mode` 全部消失，`git grep` 找不到
  任何一处引用。
- 状态栏显示四个真实字段；版本字符串透过 `lib/version.ts` 抵达页面，而它终于有了导入方。
- `#theme-toggle` 让浅色分组可达，两个开关在重新挂载后仍然成立，且 `docs/design-system.md` 不再
  写着开关不存在。
- `npm run verify`、`npm run verify:electron` 与 `npm run release:check` 全部通过。
- 浅色主题第一次被人用眼睛看过，而看到的东西无论是否改变了什么，都被写了下来。

## 不在本计划内

- 计划四：各屏 —— 带列标题的 hosts 与 keychain 表格、取代覆盖式抽屉的右固定 Inspector、可拖拽的
  终端/SFTP 分栏、四态、toast、带真实阶段的路由失败诊断、以及把六个断点合并为三个。
- 那个会暴露协商加密算法、远端主机密钥类型与会话在线时长的 `@pureterm/protocol` 改动。在它落地
  之前，这些位置保持空缺。
- 安装包图标（`.ico`、`.icns`）。favicon 是内联 SVG；Windows 图标文件是二进制资产，需要自己的
  生成步骤，也需要在目标平台上单独验证。

---

## 执行所发现的

任务 1-8 按写的样子落地，每个一个提交：`bfaf9f7` 几何 token、`d2c4c97` 网格与覆盖层、`1e6a49d` 图标轨道、`7e72732` 死外壳、`1e51501` 标记、favicon 与状态栏外壳、`149c0fa` 状态字段、`33b939f` 两个开关、`a07ce0e` 文档。两处偏离，都写进了各自的提交信息：820px 块顺带丢掉了一条后面的同名块本来就覆盖的 `.workspace-switcher` 宽度；而 620px 里隐藏 `.topbar-actions .icon-button` 的那条规则提前一个任务删掉了，因为两个开关就落在这个容器里，必须保持可达。

**任务 9 找出四件事，四件都当场修了，没有归档了事。**

- 标签条在新的 40px 栏里高 52px：`.app-tab { min-height: 44px }` 加上 `.workspace-tabs { padding: 4px 2px }`，超出了栏自己的底部细线。实测是 `y: -6.3, height: 52`。现在标签 28px，垂直内边距为零。
- `.nav-item { height: 34px }` 渲染出来是 38px，因为 `base.css` 给每个 `button` 一条 `min-height: 38px`，而单写 `height` 会输给 `min-height`。修法是连同 `min-height` 一起写；这个坑值得那句话，因为同一对属性还会在下一个定尺寸的控件上咬人。
- `.status-bar` 的文字是 `--c-chrome` 上的 `--tx-3`，而 `docs/design-system.md` 的合法性表早就标出它在浅色组是 4.23:1 —— 低于一个 11px 标签需要的下限。现在是 `--tx-2`，在活页面上实测深色 10.20:1、浅色 7.70:1。
- 轨道图标是 `--c-chrome` 上的 `--tx-4`：深色 2.79:1、浅色 2.28:1，低于非文本元素的 3:1 下限 —— 而且文字标签已经去掉了，图标是唯一还有的示意物。现在是 `--tx-3`（4.99 / 4.23），悬停时 `--tx-1`。

新增的守卫 `the top bar contents fit the height the bar is given` 会读 `--chrome-h` 并拿 `.app-tab` 与 `.nav-item` 去比，于是两者再也无法悄悄长过这条栏而不报错。

**关于测量手段的说明，因为它决定了哪些结果可信。** 内置浏览器表面在几乎整个过程中都是隐藏的，而 Chromium 不会在隐藏页面上推进 transition。翻掉 `data-theme` 之后立刻读取一个被过渡的属性，拿到的是过渡前的值：`.host-row` 与 `.nav-item` 看上去根本没有重新着色，那是测试手段的假象，不是缺陷。只有非过渡的声明可以用这种方式量 —— 网格盒、轨道宽度、状态栏自己的底色与文字。所以上面轨道图标的比例是引自已记录的矩阵而非实测，而**浅色主题至今仍然没有被任何人的眼睛看过**。

尚未检查、仍然欠着的：一次真实 SSH 会话以及随之而来的终端接缝；打开的 SFTP 面板；100% 与 125% 下的桌面窗口；以及在窗口允许的最窄宽度上标签条与窗口按钮会不会相撞。`npm run verify` 与 `npm run verify:electron` 均通过（退出 0，7 个渲染器套件），加上那条尺寸守卫之后 53 条 UI 守卫全部通过。

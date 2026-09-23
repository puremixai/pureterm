# 前端专业化重设计

[English version](2026-09-23-frontend-professional-redesign.md)

## 意图与基线

重做 `packages/ui/` 共享浏览器界面的视觉语言，让 PureTerm 读起来像一件精密的工程仪器，而不是一层主题皮肤。现有样式表是一个 581 行的单文件：`:root` 声明了 26 个 token，而后面约 80 条规则各自硬编码自己的十六进制色值，并且五个基础表面横跨 232°–240° 色相。让深色主题读起来像游戏皮肤的，是这个蓝紫偏色，而不是布局。

方向 **A · 中性石墨**是在另外两个备选（亮色外壳配深色终端、带柔阴影的层次暗色）之间，用同一布局换三套皮肤对比后选定的。范围覆盖所给四个包的全部内容：token 地基、结构升级、品牌标记加主题单一来源、亮暗双主题。交付采用 token 优先的渐进方式；一次性整页重写和引入 Tailwind 工具链都被否决。

全部工作在分支 `feat/ui-redesign` 上进行，绝不在 `main` 上开发。

## 非目标

- 不引入 Tailwind、组件库或任何新的运行时 UI 依赖。`@pureterm/ui` 保持仅面向浏览器、零框架，`scripts/check-boundaries.mjs` 必须原样继续通过。
- 不改 `@pureterm/protocol`、`@pureterm/host`、`@pureterm/transport`。连接阶段化错误码和 `ui-prefs` 存储都明确延后。
- 不改布局范式：导航仍在左侧，主机列表与编辑面仍然分离，终端仍是每标签一个 pane。
- 不做安装包图标（`.icns`、`.ico`、多尺寸 PNG）。那会把 `electron-builder` 配置和完整的 `verify:package:windows` 安装/卸载流程拖进一次 UI 改动。
- 不给主机列表引入真正的 `<table>` 语义；卡片与行共用同一 DOM，角色语义会冲突。
- 不打包终端字体。
- 不升版本。`VERSION.txt` 保持 `0.1.0-alpha.1`，全部改动记入 `[Unreleased]`。

## Token 体系

`packages/ui/src/styles/tokens.css` 成为唯一允许出现字面色值的地方。其他所有文件只消费变量。

### 中性灰阶

色相固定在 210°、饱和度不高于 5%，让深度只表达层级、绝不表达情绪。

| Token | dark | light | 用途 |
| --- | --- | --- | --- |
| `--c-inset` | `#08090a` | `#eceef1` | 代码、日志、内嵌输入框 |
| `--c-canvas` | `#0a0b0d` | `#f7f8f9` | 窗口底 |
| `--c-chrome` | `#0e1013` | `#eef0f2` | 顶栏、轨道、状态栏、对话框页脚 |
| `--c-surface` | `#131519` | `#ffffff` | 卡片、行、面板、Inspector |
| `--c-raised` | `#191c21` | `#f4f6f8` | hover、选中行、浮层 |
| `--c-control` | `#21252b` | `#e8ebef` | 分段选中态、输入底色、kbd |
| `--line` | `#262a31` | `#dfe3e8` | 主力发丝线，也是主要分层手段 |
| `--line-soft` | `#1c1f24` | `#eceef1` | 行与分组分隔 |
| `--line-strong` | `#3a4049` | `#c6ccd4` | 控件边框 |

文字四级：`--tx-1` `#f2f3f5`/`#16181c`、`--tx-2` `#b9bec6`/`#454b54`、`--tx-3` `#7d838d`/`#6b7280`、`--tx-4` `#565b63`/`#9aa1aa`。

`--tx-4` 只保留给禁用态控件与纯装饰规则——它在 `--c-surface` 上约 2.7:1，有意排除在 AA 断言之外的。这正是 `--fs-micro` 列标题与分组标签使用 `--tx-3` 而不是 `--tx-4` 的原因：它们承载真实信息，必须保持可读。

### 点缀色与语义色

现有样式表携带四种蓝（`#3c9ef5`、`#a7c4ff`、`#69c8f4`、`#096da9`、`#086ba7`、`#075a87`）和三种绿。它们收敛为一个 accent 加四个状态色，其余一律用灰阶。

| Token | dark | light | 用途 |
| --- | --- | --- | --- |
| `--ac` | `#5aaeff` | `#1f6feb` | 唯一强调色：主按钮、选中、焦点、轨道活动标记 |
| `--ac-hi` | `#7cc0ff` | `#1a5fcd` | hover |
| `--ac-bg` | `rgba(90,174,255,.12)` | `rgba(31,111,235,.10)` | 选中底色 |
| `--ac-fg` | `#05070a` | `#ffffff` | 实心 accent 上的文字 |
| `--ok` | `#4ec27f` | `#1a7f4b` | 已连接、已校验 |
| `--warn` | `#e0a83c` | `#9a6a0a` | 旧密钥、能力降级 |
| `--err` | `#f2555a` | `#c2363b` | 失败；只用于描边，绝不用于实心填充 |
| `--idle` | `#8b919b` | `#7e8590` | 断开状态点 |

`--idle` 的浅色值是修正而非重调，方式与下文 ANSI 集合的第 0 项和亮色第 0 项相同：这里原先规定的 `#c9ced5` 实测在 `--c-surface` 上是 1.58:1、在 `--c-chrome` 上是 1.385:1，远低于状态点必须越过的 3:1 下限，于是任务 1 把它换成 `#7e8590`，测得 3.72:1 与 3.26:1。`design-tokens.test.mjs` 按主题断言这条下限。

主按钮是实心 accent 配 `--ac-fg` 文字。危险按钮保留 ghost 描边，只让描边与文字转成 `--err`。

实测对比度：`--tx-1` 在 `--c-surface` 上 dark ≈ 16.5:1、light ≈ 17.7:1；`--tx-3` 在 `--c-surface` 上 ≈ 4.8:1；实心主按钮 ≈ 8.5:1 dark、≈ 4.6:1 light。正文尺寸全部通过 WCAG AA。

### 排版

- `--font-ui`：`Inter, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif`
- `--font-mono`：`"JetBrains Mono", "Cascadia Mono", Consolas, monospace` —— 仅用于外壳
- `--font-term`：终端沿用系统 mono 栈 `"Cascadia Mono", Consolas`，原因见下文测量竞态

终端表面 token 取代 `terminal-view.ts` 里那四个硬编码值：`--term-bg #08090a`、`--term-fg #c9ced6`、`--term-cursor #5aaeff`、`--term-selection rgba(90,174,255,.24)`。16 个 ANSI 项一次性收进一组中性值，并记入 `docs/design-system.md`：常规 `#101317 #f2555a #4ec27f #e0a83c #5aaeff #c58aff #57c8d0 #b9bec6`，亮色 `#5f656e #ff7b81 #7ddba8 #f2c86f #7cc0ff #d9a8ff #7fe0e8 #f2f3f5`。第 0 项刻意不等于 `--term-bg`，因为两者相同会让黑字压在终端底色上按构造恰好是 1.00:1；亮色第 0 项要过 3:1，因为提示符用它表示"调暗"而非"隐藏"的文字。它们在浅色主题下仍然保持深色。

| Token | 规格 | 用途 |
| --- | --- | --- |
| `--fs-micro` | 11px / 500 / `.07em` / 大写 | 分组标签、列标题 |
| `--fs-meta` | 12px / 400 | 地址、指纹、元信息 |
| `--fs-ui` | 13px / 400 | 正文默认 |
| `--fs-em` | 14px / 500 | 按钮、强调值 |
| `--fs-h2` | 16px / 600 / `-.01em` | 分组标题 |
| `--fs-h1` | 20px / 600 / `-.02em` | 页面标题 |
| `--fs-term` | 13.5px / 1.5 | xterm.js |

字重从 `400/600/650/700/750/800` 收敛为 `400/500/600/700`；650、750 这类值取不到真实字重，只会强制伪粗，从而让中文和小号西文发虚。凡承载 IP、端口、大小、延迟、时长、权限位的元素一律 `font-variant-numeric: tabular-nums`，避免列抖动。

### 度量

- 间距以 4px 为基准：`--s-1` 4、`--s-2` 8、`--s-3` 12、`--s-4` 16、`--s-5` 24、`--s-6` 32。
- 行高 `--row-h` 标准 38，`[data-density="compact"]` 下 `--row-h-compact` 30。控件高度 26 与 28。
- 圆角从 7/10/15 收紧为 `--r-1` 3（输入、徽章）、`--r-2` 5（按钮、行、卡片）、`--r-3` 8（面板、对话框）、`--r-full` 999（状态点）。
- dark 分层只用发丝描边、不用阴影；`--shadow-pop`（`0 8px 24px -6px` 加 1px 环）仅给浮层和对话框；light 允许在抬起的表面加 `0 1px 2px rgba(16,24,40,.05)`。
- `--z-drawer` 20、`--z-popover` 30、`--z-toast` 40、`--z-dialog` 50。
- 动效只用一条曲线 `--ease cubic-bezier(.2,.8,.2,1)`，时长 `--t-1` 100ms、`--t-2` 160ms、`--t-3` 240ms。`prefers-reduced-motion: reduce` 关闭全部过渡与骨架动画。
- 焦点用双环，两个主题都可见：`box-shadow: 0 0 0 2px var(--c-canvas), 0 0 0 4px var(--ac)`，仅由 `:focus-visible` 触发。

## 主题机制

1. `<html data-theme="dark|light">` 选择一组变量，`color-scheme` 在同一条规则里一起切换，让原生滚动条、表单控件与 `::selection` 跟随。
2. 终端在两个主题下都使用独立的 `--term-*` 深色组。浅色外壳配深色终端是刻意为之，不得被"修正"。
3. 优先级为：显式存储值 → 存储值为 `system` 时用 `prefers-color-scheme` → dark。默认 dark。
4. `tokens.css` 是唯一权威。`index.html` 的 `theme-color` meta、`apps/desktop/electron/app/shell.ts` 的 `backgroundColor` 与窗口按钮 overlay 的 `symbolColor`、`packages/ui/src/terminal-view.ts` 的 `background` 保留各自字面量，因为运行时耦合会破坏仅面向浏览器的边界；由 `theme-sync.test.mjs` 解析 `tokens.css` 并在四处漂移时让测试失败。

## 应用外壳

- 顶栏高 40px，是拖拽区。依次放品牌标记、`PureTerm` 字标加 `/ Vault` 或 `/ Session` 上下文、工作区标签条、主题开关，以及预留的原生窗口按钮位。
- 品牌改为内联 SVG 的 prompt 标记（chevron 加光标条）取代文字 `PT`，并补上真正的 favicon。标记为 18px，置于带 `--line-strong` 描边的 `--c-control` 方块内。
- 左侧导航改为 52px 图标轨道，活动项带 2px accent 指示条。3 个导航项不值得 278px，省下的 226px 正好付给主机表格的列。删除 `nav-collapsed`、`#nav-toggle` 及相关规则；导航页脚的工作区状态移入状态栏。
- 新增 24px 状态栏，作为 `#app` 的第三栅格行：连接点与状态、在线时长、`user@host:port`、协商出的加密算法与主机密钥类型、终端尺寸、SFTP 速率、能力状态、版本号。只有连接状态元素带 `role="status"`。
- 删除 `.window-control` 这段死规则，没有任何 markup 与之对应。
- 会话标签进顶栏，含状态点、主机名，以及 hover 才出现的关闭按钮。

## Hosts 工作区

页头一行是标题、计数元信息、搜索（带 `Ctrl K` 提示）、主操作和视图开关。默认视图是在既有 `<ul>` 上的五列网格：Name（头像加标签）、Address、User、Auth、Last connected。Auth 列区分 `keychain` 与本地文件并显示算法，因为这正是决定一台主机能不能用的事实。卡片视图仍作为开关保留。

选中态是 `--ac-bg` 加左缘 2px accent 条；hover 只把行提升一级表面。`ssh-dss` 这类旧材质或已变更的主机指纹用 `--warn` 文字加图标，绝不用大面积填充。

## 连接 Inspector

编辑面改为右固定 322px，不再覆盖，底色 `--c-surface` 加左缘发丝线。页头是 `--fs-micro` 模式标签，正文分组由 `--line-soft` 横线下的 `--fs-micro` 标题划分，字段用标签在上、26px 输入框落在 `--c-inset`，页脚粘性固定：左侧删除，右侧保存与 Connect。

地址与端口并成一行两个字段，下方实时显示解析结果（`ssh deploy@10.2.1.8:22`）。认证从 `<select>` 改为两格分段控件。凭据存储状态是一行常驻可见、写明操作系统加密提供方的锁标记，取代时有时无的 `#credential-hint`。

## Keychain 工作区

沿用表格加 Inspector 的模式。列表上方常驻一条横幅，写明加密提供方与"不以明文落盘"的保证，因为 `#keychain-policy` 现在是个没人会看到的空文本节点。列为 Name、Type、SHA256 指纹、Host count、Created。Inspector 里私钥以只读 mono 块呈现并带有效性徽章，单独一行说明私钥与口令在重新编辑时永不回显，保留拖拽导入目标，并提供公钥的复制与下载。

## 终端与 SFTP

`session-content` 改为水平分栏，终端与 SFTP 之间是一条 5px 可拖拽握把，取代写死的 `grid-template-rows: minmax(120px,1fr) minmax(160px,40%)`。握把自身扩大命中区，中间条 hover 转 accent，比例在会话期内保持。

SFTP 面板改为四列表格：Name、Size、Mode（八进制）、Modified，配面包屑路径、行级传输进度、右对齐的 `tabular-nums` 数字。

## 连接失败诊断

`tab.logs` 目前完全由 UI 拼装（`packages/ui/src/services/terminal.ts:303` 塞入一条首行，`:329` push 一条 `cleanError(error)`），Host 从未上报过阶段。因此分类在页面内完成：把错误文本对照一张已知 SSH 与 socket 失败表做匹配——`ENOTFOUND`、`ECONNREFUSED`、`ETIMEDOUT`、`Permission denied (publickey)`、主机密钥变更、`Unable to negotiate`、认证超时——每条映射到一个类别徽章、路由中失败的节点、以及一条下一步建议。

路由从两个点扩为四个节点（本机、TCP、密钥交换、认证），失败处画成红色虚线段。日志变成带不可选中行号的 `--c-inset` mono 块，错误行着以 `--err`。操作区是重新连接、编辑主机、复制日志，外加那一行建议。

若某次失败无法归类，路由塌成单个失败节点，页面退化为纯日志块。这样整个能力都留在 `@pureterm/ui` 内部。

## 状态与反馈

每个列表都有四态：加载骨架（shimmer 行高与真实 38px 一致，加载完成不跳动，`aria-hidden` 加一条礼貌状态文本）、空（图标、一行解释、能解决它的那个动作）、错误（后端不可用与单条操作失败分开）、降级（某项能力关闭而其余仍可用，例如密钥库不可用）。

右下角 toast 取代散落的 `#status` 文本节点：2px 语义色条、标题、一行 mono 细节、自动消失。普通提示用 `role="status"`，失败用 `role="alert"`。

## 资源与依赖

- 把 `@fontsource-variable/inter` 加为 `packages/ui` 依赖，只从 `base.css` 引入其 latin 与 latin-ext 字面，与 `style.css:1` 已有的 `@tabler/icons-webfont` 裸标识符 CSS 引入方式一致。esbuild 已经把 woff2 输出到 `dist/fonts/`（`scripts/build-ui.mjs:10-11`），`font-src 'self'` 允许。
- 中文永不打包 webfont，逐级回退到 `Microsoft YaHei UI`、`PingFang SC`、`Noto Sans CJK SC`。
- 图标继续用 Tabler。加一条全局规则把 `.ti` 钉在 `font-weight: 400` 与 `-webkit-font-smoothing: antialiased`，因为继承来的 600–800 字重会让图标字体伪粗。
- favicon 与内联品牌 SVG 是新的源码资源。不引图标工具链、不引远程资源、不引 CDN。

## 文件

`packages/ui/src/style.css` 保留为引入清单，这样 `app.ts:2-3`、`index.html:17` 的 `<link>` 和 `dist/app.css` 产物契约三处都不必改动。

```text
packages/ui/src/style.css            清单：先 Tabler，再按序引入各分片
packages/ui/src/styles/tokens.css    :root, [data-theme=light], [data-density]
packages/ui/src/styles/base.css      reset、排版、焦点环、滚动条、reduced motion
packages/ui/src/styles/chrome.css    顶栏、标签条、轨道、状态栏、品牌
packages/ui/src/styles/hosts.css     页头、搜索、行、卡片、空态
packages/ui/src/styles/inspector.css 共用的 section、field、segment、footer 体系
packages/ui/src/styles/keychain.css  策略横幅、密钥表格、PEM 块
packages/ui/src/styles/terminal.css  会话工具条、pane、xterm 覆盖、SFTP、握把
packages/ui/src/styles/states.css    骨架、四态、toast、dialog
```

不引 `@layer`：esbuild 会展平这些引入，文件顺序本身就是优先级，再多一套层叠模型只增加理解成本。

## 约束与已接受的折衷

1. 独立 Web 绑随机回环端口，因此 origin 每次启动都变，`localStorage` 里的偏好无法跨重启保留。Desktop 因 `pureterm-app://` 是稳定 origin 而正常持久化。Web 因此每次启动回落到 `prefers-color-scheme`；真正的修法是加一个 `ui-prefs` 协议请求，已延后。
2. CSP 保持 `script-src 'self'`，所以常规的首帧前置内联主题脚本这条路不可用。`index.html` 静态声明 `data-theme="dark"`，由最早的模块同步套用存储值，代价是浅色用户在 Desktop 上会看到一帧闪烁。
3. xterm 在插件加载时就测量单元盒宽度，尚未加载完的 webfont 会算出错误的字形宽度。与其往 `services/terminal.ts` 及其 `ResizeObserver` 驱动的 `fit()` 里加一道 `document.fonts` 门，本轮终端沿用系统 mono 栈。
4. 所有 id 都是承重的：`ClientView` 遇到缺失 id 会抛异常（`packages/ui/src/client-runtime.ts:55-65`）。不改任何 id 名。生命周期测试断言的行为类名 —— `.host-row`、`.host-main`、`.session-tab`、`.keychain-card`、`#host-list.list-view`、`aria-pressed`、`[data-tab-close]` —— 全部保留，让既有覆盖率继续有意义，而不是被改写成迎合新 markup。
5. 断点从五个（1250/1450/900/820/620）加一条容器查询合并为三个（1100/820/620）：1100 以下 Inspector 变窄，820 以下它全宽覆盖且 SFTP 落到终端下方，620 以下顶栏去掉上下文标签。

## 测试与验证

`test:unit` 已经通配 `packages/ui/tests/*.test.mjs`，新增测试不需要改 root script。

- 重写 `visual-contract.test.mjs`：两套主题的 token 组都存在；轨道与状态栏的栅格值匹配；并且**任何 token 块之外的十六进制或 `rgb()` 字面量都会让套件失败**——这条正是彻底淘汰那约 80 处硬编码的机制。
- 新增 `theme-sync.test.mjs`：解析 `tokens.css`，断言 `theme-color` meta、`shell.ts` 的背景与 overlay `symbolColor`、`terminal-view.ts` 的背景与之相符。
- `client-lifecycle.browser.ts` 增加轨道、标签、状态栏、Inspector 的选择器；因类名保留，其既有断言继续有效。
- `electron-desktop-entry.mjs:22-31` 在 `.app-topbar` 继续携带 `-webkit-app-region: drag` 的前提下保持通过。
- 对比度配对在 `visual-contract.test.mjs` 中以数值断言，使未来的 token 改动无法静默跌破 AA。

命令全部在仓库根目录执行：每个提交跑 `npm ci` 与 `npm run verify`；`npm run typecheck` 已含边界检查；合并前跑 `npm run verify:electron`，因为外壳、自定义协议与窗口 chrome 都被触碰；文档提交后跑 `npm run release:check` 与 Markdown 链接检查。打包未改动，因此不需要 `verify:package:windows`。UI 行为另外通过 `npm run start:web` 与 `npm run start:desktop` 手动操作两套主题与可拖拽分栏来确认。

## 提交切分

每个提交在 `npm run verify` 下独立为绿。

1. `refactor(ui): split the stylesheet into a token-first foundation` —— 分片、完整 token 集、两套主题组、契约与同步测试。外观故意保持不变，旧规则先消费 token 别名。
2. `feat(ui): adopt Inter with a tightened type scale` —— 字体依赖与字面、字号阶梯、字重收敛、图标字重修正。
3. `feat(ui): rebuild the application chrome` —— 轨道、标签条、状态栏、品牌标记、favicon、主题开关、死 CSS 清理。
4. `feat(ui): rebuild the hosts and keychain workspaces` —— 表格、共用 Inspector、横幅。
5. `feat(ui): add the resizable SFTP split, four states, toasts and failure diagnostics`。
6. `docs(ui): document the design system and record the change`。

## 文档

新增 `docs/design-system.md` 及完整配对的 `docs/design-system_zh.md`，承载 token 表、主题规则与四条硬约束；这是本次工作唯一长期的产物。更新 `docs/architecture.md` 的 UI 节及其中文配对，把样式表布局与字体命令补进 `docs/DEVELOPMENT.md`，并在 `CHANGELOG.md` 的 `Added` 与 `Changed` 下记录。随后运行 `node scripts/convert-changelog.js` 与 `node scripts/convert-changelog.js --sync-version`，并提交生成的 `packages/ui/src/lib/changelog.ts` 和 `packages/ui/src/lib/version.ts`。

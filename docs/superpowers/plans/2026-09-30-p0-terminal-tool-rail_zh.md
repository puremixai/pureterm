# P0 终端右侧工具栏实施计划

[English version](2026-09-30-p0-terminal-tool-rail.md)

> **给执行 agent：** 必须使用 `superpowers:executing-plans` 按任务执行本计划。执行用户要求委派时，可选择 `superpowers:subagent-driven-development`。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 保留左侧全局导航和顶部会话标签，在终端工作区内部增加常驻的右侧图标工具栏，并让现有文件、监控工具共用一个可收起的面板。

**架构：** 增加一个仅面向浏览器的 Cordis 服务 `ClientSessionTools`，统一管理工具选择、图标按钮、共享面板槽位和分隔条。SFTP、监控仍是独立功能服务，通过注册接入工具栏，各自管理业务数据和请求。工具栏挂载在 `#session-workspace` 内，Desktop 与本地 Web 复用同一实现。

**技术栈：** TypeScript、Cordis、DOM、CSS Grid、现有 Tabler 图标字体、xterm.js、现有国际化目录，以及隔离的 Electron／浏览器测试夹具。

**规格：** 本文内嵌的 [P0 产品约定](#p0-product-contract) 即需求规格，包含用户已确认的布局。执行 agent 无需读取聊天记录或取得截图附件即可实施。

**优先级：** 本功能按 P0 执行：所有强制验收条件通过后，才能报告功能完成。

**状态：** 可开始实施；本文描述的是待开发功能。

**基线：** 2026-09-30 检查了 `main`，提交 `2863e4d0cd841122f8db82107949e702160eec25`，版本 `0.1.0-alpha.2`。实施前重新检查工作区；此提交仅用于标识检查基线，不是重置工作区的指令。

## 全局约束

- Node.js >=24.0.0；在仓库根目录执行 npm 命令，使用唯一的根锁文件。
- Windows 使用 PowerShell；文本使用 UTF-8。
- 实施前阅读 [AGENTS.md](../../../AGENTS.md)、[架构](../../architecture.md)、[布局决策](../../../LAYOUT-PROPOSAL.md)和[设计系统](../../design-system.md)。
- `@pureterm/ui` 仅面向浏览器，不能导入 Node、Electron 或 Host。
- 保持静态 Cordis Client 装配；本任务不增加运行时包或外部 UI 依赖。
- 所有用户文案放在 `@pureterm/i18n`；同时维护中英文目录和完整的成对 Markdown 文档。
- 共享样式颜色使用现有 token；颜色字面量只能出现在 `styles/tokens.css`。复用现有 Tabler 图标、主题和焦点 token。
- 保持现有 SSH/SFTP、监控、认证及载体契约。本功能在共享 UI 内实现，无需迁移 Host、protocol、Electron IPC 或运行时架构。
- 测试使用仓库夹具和临时数据目录，不能连接用户远程主机或使用用户 SSH 数据。
- 截图和研究驱动不进入仓库；产品验证放在现有测试目录，不能重新引入 `tools/gui/`。
- 源码／构建／行为检查与真实样式布局检查是不同证据。依赖构建产物的测试必须先构建。
- 保留无关工作；其他 agent 改动同一批文件时，重新核对路径、脚本及假设。

## 重点评审风险

1. 文件请求或监控订阅确认在切换标签／工具后才到达，不能覆盖其他终端，也不能遗留已退役订阅——T03。
2. 收起面板或进入主机／密钥页，必须保留 SSH、xterm 实例、滚动历史、各标签的工具选择和分栏偏好——T01/T03。
3. 卸载 SFTP 后，监控、分隔条、终端输入、状态栏握手事实和就绪仍可用；卸载监控后，文件功能仍可用——T03。
4. 面板展开时跨越 820px，分栏方向应正确切换，工具栏保持位置，键盘仍可操作，旧的内联网格轴设置不能残留——T02/T04。
5. 连接失败界面不能覆盖工具栏；面板隐藏／卸载时，原来聚焦其中控件的用户不能丢失可用焦点——T02/T03/T04。

---

<a id="p0-product-contract"></a>

## P0 产品约定

### 已确认的布局与范围

用户已确认：左侧保持全局菜单，点击切换对应页面；新增右侧工具栏明确属于终端工作区，不能变成全局侧边栏。

- 全局外壳：常驻左侧导航、顶部会话标签、主内容区、现有状态栏。
- 终端页面：终端内容、可选工具面板、常驻右侧工具栏。
- 主机和密钥页面：不显示终端工具栏和终端工具面板；这些页面已有编辑器保持各自行为。
- 切换到另一个终端，使用该终端自己的工具选择和分栏偏好。
- P0 只接入两个工具，固定顺序为：文件、监控。
- 命令历史、命令片段、AI、Docker、端口工具、截图中的锁标记、新监控指标、每种工具独立宽度偏好属于后续工作；不增加占位入口。
- 截图证明了工具栏常驻和面板内容切换。SVG 实现、再次点击收起、拖动调整并未由截图证明；下面将这些行为明确为 PureTerm 的开发约定。

### 必须采用的结构

下图是 DOM 归属示意，不是可直接替换的 HTML。保留现有可访问属性、失败界面内容和功能挂载点 ID。

```text
#app
  top bar / #workspace-tabs
  .app-body
    #primary-nav                         global navigation
    #main
      #hosts-panel / #keychain-panel      management pages
      #connection-workspace              existing host editor
      #session-workspace                 terminal page, hidden on management pages
        .session-toolbar                 connection state, reconnect, disconnect
        #session-body
          #session-content
            #session-primary
              #terminal                  existing terminal containers
              #connection-failure        existing failure view, confined to this column
            #session-grip                shared splitter, hidden when panel is closed
            #session-tool-panel          shared panel slot, hidden when closed
              #sftp                      existing file feature mount point
              #session-monitor           existing monitoring mount point
          #session-tools                 terminal-local rail
            #sftp-toggle                 Files icon
            #monitor-toggle              Monitor icon
  existing status bar
```

必须通过 DOM 断言证明 `#session-workspace.contains(#session-tools)`。不能把工具栏挂在 `#app`、`.app-body` 或 `#main` 的全局右边缘。工具栏是布局中的一列，不是固定在视口上的覆盖层。将失败界面移入 `#session-primary`，移除旧的 `.session-workspace > .connection-failure` 顶部偏移假设，确保失败界面不会覆盖工具栏。

### 交互与状态规则

| 编号 | 必须达到的行为 | 归属／验收 |
| --- | --- | --- |
| R01 | 工具栏和面板都是终端工作区的后代；进入管理页面后两者都不可见。 | 共享视图／T01、T03、T04 |
| R02 | 左侧继续切换管理页面；顶部标签返回保留的终端。页面切换不关闭 SSH。 | ClientTerminal／T03 |
| R03 | 在终端页面，面板收起、展开或切换时，图标栏始终保留。 | ClientSessionTools／T01、T02、T04 |
| R04 | 新标签默认收起。点击工具展开，再次点击当前工具收起，点击另一工具在同一槽位替换内容。最多显示一个面板。 | ClientSessionTools／T01、T03 |
| R05 | 按终端标签 ID 记忆工具选择；现有 `TerminalTab.split` 是唯一存储的分栏偏好。A 标签不能继承 B 的选择或比例。 | ClientSessionTools + ClientTerminal／T02、T03 |
| R06 | 切换工具／页面不重建 xterm、不重连 SSH、不丢失滚动历史；已有目录不因切换被重复请求，除非明确刷新。 | 功能服务／T03 |
| R07 | 监控只在当前已连接终端被选中、文档可见、监控面板展开且未手动暂停时采集。收起／切换要退订；迟到的退役订阅确认只停止一次。 | ClientMonitor／T03 |
| R08 | 展开、收起、调整面板后，现有终端重新适配，并向同一个会话报告有效尺寸。分栏比例不包含图标栏。 | 共享分隔条 + ClientTerminal／T02、T04 |
| R09 | 工具有本地化可访问名称、悬停提示、明确焦点和选中状态，以及正确的 `aria-expanded`／`aria-controls`。仅显示图标不等于按钮无名称。 | 共享工具栏／T01、T02、T04 |
| R10 | 卸载功能移除其注册／按钮，并清除各标签记忆的该工具选择；另一个功能和分隔条仍可用。释放／重新挂载后只有一个工具栏和一个分隔条。 | Cordis scope／T03 |
| R11 | 连接中、连接失败、已断开的终端标签仍显示工具栏，工具按钮禁用，面板收起。可记忆选择并在重连后恢复，但必须使用新业务数据。失败详情限定在终端列内。 | 共享服务 + 功能服务／T02、T03、T04 |
| R12 | Desktop 和独立本地 Web 使用相同的工具栏范围与切换行为；真实夹具 SSH/SFTP/监控通信继续工作。 | 共享 UI + 入口冒烟检查／T04、T05 |

补充状态决策：

- `ClientSessionTools` 按 `TerminalTab.id` 保存工具选择，不写入 localStorage、主机记录，也不使用全局 selected-tool 变量。
- 没有选中标签、没有已连接会话或没有可用注册时，有效 `activeTool` 为 null。进入管理页只记忆选择，不显示面板。
- 两种工具都只在 `tab.state === 'connected'` 且存在 `tab.sessionId` 时可用。已连接远端报告监控不支持时，保留现有明确的 unsupported 面板；不另造能力探测或零读数。
- 重连同一个标签可恢复工具选择和分栏比例，但必须清空上一 session ID 的 SFTP 目录／请求代际，以及监控快照／历史。
- 面板关闭按钮清除选择，并在可能时将焦点返回对应图标按钮。点击图标展开时保留图标焦点；周期性数据更新不能替换正在聚焦的控件。
- 保留现有 Ctrl/Cmd+E 文件快捷键及其对话框／会话保护条件，改为调用 `toggle('files')`。不增加全局快捷键或全局 Escape 拦截。
- 功能注销时，清除所有已记忆标签中对该工具的选择。重复注销／释放安全；重复注册同一个仍存活的工具属于开发错误。
- 切走面板可以让已接受的 SFTP 操作继续针对原会话执行。完成时只能更新所属会话状态，不能抢焦点或覆盖当前工具。

### 几何与视觉约定

- 终端工具栏复用 `--rail-w: 52px`；按钮与左侧一致，为 34px 方形，图标 18px。使用 `ti ti-folder` 和 `ti ti-activity`，不增加图标依赖。
- 会话工具条保留连接状态、失败摘要、重连和断开操作。文件／监控按钮迁入图标栏，移除顶部重复入口。
- 宽屏模式，视口 >820px：`#session-body` 为自适应内容列加 52px 图标栏。展开后的 `#session-content` 为终端、5px 分隔条（`--grip-w`）、面板三列。
- 保留现有宽屏默认 `1.35fr : 1fr`、`DEFAULT_SPLIT = 0.574`、比例边界 `0.22..0.78`、终端最小宽度 240px 和面板最小宽度 220px。比例只描述两块内容，不包含图标栏和分隔条。
- 窄屏模式，视口 <=820px：图标栏仍位于终端工作区右侧；在内容列内部上下排列终端、水平分隔条、面板。保留最小高度 120px／160px，使用同一分栏偏好。
- 跨断点时清除不再使用的内联网格轴。分隔条宽屏报告 vertical，窄屏报告 horizontal。
- 保留分隔条键盘规则：方向键每次 0.02，Shift+方向键每次 0.10，Home 清空已存偏好并恢复 CSS 默认。保留指针拖动、捕获取消和焦点环。
- 工具面板头部和可滚动主体沿用现有功能布局。滚动内容不能带动图标栏或整个终端工作区。
- 使用 `min-width: 0`、`min-height: 0` 和明确的容器约束，避免 xterm、长路径撑大外层网格。
- 选中状态使用已有强调色／填充 token，焦点使用 `--ring`；禁用按钮仍有可理解名称／提示。复用两种主题和现有密度模式，不重做全局外壳样式。
- 必须实测的视口：1280×800、1024×768、821×600、820×600、800×600、640×480。覆盖明暗主题和中英文。更小布局保留当前降级行为；本任务不建立完整移动端支持。

## 当前实现与文件映射

| 文件，路径相对仓库根目录 | 当前职责／计划改动 |
| --- | --- |
| `packages/ui/src/index.html` | 已有左侧导航和终端工作区；新增嵌套的主体／终端列／面板／图标栏，迁移工具入口和失败界面。保留冒烟测试使用的现有 ID。 |
| `packages/ui/src/services/session-tools.ts`——新增 | 统一注册、记忆选择、有效可见状态、图标按钮、分隔条、共享槽位布局和释放。 |
| `packages/ui/src/client.ts` | 在 Terminal 之后、功能服务之前装配并导出 `sessionTools` scope。 |
| `packages/ui/src/services/terminal.ts` | 保留终端归属和 `split`／`setSplit()`；全部消费者迁移后移除旧抽屉事件声明。 |
| `packages/ui/src/features/sftp.ts` | 保留各会话目录／导航代际／忙碌状态和操作；注册文件工具，读取共享可见状态，迁出分隔条，删除私有 `open` 和互斥广播。 |
| `packages/ui/src/features/monitor.ts` | 保留订阅、暂停、代际、快照和历史；注册监控工具，从共享服务计算展开状态。 |
| `packages/ui/src/monitor-panel.ts` | 绘制指标和面板操作；不再管理工具栏按钮及外层面板可见性。 |
| `packages/ui/src/services/chrome.ts` | 根据共享状态显示分隔条提示；将 SFTP 依赖替换为 `clientSessionTools`。状态栏握手事实继续独立于功能卸载。 |
| `packages/ui/src/styles/terminal.css` | 终端内部图标栏、共享槽位网格、独立滚动、分隔条、窄屏和失败界面列约束。 |
| `packages/ui/src/styles/chrome.css`、`styles/states.css` | 仅按新嵌套需要删除／调整旧失败定位。保留全局导航。 |
| `packages/i18n/src/en.ts`、`zh.ts` | 工具栏名称、不可用说明、不限定文件功能的分隔条名称。 |
| `packages/ui/tests/client-test-fixture.ts`——新增 | 抽取现有 fake API／终端夹具供复用，增加 resize 观察，避免复制 fake transport。 |
| `packages/ui/tests/client-lifecycle.browser.ts` | 使用现有夹具验证状态、异步归属、卸载／重新挂载、键盘和页面切换。 |
| `packages/ui/tests/session-tools-layout.browser.ts`、`session-tools-layout-entry.mjs`、`smoke-session-tools-layout.mjs`——新增 | 复用隔离 Electron runner，以真实构建样式／资源和真实 xterm 检查布局。 |
| `packages/ui/tests/visual-contract.test.mjs`、`theme-sync.test.mjs`、`i18n-markup.test.mjs` | 更新旧结构假设，验证新的局部挂载和本地化属性。 |
| `apps/desktop/electron/diagnostics/smoke.ts`、`apps/desktop/tests/smoke-electron.mjs` | 在现有真实 Desktop UI 检查中增加工具栏范围和工具切换。 |
| `apps/web/tests/electron-entry.mjs`、`smoke-browser.mjs` | 扩展独立 Web 检查，保留普通 Node 服务和夹具通信。 |
| `package.json` | 将新增真实样式冒烟加入根 `verify:electron`，不增加依赖或锁文件。 |
| `README.md`／`README_zh.md`、`docs/architecture.md`／`_zh.md`、`docs/design-system.md`／`_zh.md`、`CHANGELOG.md`／`CHANGELOG_zh.md` | 实施后描述实际导航、面板归属、样式及验证，并重新生成 changelog 元数据。 |

执行顺序为 T01 → T02 → T03 → T04 → T05。这些任务组成一个功能，中间任务完成不等于 P0 交付完成。核心任务共用文件，应顺序执行。本计划独立于[桌面可靠性计划](2026-09-30-desktop-reliability.md)。

## 共享接口

在 `packages/ui/src/services/session-tools.ts` 定义以下浏览器类型。`MessageKey` 来自 `@pureterm/i18n`，`TerminalTab` 来自 `./terminal.js`，`Service` 来自 Cordis。类声明仅明确公共 API，不是实现函数体。

```typescript
export type SessionToolId = 'files' | 'monitor'

export interface SessionToolDefinition {
  readonly id: SessionToolId
  readonly buttonId: 'sftp-toggle' | 'monitor-toggle'
  readonly panelId: 'sftp' | 'session-monitor'
  readonly iconClass: 'ti ti-folder' | 'ti ti-activity'
  readonly labelKey: MessageKey
  available(tab: TerminalTab | undefined): boolean
}

export interface SessionToolsChange {
  readonly tabId: string | null
  readonly sessionId: string | null
  readonly tool: SessionToolId | null
}

export declare class ClientSessionTools extends Service {
  static inject: string[]
  readonly activeTool: SessionToolId | null
  register(definition: SessionToolDefinition): () => void
  isOpen(id: SessionToolId): boolean
  toggle(id: SessionToolId): void
  close(): void
}
```

- 注入 `clientView`、`clientTerminal`；声明 `Context.clientSessionTools` 和 `client/session-tools-change(change: SessionToolsChange)`。
- `activeTool`／`isOpen()` 返回有效可见状态。`toggle()` 忽略不可用或未注册工具。`close()` 清除当前标签记忆的选择。
- `register()` 负责创建／更新／移除工具按钮，返回幂等注销函数。使用上面的文件／监控 ID 对，顺序固定为文件在前、监控在后，不依赖装配顺序。
- 更新 DOM 可见性后才发送 `client/session-tools-change`；当前标签／会话／有效工具三元组变化时必须发送。功能监听方读到的是已经更新的状态，不能产生互相关闭循环。
- 只有共享服务可以写外层槽位／面板根的 `hidden`、图标选中／ARIA 以及分栏网格。功能绘制不能覆盖这些值。
- 将 `createMonitorPanel(root, toggle, actions)` 改为 `createMonitorPanel(root, actions)`；将 `MonitorPanelActions.toggleOpen()` 改为 `close()`；从 `MonitorPanelState` 移除仅服务工具栏的 `open`／`available`。保留状态、暂停、快照、历史和消息绘制。
- 删除私有 `FileState.open` 和 `TabMonitor.open`。SFTP 可以保留公共 `open` getter，但必须委托 `isOpen('files')`，不能形成第二份状态。
- 迁移所有 `client/drawer-change`、`client/files-change` 消费者，包括 ClientChrome，再移除旧事件；不能保留第二套协调机制。

至少增加以下文案：

| Key | English | Chinese |
| --- | --- | --- |
| `session.tools.label` | Terminal tools | 终端工具 |
| `session.tools.files` | Files | 文件 |
| `session.tools.monitor` | Monitor | 监控 |
| `session.tools.unavailable` | Connect this terminal to use tools. | 连接此终端后可使用工具。 |
| `session.tools.grip.label` | Resize the terminal and tool panel | 调整终端与工具面板的大小 |
| `session.tools.grip.value` | The terminal takes {percent}% | 终端占 {percent}% |

保留现有面板标题和操作翻译。替换文件专属分隔条名称时，检查 `sftp.grip.*` 的全部引用。

## T01——共享工具控制器与功能迁移

**文件：** 新增 `services/session-tools.ts`；修改 `client.ts`、`index.html`、`services/terminal.ts`、`features/sftp.ts`、`features/monitor.ts`、`monitor-panel.ts`、`services/chrome.ts`、两个文案目录和 `tests/client-lifecycle.browser.ts`。

**接口：** 产出上面的共享 API／事件、`Client.scopes.sessionTools` 和规定的嵌套挂载点。文件／监控消费注册和 `isOpen()`；ClientTerminal 不反向依赖工具服务。

- [ ] 增加失败行为检查，名称为 `terminal rail is scoped to the terminal page`、`one panel opens and a repeated click closes it`、`unavailable tools issue no requests`。使用真实 DOM ID 和夹具 API 计数断言 R01/R03/R04/R09，保留现有工具选择器。
在已连接的生命周期夹具中，复用现有 `assert`、`input`、`click`、`tick` 辅助函数，至少包含以下核心断言：

```typescript
const rail = document.getElementById('session-tools')!
assert(input('session-workspace').contains(rail), 'rail must belong to this terminal workspace')
assert(document.querySelectorAll('.session-toolbar #sftp-toggle, .session-toolbar #monitor-toggle').length === 0, 'tools must not have duplicate toolbar entries')
click('sftp-toggle'); await tick()
assert(!input('sftp').hidden && input('session-monitor').hidden, 'Files occupies the one panel slot')
click('monitor-toggle'); await tick()
assert(input('sftp').hidden && !input('session-monitor').hidden, 'Monitor replaces Files')
click('monitor-toggle'); await tick()
assert(input('session-tool-panel').hidden && !rail.hidden, 'collapse preserves the rail')
```

- [ ] 构建共享包，执行 `node packages/ui/tests/smoke-client-lifecycle.mjs`，记录实现前新增断言的失败。
- [ ] 实现共享服务、固定按钮顺序、按标签记忆选择、有效可用性和事件。使用 `ClientScope` 管理资源，将现有分隔条归属迁入该 scope；T02 完成几何细节。
- [ ] 增加嵌套挂载点，在 Terminal 之后装配服务，注册两种功能。移除各功能私有开合／互斥逻辑及工具栏管理。面板关闭和 Ctrl/Cmd+E 使用共享 API，保留文件和订阅的业务保护。
- [ ] 将 MonitorPanel 和 ClientChrome 迁移到共享契约。状态栏不能依赖 SFTP 已安装；保持 cipher／host-key 来源。
- [ ] 重新运行行为冒烟和 `npm run typecheck`；将父元素断言改为 `#session-content`，将顶部按钮文字断言改为可访问名称／ARIA 断言。提交 `feat(ui): unify terminal tool selection and registrations`。

## T02——终端内部布局、分隔条与可访问控件

**文件：** `index.html`、`services/session-tools.ts`、`styles/terminal.css`、`styles/chrome.css`、`styles/states.css`、`services/terminal.ts` 和对应 UI 契约／生命周期测试。

**接口：** 消费 T01 挂载点和工具状态。使用现有 `ClientTerminal.setSplit(ratio: number | null)`、`fit()`、`settleLayout(): Promise<boolean>`；不能创建替代终端或第二份比例状态。

- [ ] 增加失败检查，覆盖工具栏常驻、单一分隔条、键盘比例步长／边界／Home、关闭后焦点返回，以及失败界面祖先关系。扩展现有有意义的分隔条测试，不只检查样式文本。
在工具面板展开时，扩展现有分隔条测试，加入以下明确断言：

```typescript
const grip = document.getElementById('session-grip')!
assert(grip.getAttribute('aria-orientation') === (window.innerWidth > 820 ? 'vertical' : 'horizontal'), 'separator follows the active grid axis')
grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
assert(grip.getAttribute('aria-valuenow') === '57', 'Home restores the default ratio')
grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
assert(grip.getAttribute('aria-valuenow') === '59', 'one arrow changes the ratio by two points')
```

- [ ] 实现几何约定中的两层网格：外层内容加图标栏，内层终端加分隔条加面板。收起时隐藏槽位和分隔条，并清除内联分栏模板，不能残留空列。
- [ ] 保留指针捕获／取消；测量 `#session-content`，排除图标栏和分隔条。跨 820px 更新方向和有效网格轴，仅安装监控时也要工作。
- [ ] 比例继续保存在标签，保留指定默认值／最小尺寸，使用现有布局钩子在布局稳定后适配终端。不能仅因指标读数更新而重新适配／创建终端。
- [ ] 将失败界面限定在 `#session-primary`。保持重连／复制／编辑／关闭和顶部诊断操作可用，禁用的工具栏不能被遮挡。
- [ ] 实现纯图标控件、本地化名称／提示和不可用说明、焦点环及选中状态。更新属性时不重建按钮。原生 Enter／Space 可操作，不增加应用级 Escape 拦截。
- [ ] 运行 UI 契约测试、类型检查、行为冒烟。T04 提供真实样式测量，在该验收前不能报告几何验证完成。提交 `feat(ui): dock tools inside the terminal workspace`。

## T03——会话归属、异步竞态和功能释放

**文件：** `services/session-tools.ts`、`features/sftp.ts`、`features/monitor.ts`、`services/chrome.ts`、`tests/client-lifecycle.browser.ts`；新增 `tests/client-test-fixture.ts`。

**接口：** 将现有 `fixture()`、`deferred<T>()` 抽取并导出，供浏览器夹具复用。保留返回的 API、监控控制、stats、terminals 和 listeners；增加 `stats.resizes: Array<{ sessionId: string; cols: number; rows: number }>`，由 `api.resize` 记录供 T04 使用。

- [ ] 增加 `navigation retains terminal identity and tool choice`、`tools and split preferences belong to each tab` 检查。打开 A/B，A 使用文件，B 使用监控，访问主机／密钥页后返回；断言 session ID、终端对象／滚动历史、比例和 SSH open／close 计数保持正确。
对于已连接的夹具 `f` 和挂载的 `client`，页面切换检查必须包含：

```typescript
const tab = client.context.clientTerminal.active!
const before = { sessionId: tab.sessionId, terminal: tab.terminal, opens: f.stats.opens, closes: f.stats.closes }
click('nav-keychain'); await tick()
client.context.clientTerminal.select(tab.id); await tick()
assert(tab.sessionId === before.sessionId && tab.terminal === before.terminal, 'navigation preserves SSH and xterm identity')
assert(f.stats.opens === before.opens && f.stats.closes === before.closes, 'navigation does not open or close SSH')
```

- [ ] 增加 `background file replies cannot overwrite the active tool`：挂起 A 的目录请求，切到 B／监控，再完成 A；B 保持可见，返回 A 使用 A 的结果，不额外隐式 list。
- [ ] 扩展监控检查，覆盖文件／监控快速切换、手动暂停、隐藏文档、迟到 start 确认、迟到 update 和重连。每次退役只停止一次；重连开启新代际，不继承旧读数。
- [ ] 增加 `tools collapse while disconnected and restore with fresh data`。连接中／失败／断开时禁用按钮，按标签保留选择，重连只恢复新会话业务状态。
- [ ] 增加 `monitor survives SFTP unload` 及反向检查：卸载当前功能，按钮／选择消失，另一个工具和分隔条仍可用，终端输入、状态栏事实和就绪正常。释放共享服务后没有遗留监听、分隔条或注册；重新挂载后只有一个工具栏／分隔条。
- [ ] 只修复这些检查暴露的归属／生命周期缺口。移除旧布局代码和抽屉事件，不能削弱迟到回复或订阅代际保护。
- [ ] 执行行为冒烟和类型检查，报告断言及实际计数。提交 `test(ui): cover terminal tool ownership and disposal`。

## T04——真实样式布局与两个入口验收

**文件：** 新增 `tests/session-tools-layout.browser.ts`、`session-tools-layout-entry.mjs`、`smoke-session-tools-layout.mjs`；修改根 `package.json`、现有 Desktop 诊断／冒烟文件和 Web `electron-entry.mjs`／`smoke-browser.mjs`。

**接口：** 浏览器模块暴露 `window.runSessionToolsLayoutChecks(options: { theme: 'dark' | 'light'; locale: 'en' | 'zh' }): Promise<string[]>`。隔离 Electron 入口设置各内容视口并执行该函数；runner 要求 `[SESSION-TOOLS-LAYOUT]` 标记和明确的成功／退出结果。

- [ ] 使用现有 Electron runner 的隔离、超时和进程清理能力增加布局夹具。将新构建的 `packages/ui/dist/` 资源复制到临时目录，只将应用脚本替换为夹具脚本，保留真实 CSS／字体。使用共享 fake SSH API，但使用默认真实 xterm 工厂。
- [ ] 等待样式／字体就绪和布局稳定。对指定视口、两种主题和语言测量矩形及溢出；断言工具栏宽度 52px、误差不超过 1 CSS 像素，按钮尺寸、祖先关系，以及收起／文件／监控三种状态下图标栏位置不变。
在样式／字体就绪并展开工具面板后，真实样式夹具至少包含：

```typescript
await client.context.clientTerminal.settleLayout()
const rail = document.getElementById('session-tools')!
const box = rail.getBoundingClientRect()
assert(input('session-workspace').contains(rail), 'styled rail remains terminal-local')
assert(Math.abs(box.width - 52) <= 1, 'real CSS produces the 52px rail')
assert(document.documentElement.scrollWidth <= window.innerWidth + 1, 'required viewport has no outer horizontal overflow')
```

- [ ] 验证宽窄网格轴、面板主体独立滚动、隐藏轨道、失败界面范围及可见键盘焦点。宽屏展开缩小终端宽度，收起恢复；窄屏面板改变终端高度，图标栏仍在右侧。
- [ ] 断言真实终端 cols／rows 为正数，展开／收起／调整后更新同一会话尺寸；布局稳定后比较几何，不硬编码依赖机器字体的格数。记录 resize API，确认没有重连／重建终端。
- [ ] 扩展现有 Desktop 和 Web 真实 SSH 冒烟流程，验证工具栏祖先、没有重复顶部入口、文件／监控切换及管理页不显示。保留夹具通信、标记校验和现有数据／认证检查。
- [ ] 将 `node packages/ui/tests/smoke-session-tools-layout.mjs` 加入根 `verify:electron`。单独运行前执行 `npm run build:shared`；总入口已有先构建步骤。保留旧行为夹具不加载样式的方式，并准确说明其证据范围。
- [ ] 运行布局夹具和两个入口检查，修复失败并记录实测结果。提交 `test(ui): verify styled terminal tools in desktop and web`。

## T05——文档、最终验证与交接

**文件：** 两份 README、架构／设计系统文档对、CHANGELOG 对、生成的 `packages/ui/src/lib/changelog.ts` 和实施分支的结果报告。

**接口：** 消费完成的 T01–T04 和 R01–R12。仅执行本功能计划不要求升版本；另有发版要求时遵循仓库发布规范。

- [ ] 代码实现约定后再更新当前文档。说明左侧全局导航与终端内部工具的区别、单一面板归属、状态生命周期、窄屏布局和新增验证入口。保持中英文文档完整对应。
- [ ] 在 `[Unreleased]` 记录用户可见变更，执行两个 changelog 生成命令，保持生成元数据同步。
- [ ] 顺序执行下面的最终命令。代码合并前必须运行 `npm run verify`。本任务要求 `verify:electron` 提供真实样式、两个入口和 Client 生命周期证据，即使未计划修改 Electron 运行时。
- [ ] 检查链接、`git diff --check`、测试标记／退出码和最终差异中的无关改动。已识别环境限制或退出码 2 不算通过，必须明确报告受影响的验收项。
- [ ] 填写完成清单，向下一位评审者交付分支／提交、变更文件、实际测试结果、布局测量证据和剩余限制。提交 `docs(ui): document terminal-local tool navigation`。

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
npm run verify
npm run verify:electron
git diff --check
```

开发迭代时，在构建共享产物后使用以下定向检查；没有新失败或改动时，不反复运行完整套件：

```powershell
npm run build:shared
npm run typecheck
node --test packages/ui/tests/visual-contract.test.mjs packages/ui/tests/theme-sync.test.mjs packages/ui/tests/stylesheet-contract.test.mjs packages/ui/tests/i18n-markup.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
node packages/ui/tests/smoke-session-tools-layout.mjs
```

## 完成清单

- [ ] R01/R02：主机和密钥页不显示终端工具；左侧菜单／顶部标签保持各自职责，页面切换不关闭 SSH。
- [ ] R03/R04：收起、文件、监控三种状态下图标栏常驻；点击展开／切换，再次点击当前工具收起。
- [ ] R05/R06：各标签恢复自己的工具／比例；切换工具和页面保留终端对象、滚动历史、session ID 和文件请求归属。
- [ ] R07：隐藏／非当前／暂停／关闭的监控不继续采集，迟到事件不能恢复退役代际。
- [ ] R08：使用真实 CSS／xterm 验证宽窄布局和键盘／指针调整；规定视口内没有空槽、遮挡或外层溢出。
- [ ] R09：图标按钮有本地化名称／提示、选中和焦点状态、原生键盘激活及正确 ARIA。
- [ ] R10：任一功能可独立卸载；共享服务／根释放及重新挂载清理资源，不产生重复节点。
- [ ] R11：连接中／失败／断开时工具禁用；失败界面限定在终端列，重连使用新数据。
- [ ] R12：真实 Desktop 和本地 Web 冒烟通过，包含夹具 SSH、SFTP、监控和范围断言。
- [ ] 所有必需命令通过，或明确报告限制；当前文档／文案目录／生成元数据已同步。

## 可直接转发的执行提示词

> 按本文及内嵌产品约定实现 P0 终端右侧工具栏。先阅读仓库指令和当前源码，再顺序执行 T01–T05。保留左侧全局页面导航和顶部会话标签。文件／监控图标及共享面板必须严格放在终端工作区内部，管理页面不能显示。统一工具选择、图标栏、面板和分隔条归属，不改变 SSH／Host／载体架构。保留各标签状态、请求归属、监控订阅退役及功能释放。完成真实样式／xterm 和 Desktop／Web 验收，更新成对文档，报告分支／提交、实际执行命令、测量结果和剩余限制。本文所有强制验收条件满足后才能报告完成。

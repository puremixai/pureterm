# 会话主机监控实现计划

> **供代理式工作者使用：**必需技能：按任务逐项执行本计划时，使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。步骤使用复选框（`- [ ]`）语法进行跟踪。

[English version](2026-09-26-session-monitoring.md)

**目标：**在选定的连接页面显示 Linux 主机实时资源指标，并由可独立释放的 Host/Client 监控插件提供功能。

**架构：**HostMonitor 使用现有的已认证 SSH 连接，并通过公开 Host facade、dispatcher 和 WebSocket 发布类型化更新。ClientMonitor 负责面板和可见性/订阅生命周期。终端、SFTP 和应用就绪流程都不依赖监控。

**技术栈：**现有 TypeScript、Cordis、ssh2、浏览器 DOM/CSS token、Node 测试运行器和 Electron 生命周期 fixture。不增加运行时依赖。

**规格：**[会话主机监控设计](../specs/2026-09-26-session-monitoring-design_zh.md)。请完整阅读；其中的契约、数值语义和默认值是本计划的规范依据。

**状态：**尚未执行的交接文档，2026-09-26。本文档记录拟议工作，不代表现有行为或功能测试已通过。仓库快照：`feat/ui-redesign` 分支上的 `87ae9e2`。用户要求本任务为其他代理编写文档；本任务不实现或发布此功能。

## 全局约束

- Node.js 24 或更新版本；Windows 上使用 PowerShell；使用 UTF-8；以下命令均从仓库根目录运行。
- MVP 远程目标为 Linux；仅采集 CPU、内存、1/5/15 分钟负载和根文件系统。这些是文档记录的规划默认值，之后可能根据用户修正而变更。
- 刷新：立即采集，此后在每次探测完成 5,000 ms 后采集。Exec 超时：3,000 ms，包含 channel 获取时间。stdout/stderr 合计上限：65,536 字节。活动数据过期阈值：15,000 ms。
- 只有在文档可见、面板展开且未手动暂停时，当前选中的已连接标签页才允许采集。每个客户端最多一个活动订阅；每个会话不得有重叠的本地探测。
- 静态 Cordis 组合；使用现有 SSH 连接；不增加远程代理、sudo、任意命令、新 HTTP 端点、Electron 业务 IPC、历史存储或 npm 插件加载器。
- 遵循 AGENTS.md 的依赖边界和成对的中英文文档要求。所有任务中的接口都必须与本设计中的精确接口保持一致。
- 执行前检查当前分支/工作树和 AGENTS.md。保留无关工作，包括检查基线中存在的四个 `design-qa-*.png` 文件。遵守仓库分支策略；本计划依赖已检查的 UI 变更。如果从 `main` 开始，先确认这些前置变更已合入。不要为了伪造基线而悄悄合并/挑选 UI 分支上的 71 个提交。

## 评审重点

- 超时/释放之后才到达的 exec channel 回调必须关闭该 channel，且不得关闭终端连接（任务 2）。
- 缺少 `/proc` 字段、计数器减小或 `df` 分节不可用时，必须如实产生不可用/部分可用状态，绝不能给出看似合理的零值（任务 3）。
- 外部客户端 ID/会话或过期 stop 请求不得替换/取消当前有效订阅（任务 4）。
- 从标签页 A 切换到 B 后，A 发来的更新或 start 回复不得重绘 B，也不得重新启动 A 的采集器（任务 5）。
- 移除监控提供方/插件或遇到不支持的目标时，必须保留终端输入、SFTP 和应用就绪能力（任务 4-6）。

---

## 文件映射与执行顺序

| 任务 | 新建 | 修改 |
| --- | --- | --- |
| 1：协议/Client transport | `packages/protocol/tests/monitor.test.mjs` | `packages/protocol/src/protocol.ts`、`packages/ui/src/transport.ts`、`packages/ui/tests/transport-lifecycle.test.mjs`、`packages/ui/tests/client-lifecycle.browser.ts`、根目录 `package.json`、审计发现的其他类型化 SshApi fixture |
| 2：有界 SSH exec | `packages/host/tests/ssh-exec.test.mjs` | `packages/host/src/services/ssh.ts`、`apps/desktop/tests/fake-ssh-server.mjs` |
| 3：Linux 采集器 | `packages/host/src/monitoring/linux.ts`、`packages/host/tests/monitor-linux.test.mjs` | 任务 4 前不增加生产环境使用方 |
| 4：Host 插件 + dispatcher | `packages/host/src/plugins/host-monitor.ts`、`packages/host/tests/host-monitor.test.mjs`、`apps/web/tests/monitoring.test.mjs` | `packages/host/src/host.ts`、`packages/host/src/plugins/terminal-bridge.ts`、`packages/transport/src/dispatch.ts` |
| 5：Client 插件 + 面板 | `packages/ui/src/features/monitor.ts`、`packages/ui/src/monitor-panel.ts` | `packages/ui/src/client.ts`、`packages/ui/src/index.html`、`packages/ui/src/styles/terminal.css`、`packages/ui/tests/client-lifecycle.browser.ts` |
| 6：完成验收 | 无必需的新运行时文件 | 现有 Desktop/Web 集成 fixture；`README.md`、`apps/desktop/README.md`、`apps/web/README.md`、`docs/architecture.md`、`docs/design-system.md`、`docs/DEVELOPMENT.md`、`CHANGELOG.md` 及所有配对的 `_zh.md` 文件；生成的 `packages/ui/src/lib/changelog.ts` |

任务 2 和 3 可在任务 1 固定契约后并行执行。任务 4 依赖任务 1-3。任务 5 依赖任务 1，可在任务 4 运行期间准备 fixture，但集成要等任务 4 完成。任务 6 在其余任务之后执行。每项任务中，指定的共享文件同时只由一个负责人编辑。不得将 SSH fixture 或 UI 生命周期套件的写入权限交给多个互相冲突的并行代理。

任务 1 仅负责 `client-lifecycle.browser.ts` 中最初的 SshApi 兼容性修改；该任务完成并通过评审后，文件责任转交任务 5。任务 5 在交接前不得开始编辑该文件。任务 2 同样应先将 SSH fixture 交给任务 4，再由任务 4 扩展集成测试。

每项任务都先编写行为测试、运行测试观察预期失败，再实现、重跑针对性检查并检查 diff。新 API 尚缺失而导致的编译失败，只能作为初始红灯；最终必须完成行为断言。运行导入 `dist/` 的测试前先重新构建。仅当 `git diff --check` 和任务检查通过后，才提交该任务完成的文件；不要用 `git add .` 暂存。本计划不要求 push、merge、release 或版本号升级。

## 任务 1：定义线路契约和浏览器 transport

**接口：**严格按照设计第 4 节，提供所有 `Monitor*` 类型、`parseMonitorUpdate(value: unknown): MonitorUpdate`、`METHODS.monitorStart`、`METHODS.monitorStop`、`EVENTS.monitorUpdate` 和 `SshApi.monitor`。Host 实现在任务 4 中交付；不要添加占位 Host 行为。

- [ ] 编辑前运行 `rg -n 'SshApi|RuntimeCapabilities|terminal:opened|terminal:closed|createDispatcher' packages apps` 审计，并记录所有受影响的 fixture。
- [ ] 为协议验证器编写测试，覆盖完整样本、CPU 预热部分样本、不支持/null 样本、NaN/Infinity、超出 0..100 的百分比、不安全的字节数、错误的身份/序号/时间、缺失嵌套字段，以及无效状态/问题组合。必须包含以下示例断言：

  ```javascript
  assert.equal(parseMonitorUpdate(validUpdate).snapshot.cpuPercent, 25)
  assert.throws(() => parseMonitorUpdate({ ...validUpdate, sequence: 0 }))
  assert.throws(() => parseMonitorUpdate({ ...validUpdate, snapshot: { ...validUpdate.snapshot, cpuPercent: 101 } }))
  ```

- [ ] 添加 transport 测试，断言方法名/参数精确无误、取消订阅行为正确、在 start 回复前已收到的更新可处理、无效负载会被忽略且不影响终端事件，并且 transport 释放时会清空订阅者集合。
- [ ] 将 `packages/protocol/tests/*.test.mjs` 加入现有根目录 `test:unit` 脚本。运行针对性测试并记录预期的契约缺失失败。
- [ ] 实现协议新增内容以及浏览器封装/监听路由。监控事件应与 `currentSessions` 跟踪和终端负载解码相互独立。监听器异常不得改变线路连接生命周期。
- [ ] 使用确定性的监控方法/监听器更新所有类型化 SshApi fixture 对象；保留原有测试语义。不要给全局运行时能力添加远程操作系统声明。
- [ ] 依次运行 `npm run build:shared`、`node --test packages/protocol/tests/monitor.test.mjs packages/ui/tests/transport-lifecycle.test.mjs`，然后运行 `npm run typecheck`。预期退出码为 0，所有新增/既有 transport 断言均通过。检查并提交为 `feat(protocol): define session monitoring contracts`。

## 任务 2：使现有 SSH exec 有界且可取消

**接口：**扩展 `SshService.exec(sessionId: string, command: string, options: { maxBytes?: number; timeout?: number; signal?: AbortSignal }): Promise<ExecResult>`，保留现有可选默认值。`ExecResult` 保持现有形状；超出配置上限时应拒绝，而不是返回看似可用但被截断的监控样本。

- [ ] 扩展现有 loopback SSH fixture，加入仅供测试的 `onExec` 回调，以及 exec 命令/open/close/最大并发计数器。保留 shell/SFTP 默认行为。提供确定性的正常、延迟打开、挂起、仅 stderr、多字节、拒绝命令、缺少退出状态和断开连接场景；不得连接外部主机。
- [ ] 编写 `ssh-exec.test.mjs`：打开前中止时不得创建 exec 请求；打开 channel 期间中止时应及时拒绝并关闭迟到的 channel；超时包含 channel 获取过程；65,537 个合计字节超出 65,536 上限；多字节分块可正确解码；释放时拒绝待处理的 exec。与失败的探测同时打开一个 shell，并断言它仍能回显输入。
- [ ] 先运行 `npm run build:shared`，再运行 `node --test packages/host/tests/ssh-exec.test.mjs`；确认失败能指出缺少取消/截止时间/输出计数能力。
- [ ] 实现一个幂等的结束/清理路径，涵盖打开、数据/错误/关闭、中止、超时以及 SSH session/插件释放。在 SshService 内按需跟踪待处理操作，不依赖 renderer 或 monitor。限制 stdout 加 stderr 的保留字节数；失败时只关闭该操作的 channel。
- [ ] 重跑相同的构建/测试组合。断言定时器/监听器/操作被精确清理且 shell 仍可用，而不只是断言 Promise 被拒绝。运行现有的 `packages/host/tests/host-policy.test.mjs` 作为回归覆盖。检查并提交为 `feat(host): support bounded cancellable SSH exec`。

## 任务 3：实现纯 Linux 采集器

**接口：**从 `monitoring/linux.ts` 导出 `LINUX_MONITOR_COMMAND: string`、`CpuCounters`、`LinuxProbe`、`parseLinuxProbe(stdout: string): LinuxProbe` 和 `toMonitorSnapshot(probe: LinuxProbe, previousCpu: CpuCounters | null, collectedAt: number): MonitorSnapshot`。使用设计第 6 节中的精确结构/计算。不要通过新的应用级 Host 包子路径导出这些内容。

- [ ] 编写解析 fixture，覆盖精确分节帧、GNU/BusyBox 风格根目录 `df` 空白、缺失字段/失败分节、非 Linux 检测、意外 shell 前缀、重复/截断帧、过大整数以及本地化/非数字数据。加入 CPU guest 列，以证明 guest 不计入总数。
- [ ] 将数值示例固定为断言：前一个 CPU `[100n,0n,100n,800n,0n,0n,0n,0n]`，当前 CPU `[150n,0n,150n,900n,0n,0n,0n,0n]`，结果为 50%；首次样本为 null；总内存 1,000 kB、可用内存 400 kB，得到已用 614,400 字节和 60%；负载 `[0.5,1,2]` 保留三个原始值；磁盘已用 40 块 + 可用 50 块 + 总量 100 块，结果为 `40 / 90 * 100`，而不是 40%。
- [ ] 运行 `npm run build:shared` 和 `node --test packages/host/tests/monitor-linux.test.mjs`，以确认采集器缺失时的失败。
- [ ] 实现固定命令帧和纯解析/计算。缺少 MemAvailable 时标记为不可用；计数器减小时重置基线；格式错误的分节不得默默变成零。BigInt 只在内部使用；转换成协议数值前检查是否为安全整数。
- [ ] 运行针对性的构建/测试组合。检查 fixture 是否彼此独立：期望值必须是字面计算结果，不能由被测解析器生成。提交为 `feat(host): collect bounded Linux resource snapshots`。

## 任务 4：添加 HostMonitor、归属验证和 dispatcher 路由

**接口：**`HostMonitor extends Service`，使用 `hostMonitor`，并注入 `ssh`、`terminal`、`renderer`。公开方法：`start(request: MonitorStartRequest, clientId: string): Promise<MonitorStartResult>`、`stop(subscriptionId: string, clientId: string): Promise<MonitorStopResult>`、`releaseClient(clientId: string): void`、`shutdown(): void`。添加 `TerminalBridge.ownsSession(sessionId: string, clientId: string): boolean`。公开 Host facade 按设计第 4 节添加 `startMonitor`/`stopMonitor`。

- [ ] 使用可控的 Cordis 提供方服务和可控时钟编写 Host 测试，覆盖立即采样、以探测完成时间为基准延迟 5,000 ms、无并发探测、每客户端一个活动订阅、幂等 start/stop、严格归属验证以及事件序号/身份。
- [ ] 添加竞态场景：无效 start 保留有效订阅；旧 stop 不能停止替代订阅；探测待处理时 stop 会中止探测并抑制完成结果；断开连接、renderer 发送失败、依赖卸载和 shutdown 会清理所有资源。清理测试应提供可观测的时钟/channel 计数。
- [ ] 使用真实共享 Web Host 和 SSH fixture 添加 `apps/web/tests/monitoring.test.mjs`：两个 WebSocket 客户端、仅归属方收到更新、拒绝外部 start、外部 stop 不产生影响、拒绝格式错误/意外的请求字段，以及监控超时后 shell 输入/输出和 SFTP 仍能使用。测试在 SSH 退出状态缺省但帧完整有效时的行为。
- [ ] 运行 `npm run build` 和新增的 Host/Web 测试文件，观察预期的 API 缺失失败。
- [ ] 实现归属查询、HostMonitor、注册/委托以及 dispatcher 验证。在等待任何探测前先注册/替换记录。按会话串行处理退役/start，确保替代订阅不会与尚未取消的本地操作重叠。每次 await 后执行 generation 检查。不要把采集规则放入 `host.ts` 或任何 carrier。
- [ ] 在 Host 生命周期路径中调用 monitor 的 `releaseClient`/`shutdown`；缺少 monitor 服务时返回受控的不支持响应，且绝不阻止终端/Host 释放。使用 Cordis 作用域清理定时器/监听器，并复用同一个幂等 shutdown 方法。
- [ ] 依次运行 `npm run build`、`node --test packages/host/tests/host-monitor.test.mjs apps/web/tests/monitoring.test.mjs`，然后运行 `npm run check:boundaries`。预期退出码为 0，包括双客户端隔离和终端/SFTP 继续可用。检查并提交为 `feat(host): expose session monitoring as a Cordis plugin`。

## 任务 5：添加独立的 ClientMonitor 面板

**接口：**`ClientMonitor extends Service` 注册为 `clientMonitor`，只注入 `clientView`、`clientTransport`、`clientTerminal`，并使用 `SshApi.monitor`。`createMonitorPanel(element: HTMLElement, actions: { toggleExpanded(): void; togglePaused(): void; retry(): void }): MonitorPanel` 位于 `monitor-panel.ts`。`MonitorPanel` 提供 `render(state: MonitorPanelState): void` 和 `dispose(): void`；在该文件中定义/导出 `MonitorPanelState`，其中的状态以及 snapshot/expanded/paused 字段遵循设计第 7 节。该视图辅助模块不包含 transport、定时器或会话策略。

```typescript
export interface MonitorPanelState {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'paused'
    | 'unsupported' | 'error' | 'disconnected' | 'stale'
  snapshot: MonitorSnapshot | null
  expanded: boolean
  paused: boolean
  message?: string
}
```

`idle` 涵盖连接中/无会话；`paused` 字段表示标签页明确的手动暂停偏好，而 status 也可能因文档可见性/折叠而显示为 paused。每个标签页默认 expanded=true、paused=false。每个快照必须作为一次完整观测，不能混合不同时间戳的字段。错误时可以保留前一快照及其原始时间戳，但必须清楚标注错误/过期状态。

现有生命周期和 Electron fixture 会隐藏窗口。测试必须在断言采样前控制文档可见性 getter 并发送 `visibilitychange`，结束后恢复 getter，并明确断言隐藏状态会停止采样。该设置只能位于测试页面初始化中，不得添加绕过可见性策略的产品开关。任务 6 的隐藏浏览器 fixture 也采用相同的受控可见性设置。

- [ ] 使用可控的监控 start、回复、更新、stop 记录和可观测订阅扩展 `client-lifecycle.browser.ts` fixture。添加行为测试，覆盖可见且已连接的选择、CPU 预热/部分可用/错误/不支持状态呈现，以及第一个监控请求仍挂起时应用已经 ready。
- [ ] 添加活动标签页 A/B 切换、A 的迟到事件/start 回复、过期 sequence、快速折叠/暂停/恢复、可见性丢失/返回、用新 session ID 断开/重连、过期时间戳、标签关闭、插件移除和重新挂载测试。每个旧订阅都会被停止，且不能重绘当前订阅。
- [ ] 添加提供方移除验收：`await client.scopes.monitor.dispose()` 后，终端仍接受输入、SFTP 仍可用、应用仍处于 ready。移除 transport 时也应通过注入机制卸载监控。终端/chrome/SFTP/readiness 的注入列表不得新增 `clientMonitor`。
- [ ] 运行 `node packages/ui/tests/smoke-client-lifecycle.mjs`，确认新行为断言在实现前失败。此运行器会将当前源码打包到临时文件；不需要旧的已构建 UI 资源。
- [ ] 实现视图辅助模块、ClientMonitor 状态机及 Client 注册。在 start 前先创建事件监听器/当前 ID；start 回复迟到时停止过期订阅；使用 ClientScope 清理资源，并在标签关闭时清空每标签页缓存。同步构造不得依赖远程指标成功返回。
- [ ] 在 toolbar 和 content 之间添加挂载点，并在 `terminal.css` 中现有的列式 flex workspace 内设置 `flex: 0 0 auto`；保留可伸缩且 `min-height: 0` 的终端/SFTP 内容。复用现有 token 和 ResizeObserver 行为。保证数值/单位易读、按钮支持键盘、更新不改变焦点，且即使不依赖颜色也能理解控件状态。
- [ ] 运行 `node packages/ui/tests/smoke-client-lifecycle.mjs`、`npm run typecheck` 以及 `node --test packages/ui/tests/stylesheet-contract.test.mjs packages/ui/tests/visual-contract.test.mjs`。仅针对预期的布局变化更新布局断言，不得借此掩盖回归。检查并提交为 `feat(ui): show session metrics with an independent monitor plugin`。

## 任务 6：验证两个入口并更新当前文档

**接口：**无新接口。使用完整契约和插件；更新权威文档，描述实际发布的行为和限制。

- [ ] 扩展实际的 Desktop 和独立 Web 浏览器集成流程（按需修改 `apps/desktop/tests/electron-desktop-entry.mjs`、其 `smoke-electron.mjs` 启动器，以及 `apps/web/tests/electron-entry.mjs`/`smoke-browser.mjs`），显示 fixture 快照并证明同一连接仍承载终端/SFTP 流量。业务监控逻辑不得经过私有 Electron IPC。
- [ ] 使用确定性 fixture 指标检查宽/窄屏、两种主题/密度及 SFTP 打开/关闭时的页面。测量面板/终端几何尺寸和溢出；用键盘操作暂停/折叠/重试。需要交互式浏览器检查时，使用仓库批准的浏览器工作流。不要连接用户的真实主机来替代 fixture。
- [ ] 更新受影响的 README/应用 README、架构、开发/测试和设计系统文档，以及每份中文配对文档。说明 Linux/权限/工具假设、远程环境公开的数值、CPU 预热、仅根文件系统、可见性暂停，以及不支持/错误行为。只有记录了证据，才能将本计划的任务标记完成。
- [ ] 在两份 changelog 的 `[Unreleased]` 下添加功能记录；说明增量协议 API 和 exec 有界行为的变更。运行 `node scripts/convert-changelog.js` 和 `node scripts/convert-changelog.js --sync-version`；包含生成的元数据变更。除非另有发布指示，否则保持 `VERSION.txt` 和 workspace 版本不变。
- [ ] 运行 `npm run verify`，然后运行 `npm run verify:electron`。两者都必须取得真实通过结果；环境限制或退出码 2 不算通过。这些检查覆盖共享契约变更和 Electron/共享 UI 生命周期。只有确实需要改动打包/staging 时才额外要求打包验收；默认不要扩大范围。
- [ ] 运行 `npm run release:check`，验证已改文档中的 Markdown 相对链接，并运行 `git diff --check`。整体检查功能 diff，确认监控依赖未渗入现有能力、没有资源泄漏，也没有编造的指标值。
- [ ] 将验收/文档变更提交为 `test: verify session monitoring across desktop and web`。向下一位代理/用户报告变更文件、已执行命令/结果、剩余限制以及实际 base/head commit。仅凭假 SSH 服务器不得声称已覆盖生产平台。

## 完成标准

设计中的每项验收标准都有测试或记录的 UI 观察作为依据；两个共享入口都使用真实协议流量；卸载插件后现有能力仍保留；所有必需命令通过；双语文档和生成的元数据一致。只有这些文档本身写完并检查后，本交接才算完成；不能把未勾选任务写成已实现。

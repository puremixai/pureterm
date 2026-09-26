# 会话主机监控实现计划

> **供代理式工作者使用：**必需技能：按任务逐项执行本计划时，使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。步骤使用复选框（`- [ ]`）语法进行跟踪。

[English version](2026-09-26-session-monitoring.md)

**目标：**在选定的连接页面显示 Linux 主机实时资源指标，并由可独立释放的 Host/Client 监控插件提供功能。

**架构：**HostMonitor 使用现有的已认证 SSH 连接，并通过公开 Host facade、dispatcher 和 WebSocket 发布类型化更新。ClientMonitor 负责面板和可见性/订阅生命周期。会话事实走另一条路径：`SshService` 记录 ssh2 握手结果，`TerminalBridge` 以 `session:facts` 发布，`ClientChrome` 渲染到状态栏 —— 这样监控插件永远不会成为「它只是观察者的那个会话」的事实所有者。终端、SFTP 和应用就绪流程都不依赖监控。

**技术栈：**现有 TypeScript、Cordis、ssh2、浏览器 DOM/CSS token、Node 测试运行器和 Electron 生命周期 fixture。不增加运行时依赖。

**规格：**[会话主机监控设计](../specs/2026-09-26-session-monitoring-design_zh.md)。请完整阅读；其中的契约、数值语义和默认值是本计划的规范依据。

**状态：**尚未执行的交接文档，2026-09-26。本文档记录拟议工作，不代表现有行为或功能测试已通过。代码快照：`feat/ui-redesign` 分支上的 `87ae9e2`；监控文档本身是在其之上的 `a305810` 落地的。用户要求本任务为其他代理编写文档；本任务不实现或发布此功能。

## 全局约束

- Node.js 24 或更新版本；Windows 上使用 PowerShell；使用 UTF-8；以下命令均从仓库根目录运行。
- MVP 远程目标为 Linux；轮询指标为 CPU、内存、1/5/15 分钟负载、根文件系统、网络吞吐量，以及远端主机自身的 uptime。会话事实 —— 协商出的成对 cipher 与服务端 host key 算法 —— **不**参与轮询，也不属于快照（任务 2）。除此之外，指标清单是文档记录的规划默认值，之后可能根据用户修正而变更。
- 这次扩展只携带屏幕会渲染的东西。原型状态栏那一格写的是 `chacha20-poly1305 · ed25519 · 128 行`，即 cipher、host key 与终端尺寸，因此密钥交换算法与远端软件版本被刻意**不**携带：没有任何界面会显示它们。软件版本号还额外需要读取 ssh2 的私有字段（`Client` 以 `this._remoteVer` 保存它，`node_modules/ssh2/lib/client.js:318`），携带它会让它唯一的测试变成对一个私有字段的测试。
- 这次扩展中有三项是用户明确决定而非规划默认值：uptime 指远端**主机**的 uptime 而不是本会话的，吞吐量对所有非 loopback 接口求和，握手事实走自己的通道而不是搭在快照上。
- 刷新：立即采集，此后在每次探测完成 5,000 ms 后采集。Exec 超时：3,000 ms，包含 channel 获取时间。stdout/stderr 合计上限：65,536 字节。活动数据过期阈值：15,000 ms。
- 只有在文档可见、面板展开且未手动暂停时，当前选中的已连接标签页才允许采集。每个客户端最多一个活动订阅；每个会话不得有重叠的本地探测。面板默认折叠，所以刚打开的会话在用户展开之前不采集任何东西；折叠会退役订阅，而不是让它在看不见的地方继续运行。会话事实不受这些规则约束：它们每次握手发出一次、每次 rekey 再发一次，没有订阅、没有定时器、也不受可见性门控。
- 静态 Cordis 组合；使用现有 SSH 连接；不增加远程代理、sudo、任意命令、新 HTTP 端点、Electron 业务 IPC、历史存储或 npm 插件加载器。
- 遵循 AGENTS.md 的依赖边界和成对的中英文文档要求。所有任务中的接口都必须与本设计中的精确接口保持一致。
- 执行前检查当前分支/工作树和 AGENTS.md。保留无关工作，包括检查基线中存在的四个 `design-qa-*.png` 文件。遵守仓库分支策略；本计划依赖已检查的 UI 变更。如果从 `main` 开始，先确认这些前置变更已合入。不要为了伪造基线而悄悄合并/挑选 UI 分支上的 71 个提交。

## 评审重点

- 超时/释放之后才到达的 exec channel 回调必须关闭该 channel，且不得关闭终端连接（任务 2）。
- 缺少 `/proc` 字段、计数器减小或 `df` 分节不可用时，必须如实产生不可用/部分可用状态，绝不能给出看似合理的零值（任务 3）。
- 外部客户端 ID/会话或过期 stop 请求不得替换/取消当前有效订阅（任务 4）。
- 从标签页 A 切换到 B 后，A 发来的更新或 start 回复不得重绘 B，也不得重新启动 A 的采集器（任务 5）。
- 移除监控提供方/插件或遇到不支持的目标时，必须保留终端输入、SFTP 和应用就绪能力（任务 4-6）。
- 会话事实必须在移除监控插件后仍然存在，不得比拥有该会话的客户端活得更久，也不得在 Host 已经丢弃的 client 上留下 `handshake` 监听器（任务 2 与任务 5）。

---

## 文件映射与执行顺序

| 任务 | 新建 | 修改 |
| --- | --- | --- |
| 1：协议/Client transport | `packages/protocol/tests/monitor.test.mjs` | `packages/protocol/src/protocol.ts`、`packages/ui/src/transport.ts`、`packages/ui/tests/transport-lifecycle.test.mjs`、`packages/ui/tests/client-lifecycle.browser.ts`、根目录 `package.json`、审计发现的其他类型化 SshApi fixture |
| 2：有界 SSH exec + 会话事实 | `packages/host/tests/ssh-exec.test.mjs`、`packages/host/tests/session-facts.test.mjs` | `packages/host/src/services/ssh.ts`、`packages/host/src/plugins/terminal-bridge.ts`、`apps/desktop/tests/fake-ssh-server.mjs` |
| 3：Linux 采集器 | `packages/host/src/monitoring/linux.ts`、`packages/host/tests/monitor-linux.test.mjs` | 任务 4 前不增加生产环境使用方 |
| 4：Host 插件 + dispatcher | `packages/host/src/plugins/host-monitor.ts`、`packages/host/tests/host-monitor.test.mjs`、`apps/web/tests/monitoring.test.mjs` | `packages/host/src/host.ts`、`packages/host/src/plugins/terminal-bridge.ts`、`packages/transport/src/dispatch.ts` |
| 5：Client 插件 + 面板 + 状态栏 | `packages/ui/src/features/monitor.ts`、`packages/ui/src/monitor-panel.ts` | `packages/ui/src/client.ts`、`packages/ui/src/index.html`、`packages/ui/src/services/chrome.ts`、`packages/ui/src/styles/terminal.css`、`packages/ui/tests/client-lifecycle.browser.ts`、`packages/ui/tests/visual-contract.test.mjs` |
| 6：完成验收 | 无必需的新运行时文件 | 现有 Desktop/Web 集成 fixture；`README.md`、`apps/desktop/README.md`、`apps/web/README.md`、`docs/architecture.md`、`docs/design-system.md`、`docs/DEVELOPMENT.md`、`CHANGELOG.md` 及所有配对的 `_zh.md` 文件；生成的 `packages/ui/src/lib/changelog.ts` |

任务 2 和 3 可在任务 1 固定契约后并行执行。任务 4 依赖任务 1-3。任务 5 依赖任务 1 和 2，可在任务 4 运行期间准备 fixture，但集成要等任务 4 完成。任务 6 在其余任务之后执行。每项任务中，指定的共享文件同时只由一个负责人编辑。不得将 SSH fixture 或 UI 生命周期套件的写入权限交给多个互相冲突的并行代理。

任务 1 仅负责 `client-lifecycle.browser.ts` 中最初的 SshApi 兼容性修改；该任务完成并通过评审后，文件责任转交任务 5。任务 5 在交接前不得开始编辑该文件。任务 2 负责 `packages/host/src/plugins/terminal-bridge.ts`，因为会话事实的发送就在那里；任务 4 只在任务 2 通过评审后接手该文件，并且只添加归属查询，不得改动事实发送逻辑。任务 2 同样应先将 SSH fixture 交给任务 4，再由任务 4 扩展集成测试。

每项任务都先编写行为测试、运行测试观察预期失败，再实现、重跑针对性检查并检查 diff。新 API 尚缺失而导致的编译失败，只能作为初始红灯；最终必须完成行为断言。运行导入 `dist/` 的测试前先重新构建。仅当 `git diff --check` 和任务检查通过后，才提交该任务完成的文件；不要用 `git add .` 暂存。本计划不要求 push、merge、release 或版本号升级。

## 任务 1：定义线路契约和浏览器 transport

**接口：**严格按照设计第 4 节，提供所有 `Monitor*` 类型、`SessionFacts`、`parseMonitorUpdate(value: unknown): MonitorUpdate`、`parseSessionFacts(value: unknown): SessionFacts`、`METHODS.monitorStart`、`METHODS.monitorStop`、`EVENTS.monitorUpdate`、`EVENTS.sessionFacts` 以及 `SshApi.monitor`（`start`、`stop`、`onUpdate`、`onSessionFacts`）。Host 实现在任务 4 中交付，会话事实的生产者在任务 2 中交付；不要在这里添加占位 Host 行为。

- [ ] 编辑前运行 `rg -n 'SshApi|RuntimeCapabilities|terminal:opened|terminal:closed|createDispatcher' packages apps` 审计，并记录所有受影响的 fixture。
- [ ] 为协议验证器编写测试，覆盖完整样本、CPU 与网络预热部分样本、不支持/null 样本、NaN/Infinity、超出 0..100 的百分比、不安全的字节数、错误的身份/序号/时间、缺失嵌套字段，以及无效状态/问题组合。钉住数量规则：`ready` 是六个可用指标加空 issues 对象，`partial` 是一到五个，零个可用指标是 `snapshot: null` 的 `error`。必须包含以下示例断言：

  ```javascript
  assert.equal(parseMonitorUpdate(validUpdate).snapshot.cpuPercent, 25)
  assert.throws(() => parseMonitorUpdate({ ...validUpdate, sequence: 0 }))
  assert.throws(() => parseMonitorUpdate({ ...validUpdate, snapshot: { ...validUpdate.snapshot, cpuPercent: 101 } }))
  assert.equal(parseMonitorUpdate(warmingUpUpdate).snapshot.issues.net, 'warming-up')
  assert.equal(parseSessionFacts(validFacts).cipher.serverToClient, 'aes128-gcm@openssh.com')
  assert.throws(() => parseSessionFacts({ ...validFacts, revision: 0 }))
  assert.throws(() => parseSessionFacts({ ...validFacts, serverHostKey: '' }))
  assert.throws(() => parseSessionFacts({ ...validFacts, serverHostKey: 'a'.repeat(129) }))
  ```

- [ ] 断言两种预热不可互换：只有 CPU 与网络可以带 `'warming-up'`，因为只有这两者是增量指标。内存、负载、磁盘或 uptime 上出现 `'warming-up'` 必须被拒绝。
- [ ] 把 `SessionFacts` 钉在状态栏会渲染的字段上。解析结果必须恰好携带 `sessionId`、`revision`、`serverHostKey` 和两个 cipher 名：传入一个额外带 `kex`、`mac` 或 `software` 的输入，并断言这些字段都不出现在结果上，因为 `parseSessionFacts` 是构建类型化对象，而不是把负载原样透传。没有格子渲染的字段，就是没有测试能钉住的字段。
- [ ] 添加 transport 测试，断言方法名/参数精确无误、取消订阅行为正确、在 start 回复前已收到的更新可处理、无效负载会被忽略且不影响终端事件、transport 释放时会清空订阅者集合，以及 `onSessionFacts` 的路由独立于 `currentSessions` 跟踪和监控订阅。
- [ ] 将 `packages/protocol/tests/*.test.mjs` 加入现有根目录 `test:unit` 脚本（它当前只 glob `apps/web`、`packages/host` 和 `packages/ui`）。运行针对性测试并记录预期的契约缺失失败。
- [ ] 实现协议新增内容以及浏览器封装/监听路由。监控事件应与 `currentSessions` 跟踪和终端负载解码相互独立。监听器异常不得改变线路连接生命周期。`session:facts` 是没有请求侧的事件：只给它一条监听路径，不要新增 `sessionFacts` 请求方法，也不要让它启动、停止或门控任何订阅。
- [ ] 使用确定性的监控方法/监听器更新所有类型化 SshApi fixture 对象；保留原有测试语义。不要给全局运行时能力添加远程操作系统声明。
- [ ] 依次运行 `npm run build:shared`、`node --test packages/protocol/tests/monitor.test.mjs packages/ui/tests/transport-lifecycle.test.mjs`，然后运行 `npm run typecheck`。预期退出码为 0，所有新增/既有 transport 断言均通过。检查并提交为 `feat(protocol): define session monitoring contracts`。

## 任务 2：使 SSH exec 有界可取消，并记录握手结果

**接口：**扩展 `SshService.exec(sessionId: string, command: string, options: { maxBytes?: number; timeout?: number; signal?: AbortSignal }): Promise<ExecResult>`，保留现有可选默认值。`ExecResult` 保留 `stdout`、`stderr`、`code` 和 `signal`，并**去掉 `truncated`**：超出配置上限时应拒绝，而不是返回看似可用但被截断的样本；而且该标志在整个仓库里只被生产、从未被读取，保留它等于保留一份没有读取方的契约。

新增 `SshService.facts(sessionId: string): SessionFacts | null`，返回某个存活会话最新的协商结果，并在同一个 `Events` 接口中、紧邻 `ssh/session-opened` 声明内部 Host 事件 `'ssh/session-facts'(facts: SessionFacts): void`。`SshSessionInfo` 和 `list()` 保持不变：事实放在内部会话记录上，而不是公开的会话列表里。`TerminalBridge` 在该事件上、以及 `terminal:opened` 时，通过 `EVENTS.sessionFacts` 把事实转发给拥有该会话的客户端，走的正是 `terminal:opened` 已经在用的 `renderer.send` 路由。

- [ ] 先给 `apps/desktop/tests/fake-ssh-server.mjs` 加上 exec 处理器，再做本任务的其它任何事。实测：该 fixture 处理 `pty`、`window-change`、`sftp` 和 `shell`，**完全没有 `exec` 处理器**，所以对它发起 exec 会以 `CHANNEL_FAILURE` 失败，任务 4 和任务 6 都无法基于它验证。这是硬前置，不是可以以后顺手补的细节。
- [ ] 扩展该 fixture，加入仅供测试的 `onExec` 回调，以及 exec 命令/open/close/最大并发计数器。保留 shell/SFTP 默认行为。提供确定性的正常、延迟打开、挂起、仅 stderr、多字节、拒绝命令、缺少退出状态和断开连接场景；不得连接外部主机。
- [ ] 编写 `ssh-exec.test.mjs`：打开前中止时不得创建 exec 请求；打开 channel 期间中止时应及时拒绝并关闭迟到的 channel；超时包含 channel 获取过程；65,537 个合计字节超出 65,536 上限并被拒绝；多字节分块可正确解码；释放时拒绝待处理的 exec。与失败的探测同时打开一个 shell，并断言它仍能回显输入。断言 `ExecResult` 不再携带 `truncated`，且超限是拒绝而不是部分成功。
- [ ] 编写 `session-facts.test.mjs`，对着真实 loopback 握手而不是桩。通过 `SshService` 连到 fixture，断言发出的事实带有非空的 `serverHostKey`，以及非空的 `cipher.clientToServer` / `cipher.serverToClient`；`sessionId` 与会话记录一致；`revision` 从 1 开始。断言算法名非空即可，不要钉住具体字符串：实测的 fixture 负载是 `{kex: 'curve25519-sha256@libssh.org', serverHostKey: 'rsa-sha2-512', cs: {cipher: 'aes128-gcm@openssh.com', …}}`，而 fixture 允许重新协商。
- [ ] **不要**声称 fixture 覆盖了 rekey。通过 loopback 服务器无法触发第二次握手，所以 rekey 路径就是初次握手已经验证过的那一个监听器和同一个处理函数，客户端侧的 revision 规则在任务 5 用合成事件证明。把这个限制写进测试文件，而不是编造一个不可能失败的 rekey 用例。
- [ ] 在同一文件里证明生命周期：`dispose(sessionId)` 会移除 `handshake` 监听器并丢弃已存的事实，因此重连不会在 Host 已经丢弃的 client 上累积监听器；`facts()` 对未知或已关闭会话返回 null；最后一个会话关闭之后到达的事实会被丢弃，而不是被缓冲。
- [ ] 先运行 `npm run build:shared`，再运行 `node --test packages/host/tests/ssh-exec.test.mjs packages/host/tests/session-facts.test.mjs`；确认失败能指出缺少取消/截止时间/输出计数能力，以及缺少事实通道。
- [ ] 实现一个幂等的结束/清理路径，涵盖打开、数据/错误/关闭、中止、超时以及 SSH session/插件释放。在 SshService 内按需跟踪待处理操作，不依赖 renderer 或 monitor。限制 stdout 加 stderr 的保留字节数；失败时只关闭该操作的 channel。
- [ ] 在 `connect()` 创建的 client 上实现握手捕获：把协商结果存到该会话记录上，并用那一个监听器在每次握手时发出 `ssh/session-facts`。`TerminalBridge` 只在 bridge 仍然存活且 `renderer.isAlive(clientId)` 成立时转发。若握手在任何客户端拥有该会话之前到达，就没有接收方，此时丢弃它，改为在 `terminal:opened` 时投递已存的事实；发送失败不退役任何东西，因为事实不是订阅。
- [ ] 重跑相同的构建/测试组合。断言定时器/监听器/操作被精确清理且 shell 仍可用，而不只是断言 Promise 被拒绝。运行现有的 `packages/host/tests/host-policy.test.mjs` 作为回归覆盖。检查并提交为 `feat(host): bound SSH exec and publish session facts`。

## 任务 3：实现纯 Linux 采集器

**接口：**从 `monitoring/linux.ts` 导出 `LINUX_MONITOR_COMMAND: string`、`CpuCounters`、`NetCounters`、`PreviousSample`、`LinuxProbe`、`parseLinuxProbe(stdout: string): LinuxProbe` 和 `toMonitorSnapshot(probe: LinuxProbe, previous: PreviousSample | null, collectedAt: number): MonitorSnapshot`。`CpuCounters` 是只读的八元 BigInt 元组；`NetCounters` 是只读的二元 BigInt 元组，依次为接收与发送字节数；`PreviousSample` 是 `{ collectedAt: number; cpu: CpuCounters; net: NetCounters }`。用一个 `previous` 参数而不是两个，因为 CPU 与网络的增量共用同一个时间戳，来自两个不同时刻的基线对会悄悄算出一个从未发生过的速率。使用设计第 6 节中的精确结构/计算。不要通过新的应用级 Host 包子路径导出这些内容。

- [ ] 编写解析 fixture，覆盖精确分节帧、GNU/BusyBox 风格根目录 `df` 空白、缺失字段/失败分节、非 Linux 检测、意外 shell 前缀、重复/截断帧、过大整数以及本地化/非数字数据。加入 CPU guest 列，以证明 guest 不计入总数；再加一个 `NET` 分节，其中 `lo` 的计数器大到「把它算进去」会明显改变速率。
- [ ] 将数值示例固定为断言。CPU：前一个 `[100n,0n,100n,800n,0n,0n,0n,0n]`，当前 `[150n,0n,150n,900n,0n,0n,0n,0n]`，结果为 50%；首次样本为 null。内存：总内存 1,000 kB、可用内存 400 kB，得到已用 614,400 字节和 60%。负载：`[0.5,1,2]` 保留三个原始值。磁盘：已用 40 块、可用 50 块、总量 100 块，结果为 `40 / 90 * 100`，而不是 40%。网络：前一个 `[4096n, 2048n]` 在 `collectedAt` 1,000,000，当前 `[12288n, 6144n]` 在 1,002,000，得到 `receivedBytesPerSecond` 4,096、`transmittedBytesPerSecond` 2,048；而首次样本、任一计数器减小、或经过时间非正，都得到 null。Uptime：`86400.5` 得到 `uptimeSeconds` 86400.5；缺失、负数或非有限值得到 null。
- [ ] 在解析器边界钉住求和规则，因为设计第 6 节把它放在 shell 脚本里：`NET` 负载已经是求和后的那一对，解析器不得再求和一次。用一个负载为单个 `rx tx` 对的帧来证明，并断言结果精确等于这两个整数。
- [ ] 断言快照字段数量规则：六个指标全部可用的帧得到空 `issues` 对象且为 `ready`；每个单独缺失的指标得到 `partial` 且恰好一个 issue，包括 `issues.net` 与 `issues.uptime`。
- [ ] 运行 `npm run build:shared` 和 `node --test packages/host/tests/monitor-linux.test.mjs`，以确认采集器缺失时的失败。
- [ ] 实现固定命令，在现有标记中加入 `NET` 与 `UPTIME` 分节，读取 `/proc/net/dev` 与 `/proc/uptime`，并只输出求和后的非 loopback `rx tx` 对。实现纯解析/计算。缺少 MemAvailable 时标记为不可用；计数器减小时重置基线；格式错误的分节不得默默变成零。BigInt 只在内部使用；转换成协议数值前检查是否为安全整数。
- [ ] 运行针对性的构建/测试组合。检查 fixture 是否彼此独立：期望值必须是字面计算结果，不能由被测解析器生成。提交为 `feat(host): collect bounded Linux resource snapshots`。

## 任务 4：添加 HostMonitor、归属验证和 dispatcher 路由

**接口：**`HostMonitor extends Service`，使用 `hostMonitor`，并注入 `ssh`、`terminal`、`renderer`。公开方法：`start(request: MonitorStartRequest, clientId: string): Promise<MonitorStartResult>`、`stop(subscriptionId: string, clientId: string): Promise<MonitorStopResult>`、`releaseClient(clientId: string): void`、`shutdown(): void`。添加 `TerminalBridge.ownsSession(sessionId: string, clientId: string): boolean`。公开 Host facade 按设计第 4 节添加 `startMonitor`/`stopMonitor`。

- [ ] 使用可控的 Cordis 提供方服务和可控时钟编写 Host 测试，覆盖立即采样、以探测完成时间为基准延迟 5,000 ms、无并发探测、每客户端一个活动订阅、幂等 start/stop、严格归属验证以及事件序号/身份。成功探测之间要保留当前有效样本；任何整次探测失败之后、被中断之后，以及每次新订阅时，都要重置两条基线：过期的 CPU 或网络基线会算出一个从未发生过的速率。
- [ ] 除了解析器之外，也要通过 Host 路径断言六指标就绪规则：第一次探测为 `partial` 且 `issues.cpu` 与 `issues.net` 置为 `'warming-up'`；第二次探测六个指标齐全时为 `ready` 且 `issues` 为空；缺一个指标时为 `partial` 且恰好一个 issue。
- [ ] 添加竞态场景：无效 start 保留有效订阅；旧 stop 不能停止替代订阅；探测待处理时 stop 会中止探测并抑制完成结果；断开连接、renderer 发送失败、依赖卸载和 shutdown 会清理所有资源。清理测试应提供可观测的时钟/channel 计数。
- [ ] 使用真实共享 Web Host 和 SSH fixture 添加 `apps/web/tests/monitoring.test.mjs`：两个 WebSocket 客户端、仅归属方收到更新、拒绝外部 start、外部 stop 不产生影响、拒绝格式错误/意外的请求字段，以及监控超时后 shell 输入/输出和 SFTP 仍能使用。测试在 SSH 退出状态缺省但帧完整有效时的行为。
- [ ] 在同一个 Web 测试里覆盖 `session:facts` 路由：归属客户端收到事实；不拥有该会话的第二个客户端既收不到更新也收不到事实；释放监控插件后事实路径仍然工作，同时终端仍接受输入。事实不是订阅，不得随监控一起被拆掉。
- [ ] 运行 `npm run build` 和新增的 Host/Web 测试文件，观察预期的 API 缺失失败。
- [ ] 实现归属查询、HostMonitor、注册/委托以及 dispatcher 验证。在等待任何探测前先注册/替换记录。按会话串行处理退役/start，确保替代订阅不会与尚未取消的本地操作重叠。每次 await 后执行 generation 检查。不要把采集规则放入 `host.ts` 或任何 carrier。
- [ ] 在 Host 生命周期路径中调用 monitor 的 `releaseClient`/`shutdown`；缺少 monitor 服务时返回受控的不支持响应，且绝不阻止终端/Host 释放。使用 Cordis 作用域清理定时器/监听器，并复用同一个幂等 shutdown 方法。
- [ ] 依次运行 `npm run build`、`node --test packages/host/tests/host-monitor.test.mjs apps/web/tests/monitoring.test.mjs`，然后运行 `npm run check:boundaries`。预期退出码为 0，包括双客户端隔离和终端/SFTP 继续可用。检查并提交为 `feat(host): expose session monitoring as a Cordis plugin`。

## 任务 5：添加 ClientMonitor 面板与状态栏会话事实

**接口：**`ClientMonitor extends Service` 注册为 `clientMonitor`，只注入 `clientView`、`clientTransport`、`clientTerminal`，并使用 `SshApi.monitor`。`ClientChrome` 保持现有注入列表不变，额外使用 `SshApi.monitor.onSessionFacts`；它不得新增 `clientMonitor`。`createMonitorPanel(element: HTMLElement, actions: { toggleExpanded(): void; togglePaused(): void; retry(): void }): MonitorPanel` 位于 `monitor-panel.ts`。`MonitorPanel` 提供 `render(state: MonitorPanelState): void` 和 `dispose(): void`；在该文件中定义/导出 `MonitorPanelState`，其中的状态以及 snapshot/expanded/paused 字段遵循设计第 7 节。该视图辅助模块不包含 transport、定时器或会话策略。

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

`idle` 涵盖连接中/无会话；`paused` 字段表示标签页明确的手动暂停偏好，而 status 也可能因文档可见性/折叠而显示为 paused。每个标签页默认 **expanded=false、paused=false**。每个快照必须作为一次完整观测，不能混合不同时间戳的字段。错误时可以保留前一快照及其原始时间戳，但必须清楚标注错误/过期状态。

默认折叠不是装饰性选择：原型在会话屏上画两条固定横带，本外壳已经画三条，展开的监控条会让它变成四条，而每一条都是从终端高度里扣出来的。折叠后的这一行仍然报告最近更新状态，并让折叠/暂停/重试保持可达，所以刚打开的会话在用户展开之前不采集任何东西；展开时也不得把焦点移出终端。

`ClientChrome` 拿到那两项会话事实，`ClientMonitor` 不拿：cipher 与 host key 算法在一条连接内是常量，所以它们属于状态栏那一格（`chacha20-poly1305 · ed25519 · 128 行`，其中第三项本外壳已经作为 `status-size` 上报），而不属于轮询行。`ClientChrome` 订阅 `SshApi.monitor.onSessionFacts`，新增那两格，渲染 `cipher.clientToServer`，只在两个方向不同时才追加 `→ cipher.serverToClient`；第三格「会话时长」保持为空 —— 快照里的 `uptimeSeconds` 是**主机**的 uptime，是另一个数字。它忽略 `revision` 不高于该 `sessionId` 已持有值的事实；对 `terminal:opened` 之前到达、且该会话尚未见过的事实先缓冲；对从未见过打开的会话则丢弃。`ClientChrome` 不得注入 `clientMonitor`，两个插件也不得互相注入。

现有生命周期和 Electron fixture 会隐藏窗口。测试必须在断言采样前控制文档可见性 getter 并发送 `visibilitychange`，结束后恢复 getter，并明确断言隐藏状态会停止采样。该设置只能位于测试页面初始化中，不得添加绕过可见性策略的产品开关。任务 6 的隐藏浏览器 fixture 也采用相同的受控可见性设置。

- [ ] 使用可控的监控 start、回复、更新、stop 记录、可观测订阅，以及一个合成的 `session:facts` 来源，扩展 `client-lifecycle.browser.ts` fixture。添加行为测试，覆盖可见且已连接的选择、CPU 与网络预热/部分可用/错误/不支持状态呈现、第一个监控请求仍挂起时应用已经 ready，以及默认折叠：刚打开的会话在面板展开前不发出任何 start，折叠时会发出 stop。
- [ ] 添加活动标签页 A/B 切换、A 的迟到事件/start 回复、过期 sequence、快速折叠/暂停/恢复、可见性丢失/返回、用新 session ID 断开/重连、过期时间戳、标签关闭、插件移除和重新挂载测试。每个旧订阅都会被停止，且不能重绘当前订阅。
- [ ] 用合成事件添加会话事实的客户端测试：带更高 `revision` 的 rekey 会替换 cipher 与 host key 两格；重复或更低的 `revision` 被忽略；客户端从未见过打开的会话的事实被丢弃；不对称 cipher 渲染为 `cs → sc`，相等的一对渲染为单个名字；快照里存在 `uptimeSeconds` 时「会话时长」那一格仍为空。在 `terminal:opened` 之前到达、而该会话随后打开的事实会被应用。
- [ ] 添加提供方移除验收：`await client.scopes.monitor.dispose()` 后，终端仍接受输入、SFTP 仍可用、应用仍处于 ready，且状态栏的 cipher 与 host key 两格仍然是满的。移除 transport 时也应通过注入机制卸载监控。终端/chrome/SFTP/readiness 的注入列表不得新增 `clientMonitor`，`ClientChrome` 也不得新增它。
- [ ] 运行 `node packages/ui/tests/smoke-client-lifecycle.mjs`，确认新行为断言在实现前失败。此运行器会将当前源码打包到临时文件；不需要旧的已构建 UI 资源。
- [ ] 实现视图辅助模块、ClientMonitor 状态机、其 Client 注册以及 `ClientChrome` 的事实监听器。在 start 前先创建事件监听器/当前 ID；start 回复迟到时停止过期订阅；使用 ClientScope 清理资源，并在标签关闭时清空每标签页缓存。同步构造不得依赖远程指标成功返回。
- [ ] 在 toolbar 和 content 之间添加挂载点，并在 `terminal.css` 中现有的列式 flex workspace 内设置 `flex: 0 0 auto`；保留可伸缩且 `min-height: 0` 的终端/SFTP 内容。复用现有 token 和 ResizeObserver 行为。保证数值/单位易读、按钮支持键盘、更新不改变焦点，且即使不依赖颜色也能理解控件状态。
- [ ] 有意更新设计第 7 节点名的两处守卫和一段注释，而不是删掉它们：放宽 `visual-contract.test.mjs` 中 `.session-toolbar` → `.session-content` 的模式，使其在 `#session-monitor` 位于两者之间时仍断言「会话栏是内容之上的一个整块」；改写 `chrome.ts` 中 `ClientChrome` 的类注释，使它不再声称 cipher 与 host key 两格缺失，同时仍然点名保持为空的会话时长与传输速率两格。`theme-sync.test.mjs` 无需改动，因为 `terminal.css` 已经在其中登记。
- [ ] 运行 `node packages/ui/tests/smoke-client-lifecycle.mjs`、`npm run typecheck` 以及 `node --test packages/ui/tests/stylesheet-contract.test.mjs packages/ui/tests/visual-contract.test.mjs`。仅针对预期的布局变化更新布局断言，不得借此掩盖回归。检查并提交为 `feat(ui): show session metrics and session facts`。

## 任务 6：验证两个入口并更新当前文档

**接口：**无新接口。使用完整契约和插件；更新权威文档，描述实际发布的行为和限制。

- [ ] 扩展实际的 Desktop 和独立 Web 浏览器集成流程（按需修改 `apps/desktop/tests/electron-desktop-entry.mjs`、其 `smoke-electron.mjs` 启动器，以及 `apps/web/tests/electron-entry.mjs`/`smoke-browser.mjs`），显示 fixture 快照与 fixture `session:facts`，并证明同一连接仍承载终端/SFTP 流量。业务监控逻辑不得经过私有 Electron IPC。
- [ ] 使用确定性 fixture 指标检查宽/窄屏、两种主题/密度及 SFTP 打开/关闭时的页面。测量面板/终端几何尺寸和溢出；用键盘操作暂停/折叠/重试。验证默认折叠会让会话屏保持此前的横带数量。需要交互式浏览器检查时，使用仓库批准的浏览器工作流。不要连接用户的真实主机来替代 fixture。
- [ ] 更新受影响的 README/应用 README、架构、开发/测试和设计系统文档，以及每份中文配对文档。说明 Linux/权限/工具假设、远程环境公开的数值、CPU 与网络预热、仅根文件系统、可见性暂停、默认折叠、状态栏现在填上了哪两格，以及不支持/错误行为。只有记录了证据，才能将本计划的任务标记完成。
- [ ] 在两份 changelog 的 `[Unreleased]` 下添加功能记录；说明增量协议 API、`session:facts` 事件，以及 exec 有界行为的变更（包括退役的 `truncated` 标志）。运行 `node scripts/convert-changelog.js` 和 `node scripts/convert-changelog.js --sync-version`；包含生成的元数据变更。除非另有发布指示，否则保持 `VERSION.txt` 和 workspace 版本不变。
- [ ] 运行 `npm run verify`，然后运行 `npm run verify:electron`。两者都必须取得真实通过结果；环境限制或退出码 2 不算通过。这些检查覆盖共享契约变更和 Electron/共享 UI 生命周期。只有确实需要改动打包/staging 时才额外要求打包验收；默认不要扩大范围。
- [ ] 把 `npm run verify:electron` 当作依赖环境的检查，并如实记录结果。在撰写本计划的机器上实测：macOS 12.7.6 无法启动 Electron 44（它要求 macOS 13 或更新版本），因此该检查在那里无法运行。这种情况下，要连同实际采集到的替代证据一起记录这个阻塞 —— 即以 headless Chrome 运行已构建的 `packages/ui/dist` 页面，只把 `app.js` 换成 fixture 驱动；`87ae9e2` 里的窗口按钮与浅色主题工作就是这样验证的 —— 并明确说明 Electron 检查没有运行。未运行的检查不算通过的检查，说出这一点就是要求本身；绝不要为没有执行过的命令写「退出码 0」。
- [ ] 运行 `npm run release:check`，验证已改文档中的 Markdown 相对链接，并运行 `git diff --check`。整体检查功能 diff，确认监控依赖未渗入现有能力、没有资源泄漏，也没有编造的指标值。
- [ ] 将验收/文档变更提交为 `test: verify session monitoring across desktop and web`。向下一位代理/用户报告变更文件、已执行命令/结果、剩余限制以及实际 base/head commit。仅凭假 SSH 服务器不得声称已覆盖生产平台。

## 完成标准

设计中的每项验收标准都有测试或记录的 UI 观察作为依据；两个共享入口都使用真实协议流量；卸载插件后现有能力仍保留，包括状态栏的会话事实；所有必需命令通过，任何被环境阻塞的检查都记为阻塞而不是通过；双语文档和生成的元数据一致。只有这些文档本身写完并检查后，本交接才算完成；不能把未勾选任务写成已实现。

# Desktop 可靠性与上游跟进实施计划

> **供执行 agent 使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤以复选框（`- [ ]`）跟踪。只能使用用户已授权的执行方式和委派方式。

**目标：** 跟进当前 deepseek-harness 架构中适合 PureTerm 的目录归属、退出保护、快捷键和 Host 故障处理机制，并按 SSH/SFTP 场景明确安全条件。

**架构：** 保留 Electron 桌面壳、独立 Electron Node 模式 Host、共享 `startWebHost()` 和静态 Cordis Client。通过 Host/Web Host 公共接口及父子进程私有 RPC 增加活动事实和请求准入控制；Electron 负责对话框、窗口决策、菜单和应用重启。

**技术栈：** Node.js >=24、TypeScript、Electron、Cordis、ssh2、xterm.js、npm workspaces、Node 测试运行器，以及现有 Electron/浏览器 smoke 测试设施。

**需求依据：** [架构对比报告及 G01–G06](../../reports/2026-09-30-desktop-architecture-comparison_zh.md)，以及本次对话要求列出的六项后续工作。本计划补充下文明确的实现决策；对比报告本身不是详细实现规格。

[English version](2026-09-30-desktop-reliability.md)

## 全局约束

- 核对基线：PureTerm `c7816bfbc3a1d1e338bb80d2608ed31152c2ca4a`，版本 `0.1.0-alpha.2`；参考副本 `639ed015397290b3745d163aafe02ffee4aa3f84`，标签 `dsh-v0.2.0-rc.2`，核对日期 2026-09-30。
- 执行前阅读当前 [AGENTS.md](../../../AGENTS.md)、[架构](../../architecture_zh.md)、[布局](../../../LAYOUT-PROPOSAL_zh.md)、[开发文档](../../DEVELOPMENT_zh.md)，以及涉及更新/重启时的[发布指南](../../desktop-release_zh.md)。工作树版本若已更新，先核对本计划与当前实现，再编辑代码。
- Windows 使用 PowerShell；新文本使用 UTF-8。npm 命令在仓库根目录执行；保留唯一的根 lockfile，完整维护英文/中文 Markdown 对。
- 保留 `ELECTRON_RUN_AS_NODE`、`pureterm-app://app/`、二进制安全的业务 WebSocket、仅所属主 frame 的 Desktop bearer 注入、loopback 监听和独立浏览器凭据。
- `@pureterm/protocol` 保持环境中立。Host 不导入 Electron/UI/i18n；UI 不导入 Host/Node/Electron；runtime 和 Host 子进程模块不导入 Electron。transport 使用 Host 公共 API，不访问 `Host.internals` 或 `WebHost.internals`。
- 保留 Desktop 加密能力及现有 Electron `userData` 路径。独立 Web 继续使用仅会话凭据和独立数据目录。这些任务不迁移用户数据，也不改变加密回退规则。
- 本计划不增加新包或运行时依赖。不包含 HTTP RPC 迁移、动态插件、Agent job、账号平台、CLI 注册、强制更新服务或遥测。
- 用户把本计划交给 agent 执行时，默认范围是 T01–T07 和 T10。T08、T09 是条件任务，用户选择前保持未勾选。编写本计划本身不等于授权实现、推送、合并或发布。
- 使用本地假 SSH 服务器、临时 profile、随机服务端口和合成凭据。导入 `dist/` 的测试先构建；禁止使用用户的 SSH 目标和凭据。

## 评审重点

1. 两个 Electron profile 或路径别名指向同一 SSH 数据目录：在任何 Host/存储访问前只允许一个 profile，拒绝另一方且不改写存储。对应测试：T01。
2. 检查与确认之间连接建立完成，或另一个浏览器开始工作：锁住新请求，排空已接受工作，再检查；取消时恢复准入。对应测试：T02–T05。
3. 关窗、菜单退出、更新和迟到的对话框答复重叠：只有一个退出决策拥有者；旧答复不能停止新 generation，也不能安装更新。对应测试：T04–T05、T07。
4. 输入法组合输入、AltGr、模态框或编辑器拥有输入：工作区快捷键不抢键；原生与 DOM 路径不能执行两次。对应测试：T06。
5. Host 在准备退出时死亡、诊断目录不可写，或需要发信号才能终止：清理有界、明确恢复仍可用；更新器不能把强制终止当成优雅完成。对应测试：T03、T05、T07。

---

## 执行顺序与交付物

| 工作包 | 任务 | 依赖 | 优先级 / 交付物 |
| --- | --- | --- | --- |
| profile 归属 | T01 | 无 | 高；每份绑定 profile 只有一个 Desktop 写入者 |
| Host 生命周期契约 | T02、T03 | T02 先于 T03 | 高；公共事实、准入租约、私有 RPC、停止结果 |
| 退出与更新保护 | T04、T05 | T01、T03；T04 先于 T05 | 高；可取消退出及更新安装交接 |
| 快捷键归属 | T06 | 无；接入当前 generation | 中；统一命令注册和 IME 保护 |
| Host 诊断及重启 | T07 | T01、T03–T05 | 中；有界报告和明确重启/退出 |
| 后台窗口驻留 | T08 | T01、T04–T07；明确选择 | 可选；保留同一文档/socket 及返回入口 |
| 登录 shell 环境 | T09 | T01、T03、T07；有明确本机工具需求 | 条件任务；有界 POSIX 环境读取 |
| 集成、文档及交接 | T10 | 所有已选择任务 | 必须；可评审交付及实际验证结果 |

推荐顺序：T01 → T02 → T03 → T04 → T05 → T06 → T07 → T10。T06 可独立实现，但不要求并行委派。一个工作包达到可评审状态后再继续；后续工作若能独立发布，可以拆为独立分支/PR。

## 文件职责

下表路径相对仓库根目录。“新增”表示拟创建文件；现有路径仍需在执行时核对。

| 文件 | 职责 / 任务 |
| --- | --- |
| 新增 `apps/desktop/electron/runtime/single-instance.ts`；同目录新增 `desktop-profile.ts` | 最小应用锁接口；数据目录/profile 的规范化绑定，T01 |
| `apps/desktop/electron/app/main.ts`、`shell.ts`、`platform.ts`、`updates.ts` | 仅 Electron 适配：归属、close/before-quit、菜单、对话框、恢复，T01/T04–T08 |
| 新增 `packages/protocol/src/lifecycle.ts`；现有 `protocol.ts` | 中立生命周期数据形状、导出及错误码，T02/T03 |
| 新增 `packages/host/src/lifecycle.ts`；现有 `host.ts` | 已接受操作跟踪、准入租约、公共生命周期接口，T02 |
| `packages/transport/src/web-host.ts`、`dispatch.ts` | 转发公共生命周期接口；保留业务分派及清理归属，T02/T03 |
| `apps/desktop/electron/host/entry.ts`、`runtime/host-process.ts`、`runtime/process-rpc.ts` | 私有生命周期调用校验；有界子进程停止结果，T03 |
| 新增 `apps/desktop/electron/runtime/shutdown.ts`；现有 `runtime/updates.ts` | 串行退出准备；已下载更新的交接，T04/T05 |
| 新增 `packages/protocol/src/shortcuts.ts`；现有 `protocol.ts` 及 Desktop preload | 共享命令/匹配器及范围受限的原生桥，T06 |
| 新增 `packages/ui/src/services/shortcuts.ts`；现有 `client.ts`、`services/terminal.ts`、`features/hosts.ts`、`features/sftp.ts`、`index.html` | 浏览器命令归属、上下文、资源清理和快捷键帮助，T06 |
| 新增 `apps/desktop/electron/app/shortcuts.ts` | 绑定当前 shell generation 的原生输入/菜单适配，T06 |
| 新增 `apps/desktop/electron/runtime/crash-report.ts`、`fatal-recovery.ts` | 允许字段内的崩溃事实、有界留存、串行明确恢复，T07 |
| `packages/i18n/src/en.ts`、`zh.ts`、`packages/ui/src/message-text.ts` | 用户文案目录及生命周期错误映射；Host 不引入翻译 |
| 新增 `apps/desktop/electron/app/background.ts`、`runtime/background-policy.ts` | 条件性的文档驻留及托盘归属，T08 |
| 新增 `apps/desktop/electron/runtime/login-shell-environment.ts` | 条件性的 POSIX 探测、解析、合并及取消，T09 |
| 各任务点名的 Node 测试及现有 Electron/浏览器测试设施 | 行为验收；不新建 GUI 驱动子系统 |
| 当前 README、架构、开发/发布指南和 CHANGELOG 文档对 | 只更新实际交付行为，T10 |

## 共享契约决策

以下是拟新增契约，不是已有 API。中立数据形状从 `@pureterm/protocol` 导出；`HostLifecycle` 通过 Host 公共入口暴露，`WebHost.lifecycle` 通过 transport 公共入口暴露。

```ts
export interface HostActivitySnapshot {
  activeSessions: number
  pendingConnections: number
  pendingFileOperations: number
  pendingMutations: number
}
export interface HostLifecycle {
  inspectActivity(): HostActivitySnapshot
  prepareShutdown(leaseId: string): HostActivitySnapshot
  drainAccepted(leaseId: string, timeoutMs: number): Promise<HostActivitySnapshot>
  cancelShutdown(leaseId: string): boolean
}
export interface RemoteHostLifecycle {
  inspectActivity(): Promise<HostActivitySnapshot>
  prepareShutdown(leaseId: string): Promise<HostActivitySnapshot>
  drainAccepted(leaseId: string, timeoutMs: number): Promise<HostActivitySnapshot>
  cancelShutdown(leaseId: string): Promise<boolean>
}
export interface HostStopResult {
  graceful: boolean
  exitCode: number | null
  signal: string | null
}
export type ShutdownIntent = 'quit' | 'update'
export type ShutdownDecision = {
  intent: ShutdownIntent
  status: 'ready' | 'cancelled' | 'failed' | 'busy'
}
```

- `activeSessions` 统计活动 terminal bridge；`pendingConnections` 统计已接受且尚未结算的 `openTerminal()`；文件操作覆盖五个公共 SFTP 方法；mutation 覆盖排队中及执行中的 host/Keychain 写入。计数不能为负，拒绝和断连后必须正确扣回。
- 事实覆盖**当前 Host 的所有客户端**，包括附加浏览器客户端。只返回计数，不返回主机名、路径、密码、token、命令或终端输出。独立 Web 是另一个 Host，不纳入这份统计。
- 当前 `SshService.exec()` 用于监控探测，不是公开的用户 exec API。持续监控探测自身不触发退出警告，也不阻止排空；不要为了本计划新增用户 exec API。
- 父进程先生成租约 ID 再请求准备。准备操作同步关闭准入；相同 ID 的重复准备幂等，不同 ID 报 `host.lifecycle-busy`；旧租约取消不能解锁新的租约。
- 锁定时，用 `host.preparing-shutdown` 拒绝 SSH open/input、新 SFTP 操作、host/key 写入及 monitor start。允许列表/能力读取、resize、close、monitor stop、客户端释放、dispose，以及已接受工作需要的私有 seal/unseal 平台回复。notice 拒绝沿用现有载体错误处理方式，不发明 notice reply。
- 排空等待的是**已接受的有限操作**，不是长期终端流。超时使用 `host.lifecycle-drain-timeout`，不自行丢弃已接受 promise，也不自行解锁；拥有者必须取消，或继续用户明确选择的普通退出。
- 检查/准备/取消 RPC 默认超时 **2,000 ms**。排空预算 **5,000 ms**，对应 RPC 超时 **6,000 ms**。停止子进程沿用 **5,000 ms** 优雅 RPC、**500 ms** 等待退出、SIGTERM 后 **1,000 ms**、SIGKILL 后 **2,000 ms**。测试注入更短预算。
- 只有收到 shutdown 确认，并且以退出码 `0`、无终止信号退出，`graceful` 才为 true。已经死亡或被杀掉的子进程不能产生新的优雅退出确认。
- 将 `host.preparing-shutdown`、`host.lifecycle-busy`、`host.lifecycle-lease-invalid`、`host.lifecycle-drain-timeout` 加入现有错误分类及双语目录。已关闭/客户端已断开等条件优先时，保留现有错误。

## T01 — 单实例与数据/profile 归属

**文件：** 在 `apps/desktop/` 的上述目录下新增 `runtime/single-instance.ts`、`runtime/desktop-profile.ts`、`tests/single-instance.test.mjs`、`tests/desktop-profile.test.mjs`。修改 `electron/app/main.ts`，扩展现有 Electron smoke 及隔离 profile fixture。

**接口：**

```ts
claimDesktopSingleInstance(application: SingleInstanceApplication,
  dataDir: string, focusOwner: (requestedDataDir: string) => void): boolean
bindDesktopProfile(dataDir: string, userDataDir: string): void
```

`SingleInstanceApplication` 是仅包含 `requestSingleInstanceLock(additionalData)`、`on('second-instance', ...)`、`quit()` 的最小结构接口，不导入 Electron。`bindDesktopProfile()` 抛出带 `profile-mismatch`、`profile-invalid` 或 `profile-io` 的 `DesktopProfileError`。

**决策：** 保留现有生产 `userData` 路径。先处理测试路径覆盖，再获取 Electron 锁；随后在**读取 launch profile、访问凭据、创建 Host 或窗口之前**，把规范化后的 SSH 目录绑定到规范化后的 `userData`。在 `<dataDir>/desktop-profile.json` 中只存 `{ "version": 1, "userData": "<canonical absolute path>" }`；使用独占 `wx`、权限 `0600` 创建，flush/close 后才继续。已有目录通过 `realpath` 规范化；Windows 比较时规范化路径大小写。

这是一份持久归属记录，**不是 PID 锁**。同一 `userData` 下的进程由 Electron 串行化；另一份 `userData` 即使在旧进程退出后也不能直接使用这份存储。首次并发创建只选择一个绑定；遇到暂未写完的记录，最多重试 **1,000 ms** 后拒绝。使用同步启动 I/O 和有界重试，保证现有 launch-profile 开关及硬件加速决策仍在 Electron ready 前完成。不覆盖、不自动删除、不自动重绑不匹配或损坏的记录。迁移 profile 必须另有明确的数据/加密迁移流程。这也能发现开发版和安装版身份不同却指向同一存储的情况。

第二次启动恢复/显示/聚焦现有窗口；仍在启动时延迟聚焦。请求另一数据目录时明确提示，不切换正在运行的 Host。隔离测试 profile 必须使用独立 SSH 数据目录。启动失败不写 hosts/secrets，也不残留实例锁。

- [ ] 编写 `single-instance.test.mjs`：`second launch never starts a Host`、`second launch focuses after pending startup`、`different requested directory does not replace the owner`。断言只有一个锁拥有者，失败方 Host 启动次数为零，restore/focus 只发生一次。
- [ ] 编写 `desktop-profile.test.mjs`：首次并发占用、同 profile 重用、不同 profile 拒绝、支持平台上的别名/大小写一致性、损坏/部分写入/不可写记录。断言仅一个不同绑定被接受，拒绝时 hosts/secrets fixture 哈希不变。
- [ ] 运行 `npm run build:desktop`，再运行 `node --test apps/desktop/tests/single-instance.test.mjs apps/desktop/tests/desktop-profile.test.mjs`；首轮必须暴露缺失行为，不能把旧产物/导入故障当成行为失败。
- [ ] 实现两个接口和启动顺序；在双语目录中提供不匹配/修复提示。不能通过改生产 `userData` 路径使测试通过。
- [ ] 重跑聚焦测试；在 `smoke-electron.mjs` 及 fixture 中加入真实双进程验收：同 profile 拒绝、不同隔离 profile 成功。验证普通启动/重启保留原有 profile 路径。
- [ ] 只评审本任务 diff 并提交，例如 `feat: enforce desktop profile ownership`。不暂存其他工作树改动。

## T02 — Host 活动事实与准入租约

**文件：** 新增 `packages/protocol/src/lifecycle.ts`、`packages/host/src/lifecycle.ts`、`packages/host/tests/host-lifecycle.test.mjs`；修改 `packages/protocol/src/protocol.ts`、`packages/host/src/host.ts`、`packages/transport/src/web-host.ts`，以及错误/文案消费方。

**接口：** 使用上述共享契约。给 `Host`、`WebHost` 增加 `readonly lifecycle: HostLifecycle`。两个入口指向同一跟踪器；Web Host 不得从 `internals` 取出它。

- [ ] 编写测试 `snapshot counts pending handshake and both client sessions`、`SFTP and queued saves drain on success or rejection`、`prepare blocks new work but permits cleanup`、`stale cancel cannot reopen admission`。沿用 `host-policy.test.mjs`、`async-credentials.test.mjs` fixture 模式，用 gate 控制实际异步 SSH/SFTP/凭据回调。
- [ ] 用以下断言固定租约行为；fixture 拥有假服务器，清理时释放所有 gate。

```js
host.lifecycle.prepareShutdown('lease-a')
assert.equal(host.lifecycle.cancelShutdown('stale-lease'), false)
await assert.rejects(host.openTerminal(request), error => error.code === 'host.preparing-shutdown')
assert.equal(host.lifecycle.cancelShutdown('lease-a'), true)
assert.equal(host.lifecycle.inspectActivity().pendingMutations, 0)
```

- [ ] 运行 `npm run build`，再运行 `node --test packages/host/tests/host-lifecycle.test.mjs packages/host/tests/async-credentials.test.mjs packages/host/tests/host-policy.test.mjs`；实现前确认行为失败。
- [ ] 在 Host 公共 facade 同步检查准入，在接受操作时使用 `try/finally` 跟踪。排队 mutation 也计数；准入前拒绝不产生副作用，terminal input 和 dispatcher notice 不能绕过门禁。
- [ ] 实现四个生命周期方法、租约校验、有界排空及 Web Host 公共转发。保留现有 release/dispose 顺序及已接受凭据操作的回复；内部监控不进入用户工作计数。
- [ ] 重跑聚焦测试。增加 `drain times out without losing accepted save`、`browser work is included`、`monitor-only polling does not keep drain busy`；断言取消后新工作成功，拒绝/关闭后计数归零。
- [ ] 运行 `npm run check:boundaries` 并提交，例如 `feat: expose host activity and shutdown admission`。

## T03 — 私有生命周期 RPC 与真实停止结果

**文件：** 修改 `apps/desktop/electron/host/entry.ts`、`runtime/host-process.ts`、`runtime/process-rpc.ts`、现有 `tests/host-process.test.mjs`、`tests/process-rpc.test.mjs`；在 `tests/fixtures/` 下增加可控子进程 fixture。

**接口：** 给 `DesktopHostProcess` 增加 `readonly lifecycle: RemoteHostLifecycle`、`stop(): Promise<HostStopResult>`。保留 `dispose(): Promise<void>` 作为同一个幂等停止操作的兼容清理包装。给 `startHostProcess()` 增加可选 `lifecycleTimeoutMs`，用于短测试预算，默认 `2_000`。私有方法名固定为 `host:inspect-activity`、`host:prepare-shutdown`、`host:drain-accepted`、`host:cancel-shutdown`；保留 `host:start`、`host:shutdown`。

- [ ] 编写 `private activity is not available over business WS`、`child returns counts for attached browser work`、`cancel after timed-out prepare uses the known lease`、`graceful stop requires acknowledgement and zero exit`、`forced stop is reported as non-graceful`。断言事实只有四个数字字段，且是有限非负整数。
- [ ] 运行 `npm run build:desktop`；运行 `node --test apps/desktop/tests/host-process.test.mjs apps/desktop/tests/process-rpc.test.mjs`，确认私有方法/停止结果尚未实现。
- [ ] 子进程请求连接到 `webHost.lifecycle`，明确校验方法/参数并采用上述预算。父进程代理校验回复。为 version `1` reply 增加可选 `wireError: WireError`，用现有 protocol helper 保留生命周期错误码；保留字符串 `error` 作为普通/旧回复回退。测试 `host.lifecycle-drain-timeout` 以错误码保留，不靠匹配 message。排空期间继续允许反向平台请求。
- [ ] 重构停止流程，记录确认、退出码和信号，不再把这些信息吞成成功更新。多次 stop/dispose 共用一次清理；预期停止不触发“意外退出”恢复。断连、可执行文件缺失、非法 handshake、超时及无响应子进程均须有界清理。
- [ ] 子进程仅在 `WebHost.dispose()` 完成后确认，并在正常进程退出前 flush 回复。安排在 `process.exit()` 之后的 reply 不是确认；保持普通 RPC 错误兼容，并保留结构化生命周期错误码。
- [ ] 重跑测试，并断言 `pending RPCs reject on child disconnect`、`startup failure leaves no child`、`dispose can follow stop without a second signal`。信号/超时使用真实子进程 fixture。
- [ ] 提交，例如 `feat: add private host lifecycle controls and stop results`。

## T04 — 普通退出保护

**文件：** 新增 `apps/desktop/electron/runtime/shutdown.ts`、`apps/desktop/tests/shutdown.test.mjs`；修改 `electron/app/main.ts`、`shell.ts`、`platform.ts` 和目录文案。扩展现有 Electron entry/smoke fixture，覆盖关窗和菜单退出。

**接口：**

```ts
createShutdownCoordinator(options: {
  getHost(): DesktopHostProcess | undefined
  getGeneration(): number | undefined
  confirm(request: ShutdownConfirmation): Promise<boolean>
  onFailure(error: unknown, phase: 'inspect' | 'prepare' | 'drain' | 'stop'): void | Promise<void>
}): {
  prepare(intent: ShutdownIntent, version?: string): Promise<ShutdownDecision>
  dispose(): void
}
```

`ShutdownConfirmation` 包含 `intent`、可选更新 `version`、可选 `activity`，及 `phase: 'initial' | 'changed' | 'unknown' | 'force'`。原生文案显示整个 Host 的活动计数和中断后果；取消是默认/取消按钮。同一个 Host/generation/intent/version 的相同请求共用一个 pending promise；不同 intent 或更新版本返回 `busy`，不能借用另一请求的 `ready`。返回 `ready` 后保留该决策直到调用方提交清理，不再对已停止 Host 发起第二轮准备。

**流程：** 检查 → 有活动则确认 → 获取已知租约 → 排空 → 在租约下再次检查 → 如中断事实新增则再次确认 → 停止 Host → 返回 `ready`。准备前/后取消都保留窗口/socket，只取消自己的租约。dispose 或 generation 改变后，忽略迟到对话框。提交退出前，确认同一个 Host/generation 仍拥有该决策。

检查失败表示**活动未知**，不是零活动。普通退出可以明确提供“仍然退出”，默认选取消。排空超时需要普通退出的明确强制确认；取消则恢复准入。子进程在有界停止流程内终止后，普通退出可以记录非优雅停止并返回 `ready`，不能违背用户退出决策重新启动；`prepare('update', version)` 仅在 `HostStopResult.graceful === true` 时返回 `ready`，否则返回 `failed`。租约取消得不到确认或子进程无法终止时，进入明确恢复流程，不能返回看似可用的页面。

- [ ] 编写 `cancel keeps window and WebSocket alive`、`new work between inspection and preparation triggers recheck`、`repeated quit confirms and stops once`、`conflicting update is busy`、`late dialog cannot stop a replacement Host`、`late dialog cannot stop a replacement document with the same Host`、`inspection timeout is not an empty snapshot`。断言取消时 `stopCalls === 0`，解锁后能接受新工作。
- [ ] 运行 `npm run build:desktop`，再运行 `node --test apps/desktop/tests/shutdown.test.mjs`，确认行为失败。
- [ ] 实现可注入确认/失败适配的协调器；用可控 deferred 确认和模拟远端失败加快单元测试。`getGeneration()` 返回当前 shell 的 `id`；每次 await 后同时比较它和同一 Host 对象，不允许过期/冲突决策提交。
- [ ] 在**Windows/Linux 正常窗口 `close` 销毁前**拦截；所有 OS 的应用退出在 `before-quit` 拦截。窗口按钮、菜单退出和程序触发的普通退出共用同一入口。用“退出已提交”标记放行最终 `app.quit()`；`will-quit` 是清理兜底，不是首次询问用户的地方。
- [ ] 基础阶段保留 macOS 普通关窗语义：释放该页面 SSH 会话，Host 保持存活；macOS 菜单 Quit/Cmd+Q 使用应用退出保护。T08 单独决定是否保留关窗文档。启动失败、renderer crash、boot/smoke 诊断退出和已提交的更新，走有界清理，不弹无法完成的活动对话框。
- [ ] 重跑单元测试；增加 Electron 验收 `cancelling close preserves same webContents/client/session`、`accepting close stops Host before application exit`、`macOS application quit is guarded`。最终清理只 dispose 一次 Host/窗口/handler；等待仍在启动的 Host，不留下晚到子进程。
- [ ] 提交，例如 `feat: protect desktop quit with host activity checks`。

## T05 — 更新准备与安装交接

**文件：** 修改 `apps/desktop/electron/runtime/updates.ts`、`electron/app/updates.ts`、`electron/app/main.ts`、现有 `tests/updates.test.mjs`、`tests/electron-updates-entry.mjs`、`tests/smoke-updates.mjs` 和目录文案。

**接口：** 将更新协调器分开的 `confirmInstall(version)`/`beforeInstall()` 参数替换为 `prepareInstall(version: string): Promise<ShutdownDecision>`，调用 T04 的 `prepare('update', version)`。保留 `onInstallError` 处理安装交接后的失败；准备失败是独立的、尚未进入安装状态的路径。所有调用方/fixture 同步调整。

**流程：** 准备取消、busy 或停止前失败时，已下载更新保持 `downloaded`。更新确认总是包含版本和当前中断事实，包括零活动。调用 `quitAndInstall(false, true)` 前，必须获得**优雅**停止后的同 intent `ready`，并提交 shell 清理。只有安装交接已提交后才能绕过普通退出保护；保留 `autoInstallOnAppQuit = false`。

更新遇到排空/检查失败不提供“强制继续安装”。取消租约、保留下载，尚未开始停止时当前 Host 仍可用。若停止已经破坏 Host 或安装器抛错，通过 T07 提供重启当前应用，不假装原 SSH 会话还在。

- [ ] 编写 `cancelled preparation keeps downloaded version retryable`、`work admitted during confirmation is caught`、`busy ordinary quit does not install`、`drain failure unlocks without stopping`、`forced termination never invokes installer`、`dispose while confirmation is pending never installs`、`new download invalidates old confirmation`。
- [ ] 运行 `npm run build:desktop`；运行 `node --test apps/desktop/tests/updates.test.mjs apps/desktop/tests/shutdown.test.mjs`，确认交接校验尚未实现。
- [ ] 实现 `prepareInstall`，保留取消/下载行为，在**每次 await 准备完成后**检查 disposed，尤其安装器调用前。过期版本/请求不能安装之后下载的另一个版本；若失效发生在 Host 停止后，进入停止后的恢复流程，不能返回一个看似可用但 Host 已死亡的页面。
- [ ] 重跑测试，断言调用顺序：准入锁 → 排空 → 最后检查 → 获确认的正常 Host 退出 → shell 清理 → 恰好一次 `quitAndInstall(false, true)`。更新不得使用普通退出的决策。
- [ ] 扩展 `smoke-updates.mjs`，覆盖活动的假 SSH/SFTP、取消和停止失败。测试 backend/下载保持本地，不运行真实安装器或公共更新服务。
- [ ] 提交，例如 `fix: gate update install on prepared graceful shutdown`。

## T06 — 统一快捷键归属与 IME 保护

**文件：** 新增 `packages/protocol/src/shortcuts.ts`、`packages/protocol/tests/shortcuts.test.mjs`、`packages/ui/src/services/shortcuts.ts`、`apps/desktop/electron/app/shortcuts.ts`、`apps/desktop/tests/shortcuts.test.mjs`。修改 protocol 导出/`DesktopBridge`、`electron/carriers/preload.ts`、现有 shell/main/menu 适配、Client 装配/terminal/hosts/SFTP 服务、快捷键帮助及现有 Client 生命周期/浏览器测试。

**接口：**

```ts
type ShortcutCommand = 'terminal.next' | 'terminal.previous' | 'terminal.close'
  | 'terminal.focus' | 'sftp.toggle' | 'hosts.search' | 'hosts.dismiss-editor'
interface ShortcutContext {
  terminalTabs: number
  activeTerminal: boolean
  connectedTerminal: boolean
  libraryVisible: boolean
  editorOpen: boolean
  modalOpen: boolean
  composing: boolean
}
resolveShortcut(input: ShortcutInput, context: ShortcutContext,
  platform: 'mac' | 'other'): ShortcutCommand | undefined
```

`ShortcutInput` 是规范化后的中立按键记录：字符串 `key`/`code`，布尔值 `ctrl`/`meta`/`shift`/`alt`/`composing`/`repeat`，以及 `type: 'keydown' | 'keyup'`。匹配器和绑定列表不导入 DOM/Node。`ClientShortcuts` 暴露 `register(command: ShortcutCommand, handler: () => void, enabled: () => boolean): () => void`、`updateContext(patch: Partial<ShortcutContext>): void`、`execute(command: ShortcutCommand): boolean`；功能服务拥有自己的 handler，不保留重复快捷键监听器。

另外导出 `isShortcutEnabled(command: ShortcutCommand, context: ShortcutContext): boolean`，供匹配器/菜单检查上下文；`getShortcutBindings(platform: 'mac' | 'other'): readonly ShortcutBinding[]`，供原生菜单/帮助使用。`ShortcutBinding` 包含 `command: ShortcutCommand`、`modifiers: readonly ('ctrl' | 'meta' | 'shift')[]`，以及恰好一个字符串 `key` 或 `code`。匹配和帮助使用同一列表，用户可读标签仍来自 i18n 目录。Electron 适配接口为 `installDesktopShortcuts(window: BrowserWindow, platform: 'mac' | 'other'): { reportContext(context: ShortcutContext): void; dispatch(command: ShortcutCommand): boolean; dispose(): void }`，只归属一个 generation；`dispatch()` 发送前检查相同上下文规则，只有应用适配器导入 Electron。

增加可选 `DesktopBridge.shortcuts`：`platform`、`reportContext(context): void`、`onCommand(listener): () => void`。增加通道 `shortcutContext: 'desktop:shortcut-context'`、`shortcutCommand: 'desktop:shortcut-command'`。上下文报告沿用所属文档/主 frame 校验；命令订阅方校验已知 ID。新 generation 在有效上下文到达前默认禁止命令。即使 main 上下文提示已过期，UI 每次执行命令也要重新检查当前 enabled 状态。

| 命令 | 默认按键 / 作用域 |
| --- | --- |
| `terminal.next`、`terminal.previous` | 所有 OS 使用 Ctrl+Tab / Ctrl+Shift+Tab；至少有一个 terminal tab 时，在 Home 和终端页之间循环 |
| `terminal.close` | Primary+W；仅活动 terminal tab，包括等待连接/失败的 tab |
| `terminal.focus` | Primary+Backquote（`code: 'Backquote'`）；仅活动 terminal tab |
| `sftp.toggle` | Primary+E；仅已连接的终端 |
| `hosts.search` | Primary+K；仅可见的主机库，保留远端终端 Ctrl+K |
| `hosts.dismiss-editor` | Escape；仅已打开的主机编辑器 |

Primary 在 macOS 是 Cmd，其他平台是 Ctrl；这明确修正当前 macOS 帮助中 Ctrl+Tab 的歧义。编辑器打开时，除关闭编辑器外，禁止工作区快捷键；组合输入或模态框期间全部禁止。拒绝 Alt/AltGr、修饰键不匹配、key-up，以及 repeat 触发的破坏性 close。保留 tab-strip/resizer 的局部方向键导航及原生 Edit 菜单 role。第一阶段不做可定制/持久化的绑定编辑器。

- [ ] 编写表驱动测试 `composition and AltGr pass through`、`editor and modal retain input`、`library-only Ctrl+K`、`Mac Ctrl+Tab and Cmd+W`、`repeat does not close a second tab`、`no active terminal does not close a window`。对每组输入/上下文断言精确命令或 `undefined`。
- [ ] 运行 `npm run build`；运行 `node --test packages/protocol/tests/shortcuts.test.mjs apps/desktop/tests/shortcuts.test.mjs`，确认注册/原生路径行为尚未实现。
- [ ] 实现中立匹配器/列表；浏览器 `ClientShortcuts` provider 放在功能消费方之前。只把工作区快捷键迁入注册表，保留普通控件导航。跟踪 composition start/end、当前编辑器/dialog、terminal/library 上下文，用显式 scope disposer 清理。
- [ ] 原生 `before-input-event` 和菜单分派使用同一组 ID/绑定。被消费的原生按键只 prevent 一次、只到达注册表一次；Desktop 禁用竞争的 DOM 工作区按键路径，独立/附加 Web 使用 DOM 路径。保留复制/粘贴/全选及远端 Ctrl+C；不加 Reload/Zoom 菜单。
- [ ] 快捷键帮助从同一绑定及平台派生，更新双语目录。增加 `unowned frame cannot report shortcut context`、`old generation cannot receive commands` 验收；校验新增 preload/main 报告，generation 替换和 Client dispose 时重置/删除全部监听器。
- [ ] 重跑 Node 测试；在 `packages/ui/tests/client-lifecycle.browser.ts` 增加按键/IME/上下文/remount，在现有 Electron 测试中增加“一次按键一次命令”断言。运行 `node packages/ui/tests/smoke-client-lifecycle.mjs`。实际原生 IME/平台覆盖与模拟组合输入测试分开记录。
- [ ] 提交，例如 `feat: coordinate desktop and web shortcut ownership`。

## T07 — 有界 Host 故障报告与明确重启

**文件：** 新增 `apps/desktop/electron/runtime/crash-report.ts`、`runtime/fatal-recovery.ts`、`apps/desktop/tests/crash-report.test.mjs`、`tests/fatal-recovery.test.mjs`；修改 `runtime/host-process.ts`、`electron/app/main.ts`、目录文案及现有 Electron smoke fixture。

**接口：** `writeHostCrashReport(directory: string, report: HostFailureReport): Promise<string | undefined>`；`createFatalRecoveryCoordinator({ record, choose, cleanup, relaunch, exit }): { handle(failure: HostFailureReport): Promise<void>; dispose(): void }`。参数接口为 `record(report): Promise<string | undefined>`、`choose(report, reportPath): Promise<'restart' | 'quit'>`、`cleanup(): Promise<void>`、`relaunch(): void`、`exit(code: number): void`；`report` 是 `HostFailureReport`，`reportPath` 是 `string | undefined`。

`HostFailureReport` 字段为 `version: 1`、ISO `timestamp`、字符串 `appVersion`/`platform`/`architecture`、`phase: 'startup' | 'runtime' | 'update'`、可选数字 `pid`、`exitCode: number | null`、`signal: string | null`。允许的 `reason`：`spawn-error`、`handshake-invalid`、`startup-timeout`、`ipc-disconnect`、`unexpected-exit`、`shutdown-timeout`、`lifecycle-control-failed`、`update-handoff-failed`。从 `host-process.ts` 导出 `HostProcessFailure`，包含进程事实 `reason`、可选 `pid`、`exitCode`、`signal`；在现有 Error 旁增加 `onExit(error: Error, failure: HostProcessFailure)`。main 适配器补齐版本/时间/平台/phase，并提供发生在现有 onExit 回调之前的启动故障。更新消费方，不把错误原文当成报告内容。

**决策：** 存放于 `<existing userData>/diagnostics/host/`，最多留 **五**份报告，每份上限 **64 KiB**，文件权限 `0600`，写入/轮转串行化。在目录内使用临时写入/原子 rename；只轮转本写入器生成的 `host-*.json`，不删除目录或无关文件。写入失败返回 `undefined`，不阻止恢复。不持久化原始 stdout/stderr、任意 error message/stack、数据目录路径、环境、socket URL/token、主机记录、终端输出或 SSH 凭据。

原生对话框提供 **重启 PureTerm** 和 **退出**，默认退出。重启表示有界清理后，以同样 data/profile/启动参数重新启动整个应用，建立新的 Host 和 Client；不自动重连 SSH，也不恢复终端状态。exit/disconnect/error 多重通知合并为一次恢复。正常停止及诊断运行不弹框；现有 renderer GPU/sandbox 回退仍是独立流程。

- [ ] 编写 `retention is five bounded reports`、`report payload excludes synthetic token/password/path/output`、`unwritable report directory still permits restart or quit`。断言 JSON 字段在允许列表内、留存数量/字节上限正确、临时文件清理。
- [ ] 编写 `three failure events yield one dialog and relaunch`、`quit never relaunches`、`old recovery cannot relaunch after disposal`、`restart preserves profile and waits for Host stop`。断言一次提示、一次清理，且 `cleanup` 先于 `relaunch`/`exit`。
- [ ] 运行 `npm run build:desktop`；运行 `node --test apps/desktop/tests/crash-report.test.mjs apps/desktop/tests/fatal-recovery.test.mjs apps/desktop/tests/host-process.test.mjs`，确认报告/恢复行为尚未实现。
- [ ] 实现报告写入和恢复协调器；用结构化事实接入启动/运行/更新故障。恢复前使 pending 退出/快捷键决策失效；仍存活但状态不确定的 Host 先有界清理，不进行自动重启循环。
- [ ] 重跑测试；增加 Electron 验收：杀死正在处理假工作负载的 Host，观察会话失效，明确选择重启，以同一隔离 profile 启动且恢复 SSH 数量为零。确保第二实例不能在恢复期间接管 profile。
- [ ] 提交，例如 `feat: add bounded host diagnostics and explicit recovery`。

## T08 — 可选：关窗后台运行时保留同一文档

**选择门槛：** 只有用户明确选择后台 SSH 行为后才执行；基础范围完成不依赖本任务。建议第一阶段使用 opt-in `SSH_CORDIS_BACKGROUND=1`，默认关闭；Windows 使用托盘，macOS 使用 Dock。Linux 在另行明确可靠返回入口前仍使用普通受保护关窗。

**文件：** 在 `apps/desktop/` 下新增 `electron/app/background.ts`、`electron/runtime/background-policy.ts`、`tests/background-policy.test.mjs`；修改 main/shell/platform、目录文案及 Electron fixture。需要新增托盘资源时，加入 `apps/desktop/assets/tray.png`，通过 `scripts/stage-desktop.mjs` 暂存，并按需更新 runtime path/packaging 测试及 `electron-builder.cjs`。

**接口：** `resolveBackgroundClose({ enabled, platform, returnEntryReady, quitting }): 'hide' | 'guarded-close'`；`installBackgroundController(options): { showWorkspace(): void; dispose(): void }`。它只拥有一个托盘/返回入口，接收当前窗口和明确退出 callback。`activate`、`second-instance`、托盘 Show、Dock 激活都使用同一个 `showWorkspace()`。

- [ ] 编写 `default close is unchanged`、`enabled close preserves webContents and socket`、`tray failure falls back to guarded close`、`Quit/update bypass hiding`。断言隐藏期间 generation/client/session ID 不变，真正退出全部清理。
- [ ] 构建；运行 `node --test apps/desktop/tests/background-policy.test.mjs`，通过现有测试设施运行新增 Electron 用例，确认行为失败。
- [ ] 先建立 Windows 托盘，再允许隐藏。普通关窗隐藏当前文档，不 release、不 reload、不新建 Client，不能只留 Host。菜单/托盘 Quit 仍走 T04，更新仍走 T05；macOS activate 显示原隐藏窗口。
- [ ] 在现有 `userData` 中记录每 profile 只提示一次的说明：关窗保留连接，退出断开连接。托盘创建失败使用普通关窗；不接受用户无法返回的隐藏 SSH 工作区。真正退出/恢复时 dispose 托盘和菜单资源。
- [ ] 验证假 SSH echo 和 gate 控制的 SFTP 在 hide/show 前后持续工作。暂存/资源改变时运行隔离的 `npm run verify:package:windows`；记录支持平台，独立提交这个可选工作包。

## T09 — 条件任务：本机工具所需的 POSIX 登录 shell 环境

**选择门槛：** 只有具体依赖本机可执行文件/PATH 的功能需要时才执行；当前远端 SSH 行为不需要。它不改变远端服务器的 shell 环境。

**文件：** 新增 `apps/desktop/electron/runtime/login-shell-environment.ts`、`apps/desktop/tests/login-shell-environment.test.mjs`；修改 main/Host 启动接线，增加可控 shell fixture。UI 不引入 Node/Electron。

**接口：** `parseLoginShellOutput(stdout: Uint8Array): Record<string, string> | undefined`；`mergeLoginShellEnvironment(base: NodeJS.ProcessEnv, shell: Readonly<Record<string, string>>): NodeJS.ProcessEnv`；`readLoginShellEnvironment(base, { platform, signal, timeoutMs?, totalTimeoutMs?, candidates? }): Promise<{ environment: NodeJS.ProcessEnv; failures: readonly { shell: string; reason: string }[] }>`。`base` 类型是 `NodeJS.ProcessEnv`，`platform` 是 `NodeJS.Platform`，`signal` 是 `AbortSignal`；`candidates` 是测试用的可选只读 shell 绝对路径列表。生产默认每个候选 **10,000 ms**、合计 **15,000 ms**、输出最多 **1 MiB**；测试注入短预算和候选路径。

- [ ] 编写 `Windows spawns no shell`、`NUL-delimited values preserve spaces equals and newlines`、`noise outside markers is ignored`、`launcher variables cannot be overwritten`、`oversized output fails safely`、`abort/timeout removes child group and skips later candidates`。
- [ ] 运行 `npm run build:desktop`；运行 `node --test apps/desktop/tests/login-shell-environment.test.mjs`，把跨平台解析/合并测试与真实 POSIX 进程组测试分开。
- [ ] 每次父进程启动只读取一次，在获得 profile 归属后、Host fork 前进行。按账户登录 shell，再按去重的 `/bin/zsh`、`/bin/bash`、`/bin/sh` 顺序尝试，受合计预算限制，不把用户值拼进 shell 命令。使用有分隔标记的 `env -0` 输出，忽略 stdin/stderr，超时/取消时有界清理进程组；读取失败回退继承环境。
- [ ] 保留继承的 `SSH_CORDIS_*`、`ELECTRON_*` 和启动器拥有的路径/值；排除探测会话变量（`PWD`、`OLDPWD`、`SHLVL`、`_`）及临时提示抑制标记。最终 fork 前移除 `NODE_OPTIONS`/`NODE_PATH`，强制 `ELECTRON_RUN_AS_NODE=1`。返回新对象，不修改 `process.env`，不记录导出的环境值。
- [ ] Windows 重跑 no-spawn/解析；Linux/macOS 验证进程组终止、失败 shell、脱离进程组的后代/stdout 行为，以及只读取一次。退出/恢复通过 AbortController 协调；独立提交这个条件工作包并给出实际平台结果。

## T10 — 集成、当前文档和执行交接

**文件：** 按影响更新 `README.md`/`README_zh.md`、`apps/desktop/README.md`/`README_zh.md`、`docs/architecture.md`/`architecture_zh.md`、`docs/DEVELOPMENT.md`/`DEVELOPMENT_zh.md`、`docs/desktop-release.md`/`desktop-release_zh.md`、`CHANGELOG.md`/`CHANGELOG_zh.md`；行为改变时更新生成 UI changelog。`AGENTS.md`/`AGENTS_zh.md` 只增加长期有效的新约束，不加入这份任务清单。只有确保新增 smoke 真正执行时才修改根/package 验证脚本。

- [ ] 对照 G01–G06 评审已选任务覆盖；未选择 T08/T09 时标为跳过并说明原因，不把拟议行为写成已交付。核对实际公共导出、私有方法名及全部消费方与上述契约一致。
- [ ] 每项任务结束运行对应聚焦测试；所有已选代码改完后，在仓库根目录运行一次：

```powershell
npm run verify
npm run check:boundaries
npm run verify:electron
npm run release:check
git diff --check
```

- [ ] 仅在打包/暂存/资源改变时运行 `npm run verify:package:windows`。记录每条命令、退出码和平台；环境受限或历史成功不是通过。未验证的 Linux/macOS 原生行为交由 CI 或目标机器检查。
- [ ] 更新当前文档：归属记录位置、取消/未知活动处理、更新顺序、快捷键作用域、诊断留存、重启限制。T01 必须提供明确 profile 迁移/修复说明，保留加密且不静默编辑绑定。保留有日期的对比报告作为历史证据。
- [ ] 将已交付用户行为写入双语 `[Unreleased]` CHANGELOG，并运行 `node scripts/convert-changelog.js`；只有另行授权发布且明确修改版本时才同步版本元数据。不能仅因实施本计划升级 `0.1.0-alpha.2`；生成 changelog 后重跑 `npm run release:check`。
- [ ] 检查已改 Markdown 相对链接、双语标识符/数值/code block、UTF-8；检查分支中误带数据、token、构建输出、临时 profile 或无关暂存文件。文档/集成改动独立提交。
- [ ] 向用户交付已选/跳过任务、提交 ID、测试命令/结果、已知限制及仍需外部平台验证的项目。推送、创建 PR、合并、发布只按执行对话里的授权进行；本计划不是发布授权。

## 默认范围完成标准

- 每份 SSH 数据目录由一个绑定 Desktop profile 拥有；失败方不打开 Host/存储，第二次启动能聚焦已有实例。
- 有活动或活动不确定时，在销毁 Windows/Linux 文档或退出应用前提供可取消的决策；取消保留当前会话并恢复准入。
- 更新交接锁住新工作、排空已接受有限操作、重查活动，且要求已获确认的正常 Host 退出。强制终止、旧对话框、退出冲突、活动未知都不安装更新。
- Desktop/Web 共享命令定义，原生/DOM 路径只执行一次，上下文/IME 规则成立，监听器随 Client/generation 释放。
- Host 故障只留存有界、允许字段内的诊断，提供明确应用重启/退出；重启不承诺恢复 SSH/终端会话。
- 当前双语文档和 changelog 只描述已执行范围；必要检查有实际结果，可选后续工作明确可见。

## 可直接转交给执行 agent 的提示词

> 在 PureTerm 仓库工作。先阅读当前 AGENTS.md 和 `docs/superpowers/plans/2026-09-30-desktop-reliability.md`（或中文配对文档），再读链接的对比报告及当前架构/发布文档。按依赖执行 T01–T07、T10，保留 Electron Node 模式、共享 Web Host、业务 WebSocket 的现有边界。T08、T09 未选择。重新核对当前工作树，保留无关改动。依赖构建产物的测试先构建，每项任务实现/验证后做聚焦提交，最后执行必要的整体检查。报告实际结果和限制。在本次执行对话没有授权前，不推送、不合并、不发布、不迁移真实用户 profile，也不向其他任务发消息。

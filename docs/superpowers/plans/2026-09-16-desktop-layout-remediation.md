# Desktop Layout and Verification Remediation (Historical Execution Record)

> **Historical record (2026-09-16):** This plan has been implemented; the original `chore/desktop-layout-remediation` branch was later merged into `main`. Current directories, runtime boundaries, and verification entry points are defined by [LAYOUT-PROPOSAL.md](../../../LAYOUT-PROPOSAL.md), the [architecture](../../architecture.md), and the [release guide](../../desktop-release.md). This file preserves the remediation process, durable criteria, and options explicitly rejected at that time.

## Objective and baseline

The objective was to correct factual and execution problems in the directory proposal so Electron Desktop could be cloned, verified, and developed further. The baseline was `907e940`. The stack remained Electron, TypeScript, Cordis, ssh2, xterm, esbuild, and the npm lockfile; tests used Node’s built-in capabilities and local SSH/HTTP/WS fixtures without adding a test framework.

## Durable criteria retained

- Assemble applications by entry point and provide shared capabilities through packages; do not copy deepseek-harness’s scale of nested packages, hundreds of workspaces, or multi-language document machinery.
- Business code does not depend on Electron; UI does not import Node or Host; protocol is environment-neutral; cross-package references use public exports.
- Electron APIs stay in the necessary shell, carrier, preload, and diagnostic adapters; production code never reads `Host.internals`.
- Root `typecheck` and boundary checks enforce constraints; documentation alone is insufficient.
- Tests are versioned with code; historical pass counts do not replace reproducible current verification.

## Options explicitly rejected at the time

The original plan required an in-process Host, no independent Host, no client plugin tree, no workspace, and no installer/update mechanism. Those were temporary scope constraints and were superseded by the Desktop runtime implementation plan. The current implementation uses an independent Node Host, a static Client plugin tree, workspaces, installers, and update coordination.

The following splits still depend on scale and consumers: do not create a second provider package without a second SSH implementation; do not split carriers into multiple npm packages until there are enough independent consumers; and do not split frontend directories merely for naming when files have no independent change boundary. Do not copy upstream’s two-level `packages/<group>/<package>` layout, multi-tenancy, Agents, or dynamic npm plugin management directly into this project.

## Execution result

- Restored and added executable tests and fixtures, removed test-directory ignore rules, and established build, type, dependency-boundary, Host, SSH/SFTP, HTTP/WS, and startup-diagnostic verification.
- Migrated application/Electron responsibilities, build entries, and resource paths; shared Host, protocol, transport, and UI now form the root workspace with one root `package-lock.json`.
- Desktop uses an independent Node Host child process; shared UI is a Cordis Client; installer, GitHub Releases update, and draft-publishing flows were completed by the later runtime work.
- Updated the proposal, README, layout, architecture, and release documents; screenshot tooling is not product code and has been removed.
- The original remediation branch was committed and merged into `main`; the later CHANGELOG workflow was merged as well. Current version operations are in [CHANGELOG.md](../../../CHANGELOG.md).

## Historical verification boundary

The remediation confirmed artifact paths, CommonJS preload, page resources, dependency boundaries, Host lifecycle, real local SSH/SFTP, HTTP/WS authentication, and Electron startup diagnostics. The original baseline lacked traceable smoke files, so old pass numbers were not reused.

Mouse/keyboard GUI flows, every real remote sshd, signed installers on other operating systems, and cross-version upgrades were not completion criteria for this directory remediation. Current complete verification and installer acceptance use `npm run verify`, `npm run verify:electron`, `npm run verify:package:windows`, and the [release guide](../../desktop-release.md).

<details>
<summary>中文版本</summary>

# Desktop 目录与验证整改方案（历史执行记录）

> **历史记录（2026-09-16）**：本方案已实施，原分支 `chore/desktop-layout-remediation` 后续合并进 `main`。当前目录、运行时边界和验证入口以 [LAYOUT-PROPOSAL.md](../../../LAYOUT-PROPOSAL.md)、[架构说明](../../architecture.md) 和 [发布说明](../../desktop-release.md) 为准；本文只保留整改过程、长期判据以及当时明确不采纳的方案。

## 目标与基线

目标是修正目录提案中的事实与执行问题，让 Electron Desktop 成为可从克隆验证、可继续开发的工程。基线为 `907e940`。技术栈保留 Electron、TypeScript、Cordis、ssh2、xterm、esbuild 和 npm lockfile；测试使用 Node 自带能力及本机 SSH/HTTP/WS 夹具，不新增测试框架。

## 保留的长期判据

- 应用按入口装配，共享包按能力提供；不按 deepseek-harness 的规模复制多层 packages、数百个 workspace 或多语言文档配套。
- 业务层不依赖 Electron；UI 不导入 Node 或 Host；协议不依赖运行环境；跨包引用经过公开导出。
- Electron API 只在必要的壳层、载体、preload 和诊断适配中使用；生产代码不读取 `Host.internals`。
- 约束必须由根 `typecheck` 和边界检查执行，不能只停留在文档约定。
- 测试与代码一起纳入版本控制，历史通过次数不能代替当前可复现验证。

## 当时明确不采纳的方案

原计划曾要求保持进程内 Host、不引入独立 Host、客户端插件、workspace、安装和更新机制；这是当时的范围约束，随后由 Desktop runtime 实现计划取代。当前实现已采用独立 Node Host、静态 Client 插件树、workspace、安装包和更新协调。

以下拆分仍按规模和使用者决定：没有第二个 SSH 实现时不拆 provider 包；载体数量不足时不拆成多个 npm 包；前端文件没有出现独立变化边界时不为目录而拆分。不要把上游的两级 `packages/<group>/<package>`、多租户、Agent 或动态 npm 插件管理直接复制到本项目。

## 执行结果

- 找回并补写可执行的测试与夹具，移除测试目录的忽略规则，建立构建、类型、依赖边界、Host、SSH/SFTP、HTTP/WS 和启动诊断验证。
- 应用、Electron 职责分层、构建入口和资源路径完成迁移；共享 Host、协议、传输和 UI 形成根 workspace，根 `package-lock.json` 是唯一锁文件。
- Desktop 使用独立 Node Host 子进程；共享 UI 是 Cordis Client；安装包、GitHub Releases 更新和 draft 发布流程由后续 runtime 实现补齐。
- 原提案已归档，当前 README、目录决策、架构和发布说明已更新；辅助截图工具不属于产品代码，现已移除。
- 原整改分支已提交并合并到 `main`；后续 CHANGELOG 流程也已合并，当前版本操作见 [CHANGELOG.md](../../../CHANGELOG.md)。

## 历史验证边界

整改阶段确认了构建产物路径、CJS preload、页面资源、依赖边界、Host 生命周期、真实本机 SSH/SFTP、HTTP/WS 鉴权及 Electron 启动诊断。最初基线缺少可追踪的 smoke 文件，因此本轮没有沿用旧的通过数字。

当时没有把鼠标键盘 GUI 流程、所有真实远端 sshd、其他操作系统的签名安装或跨版本升级当作目录整改的完成条件。当前完整验证和安装包验收以根命令 `npm run verify`、`npm run verify:electron`、`npm run verify:package:windows` 及 [发布说明](../../desktop-release.md) 为准。

</details>

# Desktop Runtime Implementation Plan (Historical Execution Record)

> **Completed historical plan (2026-09-16):** This file records the Desktop runtime implementation steps; the implementation has been merged into `main`. Current architecture and release operations are defined by the [architecture](../../architecture.md) and [release guide](../../desktop-release.md). This is not an unfinished task list.

1. Converted `CredentialProvider` and the save flow to asynchronous operations and verified concurrency, atomic failure behavior, and the session-only Web policy.
2. Implemented parent/child RPC, the Node Host entry, and process controller; connected Desktop startup, client disposal, failure, and exit paths, and used a real child process to verify SSH/SFTP and lifecycle behavior.
3. Composed the shared UI as Cordis transport/terminal/hosts/SFTP/readiness plugins; completed transport unsubscribe/dispose and verified remounting and dependency cleanup.
4. Implemented the update coordinator and menu entry; verified duplicate checks, download errors, manual prompts, Host shutdown before installation, and cleanup.
5. Added physical staging, electron-builder, cross-platform CI, and draft Release flow; generated an NSIS package locally and completed isolated install/start acceptance.
6. Updated architecture, usage, and release documentation, ran full verification, and reviewed the integrated diff. Signing and final acceptance on other platforms remain subject to their CI and target machines.

The work was parallelized at the time: Host credentials, shared UI, and packaging/CI were edited independently, while the main task handled process boundaries, updates, assembly integration, dependency locking, and final verification.

<details>
<summary>中文版本</summary>

# Desktop 运行时实施计划（历史执行记录）

> **已完成的历史计划（2026-09-16）**：本文记录 Desktop runtime 实施步骤；实现已合并到 `main`。当前架构和发布操作以 [架构说明](../../architecture.md) 与 [发布说明](../../desktop-release.md) 为准，本文不作为未完成任务清单。

1. 已将 CredentialProvider 和保存流程改为异步，验证并发、失败原子性和 session-only Web 政策。
2. 已实现父子 RPC、Node Host 入口与进程控制器，接入 Desktop 启动、客户端释放、失败和退出路径，并使用真实子进程验证 SSH/SFTP 与生命周期。
3. 已将共享 UI 组合为 Cordis transport/terminal/hosts/SFTP/readiness 插件，补齐 transport unsubscribe/dispose，验证重挂载与依赖释放。
4. 已实现更新协调器和菜单入口，验证重复检查、下载错误、手动提示、安装前 Host 关停与清理。
5. 已添加物理 staging、electron-builder、跨平台 CI 与 draft Release 流程；本机生成 NSIS 并完成隔离安装启动验收。
6. 已更新架构、使用和发布文档，运行完整验证并审查整合差异；签名与其他平台的最终验收仍以对应 CI 和目标机器结果为准。

当时的并行分工是 Host 凭据、共享 UI、打包/CI 分别独立修改，主任务负责进程边界、更新、程序集成、依赖锁和最终验证。

</details>

# 共享 Web Host 实施计划

[English version](2026-09-23-upstream-web-host.md)

**目标：** 让 PureTerm Desktop 跟随最新上游 Web 薄壳架构，保留 SSH/SFTP 产品行为。

**架构：** 普通 Node Web 和 Desktop 子进程共享 Web Host 装配。Desktop 通过本机自定义协议提供资源、主进程为共享 WebSocket 注入认证，私有 IPC 保留生命周期和平台能力。

**技术栈：** TypeScript、Node.js >=24、npm workspaces、Electron、Cordis、ssh2、xterm.js。

**规格：** [设计](../specs/2026-09-23-upstream-web-host-design_zh.md)。

## 约束与评审重点

使用 PowerShell 和 UTF-8。保留四个共享包、唯一根锁文件、凭据策略和随机回环端口。测试不使用真实用户 SSH 数据。检查：凭据不能到达外部窗口；过期启动结果不能重新打开已卸载客户端；渲染丢失回收空闲会话和握手；关停排空已接受写入；资源路径不依赖启动 cwd。已有未跟踪设计截图与本任务无关，保持不动。

## 任务

- [x] 将干净的参考仓库快进到 `00102833dfaee1da9f48a3a8eae9d34005a75218`，创建 PureTerm 分支 `refactor/upstream-web-host`。
- [x] 新建 `packages/transport/src/web-host.ts`、公开导出及共享装配测试；让 `apps/web/src/server.ts` 使用它。在 `carrier-http.ts` 增加独立 Desktop bearer 认证和附带浏览器开关，保留现有 token/cookie 测试。
- [x] 调整 Desktop `runtime/host-process.ts` 和 `host/entry.ts`，共享 Web Host 启动后返回 `{pid,url,desktopToken}`；移除业务 dispatcher/事件代理，将进程测试和父进程丢失夹具改为真实 WS 请求。
- [x] 增加协议启动类型及最小 preload。UI 仅在 Desktop 等待启动信息，两种模式均走 WS；测试启动失败、等待中卸载、迟到回复及字节保真。
- [x] 新增 `runtime/web-document.ts` 负责安全自定义协议资源和请求认证策略；在 Electron app 注册装配。Host 就绪前加载页面，启动/就绪仅接收当前窗口主框架，删除 SSH IPC 载体。
- [x] 更新真实 Electron 启动/SSH/SFTP/Keychain/崩溃/浏览器测试和诊断探针，分别验证源码与打包资源路径。
- [x] 更新中英文现行文档、AGENTS、上游基线和 CHANGELOG，生成 UI 变更日志；运行构建、针对性测试、`npm run verify`、`npm run verify:electron`、`npm run release:check`、Markdown 链接检查及 `git diff --check`；若暂存调整需要，执行隔离 Windows 安装验收。
- [x] 评审完整差异的认证、生命周期和兼容性，修复已确认问题，仅报告实际验证结果，在本地分支保留可审查实现。

## 2026-09-23 完成的验证

- `npm run verify` 通过：130 项单元测试，以及 Node SSH/SFTP、载体和生命周期冒烟检查。
- `npm run verify:electron` 通过：自定义协议 Desktop、外部窗口拒绝、加密 Keychain、附带浏览器、渲染崩溃、更新器、独立浏览器及 Client 生命周期。
- 额外使用 `SSH_CORDIS_NO_WEB_CARRIER=1` 启动真实 Electron，Desktop 正常到达就绪状态。
- `npm run dist:desktop -- --win --x64` 和 `npm run verify:package:windows` 通过。隔离安装后从工作区外验证 SSH/SFTP 与加密凭据，停止 Host，并明确卸载此次测试安装。
- UI 变更日志/版本生成及 `npm run release:check` 通过；检查了 Markdown 本地链接目标与 `git diff --check`。
- 独立审阅发现并修复 Electron 无法识别请求 frame 时的授权问题；缺失、过期或外部 frame 无法获得 Desktop 凭据。未发现其他已确认回归。

以上为当前 Windows 环境结果。隐藏窗口启动检查中的可选截图未能获取显示表面，功能就绪检查通过；未执行 macOS/Linux 运行验收或 GUI 鼠标键盘验收。未提交、推送或发布版本。

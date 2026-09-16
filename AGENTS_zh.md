# AGENTS.md

[English version](AGENTS.md)

PureTerm 是基于 Cordis、ssh2 和 xterm.js 的开源 SSH/SFTP 客户端，提供 Electron Desktop 和独立本机 Web 两个入口。SSH 始终由用户电脑发起；本机 Web 只监听回环地址，不提供公网服务、用户账号、租户隔离或远程控制。

本文件适用于整个仓库。修改 `packages/`、`apps/` 或根目录脚本前，先阅读 [架构说明](docs/architecture_zh.md) 和 [目录决策](LAYOUT-PROPOSAL_zh.md)。修改发布流程前，阅读 [Desktop 发布说明](docs/desktop-release_zh.md)。上游协作规则参考 [deepseek-harness 的 AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md)，但本文件以 PureTerm 的实际边界为准。

## 文档语言

所有维护中的 Markdown 文档默认先阅读英文。每个英文文档都在同目录的 `*_zh.md` 文件中保留完整中文翻译，并从英文文件链接过去。行为、命令、路径或限制发生变化时，同时更新两个文件；代码块、标识符、链接和版本号必须保持一致。标准 MIT `LICENSE` 法律文本继续使用规范英文版本。

## 当前事实与历史资料

- 当前入口是 `apps/desktop/` 和 `apps/web/`；共享能力位于 `packages/host/`、`packages/protocol/`、`packages/transport/` 和 `packages/ui/`。
- Desktop 由 Electron 主进程启动独立 Node Host 子进程；独立 Web 在自己的普通 Node 进程内装配 Host。
- 根 `package-lock.json` 是唯一锁文件。所有安装、构建和验证命令从仓库根运行。
- 当前状态以根 `README_zh.md`、`LAYOUT-PROPOSAL_zh.md`、`VERSION.txt`、`docs/architecture_zh.md`、`docs/DEVELOPMENT_zh.md`、`docs/desktop-release_zh.md`、应用 README 和 `CHANGELOG_zh.md` 为准。
- `docs/superpowers/` 中带日期的文件是历史实施记录和规格。它们可以保留判据、正确建议和明确不采纳的方案，但不得当作当前命令、路径、分支或测试结果；已移除的旧归档、评审和截图研究资料不作为当前文档来源。
- 截图和鼠标键盘驱动不属于产品运行时代码或验证入口；已删除的 `tools/gui/` 与相关研究资料不要重新加入构建、测试或发布流程。

## 仓库布局

```text
apps/desktop/       Electron 壳、运行时、Host 子进程入口、载体和 Desktop 测试
apps/web/           独立本机 Web 的 Node 入口、服务和测试
packages/host/      Cordis Host、SSH/SFTP、主机存储和凭据接口
packages/protocol/  环境无关的请求、事件、能力和二进制协议
packages/transport/ dispatcher、HTTP/WebSocket、载体和就绪校验
packages/ui/        Cordis Client、终端、主机列表、SFTP 和浏览器适配
VERSION.txt         所有 workspace 共用的源码版本基准
scripts/            根 workspace 构建、类型、边界、staging 和发布检查
docs/               当前架构/发布文档及带日期的历史记录
.github/workflows/  Desktop 三平台构建和 GitHub Releases draft 流程
```

按入口和能力组织目录。不要为了模仿 deepseek-harness 的规模复制多层 package group、Agent、动态 npm 插件或多租户模型；新增包必须有独立职责、消费者和验证边界。

## 依赖与边界

- `@pureterm/protocol` 不依赖其他本地包、Electron、Node 或 UI。
- `@pureterm/host` 不依赖 Electron、UI 或应用入口；Host 的公共接口从包入口导出。
- `@pureterm/ui` 只面向浏览器，不能导入 Node、Electron 或 Host；页面内部使用静态 Cordis Client 插件组合。
- `@pureterm/transport` 通过 Host 公共接口分派请求，不能读取 `Host.internals`。
- Electron API 只进入 Desktop 的 `electron/app/`、`electron/carriers/`、preload 和诊断适配；`electron/runtime/` 与 `electron/host/` 不导入 Electron。
- 跨 workspace 引用必须使用公开 package exports；只有包内模块才使用相对源码路径。
- 源码检查和构建产物检查要明确区分。需要 `dist/` 的测试必须先构建，不要让过期产物掩盖源码错误。
- 共享包之间的协议或公开类型变化必须更新所有消费者、测试、文档和 `CHANGELOG.md`，不能只改提供方。

## 运行时不变量

- Desktop Host 子进程通过带版本的私有 RPC 握手；父进程在启动失败、窗口关闭、渲染崩溃、更新和退出时等待 Host 释放，超时才终止。
- 父子 IPC 使用能保留 `Uint8Array` 的序列化方式。终端和 SFTP 的二进制内容不能在传输层提前转成字符串。
- Client、载体和 Host 都必须提供明确的 `dispose`/释放路径；页面重挂载、WebSocket 断开和 Host 意外退出不能留下会话、监听器或定时器。
- 独立 Web 只绑定 `127.0.0.1`，使用启动 token、会话 cookie 以及 Origin/Host 校验；不能新增公开监听参数。
- Desktop 凭据通过系统加密 provider 保存。Web 只保存主机元数据和已信任指纹，不持久化密码、口令、私钥内容或私钥路径，且与 Desktop 使用分离的数据目录。

## 命令

环境要求 Node.js 24 或更高版本、npm；Windows 命令使用 PowerShell，文档和新增文本使用 UTF-8。

```powershell
npm ci
npm run start:web
npm run start:desktop

npm run build
npm run build:web
npm run build:desktop
npm run typecheck
npm run check:boundaries
npm run test:unit
npm run verify
npm run verify:electron

npm run stage:desktop
npm run dist:desktop -- --win --x64
npm run verify:package:windows
npm run release:check
npm run release:notes -- --version <version> --output release-notes.md
npm run version:generate
npm run version:sync
```

`verify` 覆盖构建、类型、依赖边界、Host/协议/凭据、UI、独立 Web 和本机 SSH/SFTP/HTTP/WS 测试。`verify:electron` 覆盖 Desktop boot、IPC、附带 Web、渲染崩溃回收、更新下载、独立 Node Web 和 Client 生命周期。Linux 的 Electron 检查在 CI 中通过 `xvfb-run` 运行。`verify:package:windows` 只验收隔离的 Windows 安装/卸载流程。

## 测试与变更验证

- 根据改动面运行最小充分检查：协议/Host/UI 逻辑优先运行相关 Node 测试；Electron 载体、进程、更新或资源路径变更运行 `npm run verify:electron`；打包或 staging 变更追加 `npm run verify:package:windows`。
- 代码、依赖边界或构建脚本变更在合并前运行 `npm run verify`。文档-only 修改至少运行 `npm run release:check`、Markdown 链接检查和 `git diff --check`。
- 报告实际运行的命令和结果。退出码 2 的已识别环境限制不算测试通过；不要用进程存在、旧 `dist/` 或历史通过次数代替成功信号。
- 测试使用仓库内夹具、随机回环端口和临时数据目录，不连接用户的远端主机，不覆盖用户 SSH 数据。
- 测试描述行为和失败条件。改变旧行为时同步更新对应测试，并在 PR 中说明兼容性影响。
- 不默认重复完整测试套件；CI 负责平台矩阵，只有跨仓库变更、诊断 CI 或用户明确要求时才扩大本机验证范围。

## 秘密与本地数据

- 不提交密码、私钥、token、证书、`.env` 或真实主机记录。发布签名只读取 GitHub Actions secrets 或本机临时环境变量。
- `SSH_CORDIS_DATA_DIR`、`SSH_CORDIS_WEB_DATA_DIR` 和测试临时目录不能指向用户已有的生产数据目录。Desktop 与独立 Web 不得同时写同一份 JSON 存储。
- Web 端文件选择只发送当前页面读取的私钥内容；不能把浏览器提供的文件名当成本机绝对路径。
- 失败路径也要清理连接、监听器、临时目录和子进程；不要为了让测试通过而放宽本机 Web 的回环或 token 校验。

## 文档、版本与发布

- 代码变化同时更新受影响的 README、架构说明、公开接口注释和测试说明。当前事实只保留一个权威位置；历史评审不要改写成当前状态。
- `VERSION.txt` 是源码版本基准。根目录及所有 workspace 的 `package.json` 和 `package-lock.json` 必须与它一致。源码版本不带 `v`，发布 tag 使用 `v<version>`。当前开发版本为 `0.1.0-alpha.1`；已发布版本号不得复用，`0.x` 破坏性变更必须明确记录。
- 用户可见变化先写入 `CHANGELOG.md` 的 `[Unreleased]`，按 `Added`、`Changed`、`Fixed`、`Security` 分类。
- `CHANGELOG.md` 首行必须是 `# PureTerm`。更新源码版本和变更日志后，运行 `node scripts/convert-changelog.js` 及 `node scripts/convert-changelog.js --sync-version`，并提交生成的 `packages/ui/src/lib/changelog.ts` 和 `packages/ui/src/lib/version.ts`。
- 根目录和所有 workspace 版本必须一致；发布前运行 `npm run release:check -- --version <version>`、`npm run verify` 和 `npm run verify:electron`。
- GitHub Releases 只由 `v<version>` tag 的 CI 生成 draft。普通分支或本地命令不发布、不上传 token，也不修改已公开的 release。
- 安装包从独立 staging 生成，不能依赖 workspace 符号链接或启动时 cwd。正式平台签名、notarization 和跨平台运行结果以对应 CI/目标机器为准。

## Git 与协作

- 从 `main` 创建聚焦分支；一个提交尽量只解决一个可审阅的问题。不要提交 `dist/`、`.release/`、`release/`、临时数据或本机截图。
- 提交前检查 `git diff --check` 和与改动面匹配的验证命令。PR 描述说明问题、行为变化、验证结果和已知限制。
- 不改写其他人正在使用的分支，不使用裸 `--force`；确需重写时使用 `--force-with-lease` 并先确认远端没有新提交。
- 合并前确认工作区没有未说明的修改，版本和 CHANGELOG 已同步，CI 所需的检查全部通过。

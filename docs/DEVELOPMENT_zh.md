# PureTerm 开发说明

[English version](DEVELOPMENT.md)

本文说明 PureTerm 的本机开发流程。PureTerm 是基于 TypeScript 和 Cordis 的 SSH/SFTP 客户端，提供 Electron Desktop 和独立本机 Web 两个入口。两个入口都从用户电脑发起 SSH；Web 服务只绑定 `127.0.0.1`，不提供公网服务。

[架构说明](architecture_zh.md)是运行时行为的权威文档，[目录决策](../LAYOUT-PROPOSAL_zh.md)是包边界的权威文档，[发布说明](desktop-release_zh.md)是安装包和 GitHub Releases 的权威文档。 [`docs/superpowers/`](superpowers/) 下带日期的记录只保留历史决策，不是当前任务清单。

## 开发环境

使用 Node.js 24 或更高版本及 npm。Windows 使用 PowerShell，文档和新增文本使用 UTF-8。根目录 `package-lock.json` 是唯一锁文件，在仓库根安装依赖：

```powershell
npm ci
```

不要在 `apps/` 或 `packages/` 中再次安装，也不要提交 `node_modules/`、`dist/`、`.release/` 或 `release/` 产物。

在仓库根启动入口：

```powershell
# 独立本机 Web；打开终端打印的带 token 地址
npm run start:web

# Electron Desktop
npm run start:desktop
```

`start:web` 构建共享包并启动普通 Node 进程。`start:desktop` 构建共享包和 Electron 入口后启动 Desktop。Web 默认使用随机回环端口；按 Ctrl+C 停止任一进程。

默认数据目录为 Desktop 的 `~/.ssh-cordis/` 和独立 Web 的 `~/.ssh-cordis/web/`。两个目录必须保持分离。测试使用临时目录，不得指向用户日常数据目录。

常用环境变量：

| 变量 | 作用 |
| --- | --- |
| `SSH_CORDIS_DATA_DIR` | 覆盖 Desktop 数据目录 |
| `SSH_CORDIS_WEB_DATA_DIR` | 覆盖独立 Web 数据目录 |
| `SSH_CORDIS_NO_WEB_CARRIER=1` | 关闭 Desktop 附带的本机 Web carrier |
| `SSH_CORDIS_NO_LAUNCH_PROFILE=1` | 禁止 Desktop 启动档案读写 |
| `SSH_CORDIS_NO_SANDBOX_FALLBACK=1` | 禁止 Electron 自动无沙箱回退 |

不要提交 `.env` 文件、密码、私钥、token、证书或真实主机记录。Desktop 凭据使用系统加密 provider。独立 Web 只保存主机元数据和已信任指纹；密码、口令和浏览器选中的私钥内容只存在当前页面。

## 仓库布局

| 路径 | 职责 |
| --- | --- |
| `apps/desktop/` | Electron 壳、平台适配、Node Host 子进程入口、载体、诊断和 Desktop 测试 |
| `apps/web/` | 独立本机 Web 的 Node 入口、HTTP/WS 服务、CLI 和测试 |
| `packages/protocol/` | 与环境无关的请求、能力、事件和二进制线格式 |
| `packages/host/` | Cordis Host、SSH/SFTP 服务、主机存储、指纹和凭据接口 |
| `packages/transport/` | dispatcher、HTTP/WebSocket 载体、客户端身份和就绪校验 |
| `packages/ui/` | 浏览器 Cordis Client、终端、主机列表、SFTP 面板和浏览器选钥 |
| `scripts/` | 根 workspace 构建、类型、边界、staging、Windows 安装包和 changelog 检查 |
| `docs/` | 当前架构/发布/开发文档及带日期的历史记录 |
| `.github/workflows/` | Desktop 跨平台构建和 GitHub Releases draft 流程 |

新增内容按入口或能力组织。新包必须有独立职责、消费者和验证边界。不要把 deepseek-harness 的包规模、Agent 模型、动态 npm 插件管理或多租户服务模型直接复制到 PureTerm。

## 依赖与运行时边界

允许的依赖方向由 `npm run check:boundaries` 和 `npm run typecheck` 执行：

- `@pureterm/protocol` 不导入本地包、Node、Electron 或 UI。
- `@pureterm/host` 负责 SSH/SFTP 和存储，但不依赖 Electron、UI 或应用入口。
- `@pureterm/ui` 只面向浏览器，不导入 Node、Electron 或 Host。
- `@pureterm/transport` 通过 Host 公共 API 调用，不读取 `Host.internals`。
- Electron API 只进入 Desktop 的 `electron/app/`、载体、preload 和诊断；`electron/runtime/` 与 `electron/host/` 不导入 Electron。
- 跨 workspace 引用使用公开 package exports，禁止通过相对路径访问另一包源码。

Desktop 启动独立 Node Host 子进程，通过带版本的私有 RPC 通信。主进程拥有窗口、原生文件选择、safeStorage、更新协调和子进程生命周期；独立 Web 在普通 Node 进程中装配自己的 Host。共享实现不代表共享会话或共享数据文件。

Client、载体和 Host 必须提供明确的释放路径。父子 IPC 保留 `Uint8Array`；终端和 SFTP 字节不能提前转成字符串。WebSocket 断开和渲染进程失败时，必须释放该客户端拥有的会话。

## 质量检查

开发过程中运行定向检查：

```powershell
npm run typecheck
npm run check:boundaries
npm run test:unit
npm run release:check
```

`test:unit` 运行 Desktop、Web、Host 和 UI 下的 Node 测试，使用仓库夹具、随机回环端口和临时数据目录。测试不得连接用户远端主机或覆盖用户 SSH 数据。

代码、依赖或构建脚本合并前运行完整 Node 验证：

```powershell
npm run verify
```

`verify` 会执行干净构建、类型和边界检查、单元测试、Host 子进程、凭据、更新协调、打包隔离、UI、独立 Web 以及本机 SSH/SFTP/HTTP/WS 冒烟检查。

涉及 Electron 窗口、IPC、preload、子进程、更新或资源路径时运行：

```powershell
npm run verify:electron
```

该命令检查 Desktop boot、IPC、附带 Web carrier、渲染崩溃清理、更新下载和校验、真实浏览器中的独立 Node Web 以及共享 Client 作用域生命周期。Electron 显示环境不可用等已识别限制不算通过。

文档-only 修改至少运行 `npm run release:check`、Markdown 相对链接检查和 `git diff --check`。在 PR 中报告实际运行的命令和结果。不要用旧 `dist/`、进程存在或历史通过次数代替成功证据。

## 入口定向检查

Desktop 命令从仓库根通过 workspace 选项运行：

```powershell
npm run boot --workspace=@pureterm/desktop
npm run smoke:electron --workspace=@pureterm/desktop
npm run smoke:web --workspace=@pureterm/desktop
npm run smoke:node --workspace=@pureterm/desktop
npm run smoke:profile --workspace=@pureterm/desktop
npm run diagnose:electron --workspace=@pureterm/desktop
```

单独运行 `smoke:node` 前先执行 `npm run build:desktop`。完整 `verify` 命令会自动构建所需产物。Desktop 冒烟测试使用受控窗口和临时用户目录；截图只是尽力取得的证据，不能替代 `renderer-ready` 或其他明确成功信号。

独立 Web 检查：

```powershell
npm run build:web
node --test apps/web/tests/*.test.mjs
node apps/web/tests/smoke-browser.mjs
```

浏览器冒烟测试只把 Electron 当作测试 Chromium 窗口，Web 服务本身仍是普通 Node 进程，并且必须继续拒绝非回环监听、无效启动 token、无效 Host/Origin 以及浏览器伪造的文件路径。

## 构建与打包

在仓库根构建全部 workspace 或指定入口：

```powershell
npm run build
npm run build:web
npm run build:desktop
```

构建顺序为 protocol、Host、transport、UI 和应用。共享 UI 只在 `packages/ui/dist/` 生成一份；应用资源通过 package exports 或编译模块路径定位，不依赖启动 cwd。

准备和检查安装包：

```powershell
npm run stage:desktop
npm run dist:desktop -- --win --x64
npm run verify:package:windows
```

staging 可以删除并重新生成，不得提交。安装包说明记录自包含 `.release/app` 布局、可选原生模块排除、CI 产物、签名、notarization、更新 feed 和验收边界。本地及普通 CI 使用 `--publish never`；只有 tag workflow 创建 GitHub draft release。

## 版本与变更日志

根包和所有 workspace 包使用同一个语义化版本。使用以下命令检查一致性：

```powershell
npm run release:check
```

用户可见变化先记录在英文 [CHANGELOG.md](../CHANGELOG.md) 的 `[Unreleased]` 区段，并同步到 [CHANGELOG_zh.md](../CHANGELOG_zh.md)。使用 `Added`、`Changed`、`Fixed` 和 `Security` 等分类。`scripts/changelog.mjs` 只从英文文件提取发布说明，中文文件是翻译镜像，不作为发布源。

发布时，将所有 workspace 版本设为相同值，更新锁文件，把 `[Unreleased]` 移到带日期的版本区段，然后运行：

```powershell
npm run release:check -- --version 0.2.0
npm run release:notes -- --version 0.2.0 --output release-notes.md
```

只有 `npm run verify`、`npm run verify:electron` 和 Windows 安装包验收通过后，才推送对应的 `v<version>` tag。发布 workflow 构建 Windows NSIS、macOS DMG/ZIP 和 Linux AppImage，并创建 draft；不会自动公开。详见[Desktop 安装包与 GitHub Releases](desktop-release_zh.md)。

## 文档与协作流程

仓库文档默认使用英文。每个维护中的 Markdown 文档都在同目录保留 `_zh.md` 镜像，并在顶部互相链接。命令、路径、行为或限制变化时同时更新两个文件。当前事实写入英文权威文档；带日期的计划和规格可以保留历史判据及未采纳方案，但必须明确标为历史记录。

提交前：

1. 检查差异中是否有过时路径、秘密、生成产物，以及对已删除历史资料的意外修改。
2. 运行与改动匹配的检查和 `git diff --check`。
3. 从 `main` 创建聚焦分支，使用可审阅的提交说明。
4. 合并前确认工作区干净，版本和 CHANGELOG 已同步。

不要把已删除的 `tools/gui/` 截图工具或旧归档、评审、截图研究目录重新加入产品、测试或发布流程。不要使用裸 `git push --force`；确需重写历史时，先检查远端并使用 `--force-with-lease`。

## 常见问题

- **切换分支后依赖或类型报错：** 在根目录运行 `npm ci`，再运行 `npm run build`，避免使用过期的包产物。
- **独立 Web 无法启动：** 确认端口未被占用且绑定地址仍为回环；使用 `node apps/web/dist/main.js --help` 查看支持的参数。
- **Desktop 无法打开：** 运行 `npm run diagnose:electron --workspace=@pureterm/desktop`，查看 `apps/desktop/dist/launch.log`，再用 `verify:electron` 检查受控启动。
- **测试留下数据：** 确认测试使用临时数据目录，并且 carrier、Host、socket 和子进程都执行了释放路径。
- **依赖边界检查失败：** 通过包公开导出引用，并把平台代码移到允许的 Desktop 适配层；不要屏蔽 AST 检查或访问 `Host.internals`。

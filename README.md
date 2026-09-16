# PureTerm

PureTerm is an SSH/SFTP client built with Cordis, ssh2, and xterm.js. It provides two local entry points: an Electron Desktop app and a standalone local Web app. SSH connections are always initiated by the user’s computer; the Web server binds only to the local loopback interface and provides no public service, accounts, or user isolation.

The project is released under the [MIT License](LICENSE).

Both entry points reuse the Host, protocol, transport adapters, and Cordis Client. Desktop starts an independent Node Host child process from Electron; the standalone Web app runs in an ordinary Node process without starting Electron.

## Getting started

You need Node.js 24 or newer and npm. Desktop also needs a working desktop environment. Install all dependencies from the repository root with the single lockfile:

```powershell
npm ci

# Use the local Web app in a browser; open the tokenized URL printed in the console
npm run start:web

# Or start the Electron Desktop client
npm run start:desktop
```

The start commands build the required shared modules and application. Web uses a random loopback port by default; press Ctrl+C to stop it. Desktop stores data in `~/.ssh-cordis/` by default, while standalone Web uses `~/.ssh-cordis/web/`; each location stores host records and trusted SSH host keys for its own entry point.

Desktop can use the operating system credential store for passwords or private-key passphrases and can open native private-key file dialogs. Standalone Web stores host information only; passwords, passphrases, and private-key content selected in the browser live only in the current page and must be entered or selected again after a refresh. See the [Desktop guide](apps/desktop/README.md) and [local Web guide](apps/web/README.md).

## Verification

```powershell
# Clean build, type/dependency-boundary checks, Node and local protocol tests
npm run verify

# Desktop boot / IPC / Web and a real-browser check of standalone Node Web
npm run verify:electron
```

Tests use the repository’s local SSH/SFTP fixtures and temporary data directories. The second command requires a desktop environment; an Electron startup limitation is a failed check, not a pass.

## Repository entry points

| Path | Contents |
| --- | --- |
| `apps/desktop/` | Electron shell, platform adapters, startup diagnostics, and tests |
| `apps/web/` | Standalone local Node Web entry point and tests |
| `packages/host/` | Cordis Host, SSH/SFTP, host storage, and credential interfaces |
| `packages/protocol/` | Transport protocol and shared data structures |
| `packages/transport/` | Request dispatch, HTTP/WebSocket, and carrier composition |
| `packages/ui/` | Shared terminal, file panel, and browser transport for both entry points |
| [docs/architecture.md](docs/architecture.md) | Current architecture, lifecycle, and data boundaries |
| [LAYOUT-PROPOSAL.md](LAYOUT-PROPOSAL.md) | Current directory and shared-module decisions |

The repository uses npm workspaces. Shared packages are referenced through public exports, and the root `package-lock.json` is the only installation lockfile. Versions and user-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md); `npm run release:check` validates version alignment and release entries in CI. `npm run dist:desktop -- --win --x64` creates a Windows installer; CI also builds macOS/Linux artifacts. Packaged builds check GitHub Releases for updates and install them only after the user confirms a restart. Signing, publishing, and local acceptance are documented in the [release guide](docs/desktop-release.md).

Old review documents, the original proposal, and screenshot research material have been removed. The current implementation record is [the remediation plan](docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md).

<details>
<summary>中文版本</summary>

# PureTerm

基于 Cordis、ssh2 和 xterm.js 的 SSH / SFTP 客户端，提供 Electron Desktop 和独立本机 Web 两个入口。SSH 连接始终由用户电脑发起；Web 服务只监听本机回环地址，不提供公开服务、账号或用户隔离。

本项目采用 [MIT License](LICENSE)。

两个入口复用 Host、协议、传输适配和 Cordis Client。Desktop 由 Electron 启动独立 Node Host 子进程；独立 Web 在普通 Node 进程中运行，无需启动 Electron。

## 开始使用

需要 Node.js 24 或更高版本及 npm；Desktop 还需要可用的桌面环境。所有依赖在仓库根通过唯一的锁文件安装：

```powershell
npm ci

# 在本机浏览器中使用：打开控制台打印的带 token 地址
npm run start:web

# 或启动 Electron 桌面客户端
npm run start:desktop
```

启动命令会构建所需共享模块和应用。Web 默认使用随机回环端口，按 Ctrl+C 停止。Desktop 数据默认位于 `~/.ssh-cordis/`，独立 Web 位于 `~/.ssh-cordis/web/`，分别维护主机记录和已信任的 SSH 主机密钥。

Desktop 支持系统加密保存密码或私钥口令、原生私钥文件选择。独立 Web 保存主机信息，密码、口令和浏览器选中的私钥仅用于当前页面，刷新后需要重新输入或选择。详情见 [Desktop 说明](apps/desktop/README.md)与[本机 Web 说明](apps/web/README.md)。

## 验证

```powershell
# 干净构建、类型和依赖边界、Node 与本机协议测试
npm run verify

# Desktop boot / IPC / Web，以及独立 Node Web 的真实浏览器检查
npm run verify:electron
```

测试使用随代码提供的本机 SSH/SFTP 夹具和临时数据目录。第二组需要桌面环境；Electron 无法启动等环境限制不算通过。

## 仓库入口

| 路径 | 内容 |
| --- | --- |
| `apps/desktop/` | Electron 壳、平台适配、启动诊断与测试 |
| `apps/web/` | 独立本机 Node Web 入口与测试 |
| `packages/host/` | Cordis Host、SSH/SFTP、主机存储及凭据接口 |
| `packages/protocol/` | 通信协议与公共数据结构 |
| `packages/transport/` | 请求分派、HTTP/WebSocket 与载体组合 |
| `packages/ui/` | 两个入口共用的终端、文件面板和浏览器传输 |
| [docs/architecture.md](docs/architecture.md) | 当前架构、生命周期与数据边界 |
| [LAYOUT-PROPOSAL.md](LAYOUT-PROPOSAL.md) | 现行目录与共享模块决策 |

项目使用 npm workspaces，共享包通过公开导出引用，根 `package-lock.json` 是唯一安装锁文件。版本和用户可见变化记录在 [CHANGELOG.md](CHANGELOG.md)，`npm run release:check` 会在 CI 中校验版本一致性和发布条目。`npm run dist:desktop -- --win --x64` 生成 Windows 安装包；CI 另提供 macOS/Linux 构建。打包版通过 GitHub Releases 检查更新，下载后由用户确认重启安装。签名、发布及本机验收见[发布说明](docs/desktop-release.md)。

旧历史评审、原始提案和截图研究资料已移除；当前实施记录见[整改方案](docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md)。

</details>

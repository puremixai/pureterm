# PureTerm

基于 Cordis、ssh2 和 xterm.js 的 SSH / SFTP 客户端，提供 Electron Desktop 和独立本机 Web 两个入口。SSH 连接始终由用户电脑发起；Web 服务只监听本机回环地址，不提供公开服务、账号或用户隔离。

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

测试使用随代码提供的本机 SSH/SFTP 夹具和临时数据目录。第二组需要桌面环境；Electron 无法启动等环境限制不算通过。GUI 鼠标键盘驱动工具独立运行，不纳入这两组命令。

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
| [tools/gui/](tools/gui/README.md) | 可选 Windows GUI 调研和验收工具 |
| [Termius 产品设计分析](docs/research/termius/Termius-产品设计分析.html) | 历史研究报告、模板和素材 |

项目使用 npm workspaces，共享包通过公开导出引用，根 `package-lock.json` 是唯一安装锁文件。`npm run dist:desktop -- --win --x64` 生成 Windows 安装包；CI 另提供 macOS/Linux 构建。打包版通过 GitHub Releases 检查更新，下载后由用户确认重启安装。签名、发布及本机验收见[发布说明](docs/desktop-release.md)。

[历史评审](docs/reviews/)与[原提案归档](docs/archive/)保留当时的目录及验证描述，不作为当前命令和测试结果。上一轮目录整改记录见[整改方案](docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md)。

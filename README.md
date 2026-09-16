# PureTerm

基于 Electron、Cordis、ssh2 和 xterm.js 的 SSH / SFTP 桌面客户端。Host 与 Electron 主进程同进程运行；桌面界面使用 IPC，默认同时提供仅监听本机回环地址的 Web 界面。应用依赖、构建和测试都保留在一个 npm 包内。

## 开始使用

需要 Node.js 24 或更高版本、npm，以及运行 Electron 的桌面环境。在仓库根执行：

```powershell
npm --prefix apps/desktop ci
npm --prefix apps/desktop start
```

`npm ci` 按锁文件安装依赖并安装 Electron；启动命令先构建再打开应用。日常数据默认保存在用户主目录的 `.ssh-cordis/`，目录整理不改变数据位置。

## 验证

```powershell
# 类型、依赖边界、干净构建，以及无需 Electron 窗口的全部测试
npm --prefix apps/desktop run verify

# 真实 Electron 启动、IPC 与 Web 载体验证，需要桌面环境
npm --prefix apps/desktop run verify:electron
```

第一组包含本机 SSH / SFTP / HTTP / WebSocket 协议测试；第二组观察真实 renderer-ready 和测试报告。环境导致 Electron 无法启动时，不能计为通过。GUI 鼠标键盘驱动工具独立运行，不纳入这两组命令。具体入口与范围见[应用说明](apps/desktop/README.md)。

## 仓库入口

| 路径 | 内容 |
| --- | --- |
| [apps/desktop/](apps/desktop/) | 单个桌面应用，包括源码、依赖、构建脚本、测试和夹具 |
| [docs/architecture.md](docs/architecture.md) | 当前架构、依赖约束与运行时资源路径 |
| [LAYOUT-PROPOSAL.md](LAYOUT-PROPOSAL.md) | 已采纳的目录决策及对原提案的修正 |
| [docs/reviews/](docs/reviews/) | 有基线的历史评审，文内旧路径按评审时状态理解 |
| [docs/archive/](docs/archive/) | 历史原始提案 |
| [Termius 产品设计分析](docs/research/termius/Termius-产品设计分析.html) | 历史研究报告；模板和素材位于同一目录 |
| [tools/gui/](tools/gui/) | 可选 Windows GUI 调研、截图和人工验收工具 |

本轮整改的实际执行结果记录在[整改方案](docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md)。旧文档中的通过次数不代表当前提交的验证结果。当前尚未提供安装包、自动更新、独立 Host 进程或 npm workspace。

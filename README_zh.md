# PureTerm

[English version](README.md)

基于 Cordis、ssh2 和 xterm.js 的 SSH / SFTP 客户端，提供 Electron Desktop 和独立本机 Web 两个入口。SSH 连接始终由用户电脑发起；Web 服务只监听本机回环地址，不提供公开服务、账号或用户隔离。

本项目采用 [MIT License](LICENSE)。

当前源码版本为 `0.1.0-alpha.1`，基准文件是 [VERSION.txt](VERSION.txt)，版本维护规则见[开发说明](docs/DEVELOPMENT_zh.md)。

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

Desktop 支持系统加密保存密码、私钥口令和导入的 Keychain 密钥，并支持原生私钥文件选择。独立 Web 仅持久化主机信息，凭据和 Keychain 密钥只用于当前客户端会话，刷新后需要重新输入或导入。详情见 [Desktop 说明](apps/desktop/README_zh.md)与[本机 Web 说明](apps/web/README_zh.md)。

## 使用连接工作区

- Hosts 是常驻管理标签。单击已保存主机只会选中卡片，不会切换页面；点击卡片的「编辑」操作才打开编辑面板。双击主机框会打开新的终端标签。同一主机重复连接也会打开独立标签。
- 每个标签独立保留输入、输出、滚动历史、连接状态和 SFTP 目录。切换标签或返回 Hosts 不会断开其他连接。文件面板使用当前 SSH 会话，并在终端下方独立占位。
- 断开连接后保留输出供检查；重新连接在原标签重试。失败页提供日志、重试和编辑主机。关闭标签只释放该会话；握手中关闭的标签会在握手成功返回后立即关闭对应连接。
- 通过「新建主机」创建主机，双击主机卡片建立连接；Ctrl+Tab / Ctrl+Shift+Tab 切换标签，Ctrl/Cmd+W 关闭当前终端标签。聚焦标签按钮后也可使用方向键、Home、End。浏览器可能占用部分快捷键，仍可使用页面上的按钮。

打开的会话与重试凭据只保留在当前客户端，刷新后不会恢复。SFTP 目前支持目录浏览、上传/下载（单文件最多 4 MiB）、新建文件夹及确认后删除。串口、端口转发、SSH 证书认证、Windows Hello、FIDO2 和命令片段管理尚未实现，不作为可用控件显示。

## 使用 Keychain

- 打开 **Keychain → 新建密钥**，填写名称，然后粘贴、选择或拖入私钥文件（OpenSSH、PEM 或支持的 PPK，最大 256 KiB）。加密私钥需填写口令后保存。SSH 解析器验证密钥，自动生成类型、公钥和 SHA-256 指纹；如果额外提供公钥，则必须与私钥匹配。
- 单击卡片选中，点击**编辑**修改名称或替换密钥。已保存的私钥及口令不会回传编辑器；只修改名称时将私钥留空。支持按名称、类型或指纹搜索、卡片/列表视图切换，以及复制已保存的公钥。
- 在主机的 **Private key** 认证设置中选择 Keychain 条目，保存主机后即可在独立终端标签中连接；Host 内部通过密钥 ID 读取凭据。仍可直接选择本地私钥文件。
- Desktop 使用独立的 `keychain.json` 原子写入系统加密密钥库，不保存私钥明文；加密不可用时保存失败。Web 导入的密钥及主机关联仅保留在该客户端的 Host 内存中，断开或刷新后清除。被已保存主机使用的密钥不可删除，须先更改主机认证设置或移除主机。删除需要确认且无法撤销。

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
| [VERSION.txt](VERSION.txt) | 所有 workspace 和发布 tag 使用的源码版本基准 |
| [docs/architecture_zh.md](docs/architecture_zh.md) | 当前架构、生命周期与数据边界 |
| [docs/DEVELOPMENT_zh.md](docs/DEVELOPMENT_zh.md) | 本机开发、验证和协作流程 |
| [LAYOUT-PROPOSAL_zh.md](LAYOUT-PROPOSAL_zh.md) | 现行目录与共享模块决策 |

项目使用 npm workspaces，共享包通过公开导出引用，根 `package-lock.json` 是唯一安装锁文件。版本和用户可见变化记录在 [CHANGELOG_zh.md](CHANGELOG_zh.md)，`npm run release:check` 会在 CI 中校验版本一致性和发布条目。`npm run dist:desktop -- --win --x64` 生成 Windows 安装包；CI 另提供 macOS/Linux 构建。打包版通过 GitHub Releases 检查更新，下载后由用户确认重启安装。签名、发布及本机验收见[发布说明](docs/desktop-release_zh.md)。

仓库文档默认使用英文。中文翻译作为同目录的 `*_zh.md` 文件维护，包括 [README_zh.md](README_zh.md)。

旧历史评审、原始提案和截图研究资料已移除；当前实施记录见[整改方案](docs/superpowers/plans/2026-09-16-desktop-layout-remediation_zh.md)。

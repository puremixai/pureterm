# PureTerm

[English version](README.md)

基于 Cordis、ssh2 和 xterm.js 的 SSH / SFTP 客户端，提供 Electron Desktop 和独立本机 Web 两个入口。SSH 连接始终由用户电脑发起；Web 服务只监听本机回环地址，不提供公开服务、账号或用户隔离。

本项目采用 [MIT License](LICENSE)。

当前源码版本为 `0.1.0-alpha.1`，基准文件是 [VERSION.txt](VERSION.txt)，版本维护规则见[开发说明](docs/DEVELOPMENT_zh.md)。

两个入口复用 Host、协议、共享 Web Host 装配和 Cordis Client。Desktop 由 Electron 启动独立 Node 模式 Web Host 子进程；其 `pureterm-app://app/` 窗口通过本机 WebSocket 发送 SSH/SFTP、主机和 Keychain 请求。独立 Web 在普通 Node 进程中运行相同装配，无需启动 Electron。

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

### 选择使用方式

| 客户端 | 打开方式 | Host 与凭据策略 |
| --- | --- | --- |
| Desktop 窗口 | `npm run start:desktop` | Electron 启动 Web Host 子进程；凭据和 Keychain 密钥可使用系统加密存储，支持原生私钥选择 |
| Desktop 附带浏览器 | 启动 Desktop 后，打开启动日志中的带 token 地址 | 共用 Desktop 的 Web Host、已保存主机、加密凭据及原生私钥选择；各客户端拥有独立的 SSH 会话 |
| 独立 Web | `npm run start:web`，然后打开打印的地址 | 使用独立 Node Web Host 和单独数据目录；凭据及 Keychain 密钥仅保留在当前客户端会话，刷新后需重新提供 |

Desktop 默认启用附带浏览器入口。设置 `SSH_CORDIS_NO_WEB_CARRIER=1` 可关闭该入口，Desktop 窗口及其内部 Web Host 仍正常工作；此设置不关闭独立 Web 启动命令。独立运行的 Desktop 和 Web 进程应使用不同的数据目录。详情见 [Desktop 说明](apps/desktop/README_zh.md)与[本机 Web 说明](apps/web/README_zh.md)。

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

## 架构与上游参考

Desktop 架构参考 [deepseek-harness 在 `00102833` 提交中的桌面实现](https://github.com/deepseek-ai/deepseek-harness/tree/00102833dfaee1da9f48a3a8eae9d34005a75218/apps/desktop)，参考副本于 2026-09-23 同步。PureTerm 将其共享 Web Host 与 Electron 壳模式用于 SSH/SFTP 客户端。

- `@pureterm/transport/web-host` 为两个入口统一装配 Cordis Host、dispatcher 和回环 HTTP/WebSocket 载体。
- Electron 在 Node 模式子进程启动期间，通过 `pureterm-app://app/` 提供共享界面。最小 `window.puretermDesktop` 桥在 Host 就绪后提供 WebSocket 地址，并接收渲染层就绪上报。SSH/SFTP、主机和 Keychain 操作统一走 WebSocket。
- Electron 主进程负责窗口、系统加密、原生选钥和子进程生命周期。它向所属窗口的 WebSocket 请求注入 Desktop 认证 token，不向页面暴露该 token。父子私有 RPC 负责平台能力及启动、关停协调。

内部集成需注意：旧 `window.sshAPI` 和 SSH 业务 IPC 已移除，既有 SSH 数据目录保持不变。进程边界与生命周期见[架构说明](docs/architecture_zh.md)，迁移说明见[变更日志](CHANGELOG_zh.md)。

## 验证

```powershell
# 干净构建、类型和依赖边界、Node 与本机协议测试
npm run verify

# Desktop boot / 自定义 scheme WebSocket / 附带 Web，以及独立 Node Web 的真实浏览器检查
npm run verify:electron
```

测试使用随代码提供的本机 SSH/SFTP 夹具和临时数据目录。第二组需要桌面环境；Electron 无法启动等环境限制不算通过。

## 仓库入口

| 路径 | 内容 |
| --- | --- |
| `apps/desktop/` | Electron 壳、Node 模式 Web Host 子进程入口、平台适配、启动诊断与测试 |
| `apps/web/` | 独立本机 Node Web 入口与测试 |
| `packages/host/` | Cordis Host、SSH/SFTP、主机存储及凭据接口 |
| `packages/protocol/` | 通信协议与公共数据结构 |
| `packages/transport/` | 共享 Web Host 装配、请求分派和 HTTP/WebSocket 载体 |
| `packages/ui/` | 两个入口共用的终端、文件面板和浏览器传输 |
| [VERSION.txt](VERSION.txt) | 所有 workspace 和发布 tag 使用的源码版本基准 |
| [docs/architecture_zh.md](docs/architecture_zh.md) | 当前架构、生命周期与数据边界 |
| [docs/DEVELOPMENT_zh.md](docs/DEVELOPMENT_zh.md) | 本机开发、验证和协作流程 |
| [LAYOUT-PROPOSAL_zh.md](LAYOUT-PROPOSAL_zh.md) | 现行目录与共享模块决策 |

项目使用 npm workspaces，共享包通过公开导出引用，根 `package-lock.json` 是唯一安装锁文件。版本和用户可见变化记录在 [CHANGELOG_zh.md](CHANGELOG_zh.md)，`npm run release:check` 会在 CI 中校验版本一致性和发布条目。`npm run dist:desktop -- --win --x64` 生成 Windows 安装包；CI 另提供 macOS/Linux 构建。打包版通过 GitHub Releases 检查更新，下载后由用户确认重启安装。签名、发布及本机验收见[发布说明](docs/desktop-release_zh.md)。

仓库文档默认使用英文。中文翻译作为同目录的 `*_zh.md` 文件维护，包括 [README_zh.md](README_zh.md)。

旧历史评审、原始提案和截图研究资料已移除；当前行为见[架构说明](docs/architecture_zh.md)，`docs/superpowers/` 下带日期的方案保留历史决策。

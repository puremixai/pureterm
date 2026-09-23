# PureTerm

[English version](CHANGELOG.md)

PureTerm 的所有重要变更都记录在这里。本文件遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 并使用 [语义化版本](https://semver.org/)。

`[Unreleased]` 区段用于记录已经合并但尚未发布的变更。创建版本 tag 前，将这些条目移到带日期的版本区段。发布工作流要求对应版本区段存在，否则拒绝该 tag。

## [Unreleased]

### Added

- 增加完整 Keychain 密钥库：支持导入、粘贴、拖放、私钥及口令校验、生成公钥与指纹、搜索、卡片/列表切换、安全编辑和删除保护。主机可选择已保存密钥并在独立终端标签中认证连接；Desktop 使用原子写入的系统加密密钥库，Web 密钥及主机关联按客户端隔离且不落盘。

### Changed

- **0.x 内部集成破坏性变更：**移除 Desktop 的 `window.sshAPI` 和 SSH 业务 IPC，以最小的 `window.puretermDesktop` 负责启动信息/就绪，并通过子进程拥有的共享回环 Web Host 处理 SSH/SFTP、主机和 Keychain。Electron 窗口从 `pureterm-app://app/` 加载；既有 SSH 数据和面向用户的操作仍可使用。独立 Web 保持独立，`SSH_CORDIS_NO_WEB_CARRIER=1` 仅关闭附带浏览器访问。
- 以紧凑的 PureTerm 顶栏替代原生标题栏，通过集成式系统控件保留窗口操作；Windows/Linux 菜单栏自动隐藏，同时保留其快捷键能力。
- 将创建主机收敛为唯一的「新建主机」操作，移除顶部栏、导航、搜索、Terminal 与 Ctrl/Cmd+T 的重复入口。
- 明确主机卡片操作：单击只选中，点击「编辑」打开主机抽屉，双击打开新的终端标签。
- 每次 SSH 连接在 Hosts 旁打开独立终端标签，隔离输出、断开/关闭/重试及 SFTP 状态；正确处理并发握手、已关闭标签的迟到结果，以及 WebSocket 失联时全部会话的收尾。
- 支持编辑主机名称、卡片/列表切换和快捷键帮助，移除未实现的占位操作；文件面板在终端下方独立占位，不遮挡提示符。
- 将共享 PureTerm 工作台重构为成熟的深色 Hosts 面板：加入参考 Termius 的导航栏与工具栏、可搜索的主机卡片和聚焦式连接工作区，同时保留主机列表、SFTP 面板的响应式表现与键盘焦点状态。
- 将维护中的 Markdown 文档统一为英文优先，同时保留完整中文翻译。
- 增加英文优先的开发说明及对应中文翻译。
- 增加 `VERSION.txt` 作为源码基准，并生成界面版本和变更日志元数据。
- 界面改用 Inter 渲染，字体随包本地分发，页面不再发起任何远程字体请求；等宽文字统一由一套字体栈解析，取代此前多处手工拷贝的副本。文字字重限制在 400/500/600/700：越界的 650/750/800 无法由中文与系统回退字面渲染，它们只会以合成粗体回应 13px 文字。
- 终端改用中性 ANSI 色板，画布比此前更暗。终端里的黑字不再与背景色完全相同，弱化提示符颜色现在相对画布达到 3:1。
- 界面全部颜色改由 token 解析。新体系位于 `packages/ui/src/styles/tokens.css`，它将要取代的改版前取值集中保存在一份受守卫的登记簿 `packages/ui/src/styles/legacy.css` 里；除这两个文件外，任何分片都不得书写颜色。配色本身尚未改变：屏幕上渲染的仍是改版前的取值，它们将由外壳重建逐步替换。
- 在 `0.1.0-alpha.1` 之后合并的工作中持续更新此区段。

### Security

- 为 Desktop 窗口的准确 WebSocket 请求使用由主进程持有的独立 bearer token；不把它写入页面 URL、DOM、浏览器 cookie 或存储。

## [0.1.0-alpha.1] - 2026-09-16

### Added

- 提供使用独立 Node Host 子进程处理 SSH、SFTP、存储和 Cordis 服务的 Electron Desktop。
- Desktop IPC 与本机 Web 入口共用 Cordis Client 生命周期，包括作用域清理和浏览器缓存恢复。
- 提供 Windows NSIS、macOS DMG/ZIP 和 Linux AppImage 的 CI 构建产物。
- 通过 GitHub Releases 检查更新，并由用户确认重启安装。
- 提供仅限本机访问的 Web，浏览器凭据只在当前会话使用，不提供用户或租户隔离。

### Security

- Desktop 凭据继续由操作系统凭据存储保护，Host 进程通过私有 IPC 能力访问它们。
- 发布构建排除可选的原生 SSH 加速模块，不包含 GitHub 凭据。

[Unreleased]: https://github.com/puremixai/pureterm/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/puremixai/pureterm/releases/tag/v0.1.0-alpha.1

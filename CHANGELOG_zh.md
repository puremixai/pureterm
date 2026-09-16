# PureTerm

[English version](CHANGELOG.md)

PureTerm 的所有重要变更都记录在这里。本文件遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 并使用 [语义化版本](https://semver.org/)。

`[Unreleased]` 区段用于记录已经合并但尚未发布的变更。创建版本 tag 前，将这些条目移到带日期的版本区段。发布工作流要求对应版本区段存在，否则拒绝该 tag。

## [Unreleased]

### Changed

- 将维护中的 Markdown 文档统一为英文优先，同时保留完整中文翻译。
- 增加英文优先的开发说明及对应中文翻译。
- 增加 `VERSION.txt` 作为源码基准，并生成界面版本和变更日志元数据。
- 在 `0.1.0-alpha.1` 之后合并的工作中持续更新此区段。

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

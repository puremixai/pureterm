# Desktop 运行时实施与验收记录

日期：2026-09-16。实现分支：`feat/desktop-runtime`，基于 `692d2fa` 的共享 Host/本机 Web 基线。

## 已实现

- Desktop 主进程保留窗口、载体、safeStorage、原生选钥与更新器；独立 Node Host 子进程拥有 Cordis Host、dispatcher、SSH/SFTP 和数据存储。使用私有带版本 IPC，支持反向平台调用、字节传递、客户端释放、启动失败回收与有界退出。
- 异步凭据保存串行化；加密失败不提交新状态；解密等待可以在客户端断开或退出时取消。独立 Web 仍不持久化密码、口令或浏览器私钥。
- 共享 Client 是 Cordis 应用，transport、terminal、hosts、SFTP、readiness 有明确依赖与资源清理。支持依赖替换、同页面重挂和 BFCache 恢复；防止迟到列表覆盖当前表单、连接中修改凭据污染自动保存、旧 WebSocket 回调污染新连接。
- electron-builder 26.15.3 / electron-updater 6.8.9；物理 staging、Windows NSIS、macOS DMG+ZIP、Linux AppImage；GitHub Releases 更新、手动检查、安装前关停 Host、异步安装失败后恢复当前版本。
- CI 为三平台构建及验证，Windows 额外执行安装与卸载验收；只有版本 tag 汇总到 draft Release。未执行线上发布。

## 本机验证

环境：Windows x64，Node 24.18.0，Electron 44.3.0，Cordis 4.0.0-rc.10。

| 检查 | 结果 |
| --- | --- |
| `npm run verify` | 构建、类型、依赖与 ESM 边界通过；143 项 Node 测试通过 |
| Desktop `verify:electron:built` | boot、IPC SSH、Desktop Web、渲染进程崩溃回收、真实更新器本机 feed，5 组通过 |
| `node apps/web/tests/smoke-browser.mjs` | 独立 Node Web、真实 SSH、浏览器选钥认证与刷新清理通过 |
| `node packages/ui/tests/smoke-client-lifecycle.mjs` | 13 项真实 Chromium 生命周期与异步竞态检查通过 |
| `stage-desktop` + builder `--publish never --win --x64` | NSIS、blockmap、latest.yml 生成成功 |
| `npm run verify:package:windows` | 仓库外临时目录真实安装、运行、卸载通过 |
| Release metadata | 安装包大小与 SHA-512 匹配 latest.yml |
| `git diff --check`、workflow YAML | 通过 |

最终 Electron 验证使用 `npm run verify` 生成的同一份产物，执行根 `verify:electron` 所列的全部 7 组检查，没有跳过应用检查。安装包也从这份最终构建生成。

子进程测试覆盖独立 PID、真实 SSH UTF-8/PTY/resize 与 SFTP 二进制、系统能力反向调用、异步保存后重启解密、客户端消失、子进程崩溃、启动超时/可执行文件不存在、父进程被强制终止后无孤儿连接。真实 Electron 渲染进程崩溃测试也确认 SSH 与 Host 退出。

更新 feed 检查使用真实 NsisUpdater 与 Electron 网络下载器，正确 SHA-512 触发下载完成，错误 SHA-512 返回 `ERR_CHECKSUM_MISMATCH`。fixture 仅在本机，不执行安装器；状态机测试覆盖检查单飞、确认安装、关停顺序、取消下载和异步安装失败恢复。

Windows 安装验收先检查现有安装登记，安装到系统临时目录 `pureterm-installed-smoke-*`，运行 cwd 与数据目录也位于仓库外，清除 NODE_PATH。通过真实 safeStorage 保存凭据，再经子进程解密建立 SSH，并完成全部 256 个字节值的 SFTP 往返。退出后 Host PID 消失、SSH 连接归零；随后显式运行该测试安装的卸载器，确认可执行文件和登记删除，再清理临时目录。

## 本机产物

- `release/PureTerm-0.1.0-win-x64.exe`：112177850 字节。
- SHA-256：`0f7b53f5875a83d0b23532830626b5205a48c5f32cc20b7262c943301476d936`。
- 同目录包含 `.exe.blockmap`、`latest.yml` 和 `win-unpacked/`。这些是本地构建产物，不进入 Git。

## 未在本机验证的发布条件

本机验收包的 Authenticode 状态为 `NotSigned`。macOS/Linux 已提供 CI 配置，但本轮未运行对应平台构建、签名、notarization 或真实安装升级。正式 tag 流程要求 Windows/macOS 签名 secrets；真实发布版本之间的更新安装仍应按[发布说明](../desktop-release.md)验收。本轮没有创建 tag、公开 Release 或上传二进制。

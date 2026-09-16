# Desktop 运行时与发布

> **已落地的历史规格（2026-09-16）**：本文记录 Desktop runtime、安装与更新的实施边界。实现已合并到 `main`；当前架构和发布操作以 [架构说明](../../architecture.md) 与 [发布说明](../../desktop-release.md) 为准。

原授权中当时尚未完成的四项是：Desktop Host 独立进程、Client Cordis 插件树、安装包、自动更新。渠道已确认采用 GitHub Releases，本机验收 Windows，macOS/Linux 提供 CI。

## 边界

- Electron 主进程拥有窗口、IPC/本机 HTTP 载体、原生文件选择、safeStorage、更新器和子进程生命周期。Node Host 子进程拥有共享 Host、SSH/SFTP、主机记录和 dispatcher。只通过私有、有版本的父子 IPC 交换请求、字节事件、客户端离开通知及有限的平台能力。
- 主进程先启动 Host、装好载体，再挂载窗口。退出、启动失败、更新安装和父进程断开都清理 Host；关停有超时与强制终止兜底。Host 意外退出拒绝所有挂起请求并通知用户。
- safeStorage 留在 Electron，Host 凭据提供者支持异步；保存串行化。独立 Web 继续仅保存主机信息，密码和浏览器私钥只在会话内使用。
- Client 是真实 Cordis Context：transport、terminal、hosts、SFTP、readiness 显式依赖。DOM、事件订阅、socket、xterm、observer 和定时器由插件 scope 释放，支持卸载后重新挂载。

## 发布与更新

- 使用 electron-builder 26.15.3 与 electron-updater 6.8.9。独立 staging 包含物理生产依赖和所有子进程/renderer/preload 资源，不依赖仓库 cwd 或 workspace 链接。第一版关闭 asar，省去独立 Node 入口的虚拟文件系统依赖。
- Windows x64 NSIS；macOS x64/arm64 dmg + zip；Linux x64 AppImage。本地与普通 CI 默认不发布，版本 tag 的专用发布 job 汇总为 GitHub draft Release。
- 打包版后台检查更新；提供手动检查。下载完成由用户确认重启安装，先停止 Host 再交给 updater。网络错误不阻塞启动，开发版和不支持更新的运行方式明确提示不可用。
- 本次实现和测试发布机制，不创建线上版本。签名和 notarization 由 CI secrets 配置；无证书的本机安装验收不等于已验证正式签名分发。

## 验收

验证异步凭据、进程 ready/失败/父子断开/退出超时、真实 SSH/SFTP 字节、Client scope 卸载重挂、更新状态/单飞/清理/安装顺序。运行项目 build、typecheck、边界检查、Node 与 Electron 验收；生成 Windows NSIS，并从隔离安装目录运行应用。macOS/Linux 的实际平台结果由 CI 提供。

上游基线：deepseek-harness `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`；对照其 Desktop host-process、desktop-host 入口、Client boot 以及 update-coordinator。保留 PureTerm 现有本机 Web 和单用户范围，不引入 Agent、多租户或对外服务。

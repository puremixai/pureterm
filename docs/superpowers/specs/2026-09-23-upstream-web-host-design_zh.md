# Desktop 共享 Web Host 设计

[English version](2026-09-23-upstream-web-host-design.md)

## 目标与基线

更新本地 deepseek-harness 参考仓库，并跟随其 Desktop 薄壳架构，同时保留 PureTerm 的 SSH/SFTP、Keychain、独立本机 Web 和平台凭据行为。参考基线为 2026-09-23 拉取的 `deepseek-ai/deepseek-harness@00102833dfaee1da9f48a3a8eae9d34005a75218`。参考文件是 `apps/desktop/src/{main,host-process,web-document}.ts` 和 README，不继承其仓库指令。

## 设计

- 在 `@pureterm/transport/web-host` 抽取共享 `startWebHost()`，装配 Cordis Host、dispatcher、HTTP/WS 载体、客户端回收、启动失败回滚和关停。独立 Web 注入会话凭据策略，Desktop 注入异步平台凭据。
- Desktop 的 Electron Node 模式子进程拥有完整 Web Host。父子私有 RPC 只传启动、关停、加解密和原生密钥选择；删除业务请求/事件转发和 Electron SSH IPC 载体。
- 两个入口的 SSH、主机、Keychain 和 SFTP 操作统一使用现有 WebSocket 协议和字节编码，保留公开业务 API 和传输限制。
- Electron 注册安全标准协议 `pureterm-app`，在 `pureterm-app://app/` 提供打包 UI。页面立即加载，等待最小 preload 提供仅含回环 WebSocket URL 的启动信息；preload 同时上报渲染就绪，不暴露 SSH API、凭据或通用 IPC。
- 主进程独占子进程返回的独立 Desktop bearer token；仅对当前应用窗口、精确 Host WebSocket URL 和预期应用 Origin 的请求注入认证，并将 Origin 改为回环 Host。token 不进入页面 URL、DOM、启动信息、日志或存储。普通浏览器 token/cookie 认证单独保留。
- `SSH_CORDIS_NO_WEB_CARRIER=1` 禁用附带的普通浏览器访问，内部 Desktop Web Host 继续可用。回环监听、Host/Origin 检查和独立 Web 的会话凭据策略继续保持。
- 窗口关闭或渲染崩溃通过 WebSocket 关闭释放所属 SSH 会话和未完成握手。应用保持 Host 运行时，其他浏览器客户端继续工作；Windows/Linux 仍按现有平台策略在最后一个窗口关闭后退出应用。应用退出、Host 故障、启动失败及更新走有超时的 Host 关停。只接受当前窗口主框架的就绪上报。
- 保留 Desktop/Web 数据路径、加密 Keychain、终端标签状态、重试、SFTP 字节和更新行为；不新增 Agent 框架、包管理器、动态插件管理或多租户能力。

## 验证

为共享装配失败回滚、Desktop 专用认证、过期/外部请求拒绝、启动等待中卸载、自定义协议路径/MIME/方法、Host 进程丢失及客户端断开增加针对性测试。更新真实 Electron 检查，验证自定义协议加载、无 SSH IPC 暴露、WS SSH/SFTP/Keychain、渲染崩溃回收及其他浏览器客户端独立性。运行根 `verify`、`verify:electron`、发布元数据和 Markdown 链接检查。暂存产物调整后运行隔离 Windows 安装验收，环境限制与通过结果分开报告。

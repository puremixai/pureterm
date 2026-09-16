# Desktop 运行时实施计划

1. 将 CredentialProvider 和保存流程改为异步，验证并发/失败原子性和 session-only Web 政策。
2. 实现父子 RPC、Node Host 入口与进程控制器；接入 Desktop 启动、客户端释放、失败与退出路径；使用真实子进程验证 SSH/SFTP 和生命周期。
3. 将共享 UI 组合为 Cordis transport/terminal/hosts/SFTP/readiness 插件，补齐 transport unsubscribe/dispose，测试重挂载与依赖释放。
4. 实现更新协调器和菜单入口，测试重复检查、下载错误、手动提示、安装前 Host 关停与清理。
5. 添加物理 staging、electron-builder、跨平台 CI 与 draft Release 流程；本机生成 NSIS，隔离安装启动验收。
6. 更新架构/使用/发布文档，运行完整验证并审查整合差异。记录签名与其他平台尚未在本机验证的边界。

并行分工：Host 凭据、共享 UI、打包/CI 分别独立修改；主任务负责进程边界、更新、程序集成、依赖锁和最终验证。

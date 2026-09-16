# Desktop 与本机 Web 目录决策

[English version](LAYOUT-PROPOSAL.md)

状态：已采纳。目标是让 Electron Desktop 与独立本机 Web 复用业务和界面，两个入口都只从用户电脑发起 SSH。独立 Web 仅监听 `127.0.0.1`，不做远程部署、用户账号或租户隔离。

本决策替代上一轮“单个应用 npm 包”的限制。Electron 分层继续保留，Desktop Host 已拆为独立 Node 子进程，共享 UI 已成为 Cordis Client 应用。

## 目录与安装边界

```text
pureterm/
  package.json / package-lock.json / tsconfig.base.json
  scripts/                         workspace 构建、类型与边界检查
  apps/
    desktop/
      package.json / tsconfig*.json
      electron/
        app/                       main、shell、平台 API
        runtime/                   启动策略、就绪、档案、重启、资源路径
        host/                      独立 Node Host 入口（无 Electron API）
        carriers/                  IPC 与 preload
        diagnostics/               应用内 boot / smoke 钩子
      scripts/                     Electron 启动、构建与诊断工具
      tests/                       Desktop 和协议测试、SSH/SFTP 夹具
    web/
      package.json / tsconfig.json
      src/                         普通 Node 入口、Host 与 HTTP/WS 装配
      tests/                       生命周期、协议及真实浏览器测试
  packages/
    host/src/                      Host 公共接口、services、plugins、凭据策略
    protocol/src/                  通道、数据、事件与二进制线格式
    transport/src/                 dispatcher、HTTP/WS、载体与就绪报文校验
    ui/src/                        页面、xterm、文件面板、客户端传输
  docs/
    architecture.md / DEVELOPMENT.md / desktop-release.md
    superpowers/plans/ / specs/   带日期的历史记录
```

在仓库根运行 `npm ci`，使用根目录唯一锁文件和 workspace 依赖关系。各应用与共享包保留自己的 manifest 和 TypeScript 配置；不在应用目录维护第二份锁文件或独立安装流程。共享包为私有包，不代表已实现多包发布。

`host/src/services/` 与 `host/src/plugins/` 保留原业务分类。这些名称不严格对应 Cordis 类别，模块拆分以职责和使用者为依据。

## 运行边界

| 共享模块 | 运行入口负责的适配 |
| --- | --- |
| Host、SSH/SFTP、主机和指纹记录 | 数据目录、凭据持久化策略、启动与退出 |
| 协议与 dispatcher | 客户端身份、生命周期、入口能力说明 |
| HTTP/WebSocket | 本机端口、静态资源路径、客户端断开回调 |
| 终端与文件面板 | Desktop 原生选钥 / Web 浏览器选钥、可否记住凭据 |

Desktop 主进程提供 IPC 和原有本机 Web carrier，通过私有父子 IPC 共享独立 Node Host。主进程保留 safeStorage 和原生选钥，子进程通过异步能力调用使用它们。独立 Web 自己创建一个 Host，默认使用另一份数据文件。共享代码不意味着两个应用自动共享会话或凭据。

独立 Web 不读写凭据文件、不保存私钥路径。发现指定目录已有 `secrets.json` 或主机记录含旧密文时，启动会拒绝使用该目录，避免覆盖 Desktop 数据。默认目录分别是 `~/.ssh-cordis/` 和 `~/.ssh-cordis/web/`；自定义时仍应保持数据文件分离。

## 可执行约束

- `@pureterm/protocol` 不导入其他模块。
- `@pureterm/host` 不依赖 Electron、界面或应用入口。
- `@pureterm/ui` 只依赖协议及浏览器库，不导入 Node、Electron 或 Host。
- `@pureterm/transport` 通过公共 Host 接口分派请求，不读取 `Host.internals`。
- 跨包引用必须经过允许的公开导出，不通过相对路径访问另一包源码。
- Electron API 限于 Desktop app、IPC、preload 与诊断适配；runtime 为平台策略和普通 Node 进程控制，不导入 Electron；host 入口同样不导入 Electron。

根 `scripts/check-boundaries.mjs` 使用 TypeScript AST 检查，并接入 `typecheck`。这些约束保护源码依赖方向，不是运行时隔离机制。

## 构建与验收

根构建脚本按协议、Host、传输、界面、应用的顺序构建，清理相应项目的 `dist/`。`build:web`、`build:desktop` 只构建所需入口和共享模块；`build` 构建全部。

| 资源 | 产物 |
| --- | --- |
| Electron 入口 | `apps/desktop/dist/electron/app/main.js` |
| Desktop Node Host | `apps/desktop/dist/electron/host/entry.js` |
| preload | `apps/desktop/dist/electron/carriers/preload.cjs` |
| 独立 Web 入口 | `apps/web/dist/main.js` |
| 共享页面 | `packages/ui/dist/index.html`、`app.js`、`app.css` |
| 共享 Node 模块 | 对应 `packages/*/dist/` |

运行入口通过包导出定位共享页面，Desktop 按编译模块定位自己的 preload 和 Node Host，不依赖当前工作目录。`npm run verify` 覆盖构建、类型、边界及 Node/协议测试；`npm run verify:electron` 验证 Desktop、独立 Web、更新下载与 Client 插件生命周期。安装包验收另见 `npm run verify:package:windows`。测试代码随仓库保存，不继承历史文档的通过次数。

## 上游参考与范围

上游依据固定为 deepseek-harness 提交 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`。PureTerm 已实现独立 Node Host、Client Cordis 插件树与安装更新机制。按本项目范围采用静态插件组合、私有 Node IPC、GitHub Releases 渠道，不引入上游 Agent、动态 npm 插件管理或多租户。具体发布和签名条件见[发布说明](docs/desktop-release_zh.md)。

上游实际按 `packages/<group>/<package>` 组织，SSH 包位于 `packages/ssh/{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}`；不能从 Service 导出形式推导本项目的 services/plugins 目录规则。上游 Web Client 本身是 Cordis 应用，“不另造 IPC 插件系统”不代表前端没有插件树。

原始提案、历史评审和截图研究资料已从当前仓库移除；当前实现说明见[架构](docs/architecture_zh.md)。

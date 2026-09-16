# PureTerm Desktop

Electron + Cordis + ssh2 + xterm.js 的 SSH / SFTP 客户端。应用支持密码或私钥认证、保存主机、终端交互和基本远端文件操作。Host 在 Electron 主进程内运行，默认提供桌面 IPC 和本机 Web 两种入口。

[仓库入口](../../README.md) · [架构](../../docs/architecture.md) · [目录决策](../../LAYOUT-PROPOSAL.md)

## 安装与启动

需要 Node.js 24 或更高版本、npm 和可运行 Electron 的桌面环境。仓库根执行：

```powershell
npm --prefix apps/desktop ci
npm --prefix apps/desktop start
```

在本目录执行时可直接使用 `npm ci`、`npm start`。`npm ci` 安装锁文件指定的依赖及 Electron；`start` 先进行干净构建，再打开应用。需要脱离终端运行时使用 `npm run launch`，日志写入应用的 `dist/launch.log`。

打开应用后填写主机、端口和用户名，选择密码或私钥认证，再连接。私钥只保存路径，连接时读取文件；口令留空表示不使用私钥口令。勾选记住凭据时，通过系统加密能力保存密文；切换认证方式会清理旧凭据。

连接后可打开“文件”面板，浏览目录、上传下载文件、新建目录或删除文件。SFTP 单文件上限为 4 MiB；当前没有续传、进度条或重命名功能。删除直接作用于远端，不进入应用回收站。

## 数据与本机 Web 入口

默认数据目录是用户主目录的 `.ssh-cordis/`，环境变量 `SSH_CORDIS_DATA_DIR` 可指定其他目录。

| 文件 | 内容 |
| --- | --- |
| `hosts.json` | 主机元数据、认证方式及私钥文件路径 |
| `secrets.json` | 系统加密能力生成的凭据密文，与主机元数据分开存储 |
| `known_hosts.json` | 首次信任记录的主机密钥指纹；密钥改变时拒绝连接 |
| `launch-profile.json` | renderer 就绪后提交的启动配置；无效档案会被忽略 |

默认 Web carrier 只监听 `127.0.0.1`，启动日志提供带 token 的本机地址；token 每次启动重新生成。浏览器与桌面共享主机和凭据，文件选择仍由运行后端的机器处理。

常用环境设置：

| 环境变量 | 值为 `1` 时的作用 |
| --- | --- |
| `SSH_CORDIS_NO_WEB_CARRIER` | 关闭本次 Web 入口 |
| `SSH_CORDIS_NO_LAUNCH_PROFILE` | 不读取或写入启动档案 |
| `SSH_CORDIS_NO_SANDBOX_FALLBACK` | 禁止自动无沙箱回退及对应档案回填 |

应用保留既有的启动回退行为；档案不区分容器、CI 与日常桌面环境。测试使用临时数据目录。日常档案若记录了不希望复用的启动设置，可通过上述环境变量禁用档案或回退策略。

## 代码与构建

| 路径 | 内容 |
| --- | --- |
| `src/host.ts` | Cordis 装配和 Host 公共接口 |
| `src/services/`、`src/plugins/` | SSH、存储、终端/SFTP 桥和日志 |
| `shared/` | 两侧共用协议 |
| `renderer/` | 页面、终端、SFTP 交互与传输适配 |
| `electron/app/` | main、shell、platform 等 Electron 适配 |
| `electron/runtime/` | 平台策略、就绪、档案、重启与资源路径 |
| `electron/bridge/`、`electron/carriers/` | Host 调用映射、IPC、HTTP/WS 与 preload |
| `electron/diagnostics/` | 应用进程中的 boot/smoke 钩子 |
| `scripts/`、`tests/` | 构建启动脚本、依赖边界检查、测试与夹具 |

`npm run build` 清理本应用 `dist/`，随后生成 `dist/electron/app/main.js`、`dist/electron/carriers/preload.cjs` 和 `dist/renderer/{index.html,app.js,app.css}`。运行时按模块位置解析资源，因此从仓库根或其他 cwd 启动使用相同产物。

`npm run typecheck` 包含 Node/Electron 与浏览器类型检查、ESM 扩展名检查和 `check:boundaries`。业务不依赖 Electron；renderer 不导入 Node 或 Host 实现；壳访问业务只经过 `src/host.ts`。完整边界规则见[架构文档](../../docs/architecture.md)。

## 验证入口

在仓库根执行完整验证：

```powershell
npm --prefix apps/desktop run verify
npm --prefix apps/desktop run verify:electron
```

两组命令的范围如下。表中的子命令在应用目录使用 `npm run <命令>`，从仓库根加 `--prefix apps/desktop`。

| 命令 | 范围 |
| --- | --- |
| `verify` | 类型与依赖约束、干净构建、全部无需 Electron 窗口的测试 |
| `test:unit` | 依赖边界规则、运行时资源/产物检查，以及 boot 失败判定与超时回收回归 |
| `smoke:node` | 使用已构建产物运行以下六组无需 Electron 窗口的 smoke |
| `smoke:desktop` | 平台决策、就绪与重启逻辑 |
| `smoke:host` | 本机 SSH 协议下的 Host、终端、凭据与资源卸载 |
| `smoke:sftp` | 本机 SFTP 路径及文件操作往返 |
| `smoke:carrier` | HTTP/WebSocket 访问控制、请求映射与二进制往返 |
| `smoke:profile` | 临时目录中的启动档案持久化、无效数据处理和就绪门控；不启动两次真实应用 |
| `smoke:runner` | Electron runner 的成功、失败与环境限制判定 |
| `verify:electron` | 真实 Electron boot、IPC 与 Web 冒烟 |
| `boot` | 启动真实应用并等待 renderer-ready / boot 成功信号 |
| `smoke:electron` | 真实 Electron preload、IPC 和终端字节流 |
| `smoke:web` | 真实应用中的 Web 载体及 renderer-ready |
| `smoke` | 构建后运行 Node、IPC 与 Web smoke，不包含 boot |
| `diagnose:electron` | 用最小 Electron 页面排查本机 Chromium 渲染环境 |

单独运行 `test:unit` 或 `smoke:node` 前先执行 `npm run build`，保证测试读取的是当前产物；完整 `verify` 已包含这一步。

`verify` 使用随代码保存的本机夹具、随机回环端口和临时数据目录，不连接真实远端 SSH 主机。`verify:electron` 需要可用的桌面环境；进程存在或窗口创建不代表通过。boot、IPC、Web 检查共用 `scripts/electron-runner.mjs`，要求成功信号、必要的就绪证据与正常退出同时成立；超时会回收进程树。退出码 0 表示通过，1 表示失败，2 表示已识别的环境限制，环境限制不能记录为成功。

Electron 验证使用隐藏窗口和临时用户目录，并关闭自动无沙箱回退，以便完整回收所启动的进程；本轮验证没有覆盖两代真实 Electron 的自动回退。boot 截图为尽力获取，只有本次成功生成时才输出文件路径；截图失败不替代或否定 renderer-ready 检查。

迁移前 Git 基线缺少旧 smoke 文件；当前测试为本轮补写并纳入版本控制的用例。历史 README 中的次数和日志不再作为本次结果。实际执行记录见[整改方案](../../docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md)。`smoke:profile` 只验证档案模块，不替代真实两次启动的产品验收；本机 ssh2 夹具也不代表真实 sshd 的兼容性覆盖。

## 可选 GUI 与研究资料

Windows 鼠标键盘驱动、截图和原生文件对话框流程位于 [tools/gui](../../tools/gui/README.md)，独立运行，不纳入 `verify` 或 `verify:electron`。原始截图与日志不入库，工具路径可通过说明中的环境变量配置。

[Termius 产品设计分析](../../docs/research/termius/Termius-产品设计分析.html) 是保留原内容的历史研究报告；模板和 9 张素材与报告同目录，最终 HTML 内联图片，可离线打开。

当前不提供独立 Host 进程、安装包、自动更新、多用户 Web 隔离、端口转发或多标签页。后续扩展按具体需求评估，目录结构本身不承诺这些能力。

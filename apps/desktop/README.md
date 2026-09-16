# PureTerm Desktop

PureTerm Desktop is an Electron SSH/SFTP client with password or private-key authentication, saved hosts, an interactive terminal, and basic remote file operations. Electron starts an independent Node Host child process; the default IPC window and the local browser entry share that Host. The main process owns operating-system encryption and native key selection.

Business logic, the protocol, HTTP/WS, and the UI live in shared root-workspace packages. The standalone entry that does not start Electron is documented in the [local Web guide](../web/README.md). See the [repository guide](../../README.md), [architecture](../../docs/architecture.md), and [layout decision](../../LAYOUT-PROPOSAL.md).

## Install and start

You need Node.js 24 or newer, npm, and a desktop environment that can run Electron. From the repository root:

```powershell
npm ci
npm run start:desktop
```

Dependencies are installed by the single root lockfile; do not run a separate `npm ci` in this directory. The start command builds shared modules, the UI, and Desktop before opening the app. To launch outside the terminal, run `npm run launch --workspace=@pureterm/desktop` from the root; logs go to `apps/desktop/dist/launch.log`.

Enter a host, port, and user, choose password or private-key authentication, and connect. Desktop’s private-key picker is a native file dialog and stores only the path; the file is read when connecting, and an empty passphrase means no passphrase is supplied. When “remember credentials” is selected, ciphertext is stored through the operating-system encryption provider; switching authentication methods removes the old credential.

The Files panel supports directory browsing, upload/download, directory creation, and deletion. SFTP transfers are limited to 4 MiB per file and have no resume, progress bar, or rename operation; deletion acts on the remote host immediately and does not use an application recycle bin.

## Data and the attached Web entry

The default data directory is `~/.ssh-cordis/`, overridden by `SSH_CORDIS_DATA_DIR`.

| File | Contents |
| --- | --- |
| `hosts.json` | host metadata, authentication mode, and private-key path |
| `secrets.json` | ciphertext produced by the operating-system credential provider |
| `known_hosts.json` | trusted SSH host fingerprints; changed keys reject the connection |
| `launch-profile.json` | launch configuration submitted after renderer readiness |

Desktop’s HTTP carrier binds only to `127.0.0.1`; startup logs print a tokenized local URL. A new token is generated for every launch. The browser and Desktop share host records, encrypted credentials, and native private-key selection.

The standalone `npm run start:web` command uses its own Node Host and defaults to `~/.ssh-cordis/web/`. It stores hosts and fingerprints only; browser key selection does not depend on Electron, and passwords/private keys live only in the current page. Do not point both independent processes at the same data files.

| Environment variable | Effect |
| --- | --- |
| `SSH_CORDIS_DATA_DIR` | select the Desktop data directory |
| `SSH_CORDIS_NO_WEB_CARRIER=1` | disable Desktop’s attached Web entry for this run |
| `SSH_CORDIS_NO_LAUNCH_PROFILE=1` | disable launch-profile reads and writes |
| `SSH_CORDIS_NO_SANDBOX_FALLBACK=1` | disable automatic no-sandbox fallback and profile backfill |

Sandbox, GPU, and startup fallback behavior remain as implemented. Profiles are not separated by container, CI, and daily environments; tests use temporary directories to avoid changing a normal configuration.

## Code and build

| Path | Responsibility |
| --- | --- |
| `electron/app/` | main process, shell, platform APIs, system credentials, and native key picker |
| `electron/runtime/` | platform policy, readiness, profiles, restart, and resource paths |
| `electron/carriers/` | IPC and preload |
| `electron/diagnostics/` | in-process boot/smoke hooks |
| `scripts/`, `tests/` | Desktop build/launch, diagnostics, tests, and local protocol fixtures |
| `../../packages/{host,protocol,transport,ui}/` | shared business logic, protocol, transport, and UI |

From the root, `npm run build:desktop` builds shared packages and Desktop, producing `dist/electron/app/main.js` and `dist/electron/carriers/preload.cjs`. UI artifacts stay in `../../packages/ui/dist/` and are located through package exports rather than copied into Desktop dist.

Root `npm run typecheck` checks every workspace plus ESM extensions and dependency boundaries. Host has no Electron dependency; UI imports neither Node nor Host; the shell accesses business logic through public package exports and never reads `Host.internals`.

## Verification and diagnostics

Run the complete checks from the repository root:

```powershell
npm run verify
npm run verify:electron
```

`verify` includes builds, types, dependency constraints, and Host child-process, update-coordinator, UI, Web, SSH/SFTP, and HTTP/WS tests that do not need a window. Root `verify:electron` checks Desktop boot, IPC, Desktop Web, renderer-crash cleanup, update downloads, standalone Node Web, and shared Client lifecycle.

Desktop-focused commands can be run from the root with `npm run <command> --workspace=@pureterm/desktop`:

| Command | Scope |
| --- | --- |
| `boot` | start real Desktop and wait for renderer-ready and boot results |
| `smoke:electron` | real preload, IPC, and terminal byte stream |
| `smoke:web` | real page and terminal in the Desktop Web carrier |
| `smoke:node` | built platform, profile, Host, SFTP, carrier, and runner checks |
| `smoke:profile` | profile persistence, invalid data, and readiness gate without two real launches |
| `diagnose:electron` | diagnose Chromium rendering with a minimal Electron page |

Build first with `npm run build:desktop` before running `smoke:node` alone so it cannot read stale artifacts. Full verification includes the build.

Tests use random loopback ports, temporary data directories, and local SSH fixtures; they never connect to a user’s remote host. `scripts/electron-runner.mjs` checks success signals, required evidence, and clean exit, and reclaims the process tree on timeout. Exit code 0 passes, 1 fails, and 2 means a recognized environment limitation; an environment limitation is not a pass.

Electron verification uses controlled windows and temporary user data and disables automatic no-sandbox fallback, so it does not cover both generations of real Electron fallback. Boot screenshots are best effort and are emitted only when created; a screenshot cannot replace renderer-ready. `smoke:profile` also cannot replace a real two-launch acceptance test, and the local ssh2 fixture does not represent every sshd implementation.

## Current scope

Desktop Host separation, the shared Cordis Client, installer builds, and GitHub Releases update checks are implemented. “Help → Check for Updates” performs a manual check; after a download, a confirmed restart stops SSH and installs the update. Development builds do not check online. See the [release guide](../../docs/desktop-release.md) for packaging, signing, and publishing. Port forwarding, multiple tabs, user accounts, and multi-user isolation are not in the current scope. Historical remediation and test notes are in the [previous plan](../../docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md); its old paths and pass counts describe that historical baseline.

<details>
<summary>中文版本</summary>

# PureTerm Desktop

Electron SSH / SFTP 客户端，支持密码或私钥认证、保存主机、终端交互和基本远端文件操作。Electron 启动独立 Node Host 子进程；默认提供 IPC 窗口和本机浏览器入口，两者共享子进程中的 Host。系统加密与原生选钥仍由主进程提供。

业务、协议、HTTP/WS 与界面已抽到根 workspace 的共享包。无需启动 Electron 的独立入口见[本机 Web](../web/README.md)。[仓库入口](../../README.md) · [架构](../../docs/architecture.md) · [目录决策](../../LAYOUT-PROPOSAL.md)

## 安装与启动

需要 Node.js 24 或更高版本、npm 和可运行 Electron 的桌面环境。在仓库根执行：

```powershell
npm ci
npm run start:desktop
```

依赖由根唯一锁文件安装，不再在此目录单独执行 `npm ci`。启动命令构建共享模块、界面和 Desktop，然后打开应用。需要脱离终端运行时，在根执行 `npm run launch --workspace=@pureterm/desktop`，日志写入 `apps/desktop/dist/launch.log`。

填写主机、端口、用户名，选择密码或私钥后连接。Desktop 的私钥选择使用原生文件对话框，只保存路径；连接时读取文件，口令留空表示不提供口令。勾选记住凭据时通过系统加密能力保存密文，切换认证方式会清理旧凭据。

“文件”面板支持目录浏览、上传/下载、新建目录和删除。SFTP 单文件上限为 4 MiB，没有续传、进度条或重命名；删除直接作用于远端，不进入应用回收站。

## 数据与附带 Web 入口

默认目录为 `~/.ssh-cordis/`，由 `SSH_CORDIS_DATA_DIR` 覆盖。

| 文件 | 内容 |
| --- | --- |
| `hosts.json` | 主机元数据、认证方式和私钥路径 |
| `secrets.json` | 系统加密能力生成的凭据密文 |
| `known_hosts.json` | 已信任 SSH 主机指纹；密钥改变时拒绝连接 |
| `launch-profile.json` | renderer 就绪后提交的启动配置 |

Desktop 的 HTTP carrier 只监听 `127.0.0.1`，启动日志提供带 token 的本机地址。token 每次启动重新生成；浏览器与桌面共享主机记录、系统加密凭据和原生私钥选择能力。

独立 `npm run start:web` 使用自己的 Node Host，默认数据在 `~/.ssh-cordis/web/`，只保存主机和指纹记录，浏览器选钥不依赖 Electron，密码和私钥仅用于当前页面。不要把两个独立进程指向同一份数据文件。

| 环境变量 | 作用 |
| --- | --- |
| `SSH_CORDIS_DATA_DIR` | 指定 Desktop 数据目录 |
| `SSH_CORDIS_NO_WEB_CARRIER=1` | 关闭 Desktop 本次附带 Web 入口 |
| `SSH_CORDIS_NO_LAUNCH_PROFILE=1` | 禁止读写启动档案 |
| `SSH_CORDIS_NO_SANDBOX_FALLBACK=1` | 禁止自动无沙箱回退及对应档案回填 |

沙箱、GPU 和启动回退保留既有行为；档案不区分容器、CI 与日常环境。测试使用临时目录，避免影响日常配置。

## 代码与构建

| 路径 | 内容 |
| --- | --- |
| `electron/app/` | main、shell、平台 API、系统凭据和原生选钥 |
| `electron/runtime/` | 平台策略、就绪、档案、重启及资源路径 |
| `electron/carriers/` | IPC 与 preload |
| `electron/diagnostics/` | 应用进程中的 boot/smoke 钩子 |
| `scripts/`、`tests/` | Desktop 构建启动、诊断、测试与本机协议夹具 |
| `../../packages/{host,protocol,transport,ui}/` | 共享业务、协议、传输与界面 |

根 `npm run build:desktop` 构建共享包和 Desktop，生成 `dist/electron/app/main.js` 与 `dist/electron/carriers/preload.cjs`。界面产物位于 `../../packages/ui/dist/`，通过包导出解析，不再复制到 Desktop dist。

根 `npm run typecheck` 检查各 workspace，并运行 ESM 扩展名和依赖边界检查。Host 不依赖 Electron；UI 不导入 Node 或 Host；壳通过公共包导出访问业务，不读取 `Host.internals`。

## 验证与诊断

完整命令在仓库根执行：

```powershell
npm run verify
npm run verify:electron
```

`verify` 包含全部构建、类型与依赖约束，以及无需窗口的 Host 子进程、更新协调、UI、Web、SSH/SFTP/HTTP/WS 测试。根 `verify:electron` 检查 Desktop boot、IPC、Desktop Web、渲染崩溃、更新下载、独立 Node Web 和共享 Client 生命周期。

Desktop 的定向命令可在根使用 `npm run <命令> --workspace=@pureterm/desktop`：

| 命令 | 范围 |
| --- | --- |
| `boot` | 启动真实 Desktop，等待 renderer-ready 与 boot 结果 |
| `smoke:electron` | 真实 preload、IPC 和终端字节流 |
| `smoke:web` | Desktop Web 载体中的真实页面与终端 |
| `smoke:node` | 使用已构建产物运行平台、档案、Host、SFTP、carrier 和 runner 检查 |
| `smoke:profile` | 启动档案持久化、无效数据与就绪门控，不启动两次真实应用 |
| `diagnose:electron` | 用最小 Electron 页面排查 Chromium 渲染环境 |

单独执行 `smoke:node` 前先运行根 `npm run build:desktop`，以免读取过期产物。完整验证命令包含构建。

测试使用随机回环端口、临时数据目录和本机 SSH 夹具，不连接用户的远端主机。真实应用检查共用 `scripts/electron-runner.mjs`，同时检查成功信号、必要证据与正常退出；超时会回收进程树。退出码 0 为通过、1 为失败、2 为已识别的环境限制，环境限制不算成功。

Electron 验证使用受控窗口与临时用户目录，关闭自动无沙箱回退，因此不覆盖两代真实 Electron 的回退。boot 截图尽力获取，只有本次成功生成时才输出路径；截图不能代替 renderer-ready。`smoke:profile` 也不能替代真实双次启动验收，本机 ssh2 夹具不代表所有 sshd 的兼容性。

## 当前范围

已提供独立 Desktop Host、共享 Cordis Client、安装包构建与 GitHub Releases 更新。菜单“帮助 → 检查更新”可手动检查；下载完成后确认重启才会关闭 SSH 并安装，开发版不联网检查。安装、签名与发布配置见[发布说明](../../docs/desktop-release.md)。当前没有端口转发、多标签页、用户账号或多用户隔离。历史整改与测试说明见[上一轮方案](../../docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md)，其中旧路径与通过次数按当时基线理解。

</details>

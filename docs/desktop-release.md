# Desktop Installers and GitHub Releases

PureTerm installers are produced by electron-builder, and updates are fetched by electron-updater from the public `puremixai/pureterm` GitHub Releases repository. Users do not need a GitHub token. Development launches and standalone local Web do not participate in packaged-app updates.

## Local build

Use Node.js 24 and the locked dependencies from the repository root:

```powershell
npm ci
npm run verify
npm run verify:electron
npm run dist:desktop -- --win --x64
npm run verify:package:windows
npm run release:check
```

`dist:desktop` builds Desktop, prepares `.release/app`, and invokes `apps/desktop/electron-builder.cjs`. It explicitly uses `--publish never` and creates local files only. Windows artifacts are in `release/`:

- `PureTerm-<version>-win-x64.exe`: an NSIS installer, installed for the current user by default.
- The matching `.exe.blockmap` and `latest.yml`: incremental-download and update metadata that must be published with the installer.
- `win-unpacked/`: a complete application directory for inspection.

The NSIS installer does not launch the app automatically after installation. Users may choose the install directory; install and uninstall do not remove SSH hosts or user credentials. An unsigned local build may show an unknown-publisher warning on Windows. Official tag builds require a signing certificate.

`npm run stage:desktop` prepares the runtime directory without building an installer. It is disposable and must not be committed to Git.

## Runtime contents

`.release/app` is self-contained; packaging does not rely on monorepo workspace symlinks or the launch cwd:

```text
.release/app/
  package.json
  runtime-dependencies.json
  dist/electron/
    app/main.js
    host/entry.js
    carriers/preload.cjs
  node_modules/@pureterm/
    host/{package.json,dist/}
    protocol/{package.json,dist/}
    transport/{package.json,dist/}
    ui/{package.json,dist/}
  node_modules/...
```

External production dependencies are copied from the actual tree installed by `npm ci`, with manifest versions made exact. Nested dependencies are retained when versions conflict, together with their license files. The UI is bundled for the browser, so the package does not need another xterm or browser-Cordis dependency tree.

SSH uses ssh2’s JavaScript implementation. Optional accelerators `cpu-features`, `nan`, and `sshcrypto.node` are not packaged, so native rebuild is disabled. Runtime resources such as `poly1305.js` remain in the package. If a required native module is introduced later, update staging, Electron ABI builds, and installer tests together.

`asar:false` is currently used so the independent Node Host entry and its dependencies remain real files. Electron main and Host child processes share the packaged Electron/Node runtime; end users do not install Node.js separately.

## CI and publishing

`.github/workflows/desktop-release.yml` builds three platforms for pull requests, manual runs, and `v*` tags:

| Runner | Artifacts | Architectures |
| --- | --- | --- |
| Windows | NSIS | x64 |
| macOS | DMG, ZIP | x64, arm64 |
| Linux | AppImage | x64 |

The macOS job builds both architectures and keeps update metadata that covers both. ZIP is required by macOS auto-update; publishing only DMG is insufficient. Linux auto-update targets a running AppImage; running an unpacked directory is not AppImage update acceptance.

Ordinary builds save Actions artifacts only. Before upload, the Windows job installs, runs, and uninstalls the NSIS package in isolation. Only when the complete three-platform build for a tag succeeds does the follow-up job create or update a **draft release** with installers, blockmaps, and platform update metadata. It refuses to modify an already-public release and never publishes the draft automatically.

## Versions and CHANGELOG

The root and every `apps/*` and `packages/*` `package.json` carry the same version. `npm run release:check` verifies exact alignment and requires a `[Unreleased]` section in `CHANGELOG.md`; a non-empty section must classify entries under categories such as `Added`, `Changed`, `Fixed`, or `Security`.

Record user-visible changes under `[Unreleased]` before merging a feature. When preparing a release, move those entries to a dated `## [x.y.z] - YYYY-MM-DD` section, update the comparison link at the bottom, and run:

```powershell
npm run release:check -- --version 0.2.0
npm run release:notes -- --version 0.2.0 --output release-notes.md
```

The scripts reject inconsistent versions, missing dates, or a missing matching CHANGELOG section. Do not copy release notes by hand; tag CI extracts the same section for the GitHub draft. Version tags must be `v<version>`, for example `v0.2.0`.

Publishing steps:

1. Set every workspace `package.json` to the same new version, update the lockfile, and move `[Unreleased]` to the dated version section.
2. Run `npm run release:check -- --version <version>`, `npm run verify`, and `npm run verify:electron`.
3. Push the matching `v<version>` tag. CI rechecks versions and CHANGELOG and generates draft notes from that section.
4. Download the draft installers and verify startup, SSH, SFTP, Host shutdown, and update behavior on the target platforms.
5. Confirm artifacts, CHANGELOG content, and signatures, then publish the draft. Installed clients can discover the version only after it is public.

The publishing job uses GitHub’s automatically provided `GITHUB_TOKEN`; only that job receives `contents:write`. The token is not packaged. Rerunning the same tag replaces draft artifacts; fixes to a public release use a higher version.

## Signing configuration

Configure these names as GitHub Actions secrets and never commit their values or certificates:

| Platform | Secret | Purpose |
| --- | --- | --- |
| Windows | `WIN_CSC_LINK` | signing-certificate path or base64 PFX/P12 |
| Windows | `WIN_CSC_KEY_PASSWORD` | certificate password |
| macOS | `MAC_CSC_LINK` | Developer ID Application certificate; CI maps it to `CSC_LINK` |
| macOS | `MAC_CSC_KEY_PASSWORD` | certificate password; CI maps it to `CSC_KEY_PASSWORD` |
| macOS | `APPLE_ID` | Apple account |
| macOS | `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password |
| macOS | `APPLE_TEAM_ID` | Developer Team ID |

A tag build fails when required credentials are missing and does not publish an unsigned app as an official update candidate. Non-tag builds may create acceptance packages; an ad-hoc-signed macOS build without a certificate does not prove distribution signing or auto-update acceptance. Official macOS builds enable Hardened Runtime and notarization.

Local builds may receive certificates through environment variables. Apple API-key authentication is also supported with `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`; the current CI example uses Apple ID authentication, so update the credential checks and mappings together when switching.

## Acceptance boundaries

`packaging.test.mjs` checks that staging runs from a cwd outside the workspace, nested dependency versions remain correct, UI exports resolve, required Host entries and missing dependencies fail as expected, and linked directories cannot write outside the workspace or omit files. The installer itself still needs a real run.

Windows acceptance uses an isolated install directory and `SSH_CORDIS_DATA_DIR`. First confirm that no existing PureTerm installation will be overwritten. Launch the installed `PureTerm.exe` from outside the workspace, verify shared UI, Host child process, SSH/SFTP, and process exit, then uninstall this test installation. A successful install does not replace acceptance of download, checksum, and restart installation between two versions.

`verify:package:windows` automates this flow: it refuses to overwrite an existing PureTerm installation; otherwise it installs into the system temporary directory `pureterm-installed-smoke-*` outside the repository, uses temporary Chromium/data directories and local SSH/SFTP fixtures, verifies encrypted credentials across processes, invokes the test uninstaller, and checks registry and process cleanup. The install directory and launch cwd are outside the workspace, and `NODE_PATH` is removed so workspace dependencies cannot hide omitted package files.

Updates can be triggered from “Help → Check for Updates” or the background checker. After download, the default choice is “Later”; a confirmed restart stops Host and installs. The updater error listener remains active during installation; if the platform reports an asynchronous failure, the app shows the error and restarts the current version instead of leaving a windowless process.

Updater state-machine and local-feed tests need no public release. `node apps/desktop/tests/smoke-updates.mjs` uses real Electron, `NsisUpdater`, and Electron’s network downloader to verify a new version downloads from a local feed and an incorrect SHA-512 is rejected. It downloads fixture data that cannot execute, keeps all caches in the runner’s temporary directory, forbids external requests and installer invocation, and does not validate release certificates or a real upgrade.

Configured macOS/Linux workflows do not prove that those platforms have been built, signed, or run successfully; use the corresponding CI and target-machine results.

Official references: [electron-builder v26 configuration](https://www.electron.build/v26/docs/configuration/), [auto-update](https://www.electron.build/v26/docs/features/auto-update/), [code signing](https://www.electron.build/v26/docs/features/code-signing/), and [macOS notarization](https://www.electron.build/v26/docs/notarization/). The project is pinned to builder 26.x; do not copy renamed options from 27.x documentation without checking the pinned version.

<details>
<summary>中文版本</summary>

# Desktop 安装包与 GitHub Releases

PureTerm 的安装包由 electron-builder 生成，更新由 electron-updater 从公开仓库 `puremixai/pureterm` 的 GitHub Releases 获取。用户电脑不需要 GitHub token。开发启动与独立本机 Web 不参与安装包更新。

## 本地构建

在仓库根目录使用 Node.js 24 和锁定依赖：

```powershell
npm ci
npm run verify
npm run verify:electron
npm run dist:desktop -- --win --x64
npm run verify:package:windows
npm run release:check
```

`dist:desktop` 构建 Desktop、准备 `.release/app`，随后调用 `apps/desktop/electron-builder.cjs`。此命令明确使用 `--publish never`，只生成本机文件。Windows 产物位于 `release/`：

- `PureTerm-<version>-win-x64.exe`：NSIS 安装包，默认按当前用户安装。
- 同名 `.exe.blockmap` 与 `latest.yml`：增量下载和更新元数据，应与安装包一起发布。
- `win-unpacked/`：方便检查的完整应用目录。

NSIS 安装结束后不会自动启动应用。安装器允许选择目录；安装和卸载不删除 SSH 主机记录与用户凭据。没有证书的本机构建用于验收，Windows 可能显示未知发布者提示。正式 tag 构建要求签名证书。

`npm run stage:desktop` 可以单独准备运行时目录。该目录可以被删除并重新生成，不应提交进 Git。

## 运行时内容

`.release/app` 是自包含目录，打包不依赖 monorepo 的 workspace 符号链接或启动工作目录：

```text
.release/app/
  package.json
  runtime-dependencies.json
  dist/electron/
    app/main.js
    host/entry.js
    carriers/preload.cjs
  node_modules/@pureterm/
    host/{package.json,dist/}
    protocol/{package.json,dist/}
    transport/{package.json,dist/}
    ui/{package.json,dist/}
  node_modules/...
```

外部生产依赖从 `npm ci` 安装后的实际依赖树复制，manifest 中的版本改为精确版本。存在版本冲突时保留嵌套依赖，并保留依赖的许可证文件。UI 已经被打成浏览器 bundle，无需再装一份 xterm 或浏览器 Cordis 依赖树。

SSH 使用 ssh2 的 JS 实现，暂不打包 `cpu-features`、`nan` 或 `sshcrypto.node` 可选加速模块。因此关闭 electron-builder 的 native rebuild。`poly1305.js` 等运行时资源仍包含在包内。后续引入必需原生模块时，需要同时调整 staging、Electron ABI 构建和安装包测试。

目前使用 `asar:false`，独立 Node Host 入口和其依赖都是真实文件。Electron 主进程与 Host 子进程共用安装包内的 Electron/Node 运行时，终端用户无需另装 Node.js。

## CI 与发布

`.github/workflows/desktop-release.yml` 对 PR、手动运行和 `v*` tag 提供三平台构建：

| Runner | 产物 | 架构 |
| --- | --- | --- |
| Windows | NSIS | x64 |
| macOS | DMG、ZIP | x64、arm64 |
| Linux | AppImage | x64 |

macOS 的两个架构在同一个 job 生成，保留包含两者的更新元数据。ZIP 是 macOS 自动更新的必需产物，不能只发布 DMG。Linux 自动更新用于实际运行的 AppImage；直接运行 unpacked 目录不等于 AppImage 更新验收。

普通构建仅保存 Actions artifacts。Windows job 在上传前还会隔离安装、运行并卸载 NSIS 包。只有 tag 触发的完整三平台构建成功，后续 job 才创建或更新 **draft release**，并附加安装包、blockmap 和各平台更新元数据。它拒绝修改已经公开的 release，也不会自动公开 draft。

## 版本与 CHANGELOG

版本号统一写在根目录和所有 `apps/*`、`packages/*` 的 `package.json` 中。`npm run release:check` 会检查这些版本完全一致，并要求 `CHANGELOG.md` 包含 `[Unreleased]` 区段；该区段有内容时必须按 `Added`、`Changed`、`Fixed`、`Security` 等类别归类。提交新功能时先在 `[Unreleased]` 下记录用户可见变化，发布后可以暂时留空等待下一轮变更。

准备发布时，把 `[Unreleased]` 内容移到带日期的 `## [x.y.z] - YYYY-MM-DD` 区段，更新底部比较链接，再运行：

```powershell
npm run release:check -- --version 0.2.0
npm run release:notes -- --version 0.2.0 --output release-notes.md
```

脚本会拒绝版本不一致、缺少日期或缺少对应 CHANGELOG 区段的发布。不要手工复制发布说明；tag CI 会从同一个区段提取 GitHub draft Release notes。版本 tag 必须是 `v<version>`，例如 `v0.2.0`。

发布步骤：

1. 将所有 workspace `package.json` 的版本设为相同的新版本，更新 lock，并把 `[Unreleased]` 移到对应的日期版本区段。
2. 运行 `npm run release:check -- --version <version>`、`npm run verify` 和 `npm run verify:electron`。
3. 推送与版本对应的 `v<version>` tag。CI 会重新检查版本和 CHANGELOG，并从对应区段生成 draft notes。
4. 下载 draft 中的安装包，在目标平台验收启动、SSH、SFTP、Host 退出及更新行为。
5. 确认所有附件、CHANGELOG 内容和签名后公开 draft。已安装客户端此时才能发现该版本。

发布 job 使用 GitHub 自动提供的 `GITHUB_TOKEN`，仅此 job 获得 `contents:write`。token 不进入应用包。重新运行同一 tag 只覆盖 draft 附件；已发布版本的修复使用更高版本号。

## 签名配置

在 GitHub 仓库 Actions secrets 中配置以下名称，切勿把值或证书提交到仓库：

| 平台 | Secret | 用途 |
| --- | --- | --- |
| Windows | `WIN_CSC_LINK` | 签名证书路径或 base64 PFX/P12 |
| Windows | `WIN_CSC_KEY_PASSWORD` | 证书密码 |
| macOS | `MAC_CSC_LINK` | Developer ID Application 证书；CI 映射到 `CSC_LINK` |
| macOS | `MAC_CSC_KEY_PASSWORD` | 证书密码；CI 映射到 `CSC_KEY_PASSWORD` |
| macOS | `APPLE_ID` | Apple 账户 |
| macOS | `APPLE_APP_SPECIFIC_PASSWORD` | Apple 应用专用密码 |
| macOS | `APPLE_TEAM_ID` | Developer Team ID |

tag 构建缺少所需凭据时直接失败，不把未签名应用作为正式更新候选发布。非 tag 构建允许生成验收包；macOS 无证书时使用 ad-hoc 签名，不能据此声称完成分发签名或自动更新验收。macOS 正式构建启用 Hardened Runtime 和 notarization。

本地构建也可以通过环境变量提供证书。配置另外支持 `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` 作为 Apple API key 认证方案；当前 CI 示例采用 Apple ID 方案，切换时应同步更改 CI 的凭据检查及映射。

## 验收边界

`packaging.test.mjs` 检查 staging 可在工作区之外的 cwd 运行、嵌套依赖版本保持正确、UI 导出仍可解析、必要 Host 入口和依赖缺失时构建失败，以及链接目录不会导致工作区外写入或遗漏文件。安装包本身仍需真实运行验证。

Windows 本机验收应使用独立安装目录和 `SSH_CORDIS_DATA_DIR`，先确认没有已有 PureTerm 安装，避免覆盖用户环境。安装后从工作区之外启动安装目录中的 `PureTerm.exe`，验证共享 UI、Host 子进程、SSH/SFTP 和进程退出，再卸载此次测试安装。安装成功不能替代对新旧版本之间更新下载、校验和重启安装的验收。

`verify:package:windows` 自动执行上述流程：已有 PureTerm 安装时拒绝覆盖，否则在仓库外的系统临时目录 `pureterm-installed-smoke-*` 安装，使用临时 Chromium/数据目录和本机 SSH/SFTP 夹具，验证系统加密凭据跨进程读写，最后调用本次安装的卸载器并检查登记和进程清理。安装目录与启动 cwd 均位于仓库外，并移除 NODE_PATH，避免工作区依赖掩盖漏打包问题。

更新通过菜单“帮助 → 检查更新”或后台定时检查触发。下载后默认选择“稍后”；确认重启才会关停 Host 并安装。安装前保留更新器错误监听，若平台异步报告安装失败，显示错误后重启当前版本，避免留下无窗口进程。

自动更新的状态机测试与本地 feed 测试不需要创建公开 release。`node apps/desktop/tests/smoke-updates.mjs` 使用真实 Electron、NsisUpdater 和 Electron 网络下载器，验证本机 feed 中的新版本可以下载，错误 SHA-512 会被拒绝。该测试只下载不可执行的 fixture 数据，所有缓存均放入 runner 的临时目录，禁止外网请求和安装调用；它不验证发布证书或实际安装升级。

macOS/Linux 的工作流配置完成，也不代表这些平台已经实际构建、签名或运行成功；以对应 CI 和目标机器结果为准。

官方参考：[electron-builder v26 配置](https://www.electron.build/v26/docs/configuration/)、[自动更新](https://www.electron.build/v26/docs/features/auto-update/)、[签名](https://www.electron.build/v26/docs/features/code-signing/)、[macOS notarization](https://www.electron.build/v26/docs/notarization/)。当前锁定 builder 26.x，不应直接套用 27.x 文档中重命名后的配置。

</details>

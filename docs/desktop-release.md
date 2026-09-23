# Desktop Installers and GitHub Releases

[中文版本](desktop-release_zh.md)

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

The packaged UI loads from `pureterm-app://app/`. The child starts the same loopback Web Host used by standalone Web, and the minimal preload gives the window only its WebSocket URL. Electron main injects the private Desktop bearer token into that window’s exact WebSocket request; ordinary attached-browser token/cookie access can be disabled with `SSH_CORDIS_NO_WEB_CARRIER=1` without disabling the Desktop window.

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

PureTerm is in the `0.x` development cycle and follows [SemVer 2.0.0](https://semver.org/). The current source version is `0.1.0-alpha.1`; `0.1.0-alpha.N`, `0.1.0-beta.N`, `0.1.0-rc.N`, and `0.1.0` describe successive testing and delivery phases. Phase suffixes start at `1` independently, published versions are never reused, and `0.x` breaking changes must be called out in the changelog. Source versions omit `v`; Git tags use `v<version>`.

`VERSION.txt` is the source-version baseline. The root and every `apps/*` and `packages/*` `package.json`, together with `package-lock.json`, must match it. `npm run release:check` verifies exact alignment, requires a `[Unreleased]` section in `CHANGELOG.md`, and rejects a changelog whose first line is not `# PureTerm` or whose non-empty entries are not grouped under categories such as `Added`, `Changed`, `Fixed`, or `Security`.

After updating the source version, packages, and English changelog, regenerate the UI metadata and commit the generated files:

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```

These commands write `packages/ui/src/lib/changelog.ts` and `packages/ui/src/lib/version.ts`. Keep the Chinese changelog in sync as a translation mirror.

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

Windows acceptance uses an isolated install directory and `SSH_CORDIS_DATA_DIR`. First confirm that no existing PureTerm installation will be overwritten. Launch the installed `PureTerm.exe` from outside the workspace, verify the custom-scheme UI, child Web Host, WebSocket SSH/SFTP, and process exit, then uninstall this test installation. A successful install does not replace acceptance of download, checksum, and restart installation between two versions.

`verify:package:windows` automates this flow: it refuses to overwrite an existing PureTerm installation; otherwise it installs into the system temporary directory `pureterm-installed-smoke-*` outside the repository, uses temporary Chromium/data directories and local SSH/SFTP fixtures, verifies encrypted credentials across processes, invokes the test uninstaller, and checks registry and process cleanup. The install directory and launch cwd are outside the workspace, and `NODE_PATH` is removed so workspace dependencies cannot hide omitted package files.

Updates can be triggered from “Help → Check for Updates” or the background checker. After download, the default choice is “Later”; a confirmed restart stops Host and installs. The updater error listener remains active during installation; if the platform reports an asynchronous failure, the app shows the error and restarts the current version instead of leaving a windowless process.

Updater state-machine and local-feed tests need no public release. `node apps/desktop/tests/smoke-updates.mjs` uses real Electron, `NsisUpdater`, and Electron’s network downloader to verify a new version downloads from a local feed and an incorrect SHA-512 is rejected. It downloads fixture data that cannot execute, keeps all caches in the runner’s temporary directory, forbids external requests and installer invocation, and does not validate release certificates or a real upgrade.

Configured macOS/Linux workflows do not prove that those platforms have been built, signed, or run successfully; use the corresponding CI and target-machine results.

Official references: [electron-builder v26 configuration](https://www.electron.build/v26/docs/configuration/), [auto-update](https://www.electron.build/v26/docs/features/auto-update/), [code signing](https://www.electron.build/v26/docs/features/code-signing/), and [macOS notarization](https://www.electron.build/v26/docs/notarization/). The project is pinned to builder 26.x; do not copy renamed options from 27.x documentation without checking the pinned version.

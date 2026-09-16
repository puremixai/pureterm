# PureTerm Desktop

[中文版本](README_zh.md)

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

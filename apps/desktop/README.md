# PureTerm Desktop

[中文版本](README_zh.md)

PureTerm Desktop is an Electron SSH/SFTP client with password or private-key authentication, saved hosts, an interactive terminal, and basic remote file operations. Electron starts an independent Node-mode Web Host child process. Its `pureterm-app://app/` window and optional local browser use that child’s WebSocket. The main process owns operating-system encryption and native key selection.

Business logic, the protocol, HTTP/WS, and the UI live in shared root-workspace packages. The standalone entry that does not start Electron is documented in the [local Web guide](../web/README.md). See the [repository guide](../../README.md), [architecture](../../docs/architecture.md), and [layout decision](../../LAYOUT-PROPOSAL.md).

## Install and start

You need Node.js 24 or newer, npm, and a desktop environment that can run Electron. From the repository root:

```powershell
npm ci
npm run start:desktop
```

Dependencies are installed by the single root lockfile; do not run a separate `npm ci` in this directory. The start command builds shared modules, the UI, and Desktop before opening the app. To launch outside the terminal, run `npm run launch --workspace=@pureterm/desktop` from the root; logs go to `apps/desktop/dist/launch.log`.

Enter a host, port, and user, choose password or private-key authentication, and connect. Desktop’s private-key picker is a native file dialog and stores only the path; the file is read when connecting, and an empty passphrase means no passphrase is supplied. When “remember credentials” is selected, ciphertext is stored through the operating-system encryption provider; on a machine where no usable provider exists the switch is off, its hint says the credential lasts only for this page, and the Host refuses a save rather than writing plaintext. Switching authentication methods removes the old credential.

Alternatively, import or paste a private key in **Keychain**, then select it in the host's authentication settings. Imported keys and their passphrases are saved in a dedicated system-encrypted vault. Public key/type/fingerprint are derived on save; editing never reveals the stored private material. See [Keychain usage](../../README.md#working-with-keychain).

The Files panel supports directory browsing, upload/download, directory creation, and deletion. SFTP transfers are limited to 4 MiB per file and have no resume, progress bar, or rename operation; deletion acts on the remote host immediately and does not use an application recycle bin.

Each session can also report the remote host's resources. The **Monitor** button on the terminal page's tool rail opens it; the panel is **collapsed by default**, and opening it starts a five-second Linux probe and shows CPU, memory, load, the root filesystem's usage, the network rate and the host's uptime, with pause and retry beside them. Closing the panel, pausing, hiding the page, switching tabs, and losing the connection all stop collection, so a closed session costs the remote nothing. The probe travels over the same SSH connection as the terminal and uses an ordinary exec channel — business monitoring does not use private Electron IPC, and the attached browser reports the same figures. CPU and network are rates and stay empty until a second probe supplies a baseline; disk is the root filesystem only; a counter the remote does not expose is left empty with its reason on hover; and a remote that is not Linux is reported as unsupported rather than as a failure. The status bar's cipher and host-key cells come from the SSH handshake, not from this panel, so they stay filled while it is closed or when the monitor plugin is unloaded.

## Data and the attached Web entry

The default data directory is `~/.ssh-cordis/`, overridden by `SSH_CORDIS_DATA_DIR`.

| File | Contents |
| --- | --- |
| `hosts.json` | host metadata, authentication mode, and private-key path or Keychain ID |
| `secrets.json` | ciphertext produced by the operating-system credential provider |
| `keychain.json` | atomic system-encrypted imported-key vault; no plaintext private material |
| `known_hosts.json` | trusted SSH host fingerprints; changed keys reject the connection |
| `launch-profile.json` | launch configuration submitted after renderer readiness |
| `desktop-profile.json` | ownership record binding this directory to one Desktop profile; never auto-rewritten |
| `diagnostics/host/` | bounded Host-failure reports (allowlisted, 0600, newest five kept) |

Desktop’s internal Web Host always binds to `127.0.0.1`. The application window loads UI files through `pureterm-app://app/` while the Host starts. Its minimal `window.puretermDesktop` preload API waits for Host readiness to provide a loopback WebSocket URL, and the page reports two facts back: that the renderer is ready, and which language it is showing, so the application menu and the native dialogs follow the language switch. SSH, SFTP, hosts, and Keychain operations use that WebSocket, not Electron business IPC. Electron main injects a separate bearer token only into the window’s exact WebSocket request; the token is never exposed to the page. When attached browser access is enabled, startup logs print a different tokenized local URL and issue browser session cookies. The attached browser and Desktop window share the Host process, encrypted storage, and native key picker; each client owns its SSH sessions.

The standalone `npm run start:web` command uses a separate Node Web Host and defaults to `~/.ssh-cordis/web/`. It stores hosts and fingerprints only; browser key selection does not depend on Electron, and passwords/private keys live only in the current page. It does not share Desktop sessions or data files, and `SSH_CORDIS_NO_WEB_CARRIER=1` does not disable it. Do not point both independent processes at the same data files.

| Environment variable | Effect |
| --- | --- |
| `SSH_CORDIS_DATA_DIR` | select the Desktop data directory |
| `SSH_CORDIS_NO_WEB_CARRIER=1` | disable only Desktop’s attached ordinary-browser entry; the internal Web Host and Desktop window still work |
| `SSH_CORDIS_NO_LAUNCH_PROFILE=1` | disable launch-profile reads and writes |
| `SSH_CORDIS_NO_SANDBOX_FALLBACK=1` | disable automatic no-sandbox fallback and profile backfill |
| `SSH_CORDIS_QUIT_CONFIRM=accept\|cancel` | answer the quit-confirmation dialog for isolated Electron checks; a normal launch never sets it |
| `SSH_CORDIS_RECOVERY_CHOICE=restart\|quit` | answer the Host-failure recovery dialog for isolated Electron checks; a normal launch never sets it |

Sandbox, GPU, and startup fallback behavior remain as implemented. Profiles are not separated by container, CI, and daily environments; tests use temporary directories to avoid changing a normal configuration.

## Reliability and recovery

Desktop admits one profile per data directory. Before it reads a launch profile or opens a Host, it takes a single-instance lock and writes or checks `desktop-profile.json`; a second launch on the same directory focuses the owner (or reports the different directory it asked for), and a launch whose Chromium `userData` does not match the record stops with an explicit message instead of letting two processes write one store. PureTerm never rebinds or repairs the record for you: moving existing data to another profile needs a deliberate data/encryption migration, and the error text says so. To run two profiles side by side, give each its own `SSH_CORDIS_DATA_DIR` and Chromium user-data directory.

An ordinary quit (closing the last window on Windows/Linux, the menu item, or Cmd+Q) is guarded: Desktop reads the Host’s accepted-work counts, asks only when there is activity or the counts could not be read, closes admission with a lease, drains finite accepted work, rechecks, and stops the Host. Declining leaves the window, its WebSocket, and every session running. An update is installed only after the Host acknowledges a clean, signal-free exit; a forced termination, a busy preparation, or a cancelled dialog keeps the downloaded update and the running Host.

If the Host exits unexpectedly, fails its startup handshake, or times out during shutdown, Desktop writes one report under `diagnostics/host/` — version, time, platform, architecture, phase, reason, and process facts only, with no host names, paths, credentials, commands, or terminal output — and then offers a native choice of restarting or quitting. A restart relaunches with the same data directory and switches but does not restore SSH sessions or terminal tabs.

Workspace shortcuts have one owner. Desktop and the standalone/attached browser resolve the same neutral bindings, so a key is consumed at most once; Ctrl/Cmd+W closes the active tab, Ctrl+Tab / Ctrl+Shift+Tab cycle tabs on every platform, Ctrl/Cmd+E opens Files, Ctrl/Cmd+` focuses the terminal, Ctrl/Cmd+K focuses host search, and Escape dismisses the host editor. Nothing is taken while an IME composition or a dialog owns the keyboard, Alt/AltGr passes through, and a held key does not repeat a destructive close.

## Code and build

| Path | Responsibility |
| --- | --- |
| `electron/app/` | main process, shell, platform APIs, system credentials, and native key picker |
| `electron/runtime/` | platform policy, readiness, profiles, restart, and resource paths |
| `electron/host/` | independent Node-mode Web Host child entry |
| `electron/carriers/` | minimal preload WebSocket bootstrap plus the readiness and locale reports |
| `electron/diagnostics/` | in-process boot/smoke hooks |
| `scripts/`, `tests/` | Desktop build/launch, diagnostics, tests, and local protocol fixtures |
| `../../packages/{host,protocol,i18n,transport,ui}/` | shared business logic, protocol, message catalog, transport, and UI |

From the root, `npm run build:desktop` builds shared packages and Desktop, producing `dist/electron/app/main.js`, `dist/electron/host/entry.js`, and `dist/electron/carriers/preload.cjs`. UI artifacts stay in `../../packages/ui/dist/` and are located through package exports rather than copied into Desktop dist.

Root `npm run typecheck` checks every workspace plus ESM extensions and dependency boundaries. Host has no Electron dependency and never imports the message catalog, which it replaces with a failure code; UI imports neither Node nor Host; the shell accesses business logic through public package exports and never reads `Host.internals`.

## Verification and diagnostics

Run the complete checks from the repository root:

```powershell
npm run verify
npm run verify:electron
```

`verify` includes builds, types, dependency constraints, and Host child-process, profile-ownership, Host lifecycle, shutdown-coordinator, update-coordinator, crash-report, fatal-recovery, shortcut, UI, Web, SSH/SFTP, and HTTP/WS tests that do not need a window. Root `verify:electron` checks Desktop custom-scheme boot, WebSocket SSH/Keychain operations, Desktop Web, renderer-crash cleanup, update downloads, standalone Node Web, shared Client lifecycle, single-profile ownership between two real launches, cancellable quit protection, and Host-failure recovery.

Desktop-focused commands can be run from the root with `npm run <command> --workspace=@pureterm/desktop`:

| Command | Scope |
| --- | --- |
| `boot` | start real Desktop and wait for renderer-ready and boot results |
| `smoke:electron` | real custom-scheme UI, minimal preload, WebSocket, terminal byte stream, and a fixture resource snapshot with session facts |
| `smoke:web` | real page and terminal in the Desktop Web carrier |
| `smoke:node` | built platform, profile, Host, SFTP, carrier, and runner checks |
| `smoke:profile` | profile persistence, invalid data, and readiness gate without two real launches |
| `diagnose:electron` | diagnose Chromium rendering with a minimal Electron page |

Build first with `npm run build:desktop` before running `smoke:node` alone so it cannot read stale artifacts. Full verification includes the build.

Tests use random loopback ports, temporary data directories, and local SSH fixtures; they never connect to a user’s remote host. `scripts/electron-runner.mjs` checks success signals, required evidence, and clean exit, and reclaims the process tree on timeout. Exit code 0 passes, 1 fails, and 2 means a recognized environment limitation; an environment limitation is not a pass.

Electron verification uses controlled windows and temporary user data and disables automatic no-sandbox fallback, so it does not cover both generations of real Electron fallback. Boot screenshots are best effort and are emitted only when created; a screenshot cannot replace renderer-ready. `smoke:profile` also cannot replace a real two-launch acceptance test, and the local ssh2 fixture does not represent every sshd implementation.

## Current scope

Desktop Web Host separation, the shared Cordis Client, terminal tabs, installer builds, and GitHub Releases update checks are implemented. One Desktop profile owns each data directory, a quit with active or uncertain SSH work asks first and can be cancelled, and a Host failure offers an explicit restart or quit without restoring sessions. “Help → Check for Updates” performs a manual check; after a download, a confirmed restart stops SSH and installs the update, and the install waits for a clean Host exit rather than a forced one. Development builds do not check online. See the [release guide](../../docs/desktop-release.md) for packaging, signing, and publishing. Port forwarding, user accounts, and multi-user isolation are outside the current scope. Historical remediation and test notes are in the [previous plan](../../docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md); its old paths and pass counts describe that historical baseline.

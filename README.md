# PureTerm

[中文版本](README_zh.md)

PureTerm is an SSH/SFTP client built with Cordis, ssh2, and xterm.js. It provides two local entry points: an Electron Desktop app and a standalone local Web app. SSH connections are always initiated by the user’s computer; the Web server binds only to the local loopback interface and provides no public service, accounts, or user isolation.

The project is released under the [MIT License](LICENSE).

The current source version is `0.1.0-alpha.1`, maintained in [VERSION.txt](VERSION.txt) and described in the [development guide](docs/DEVELOPMENT.md).

Both entry points reuse the Host, protocol, transport adapters, and Cordis Client. Desktop starts an independent Node Host child process from Electron; the standalone Web app runs in an ordinary Node process without starting Electron.

## Getting started

You need Node.js 24 or newer and npm. Desktop also needs a working desktop environment. Install all dependencies from the repository root with the single lockfile:

```powershell
npm ci

# Use the local Web app in a browser; open the tokenized URL printed in the console
npm run start:web

# Or start the Electron Desktop client
npm run start:desktop
```

The start commands build the required shared modules and application. Web uses a random loopback port by default; press Ctrl+C to stop it. Desktop stores data in `~/.ssh-cordis/` by default, while standalone Web uses `~/.ssh-cordis/web/`; each location stores host records and trusted SSH host keys for its own entry point.

Desktop can use the operating system credential store for passwords or private-key passphrases and can open native private-key file dialogs. Standalone Web stores host information only; passwords, passphrases, and private-key content selected in the browser live only in the current page and must be entered or selected again after a refresh. See the [Desktop guide](apps/desktop/README.md) and [local Web guide](apps/web/README.md).

## Working with connections

- Hosts is a permanent management tab. A single click selects a saved host without changing pages; use its Edit action to open the editor. Double-clicking a host opens a new terminal tab. Each connection gets a separate tab, including repeated connections to the same host.
- Tabs keep independent input, output, scrollback, connection state, and SFTP directories. Switching tabs or returning to Hosts leaves other connections running. The Files panel uses the selected SSH session and reserves space below its terminal.
- Disconnect retains output for inspection. Reconnect retries in the same tab; failed connections provide logs, retry, and host editing. Closing a tab releases only that session. A tab closed during its handshake releases the connection if the handshake later succeeds.
- Use `+` or Ctrl/Cmd+T for a new connection, Ctrl+Tab / Ctrl+Shift+Tab to switch, and Ctrl/Cmd+W to close the current terminal tab. Tab buttons also support arrow keys, Home, and End. Browsers may reserve some shortcuts; the visible controls remain available.

Open sessions and retry credentials live only in the current client; they are not restored after a reload. SFTP currently supports directory navigation, upload/download (up to 4 MiB per file), folder creation, and deletion with confirmation. Serial connections, port forwarding, and standalone keychain/snippet management are not implemented and are not shown as working controls.

## Verification

```powershell
# Clean build, type/dependency-boundary checks, Node and local protocol tests
npm run verify

# Desktop boot / IPC / Web and a real-browser check of standalone Node Web
npm run verify:electron
```

Tests use the repository’s local SSH/SFTP fixtures and temporary data directories. The second command requires a desktop environment; an Electron startup limitation is a failed check, not a pass.

## Repository entry points

| Path | Contents |
| --- | --- |
| `apps/desktop/` | Electron shell, platform adapters, startup diagnostics, and tests |
| `apps/web/` | Standalone local Node Web entry point and tests |
| `packages/host/` | Cordis Host, SSH/SFTP, host storage, and credential interfaces |
| `packages/protocol/` | Transport protocol and shared data structures |
| `packages/transport/` | Request dispatch, HTTP/WebSocket, and carrier composition |
| `packages/ui/` | Shared terminal, file panel, and browser transport for both entry points |
| [VERSION.txt](VERSION.txt) | Source version baseline for all workspaces and release tags |
| [docs/architecture.md](docs/architecture.md) | Current architecture, lifecycle, and data boundaries |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development, verification, and contribution workflow |
| [LAYOUT-PROPOSAL.md](LAYOUT-PROPOSAL.md) | Current directory and shared-module decisions |

The repository uses npm workspaces. Shared packages are referenced through public exports, and the root `package-lock.json` is the only installation lockfile. Versions and user-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md); `npm run release:check` validates version alignment and release entries in CI. `npm run dist:desktop -- --win --x64` creates a Windows installer; CI also builds macOS/Linux artifacts. Packaged builds check GitHub Releases for updates and install them only after the user confirms a restart. Signing, publishing, and local acceptance are documented in the [release guide](docs/desktop-release.md).

English is the default for repository documentation. Chinese translations are maintained as paired `*_zh.md` files, including [README_zh.md](README_zh.md).

Old review documents, the original proposal, and screenshot research material have been removed. The current implementation record is [the remediation plan](docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md).

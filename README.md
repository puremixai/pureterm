# PureTerm

[中文版本](README_zh.md)

PureTerm is an SSH/SFTP client built with Cordis, ssh2, and xterm.js. It provides two local entry points: an Electron Desktop app and a standalone local Web app. SSH connections are always initiated by the user’s computer; the Web server binds only to the local loopback interface and provides no public service, accounts, or user isolation.

The project is released under the [MIT License](LICENSE).

The current source version is `0.1.0-alpha.1`, maintained in [VERSION.txt](VERSION.txt) and described in the [development guide](docs/DEVELOPMENT.md).

Both entry points reuse the Host, protocol, shared Web Host assembly, and Cordis Client. Desktop starts an independent Node-mode Web Host child process from Electron. Its `pureterm-app://app/` window sends SSH/SFTP, host, and Keychain traffic over a loopback WebSocket; standalone Web runs the same assembly in an ordinary Node process without starting Electron.

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

### Choose how to connect

| Client | How to open it | Host and credential policy |
| --- | --- | --- |
| Desktop window | `npm run start:desktop` | Electron starts a Web Host child; credentials and Keychain keys can use system-encrypted storage, with native private-key selection |
| Browser attached to Desktop | Start Desktop, then open its tokenized URL from the startup log | Shares Desktop's Web Host, saved hosts, encrypted credentials, and native private-key selection; each client owns its SSH sessions |
| Standalone Web | `npm run start:web`, then open the printed URL | An independent Node Web Host with separate data; credentials and Keychain keys remain in the current client session and must be supplied again after a refresh |

Desktop's attached browser entry is enabled by default. Set `SSH_CORDIS_NO_WEB_CARRIER=1` to disable it; the Desktop window and its internal Web Host continue to work. This setting does not disable the standalone Web command. Keep independent Desktop and Web processes on separate data directories. See the [Desktop guide](apps/desktop/README.md) and [local Web guide](apps/web/README.md).

## Working with connections

- Hosts is a permanent management tab. A single click selects a saved host without changing pages; use its Edit action to open the editor. Double-clicking a host opens a new terminal tab. Each connection gets a separate tab, including repeated connections to the same host.
- Tabs keep independent input, output, scrollback, connection state, and SFTP directories. Switching tabs or returning to Hosts leaves other connections running. The Files panel uses the selected SSH session and reserves space below its terminal.
- Disconnect retains output for inspection. Reconnect retries in the same tab; failed connections provide logs, retry, and host editing. Closing a tab releases only that session. A tab closed during its handshake releases the connection if the handshake later succeeds.
- Create hosts through **New Host** and double-click a host card to connect; use Ctrl+Tab / Ctrl+Shift+Tab to switch tabs and Ctrl/Cmd+W to close the current terminal tab. Tab buttons also support arrow keys, Home, and End. Browsers may reserve some shortcuts; the visible controls remain available.

Open sessions and retry credentials live only in the current client; they are not restored after a reload. SFTP currently supports directory navigation, upload/download (up to 4 MiB per file), folder creation, and deletion with confirmation. Serial connections, port forwarding, SSH certificate authentication, Windows Hello, FIDO2, and snippet management are not implemented and are not shown as working controls.

## Working with Keychain

- Open **Keychain → New key**, enter a label, then paste, choose, or drag in a private-key file (OpenSSH, PEM, or supported PPK; up to 256 KiB). Enter the passphrase for an encrypted key and save. The SSH parser validates the key and derives its type, public key, and SHA-256 fingerprint; an optional supplied public key must match.
- Single-click a card to select it; use **Edit** to rename or replace the key. Stored private material and passphrases are never returned to the editor. Leave the private-key field empty when renaming. Search by label, type, or fingerprint, switch card/list views, and copy the saved public key.
- In a host's **Private key** authentication settings, select the saved Keychain entry, save the host, then connect in its own terminal tab. The Host resolves the key ID internally. Direct private-key file selection remains available.
- Desktop stores a dedicated atomic, system-encrypted `keychain.json` vault with no plaintext private material; unavailable encryption fails the save. Web keeps imported keys and host-key associations only in that client's Host memory and clears them on disconnect/reload. A key used by a saved host cannot be deleted until that host's authentication is changed or the host is removed. Deletion requires confirmation and cannot be undone.

## Architecture and upstream reference

The Desktop architecture follows [deepseek-harness's Desktop implementation at `00102833`](https://github.com/deepseek-ai/deepseek-harness/tree/00102833dfaee1da9f48a3a8eae9d34005a75218/apps/desktop), the reference snapshot synchronized on 2026-09-23. PureTerm adapts the shared Web Host and Electron shell pattern to its SSH/SFTP client.

- `@pureterm/transport/web-host` assembles the Cordis Host, dispatcher, and loopback HTTP/WebSocket carrier for both entry points.
- Electron serves the shared UI at `pureterm-app://app/` while its Node-mode child starts. The minimal `window.puretermDesktop` bridge provides the WebSocket address after Host readiness and accepts the renderer's readiness report. SSH/SFTP, hosts, and Keychain operations use WebSocket.
- Electron main owns the window, system encryption, native key picker, and child lifecycle. It injects the Desktop authentication token into the owned window's WebSocket request without exposing that token to the page. Private parent/child RPC carries platform capabilities and startup/shutdown coordination.

For internal integrations, the old `window.sshAPI` and SSH business IPC have been removed. Existing SSH data directories remain unchanged. See the [architecture guide](docs/architecture.md) for process boundaries and lifecycle, and the [changelog](CHANGELOG.md) for migration details.

## Verification

```powershell
# Clean build, type/dependency-boundary checks, Node and local protocol tests
npm run verify

# Desktop boot / custom-scheme WebSocket / attached Web and a real-browser check of standalone Node Web
npm run verify:electron
```

Tests use the repository’s local SSH/SFTP fixtures and temporary data directories. The second command requires a desktop environment; an Electron startup limitation is a failed check, not a pass.

## Repository entry points

| Path | Contents |
| --- | --- |
| `apps/desktop/` | Electron shell, Node-mode Web Host child entry, platform adapters, startup diagnostics, and tests |
| `apps/web/` | Standalone local Node Web entry point and tests |
| `packages/host/` | Cordis Host, SSH/SFTP, host storage, and credential interfaces |
| `packages/protocol/` | Transport protocol and shared data structures |
| `packages/transport/` | Shared Web Host assembly, request dispatch, and HTTP/WebSocket carrier |
| `packages/ui/` | Shared terminal, file panel, and browser transport for both entry points |
| [VERSION.txt](VERSION.txt) | Source version baseline for all workspaces and release tags |
| [docs/architecture.md](docs/architecture.md) | Current architecture, lifecycle, and data boundaries |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development, verification, and contribution workflow |
| [LAYOUT-PROPOSAL.md](LAYOUT-PROPOSAL.md) | Current directory and shared-module decisions |

The repository uses npm workspaces. Shared packages are referenced through public exports, and the root `package-lock.json` is the only installation lockfile. Versions and user-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md); `npm run release:check` validates version alignment and release entries in CI. `npm run dist:desktop -- --win --x64` creates a Windows installer; CI also builds macOS/Linux artifacts. Packaged builds check GitHub Releases for updates and install them only after the user confirms a restart. Signing, publishing, and local acceptance are documented in the [release guide](docs/desktop-release.md).

English is the default for repository documentation. Chinese translations are maintained as paired `*_zh.md` files, including [README_zh.md](README_zh.md).

Old review documents, the original proposal, and screenshot research material have been removed. The [architecture](docs/architecture.md) describes current behavior; dated plans under `docs/superpowers/` preserve historical decisions.

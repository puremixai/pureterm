# PureTerm Architecture

[中文版本](architecture_zh.md)

PureTerm has two runtime entry points, Electron Desktop and standalone local Web, backed by four npm workspace packages: Host, protocol, transport, and UI. SSH/SFTP connections are always initiated by the user’s computer, and HTTP services bind only to `127.0.0.1`. There are no user accounts, tenant isolation, or remote-control tunnels.

The paths below are relative to the repository root. See the [repository guide](../README.md) for commands and the [layout decision](../LAYOUT-PROPOSAL.md) for the physical layout.

## Runtime modes

| Entry point | Host process | UI and communication | Default data directory |
| --- | --- | --- | --- |
| Desktop | independent Node-mode Web Host child process | `pureterm-app://app/` window and optional local browser use the child-owned loopback WebSocket | `~/.ssh-cordis/` |
| standalone Web | ordinary Node process | local browser over HTTP/WS | `~/.ssh-cordis/web/` |

Desktop’s window and optional attached browser share one Web Host in the child process. Standalone Web creates a separate Web Host with the same `startWebHost()` assembly; the applications do not automatically share active sessions or data files. Electron launches the child in Node mode, and that entry does not load the Electron API.

## Requests and events

```mermaid
flowchart LR
  U[Cordis Client / xterm] --> T[Client transport]
  T --> W[Loopback WebSocket]
  W --> D[Node Web Host child / dispatcher]
  B[Attached local browser] --> W
  W2[Standalone Web browser / WebSocket] --> D2[In-process Web Host / dispatcher]
  D2 --> H[Public Host API]
  D --> H
  H --> C[Cordis services and plugins]
  C --> S[ssh2 / SSH / SFTP]
```

`packages/protocol/src/protocol.ts` defines channels, capabilities, requests, results, events, and the binary wire format. `packages/transport/src/web-host.ts` assembles Host, dispatcher, and HTTP/WS carrier once for both entries. The dispatcher maps the protocol to public Host methods; each WebSocket supplies client identity. The transport restores binary payloads to bytes without converting terminal chunks to strings.

Events return through `RendererBridge` / `RendererHandle` to the corresponding client. IDs are opaque WebSocket client IDs; Host does not interpret Electron `webContents`. Client routing is separate from credential capabilities: an entry point injects `CredentialProvider` into `SessionStore`, while `RendererBridge` does not encrypt or decrypt data.

## Module responsibilities

| Location | Responsibility |
| --- | --- |
| `packages/host/src/host.ts` | assemble Cordis Context, export Host, and manage connection/plugin-tree lifecycle |
| `packages/host/src/services/`, `plugins/` | SSH, TOFU, host storage, terminal/SFTP bridge, and logging |
| `packages/host/src/credentials.ts` | credential-provider interface and default session-only policy |
| `packages/protocol/` | environment-neutral protocol and shared data structures |
| `packages/transport/` | shared Web Host assembly, dispatcher, HTTP/WS, and readiness validation |
| `packages/ui/` | Cordis Client, page, terminal, SFTP, client transport, and browser key selection |
| `apps/desktop/electron/app/` | Electron startup, windows, system encryption, native file picker, and update adapter |
| `apps/desktop/electron/host/` | Node Host child entry with no Electron import |
| `apps/desktop/electron/runtime/` | platform policy, readiness, profiles, child/RPC control, update coordination, and resource paths |
| `apps/desktop/electron/carriers/` | minimal CommonJS preload bootstrap and readiness report |
| `apps/desktop/electron/diagnostics/` | in-process startup and smoke hooks |
| `apps/web/src/` | Node CLI, data directory, and standalone policy injected into shared Web Host |

The `services/` and `plugins/` names preserve the existing business grouping; they are not a strict Service/function-plugin classification. Public Host types are exported from the package entry, so applications do not access internal implementations.

## Dependencies and build

The root `package.json` declares workspaces and the root `package-lock.json` is the only lockfile. Packages reference one another through public exports; relative source imports are limited to modules inside a package. Shared Host has no Electron or UI dependency, UI imports neither Node nor Host, and protocol has no module dependency. Applications and transport never read `Host.internals`; the internal view exists only for tests and diagnostics.

`scripts/check-boundaries.mjs` uses the TypeScript AST to check imports, exports, dynamic imports, `require`, and internal access; the rules are exercised in a temporary fixture project. This is a dependency constraint, not runtime security isolation. Each package and application has its own type check; browser builds use DOM types and Node/Electron builds use their corresponding environments.

Root build scripts build shared packages first, then the selected entry, and clean the corresponding `dist/`. The shared UI produces one `packages/ui/dist/{index.html,app.js,app.css}`. Both entries locate it through the `@pureterm/ui/index.html` package export. Desktop serves those files through the secure `pureterm-app://app/` scheme and locates `dist/electron/carriers/preload.cjs` by compiled module location. The standalone Web entry is `apps/web/dist/main.js`. None of these paths depend on the launch cwd.

## Lifecycle

Desktop applies platform policy, registers the custom scheme and scoped WebSocket authorization, starts the Node Web Host, and creates a shell generation while Host startup continues. The page loads immediately; its minimal preload waits for Host readiness before receiving the loopback WebSocket URL. Each window generation, listener, and watchdog has an idempotent release path; window operations read the current generation. The readiness gate accepts a launch profile only after the current main frame reports `renderer-ready`; loaded HTML alone does not mean the application is usable.

Private parent/child IPC carries startup, shutdown, encryption, and native key-picker capabilities. The main process holds a separate Desktop bearer token and injects it only into the current application window’s exact Host WebSocket request, rewriting Origin to the loopback Host. The token never reaches page URLs, DOM, preload bootstrap, logs, or storage. An unexpected Host exit reports an error and ends the application. Application exit, startup failure, diagnostics, and updates wait for the child to close and terminate it after the deadline. Closing or crashing a renderer closes its WebSocket and releases its sessions; other browser clients continue while the Host remains running. Closing the last window exits the app on Windows/Linux, while macOS keeps the Host available for window reactivation.

Standalone Web injects the default session-only policy into the shared Web Host and then listens on the loopback port; a listen failure unloads Host. Ctrl+C/SIGTERM closes the carrier and all SSH sessions. A WebSocket disconnect calls `Host.releaseClient()`, promptly closing idle sessions owned by that client and cancelling an unfinished SSH handshake; other clients continue running.

If Host creation fails, already assembled services are unloaded. Host shutdown first cancels connection and encryption waits, waits for accepted storage mutations, and then unloads the plugin tree; after shutdown, new connections and mutations are rejected. Save/remove operations are serialized, and new state is not committed before encryption completes. If an `opened` event cannot reach its client, cleanup still runs so a browser-close/handshake race cannot leave a connection behind.

The shared Client is a Cordis Context created by `createClient()`. It installs view, transport, terminal, Keychain, hosts, SFTP, and application/readiness services in order, with dependencies declared through `inject`. Each scope releases DOM listeners, transport subscriptions, `ResizeObserver`, timers, private-key drafts, and terminal resources. The root can be unmounted and mounted again; unloading a dependency scope unloads its dependents. Client disposal closes its WebSocket and releases its Host sessions.

Desktop retains sandbox, GPU, launch-profile, and restart behavior. `SSH_CORDIS_NO_SANDBOX_FALLBACK=1` disables automatic no-sandbox fallback and profile backfill; `SSH_CORDIS_NO_LAUNCH_PROFILE=1` disables profile reads and writes. Profiles are not separated for CI, containers, and daily use; tests use temporary directories.

### Terminal tab ownership

`ClientTerminal` owns a collection of tab records, each with an xterm instance, immutable connection-request snapshot, status, logs, and an optional Host session ID. Hosts is a separate permanent page. Selection changes visibility and sizing only; background output is routed by session ID. A disconnect retains its tab and scrollback, whereas closing a tab disposes that terminal and closes only its SSH session.

Concurrent handshakes are associated with tabs using their own `open()` RPC replies, not the currently selected tab or `opened` event order. Events preceding the reply are buffered by session ID with a 1 MiB per-session limit. Closing a pending tab removes its view immediately and closes a subsequently returned session; the existing protocol does not provide per-open-request cancellation. Client disposal still releases all sessions and pending handshakes through the transport. WebSocket loss reports closure for every tracked session.

`ClientSftp` shares one rendered panel but retains directory, visibility, busy state, and navigation revision per session. Async results only update their owning state, so a background request cannot overwrite the selected tab's files. Closing/disconnecting a session invalidates its file state. Retry credentials remain in client memory for the tab lifetime and are not serialized as session restoration data. No Host or wire-protocol change is required.

## Data and entry capabilities

Desktop overrides its data directory with `SSH_CORDIS_DATA_DIR`. `hosts.json` stores host metadata and either a private-key path or a Keychain key ID; `secrets.json` stores host credential ciphertext; `known_hosts.json` stores TOFU fingerprints; `launch-profile.json` stores the ready launch configuration. safeStorage remains in the main process, and Host’s asynchronous `CredentialProvider` calls it over private IPC. Without a usable system encryption backend, the app does not fall back to plaintext persistence. Directly selected private-key files are read at connection time and are not copied into host storage. The attached local browser uses the same encryption and native picker capabilities.

Keychain imports use a separate `keychain.json` vault: each entry contains an opaque ID and system-encrypted JSON holding its metadata, private key, and optional passphrase. Writes use a same-directory temporary file (0600) and atomic rename; an encryption or write failure leaves the prior vault intact. Startup decrypts only to build public metadata, and authentication decrypts the selected entry inside Host; list/save replies never include private material. Host serializes key and host mutations together, rejects invalid references, prevents deletion of referenced keys, and drains accepted writes before shutdown. `keys:list/save/remove` traverse the shared dispatcher and WebSocket carrier. SSH certificates and hardware-backed keys are outside this implementation.

The client-only `SshApi.onDisconnected()` subscription propagates WebSocket generation loss even without an SSH session. Keychain clears unsaved drafts on transport loss; session-only clients additionally clear key cards and cached host-key references without requiring a page reload. UI operation ownership prevents an old save/delete refresh from unlocking a newer request. Switching a shared Web host away from private-key authentication invalidates its associations in every client, and explicitly supplied private-key content takes precedence over an implicit session association.

Standalone Web accepts `--data-dir` or `SSH_CORDIS_WEB_DATA_DIR`, with the command-line option taking precedence. It stores `hosts.json` and `known-hosts.json`, never reads or writes credential or Keychain vault contents, never persists a private-key path or Keychain association, and reports `hasSecret: false` in public records. Requests to remember a password or passphrase are ignored. Imported keys and host-key associations stay in per-client Host maps, are inaccessible to other clients, and are removed by `releaseClient()`. Queued mutations from a released client are cancelled. If the directory contains a credential vault or legacy embedded ciphertext, Host rejects it explicitly and does not migrate or overwrite the original.

The browser File API reads private-key content and never treats the filename as a local absolute path. Passwords, private keys, and passphrases stay in the current page and must be entered again after a refresh. UI capabilities select browser or native key picking and disable credential memory for standalone Web. The two processes use separate default files; custom directories must also avoid concurrent writes to the same JSON store.

Browser HTTP resources and WebSockets require the startup token or its session cookie and validate the local Host header and Origin. Desktop’s internal WebSocket instead accepts the main-process bearer credential. The bind address cannot expand to a public interface. A new browser token is generated for each launch and removed from the address bar after page initialization. `SSH_CORDIS_NO_WEB_CARRIER=1` disables only Desktop’s attached ordinary-browser entry; its internal Web Host and the standalone Web launcher still work.

SFTP reuses an established SSH session and supports directory browsing, single-file upload/download, directory creation, and deletion. The shared protocol’s `MAX_TRANSFER_BYTES` limits one file to 4 MiB; the current implementation reads the complete file and has no streaming, resume, progress reporting, or rename operation.

## Verification and upstream relationship

Root `verify` builds every project and runs type, boundary, Host child-process/credential, update-coordinator, packaging-isolation, UI, standalone Web, and SSH/SFTP/HTTP/WS protocol tests. Root `verify:electron` covers Desktop custom-scheme boot, WebSocket SSH/Keychain traffic, attached Desktop Web, renderer-crash cleanup, real updater download and checksum validation, standalone Node Web, and Client-scope lifecycle. Electron acts only as the test browser in the standalone Web flow; the service still starts in ordinary Node.

Electron checks use an isolated user directory, controlled windows, strict success/failure/exit/timeout signals, and process-tree cleanup. Automatic no-sandbox fallback is disabled, so both generations of real Electron fallback are outside this check. GUI mouse/keyboard acceptance is outside these commands, and the local ssh2 fixture does not cover every real sshd implementation.

The upstream reference is locked to deepseek-harness commit `00102833dfaee1da9f48a3a8eae9d34005a75218`. PureTerm follows its thin Desktop wrapper and Cordis dependency/scope model while keeping an independent Node-mode Web Host, shared Cordis Client, installer build, and update coordination. Private Node IPC is reserved for platform capabilities and lifecycle; business traffic uses WebSocket. PureTerm does not add upstream Agents or dynamic plugin management.

Installers are built from independent staging with physical production dependencies and shared resources, and asar is disabled to keep child-process files real. Windows uses NSIS, macOS uses dmg+zip, and Linux uses AppImage. Packaged builds check and download updates from GitHub Releases and stop Host before a user-confirmed restart. Development builds do not check; local and ordinary CI runs do not publish; a tag job creates a draft. Versions and user-visible changes are kept in the root [CHANGELOG.md](../CHANGELOG.md), and `scripts/changelog.mjs` checks workspace versions and extracts draft notes. Signing, notarization, platform builds, and acceptance limits are in the [release guide](desktop-release.md).

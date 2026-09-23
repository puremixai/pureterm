# Shared Web Host Desktop Design

[中文版本](2026-09-23-upstream-web-host-design_zh.md)

## Intent and baseline

Update the local deepseek-harness reference and follow its Desktop thin-wrapper architecture while preserving PureTerm SSH/SFTP, Keychain, independent local Web and platform credential behavior. The reference is `deepseek-ai/deepseek-harness@00102833dfaee1da9f48a3a8eae9d34005a75218`, fetched on 2026-09-23. Its `apps/desktop/src/{main,host-process,web-document}.ts` and README are reference inputs, not inherited repository instructions.

## Design

- Extract shared `startWebHost()` assembly into `@pureterm/transport/web-host`: Cordis Host, dispatcher, HTTP/WS carrier, client cleanup, startup rollback and shutdown. Standalone Web injects session-only credentials; Desktop injects asynchronous platform credentials.
- The Desktop Electron Node-mode child owns this entire Web Host. Parent/child private RPC carries startup, shutdown, encryption and native key selection only. Remove business request/event forwarding and the Electron SSH IPC carrier.
- All SSH, host, Keychain and SFTP operations use the existing WebSocket protocol and byte encoding in both entry points. Keep the existing public business API and transfer limits.
- Electron registers the secure standard `pureterm-app` scheme and serves the packaged UI at `pureterm-app://app/`. The page loads immediately and waits for a minimal preload bootstrap containing only the loopback WebSocket URL. The preload also reports renderer readiness; it exposes no SSH API, credentials or generic IPC.
- The main process alone owns a separate Desktop bearer token returned by the child. It injects authorization only for the current application window's exact Host WebSocket URL and expected application Origin, rewriting Origin to the loopback Host. Never put this token in page URLs, DOM, renderer bootstrap, logs or storage. Ordinary browser token/cookie authentication stays separate.
- `SSH_CORDIS_NO_WEB_CARRIER=1` disables the attached ordinary-browser access; the internal Desktop Web Host remains available. Loopback-only binding, Host/Origin checks and session-only standalone Web policy remain mandatory.
- Closing or crashing a renderer closes its WebSocket and releases its SSH sessions and unfinished handshakes. Other browser clients continue while the application keeps its Host running; the existing platform policy still exits the application when its last window closes on Windows/Linux. Application exit, Host failure, startup failure and update use bounded Host shutdown. Readiness is accepted only from the current owned main frame.
- Preserve Desktop/Web data paths, encrypted Keychain, terminal tab state, retry behavior, SFTP bytes and update behavior. No new agent framework, package manager, dynamic plugin manager or multi-tenant features are introduced.

## Verification

Add focused tests for shared assembly rollback, Desktop-only authentication, rejected stale/foreign requests, bootstrap disposal, custom-scheme path/MIME/method handling, Host process loss and client disconnect. Update real Electron checks to prove custom-scheme loading, no exposed SSH IPC, WS SSH/SFTP/Keychain operations, renderer-crash cleanup and independent attached clients. Run root `verify`, `verify:electron`, release metadata and Markdown links. Run isolated Windows package acceptance after staging changes; report environment limitations separately from passing results.

# Desktop Runtime and Release

[中文版本](2026-09-16-desktop-runtime_zh.md)

> **Landed historical specification (2026-09-16):** This file records the implementation boundaries for Desktop runtime, installers, and updates. The implementation has been merged into `main`; current architecture and release operations are defined by the [architecture](../../architecture.md) and [release guide](../../desktop-release.md).

At the time of authorization, four items were unfinished: an independent Desktop Host process, the Client Cordis plugin tree, installers, and auto-update. The channel was confirmed as GitHub Releases, with Windows acceptance on the local machine and CI builds for macOS/Linux.

## Boundaries

- The Electron main process owns windows, IPC/local HTTP carriers, native file selection, safeStorage, the updater, and child-process lifecycle. The Node Host child owns shared Host, SSH/SFTP, host records, and dispatcher. A private, versioned parent/child IPC channel carries requests, byte events, client-leave notifications, and a small set of platform capabilities.
- The main process starts Host and installs carriers before mounting the window. Exit, startup failure, update installation, and parent disconnect clean up Host; shutdown has a deadline and forced-termination fallback. An unexpected Host exit rejects pending requests and notifies the user.
- safeStorage remains in Electron and the Host credential provider is asynchronous; saves are serialized. Standalone Web continues to store host information only, with passwords and browser-selected private keys limited to the session.
- Client is a real Cordis Context: transport, terminal, hosts, SFTP, and readiness declare explicit dependencies. DOM, event subscriptions, sockets, xterm, observers, and timers are released by plugin scopes so unmount/remount is safe.

## Packaging and updates

- Use electron-builder 26.15.3 and electron-updater 6.8.9. Independent staging contains physical production dependencies and all child/renderer/preload resources and does not depend on the repository cwd or workspace links. The first version disables asar to avoid a virtual filesystem dependency for the independent Node entry.
- Windows x64 uses NSIS; macOS uses dmg + zip for x64/arm64; Linux uses an x64 AppImage. Local and ordinary CI runs do not publish. A version tag’s release job aggregates artifacts into a GitHub draft Release.
- Packaged builds check for updates in the background and expose a manual check. After download, the user confirms a restart; the app stops Host before handing off to the updater. Network errors do not block startup, and development or unsupported modes clearly report that updates are unavailable.
- This implementation and its tests do not create an online release. Signing and notarization use CI secrets; an unsigned local installer does not prove formal distribution signing.

## Acceptance

Verify asynchronous credentials, process ready/failure/parent-disconnect/exit-timeout paths, real SSH/SFTP bytes, Client-scope unmount/remount, update state/single-flight/cleanup/install ordering. Run project build, typecheck, boundary, Node, and Electron acceptance; generate a Windows NSIS package and run it from an isolated install directory. macOS/Linux platform results come from CI.

Upstream baseline: deepseek-harness `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`; compare its Desktop host process, desktop-host entry, Client boot, and update coordinator. Keep PureTerm’s existing local Web and single-user scope; do not add Agents, multi-tenancy, or public service.

# Desktop Runtime Implementation Plan (Historical Execution Record)

[中文版本](2026-09-16-desktop-runtime_zh.md)

> **Completed historical plan (2026-09-16):** This file records the Desktop runtime implementation steps; the implementation has been merged into `main`. Current architecture and release operations are defined by the [architecture](../../architecture.md) and [release guide](../../desktop-release.md). This is not an unfinished task list.

1. Converted `CredentialProvider` and the save flow to asynchronous operations and verified concurrency, atomic failure behavior, and the session-only Web policy.
2. Implemented parent/child RPC, the Node Host entry, and process controller; connected Desktop startup, client disposal, failure, and exit paths, and used a real child process to verify SSH/SFTP and lifecycle behavior.
3. Composed the shared UI as Cordis transport/terminal/hosts/SFTP/readiness plugins; completed transport unsubscribe/dispose and verified remounting and dependency cleanup.
4. Implemented the update coordinator and menu entry; verified duplicate checks, download errors, manual prompts, Host shutdown before installation, and cleanup.
5. Added physical staging, electron-builder, cross-platform CI, and draft Release flow; generated an NSIS package locally and completed isolated install/start acceptance.
6. Updated architecture, usage, and release documentation, ran full verification, and reviewed the integrated diff. Signing and final acceptance on other platforms remain subject to their CI and target machines.

The work was parallelized at the time: Host credentials, shared UI, and packaging/CI were edited independently, while the main task handled process boundaries, updates, assembly integration, dependency locking, and final verification.

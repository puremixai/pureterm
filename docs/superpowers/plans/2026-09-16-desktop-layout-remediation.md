# Desktop Layout and Verification Remediation (Historical Execution Record)

[中文版本](2026-09-16-desktop-layout-remediation_zh.md)

> **Historical record (2026-09-16):** This plan has been implemented; the original `chore/desktop-layout-remediation` branch was later merged into `main`. Current directories, runtime boundaries, and verification entry points are defined by [LAYOUT-PROPOSAL.md](../../../LAYOUT-PROPOSAL.md), the [architecture](../../architecture.md), and the [release guide](../../desktop-release.md). This file preserves the remediation process, durable criteria, and options explicitly rejected at that time.

## Objective and baseline

The objective was to correct factual and execution problems in the directory proposal so Electron Desktop could be cloned, verified, and developed further. The baseline was `907e940`. The stack remained Electron, TypeScript, Cordis, ssh2, xterm, esbuild, and the npm lockfile; tests used Node’s built-in capabilities and local SSH/HTTP/WS fixtures without adding a test framework.

## Durable criteria retained

- Assemble applications by entry point and provide shared capabilities through packages; do not copy deepseek-harness’s scale of nested packages, hundreds of workspaces, or multi-language document machinery.
- Business code does not depend on Electron; UI does not import Node or Host; protocol is environment-neutral; cross-package references use public exports.
- Electron APIs stay in the necessary shell, carrier, preload, and diagnostic adapters; production code never reads `Host.internals`.
- Root `typecheck` and boundary checks enforce constraints; documentation alone is insufficient.
- Tests are versioned with code; historical pass counts do not replace reproducible current verification.

## Options explicitly rejected at the time

The original plan required an in-process Host, no independent Host, no client plugin tree, no workspace, and no installer/update mechanism. Those were temporary scope constraints and were superseded by the Desktop runtime implementation plan. The current implementation uses an independent Node Host, a static Client plugin tree, workspaces, installers, and update coordination.

The following splits still depend on scale and consumers: do not create a second provider package without a second SSH implementation; do not split carriers into multiple npm packages until there are enough independent consumers; and do not split frontend directories merely for naming when files have no independent change boundary. Do not copy upstream’s two-level `packages/<group>/<package>` layout, multi-tenancy, Agents, or dynamic npm plugin management directly into this project.

## Execution result

- Restored and added executable tests and fixtures, removed test-directory ignore rules, and established build, type, dependency-boundary, Host, SSH/SFTP, HTTP/WS, and startup-diagnostic verification.
- Migrated application/Electron responsibilities, build entries, and resource paths; shared Host, protocol, transport, and UI now form the root workspace with one root `package-lock.json`.
- Desktop uses an independent Node Host child process; shared UI is a Cordis Client; installer, GitHub Releases update, and draft-publishing flows were completed by the later runtime work.
- Updated the proposal, README, layout, architecture, and release documents; screenshot tooling is not product code and has been removed.
- The original remediation branch was committed and merged into `main`; the later CHANGELOG workflow was merged as well. Current version operations are in [CHANGELOG.md](../../../CHANGELOG.md).

## Historical verification boundary

The remediation confirmed artifact paths, CommonJS preload, page resources, dependency boundaries, Host lifecycle, real local SSH/SFTP, HTTP/WS authentication, and Electron startup diagnostics. The original baseline lacked traceable smoke files, so old pass numbers were not reused.

Mouse/keyboard GUI flows, every real remote sshd, signed installers on other operating systems, and cross-version upgrades were not completion criteria for this directory remediation. Current complete verification and installer acceptance use `npm run verify`, `npm run verify:electron`, `npm run verify:package:windows`, and the [release guide](../../desktop-release.md).

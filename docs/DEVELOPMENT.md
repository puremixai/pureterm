# PureTerm Development Guide

[中文版本](DEVELOPMENT_zh.md)

This guide describes the local development workflow for PureTerm. PureTerm is a TypeScript/Cordis SSH and SFTP client with an Electron Desktop entry point and a standalone local Web entry point. Both entry points initiate SSH from the user’s computer; the Web server binds only to `127.0.0.1` and is not a public service.

The [architecture](architecture.md) is the source of truth for runtime behavior, the [layout decision](../LAYOUT-PROPOSAL.md) is the source of truth for package boundaries, and the [release guide](desktop-release.md) is the source of truth for installers and GitHub Releases. Dated records under [`docs/superpowers/`](superpowers/) preserve historical decisions and are not current task lists.

## Development environment

Use Node.js 24 or newer and npm. On Windows, run commands in PowerShell. Keep documents and new text in UTF-8. The root `package-lock.json` is the only lockfile; install dependencies from the repository root:

```powershell
npm ci
```

Do not run a second install from `apps/` or `packages/`, and do not commit `node_modules/`, `dist/`, `.release/`, or `release/` output.

Start the entry points from the repository root:

```powershell
# Standalone local Web; open the tokenized URL printed in the terminal
npm run start:web

# Electron Desktop
npm run start:desktop
```

`start:web` builds the shared packages and launches an ordinary Node process. `start:desktop` builds the shared packages and Electron entry, then launches Desktop. Web uses a random loopback port by default; press Ctrl+C to stop either process.

The default data directories are `~/.ssh-cordis/` for Desktop and `~/.ssh-cordis/web/` for standalone Web. Keep these directories separate. Tests use temporary directories and must never point at a normal user data directory.

Useful environment variables:

| Variable | Purpose |
| --- | --- |
| `SSH_CORDIS_DATA_DIR` | Override Desktop data directory |
| `SSH_CORDIS_WEB_DATA_DIR` | Override standalone Web data directory |
| `SSH_CORDIS_NO_WEB_CARRIER=1` | Disable Desktop’s attached local Web carrier |
| `SSH_CORDIS_NO_LAUNCH_PROFILE=1` | Disable Desktop launch-profile reads and writes |
| `SSH_CORDIS_NO_SANDBOX_FALLBACK=1` | Disable automatic Electron no-sandbox fallback |

Do not commit `.env` files, passwords, private keys, tokens, certificates, or real host records. Desktop credentials use the operating-system encryption provider. Standalone Web stores host metadata and trusted fingerprints only; passwords, passphrases, and browser-selected private-key content stay in the current page.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/desktop/` | Electron shell, platform adapters, Node Host child entry, carriers, diagnostics, and Desktop tests |
| `apps/web/` | Standalone local Web Node entry, HTTP/WS server, CLI, and tests |
| `packages/protocol/` | Environment-neutral requests, capabilities, events, and binary wire format |
| `packages/host/` | Cordis Host, SSH/SFTP services, host storage, fingerprints, and credential interfaces |
| `packages/transport/` | Dispatcher, HTTP/WebSocket carriers, client identity, and readiness validation |
| `packages/ui/` | Browser Cordis Client, terminal, host list, SFTP panel, and browser key picker |
| `scripts/` | Root workspace build, type, boundary, staging, Windows package, and changelog checks |
| `docs/` | Current architecture/release/development docs and dated historical records |
| `.github/workflows/` | Cross-platform Desktop build and GitHub Releases draft workflow |

Organize additions by entry point or capability. A new package needs an independent responsibility, a consumer, and a verification boundary. Do not copy deepseek-harness’s package scale, Agent model, dynamic npm plugin management, or multi-tenant service model into PureTerm.

## Dependency and runtime boundaries

The allowed dependency direction is enforced by `npm run check:boundaries` and `npm run typecheck`:

- `@pureterm/protocol` imports no local package, Node, Electron, or UI code.
- `@pureterm/host` owns SSH/SFTP and storage but does not depend on Electron, UI, or application entry points.
- `@pureterm/ui` is browser-only and does not import Node, Electron, or Host.
- `@pureterm/transport` calls the public Host API and never reads `Host.internals`.
- Electron APIs stay in Desktop `electron/app/`, carriers, preload, and diagnostics. `electron/runtime/` and `electron/host/` have no Electron import.
- Cross-workspace imports use public package exports. Relative imports into another package’s source are prohibited.

Desktop starts an independent Node Host child process and communicates through a versioned private RPC channel. The parent owns the window, native file picker, safeStorage, update coordinator, and child lifecycle. Standalone Web assembles its own Host in an ordinary Node process. Shared code does not mean shared sessions or shared data files.

Client, carriers, and Host must expose explicit disposal paths. Parent/child IPC preserves `Uint8Array`; terminal and SFTP bytes must not be converted to strings prematurely. WebSocket disconnects and renderer failures must release the sessions owned by that client.

## Quality checks

Run focused checks while developing:

```powershell
npm run typecheck
npm run check:boundaries
npm run test:unit
npm run release:check
```

`test:unit` runs the Node test files under Desktop, Web, Host, and UI. It uses repository fixtures, random loopback ports, and temporary data directories. Tests must not connect to a user’s remote host or overwrite user SSH data.

Before merging code, dependency, or build-script changes, run the full Node verification:

```powershell
npm run verify
```

`verify` performs a clean build, type and boundary checks, unit tests, Host child-process checks, credential tests, update-coordinator tests, packaging-isolation tests, UI tests, standalone Web tests, and local SSH/SFTP/HTTP/WS smoke checks.

Changes involving Electron windows, IPC, preload, child processes, update behavior, or resource paths require:

```powershell
npm run verify:electron
```

This command verifies Desktop boot, IPC, the attached Web carrier, renderer-crash cleanup, update download/checksum handling, standalone Node Web in a real browser, and shared Client scope lifecycle. A recognized environment limitation, such as an unavailable Electron display, is not a passing result.

Documentation-only changes must run `npm run release:check`, a Markdown relative-link check, and `git diff --check`. Report the actual commands and results in the pull request. Do not use an old `dist/` directory, process existence, or a historical pass count as evidence of success.

## Targeted entry-point checks

Desktop checks are run from the root with the workspace option:

```powershell
npm run boot --workspace=@pureterm/desktop
npm run smoke:electron --workspace=@pureterm/desktop
npm run smoke:web --workspace=@pureterm/desktop
npm run smoke:node --workspace=@pureterm/desktop
npm run smoke:profile --workspace=@pureterm/desktop
npm run diagnose:electron --workspace=@pureterm/desktop
```

Run `npm run build:desktop` before invoking `smoke:node` by itself. The complete `verify` commands already build the required artifacts. Desktop smoke tests use controlled windows and temporary user data; screenshots are best-effort evidence and never replace `renderer-ready` or another explicit success signal.

Standalone Web checks are:

```powershell
npm run build:web
node --test apps/web/tests/*.test.mjs
node apps/web/tests/smoke-browser.mjs
```

The browser smoke test uses Electron only as a test Chromium window. The Web service itself remains an ordinary Node process and must continue to reject non-loopback listeners, invalid startup tokens, invalid Host/Origin headers, and browser fake file paths.

## Building and packaging

Build all workspaces or one entry point from the root:

```powershell
npm run build
npm run build:web
npm run build:desktop
```

Build order is protocol, Host, transport, UI, and applications. Shared UI artifacts are emitted once under `packages/ui/dist/`; application resources are located through package exports or compiled module paths rather than the launch cwd.

Prepare and inspect an installer with:

```powershell
npm run stage:desktop
npm run dist:desktop -- --win --x64
npm run verify:package:windows
```

Staging is disposable and must not be committed. The installer guide documents the self-contained `.release/app` layout, optional native module exclusions, CI artifacts, signing, notarization, update feeds, and acceptance limits. Local and ordinary CI builds use `--publish never`; only the tag workflow creates a GitHub draft release.

## Versions and changelog

The root package and every workspace package use the same semantic version. Check alignment with:

```powershell
npm run release:check
```

Record user-visible changes in the English `[Unreleased]` section of [CHANGELOG.md](../CHANGELOG.md) and mirror them in [CHANGELOG_zh.md](../CHANGELOG_zh.md). Keep categories such as `Added`, `Changed`, `Fixed`, and `Security`. `scripts/changelog.mjs` extracts release notes from the English file; the Chinese file is a translation mirror and is not parsed as a release source.

For a release, set every workspace version to the same value, update the lockfile, move `[Unreleased]` into a dated version section, and run:

```powershell
npm run release:check -- --version 0.2.0
npm run release:notes -- --version 0.2.0 --output release-notes.md
```

Push a matching `v<version>` tag only after `npm run verify`, `npm run verify:electron`, and the Windows package acceptance pass. The release workflow builds Windows NSIS, macOS DMG/ZIP, and Linux AppImage artifacts and creates a draft release; it does not publish the draft automatically. See [Desktop Installers and GitHub Releases](desktop-release.md).

## Documentation and contribution flow

English is the default documentation language. Every maintained Markdown document has a paired `_zh.md` file in the same directory, with a language link at the top. Update both files when commands, paths, behavior, or limits change. Keep current facts in the canonical English document; dated plans and specifications may preserve historical criteria and rejected alternatives but must be labeled as historical.

Before committing:

1. Review the diff for stale paths, secrets, generated artifacts, and accidental changes to deleted historical material.
2. Run the checks appropriate to the change and `git diff --check`.
3. Use a focused branch from `main` and a reviewable commit message.
4. Confirm the worktree is clean and versions/CHANGELOG are synchronized before merging.

Do not reintroduce the deleted `tools/gui/` screenshot tooling or the removed archive, review, and screenshot-research directories into product, test, or release flows. Do not use bare `git push --force`; if history must be rewritten, use `--force-with-lease` after checking the remote.

## Troubleshooting

- **Dependency or type errors after a branch switch:** run `npm ci` from the root, then `npm run build` so no stale package output is used.
- **Standalone Web does not start:** check that the selected port is free and that the bind address remains loopback; use `node apps/web/dist/main.js --help` for supported options.
- **Desktop cannot open:** run `npm run diagnose:electron --workspace=@pureterm/desktop`, inspect `apps/desktop/dist/launch.log`, and use `verify:electron` for the controlled boot checks.
- **A test leaves data behind:** confirm the test uses a temporary data directory and that the carrier, Host, socket, and child process all reach their disposal paths.
- **A package boundary check fails:** import through the package’s public export and move platform-specific code to the permitted Desktop adapter; do not silence the AST check or access `Host.internals`.

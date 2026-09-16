# AGENTS.md

[中文版本](AGENTS_zh.md)

PureTerm is an open-source SSH/SFTP client built with Cordis, ssh2, and xterm.js. It has two local entry points: Electron Desktop and standalone local Web. SSH is always initiated by the user’s computer; local Web binds only to loopback and provides no public service, user accounts, tenant isolation, or remote-control tunnel.

These instructions apply to the whole repository. Before changing `packages/`, `apps/`, or root scripts, read the [architecture](docs/architecture.md) and [layout decision](LAYOUT-PROPOSAL.md). Before changing release behavior, read the [Desktop release guide](docs/desktop-release.md). The [deepseek-harness AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md) is a reference for upstream collaboration practices; this file defines PureTerm’s actual boundaries.

## Documentation language

English is the default reading language for every maintained Markdown document. Keep a complete Chinese translation in the paired `*_zh.md` file in the same directory. Link the Chinese file from the English file and update both files when behavior, commands, paths, or limits change. Code blocks, identifiers, links, and version numbers must remain equivalent. The standard MIT `LICENSE` text remains the canonical legal text in English.

## Current facts and historical material

- Current entry points are `apps/desktop/` and `apps/web/`; shared capabilities are in `packages/host/`, `packages/protocol/`, `packages/transport/`, and `packages/ui/`.
- Electron starts an independent Node Host child process for Desktop; standalone Web assembles Host in its own ordinary Node process.
- The root `package-lock.json` is the only lockfile. Run all install, build, and verification commands from the repository root.
- Current behavior is authoritative in the root `README.md`, `LAYOUT-PROPOSAL.md`, `VERSION.txt`, `docs/architecture.md`, `docs/DEVELOPMENT.md`, `docs/desktop-release.md`, the application READMEs, and `CHANGELOG.md`.
- Dated files under `docs/superpowers/` are historical implementation records and specifications. They may preserve durable criteria, correct advice, and explicitly rejected options, but do not treat them as current commands, paths, branches, or test results. Removed archive, review, and screenshot research material is not a current source.
- Screenshot and mouse/keyboard drivers are not product runtime code or verification entry points. Do not reintroduce the deleted `tools/gui/` directory or related research into build, test, or release flows.

## Repository layout

```text
apps/desktop/       Electron shell, runtime, Host child entry, carriers, and Desktop tests
apps/web/           standalone local Web Node entry, server, and tests
packages/host/      Cordis Host, SSH/SFTP, host storage, and credential interfaces
packages/protocol/  environment-neutral requests, events, capabilities, and binary protocol
packages/transport/ dispatcher, HTTP/WebSocket, carriers, and readiness validation
packages/ui/        Cordis Client, terminal, host list, SFTP, and browser adapters
VERSION.txt         source version baseline shared by all workspaces
scripts/            root workspace build, type, boundary, staging, and release checks
docs/               current architecture/release docs and dated historical records
.github/workflows/  three-platform Desktop build and GitHub Releases draft workflow
```

Organize directories by entry point and capability. Do not copy deepseek-harness’s scale by adding nested package groups, Agents, dynamic npm plugins, or a multi-tenant model. A new package must have an independent responsibility, consumers, and a verification boundary.

## Dependencies and boundaries

- `@pureterm/protocol` has no dependency on local packages, Electron, Node, or the UI.
- `@pureterm/host` does not depend on Electron, the UI, or application entry points; its public API is exported from the package entry.
- `@pureterm/ui` targets browsers only and cannot import Node, Electron, or Host; the page uses a static Cordis Client plugin composition.
- `@pureterm/transport` dispatches through the public Host API and cannot read `Host.internals`.
- Electron APIs may enter only Desktop `electron/app/`, `electron/carriers/`, preload, and diagnostic adapters; `electron/runtime/` and `electron/host/` have no Electron import.
- Cross-workspace references use public package exports; relative source imports are for modules inside one package.
- Keep source checks separate from artifact checks. Tests that require `dist/` must build first so stale artifacts cannot hide source errors.
- A protocol or public-type change in a shared package updates every consumer, test, document, and `CHANGELOG.md`; changing only the provider is incomplete.

## Runtime invariants

- The Desktop Host child process performs a versioned private RPC handshake. On startup failure, window close, renderer crash, update, or exit, the parent waits for Host cleanup and terminates only after the timeout.
- Parent/child IPC uses serialization that preserves `Uint8Array`; terminal and SFTP bytes must not be converted to strings in the transport layer.
- Client, carriers, and Host expose explicit `dispose` paths. Page remounts, WebSocket disconnects, and unexpected Host exits must not leave sessions, listeners, or timers behind.
- Standalone Web binds only to `127.0.0.1`, uses a startup token and session cookie, and validates Origin/Host; do not add a public listening option.
- Desktop credentials use an operating-system encryption provider. Web stores host metadata and trusted fingerprints only, never passwords, passphrases, private-key content, or private-key paths, and uses a data directory separate from Desktop.

## Commands

The environment requires Node.js 24 or newer and npm. Use PowerShell on Windows; documents and new text are UTF-8.

```powershell
npm ci
npm run start:web
npm run start:desktop

npm run build
npm run build:web
npm run build:desktop
npm run typecheck
npm run check:boundaries
npm run test:unit
npm run verify
npm run verify:electron

npm run stage:desktop
npm run dist:desktop -- --win --x64
npm run verify:package:windows
npm run release:check
npm run release:notes -- --version <version> --output release-notes.md
npm run version:generate
npm run version:sync
```

`verify` covers build, types, dependency boundaries, Host/protocol/credential, UI, standalone Web, and local SSH/SFTP/HTTP/WS tests. `verify:electron` covers Desktop boot, IPC, attached Web, renderer-crash cleanup, update downloads, standalone Node Web, and Client lifecycle. Linux Electron checks run under `xvfb-run` in CI. `verify:package:windows` is limited to an isolated Windows install/uninstall flow.

## Test and change verification

- Run the smallest sufficient checks for the change: focused Node tests for protocol/Host/UI logic; `npm run verify:electron` for Electron carriers, processes, updates, or resource paths; and `npm run verify:package:windows` for packaging or staging changes.
- Before merging code, dependency-boundary, or build-script changes, run `npm run verify`. Documentation-only changes must at least run `npm run release:check`, the Markdown link check, and `git diff --check`.
- Report the commands and results that actually ran. A recognized environment limitation with exit code 2 is not a passing test; process existence, old `dist/`, and historical pass counts are not success signals.
- Tests use repository fixtures, random loopback ports, and temporary data directories. They must not connect to a user’s remote host or overwrite user SSH data.
- Tests describe behavior and failure conditions. When old behavior changes, update the relevant tests and explain compatibility impact in the PR.
- Do not repeat the full suite by default. CI owns the platform matrix; expand local verification for cross-repository changes, diagnostic CI changes, or an explicit user request.

## Secrets and local data

- Never commit passwords, private keys, tokens, certificates, `.env` files, or real host records. Release signing reads only GitHub Actions secrets or temporary local environment variables.
- `SSH_CORDIS_DATA_DIR`, `SSH_CORDIS_WEB_DATA_DIR`, and test temporary directories must not point to existing production data. Desktop and standalone Web must never write the same JSON store concurrently.
- Web file selection sends only private-key content read by the current page; never treat a browser-provided filename as a local absolute path.
- Failure paths must clean up connections, listeners, temporary directories, and child processes. Do not weaken loopback or token checks to make a test pass.

## Documentation, versions, and releases

- Update affected READMEs, architecture documentation, public API comments, and test notes with code changes. Keep current facts in one authoritative location; do not rewrite historical reviews as current status.
- `VERSION.txt` is the source-version baseline. The root and every workspace `package.json` plus `package-lock.json` must match it. Source versions omit `v`; release tags use `v<version>`. The current development version is `0.1.0-alpha.1`; never reuse a published version, and record `0.x` breaking changes explicitly.
- Record user-visible changes under `[Unreleased]` in `CHANGELOG.md`, categorized as `Added`, `Changed`, `Fixed`, or `Security`.
- `CHANGELOG.md` must start with `# PureTerm`. After updating the source version and changelog, run `node scripts/convert-changelog.js` and `node scripts/convert-changelog.js --sync-version`; commit the generated `packages/ui/src/lib/changelog.ts` and `packages/ui/src/lib/version.ts`.
- The root and every workspace version must match. Before a release run `npm run release:check -- --version <version>`, `npm run verify`, and `npm run verify:electron`.
- GitHub Releases drafts are created only by CI for a `v<version>` tag. Ordinary branches and local commands do not publish, upload tokens, or modify a public release.
- Build installers from independent staging; do not depend on workspace symlinks or the launch cwd. Treat signing, notarization, and cross-platform runtime results as results from the corresponding CI or target machine.

## Git and collaboration

- Create focused branches from `main`; keep one reviewable concern per commit where practical. Never commit `dist/`, `.release/`, `release/`, temporary data, or local screenshots.
- Before committing, run `git diff --check` and the verification commands appropriate to the change. PR descriptions state the problem, behavior change, verification, and known limits.
- Do not rewrite branches used by others and do not use bare `--force`; if history must be rewritten, use `--force-with-lease` after checking the remote.
- Before merging, confirm the worktree has no unexplained changes, versions and CHANGELOG are synchronized, and all required CI checks have passed.

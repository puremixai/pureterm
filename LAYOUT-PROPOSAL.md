# Desktop and Local Web Layout Decision

[中文版本](LAYOUT-PROPOSAL_zh.md)

Status: adopted. Electron Desktop and the standalone local Web app reuse business logic and the UI, and both entry points initiate SSH only from the user’s computer. Standalone Web binds only to `127.0.0.1`; it is not designed for remote deployment, user accounts, or tenant isolation.

This decision replaces the earlier constraint that everything live in one application npm package. Electron layering remains; the Desktop Host now runs in an independent Node child process, and the shared UI is a Cordis Client application.

## Directory and installation boundary

```text
pureterm/
  package.json / package-lock.json / VERSION.txt / tsconfig.base.json
  scripts/                         workspace build, type, and boundary checks
  apps/
    desktop/
      package.json / tsconfig*.json
      electron/
        app/                       main process, shell, platform APIs
        runtime/                   startup policy, readiness, profiles, restart, paths
        host/                      independent Node Host entry (no Electron API)
        carriers/                  IPC and preload
        diagnostics/               in-app boot / smoke hooks
      scripts/                     Electron launch, build, and diagnostic tools
      tests/                       Desktop/protocol tests and SSH/SFTP fixtures
    web/
      package.json / tsconfig.json
      src/                         ordinary Node entry, Host and HTTP/WS assembly
      tests/                       lifecycle, protocol, and real-browser tests
  packages/
    host/src/                      public Host API, services, plugins, credential policy
    protocol/src/                  channels, data, events, and binary wire format
    transport/src/                 dispatcher, HTTP/WS, carriers, readiness validation
    ui/src/                        page, xterm, file panel, client transport, generated metadata
  docs/
    architecture.md / DEVELOPMENT.md / desktop-release.md
    superpowers/plans/ / specs/   dated historical records
```

Run `npm ci` at the repository root with the single root lockfile and workspace dependency graph. Each application and shared package keeps its own manifest and TypeScript configuration; no application directory maintains a second lockfile or installation flow. Shared packages are private packages, not a promise of multi-package publishing.

`host/src/services/` and `host/src/plugins/` retain the existing business grouping. These names are not a strict mapping to Cordis categories; split modules by responsibility and consumers.

## Runtime boundary

| Shared module | Adapter owned by an entry point |
| --- | --- |
| Host, SSH/SFTP, hosts, and fingerprints | data directory, credential persistence policy, startup, and shutdown |
| Protocol and dispatcher | client identity, lifecycle, and entry-point capabilities |
| HTTP/WebSocket | loopback port, static resource path, and client-disconnect callback |
| Terminal and file panel | Desktop native key picker / Web browser picker and credential-memory choice |

The Desktop main process provides IPC and the existing local Web carrier. A private parent/child IPC channel shares the independent Node Host. The main process owns safeStorage and native key picking; the child process consumes them through asynchronous capability calls. Standalone Web creates its own Host with a separate default data file. Shared code does not imply shared sessions or credentials.

Standalone Web neither reads credential files nor stores private-key paths. If the selected directory already contains `secrets.json`, or a host record contains legacy ciphertext, startup rejects that directory instead of overwriting Desktop data. Defaults are `~/.ssh-cordis/` and `~/.ssh-cordis/web/`; custom locations must keep the files separate as well.

## Enforced constraints

- `@pureterm/protocol` imports no other module.
- `@pureterm/host` does not depend on Electron, the UI, or an application entry point.
- `@pureterm/ui` depends only on the protocol and browser libraries; it does not import Node, Electron, or Host.
- `@pureterm/transport` dispatches through the public Host API and never reads `Host.internals`.
- Cross-package references use allowed public exports, never a relative path into another package’s source.
- Electron APIs are limited to the Desktop app, IPC, preload, and diagnostic adapters. `runtime` controls platform policy and ordinary Node processes without importing Electron; the Host entry also has no Electron import.

The root `scripts/check-boundaries.mjs` enforces these rules with the TypeScript AST and is part of `typecheck`. They protect source dependency direction; they are not runtime isolation.

## Build and acceptance

Root build scripts build protocol, Host, transport, UI, and applications in that order and clean the relevant `dist/` directories. `build:web` and `build:desktop` build only the selected entry and its shared modules; `build` builds everything.

| Resource | Artifact |
| --- | --- |
| Electron entry | `apps/desktop/dist/electron/app/main.js` |
| Desktop Node Host | `apps/desktop/dist/electron/host/entry.js` |
| preload | `apps/desktop/dist/electron/carriers/preload.cjs` |
| standalone Web entry | `apps/web/dist/main.js` |
| shared page | `packages/ui/dist/index.html`, `app.js`, `app.css` |
| shared Node modules | the corresponding `packages/*/dist/` |

Entry points locate the shared page through package exports. Desktop locates its compiled preload and Node Host by module paths rather than the current working directory. `npm run verify` covers build, types, boundaries, and Node/protocol tests; `npm run verify:electron` checks Desktop, standalone Web, update downloads, and Client plugin lifecycle. Package acceptance is covered by `npm run verify:package:windows`. Tests live in the repository and do not inherit pass counts from historical documents.

## Upstream reference and scope

The upstream baseline is deepseek-harness commit `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`. PureTerm implements an independent Node Host, a Cordis Client plugin tree, and packaging/update coordination. Within this project’s scope we use a static plugin composition, private Node IPC, and GitHub Releases; we do not add upstream Agents, dynamic npm plugin management, or multi-tenancy. See the [release guide](docs/desktop-release.md) for publishing and signing conditions.

Upstream actually uses `packages/<group>/<package>` (its SSH packages are `packages/ssh/{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}`), so the Service export shape cannot be used to infer PureTerm’s `services/` and `plugins/` directory rule. Upstream Web Client is itself a Cordis application; “do not invent another IPC plugin system” does not mean the frontend has no plugin tree.

The original proposal, historical reviews, and screenshot research material have been removed from the current repository. The [architecture document](docs/architecture.md) is the current implementation reference.

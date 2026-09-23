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
        carriers/                  minimal preload bootstrap
        diagnostics/               in-app boot / smoke hooks
      scripts/                     Electron launch, build, and diagnostic tools
      tests/                       Desktop/protocol tests and SSH/SFTP fixtures
    web/
      package.json / tsconfig.json
      src/                         ordinary Node entry and standalone Web Host policy
      tests/                       lifecycle, protocol, and real-browser tests
  packages/
    host/src/                      public Host API, services, plugins, credential policy
    protocol/src/                  channels, data, events, and binary wire format
    transport/src/                 shared Web Host, dispatcher, HTTP/WS, readiness validation
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

The Desktop child owns the shared Web Host and its loopback HTTP/WS carrier. The `pureterm-app://app/` window and optional attached browser use its WebSocket; private parent/child IPC carries lifecycle, safeStorage, and native key-picker calls only. The main process injects a separate bearer token into the owned window’s exact WebSocket request. Standalone Web creates its own Web Host with a separate default data file. Shared code does not imply shared sessions or credentials.

Standalone Web neither reads credential files nor stores private-key paths. If the selected directory already contains `secrets.json` or the encrypted `keychain.json` vault, or a host record contains legacy ciphertext, startup rejects that directory instead of overwriting Desktop data. Defaults are `~/.ssh-cordis/` and `~/.ssh-cordis/web/`; custom locations must keep the files separate as well. Web Keychain keys and host associations are client-scoped memory only, cleared when the client disconnects.

## Enforced constraints

- `@pureterm/protocol` imports no other module.
- `@pureterm/host` does not depend on Electron, the UI, or an application entry point.
- `@pureterm/ui` depends only on the protocol and browser libraries; it does not import Node, Electron, or Host.
- `@pureterm/transport` dispatches through the public Host API and never reads `Host.internals`.
- Cross-package references use allowed public exports, never a relative path into another package’s source.
- Electron APIs are limited to the Desktop app, preload, and diagnostic adapters. `runtime`, the Host entry, and ordinary carriers do not import Electron.

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

Entry points locate the shared page through package exports. Desktop serves it through `pureterm-app://app/` and locates its compiled preload and Node Host by module paths rather than the current working directory. `npm run verify` covers build, types, boundaries, and Node/protocol tests; `npm run verify:electron` checks Desktop, standalone Web, update downloads, and Client plugin lifecycle. Package acceptance is covered by `npm run verify:package:windows`. Tests live in the repository and do not inherit pass counts from historical documents.

## Upstream reference and scope

The upstream reference is locked to deepseek-harness commit `00102833dfaee1da9f48a3a8eae9d34005a75218`. PureTerm follows its thin Desktop wrapper with a child-owned Web Host, a Cordis Client plugin tree, and packaging/update coordination. Within this project’s scope we use static plugin composition, WebSocket business traffic, private platform/lifecycle IPC, and GitHub Releases; we do not add upstream Agents, dynamic npm plugin management, or multi-tenancy. See the [release guide](docs/desktop-release.md) for publishing and signing conditions.

Upstream actually uses `packages/<group>/<package>` (its SSH packages are `packages/ssh/{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}`), so the Service export shape cannot be used to infer PureTerm’s `services/` and `plugins/` directory rule. Upstream Web Client is itself a Cordis application; “do not invent another IPC plugin system” does not mean the frontend has no plugin tree.

The original proposal, historical reviews, and screenshot research material have been removed from the current repository. The [architecture document](docs/architecture.md) is the current implementation reference.

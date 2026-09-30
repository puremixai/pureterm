# Desktop Reliability and Upstream Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use only the execution method and delegation authorized by the human.

**Goal:** Bring PureTerm's Desktop ownership, shutdown, shortcuts, and Host failure handling closer to the useful parts of the current deepseek-harness architecture, with explicit SSH/SFTP safety checks.

**Architecture:** Keep the Electron shell, independent Electron Node-mode Host, shared `startWebHost()`, and static Cordis Client. Add Host lifecycle facts and admission control through public Host/Web Host APIs and private parent/child RPC; Electron owns dialogs, window decisions, menus, and application restart.

**Tech Stack:** Node.js >=24, TypeScript, Electron, Cordis, ssh2, xterm.js, npm workspaces, Node test runner, existing Electron/browser smoke harnesses.

**Spec:** [Architecture comparison and G01–G06](../../reports/2026-09-30-desktop-architecture-comparison.md), plus the six-item follow-up requested in this conversation. This document makes the implementation decisions below explicit; the comparison report alone is not an implementation specification.

[中文版本](2026-09-30-desktop-reliability_zh.md)

## Global Constraints

- Baseline: PureTerm `c7816bfbc3a1d1e338bb80d2608ed31152c2ca4a`, version `0.1.0-alpha.2`; reference `639ed015397290b3745d163aafe02ffee4aa3f84`, tag `dsh-v0.2.0-rc.2`, checked on 2026-09-30.
- Before execution, read [AGENTS.md](../../../AGENTS.md), [architecture](../../architecture.md), [layout](../../../LAYOUT-PROPOSAL.md), [development](../../DEVELOPMENT.md), and, for update/restart behavior, [release guide](../../desktop-release.md). Reconcile a newer checkout with this dated plan before editing.
- Windows commands use PowerShell. All new text is UTF-8. Run npm commands from the repository root; maintain the single root lockfile and complete English/Chinese Markdown pairs.
- Preserve `ELECTRON_RUN_AS_NODE`, `pureterm-app://app/`, binary-safe business WebSocket transport, main-frame-only Desktop bearer injection, loopback binding, and separate browser credentials.
- `@pureterm/protocol` remains environment-neutral. Host does not import Electron/UI/i18n. UI does not import Host/Node/Electron. Runtime and Host child modules do not import Electron. Transport consumes public Host APIs, never `Host.internals` or `WebHost.internals`.
- Desktop encryption and existing Electron `userData` remain intact. Standalone Web remains session-only and uses a separate data directory. Do not migrate user data or change encryption fallback as part of these tasks.
- No new package or runtime dependency is planned. No HTTP RPC migration, dynamic plugins, Agent jobs, account platform, CLI registration, mandatory update service, or telemetry is included.
- Tasks T01–T07 and T10 form the default implementation scope when this plan is assigned for execution. T08 and T09 are conditional and remain unchecked until the human selects them. Writing this plan does not itself authorize implementation, push, merge, or publication.
- Use local fake SSH servers, temporary profiles, random service ports, and synthetic credentials. Build before tests that import `dist/`. Never use a user's SSH targets or credentials.

## Review Focus

1. Two Electron profiles or path aliases point at one SSH data directory: one profile is admitted before any Host/store access; the other is rejected without rewriting the store. Tests: T01.
2. A connection completes, or another browser starts work, between inspection and confirmation: lock admission, drain accepted work, and inspect again. Cancellation restores admission. Tests: T02–T05.
3. Close, menu Quit, update, and a late dialog response overlap: one owner controls shutdown; stale responses cannot stop a new generation or install an update. Tests: T04–T05, T07.
4. IME composition, AltGr, a modal, or an editor owns input: workspace shortcuts do not consume it, and a native/DOM pair does not execute twice. Tests: T06.
5. Host dies during preparation, report storage is unwritable, or shutdown needs a signal: bounded cleanup and explicit recovery remain available; an updater never treats forced termination as graceful completion. Tests: T03, T05, T07.

---

## Execution Order and Deliverables

| Work package | Tasks | Dependency | Priority / output |
| --- | --- | --- | --- |
| Profile ownership | T01 | None | High; one Desktop writer per bound profile |
| Host lifecycle contract | T02, T03 | T02 before T03 | High; public facts, admission lease, private RPC, stop outcome |
| Exit and update protection | T04, T05 | T01, T03; T04 before T05 | High; cancellation-safe exit and update handoff |
| Shortcut ownership | T06 | None; integrate with current generation | Medium; one command registry and IME protection |
| Host diagnostics and restart | T07 | T01, T03–T05 | Medium; bounded reports and explicit restart/exit |
| Background window retention | T08 | T01, T04–T07; explicit selection | Optional; retain the same document/socket and a return entry |
| Login-shell environment | T09 | T01, T03, T07; demonstrated local-tool need | Conditional; bounded POSIX environment read |
| Final integration and documentation | T10 | Every selected task | Required; reviewable handoff with actual check results |

Recommended sequence: T01 → T02 → T03 → T04 → T05 → T06 → T07 → T10. T06 is independently implementable, but no parallel dispatch is required. Keep one work package reviewable before advancing; split later work into a separate branch/PR when it can ship independently.

## File Responsibilities

Paths below are repository-relative. “New” paths are proposed files; existing paths must be rechecked at execution time.

| File(s) | Responsibility / task |
| --- | --- |
| New `apps/desktop/electron/runtime/single-instance.ts`; new `desktop-profile.ts` in the same directory | Minimal application lock seam; canonical data/profile binding, T01 |
| `apps/desktop/electron/app/main.ts`, `shell.ts`, `platform.ts`, `updates.ts` | Electron adapters only: ownership, close/before-quit, menus, dialogs, recovery, T01/T04–T08 |
| New `packages/protocol/src/lifecycle.ts`; existing `protocol.ts` | Neutral lifecycle shapes and exports/error codes, T02/T03 |
| New `packages/host/src/lifecycle.ts`; existing `host.ts` | Accepted operation tracking, admission lease, public lifecycle surface, T02 |
| `packages/transport/src/web-host.ts`, `dispatch.ts` | Forward the public lifecycle surface; preserve business dispatch and cleanup ownership, T02/T03 |
| `apps/desktop/electron/host/entry.ts`, `runtime/host-process.ts`, `runtime/process-rpc.ts` | Validate private lifecycle calls; bounded child stop outcome, T03 |
| New `apps/desktop/electron/runtime/shutdown.ts`; existing `runtime/updates.ts` | Serialized shutdown preparation; downloaded-update handoff, T04/T05 |
| New `packages/protocol/src/shortcuts.ts`; existing `protocol.ts` and Desktop preload | Shared commands/matcher and narrow native bridge, T06 |
| New `packages/ui/src/services/shortcuts.ts`; existing `client.ts`, `services/terminal.ts`, `features/hosts.ts`, `features/sftp.ts`, `index.html` | Browser command ownership, context, resource cleanup, shortcut help, T06 |
| New `apps/desktop/electron/app/shortcuts.ts` | Native input/menu adapter bound to the current shell generation, T06 |
| New `apps/desktop/electron/runtime/crash-report.ts`, `fatal-recovery.ts` | Allowlisted crash facts, bounded retention, serialized explicit recovery, T07 |
| `packages/i18n/src/en.ts`, `zh.ts`, `packages/ui/src/message-text.ts` | User-facing catalog text and lifecycle error mapping; no Host translation imports |
| New `apps/desktop/electron/app/background.ts`, new `runtime/background-policy.ts` | Conditional document retention and tray ownership, T08 |
| New `apps/desktop/electron/runtime/login-shell-environment.ts` | Conditional POSIX probe, parser, merge, cancellation, T09 |
| Node tests and existing Electron/browser harnesses named in each task | Behavioral acceptance, without a new GUI-driver subsystem |
| Current READMEs, architecture, development/release guides, CHANGELOG pairs | Update actual shipped behavior only, T10 |

## Shared Contract Decisions

These are proposed contracts, not existing APIs. Export neutral shapes from `@pureterm/protocol`; expose `HostLifecycle` through the public Host entry and `WebHost.lifecycle` through the public transport entry.

```ts
export interface HostActivitySnapshot {
  activeSessions: number
  pendingConnections: number
  pendingFileOperations: number
  pendingMutations: number
}
export interface HostLifecycle {
  inspectActivity(): HostActivitySnapshot
  prepareShutdown(leaseId: string): HostActivitySnapshot
  drainAccepted(leaseId: string, timeoutMs: number): Promise<HostActivitySnapshot>
  cancelShutdown(leaseId: string): boolean
}
export interface RemoteHostLifecycle {
  inspectActivity(): Promise<HostActivitySnapshot>
  prepareShutdown(leaseId: string): Promise<HostActivitySnapshot>
  drainAccepted(leaseId: string, timeoutMs: number): Promise<HostActivitySnapshot>
  cancelShutdown(leaseId: string): Promise<boolean>
}
export interface HostStopResult {
  graceful: boolean
  exitCode: number | null
  signal: string | null
}
export type ShutdownIntent = 'quit' | 'update'
export type ShutdownDecision = {
  intent: ShutdownIntent
  status: 'ready' | 'cancelled' | 'failed' | 'busy'
}
```

- `activeSessions` counts live terminal bridges; `pendingConnections` counts admitted `openTerminal()` calls until settlement; file operations cover all five public SFTP calls; mutations cover queued and running host/Keychain writes. Counters cannot become negative and must unwind on rejection/disconnection.
- Facts cover **all clients of this Host**, including attached browser clients. They contain counts only: no host names, paths, passwords, tokens, commands, or terminal output. Standalone Web is a different Host and is not included.
- Current `SshService.exec()` is used for monitor probes; it is not a public user-exec API. Continuous monitor probes alone do not trigger a quit warning or prevent drain. Do not add a public exec API for this plan.
- The parent generates the lease ID before requesting preparation. Preparing synchronously closes admission; repeated preparation with the same ID is idempotent, a different ID fails with `host.lifecycle-busy`, and a stale cancellation cannot unlock a newer lease.
- While locked, reject SSH opens/input, all new SFTP operations, host/key mutations, and monitor starts with `host.preparing-shutdown`. Allow list/capability reads, resize, close, monitor stop, client release, disposal, and private platform seal/unseal replies needed by already accepted work. Notice rejection must use the existing carrier error-handling convention rather than inventing a notice reply.
- Drain waits for **finite accepted work**, not live terminal streams. Timeout is `host.lifecycle-drain-timeout` and does not itself discard accepted promises or unlock admission. The owner must cancel or proceed with an explicitly authorized ordinary quit.
- Default inspection/preparation/cancellation RPC timeout: **2,000 ms**. Drain budget: **5,000 ms**; its RPC timeout is **6,000 ms**. Child stop retains **5,000 ms** graceful RPC plus **500 ms** exit wait, **1,000 ms** after SIGTERM and **2,000 ms** after SIGKILL. Tests inject shorter budgets.
- `graceful` is true only after shutdown acknowledgement and clean exit code `0` without a terminating signal. A dead child or a killed child cannot supply a new graceful acknowledgement.
- Add `host.preparing-shutdown`, `host.lifecycle-busy`, `host.lifecycle-lease-invalid`, and `host.lifecycle-drain-timeout` to existing error classification and both catalogs. Preserve established closed/client-disconnected errors when those conditions take precedence.

## T01 — Single Instance and Data/Profile Ownership

**Files:** Create `runtime/single-instance.ts`, `runtime/desktop-profile.ts`, `tests/single-instance.test.mjs`, `tests/desktop-profile.test.mjs` under `apps/desktop/` using the directories above. Modify `electron/app/main.ts`; extend the existing Electron smoke harness and its isolated-profile fixtures.

**Interfaces:**

```ts
claimDesktopSingleInstance(application: SingleInstanceApplication,
  dataDir: string, focusOwner: (requestedDataDir: string) => void): boolean
bindDesktopProfile(dataDir: string, userDataDir: string): void
```

`SingleInstanceApplication` is a minimal structural seam for `requestSingleInstanceLock(additionalData)`, `on('second-instance', ...)`, and `quit()`; it imports no Electron. `bindDesktopProfile()` throws a typed `DesktopProfileError` with `profile-mismatch`, `profile-invalid`, or `profile-io`.

**Decisions:** Keep the existing production `userData` path. Resolve test overrides before claiming Electron's lock; then bind the canonical SSH directory to canonical `userData` **before launch-profile reads, credentials, Host creation, or windows**. Store only `{ "version": 1, "userData": "<canonical absolute path>" }` in `<dataDir>/desktop-profile.json`, created with exclusive `wx`, mode `0600`, flushed and closed before proceeding. Canonicalize existing directories with `realpath`; normalize Windows path case for comparison.

This binding is a durable ownership record, **not a PID lock**. Processes sharing `userData` are serialized by Electron; another `userData` cannot use this store even after the old process exits. A concurrent first creation chooses one binding; retry a temporarily incomplete record for at most **1,000 ms**, then fail closed. Use synchronous startup I/O and bounded retry so the existing launch-profile switches and hardware-acceleration decision still occur before Electron ready. Never overwrite, auto-delete, or auto-rebind a mismatched/malformed record. Profile migration requires a separate, explicit data/encryption migration procedure. This also catches dev/installed app identities pointing at one store.

On second launch, restore/show/focus the current window or defer focus until startup finishes. A requested different data directory produces a clear message; it does not switch the running Host. Independent test profiles need independent SSH directories. Startup failure exits without writing hosts/secrets or retaining the instance lock.

- [ ] Write `single-instance.test.mjs`: `second launch never starts a Host`, `second launch focuses after pending startup`, and `different requested directory does not replace the owner`. Assert one lock owner, zero loser Host starts, and one restore/focus action.
- [ ] Write `desktop-profile.test.mjs`: concurrent first claims, same profile reuse, different profile rejection, alias/case equivalence where supported, malformed/partial/unwritable record. Assert exactly one distinct binding is accepted and hosts/secrets fixture hashes remain unchanged on rejection.
- [ ] Run `npm run build:desktop`, then `node --test apps/desktop/tests/single-instance.test.mjs apps/desktop/tests/desktop-profile.test.mjs`; the first cycle must expose the missing behavior, not a stale build/import artifact.
- [ ] Implement the two seams and startup ordering; localize mismatch/repair guidance in both catalogs. Do not set a new production `userData` path to make the test pass.
- [ ] Repeat the focused tests; add a real two-process Electron check for same-profile denial and separate-profile success to `smoke-electron.mjs`/its fixture. Verify ordinary launch and restart retain existing profile paths.
- [ ] Review only this task's diff and commit, for example `feat: enforce desktop profile ownership`. Do not stage unrelated working-tree changes.

## T02 — Host Activity Facts and Admission Lease

**Files:** Create `packages/protocol/src/lifecycle.ts`, `packages/host/src/lifecycle.ts`, `packages/host/tests/host-lifecycle.test.mjs`; modify `packages/protocol/src/protocol.ts`, `packages/host/src/host.ts`, `packages/transport/src/web-host.ts`, and error/catalog consumers.

**Interfaces:** Consume the shared contract above. Add `readonly lifecycle: HostLifecycle` to `Host` and `WebHost`. Both surfaces refer to the same tracker; Web Host must not recover it from `internals`.

- [ ] Write named tests `snapshot counts pending handshake and both client sessions`, `SFTP and queued saves drain on success or rejection`, `prepare blocks new work but permits cleanup`, and `stale cancel cannot reopen admission`. Reuse `host-policy.test.mjs` and `async-credentials.test.mjs` fixture patterns; gate actual asynchronous SSH/SFTP/credential callbacks.
- [ ] Pin the lease behavior with assertions such as the following; the fixture owns the fake server and releases every gate in cleanup.

```js
host.lifecycle.prepareShutdown('lease-a')
assert.equal(host.lifecycle.cancelShutdown('stale-lease'), false)
await assert.rejects(host.openTerminal(request), error => error.code === 'host.preparing-shutdown')
assert.equal(host.lifecycle.cancelShutdown('lease-a'), true)
assert.equal(host.lifecycle.inspectActivity().pendingMutations, 0)
```

- [ ] Build with `npm run build`, then run `node --test packages/host/tests/host-lifecycle.test.mjs packages/host/tests/async-credentials.test.mjs packages/host/tests/host-policy.test.mjs`; confirm a behavioral failure before implementing.
- [ ] Implement synchronous admission checks at the public Host facade and `try/finally` tracking at acceptance. Queue counts include waiting mutations. Ensure rejection before admission has no side effect; terminal input and dispatcher notices cannot bypass the gate.
- [ ] Implement the four lifecycle methods, lease validation, bounded drain, and public Web Host forwarding. Preserve existing release/dispose ordering and accepted credential replies. Internal monitoring remains outside the user-work counters.
- [ ] Run focused tests again. Add `drain times out without losing accepted save`, `browser work is included`, and `monitor-only polling does not keep drain busy`; assert cancellation lets new work succeed and a rejected/closed operation returns its count to zero.
- [ ] Run `npm run check:boundaries` and commit, for example `feat: expose host activity and shutdown admission`.

## T03 — Private Lifecycle RPC and Honest Stop Outcomes

**Files:** Modify `apps/desktop/electron/host/entry.ts`, `runtime/host-process.ts`, `runtime/process-rpc.ts`, existing `tests/host-process.test.mjs` and `tests/process-rpc.test.mjs`; add controlled child fixtures under `tests/fixtures/`.

**Interfaces:** Extend `DesktopHostProcess` with `readonly lifecycle: RemoteHostLifecycle` and `stop(): Promise<HostStopResult>`. Keep `dispose(): Promise<void>` as the compatible cleanup wrapper around the same idempotent stop operation. Add optional `lifecycleTimeoutMs` to `startHostProcess()` for short test budgets, default `2_000`. Private methods are exactly `host:inspect-activity`, `host:prepare-shutdown`, `host:drain-accepted`, and `host:cancel-shutdown`; retain `host:start` and `host:shutdown`.

- [ ] Write `private activity is not available over business WS`, `child returns counts for attached browser work`, `cancel after timed-out prepare uses the known lease`, `graceful stop requires acknowledgement and zero exit`, and `forced stop is reported as non-graceful`. Assert facts contain only the four numeric fields and are finite nonnegative integers.
- [ ] Build with `npm run build:desktop`; run `node --test apps/desktop/tests/host-process.test.mjs apps/desktop/tests/process-rpc.test.mjs` and observe the missing private methods/result behavior.
- [ ] Wire child requests to `webHost.lifecycle`, with explicit method/argument validation and the budgets above. Parent proxies validate replies. Extend the version `1` reply with optional `wireError: WireError`, using the existing protocol helpers to preserve lifecycle error codes; retain the string `error` fallback for generic/older replies. Test that `host.lifecycle-drain-timeout` remains an error code, not a message match. Keep reverse platform requests available during drain.
- [ ] Refactor child stop to record acknowledgement, exit code, and signal without swallowing them into a successful update outcome. Multiple stop/dispose calls share one cleanup; expected stop must not emit an unexpected-exit recovery event. Cleanup remains bounded after disconnect, absent executable, malformed handshake, timeout, or unresponsive child.
- [ ] Ensure the child acknowledges only after `WebHost.dispose()` completes and flushes that reply before clean process exit. A reply scheduled after `process.exit()` is not an acknowledgement. Keep generic RPC errors compatible and preserve structured lifecycle error codes.
- [ ] Repeat tests; also assert `pending RPCs reject on child disconnect`, `startup failure leaves no child`, and `dispose can follow stop without a second signal`. Use a real child fixture for signal/timeout behavior.
- [ ] Commit, for example `feat: add private host lifecycle controls and stop results`.

## T04 — Ordinary Quit Protection

**Files:** Create `apps/desktop/electron/runtime/shutdown.ts`, `apps/desktop/tests/shutdown.test.mjs`; modify `electron/app/main.ts`, `shell.ts`, `platform.ts`, and catalogs. Extend the existing Electron entry/smoke fixtures for close and menu-quit paths.

**Interfaces:**

```ts
createShutdownCoordinator(options: {
  getHost(): DesktopHostProcess | undefined
  getGeneration(): number | undefined
  confirm(request: ShutdownConfirmation): Promise<boolean>
  onFailure(error: unknown, phase: 'inspect' | 'prepare' | 'drain' | 'stop'): void | Promise<void>
}): {
  prepare(intent: ShutdownIntent, version?: string): Promise<ShutdownDecision>
  dispose(): void
}
```

`ShutdownConfirmation` contains `intent`, optional update `version`, optional `activity`, and `phase: 'initial' | 'changed' | 'unknown' | 'force'`. Native text shows global Host counts and interruption consequences; Cancel is the default/cancel button. Identical in-flight requests for the same Host/generation/intent/version share a promise; a different intent or update version returns `busy` and cannot borrow another request's `ready` result. Once `ready` is returned, reserve that decision until the caller commits cleanup; do not start a second preparation against the already stopped Host.

**Flow:** inspect → confirm if active → acquire known lease → drain → re-inspect under the lease → confirm newly increased interruption facts if necessary → stop Host → return `ready`. Cancel before/after preparation preserves the window/socket and cancels only its own lease. A late dialog after disposal or generation change is ignored. Before any commit, validate that the same Host/generation still owns the decision.

Inspection failure is **unknown activity**, never zero. Ordinary quit may offer explicit “Quit anyway” with Cancel selected. A drain timeout needs explicit ordinary-quit force confirmation; cancel releases admission. After the child has terminated within the bounded stop sequence, ordinary quit may return `ready` with non-graceful termination recorded; it must not relaunch against the user's quit decision. `prepare('update', version)` returns `ready` only when `HostStopResult.graceful === true`, otherwise `failed`. An unacknowledged lease cancellation or a child that could not be terminated goes to explicit recovery, never a usable-looking page.

- [ ] Write `cancel keeps window and WebSocket alive`, `new work between inspection and preparation triggers recheck`, `repeated quit confirms and stops once`, `conflicting update is busy`, `late dialog cannot stop a replacement Host`, `late dialog cannot stop a replacement document with the same Host`, and `inspection timeout is not an empty snapshot`. Assert `stopCalls === 0` on cancellation and successful new admission after lease release.
- [ ] Run `npm run build:desktop`, then `node --test apps/desktop/tests/shutdown.test.mjs`; establish the failure.
- [ ] Implement the coordinator with injected confirmation/failure seams; use deferred confirmations and controlled remote failures for fast unit tests. `getGeneration()` returns the current shell's `id`; compare both it and the same Host object after each await. Allow no stale or conflicting decision to commit.
- [ ] Intercept **Windows/Linux normal window `close` before destruction**, and application `before-quit` on every OS. Route window buttons, menu Quit, and programmatic ordinary quit through the same gate. Use a committed-quit flag to let the final `app.quit()` pass once; `will-quit` is the cleanup fallback, not the first place to ask the user.
- [ ] Keep macOS ordinary window close semantics for this base phase: it releases that page's SSH sessions and leaves Host alive. macOS menu Quit/Cmd+Q uses the application guard. T08 is the separate decision to retain a closing document. Startup failure, renderer crash, boot/smoke diagnostic exit, and an already committed update use bounded cleanup without an impossible activity dialog.
- [ ] Repeat unit tests and add Electron acceptance `cancelling close preserves same webContents/client/session`, `accepting close stops Host before application exit`, and `macOS application quit is guarded`. Ensure final cleanup disposes the stopped Host/window/handlers once and waits for an in-progress startup rather than orphaning its late child.
- [ ] Commit, for example `feat: protect desktop quit with host activity checks`.

## T05 — Update Preparation and Install Handoff

**Files:** Modify `apps/desktop/electron/runtime/updates.ts`, `electron/app/updates.ts`, `electron/app/main.ts`, existing `tests/updates.test.mjs`, `tests/electron-updates-entry.mjs`, `tests/smoke-updates.mjs`, and catalogs.

**Interfaces:** Replace the update coordinator's split `confirmInstall(version)`/`beforeInstall()` options with `prepareInstall(version: string): Promise<ShutdownDecision>`, consuming T04's `prepare('update', version)`. Keep `onInstallError` for failures after the installer handoff; preparation failure is a separate non-installing path. Adapt every caller and fixture together.

**Flow:** A downloaded update remains `downloaded` when preparation is cancelled, busy, or fails before stop. Update confirmation always includes the version and current interruption facts, including zero work. Before invoking `quitAndInstall(false, true)`, require a same-intent `ready` result from a **graceful** stop and commit shell cleanup. Disable the ordinary-quit guard only after that handoff is committed. Preserve `autoInstallOnAppQuit = false`.

Updates do not offer force-through after drain/inspection failure. Cancel the lease, retain the download, and leave the current Host usable when stop has not begun. If stopping already destroyed Host or the installer throws, offer restart of the current application through T07; do not pretend the previous SSH sessions survived.

- [ ] Write `cancelled preparation keeps downloaded version retryable`, `work admitted during confirmation is caught`, `busy ordinary quit does not install`, `drain failure unlocks without stopping`, `forced termination never invokes installer`, `dispose while confirmation is pending never installs`, and `new download invalidates old confirmation`.
- [ ] Build with `npm run build:desktop`; run `node --test apps/desktop/tests/updates.test.mjs apps/desktop/tests/shutdown.test.mjs` and confirm the missing handoff checks.
- [ ] Implement `prepareInstall`, preserve cancellation/download behavior, and check the coordinator's disposed state **after every awaited preparation**, immediately before installer invocation. A stale version/request cannot install a later download. If invalidation arrives after Host stop, treat it as a post-stop recovery case rather than returning to a usable-looking page with a dead Host.
- [ ] Repeat tests with call-order assertions: admission lock → drain → final inspection → acknowledged clean Host exit → shell cleanup → exactly one `quitAndInstall(false, true)`. An update must never accept an ordinary-quit decision.
- [ ] Extend `smoke-updates.mjs` with active fake SSH/SFTP, cancellation, and failed-stop coverage. Keep the test backend/download local; do not invoke a real installer or public update service.
- [ ] Commit, for example `fix: gate update install on prepared graceful shutdown`.

## T06 — Unified Shortcut Ownership and IME Protection

**Files:** Create `packages/protocol/src/shortcuts.ts`, `packages/protocol/tests/shortcuts.test.mjs`, `packages/ui/src/services/shortcuts.ts`, `apps/desktop/electron/app/shortcuts.ts`, `apps/desktop/tests/shortcuts.test.mjs`. Modify protocol exports/`DesktopBridge`, `electron/carriers/preload.ts`, current shell/main/menu adapters, Client composition/terminal/hosts/SFTP services, shortcut help, and existing Client lifecycle/browser tests.

**Interfaces:**

```ts
type ShortcutCommand = 'terminal.next' | 'terminal.previous' | 'terminal.close'
  | 'terminal.focus' | 'sftp.toggle' | 'hosts.search' | 'hosts.dismiss-editor'
interface ShortcutContext {
  terminalTabs: number
  activeTerminal: boolean
  connectedTerminal: boolean
  libraryVisible: boolean
  editorOpen: boolean
  modalOpen: boolean
  composing: boolean
}
resolveShortcut(input: ShortcutInput, context: ShortcutContext,
  platform: 'mac' | 'other'): ShortcutCommand | undefined
```

`ShortcutInput` is a neutral normalized key record: string `key`/`code`, boolean `ctrl`/`meta`/`shift`/`alt`/`composing`/`repeat`, and `type: 'keydown' | 'keyup'`. The matcher and binding list contain no DOM/Node imports. `ClientShortcuts` exposes `register(command: ShortcutCommand, handler: () => void, enabled: () => boolean): () => void`, `updateContext(patch: Partial<ShortcutContext>): void`, and `execute(command: ShortcutCommand): boolean`; feature services own their handlers, not duplicated listeners.

Also export `isShortcutEnabled(command: ShortcutCommand, context: ShortcutContext): boolean` for matcher/menu context checks and `getShortcutBindings(platform: 'mac' | 'other'): readonly ShortcutBinding[]` for native menus/help. `ShortcutBinding` has `command: ShortcutCommand`, `modifiers: readonly ('ctrl' | 'meta' | 'shift')[]`, and exactly one string `key` or `code`. Matching and help consume this list; human labels still come from the i18n catalog. The Electron adapter is `installDesktopShortcuts(window: BrowserWindow, platform: 'mac' | 'other'): { reportContext(context: ShortcutContext): void; dispatch(command: ShortcutCommand): boolean; dispose(): void }`, scoped to one generation. `dispatch()` checks the same context rules before sending; only the application adapter imports Electron.

Add optional `DesktopBridge.shortcuts` with `platform`, `reportContext(context): void`, and `onCommand(listener): () => void`. Add channels `shortcutContext: 'desktop:shortcut-context'` and `shortcutCommand: 'desktop:shortcut-command'`. Context reports use the existing owned-document/main-frame validation; command subscribers validate known IDs. New-generation defaults are blocked until a valid context report arrives. UI rechecks current enabled state on every command, even if the main process has an older context hint.

| Command | Default key / scope |
| --- | --- |
| `terminal.next`, `terminal.previous` | Ctrl+Tab / Ctrl+Shift+Tab on all OSes; cycle Home plus terminal tabs when at least one terminal tab exists |
| `terminal.close` | Primary+W; only an active terminal tab, including pending/failed tabs |
| `terminal.focus` | Primary+Backquote (`code: 'Backquote'`); only an active terminal tab |
| `sftp.toggle` | Primary+E; only a connected terminal |
| `hosts.search` | Primary+K; only the visible host library, preserving remote terminal Ctrl+K |
| `hosts.dismiss-editor` | Escape; only an open host editor |

Primary is Cmd on macOS and Ctrl elsewhere. This explicitly corrects the current macOS shortcut-help ambiguity for Ctrl+Tab. Except dismissing the editor, suppress workspace shortcuts while the editor is open; suppress all of them during composition or a modal. Reject Alt/AltGr, modifier mismatches, key-up, and repeat-triggered destructive close. Keep local tab-strip/resizer arrow navigation and native Edit menu roles. No customizable/persisted binding editor is included in this first phase.

- [ ] Write table tests `composition and AltGr pass through`, `editor and modal retain input`, `library-only Ctrl+K`, `Mac Ctrl+Tab and Cmd+W`, `repeat does not close a second tab`, and `no active terminal does not close a window`. Assert the exact command or `undefined` for each input/context.
- [ ] Build with `npm run build`; run `node --test packages/protocol/tests/shortcuts.test.mjs apps/desktop/tests/shortcuts.test.mjs` and establish the missing registry/native behavior.
- [ ] Implement the neutral matcher/list and browser `ClientShortcuts` provider before feature consumers. Move only workspace shortcuts into registrations; preserve ordinary control navigation. Track composition start/end, current editor/dialog state, and terminal/library context with explicit scope disposers.
- [ ] Implement the native `before-input-event` adapter and menu command dispatch using the same IDs/bindings. A consumed native key is prevented once and reaches the registry once; Desktop disables the competing DOM workspace-key path, while standalone/attached Web uses it. Keep copy/paste/select-all and remote Ctrl+C behavior intact; add no Reload or Zoom menu.
- [ ] Derive shortcut help from the same bindings and platform; update both catalogs. Add `unowned frame cannot report shortcut context` and `old generation cannot receive commands` acceptance cases; validate new preload/main reports and reset/remove every listener on generation replacement and Client disposal.
- [ ] Repeat Node tests; extend `packages/ui/tests/client-lifecycle.browser.ts` with key/IME/context/remount behavior and the existing Electron harness with one-press/one-command assertions. Run `node packages/ui/tests/smoke-client-lifecycle.mjs`. Record actual native IME/platform coverage separately from simulated composition tests.
- [ ] Commit, for example `feat: coordinate desktop and web shortcut ownership`.

## T07 — Bounded Host Failure Reports and Explicit Restart

**Files:** Create `apps/desktop/electron/runtime/crash-report.ts`, `runtime/fatal-recovery.ts`, `apps/desktop/tests/crash-report.test.mjs`, `tests/fatal-recovery.test.mjs`; modify `runtime/host-process.ts`, `electron/app/main.ts`, catalogs, and the current Electron smoke fixtures.

**Interfaces:** `writeHostCrashReport(directory: string, report: HostFailureReport): Promise<string | undefined>` and `createFatalRecoveryCoordinator({ record, choose, cleanup, relaunch, exit }): { handle(failure: HostFailureReport): Promise<void>; dispose(): void }`. Options are `record(report): Promise<string | undefined>`, `choose(report, reportPath): Promise<'restart' | 'quit'>`, `cleanup(): Promise<void>`, `relaunch(): void`, and `exit(code: number): void`; `report` is `HostFailureReport` and `reportPath` is `string | undefined`.

Define `HostFailureReport` with `version: 1`, ISO `timestamp`, string `appVersion`/`platform`/`architecture`, `phase: 'startup' | 'runtime' | 'update'`, optional numeric `pid`, `exitCode: number | null`, and `signal: string | null`. Allowed `reason` values are `spawn-error`, `handshake-invalid`, `startup-timeout`, `ipc-disconnect`, `unexpected-exit`, `shutdown-timeout`, `lifecycle-control-failed`, and `update-handoff-failed`. Export `HostProcessFailure` from `host-process.ts` containing the process facts `reason`, optional `pid`, `exitCode`, and `signal`; extend `onExit(error: Error, failure: HostProcessFailure)` alongside the existing Error. The main adapter adds version/time/platform/phase and supplies startup failures that precede the existing onExit callback. Update consumers without using error text as report payload.

**Decisions:** Store under `<existing userData>/diagnostics/host/`, retain **five** reports, cap each at **64 KiB**, create files with `0600`, and serialize write/rotation. Use atomic temp-write/rename inside that directory; rotate only this writer's `host-*.json` files, never delete the directory or unrelated files. Failed writes return `undefined` and never block recovery. Do not persist raw stdout/stderr, arbitrary error messages/stacks, data-directory paths, environment, socket URL/token, host records, terminal output, or SSH secrets.

The native dialog offers **Restart PureTerm** and **Quit** (Quit default). Restart means a full application relaunch after bounded cleanup, with the same data/profile/launch arguments; it creates a new Host and new Client. It does not reconnect SSH or restore terminal state automatically. Collapse exit/disconnect/error notifications into one recovery. Expected shutdown and diagnostic runs do not prompt. Renderer GPU/sandbox fallback remains a separate existing path.

- [ ] Write `retention is five bounded reports`, `report payload excludes synthetic token/password/path/output`, and `unwritable report directory still permits restart or quit`. Assert allowlisted JSON fields, retention count, byte limit, and cleanup of temporary files.
- [ ] Write `three failure events yield one dialog and relaunch`, `quit never relaunches`, `old recovery cannot relaunch after disposal`, and `restart preserves profile and waits for Host stop`. Assert one prompt, one cleanup, and `cleanup` before `relaunch`/`exit`.
- [ ] Build with `npm run build:desktop`; run `node --test apps/desktop/tests/crash-report.test.mjs apps/desktop/tests/fatal-recovery.test.mjs apps/desktop/tests/host-process.test.mjs` and establish the missing reporting/recovery behavior.
- [ ] Implement the report writer and recovery coordinator; wire startup/runtime/update failures with structured facts. Invalidate pending shutdown/shortcut decisions before recovery; resolve a live, uncertain Host through bounded cleanup and never auto-restart in a loop.
- [ ] Repeat tests; add Electron acceptance that kills a fake-work Host, observes lost sessions, selects explicit restart, and starts with the same isolated profile and zero restored SSH sessions. Ensure a second instance cannot steal that profile during recovery.
- [ ] Commit, for example `feat: add bounded host diagnostics and explicit recovery`.

## T08 — Optional: Preserve the Document When Closing to Background

**Selection gate:** Execute only when the human explicitly selects background SSH behavior. Base completion does not depend on this task. Proposed first scope is opt-in `SSH_CORDIS_BACKGROUND=1`, default off, Windows tray plus macOS Dock; Linux uses ordinary guarded close until a reliable return entry is separately specified.

**Files:** Create `electron/app/background.ts`, `electron/runtime/background-policy.ts`, `tests/background-policy.test.mjs` under `apps/desktop/`; modify main/shell/platform, catalogs, and Electron fixtures. If a new tray asset is required, add `apps/desktop/assets/tray.png`, stage it through `scripts/stage-desktop.mjs`, and update runtime path/packaging tests and `electron-builder.cjs` as needed.

**Interfaces:** `resolveBackgroundClose({ enabled, platform, returnEntryReady, quitting }): 'hide' | 'guarded-close'`; `installBackgroundController(options): { showWorkspace(): void; dispose(): void }`. It owns exactly one tray/return entry and receives current-window/explicit-quit callbacks. Route `activate`, `second-instance`, tray Show, and Dock activation to the same `showWorkspace()`.

- [ ] Write `default close is unchanged`, `enabled close preserves webContents and socket`, `tray failure falls back to guarded close`, and `Quit/update bypass hiding`. Assert stable generation/client/session IDs while hidden and full cleanup on true quit.
- [ ] Build; run `node --test apps/desktop/tests/background-policy.test.mjs` and the new Electron cases through the existing harness; establish failure.
- [ ] Implement Windows tray before enabling hide. Hide the current document on ordinary close; do not release, reload, create another Client, or leave just Host alive. Keep menu/tray Quit routed through T04 and update through T05. macOS activate shows the existing hidden window.
- [ ] Add a once-per-profile explanation under existing `userData`: closing keeps connections alive; Quit disconnects them. Tray creation failure uses ordinary close; a hidden unreachable SSH workspace is never an accepted outcome. Dispose tray/menu resources on true exit and recovery.
- [ ] Verify fake SSH echo and a gated SFTP operation continue across hide/show. If staging/assets changed, run isolated `npm run verify:package:windows`; document supported platforms and commit this optional package separately.

## T09 — Conditional: POSIX Login-Shell Environment for Local Tools

**Selection gate:** Execute only after a concrete local executable/PATH-dependent feature requires it. Current remote SSH behavior does not. This does not change the remote server's shell environment.

**Files:** Create `apps/desktop/electron/runtime/login-shell-environment.ts`, `apps/desktop/tests/login-shell-environment.test.mjs`; modify main/Host startup wiring and add controlled shell fixtures. No Node/Electron imports enter UI.

**Interfaces:** `parseLoginShellOutput(stdout: Uint8Array): Record<string, string> | undefined`; `mergeLoginShellEnvironment(base: NodeJS.ProcessEnv, shell: Readonly<Record<string, string>>): NodeJS.ProcessEnv`; `readLoginShellEnvironment(base, { platform, signal, timeoutMs?, totalTimeoutMs?, candidates? }): Promise<{ environment: NodeJS.ProcessEnv; failures: readonly { shell: string; reason: string }[] }>`. `base` is `NodeJS.ProcessEnv`, `platform` is `NodeJS.Platform`, `signal` is `AbortSignal`, and `candidates` is an optional readonly list of absolute shell paths for tests. Production defaults are **10,000 ms per candidate**, **15,000 ms total**, and **1 MiB** output maximum; tests inject short budgets and candidate paths.

- [ ] Write `Windows spawns no shell`, `NUL-delimited values preserve spaces equals and newlines`, `noise outside markers is ignored`, `launcher variables cannot be overwritten`, `oversized output fails safely`, and `abort/timeout removes child group and skips later candidates`.
- [ ] Build with `npm run build:desktop`; run `node --test apps/desktop/tests/login-shell-environment.test.mjs`; separate portable parser/merge tests from real POSIX process-group tests.
- [ ] Implement one read per parent launch, before Host fork and after profile ownership. Try the account login shell then distinct fixed `/bin/zsh`, `/bin/bash`, `/bin/sh` candidates within the total budget, without interpolating user values into shell commands. Use delimited `env -0` output, ignored stdin/stderr, and bounded process-group cleanup on timeout/abort. Failed reads fall back to inherited environment.
- [ ] Preserve inherited `SSH_CORDIS_*`, `ELECTRON_*`, and launcher-owned paths/values; exclude probe-session variables (`PWD`, `OLDPWD`, `SHLVL`, `_`) and transient prompt-suppression flags. Strip `NODE_OPTIONS`/`NODE_PATH` before final fork and force `ELECTRON_RUN_AS_NODE=1`. Return a new object without mutating `process.env`; never log dumped environment values.
- [ ] Repeat tests on Windows for no-spawn/parsing and on Linux/macOS for group termination, failed shell, detached descendant/stdout behavior, and one-time read. Coordinate quit/recovery with an AbortController. Commit this conditional package separately with actual platform results.

## T10 — Integration, Current Documentation, and Execution Handoff

**Files:** Update affected `README.md`/`README_zh.md`, `apps/desktop/README.md`/`README_zh.md`, `docs/architecture.md`/`architecture_zh.md`, `docs/DEVELOPMENT.md`/`DEVELOPMENT_zh.md`, `docs/desktop-release.md`/`desktop-release_zh.md`, `CHANGELOG.md`/`CHANGELOG_zh.md`, and generated UI changelog when behavior changes. Touch `AGENTS.md`/`AGENTS_zh.md` only for durable new invariants, not this task list. Modify the root/package verification scripts only to ensure new smoke cases actually run.

- [ ] Review selected task coverage against G01–G06. Mark T08/T09 as skipped with the selection reason when not selected; do not describe their proposed behavior as shipped. Reconcile actual public exports, private method names, and every consumer with the shared contracts above.
- [ ] Run appropriate focused tests after each task; after all selected code changes, run the following once from the repository root:

```powershell
npm run verify
npm run check:boundaries
npm run verify:electron
npm run release:check
git diff --check
```

- [ ] Run `npm run verify:package:windows` only if packaging/staging/assets changed. Record each command, exit code, and platform; an environment-limited check or historical success is not a pass. Use CI or target machines for untested Linux/macOS native behavior.
- [ ] Update current documents with actual ownership-record location, cancellation/unknown-activity behavior, update ordering, shortcut scopes, report retention, and restart limitations. For T01 include explicit profile-migration/repair guidance that preserves encryption and never silently edits the binding. Keep the dated comparison report as historical evidence.
- [ ] Add shipped user-visible changes to both `[Unreleased]` changelogs and run `node scripts/convert-changelog.js`; synchronize version metadata only if the version was deliberately changed in a separately authorized release. Do not bump `0.1.0-alpha.2` merely to implement this plan. Re-run `npm run release:check` after changelog generation.
- [ ] Check touched Markdown relative links, bilingual identifiers/limits/code blocks, and UTF-8. Review the branch for accidental data, tokens, build outputs, temporary profiles, or unrelated staged files; commit documentation/integration changes separately.
- [ ] Provide the human with selected/skipped tasks, commit IDs, test commands/results, known limits, and remaining external platform checks. Push, create a PR, merge, or publish only as authorized in that execution conversation; this plan is not release authorization.

## Definition of Done for the Default Scope

- One bound Desktop profile owns each SSH data directory; the loser never opens its Host/store, and a second launch can focus the owner.
- Quitting with active or uncertain SSH work requires a cancellable decision before destroying the Windows/Linux document or exiting the app. Cancel preserves the current sessions and restores admission.
- Update handoff locks new work, drains finite admitted operations, rechecks activity, and requires acknowledged clean Host exit. Force termination, stale dialogs, conflicting quit, and unknown activity never install an update.
- Desktop and Web share command definitions; native/DOM paths execute once, context/IME rules hold, and listeners disappear with their Client/generation.
- Host failures retain only bounded allowlisted diagnostics and offer explicit application restart/quit. Restart does not promise SSH/session restoration.
- Current bilingual docs and changelog describe only executed scope; required checks have actual results, and deferred optional work is visible.

## Forwardable Agent Prompt

> Work in the PureTerm repository. Read its current AGENTS.md and `docs/superpowers/plans/2026-09-30-desktop-reliability.md` (or the Chinese pair), then read the linked comparison report and current architecture/release documents. Execute T01–T07 and T10 in dependency order, preserving existing Electron Node-mode/shared Web Host/business WebSocket boundaries. T08 and T09 are not selected. Revalidate the checkout and preserve unrelated changes. Build before artifact-based tests; implement and verify each task with a focused commit, then run the required final checks. Report actual results and limits. Do not push, merge, publish, migrate real user profiles, or message other tasks without authorization in this execution conversation.

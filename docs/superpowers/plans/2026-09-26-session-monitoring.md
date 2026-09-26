# Session Host Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

[中文版本](2026-09-26-session-monitoring_zh.md)

**Goal:** Show live Linux host resource metrics on the selected connection page, with independently disposable Host/Client monitoring plugins.

**Architecture:** HostMonitor uses the existing authenticated SSH connection and publishes typed updates through the public Host facade, dispatcher, and WebSocket. ClientMonitor owns the panel and visibility/subscription lifecycle. Terminal, SFTP, and application readiness have no dependency on monitoring.

**Tech Stack:** Existing TypeScript, Cordis, ssh2, browser DOM/CSS tokens, Node test runner, and Electron lifecycle fixtures. No new runtime dependency.

**Spec:** [Session Host Monitoring Design](../specs/2026-09-26-session-monitoring-design.md). Read it completely; its contracts, numeric semantics, and defaults are normative for this plan.

**Status:** Unexecuted handoff, 2026-09-26. This document records proposed work, not existing behavior or passing feature tests. Repository snapshot: `feat/ui-redesign` at `87ae9e2`. The user asked this task to write documentation for other agents; this task does not implement or publish the feature.

## Global Constraints

- Node.js 24 or newer; PowerShell on Windows; UTF-8; commands below run from the repository root.
- Linux remote MVP; CPU, memory, load 1/5/15, and root filesystem only. These are documented planning defaults, subject to a later user correction.
- Refresh: immediately, then 5,000 ms after probe completion. Exec timeout: 3,000 ms including channel acquisition. Combined stdout/stderr limit: 65,536 bytes. Active-data stale threshold: 15,000 ms.
- Only the selected connected tab with visible document, expanded panel, and no manual pause may collect. At most one active subscription per client, with no overlapping local probes per session.
- Static Cordis composition; existing SSH connection; no remote agent, sudo, arbitrary commands, new HTTP endpoint, Electron business IPC, history storage, or npm plugin loader.
- Follow AGENTS.md dependency boundaries and paired English/Chinese documentation. Keep this design's exact interfaces consistent across tasks.
- Before executing, inspect current branch/worktree and AGENTS.md. Preserve unrelated work, including the four `design-qa-*.png` files present at the inspected baseline. Follow the repository's branch policy; this plan depends on the inspected UI changes. If starting from `main`, confirm those prerequisites are integrated first. Do not silently merge/cherry-pick the 71-commit UI branch to manufacture a base.

## Review Focus

- A delayed exec channel callback after timeout/disposal must close that channel and must not close the terminal connection (Task 2).
- A missing `/proc` field, counter decrease, or unusable `df` section must produce a truthful unavailable/partial state, never a plausible zero (Task 3).
- A foreign client ID/session or obsolete stop request must not replace/cancel the current valid subscription (Task 4).
- An update or start reply from tab A after switching to B must neither redraw B nor revive A's sampler (Task 5).
- Removing the monitor provider/plugin or encountering an unsupported target must preserve typing, SFTP, and readiness (Tasks 4-6).

---

## File map and execution order

| Task | Create | Modify |
| --- | --- | --- |
| 1: protocol/client transport | `packages/protocol/tests/monitor.test.mjs` | `packages/protocol/src/protocol.ts`, `packages/ui/src/transport.ts`, `packages/ui/tests/transport-lifecycle.test.mjs`, `packages/ui/tests/client-lifecycle.browser.ts`, root `package.json`, any other typed SshApi fixture found by the audit |
| 2: bounded SSH exec | `packages/host/tests/ssh-exec.test.mjs` | `packages/host/src/services/ssh.ts`, `apps/desktop/tests/fake-ssh-server.mjs` |
| 3: Linux collector | `packages/host/src/monitoring/linux.ts`, `packages/host/tests/monitor-linux.test.mjs` | No production consumer until Task 4 |
| 4: Host plugin + dispatcher | `packages/host/src/plugins/host-monitor.ts`, `packages/host/tests/host-monitor.test.mjs`, `apps/web/tests/monitoring.test.mjs` | `packages/host/src/host.ts`, `packages/host/src/plugins/terminal-bridge.ts`, `packages/transport/src/dispatch.ts` |
| 5: Client plugin + panel | `packages/ui/src/features/monitor.ts`, `packages/ui/src/monitor-panel.ts` | `packages/ui/src/client.ts`, `packages/ui/src/index.html`, `packages/ui/src/styles/terminal.css`, `packages/ui/tests/client-lifecycle.browser.ts` |
| 6: complete acceptance | No required new runtime files | Existing Desktop/Web integration fixtures; `README.md`, `apps/desktop/README.md`, `apps/web/README.md`, `docs/architecture.md`, `docs/design-system.md`, `docs/DEVELOPMENT.md`, `CHANGELOG.md` and all paired `_zh.md` files; generated `packages/ui/src/lib/changelog.ts` |

Tasks 2 and 3 can run independently after Task 1 fixes the contract. Task 4 consumes 1-3. Task 5 consumes 1 and can prepare fixtures while Task 4 runs, but integration waits for 4. Task 6 follows all tasks. Keep edits to shared files assigned to one owner at a time. Do not give parallel agents conflicting ownership of the SSH fixture or UI lifecycle suite.

Task 1 owns only the initial SshApi compatibility changes in `client-lifecycle.browser.ts`; after its reviewed completion, ownership transfers to Task 5. Task 5 must not start editing that file before this handoff. Task 2 similarly hands the SSH fixture to Task 4 before integration extensions.

At each task, write its behavioral tests, run them to see the intended failure, implement, rerun the focused check, and review the diff. A compiler failure from a deliberately missing new API is a valid initial red only; finish with behavioral assertions. Rebuild before running tests importing `dist/`. Commit only the completed task's files after `git diff --check` and its checks pass; do not stage with `git add .`. No push, merge, release, or version bump is required by this plan.

## Task 1: Define the wire contract and browser transport

**Interfaces:** Produce every `Monitor*` type, `parseMonitorUpdate(value: unknown): MonitorUpdate`, `METHODS.monitorStart`, `METHODS.monitorStop`, `EVENTS.monitorUpdate`, and `SshApi.monitor` exactly as specified in design section 4. Host implementation is delivered in Task 4; do not add placeholder Host behavior.

- [ ] Audit `rg -n 'SshApi|RuntimeCapabilities|terminal:opened|terminal:closed|createDispatcher' packages apps` and record all affected fixtures before editing.
- [ ] Write protocol validator tests for a complete sample, CPU warm-up partial sample, unsupported/null sample, NaN/infinity, percentages outside 0..100, unsafe bytes, bad identity/sequence/time, missing nested fields, and invalid status/issue combinations. Example required assertions:

  ```javascript
  assert.equal(parseMonitorUpdate(validUpdate).snapshot.cpuPercent, 25)
  assert.throws(() => parseMonitorUpdate({ ...validUpdate, sequence: 0 }))
  assert.throws(() => parseMonitorUpdate({ ...validUpdate, snapshot: { ...validUpdate.snapshot, cpuPercent: 101 } }))
  ```

- [ ] Add transport tests asserting exact method strings/params, unsubscribe behavior, an update delivered before start reply, invalid payload ignored without breaking terminal events, and subscriber sets cleared on transport disposal.
- [ ] Add `packages/protocol/tests/*.test.mjs` to the existing root `test:unit` script. Run the focused tests and record the expected missing-contract failure.
- [ ] Implement the protocol additions and browser wrappers/listener routing. Keep monitoring events separate from `currentSessions` tracking and terminal payload decoding. Listener exceptions must not alter the wire connection lifecycle.
- [ ] Update all typed SshApi fixture objects with deterministic monitor methods/listeners; retain existing test semantics. Do not extend global runtime capabilities with a remote OS claim.
- [ ] Run `npm run build:shared`, then `node --test packages/protocol/tests/monitor.test.mjs packages/ui/tests/transport-lifecycle.test.mjs`, then `npm run typecheck`. Expect exit 0 and all new/old transport assertions passing. Review and commit as `feat(protocol): define session monitoring contracts`.

## Task 2: Make existing SSH exec bounded and cancellable

**Interfaces:** Extend `SshService.exec(sessionId: string, command: string, options: { maxBytes?: number; timeout?: number; signal?: AbortSignal }): Promise<ExecResult>`, preserving existing optional defaults. `ExecResult` retains its current shape; exceeding the configured limit rejects instead of returning an apparently usable truncated monitoring sample.

- [ ] Extend the existing loopback SSH fixture with a test-only `onExec` callback and exec command/open/close/max-concurrency counters. Preserve shell/SFTP defaults. Provide deterministic normal, delayed-open, hung, stderr-only, multibyte, rejected-command, missing-exit-status, and disconnect cases without external hosts.
- [ ] Write `ssh-exec.test.mjs`: abort before opening creates no exec request; abort during channel opening rejects promptly and closes a late channel; timeout includes acquisition; 65,537 combined bytes exceed a 65,536 bound; multibyte chunks decode correctly; disposal rejects pending execs. Open a shell alongside the failed probe and assert it still echoes input.
- [ ] Run `npm run build:shared` followed by `node --test packages/host/tests/ssh-exec.test.mjs`; confirm failures identify missing cancellation/deadline/output accounting.
- [ ] Implement one idempotent settlement/cleanup path covering opening, data/error/close, abort, timeout, and SSH-session/plugin disposal. Track pending operations as needed inside SshService, with no renderer or monitor dependency. Bound retained stdout plus stderr; close only the operation's channel on its failure.
- [ ] Run the same build/test pair. Assert exact cleanup of timers/listeners/operations and shell survival, not merely rejected Promises. Run existing `packages/host/tests/host-policy.test.mjs` as regression coverage. Review and commit as `feat(host): support bounded cancellable SSH exec`.

## Task 3: Implement the pure Linux collector

**Interfaces:** Export `LINUX_MONITOR_COMMAND: string`, `CpuCounters`, `LinuxProbe`, `parseLinuxProbe(stdout: string): LinuxProbe`, and `toMonitorSnapshot(probe: LinuxProbe, previousCpu: CpuCounters | null, collectedAt: number): MonitorSnapshot` from `monitoring/linux.ts`. Use the exact shapes/calculations in design section 6. Do not export them as new application-facing Host package subpaths.

- [ ] Write parser fixtures with exact section framing, GNU/BusyBox-style root `df` spacing, missing field/failed section, non-Linux detection, unexpected shell prefix, duplicated/truncated frame, excessive integer size, and localized/non-numeric data. Include CPU guest columns to prove they are not added to totals.
- [ ] Pin numeric examples as assertions: previous CPU `[100n,0n,100n,800n,0n,0n,0n,0n]`, current `[150n,0n,150n,900n,0n,0n,0n,0n]` gives 50%; first sample gives null; memory 1,000 kB total and 400 kB available gives 614,400 used bytes and 60%; load `[0.5,1,2]` remains three raw values; disk used 40 blocks + available 50 blocks + total 100 blocks gives `40 / 90 * 100`, not 40%.
- [ ] Run `npm run build:shared` and `node --test packages/host/tests/monitor-linux.test.mjs` to establish the missing-collector failure.
- [ ] Implement fixed command framing and pure parsing/calculation. Missing MemAvailable is unavailable; counter decreases reset the baseline; malformed sections never silently become zeros. BigInt stays internal, with safe-number checks before protocol conversion.
- [ ] Run the focused build/test pair. Review fixture independence: expected values must be literal calculations, not values generated by the parser being tested. Commit as `feat(host): collect bounded Linux resource snapshots`.

## Task 4: Add HostMonitor, ownership, and dispatcher routes

**Interfaces:** `HostMonitor extends Service` uses `hostMonitor` and injects `ssh`, `terminal`, `renderer`. Public methods: `start(request: MonitorStartRequest, clientId: string): Promise<MonitorStartResult>`, `stop(subscriptionId: string, clientId: string): Promise<MonitorStopResult>`, `releaseClient(clientId: string): void`, `shutdown(): void`. Add `TerminalBridge.ownsSession(sessionId: string, clientId: string): boolean`. The public Host facade adds `startMonitor`/`stopMonitor` from design section 4.

- [ ] Write Host tests using controlled Cordis provider services and a controllable clock for immediate sampling, 5,000 ms completion-based delay, no concurrent probes, one active subscription per client, idempotent starts/stops, strict ownership, and event sequence/identity.
- [ ] Add the race cases: invalid start leaves a valid subscription active; old stop cannot stop the replacement; stop while a probe is pending aborts it and suppresses its completion; disconnect, renderer send failure, dependency unload, and shutdown clear all resources. Give cleanup tests an observable clock/channel count.
- [ ] Add `apps/web/tests/monitoring.test.mjs` using the real shared Web Host and SSH fixture: two WebSocket clients, valid owner's updates only, foreign start rejected, foreign stop harmless, malformed/unexpected request fields rejected, shell input/output and SFTP still work after a monitor timeout. Test omitted SSH exit status with a valid complete frame.
- [ ] Run `npm run build` and the new Host/Web test files to observe the expected missing-API failures.
- [ ] Implement ownership query, HostMonitor, registrations/delegations, and dispatcher validation. Register/replace records before awaiting any probe. Serialize retirement/start per session so a replacement does not overlap an uncancelled prior local operation. Use generation checks after every await. Keep collection rules out of `host.ts` and all carriers.
- [ ] Call monitor `releaseClient`/`shutdown` in Host lifecycle paths; missing monitor service produces a controlled unsupported response and never prevents terminal/Host disposal. Use Cordis scope cleanup for timers/listeners and the same idempotent shutdown method.
- [ ] Run `npm run build`, then `node --test packages/host/tests/host-monitor.test.mjs apps/web/tests/monitoring.test.mjs`, then `npm run check:boundaries`. Expect exit 0, including two-client isolation and continued terminal/SFTP use. Review and commit as `feat(host): expose session monitoring as a Cordis plugin`.

## Task 5: Add the independent ClientMonitor panel

**Interfaces:** `ClientMonitor extends Service` registers `clientMonitor`, injects only `clientView`, `clientTransport`, `clientTerminal`, and consumes `SshApi.monitor`. `createMonitorPanel(element: HTMLElement, actions: { toggleExpanded(): void; togglePaused(): void; retry(): void }): MonitorPanel` lives in `monitor-panel.ts`. `MonitorPanel` provides `render(state: MonitorPanelState): void` and `dispose(): void`; define/export `MonitorPanelState` there with the states and snapshot/expanded/paused fields in design section 7. This view helper contains no transport, timers, or session policy.

```typescript
export interface MonitorPanelState {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'paused'
    | 'unsupported' | 'error' | 'disconnected' | 'stale'
  snapshot: MonitorSnapshot | null
  expanded: boolean
  paused: boolean
  message?: string
}
```

`idle` covers connecting/no session; `paused` is the tab's explicit manual pause preference, while status may also be paused because of document visibility/collapse. Defaults per tab are expanded=true and paused=false. Treat each snapshot as one observation, without combining fields from different timestamps. An error may retain the prior snapshot with its original timestamp and clear error/stale labeling.

The existing lifecycle and Electron fixtures keep their windows hidden. Tests must control the document visibility getter and dispatch `visibilitychange` before asserting sampling, restore the getter afterward, and explicitly assert the hidden state stops sampling. Make this a test-only page setup, not a product flag that bypasses the visibility policy. Apply the same controlled visibility setup to Task 6's hidden browser fixtures.

- [ ] Extend `client-lifecycle.browser.ts` fixtures with controllable monitor starts, replies, updates, stop records, and observable subscriptions. Add behavior tests for visible connected selection, CPU warming-up/partial/error/unsupported rendering, and readiness completing while the first monitor request remains pending.
- [ ] Add active-tab A/B switching, late A event/start reply, obsolete sequence, rapid collapse/pause/resume, visibility loss/return, disconnect/reconnect with new session ID, stale timestamp, tab close, plugin removal, and remount tests. Each old subscription is stopped and cannot repaint the current one.
- [ ] Add a provider-removal acceptance: `await client.scopes.monitor.dispose()` leaves the terminal accepting input, SFTP functional, and application ready. Removing transport still unloads monitoring through injection. No terminal/chrome/SFTP/readiness inject list may gain `clientMonitor`.
- [ ] Run `node packages/ui/tests/smoke-client-lifecycle.mjs` and confirm the new behavior assertions fail before implementation. This runner bundles current source into temporary files; it does not require stale built UI assets.
- [ ] Implement the view helper, ClientMonitor state machine, and its client registration. Create the event listener/current ID before start; stop obsolete starts on late reply; use ClientScope for cleanup and clear per-tab caches on tab close. Keep synchronous construction independent from successful remote metrics.
- [ ] Add the mount between toolbar and content, with `flex: 0 0 auto` inside the existing column-flex workspace in `terminal.css`; retain the flexible, min-height-zero terminal/SFTP content. Reuse existing tokens and ResizeObserver behavior. Keep values/units readable, buttons keyboard-accessible, updates free of focus changes, and control state understandable without color alone.
- [ ] Run `node packages/ui/tests/smoke-client-lifecycle.mjs`, `npm run typecheck`, and `node --test packages/ui/tests/stylesheet-contract.test.mjs packages/ui/tests/visual-contract.test.mjs`. Update layout assertions only for intended layout changes, not to hide regressions. Review and commit as `feat(ui): show session metrics with an independent monitor plugin`.

## Task 6: Verify both entries and update current documentation

**Interfaces:** No new interfaces. Consume the complete contract and plugins; update authoritative documentation to describe actual shipped behavior and limitations.

- [ ] Extend actual Desktop and standalone Web browser integration flows (`apps/desktop/tests/electron-desktop-entry.mjs`, its `smoke-electron.mjs` launcher, and `apps/web/tests/electron-entry.mjs`/`smoke-browser.mjs` as needed) to show a fixture snapshot and prove the same connection still carries terminal/SFTP traffic. Keep business monitoring off private Electron IPC.
- [ ] Run and inspect the page with deterministic fixture metrics at wide/narrow widths, both themes/densities, and SFTP open/closed. Measure panel/terminal geometry and overflow; exercise pause/collapse/retry by keyboard. Use the repository's approved browser workflow if interactive browser inspection is needed. Do not connect to a user's real host as a substitute for fixtures.
- [ ] Update affected README/application README, architecture, development/testing, and design-system documentation plus every Chinese pair. State Linux/permission/tool assumptions, values exposed by the remote environment, CPU warm-up, root-only disk, visibility pause, and unsupported/error behavior. Mark this plan's tasks complete only with recorded evidence.
- [ ] Add the feature under `[Unreleased]` in both changelogs; document the additive protocol API and bounded exec behavior change. Run `node scripts/convert-changelog.js` and `node scripts/convert-changelog.js --sync-version`; include generated metadata changes. Keep `VERSION.txt` and workspace versions unchanged unless separately instructed to release.
- [ ] Run `npm run verify`, then `npm run verify:electron`. Expect real passing results from both; an environment limitation or exit 2 is not a pass. These cover the shared contract change and Electron/shared UI lifecycle. Packaging acceptance is only additionally required if packaging/staging changes become necessary; do not expand scope by default.
- [ ] Run `npm run release:check`, validate Markdown relative links in changed documents, and run `git diff --check`. Review the complete feature diff for monitor dependencies creeping into existing capabilities, resource leaks, and invented metric values.
- [ ] Commit the acceptance/docs changes as `test: verify session monitoring across desktop and web`. Report changed files, executed commands/results, remaining limitations, and the actual base/head commits to the next agent/user. Do not claim production-platform coverage from the fake SSH server alone.

## Done means

Every acceptance item in the design is backed by a test or recorded UI observation; both shared entries exercise real protocol traffic; plugin removal preserves existing capabilities; all required commands pass; bilingual documentation and generated metadata agree. This handoff itself is complete when these documents are written and checked, not when an unchecked task is described as implemented.

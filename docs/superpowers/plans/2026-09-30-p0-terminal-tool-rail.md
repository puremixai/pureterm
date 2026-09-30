# P0 Terminal Tool Rail Implementation Plan

[中文版本](2026-09-30-p0-terminal-tool-rail_zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. `superpowers:subagent-driven-development` is an alternative when the executing user requests delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the global left navigation and session tabs, and give the terminal workspace its own persistent right icon rail with one collapsible panel for the existing Files and Monitor tools.

**Architecture:** Add one browser-only Cordis service, `ClientSessionTools`, to own tool selection, rail buttons, the shared panel slot, and the splitter. SFTP and monitoring remain independent feature services that register their tool and retain ownership of their business data and requests. Mount the rail inside `#session-workspace`; Desktop and local Web reuse the same implementation.

**Tech Stack:** TypeScript, Cordis, DOM, CSS Grid, existing Tabler webfont icons, xterm.js, the existing i18n catalog, and isolated Electron/browser test fixtures.

**Spec:** The embedded [P0 product contract](#p0-product-contract) is the specification. It incorporates the user's confirmed layout and is sufficient to execute without the chat or screenshot attachments.

**Priority:** P0 for this feature: every mandatory acceptance condition must pass before reporting the feature complete.

**Status:** Ready for implementation; this document does not describe a shipped feature.

**Baseline:** Inspected on 2026-09-30, `main`, commit `2863e4d0cd841122f8db82107949e702160eec25`, version `0.1.0-alpha.2`. Revalidate the checkout before implementation; this hash is an inspection reference, not a command to reset the worktree.

## Global constraints

- Node.js >=24.0.0; run npm commands from the repository root with the single root lockfile.
- Use PowerShell on Windows and UTF-8 for text.
- Read [AGENTS.md](../../../AGENTS.md), [architecture](../../architecture.md), [layout decision](../../../LAYOUT-PROPOSAL.md), and [design system](../../design-system.md) before implementation.
- `@pureterm/ui` targets browsers only and cannot import Node, Electron, or Host.
- Keep the static Cordis Client composition; this task adds no runtime package or external UI dependency.
- All user-facing copy lives in `@pureterm/i18n`; maintain English and Chinese catalogs and complete paired Markdown documents.
- Shared stylesheet colors resolve through existing tokens; color literals may appear only in `styles/tokens.css`. Reuse the existing Tabler icon library and theme/focus tokens.
- Keep the current SSH/SFTP, monitoring, authentication, and carrier contracts. This feature is implemented in the shared UI; it requires no Host, protocol, Electron IPC, or runtime architecture migration.
- Tests use repository fixtures and temporary data directories, never a user's remote host or SSH data.
- Keep screenshots and research drivers outside the repository; product verification belongs in the existing test directories, not `tools/gui/`.
- Source/build/behavior checks and actual styled-layout checks are separate evidence. Build before running artifact-dependent tests.
- Preserve unrelated work; recheck paths, scripts, and assumptions if another agent changes the same files.

## Review focus

1. A slow file request or monitor acknowledgement arriving after a tab/tool switch must not repaint another terminal or leave a retired subscription active — T03.
2. Closing the panel or visiting Hosts/Keychain must preserve SSH, xterm identity, scrollback, per-tab tool selection, and split preference — T01/T03.
3. Removing SFTP must leave Monitor, its splitter, terminal input, status-bar facts, and readiness working; removing Monitor must leave Files working — T03.
4. Crossing 820px while the panel is open must change the split axis without moving the rail, losing keyboard access, or leaving stale inline tracks — T02/T04.
5. A connection failure or focused panel control must not cover the rail or strand focus when the panel is hidden/disposed — T02/T03/T04.

---

<a id="p0-product-contract"></a>

## P0 product contract

### Confirmed layout and scope

The user confirmed that the left rail remains global navigation that switches pages, and that the new right rail belongs specifically to the terminal workspace. It must not become a global sidebar.

- Global shell: persistent left navigation, top session tabs, main content, existing status bar.
- Terminal page: terminal content, optional tool panel, persistent right tool rail.
- Hosts and Keychain pages: no terminal tool rail and no terminal tool panel; their existing editors retain their own behavior.
- Selecting another terminal uses that terminal's tool selection and split preference.
- P0 includes exactly two tool registrations, in order: Files, Monitor.
- Command history, snippets, AI, Docker, port tools, screenshot lock badges, new monitoring metrics, and per-tool width preferences are future work; do not add placeholder entries.
- The screenshots establish the persistent rail and alternative panel contents. SVG implementation, repeat-click behavior, and resizing were not proven by screenshots; the rules below are PureTerm's explicit implementation contract.

### Required structure

The following is a DOM ownership sketch, not replacement markup. Preserve existing accessibility attributes, failure content, and feature mount-point IDs.

```text
#app
  top bar / #workspace-tabs
  .app-body
    #primary-nav                         global navigation
    #main
      #hosts-panel / #keychain-panel      management pages
      #connection-workspace              existing host editor
      #session-workspace                 terminal page, hidden on management pages
        .session-toolbar                 connection state, reconnect, disconnect
        #session-body
          #session-content
            #session-primary
              #terminal                  existing terminal containers
              #connection-failure        existing failure view, confined to this column
            #session-grip                shared splitter, hidden when panel is closed
            #session-tool-panel          shared panel slot, hidden when closed
              #sftp                      existing file feature mount point
              #session-monitor           existing monitoring mount point
          #session-tools                 terminal-local rail
            #sftp-toggle                 Files icon
            #monitor-toggle              Monitor icon
  existing status bar
```

A DOM assertion must prove `#session-workspace.contains(#session-tools)`. Do not mount the rail on `#app`, `.app-body`, or the global right edge of `#main`. The rail is a layout column, not a viewport-fixed overlay. Move the failure view into `#session-primary` and remove the old `.session-workspace > .connection-failure` top-offset assumption so it cannot cover the rail.

### Interaction and state rules

| ID | Required behavior | Owner / acceptance |
| --- | --- | --- |
| R01 | Rail and panel are descendants of the terminal workspace; both disappear on management pages. | Shared view / T01, T03, T04 |
| R02 | Left navigation continues switching management pages; top tabs return to retained terminals. Navigation does not close SSH. | ClientTerminal / T03 |
| R03 | The rail remains visible on terminal pages when the panel is collapsed, opened, or switched. | ClientSessionTools / T01, T02, T04 |
| R04 | New tabs start with no panel. Clicking a tool opens it; clicking the active tool collapses it; clicking another replaces the content in the same slot. At most one panel is visible. | ClientSessionTools / T01, T03 |
| R05 | Tool selection is remembered by terminal tab ID; the existing `TerminalTab.split` remains the only stored split preference. Tab A never inherits Tab B's selection or ratio. | ClientSessionTools + ClientTerminal / T02, T03 |
| R06 | Switching tools/pages does not recreate xterm, reconnect SSH, lose scrollback, or issue a second file request for an already-loaded directory without an explicit refresh. | Feature services / T03 |
| R07 | Monitor collects only for the selected, connected, visible terminal with Monitor open and not manually paused. Closing/switching stops its subscription. Retired acknowledgements are stopped exactly once. | ClientMonitor / T03 |
| R08 | Panel open/close/resize fits the existing terminal and reports valid dimensions for the same session. The rail is excluded from the pane split ratio. | Shared splitter + ClientTerminal / T02, T04 |
| R09 | Tools have localized accessible names, hover titles, visible focus and selection, and correct `aria-expanded`/`aria-controls`. Icon-only presentation is not an unnamed button. | Shared rail / T01, T02, T04 |
| R10 | Feature unload removes its registration/button and clears remembered selection of that tool; the remaining feature and splitter keep working. Dispose/remount leaves one rail and one splitter. | Cordis scopes / T03 |
| R11 | Connecting, failed, and disconnected terminal tabs retain the rail with disabled tools. Their tool panel collapses; remembered selection can restore after reconnect, using fresh business data. Failure details stay inside the terminal column. | Shared service + feature services / T02, T03, T04 |
| R12 | Desktop and standalone local Web exhibit the same scoped rail and switching behavior, with real fixture SSH/SFTP/monitor traffic still working. | Shared UI + entry smoke checks / T04, T05 |

Additional state decisions:

- Store remembered tool selection in `ClientSessionTools` by `TerminalTab.id`, not in localStorage, host records, or a global selected-tool variable.
- Effective `activeTool` is null when there is no selected tab, no connected session, or no eligible registration. On a management page, retain the remembered selection without showing the panel.
- Both registrations are available only when `tab.state === 'connected'` and `tab.sessionId` is present. A connected remote that reports monitoring unsupported still gets the existing explicit unsupported panel; do not invent capability detection or zero values.
- Reconnecting a tab may restore its remembered selection and split, but must clear the old SFTP directory/request generation and monitor snapshot/history for the previous session ID.
- A panel close button clears selection and returns focus to that tool button when possible. Opening via the icon keeps focus on the icon; periodic data updates must not replace focused controls.
- Preserve the current Ctrl/Cmd+E Files shortcut and its existing dialog/session guards, routing it through `toggle('files')`. Introduce no new global shortcut or global Escape interception.
- A feature unregister clears its selection in every remembered tab. A repeated unregister/dispose is safe; a duplicate live registration is a developer error.
- Navigating away from a panel may leave an accepted SFTP operation running for its original session. Its completion updates only that session's state and must not steal focus or repaint the active tool.

### Geometry and visual contract

- Reuse `--rail-w: 52px` for the terminal rail; match the left rail's 34px square button and 18px icon. Use `ti ti-folder` and `ti ti-activity`; no additional icon dependency.
- Keep connection state, failure summary, reconnect, and disconnect in the session toolbar. Move Files/Monitor entry buttons into the rail and remove their duplicate toolbar entries.
- Wide mode, viewport >820px: `#session-body` has a flexible content column plus the 52px rail. An open `#session-content` has terminal, 5px splitter (`--grip-w`), and panel tracks.
- Preserve the current wide default `1.35fr : 1fr`, `DEFAULT_SPLIT = 0.574`, ratio clamp `0.22..0.78`, terminal minimum 240px, and panel minimum 220px. The ratio describes the two panes, excluding the rail and splitter.
- Narrow mode, viewport <=820px: keep the rail on the right of the terminal workspace; stack terminal, horizontal splitter, and panel within the content column. Preserve minimum pane heights 120px/160px and the same split preference.
- On breakpoint changes, clear the inactive inline grid axis. The separator reports vertical orientation in wide mode and horizontal orientation in narrow mode.
- Keep the existing splitter keys: arrows change the ratio by 0.02, Shift+arrow by 0.10, Home clears the stored preference and restores CSS defaults. Retain pointer drag, capture cancellation, and focus ring.
- The tool panel's header and scrollable body retain the existing feature layout. Content scrolling must not scroll the rail or the entire terminal workspace.
- Use `min-width: 0`, `min-height: 0`, and explicit containment so xterm and long paths cannot expand the outer grid.
- Selection uses existing accent/fill tokens; focus uses `--ring`; disabled buttons retain readable labels/tooltips. Reuse both themes and current density modes rather than restyling the shell.
- Mandatory measured viewports: 1280×800, 1024×768, 821×600, 820×600, 800×600, 640×480. Test light/dark and English/Chinese. Smaller layouts retain the current fallback; this task does not establish complete mobile support.

## Current implementation and file map

| File(s), relative to root | Current responsibility / planned change |
| --- | --- |
| `packages/ui/src/index.html` | Left navigation and terminal workspace exist; add the nested body/primary/panel/rail structure and relocate tool entries and failure view. Preserve existing IDs consumed by smoke tests. |
| `packages/ui/src/services/session-tools.ts` — new | Shared registration, remembered selection, effective visibility, icon buttons, splitter, panel-slot geometry, and disposal. |
| `packages/ui/src/client.ts` | Mount/export a `sessionTools` scope after Terminal and before feature services. |
| `packages/ui/src/services/terminal.ts` | Retain terminal ownership and `split`/`setSplit()`; remove obsolete drawer event declarations once all consumers migrate. |
| `packages/ui/src/features/sftp.ts` | Keep per-session directory/navigation/busy state and operations; register Files, consume shared visibility, move splitter ownership out, and remove its private `open` state and mutual-close broadcaster. |
| `packages/ui/src/features/monitor.ts` | Keep subscriptions, paused state, generations, snapshots, and history; register Monitor and derive openness from the shared service. |
| `packages/ui/src/monitor-panel.ts` | Render metrics and panel actions; stop owning the rail button and outer panel visibility. |
| `packages/ui/src/services/chrome.ts` | Read the shared tool state for the split hint; replace its SFTP dependency with `clientSessionTools`. Keep session facts independent of feature unload. |
| `packages/ui/src/styles/terminal.css` | Terminal-local rail, panel-slot grid, independent scrolling, splitter, narrow mode, and failure-column containment. |
| `packages/ui/src/styles/chrome.css`, `styles/states.css` | Remove/adjust obsolete failure positioning only where the new nesting requires it. Preserve global navigation. |
| `packages/i18n/src/en.ts`, `zh.ts` | Localized rail names, disabled explanation, and tool-neutral separator label. |
| `packages/ui/tests/client-test-fixture.ts` — new | Extract the existing fake API/terminal fixture for reuse; add resize observations rather than duplicate fake transports. |
| `packages/ui/tests/client-lifecycle.browser.ts` | State, async ownership, unload/remount, keyboard, and navigation assertions using existing fixtures. |
| `packages/ui/tests/session-tools-layout.browser.ts`, `session-tools-layout-entry.mjs`, `smoke-session-tools-layout.mjs` — new | Real built stylesheet/assets and real xterm layout checks in the existing isolated Electron runner. |
| `packages/ui/tests/visual-contract.test.mjs`, `theme-sync.test.mjs`, `i18n-markup.test.mjs` | Update obsolete structural assumptions and validate the new scoped markup and localized attributes. |
| `apps/desktop/electron/diagnostics/smoke.ts`, `apps/desktop/tests/smoke-electron.mjs` | Extend the existing real Desktop UI checks with rail scope and tool switching. |
| `apps/web/tests/electron-entry.mjs`, `smoke-browser.mjs` | Extend standalone Web checks; keep its ordinary Node server and fixture traffic. |
| `package.json` | Include the new styled-layout smoke in root `verify:electron`; no new dependency or lockfile. |
| `README.md`/`README_zh.md`, `docs/architecture.md`/`_zh.md`, `docs/design-system.md`/`_zh.md`, `CHANGELOG.md`/`CHANGELOG_zh.md` | After implementation, describe the actual navigation, panel ownership, styles, and verification. Regenerate changelog metadata. |

Execution order is T01 → T02 → T03 → T04 → T05. These tasks contribute to one feature; an intermediate task is not a completed P0 delivery. The core tasks share files and should execute sequentially. This plan is independent of the [Desktop reliability plan](2026-09-30-desktop-reliability.md).

## Shared interfaces

Define these browser-only types in `packages/ui/src/services/session-tools.ts`. `MessageKey` comes from `@pureterm/i18n`; `TerminalTab` comes from `./terminal.js`; `Service` comes from Cordis. The class block specifies the public API, not the implementation body.

```typescript
export type SessionToolId = 'files' | 'monitor'

export interface SessionToolDefinition {
  readonly id: SessionToolId
  readonly buttonId: 'sftp-toggle' | 'monitor-toggle'
  readonly panelId: 'sftp' | 'session-monitor'
  readonly iconClass: 'ti ti-folder' | 'ti ti-activity'
  readonly labelKey: MessageKey
  available(tab: TerminalTab | undefined): boolean
}

export interface SessionToolsChange {
  readonly tabId: string | null
  readonly sessionId: string | null
  readonly tool: SessionToolId | null
}

export declare class ClientSessionTools extends Service {
  static inject: string[]
  readonly activeTool: SessionToolId | null
  register(definition: SessionToolDefinition): () => void
  isOpen(id: SessionToolId): boolean
  toggle(id: SessionToolId): void
  close(): void
}
```

- Inject `clientView` and `clientTerminal`; declare `Context.clientSessionTools` and `client/session-tools-change(change: SessionToolsChange)`.
- `activeTool`/`isOpen()` report effective visibility. `toggle()` ignores unavailable or unregistered tools. `close()` clears the current tab's remembered selection.
- `register()` owns creation/update/removal of that rail button and returns an idempotent disposer. Definitions use the exact Files/Monitor ID pairs above, ordered Files then Monitor regardless of mount order.
- Emit `client/session-tools-change` after updating DOM visibility, and whenever the active tab/session/effective tool tuple changes. Feature listeners read the already-settled state; the event must not create a mutual-close loop.
- The shared service alone writes panel-slot/root `hidden`, rail selection/ARIA, and split tracks. Feature rendering must not overwrite those values.
- Change `createMonitorPanel(root, toggle, actions)` to `createMonitorPanel(root, actions)`. Change `MonitorPanelActions.toggleOpen()` to `close()`; remove rail-only `open`/`available` fields from `MonitorPanelState`. Keep status, paused, snapshot, history, and message rendering.
- Delete private `FileState.open` and `TabMonitor.open`. SFTP may retain its public `open` getter as a delegation to `isOpen('files')`, but it is not a second state store.
- Migrate all `client/drawer-change` and `client/files-change` consumers, including ClientChrome; then remove these events rather than keep a second coordination mechanism.

Minimum new catalog entries:

| Key | English | Chinese |
| --- | --- | --- |
| `session.tools.label` | Terminal tools | 终端工具 |
| `session.tools.files` | Files | 文件 |
| `session.tools.monitor` | Monitor | 监控 |
| `session.tools.unavailable` | Connect this terminal to use tools. | 连接此终端后可使用工具。 |
| `session.tools.grip.label` | Resize the terminal and tool panel | 调整终端与工具面板的大小 |
| `session.tools.grip.value` | The terminal takes {percent}% | 终端占 {percent}% |

Preserve existing panel titles and action translations. Audit `sftp.grip.*` references when replacing their file-specific labels.

## T01 — Shared tool controller and feature migration

**Files:** New `services/session-tools.ts`; modify `client.ts`, `index.html`, `services/terminal.ts`, `features/sftp.ts`, `features/monitor.ts`, `monitor-panel.ts`, `services/chrome.ts`, both catalogs, and `tests/client-lifecycle.browser.ts`.

**Interfaces:** Produces the shared API/event above, `Client.scopes.sessionTools`, and the required nested mount points. Files/Monitor consume registration and `isOpen()`; ClientTerminal stays independent of the tool service.

- [ ] Add failing behavior checks named `terminal rail is scoped to the terminal page`, `one panel opens and a repeated click closes it`, and `unavailable tools issue no requests`. Assert R01/R03/R04/R09 against real DOM IDs and fixture API counters; preserve the existing tool selectors.
In a connected lifecycle fixture, using its existing `assert`, `input`, `click`, and `tick` helpers, the required core assertions are:

```typescript
const rail = document.getElementById('session-tools')!
assert(input('session-workspace').contains(rail), 'rail must belong to this terminal workspace')
assert(document.querySelectorAll('.session-toolbar #sftp-toggle, .session-toolbar #monitor-toggle').length === 0, 'tools must not have duplicate toolbar entries')
click('sftp-toggle'); await tick()
assert(!input('sftp').hidden && input('session-monitor').hidden, 'Files occupies the one panel slot')
click('monitor-toggle'); await tick()
assert(input('sftp').hidden && !input('session-monitor').hidden, 'Monitor replaces Files')
click('monitor-toggle'); await tick()
assert(input('session-tool-panel').hidden && !rail.hidden, 'collapse preserves the rail')
```

- [ ] Build shared packages and run `node packages/ui/tests/smoke-client-lifecycle.mjs`; record the new assertions failing before implementation.
- [ ] Implement the shared service, ordered button registrations, per-tab remembered selection, effective availability, and event. Use `ClientScope` for resources and migrate the existing splitter ownership into this scope; T02 completes geometry details.
- [ ] Add the nested mount points, mount the service after Terminal, and register both features. Remove their private openness/mutual-close logic and rail ownership. Panel close and Ctrl/Cmd+E route through the shared API; preserve file and subscription business guards.
- [ ] Migrate MonitorPanel and ClientChrome to the shared contract. The status bar must not depend on SFTP being installed; do not change its cipher/host-key source.
- [ ] Re-run the behavior smoke and `npm run typecheck`; adapt parent-element assertions to `#session-content` and replace expectations of toolbar text with accessible-name/ARIA assertions. Commit `feat(ui): unify terminal tool selection and registrations`.

## T02 — Terminal-local layout, splitter, and accessible controls

**Files:** `index.html`, `services/session-tools.ts`, `styles/terminal.css`, `styles/chrome.css`, `styles/states.css`, `services/terminal.ts`, and relevant UI contract/lifecycle tests.

**Interfaces:** Consumes T01's mount points and tool state. Uses existing `ClientTerminal.setSplit(ratio: number | null)`, `fit()`, and `settleLayout(): Promise<boolean>`; creates no replacement terminal or second ratio store.

- [ ] Add failing checks for rail persistence, a single splitter, keyboard ratio steps/clamps/Home, focus return on close, and failure-view ancestry. Extend existing meaningful splitter checks rather than assert stylesheet text alone.
With a tool panel open, extend the existing separator test with these exact assertions:

```typescript
const grip = document.getElementById('session-grip')!
assert(grip.getAttribute('aria-orientation') === (window.innerWidth > 820 ? 'vertical' : 'horizontal'), 'separator follows the active grid axis')
grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
assert(grip.getAttribute('aria-valuenow') === '57', 'Home restores the default ratio')
grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
assert(grip.getAttribute('aria-valuenow') === '59', 'one arrow changes the ratio by two points')
```

- [ ] Implement the two-level grid in the geometry contract: outer content+rail, inner terminal+splitter+panel. Hide both slot and splitter when collapsed; clear inline tracks in that state so no empty column remains.
- [ ] Preserve pointer capture/drag cancellation; measure `#session-content`, excluding rail and splitter. Update orientation and active axis at the 820px breakpoint, including when only Monitor is installed.
- [ ] Keep ratio storage on the tab, preserve the specified defaults/minima, and fit after geometry settles using existing terminal layout hooks. Do not fit/recreate terminals merely because a metric value changes.
- [ ] Constrain failure UI to `#session-primary`. Keep reconnect/copy/edit/close actions and toolbar diagnostics functional, with the disabled tool rail unobscured.
- [ ] Implement icon-only controls, localized names/titles and disabled explanation, focus ring and active state. Update attributes without rebuilding buttons on each render. Native Enter/Space work; add no application-wide Escape handler.
- [ ] Run UI contract tests, typecheck, and behavior smoke. T04 supplies measured styled acceptance; do not report geometry verified before that gate. Commit `feat(ui): dock tools inside the terminal workspace`.

## T03 — Session ownership, async races, and feature disposal

**Files:** `services/session-tools.ts`, `features/sftp.ts`, `features/monitor.ts`, `services/chrome.ts`, `tests/client-lifecycle.browser.ts`; create `tests/client-test-fixture.ts`.

**Interfaces:** Extract/export existing `fixture()` and `deferred<T>()` for browser fixtures. Preserve its existing returned API, monitor controls, stats, terminals, and listeners; add `stats.resizes: Array<{ sessionId: string; cols: number; rows: number }>` recorded by `api.resize` for T04.

- [ ] Add named checks `navigation retains terminal identity and tool choice` and `tools and split preferences belong to each tab`. Open A/B, use Files on A and Monitor on B, visit Hosts/Keychain, and return; assert unchanged session IDs, terminal objects/scrollback, split values, and SSH open/close counters.
For a connected fixture `f` and its mounted `client`, the navigation check must include:

```typescript
const tab = client.context.clientTerminal.active!
const before = { sessionId: tab.sessionId, terminal: tab.terminal, opens: f.stats.opens, closes: f.stats.closes }
click('nav-keychain'); await tick()
client.context.clientTerminal.select(tab.id); await tick()
assert(tab.sessionId === before.sessionId && tab.terminal === before.terminal, 'navigation preserves SSH and xterm identity')
assert(f.stats.opens === before.opens && f.stats.closes === before.closes, 'navigation does not open or close SSH')
```

- [ ] Add `background file replies cannot overwrite the active tool`: delay A's list, switch to B/Monitor, resolve A, and verify B stays visible; returning to A uses A's result without an extra implicit list.
- [ ] Extend monitor tests for Files/Monitor rapid switches, manual pause, hidden document, late start acknowledgement, late update, and reconnect. Each retirement stops once; reconnect starts a new generation with no old samples.
- [ ] Add `tools collapse while disconnected and restore with fresh data`. Disable controls while connecting/failed/disconnected; retain the choice by tab; reconnect restores only new-session business state.
- [ ] Add `monitor survives SFTP unload` and its reverse: remove the active feature, confirm its button/selection disappear, use the other tool, move its splitter, and verify terminal input, status facts, and readiness. Dispose the shared service and assert no orphan listeners, grip, or registrations; remount gives exactly one rail/grip.
- [ ] Fix only ownership/lifecycle gaps these cases expose. Remove obsolete layout code and drawer events; do not weaken late-response or subscription-generation checks.
- [ ] Run the behavior smoke and typecheck; report assertions and actual counters. Commit `test(ui): cover terminal tool ownership and disposal`.

## T04 — Real styled layout and both-entry acceptance

**Files:** Create `tests/session-tools-layout.browser.ts`, `session-tools-layout-entry.mjs`, `smoke-session-tools-layout.mjs`; modify root `package.json`, existing Desktop diagnostic/smoke files, and Web `electron-entry.mjs`/`smoke-browser.mjs`.

**Interfaces:** The browser module exposes `window.runSessionToolsLayoutChecks(options: { theme: 'dark' | 'light'; locale: 'en' | 'zh' }): Promise<string[]>`. The isolated Electron entry sets each content viewport and executes it; the runner requires `[SESSION-TOOLS-LAYOUT]` and an explicit success/exit result.

- [ ] Add the layout fixture using the existing Electron runner's isolation/timeouts/process cleanup. Copy freshly built `packages/ui/dist/` assets into a temporary directory, replace only the application script with the fixture script, and keep real CSS/fonts. Use the shared fake SSH API but the default real xterm factory.
- [ ] Wait for stylesheet/font readiness and settled layout. Measure rectangles and overflow for all specified viewports, both themes and locales; assert rail width 52px within 1 CSS pixel, button size, ancestry, and unchanged rail position across close/Files/Monitor.
After stylesheet/font readiness and an open tool panel, the styled fixture must include:

```typescript
await client.context.clientTerminal.settleLayout()
const rail = document.getElementById('session-tools')!
const box = rail.getBoundingClientRect()
assert(input('session-workspace').contains(rail), 'styled rail remains terminal-local')
assert(Math.abs(box.width - 52) <= 1, 'real CSS produces the 52px rail')
assert(document.documentElement.scrollWidth <= window.innerWidth + 1, 'required viewport has no outer horizontal overflow')
```

- [ ] Verify wide/narrow axes, panel/body scrolling, hidden tracks, failure containment, and visible keyboard focus. Opening a wide panel reduces terminal width; closing restores it. Narrow panels change terminal height while the rail stays on the right.
- [ ] Assert real terminal cols/rows are positive and updated for the same session after open/close/resize; compare geometry after layout rather than hard-code machine-dependent font cell counts. Record resize API observations and verify no reconnect/terminal recreation.
- [ ] Extend existing Desktop and Web real-SSH smoke paths to assert rail ancestry, no duplicate toolbar tool entries, Files/Monitor switching, and absence on management pages. Preserve fixture traffic, marker validation, and existing data/auth checks.
- [ ] Add `node packages/ui/tests/smoke-session-tools-layout.mjs` to root `verify:electron`. Its focused invocation follows `npm run build:shared`; the aggregate already builds first. Keep the legacy behavior harness unstyled and identify its evidence accurately.
- [ ] Run the styled fixture and both-entry checks; fix failures and record measured results. Commit `test(ui): verify styled terminal tools in desktop and web`.

## T05 — Documentation, final verification, and handoff

**Files:** Both READMEs, architecture/design-system pairs, CHANGELOG pair, generated `packages/ui/src/lib/changelog.ts`, and the implementation branch's result report.

**Interfaces:** Consumes completed T01–T04 and R01–R12. No version bump is required just to execute this feature plan; follow the repository release rules if a release is separately requested.

- [ ] Update current documentation after code implements the contract. Explain global left navigation versus terminal-local tools, single panel ownership, state lifetime, narrow layout, and the new verification entry. Keep every English/Chinese pair complete.
- [ ] Record the visible change under `[Unreleased]`; run both changelog generation commands and keep generated metadata synchronized.
- [ ] Run the final commands below sequentially. `npm run verify` is mandatory before code merge. `verify:electron` is required here for styled UI, both-entry smoke, and Client lifecycle evidence, even though no Electron runtime change is planned.
- [ ] Check links, `git diff --check`, test markers/exit codes, and the final diff for unrelated changes. A recognized environment limitation or exit code 2 is not a passing result; report the affected gate explicitly.
- [ ] Fill the acceptance checklist and give the next reviewer the branch/commit, changed files, actual test results, measured layout evidence, and any remaining limitations. Commit `docs(ui): document terminal-local tool navigation`.

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
npm run verify
npm run verify:electron
git diff --check
```

For development iterations, use these focused checks after building shared artifacts; do not repeatedly run the full suite without new failures or changes:

```powershell
npm run build:shared
npm run typecheck
node --test packages/ui/tests/visual-contract.test.mjs packages/ui/tests/theme-sync.test.mjs packages/ui/tests/stylesheet-contract.test.mjs packages/ui/tests/i18n-markup.test.mjs
node packages/ui/tests/smoke-client-lifecycle.mjs
node packages/ui/tests/smoke-session-tools-layout.mjs
```

## Completion checklist

- [ ] R01/R02: Hosts and Keychain show no terminal tools; the left rail/top tabs retain their roles and navigation keeps SSH alive.
- [ ] R03/R04: The terminal rail persists with no panel, Files, or Monitor; one click opens/switches and a repeated click collapses.
- [ ] R05/R06: Each tab restores its own tool/ratio; tool and page changes preserve terminal identity, scrollback, session IDs, and file ownership.
- [ ] R07: Hidden/inactive/paused/closed monitoring does not keep collecting; late events cannot revive a retired generation.
- [ ] R08: Wide/narrow layout and keyboard/pointer resize work with real CSS/xterm; no empty gutter, overlap, or outer overflow at required viewports.
- [ ] R09: Icon buttons have localized names/titles, selection and focus states, working native keyboard activation, and correct ARIA.
- [ ] R10: Either feature can unload independently; shared-service/root disposal and remount release resources without duplicates.
- [ ] R11: Connecting/failed/disconnected tools are disabled; the failure view stays inside the terminal column; reconnect uses fresh data.
- [ ] R12: Real Desktop and local Web smoke checks pass with fixture SSH, SFTP, monitoring, and scope assertions.
- [ ] All required commands passed or have explicitly reported limitations; current docs/catalogs/generated metadata are synchronized.

## Forwardable execution prompt

> Implement the P0 terminal tool rail using this document and its embedded product contract. Read the repository instructions and current sources first, then execute T01–T05 in order. Preserve the global left page navigation and top session tabs. Place Files/Monitor icons and their shared panel strictly inside the terminal workspace; management pages must not display them. Centralize tool selection, rail, panel, and splitter ownership without changing SSH/Host/carrier architecture. Preserve per-tab state, request ownership, monitoring retirement, and feature disposal. Complete the actual-stylesheet/xterm and Desktop/Web acceptance checks, update paired documentation, and report the branch/commit, executed commands, measured results, and remaining limitations. Completion requires every mandatory acceptance condition in this plan.

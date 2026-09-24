# Chrome Rebuild Implementation Plan

[中文版本](2026-09-24-chrome-rebuild_zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the application chrome — a 52px icon rail, a 40px top bar that carries the brand mark and the session tabs, a 24px status bar, and working theme and density switches — so the light theme becomes reachable and the shell reads as one measured instrument instead of a stack of panels.

**Architecture:** Three geometry tokens (`--chrome-h`, `--rail-w`, `--status-h`) become the single source for every height the chrome has, including the Electron title-bar overlay height, which `theme-sync.test.mjs` already ties to CSS and will now read from the token sheet. A new `ClientChrome` Cordis service owns the status bar and the two switches; it subscribes to the internal events the terminal service already emits and to one new resize event, and it persists both preferences in `localStorage`, which the codebase does not currently use at all.

**Tech Stack:** CSS custom properties, Cordis `Service` plugins, TypeScript (browser-only `@pureterm/ui`), Node's built-in test runner, Electron `titleBarOverlay`, Tabler webfont icons.

**Target design:** `docs/superpowers/prototype/graphite-target.html` — open it, switch the theme and density there, and build what it shows. It reads the real `tokens.css`, so it is the same source of truth.

---

## Prerequisites and current facts

Read `AGENTS.md`, `docs/architecture.md`, `docs/design-system.md`, and the two preceding plans
(`2026-09-23-token-foundation.md`, `2026-09-24-graphite-palette-flip.md`) before starting.

Verified against the tree at commit `36b7c2c`:

- `packages/ui/src/styles/tokens.css` is the only file that may hold a colour literal, and
  `:root` declares 72 custom properties. Metrics are theme-invariant by contract: `:root` and
  `[data-theme="light"]` match the same element, so a metric declared twice is the duplicate debt
  this system exists to remove. `design-tokens.test.mjs` enforces that with `GLOBAL_TOKENS`.
- `[data-theme="light"]` and `[data-density="compact"]` exist in `tokens.css` and **nothing writes
  them**. `grep -rn "data-theme" packages/ui/src apps/desktop apps/web` returns only the selector
  and its own comments. This plan makes both reachable.
- The chrome geometry is currently three hand-copied numbers: `grid-template-rows: 76px` and
  `env(titlebar-area-height, 76px)` in `styles/chrome.css:5,19`, and `height: 76` in
  `apps/desktop/electron/app/shell.ts:70`. `theme-sync.test.mjs:45-57` is what keeps them equal.
- The rail is `278px` (`chrome.css:107`) with a `232px` override at 1250px (`:110`), and
  `visual-contract.test.mjs:32` asserts the literal `278px`.
- `#nav-toggle` and `.nav-collapsed` are live (`index.html:23`, `features/hosts.ts:50-54`,
  `chrome.css:104-105`); `.window-control`, `.update-pill`, `.workspace-chevron` and
  `.app-shell.failure-mode` are **dead CSS** — no markup and no code names them.
  `failure-mode` is only ever removed (`services/terminal.ts:229`), never added.
- Session tabs are built in `services/terminal.ts:165-210` and appended to `#workspace-tabs`;
  `.nav-item.active` is toggled at `services/terminal.ts:232-233`.
- `ClientView.element(id)` (`client-runtime.ts:55-59`) **throws** when an id is missing, so every
  element this plan reads must be added to `index.html` in the same or an earlier task.
- A service is registered in `packages/ui/src/client.ts:15` (the `scopes` key union) and `:31-39`
  (the `context.plugin(...)` list). `features/readiness.ts:9` lists the providers that gate
  readiness; `ClientChrome` must **not** be added there, because a status bar is not a readiness
  condition and adding it would make a chrome bug block the app.
- Status-bar data, checked field by field: connection state is available (`TabState`,
  `services/terminal.ts:6`, plus `tab.message`); `user@host:port` is available from
  `tab.request`; terminal `cols × rows` is available (`terminal-view.ts:5-6`); the app version is
  available and currently has **no importer** (`lib/version.ts:2`). Uptime, negotiated cipher and
  remote host key type are **not available anywhere** — `SshSessionInfo` is
  `{id, host, port, username}` (`packages/host/src/services/ssh.ts:79-84`) and no code reads ssh2's
  negotiated state. SFTP transfer rate is not available either: transfers are whole-file RPCs
  (`features/sftp.ts:161-184`).
- `localStorage` is used nowhere in `packages/`; CSP is
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'` (`index.html:11-14`).
  `script-src 'self'` forbids the usual inline pre-paint theme script, so a stored light theme
  repaints one frame after `app.js` runs. That is accepted and documented, not worked around.
- Verified icon names present in `@tabler/icons-webfont`: `ti-sun`, `ti-moon`,
  `ti-arrows-minimize`, `ti-arrows-maximize`. `ti-rows`, `ti-density` and `ti-layout-density` do
  not exist — do not invent them.

## Commands

From the repository root. `npm run test:unit` runs every workspace suite; the UI guards are the
five files under `packages/ui/tests/`.

```powershell
node --test "packages/ui/tests/design-tokens.test.mjs"
node --test "packages/ui/tests/theme-sync.test.mjs"
node --test "packages/ui/tests/visual-contract.test.mjs"
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run verify
npm run verify:electron
npm run release:check
```

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/ui/src/styles/tokens.css` | The three chrome geometry tokens. | Modify |
| `packages/ui/tests/design-tokens.test.mjs` | Teach the metric-parity guards about them. | Modify |
| `packages/ui/src/styles/chrome.css` | Top bar, rail, status bar, and the grid that holds them. | Modify |
| `packages/ui/src/index.html` | Rail labels as `aria-label`, brand SVG, favicon, top-bar controls, status bar markup. | Modify |
| `packages/ui/tests/theme-sync.test.mjs` | Overlay height and favicon colours read from the token sheet. | Modify |
| `apps/desktop/electron/app/shell.ts` | The 76px overlay becomes 40px. | Modify |
| `packages/ui/tests/visual-contract.test.mjs` | The rail assertion moves from a literal to a token. | Modify |
| `packages/ui/src/features/hosts.ts` | Lose the `#nav-toggle` handler. | Modify |
| `packages/ui/src/services/terminal.ts` | Emit `client/terminal-resize`; drop dead class writes. | Modify |
| `packages/ui/src/services/chrome.ts` | Status bar content, theme switch, density switch. | Create |
| `packages/ui/src/client.ts` | Mount `ClientChrome`. | Modify |
| `packages/ui/tests/client-lifecycle.browser.ts` | Behaviour: status fields, theme persistence, density. | Modify |
| `docs/design-system.md` + `_zh.md`, `CHANGELOG.md` + `_zh.md`, `docs/architecture.md` + `_zh.md` | Record the new state. | Modify |

---

### Task 1: The three geometry tokens

**Files:**
- Modify: `packages/ui/src/styles/tokens.css:91` (after `--ease`)
- Modify: `packages/ui/tests/design-tokens.test.mjs:44-50`

- [ ] **Step 1: Extend the metric list in the guard first**

In `packages/ui/tests/design-tokens.test.mjs`, replace the `GLOBAL_TOKENS` block with:

```js
const GLOBAL_TOKENS = [
  '--r-1', '--r-2', '--r-3', '--r-4', '--r-full',
  '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6',
  '--row-h', '--row-h-compact',
  '--z-drawer', '--z-popover', '--z-toast', '--z-dialog',
  '--t-1', '--t-2', '--t-3', '--ease',
  // The chrome's own geometry. These three are the only place a shell height is
  // written down, and theme-sync.test.mjs ties the Electron title-bar overlay to
  // --chrome-h, so a fourth copy of 40px cannot appear silently.
  '--chrome-h', '--rail-w', '--status-h',
]
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test "packages/ui/tests/design-tokens.test.mjs"`
Expected: FAIL — `:root is missing --chrome-h` inside
`theme-invariant metrics live in :root only`.

- [ ] **Step 3: Declare them**

In `packages/ui/src/styles/tokens.css`, insert directly after the `--ease` line and before the
blank line that precedes `--font-ui`:

```css
  /* Chrome geometry. --chrome-h is the height Electron's title-bar overlay is
     told to reserve, so theme-sync.test.mjs reads it as the single source. */
  --chrome-h: 40px;
  --rail-w: 52px;
  --status-h: 24px;
```

- [ ] **Step 4: Run the guard again**

Run: `node --test "packages/ui/tests/design-tokens.test.mjs"`
Expected: PASS, 14 tests. If `--shadow-pop is the one theme-varying derived token` fails, the new
tokens were written inside the light block instead of `:root`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): add the chrome geometry tokens"
```

---

### Task 2: Retarget the grid, the top bar and the Electron overlay

The `#app` grid gains its third row here, so the status bar markup must land in Task 5 before any
visual check. Between these two tasks the app renders a 40px top bar and no status row, which is a
visually incomplete but structurally correct state; do not run the Electron entry test between them.

**Files:**
- Modify: `packages/ui/src/styles/chrome.css:1-10,13-25,107-111`
- Modify: `apps/desktop/electron/app/shell.ts:66-72`
- Modify: `packages/ui/tests/theme-sync.test.mjs:20-26,45-57`
- Modify: `packages/ui/tests/visual-contract.test.mjs:32`

- [ ] **Step 1: Move the height assertion onto the token sheet**

In `packages/ui/tests/theme-sync.test.mjs`, add this helper immediately after the existing
`declaration()` function (which only matches hex):

```js
function pixel(name) {
  const match = new RegExp(`^[ \\t]*${name}:[ \\t]*(\\d+)px[ \\t]*;`, 'm').exec(code)
  assert.ok(match, `${name} must be an integer px declaration in styles/tokens.css for this check to mean anything`)
  return match[1]
}
```

Then replace the body of `test('the overlay height agrees with the top bar the CSS draws', ...)`
from `const overlay = ...` to the end of the test with:

```js
  const overlay = /titleBarOverlay:\s*\{([^}]*)\}/.exec(shell)
  assert.ok(overlay, 'shell.ts lost its titleBarOverlay block')
  const height = /height:\s*(\d+)/.exec(overlay[1])
  assert.ok(height, 'the titleBarOverlay block lost its height')
  const chromeHeight = pixel('--chrome-h')
  const row = /#app\s*\{[^}]*grid-template-rows:\s*var\(--chrome-h\)\s+minmax\(0,\s*1fr\)\s+var\(--status-h\);/
    .exec(chrome)
  const fallback = /env\(titlebar-area-height,\s*(\d+)px\)/.exec(chrome)
  assert.ok(row, 'the #app grid must be three rows: var(--chrome-h), the content, then var(--status-h)')
  assert.ok(fallback, 'chrome.css must keep an env(titlebar-area-height, …) fallback to compare against')
  assert.equal(height[1], chromeHeight, 'the overlay height must equal --chrome-h, the only written top-bar height')
  assert.equal(fallback[1], chromeHeight,
    'the fallback must equal --chrome-h; env() cannot read a custom property, so this literal is the one place the number is repeated and this assertion is what ties it')
  assert.equal(pixel('--status-h'), '24', 'the status row is a design decision, not a leftover')
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test "packages/ui/tests/theme-sync.test.mjs"`
Expected: FAIL — `the #app grid must be three rows: …`.

- [ ] **Step 3: Rewrite the grid and the top bar**

In `packages/ui/src/styles/chrome.css`, replace lines 1-25 (the `#app` and `.app-topbar` blocks,
keeping the file's leading comment) with:

```css
/* Application shell — the #app grid, top bar, workspace and session tabs, the
   navigation rail, the status bar, and the state classes on .app-shell that
   reshape them. Heights come from --chrome-h and --status-h; the one literal
   inside env() below is the number Electron reserves for its overlay, and
   theme-sync.test.mjs is what keeps it equal to the token. */
#app {
  display: grid;
  grid-template-rows: var(--chrome-h) minmax(0, 1fr) var(--status-h);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--c-canvas);
}

/* Application chrome */
.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  width: env(titlebar-area-width, 100%);
  height: env(titlebar-area-height, 40px);
  margin-left: env(titlebar-area-x, 0px);
  padding: 0 8px 0 12px;
  background: var(--c-chrome);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
}
```

Then replace the `.app-body` rule and its 1250px override (lines 107-111) with:

```css
.app-body { display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); min-height: 0; overflow: hidden; }
```

- [ ] **Step 4: Tell Electron the same height**

In `apps/desktop/electron/app/shell.ts`, change the overlay block from `height: 76,` to:

```ts
      titleBarOverlay: {
        color: '#0e1013',
        symbolColor: '#7d838d',
        height: 40,
      },
```

- [ ] **Step 5: Move the rail assertion off the literal**

In `packages/ui/tests/visual-contract.test.mjs`, replace line 32 with:

```js
  assert.match(css, /grid-template-columns:\s*var\(--rail-w\)\s+minmax\(0,\s*1fr\)/, 'desktop shell needs a stable navigation rail')
```

- [ ] **Step 6: Run every UI guard**

Run: `node --test "packages/ui/tests/*.test.mjs"`
Expected: PASS. `stylesheet-contract.test.mjs` must stay green: no colour literal was added.

- [ ] **Step 7: Build and typecheck, then commit**

```powershell
npm run build
npm run typecheck
```
```bash
git add packages/ui/src/styles/chrome.css apps/desktop/electron/app/shell.ts packages/ui/tests/theme-sync.test.mjs packages/ui/tests/visual-contract.test.mjs
git commit -m "feat(ui): drive the shell geometry from tokens"
```

---

### Task 3: The icon rail

The rail stops being a 278px list of labelled rows and becomes 52px of icons. The visible label is
removed from the markup, so the accessible name must move to `aria-label` in the same edit — a
button whose only text is `display: none` has no name at all.

**Files:**
- Modify: `packages/ui/src/index.html:35-41`
- Modify: `packages/ui/src/styles/chrome.css:113-122,131-141,143-154,177-181`

- [ ] **Step 1: Rewrite the nav markup**

Replace `packages/ui/src/index.html` lines 35-41 (the whole `<nav id="primary-nav">` element) with:

```html
        <nav id="primary-nav" class="primary-nav" aria-label="主导航">
          <button type="button" id="nav-hosts" class="nav-item active" aria-label="Hosts" title="Hosts"><span class="nav-icon" aria-hidden="true"><i class="ti ti-server-2"></i></span></button>
          <button type="button" id="nav-keychain" class="nav-item" aria-label="密钥管理" title="密钥管理"><span class="nav-icon" aria-hidden="true"><i class="ti ti-key"></i></span></button>
          <div class="nav-divider" aria-hidden="true"></div>
          <button type="button" id="nav-shortcuts" class="nav-item" aria-label="快捷键" title="快捷键"><span class="nav-icon" aria-hidden="true"><i class="ti ti-keyboard"></i></span></button>
        </nav>
```

`.nav-footer` is gone: its content ("Local workspace" and the status dot) belongs to the status bar
in Task 5, and a footer inside a 52px rail cannot render either of them.

- [ ] **Step 2: Rewrite the rail rules**

Replace `packages/ui/src/styles/chrome.css` lines 113-122 (from the `/* The rail and the top bar`
comment through `.nav-status-dot`) with:

```css
/* The rail and the top bar are one ground, so they separate by hairline rather
   than by two different tints, which is how the old palette read as a skin. */
.primary-nav { display: flex; min-height: 0; flex: none; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0; background: var(--c-chrome); border-right: 1px solid var(--line); }
.nav-divider { width: 20px; height: 1px; margin: 6px 0; background: var(--line); }
.nav-item { position: relative; display: grid; width: 34px; height: 34px; place-items: center; padding: 0; border-color: transparent; border-radius: var(--r-2); background: transparent; color: var(--tx-4); font-size: 18px; line-height: 1; }
.nav-item:hover:not(:disabled) { color: var(--tx-2); border-color: transparent; background: var(--c-raised); }
.nav-item.active { color: var(--ac); background: var(--ac-bg); }
/* The active marker sits outside the button box, on the hairline, because a
   34px square cannot carry a 2px inset without moving its icon off centre. */
.nav-item.active::before { content: ''; position: absolute; top: 9px; bottom: 9px; left: -10px; width: 2px; border-radius: 1px; background: var(--ac); }
.nav-item:focus-visible { outline: none; box-shadow: var(--ring); }
.nav-icon { display: grid; place-items: center; width: auto; color: inherit; font-size: inherit; font-weight: 400; }
```

- [ ] **Step 3: Delete the rail's responsive overrides**

In `packages/ui/src/styles/chrome.css`, the 820px block (lines 131-141) currently reshapes the rail
for a width it no longer needs. Replace that whole `@media (max-width: 820px)` block with only the
top-bar padding it still needs:

```css
@media (max-width: 820px) {
  .app-topbar { padding-left: 10px; }
  .workspace-switcher { min-width: 44px; width: 44px; padding: 0 10px; }
  .workspace-copy, .workspace-chevron { display: none; }
}
```

Then in the 620px block (lines 143-154), delete the four rail-specific lines
(`.primary-nav { … }`, `.nav-item { … }`, both `.nav-item span …` rules and `.nav-footer { … }`),
keeping the `body`, `#app`, `.app-topbar`, `.topbar-actions`, `.app-body` and `.app-tab` rules.

- [ ] **Step 4: Confirm the guards and the build**

Run: `node --test "packages/ui/tests/*.test.mjs"`
Expected: PASS. `visual-contract.test.mjs:23` still finds `class="ti ti-server-2"` because the rail
keeps that icon.

```powershell
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/index.html packages/ui/src/styles/chrome.css
git commit -m "feat(ui): collapse the navigation sidebar into a 52px icon rail"
```

---

### Task 4: Remove the dead chrome

Four rules name nothing that exists. Deleting them is what makes Task 7's controls the only
chrome buttons, and it is cheaper to do now than to keep explaining.

**Files:**
- Modify: `packages/ui/src/index.html:23`
- Modify: `packages/ui/src/features/hosts.ts:50-54`
- Modify: `packages/ui/src/styles/chrome.css:33-51,104-105,100-101,84,125-127`

- [ ] **Step 1: Delete the toggle from the markup**

Remove this line from `packages/ui/src/index.html` (line 23):

```html
          <button type="button" id="nav-toggle" class="icon-button topbar-menu" aria-label="展开或收起主导航" aria-expanded="true"><i class="ti ti-menu-2" aria-hidden="true"></i></button>
```

- [ ] **Step 2: Delete its handler**

In `packages/ui/src/features/hosts.ts`, remove these five lines (50-54):

```ts
    this.scope.listen(view.element('nav-toggle'), 'click', () => {
      if (ctx.clientTerminal.active) ctx.clientTerminal.select(null)
      const collapsed = view.element('app').classList.toggle('nav-collapsed')
      view.element('nav-toggle').setAttribute('aria-expanded', String(!collapsed))
    })
```

The line above it already covers the behaviour that mattered: `for (const id of ['workspace-home',
'nav-hosts']) … ctx.clientTerminal.select(null)`. Removing the toggle cannot strand a session view.

- [ ] **Step 3: Delete the dead CSS**

In `packages/ui/src/styles/chrome.css`:
- In the shared `.icon-button, .window-control` rule, drop every `, .window-control` selector part
  so the block reads `.icon-button { … }` and `.icon-button:hover:not(:disabled) { … }`, and delete
  the two `.window-control` rules that follow (`min-width: 38px …` and
  `.window-control.close:hover …`).
- Delete `.topbar-menu { margin-right: 2px; font-size: 24px; }`.
- Delete the two `.app-shell.nav-collapsed` rules and their comment.
- Delete the two `.update-pill` rules and the `.workspace-chevron` rule.
- Delete the `.app-shell.failure-mode` block (the comment plus both rules). Nothing ever adds that
  class: `services/terminal.ts:229` only removes it, and the failure view is driven by
  `view.element('connection-failure').hidden` at `:255`.

- [ ] **Step 4: Delete the dead class write**

In `packages/ui/src/services/terminal.ts:229`, remove:

```ts
    app.classList.remove('failure-mode')
```

- [ ] **Step 5: Prove nothing referenced them**

```powershell
git grep -n "nav-toggle\|nav-collapsed\|window-control\|update-pill\|failure-mode\|topbar-menu" -- packages apps docs
```
Expected: no output. If `docs/design-system.md` or a plan mentions them, leave the docs alone —
dated plan files are history; `docs/design-system.md` is corrected in Task 8.

- [ ] **Step 6: Verify and commit**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
```
```bash
git add packages/ui/src/index.html packages/ui/src/features/hosts.ts packages/ui/src/styles/chrome.css packages/ui/src/services/terminal.ts
git commit -m "refactor(ui): delete chrome CSS that names nothing"
```

---

### Task 5: Brand mark, favicon, and the status bar shell

The mark and the favicon are the same glyph in two places, so they are tied by a test rather than
by a promise: `theme-sync.test.mjs` compares the path data and the two colours the favicon must
inline.

**Files:**
- Modify: `packages/ui/src/index.html:14-17,25,40,176-184`
- Modify: `packages/ui/tests/theme-sync.test.mjs:34-43`
- Modify: `packages/ui/src/styles/chrome.css`

- [ ] **Step 1: Write the failing tie**

In `packages/ui/tests/theme-sync.test.mjs`, append this test:

```js
// The mark is drawn twice: once as the 18px glyph in the top bar, where CSS owns
// the colour, and once as a favicon, where a data: URI cannot read a custom
// property. Two copies of one glyph is the exact debt this system exists to
// remove, so the path data and both colours are compared instead of trusted.
test('the brand mark and the favicon are the same glyph in the same colours', () => {
  const mark = /class="workspace-mark"[^>]*>([\s\S]*?)<\/span>/.exec(html)
  assert.ok(mark, 'index.html lost the .workspace-mark element')
  const paths = [...mark[1].matchAll(/d="([^"]+)"/g)].map((m) => m[1])
  assert.equal(paths.length, 2, 'the mark is a chevron and a cursor bar, in that order')

  const icon = /rel="icon" href="data:image\/svg\+xml,([^"]+)"/.exec(html)
  assert.ok(icon, 'index.html must carry an inline SVG favicon')
  const svg = decodeURIComponent(icon[1])
  // The URI uses single quotes because the attribute itself uses double ones, so
  // only the path data and the colour value are compared, never the quoting.
  for (const d of paths) assert.ok(svg.includes(d), `the favicon is missing the mark path ${d}`)
  assert.equal(/fill=['"]?(#[0-9a-fA-F]{6})/.exec(svg)?.[1].toLowerCase(), declaration('--c-chrome'),
    'the favicon ground must equal --c-chrome, the ground the top bar paints')
  assert.equal(/stroke=['"]?(#[0-9a-fA-F]{6})/.exec(svg)?.[1].toLowerCase(), declaration('--ac'),
    'the favicon glyph must equal --ac, which is what .workspace-mark colours itself with')
})
```

Run: `node --test "packages/ui/tests/theme-sync.test.mjs"`
Expected: FAIL — `the mark is a chevron and a cursor bar, in that order`, because the element
currently holds the text `PT` and contributes no path data.

- [ ] **Step 2: Replace the text mark with the SVG mark**

In `packages/ui/src/index.html:25`, replace

```html
            <span class="workspace-mark" aria-hidden="true">PT</span>
```

with

```html
            <span class="workspace-mark" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 4l4 4-4 4"/><path d="M8.5 12.5h5"/></svg></span>
```

- [ ] **Step 3: Add the favicon**

In `packages/ui/src/index.html`, insert immediately after the `<title>` line:

```html
    <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Crect%20width='16'%20height='16'%20rx='3'%20fill='%230e1013'/%3E%3Cg%20fill='none'%20stroke='%235aaeff'%20stroke-width='1.8'%20stroke-linecap='round'%3E%3Cpath%20d='M3%204l4%204-4%204'/%3E%3Cpath%20d='M8.5%2012.5h5'/%3E%3C/g%3E%3C/svg%3E" />
```

`img-src 'self' data:` already permits it, and a data URI means neither entry point needs to serve
a new file. The two colours are the only literals here and Step 1's test is what keeps them honest.

- [ ] **Step 4: Style the mark as a glyph box**

In `packages/ui/src/styles/chrome.css`, replace the `.workspace-mark, .app-tab-mark` rule with:

```css
.workspace-mark,
.app-tab-mark {
  display: grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-1);
  background: var(--c-control);
  color: var(--ac);
}
```

and delete the later `.app-tab-mark { width: 18px; … font-size: 8px; }` override, which existed to
shrink the text mark inside a tab; the SVG is already 18px.

- [ ] **Step 5: Run the tie**

Run: `node --test "packages/ui/tests/theme-sync.test.mjs"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Add the status bar markup**

In `packages/ui/src/index.html`, insert this block immediately before the closing `</div>` of
`#app` (currently line 220, after `</div>` that closes `.app-body`):

```html
      <footer class="status-bar" aria-label="工作区状态">
        <span class="status-item"><span id="status-dot" class="status-dot" aria-hidden="true"></span><span id="status-state">正在启动…</span></span>
        <span class="status-sep" aria-hidden="true">│</span>
        <span id="status-endpoint" class="status-item mono">—</span>
        <span class="status-sep" aria-hidden="true">│</span>
        <span id="status-size" class="status-item mono">—</span>
        <span class="status-fill"></span>
        <span id="status-workspace" class="status-item">本地工作区</span>
        <span class="status-sep" aria-hidden="true">│</span>
        <span id="status-version" class="status-item mono">—</span>
      </footer>
```

- [ ] **Step 7: Add the status bar CSS**

Append to `packages/ui/src/styles/chrome.css`:

```css
/* Status bar. Every field here is a value the renderer already owns; the
   cipher, host key type and uptime this design originally asked for are not
   reported by the Host at all, so they are absent rather than faked. */
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--status-h);
  padding: 0 10px;
  background: var(--c-chrome);
  border-top: 1px solid var(--line);
  color: var(--tx-3);
  font-size: var(--fs-micro);
  line-height: 1;
}

.status-bar b { color: var(--tx-2); font-weight: 400; }
.status-item { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.status-fill { flex: 1 1 auto; }
.status-sep { color: var(--line-strong); }
.status-dot { width: 7px; height: 7px; border-radius: var(--r-full); background: var(--idle); }
.status-dot[data-state="connected"] { background: var(--ok); }
.status-dot[data-state="connecting"] { background: var(--warn); }
.status-dot[data-state="failed"],
.status-dot[data-state="disconnected"] { background: var(--err); }
```

- [ ] **Step 8: Check the hairline floor still holds**

Run: `node --test "packages/ui/tests/stylesheet-contract.test.mjs"`
Expected: PASS. `.status-bar` sets a `--line` border on a `--c-chrome` ground, which measures
1.323:1 — above the 1.1 floor the guard enforces.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/index.html packages/ui/src/styles/chrome.css packages/ui/tests/theme-sync.test.mjs
git commit -m "feat(ui): add the brand mark, favicon and status bar shell"
```

---

### Task 6: Fill the status bar

`ClientChrome` owns the four fields that exist. It also needs one event the terminal service does
not emit yet, so the size field cannot go stale.

**Files:**
- Modify: `packages/ui/src/services/terminal.ts:31-35,203`
- Create: `packages/ui/src/services/chrome.ts`
- Modify: `packages/ui/src/client.ts:15,31-39`

- [ ] **Step 1: Emit the size**

In `packages/ui/src/services/terminal.ts`, add to the `Events` interface (after
`'client/tab-closed'(tabId: string): void`):

```ts
    'client/terminal-resize'(size: { cols: number; rows: number }): void
```

and change the per-tab resize wiring at line 203 from

```ts
    const resize = pane.terminal.onResize(({ cols, rows }) => { if (tab.sessionId) this.ctx.clientTransport.api.resize(tab.sessionId, cols, rows) })
```

to

```ts
    const resize = pane.terminal.onResize(({ cols, rows }) => {
      if (tab.id === this.activeId) this.ctx.emit('client/terminal-resize', { cols, rows })
      if (tab.sessionId) this.ctx.clientTransport.api.resize(tab.sessionId, cols, rows)
    })
```

The event is emitted only for the active tab because the status bar describes the visible terminal,
and every other tab keeps its own real size in its own pane.

- [ ] **Step 2: Write the service**

Create `packages/ui/src/services/chrome.ts`:

```ts
import { Service, type Context } from 'cordis'
import { VERSION } from '../lib/version.js'

declare module 'cordis' { interface Context { clientChrome: ClientChrome } }

const STATE_TEXT: Record<string, string> = {
  connecting: '连接中', connected: '已连接', disconnected: '已断开', failed: '连接失败',
}

/**
 * The 24px status bar, the theme and the row density.
 *
 * Only four fields, because only four values exist to show: the Host reports no
 * negotiated cipher, no remote key type and no session uptime, and an
 * approximation of any of them in a status bar is worse than an empty slot.
 */
export class ClientChrome extends Service {
  static inject = ['clientView', 'clientTerminal']

  constructor(ctx: Context) {
    super(ctx, 'clientChrome')
    const view = ctx.clientView
    view.element('status-version').textContent = `v${VERSION}`
    ctx.on('client/connection-change', () => this.render())
    ctx.on('client/session-change', () => this.render())
    ctx.on('client/tab-closed', () => this.render())
    ctx.on('client/terminal-resize', () => this.render())
    this.render()
  }

  private render(): void {
    const view = this.ctx.clientView
    const tab = this.ctx.clientTerminal.active
    const dot = view.element('status-dot')
    if (!tab) {
      dot.dataset.state = ''
      view.element('status-state').textContent = '主机库'
      view.element('status-endpoint').textContent = `${this.ctx.clientTerminal.tabs.length} 个会话标签`
      view.element('status-size').textContent = '—'
      return
    }
    dot.dataset.state = tab.state
    view.element('status-state').textContent = STATE_TEXT[tab.state] ?? tab.state
    view.element('status-endpoint').textContent = `${tab.request.username}@${tab.request.host}:${tab.request.port ?? 22}`
    view.element('status-size').textContent = `${tab.terminal.cols}×${tab.terminal.rows}`
  }
}
```

- [ ] **Step 3: Mount it**

In `packages/ui/src/client.ts`, add the import beside the other service imports:

```ts
import { ClientChrome } from './services/chrome.js'
```

add `'chrome'` to the `scopes` key union on line 15 so it reads

```ts
  readonly scopes: Readonly<Record<'view' | 'transport' | 'terminal' | 'keychain' | 'hosts' | 'sftp' | 'chrome' | 'application', Fiber>>
```

and register it after `sftp` in the `scopes` object:

```ts
    chrome: context.plugin(ClientChrome),
```

Do **not** add `clientChrome` to `features/readiness.ts:9`: the status bar is not a readiness
condition, and gating on it would let a chrome bug block the app.

- [ ] **Step 4: Typecheck and run the guards**

```powershell
npm run typecheck
node --test "packages/ui/tests/*.test.mjs"
```
Expected: both clean. `visual-contract.test.mjs` passes because every id the service reads now
exists in the markup.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/services/chrome.ts packages/ui/src/services/terminal.ts packages/ui/src/client.ts
git commit -m "feat(ui): report connection state, endpoint, size and version in the status bar"
```

---

### Task 7: Theme and density switches

Both switches write one attribute on `<html>` and remember the choice. `lib/version.ts` gains its
first importer in Task 6, and `localStorage` gets its first in the codebase here — there is no
existing settings service to extend.

**Files:**
- Modify: `packages/ui/src/index.html:21-32`
- Modify: `packages/ui/src/services/chrome.ts`
- Modify: `packages/ui/tests/visual-contract.test.mjs`
- Modify: `packages/ui/tests/client-lifecycle.browser.ts`

- [ ] **Step 1: Add the controls to the top bar**

In `packages/ui/src/index.html`, replace the closing part of the `<header class="app-topbar">`
element (currently just `</div>` after `#workspace-tabs`) so the header ends with:

```html
        </div>
        <div class="topbar-actions">
          <button type="button" id="theme-toggle" class="icon-button" aria-label="切换到浅色主题" aria-pressed="false" title="主题"><i class="ti ti-moon" aria-hidden="true"></i></button>
          <button type="button" id="density-toggle" class="icon-button" aria-label="切换到紧凑行高" aria-pressed="false" title="行高密度"><i class="ti ti-arrows-minimize" aria-hidden="true"></i></button>
        </div>
      </header>
```

`.topbar-actions` already exists in `chrome.css` and was dead until this moment.

- [ ] **Step 2: Declare the failure in the behaviour test**

`packages/ui/tests/client-lifecycle.browser.ts` is one long `runChecks()` made of look-alike
scenario blocks: build a fixture, `createClient`, assert, `await client.dispose()`,
`checks.push('…')`. Add a new block immediately after the line
`checks.push('New Host is the only visible entry for creating a host')` (currently line 185):

Add `import { VERSION } from '../src/lib/version.js'` to the file's import block first — asserting
the literal version string would make every release a test edit.

```ts
    const chrome = fixture()
    client = createClient({ api: chrome.api, terminalFactory: chrome.terminalFactory })
    assert((await client.ready).ok, 'chrome client failed readiness')
    const html = document.documentElement
    assert(!html.hasAttribute('data-theme'), 'a first run must carry no stored theme')
    assert(input('status-version').textContent === `v${VERSION}`, 'the status bar must render the generated version')
    click('theme-toggle')
    assert(html.dataset.theme === 'light', 'the theme switch must write data-theme on <html>')
    assert(document.getElementById('theme-toggle')!.getAttribute('aria-pressed') === 'true',
      'the switch must report its own state')
    click('density-toggle')
    assert(html.dataset.density === 'compact', 'the density switch must write data-density')
    const remembered = JSON.parse(window.localStorage.getItem('pureterm.chrome') ?? '{}')
    assert(remembered.theme === 'light' && remembered.density === 'compact',
      'both choices must persist under one key, so a partial write cannot desynchronise them')
    await client.dispose()
    client = createClient({ api: chrome.api, terminalFactory: chrome.terminalFactory })
    assert((await client.ready).ok, 'restored chrome client failed readiness')
    assert(html.dataset.theme === 'light' && html.dataset.density === 'compact',
      'a remount must restore both choices from storage')
    window.localStorage.removeItem('pureterm.chrome')
    delete html.dataset.theme
    delete html.dataset.density
    checks.push('the status bar renders real fields, and both chrome switches persist across a remount')
```

Then add the size field to the existing multi-tab scenario: after its
`assert(gestures.stats.opens === 1 …)`-style connection assertions, drive the fixture's own resize
listeners and check the bar follows:

```ts
    const device = gestures.terminals.at(-1)!
    for (const listener of device.resizeListeners) listener({ cols: 132, rows: 41 })
    await tick()
    assert(input('status-size').textContent === '132×41', 'the status bar must follow the active terminal size')
```

Run: `npm run verify:electron`
Expected: FAIL with `a first run must carry no stored theme` only if an earlier scenario left a
value behind, otherwise with `the theme switch must write data-theme on <html>` — the control has
no behaviour yet.

- [ ] **Step 3: Implement the switches**

In `packages/ui/src/services/chrome.ts`, add above the class:

```ts
const CHROME_KEY = 'pureterm.chrome'
interface ChromePrefs { theme?: 'dark' | 'light'; density?: 'comfortable' | 'compact' }

/** One key for both choices: two independent keys would let a partial write leave a
 *  remembered theme and a lost density, which reads as the switch being broken. */
function readPrefs(storage: Storage): ChromePrefs {
  try { return JSON.parse(storage.getItem(CHROME_KEY) ?? '{}') as ChromePrefs } catch { return {} }
}
```

and inside the constructor, before `this.render()`:

```ts
    const html = view.document.documentElement
    const storage = view.window.localStorage
    const prefs = readPrefs(storage)
    const theme = view.element<HTMLButtonElement>('theme-toggle')
    const density = view.element<HTMLButtonElement>('density-toggle')
    const apply = (): void => {
      if (prefs.theme) html.dataset.theme = prefs.theme
      if (prefs.density) html.dataset.density = prefs.density
      theme.setAttribute('aria-pressed', String(prefs.theme === 'light'))
      theme.setAttribute('aria-label', prefs.theme === 'light' ? '切换到深色主题' : '切换到浅色主题')
      theme.firstElementChild?.className = `ti ${prefs.theme === 'light' ? 'ti-sun' : 'ti-moon'}`
      density.setAttribute('aria-pressed', String(prefs.density === 'compact'))
      density.setAttribute('aria-label', prefs.density === 'compact' ? '切换到舒适行高' : '切换到紧凑行高')
      density.firstElementChild?.className = `ti ${prefs.density === 'compact' ? 'ti-arrows-maximize' : 'ti-arrows-minimize'}`
    }
    const save = (): void => { try { storage.setItem(CHROME_KEY, JSON.stringify(prefs)) } catch { /* a private-mode quota denial costs the choice, not the session */ } }
    this.scope.listen(theme, 'click', () => {
      prefs.theme = prefs.theme === 'light' ? 'dark' : 'light'
      html.dataset.theme = prefs.theme
      save()
      apply()
    })
    this.scope.listen(density, 'click', () => {
      prefs.density = prefs.density === 'compact' ? 'comfortable' : 'compact'
      html.dataset.density = prefs.density
      save()
      apply()
    })
    apply()
```

`this.scope` does not exist on this service yet. Add the import
`import { ClientScope } from '../client-runtime.js'`, the field
`private readonly scope: ClientScope`, and assign it as the first statement of the constructor —
`this.scope = new ClientScope(ctx)` — exactly as `ClientApplication` does at
`features/readiness.ts:14`. Do not initialise the field from `this.ctx`: the base `Service` has set
`ctx` by then, but every other service in this package takes the constructor parameter, and
following them is what keeps the pattern readable.

- [ ] **Step 4: Assert the switch exists, structurally**

In `packages/ui/tests/visual-contract.test.mjs`, add to the first test after the `#primary-nav`
assertion:

```js
  assert.match(html, /id="theme-toggle"/, 'the light theme is unreachable without this control')
  assert.match(html, /id="density-toggle"/)
  assert.match(html, /class="status-bar"/)
  assert.match(css, /\.status-bar\s*\{[^}]*var\(--status-h\)/, 'the status bar must be drawn from its token')
```

Run: `node --test "packages/ui/tests/visual-contract.test.mjs"`
Expected: PASS.

No CSS is needed for the two controls: `.topbar-actions` is already a flex row
(`chrome.css:30-31`) and `.app-topbar button` already opts out of the drag region
(`chrome.css:27`), which is what keeps them clickable inside a draggable bar.

- [ ] **Step 5: Verify the behaviour**

```powershell
npm run build
npm run verify:electron
```
Expected: PASS, including the restored-theme assertion after the remount.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/index.html packages/ui/src/services/chrome.ts packages/ui/src/styles/chrome.css packages/ui/tests/visual-contract.test.mjs packages/ui/tests/client-lifecycle.browser.ts
git commit -m "feat(ui): ship the theme and density switches"
```

---

### Task 8: Correct the documents

The design system document currently states, in three places, that the light theme cannot be
reached and that no switch exists. After Task 7 that is false, and a false sentence in the one
authority on this subject is worse than no sentence.

**Files:**
- Modify: `docs/design-system.md`, `docs/design-system_zh.md`
- Modify: `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` + `_zh.md`
- Modify: `CHANGELOG.md`, `CHANGELOG_zh.md`
- Modify: `packages/ui/src/lib/changelog.ts` (generated)

- [ ] **Step 1: Rewrite the reachability claim**

In `docs/design-system.md`, the bullet in `## Theme mechanism` that begins
`**The switch does not exist yet.**` becomes:

```md
- **The switch exists.** `#theme-toggle` and `#density-toggle` in the top bar are written by
  `packages/ui/src/services/chrome.ts`, which sets `data-theme` and `data-density` on `<html>` and
  remembers both under the single `pureterm.chrome` key. A first run carries no `data-theme` at all
  and so resolves to the `:root` group. Because `script-src 'self'` forbids an inline pre-paint
  script, a stored light theme is applied one frame after `app.js` runs: the top bar paints dark,
  then flips. That flash is the price of the CSP, and it is accepted rather than worked around.
```

Then in `## Known gaps`, delete the bullet that begins
`The light theme has no switch, so no cell of the light columns…`, and correct the consumer census
bullet that lists `--overlay-soft`, `--overlay-press` and `--ac-focus` plus fourteen metrics: three
of those metrics (`--chrome-h`, `--rail-w`, `--status-h`) now have call sites in `chrome.css`, so
the count and the list change. Recompute both with the same method the flip used — read the
partials and count `var(--x)` — rather than editing the number by hand.

- [ ] **Step 2: Correct the spec's status-bar promise**

In `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` (and its `_zh.md`), find
the status-bar description that lists cipher, host key type and uptime, and replace that sentence
with:

```md
The status bar carries only what the renderer actually receives: connection state,
`user@host:port`, terminal `cols×rows`, and the app version. Negotiated cipher, remote host key
type and session uptime were in the original design and are **not** available — the Host reports
`{id, host, port, username}` for a session and never reads ssh2's negotiated state. Exposing them
is a `@pureterm/protocol` change with its own plan, not a UI task.
```

- [ ] **Step 3: Record the user-visible change**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Changed`, add:

```md
- Rebuild the application chrome: the navigation sidebar becomes a 52px icon rail, the top bar
  drops from 76px to 40px and now carries the brand mark, the session tabs and two new switches,
  and a 24px status bar reports connection state, endpoint, terminal size and version. The
  desktop window's title-bar overlay follows the new height.
- Add a theme switch and a row-density switch. The light theme is now reachable in the running app,
  and both choices are remembered. Because the page's Content-Security-Policy forbids an inline
  pre-paint script, a stored light theme applies one frame after start.
```

and under `### Fixed`:

```md
- The status bar shows only fields the backend actually reports. Negotiated cipher, remote host key
  type and session uptime are absent rather than approximated; exposing them needs a protocol
  change.
```

Mirror both in `CHANGELOG_zh.md`.

- [ ] **Step 4: Regenerate the metadata and check the links**

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```
```bash
git diff --check
```
Expected: `Changelog and workspace versions are valid for 0.1.0-alpha.1.` and no whitespace errors.
Then open every relative link and `#anchor` you touched and confirm it resolves — this repository
has no markdown-link script, so it is checked by inspection.

- [ ] **Step 5: Commit**

```bash
git add docs/ CHANGELOG.md CHANGELOG_zh.md packages/ui/src/lib/
git commit -m "docs(ui): record the chrome rebuild"
```

---

### Task 9: Look at it

This task changes nothing and must not be skipped. Plan 2's Task 7 was only partly doable because
the browser surface kept disappearing; this one decides whether the light theme is real.

- [ ] **Step 1: Exercise both entry points**

```powershell
npm run start:web
npm run start:desktop
```

- [ ] **Step 2: Check the specific failure modes this rebuild can produce**

Report on each, against the running app: (a) is the 52px rail navigable without labels — do the
three icons read as Hosts / Keychain / Shortcuts, and does the active marker land on the hairline
rather than in mid-air; (b) does the 40px top bar still feel like a title bar you can drag, and do
the window controls overlap the session tabs at the narrowest width the window allows; (c) with the
light theme finally on screen, do the hairlines, the `--c-control` fields and the `--tx-3` muted
text hold up — this is the first time anyone has looked at them; (d) does the terminal stay dark
inside a light shell without a visible seam; (e) is the status bar's 11px text readable at 100% on
your display, and does `cols×rows` update when you resize the window; (f) does the one-frame dark
flash on a stored light theme read as a bug or as a launch; (g) does the icon rail's hover state
read as hover, now that the row is 34px instead of 54px.

- [ ] **Step 3: Confirm the desktop geometry**

In `npm run start:desktop` on Windows, check that the native caption buttons sit inside the 40px
overlay and that no part of the top bar is painted by the OS. Then check the same at 125%, the
scaling the flip's review ran at.

- [ ] **Step 4: Report honestly**

Anything you could not check, say so. Any item where the rebuild made the interface worse goes into
Plan 4's prerequisites rather than being retuned here — in particular, if the light theme reveals
that a ground or a hairline was chosen for dark only, write it down as a token correction with the
measured pair, and do not silently change a value that fourteen tests assert.

---

## Done criteria

- `--chrome-h`, `--rail-w` and `--status-h` are the only written chrome geometry, and
  `theme-sync.test.mjs` ties the Electron overlay and the `env()` fallback to `--chrome-h`.
- The rail is 52px at every width, `#nav-toggle`, `.nav-collapsed`, `.window-control`,
  `.update-pill`, `.workspace-chevron` and `.app-shell.failure-mode` are gone, and `git grep` finds
  no reference to any of them.
- The status bar shows four real fields; the version string reaches the page through
  `lib/version.ts`, which finally has an importer.
- `#theme-toggle` makes the light group reachable, both switches persist across a remount, and
  `docs/design-system.md` no longer says the switch does not exist.
- `npm run verify`, `npm run verify:electron` and `npm run release:check` pass.
- The light theme has been looked at by a human for the first time, and what was seen is written
  down whether or not it changed anything.

## Not in this plan

- Plan 4: the screens — hosts and keychain tables with column headers, the docked Inspector
  replacing the overlay drawer, the draggable terminal/SFTP split, the four states, toasts, failure
  diagnostics with real route stages, and consolidating six breakpoints to three.
- The `@pureterm/protocol` change that would expose negotiated cipher, remote host key type and
  session uptime. Until it lands, those slots stay absent.
- Installer icons (`.ico`, `.icns`). The favicon is inline SVG; a Windows icon file is a binary
  asset that needs its own generation step and its own verification on the target platform.

---

## What execution found

Tasks 1-8 landed as written, one commit each: `bfaf9f7` geometry tokens, `d2c4c97` grid and overlay, `1e6a49d` icon rail, `7e72732` dead chrome, `1e51501` mark, favicon and status bar shell, `149c0fa` status fields, `33b939f` the two switches, `a07ce0e` the documents. Two deviations, both recorded in their commit messages: the 820px block also lost a `.workspace-switcher` width the later block already overrode, and the 620px rule hiding `.topbar-actions .icon-button` was deleted a task early because the switches land in that container and must stay reachable.

**Task 9 found four things, and all four were fixed rather than filed.**

- The tab strip was 52px tall inside the new 40px bar: `.app-tab { min-height: 44px }` plus `.workspace-tabs { padding: 4px 2px }` summed past the bar's own bottom hairline. Measured as `y: -6.3, height: 52`. Tabs are now 28px with zero vertical padding.
- `.nav-item { height: 34px }` rendered 38px tall, because `base.css` gives every `button` a `min-height: 38px` and a bare `height` loses to it. Naming `min-height` alongside `height` is the fix, and the trap is worth the sentence because the same pair of properties will bite the next sized control.
- `.status-bar` text was `--tx-3` on `--c-chrome`, which the legality table in `docs/design-system.md` already marks at 4.23:1 in the light group — under the floor an 11px label needs. It is now `--tx-2`, measured at 10.20:1 dark and 7.70:1 light on the live page.
- The rail icons were `--tx-4` on `--c-chrome`: 2.79:1 dark, 2.28:1 light, under the 3:1 non-text floor — and the labels are gone, so the icon is the only affordance there is. Now `--tx-3` (4.99 / 4.23) with `--tx-1` on hover.

A new guard, `the top bar contents fit the height the bar is given`, reads `--chrome-h` and compares `.app-tab` and `.nav-item` against it, so neither can outgrow the bar again without a failure.

**The measurement caveat, because it changes what can be trusted.** The in-app browser surface was hidden for all but one pass, and Chromium does not advance transitions on a hidden page. Reading a transitioned property straight after flipping `data-theme` returns the pre-transition value: `.host-row` and `.nav-item` looked as though they never recolour at all, which is an artifact of the harness and not a defect. Only non-transitioned declarations are measurable this way — grid boxes, the rail width, the status bar's own ground and text. So the rail icon ratios above are cited from the documented matrix rather than measured, and **the light theme has still not been seen by a human eye**.

Not checked, still owed: a real SSH session and with it the terminal seam; the SFTP sheet open; the desktop window at 100% and 125%; whether the tab strip and the window controls collide at the narrowest width the window allows. `npm run verify` and `npm run verify:electron` both pass (exit 0, 7 renderer suites), and 53 UI guards pass with the fit assertion included.

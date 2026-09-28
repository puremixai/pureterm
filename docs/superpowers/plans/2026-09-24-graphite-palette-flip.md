# Graphite Palette Flip Implementation Plan

[中文版本](2026-09-24-graphite-palette-flip_zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `packages/ui/src/styles/legacy.css` and repaint the whole application with the neutral-graphite ramp, leaving layout, markup and behaviour untouched.

**Architecture:** Every colour already resolves through a token, so the flip is three mechanical acts — re-home the four non-colour register entries, retune `tokens.css` to the measured graphite values and add the translucent steps the ramp needs, then replace each `var(--legacy-*)` and old-alias reference with a new-system token and delete the register. Two guards make this safe rather than hopeful: `stylesheet-contract.test.mjs` fails on any colour literal outside `tokens.css`, and its reference-direction check fails on any `var(--x)` that names nothing.

**Tech Stack:** Plain CSS, Node's built-in test runner, esbuild. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md`, sections "Token system", "Theme mechanism" and the "Non-goals" list.

**Depends on:** the finished foundation plan. Read `docs/superpowers/plans/2026-09-23-token-foundation.md` — its "Revisions…", "Task 5 corrections…" and "Carry forward into Plan 2" sections are inputs to this plan, and items 1-8 of that list are all handled here.

**Branch:** continue on `feat/ui-redesign`. Never on `main`.

---

## Scope: this plan is the flip only

The spec's commit 3 (the chrome rebuild — 52px icon rail, top-bar tabs, status bar, brand mark, favicon, theme switch) is **Plan 3**, and commit 4 (hosts/keychain tables, Inspector, SFTP split, four states, failure diagnostics) is **Plan 4**. The reason to cut here is not tidiness: the flip is the single highest-risk step in the redesign because it changes every pixel at once while changing nothing else, so it must land alone to be reviewable and revertable. It also produces working, testable software on its own — a graphite PureTerm with the layout the user has today.

**Two consequences of that cut, both intended:**

1. **The light theme stays unreachable.** `[data-theme="light"]` gets no trigger until Plan 3's switch. Plan 2 must make the light group *correct*, not *activatable*.
2. **The status bar's missing data is not built here.** The spec promised cipher, host key type, uptime and latency. None of them exist anywhere in `SshApi` or the events today — `RuntimeCapabilities` is only `credentialPersistence` and `privateKeyPicker` (`packages/protocol/src/protocol.ts:244-247`), and the spec forbids a protocol change in this phase. Do not add a host-side field to make a mockup true. Plan 3 builds the status bar from what is actually available and the spec's field list gets corrected in its own commit.

## Non-goals

- No layout, markup, class-name or id changes. `#nav-toggle`, `.nav-collapsed`, `.workspace-mark`, `#primary-nav` and the 278px grid all survive this plan exactly as they are; Plan 3 removes them.
- No new dependency, no terminal font, no `@layer`.
- No protocol, host or transport change.
- No real `<table>` semantics, no installer icons (the spec's deferred list still applies).
- Do not bump the version. `VERSION.txt` stays `0.1.0-alpha.1`; the change lands under `[Unreleased]`.

## The token additions this ramp needs

`tokens.css` today has 21 colour tokens per theme. The register's 96 colour entries cannot map onto 21 without inventing the steps the old palette had and the new one lacks. Add these to `:root` and, where a light value is meaningful, to `[data-theme="light"]`:

```css
  /* Translucent steps. Dark values are white-or-accent at an alpha; light
     values flip to black-or-accent because white-on-white does not exist. */
  --overlay-soft: rgba(255, 255, 255, 0.03);
  --overlay-hover: rgba(255, 255, 255, 0.06);
  --overlay-press: rgba(255, 255, 255, 0.09);
  --ac-line: rgba(90, 174, 255, 0.42);
  --ac-focus: rgba(90, 174, 255, 0.55);
  --ok-bg: rgba(78, 194, 127, 0.12);
  --ok-line: rgba(78, 194, 127, 0.3);
  --warn-bg: rgba(224, 168, 60, 0.12);
  --warn-line: rgba(224, 168, 60, 0.32);
  --err-bg: rgba(242, 85, 90, 0.12);
  --err-line: rgba(242, 85, 90, 0.32);
  --scrim: rgba(0, 0, 0, 0.62);
  --scroll-thumb: #33383f;
  --scroll-thumb-strong: #444a53;
```

and the light group gains:

```css
  --overlay-soft: rgba(0, 0, 0, 0.03);
  --overlay-hover: rgba(0, 0, 0, 0.055);
  --overlay-press: rgba(0, 0, 0, 0.08);
  --ac-line: rgba(31, 111, 235, 0.42);
  --ac-focus: rgba(31, 111, 235, 0.35);
  --ok-bg: rgba(26, 127, 75, 0.1);
  --ok-line: rgba(26, 127, 75, 0.28);
  --warn-bg: rgba(154, 106, 10, 0.1);
  --warn-line: rgba(154, 106, 10, 0.3);
  --err-bg: rgba(194, 54, 59, 0.1);
  --err-line: rgba(194, 54, 59, 0.3);
  --scrim: rgba(20, 24, 30, 0.38);
  --scroll-thumb: #c9ced5;
  --scroll-thumb-strong: #aab1ba;
```

No `--on-solid` token. `--legacy-on-solid` is `#ffffff` at three call sites — `hosts.css:41` `.host-avatar`, `inspector.css:26` `.connection-type`, `keychain.css:21` `.keychain-avatar` — and all three sit on a fill the mapping table makes `--c-control`, which is `#21252b` in dark and `#e8ebef` in light. So the legend wants white in dark and near-black in light, which is precisely what `--tx-1` already is in both groups. Map it to `var(--tx-1)` and add no token; a new name for an existing decision is how the register grew to 96 entries in the first place.

The ramp gains one radius step, because a 3-step scale cannot absorb 16 distinct literal values without flattening panels into controls:

```css
  --r-4: 12px;
```

Keep `--r-1` 3, `--r-2` 5, `--r-3` 8 unchanged, and do not widen further: the four-step scale is the design, and 16 distinct radii were the accident.

## The mapping table

This is the plan's payload. Every row is `legacy.css`'s current value → the new-system token that replaces it. Apply it mechanically; where a row says "delete", remove the declaration and let the hairline or surface do the work. Where two old entries map to one new token, they collapse — that is the point.

| Register entry (current value) | Replaced by | Note |
| --- | --- | --- |
| `--topbar` `#121426` | `var(--c-chrome)` | `index.html:15` meta and `shell.ts:61,67` follow in Task 5 |
| `--nav` `#272b40` | `var(--c-chrome)` | rail and top bar become one ground |
| `--main` `#1d2033` | `var(--c-canvas)` | |
| `--main-soft` `#22263a` | `var(--c-surface)` | |
| `--card` `#292d43` | `var(--c-surface)` | |
| `--card-hover` `#30354d` | `var(--c-raised)` | |
| `--field` `#171a2b` | `var(--c-inset)` | |
| `--field-hover` `#1d2134` | `var(--c-control)` | |
| `--text-strong` `#f5f5fb` | `var(--tx-1)` | |
| `--text` `#e5e7f2` | `var(--tx-2)` | |
| `--text-muted` `#a1a5bb` | `var(--tx-3)` | `shell.ts:68` `symbolColor` follows |
| `--text-faint` `#737991` | `var(--tx-4)` | but see the legality rule: `--tx-4` is decorative only, so `.tab-state-dot` (`chrome.css:166`) goes to `--tx-3` |
| `--accent` `#a7c4ff` | `var(--ac)` | pale-on-dark text becomes the accent itself |
| `--accent-strong` `#3c9ef5` | `var(--ac)` | |
| `--accent-soft` `rgba(121,169,255,.16)` | `var(--ac-bg)` | |
| `--legacy-ok` `#7bd6af` | `var(--ok)` | |
| `--legacy-err` `#ff929e` | `var(--err)` | |
| `--warning` `#f2c86f` | `var(--warn)` | |
| `--legacy-surface-sunken` `#1c2033` | delete | the register's one unreferenced entry |
| `--legacy-surface-raised` / `-hover` `#24283d`/`#2d324a` | `var(--c-raised)` | |
| `--legacy-surface-active` `#323852` | `var(--c-control)` | |
| `--legacy-surface-field` `#25293d` | `var(--c-inset)` | |
| `--legacy-surface-block` / `-alt` `#30344a`/`#3b4057` | `var(--c-control)` | |
| `--legacy-surface-control` `#3b425e` | `var(--c-control)` | |
| `--legacy-surface-tool` / `-add` `#393e56`/`#3c4159` | `var(--c-control)` | |
| `--legacy-surface-action` / `-hover` `#3f435a`/`#4a506b` | `var(--c-control)` / `var(--c-raised)` | |
| `--legacy-surface-nav-active` `#41465e` | `var(--ac-bg)` | active nav is now an accent ground, not a lighter grey |
| `--legacy-surface-input` `#262a40` | `var(--c-inset)` | |
| `--legacy-surface-log` `#2a2e44` | `var(--c-inset)` | |
| `--legacy-surface-secondary` `#2d3147` | `var(--c-surface)` | |
| `--legacy-surface-bar` `#1a1e30` | `var(--c-chrome)` | |
| `--legacy-surface-pill` / `-hover` `#20243a`/`#303650` | `var(--c-control)` / `var(--c-raised)` | |
| `--legacy-surface-tab-active` `#2b3048` | `var(--c-surface)` | |
| `--legacy-surface-tab-session` `#1c2033` | `var(--c-canvas)` | |
| `--legacy-surface-tab-active-session` `#263b43` | `var(--ok-bg)` | an active session tab reads as a connected state, not a teal block |
| `--legacy-surface-tab-failed` `#3e2939` | `var(--err-bg)` | |
| `--legacy-on-accent` / `-hover` `#081426`/`#06111f` | `var(--ac-fg)` | one value, not two |
| `--legacy-accent-hover` `#56adff` | `var(--ac-hi)` | |
| `--legacy-danger-fill` `#a84455` | `var(--err)` | the close-button hover; the red block stays red |
| `--legacy-danger-node` / `-title` / `-log` | `var(--err)` | three reds become one |
| `--legacy-log-glyph` `#bab3d0` | `var(--tx-3)` | |
| `--legacy-icon-on-nav` `#f5f6ff` | `var(--tx-1)` | |
| `--legacy-strong-on-dark` `#e7e9f4` | `var(--tx-1)` | |
| `--legacy-placeholder-strong` `#adb2c7` | `var(--tx-3)` | |
| `--legacy-on-solid` `#ffffff` | `var(--tx-1)` | measured: its three fills become `--c-control`, so white in dark and near-black in light is exactly `--tx-1` |
| `--legacy-mark-bg` / `-fg` `#e5e8f2`/`#20243a` | `var(--c-control)` / `var(--ac)` | Plan 3 replaces the text mark with the SVG brand |
| `--legacy-key-avatar` / `-address-avatar` `#075a87`/`#086ba7` | `var(--c-control)` | the two decorative blues were the hue cast; avatars go neutral |
| `--legacy-tone-0`…`-3` `#f15b29 #096da9 #efad18 #4b4d61` | `var(--c-control)` | all four tones collapse; `--tone-2-fg` → `var(--tx-3)` |
| `--legacy-scroll-thumb` / `-strong` | `var(--scroll-thumb)` / `--scroll-thumb-strong` | |
| `--legacy-line-faint`/`-hair`/`-edge`/`--legacy-line`/`-mid`/`-field`/`-strong` (7 steps, `.05`→`.17`) | `var(--line-soft)` for the four faintest, `var(--line)` for `.12`/`.13`, `var(--line-strong)` for `.17` | seven become three; `--line-soft` gets its first consumers here |
| `--legacy-overlay-soft` / `-hover` / `-hover-strong` | `var(--overlay-soft)` / `--overlay-hover` / `--overlay-press` | |
| `--legacy-row-hover` `rgba(222,226,255,.055)` | `var(--overlay-hover)` | |
| `--legacy-tint-accent` `rgba(93,157,255,.13)` | `var(--ac-bg)` | |
| `--legacy-tint-accent-line` / `-line-strong` | `var(--ac-line)` | |
| `--legacy-tint-accent-focus` `rgba(167,196,255,.7)` | `var(--ac-focus)` | |
| `--legacy-tint-ok` / `-ok-line` | `var(--ok-bg)` / `var(--ok-line)` | |
| `--legacy-tint-err` / `-err-line` | `var(--err-bg)` / `var(--err-line)` | |
| `--legacy-tint-warn` / `-warn-line` | `var(--warn-bg)` / `var(--warn-line)` | |
| `--legacy-mini-bg` `rgba(20,23,42,.55)` | `var(--c-control)` | hover actions no longer float on translucent black |
| `--legacy-field-inset` | `var(--c-inset)` | |
| `--legacy-shadow-sm` / `-card` / `-card-hover` / `-log` | delete | dark layers with hairlines; add `border: 1px solid var(--line)` where the surface needs an edge |
| `--legacy-shadow-drawer` / `-sheet` / `-editor` | delete | the drawer and sheet get `border-left`/`border-top` in `var(--line)` |
| `--legacy-shadow-dialog` | `var(--shadow-pop)` | |
| `--legacy-backdrop` `rgba(7,9,22,.6)` | `var(--scrim)` | |
| `--radius-sm` `7px` | `var(--r-2)` | 5px; controls tighten |
| `--radius-md` `10px` | `var(--r-3)` | 8px |
| `--radius-lg` `15px` | `var(--r-4)` | 12px, the new step |
| `--motion-standard` `cubic-bezier(.32,.72,0,1)` | `var(--ease)` | one curve for the whole app |

Remaining radius literals in the partials map to the nearest step: `4px`→`--r-1`, `5px`→`--r-2`, `6px`→`--r-2`, `8px`→`--r-3`, `9px`→`--r-3`, `11px`→`--r-4`, `12px`→`--r-4`, `13px`→`--r-4`, `14px`→`--r-4`, `16px`→`--r-3`, `17px`/`18px`/`20px`→`--r-4`, `50%`→`--r-full`, and the two `0` and `0 10px 10px 0` cases stay as they are.

---

### Task 1: Extend the ramp and measure before committing to it

**Files:**
- Modify: `packages/ui/src/styles/tokens.css`
- Modify: `packages/ui/tests/design-tokens.test.mjs`
- Test: `packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/tests/design-tokens.test.mjs`. A new translucent step with a hex body instead of a triplet, or a step missing from one group, is the two failures this ramp is most likely to acquire:

```js
const TINT_TOKENS = [
  '--overlay-soft', '--overlay-hover', '--overlay-press',
  '--ac-line', '--ac-focus',
  '--ok-bg', '--ok-line', '--warn-bg', '--warn-line', '--err-bg', '--err-line',
  '--scrim',
]

test('every translucent step carries the triplet of the colour it tints', () => {
  const parents = {
    '--ac-line': '--ac', '--ac-focus': '--ac',
    '--ok-bg': '--ok', '--ok-line': '--ok',
    '--warn-bg': '--warn', '--warn-line': '--warn',
    '--err-bg': '--err', '--err-line': '--err',
  }
  for (const [tint, parent] of Object.entries(parents)) {
    for (const selector of THEMES) {
      assert.deepEqual(triplet(token(selector, tint)), triplet(token(selector, parent)),
        `${selector} ${tint} must be ${parent} at an alpha`)
    }
  }
})

test('translucent steps exist in both theme groups', () => {
  for (const selector of THEMES) {
    for (const name of TINT_TOKENS) assert.ok(names(block(selector)).includes(name), `${selector} is missing ${name}`)
  }
})
```

Adapt `THEMES`, `block`, `names`, `token` and `triplet` to the helpers the file already has — it uses `DARK` and `LIGHT` constants and exports none of them, so extend the test's own scope rather than restructuring it. If `triplet` is only reachable through `token-source.mjs`, import it from there.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: FAIL on missing `--overlay-soft` in `:root`.

- [ ] **Step 3: Check the status colours still clear AA on their own tinted grounds**

Status text never sits on bare surface — `.tag.saved`, `#status.ok`, `.keychain-message.ok/.err` and `#sftp-hint.*` all paint the colour on the matching tint. Composite each `--*-bg` over its ground, compute the ratio against the solid status colour, and report the nine numbers for both themes. If any pair falls under 4.5, fix it by raising the text token's value in that theme, not by lowering the tint's alpha, and say which pair forced the change. Record the resulting figures in the commit message so the flip's accessibility claim is auditable rather than asserted.

- [ ] **Step 4: Add the tokens**

Insert the `:root` block from "The token additions this ramp needs" after `--idle`, and the light block after the light `--idle`. Add `--r-4: 12px` beside the other radii in `:root` only — it is a metric, and metrics are not redeclared per theme.

- [ ] **Step 5: Run tests**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: PASS. Also run `node --test packages/ui/tests/stylesheet-contract.test.mjs` — the declaration-count ratchet counts `legacy.css`, not `tokens.css`, so it stays green.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): add the translucent steps the graphite ramp needs"
```

---

### Task 2: Re-home the four non-colour entries

**Files:**
- Modify: `packages/ui/src/styles/legacy.css` (delete the four)
- Modify: `packages/ui/src/styles/base.css`, `chrome.css`, `hosts.css`, `inspector.css`, `keychain.css`, `states.css`, `terminal.css`
- Modify: `packages/ui/tests/stylesheet-contract.test.mjs`

- [ ] **Step 1: Write the failing test**

The ratchet currently pins 100 declarations. The reference-direction guard already rejects a `var(--radius-sm)` that names nothing, so deleting the four without re-homing fails loudly — which is the point. Update the two numbers in `stylesheet-contract.test.mjs`:

```js
const LEGACY_DECLARATIONS = 96
```

and replace the count assertion's message so it names the reason: geometry and motion left the register, colour stayed. Keep the semicolon-equality check working against the new number.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/tests/stylesheet-contract.test.mjs`
Expected: FAIL — the file still declares 100.

- [ ] **Step 3: Replace all 22 references**

`--radius-sm` → `--r-2` at `base.css:60`, `terminal.css:12`, `terminal.css:17`. `--radius-md` → `--r-3` at `base.css:43`, `terminal.css:19`, `terminal.css:21`. `--radius-lg` → `--r-4` at `states.css:11`, `terminal.css:9`. `--motion-standard` → `--ease` at `base.css:49` (4 occurrences), `hosts.css:38` (4), `hosts.css:54`, `inspector.css:49` (3), `terminal.css:19` (2). Confirm the count first, because a missed occurrence becomes a dangling reference the guard will catch but a duplicated line will not:

```powershell
Select-String -Path packages/ui/src/styles/*.css -Pattern 'var\(--radius-|var\(--motion-standard\)' | Group-Object Filename | Select-Object Count, Name
```
Expected: 22 matches total, then 0 after the replacement.

- [ ] **Step 4: Delete the four declarations and the header warning**

Remove `--radius-sm`, `--radius-md`, `--radius-lg`, `--motion-standard` and the `/* Geometry and motion, not colour … */` comment from `legacy.css`. Rewrite its header: the whole file is now colour debt, deletion is one `git rm` plus one manifest line, and the parallel-name warning about `--line-strong` versus `--legacy-line-strong` stays until Task 4 collapses the hairlines.

- [ ] **Step 5: Run the guards**

Run: `node --test "packages/ui/tests/*.test.mjs"`, then `npm run build:web`.
Expected: all green; the reference check passes because every `var(--r-*)` and `var(--ease)` names a token.

- [ ] **Step 6: Verify the transition change is not a regression**

`--ease` is `cubic-bezier(0.2, 0.8, 0.2, 1)` where `--motion-standard` was `cubic-bezier(0.32, 0.72, 0, 1)`. Both end at 1; the new one is slower to leave and faster to settle. Run `npm run start:desktop`, hover a host row, a button and a tab, and confirm nothing feels laggy or snaps early. Report what you observed. If a transition now reads as wrong, that is a duration problem in the call site, not the curve — say which.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles packages/ui/tests/stylesheet-contract.test.mjs
git commit -m "refactor(ui): move geometry and motion out of the debt register"
```

---

### Task 3: Flip the partials, one file at a time

**Files:**
- Modify: each of `base.css`, `chrome.css`, `hosts.css`, `inspector.css`, `keychain.css`, `terminal.css`, `states.css`

- [ ] **Step 1: Agree the order and the check**

Work in this order, because it front-loads the files whose result you can see without a live session: `base.css`, `chrome.css`, `hosts.css`, `inspector.css`, `keychain.css`, `states.css`, `terminal.css`. After each file run:

```powershell
node --test packages/ui/tests/stylesheet-contract.test.mjs
```
Expected: green. A `var(--topbar)` you replaced with a name that does not exist fails the reference check immediately, naming the line.

- [ ] **Step 2: Rewrite `base.css`**

Apply the mapping table to every register reference in the file. Concretely, the element defaults become:

```css
body { overflow: hidden; background: var(--c-canvas); color: var(--tx-2); font-family: var(--font-ui); font-size: var(--fs-ui); text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; box-shadow: var(--ring); }
button { min-height: 38px; padding: 0 13px; border: 1px solid var(--line); border-radius: var(--r-3); background: var(--c-surface); color: var(--tx-2); cursor: pointer; font-size: var(--fs-ui); font-weight: 500; transition: background-color var(--t-2) var(--ease), border-color var(--t-2) var(--ease), color var(--t-2) var(--ease), transform var(--t-2) var(--ease); }
button:hover:not(:disabled) { border-color: var(--line-strong); background: var(--c-raised); color: var(--tx-1); }
button:disabled { cursor: not-allowed; opacity: 0.42; }
button.ghost { border-color: transparent; background: transparent; color: var(--tx-3); }
button.ghost:hover:not(:disabled) { border-color: var(--line); background: var(--c-surface); color: var(--tx-1); }
button.primary { border-color: transparent; background: var(--ac); color: var(--ac-fg); font-weight: 600; }
button.primary:hover:not(:disabled) { border-color: transparent; background: var(--ac-hi); color: var(--ac-fg); }
```

Two deliberate departures from a mechanical substitution, both traceable to the spec: the focus treatment moves from `outline` to `box-shadow: var(--ring)`, because the double ring is the only form that stays visible against both a surface and an accent fill; and `button:active` keeps its `transform` while the old card shadows are deleted rather than re-added.

- [ ] **Step 3: Rewrite `chrome.css`**

Same method. Specific decisions: `.app-topbar` and `.primary-nav` both take `var(--c-chrome)` and separate by `border-right: 1px solid var(--line)`; `.app-tab.is-active` and `.workspace-tabs > .app-tab.is-active` collapse to one rule using `var(--c-control)`; `.session-tab.is-active` takes `var(--ok-bg)` plus `border-color: var(--ok-line)`; `.session-tab[data-state="failed"].is-active` takes `var(--err-bg)` and `var(--err-line)`; `.tab-state-dot`'s default becomes `var(--idle)` rather than `--tx-4`, because it is a state indicator and Plan 1's own note says decorative tokens must not carry meaning; `.nav-item.active` takes `var(--ac-bg)` with the accent reserved for a later left-edge marker; `.icon-button, .window-control` hover uses `var(--overlay-hover)`; `.window-control.close:hover` uses `var(--err)`; `.workspace-mark` keeps a `--c-control` ground with `var(--ac)` glyph; `--legacy-line-hair`/`-edge`/`-faint` all collapse to `var(--line-soft)` and `--legacy-line-strong` to `var(--line-strong)`; the `#app` and `.app-topbar` heights stay `76px` — Plan 3 changes geometry, not this plan.

- [ ] **Step 4: Rewrite `hosts.css`**

`.host-row` loses `--legacy-shadow-card` and gains nothing: `border: 1px solid var(--line-soft)` with `background: var(--c-surface)`; `.host-row:hover` raises to `var(--c-raised)` with `border-color: var(--line)` and **drops `transform: translateY(-1px)`** — a lift with no shadow reads as a glitch; `.host-row.active` becomes `background: var(--ac-bg)` and `border-color: var(--ac-line)`. `.host-avatar` and all four `.tone-*` rules collapse to one `background: var(--c-control); color: var(--tx-3)`. `.host-search-row`'s `--legacy-surface-block-alt` becomes `var(--c-surface)` with `border: 1px solid var(--line)`. `.search-icon` uses `var(--tx-2)` and `#host-search::placeholder` uses `var(--tx-4)`, a placeholder being decorative by definition. `.section-kicker` and `.host-count` use `var(--tx-3)`, **not** `--tx-4`: the kicker labels a section and the count states how many hosts exist, so both carry information and `tokens.css`'s legality comment forbids `--tx-4` for that. `.hosts-heading h1` uses `var(--tx-1)`. `.tag.saved` uses `--ok`/`--ok-bg`/`--ok-line`.

- [ ] **Step 5: Rewrite `inspector.css`**

`input, select` take `background: var(--c-control)`, `border: 1px solid var(--line-strong)`, `color: var(--tx-1)`, and `input:focus` moves to the `--ring` treatment with `background: var(--c-inset)`. `.address-control` and `.connection-type` collapse to `var(--c-surface)` and `var(--c-control)` grounds — the blue square was the single most saturated element in the app. `.drawer-footer` uses `var(--c-chrome)` and `border-top: 1px solid var(--line)`; `#toolbar`'s `--legacy-shadow-drawer` becomes `border-left: 1px solid var(--line)`. `.field > span` uses `var(--tx-3)` — labels are text, so `--tx-4` is forbidden by the legality rule. `#status` keeps its three semantic colours but they are `var(--ok)`, `var(--warn)`, `var(--ac)`.

- [ ] **Step 6: Rewrite `keychain.css`**

`.keychain-card` follows `.host-row`. `.keychain-avatar` becomes `var(--c-control)` with `var(--tx-3)` glyph. `.keychain-toolbar.dashboard-toolbar` uses `var(--c-chrome)`; `#keychain-view[aria-pressed="true"]` uses `var(--c-control)`. `.keychain-form-section` uses `var(--c-surface)` and loses `--legacy-shadow-*`. `.keychain-drop.is-dragging` uses `var(--ac-bg)` and `var(--ac-line)`. The `@media (max-width: 900px)` `.keychain-editor` shadow becomes `border-left: 1px solid var(--line)`.

- [ ] **Step 7: Rewrite `states.css`**

The failure page is where the old palette was loudest: `.failure-route-node` and `.failure-route-line` use one `var(--err)` instead of three reds; `.failure-shell > h2` uses `var(--err)`; `.failure-log` uses `var(--c-inset)` and loses `--legacy-shadow-log`; `.failure-secondary` uses `var(--c-surface)` with `border: 1px solid var(--line)`; `.shortcuts-dialog` takes `var(--c-surface)`, `border: 1px solid var(--line-strong)`, `box-shadow: var(--shadow-pop)`, and `::backdrop` takes `var(--scrim)`. `.empty` keeps a dashed `var(--line-strong)`.

- [ ] **Step 8: Rewrite `terminal.css`**

`#terminal`, `.session-workspace` and `.connection-failure` already take `var(--topbar)` → `var(--c-chrome)`, and the xterm canvas supplies its own `--term-bg` ground, so the surface behind the terminal must match it: use `var(--term-bg)` for `#terminal` rather than a chrome token, and say so in a comment, because the mismatch between a chrome background and the xterm canvas is a one-pixel seam you will otherwise chase. `.session-toolbar` uses `var(--c-chrome)` with `border-bottom: 1px solid var(--line)`. `#sftp` uses `var(--c-surface)` and loses `--legacy-shadow-sheet` in favour of `border-top: 1px solid var(--line)`. `.file-row:hover` uses `var(--overlay-hover)`. `#sftp-path` and `.file-size`/`.file-time` keep `--font-mono` and use `var(--tx-3)`. `.tag.link` uses `var(--warn)`/`--warn-bg`/`--warn-line`.

- [ ] **Step 9: Verify each file as you go, then all together**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run build:web
```
Expected: green, and the register is now referenced by nothing. Confirm:

```powershell
Select-String -Path packages/ui/src/styles/base.css, packages/ui/src/styles/chrome.css, packages/ui/src/styles/hosts.css, packages/ui/src/styles/inspector.css, packages/ui/src/styles/keychain.css, packages/ui/src/styles/terminal.css, packages/ui/src/styles/states.css -Pattern 'var\(--(topbar|nav|main|card|field|text|accent|warning)|var\(--legacy-)'
```
Expected: no matches, other than `legacy.css` itself importing nothing.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/styles
git commit -m "feat(ui): repaint the interface in the neutral graphite ramp"
```

---

### Task 4: Delete the register

**Files:**
- Delete: `packages/ui/src/styles/legacy.css`
- Modify: `packages/ui/src/style.css`
- Modify: `packages/ui/tests/stylesheet-contract.test.mjs`, `packages/ui/tests/visual-contract.test.mjs`, `packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: Shrink the guards first, in one commit-hunk**

In `stylesheet-contract.test.mjs`: `EXEMPT = new Set(['tokens'])`, `SANCTIONED = ['tokens']`, and delete `LEGACY_DECLARATIONS`, the count assertion, the semicolon-equality check, the liveness test and `UNREFERENCED_LEGACY`. Keep the reference-direction test — it now validates the ramp against itself and is the guard that keeps `var(--nonexistent)` from shipping.

In `visual-contract.test.mjs`: drop `'legacy'` from the pinned order array, and replace the retired-alias loop:

```js
  for (const token of ['--c-canvas', '--c-surface', '--tx-1', '--tx-3', '--ac', '--ok', '--err', '--line']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing design token ${token}`)
  }
```

- [ ] **Step 2: Run the tests and confirm they fail for the right reason**

Run: `node --test packages/ui/tests/stylesheet-contract.test.mjs`
Expected: FAIL — `legacy.css` is still exempted by nothing while the manifest still imports it, or the exemption-pair assertion trips. That is the guard working: the deletion and the shrink must land together.

- [ ] **Step 3: Delete**

```bash
git rm packages/ui/src/styles/legacy.css
```
Remove the `@import "./styles/legacy.css";` line from `packages/ui/src/style.css`, and update its header comment, which currently names two files where a colour literal may appear. It now names one.

- [ ] **Step 4: Run everything**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run build:web
npm run verify
```
Expected: all green. If the reference-direction check names a dangling `var(--legacy-*)`, a Task 3 substitution was missed — fix the call site, never the exemption list.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/style.css packages/ui/tests
git commit -m "refactor(ui): delete the legacy palette register"
```

---

### Task 5: Sync the four out-of-CSS colour holders

**Files:**
- Modify: `packages/ui/src/index.html:15`
- Modify: `apps/desktop/electron/app/shell.ts:61,67-68`
- Test: `packages/ui/tests/theme-sync.test.mjs`

- [ ] **Step 1: Write the failing test**

The spec's "single source" rule was deferred to this plan. Create `packages/ui/tests/theme-sync.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ui = (p) => readFile(new URL(p, import.meta.url), 'utf8')
const [tokens, html, shell] = await Promise.all([
  ui('../src/styles/tokens.css'),
  ui('../src/index.html'),
  ui('../../../apps/desktop/electron/app/shell.ts'),
])

function declaration(name) {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)
  assert.ok(match, `${name} is not declared as a hex value in tokens.css`)
  return match[1].toLowerCase()
}

test('the four out-of-CSS colour holders agree with the ramp', () => {
  const chrome = declaration('--c-chrome')
  const muted = declaration('--tx-3')
  const meta = /name="theme-color" content="(#[0-9a-fA-F]{6})"/.exec(html)
  assert.ok(meta, 'index.html lost its theme-color meta')
  assert.equal(meta[1].toLowerCase(), chrome, 'theme-color must equal --c-chrome')
  const bg = /backgroundColor:\s*'(#[0-9a-fA-F]{6})'/.exec(shell)
  assert.ok(bg, 'shell.ts lost its backgroundColor')
  assert.equal(bg[1].toLowerCase(), chrome, 'the window background must equal --c-chrome')
  const symbol = /symbolColor:\s*'(#[0-9a-fA-F]{6})'/.exec(shell)
  assert.ok(symbol, 'shell.ts lost its overlay symbolColor')
  assert.equal(symbol[1].toLowerCase(), muted, 'the overlay symbols must equal --tx-3')
})

test('the overlay height agrees with the top bar the CSS draws', async () => {
  const chrome = await ui('../src/styles/chrome.css')
  const overlay = /height:\s*(\d+),/.exec(shell)
  assert.ok(overlay, 'shell.ts lost its overlay height')
  const rows = /#app\s*\{[^}]*grid-template-rows:\s*(\d+)px/.exec(chrome)
  const fallback = /env\(titlebar-area-height,\s*(\d+)px\)/.exec(chrome)
  assert.ok(rows && fallback, 'chrome.css lost the 76px top bar geometry this must match')
  assert.equal(overlay[1], rows[1], 'the overlay height must equal the #app grid row')
  assert.equal(overlay[1], fallback[1], 'the overlay height must equal the top bar fallback height')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/tests/theme-sync.test.mjs`
Expected: FAIL — the three literals are still `#121426` and `#a1a5bb`.

- [ ] **Step 3: Update the three literals**

`index.html:15` → `content="#0e1013"`. `shell.ts:61` → `backgroundColor: '#0e1013'`. `shell.ts:68` → `symbolColor: '#7d838d'`. Leave `height: 76` alone. `shell.ts:64` `titleBarStyle: 'hidden'` is unchanged.

- [ ] **Step 4: Run everything, including the Electron path**

```powershell
node --test packages/ui/tests/theme-sync.test.mjs
npm run verify
npm run verify:electron
```
Expected: all green. `verify:electron` must be run here, not deferred: `apps/desktop/tests/electron-desktop-entry.mjs` asserts `.app-topbar` is a drag region and this plan touched the top bar's colours and borders.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/index.html apps/desktop/electron/app/shell.ts packages/ui/tests/theme-sync.test.mjs
git commit -m "fix(ui): keep the window chrome colours in sync with the ramp"
```

---

### Task 6: Correct the hairline contrast the foundation left short, and the docs

**Files:**
- Modify: `packages/ui/src/styles/inspector.css`
- Modify: `packages/ui/tests/design-tokens.test.mjs`
- Modify: `docs/design-system.md`, `docs/design-system_zh.md`, `CHANGELOG.md`, `CHANGELOG_zh.md`, `docs/architecture.md`, `docs/architecture_zh.md`
- Modify: `packages/ui/src/lib/changelog.ts` (generated)

- [ ] **Step 1: Re-measure `.ssh-section`'s divider**

Carry-forward item 4: this divider went from `rgba(222,226,255,.1)` to `--legacy-line-faint` at `.05`, a 1.311:1 → 1.141:1 drop against `--nav`. Task 3 collapsed it onto `--line-soft`, measured at 1.106:1 against `--c-surface` — the same shortfall. Raise it to `var(--line)` (1.269:1) and state the number in the commit message. Confirm no other collapsed hairline dropped below 1.2:1 against the ground it now sits on; list the ones you checked.

- [ ] **Step 2: Add a hairline floor assertion**

A hairline is not text, but "invisible" is a defect. Append to `packages/ui/tests/design-tokens.test.mjs`:

```js
test('hairlines stay perceptible on the surface they sit on', () => {
  for (const selector of THEMES) {
    for (const [line, ground] of [['--line', '--c-surface'], ['--line-strong', '--c-surface'], ['--line', '--c-chrome']]) {
      const got = ratio(rgbTriplet(token(selector, line)), hex(token(selector, ground)))
      assert.ok(got >= 1.15, `${selector} ${line} on ${ground} is ${got.toFixed(3)}:1, needs 1.15:1`)
    }
  }
})
```

Use the parser the file already has; an `rgba()` token value must resolve through the same triplet reader, and this assertion checks the alpha-bearing colour against the ground it composites onto — if the file's existing helpers compute a flat ratio without compositing, composite over `ground` explicitly and say so, because `rgba(255,255,255,.06)` over `#131519` is not the same colour as either input.

- [ ] **Step 3: Update the design-system documents**

Both languages. `docs/design-system.md` must now say: the colour literal is permitted in exactly one file; the register no longer exists; the hairline ladder is three steps and the mapping from the old seven; `--r-4` exists and what it is for; the shadows are gone from dark and `--shadow-pop` is the only one left; that `--legacy-on-solid` resolved to `--tx-1` rather than becoming a token; the status-on-own-tint ratios from Task 1 Step 3; `.ssh-section`'s divider at `--line`; and that the light group is still unreachable pending Plan 3. Correct the tables whose numbers this plan changed — the byte counts, the token counts, and the consumer census. Recompute rather than editing by hand.

- [ ] **Step 4: Record the user-visible change**

`CHANGELOG.md` and `CHANGELOG_zh.md`, under `[Unreleased]`:

```markdown
### Changed
- The interface now uses the neutral graphite palette: the blue-violet cast is
  gone, surfaces separate by luminance and hairlines instead of by shadows, and
  status colours, scrollbars, avatars and translucent fills were retuned to
  match. The navigation sidebar, top bar and terminal tab layout are unchanged;
  the chrome rebuild that follows will change them.
```

Then:

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
```

- [ ] **Step 5: Update `docs/architecture.md` and its pair**

The sentence added by the foundation plan names two files as colour holders. It is now one. Fix both languages.

- [ ] **Step 6: Verify**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run verify
npm run verify:electron
npm run release:check
git diff --check
```
Expected: all green, `release:check` valid for `0.1.0-alpha.1`. Then check every relative link you touched resolves by inspection — there is no markdown-link script in this repo, and say that is what you did.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles packages/ui/tests docs/ CHANGELOG.md CHANGELOG_zh.md packages/ui/src/lib/
git commit -m "docs(ui): document the graphite palette flip"
```

---

### Task 7: Look at it

**Files:** none — this task changes nothing and must not skip.

- [ ] **Step 1: Exercise both entry points**

```powershell
npm run start:web
npm run start:desktop
```

- [ ] **Step 2: Check the specific failure modes this flip can produce**

Against the running app, report on each: (a) does any hairline disappear at 100% zoom on a display you actually use; (b) is a selected host row distinguishable from a hovered one, and from an unselected one, at a glance; (c) do the four host-avatar tones collapsing to one neutral ground make rows *harder* to scan — the tones used to be the only colour in the list, and losing them may cost a scanning aid rather than a decoration; (d) is the `--ac-bg` active nav item clearly active without the old grey block; (e) does the failure page still read as an error with one red instead of three; (f) is the removed lift-transform on `.host-row:hover` now a dead-feeling hover; (g) with the shadows gone, do the drawer, the SFTP sheet and the dialog still separate from what is behind them.

- [ ] **Step 3: Confirm the terminal seam**

Open a real session if you have any non-production host available; otherwise say plainly that you did not. Check the one-pixel line where the DOM renderer's ground meets `#terminal`'s background, and where `.terminal-pane` padding shows through.

- [ ] **Step 4: Report honestly**

Anything you could not check, say so. Any item above where the flip made the interface worse, file it as a Plan 3 input rather than quietly retuning a token now — a value changed under a green test suite is how this ramp acquired its second set of hand-copied colours once already.

---

## Done criteria

- `legacy.css` does not exist and `tokens.css` is the only file in the project with a colour literal, enforced by a test.
- `theme-sync.test.mjs` ties `index.html`'s meta and `shell.ts`'s two literals to the ramp, and the overlay height to the CSS top bar.
- `npm run verify` and `npm run verify:electron` pass; the ANSI tie added in the foundation fails if a status colour is retuned without its terminal counterpart.
- The app reads as neutral graphite at every screen, with the current layout.
- `docs/design-system.md` and its Chinese pair agree with the code, including the numbers.
- The light group is correct and still unreachable, and the docs say so.

## Not in this plan

- Plan 3: the chrome rebuild — 52px icon rail, `#nav-toggle` and `.nav-collapsed` removal, session tabs in the top bar, the 24px status bar built from the fields that actually exist, the inline SVG brand mark, favicon, `.window-control` dead CSS removal, the 76px top bar becoming 40px, the theme switch that makes light reachable, and `data-density`.
- Plan 4: the screens — hosts and keychain tables, the docked Inspector, the resizable SFTP split, four states, toasts, failure diagnostics, breakpoint consolidation from six to three.
- Both later plans inherit this one's rules: no colour literal outside `tokens.css`, and every `var(--x)` must name a declared token.

---

## What execution found

**Task 6** landed as two commits. `666737b` added `every hairline stays perceptible against the ground it is drawn on` — to `stylesheet-contract.test.mjs`, not to `design-tokens.test.mjs` where this plan placed it, because the file that can read the partials is the one that can see which pairs are actually painted. A matrix of token pairs would certify thirty-six combinations nobody draws while the one real case vanished. It collects 28 rules from the seven content partials, measures each in both themes, and fails below 1.1:1. Running it against the flip's own output found two collisions the mapping table could not see: light `--line-soft` is `#eceef1`, the same value as light `--c-inset`, so a separator on that ground computes to exactly 1.000; and dark `--line-soft` on `--c-raised` is 1.034. Six declarations moved up a step — four separators from `--line-soft` to `--line` (the keychain shell edge, two rules in `terminal.css`, the host-card divider) and `.tag` plus `.action-split` from `--line` to `--line-strong` on their `--c-control` fill. `62d55be` rewrote `docs/design-system.md` and its pair from numbers measured off the tree: the token counts, the byte column, the consumer census, the status-on-own-tint matrix, the full per-ground legality matrix, and the register section, which is now history.

**Task 7 — done as far as the tooling reached, and here is where that was.** The in-app browser produced one visible surface (886×772 at 150% display scaling) and then went `visibilityState=hidden` for the rest of the session, so there is one screenshot and everything below else is computed evidence read off the live page. The page ran against a throwaway fixture store — `SSH_CORDIS_WEB_DATA_DIR` pointed at a temporary directory holding six fake host records — and **no connection to any host was attempted**, in either direction. The directory is deleted.

- (a) *hairlines at 100%*: the chrome edges are present — `.app-topbar` bottom and `.primary-nav` right both paint `--line` on `--c-chrome` at 1.323:1, the search row 1.269:1. The weakest live pair is `.host-row`'s own border at **1.106:1**, which is exactly the guard's floor: in a dense list the unselected rows read as borderless and a row announces itself by gaining the 1.635:1 hover edge. Plan 3 input, not retuned here.
- (b) *selected vs hovered vs unselected*: three different signals rather than three strengths — `rgb(19, 21, 25)` with a 1.106 rule, `rgb(25, 28, 33)` with a `--line-strong` 1.635 rule, `rgb(28, 39, 53)` with a blue `--ac-line` rule. Two of the three move hue, so the pair is separable at a glance.
- (c) *the four avatar tones*: all six rows compute to one ground, `--c-control` `rgb(33, 37, 43)`, under a 13.87:1 `--tx-1` glyph. Nothing replaces the tone distinction, so scanning the list is now purely text-led. This is the one item where the flip removed information rather than pigment, and Plan 3 owns the answer.
- (d) *`--ac-bg` active nav*: over `--c-chrome` it composites to `rgb(23, 35, 47)`, 1.196:1 against the rail, while a hovered sibling gets `--overlay-hover` at 1.140:1 — 0.05 apart in luminance, separated only by hue. The screenshot does read the active item as active, and the spec's accent left-edge marker is what would make it unambiguous.
- (e) *one-red failure page*: **not exercised live**, since that needs a refused connection. Read from the live sheet instead: `--err` carries four roles — `.failure-route-node`, the solid `.failure-route-line`, the shell `h2`, and `.failure-log-entry.is-error i` — while the title stays `--tx-1` on `--c-canvas` and the log panel is `--c-inset` under `--line`. The page reads as an error by position, not by saturation.
- (f) *hover without the lift*: `.host-row` transitions `background-color` and `border-color` over 180ms on `--ease`, so the change is animated and lands in the edge rather than in the geometry. Whether that reads as dead is the eye judgement this session could not finish. It also surfaced a fact for the docs: the durations are hand-written `180ms`/`160ms`, off the `--t-*` ladder by 20ms, while the curve beside them is a token.
- (g) *separation without shadows*: `.drawer-footer` is `--c-chrome` under `--line`, `#sftp` is `--c-surface` under `--line`, and `.shortcuts-dialog` keeps `--shadow-pop` over a `--scrim` backdrop — one floating surface, which is the intended shape. The SFTP sheet was never seen open.
- *Terminal seam*: **not checked.** No session was opened, so the join between the DOM renderer's ground and `#terminal`'s `--term-bg` remains unverified in both entry points.

Items (c), (d), (f) and (g) therefore remain Plan 3's first checkpoint rather than a retuning now: a value changed under a green suite is how the register acquired its second set of hand-copied colours once already.

**One fact worth its weight.** The built `packages/ui/dist/app.css` carries 56 hex literals: 50 inside the two theme blocks, and six that belong to `.composition-view` and its siblings inside `@xterm/xterm/css/xterm.css`. No test reads the flattened sheet; the count was taken by hand and is now written into `docs/design-system.md` so the next reader does not have to re-derive where the six came from.

# Token Foundation Implementation Plan

[中文版本](2026-09-23-token-foundation_zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `packages/ui` token-disciplined and re-typeset, so every later visual change is a token edit instead of a stylesheet hunt.

**Architecture:** Split the 581-line `style.css` into eight role-based partials behind a `style.css` manifest, define the full neutral-graphite token set (dark + light) in `styles/tokens.css`, then replace all ~140 hard-coded literals in the old rules with a named legacy token block. A new unit test fails on any literal outside a token block, which is what makes the debt permanent. Appearance changes only in small, deliberate steps; the graphite palette itself is flipped by Plan 2.

**Tech Stack:** Plain CSS, esbuild (existing browser build), Node's built-in test runner via `node --test`, `@fontsource-variable/inter`.

**Spec:** `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` — this plan implements its commits 1 and 2, plus the token half of its documentation commit.

**Branch:** work on `feat/ui-redesign`. Never on `main`.

---

## Scope of this plan

The spec lists six commits. Commits 1–2 are here. Commits 3–5 (chrome, hosts/keychain tables, SFTP split, states, failure diagnostics) need Plan 1 finished first because they consume the token block; commit 6's CHANGELOG half is here, the architecture-doc half moves to the end of Plan 3.

**Deliberate deviation from the spec's file list, recorded here so it is not silent:** the spec's `states.css` covers "skeleton, four states, toast, dialog". The connection-failure rules (old `style.css:411-440`) also land in `states.css`, because diagnostics, the four states and toasts are one responsibility and splitting them across two files would separate code that changes together. No new file is added.

## Why the legacy token block is allowed

`tokens.css` will gain roughly 55 entries named after what each old literal *does* (`--scroll-thumb`, `--tint-ok`, `--fail-log-icon`). Most survive into the final system. The one-off ones exist only so the no-literals test can be switched on in this plan; Plan 2's palette flip deletes the whole block in one commit. Do not add to the block — reference an existing entry or file it as a follow-up.

A review proposed moving the register to its own `styles/legacy.css` so Plan 2 could delete it with one `git rm`. That is rejected: the original reason was that `block(':root')` would mis-parse a huge appended body, and Task 1's follow-up commit anchors the selector match, strips comments and rejects a nested `{`, so the hazard is gone. One file with one contract is easier to reason about than two, and `git show` of the flip commit already isolates the deletion.

## Revisions after the Task 1 and Task 2 reviews

Task 1 shipped as `432c72e` and was hardened by `6b89946`: light `--idle` became `#7e8590` because `#c9ced5` measured 1.58:1 on surface and 1.385:1 on chrome, `--font-term` regained the `"Sarasa Mono SC"` and `"Microsoft YaHei Mono"` fallbacks that an earlier draft had dropped from the stack actually used at `terminal-view.ts:21`, the test now strips comments and anchors each selector at line start before parsing, and it grew from 5 tests to 9. Task 2 shipped as `bd50adf`. Independent review of Task 2 confirmed the move is complete and behaviour-neutral, and found five things this plan got wrong. They are recorded here rather than patched into the task bodies, because the task text is what the next engineer reads.

1. **Task 2 Step 5's comparison method is unachievable as written.** It expects sorted-line equality of `dist/app.css` before and after, but this commit is the first time `tokens.css` enters the bundle at all, and esbuild re-wraps split `@media` blocks. Compare parsed `(media-context, selector, declaration)` triples instead, and check per-`(selector, property)` sequence for order.
2. **Task 2 Step 4's ranges have four gaps**, resolved by judgement during the work: old `494-495` (`body { overflow: auto }`, `#app { height: auto }`) belonged to no partial; old `255` (`#host-direct-key`) belonged to no partial; hosts' stated `575-576` is off by two, since `575` is `.session-tab` and `576` is `#terminal` and hosts actually owns `573-574`; and states' stated `219-222` contradicts the cross-file note below it, which wins, so `.keychain-empty` stays in `keychain.css`.
3. **"Fix the manifest order, not the rule" is not always executable, and one of the two forced rule moves was avoidable.** The `.app-body` cycle is real — base `278px`, `1250px` override and `820px` override were assigned to two files, and no linear import list satisfies chrome → hosts → chrome. But the cycle dissolves if `.app-body`'s `232px` and `72px` lines both live in `chrome.css` beside the base rule, which is what the plan's own selector-prefix rule asked for; that placement measures zero cascade difference across 367,224 sampled winners. `hosts.css` must not end up owning a shell grid rule. Splitting a shared `@media` block across two files is the thing to avoid here, not splitting a declaration.
4. **`.keychain-content h1 { font-size: 20px }` is dead.** `index.html:85` nests the "Keys" heading in one element carrying both `.keychain-content` and `.hosts-heading`, so the 23px rule has won since before the split. It was relocated during Task 2 to protect a relationship that never applied. Delete the rule; leaving it means Task 5 Step 7 maps a dead declaration onto `--fs-h1` and makes that token look consumed.
5. **The manifest order is load-bearing and was asserted by nothing.** All eight partials are nearly fully pinned: of 40,320 permutations, 56 satisfy the existing order dependencies, deleting a partial leaves the suite green, and the test named "the manifest owns cascade order" only checked for `@import`. Derive the partial list by parsing `style.css`, assert it equals the expected eight in the expected order, and read the partials in that derived order so the test's witness can no longer diverge from what ships.

Three further decisions changed:

- **Task 3 must not prefix the register in place, and must not keep it in `tokens.css` either.** Only four of its 24 entries announce themselves as debt; the other twenty read as permanent tokens, so a palette flip would depend on a deletion list that exists only in a dated document. Prefixing all 24 `--legacy-*` would fix that at the cost of roughly 90 mechanical reference rewrites stacked on top of the ~102 literal replacements — churn for its own reward. Instead Task 3 moves the whole register into `packages/ui/src/styles/legacy.css`, imported from the manifest immediately after `tokens.css`. `tokens.css` then holds only the new system, `var(--nav)` and friends keep working untouched, the no-literals test excludes exactly two files rather than one, and Plan 2's deletion becomes a `git rm` plus one manifest line. This supersedes the rejection of a separate `legacy.css` earlier in this document: that rejection rested on the parser hazard, which Task 1's hardening closed, and the boundary a file gives is machine-readable rather than merely documented. `--line`, `--line-soft` and `--line-strong` stay distinguishable because the first two of those live in `legacy.css` and `--line-soft` belongs to the new ramp — note it has zero references today.
- **The plan's test-file placement was wrong.** `design-tokens.test.mjs` is pinned to `tokens.css` by the file it reads, so Tasks 3–5 must not move colour-literal scanning, an `Inter` import assertion, a `font-weight` census, a `.ti` pin, and a `terminal-view.ts` source check into it. Split by subject: `design-tokens.test.mjs` keeps theme parity, contrast and register accounting; a new `stylesheet-contract.test.mjs` owns manifest order and partial list, no-literals across partials, the weight census, the `.ti` pin and the Inter import; a new `terminal-theme.test.mjs` owns the `terminal-view.ts` source contract. Share the derived partial list through a non-test `.mjs` helper, as `client-lifecycle-entry.mjs` already does. `test:unit`'s existing glob picks all of these up with no wiring.
- **Task 3 Step 3's block must declare one token per line.** One draft line carried two declarations, and `token()` anchors its lookup at line start while `names()` does not, so the second name on such a line is invisible to value lookup. Keep the file flat and one-per-line.

Two smaller things to fold into Task 5: it currently converts `font-size` literals onto `--fs-*` but leaves six copies of the hard-coded `"Cascadia Mono", Consolas, monospace` stack across five partials plus `terminal-view.ts:21` while `--font-mono` and `--font-term` sit unused — include `font-family` in the sweep. And give each partial the one-line responsibility header that `keychain.css:1` has; only two of eight have one.

## Carry forward into Plan 2

Task 3 landed as `d893346` and was hardened by `8e7541d`. `packages/ui/src/styles/legacy.css` is now the register: 100 declarations, 96 of them colour, guarded by a declaration-count ratchet and a reference liveness check with a one-entry allowlist. Four things must be handled by the palette flip, and nothing in the code warns about three of them:

1. **Four register entries are not colour and cannot simply be deleted.** `--radius-sm` 7px, `--radius-md` 10px, `--radius-lg` 15px against a new ramp of 3/5/8px, and `--motion-standard` as `cubic-bezier(0.32, 0.72, 0, 1)` against `--ease` as `cubic-bezier(0.2, 0.8, 0.2, 1)`. Together they carry 22 live references, 14 of them from `--motion-standard` alone. Re-homing them is a measured rendering decision — widen the ramp, or retune 22 values — not a move. Plan 2 needs an explicit old-to-new mapping table for these four before anyone runs the `git rm`.
2. **`visual-contract.test.mjs:26` asserts that `--topbar`, `--nav`, `--card`, `--text-strong` and `--accent` exist.** All five are colour aliases the flip deletes, so that assertion must be rewritten in the same commit, or the flip fails the suite for the wrong reason.
3. **Shrinking the register touches two test files, deliberately.** `stylesheet-contract.test.mjs` pins the declaration count, the sanctioned exemption pair, and the reference liveness allowlist; `design-tokens.test.mjs`'s `GLOBAL_TOKENS` must grow if new metric steps are added. Two edits on purpose, so the deletion cannot become silent.
4. **`.ssh-section`'s divider lost contrast in Task 3** — `rgba(222,226,255,.1)` mapped onto `--legacy-line-faint` at `.05`, because the register has no `.10` hairline entry. It is within the plan's tolerance and lands near where the flip is going anyway (`--line-soft` is 1.106:1 against `--line` at 1.269:1), but re-measure it onto the new ramp rather than inheriting it.

Also for Plan 2: `legacy.css` has no light group, so all 100 entries stay dark in light mode — correct while the file exists, and a one-file change when it does not. And `white` remains in three places the literal regex cannot see: `\bwhite\b` also matches `white-space`, which appears 13 times in these partials, so catching named colours needs a value-position-aware rule rather than a wider word list.

Task 4 added two more:

5. **`index.html:15` still carries `<meta name="theme-color" content="#121426">`** — a retired-palette literal in a file no guard reads, now matching nothing that renders. It belongs to the theme-sync assertion the flip owes.
6. **The `--term-*` group has no CSS consumer at all.** Its only reader is `terminal-view.ts`, which no CSS guard scans, so `terminal-theme.test.mjs` is the single tie holding it, and the palette flip cannot "see" the terminal through the stylesheet. Note also that xterm 6 ships only the DOM renderer here (`_createRenderer()` returns `DomRenderer`, no canvas addon is loaded), and that renderer pre-blends the selection alpha at construction: `--term-selection`'s stated `.24` resolves to a painted `#1c3045`. The alpha is decorative until a canvas or gpu renderer lands, which would render the same token differently.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/ui/src/style.css` | Manifest only: Tabler import, then the eight partials in cascade order |
| `packages/ui/src/styles/tokens.css` | `:root` new ramp + legacy block; `[data-theme="light"]` new ramp only |
| `packages/ui/src/styles/base.css` | Reset, element defaults, buttons/inputs, focus ring, scrollbars, reduced motion |
| `packages/ui/src/styles/chrome.css` | `#app` grid, top bar, workspace/session tabs, nav rail, shell state classes |
| `packages/ui/src/styles/hosts.css` | Hosts dashboard: page header, search, host list, rows, cards, tags |
| `packages/ui/src/styles/inspector.css` | Connection form: drawer shell, sections, fields, footer |
| `packages/ui/src/styles/keychain.css` | Keychain library, editor, policy banner, drop target |
| `packages/ui/src/styles/terminal.css` | Terminal surface, xterm overrides, session toolbar, SFTP panel |
| `packages/ui/src/styles/states.css` | Empty, failure diagnostics, shortcuts dialog |
| `packages/ui/tests/design-tokens.test.mjs` | Theme parity, contrast, no stray literals, terminal palette sync |

---

## Task 1: Token file with both theme groups

**Files:**
- Create: `packages/ui/src/styles/tokens.css`
- Test: `packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/tests/design-tokens.test.mjs`. It parses the token file rather than eyeballing it, so a future edit to one theme cannot silently drop a variable the other theme has, and contrast is arithmetic instead of opinion.

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

function block(selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing token block ${selector}`)
  const body = css.slice(start + selector.length)
  const open = body.indexOf('{')
  const close = body.indexOf('}', open)
  return body.slice(open + 1, close)
}

function names(text) {
  return [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
}

function hex(text) {
  const value = text.trim().replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value.slice(0, 6)
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
}

function luminance(color) {
  const channel = color.map((byte) => {
    const srgb = byte / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2]
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

function token(selector, name) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block(selector))
  assert.ok(match, `missing ${name} in ${selector}`)
  return match[1].trim()
}

const THEME_TOKENS = [
  '--c-inset', '--c-canvas', '--c-chrome', '--c-surface', '--c-raised', '--c-control',
  '--line', '--line-soft', '--line-strong',
  '--tx-1', '--tx-2', '--tx-3', '--tx-4',
  '--ac', '--ac-hi', '--ac-bg', '--ac-fg',
  '--ok', '--warn', '--err', '--idle',
  '--term-bg', '--term-fg', '--term-cursor', '--term-selection',
]

// Metrics are theme-invariant: `:root` and `[data-theme="light"]` match the
// same element, so the light group inherits them. Repeating them would
// recreate the hand-synced duplicate debt this plan exists to remove.
const GLOBAL_TOKENS = [
  '--r-1', '--r-2', '--r-3', '--r-full',
  '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6',
  '--row-h', '--row-h-compact',
  '--z-drawer', '--z-popover', '--z-toast', '--z-dialog',
  '--t-1', '--t-2', '--t-3', '--ease',
]

test('both theme groups declare the same colour tokens', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    const declared = new Set(names(block(selector)))
    for (const name of THEME_TOKENS) {
      assert.ok(declared.has(name), `${selector} is missing ${name}`)
    }
  }
  const dark = new Set(names(block(':root')))
  const light = new Set(names(block('[data-theme="light"]')))
  for (const name of light) assert.ok(dark.has(name), `${name} exists only in the light theme`)
})

test('theme-invariant metrics are declared once, in :root only', () => {
  const dark = new Set(names(block(':root')))
  const light = new Set(names(block('[data-theme="light"]')))
  for (const name of GLOBAL_TOKENS) {
    assert.ok(dark.has(name), `:root is missing ${name}`)
    assert.ok(!light.has(name), `${name} must not be duplicated into the light theme`)
  }
})

test('text and accent tokens clear WCAG AA on their surfaces', () => {
  const pairs = [
    ['--tx-1', '--c-surface', 4.5],
    ['--tx-2', '--c-surface', 4.5],
    ['--tx-3', '--c-surface', 4.5],
    ['--tx-1', '--c-chrome', 4.5],
    ['--ac-fg', '--ac', 4.5],
    ['--ok', '--c-surface', 3],
    ['--warn', '--c-surface', 3],
    ['--err', '--c-surface', 3],
  ]
  for (const selector of [':root', '[data-theme="light"]']) {
    for (const [fg, bg, minimum] of pairs) {
      const got = ratio(hex(token(selector, fg)), hex(token(selector, bg)))
      assert.ok(got >= minimum, `${selector} ${fg} on ${bg} is ${got.toFixed(2)}:1, needs ${minimum}:1`)
    }
  }
})

test('--tx-4 stays decorative-only and is expected to fail AA', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    const got = ratio(hex(token(selector, '--tx-4')), hex(token(selector, '--c-surface')))
    assert.ok(got < 4.5, `--tx-4 measured ${got.toFixed(2)}:1; it must not be used for real text`)
  }
})

test('terminal tokens exist in both themes and stay dark', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    assert.ok(luminance(hex(token(selector, '--term-bg'))) < 0.02, `${selector} must keep a dark terminal`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: FAIL — `ENOENT` or `missing token block :root`, because `src/styles/tokens.css` does not exist yet.

- [ ] **Step 3: Write the token file**

Create `packages/ui/src/styles/tokens.css` with exactly this content. The `:root` block is new values only for now; the legacy block arrives in Task 2 Step 3.

```css
:root {
  color-scheme: dark;

  /* Neutral ramp. Hue is pinned to 210deg at <=5% saturation: depth is
     hierarchy, never mood. */
  --c-inset: #08090a;
  --c-canvas: #0a0b0d;
  --c-chrome: #0e1013;
  --c-surface: #131519;
  --c-raised: #191c21;
  --c-control: #21252b;
  --line: #262a31;
  --line-soft: #1c1f24;
  --line-strong: #3a4049;
  --tx-1: #f2f3f5;
  --tx-2: #b9bec6;
  --tx-3: #7d838d;
  --tx-4: #565b63;
  --ac: #5aaeff;
  --ac-hi: #7cc0ff;
  --ac-bg: rgba(90, 174, 255, 0.12);
  --ac-fg: #05070a;
  --ok: #4ec27f;
  --warn: #e0a83c;
  --err: #f2555a;
  --idle: #8b919b;

  /* Terminal keeps one dark group in both themes. A light shell over a
     dark canvas is the point, not an oversight. */
  --term-bg: #08090a;
  --term-fg: #c9ced6;
  --term-cursor: #5aaeff;
  --term-selection: rgba(90, 174, 255, 0.24);

  --r-1: 3px;
  --r-2: 5px;
  --r-3: 8px;
  --r-full: 999px;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 32px;
  --row-h: 38px;
  --row-h-compact: 30px;
  --z-drawer: 20;
  --z-popover: 30;
  --z-toast: 40;
  --z-dialog: 50;
  --t-1: 100ms;
  --t-2: 160ms;
  --t-3: 240ms;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);

  --font-ui: Inter, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
  --font-term: "Cascadia Mono", Consolas, monospace;
  --fs-micro: 11px;
  --fs-meta: 12px;
  --fs-ui: 13px;
  --fs-em: 14px;
  --fs-h2: 16px;
  --fs-h1: 20px;
  --fs-term: 13.5px;
  --ring: 0 0 0 2px var(--c-canvas), 0 0 0 4px var(--ac);
  --shadow-pop: 0 8px 24px -6px rgba(0, 0, 0, 0.5);
}

[data-theme="light"] {
  color-scheme: light;

  --c-inset: #eceef1;
  --c-canvas: #f7f8f9;
  --c-chrome: #eef0f2;
  --c-surface: #ffffff;
  --c-raised: #f4f6f8;
  --c-control: #e8ebef;
  --line: #dfe3e8;
  --line-soft: #eceef1;
  --line-strong: #c6ccd4;
  --tx-1: #16181c;
  --tx-2: #454b54;
  --tx-3: #6b7280;
  --tx-4: #9aa1aa;
  --ac: #1f6feb;
  --ac-hi: #1a5fcd;
  --ac-bg: rgba(31, 111, 235, 0.1);
  --ac-fg: #ffffff;
  --ok: #1a7f4b;
  --warn: #9a6a0a;
  --err: #c2363b;
  --idle: #c9ced5;

  /* Identical to dark on purpose; asserted by design-tokens.test.mjs. */
  --term-bg: #08090a;
  --term-fg: #c9ced6;
  --term-cursor: #5aaeff;
  --term-selection: rgba(90, 174, 255, 0.24);

  --shadow-pop: 0 8px 24px -6px rgba(16, 24, 40, 0.28);
}

[data-density="compact"] {
  --row-h: var(--row-h-compact);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: PASS, 5 tests. If an AA test fails, re-measure before changing any value — the intended ratios are dark `--tx-1` ≈16.46:1, `--tx-3` ≈4.79:1, `--ac-fg` on `--ac` ≈8.58:1; light `--tx-1` ≈17.77:1, `--tx-3` ≈4.83:1, `--ac-fg` on `--ac` ≈4.63:1.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): define the neutral graphite token system"
```

---

## Task 2: Split the stylesheet without changing behaviour

**Files:**
- Modify: `packages/ui/src/style.css` (becomes the manifest)
- Create: `packages/ui/src/styles/base.css`, `chrome.css`, `hosts.css`, `inspector.css`, `keychain.css`, `terminal.css`, `states.css`
- Modify: `packages/ui/tests/visual-contract.test.mjs`
- Modify: `packages/ui/src/app.ts:2` (no change to the import path; verify only)

- [ ] **Step 1: Update the contract test to read every partial**

The existing test reads `src/style.css`, which is about to become a nine-line manifest, so it must read the flattened cascade instead. Replace `packages/ui/tests/visual-contract.test.mjs:4-7` with:

```js
const PARTIALS = ['tokens', 'base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states']

const [html, ...partials] = await Promise.all([
  readFile(new URL('../src/index.html', import.meta.url), 'utf8'),
  ...PARTIALS.map((name) => readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8')),
])
const css = partials.join('\n')
const manifest = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
```

The Tabler assertion on old line 24 reads `css`; change it to `manifest`, because the import now lives in the manifest:

```js
  assert.match(manifest, /@import\s+"@tabler\/icons-webfont\/dist\/tabler-icons\.min\.css"/)
```

Add one assertion that no partial imports another (the manifest owns ordering, or cascade intent becomes unknowable):

```js
test('each partial is a leaf and the manifest owns cascade order', () => {
  for (const [name, text] of PARTIALS.map((n, i) => [n, partials[i]])) {
    assert.ok(!/@import/.test(text), `styles/${name}.css must not @import; put it in style.css`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/tests/visual-contract.test.mjs`
Expected: FAIL — `ENOENT ... styles/base.css`.

- [ ] **Step 3: Create the manifest**

Overwrite `packages/ui/src/style.css`:

```css
@import "@tabler/icons-webfont/dist/tabler-icons.min.css";
@import "./styles/tokens.css";
@import "./styles/base.css";
@import "./styles/chrome.css";
@import "./styles/hosts.css";
@import "./styles/inspector.css";
@import "./styles/keychain.css";
@import "./styles/terminal.css";
@import "./styles/states.css";
```

- [ ] **Step 4: Move each line range verbatim into its partial**

Move, do not rewrite, and keep every rule on one line exactly as it is today. Blank lines and section comments move with their rules. Ranges are current `style.css` line numbers; read the file before each move.

**The old `:root` block (old `3-29`) is the one part you cannot move verbatim.** Its 25 declarations collide with the new ramp in four places, and a later `:root` in the cascade would silently win: `--line`, `--line-strong`, `--ok` and `--err` already mean something new. Handle it like this, in this same commit:

- The other 21 declarations (`--topbar`, `--nav`, `--main`, `--main-soft`, `--card`, `--card-hover`, `--field`, `--field-hover`, `--text-strong`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-strong`, `--accent-soft`, `--warning`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--motion-standard`, and the `color-scheme: dark` line) move into `tokens.css` inside the existing `:root`, appended after the new tokens with the `/* ── Legacy aliases: debt register ── */` comment from Task 3 in front of them. Do not redeclare `color-scheme`.
- Rename the four collisions, keeping their old values, and add them to that same block:

```css
  --legacy-line: rgba(222, 226, 255, 0.085);
  --legacy-line-strong: rgba(222, 226, 255, 0.17);
  --legacy-ok: #7bd6af;
  --legacy-err: #ff929e;
```

- Rewrite every reference to the old bare names in the partials: `var(--line)`→`var(--legacy-line)` (11 sites), `var(--line-strong)`→`var(--legacy-line-strong)` (7 sites), `var(--ok)`→`var(--legacy-ok)` (7 sites), `var(--err)`→`var(--legacy-err)` (8 sites). Then grep to prove nothing is left:

```powershell
Select-String -Path packages/ui/src/styles/*.css -Pattern 'var\(--line\)|var\(--line-strong\)|var\(--ok\)|var\(--err\)'
```
Expected: no matches, because the four bare names must now resolve only to the graphite ramp. `var(--line-soft)` is a different name and is unaffected.

**`styles/base.css`** — old `31-83`, plus `232-235` (textarea) and `527-529` (reduced motion):

```css
* { box-sizing: border-box; }
html, body { height: 100%; min-height: 100%; margin: 0; }
body { overflow: hidden; background: var(--main); color: var(--text); font-family: "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif; font-size: 13px; text-rendering: optimizeLegibility; }
button, input, select { font: inherit; -webkit-tap-highlight-color: transparent; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
button { min-height: 38px; padding: 0 13px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--card); color: var(--text); cursor: pointer; font-size: 13px; font-weight: 600; transition: background-color 180ms var(--motion-standard), border-color 180ms var(--motion-standard), color 180ms var(--motion-standard), transform 180ms var(--motion-standard); }
button:hover:not(:disabled) { border-color: var(--line-strong); background: var(--card-hover); color: var(--text-strong); }
button:active:not(:disabled) { transform: translateY(1px) scale(0.99); }
button:disabled { cursor: not-allowed; opacity: 0.42; }
button.ghost { border-color: transparent; background: transparent; color: var(--text-muted); }
button.ghost:hover:not(:disabled) { border-color: var(--line); background: var(--card); color: var(--text-strong); }
button.primary { border-color: transparent; background: var(--accent-strong); color: #081426; font-weight: 750; }
button.primary:hover:not(:disabled) { border-color: transparent; background: #56adff; color: #06111f; }
button.small { min-height: 30px; padding: 0 10px; border-radius: var(--radius-sm); font-size: 12px; }
[hidden] { display: none !important; }
textarea { width: 100%; min-width: 0; min-height: 100px; padding: 13px; resize: vertical; border: 1px solid var(--line-strong); border-radius: 14px; background: var(--field); color: var(--text-strong); font: 12px/1.6 "Cascadia Mono", Consolas, monospace; }
textarea::placeholder { color: var(--text-faint); }
textarea:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
textarea:disabled { opacity: .6; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
```

**`styles/chrome.css`** — old `85-187`, `278-286`, `411-416`, `531-548`, `563`, plus the chrome halves of the media queries at old `476-485`, `496-503`, `564-568`, `569-575`. Every rule from those ranges whose selector starts with `.app-`, `#app`, `.topbar`, `.workspace`, `.icon-button`, `.window-control`, `.update-pill`, `.primary-nav`, `.nav-`, `.session-tab`, `.tab-`, or `.app-shell`.

**`styles/hosts.css`** — old `273-277`, `288-339`, `467-474`, plus the hosts/media rules from old `486-490`, `504-510`, `514`, `575-576`.

**`styles/inspector.css`** — old `252-254`, `341-405`, plus the form rules from old `490`, `511-513`, `515-518`.

**`styles/keychain.css`** — old `189-251`, `256-265`.

**`styles/terminal.css`** — old `406-410`, `442-465`, `549-562`, plus terminal/SFTP rules from old `519`, `523-524`, `576-581`.

**`styles/states.css`** — old `219-222` and `266-272` (keychain and shortcuts dialog), `317` (`.empty`), `417-440` (connection failure), plus failure rules from old `520-522`.

Note the two cross-file moves, which are deliberate rather than mechanical:
- `.empty` (old `317`) goes to `states.css` because the empty state is one component, not a hosts detail.
- `.keychain-empty` (old `219-222`) stays in `keychain.css` even though it is also an empty state, because Plan 3 replaces it wholesale alongside the rest of that screen; moving it would split a unit that is about to be rewritten together.

- [ ] **Step 5: Confirm the split lost no rule**

Compare the flattened output against the pre-split build. From the repository root:

```powershell
npm run build:web
Select-String -Path packages/ui/dist/app.css -Pattern '^\s*[.#\[a-z]' | Measure-Object
```

Expected: the selector-line count equals the count produced by the same command on `main` (`git stash` the split, rebuild, compare, unstash). A mismatch means a rule was dropped or duplicated during the move.

- [ ] **Step 6: Run the checks**

```powershell
npm run build:web
npm run typecheck
node --test packages/ui/tests/visual-contract.test.mjs
```
Expected: build succeeds with `dist/app.css` emitted; typecheck and boundaries pass; the contract test passes, including the new leaf-partial test.

- [ ] **Step 7: Confirm appearance is identical by eye**

```powershell
npm run start:web
```
Open the printed loopback URL. Expected: pixel-equivalent to `main` for the hosts dashboard, the connection form, keychain, and a terminal session. If anything differs, a rule was moved to a partial that now loads in the wrong cascade position — fix the manifest order, not the rule.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/style.css packages/ui/src/styles packages/ui/tests/visual-contract.test.mjs
git commit -m "refactor(ui): split the stylesheet into role-based partials"
```

---

## Task 3: Retire every hard-coded literal

**Files:**
- Modify: `packages/ui/src/styles/tokens.css` (append the legacy block)
- Modify: all seven other partials
- Test: `packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: Write the failing no-literals test**

Append to `packages/ui/tests/design-tokens.test.mjs`:

```js
const STYLED_PARTIALS = ['base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states']

test('no partial hard-codes a colour', async () => {
  const { readFile } = await import('node:fs/promises')
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/
  for (const name of STYLED_PARTIALS) {
    const text = await readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8')
    const offenders = text.split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => !line.trim().startsWith('/*') && LITERAL.test(line))
    assert.deepEqual(offenders, [], `styles/${name}.css must consume tokens:\n` + offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n'))
  }
})
```

Name it `STYLED_PARTIALS`, not `PARTIALS`, and note it deliberately excludes `tokens.css`: that file is the one place literals are allowed, which is the whole point of the rule.

- [ ] **Step 2: Run test to verify it fails and count the debt**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: FAIL, listing every offending line. Record the total — it is the number the legacy block must absorb, and the spec's estimate is roughly 140.

- [ ] **Step 3: Append the legacy block to `:root` in tokens.css**

Insert before the closing `}` of `:root`. These are the old rules' current values given roles, so this task changes appearance by at most a step or two. Plan 2 deletes the block.

Task 2 already moved the 21 non-colliding old names and the four `--legacy-line`/`--legacy-ok`/`--legacy-err` entries into this block, so the comment header may already be present — do not duplicate it. Append only the role entries below.

```css
  /* ── Legacy aliases: debt register ────────────────────────────────
     Values are the pre-redesign palette, named by role. Reference an
     entry here only when nothing above fits. Plan 2's palette flip
     removes this entire block. */
  --legacy-surface-sunken: #1c2033;
  --legacy-surface-raised: #24283d;
  --legacy-surface-raised-hover: #2d324a;
  --legacy-surface-active: #323852;
  --legacy-surface-field: #25293d;
  --legacy-surface-block: #30344a;
  --legacy-surface-block-alt: #3b4057;
  --legacy-surface-control: #3b425e;
  --legacy-surface-tool: #393e56;
  --legacy-surface-tool-add: #3c4159;
  --legacy-surface-action: #3f435a;
  --legacy-surface-action-hover: #4a506b;
  --legacy-surface-nav-active: #41465e;
  --legacy-surface-input: #262a40;
  --legacy-surface-log: #2a2e44;
  --legacy-surface-secondary: #2d3147;
  --legacy-surface-tab-active: #2b3048;
  --legacy-surface-tab-session: #1c2033;
  --legacy-surface-tab-active-session: #263b43;  --legacy-surface-tab-failed: #3e2939;
  --legacy-surface-bar: #1a1e30;
  --legacy-surface-pill: #20243a;
  --legacy-surface-pill-hover: #303650;
  --legacy-on-accent: #081426;
  --legacy-on-accent-hover: #06111f;
  --legacy-accent-hover: #56adff;
  --legacy-danger-fill: #a84455;
  --legacy-danger-node: #ff5962;
  --legacy-danger-title: #ff6670;
  --legacy-danger-log: #ff8a91;
  --legacy-log-glyph: #bab3d0;
  --legacy-icon-on-nav: #f5f6ff;
  --legacy-strong-on-dark: #e7e9f4;
  --legacy-placeholder-strong: #adb2c7;
  --legacy-on-solid: #ffffff;
  --legacy-mark-bg: #e5e8f2;
  --legacy-mark-fg: #20243a;
  --legacy-key-avatar: #075a87;
  --legacy-address-avatar: #086ba7;
  --legacy-tone-0: #f15b29;
  --legacy-tone-1: #096da9;
  --legacy-tone-2: #efad18;
  --legacy-tone-2-fg: #fff8da;
  --legacy-tone-3: #4b4d61;
  --legacy-scroll-thumb: #454b67;
  --legacy-scroll-thumb-strong: #4b5069;
  --legacy-line-faint: rgba(222, 226, 255, 0.05);
  --legacy-line-hair: rgba(222, 226, 255, 0.07);
  --legacy-line-edge: rgba(222, 226, 255, 0.08);
  --legacy-line-mid: rgba(222, 226, 255, 0.12);
  --legacy-line-field: rgba(222, 226, 255, 0.13);
  --legacy-overlay-soft: rgba(255, 255, 255, 0.025);
  --legacy-overlay-hover: rgba(255, 255, 255, 0.07);
  --legacy-overlay-hover-strong: rgba(255, 255, 255, 0.08);
  --legacy-row-hover: rgba(222, 226, 255, 0.055);
  --legacy-tint-accent: rgba(93, 157, 255, 0.13);
  --legacy-tint-accent-line: rgba(167, 196, 255, 0.12);
  --legacy-tint-accent-line-strong: rgba(167, 196, 255, 0.42);
  --legacy-tint-accent-focus: rgba(167, 196, 255, 0.7);
  --legacy-tint-ok: rgba(123, 214, 175, 0.1);
  --legacy-tint-ok-line: rgba(123, 214, 175, 0.25);
  --legacy-tint-err: rgba(255, 146, 158, 0.1);
  --legacy-tint-err-line: rgba(255, 146, 158, 0.25);
  --legacy-tint-warn: rgba(242, 200, 111, 0.1);
  --legacy-tint-warn-line: rgba(242, 200, 111, 0.28);
  --legacy-mini-bg: rgba(20, 23, 42, 0.55);
  --legacy-field-inset: rgba(23, 26, 43, 0.22);
  --legacy-shadow-sm: 0 8px 20px rgba(7, 8, 18, 0.08);
  --legacy-shadow-card: 0 8px 18px rgba(8, 9, 22, 0.08);
  --legacy-shadow-card-hover: 0 12px 24px rgba(8, 9, 22, 0.16);
  --legacy-shadow-log: 0 14px 32px rgba(7, 8, 18, 0.14);
  --legacy-shadow-drawer: -24px 0 42px rgba(7, 8, 18, 0.24);
  --legacy-shadow-sheet: 0 -12px 28px rgba(0, 0, 0, 0.18);
  --legacy-shadow-editor: -20px 0 40px rgba(8, 10, 27, 0.33);
  --legacy-shadow-dialog: 0 24px 80px rgba(0, 0, 0, 0.53);
  --legacy-backdrop: rgba(7, 9, 22, 0.6);
```

- [ ] **Step 4: Replace each literal with its token**

Work one partial at a time so each edit chunk is reviewable and the failing-test list shrinks monotonically. Use this mapping; it covers every literal in the current file.

| Old literal (old line) | Replace with |
| --- | --- |
| `#081426` (79) | `var(--legacy-on-accent)` |
| `#56adff`, `#06111f` (80) | `var(--legacy-accent-hover)`, `var(--legacy-on-accent-hover)` |
| `rgba(222,226,255,.06)` (105, 291) | `var(--legacy-line-hair)` |
| `rgba(255,255,255,.08)` (130, 305) | `var(--legacy-overlay-hover-strong)` |
| `#a84455` (133) | `var(--legacy-danger-fill)` |
| `#24283d`, `#2d324a` (142, 147) | `var(--legacy-surface-raised)`, `var(--legacy-surface-raised-hover)` |
| `#e5e8f2`, `#20243a` (156, 157) | `var(--legacy-mark-bg)`, `var(--legacy-mark-fg)` |
| `#20243a` (180, 182) | `var(--legacy-surface-pill)` |
| `#303650` (183) | `var(--legacy-surface-pill-hover)` |
| `#4b5069` (198, 356) | `var(--legacy-scroll-thumb-strong)` |
| `#075a87` (210) | `var(--legacy-key-avatar)` |
| `#393e56` (218, 277, 308) | `var(--legacy-surface-tool)` |
| `#3b425e` (243) | `var(--legacy-surface-control)` |
| `#080a1b55` (263) | `var(--legacy-shadow-editor)` |
| `#0008`, `#07091699` (266, 267) | `var(--legacy-shadow-dialog)`, `var(--legacy-backdrop)` |
| `rgba(222,226,255,.05)` (279) | `var(--legacy-line-faint)` |
| `rgba(222,226,255,.07)` (280, 332) | `var(--legacy-line-hair)` |
| `rgba(255,255,255,.07)` (282, 323) | `var(--legacy-overlay-hover)` |
| `#41465e`, `rgba(255,255,255,.025)` (283) | `var(--legacy-surface-nav-active)`, `var(--legacy-overlay-soft)` |
| `#f5f6ff` (284) | `var(--legacy-icon-on-nav)` |
| `rgba(123,214,175,.1)` (286, 333) | `var(--legacy-tint-ok)` |
| `#454b67` (290, 409, 448, 535) | `var(--legacy-scroll-thumb)` |
| `#3b4057` (291) | `var(--legacy-surface-block-alt)` |
| `rgba(7,8,18,.08)` (291) | `var(--legacy-shadow-sm)` |
| `#e7e9f4` (293) | `var(--legacy-strong-on-dark)` |
| `#adb2c7` (296) | `var(--legacy-placeholder-strong)` |
| `#3f435a`, `#4a506b` (301, 303, 305) | `var(--legacy-surface-action)`, `var(--legacy-surface-action-hover)` |
| `#3c4159` (309) | `var(--legacy-surface-tool-add)` |
| `rgba(8,9,22,.08)` (318) | `var(--legacy-shadow-card)` |
| `rgba(167,196,255,.12)`, `rgba(8,9,22,.16)`, `0 12px 24px …` (319) | `var(--legacy-tint-accent-line)`, `var(--legacy-shadow-card-hover)` |
| `rgba(167,196,255,.42)`, `#323852`, `rgba(93,157,255,.1)` (320) | `var(--legacy-tint-accent-line-strong)`, `var(--legacy-surface-active)`, `var(--legacy-tint-accent)` |
| `#fff` (323) | `var(--legacy-on-solid)` |
| `#f15b29`, `#096da9`, `#efad18`, `#fff8da`, `#4b4d61` (324-327) | `var(--legacy-tone-0)` … `var(--legacy-tone-3)`, `var(--legacy-tone-2-fg)` |
| `rgba(123,214,175,.25)` (333) | `var(--legacy-tint-ok-line)` |
| `rgba(20,23,42,.55)` (337) | `var(--legacy-mini-bg)` |
| `rgba(255,146,158,.25)`, `rgba(255,146,158,.1)` (339, 547) | `var(--legacy-tint-err-line)`, `var(--legacy-tint-err)` |
| `rgba(222,226,255,.08)` (344, 347, 395) | `var(--legacy-line-edge)` |
| `#272b40` (344, 395) | `var(--nav)` — same value, and those are the drawer and its footer, not tab rules |
| `rgba(7,8,18,.24)` (344) | `var(--legacy-shadow-drawer)` |
| `#30344a`, `#086ba7`, `#262a40` (360-362) | `var(--legacy-surface-block)`, `var(--legacy-address-avatar)`, `var(--legacy-surface-input)` |
| `rgba(222,226,255,.12)`, `rgba(23,26,43,.22)` (364) | `var(--legacy-line-mid)`, `var(--legacy-field-inset)` |
| `rgba(222,226,255,.1)` (371) | `var(--legacy-line-faint)` |
| `rgba(222,226,255,.13)`, `#25293d` (382) | `var(--legacy-line-field)`, `var(--legacy-surface-field)` |
| `rgba(167,196,255,.7)`, `rgba(93,157,255,.13)` (385) | `var(--legacy-tint-accent-focus)`, `var(--legacy-tint-accent)` |
| `#121426` (406, 417, 549) | `var(--topbar)` |
| `#ff5962`, `#ff6670`, `#2a2e44`, `rgba(7,8,18,.14)` (428-431) | `var(--legacy-danger-node)`, `var(--legacy-danger-title)`, `var(--legacy-surface-log)`, `var(--legacy-shadow-log)` |
| `#bab3d0`, `#ff8a91` (434, 435) | `var(--legacy-log-glyph)`, `var(--legacy-danger-log)` |
| `#2d3147` (440) | `var(--legacy-surface-secondary)` |
| `rgba(0,0,0,.18)` (443) | `var(--legacy-shadow-sheet)` |
| `rgba(222,226,255,.055)` (454) | `var(--legacy-row-hover)` |
| `rgba(242,200,111,.28)`, `rgba(242,200,111,.1)` (462) | `var(--legacy-tint-warn-line)`, `var(--legacy-tint-warn)` |
| `#2b3048`, `#1c2033`, `#263b43`, `rgba(123,214,175,.22)`, `#3e2939` (537-547) | `var(--legacy-surface-tab-active)`, `var(--legacy-surface-tab-session)`, `var(--legacy-surface-tab-active-session)`, `var(--legacy-tint-ok-line)`, `var(--legacy-surface-tab-failed)` |
| `#1a1e30` (550) | `var(--legacy-surface-bar)` |

The two `border-radius` literals that are not 7/10/15 (`11px`, `12px`, `13px`, `14px`, `16px`, `17px`, `18px`, `20px`, `9px`) are geometry, not colour, and are out of scope here — the test regex matches colour literals only. Plan 2 folds them onto `--r-*`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: PASS, including the no-literals test with an empty offender list.

- [ ] **Step 6: Build and compare the artifact**

```powershell
npm run build:web
Select-String -Path packages/ui/dist/app.css -Pattern '#[0-9a-fA-F]{3,8}\b' | Measure-Object -Property Line
```
Expected: `Count` equals the number of colour declarations inside `tokens.css` only — no match should carry a selector from another partial. Then run `npm run verify`.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles packages/ui/tests/design-tokens.test.mjs
git commit -m "refactor(ui): consume tokens for every colour"
```

---

## Task 4: Terminal palette follows the tokens

**Files:**
- Modify: `packages/ui/src/terminal-view.ts:18-33`
- Modify: `packages/ui/tests/design-tokens.test.mjs`
- Test: `packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/tests/design-tokens.test.mjs`. This is the first half of the spec's "single theme source" rule: the xterm theme is currently four hard-coded values plus a 16-entry ANSI array that nothing ties to the stylesheet.

```js
test('the xterm theme reads its colours from the terminal tokens', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/terminal-view.ts', import.meta.url), 'utf8')
  assert.match(source, /getComputedStyle/, 'the xterm theme must be resolved from CSS custom properties')
  assert.match(source, /--term-bg/, 'the terminal background must come from --term-bg')
  assert.match(source, /--term-fg|--term-cursor|--term-selection/, 'cursor, foreground and selection must come from tokens')
  const stray = source.match(/#[0-9a-fA-F]{6}\b/g) ?? []
  assert.ok(stray.length <= 16, `only the 16 ANSI entries may carry literals, found ${stray.length}`)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: FAIL — `the xterm theme must be resolved from CSS custom properties`.

- [ ] **Step 3: Resolve the theme from computed style**

In `packages/ui/src/terminal-view.ts`, replace the literal `theme` object at lines 22-29 with values read from the document. Add the helper above the options construction:

```ts
const probe = document.documentElement
const read = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim()

const ANSI: string[] = [
  '#08090a', '#f2555a', '#4ec27f', '#e0a83c', '#5aaeff', '#c58aff', '#57c8d0', '#b9bec6',
  '#565b63', '#ff7b81', '#7ddba8', '#f2c86f', '#7cc0ff', '#d9a8ff', '#7fe0e8', '#f2f3f5',
]
```

and in the `new Terminal({ ... })` options:

```ts
  theme: {
    background: read('--term-bg'),
    foreground: read('--term-fg'),
    cursor: read('--term-cursor'),
    cursorAccent: read('--term-bg'),
    selectionBackground: read('--term-selection'),
    ...palette,
  },
```

**Correction found during execution: `ANSI` is not a key of xterm's `ITheme`.** Writing `ANSI,` into the theme object fails to compile with `TS2353: Object literal may only specify known properties, and 'ANSI' does not exist in type 'ITheme'`, and `@xterm/xterm` 6.0.0 accepts no array at all — its `ThemeService` folds the sixteen *named* keys into its own 0-15 array. A cast would have compiled and then silently delivered xterm's Tango defaults, with the red at `#cc0000`, and nothing anywhere would have errored. The shipped shape keeps the array as the single readable list and hands it over positionally:

```ts
  const palette: ITheme = {
    black: ANSI[0], red: ANSI[1], green: ANSI[2], yellow: ANSI[3],
    blue: ANSI[4], magenta: ANSI[5], cyan: ANSI[6], white: ANSI[7],
    brightBlack: ANSI[8], brightRed: ANSI[9], brightGreen: ANSI[10], brightYellow: ANSI[11],
    brightBlue: ANSI[12], brightMagenta: ANSI[13], brightCyan: ANSI[14], brightWhite: ANSI[15],
  }
```

with `...palette` spread after the five token reads, and `ANSI[0]` set to `#101317` rather than `--term-bg` so black-on-terminal text is not exactly 1.00:1 by construction, and `ANSI[8]` set to `#5f656e` so the dimmed-prompt colour clears 3:1.

`cursorAccent` must stay in the object. The literal it replaces (`terminal-view.ts:23`) was `cursorAccent: '#121426'`, which is that file's own background value: xterm inverts the glyph under a hollow or opaque cursor using it, so dropping the key changes how the cursor renders over text. It resolves to `--term-bg` because the cell under the cursor is the canvas.

Add one more assertion to the Task 4 test: `--term-cursor` carries the same RGB triplet as `:root`'s `--ac`. A review of Task 1 found that `--term-cursor: #5aaeff` is a third hand-copy of the accent, and only `--ac-bg` and `--term-selection` were placed under triplet tracking, so flipping the accent in Plan 2 would leave the cursor behind in silence.

`read()` takes no fallback on purpose. `style.css` is linked in `index.html` and imported at `app.ts:2`, so the custom properties are resolved before any terminal is constructed; a fallback string would only add untested code paths and push the literal count past the assertion below.

Keep `fontSize: 14` for now; `--fs-term` is 13.5px and applying it is a Plan 2 change, because a font-size change without a re-measure is exactly the measurement race the spec defers.

**Deferred half of the spec's theme-sync rule.** The spec also wants `index.html`'s `theme-color` meta and `apps/desktop/electron/app/shell.ts`'s `backgroundColor` and overlay `symbolColor` asserted against the token file. Those three literals are all `#121426` or `#a1a5bb`, which still equal `--topbar` and `--text-muted` today, so the assertion would pass now and only start to bite after Plan 2's flip — and a test that must be added disabled is worse than one added later. It belongs in the flip commit, and `docs/superpowers/plans/` will carry that task.

- [ ] **Step 4: Run tests and the client lifecycle check**

```powershell
node --test packages/ui/tests/design-tokens.test.mjs
npm run typecheck
node packages/ui/tests/smoke-client-lifecycle.mjs
```
Expected: all pass. The lifecycle smoke test injects a headless terminal factory, so confirm the real browser path still opens: run `npm run start:web`, connect to a host, and check the canvas background is `#08090a` and text is legible.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/terminal-view.ts packages/ui/tests/design-tokens.test.mjs
git commit -m "refactor(ui): resolve the xterm palette from tokens"
```

---

## Task 5: Adopt Inter and reduce the weight set

**Files:**
- Modify: `packages/ui/package.json:9-15`
- Modify: `packages/ui/src/styles/base.css`
- Modify: `packages/ui/tests/design-tokens.test.mjs`
- Modify: root `package-lock.json` (by `npm install`, never by hand)

- [ ] **Step 1: Write the failing test**

Append:

```js
test('the stylesheet ships Inter and keeps to four weights', async () => {
  const { readFile } = await import('node:fs/promises')
  const manifest = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
  assert.match(manifest, /@import\s+"@fontsource-variable\/inter\/latin-400\.css"/, 'Inter latin must be bundled, not fetched')
  const texts = []
  for (const name of STYLED_PARTIALS) {
    texts.push(await readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8'))
  }
  const weights = new Set([...texts.join('\n').matchAll(/font-weight:\s*([^;]+);/g)].map((m) => m[1].trim()))
  for (const weight of weights) {
    assert.ok(['400', '500', '600', '700', 'normal', 'bold'].includes(weight), `disallowed font-weight ${weight}`)
  }
})

test('tabler icons never inherit a synthetic bold', async () => {
  const { readFile } = await import('node:fs/promises')
  const base = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8')
  assert.match(base, /\.ti\s*\{[^}]*font-weight:\s*400/, 'the icon font must be pinned to 400')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ui/tests/design-tokens.test.mjs`
Expected: FAIL on the Inter import assertion.

- [ ] **Step 3: Add the dependency from the repository root**

```powershell
npm install @fontsource-variable/inter --workspace=@pureterm/ui --save-exact
```
Expected: `packages/ui/package.json` gains an exact `@fontsource-variable/inter` entry and the root `package-lock.json` updates. The root lockfile is the only lockfile — if any nested `package-lock.json` appears, delete it and re-run from the root.

- [ ] **Step 4: Import only the faces that are used**

Prepend to `packages/ui/src/style.css`, after the Tabler line:

```css
@import "@fontsource-variable/inter/latin-400.css";
@import "@fontsource-variable/inter/latin-500.css";
@import "@fontsource-variable/inter/latin-600.css";
@import "@fontsource-variable/inter/latin-700.css";
```

If the installed version exposes a single `index.css` with all four weights instead, import that one file and drop the four lines; check with `Get-ChildItem node_modules/@fontsource-variable/inter/*.css` before guessing. Do not import the full CJK or greek/cyrillic subsets — the page never renders them and they are dead weight in every installer.

- [ ] **Step 5: Point the body at the token and pin the icon font**

In `packages/ui/src/styles/base.css`, change the `body` rule's family and size to the tokens, and add the icon rule:

```css
body {
  overflow: hidden;
  background: var(--main);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--fs-ui);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

.ti { font-weight: 400; font-style: normal; -webkit-font-smoothing: antialiased; }
```

`.ti` must be pinned because inherited 600-800 weights make the icon webfont synthesise a bold it does not have, which shows up as smeared glyphs at 20-25px.

- [ ] **Step 6: Reduce every weight to the allowed set**

Replace across the partials: `650`→`600`, `750`→`700`, `800`→`700`, `1000`→`700`, and `500` where it currently reads a heading that should stay quiet. Concrete locations from the current file, now in partials: `base.css` `button` `600` stays, `button.primary` `750`→`700`, `button.mini` `600` stays; `chrome.css` `.app-tab` `650`→`600`, `.workspace-mark` `800`→`700`, `.nav-item` `600` stays, `.nav-icon` `700` stays; `hosts.css` `.section-kicker` `800`→`700`, `.hosts-heading h1` `700` stays, `.host-label` `700` stays, `.host-avatar` `800`→`700`, `button.mini` stays; `inspector.css` `.mode` `750`→`700`, `.drawer-section h2` `750`→`700`, `.ssh-port-row strong` `750`→`700`; `states.css` `.failure-host h1` `750`→`700`, `.failure-shell > h2` `750`→`700`.

- [ ] **Step 7: Apply the scale to the elements that already match a token**

In each partial, replace a fixed `font-size` with the matching `--fs-*` only where the value is already exactly equal, so this step cannot shift layout: `13px`→`var(--fs-ui)`, `12px`→`var(--fs-meta)`, `11px`→`var(--fs-micro)`, `14px`→`var(--fs-em)`, `16px`→`var(--fs-h2)`, `20px`→`var(--fs-h1)`. Leave `10px`, `21px`, `22px`, `23px`, `25px`, `28px`, `34px`, `36px` and icon sizes alone — they are retuned in Plan 2 with the chrome rebuild, not here.

- [ ] **Step 8: Run the tests and inspect both entry points**

```powershell
node --test packages/ui/tests/design-tokens.test.mjs
npm run verify
npm run start:web
npm run start:desktop
```
Expected: tests and `verify` pass. In each window, DevTools → Network must show **zero** remote font requests, and `getComputedStyle(document.body).fontFamily` must start with `Inter`. Confirm Chinese labels still render — they must come from `Microsoft YaHei UI`, and if a Latin glyph looks mismatched next to it, that is a fallback ordering bug in `--font-ui`, not a reason to bundle a CJK font.

- [ ] **Step 9: Commit**

```bash
git add package-lock.json packages/ui/package.json packages/ui/src/style.css packages/ui/src/styles packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): bundle Inter and reduce the weight set"
```

---

## Task 6: Document the token system

**Files:**
- Create: `docs/design-system.md`, `docs/design-system_zh.md`
- Modify: `CHANGELOG.md`
- Modify: `packages/ui/src/lib/changelog.ts`, `packages/ui/src/lib/version.ts` (generated only)

- [ ] **Step 1: Write the English design-system document**

`docs/design-system.md` must contain, in this order: the link line `[中文版本](design-system_zh.md)`; the rule that `styles/tokens.css` is the only place a colour literal may appear; the neutral ramp table and the accent/semantic table copied verbatim from the spec at `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md`; the typography and metric tables from the same section; the four-step theme resolution order; the 16 ANSI entries in the order used by `terminal-view.ts`; and a **Legacy aliases** section that states the block is a debt register, names Plan 2 as its deletion point, and warns that adding to it needs a reason.

- [ ] **Step 2: Write the Chinese document as a complete translation**

`docs/design-system_zh.md` mirrors section for section. Per the repository rule, code blocks, identifiers, links and version numbers must stay equivalent to the English file — the MIT `LICENSE` is the only document that has no translation.

- [ ] **Step 3: Record the change**

Add to `CHANGELOG.md` under `[Unreleased]`:

```markdown
### Changed
- The shared UI stylesheet is split into role-based partials behind a `style.css`
  manifest, and every colour now resolves through design tokens in
  `packages/ui/src/styles/tokens.css`. UI text uses bundled Inter and renders in
  four weights instead of six.

### Added
- `docs/design-system.md` documents the token system, both theme groups and the
  terminal palette, with a Chinese translation.
- New unit tests fail on any colour literal outside a token block, on a token
  present in one theme but not the other, and on any text or accent pair that
  drops below WCAG AA.
```

- [ ] **Step 4: Regenerate the embedded changelog and version**

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```
Expected: `release:check` prints `Changelog and workspace versions are valid for 0.1.0-alpha.1.` and `git status` shows `packages/ui/src/lib/changelog.ts` as modified. If `version.ts` also changes, the two commands were run in the wrong order — re-run both.

- [ ] **Step 5: Full verification and links**

```powershell
npm run verify
git diff --check
Get-ChildItem docs/*.md | ForEach-Object { (Get-Content $_.FullName -Raw) -match 'design-system_zh\.md' }
```
Expected: `verify` green; `git diff --check` silent; both documents link each other.

- [ ] **Step 6: Commit**

```bash
git add docs/design-system.md docs/design-system_zh.md CHANGELOG.md packages/ui/src/lib/changelog.ts packages/ui/src/lib/version.ts
git commit -m "docs(ui): document the token system"
```

---

## Done criteria for this plan

- `npm run verify` and `npm run verify:electron` pass on `feat/ui-redesign`.
- `design-tokens.test.mjs` is green and would fail if any single hex value were added outside `tokens.css`.
- Each theme group declares every colour token, and no metric is duplicated into the light theme. (`:root` legitimately holds ~55 more names once Task 3 adds the legacy register; the invariant is "nothing is light-only", not "the two groups are equal".)
- `docs/design-system.md` and its Chinese pair exist and agree.
- Appearance is recognisably the current PureTerm, now re-typeset in Inter. **The palette flip to graphite is Plan 2's first commit**, and this plan must not do it early.

## Not in this plan

- Plan 2: delete the legacy alias block, flip to the graphite ramp, rebuild the chrome (52px rail, top-bar tabs, 24px status bar, brand SVG and favicon, theme switch, dead `.window-control` removal), fold remaining radii onto `--r-*`, apply `--fs-term`, and add the deferred half of the theme-sync rule (`index.html` meta and `shell.ts`'s two literals). **Watch the light theme's `--ac-fg` on `--ac`: it measures 4.63:1, only 0.13 above the AA floor.** Any lightening of the accent during the flip breaks it, and `design-tokens.test.mjs` will fail — darken the accent rather than loosening the threshold.
- Plan 3: hosts and keychain tables, docked Inspector, resizable SFTP split, four states, toasts, failure diagnostics, the breakpoint consolidation to 1100/820/620, and the `docs/architecture.md` update.
- Both later plans inherit this plan's no-literals rule, so any new CSS they add must reference a token from the first commit of that task.

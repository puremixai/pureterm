# Professional Frontend Redesign

[中文版本](2026-09-23-frontend-professional-redesign_zh.md)

## Intent and baseline

Rebuild the visual language of the shared browser UI in `packages/ui/` so PureTerm reads as a precise engineering instrument rather than a themed skin. The current stylesheet is one 581-line file whose `:root` declares 26 tokens while roughly 80 later rules hard-code their own hex values, and whose five base surfaces span hue 232°–240°. That blue-violet cast, not the layout, is the main reason the dark theme reads as a game skin.

Direction **A · Neutral Graphite** was selected against two alternatives (light-chrome/dark-terminal and layered dark with soft shadows) by comparing the same layout under three skins. Scope covers all four offered packages: the token foundation, structural upgrades, brand mark plus a single theme source, and a dual light/dark theme. Delivery follows a token-first, incremental approach; a big-bang rewrite and a Tailwind-class toolchain were both rejected.

Work happens on branch `feat/ui-redesign`, never on `main`.

## Non-goals

- No Tailwind, component kit or new runtime UI dependency. `@pureterm/ui` stays browser-only, zero-framework, and `scripts/check-boundaries.mjs` must keep passing unchanged.
- No `@pureterm/protocol`, `@pureterm/host` or `@pureterm/transport` change. Connection-stage error codes and a `ui-prefs` store are explicitly deferred.
- No layout paradigm change: navigation stays left, the host list and the editing surface stay separate, the terminal keeps one pane per tab.
- No installer icons (`.icns`, `.ico`, multi-size PNG). That would drag `electron-builder` configuration and the full `verify:package:windows` install/uninstall flow into a UI change.
- No real `<table>` semantics for the host list; cards and rows share one DOM, and the roles would conflict.
- No bundled terminal font.
- No version bump. `VERSION.txt` stays `0.1.0-alpha.1` and all changes land under `[Unreleased]`.

## Token system

`packages/ui/src/styles/tokens.css` becomes the only place a literal color may appear. Every other file consumes variables only.

### Neutral ramp

Hue is fixed at 210° with saturation at or below 5%, so depth expresses hierarchy and never mood.

| Token | dark | light | Role |
| --- | --- | --- | --- |
| `--c-inset` | `#08090a` | `#eceef1` | Code, logs, embedded inputs |
| `--c-canvas` | `#0a0b0d` | `#f7f8f9` | Window background |
| `--c-chrome` | `#0e1013` | `#eef0f2` | Top bar, rail, status bar, dialog footer |
| `--c-surface` | `#131519` | `#ffffff` | Cards, rows, panels, Inspector |
| `--c-raised` | `#191c21` | `#f4f6f8` | Hover, selected row, popover |
| `--c-control` | `#21252b` | `#e8ebef` | Segmented selection, input fill, kbd |
| `--line` | `#262a31` | `#dfe3e8` | Primary hairline; the main layering device |
| `--line-soft` | `#1c1f24` | `#eceef1` | Row and section separators |
| `--line-strong` | `#3a4049` | `#c6ccd4` | Control borders |

Text ramp: `--tx-1` `#f2f3f5`/`#16181c`, `--tx-2` `#b9bec6`/`#454b54`, `--tx-3` `#7d838d`/`#6b7280`, `--tx-4` `#565b63`/`#9aa1aa`.

`--tx-4` is reserved for disabled controls and purely decorative rules only — it measures ≈2.7:1 on `--c-surface` and is deliberately outside the AA assertion. That is why `--fs-micro` column headers and section labels use `--tx-3`, not `--tx-4`: those carry real information and must stay legible.

### Accent and semantics

The stylesheet currently carries four blues (`#3c9ef5`, `#a7c4ff`, `#69c8f4`, `#096da9`, `#086ba7`, `#075a87`) and three greens. They collapse to one accent plus four status colours and everything else is grey.

| Token | dark | light | Role |
| --- | --- | --- | --- |
| `--ac` | `#5aaeff` | `#1f6feb` | Only emphasis colour: primary button, selection, focus, active rail mark |
| `--ac-hi` | `#7cc0ff` | `#1a5fcd` | Hover |
| `--ac-bg` | `rgba(90,174,255,.12)` | `rgba(31,111,235,.10)` | Selection fill |
| `--ac-fg` | `#05070a` | `#ffffff` | Text on solid accent |
| `--ok` | `#4ec27f` | `#1a7f4b` | Connected, verified |
| `--warn` | `#e0a83c` | `#9a6a0a` | Legacy key, degraded capability |
| `--err` | `#f2555a` | `#c2363b` | Failure; outline only, never a solid fill |
| `--idle` | `#8b919b` | `#7e8590` | Disconnected state dot |

`--idle`'s light value is a correction rather than a re-tune, in the same way entry 0 and bright entry 0 of the ANSI set below were corrected: the `#c9ced5` specified here measured 1.58:1 on `--c-surface` and 1.385:1 on `--c-chrome`, well under the 3:1 floor a status dot has to clear, so Task 1 replaced it with `#7e8590`, which measures 3.72:1 and 3.26:1. `design-tokens.test.mjs` asserts that floor per theme.

Primary buttons are solid accent with `--ac-fg` text. Destructive buttons keep a ghost outline whose border and label turn `--err`.

Measured ratios: `--tx-1` on `--c-surface` ≈ 16.5:1 dark and ≈ 17.7:1 light; `--tx-3` on `--c-surface` ≈ 4.8:1; solid primary ≈ 8.5:1 dark and ≈ 4.6:1 light. All clear WCAG AA at body size.

### Typography

- `--font-ui`: `Inter, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif`
- `--font-mono`: `"JetBrains Mono", "Cascadia Mono", Consolas, monospace` — shell only; the terminal keeps the system mono stack
- `--font-term`: unchanged system mono stack, `"Cascadia Mono", Consolas`, because of the measurement race described below

Terminal surface tokens replace the four hard-coded values in `terminal-view.ts`: `--term-bg #08090a`, `--term-fg #c9ced6`, `--term-cursor #5aaeff`, `--term-selection rgba(90,174,255,.24)`. The 16 ANSI entries are retuned once into a neutral set and listed in `docs/design-system.md`: normal `#101317 #f2555a #4ec27f #e0a83c #5aaeff #c58aff #57c8d0 #b9bec6`, bright `#5f656e #ff7b81 #7ddba8 #f2c86f #7cc0ff #d9a8ff #7fe0e8 #f2f3f5`. Entry 0 is deliberately not `--term-bg`, because identical values make black-on-terminal text exactly 1.00:1 by construction, and bright entry 0 clears 3:1 because prompts use it for dimmed rather than hidden text. They stay dark in the light theme.

| Token | Spec | Use |
| --- | --- | --- |
| `--fs-micro` | 11px / 500 / `.07em` / uppercase | Section labels, column headers |
| `--fs-meta` | 12px / 400 | Addresses, fingerprints, metadata |
| `--fs-ui` | 13px / 400 | Body default |
| `--fs-em` | 14px / 500 | Buttons, emphasised values |
| `--fs-h2` | 16px / 600 / `-.01em` | Group headings |
| `--fs-h1` | 20px / 600 / `-.02em` | Page title |
| `--fs-term` | 13.5px / 1.5 | xterm.js |

Weights reduce from `400/600/650/700/750/800` to `400/500/600/700`; values such as 650 and 750 resolve to no real weight and force synthetic bolding, which blurs CJK and small Latin. `font-variant-numeric: tabular-nums` applies to every element holding an IP, port, size, latency, duration or mode, so columns do not jitter.

### Metrics

- Spacing on a 4px base: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32.
- Row heights `--row-h` 38 standard and `--row-h-compact` 30 via `[data-density="compact"]`. Control heights 26 and 28.
- Radius tightens from 7/10/15 to `--r-1` 3 (inputs, chips), `--r-2` 5 (buttons, rows, cards), `--r-3` 8 (panels, dialog), `--r-full` 999 (state dots).
- Layering in dark uses hairlines only, with no shadows; `--shadow-pop` (`0 8px 24px -6px` plus a 1px ring) is reserved for popovers and dialogs, and light may add `0 1px 2px rgba(16,24,40,.05)` to raised surfaces.
- `--z-drawer` 20, `--z-popover` 30, `--z-toast` 40, `--z-dialog` 50.
- Motion uses one curve, `--ease cubic-bezier(.2,.8,.2,1)`, at `--t-1` 100ms, `--t-2` 160ms, `--t-3` 240ms. `prefers-reduced-motion: reduce` disables all transitions and skeleton animation.
- Focus uses a double ring that stays visible on both themes: `box-shadow: 0 0 0 2px var(--c-canvas), 0 0 0 4px var(--ac)`, on `:focus-visible` only.

## Theme mechanism

1. `<html data-theme="dark|light">` selects a variable group, and `color-scheme` is switched in the same rule so native scrollbars, form controls and `::selection` follow.
2. The terminal always uses a dedicated `--term-*` dark group in both themes. A light shell over a dark terminal is intentional and must not be "fixed".
3. Preference order is an explicit stored value, then `prefers-color-scheme` when the stored value is `system`, then dark. Default is dark.
4. `tokens.css` is authoritative. `index.html`'s `theme-color` meta, `apps/desktop/electron/app/shell.ts`'s `backgroundColor` and window-button overlay `symbolColor`, and `packages/ui/src/terminal-view.ts`'s `background` keep their literals because a runtime coupling would break the browser-only boundary; `theme-sync.test.mjs` parses `tokens.css` and fails when any of the four drifts.

## Application chrome

- Top bar is 40px and is the drag region. It holds the brand mark, the wordmark `PureTerm` with a `/ Vault` or `/ Session` context, the workspace tab strip, the theme toggle, and the native window-control reservation.
- The brand becomes an inline SVG prompt mark (chevron plus caret bar) replacing the text `PT`, and the page gains a real favicon. The mark is 18px inside a `--c-control` square with a `--line-strong` border.
- Left navigation becomes a 52px icon rail with a 2px accent indicator bar on the active item. Three items do not justify 278px, and the reclaimed 226px pays for the host table columns. `nav-collapsed`, `#nav-toggle` and their rules are removed; the navigation footer's workspace status moves to the status bar.
- A 24px status bar is added as a third `#app` grid row: connection dot and state, uptime, `user@host:port`, negotiated cipher and host key type, terminal dimensions, SFTP throughput, capability state, and version. Only the connection state element carries `role="status"`.
- The dead `.window-control` rules are deleted; no markup matches them.
- Session tabs live in the top bar with a state dot, host label, and a close button that appears on hover.

## Hosts workspace

Header row is title, count metadata, search (with a `Ctrl K` hint), primary action and the view toggle. The default view is a five-column grid over the existing `<ul>`: Name (avatar plus label), Address, User, Auth, Last connected. The Auth column distinguishes `keychain` from a local file and shows the algorithm, because that is the fact that decides whether a host is usable. Card view remains a toggle.

Selection is `--ac-bg` plus a 2px accent bar on the left edge; hover raises the row one surface step. Legacy or risky material such as a `ssh-dss` key or a changed host fingerprint uses `--warn` text and an icon, never a filled block.

## Connection Inspector

The editing surface docks at 322px instead of overlaying, with `--c-surface` background and a left hairline. Its header is a `--fs-micro` mode label, body sections are separated by `--line-soft` rules under `--fs-micro` headings, fields use labels above 26px inputs on `--c-inset`, and the footer is sticky with delete on the left, save and Connect on the right.

Address and port become two fields in one row with a live resolved target beneath (`ssh deploy@10.2.1.8:22`). Authentication becomes a two-segment control rather than a `<select>`. Credential storage state is an always-visible lock line naming the OS provider, replacing an intermittently shown `#credential-hint`.

## Keychain workspace

Same table plus Inspector pattern. A persistent banner above the list states the encryption provider and the never-plaintext guarantee, because `#keychain-policy` is currently an empty text node that no user ever sees. Columns are Name, Type, SHA256 fingerprint, Host count, Created. The Inspector shows the PEM body in a read-only mono block with a validity badge, states in its own line that private key and passphrase are never echoed back on re-edit, keeps the drop-to-import target, and offers copy and download of the public key.

## Terminal and SFTP

`session-content` becomes a horizontal split with a 5px draggable grip between terminal and SFTP, replacing the hard-coded `grid-template-rows: minmax(120px,1fr) minmax(160px,40%)`. The grip widens its own hit area, the middle bar turns accent on hover, and the ratio persists for the session.

The SFTP panel becomes a four-column table: Name, Size, Mode as octal, Modified, with a breadcrumb path, row-level transfer progress, and right-aligned `tabular-nums` numerics.

## Failure diagnostics

`tab.logs` is assembled in the UI today (`packages/ui/src/services/terminal.ts:303` seeds one line and `:329` pushes `cleanError(error)`); the Host has never reported stages. So classification is done in the page by matching the error text against a table of known SSH and socket failures — `ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `Permission denied (publickey)`, host key changed, `Unable to negotiate`, and authentication timeouts — each mapping to a category badge, a failing node in the route, and one next-step suggestion.

The route grows from two dots to four nodes (local, TCP, key exchange, authentication) with a dashed red link at the failure point. The log becomes a `--c-inset` mono block with non-selectable line numbers and error lines tinted `--err`. Actions are retry, edit host, copy log, plus the suggestion line.

If a stage cannot be classified, the route collapses to a single failure node and the page degrades to the log block. This keeps the whole feature inside `@pureterm/ui`.

## States and feedback

Every list gets four states: loading skeleton (shimmer rows at the real 38px height so nothing jumps on arrival, `aria-hidden` plus one polite status line), empty (icon, one-line explanation, the action that resolves it), error (backend unavailable versus a single failed operation), and degraded (a capability is off, such as Keychain being unavailable, while the rest works).

A bottom-right toast replaces the scattered `#status` text nodes: 2px semantic bar, title, one mono detail line, auto-dismiss. `role="status"` for normal notices and `role="alert"` for failures.

## Assets and dependencies

- Add `@fontsource-variable/inter` as a `packages/ui` dependency and import only its latin and latin-ext faces from `base.css`, matching the bare-specifier CSS import already used for `@tabler/icons-webfont` at `style.css:1`. esbuild already emits woff2 under `dist/fonts/` (`scripts/build-ui.mjs:10-11`) and `font-src 'self'` allows it.
- CJK never ships as a webfont; it falls through to `Microsoft YaHei UI`, `PingFang SC` and `Noto Sans CJK SC`.
- Icons stay Tabler. A global rule pins `.ti` to `font-weight: 400` and `-webkit-font-smoothing: antialiased`, because inherited 600–800 weights fake-bold the icon font.
- Favicon and the inline brand SVG are new source assets. No icon toolchain, no remote asset, no CDN.

## Files

`packages/ui/src/style.css` survives as an import manifest so `app.ts:2-3`, the `<link>` at `index.html:17` and the `dist/app.css` artifact contract all stay untouched.

```text
packages/ui/src/style.css            manifest: Tabler import then partials, in order
packages/ui/src/styles/tokens.css    :root, [data-theme=light], [data-density]
packages/ui/src/styles/base.css      reset, typography, focus ring, scrollbars, reduced motion
packages/ui/src/styles/chrome.css    top bar, tabs, rail, status bar, brand
packages/ui/src/styles/hosts.css     page header, search, rows, cards, empty
packages/ui/src/styles/inspector.css shared section, field, segment and footer system
packages/ui/src/styles/keychain.css  policy banner, key table, PEM block
packages/ui/src/styles/terminal.css  session toolbar, panes, xterm overrides, SFTP, grip
packages/ui/src/styles/states.css    skeleton, four states, toast, dialog
```

No `@layer`: esbuild flattens the imports, so file order already is the precedence, and a second cascade model costs comprehension for no gain.

## Constraints and accepted compromises

1. Standalone Web binds a random loopback port, so its origin changes every launch and `localStorage` preferences cannot survive a restart. Desktop persists normally because `pureterm-app://` is a stable origin. Web therefore falls back to `prefers-color-scheme` each launch; a `ui-prefs` protocol request is the real fix and is deferred.
2. CSP keeps `script-src 'self'`, so the usual pre-paint inline theme script is unavailable. `index.html` statically declares `data-theme="dark"` and the earliest module applies the stored value, which leaves a one-frame flash for light users on Desktop only.
3. xterm measures the cell box when the addon loads, and a webfont that has not finished loading produces wrong glyph widths. Rather than add a `document.fonts` gate into `services/terminal.ts` and its `ResizeObserver`-driven `fit()`, the terminal keeps the system mono stack this round.
4. Every id is load-bearing: `ClientView` throws on a missing id (`packages/ui/src/client-runtime.ts:55-65`). No id is renamed. Behavioural class names asserted by the lifecycle test — `.host-row`, `.host-main`, `.session-tab`, `.keychain-card`, `#host-list.list-view`, `aria-pressed`, `[data-tab-close]` — are kept so existing coverage stays meaningful instead of being rewritten to match new markup.
5. Breakpoints consolidate from five (1250/1450/900/820/620) plus one container query to three (1100/820/620): below 1100 the Inspector narrows, below 820 it overlays full width and SFTP stacks under the terminal, below 620 the top bar drops the context label.

## Testing and verification

`packages/ui/tests/*.test.mjs` is already globbed by `test:unit`, so new tests need no root script changes.

- `visual-contract.test.mjs` is rewritten: both themes' token groups exist; the rail and status bar grid values match; and **any hex or `rgb()` literal outside a token block fails the suite**, which is what permanently retires the ~80 hard-coded values.
- `theme-sync.test.mjs` is added: parse `tokens.css`, then assert the `theme-color` meta, `shell.ts` background and overlay `symbolColor`, and `terminal-view.ts` background agree with it.
- `client-lifecycle.browser.ts` gains selectors for the rail, tabs, status bar and Inspector, and keeps its existing assertions because class names are preserved.
- `electron-desktop-entry.mjs:22-31` keeps passing with `.app-topbar` carrying `-webkit-app-region: drag`.
- Contrast pairs are asserted numerically in `visual-contract.test.mjs` so a future token edit cannot silently drop below AA.

Commands, all from the repository root: `npm ci`, then `npm run verify` per commit; `npm run typecheck` includes the boundary check; `npm run verify:electron` before merging, since carriers, the custom scheme and window chrome are touched; `npm run release:check` and the Markdown link check after the documentation commit. `verify:package:windows` is not required because packaging is untouched. UI behavior is additionally confirmed by running `npm run start:web` and `npm run start:desktop` and operating both themes and the resizable split by hand.

## Commit sequence

Each commit is independently green under `npm run verify`.

1. `refactor(ui): split the stylesheet into a token-first foundation` — partials, full token set, both theme groups, contract and sync tests. Appearance is deliberately unchanged; old rules consume token aliases.
2. `feat(ui): adopt Inter with a tightened type scale` — font dependency and faces, scale, weight reduction, icon weight fix.
3. `feat(ui): rebuild the application chrome` — rail, tab strip, status bar, brand mark, favicon, theme switch, dead CSS removal.
4. `feat(ui): rebuild the hosts and keychain workspaces` — tables, shared Inspector, banner.
5. `feat(ui): add the resizable SFTP split, four states, toasts and failure diagnostics`.
6. `docs(ui): document the design system and record the change`.

## Documentation

New `docs/design-system.md` with a complete paired `docs/design-system_zh.md` carries the token tables, the theme rules and the four hard constraints; it is the durable output of this work. Update the UI section of `docs/architecture.md` and its Chinese pair, add the stylesheet layout and font commands to `docs/DEVELOPMENT.md`, and record the change in `CHANGELOG.md` under `Added` and `Changed`. Then run `node scripts/convert-changelog.js` and `node scripts/convert-changelog.js --sync-version`, committing the generated `packages/ui/src/lib/changelog.ts` and `packages/ui/src/lib/version.ts`.

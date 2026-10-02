# Design Tokens and Stylesheet Layout

[中文版本](design-system_zh.md)

This document describes the shared UI's token values, stylesheet layout, theme mechanism, terminal palette, typography, and responsive behavior. Geometry is read from the source files named here; the color tables retain their measured contrast ratios. Update this document with the styles it describes: the CSS tests do not check the prose.

Paths are relative to the repository root. See the [architecture](architecture.md) for process boundaries, the [development guide](DEVELOPMENT.md) for commands, and `AGENTS.md` for the repository rules this layout follows.

## The one rule

Inside the shared stylesheet, a colour literal may appear in exactly one file. `packages/ui/src/styles/tokens.css` is the system: the neutral ramp and its three line steps, the text ramp, the accent and status set, the fourteen translucent steps those colours need in order to be usable as fills and borders, the terminal group, and the theme-invariant metrics. Measured on the current tree, the `styles/` directory holds 50 hex literals and 30 functional `rgb()`/`rgba()` calls and every one of them is inside that file; the other nine partials hold none. The pre-redesign palette used to be a second sanctioned home — a guarded deletion list named `legacy.css` — and the palette flip retired its 99 remaining references, emptied it to a single orphan, and deleted the file rather than leaving an alias behind to be revived.

The qualifier is load-bearing, because the rule is about CSS and the guard reads partials. Two places outside the cascade hold colour literals: the two sixteen-entry palettes — `ANSI_DARK` and `ANSI_LIGHT` — in `packages/ui/src/terminal-view.ts`, deliberate and covered in [Terminal palette](#terminal-palette), and `<meta name="theme-color" content="#0e1013">` at `packages/ui/src/index.html:15`, which is outside the stylesheet and so outside the literal rule — `theme-sync.test.mjs` is what ties it to `--c-chrome`. Naming them here is what keeps the one-file sentence honest rather than merely narrow.

The end-to-end form of that claim is checkable in the artifact rather than the source: the built `packages/ui/dist/app.css` carries 56 hex literals, 50 of them inside the two theme blocks, and the remaining six all belong to `@xterm/xterm/css/xterm.css` — `.composition-view { background: #000; color: #FFF }` and its siblings, a vendored third-party sheet the guard reads no more than it reads Tabler's icons. No test reads the flattened sheet; the count above was measured by hand, and it is recorded so the next reader does not have to re-derive where those six come from.

`packages/ui/src/styles/fonts.css` is the only file that may name a typeface in a face declaration, because that is what an `@font-face` does: it declares a face rather than asking a token for one. The three stacks the page asks for — `--font-ui`, `--font-mono`, `--font-term` — are named in `tokens.css`, so `fonts.css` is the only place a family is declared, not the only place one is written out.

`packages/ui/tests/stylesheet-contract.test.mjs` enforces all of it, and the exemption list is itself asserted rather than declared:

- `SANCTIONED = ['tokens']` is compared against the live `EXEMPT` set, so exempting a second partial needs an explicit edit to a test constant. That list held two names, `legacy` and `tokens`, from the split until the flip; shrinking it to one was the plan's completion criterion.
- every member of `EXEMPT` must still be a partial the manifest imports, so a stale exemption fails.
- `totalImports(manifest)` must equal the number of parsed partial names plus one — the external Tabler line, which only `style.css` carries; `desktop.css` is one import per partial and nothing else. This closes the `url(...)` import form that yields no name and would therefore ship a partial into a cascade without ever being scanned.
- the colour test counts the partials it scanned and asserts the total equals `names.length - EXEMPT.size`, so a skipped file is a failure rather than a pass.
- every `var(--x)` in any partial, the register included, must name a token `tokens.css` declares — the test is `every var() reference names a token the register declares`. This is the opposite direction to a declaration's own liveness check, and it is the one that mattered during the flip: an unknown custom property is not an error, it is substituted at computed-value time, so a mistyped `var(--fs-metax)` in a partial or a `var(--c-canvasx)` inside a token value makes the declaration quietly stop existing on the page. The palette migration changed hundreds of call sites together, which is why the guard checks every reference.

The pattern is `/#[0-9a-fA-F]{3,8}\b|\brgba?\(/`, applied to each partial with comments blanked. Comments are blanked rather than deleted so an offender keeps the line number a reader sees in the file. The same file also pins the type rules: only `fonts.css` may declare a face, every `font-family` and `font` shorthand must resolve through `var(--font-ui)`, `var(--font-mono)` or `var(--font-term)` (or a CSS-wide keyword), and every `font-weight` must be one of the four weights this app ships. The `@font-face` carve-out those censuses rely on is only honest because a separate test asserts exactly one file may hold faces.

## Stylesheet layout

`packages/ui/src/style.css` is an `@import` manifest and nothing else: twenty-three lines, a cascade-contract header comment followed by ten imports — the first for `@tabler/icons-webfont/dist/tabler-icons.min.css`, the next nine for the local partials in cascade order. `packages/ui/src/desktop.css` is the second manifest, and it exists for one reason: a sheet the standalone Web entry must not carry.

| # | Partial | Responsibility |
| --- | --- | --- |
| 1 | `styles/fonts.css` | Bundled faces. The only file that may name a family in a face declaration. |
| 2 | `styles/tokens.css` | The token system and the theme groups. |
| 3 | `styles/base.css` | Element defaults: reset, inherited type, buttons and inputs, focus rings, reduced motion. |
| 4 | `styles/chrome.css` | Application shell: the `#app` grid, top bar, workspace and session tabs, navigation rail, status bar, and the state classes on `.app-shell`. |
| 5 | `styles/hosts.css` | Hosts dashboard: page header, search row, toolbar, and the table and card shapes a saved host renders in. |
| 6 | `styles/inspector.css` | Connection form: the docked editor shell and its header, sections, fields and footer, plus the shared controls the keychain editor reuses. |
| 7 | `styles/keychain.css` | Keychain library and editor over the shared host-table language. |
| 8 | `styles/terminal.css` | Terminal surface: the xterm pane and its overrides, the reconnect banner a dropped session shows, the terminal-local tool rail, and the shared tool panel with its splitter. |
| 9 | `styles/states.css` | Nothing-to-show and something-went-wrong: empty placeholder, shortcuts dialog, connection-failure page. |

`desktop.css` carries one partial, `styles/window-controls.css`, holding the top bar's minimize/maximize/close rules. The split is the point rather than an accident of file size: `index.html` and the built `app.css` are what both entry points share, and the Web entry has no window to control, so it must carry neither the markup nor the rules. The markup is not in `index.html` at all — `services/chrome.ts` links `./desktop.css` and builds the three buttons, and only when `window.puretermDesktop.windowControls` is present. Which platforms that is, is a platform question with one answer (`drawsOwnWindowControls` in the Desktop's platform plan): Windows and Linux, whose `titleBarStyle: 'hidden'` leaves no native buttons, but not macOS, which keeps its own traffic lights and must not have a second set drawn beside them. Measured on the built sheets, `app.css` contains no rule whose selector mentions `.window-control`, and every rule in `desktop.css` is one of them.

The terminal screen's tools are a rail, not a toolbar: a column at the right edge of `#session-workspace`, drawn from the same `--rail-w` and carrying the same 34px square button as the global navigation rail, one step removed in role. The rail is a column of the workspace rather than of the shell, so it leaves with the terminal page instead of staying behind on Hosts or Keychain, and it is excluded from the split ratio — the ratio describes the terminal and the panel, the only two tracks the grip sits between. Each tool registers a button and renders into one shared slot, so the terminal faces at most one panel and a second tool replaces the first rather than adding a second column. Closed, the slot and the grip are `hidden` and the session screen keeps the two fixed bands every page draws — the top bar (40px above 620px, 48px at narrower widths) and the 24px status bar; narrow screens also carry a separate 48px navigation row — with the terminal giving up no width. Open, the panel takes the file table's `minmax(240px, 1.35fr) var(--grip-w) minmax(220px, 1fr)` track and the same focusable grip, so only the terminal cell yields; below 820px the same grid turns a quarter turn, the panel stacks under the terminal behind a horizontal grip, and the rail stays on the right. Every panel keeps the file table's geometry rather than inventing one — a `.panel-head` row above a body that scrolls on its own — so a long path or a full metric list never scrolls the rail or the workspace. The monitor stacks its metrics as sections: a label and a value, plus an occupancy bar for CPU, memory and root disk and a receive/transmit sparkline for network. Status is carried by text and only repeated by colour, so the panel still reads under a colour-vision difference. The view runs no timer of its own: the host pushes a snapshot every five seconds and `monitor-panel.ts` only redraws text, attributes and the sparkline's path points.

The split ratio belongs to the terminal tab and applies only while a tool panel is open. Collapsing the panel clears both inline grid axes so the terminal fills the available area. Crossing the 820px breakpoint updates the grid axis and separator orientation immediately, retains the ratio and keyboard focus, and lets the terminal's existing resize observer fit its rows and columns.

File sizes and line counts vary with edits and checkout line endings. The table describes ownership; the source and stylesheet contract tests define the cascade.

The manifest owns cascade order because partials compete at equal specificity and the later import wins. That is why no partial may `@import`: a nested import would decide order in nine places instead of one, and `visual-contract.test.mjs` asserts `!/@import/` against every partial's own text. The order itself is pinned by the same test, which asserts the exact name list `['fonts', 'tokens', 'base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states']` for `style.css` and `['window-controls']` for `desktop.css` — and derives both from the manifests through `packages/ui/tests/partial-list.mjs` rather than a second copy of the files, so adding, renaming or reusing a partial fails until the assertion is edited with intent. That helper reads every manifest, and the censuses scan the union: a partial that only `desktop.css` imports would otherwise ship through a door no guard was watching, which is the one way this layout could still hide a file.

`style.css` reaches the page through two doors: `packages/ui/src/index.html:18` links `./app.css`, the built sheet, and `packages/ui/src/app.ts:2` imports `./style.css` so that esbuild flattens every `@import` — the nine partials `style.css` names plus the external Tabler and xterm sheets — into that single `packages/ui/dist/app.css` both entry points serve. `desktop.css` has a third, narrower door: nothing imports it, and `packages/ui/src/services/chrome.ts` appends `<link rel="stylesheet" href="./desktop.css">` to the document at runtime, once, and only when the desktop bridge offers `windowControls`. It is built by `scripts/build-ui.mjs` as a second esbuild entry, so the Web entry's `app.css` never contains it.

## Tokens

All values below are read from `packages/ui/src/styles/tokens.css`. The dark column is the `:root` group, the light column the `[data-theme="light"]` group.

`:root` declares 76 custom properties. The light group redeclares 40 of them — the 35 theme colours, the 4 terminal tokens, and `--shadow-pop` — and declares nothing new. The arithmetic below is what `design-tokens.test.mjs` enforces under both selectors, and it is the shape of the file rather than an accident of it: 6 surface steps + 3 line steps + 4 text steps + 8 accent and status + 14 translucent steps = 35 colours, + 4 terminal + 25 metrics + 10 type + 2 derived (`--ring`, `--shadow-pop`) = 76.

### Surface ramp

Six steps of depth. The header comment pins hue to 210deg at no more than 5% saturation; measured, the six surface steps span 210–220deg of hue with a maximum red-to-blue spread of 10 of 255 (`--c-control`), which is the intent underneath that number: depth is hierarchy, never mood. The ratio column measures each step against `--c-surface`, which is the ground the legibility rule below is stated on. In the dark group only `--c-raised` and `--c-control` sit above the surface; in the light group the surface is the top of the ramp and every other step sinks below it.

| Token | Dark | Light | Ratio to `--c-surface` (dark / light) |
| --- | --- | --- | --- |
| `--c-inset` | `#08090a` | `#eceef1` | 1.09 darker / 1.16 darker |
| `--c-canvas` | `#0a0b0d` | `#f7f8f9` | 1.08 darker / 1.06 darker |
| `--c-chrome` | `#0e1013` | `#eef0f2` | 1.04 darker / 1.14 darker |
| `--c-surface` | `#131519` | `#ffffff` | 1.00 |
| `--c-raised` | `#191c21` | `#f4f6f8` | 1.07 lighter / 1.08 darker |
| `--c-control` | `#21252b` | `#e8ebef` | 1.19 lighter / 1.20 darker |

Three line steps, faintest to strongest. They replaced the register's seven alpha steps, paired by measured ratio rather than by name: the four faintest (`.05`, `.07`, `.08`, `.085`, compositing to 1.14–1.26 on the grounds they were drawn on) collapsed onto `--line-soft`, `.12` and `.13` onto `--line`, and `.17` onto `--line-strong`. Six of the collapsed pairs then needed one more step after the floor guard ran — four separators from `--line-soft` up to `--line`, and two rules from `--line` up to `--line-strong`; see [Legality is per ground and per theme](#legality-is-per-ground-and-per-theme).

| Token | Dark | Light |
| --- | --- | --- |
| `--line-soft` | `#1c1f24` | `#eceef1` |
| `--line` | `#262a31` | `#dfe3e8` |
| `--line-strong` | `#3a4049` | `#c6ccd4` |

### Text ramp

| Token | Dark | Light | On `--c-surface` (dark / light) |
| --- | --- | --- | --- |
| `--tx-1` | `#f2f3f5` | `#16181c` | 16.46:1 / 17.77:1 |
| `--tx-2` | `#b9bec6` | `#454b54` | 9.79:1 / 8.80:1 |
| `--tx-3` | `#7d838d` | `#6b7280` | 4.79:1 / 4.83:1 |
| `--tx-4` | `#565b63` | `#9aa1aa` | 2.67:1 / 2.61:1 |

`--tx-1` and `--tx-2` are body and secondary text, `--tx-3` is the muted step, and `--tx-4` is the fourth rung. `design-tokens.test.mjs` asserts AA for `--tx-1`, `--tx-2` and `--tx-3` on `--c-surface` in both themes, and treats `--tx-4` as an ordering guard instead of a ceiling: it must stay weaker than `--tx-3` and at or above 1.5:1, so raising it into AA is progress while letting it fade to nothing is not.

Because it is not an AA step, `--tx-4` may not be used as text. The one general position is a `::placeholder`, which names a field whose label is already on screen and disappears on the first keystroke; `stylesheet-contract.test.mjs` reads every rule in the cascade and fails on a `color: var(--tx-4)` whose selector is not a placeholder. The hosts and keychain column headers were the first such rule — real 11px text at 2.88:1 dark and 2.61:1 light — and they now take `--tx-3` (5.16:1 and 4.55:1 on their own ground).

Exactly one selector is exempt, and the test names it rather than describing it: the top bar's brand suffix (`/ Vault`, `/ Session`), 2.79:1 on `--c-chrome` dark and 2.28:1 light. It is decorative — it restates what the rail's active item and the panel's own heading already say, so losing it costs no information — and the prototype writes it at `--tx-4`, which is why the alignment takes the prototype's rung here and the column headers' `--tx-3` there. The exemption is audited the way `EXEMPT` is: `DECORATIVE_TX4` has to still be a selector some partial draws at `--tx-4`, so an exemption cannot outlive the rule it was written for. The prototype's other sixteen `--tx-4` text positions still take `--tx-3`.

### Accent and status

| Token | Dark | Light | Notes |
| --- | --- | --- | --- |
| `--ac` | `#5aaeff` | `#1f6feb` | One accent, no gradient. |
| `--ac-hi` | `#7cc0ff` | `#1a5fcd` | Hover/strong step; lighter than `--ac` in the dark group and darker in the light group, so the hover state always gains contrast. |
| `--ac-bg` | `rgba(90, 174, 255, 0.12)` | `rgba(31, 111, 235, 0.1)` | Tinted fill. Its RGB triplet must equal the same group's `--ac`; only the alpha is free. |
| `--ac-fg` | `#05070a` | `#ffffff` | Legend on an accent fill: 8.58:1 dark, 4.63:1 light. |
| `--ok` | `#4ec27f` | `#187747` | 8.14:1 / 5.57:1 on `--c-surface`. |
| `--warn` | `#e0a83c` | `#8c6009` | 8.56:1 / 5.54:1 on `--c-surface`. |
| `--err` | `#f2555a` | `#b83237` | 5.42:1 / 5.92:1 on `--c-surface`. |
| `--idle` | `#8b919b` | `#7e8590` | Status dot that must not read as off: 3:1 minimum on both `--c-surface` and `--c-chrome`, asserted per theme (5.76/6.01 dark, 3.72/3.26 light). |

Status colours render as 11–12px labels, so the test holds them to the 4.5:1 normal-text floor rather than the 3:1 large-graphic floor. They also render on their own tint, which is the harder ground and the reason the light set is darker than the first draft: see [translucent steps](#translucent-steps).

### Translucent steps

Fourteen tokens make up this group: three overlay lifts, two accent steps (`--ac-bg`, in the table above, is the third), six status chip steps, a scrim, and the two scrollbar thumbs — the latter pair being the group's only opaque members. Every one of them exists twice, because a white overlay on a white ground is nothing — `design-tokens.test.mjs` asserts that with `translucent steps exist in both theme groups`.

| Token | Dark | Light | Purpose |
| --- | --- | --- | --- |
| `--overlay-soft` | `rgba(255, 255, 255, 0.03)` | `rgba(0, 0, 0, 0.03)` | Resting fill lift; 1.07:1 on `--c-surface` in either theme. |
| `--overlay-hover` | `rgba(255, 255, 255, 0.06)` | `rgba(0, 0, 0, 0.055)` | Hover lift; 1.16 dark / 1.13 light. |
| `--overlay-press` | `rgba(255, 255, 255, 0.09)` | `rgba(0, 0, 0, 0.08)` | Pressed lift; 1.27 dark / 1.19 light. |
| `--ac-line` | `rgba(90, 174, 255, 0.42)` | `rgba(31, 111, 235, 0.42)` | Accent border on a selected row. |
| `--ac-focus` | `rgba(90, 174, 255, 0.55)` | `rgba(31, 111, 235, 0.35)` | Focus ring second stop. |
| `--ok-bg` / `--ok-line` | `0.12` / `0.3` of `#4ec27f` | `0.1` / `0.28` of `#187747` | Healthy session chip. |
| `--warn-bg` / `--warn-line` | `0.12` / `0.32` of `#e0a83c` | `0.1` / `0.3` of `#8c6009` | Retry-state chip. |
| `--err-bg` / `--err-line` | `0.12` / `0.32` of `#f2555a` | `0.1` / `0.3` of `#b83237` | Failure chip and failure-page panel. |
| `--scrim` | `rgba(0, 0, 0, 0.62)` | `rgba(20, 24, 30, 0.38)` | Dialog backdrop. |
| `--scroll-thumb` | `#33383f` | `#c9ced5` | `::-webkit-scrollbar-thumb`. |
| `--scroll-thumb-strong` | `#444a53` | `#aab1ba` | Its `:hover` sibling. |

Two guards make the group honest rather than decorative. Every tint whose meaning is "this colour, translucent" must carry the RGB triplet of the opaque token it names, **in the same theme group**, measured rather than string-compared so a change of notation is not mistaken for a change of colour: `every translucent step carries the triplet of the colour it tints` covers the eight `--ac-line`, `--ac-focus` and `--{ok,warn,err}-{bg,line}` steps, while `--ac-bg` and the two terminal copies of the accent ride in the accent and terminal assertions instead. That is what stops `--ok-line` from keeping a copy of last week's green.

And because a chip's real ground is its own tint rather than a bare surface, `status colours clear AA on their own tint, not only on a bare surface` measures each status colour over both grounds a chip actually appears on:

| Pair | Dark | Light |
| --- | --- | --- |
| `--ok` on `--ok-bg` over `--c-surface` / `--c-canvas` | 6.67 / 7.42 | 4.84 / 4.57 |
| `--warn` on `--warn-bg` over `--c-surface` / `--c-canvas` | 6.95 / 7.74 | 4.84 / 4.56 |
| `--err` on `--err-bg` over `--c-surface` / `--c-canvas` | 4.74 / 5.21 | 5.09 / 4.78 |
| the same three on their `--*-line` over `--c-surface` | 4.47 / 4.39 / 3.47 | 3.71 / 3.60 / 3.66 |

The bottom row is not a failure and is not covered by that assertion, because the `--*-line` steps are borders: they are drawn beside a chip, not under its text. It is recorded here so that promoting one of them to a text ground is a decision rather than an accident — on a line-tinted background all six status pairs are sub-AA, the light ones at 3.60–3.71.

The first light draft had `--ok #1a7f4b`, `--warn #9a6a0a`, `--err #c2363b`, and all three cleared AA on a bare `--c-surface`. Measured on their own tints they fell to 4.39, 4.17 and 4.41 — a green that passes the test and fails the chip. Darkening the three, and re-deriving their `--*-bg` and `--*-line` triplets from the new values, is what the table above now records.

### Terminal group

Four tokens per group. The canvas is the end of each group's ramp in the direction that group runs: the dark group's deepest step, which is `--c-inset`'s own `#08090a`, and the light group's brightest, which is `--c-surface`'s `#ffffff`. A light session is therefore a surface beside the file table rather than a dark hole in a white shell. An earlier specification kept one dark group in both themes and called a light shell over a dark canvas intentional; that is reversed here, on the report that the terminal did not follow the theme at all — the old file still records the rejected direction, and this section is the current one.

| Token | Dark | Light |
| --- | --- | --- |
| `--term-bg` | `#08090a` | `#ffffff` |
| `--term-fg` | `#c9ced6` | `#24292f` |
| `--term-cursor` | `#5aaeff` | `#1f6feb` |
| `--term-selection` | `rgba(90, 174, 255, 0.24)` | `rgba(31, 111, 235, 0.18)` |

`--term-bg` is asserted per group: the dark value keeps a relative luminance below 0.02 (measured 0.0027) and the light one above 0.6 (measured 1.000), so neither canvas can drift into the other group's. `--term-fg` is held to 4.5:1 on its own canvas — 12.61:1 dark, 14.65:1 light. `--term-cursor` and `--term-selection` carry their **own** group's `--ac` triplet and are asserted to keep carrying it; both are read through `getComputedStyle`, so no `var()` ties them and the assertion is the only link. Because xterm resolves a theme once, a switch that only rewrote the stylesheet would leave every open terminal on the group it was built in; the palette section below covers how the change is pushed instead.

### Metrics

Theme-invariant: `:root` and `[data-theme="light"]` match the same element, so the light group inherits these and repeating them would recreate the hand-synced duplicate debt this system exists to remove. `design-tokens.test.mjs` asserts that every metric is declared in `:root` and absent from the light group.

| Group | Tokens |
| --- | --- |
| Radii | `--r-1: 3px`, `--r-2: 5px`, `--r-3: 8px`, `--r-4: 12px`, `--r-full: 999px` |
| Spacing | `--s-1: 4px`, `--s-2: 8px`, `--s-3: 12px`, `--s-4: 16px`, `--s-5: 24px`, `--s-6: 32px` |
| Row heights | `--row-h: 48px`, `--row-h-compact: 34px` |
| Z-index | `--z-drawer: 20`, `--z-popover: 30`, `--z-toast: 40`, `--z-dialog: 50` |
| Motion | `--t-1: 100ms`, `--t-2: 160ms`, `--t-3: 240ms`, `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)` |
| Chrome geometry | `--chrome-h: 40px`, `--rail-w: 52px`, `--status-h: 24px`, `--insp-w: 360px` |
| Focus ring | `--ring: 0 0 0 2px var(--c-canvas), 0 0 0 4px var(--ac)` |
| Pop shadow | `--shadow-pop: 0 8px 24px -6px rgba(0, 0, 0, 0.5)` dark, `0 8px 24px -6px rgba(16, 24, 40, 0.28)` light |

`--r-1`, `--r-2` and `--r-3` provide 3px controls, 5px rows and 8px cards/dialogs. `--r-4` remains declared but unused. The neutral surfaces and line steps separate these elements without adding card shadows. `--ease` is shared by control transitions and entrance motion.

`--chrome-h` defines the default 40px top bar and the first row of the `#app` grid. At 620px and below, both are explicitly 48px and the navigation rail becomes a separate 48px horizontal row. The remaining workspace stays in a definite `minmax(0, 1fr)` grid track, so terminal panes and overlay editors resolve their height against the available viewport. Desktop uses `titleBarStyle: 'hidden'` without `titleBarOverlay`; its caption controls remain owned by `window-controls.css`.

`--shadow-pop` is the single sanctioned exception to metric invariance: it is derived from theme colours, so it has to be recomputed per theme instead of inherited, and the test asserts both that it is the only light-group declaration outside the colour and terminal categories and that its light value differs from its dark value. It is also the only shadow left: the flip removed the elevation shadows on cards, rows and panels in favour of the line steps, so this one exists for the popover that leaves its container and needs to be separable from everything behind it.

`[data-density="compact"]` is independent of the theme and remaps `--row-h` to `--row-h-compact`: 48px comfortable rows and 34px compact rows. The default button floor is 28px. The host, keychain and file row main buttons retain `min-height: 0`, so they do not override the row size. Narrow library rows grow to at least 60px to show the name and connection string or fingerprint on separate lines; cards keep their own content-driven height. SFTP file rows use a separate 34px minimum.

### Type scale

| Token | Value | Role |
| --- | --- | --- |
| `--font-ui` | `Inter, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif` | Interface text and keyboard hints |
| `--font-mono` | `"JetBrains Mono", "Cascadia Mono", Consolas, monospace` | Addresses, fingerprints, technical values and diagnostics |
| `--font-term` | `"Cascadia Mono", Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", monospace` | Read by `terminal-view.ts` |
| `--fs-micro` | `11px` | Small metadata |
| `--fs-meta` | `12px` | Secondary interface text |
| `--fs-ui` | `13px` | Standard interface text |
| `--fs-em` | `14px` | Emphasized interface text |
| `--fs-h2` | `16px` | Section headings |
| `--fs-h1` | `20px` | Heading scale token; library titles use 28px above 620px and 24px below |
| `--fs-term` | `13.5px` | Unused; see [known gaps](#known-gaps) |

Font tokens define families; each component chooses its scale. `#keychain-fingerprint` uses `--font-mono`, including when a long fingerprint wraps.

Terminal colors reach xterm through `getComputedStyle`; `terminal-theme.test.mjs` checks their names and ties mirrored ANSI entries to the corresponding token. `--term-bg` also paints the surrounding terminal surface. `--ring` provides keyboard focus and `--shadow-pop` separates dialogs and toasts from the page.

### Library geometry and interaction

- **Hierarchy and spacing.** Hosts and Keychain share a 104px minimum header with 28px titles, 34px search/action controls, and responsive page gutters. Their docked editors use `--insp-w: 360px`. On narrow screens the title and count stack, the primary action and view switch stay aligned, and search moves to a full-width row.
- **Host table.** The header and rows share one grid template with a reserved 92px action column. Connect, Edit and Delete are separate named buttons; they never cover the updated date. A single click selects, Connect or a double click opens a terminal, and `aria-pressed` reports selection. Truncated names and endpoints retain their full text in tooltips.
- **Space beside editors.** Each library has its own inline-size query container. At 900px of panel width Hosts hides user and authentication columns, while Keychain hides usage and update columns. At 660px each keeps the name, a second line for the connection string or fingerprint, and the actions. These decisions use the panel's available width, including space taken by a docked editor. Both card views use an auto-fill grid with a 250px target minimum that can shrink to the container. At viewport widths of 900px and below, editors fill the workspace as overlays and hide the underlying library controls from keyboard focus until closed.
- **Empty and filtered states.** An empty Hosts library pairs a short explanation and New Host action with an inline SVG diagram of a terminal connected to servers. It uses the existing theme tokens and local markup. At narrower panel widths the diagram moves above the copy. A search with no results hides the diagram and offers Clear search, which clears the filter and returns focus to search.
- **Narrow shell.** At 620px and below, a 48px top bar and 48px horizontal navigation row leave the rest of the viewport to the workspace. Theme, density and language controls stay reachable. The brand name remains visible when no session tabs need that space. Editors scroll within the workspace; the body does not become a content-sized flex column. The status bar prioritizes connection identity and state, truncates long endpoints, and progressively hides secondary fields. Library pages hide unused handshake values.
- **Files.** The SFTP table names its Name, Size, Mode and Modified columns in the active language, and its path input has an accessible name. A separate 104px action column prevents download/delete controls from covering metadata. File rows are at least 34px high. At 420px of panel width and below, the table retains the name and actions while hiding the three metadata columns.
- **Motion.** Hover, focus, selection and button states use the shared easing and 160ms control transition. Editors enter over 240ms with a 10px horizontal offset; the shortcuts dialog uses 160ms and an 8px vertical offset. The empty-state SVG enters once over 600ms. `prefers-reduced-motion: reduce` disables smooth scrolling and clamps transitions and animations to 0.01ms with one iteration; toasts and skeletons also have explicit animation overrides.

### Legality is per ground and per theme

Contrast is a property of a pair, not of a token. The full measured matrix — every foreground the system offers as text against every ground it offers as a surface, both themes. This is the table `tokens.css` points at from its own header comment, so it is the reference a reader consults when a pair is not already drawn in the partials.

Dark group:

| Foreground | `--c-inset` | `--c-canvas` | `--c-chrome` | `--c-surface` | `--c-raised` | `--c-control` |
| --- | --- | --- | --- | --- | --- | --- |
| `--tx-1` | 17.95 | 17.73 | 17.16 | 16.46 | 15.38 | 13.86 |
| `--tx-2` | 10.67 | 10.54 | 10.20 | 9.79 | 9.15 | 8.24 |
| `--tx-3` | 5.22 | 5.16 | 4.99 | 4.79 | 4.48 | **4.03** |
| `--tx-4` | 2.92 | 2.88 | 2.79 | 2.67 | 2.50 | 2.25 |
| `--ac` | 8.48 | 8.38 | 8.10 | 7.77 | 7.27 | 6.55 |
| `--ac-hi` | 10.29 | 10.16 | 9.84 | 9.44 | 8.82 | 7.95 |

Light group:

| Foreground | `--c-inset` | `--c-canvas` | `--c-chrome` | `--c-surface` | `--c-raised` | `--c-control` |
| --- | --- | --- | --- | --- | --- | --- |
| `--tx-1` | 15.29 | 16.72 | 15.56 | 17.77 | 16.41 | 14.86 |
| `--tx-2` | 7.57 | 8.27 | 7.70 | 8.80 | 8.12 | 7.36 |
| `--tx-3` | **4.16** | **4.55** | **4.23** | 4.83 | **4.46** | **4.04** |
| `--tx-4` | 2.24 | 2.45 | 2.28 | 2.61 | 2.41 | 2.18 |
| `--ac` | **3.99** | **4.36** | **4.06** | 4.63 | **4.28** | **3.88** |
| `--ac-hi` | 5.07 | 5.54 | 5.16 | 5.89 | 5.44 | 4.93 |

Bold marks a cell under the 4.5:1 normal-text floor. The rule those cells force: **in the light theme, muted text and accent text belong on `--c-surface` alone.** `--tx-3` and `--ac` clear 4.5:1 there (4.83 and 4.63) and fail on every other light ground — and `--ac` fails on `--c-canvas` too, at 4.36, which is the one that surprises people, because canvas is the *lighter* of the two and the accent's own luminance sits between them. `--ac-hi` is the escape hatch and the reason the hover step is darker in the light group than its base: it clears 4.93 at the light group's worst ground.

The dark group is far more permissive but not unconditional. `--ac` and `--ac-hi` clear every dark ground, `--tx-1` and `--tx-2` clear every one by a mile, but `--tx-3` drops under AA on `--c-raised` (4.48) and `--c-control` (4.03) — the two grounds the flip paints on hover and on controls. A muted label that is legal on a card row is therefore not automatically legal on the hovered version of the same row, and that is a per-rule decision the tests cannot make.

`design-tokens.test.mjs` asserts the `--c-surface` column plus `--tx-1` and `--idle` on `--c-chrome` and `--ac-fg` on `--ac`. It does not assert every cell of these two tables, so a change to a ground used only for chrome or for a hovered state must be checked against them by hand.

The hairlines are deliberately excluded from that discipline: they are not text, and holding a divider to 4.5:1 would turn every panel in the app into a grid of rules. What they are held to instead is a floor, because a border that computes to nothing is absent rather than quiet. Bold marks a pair below the 1.1:1 floor the guard enforces:

| Token | dark: inset / canvas / chrome / surface / raised / control | light: inset / canvas / chrome / surface / raised / control |
| --- | --- | --- |
| `--line-soft` | 1.21 / 1.19 / 1.15 / 1.11 / **1.03** / **1.07** | **1.00** / 1.09 / **1.02** / 1.16 / **1.07** / **1.03** |
| `--line` | 1.38 / 1.37 / 1.32 / 1.27 / 1.19 / **1.07** | 1.11 / 1.21 / 1.13 / 1.29 / 1.19 / **1.08** |
| `--line-strong` | 1.91 / 1.88 / 1.82 / 1.75 / 1.63 / 1.47 | 1.39 / 1.52 / 1.42 / 1.62 / 1.49 / 1.35 |

The near-1.27 figure on `--c-surface` is the design target, and the ramp carries depth at 1.04–1.19 between adjacent steps, so a hairline at 1.2–1.4 is the same order of quiet. What is *not* design is a separator on a ground one step away from it: `--line-soft` on `--c-raised` measures 1.034, and in the light theme the same token on `--c-inset` is exactly 1.000 — the same RGB value as the ground, which is a border declaration that draws nothing. The light group's `--line-soft` is `#eceef1`, identical to its `--c-inset`, and that collision is what the first draft of the divider audit found.

`stylesheet-contract.test.mjs` therefore asserts `every hairline stays perceptible against the ground it is drawn on`. It reads the pairs the stylesheet actually paints — a rule that sets a `--line*` border and a `--c-*` background in the same block — rather than the whole matrix above, which would certify 36 combinations nobody draws while the one real case vanished. It collects 36 rules, measures each in both themes, and fails below 1.1:1. Fixing the flip's own output with that guard raised four separators from `--line-soft` to `--line` (the keychain shell edge, two rules in `terminal.css`, the host-card divider) and pushed `.tag` and `.action-split` from `--line` to `--line-strong` on their `--c-control` fill, where 1.07 is not a border. Making a hairline pass a text contrast test would be the opposite mistake, and the two together are the whole discipline: not AA, but not nothing.

## Theme mechanism

- `:root` declares `color-scheme: dark`, `[data-theme="light"]` declares `color-scheme: light`. `color-scheme` is what tells the user agent which form-control and scrollbar palette to paint, so the property is part of the theme and not decoration.
- Resolution order: both selectors match the same element (`<html>`), at equal specificity, and the light block is later in the file, so it wins for exactly the colour and terminal groups it redeclares plus `--shadow-pop`. Metrics, fonts, and the type scale inherit from `:root`. The light group therefore redeclares colours only, and a token added to the light group alone fails `no token is declared only in the light theme`.
- The terminal follows the theme: the light group declares its own canvas, foreground, cursor and selection, and `terminal-view.ts` re-reads all four — plus the palette of its group — when the switch is used.
- **The switches exist.** `#theme-toggle`, `#density-toggle` and `#locale-toggle` in the top bar are written by `packages/ui/src/services/chrome.ts`. The first two set `data-theme` and `data-density` on `<html>`; the third calls `setLocale()` in `@pureterm/i18n`, writes `<html lang>` (`en` or `zh-CN`) and `data-locale`, and announces the change on the client so every surface that composes text re-renders instead of leaving the previous language on screen. All three are remembered under the single `pureterm.chrome` key in `localStorage` — the first use of web storage in this package — and the default is English, the catalog's source language. A first run carries no `data-theme` at all and so resolves to the `:root` group. Because `script-src 'self'` forbids the inline pre-paint script that would normally apply a stored theme before first byte, a stored light theme lands one frame after `app.js` runs: the top bar paints dark, then flips. That flash is the price of the CSP, and it is accepted rather than worked around; a stored language pays it too, because `index.html` ships English and its static text carries `data-i18n` attributes that only the client can replace.
- The light group is under test on every assertion in `design-tokens.test.mjs`, which measures both blocks, so its values cannot drift whether or not anyone has selected it.
- `[data-density="compact"]` is independent of the theme and remaps `--row-h` only.

## Terminal palette

`packages/ui/src/terminal-view.ts` builds the xterm theme from six `read()` calls over five tokens:

```ts
const probe = document.documentElement
const read = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim()
```

`themeOf()` holds `background`, `foreground`, `cursor`, `cursorAccent` and `selectionBackground`, each one a `read()` and nothing else; `terminal-theme.test.mjs` scans that object for hex literals and fails on any. `cursorAccent: read('--term-bg')` survives because xterm uses it to invert the glyph under the cursor, and the cell under a block cursor is the canvas. `fontFamily: read('--font-term')` replaced a fifth hand-copy of the stack, so the CJK fallbacks now live in one place. The four canvas tokens need no choosing: `getComputedStyle` answers for the group that is on. Only the palette has to be picked, and `probe.dataset.theme` is what picks it — the same attribute the switch writes.

`read()` takes no fallback on purpose. `app.ts:2` imports `style.css`, which `index.html:18` delivers as the built `app.css`, so the custom properties are resolved long before any terminal is constructed; a fallback string would only add an untested path that hides a renamed token, and would push a colour literal back into a file the guard reads. The tie that keeps the names honest is `terminal-theme.test.mjs`, which asserts each of the four `--term-*` names appears in the source.

xterm resolves a theme once, at construction, so a terminal built before the theme was applied — and every terminal open when it changes — would keep the group it was born in. `TerminalView` therefore carries `applyTheme()`, which re-runs `themeOf()` and assigns it to `terminal.options.theme`; that one option is what xterm's `ThemeService` subscribes to (`onSpecificOptionChange('theme')`), so the assignment repaints the canvas, the palette and the cursor in place. `ClientChrome` broadcasts `client/theme-change` after it writes `data-theme` — once at start-up and on every theme click, never on a density click, which moves no terminal token — and `ClientTerminal` re-applies it to the idle pane and to every open tab. The idle pane is the reason the start-up broadcast exists: it is built before `ClientChrome` runs, so a remembered light theme reaches it only through that event.

The sixteen ANSI entries of each group, in array order, with each entry's measured ratio on **its own** group's `--term-bg`:

| # | Dark value | Ratio | # | Dark value | Ratio |
| --- | --- | --- | --- | --- | --- |
| 0 black | `#101317` | 1.07 | 8 brightBlack | `#5f656e` | 3.39 |
| 1 red | `#f2555a` | 5.90 | 9 brightRed | `#ff7b81` | 7.97 |
| 2 green | `#4ec27f` | 8.87 | 10 brightGreen | `#7ddba8` | 11.93 |
| 3 yellow | `#e0a83c` | 9.33 | 11 brightYellow | `#f2c86f` | 12.59 |
| 4 blue | `#5aaeff` | 8.48 | 12 brightBlue | `#7cc0ff` | 10.29 |
| 5 magenta | `#c58aff` | 8.02 | 13 brightMagenta | `#d9a8ff` | 10.43 |
| 6 cyan | `#57c8d0` | 10.04 | 14 brightCyan | `#7fe0e8` | 13.03 |
| 7 white | `#b9bec6` | 10.67 | 15 brightWhite | `#f2f3f5` | 17.95 |

| # | Light value | Ratio | # | Light value | Ratio |
| --- | --- | --- | --- | --- | --- |
| 0 black | `#24292f` | 14.65 | 8 brightBlack | `#6b7280` | 4.83 |
| 1 red | `#b83237` | 5.92 | 9 brightRed | `#d1242f` | 5.24 |
| 2 green | `#187747` | 5.57 | 10 brightGreen | `#1a7f37` | 5.08 |
| 3 yellow | `#8c6009` | 5.54 | 11 brightYellow | `#9a6700` | 4.87 |
| 4 blue | `#1f6feb` | 4.63 | 12 brightBlue | `#218bff` | 3.39 |
| 5 magenta | `#8250df` | 5.05 | 13 brightMagenta | `#a475f9` | 3.24 |
| 6 cyan | `#0f6f77` | 5.90 | 14 brightCyan | `#1b7c83` | 4.93 |
| 7 white | `#454b54` | 8.80 | 15 brightWhite | `#16181c` | 17.77 |

The light palette is its own set rather than the dark one at another alpha, because the constraint inverts: on a white canvas every entry has to stay dark enough to read, so "bright" there means more saturated, not lighter — `brightRed` `#d1242f` sits beside `red` `#b83237`, and `brightCyan` `#1b7c83` beside `cyan` `#0f6f77`. Every entry from 1 to 15 clears 3:1 on its canvas in both groups, and `terminal-theme.test.mjs` holds them there; `brightMagenta` `#a475f9` at 3.24 and `brightBlue` `#218bff` at 3.39 are the two light entries closest to the floor.

xterm's `ITheme` names those sixteen individually — `black`, `red`, … `brightWhite` — and its `ThemeService` folds the named keys into its own 0–15 array, so a list is handed over by position: 0–7 normal, 8–15 bright, in black/red/green/yellow/blue/magenta/cyan/white order. A literal `color` name for the neutral set would be misleading, so each list is kept as the readable array and `palette(entries)` is only the fold.

Seven of the dark sixteen are the dark group's own colours a second time over: entry 1 is `--err`, 2 `--ok`, 3 `--warn`, 4 `--ac`, 7 `--tx-2`, 12 `--ac-hi` and 15 `--tx-1`, each byte-identical to the token it mirrors. The light list mirrors six of its own group — the same entries minus 12, because `--ac-hi` is the *darker* hover step there while `brightBlue` has to stay the lighter blue, so that one entry is a value of its own. Like `--term-cursor`, none of the ties is reached through a `var()`, so `terminal-theme.test.mjs` reads both arrays out of `terminal-view.ts` — rather than re-typing the literals into a test, which could pass while the array it names drifted — and asserts those triplets still equal the tokens they mirror. The rationale is the one `design-tokens.test.mjs` already gives for the cursor: without the tie, a palette flip leaves the copy behind in silence. Retuning `--ok`, `--err`, `--warn`, `--ac`, `--ac-hi`, `--tx-1` or `--tx-2` therefore means editing the matching list in the same commit, and the suite refuses to let that be forgotten. The ties compare triplets rather than strings, so a change of notation is not mistaken for a change of colour.

Entry 0 is deliberately **not** `--term-bg`, and the two groups arrive at that from opposite directions. In the dark group both values were `#08090a` in an earlier draft, which made black-on-terminal text exactly 1.00:1 by construction: `printf '\e[30mhidden\e[0m'` would have been invisible rather than dark. `#101317` lifts it to 1.07:1, still nearly invisible as a legible colour and correctly so — it is the shadow step of that canvas. On the light canvas the shadow step would be the invisible choice, so entry 0 is a legible near-black instead (`#24292f`, 14.65:1) — the same value the group's `--term-fg` carries. Entry 8, bright black, is the one the constraint really binds in both groups: prompts use it for *dimmed* rather than hidden text, and the first dark draft's `#565b63` measured 2.92:1, under the 3:1 floor. `#5f656e` clears 3.39:1 dark, and `#6b7280` clears 4.83:1 light.

`@xterm/xterm` 6.0.0 exposes no `ANSI` key on `ITheme`; the only array is `extendedAnsi`, which covers entries 16–255. Writing `ANSI,` into the theme object fails to compile with `TS2353: Object literal may only specify known properties, and 'ANSI' does not exist in type 'ITheme'`. That failure is the good outcome: a type cast would have compiled, xterm would have ignored the unknown key, and the shipped terminal would have rendered xterm's own `DEFAULT_ANSI_COLORS` — the Tango set, black `#2e3436`, red `#cc0000` — with no error anywhere to say so. The positional fold above is what makes the neutral set actually reach the screen.

## Typography

`Inter` is declared locally in `packages/ui/src/styles/fonts.css` rather than imported from its package, for two independent reasons.

`@fontsource-variable/inter` 5.3.0 is a variable package: it has no per-weight file at all, because one file per subset serves the whole 100–900 axis. Subsetting is therefore the only thing to choose, and every CSS file the package ships — `index.css`, `standard.css`, `wght.css`, `opsz.css` and the italic variants — declares all seven subsets at once. `stylesheet-contract.test.mjs` asserts the manifest never names `@fontsource`, because importing one of those entry points would put Greek, Cyrillic and Vietnamese into every installer for a page that renders none of them: the seven variable woff2 files total 218,512 bytes (213 KiB), and the five subsets the page cannot reach account for 85,188 bytes (83 KiB) of that. Only the two latin files ship.

The second reason is a name. The package names its family `Inter Variable`, and `--font-ui` asks for `Inter`. A face that does not answer to the name the token asks for would ship the bytes and still render Segoe UI, silently, because a font stack that finds nothing simply falls through. So the faces are declared here under the exact name, with the package's own descriptors and unicode-ranges, and the test reads the asked-for family out of `--font-ui` and requires every face to carry it — plus `font-weight: 100 900`, `font-style: normal`, and a `unicode-range` on each. `format('woff2')` is used rather than the legacy `woff2-variations` spelling, which a user agent may skip; the weight-range descriptor in the same block is what unlocks the axis.

Allowed weights are 400, 500, 600 and 700, plus the `normal`/`bold` keywords. The stylesheet contract enforces that set; individual declaration counts change with the components. Library titles and host monograms use 600, while host labels use 500. Inter can render intermediate weights, but the CJK and system fallbacks may have to synthesize them, so the interface keeps the shared scale.

`.ti` is pinned to `font-weight: 400` in `base.css` rather than left to inherit. Tabler owns one weight, the chrome asks for 600–700 around it, and the external import that defines `.ti` is first in the cascade, so any later partial could undo the vendor's own pin. The test asserts the pin and its `font-style: normal` and `-webkit-font-smoothing: antialiased` siblings, because synthetic oblique on an icon is a distorted glyph, not a style.

`--font-term` keeps `"Sarasa Mono SC"` and `"Microsoft YaHei Mono"` between the Latin mono faces and the generic. A terminal has to be able to draw box-drawing and wide glyphs at all, and Cascadia Mono and Consolas do not cover them; dropping those two fallbacks would put Chinese output on the UA default and break alignment. It is the same list `terminal-view.ts` used to hard-code, so the switch to `read('--font-term')` is value-preserving.

What the build emits, from `scripts/build-ui.mjs` with `assetNames: 'fonts/[name]-[hash]'`:

| File | Bytes |
| --- | --- |
| `packages/ui/dist/fonts/inter-latin-wght-normal-NRMW37G5.woff2` | 48,256 |
| `packages/ui/dist/fonts/inter-latin-ext-wght-normal-HA22NDSG.woff2` | 85,068 |

133,324 bytes of faces for both entry points, and no remote font request: the page's Content-Security-Policy keeps `font-src 'self'`.

The OFL notice has to be a `/*!` block, not a `/*` comment and not a path to the package licence. esbuild keeps legal comments — those opening `/*!` — when it flattens the cascade into one file, so the attribution reaches `packages/ui/dist/app.css` beside Tabler's own header, and `scripts/stage-desktop.mjs` deliberately skips `@pureterm/ui`'s dependencies when staging, on the grounds that the browser bundle already embeds what the page needs. The installer therefore ships the faces without shipping `node_modules/@fontsource-variable/inter/LICENSE`, which is the file the notice points at. Only the comment travels.

## How the register went away

`packages/ui/src/styles/legacy.css` no longer exists. It held the pre-redesign palette — dark blue-purple surfaces, a `#a7c4ff` accent, translucent `rgba(222, 226, 255, .0xx)` hairlines — as 100 role-named custom properties that the partials read, and the redesign kept it alive on purpose as a **guarded deletion list** rather than allowing those values to spread back through the cascade. Its two guards are gone with it, and what replaced them is worth recording because it is the reason the file could be deleted in one commit instead of one entry at a time:

- The **count ratchet** (`LEGACY_DECLARATIONS = 100`, asserted as an exact equality against the declarations and the semicolons in the file) meant a file exempt from the colour rule could not grow. It stepped down 100 → 96 → 1 as the flip consumed entries, and the constant was deleted with the file. The durable form of that idea is the liveness guard's replacement below rather than a number, since there is nothing left to count.
- The **reference-liveness allowlist** required every register entry to have a call site or to be named in `UNREFERENCED_LEGACY`, in both directions. It had one blind spot that cost real work: it filtered on `name.startsWith('--legacy-')`, so the sixteen aliases in the file that never carried the prefix — `--topbar`, `--nav`, `--card`, `--text-strong`, `--accent` and the rest — could orphan in silence. The filter was removed before the deletion, which is what surfaced those sixteen.
- The four entries that were never colour (`--radius-sm/-md/-lg`, `--motion-standard`, 22 call sites) were re-homed **first**, in their own commit, because otherwise deleting the file takes the geometry and the easing curve down with the palette. That ordering is the general lesson: a debt register may hold anything, and only the colour test can tell you what. A fifth entry, `--legacy-on-solid`, was deliberately **not** re-homed, and it is the more interesting case. It is `#ffffff` at three call sites — a host avatar, a connection-type tag, a keychain avatar — and every one of those fills the mapping table sent to `--c-control`, which is `#21252b` in dark and `#e8ebef` in light. So the legend wants white in one theme and near-black in the other, which is exactly what `--tx-1` already is in both groups: it mapped to `var(--tx-1)` and no token was added. A new name for a decision an existing token already makes is precisely how a register grows to 96 entries.

Three facts the flip settled, each of which had been an open question in this section:

- `legacy.css` had no light group, so all 100 entries stayed dark in light mode for as long as it existed. That is now structurally impossible: `design-tokens.test.mjs`'s `every theme group declares every colour token` requires the light block to redeclare all 35 colours and all four terminal tokens, and `no token is declared only in the light theme` refuses the mirror case.
- `visual-contract.test.mjs` used to assert that the concatenated cascade still declared `--topbar`, `--nav`, `--card`, `--text-strong` and `--accent` — five names that lived only in the register, so deleting the file failed a test about nothing. The assertions moved to the new ramp; the retired-alias loop then went too, as duplicative of the manifest-derived partial list.
- The parallel-name trap is closed but worth restating, because the same shape recurs with every future alias. The register's seven live hairline steps ran `.05` to `.17` alpha; the new ramp has three opaque steps. So `--line-strong` and `--legacy-line-strong` were two names for two different values, one live and one pending, and a blind `s/--legacy-//` would have landed a live 0.17 alpha where an opaque step belongs. Pair tokens by measured value, never by name.

The connection drawer's divider — `.ssh-section` while it held the port field, `.general-section` now that the port sits beside the address — is the divider that example exists for: `1px solid var(--legacy-line-faint)`, an `rgba(222, 226, 255, 0.05)` over the drawer ground, measured 1.14:1 — a divider in name only. It is now `var(--line)` (`inspector.css:47`) and the hairline floor keeps it there.

## Known gaps

- `--fs-term: 13.5px` has no consumer. `terminal-view.ts` passes `fontSize: 14` to the `Terminal` constructor, and the comment there records why: 13.5px would change xterm's measured cell metrics without a re-measure. The token is a statement of intent, not a value in force.
- Named colours are invisible to the literal rule. The pattern is `/#[0-9a-fA-F]{3,8}\b|\brgba?\(/`, which matches hex and functional `rgb()`/`rgba()` only, so `color: white` or `color: tomato` passes the guard today. This is a latent hole rather than a live defect: after the flip the word `white` still occurs 13 times across the content partials and every occurrence is inside a `white-space` property, the 46 `transparent` uses are deliberate border and fills, and a scan of value positions for the standard CSS colour words returns zero hits. Closing it needs a value-position-aware rule, not a wider word list, because `\bwhite\b` as a pattern also matches `white-space` and would report 13 clean lines as offenders.
- The generated `packages/ui/src/lib/changelog.ts` has no importer. Nothing under `packages/`, `apps/` or `scripts/` imports it, and no changelog string appears anywhere in the built `packages/ui/dist/app.js`. Its sibling `lib/version.ts` does now: `services/chrome.ts` renders it into the status bar, and `client-lifecycle.browser.ts` asserts that rendering rather than a copied version string. `npm run release:check` parses both and compares them against `CHANGELOG.md` and `VERSION.txt`, so neither can go stale silently, but the changelog half is release metadata at build time rather than page content today.
- `--font-mono` leads with `"JetBrains Mono"`, which is not bundled; only `@fontsource-variable/inter` is installed. Shell monospace therefore resolves to Cascadia Mono or Consolas depending on the machine. That is ordinary font-stack behaviour, not a defect, but it means `--font-mono` and `--font-term` differ today only by the terminal's CJK fallbacks and JetBrains Mono's absence.

# Design Tokens and Stylesheet Layout

[中文版本](design-system_zh.md)

This document is the authority for where the shared UI's visual values live and what may name them: the token file, the stylesheet layout that delivers it to the page, the theme mechanism, the terminal palette, the typography, and the legacy register that still predates the system. It describes the tree as it stands, not the plan that produced it, and every number in it was measured from the files named alongside.

Paths are relative to the repository root. See the [architecture](architecture.md) for process boundaries, the [development guide](DEVELOPMENT.md) for commands, and `AGENTS.md` for the repository rules this layout follows.

## The one rule

A colour literal may appear in exactly two files. `packages/ui/src/styles/tokens.css` is the system: the neutral ramp, the text ramp, the accent and status set, the terminal group, and the theme-invariant metrics. `packages/ui/src/styles/legacy.css` is the sole sanctioned exception — the pre-redesign palette, held as a guarded deletion list rather than allowed to spread back through the partials. Everything else resolves colour through a token.

`packages/ui/src/styles/fonts.css` is the only file that may name a typeface as a literal, because that is what an `@font-face` does: it declares a face rather than asking a token for one. The three stacks the page asks for — `--font-ui`, `--font-mono`, `--font-term` — are declared in `tokens.css`.

`packages/ui/tests/stylesheet-contract.test.mjs` enforces all of it, and the exemption list is itself asserted rather than declared:

- `SANCTIONED = ['legacy', 'tokens']` is compared against the live `EXEMPT` set, so exempting a third partial needs an explicit edit to a test constant.
- every member of `EXEMPT` must still be a partial the manifest imports, so a stale exemption fails.
- `totalImports(manifest)` must equal the number of parsed partial names plus one (the external Tabler line), which closes the `url(...)` import form that yields no name and would therefore ship a partial into the cascade without ever being scanned.
- the colour test counts the partials it scanned and asserts the total equals `names.length - EXEMPT.size`, so a skipped file is a failure rather than a pass.

The pattern is `/#[0-9a-fA-F]{3,8}\b|\brgba?\(/`, applied to each partial with comments blanked. Comments are blanked rather than deleted so an offender keeps the line number a reader sees in the file. The same file also pins the type rules: only `fonts.css` may declare a face, every `font-family` and `font` shorthand must resolve through `var(--font-ui)`, `var(--font-mono)` or `var(--font-term)` (or a CSS-wide keyword), and every `font-weight` must be one of the four weights this app ships. The `@font-face` carve-out those censuses rely on is only honest because a separate test asserts exactly one file may hold faces.

## Stylesheet layout

`packages/ui/src/style.css` is an `@import` manifest and nothing else: eleven lines, the first importing `@tabler/icons-webfont/dist/tabler-icons.min.css` and the next ten importing the local partials in cascade order.

| # | Partial | Bytes | Responsibility |
| --- | --- | --- | --- |
| 1 | `styles/fonts.css` | 2,236 | Bundled faces. The only file naming a family instead of asking a token for one. |
| 2 | `styles/tokens.css` | 3,530 | The token system and the theme groups. |
| 3 | `styles/legacy.css` | 5,569 | The pre-redesign palette as a debt register. |
| 4 | `styles/base.css` | 3,076 | Element defaults: reset, inherited type, buttons and inputs, focus rings, reduced motion. |
| 5 | `styles/chrome.css` | 8,944 | Application shell: the `#app` grid, top bar, workspace and session tabs, navigation rail, and the state classes on `.app-shell`. |
| 6 | `styles/hosts.css` | 8,384 | Hosts dashboard: page header, search row, toolbar, and the card and list shapes. |
| 7 | `styles/inspector.css` | 7,447 | Connection form: drawer shell, header, sections, fields, footer, and the shared controls the keychain editor reuses. |
| 8 | `styles/keychain.css` | 6,381 | Keychain library and editor over the shared host-card language. |
| 9 | `styles/terminal.css` | 5,294 | Terminal surface: the xterm pane and its overrides, the session toolbar, the SFTP drawer. |
| 10 | `styles/states.css` | 3,639 | Nothing-to-show and something-went-wrong: empty placeholder, shortcuts dialog, connection-failure page. |

The manifest owns cascade order because partials compete at equal specificity and the later import wins. That is why no partial may `@import`: a nested import would decide order in ten places instead of one, and `visual-contract.test.mjs` asserts `!/@import/` against every partial's own text. The order itself is pinned by the same test, which asserts the exact name list `['fonts', 'tokens', 'legacy', 'base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states']` — and derives it from the manifest through `packages/ui/tests/partial-list.mjs` rather than a second copy of the file, so adding, renaming or reusing a partial fails until the assertion is edited with intent.

`style.css` reaches the page through two doors: `packages/ui/src/index.html:17` links `./app.css`, the built sheet, and `packages/ui/src/app.ts:2` imports `./style.css` so that esbuild flattens every `@import` — the ten partials plus the external Tabler and xterm sheets — into that single `packages/ui/dist/app.css` both entry points serve.

## Tokens

All values below are read from `packages/ui/src/styles/tokens.css`. The dark column is the `:root` group, the light column the `[data-theme="light"]` group.

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

Three line steps, faintest to strongest:

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

### Accent and status

| Token | Dark | Light | Notes |
| --- | --- | --- | --- |
| `--ac` | `#5aaeff` | `#1f6feb` | One accent, no gradient. |
| `--ac-hi` | `#7cc0ff` | `#1a5fcd` | Hover/strong step; lighter than `--ac` in the dark group and darker in the light group, so the hover state always gains contrast. |
| `--ac-bg` | `rgba(90, 174, 255, 0.12)` | `rgba(31, 111, 235, 0.1)` | Tinted fill. Its RGB triplet must equal the same group's `--ac`; only the alpha is free. |
| `--ac-fg` | `#05070a` | `#ffffff` | Legend on an accent fill: 8.58:1 dark, 4.63:1 light. |
| `--ok` | `#4ec27f` | `#1a7f4b` | 8.14:1 / 5.02:1 on `--c-surface`. |
| `--warn` | `#e0a83c` | `#9a6a0a` | 8.56:1 / 4.73:1 on `--c-surface`. |
| `--err` | `#f2555a` | `#c2363b` | 5.42:1 / 5.41:1 on `--c-surface`. |
| `--idle` | `#8b919b` | `#7e8590` | Status dot that must not read as off: 3:1 minimum on both `--c-surface` and `--c-chrome`, asserted per theme (5.76/6.01 dark, 3.72/3.26 light). |

Status colours render as 11–12px labels, so the test holds them to the 4.5:1 normal-text floor rather than the 3:1 large-graphic floor.

### Terminal group

Four tokens, byte-identical in both theme groups and asserted as such: a light shell over a dark canvas is the point.

| Token | Value (both themes) |
| --- | --- |
| `--term-bg` | `#08090a` |
| `--term-fg` | `#c9ced6` |
| `--term-cursor` | `#5aaeff` |
| `--term-selection` | `rgba(90, 174, 255, 0.24)` |

`--term-bg` is asserted to keep a relative luminance below 0.02 (measured 0.0027), so no future edit can brighten the canvas into a light terminal by accident. `--term-cursor` and `--term-selection` carry the **dark** group's `--ac` triplet and are asserted to keep carrying it; both are read once through `getComputedStyle`, so no `var()` ties them and the assertion is the only link.

### Metrics

Theme-invariant: `:root` and `[data-theme="light"]` match the same element, so the light group inherits these and repeating them would recreate the hand-synced duplicate debt this system exists to remove. `design-tokens.test.mjs` asserts that every metric is declared in `:root` and absent from the light group.

| Group | Tokens |
| --- | --- |
| Radii | `--r-1: 3px`, `--r-2: 5px`, `--r-3: 8px`, `--r-full: 999px` |
| Spacing | `--s-1: 4px`, `--s-2: 8px`, `--s-3: 12px`, `--s-4: 16px`, `--s-5: 24px`, `--s-6: 32px` |
| Row heights | `--row-h: 38px`, `--row-h-compact: 30px` |
| Z-index | `--z-drawer: 20`, `--z-popover: 30`, `--z-toast: 40`, `--z-dialog: 50` |
| Motion | `--t-1: 100ms`, `--t-2: 160ms`, `--t-3: 240ms`, `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)` |
| Focus ring | `--ring: 0 0 0 2px var(--c-canvas), 0 0 0 4px var(--ac)` |
| Pop shadow | `--shadow-pop: 0 8px 24px -6px rgba(0, 0, 0, 0.5)` dark, `0 8px 24px -6px rgba(16, 24, 40, 0.28)` light |

`--shadow-pop` is the single sanctioned exception to metric invariance: it is derived from theme colours, so it has to be recomputed per theme instead of inherited, and the test asserts both that it is the only light-group declaration outside the colour and terminal categories and that its light value differs from its dark value.

`[data-density="compact"]` is an orthogonal dimension to the theme and remaps one token: `--row-h: var(--row-h-compact)`.

### Type scale

| Token | Value | Consumers today |
| --- | --- | --- |
| `--font-ui` | `Inter, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif` | 1 `var()`: `body` in `base.css` |
| `--font-mono` | `"JetBrains Mono", "Cascadia Mono", Consolas, monospace` | 7 `var()` across `base`, `hosts`, `inspector`, `terminal`, `states` |
| `--font-term` | `"Cascadia Mono", Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", monospace` | 1 `read()` in `terminal-view.ts` |
| `--fs-micro` | `11px` | 11 `var()` |
| `--fs-meta` | `12px` | 18 `var()` |
| `--fs-ui` | `13px` | 7 `var()` |
| `--fs-em` | `14px` | 6 `var()` |
| `--fs-h2` | `16px` | 4 `var()` |
| `--fs-h1` | `20px` | 1 `var()` |
| `--fs-term` | `13.5px` | none — see [known gaps](#known-gaps) |

Every other token in the file — the 21 theme colours including the three line steps, the 20 metrics, `--ring` and `--shadow-pop` — has no `var()` consumer in any partial yet. That is the state of the foundation, not an oversight in this table: the partials still read the legacy register, and the palette flip that rewires them is the next plan.

### Legality is per ground and per theme

Contrast is a property of a pair, not of a token. The measured ratios:

| Foreground | Dark on `--c-surface` | Light on `--c-surface` | Light on `--c-control` | Light on `--c-chrome` |
| --- | --- | --- | --- | --- |
| `--tx-1` | 16.46 | 17.77 | 14.86 | 15.56 |
| `--tx-2` | 9.79 | 8.80 | 7.36 | 7.70 |
| `--tx-3` | 4.79 | 4.83 | **4.04** | **4.23** |
| `--ac` | 7.77 | 4.63 | **3.88** | **4.06** |

The rule the numbers force: **in the light theme, muted text and accent text belong on `--c-surface` alone.** `--tx-3` and `--ac` clear 4.5:1 there (4.83 and 4.63), and fall to 3.88–4.23 on `--c-control` and `--c-chrome`. The dark group is far more permissive but not unconditional: `--ac` clears every dark ground (6.55:1 at its worst, on `--c-control`), while `--tx-3` itself drops to 4.48 on `--c-raised` and 4.03 on `--c-control`. Note that `tokens.css`'s own header comment states the dark case as "clears AA on every ground", which holds for `--ac` and for `--tx-1`/`--tx-2` but not for `--tx-3` on the two lightest dark steps; the matrix above is the measured truth and the comment is the one place this document disagrees with the source.

`design-tokens.test.mjs` asserts the `--c-surface` pairs plus `--tx-1` and `--idle` on `--c-chrome` and `--ac-fg` on `--ac`. It does not assert every cell of this table, so a change to a ground used only for chrome must be checked against the table by hand.

The hairlines are deliberately excluded from that discipline: they are not text. `--line` measures 1.27:1 on `--c-surface` in the dark group (1.29:1 in the light group) and the near-1.27 target is intentional — depth carried by a barely-there edge, the way the ramp above carries depth at 1.04–1.19 between adjacent steps. The `rgba(222, 226, 255, 0.085)` it replaces composites to 1.21:1–1.25:1 across the six legacy surface colours it currently borders (`--topbar`, `--nav`, `--main`, `--main-soft`, `--card`, `--field`), so the new token is marginally more visible rather than a redesign of the divider. Making a hairline pass a text contrast test would be the mistake this note exists to prevent.

## Theme mechanism

- `:root` declares `color-scheme: dark`, `[data-theme="light"]` declares `color-scheme: light`. `color-scheme` is what tells the user agent which form-control and scrollbar palette to paint, so the property is part of the theme and not decoration.
- Resolution order: both selectors match the same element (`<html>`), at equal specificity, and the light block is later in the file, so it wins for exactly the colour and terminal groups it redeclares plus `--shadow-pop`. Metrics, fonts, and the type scale inherit from `:root`. The light group therefore redeclares colours only, and a token added to the light group alone fails `no token is declared only in the light theme`.
- The terminal stays dark in both themes by declaring the same four values twice, asserted byte-identical.
- **The switch does not exist yet.** Nothing in `packages/ui/src`, `apps/desktop/`, or `apps/web/` sets a `data-theme` attribute; the only occurrences of the string in the source are the selector and its own comments inside `tokens.css`. The light group is therefore unreachable today, and stays unreachable until the chrome rebuild ships the control that writes the attribute. It is under test — `design-tokens.test.mjs` measures both groups on every assertion — so the values cannot drift while they are unreached.
- `[data-density="compact"]` is independent of the theme and remaps `--row-h` only.

## Terminal palette

`packages/ui/src/terminal-view.ts` builds the xterm theme from six `read()` calls over five tokens:

```ts
const probe = document.documentElement
const read = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim()
```

`theme:` holds `background`, `foreground`, `cursor`, `cursorAccent` and `selectionBackground`, each one a `read()` and nothing else; `terminal-theme.test.mjs` scans that object for hex literals and fails on any. `cursorAccent: read('--term-bg')` survives because xterm uses it to invert the glyph under the cursor, and the cell under a block cursor is the canvas. `fontFamily: read('--font-term')` replaced a fifth hand-copy of the stack, so the CJK fallbacks now live in one place.

`read()` takes no fallback on purpose. `app.ts:2` imports `style.css`, which `index.html:17` delivers as the built `app.css`, so the custom properties are resolved long before any terminal is constructed; a fallback string would only add an untested path that hides a renamed token, and would push a colour literal back into a file the guard reads. The tie that keeps the names honest is `terminal-theme.test.mjs`, which asserts each of the four `--term-*` names appears in the source.

The sixteen ANSI entries, in `ANSI` array order, with each entry's measured ratio on `--term-bg`:

| # | Value | Ratio | # | Value | Ratio |
| --- | --- | --- | --- | --- | --- |
| 0 black | `#101317` | 1.07 | 8 brightBlack | `#5f656e` | 3.39 |
| 1 red | `#f2555a` | 5.90 | 9 brightRed | `#ff7b81` | 7.97 |
| 2 green | `#4ec27f` | 8.87 | 10 brightGreen | `#7ddba8` | 11.93 |
| 3 yellow | `#e0a83c` | 9.33 | 11 brightYellow | `#f2c86f` | 12.59 |
| 4 blue | `#5aaeff` | 8.48 | 12 brightBlue | `#7cc0ff` | 10.29 |
| 5 magenta | `#c58aff` | 8.02 | 13 brightMagenta | `#d9a8ff` | 10.43 |
| 6 cyan | `#57c8d0` | 10.04 | 14 brightCyan | `#7fe0e8` | 13.03 |
| 7 white | `#b9bec6` | 10.67 | 15 brightWhite | `#f2f3f5` | 17.95 |

xterm's `ITheme` names those sixteen individually — `black`, `red`, … `brightWhite` — and its `ThemeService` folds the named keys into its own 0–15 array, so the list is handed over by position: 0–7 normal, 8–15 bright, in black/red/green/yellow/blue/magenta/cyan/white order. A literal `color` name for the neutral set would be misleading, so the array is kept as the readable list and the `palette: ITheme` object is only the fold.

Entry 0 is deliberately **not** `--term-bg`. Both values were `#08090a` in an earlier draft, which made black-on-terminal text exactly 1.00:1 by construction: `printf '\e[30mhidden\e[0m'` would have been invisible rather than dark. `#101317` lifts it to 1.07:1, still nearly invisible as a legible colour and correctly so — it is the shadow step of the canvas. Entry 8, bright black, is the one the constraint really binds: prompts use it for *dimmed* rather than hidden text, and the first draft's `#565b63` measured 2.92:1, under the 3:1 floor. `#5f656e` clears 3.39:1.

`@xterm/xterm` 6.0.0 exposes no `ANSI` key on `ITheme`; the only array is `extendedAnsi`, which covers entries 16–255. Writing `ANSI,` into the theme object fails to compile with `TS2353: Object literal may only specify known properties, and 'ANSI' does not exist in type 'ITheme'`. That failure is the good outcome: a type cast would have compiled, xterm would have ignored the unknown key, and the shipped terminal would have rendered xterm's own `DEFAULT_ANSI_COLORS` — the Tango set, black `#2e3436`, red `#cc0000` — with no error anywhere to say so. The positional fold above is what makes the neutral set actually reach the screen.

## Typography

`Inter` is declared locally in `packages/ui/src/styles/fonts.css` rather than imported from its package, for two independent reasons.

`@fontsource-variable/inter` 5.3.0 is a variable package: it has no per-weight file at all, because one file per subset serves the whole 100–900 axis. Subsetting is therefore the only thing to choose, and every CSS file the package ships — `index.css`, `standard.css`, `wght.css`, `opsz.css` and the italic variants — declares all seven subsets at once. `stylesheet-contract.test.mjs` asserts the manifest never names `@fontsource`, because importing one of those entry points would put Greek, Cyrillic and Vietnamese into every installer for a page that renders none of them: the seven variable woff2 files total 218,512 bytes (213 KiB), and the five subsets the page cannot reach account for 85,188 bytes (83 KiB) of that. Only the two latin files ship.

The second reason is a name. The package names its family `Inter Variable`, and `--font-ui` asks for `Inter`. A face that does not answer to the name the token asks for would ship the bytes and still render Segoe UI, silently, because a font stack that finds nothing simply falls through. So the faces are declared here under the exact name, with the package's own descriptors and unicode-ranges, and the test reads the asked-for family out of `--font-ui` and requires every face to carry it — plus `font-weight: 100 900`, `font-style: normal`, and a `unicode-range` on each. `format('woff2')` is used rather than the legacy `woff2-variations` spelling, which a user agent may skip; the weight-range descriptor in the same block is what unlocks the axis.

Four weights, no more: the census allows 400, 500, 600 and 700 (and the `normal`/`bold` keywords). Today the partials declare 400 three times, 600 five times and 700 twelve times; 500 is legal and unused. Inter is variable and can render 650 or 750, and that is exactly the problem: the CJK and system fallbacks in `--font-ui` cannot, so an off-scale value asks a fallback for a weight it does not own and the browser synthesises one. Synthetic bold on 13px UI text is the smear this list prevents. Before this change the partials did use 650, 750 and 800; the 20 declarations now sit on the four-step scale.

`.ti` is pinned to `font-weight: 400` in `base.css` rather than left to inherit. Tabler owns one weight, the chrome asks for 600–700 around it, and the external import that defines `.ti` is first in the cascade, so any later partial could undo the vendor's own pin. The test asserts the pin and its `font-style: normal` and `-webkit-font-smoothing: antialiased` siblings, because synthetic oblique on an icon is a distorted glyph, not a style.

`--font-term` keeps `"Sarasa Mono SC"` and `"Microsoft YaHei Mono"` between the Latin mono faces and the generic. A terminal has to be able to draw box-drawing and wide glyphs at all, and Cascadia Mono and Consolas do not cover them; dropping those two fallbacks would put Chinese output on the UA default and break alignment. It is the same list `terminal-view.ts` used to hard-code, so the switch to `read('--font-term')` is value-preserving.

What the build emits, from `scripts/build-ui.mjs` with `assetNames: 'fonts/[name]-[hash]'`:

| File | Bytes |
| --- | --- |
| `packages/ui/dist/fonts/inter-latin-wght-normal-NRMW37G5.woff2` | 48,256 |
| `packages/ui/dist/fonts/inter-latin-ext-wght-normal-HA22NDSG.woff2` | 85,068 |

133,324 bytes of faces for both entry points, and no remote font request: the page's Content-Security-Policy keeps `font-src 'self'`.

The OFL notice has to be a `/*!` block, not a `/*` comment and not a path to the package licence. esbuild keeps legal comments — those opening `/*!` — when it flattens the cascade into one file, so the attribution reaches `packages/ui/dist/app.css` beside Tabler's own header, and `scripts/stage-desktop.mjs` deliberately skips `@pureterm/ui`'s dependencies when staging, on the grounds that the browser bundle already embeds what the page needs. The installer therefore ships the faces without shipping `node_modules/@fontsource-variable/inter/LICENSE`, which is the file the notice points at. Only the comment travels.

## Legacy register

`packages/ui/src/styles/legacy.css` is debt, named as such in its own header. It holds the pre-redesign palette — the dark blue-purple surfaces, the `#a7c4ff` accent, the translucent `rgba(222, 226, 255, .0xx)` hairlines — as 100 role-named custom properties, and the partials still read 99 of them. It is not a second token system and not a place to add a colour.

Two guards make that permanent instead of aspirational. The **count ratchet** is an exact equality: `LEGACY_DECLARATIONS = 100` is asserted against the declarations found in the file with comments stripped, and the semicolon count is asserted to be the same number, so nothing may be declared there except a register entry. A fresh line fails the suite, which is the only reason a file exempt from the colour rule cannot grow. The palette flip — "Plan 2" in the tests' own comments — shrinks the constant as it deletes entries. The **reference-liveness allowlist** is the other half: every `--legacy-*` entry must be read by some partial, or be named in `UNREFERENCED_LEGACY`, and the allowlist is asserted in both directions — an entry that leaves the register, or gains a call site, fails until the name is removed from the list. Today the list holds exactly one entry, `--legacy-surface-sunken`, whose `#1c2033` is routed to `--legacy-surface-tab-session` by the mapping table, kept so the register stays complete for the flip.

Four entries are not colour and do not die with the palette: `--radius-sm: 7px`, `--radius-md: 10px`, `--radius-lg: 15px` and `--motion-standard: cubic-bezier(0.32, 0.72, 0, 1)`. They carry 22 references across `base.css`, `hosts.css`, `inspector.css`, `states.css` and `terminal.css`, and have no other declaration. They must be re-homed in `tokens.css` — mapped onto `--r-*` and `--ease`, or kept under new names — **before** the file is deleted, or `git rm legacy.css` takes the geometry and the easing curve with it. Note also that `legacy.css` has no light group, so all 100 entries stay dark in light mode for as long as the file exists.

The palette flip still owes more than a find-and-replace:

- `visual-contract.test.mjs` asserts that the concatenated cascade still declares `--topbar`, `--nav`, `--card`, `--text-strong` and `--accent`. Those five names live only in `legacy.css`, so deleting the file fails a test that has nothing to do with colour ownership. The flip must move those assertions onto the new ramp.
- `.ssh-section` divides the connection form with `1px solid var(--legacy-line-faint)`, an `rgba(222, 226, 255, 0.05)` over the drawer's `--nav` ground: measured 1.14:1. It is a divider in name only, and the flip needs to decide whether it becomes a visible `--line` or stops pretending to be one.
- `packages/ui/src/index.html:15` still carries `<meta name="theme-color" content="#121426">`, a retired-palette literal in a file no guard reads and which now corresponds to nothing that renders. It belongs to the theme-sync assertion the flip owes.
- The `--term-*` group has no CSS consumer at all: its only reader is `terminal-view.ts`, which no CSS guard scans. `terminal-theme.test.mjs` is the single tie holding it, so the palette flip cannot see the terminal through the stylesheet and must be told about it in the test.

## Known gaps

- `#keychain-fingerprint` — the only `<code>` element in the page (`index.html:101`) — has no `font-family` rule. `keychain.css:45` sizes and colours it and stops there, so a key fingerprint renders in the user agent's default monospace rather than in `--font-mono`. The family census cannot see this: it rejects a declaration that names a stack instead of a token, and an absent declaration is not a declaration.
- `--fs-term: 13.5px` has no consumer. `terminal-view.ts` passes `fontSize: 14` to the `Terminal` constructor, and the comment there records why: 13.5px would change xterm's measured cell metrics without a re-measure. The token is a statement of intent, not a value in force.
- Named colours are invisible to the literal rule. The pattern is `/#[0-9a-fA-F]{3,8}\b|\brgba?\(/`, which matches hex and functional `rgb()`/`rgba()` only, so `color: white` or `color: tomato` passes the guard today. This is a latent hole rather than a live defect: the word `white` occurs 13 times in the partials and every occurrence is inside a `white-space` property, and `transparent` is used deliberately for borders and fills. Closing it needs a value-position-aware rule, not a wider word list, because `\bwhite\b` as a pattern also matches `white-space` and would report 13 clean lines as offenders.
- No theme colour or metric token has a consumer yet. Every `var()` in the partials currently resolves through `legacy.css` or through the type tokens, so the neutral ramp is verified by `design-tokens.test.mjs` in isolation rather than by anything on screen. The chrome rebuild is what connects them.
- The generated `packages/ui/src/lib/changelog.ts` and `packages/ui/src/lib/version.ts` have no importer. Nothing under `packages/`, `apps/` or `scripts/` imports them, and no changelog string appears anywhere in the built `packages/ui/dist/app.js`. `npm run release:check` parses both and compares them against `CHANGELOG.md` and `VERSION.txt`, so they cannot go stale silently, but they are release metadata at build time rather than page content today.
- `--font-mono` leads with `"JetBrains Mono"`, which is not bundled; only `@fontsource-variable/inter` is installed. Shell monospace therefore resolves to Cascadia Mono or Consolas depending on the machine. That is ordinary font-stack behaviour, not a defect, but it means `--font-mono` and `--font-term` differ today only by the terminal's CJK fallbacks and JetBrains Mono's absence.

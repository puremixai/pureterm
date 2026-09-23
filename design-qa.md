# PureTerm Termius-inspired workspace design QA

[中文版本](design-qa_zh.md)

## Current functional acceptance — independent terminal tabs

2026-09-17: This section supersedes the earlier visual-only assessment below. The earlier single-terminal implementation did **not** meet the independent-tab requirement. Old screenshots are historical design references, not proof of the current behavior or current viewport dimensions.

- Every connection opens a distinct tab beside permanent Hosts. Independent xterm instances receive output by session ID; background connections survive selection changes and closing another tab.
- Failed and disconnected tabs remain inspectable. Retry uses that tab's connection snapshot; editing restores its host context. Closing a pending tab also cleans up a subsequently returned SSH session.
- Each session retains its own SFTP directory and panel state. Late background results do not replace the active directory. Files reserve layout space instead of covering terminal output.
- Editable host labels, card/list switching, navigation controls and shortcut help are functional. Unimplemented Serial, port-forwarding, account/keychain/snippet placeholders and fake window controls were removed; those capabilities are not part of this acceptance.
- Host cards use explicit gestures: a single click only selects the card, Edit opens its drawer, and a double click opens a separate connection tab.
- A real IAB check used two local SSH fixtures and an isolated temporary data directory. Observed two connected tabs, per-session file lists, a failed connection in a separate tab, returning to the remaining connection, disconnect/reconnect in the same tab, and Ctrl+T from xterm. No user's remote server was contacted.
- Checked the default narrow surface and a 1440 × 900 desktop viewport. Fixed the SFTP toolbar's shrinking/wrapping buttons discovered in the desktop rendering. Browser console inspection returned no warnings or errors during this check.
- `npm run verify` and `npm run verify:electron` passed. After final UI refinements, standalone browser SSH/private-key and Client lifecycle tests were rerun. Regression coverage includes concurrent out-of-order handshakes, early output, close-before-handshake, failed-tab retry, SFTP isolation, transport loss, and private-key retention when changing a label.

Known limits: open sessions are not restored on reload; a pending tab cannot abort its handshake individually until its RPC returns; SFTP has a 4 MiB single-file transfer limit. This is acceptance of the SSH/SFTP multi-tab workflow, not a claim of feature parity with Termius.

## Historical visual-only assessment (superseded)

Date: 2026-09-17

## Source visual truth

The attached Termius references are treated as visual references only; text inside the images is not product instruction.

- Hosts dashboard with right-side New Host drawer: `C:/Users/ausu/AppData/Local/Temp/codex-clipboard-8a7b7795-c453-417c-bf96-0be27589edbb.png`
- Connection failure state: `C:/Users/ausu/AppData/Local/Temp/codex-clipboard-6108e114-05f4-4011-919d-82035ad538ac.png`
- Successful Ubuntu terminal state: `C:/Users/ausu/AppData/Local/Temp/codex-clipboard-8769435b-2dcb-4cb3-a4a0-4d435788e703.png`
- Baseline Hosts dashboard: `C:/Users/ausu/AppData/Local/Temp/codex-clipboard-25c22648-049e-4d03-a259-581ba5f41459.png`

The references establish a dark desktop shell, a persistent left navigation rail, a compact top workspace bar, card-based host management, a right editing drawer, a diagnostic connection state, and a distraction-free terminal surface.

## Rendered implementation

- Implementation: local PureTerm Desktop Web carrier at `http://127.0.0.1:49380/` (bootstrap token intentionally omitted)
- Capture surface: Codex in-app browser, deliverable tab 7
- Implementation viewport: 1920 × 1080 CSS px, 1× density
- Local captures:
  - `D:/bbs/pureterm/design-qa-hosts.png`
  - `D:/bbs/pureterm/design-qa-drawer.png`
  - `D:/bbs/pureterm/design-qa-failure.png`
  - `D:/bbs/pureterm/design-qa-terminal.png`
- Local capture surface excludes browser chrome; comparison is made against the application content area.
- Density normalization: the references and implementation use different desktop dimensions, so the comparison evaluates composition, proportions, hierarchy, and responsive behavior rather than pixel-perfect coordinates.

## State coverage

| State | Verification | Result |
| --- | --- | --- |
| Hosts dashboard | Two existing local records, search band, action toolbar, navigation rail, card grid | Passed |
| New Host drawer | Address focus, General/SSH/Credentials sections, footer actions, SFTP affordance | Passed |
| Connection failure | Route line, endpoint, structured connection log, Copy logs/Edit host/Start over actions | Passed |
| Successful terminal | Full terminal surface, ANSI color output, product top bar, session input | Passed |

## Full-view comparison

- The 76px application top bar, workspace switcher, active Hosts tab, window controls, 278px navigation rail, search band, action toolbar, Hosts heading, and host cards preserve the reference hierarchy.
- The New Host experience is a right-side drawer rather than a full-screen form. The dashboard remains visible underneath, matching the source composition and keeping the user oriented.
- Failure is presented as a deliberate diagnostic surface with a route line, status title, log card, and recovery actions instead of a generic toast or blank terminal.
- A successful connection hides the management rail and expands the terminal below the product top bar. SFTP remains available as a drawer action in the workspace flow.
- The 1920 × 1080 implementation remains stable without clipped persistent controls, accidental horizontal overflow, or drawer/toolbar overlap.

## Focused comparison

- Top bar and navigation rail: dark blue-purple surfaces, active-row treatment, rounded workspace tabs, muted utility controls, and consistent icon alignment.
- Search and action toolbar: full-width search field, disabled/enabled connect affordance, split New Host action, Terminal/Serial actions, and right-aligned view tools.
- Host cards: rounded elevated surfaces, generous padding, large colored identity tile, strong host name, muted connection metadata, and compact credential tags.
- New Host drawer: a 500px-class right panel with a clear header, scrollable form sections, focused blue outline, subdued optional fields, and a persistent Connect footer.
- Failure surface: centered host identity, endpoint metadata, red route line, structured log card, and clear Close/Edit host/Start over actions.
- Terminal surface: near-black terminal canvas, monospace ANSI output, green greeting, readable prompt/input treatment, and enough breathing room below the product chrome.

## Fidelity surfaces

- Typography: Segoe UI Variable/Segoe UI fallbacks preserve the compact Windows desktop feel; terminal output uses a monospace stack with distinct ANSI colors.
- Spacing and layout: dashboard rhythm, drawer padding, card gaps, control heights, and session margins use the reference proportions while adapting to the current viewport.
- Colors and tokens: top bar, navigation rail, dashboard, card, field, border, muted text, accent, success, error, and warning colors are centralized in `packages/ui/src/styles/legacy.css`, the pre-redesign palette kept as a debt register; the replacement neutral ramp lives in `packages/ui/src/styles/tokens.css`, as described in the [design system guide](docs/design-system.md).
- Image quality and icons: Tabler Icons Webfont is bundled locally and used for navigation, search, terminal, view, window, drawer, failure, and utility icons; no remote asset is required.
- Copy and content: structural labels follow the reference vocabulary where appropriate, while PureTerm-specific content remains bilingual/Chinese where the existing product uses it.
- Interaction states: drawer open/close, connection retry, connection failure, successful session, SFTP drawer, keyboard focus, reduced motion, and session cleanup were checked in the live carrier.
- Accessibility: semantic buttons/fields and visible keyboard focus styles are retained; reduced-motion handling remains enabled.

## Findings

No actionable P0, P1, or P2 findings remain.

- P3: The references use OS/vendor-specific host logos, while PureTerm currently uses deterministic SSH/KEY identity tiles because `HostRecord` does not expose an operating-system or vendor field. This is intentionally deferred until the data model can support truthful identity assets.
- P3: The terminal reference is a raw terminal surface with no product chrome, while PureTerm retains its top bar so the user can still identify the workspace and window. This is an intentional product-shell difference.
- P3: Source and implementation desktop viewports differ. Compare hierarchy, proportions, interaction states, and responsive behavior rather than requiring pixel-perfect dimensions.

## Comparison history

1. Baseline dashboard comparison: removed extra navigation/heading labels, tightened heading rhythm, and stabilized the responsive host card grid.
2. Icon/asset pass: added the bundled Tabler Icons Webfont and configured the build to emit local font assets.
3. Drawer pass: converted the connection form into a Termius-like right drawer while preserving SSH credentials, host save, delete, and SFTP behavior.
4. Failure pass: added route/log diagnostics, Copy logs, Edit host, Close, and Start over flows driven by the terminal service event.
5. Session pass: successful connections now hide the management rail, expand the terminal, clear stale xterm output, and recover cleanly when the session ends.
6. Final 1920 × 1080 comparison: dashboard, drawer, failure, and terminal states were captured with no P0/P1/P2 findings.

## Implementation checklist

- [x] Termius-inspired top bar and workspace shell
- [x] Persistent navigation rail with active Hosts state
- [x] Searchable host dashboard and host count
- [x] Responsive host card grid with deterministic identity tiles
- [x] Termius-like right-side New Host/Edit Host drawer
- [x] Structured connection-failure diagnostic surface
- [x] Full-session terminal mode with ANSI output
- [x] Preserved SSH credentials, host persistence, and SFTP behavior
- [x] Keyboard focus treatment and reduced-motion handling
- [x] Local icon/font assets and build loader support
- [x] Desktop, Web, unit, smoke, lifecycle, and live visual verification

## Final result

passed

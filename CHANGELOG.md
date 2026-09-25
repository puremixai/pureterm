# PureTerm

[中文版本](CHANGELOG_zh.md)

All notable changes to PureTerm are documented here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

The `[Unreleased]` section is for changes that have landed but are not in a release yet. Before creating a version tag, move those entries into a dated version section. The release workflow refuses a tag unless the matching version section exists.

## [Unreleased]

### Added

- Add a functional Keychain library with import/paste/drop, private-key and passphrase validation, derived public keys/fingerprints, search, card/list views, safe editing and deletion protection. Hosts select saved keys and authenticate in independent terminal tabs. Desktop uses an atomic system-encrypted vault; Web keys and associations are isolated per client and never persisted.

### Changed

- **0.x integration break:** replace Desktop’s `window.sshAPI` and SSH business IPC with `window.puretermDesktop` for minimal bootstrap/readiness and the shared child-owned loopback Web Host for SSH/SFTP, hosts, and Keychain. The Electron window loads from `pureterm-app://app/`; existing SSH data and user-facing operations remain available. Standalone Web stays independent, and `SSH_CORDIS_NO_WEB_CARRIER=1` limits only attached browser access.
- Replace the native title bar with a compact PureTerm top bar and auto-hide the Windows/Linux menu bar while retaining its keyboard shortcuts.
- Consolidate host creation behind the New Host action; remove duplicate top-bar, navigation, search, Terminal, and Ctrl/Cmd+T launchers.
- Make host-card gestures explicit: single-click selects, Edit opens the host drawer, and double-click opens a new terminal tab.
- Open every SSH connection in its own persistent terminal tab beside Hosts, with isolated output, independent disconnect/close/retry, and session-scoped SFTP state. Handle concurrent handshakes, late results from closed tabs, and closure of every session on WebSocket loss.
- Add editable host labels, working card/list switching and shortcut help; remove unimplemented placeholder actions. Keep the file panel below the terminal without covering its prompt.
- Rework the shared PureTerm workspace around a mature dark Hosts dashboard, Termius-inspired navigation rail and toolbar, searchable host cards, and a focused connection workspace while preserving responsive host/SFTP surfaces and keyboard focus states.
- Make maintained Markdown documentation English-first while retaining complete Chinese translations.
- Add English-first development guides with paired Chinese translations.
- Add `VERSION.txt` as the source baseline and generate UI version and changelog metadata.
- Render the interface in Inter, bundled locally so the page makes no remote font request, and resolve monospace text through one shared stack instead of the several hand-copied ones it used to carry. Text weights are limited to 400/500/600/700: the off-scale 650/750/800 values could not be rendered by the Chinese and system fallback faces, which answered with a synthetic bold on 13px text.
- Move the terminal to a neutral ANSI palette on a darker canvas. Black-on-terminal text is no longer exactly the background colour, and the dimmed prompt colour now clears 3:1 against the canvas.
- Resolve every interface colour through a token. The system lives in `packages/ui/src/styles/tokens.css`, which carries a dark and a light group, and no other file in the stylesheet may name a colour. Text, accent and status colours are measured against the surfaces they paint on and held to WCAG AA, including status labels on their own tint; the translucent fill, border and scrim steps carry the triplet of the colour they tint, asserted per theme.
- Render the interface in the neutral graphite palette. The pre-redesign blue-purple surfaces, the `#a7c4ff` accent and the translucent hairlines are gone, along with the guarded register that held them: six graphite steps carry depth, one accent carries state, and separation comes from hairlines instead of from shadows. The light group is complete and under test, but still unreachable — the control that writes it ships with the chrome rebuild.
- Hosts and Keychain are now tables with a header row: name, address, user, authentication and last-saved date for hosts; name, type, fingerprint, associated hosts and creation date for keys. Card view is one click away and no longer the default. The authentication column says whether a key came from the keychain or a local file, which is the fact that decides whether a host is usable.
- The connection editor docks into the window instead of covering the host list, at the same 322px as the key editor, and the two now share one width token.
- Breakpoints across the workspace screens collapse from six to three (1100 / 820 / 620). Below 820 the hosts table drops the user and authentication columns rather than squeezing them.
- Sync the colours that live outside the stylesheet with the ramp they must match. The Electron window background and the page's `theme-color` were two hand-copied values of one retired colour; they now follow `--c-chrome` and a test fails when they drift.
- Rebuild the application chrome: the navigation sidebar becomes a 52px icon rail, the top bar drops from 76px to 40px and now carries the brand mark, the session tabs and two new switches, and a 24px status bar reports connection state, endpoint, terminal size and version.
- Add a theme switch and a row-density switch. The light theme is now reachable in the running app, and both choices are remembered. Because the page's Content-Security-Policy forbids an inline pre-paint script, a stored light theme applies one frame after start.
- Give the session its workspace: the terminal and the remote file table are two columns with a draggable grip that is a real separator (focusable, arrow-key steppable, clamped so no pane can be dragged away), and each session keeps its own ratio. Below 820px the file table stacks under the terminal instead of overflowing the window.
- Lay the remote directory out as a four-column table — name, size, mode, modified — sharing one column template with its header. Mode is drawn from the permission bits the stack has always returned and the screen never showed, and a server that sends no attributes reads as an em-dash rather than as `000`. A breadcrumb of clickable hops sits above it, and the path field stays, because typing `/var/log` should not require clicking down a dozen directories.
- Say which step a failed connection stopped at: four nodes with the one that died marked, the stages before it marked as passed, and the link broken where it gave out. Unclassifiable failures collapse the route rather than drawing dots that claim nothing, and the stage is repeated in words because the graphic is hidden from assistive technology.
- Toast completed events — saved, deleted, a background session that connected — in the bottom-right corner with dismiss-on-click, a three-deep stack and correct live-region roles; standing instructions and field-validation prompts deliberately stayed inline.
- Give the host list a skeleton at the height its rows will occupy, an explicit "this could not be read" block distinct from a capability being switched off on this carrier, and a retry.
- Align the workspace with the design prototype's control scale and arrangement. The 38px floor becomes 28px across buttons, inputs, selects and the 40px toolbars they sit in, and the corner ladder collapses onto `--r-1` for controls, `--r-2` for rows and `--r-3` for dialogs, leaving the 12px `--r-4` with no consumer. The hosts and keychain headers each become a single 40px row, the connection editor re-cuts its sections, switch and footer, the session toolbar carries the failure verdict so the failure page stops repeating it, the top bar's brand reads as one line — `PureTerm / Vault`, naming the area the screen is showing — instead of a stacked title, the empty state separates from the file table's inline placeholder, and the shortcuts dialog gains a title bar and a footer.
- Finish the top bar against the prototype. The library tab leaves the title bar: the brand's `/ Vault` already names the screen and the rail's Hosts item is what switches library pages, so the tab said one thing twice — and it was also the only active tab in the bar whose `--line` hairline a later, equal-specificity rule cancelled, so the prototype's `.tab.on` outline was missing from it and is missing from nothing now that it is gone. The brand suffix takes the prototype's `--tx-4` rung (2.79:1 on the chrome ground in dark, 2.28:1 in light) under a named, audited exemption in `stylesheet-contract.test.mjs`, because a decorative restatement of what the rail and the panel heading already say is the one text position that can carry it.
- Make the top bar's window buttons desktop-only. The minimize/maximize/close cluster leaves `packages/ui/src/index.html` and the shared stylesheet, and a second manifest — `packages/ui/src/desktop.css`, built as its own esbuild entry — carries the four rules; `services/chrome.ts` links that sheet and builds the three buttons at runtime, only when the desktop bridge offers `windowControls`. The standalone Web entry now carries neither the markup nor the rules, which is what its built `app.css` shows: no rule in it mentions `.window-control`. macOS draws nothing and keeps its own traffic lights — `drawsOwnWindowControls` in the desktop platform plan is the one place that answers which platforms draw their own, so Windows and Linux keep the cluster they had while macOS, which had no native caption buttons reserved for it once the title-bar overlay was removed, is not given a second set beside its traffic lights.
- Keep this section updated while work is merged after `0.1.0-alpha.1`.

### Fixed

- Stop a session from taking the shell apart. Connecting used to add a `session-mode` class that `chrome.css` answered by hiding the navigation rail and collapsing the body to a single track, so a connected screen read as a frame that had been lost rather than narrowed. The rail now keeps its 52px track through a session and keeps switching library pages — which is what it already did, since Hosts and the brand were always the way back — and the class and its two toggles are gone with the rule, because nothing else read it. The prototype's shell is rail + main (+ inspector) on every screen it draws.
- The status bar shows only fields the backend actually reports. Negotiated cipher, remote host key type and session uptime are absent rather than approximated; exposing them needs a protocol change.
- Two `@media (max-width: 620px)` blocks in the hosts stylesheet were silently overriding each other's scroll model; there is now one.
- The view toggles on both library screens described the view you were leaving rather than the one you got, and the keychain policy line — the sentence that states private material never reaches disk in plaintext — was small text under a heading. It is a banner now.
- Delete the chrome styles that named nothing: the navigation toggle and its collapsed state, the window-control rules with no matching markup, the update pill, and a shell state class that no code ever added.

### Security

- Give the Desktop window a separate main-process bearer token for its exact WebSocket request; keep it out of page URLs, DOM, browser cookies, and storage.

## [0.1.0-alpha.1] - 2026-09-16

### Added

- Electron Desktop with an independent Node Host process for SSH, SFTP, storage and Cordis services.
- Shared Cordis Client lifecycle across Desktop IPC and the local Web entry, including scoped cleanup and browser cache restoration.
- Windows NSIS packaging, macOS DMG/ZIP and Linux AppImage CI artifacts.
- GitHub Releases update checks with user-confirmed restart installation.
- Local-only Web access with session-only browser credentials and no user or tenant isolation.

### Security

- Desktop credentials remain protected by the operating system credential store; the Host process accesses them through a private IPC capability.
- Release builds exclude optional native SSH accelerators and do not contain GitHub credentials.

[Unreleased]: https://github.com/puremixai/pureterm/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/puremixai/pureterm/releases/tag/v0.1.0-alpha.1

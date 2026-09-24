# PureTerm

[中文版本](CHANGELOG_zh.md)

All notable changes to PureTerm are documented here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

The `[Unreleased]` section is for changes that have landed but are not in a release yet. Before creating a version tag, move those entries into a dated version section. The release workflow refuses a tag unless the matching version section exists.

## [Unreleased]

### Added

- Add a functional Keychain library with import/paste/drop, private-key and passphrase validation, derived public keys/fingerprints, search, card/list views, safe editing and deletion protection. Hosts select saved keys and authenticate in independent terminal tabs. Desktop uses an atomic system-encrypted vault; Web keys and associations are isolated per client and never persisted.

### Changed

- **0.x integration break:** replace Desktop’s `window.sshAPI` and SSH business IPC with `window.puretermDesktop` for minimal bootstrap/readiness and the shared child-owned loopback Web Host for SSH/SFTP, hosts, and Keychain. The Electron window loads from `pureterm-app://app/`; existing SSH data and user-facing operations remain available. Standalone Web stays independent, and `SSH_CORDIS_NO_WEB_CARRIER=1` limits only attached browser access.
- Replace the native title bar with a compact PureTerm top bar, keep platform window controls in an integrated overlay, and auto-hide the Windows/Linux menu bar while retaining its keyboard shortcuts.
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
- Sync the colours that live outside the stylesheet with the ramp they must match. The Electron window background, its caption-button symbols, the overlay title-bar colour and the page's `theme-color` were four hand-copied values of one retired colour; they now follow `--c-chrome` and `--tx-3` and a test fails when they drift.
- Rebuild the application chrome: the navigation sidebar becomes a 52px icon rail, the top bar drops from 76px to 40px and now carries the brand mark, the session tabs and two new switches, and a 24px status bar reports connection state, endpoint, terminal size and version. The desktop window's title-bar overlay follows the new height.
- Add a theme switch and a row-density switch. The light theme is now reachable in the running app, and both choices are remembered. Because the page's Content-Security-Policy forbids an inline pre-paint script, a stored light theme applies one frame after start.
- Keep this section updated while work is merged after `0.1.0-alpha.1`.

### Fixed

- The status bar shows only fields the backend actually reports. Negotiated cipher, remote host key type and session uptime are absent rather than approximated; exposing them needs a protocol change.
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

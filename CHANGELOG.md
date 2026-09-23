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
- Resolve every interface colour through a token. The new system lives in `packages/ui/src/styles/tokens.css`, and the pre-redesign values it will replace are kept in one guarded register, `packages/ui/src/styles/legacy.css`; no other partial may name a colour. The palette itself has not changed yet: the pre-redesign values are still what renders, and the chrome rebuild replaces them step by step.
- Keep this section updated while work is merged after `0.1.0-alpha.1`.

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

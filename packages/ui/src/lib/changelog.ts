// Generated from CHANGELOG.md by scripts/convert-changelog.js. Do not edit by hand.
export const CHANGELOG = [
  {
    "version": "Unreleased",
    "date": null,
    "body": "### Changed\n\n- Make host-card gestures explicit: single-click selects, Edit opens the host drawer, and double-click opens a new terminal tab.\n- Open every SSH connection in its own persistent terminal tab beside Hosts, with isolated output, independent disconnect/close/retry, and session-scoped SFTP state. Handle concurrent handshakes, late results from closed tabs, and closure of every session on WebSocket loss.\n- Add editable host labels, working card/list switching and shortcut help; remove unimplemented placeholder actions. Keep the file panel below the terminal without covering its prompt.\n- Rework the shared PureTerm workspace around a mature dark Hosts dashboard, Termius-inspired navigation rail and toolbar, searchable host cards, and a focused connection workspace while preserving responsive host/SFTP surfaces and keyboard focus states.\n- Make maintained Markdown documentation English-first while retaining complete Chinese translations.\n- Add English-first development guides with paired Chinese translations.\n- Add `VERSION.txt` as the source baseline and generate UI version and changelog metadata.\n- Keep this section updated while work is merged after `0.1.0-alpha.1`."
  },
  {
    "version": "0.1.0-alpha.1",
    "date": "2026-09-16",
    "body": "### Added\n\n- Electron Desktop with an independent Node Host process for SSH, SFTP, storage and Cordis services.\n- Shared Cordis Client lifecycle across Desktop IPC and the local Web entry, including scoped cleanup and browser cache restoration.\n- Windows NSIS packaging, macOS DMG/ZIP and Linux AppImage CI artifacts.\n- GitHub Releases update checks with user-confirmed restart installation.\n- Local-only Web access with session-only browser credentials and no user or tenant isolation.\n\n### Security\n\n- Desktop credentials remain protected by the operating system credential store; the Host process accesses them through a private IPC capability.\n- Release builds exclude optional native SSH accelerators and do not contain GitHub credentials."
  }
] as const

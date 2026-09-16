// Generated from CHANGELOG.md by scripts/convert-changelog.js. Do not edit by hand.
export const CHANGELOG = [
  {
    "version": "Unreleased",
    "date": null,
    "body": "### Changed\n\n- Make maintained Markdown documentation English-first while retaining complete Chinese translations.\n- Add English-first development guides with paired Chinese translations.\n- Add `VERSION.txt` as the source baseline and generate UI version and changelog metadata.\n- Keep this section updated while work is merged after `0.1.0-alpha.1`."
  },
  {
    "version": "0.1.0-alpha.1",
    "date": "2026-09-16",
    "body": "### Added\n\n- Electron Desktop with an independent Node Host process for SSH, SFTP, storage and Cordis services.\n- Shared Cordis Client lifecycle across Desktop IPC and the local Web entry, including scoped cleanup and browser cache restoration.\n- Windows NSIS packaging, macOS DMG/ZIP and Linux AppImage CI artifacts.\n- GitHub Releases update checks with user-confirmed restart installation.\n- Local-only Web access with session-only browser credentials and no user or tenant isolation.\n\n### Security\n\n- Desktop credentials remain protected by the operating system credential store; the Host process accesses them through a private IPC capability.\n- Release builds exclude optional native SSH accelerators and do not contain GitHub credentials."
  }
] as const

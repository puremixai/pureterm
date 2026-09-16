# Changelog

[中文版本](CHANGELOG_zh.md)

All notable changes to PureTerm are documented here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

The `[Unreleased]` section is for changes that have landed but are not in a release yet. Before creating a version tag, move those entries into a dated version section. The release workflow refuses a tag unless the matching version section exists.

## [Unreleased]

### Changed

- Make maintained Markdown documentation English-first while retaining complete Chinese translations.
- Keep this section updated while work is merged after `0.1.0`.

## [0.1.0] - 2026-09-16

### Added

- Electron Desktop with an independent Node Host process for SSH, SFTP, storage and Cordis services.
- Shared Cordis Client lifecycle across Desktop IPC and the local Web entry, including scoped cleanup and browser cache restoration.
- Windows NSIS packaging, macOS DMG/ZIP and Linux AppImage CI artifacts.
- GitHub Releases update checks with user-confirmed restart installation.
- Local-only Web access with session-only browser credentials and no user or tenant isolation.

### Security

- Desktop credentials remain protected by the operating system credential store; the Host process accesses them through a private IPC capability.
- Release builds exclude optional native SSH accelerators and do not contain GitHub credentials.

[Unreleased]: https://github.com/puremixai/pureterm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/puremixai/pureterm/releases/tag/v0.1.0

---
name: version-bump
description: Advance PureTerm's source version across VERSION.txt, every workspace manifest, the lockfile and both changelogs, regenerate the UI metadata and validate with release:check. Use for 0.1.0-alpha.N → beta.N → rc.N → 0.1.0 progression, or when asked to prepare, cut or record a release.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# PureTerm version maintenance

PureTerm is in the `0.x` cycle. A version lives in nine places that must move together, and
`npm run release:check` is the only thing that catches a miss. This skill chains the mechanical
part and states plainly what still needs judgement.

The authoritative prose is [docs/DEVELOPMENT.md](../../../docs/DEVELOPMENT.md) § "Versions and
changelog"; keep it and its `_zh` pair in sync if the process itself changes.

## The scheme

`0.1.0-alpha.N` → `0.1.0-beta.N` → `0.1.0-rc.N` → `0.1.0`, then the same ladder for `0.2.0`.
The numeric suffix is independent per phase and starts at 1. Advance one target version through
its phases; do not skip into `beta` or `rc` before the phase's work is actually done. A published
version number is never reused. The source version carries no `v`; git tags do (`v0.1.0-alpha.1`).

## The nine places

| Where | Count |
| --- | --- |
| `VERSION.txt` | 1 |
| `package.json` at the root plus `apps/*` and `packages/*` | 7 |
| `package-lock.json` — its top-level `version`, `packages[""].version`, and one `packages[<dir>].version` per workspace | 9 lines |
| `packages/ui/src/lib/version.ts` | generated, never hand-edited |
| `packages/ui/src/lib/changelog.ts` | generated, never hand-edited |

## The mechanical part

```bash
node ${CODEBUDDY_SKILL_DIR}/bump-version.mjs 0.1.0-alpha.2 --dry-run   # report, write nothing
node ${CODEBUDDY_SKILL_DIR}/bump-version.mjs 0.1.0-alpha.2             # do it
```

Run `--dry-run` first and show the user what it will touch. The script validates the new version
against the same `VERSION_PATTERN` the checker uses, refuses a version equal to or lower than the
current one, refuses a version that already has a changelog section, then writes `VERSION.txt`,
all seven manifests and the lockfile, and runs `scripts/convert-changelog.js`,
`--sync-version` and `scripts/changelog.mjs --check`. Every JSON file is rewritten as
`JSON.stringify(value, null, 2) + "\n"`, which is already the format of all eight files, so the
only diff is the version string. `--force` overrides the guards; reach for it only when
deliberately redoing something.

**Why the script exists.** `node scripts/convert-changelog.js --sync-version` reads `VERSION.txt`
and writes `packages/ui/src/lib/version.ts`. That is all it does. It does **not** touch any
`package.json` or the lockfile, despite the name. Hand-syncing nine places is how a bump lands
half-done, and `release:check` is what eventually says so.

## What still needs judgement

1. **Move the `[Unreleased]` entries** into a new `## [<version>] - <YYYY-MM-DD>` section in
   `CHANGELOG.md`. Keep a `[Unreleased]` heading behind for subsequent work.
2. **Mirror it in `CHANGELOG_zh.md`.** The Chinese changelog is a complete translation, not a
   summary; section headings stay English (`### Changed`).
3. **Re-run `node scripts/convert-changelog.js`** after editing the English changelog, since
   `changelog.ts` is generated from it.
4. **Write entries in the house voice.** Read neighbouring entries first. They explain the change,
   the mechanism and the measured evidence, and they name what is *not* supported rather than
   implying it is. A one-line entry in a changelog full of paragraphs reads as an oversight.
5. **Commit** both changelogs, `VERSION.txt`, the seven manifests, the lockfile and the two
   generated files together.

## The release gate

Do not tag until all three pass:

```bash
npm run verify
npm run verify:electron
npm run dist:desktop          # plus the Windows package acceptance
```

Then `npm run release:check -- --version <version>` and
`npm run release:notes -- --version <version> --output release-notes.md`; the workflow creates a
GitHub **draft** release and does not publish it. A check that did not run is not a passed check —
record it as not run rather than as a pass.

## Environment note

This dev host is macOS 12.7.6 on a `MacBookPro11,4`, whose last supported macOS is Monterey.
`npm run verify:electron` runs and passes there because the repository pins Electron 43; Electron
44 and above need macOS 13. On a Linux CI runner without a keyring,
`RuntimeCapabilities.credentialPersistence` is `'session'` and the Desktop Keychain step asserts a
refusal rather than a round-trip. See the memory note on this host for detail.

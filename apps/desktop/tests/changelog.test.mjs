import assert from 'node:assert/strict'
import test from 'node:test'
import { parseChangelog, releaseNotes, validateProject } from '../../../scripts/changelog.mjs'

test('the repository keeps workspace versions and a dated release section in sync', () => {
  const result = validateProject()
  assert.equal(result.version, '0.1.0')
  assert.equal(result.versions.length, 7)
  assert.equal(result.entry.version, 'Unreleased')
  assert.match(result.entry.body, /Keep this section updated/)
  assert.equal(result.changelog.entries.find(entry => entry.version === '0.1.0')?.date, '2026-09-16')
})

test('release notes are extracted from the matching changelog section', () => {
  const notes = releaseNotes(undefined, '0.1.0')
  assert.match(notes, /^# PureTerm 0\.1\.0/m)
  assert.match(notes, /Desktop installers and update metadata/)
  assert.doesNotMatch(notes, /Keep this section updated/)
  assert.doesNotMatch(notes, /^\[[^\]]+\]:/m)
})

test('changelog parser keeps version headings separate and preserves dates', () => {
  const entries = parseChangelog('# Changelog\n\n## [Unreleased]\n\n### Added\n- next\n\n## [1.2.3] - 2026-09-16\n\n### Fixed\n- bug\n')
  assert.deepEqual(entries.map(entry => ({ version: entry.version, date: entry.date })), [
    { version: 'Unreleased', date: null }, { version: '1.2.3', date: '2026-09-16' },
  ])
  assert.match(entries[1].body, /### Fixed/)
})

test('release validation rejects a missing version section', () => {
  assert.throws(() => validateProject(undefined, '9.9.9'), /no \[9\.9\.9\] section/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readPartials, totalImports } from './partial-list.mjs'

// tokens.css holds the new ramp and legacy.css holds the debt register; both
// are the sanctioned homes for a colour literal. Every other partial must
// resolve colour through a token, which is what makes the debt permanent. The
// exemption is audited, not just declared: it has to stay exactly the two
// literal registers, every member still has to be a partial the manifest
// imports, and the scan has to cover the rest. Deleting styles/legacy.css in
// Plan 2 therefore fails here until the set shrinks with it.
const EXEMPT = new Set(['tokens', 'legacy'])
const SANCTIONED = ['legacy', 'tokens']
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/

// legacy.css is exempt from the rule above, so "reference an existing entry,
// do not add one" has to be a number rather than prose: a fresh line there
// hides from every other check. Plan 2 shrinks it as the palette flips.
const LEGACY_DECLARATIONS = 100

// Holdovers the plan keeps verbatim even though no partial reads them:
// --legacy-surface-sunken's #1c2033 is routed to --legacy-surface-tab-session
// by the mapping table. The register stays complete for the flip, so the
// exception is named here instead of dropped from the file; Plan 2 should
// shrink this set to empty.
const UNREFERENCED_LEGACY = new Set(['--legacy-surface-sunken'])

// Comments document, they do not declare: see design-tokens.test.mjs. A comment
// is blanked rather than deleted so an offender keeps its real line number.
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
}

test('no partial hard-codes a colour', async () => {
  const { manifest, names, texts } = await readPartials()
  assert.deepEqual([...EXEMPT].sort(), SANCTIONED,
    'only the two literal registers may be exempt; exempting a partial that resolves colour through tokens would make this test decorative')
  for (const name of EXEMPT) {
    assert.ok(names.includes(name),
      `EXEMPT still lists styles/${name}.css, which the manifest no longer imports; drop the exemption`)
  }
  // A url(...) import yields no name, so the file would ship in the cascade and
  // never be scanned; the Tabler line is the manifest's only non-partial import.
  assert.equal(totalImports(manifest), names.length + 1,
    'every @import in style.css must be one partial plus the Tabler line; an import form the name parser drops escapes this test')
  const reports = []
  let scanned = 0
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    if (EXEMPT.has(name)) continue
    scanned += 1
    const offenders = withoutComments(text).split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => LITERAL.test(line))
    if (offenders.length) {
      reports.push(`styles/${name}.css\n` + offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n'))
    }
  }
  assert.equal(scanned, names.length - EXEMPT.size,
    'the scan must cover exactly the non-exempt partials; a third escape route is not allowed')
  assert.equal(reports.length, 0, `colours must resolve through tokens:\n\n${reports.join('\n\n')}`)
})

// The register, comments gone, with the entry names it declares.
async function legacyRegister() {
  const { names, texts } = await readPartials()
  assert.notEqual(names.indexOf('legacy'), -1,
    'styles/legacy.css is the register these guards measure; when Plan 2 deletes it, delete them too')
  const source = withoutComments(texts[names.indexOf('legacy')])
  const declared = [...source.matchAll(/^[ \t]*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
  return { source, declared }
}

test('the legacy register holds exactly its measured declarations', async () => {
  const { source, declared } = await legacyRegister()
  assert.equal(declared.length, LEGACY_DECLARATIONS,
    `styles/legacy.css declares ${declared.length} entries, not ${LEGACY_DECLARATIONS}; the register is a deletion list, not a place to add colours`)
  assert.equal((source.match(/;/g) || []).length, LEGACY_DECLARATIONS,
    'every semicolon in styles/legacy.css must close a register entry; nothing else may be declared there')
})

test('every legacy entry is read by a partial, or named in the allowlist', async () => {
  const { declared } = await legacyRegister()
  const { names, texts } = await readPartials()
  const styled = names.filter((n) => n !== 'legacy')
    .map((n) => withoutComments(texts[names.indexOf(n)]))
    .join('\n')
  const referenced = new Set([...styled.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]))
  const orphans = declared.filter((name) => name.startsWith('--legacy-')
    && !referenced.has(name) && !UNREFERENCED_LEGACY.has(name))
  assert.deepEqual(orphans, [], `unreferenced without being allowlisted: ${orphans.join(', ')}`)
  // The allowlist shrinks too: a holdover that leaves the register, or gains a
  // call site, has no business staying named here.
  for (const name of UNREFERENCED_LEGACY) {
    assert.ok(declared.includes(name), `${name} is allowlisted but no longer declared; shrink the allowlist`)
    assert.ok(!referenced.has(name), `${name} has a call site again; shrink the allowlist`)
  }
})

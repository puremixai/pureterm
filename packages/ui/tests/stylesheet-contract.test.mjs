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
//
// Measured after each flipped partial, never remembered by hand: it started at
// 100 and only falls, because the liveness test below names whatever a flip
// orphans. Update it from the test output, not from a count you did mentally.
const LEGACY_DECLARATIONS = 37

// The four non-colour names, so a re-declaration in the register fails by name
// rather than by a confusing count.
const NOT_COLOUR_DEBT = ['--radius-sm', '--radius-md', '--radius-lg', '--motion-standard']

// Holdovers the plan keeps verbatim even though no partial reads them:
// --legacy-surface-sunken's #1c2033 is routed to --legacy-surface-tab-session
// by the mapping table. The register stays complete for the flip, so the
// exception is named here instead of dropped from the file; Plan 2 should
// shrink this set to empty.
const UNREFERENCED_LEGACY = new Set(['--legacy-surface-sunken'])

// styles/fonts.css is the one partial that declares a face, which is the only
// place a family name may be written rather than asked for through a token. The
// censuses below read its face blocks out of the text, so this file has to stay
// the only place a face is declared; that is asserted, not assumed.
const FACE_SOURCE = 'fonts'

// The Inter files @fontsource-variable/inter 5.3.0 really exposes. It has no
// per-weight entry point: one variable file per subset carries the whole
// 100-900 range, so subsetting is the only choice left and the two faces below
// are that choice — the latin pair, in normal style.
const INTER_FACES = [
  'inter-latin-wght-normal.woff2',
  'inter-latin-ext-wght-normal.woff2',
]

// Four weights, no more. Inter is a variable font and can render any value in
// 100-900, but the CJK and system fallbacks in --font-ui cannot: an off-scale
// 650 or 750 asks a fallback for a weight it does not have, so the browser
// synthesises one, and synthetic bold on 13px UI text is the smear this list
// exists to prevent.
const WEIGHTS = new Set(['400', '500', '600', '700', 'normal', 'bold'])

// Comments document, they do not declare: see design-tokens.test.mjs. A comment
// is blanked rather than deleted so an offender keeps its real line number.
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
}

// Reads one partial with comments gone. Comment blanking keeps the newlines, so
// an offender keeps the line number a reader sees in the file.
function sourceOf(names, texts, name) {
  assert.notEqual(names.indexOf(name), -1,
    `styles/${name}.css is a contract these tests measure; if the file moved, move the contract with it`)
  return withoutComments(texts[names.indexOf(name)])
}

// The two censuses read @font-face blocks out of the text, because a face names
// a family and publishes a weight range instead of asking for either. That
// carve-out is only honest if a face cannot be hidden in an arbitrary partial,
// so exactly one file may hold them.
function withoutFaces(text) {
  return text.replace(/@font-face\s*\{[^}]*\}/g, (block) => block.replace(/[^\n]/g, ''))
}

function censusSource(text) {
  return withoutFaces(withoutComments(text))
}

// Every declaration of `property` in the scanned text, with its line number.
function declarations(text, property) {
  const pattern = new RegExp(`(?<![-\\w])${property}\\s*:\\s*([^;]+);`, 'g')
  return [...text.matchAll(pattern)].map((match) => ({
    line: text.slice(0, match.index).split('\n').length,
    property: match[0].slice(0, match[0].indexOf(':')),
    value: match[1].trim(),
  }))
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
  for (const name of NOT_COLOUR_DEBT) {
    assert.ok(!declared.includes(name),
      `${name} is geometry or motion, not colour debt: it belongs in styles/tokens.css, not the deletion list`)
  }
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

// The test above reads declarations and asks whether anything references them.
// This one reads references and asks whether anything declares them, which is
// the direction that has no guard today. It matters more than it looks: an
// unknown custom property is not an error, it is substituted at computed-value
// time, so `padding: var(--s-3x)` does not fail the build and does not print a
// warning — the declaration simply stops existing on the page. Every one of the
// new ramp's ~90 call sites is still unwritten, so the palette flip will create
// the whole exposure in a single commit, and a transposed suffix in a partial
// (`--fs-metax`) or inside a token value (`var(--c-canvasx)`) is exactly the
// mistake this catches. The registers' own references are scanned too: a token
// may be exempt from the literal rule, but it is not exempt from pointing at a
// name that exists.
test('every var() reference names a token one of the registers declares', async () => {
  const { names, texts } = await readPartials()
  const declared = new Set()
  for (const register of SANCTIONED) {
    for (const match of sourceOf(names, texts, register).matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      declared.add(match[1])
    }
  }
  assert.ok(declared.size > 0, 'the registers declare no tokens at all; the set is the contract')
  const reports = []
  let scanned = 0
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    scanned += 1
    // Line numbers come from the blanked source: blanking keeps every newline,
    // so a reference reports the line a reader finds in the file.
    const source = withoutComments(text)
    const offenders = [...source.matchAll(/var\(\s*(--[a-z0-9-]+)/g)]
      .filter((match) => !declared.has(match[1]))
      .map((match) => `  ${source.slice(0, match.index).split('\n').length}: var(${match[1]}) is declared nowhere`)
    if (offenders.length) reports.push(`styles/${name}.css\n${[...new Set(offenders)].join('\n')}`)
  }
  assert.equal(scanned, names.length,
    'the reference check must cover every partial the manifest imports; an unchecked file is an escape route')
  assert.equal(reports.length, 0,
    `every var() must name a token declared in styles/tokens.css or styles/legacy.css:\n\n${reports.join('\n\n')}`)
})

// A face names a family and publishes a weight range instead of asking for one,
// so the censuses read @font-face blocks out of their text. That is only safe
// because exactly one file may hold them.
test('only styles/fonts.css declares a face', async () => {
  const { names, texts } = await readPartials()
  const strays = names.filter((name) => name !== FACE_SOURCE && /@font-face/.test(withoutComments(texts[names.indexOf(name)])))
  assert.deepEqual(strays, [],
    `faces belong in styles/${FACE_SOURCE}.css, which the censuses read out of their own text: ${strays.map((n) => `styles/${n}.css`).join(', ')}`)
})

// The app bundles its own faces, so a package entry point in the manifest would
// be a licence to ship every subset: every CSS file
// @fontsource-variable/inter exposes declares all seven at once. Asserting the
// shipped file names, rather than the package name, is what makes an upgrade
// that renames or re-splits them fail here instead of quietly widening every
// installer.
test('the cascade bundles the Inter faces it renders', async () => {
  const { manifest, names, texts } = await readPartials()
  assert.match(manifest, /^[ \t]*@import\s+['"]\.\/styles\/fonts\.css['"];?[ \t]*$/m,
    'styles/fonts.css must reach the page through the manifest, or the faces below are dead files')
  assert.ok(!/@fontsource/.test(withoutComments(manifest)),
    'style.css must not import an @fontsource entry point directly; each of that package\'s CSS files references all seven subsets and would ship greek, cyrillic and vietnamese for a page that renders none of them')
  const faces = [...sourceOf(names, texts, FACE_SOURCE).matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
  assert.equal(faces.length, INTER_FACES.length,
    `styles/${FACE_SOURCE}.css declares ${faces.length} @font-face rules for ${INTER_FACES.length} bundled files; a face without a file, or a file without a face, is a download that never lands`)
  const shipped = faces.map((face) => {
    const url = /url\(\s*['"]?([^'")]+?)['"]?\s*\)/.exec(face)
    assert.ok(url, `an @font-face declares no src url:\n${face.trim()}`)
    return url[1].split('/').pop()
  })
  assert.deepEqual([...shipped].sort(), [...INTER_FACES].sort(),
    `styles/${FACE_SOURCE}.css must reference exactly the two latin variable files (${INTER_FACES.join(', ')}), found ${shipped.join(', ')}`)
  // --font-ui asks for a family by name; the bundled face has to carry that
  // exact name, or the token silently selects a system font and nothing here
  // can tell. The @fontsource-variable packages name their family
  // "Inter Variable", which is not what --font-ui says.
  const token = /--font-ui:\s*([^;]+)/.exec(sourceOf(names, texts, 'tokens'))
  assert.ok(token, 'tokens.css must declare --font-ui')
  const asked = token[1].trim().split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  faces.forEach((face, index) => {
    assert.match(face, new RegExp(`font-family:\\s*['"]?${asked}['"]?\\s*;`),
      `face ${index} must be named ${asked}, the first family --font-ui asks for`)
    assert.match(face, /font-weight:\s*100 900\s*;/, `face ${index} must publish the whole variable weight range`)
    assert.match(face, /font-style:\s*normal\s*;/, `face ${index} must be the normal style; this UI has no italic text`)
    assert.match(face, /unicode-range:/, `face ${index} must carry a unicode-range, or latin-ext swallows every glyph latin already covers`)
  })
})

test('text asks for one of the four weights this app ships', async () => {
  const { names, texts } = await readPartials()
  const reports = []
  let scanned = 0
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    scanned += 1
    const offenders = declarations(censusSource(text), 'font-weight')
      .filter(({ value }) => !WEIGHTS.has(value))
      .map(({ line, value }) => `  ${line}: font-weight: ${value};`)
    if (offenders.length) reports.push(`styles/${name}.css\n${offenders.join('\n')}`)
  }
  assert.equal(scanned, names.length,
    'the census must cover every partial the manifest imports; an unchecked file is an escape route')
  assert.equal(reports.length, 0,
    `only ${[...WEIGHTS].join('/')} are available across Inter and the system fallbacks:\n\n${reports.join('\n\n')}`)
})

// Inherited 600-800 weights make an icon webfont that owns only one weight
// synthesise a bold it does not have, which reads as smeared glyphs at the
// 20-25px sizes the chrome uses. Tabler ships `font-weight: normal` on .ti, but
// it is imported first, so a later partial can undo it; the pin has to live in
// this cascade to stop that.
test('base.css pins the icon font to the weight it actually has', async () => {
  const { names, texts } = await readPartials()
  const rule = /\.ti\s*\{([^}]*)\}/.exec(sourceOf(names, texts, 'base'))
  assert.ok(rule, 'styles/base.css must carry a .ti rule pinning the icon font')
  assert.match(rule[1], /font-weight:\s*400\s*;/, 'the icon font must be pinned to 400')
  assert.match(rule[1], /font-style:\s*normal\s*;/, 'synthetic oblique on an icon is a distorted glyph, not a style')
  assert.match(rule[1], /-webkit-font-smoothing:\s*antialiased\s*;/, 'icons must match the body smoothing')
})

test('no partial hard-codes a font stack', async () => {
  const { names, texts } = await readPartials()
  const RESOLVES = /var\(--font-(?:ui|mono|term)\)/
  const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/
  const reports = []
  let scanned = 0
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    scanned += 1
    const source = censusSource(text)
    const offenders = [
      ...declarations(source, 'font-family'),
      // `font:` also picks a family, so a shorthand would be an escape route.
      ...declarations(source, 'font'),
    ]
      .filter(({ value }) => !RESOLVES.test(value) && !CSS_WIDE.test(value))
      .map(({ line, value }) => `  ${line}: font-family resolves to ${value}`)
    if (offenders.length) reports.push(`styles/${name}.css\n${offenders.join('\n')}`)
  }
  assert.equal(scanned, names.length,
    'the census must cover every partial the manifest imports; an unchecked file is an escape route')
  assert.equal(reports.length, 0,
    `every family must resolve through --font-ui, --font-mono or --font-term:\n\n${reports.join('\n\n')}`)
})

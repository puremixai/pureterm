import assert from 'node:assert/strict'
import test from 'node:test'
import { readPartials, totalImports } from './partial-list.mjs'
import { DARK, LIGHT, ratio, token, triplet } from './token-source.mjs'

// tokens.css is the only sanctioned home for a colour literal. Every other
// partial must resolve colour through a token, which is what makes the debt
// permanent. The exemption is audited, not just declared: it has to stay
// exactly the one register, its member still has to be a partial the manifest
// imports, and the scan has to cover the rest.
const EXEMPT = new Set(['tokens'])
const SANCTIONED = ['tokens']
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/

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
  const { groups, names, texts } = await readPartials()
  assert.deepEqual([...EXEMPT].sort(), SANCTIONED,
    'only the two literal registers may be exempt; exempting a partial that resolves colour through tokens would make this test decorative')
  for (const name of EXEMPT) {
    assert.ok(names.includes(name),
      `EXEMPT still lists styles/${name}.css, which the manifest no longer imports; drop the exemption`)
  }
  // A url(...) import yields no name, so the file would ship in the cascade and
  // never be scanned. The Tabler line is the only non-partial import and it is in
  // style.css alone; desktop.css is one import per partial and nothing else.
  for (const group of groups) {
    const external = group.name === 'style.css' ? 1 : 0
    assert.equal(totalImports(group.manifest), group.names.length + external,
      `every @import in ${group.name} must be one partial, plus the Tabler line in style.css; an import form the name parser drops escapes this test`)
  }
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

// Reads references and asks whether anything declares them. An unknown custom
// property is not an error: it is substituted at computed-value time, so
// `padding: var(--s-3x)` fails no build and prints no warning — the declaration
// simply stops existing on the page. The palette flip wrote ~150 references to
// new-ramp names in one pass, which is exactly when a transposed suffix in a
// partial (`--fs-metax`) or inside a token value (`var(--c-canvasx)`) would
// slip through. tokens.css is scanned too: a register may be exempt from the
// literal rule, but it is not exempt from pointing at a name that exists.
test('every var() reference names a token the register declares', async () => {
  const { names, texts } = await readPartials()
  const declared = new Set()
  for (const register of SANCTIONED) {
    for (const match of sourceOf(names, texts, register).matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      declared.add(match[1])
    }
  }
  assert.ok(declared.size > 0, 'the register declares no tokens at all; the set is the contract')
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
    `every var() must name a token declared in styles/tokens.css:\n\n${reports.join('\n\n')}`)
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

// --tx-4 is the weakest rung the ramp owns — 2.25:1 on the darkest ground and
// 2.18:1 on the lightest — so it fails AA wherever a reader has to read it. A
// placeholder is the only sanctioned use: it names a field whose label is
// already on screen and it disappears on the first keystroke. The column header
// this catches was real text at 2.88:1.
//
// Exactly one selector is exempt, and it is named rather than described: the top
// bar's brand suffix (`/ Vault`, `/ Session`, 2.79:1 on --c-chrome dark and
// 2.28:1 light). It is decorative — it restates what the rail's active item and
// the panel's own heading already say, so losing it costs no information — and
// the prototype draws it at --tx-4. The exemption is audited the way EXEMPT is:
// it has to still be a selector some partial declares, so an exemption cannot
// outlive the rule it was written for.
const DECORATIVE_TX4 = new Set(['.workspace-copy small'])

test('the weakest text rung is only ever drawn on a placeholder', async () => {
  const { names, texts } = await readPartials()
  const offenders = []
  const exempted = new Set()
  // Rule-by-rule rather than line-by-line: the selector lives before the brace,
  // and a media block's prelude cannot match because the selector class excludes
  // a second brace.
  const RULE = /([^{}]+)\{([^{}]*)\}/g
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    const source = censusSource(text)
    for (const match of source.matchAll(RULE)) {
      const [, selector, body] = match
      if (/[:\s]color\s*:[^;]*var\(--tx-4\)/.test(body) && !selector.includes('::placeholder')) {
        const subject = selector.trim()
        if (DECORATIVE_TX4.has(subject)) {
          exempted.add(subject)
          continue
        }
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`  styles/${name}.css:${line}: "${subject}"`)
      }
    }
  }
  for (const exempt of DECORATIVE_TX4) {
    assert.ok(exempted.has(exempt),
      `"${exempt}" is exempt from the --tx-4 rule, but no partial draws it at --tx-4 any more; drop the exemption`)
  }
  assert.equal(offenders.length, 0,
    `--tx-4 is below AA as text; use --tx-3, or make the rule a ::placeholder:\n\n${offenders.join('\n')}`)
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

// Hairlines carry no AA obligation, but a border that computes to nothing is a
// defect: it is absent, not quiet. This reads the pairs the stylesheet actually
// paints — a rule with a `--line*` border and a `--c-*` background in the same
// block — rather than asserting a matrix of combinations nobody draws, which
// would pass while the one real case vanished. What motivated it: a toolbar
// separator on a --c-chrome ground measured 1.017:1 in the light theme.
// esbuild tolerates a declaration that lost its selector: it emits it, the
// browser drops it, and the rule is simply gone with every guard still green.
// This one had its selector eaten by an editing slip and 60 tests passed over it.
test('every partial is a parseable block structure', async () => {
  const { names, texts } = await readPartials()
  const broken = []
  for (const [name, text] of names.map((n, i) => [n, texts[i]])) {
    if (name === 'fonts') continue
    const source = withoutComments(text)
    const open = (source.match(/\{/g) || []).length
    const close = (source.match(/\}/g) || []).length
    if (open !== close) broken.push(`  styles/${name}.css: ${open} 左花括号 vs ${close} 右花括号`)
    // 这条规则只管一种具体的坏法：选择器没了、声明裸露在块外。本代码库每条规则都
    // 写成一行（选择器、`{`、声明、`}` 同一行），所以判据必须是「这一行开始时不在
    // 任何块内，行里又没有 `{`，却带着一条声明」—— 按行内花括号计数会把整行规则
    // 误判成块外声明，第一版就是这么错的。
    let depth = 0
    const newline = String.fromCharCode(10)
    for (const [index, line] of source.split(newline).entries()) {
      const outside = depth === 0
      for (const ch of line) { if (ch === '{') depth += 1; else if (ch === '}') depth = Math.max(0, depth - 1) }
      const body = line.trim()
      if (outside && !line.includes('{') && body !== '' && /[;}]$/.test(body) && body.includes(':')) {
        broken.push(`  styles/${name}.css:${index + 1}: 块外的声明 -> ${body.slice(0, 46)}`)
      }
    }
  }
  const joiner = String.fromCharCode(10)
  assert.deepEqual(broken, [], `这些行不在任何规则里，esbuild 会原样发出去，浏览器直接丢弃：${joiner}${broken.join(joiner)}`)
})

test('every hairline stays perceptible against the ground it is drawn on', async () => {
  const { names, texts } = await readPartials()
  // Keyed per rule, not per pair: keying by pair hid every rule after the first
  // and made the flip fix one divider at a time.
  const pairs = new Map()
  for (const [partial, fileText] of names.map((n, i) => [n, texts[i]])) {
    if (partial === 'tokens') continue
    for (const rule of withoutComments(fileText).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const border = /border(?:-[a-z]+)*\s*:\s*[^;]*var\((--line[a-z-]*)\)/.exec(rule[2])
      const ground = /background:\s*var\((--c-[a-z]+)\)/.exec(rule[2])
      if (border && ground) pairs.set(`${rule[1].trim().split('\n').pop()} { ${border[1]} on ${ground[1]} }`, [border[1], ground[1]])
    }
  }
  const reports = []
  for (const [label, [lineName, groundName]] of pairs) {
    for (const theme of [DARK, LIGHT]) {
      const got = ratio(triplet(token(theme, lineName)), triplet(token(theme, groundName)))
      if (got < 1.1) reports.push(`${theme}  ${label} is ${got.toFixed(3)}:1`)
    }
  }
  assert.deepEqual(reports, [], `hairlines that are effectively absent:\n${reports.join('\n')}`)
})

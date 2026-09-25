import { readFile } from 'node:fs/promises'

const manifestUrl = new URL('../src/style.css', import.meta.url)

// Two manifests, and the second one is the point. desktop.css carries the sheet the
// standalone Web entry must not have — the top bar's caption buttons — so a partial
// only that manifest imports would ship unscanned if these guards assumed style.css
// was the whole cascade. Reading both is what keeps "an unchecked file is an escape
// route" true for the file the Web entry does not load.
const MANIFESTS = ['style.css', 'desktop.css']

export async function readManifest() {
  return readFile(manifestUrl, 'utf8')
}

export function partialNames(manifest) {
  return [...manifest.matchAll(/@import\s+['"]\.\/styles\/([a-z-]+)\.css['"]/g)].map((m) => m[1])
}

// Counts @import lines that name a partial as a quoted path. Both quote styles
// parse, but the url(...) form does not: partialNames only yields a name when
// the whole line matches, so use totalImports to prove nothing was dropped.
export function styleImportCount(manifest) {
  return (manifest.match(/@import\s+['"]\.\/styles\//g) || []).length
}

// Every @import in the manifest, whatever form it uses, after comments go: the
// manifest header spells the word @import while explaining the rule, and a
// comment documents, it does not import. One external import (Tabler) plus one
// per partial is the only honest total.
export function totalImports(manifest) {
  const source = manifest.replace(/\/\*[\s\S]*?\*\//g, '')
  return (source.match(/@import\b/g) || []).length
}

export async function readPartials() {
  const manifests = await Promise.all(MANIFESTS.map((name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))
  const cache = new Map()
  const load = async (name) => {
    if (!cache.has(name)) cache.set(name, await readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8'))
    return cache.get(name)
  }
  const groups = []
  for (const [index, manifest] of manifests.entries()) {
    const names = partialNames(manifest)
    const texts = await Promise.all(names.map(load))
    groups.push({ name: MANIFESTS[index], manifest, names, texts, css: texts.join('\n') })
  }
  // The flat view is every partial of every manifest, in manifest order: the censuses
  // scan this, so a partial cannot be covered in one manifest and skipped in the other.
  const names = groups.flatMap((group) => group.names)
  const texts = groups.flatMap((group) => group.texts)
  return { manifest: manifests[0], manifests, groups, names, texts, css: texts.join('\n') }
}

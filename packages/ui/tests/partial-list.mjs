import { readFile } from 'node:fs/promises'

const manifestUrl = new URL('../src/style.css', import.meta.url)

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
  const manifest = await readManifest()
  const names = partialNames(manifest)
  const texts = await Promise.all(names.map((name) => readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8')))
  return { manifest, names, css: texts.join('\n'), texts }
}

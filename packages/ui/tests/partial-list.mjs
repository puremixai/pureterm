import { readFile } from 'node:fs/promises'

const manifestUrl = new URL('../src/style.css', import.meta.url)

export async function readManifest() {
  return readFile(manifestUrl, 'utf8')
}

export function partialNames(manifest) {
  return [...manifest.matchAll(/@import\s+['"]\.\/styles\/([a-z-]+)\.css['"]/g)].map((m) => m[1])
}

// Counts every @import line that targets the styles directory, whatever quote
// style it uses. partialNames only yields a name when the whole line parses, so
// comparing the two catches an import form the parser silently drops.
export function styleImportCount(manifest) {
  return (manifest.match(/@import\s+['"]\.\/styles\//g) || []).length
}

export async function readPartials() {
  const manifest = await readManifest()
  const names = partialNames(manifest)
  const texts = await Promise.all(names.map((name) => readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8')))
  return { manifest, names, css: texts.join('\n'), texts }
}

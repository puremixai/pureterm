import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseChangelog, VERSION_PATTERN } from './changelog.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const changelogPath = join(root, 'CHANGELOG.md')

function fail(message) {
  throw new Error(message)
}

export function generateChangelog(projectRoot = root) {
  const sourcePath = join(projectRoot, 'CHANGELOG.md')
  if (!existsSync(sourcePath)) fail(`Missing changelog: ${sourcePath}`)
  const source = readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '')
  if (!/^# PureTerm\s*\r?\n/.test(source)) fail('CHANGELOG.md must start with # PureTerm.')
  const entries = parseChangelog(source)
  if (entries.length === 0) fail('CHANGELOG.md has no version sections.')
  const destination = join(projectRoot, 'packages', 'ui', 'src', 'lib')
  mkdirSync(destination, { recursive: true })
  const publicEntries = entries.map(({ version, date, body }) => ({ version, date, body }))
  const generated = [
    '// Generated from CHANGELOG.md by scripts/convert-changelog.js. Do not edit by hand.',
    `export const CHANGELOG = ${JSON.stringify(publicEntries, null, 2)} as const`,
    '',
  ].join('\n')
  writeFileSync(join(destination, 'changelog.ts'), generated, 'utf8')
  return entries
}

export function generateVersion(projectRoot = root) {
  const sourcePath = join(projectRoot, 'VERSION.txt')
  if (!existsSync(sourcePath)) fail(`Missing version file: ${sourcePath}`)
  const version = readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '').trim()
  if (!VERSION_PATTERN.test(version)) fail(`Invalid VERSION.txt value: ${version}`)
  const destination = join(projectRoot, 'packages', 'ui', 'src', 'lib')
  mkdirSync(destination, { recursive: true })
  const generated = [
    '// Generated from VERSION.txt by scripts/convert-changelog.js --sync-version. Do not edit by hand.',
    `export const VERSION = ${JSON.stringify(version)} as const`,
    'export const APP_VERSION = VERSION',
    '',
  ].join('\n')
  writeFileSync(join(destination, 'version.ts'), generated, 'utf8')
  return version
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--sync-version')) {
    console.error('Usage: node scripts/convert-changelog.js [--sync-version]')
    process.exitCode = 2
  } else {
    try {
      if (args[0] === '--sync-version') {
        console.log(`Generated packages/ui/src/lib/version.ts for ${generateVersion()}.`)
      } else {
        console.log(`Generated packages/ui/src/lib/changelog.ts from ${changelogPath}.`)
        generateChangelog()
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}

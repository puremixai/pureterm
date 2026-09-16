import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const VERSION_HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function workspacePackageFiles(projectRoot) {
  const files = [join(projectRoot, 'package.json')]
  for (const group of ['apps', 'packages']) {
    const directory = join(projectRoot, group)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(directory, entry.name, 'package.json'))) {
        files.push(join(directory, entry.name, 'package.json'))
      }
    }
  }
  return files
}

export function readProjectVersions(projectRoot = root) {
  return workspacePackageFiles(projectRoot).map(path => {
    const manifest = readJson(path)
    return { path, name: manifest.name, version: manifest.version }
  })
}

function readLockfileVersions(projectRoot, versions) {
  const path = join(projectRoot, 'package-lock.json')
  if (!existsSync(path)) fail(`Missing lockfile: ${path}`)
  const lockfile = readJson(path)
  for (const item of versions) {
    const packagePath = relative(projectRoot, item.path)
    const lockKey = packagePath === 'package.json'
      ? ''
      : packagePath.slice(0, -'package.json'.length).replace(/[\\/]+$/, '').split(sep).join('/')
    const lockVersion = lockfile.packages?.[lockKey]?.version
    if (lockVersion !== item.version) {
      fail(`package-lock.json ${lockKey || '(root)'} version ${lockVersion ?? '(missing)'} must match ${item.version}.`)
    }
  }
}

export function readSourceVersion(projectRoot = root) {
  const path = join(projectRoot, 'VERSION.txt')
  if (!existsSync(path)) fail(`Missing version file: ${path}`)
  const version = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
  if (!VERSION_PATTERN.test(version)) fail(`Invalid VERSION.txt value: ${version}`)
  return version
}

export function parseChangelog(text) {
  const withoutCollapsedTranslations = text.replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '')
  const lines = withoutCollapsedTranslations.replace(/^\uFEFF/, '').split(/\r?\n/)
  const entries = []
  let current
  for (const line of lines) {
    const match = line.match(VERSION_HEADING)
    if (match) {
      current = { version: match[1], date: match[2] ?? null, lines: [] }
      entries.push(current)
    } else if (current) {
      current.lines.push(line)
    }
  }
  return entries.map(entry => ({
    ...entry,
    body: entry.lines
      .filter(line => !/^\[[^\]]+\]:\s+\S+\s*$/.test(line.trim()))
      .join('\n')
      .trim(),
  }))
}

export function readChangelog(projectRoot = root) {
  const path = join(projectRoot, 'CHANGELOG.md')
  if (!existsSync(path)) throw new Error(`Missing changelog: ${path}`)
  return { path, text: readFileSync(path, 'utf8'), entries: parseChangelog(readFileSync(path, 'utf8')) }
}

function fail(message) {
  throw new Error(message)
}

export function validateProject(projectRoot = root, releaseVersion) {
  const versions = readProjectVersions(projectRoot)
  const invalid = versions.filter(item => typeof item.version !== 'string' || !VERSION_PATTERN.test(item.version))
  if (invalid.length) fail(`Invalid package version(s): ${invalid.map(item => `${item.name}=${item.version}`).join(', ')}`)
  const uniqueVersions = new Set(versions.map(item => item.version))
  if (uniqueVersions.size !== 1) {
    fail(`Workspace package versions must match: ${versions.map(item => `${item.name}=${item.version}`).join(', ')}`)
  }
  readLockfileVersions(projectRoot, versions)
  const projectVersion = versions[0]?.version
  const sourceVersion = readSourceVersion(projectRoot)
  if (sourceVersion !== projectVersion) {
    fail(`VERSION.txt (${sourceVersion}) must match workspace version ${projectVersion}.`)
  }
  const changelog = readChangelog(projectRoot)
  const changelogText = changelog.text.replace(/^\uFEFF/, '')
  if (!/^# PureTerm(?:\r?\n|$)/.test(changelogText)) {
    fail('CHANGELOG.md must start with # PureTerm.')
  }
  const unreleased = changelog.entries.find(entry => entry.version === 'Unreleased')
  if (!unreleased) {
    fail('CHANGELOG.md must contain an [Unreleased] section.')
  }
  if (unreleased.body && !/^###\s+/m.test(unreleased.body)) {
    fail('CHANGELOG.md [Unreleased] content must be grouped under a category heading.')
  }
  const generatedVersionPath = join(projectRoot, 'packages', 'ui', 'src', 'lib', 'version.ts')
  if (!existsSync(generatedVersionPath)) {
    fail(`Missing generated version file: ${generatedVersionPath}`)
  }
  const generatedVersion = readFileSync(generatedVersionPath, 'utf8').match(/export const VERSION = ["']([^"']+)["'] as const/)?.[1]
  if (generatedVersion !== projectVersion) {
    fail(`Generated UI version ${generatedVersion ?? '(missing)'} must match workspace version ${projectVersion}.`)
  }
  const generatedChangelogPath = join(projectRoot, 'packages', 'ui', 'src', 'lib', 'changelog.ts')
  if (!existsSync(generatedChangelogPath)) {
    fail(`Missing generated changelog file: ${generatedChangelogPath}`)
  }
  const generatedChangelog = readFileSync(generatedChangelogPath, 'utf8')
  const generatedChangelogJson = generatedChangelog.match(/^export const CHANGELOG = ([\s\S]*?) as const\s*$/m)?.[1]
  if (!generatedChangelogJson) {
    fail('Generated UI changelog has an invalid format.')
  }
  let generatedEntries
  try {
    generatedEntries = JSON.parse(generatedChangelogJson)
  } catch {
    fail('Generated UI changelog is not valid JSON data.')
  }
  const sourceEntries = changelog.entries.map(({ version, date, body }) => ({ version, date, body }))
  if (JSON.stringify(generatedEntries) !== JSON.stringify(sourceEntries)) {
    fail('Generated UI changelog is out of date; run node scripts/convert-changelog.js.')
  }
  if (releaseVersion !== undefined) {
    if (!VERSION_PATTERN.test(releaseVersion)) fail(`Invalid release version: ${releaseVersion}`)
    const entry = changelog.entries.find(item => item.version === releaseVersion)
    if (!entry) fail(`CHANGELOG.md has no [${releaseVersion}] section.`)
    if (releaseVersion !== projectVersion) fail(`Release version ${releaseVersion} does not match package version ${projectVersion}.`)
    if (!entry.date) fail(`CHANGELOG.md release [${releaseVersion}] must have a date.`)
    if (!entry.body || !/^###\s+/m.test(entry.body)) fail(`CHANGELOG.md release [${releaseVersion}] is empty.`)
    return { version: releaseVersion, entry, versions, changelog }
  }
  return { version: projectVersion, entry: unreleased, versions, changelog }
}

export function releaseNotes(projectRoot = root, releaseVersion) {
  const result = validateProject(projectRoot, releaseVersion)
  const body = result.entry.body
  return `# PureTerm ${result.version}\n\n${body}\n\n---\n\nDesktop installers and update metadata. Validate the artifacts before publishing this draft.\n`
}

function usage() {
  console.error('Usage: node scripts/changelog.mjs --check [--version <version>] | --notes --version <version> [--output <file>]')
  process.exitCode = 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const command = args[0]
  const versionIndex = args.indexOf('--version')
  const outputIndex = args.indexOf('--output')
  const releaseVersion = versionIndex >= 0 ? args[versionIndex + 1] : undefined
  const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined
  if (!['--check', '--notes'].includes(command) || (versionIndex >= 0 && !releaseVersion)
    || (outputIndex >= 0 && !output) || args.some((arg, index) =>
      !['--check', '--notes', '--version', '--output'].includes(arg)
      && (index === 0 || args[index - 1] !== '--version' && args[index - 1] !== '--output'))) {
    usage()
  } else {
    try {
      if (command === '--check') {
        const result = validateProject(root, releaseVersion)
        console.log(`Changelog and workspace versions are valid for ${result.version}.`)
      } else {
        if (!releaseVersion) fail('--notes requires --version <version>.')
        const notes = releaseNotes(root, releaseVersion)
        if (output) writeFileSync(resolve(output), notes, 'utf8')
        else process.stdout.write(notes)
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}

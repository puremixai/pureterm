import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceNames = ['host', 'protocol', 'transport', 'ui']
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

function contained(root, target) {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function installedPackage(name, from) {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error(`Invalid dependency name: ${name}`)
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(directory) === directory) break
  }
  throw new Error(`Missing installed dependency: ${name} (from ${from})`)
}

function copyFiles(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      const name = relative(source, path)
      if (name.split(sep).some(part => part === 'node_modules' || part === '.git') || name.endsWith('.node')) return false
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Unexpected symbolic link in runtime files: ${path}`)
      return true
    },
  })
}

function productionDependencies(manifest) {
  const dependencies = { ...manifest.dependencies }
  for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!manifest.peerDependenciesMeta?.[name]?.optional && name !== 'electron') dependencies[name] ??= version
  }
  // ssh2's cpu-features/nan/sshcrypto bindings are optional optimizations.
  // Stage the portable JS implementation so no Node/Electron ABI rebuild is needed.
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) delete dependencies[name]
  return dependencies
}

/** Materialize a self-contained app without workspace links or native optional dependencies. */
export function stageDesktop(projectRoot = resolve(import.meta.dirname, '..')) {
  const root = realpathSync(projectRoot)
  const output = join(root, '.release', 'app')
  const parent = dirname(output)
  for (const path of [parent, output]) {
    if (existsSync(path) && !contained(root, realpathSync(path))) throw new Error('Staging directory must stay inside the project workspace')
  }
  const desktopRoot = join(root, 'apps', 'desktop')
  const desktop = readJson(join(desktopRoot, 'package.json'))
  for (const artifact of [desktop.main, 'dist/electron/host/entry.js', 'dist/electron/carriers/preload.cjs']) {
    if (!artifact || !existsSync(join(desktopRoot, artifact))) throw new Error(`Missing built runtime artifact: ${artifact}. Run npm run build:desktop first.`)
  }
  for (const name of workspaceNames) {
    const dist = join(root, 'packages', name, 'dist')
    if (!existsSync(dist)) throw new Error(`Missing built runtime artifact: ${dist}. Run npm run build:desktop first.`)
  }
  if (!existsSync(join(root, 'packages', 'ui', 'dist', 'index.html'))) throw new Error('Missing built runtime artifact: UI index.html')

  // Both resolved ancestors were checked above before this bounded recursive deletion.
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  copyFiles(join(desktopRoot, 'dist'), join(output, 'dist'))
  const inventory = []
  const copied = new Map()
  const internals = new Map()
  for (const name of workspaceNames) {
    const source = join(root, 'packages', name)
    const destination = join(output, 'node_modules', '@pureterm', name)
    mkdirSync(destination, { recursive: true })
    copyFiles(join(source, 'dist'), join(destination, 'dist'))
    const manifest = readJson(join(source, 'package.json'))
    internals.set(manifest.name, { source, destination, manifest })
    copied.set(destination, source)
    writeJson(join(destination, 'package.json'), manifest)
  }

  function install(name, sourceParent, targetParent) {
    const internal = internals.get(name)
    if (internal) return internal.manifest.version
    const source = installedPackage(name, sourceParent)
    const manifest = readJson(join(source, 'package.json'))
    // Reuse only an ancestor dependency from the same installed source. Different
    // versions remain nested, retaining Node's normal module resolution behavior.
    for (let ancestor = targetParent; ; ancestor = dirname(ancestor)) {
      const candidate = join(ancestor, 'node_modules', name)
      if (copied.get(candidate) === source) return manifest.version
      if (ancestor === output || !contained(output, ancestor)) break
    }
    const destination = join(targetParent, 'node_modules', name)
    if (copied.has(destination)) throw new Error(`Conflicting staged dependency: ${name}`)
    copied.set(destination, source)
    copyFiles(source, destination)
    const dependencies = {}
    for (const child of Object.keys(productionDependencies(manifest))) dependencies[child] = install(child, source, destination)
    const { devDependencies, optionalDependencies, peerDependencies, peerDependenciesMeta, scripts, ...runtime } = manifest
    writeJson(join(destination, 'package.json'), { ...runtime, dependencies })
    inventory.push({ name: manifest.name, version: manifest.version, path: relative(output, destination).split(sep).join('/') })
    return manifest.version
  }

  for (const [name, { source, destination, manifest }] of internals) {
    const dependencies = {}
    // The browser bundle already embeds Cordis, xterm and their browser dependencies.
    if (name !== '@pureterm/ui') {
      for (const child of Object.keys(productionDependencies(manifest))) dependencies[child] = install(child, source, destination)
    }
    const { devDependencies, optionalDependencies, peerDependencies, peerDependenciesMeta, scripts, ...runtime } = manifest
    writeJson(join(destination, 'package.json'), { ...runtime, dependencies })
  }
  const dependencies = {}
  for (const name of Object.keys(productionDependencies(desktop))) dependencies[name] = install(name, desktopRoot, output)
  writeJson(join(output, 'package.json'), {
    name: 'pureterm', version: desktop.version, description: desktop.description ?? 'PureTerm SSH desktop client',
    author: 'Puremix AI', private: true, type: 'module', main: desktop.main,
    repository: { type: 'git', url: 'https://github.com/puremixai/pureterm.git' },
    dependencies,
  })
  writeJson(join(output, 'runtime-dependencies.json'), inventory.sort((a, b) => a.path.localeCompare(b.path)))
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/stage-desktop.mjs')
  console.log(`Staged desktop runtime: ${stageDesktop()}`)
}

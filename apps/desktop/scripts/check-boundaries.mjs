import { readdirSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourceRoots = ['src', 'shared', 'renderer', 'electron']
const slash = (path) => path.replaceAll('\\', '/')

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

function isElectronAdapter(file) {
  return file.startsWith('electron/app/') || file.startsWith('electron/diagnostics/')
    || ['electron/carriers/carrier-ipc.ts', 'electron/carriers/preload.ts'].includes(file)
}

/** Check both type and value imports: a type must not leak a forbidden runtime's concepts. */
export function checkBoundaries(root) {
  const failures = []
  for (const filePath of sourceRoots.flatMap((directory) => sourceFiles(resolve(root, directory)))) {
    const file = slash(relative(root, filePath))
    const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true)
    const fail = (node, message) => {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
      failures.push(`${file}:${line + 1}:${character + 1} ${message}`)
    }
    const requireFactories = new Set()
    const requireCalls = new Set(['require'])
    const moduleNamespaces = new Set()
    // Track createRequire aliases so a Node adapter cannot hide an Electron import behind one.
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !['node:module', 'module'].includes(statement.moduleSpecifier.text)) continue
      if (statement.importClause?.name) moduleNamespaces.add(statement.importClause.name.text)
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) moduleNamespaces.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if ((binding.propertyName ?? binding.name).text === 'createRequire') requireFactories.add(binding.name.text)
        }
      }
    }
    const isRequireFactory = (expression) => {
      if (ts.isIdentifier(expression)) return requireFactories.has(expression.text)
      const namespace = (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
        ? expression.expression : undefined
      if (!namespace || !ts.isIdentifier(namespace) || !moduleNamespaces.has(namespace.text)) return false
      const key = ts.isPropertyAccessExpression(expression) ? expression.name : expression.argumentExpression
      return (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'createRequire'
    }
    const collectRequire = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && ts.isCallExpression(node.initializer) && isRequireFactory(node.initializer.expression)) requireCalls.add(node.name.text)
      ts.forEachChild(node, collectRequire)
    }
    collectRequire(source)

    const checkSpecifier = (node) => {
      if (!node || !(ts.isStringLiteralLike(node))) {
        fail(node ?? source, 'Module specifier must be a literal for dependency checks.')
        return
      }
      const specifier = node.text
      if ((specifier === 'electron' || specifier.startsWith('electron/')) && !isElectronAdapter(file)) {
        fail(node, 'Electron is restricted to app, IPC/preload and diagnostics adapters.')
      }
      if (file.startsWith('shared/')) {
        fail(node, 'Shared protocol must not import another module.')
        return
      }
      if (file.startsWith('renderer/') && (isBuiltin(specifier) || specifier === 'electron' || specifier.startsWith('electron/'))) {
        fail(node, 'Browser must not import Node or Electron modules.')
      }
      if (specifier.startsWith('file:') || isAbsolute(specifier) || specifier.startsWith('#')) {
        fail(node, 'Use relative source imports or declared external packages, not path aliases or absolute modules.')
        return
      }
      if (!specifier.startsWith('.')) return
      const target = slash(relative(root, resolve(dirname(filePath), specifier)))
      if (target.startsWith('../') || !sourceRoots.some((directory) => target.startsWith(`${directory}/`))) {
        fail(node, 'Source imports must stay inside the application source roots.')
      } else if (file.startsWith('src/') && !/^(src|shared)\//.test(target)) {
        fail(node, 'Host may only import Host implementations and shared protocol.')
      } else if (file.startsWith('renderer/') && !/^(renderer|shared)\//.test(target)) {
        fail(node, 'Browser may only import browser modules and shared protocol.')
      } else if (file.startsWith('electron/')) {
        if (target.startsWith('src/') && !/^src\/host\.(js|ts)$/.test(target)) {
          fail(node, 'Use src/host.ts for all Host values and types.')
        }
        if (target.startsWith('renderer/')) fail(node, 'Electron must load built renderer assets, not import browser source.')
        if (file.startsWith('electron/runtime/') && !/^(electron\/runtime|shared)\//.test(target)) {
          fail(node, 'Runtime may only import runtime modules and shared protocol.')
        }
        if (file.startsWith('electron/bridge/') && !/^(electron\/(bridge|runtime)|shared)\//.test(target)
          && !/^src\/host\.(js|ts)$/.test(target)) {
          fail(node, 'Bridge may only import bridge/runtime modules, shared protocol and the Host facade.')
        }
        if (file.startsWith('electron/carriers/') && /^electron\/(app|diagnostics)\//.test(target)) {
          fail(node, 'Carriers must not depend on application assembly or diagnostics.')
        }
      }
    }

    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        checkSpecifier(node.moduleSpecifier)
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        checkSpecifier(node.moduleReference.expression)
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        checkSpecifier(node.argument.literal)
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && requireCalls.has(node.expression.text))
        || (ts.isCallExpression(node.expression) && isRequireFactory(node.expression.expression)))) {
        checkSpecifier(node.arguments[0])
      }
      if (file.startsWith('electron/') && !file.startsWith('electron/diagnostics/')) {
        const bindingKey = ts.isBindingElement(node) ? (node.propertyName ?? node.name) : undefined
        const bindingName = bindingKey && ts.isComputedPropertyName(bindingKey) ? bindingKey.expression : bindingKey
        const bindsInternals = bindingName && (ts.isIdentifier(bindingName) || ts.isStringLiteralLike(bindingName))
          && bindingName.text === 'internals'
        const objectAssignment = (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
          && ts.isObjectLiteralExpression(node.parent) && ts.isBinaryExpression(node.parent.parent)
          && node.parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.parent.parent.left === node.parent
        const assignedKey = objectAssignment ? node.name : undefined
        const assignedName = assignedKey && ts.isComputedPropertyName(assignedKey) ? assignedKey.expression : assignedKey
        const assignsInternals = assignedName && (ts.isIdentifier(assignedName) || ts.isStringLiteralLike(assignedName))
          && assignedName.text === 'internals'
        if ((ts.isPropertyAccessExpression(node) && node.name.text === 'internals')
          || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
            && node.argumentExpression.text === 'internals') || bindsInternals || assignsInternals) {
          fail(node, 'Host.internals is diagnostics-only; use the Host public API.')
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return failures
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--root')) {
    console.error('Usage: node scripts/check-boundaries.mjs [--root <application>]')
    process.exitCode = 1
  } else {
    try {
      const root = args[1] ? resolve(args[1]) : fileURLToPath(new URL('..', import.meta.url))
      const failures = checkBoundaries(root)
      if (failures.length) {
        console.error(failures.join('\n'))
        process.exitCode = 1
      } else console.log('ok  Host / browser / protocol / Electron dependency boundaries')
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}

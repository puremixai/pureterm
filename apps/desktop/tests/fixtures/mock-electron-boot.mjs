// Run the real boot CLI against a deterministic, short-lived Node child. Only the
// executable/process boundary is substituted; the boot verdict remains production code.
import { registerHooks } from 'node:module'

// Keep the CLI timeout test fast without changing its production timeout constant.
if (process.env.BOOT_TEST_SCENARIO === 'timeout-tree') {
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback, milliseconds, ...args) =>
    originalSetTimeout(callback, milliseconds === 60_000 ? 500 : milliseconds, ...args)
}

const childModule = 'test:boot-child-process'
const electronModule = 'test:boot-electron'
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { url: electronModule, shortCircuit: true }
    if (specifier === 'node:child_process' && context.parentURL !== childModule) {
      return { url: childModule, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === electronModule) return { format: 'module', shortCircuit: true, source: 'export default process.execPath' }
    if (url === childModule) return { format: 'module', shortCircuit: true, source: `
      import { spawn as realSpawn } from 'node:child_process'
      export * from 'node:child_process'
      export function spawn(_executable, _args, options) {
        const scenario = process.env.BOOT_TEST_SCENARIO
        let code = 'console.log("[main] 闸门已打开"); console.log("[BOOT-OK]");' +
          (scenario === 'failure-marker' ? 'console.log("[BOOT-FAIL]");' : '') +
          (scenario === 'unhandled-rejection' ? 'console.error("[main] unhandledRejection: Error: asynchronous startup failure");' : '') +
          'process.exit(' + (scenario === 'nonzero-exit' ? 9 : 0) + ')'
        if (scenario === 'timeout-tree') code = [
          'console.log("[main] 闸门已打开"); console.log("[BOOT-OK]");',
          'console.log("[BOOT-PARENT] " + process.pid);',
          'console.log("[BOOT-TEMP] " + process.env.SSH_CORDIS_DATA_DIR);',
          'const { spawn } = require("node:child_process");',
          'const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "inherit", windowsHide: true });',
          'console.log("[BOOT-CHILD] " + child.pid); setInterval(()=>{},1000);',
        ].join(' ')
        return realSpawn(process.execPath, ['-e', code], options)
      }
    ` }
    return nextLoad(url, context)
  },
})

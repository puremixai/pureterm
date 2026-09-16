import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Resolve compiled assets from this module, regardless of the process working directory. */
export function resolveDesktopPaths(): {
  distDir: string
  rendererDir: string
  rendererHtml: string
  preloadScript: string
} {
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const rendererDir = dirname(fileURLToPath(import.meta.resolve('@pureterm/ui/index.html')))
  return {
    distDir,
    rendererDir,
    rendererHtml: join(rendererDir, 'index.html'),
    preloadScript: join(distDir, 'electron', 'carriers', 'preload.cjs'),
  }
}

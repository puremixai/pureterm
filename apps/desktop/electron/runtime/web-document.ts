import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

export const DESKTOP_ORIGIN = 'pureterm-app://app'
export const DESKTOP_PAGE = `${DESKTOP_ORIGIN}/`

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon',
}
const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
}

/** Load packaged assets without waiting for the Host or exposing local paths to the page. */
export async function serveWebDocument(request: Request, directory: string): Promise<Response> {
  const url = new URL(request.url)
  const failure = (status: number): Response => new Response(null, { status, headers: HEADERS })
  if (url.protocol !== 'pureterm-app:' || url.host !== 'app' || url.username || url.password) return failure(404)
  if (!['GET', 'HEAD'].includes(request.method)) return failure(405)
  let path: string
  try { path = decodeURIComponent(url.pathname) } catch { return failure(400) }
  if (path.includes('\0')) return failure(400)
  if (path.includes('\\')) return failure(403)
  const root = resolve(directory)
  const target = resolve(root, `.${path === '/' ? '/index.html' : path}`)
  if (!target.startsWith(root + sep)) return failure(403)
  try {
    const bytes = await readFile(target)
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), {
      headers: { ...HEADERS, 'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream' },
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return failure(code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR' ? 404 : 500)
  }
}

export interface DesktopSocketOwner {
  webContentsId: number
  hostUrl: string
  desktopToken: string
}

/** Credentials belong to the current shell window and its exact private Host endpoint. */
export function authorizeDesktopSocket(request: {
  url: string
  webContentsId?: number
  isMainFrame: boolean
  requestHeaders: Record<string, string>
}, owner: DesktopSocketOwner | undefined): { cancel?: boolean; requestHeaders?: Record<string, string> } {
  if (!owner || request.webContentsId !== owner.webContentsId) return {}
  if (!request.isMainFrame) return { cancel: true }
  const host = new URL(owner.hostUrl)
  const expected = new URL('/ws', host)
  expected.protocol = 'ws:'
  if (request.url !== expected.href) return {}
  const headers = Object.fromEntries(Object.entries(request.requestHeaders).map(([key, value]) => [key.toLowerCase(), value]))
  if (headers.origin !== DESKTOP_ORIGIN) return { cancel: true }
  delete headers.cookie
  headers.origin = host.origin
  headers.authorization = `Bearer ${owner.desktopToken}`
  return { requestHeaders: headers }
}

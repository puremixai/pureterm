import type { RendererReadyPayload } from '@pureterm/protocol'

export function normalizeReadyPayload(payload: unknown): RendererReadyPayload {
  const raw = (payload ?? {}) as Record<string, unknown>
  const info: RendererReadyPayload = {
    ok: raw.ok === true,
    hosts: Number(raw.hosts) || 0,
    cols: Number(raw.cols) || 0,
    rows: Number(raw.rows) || 0,
  }
  if (typeof raw.error === 'string' && raw.error) info.error = raw.error
  return info
}

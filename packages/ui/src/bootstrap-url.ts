/** HTTP already exchanged this token for an HttpOnly cookie before loading the UI. */
export function withoutBootstrapToken(location: string): string | undefined {
  const url = new URL(location)
  if (!url.searchParams.has('token')) return undefined
  url.searchParams.delete('token')
  return url.href
}

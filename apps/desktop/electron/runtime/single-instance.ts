/*
 * Desktop single-instance ownership.
 *
 * Electron already serialises two processes that share one `userData`, but it has
 * no opinion about two launches that resolve the *same SSH data directory* while
 * claiming different profiles. This seam asks for the application lock once and
 * routes a later launch to the owner, and it imports no Electron API so the
 * decision can be tested without a window.
 *
 * The lock is held for the whole process lifetime; the loser quits before it
 * reads a launch profile, touches the store, or starts a Host.
 */

/** The minimal structural surface this module needs from Electron's `app`. */
export interface SingleInstanceApplication {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean
  on(
    event: 'second-instance',
    listener: (event: unknown, argv: string[], workingDirectory: string, additionalData: unknown) => void,
  ): unknown
  quit(): void
}

/** Read the data directory a second launch asked for, if it supplied one. */
function requestedDataDir(additionalData: unknown): string | undefined {
  if (!additionalData || typeof additionalData !== 'object') return undefined
  const value = (additionalData as Record<string, unknown>).dataDir
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Claim the single-instance lock.
 *
 * Returns `true` for the owner; `false` for a loser, after asking it to quit. The
 * owner registers the `second-instance` handler, which reports the directory the
 * newcomer asked for so the caller can focus itself (same directory) or explain
 * that it will not switch (different directory).
 */
export function claimDesktopSingleInstance(
  application: SingleInstanceApplication,
  dataDir: string,
  focusOwner: (requestedDataDir: string) => void,
): boolean {
  if (!application.requestSingleInstanceLock({ dataDir })) {
    application.quit()
    return false
  }
  application.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    focusOwner(requestedDataDir(additionalData) ?? dataDir)
  })
  return true
}

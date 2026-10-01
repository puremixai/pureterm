/**
 * Host lifecycle facts, admission leases, and shutdown outcomes.
 *
 * Neutral shapes shared by Host, transport and the Desktop shell. A snapshot
 * carries **counts only** — no host names, paths, passwords, tokens, commands,
 * or terminal output — so it is safe to put in front of a user and to cross the
 * private parent/child RPC unchanged.
 *
 * The four numbers describe work the Host has accepted:
 *   - `activeSessions` counts live terminal bridges;
 *   - `pendingConnections` counts admitted `openTerminal()` calls until settlement;
 *   - `pendingFileOperations` counts the five public SFTP calls in flight;
 *   - `pendingMutations` counts queued and running host/Keychain writes.
 * Continuous monitor probes are internal and are deliberately **not** counted:
 * polling alone must never keep a drain busy or trigger a quit warning.
 */

export interface HostActivitySnapshot {
  activeSessions: number
  pendingConnections: number
  pendingFileOperations: number
  pendingMutations: number
}

/**
 * The in-process lifecycle surface on `Host` and `WebHost`.
 *
 * `prepareShutdown` closes admission synchronously and is idempotent for the
 * same lease; a different lease fails with `host.lifecycle-busy`. `drainAccepted`
 * waits for finite accepted work (not live terminal streams) and reports
 * `host.lifecycle-drain-timeout` without discarding accepted promises or
 * unlocking admission. `cancelShutdown` returns `true` only when it released the
 * current lease, so a stale cancellation can never reopen a newer one.
 */
export interface HostLifecycle {
  inspectActivity(): HostActivitySnapshot
  prepareShutdown(leaseId: string): HostActivitySnapshot
  drainAccepted(leaseId: string, timeoutMs: number): Promise<HostActivitySnapshot>
  cancelShutdown(leaseId: string): boolean
}

/** The same surface across the private parent/child RPC, where every call is asynchronous. */
export interface RemoteHostLifecycle {
  inspectActivity(): Promise<HostActivitySnapshot>
  prepareShutdown(leaseId: string): Promise<HostActivitySnapshot>
  drainAccepted(leaseId: string, timeoutMs: number): Promise<HostActivitySnapshot>
  cancelShutdown(leaseId: string): Promise<boolean>
}

/**
 * How a Host child actually stopped.
 *
 * `graceful` is true only after a shutdown acknowledgement **and** a clean exit
 * with code `0` and no terminating signal. A dead or killed child can never
 * supply a new graceful acknowledgement.
 */
export interface HostStopResult {
  graceful: boolean
  exitCode: number | null
  signal: string | null
}

/** Why the application is shutting a Host down. */
export type ShutdownIntent = 'quit' | 'update'

/** The outcome of a serialized shutdown preparation. */
export interface ShutdownDecision {
  intent: ShutdownIntent
  status: 'ready' | 'cancelled' | 'failed' | 'busy'
}

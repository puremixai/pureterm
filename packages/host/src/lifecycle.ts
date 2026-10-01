import { HostError, type HostActivitySnapshot, type HostLifecycle } from '@pureterm/protocol'

/*
 * Accepted-work tracking and the shutdown admission lease for one Host.
 *
 * The counters are the whole contract: they must never go negative, they must
 * unwind on rejection and disconnection, and `drainAccepted` waits for them to
 * reach zero rather than for live terminal streams to end. Admission is a
 * synchronous boolean so a caller cannot slip new work in between an inspection
 * and a confirmation.
 */

export type HostActivityKind = 'connection' | 'file' | 'mutation'

/** Finite work the Host has accepted; monitor probes are intentionally excluded. */
export class HostActivityTracker implements HostLifecycle {
  private lease: string | undefined
  private connections = 0
  private fileOperations = 0
  private mutations = 0
  private readonly waiters = new Set<() => void>()

  constructor(private readonly countActiveSessions: () => number) {}

  /** True while a lease holds admission closed. */
  get locked(): boolean {
    return this.lease !== undefined
  }

  inspectActivity(): HostActivitySnapshot {
    return {
      activeSessions: Math.max(0, this.countActiveSessions()),
      pendingConnections: this.connections,
      pendingFileOperations: this.fileOperations,
      pendingMutations: this.mutations,
    }
  }

  /** Synchronous admission gate. Throws `host.preparing-shutdown` while a lease is held. */
  assertAdmitted(): void {
    if (this.lease !== undefined) throw new HostError('host.preparing-shutdown')
  }

  /**
   * Count one accepted operation until it settles.
   *
   * The counter is incremented before `operation` runs, so a caller that has
   * passed `assertAdmitted()` is reflected in the snapshot immediately and a
   * drain cannot miss it.
   */
  async track<T>(kind: HostActivityKind, operation: () => T | Promise<T>): Promise<T> {
    this.begin(kind)
    try {
      return await operation()
    } finally {
      this.end(kind)
    }
  }

  /** Increment for callers that manage their own settlement (the mutation queue). */
  begin(kind: HostActivityKind): void {
    if (kind === 'connection') this.connections += 1
    else if (kind === 'file') this.fileOperations += 1
    else this.mutations += 1
  }

  /** Decrement in a `finally`; never below zero. */
  end(kind: HostActivityKind): void {
    if (kind === 'connection') this.connections = Math.max(0, this.connections - 1)
    else if (kind === 'file') this.fileOperations = Math.max(0, this.fileOperations - 1)
    else this.mutations = Math.max(0, this.mutations - 1)
    this.notify()
  }

  prepareShutdown(leaseId: string): HostActivitySnapshot {
    if (this.lease !== undefined && this.lease !== leaseId) throw new HostError('host.lifecycle-busy')
    this.lease = leaseId
    return this.inspectActivity()
  }

  cancelShutdown(leaseId: string): boolean {
    // A stale lease must not unlock a newer one.
    if (this.lease !== leaseId) return false
    this.lease = undefined
    this.notify()
    return true
  }

  async drainAccepted(leaseId: string, timeoutMs: number): Promise<HostActivitySnapshot> {
    if (this.lease !== leaseId) throw new HostError('host.lifecycle-lease-invalid')
    const pending = (): number => this.connections + this.fileOperations + this.mutations
    if (pending() > 0 && !await this.waitForIdle(pending, timeoutMs)) {
      // Timeout does not discard accepted promises or unlock admission.
      throw new HostError('host.lifecycle-drain-timeout')
    }
    return this.inspectActivity()
  }

  private waitForIdle(pending: () => number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const settle = (idle: boolean): void => {
        if (timer) clearTimeout(timer)
        this.waiters.delete(check)
        resolve(idle)
      }
      const check = (): void => { if (pending() === 0) settle(true) }
      this.waiters.add(check)
      timer = setTimeout(() => settle(false), Math.max(0, timeoutMs))
      timer.unref?.()
      check()
    })
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter()
  }
}

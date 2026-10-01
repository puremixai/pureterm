import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'

/*
 * Desktop profile ownership.
 *
 * One Desktop profile owns one SSH data directory. The binding is a durable
 * *record*, not a PID lock: two processes that share `userData` are already
 * serialised by Electron, but another `userData` must not be allowed to use this
 * store even after the first process has exited. The record names the canonical
 * `userData` that bound the directory, is written once with exclusive create, and
 * is never overwritten, auto-deleted, or auto-rebound.
 *
 * Pure fs + path, no Electron import: the whole decision is unit-testable, and it
 * runs synchronously so the launch-profile switches and the hardware-acceleration
 * decision still happen before Electron is ready.
 */

export const DESKTOP_PROFILE_VERSION = 1
export const DESKTOP_PROFILE_FILE = 'desktop-profile.json'

/** How long a temporarily incomplete record (an empty file another writer just created) is retried. */
const PROFILE_RETRY_MS = 1_000

export type DesktopProfileErrorCode = 'profile-mismatch' | 'profile-invalid' | 'profile-io'

/**
 * A failure that must stop Desktop startup before the store or Host is touched.
 *
 * The codes are the repair guidance boundary: the caller turns `profile-mismatch`
 * and `profile-invalid` into an explicit message and refuses to run, rather than
 * falling back to another directory or silently editing the record.
 */
export class DesktopProfileError extends Error {
  constructor(
    readonly code: DesktopProfileErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'DesktopProfileError'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Absolute, symlink-resolved, existing directory. Created first if it does not exist yet.
 *
 * `realpathSync.native` rather than `realpathSync`: on Windows the JavaScript walk keeps
 * an 8.3 short name (`RUNNER~1`) exactly as it was spelled, while the native call resolves
 * the directory's real long name (`runneradmin`) — the same answer `fs.promises.realpath`
 * gives. Two launches that spell one directory differently must not read as two profiles.
 */
function canonicalDirectory(directory: string): string {
  const absolute = resolve(directory)
  try {
    if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true, mode: 0o700 })
    return realpathSync.native(absolute)
  } catch (error) {
    throw new DesktopProfileError('profile-io', `Cannot prepare the data directory ${absolute}: ${describe(error)}`, { cause: error })
  }
}

/**
 * Comparison key for two canonical paths. Windows resolves case-insensitively, so
 * the same directory written two ways must not read as a mismatch; other platforms
 * keep the case as it is.
 */
export function sameDesktopProfilePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const absolute = resolve(value)
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute
  }
  return normalize(left) === normalize(right)
}

type ReadResult =
  | { kind: 'missing' }
  | { kind: 'incomplete' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; userData: string }

function readRecord(file: string): ReadResult {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw new DesktopProfileError('profile-io', `Cannot read ${file}: ${describe(error)}`, { cause: error })
  }
  // An empty file is the window between `open(wx)` and the first write by another
  // process; retry it briefly instead of calling a live binding corrupt.
  if (!raw.trim()) return { kind: 'incomplete' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', reason: 'the file is not JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'invalid', reason: 'the record is not an object' }
  }
  const record = parsed as Record<string, unknown>
  if (record.version !== DESKTOP_PROFILE_VERSION) {
    return { kind: 'invalid', reason: `unsupported version ${String(record.version)}` }
  }
  if (typeof record.userData !== 'string' || !record.userData) {
    return { kind: 'invalid', reason: 'userData is missing' }
  }
  return { kind: 'ok', userData: record.userData }
}

/** Exclusive create. Returns `true` on success, `false` when another writer won the race. */
function tryCreate(file: string, userData: string): boolean {
  let fd: number
  try {
    fd = openSync(file, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw new DesktopProfileError('profile-io', `Cannot create ${file}: ${describe(error)}`, { cause: error })
  }
  try {
    writeSync(fd, JSON.stringify({ version: DESKTOP_PROFILE_VERSION, userData }))
    // Flush before closing so a reader never sees a half-written record as complete.
    fsyncSync(fd)
  } catch (error) {
    throw new DesktopProfileError('profile-io', `Cannot write ${file}: ${describe(error)}`, { cause: error })
  } finally {
    closeSync(fd)
  }
  return true
}

/** Short synchronous sleep, used only while retrying another writer's incomplete record. */
function sleepBriefly(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
}

/**
 * Bind `dataDir` to `userDataDir`, or fail closed.
 *
 * On success `<dataDir>/desktop-profile.json` holds the canonical `userData`. A
 * matching existing record is reused; a record naming another `userData` throws
 * `profile-mismatch`; a malformed record throws `profile-invalid`; an I/O failure
 * throws `profile-io`. The existing store is never rewritten on rejection.
 */
export function bindDesktopProfile(dataDir: string, userDataDir: string): void {
  const canonicalData = canonicalDirectory(dataDir)
  const canonicalUser = canonicalDirectory(userDataDir)
  const file = join(canonicalData, DESKTOP_PROFILE_FILE)
  const deadline = Date.now() + PROFILE_RETRY_MS

  for (;;) {
    const existing = readRecord(file)
    if (existing.kind === 'ok') {
      if (sameDesktopProfilePath(existing.userData, canonicalUser)) return
      throw new DesktopProfileError(
        'profile-mismatch',
        `The data directory ${canonicalData} is bound to the Desktop profile ${existing.userData}, not ${canonicalUser}.`,
      )
    }
    if (existing.kind === 'invalid') {
      throw new DesktopProfileError('profile-invalid', `The profile record at ${file} is unusable: ${existing.reason}.`)
    }
    if (existing.kind === 'missing' && tryCreate(file, canonicalUser)) return
    // Either we lost the create race or read a record still being written.
    if (Date.now() >= deadline) {
      throw new DesktopProfileError('profile-invalid', `The profile record at ${file} did not become readable within ${PROFILE_RETRY_MS}ms.`)
    }
    sleepBriefly()
  }
}

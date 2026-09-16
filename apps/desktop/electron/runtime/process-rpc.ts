/** Private, versioned IPC between the Electron shell and its Node Host. */
export interface ProcessChannel {
  send(message: unknown, onError: (error: Error | null) => void): void
  listen(listener: (message: unknown) => void): () => void
}

type Envelope = { version: 1; kind: 'call' | 'reply' | 'notice'; id?: number; method?: string; args?: unknown[]; value?: unknown; error?: string }
export interface ProcessRpc {
  call<T = unknown>(method: string, args?: unknown[], timeoutMs?: number): Promise<T>
  notify(method: string, args?: unknown[]): boolean
  close(reason?: Error): void
}

export function createProcessRpc(options: {
  channel: ProcessChannel
  request(method: string, args: unknown[]): unknown | Promise<unknown>
  notice?(method: string, args: unknown[]): void
  onError?(error: Error): void
  timeoutMs?: number
}): ProcessRpc {
  let nextId = 0
  let closed: Error | undefined
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const send = (message: Envelope): boolean => {
    if (closed) return false
    try {
      options.channel.send(message, error => { if (error) close(error) })
      return true
    } catch (error) {
      close(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }
  const unlisten = options.channel.listen(raw => {
    if (closed || !raw || typeof raw !== 'object') return
    const message = raw as Envelope
    if (message.version !== 1) return
    if (message.kind === 'reply' && Number.isSafeInteger(message.id)) {
      const task = pending.get(message.id!)
      if (!task) return
      pending.delete(message.id!)
      clearTimeout(task.timer)
      if (typeof message.error === 'string') task.reject(new Error(message.error))
      else task.resolve(message.value)
      return
    }
    if (typeof message.method !== 'string' || !Array.isArray(message.args)) return
    if (message.kind === 'notice') {
      try { options.notice?.(message.method, message.args) }
      catch (error) { options.onError?.(error instanceof Error ? error : new Error(String(error))) }
    } else if (message.kind === 'call' && Number.isSafeInteger(message.id)) {
      void Promise.resolve().then(() => options.request(message.method!, message.args!)).then(
        value => send({ version: 1, kind: 'reply', id: message.id, value }),
        error => send({ version: 1, kind: 'reply', id: message.id, error: error instanceof Error ? error.message : String(error) }),
      )
    }
  })
  function close(reason = new Error('Host IPC disconnected')): void {
    if (closed) return
    closed = reason
    unlisten()
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.reject(reason)
    }
    pending.clear()
  }
  return {
    call<T>(method: string, args: unknown[] = [], timeoutMs = options.timeoutMs ?? 120_000): Promise<T> {
      if (closed) return Promise.reject(closed)
      if (pending.size >= 1024) return Promise.reject(new Error('Too many pending Host requests'))
      const id = ++nextId
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Host request timed out: ${method}`))
        }, timeoutMs)
        pending.set(id, { resolve: value => resolve(value as T), reject, timer })
        send({ version: 1, kind: 'call', id, method, args })
      })
    },
    notify: (method, args = []) => send({ version: 1, kind: 'notice', method, args }),
    close,
  }
}

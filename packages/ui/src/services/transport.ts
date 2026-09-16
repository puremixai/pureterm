import { Service, type Context } from 'cordis'
import type { RuntimeCapabilities, SshApi } from '@pureterm/protocol'
import { createTransport } from '../transport.js'
import { parseRuntimeCapabilities } from '../credentials.js'

declare module 'cordis' { interface Context { clientTransport: ClientTransport } }

export class ClientTransport extends Service {
  readonly api: SshApi
  readonly capabilities: Promise<RuntimeCapabilities>

  constructor(ctx: Context, options: { api?: SshApi } = {}) {
    super(ctx, 'clientTransport')
    this.api = options.api ?? createTransport()
    ctx.effect(() => () => this.api.dispose(), 'client.transport')
    this.capabilities = this.api.getCapabilities().then(parseRuntimeCapabilities)
    // The readiness feature reports failures; attaching now also covers dependency teardown.
    void this.capabilities.catch(() => {})
  }
}

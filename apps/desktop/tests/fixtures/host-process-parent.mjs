import { fileURLToPath } from 'node:url'
import { startHostProcess } from '../../dist/electron/runtime/host-process.js'

const child = await startHostProcess({
  entry: fileURLToPath(new URL('../../dist/electron/host/entry.js', import.meta.url)),
  dataDir: process.argv[2], execPath: process.execPath,
  credentials: { persistent: true, seal: () => undefined, unseal: () => undefined },
  pickPrivateKey: async () => undefined,
})
process.on('message', (message) => {
  if (message?.kind !== 'open') return
  void (async () => {
    const address = new URL(child.url)
    address.protocol = 'ws:'
    address.pathname = '/ws'
    const socket = new WebSocket(address)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.addEventListener('message', event => {
      const reply = JSON.parse(event.data)
      if (reply.kind !== 'reply' || reply.id !== 1) return
      if (reply.ok) process.send?.({ kind: 'opened', value: reply.value })
      else process.send?.({ kind: 'error', error: reply.error })
    })
    socket.send(JSON.stringify({ kind: 'call', id: 1, method: 'ssh:open', params: [message.payload] }))
  })().catch(error => process.send?.({ kind: 'error', error: error.message }))
})
process.send?.({ kind: 'ready', pid: child.pid })

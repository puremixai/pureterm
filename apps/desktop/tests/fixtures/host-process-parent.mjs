import { fileURLToPath } from 'node:url'
import { startHostProcess } from '../../dist/electron/runtime/host-process.js'

const clientId = 'fixture:renderer'
const child = await startHostProcess({
  entry: fileURLToPath(new URL('../../dist/electron/host/entry.js', import.meta.url)),
  dataDir: process.argv[2], execPath: process.execPath,
  bridge: { getRenderer: (id) => id === clientId ? { id, isAlive: () => true, send: () => true } : undefined },
  credentials: { persistent: true, seal: () => undefined, unseal: () => undefined },
  pickPrivateKey: async () => undefined, onReady: () => {},
})
process.on('message', (message) => {
  if (message?.kind !== 'open') return
  void child.dispatcher.call('ssh:open', [message.payload], clientId).then(
    (value) => process.send?.({ kind: 'opened', value }),
    (error) => process.send?.({ kind: 'error', error: error.message }),
  )
})
process.send?.({ kind: 'ready', pid: child.pid })

import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

writeFileSync(process.env.PURETERM_TEST_CHILD_PID, String(process.pid), 'utf8')
// Own the IPC channel; test mode can reply with an invalid startup address.
process.on('message', message => {
  if (!process.env.PURETERM_TEST_BAD_HANDSHAKE || message?.method !== 'host:start') return
  process.send?.({ version: 1, kind: 'reply', id: message.id,
    value: { pid: process.pid, url: `http://0.0.0.0:4321/?token=${randomBytes(24).toString('base64url')}`,
      desktopToken: randomBytes(24).toString('base64url') } })
})

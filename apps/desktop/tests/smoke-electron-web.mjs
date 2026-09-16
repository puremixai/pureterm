import { fileURLToPath } from 'node:url'
import { createFakeSshServer } from './fake-ssh-server.mjs'
import { runElectron, reportElectronResult } from '../scripts/electron-runner.mjs'

const server = await createFakeSshServer()
try {
  const result = await runElectron({
    entry: fileURLToPath(new URL('./electron-web-entry.mjs', import.meta.url)),
    env: { SSH_CORDIS_SMOKE_HOST: server.host, SSH_CORDIS_SMOKE_PORT: String(server.port),
      SSH_CORDIS_SMOKE_USER: server.username, SSH_CORDIS_SMOKE_PASS: server.password },
    successMarker: '[WEB-SMOKE-OK]', requiredMarkers: ['[WEB-READY]'],
  })
  reportElectronResult('electron-web', result)
} finally {
  await server.close()
}

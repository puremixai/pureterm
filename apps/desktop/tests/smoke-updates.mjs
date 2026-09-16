import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute, relative } from 'node:path'
import { runElectron, reportElectronResult } from '../scripts/electron-runner.mjs'

// Deliberately not an executable. The smoke exercises downloads and verification,
// never installation, and never contacts GitHub or another external service.
const payload = Buffer.from('PureTerm updater fixture; this is not an executable.\n'.repeat(8192))
const sha512 = createHash('sha512').update(payload).digest('base64')
const requested = []
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  requested.push(pathname)
  const match = /^\/(good|bad)\/(latest[^/]*\.yml|fixture-update\.exe)$/.exec(pathname)
  if (!match || request.method !== 'GET') { response.writeHead(404).end(); return }
  const [, scenario, name] = match
  if (name === 'fixture-update.exe') {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length }).end(payload)
    return
  }
  const digest = scenario === 'good' ? sha512 : Buffer.alloc(64, 7).toString('base64')
  const metadata = JSON.stringify({
    version: scenario === 'good' ? '1.1.0' : '1.2.0',
    files: [{ url: 'fixture-update.exe', sha512: digest, size: payload.length }],
    releaseDate: '2026-09-16T00:00:00.000Z',
  })
  response.writeHead(200, { 'content-type': 'application/yaml', 'content-length': Buffer.byteLength(metadata) }).end(metadata)
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
try {
  const url = `http://127.0.0.1:${server.address().port}`
  const result = await runElectron({
    entry: fileURLToPath(new URL('./electron-updates-entry.mjs', import.meta.url)),
    env: { SSH_CORDIS_UPDATE_FIXTURE_URL: url, SSH_CORDIS_UPDATE_FIXTURE_SHA512: sha512 },
    successMarker: '[UPDATER-SMOKE-OK]',
    requiredMarkers: ['[UPDATER-DOWNLOAD-OK]', '[UPDATER-CHECKSUM-REJECTED]'],
    inspect({ dataDir, output }) {
      const line = output.split(/\r?\n/).find(item => item.startsWith('[UPDATER-DOWNLOAD-OK] '))
      const report = JSON.parse(line.slice('[UPDATER-DOWNLOAD-OK] '.length))
      const path = relative(dataDir, report.file)
      assert.ok(path && !path.startsWith('..') && !isAbsolute(path), 'updater escaped the isolated cache directory')
      assert.deepEqual(readFileSync(report.file), payload)
      for (const scenario of ['good', 'bad']) {
        assert.equal(requested.filter(path => path.startsWith(`/${scenario}/latest`) && path.endsWith('.yml')).length, 1)
        assert.equal(requested.filter(path => path === `/${scenario}/fixture-update.exe`).length, 1)
      }
      assert.equal(requested.length, 4, 'unexpected feed or download request')
    },
  })
  reportElectronResult('electron-updater-feed', result)
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}

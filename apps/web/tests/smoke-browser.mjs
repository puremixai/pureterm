import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startFakeSshServer } from '../../desktop/tests/fake-ssh-server.mjs'
import { runElectron, reportElectronResult } from '../../desktop/scripts/electron-runner.mjs'

const directory = await mkdtemp(join(tmpdir(), 'pureterm-web-browser-'))
const dataDir = join(directory, 'profile')
const keyFile = join(directory, 'browser-only-private-key.pem')
const ssh = await startFakeSshServer({ keyAuthentication: true })
let child
let exit
let nodeOutput = ''
let result = { code: 1, reason: 'browser smoke did not complete' }

async function until(predicate, description, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await delay(20)
  }
  throw new Error(`Timed out waiting for ${description}\n${nodeOutput}`)
}

try {
  await writeFile(keyFile, ssh.hostKey, { mode: 0o600 })
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('SSH_CORDIS_') || key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS') delete env[key]
  child = spawn(process.execPath, [fileURLToPath(new URL('../dist/main.js', import.meta.url)), '--data-dir', dataDir],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (text) => { nodeOutput += text })
  child.stderr.on('data', (text) => { nodeOutput += text })
  child.once('error', (error) => { exit = { error } })
  child.once('close', (code, signal) => { exit = { code, signal } })
  const url = await until(() => {
    if (exit) throw new Error(`Node Web exited before becoming ready: ${JSON.stringify(exit)}\n${nodeOutput}`)
    return nodeOutput.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)?.[0]
  }, 'Node Web startup URL')
  result = await runElectron({
    entry: fileURLToPath(new URL('./electron-entry.mjs', import.meta.url)),
    env: { PURETERM_TEST_WEB_URL: url, PURETERM_TEST_PRIVATE_KEY: keyFile,
      SSH_CORDIS_SMOKE_HOST: ssh.host, SSH_CORDIS_SMOKE_PORT: String(ssh.port),
      SSH_CORDIS_SMOKE_USER: ssh.username, SSH_CORDIS_SMOKE_PASS: ssh.password },
    successMarker: '[WEB-SMOKE-OK]', requiredMarkers: ['[WEB-READY]', '[WEB-BROWSER-KEY-AUTH]', '[WEB-BROWSER-KEY]'],
  })
  if (result.code === 0) {
    assert.ok(ssh.authentications.includes('publickey'), 'browser connection must complete signed public-key authentication')
    const files = await readdir(dataDir)
    assert.ok(files.includes('hosts.json'))
    assert.equal(files.includes('secrets.json'), false)
    for (const name of files) {
      const text = await readFile(join(dataDir, name), 'utf8')
      assert.equal(text.includes('browser-key-passphrase-never-persist'), false)
      assert.equal(text.includes('PRIVATE KEY'), false)
    }
    const hosts = JSON.parse(await readFile(join(dataDir, 'hosts.json'), 'utf8'))
    assert.equal(hosts.length, 1)
    assert.equal(hosts[0].username, ssh.username)
    assert.equal(hosts[0].authMethod, 'privateKey')
    assert.equal(hosts[0].privateKeyPath, undefined)
  }
} catch (error) {
  console.error('[WEB-SMOKE-FAIL]', error)
  result = { code: 1, reason: error.message }
} finally {
  if (child && !exit) {
    child.kill('SIGTERM')
    try { await until(() => exit, 'Node Web shutdown', 5000) }
    catch { child.kill('SIGKILL'); result = { code: 1, reason: 'Node Web did not shut down' } }
  }
  await ssh.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  reportElectronResult('standalone-web-browser', result)
}

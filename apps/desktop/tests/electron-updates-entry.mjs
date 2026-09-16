import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, session } from 'electron'
import electronUpdater from 'electron-updater'
import executorModule from 'electron-updater/out/electronHttpExecutor.js'

const { NsisUpdater } = electronUpdater
const { ElectronHttpExecutor } = executorModule
const dataDir = process.env.SSH_CORDIS_DATA_DIR
const origin = new URL(process.env.SSH_CORDIS_UPDATE_FIXTURE_URL).origin
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.equal(new URL(origin).protocol, 'http:')
mkdirSync(process.env.SSH_CORDIS_TEST_USER_DATA, { recursive: true })
app.setPath('userData', process.env.SSH_CORDIS_TEST_USER_DATA)
app.commandLine.appendSwitch('disable-background-networking')

let forbiddenNetwork = []
let installationAttempts = 0
function forbidInstallation() {
  installationAttempts += 1
  throw new Error('Installation is forbidden in the updater feed smoke')
}

function updaterFor(scenario) {
  const directory = join(dataDir, `update-${scenario}`)
  mkdirSync(directory, { recursive: true })
  const config = join(directory, 'dev-app-update.yml')
  const feed = { provider: 'generic', url: `${origin}/${scenario}/`, updaterCacheDirName: 'cache' }
  writeFileSync(config, JSON.stringify(feed), 'utf8')
  // Only application identity and paths are adapted. NsisUpdater's provider,
  // Electron network executor, download pipeline and digest verifier are real.
  const updater = new NsisUpdater(undefined, {
    version: '1.0.0', name: 'PureTermUpdaterFixture', isPackaged: false,
    appUpdateConfigPath: config, userDataPath: directory, baseCachePath: directory,
    whenReady: () => app.whenReady(), quit: forbidInstallation, relaunch: forbidInstallation,
    onQuit: forbidInstallation,
  })
  updater.httpExecutor = new ElectronHttpExecutor()
  updater.forceDevUpdateConfig = true
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.disableWebInstaller = true
  updater.disableDifferentialDownload = true
  updater.logger = null
  updater.quitAndInstall = forbidInstallation
  updater.install = forbidInstallation
  updater.doInstall = forbidInstallation
  updater.setFeedURL(feed)
  return updater
}

async function main() {
  let code = 1
  try {
    await app.whenReady()
    const guard = (details, callback) => {
      const allowed = new URL(details.url).origin === origin
      if (!allowed) forbiddenNetwork.push(details.url)
      callback({ cancel: !allowed })
    }
    // The updater uses its own Chromium session. Block external requests in both
    // that session and the default session before starting any update check.
    session.defaultSession.webRequest.onBeforeRequest(guard)
    session.fromPartition('electron-updater', { cache: false }).webRequest.onBeforeRequest(guard)

    const good = updaterFor('good')
    const goodEvents = []
    const goodErrors = []
    good.on('update-available', info => goodEvents.push(['available', info.version]))
    good.on('update-downloaded', info => goodEvents.push(['downloaded', info.version]))
    good.on('error', error => goodErrors.push(error))
    const available = await good.checkForUpdates()
    assert.equal(available.updateInfo.version, '1.1.0')
    assert.equal(available.downloadPromise, null, 'fixture must explicitly request the download')
    const files = await good.downloadUpdate()
    assert.equal(files.length, 1)
    assert.equal(createHash('sha512').update(readFileSync(files[0])).digest('base64'), process.env.SSH_CORDIS_UPDATE_FIXTURE_SHA512)
    assert.deepEqual(goodEvents, [['available', '1.1.0'], ['downloaded', '1.1.0']])
    assert.deepEqual(goodErrors, [])
    console.log('[UPDATER-DOWNLOAD-OK] ' + JSON.stringify({ version: '1.1.0', file: files[0] }))

    const bad = updaterFor('bad')
    const badEvents = []
    const badErrors = []
    bad.on('update-downloaded', info => badEvents.push(info))
    bad.on('error', error => badErrors.push(error))
    assert.equal((await bad.checkForUpdates()).updateInfo.version, '1.2.0')
    await assert.rejects(bad.downloadUpdate(), error => {
      assert.equal(error.code, 'ERR_CHECKSUM_MISMATCH')
      assert.match(error.message, /sha512 checksum mismatch/)
      return true
    })
    assert.equal(badEvents.length, 0, 'corrupt installer was marked as downloaded')
    assert.equal(bad.installerPath, null, 'corrupt installer remained eligible for installation')
    assert.equal(badErrors.length, 1)
    assert.equal(badErrors[0].code, 'ERR_CHECKSUM_MISMATCH')
    console.log('[UPDATER-CHECKSUM-REJECTED] ERR_CHECKSUM_MISMATCH')
    assert.deepEqual(forbiddenNetwork, [], 'updater attempted to access an external origin')
    assert.equal(installationAttempts, 0)
    code = 0
  } catch (error) {
    console.error('[SMOKE-FAIL] updater feed', error)
  } finally {
    await session.fromPartition('electron-updater', { cache: false }).closeAllConnections()
    console.log(code === 0 ? '[UPDATER-SMOKE-OK]' : '[SMOKE-FAIL] updater feed')
    app.exit(code)
  }
}

void main()

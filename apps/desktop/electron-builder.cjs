const { resolve } = require('node:path')
const { version: electronVersion } = require('electron/package.json')

const root = resolve(__dirname, '../..')
const releaseBuild = process.env.PURETERM_RELEASE_BUILD === '1'
const macCertificate = Boolean(process.env.CSC_LINK)
const appleCredentials = Boolean(
  (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)
  || (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER),
)

module.exports = {
  appId: 'ai.puremix.pureterm',
  productName: 'PureTerm',
  electronVersion,
  directories: {
    app: resolve(root, '.release/app'),
    output: resolve(root, 'release'),
  },
  // The Host is a separately forked Node entry. Keep its files directly accessible.
  asar: false,
  npmRebuild: false,
  nodeGypRebuild: false,
  files: ['**/*', '!**/*.map', '!**/*.node'],
  artifactName: 'PureTerm-${version}-${os}-${arch}.${ext}',
  electronUpdaterCompatibility: '>=2.16',
  forceCodeSigning: releaseBuild && process.platform !== 'linux',
  publish: [{ provider: 'github', owner: 'puremixai', repo: 'pureterm', releaseType: 'draft' }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }, { target: 'zip', arch: ['x64', 'arm64'] }],
    category: 'public.app-category.developer-tools',
    identity: macCertificate ? undefined : '-',
    hardenedRuntime: macCertificate,
    notarize: macCertificate && appleCredentials,
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    category: 'System',
    synopsis: 'SSH terminal and SFTP desktop client',
  },
}

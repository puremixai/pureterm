import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createFakeSshServer } from '../apps/desktop/tests/fake-ssh-server.mjs'
import { until } from '../apps/desktop/tests/integration-helpers.mjs'
import { runElectron } from '../apps/desktop/scripts/electron-runner.mjs'

const exec = promisify(execFile)
const repository = realpathSync(resolve(import.meta.dirname, '..'))

function contained(root, target) {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function assertTestDirectory(root, directory) {
  const absoluteRoot = realpathSync(root)
  const present = existsSync(directory)
  const absoluteDirectory = present ? realpathSync(directory) : resolve(directory)
  if (absoluteRoot !== realpathSync(tmpdir()) || !contained(absoluteRoot, absoluteDirectory)
    || absoluteDirectory === repository || contained(repository, absoluteDirectory)
    || dirname(absoluteDirectory) !== absoluteRoot || !relative(absoluteRoot, absoluteDirectory).startsWith('pureterm-installed-smoke-')
    || (present && lstatSync(directory).isSymbolicLink())) {
    throw new Error(`Refusing to modify an installation directory outside the isolated OS temporary location: ${directory}`)
  }
  return absoluteDirectory
}

// Query both registry views; never execute an UninstallString from the registry.
// An existing installation must remain entirely untouched by this smoke test.
const registryScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$found = @()
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    try {
      $uninstall = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall', $false)
      if ($null -eq $uninstall) { continue }
      try {
        foreach ($name in $uninstall.GetSubKeyNames()) {
          $item = $uninstall.OpenSubKey($name, $false)
          if ($null -eq $item) { continue }
          try {
            if ([string]$item.GetValue('DisplayName') -match '^PureTerm(?:\s|$)') {
              $found += [pscustomobject]@{
                hive = [string]$hive
                view = [string]$view
                key = $name
                location = [string]$item.GetValue('InstallLocation')
                version = [string]$item.GetValue('DisplayVersion')
              }
            }
          } finally { $item.Dispose() }
        }
      } finally { $uninstall.Dispose() }
    } finally { $base.Dispose() }
  }
}
ConvertTo-Json -Compress -InputObject @($found)
`

async function installations() {
  const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', registryScript], {
    windowsHide: true, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024,
  })
  const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''))
  if (!Array.isArray(result)) throw new Error('Unexpected PureTerm installation registry response')
  return result
}

async function runNsis(executable, args, cwd) {
  await exec(executable, args, {
    cwd, windowsHide: true, windowsVerbatimArguments: true,
    timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  })
}

function processExists(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

export async function verifyWindowsPackage() {
  if (process.platform !== 'win32') throw new Error('Windows installer verification must run on Windows')
  const desktop = JSON.parse(readFileSync(join(repository, 'apps', 'desktop', 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(desktop.version)) throw new Error('Invalid Desktop package version')
  const installer = join(repository, 'release', `PureTerm-${desktop.version}-win-x64.exe`)
  if (!existsSync(installer)) throw new Error(`Missing installer: ${installer}. Build the Windows package first.`)
  const existing = await installations()
  if (existing.length) {
    throw new Error(`PureTerm is already installed. Installer verification will not replace it: ${JSON.stringify(existing)}`)
  }

  const temporary = realpathSync(tmpdir())
  if (temporary === repository || contained(repository, temporary)) {
    throw new Error('The OS temporary directory must be outside the repository so installed dependencies cannot resolve from the workspace')
  }
  const installation = mkdtempSync(join(temporary, 'pureterm-installed-smoke-'))
  assertTestDirectory(temporary, installation)
  const installedExe = join(installation, 'PureTerm.exe')
  const uninstaller = join(installation, 'Uninstall PureTerm.exe')
  let attempted = false
  let server
  let failure
  let cleanupFailure
  let inspected = false
  try {
    console.log(`[windows-package] Installing ${installer} into ${installation}`)
    attempted = true
    // NSIS requires /D to be the last argument, without quotes around the path.
    await runNsis(installer, ['/S', `/D=${installation}`], repository)
    await until(() => existsSync(installedExe) && existsSync(uninstaller), 'installed application and uninstaller', 30_000)
    assertTestDirectory(temporary, installation)
    assert.ok(contained(installation, realpathSync(installedExe)), 'installed executable escaped the test directory')
    server = await createFakeSshServer()
    const result = await runElectron({
      executable: installedExe,
      env: {
        SSH_CORDIS_SMOKE: '1', SSH_CORDIS_SMOKE_SFTP: '1', SSH_CORDIS_TEST_HIDE_WINDOW: '1',
        SSH_CORDIS_SMOKE_HOST: server.host, SSH_CORDIS_SMOKE_PORT: String(server.port),
        SSH_CORDIS_SMOKE_USER: server.username, SSH_CORDIS_SMOKE_PASS: server.password,
      },
      successMarker: '[SMOKE-OK]', requiredMarkers: ['[SFTP-SMOKE-OK]', '[CREDENTIAL-SMOKE-OK]', '[main] 闸门已打开'],
      inspect: async ({ output }) => {
        const match = output.match(/Host 子进程已就绪 pid=(\d+) parent=(\d+)/)
        assert.ok(match, 'installed application did not report its Host child process')
        const hostPid = Number(match[1])
        assert.notEqual(hostPid, Number(match[2]), 'Host must run in a separate Node process')
        assert.equal(processExists(hostPid), false, 'installed application left its Host child running')
        await until(() => server.connections === 0, 'installed application SSH cleanup')
        assert.ok(server.authentications.length > 0, 'installer smoke did not authenticate with the SSH fixture')
        assert.ok(server.sftp.channels > 0, 'installer smoke did not exercise a real SFTP subsystem')
        inspected = true
      },
    })
    assert.equal(result.code, 0, `Installed application smoke failed: ${result.reason}`)
    assert.equal(inspected, true, 'post-run application checks did not execute')
  } catch (error) {
    failure = error
  } finally {
    try { await server?.close() } catch (error) { cleanupFailure = error }
    try {
      assertTestDirectory(temporary, installation)
      if (attempted) {
        if (existsSync(uninstaller)) {
          assert.ok(contained(installation, realpathSync(uninstaller)), 'uninstaller escaped the test directory')
          console.log(`[windows-package] Uninstalling isolated package from ${installation}`)
          await runNsis(uninstaller, ['/S'], repository)
          await until(() => !existsSync(installedExe), 'installed executable removal', 30_000)
          await until(async () => (await installations()).length === 0, 'PureTerm uninstall registry removal', 30_000)
        } else if (existsSync(installedExe) || (await installations()).length > 0) {
          throw new Error(`The installer left files or registry entries without its uninstaller; inspect ${installation}`)
        }
      }
      // Check the final resolved absolute target immediately before recursive deletion.
      // Uninstallers may already have removed the now-empty application directory.
      if (existsSync(installation)) {
        const target = assertTestDirectory(temporary, installation)
        rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      }
    } catch (error) {
      cleanupFailure = cleanupFailure ? new AggregateError([cleanupFailure, error], 'Multiple package cleanup failures') : error
    }
  }
  if (failure && cleanupFailure) throw new AggregateError([failure, cleanupFailure], 'Windows package verification and cleanup failed')
  if (cleanupFailure) throw cleanupFailure
  if (failure) throw failure
  console.log('[WINDOWS-PACKAGE-OK] Installer, SSH, SFTP, Host shutdown and explicit uninstall verified')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/verify-windows-package.mjs')
  await verifyWindowsPackage()
}

import { app, type BrowserWindow } from 'electron'

interface SmokeReport {
  preload: string
  sessionId: string | null
  openedSize: { cols: number; rows: number } | null
  text: string
  replacementChars: number
  closedReason: string | null
  error: string | null
}

/**
 * 只用于验证链路：真窗口 + 真 preload + 真渲染进程 + 真 SSH 连接。
 * 由 tests/smoke-electron.mjs 启动（它负责起一个本地假 SSH 服务）。
 */
export async function runSmokeTest(window: BrowserWindow, exit: (code: number) => void = code => app.exit(code)): Promise<void> {
  const config = {
    host: process.env.SSH_CORDIS_SMOKE_HOST ?? '127.0.0.1',
    port: Number(process.env.SSH_CORDIS_SMOKE_PORT ?? '2222'),
    username: process.env.SSH_CORDIS_SMOKE_USER ?? 'demo',
    password: process.env.SSH_CORDIS_SMOKE_PASS ?? 'demo',
  }

  let code = 1
  try {
    await new Promise<void>((resolve) => {
      if (!window.webContents.isLoading()) resolve()
      else window.webContents.once('did-finish-load', () => resolve())
    })

    const ready = await window.webContents.executeJavaScript('window.__smoke.ready')
    if (!ready?.ok) throw new Error(`Renderer initialization failed: ${ready?.error ?? 'missing readiness'}`)
    const surface = await window.webContents.executeJavaScript(`(async () => ({
      preloadType: typeof window.puretermDesktop,
      legacyApiType: typeof window.sshAPI,
      page: location.origin,
      bootstrap: await window.puretermDesktop.bootstrap(),
      carrier: window.__smoke.api.carrier,
      capabilities: await window.__smoke.api.getCapabilities(),
    }))()`)
    const { preloadType } = surface
    if (surface.legacyApiType !== 'undefined' || surface.page !== 'pureterm-app://app'
      || Object.keys(surface.bootstrap).join() !== 'webSocketUrl'
      || !/^ws:\/\/127\.0\.0\.1:\d+\/ws$/.test(surface.bootstrap.webSocketUrl)
      || surface.carrier !== 'web') throw new Error('Invalid Desktop Web Host boundary')
    const report = (await window.webContents.executeJavaScript(
      `window.__smoke.run(${JSON.stringify(config)})`,
    )) as SmokeReport

    const ok =
      preloadType === 'object' &&
      !!report.sessionId &&
      !report.error &&
      report.replacementChars === 0 &&
      report.text.includes('你好，世界') &&
      report.text.includes('echo:ls') &&
      !!report.closedReason &&
      report.openedSize?.cols === 100 &&
      report.openedSize?.rows === 30

    if (process.env.SSH_CORDIS_SMOKE_SFTP === '1') {
      const sftpOk = await window.webContents.executeJavaScript(`(async () => {
        const api = window.__smoke.api;
        const config = ${JSON.stringify(config)};
        const record = await api.hosts.save({ ...config, label: 'Installer credential check', rememberPassword: true });
        if (!record.hasSecret) throw new Error('System credential encryption unavailable');
        const { password, ...connection } = config;
        let sessionId;
        let path;
        try {
          sessionId = (await api.open({ ...connection, hostId: record.id })).sessionId;
          const listing = await api.sftp.list(sessionId, '.');
          const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
          const saved = await api.sftp.write(sessionId, listing.path, '.pureterm-smoke-' + Date.now() + '.bin', bytes);
          path = saved.path;
          const read = await api.sftp.read(sessionId, path);
          return read.bytes instanceof Uint8Array && read.size === 256 && bytes.every((value, i) => read.bytes[i] === value);
        } finally {
          try { if (path) await api.sftp.remove(sessionId, path); }
          finally {
            if (sessionId) api.close(sessionId);
            await api.hosts.remove(record.id);
          }
        }
      })()`)
      if (!sftpOk) throw new Error('Packaged SFTP binary round trip failed')
      console.log('[SFTP-SMOKE-OK]')
      console.log('[CREDENTIAL-SMOKE-OK] system-encrypted credential crossed the Host process boundary')
    }
    // Supplied only by the isolated local fixture runner, never by normal startup.
    if (process.env.SSH_CORDIS_SMOKE_KEYCHAIN) {
      const keychainOk = await window.webContents.executeJavaScript(`(async () => {
        const api = window.__smoke.api;
        const config = ${JSON.stringify(config)};
        const key = await api.keychain.save({ label: 'Web Host Keychain check', privateKey: ${JSON.stringify(process.env.SSH_CORDIS_SMOKE_KEYCHAIN)} });
        if (key.privateKey || key.passphrase || !key.fingerprint) throw new Error('Unsafe Keychain public record');
        const { password, ...connection } = config;
        const host = await api.hosts.save({ ...connection, authMethod: 'privateKey', keyId: key.id });
        let sessionId;
        try {
          sessionId = (await api.open({ ...connection, hostId: host.id })).sessionId;
          return !!sessionId && (await api.keychain.list()).some(item => item.id === key.id);
        } finally {
          if (sessionId) api.close(sessionId);
          await api.hosts.remove(host.id);
        }
      })()`)
      if (!keychainOk) throw new Error('Desktop Keychain authentication failed')
      console.log('[KEYCHAIN-WEB-OK] system-encrypted key authenticated through WebSocket and the Node Host')
    }
    console.log('[SMOKE] ' + JSON.stringify({ preloadType, page: surface.page, carrier: surface.carrier, ...report }))
    console.log(ok ? '[SMOKE-OK]' : '[SMOKE-FAIL]')
    code = ok ? 0 : 1
  } catch (error) {
    console.error('[SMOKE-ERROR]', error)
  }

  // 留出时间把 stdout 刷出去
  setTimeout(() => exit(code), 300)
}

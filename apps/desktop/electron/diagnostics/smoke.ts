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
    /*
     * 资源监控的端到端验收。走真实 UI，不碰私有 IPC：连接 → 展开监控条 → 读到远端
     * 快照 → 同一条连接上终端和 SFTP 仍然工作。业务数据全程走共享 WebSocket 载体，
     * 所以这里能成立，正是因为它没有为自己开一条通道。
     *
     * 窗口是隐藏的，而「文档可见」是采集的准入条件之一，所以先把 `document.hidden`
     * 改成 false 再发 `visibilitychange`，结束还原。这是测试装置，不是产品开关：
     * 产品侧的可见性策略一个字都没改，只是这个夹具让页面表现得像在前台。
     *
     * 这里只采集和打印观测值，定值断言在启动器（smoke-electron.mjs）里，和
     * `[SMOKE]` 那条一样——期望值属于夹具，不属于产品诊断代码。
     */
    if (process.env.SSH_CORDIS_SMOKE_MONITOR === '1') {
      const monitor = await window.webContents.executeJavaScript(`(async () => {
        const config = ${JSON.stringify(config)};
        const wait = async (read, what, timeout = 25000) => {
          const deadline = Date.now() + timeout;
          for (;;) {
            const seen = read();
            if (seen) return seen;
            if (Date.now() > deadline) throw new Error('监控验收等待超时：' + what);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        };
        const value = metric => document.querySelector('#monitor-body .monitor-field[data-metric=' + metric + '] .monitor-value').textContent;
        const facts = () => ({ cipher: document.getElementById('status-cipher').textContent, key: document.getElementById('status-key').textContent });
        const visible = () => document.getElementById('monitor-state').textContent;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        try {
          document.getElementById('host-new').click();
          document.getElementById('host').value = config.host;
          document.getElementById('port').value = String(config.port);
          document.getElementById('user').value = config.username;
          document.getElementById('pass').value = config.password;
          document.getElementById('host-label').value = 'Monitor fixture';
          document.getElementById('connect').click();
          await wait(() => document.getElementById('session-state').className === 'connected' ? true : null, '会话连接');
          const held = await wait(() => { const seen = facts(); return seen.cipher !== '—' && seen.key !== '—' ? seen : null; }, '握手事实');
          // 折叠是默认值：展开之前一次探测都不该发生，状态文字要说的是「暂停」而不是「读取中」。
          const collapsed = document.getElementById('monitor-body').hidden;
          const beforeExpand = visible();
          document.getElementById('monitor-toggle').click();
          const first = await wait(() => { const text = value('memory'); return text.includes('%') ? text : null; }, '第一张快照');
          const ready = await wait(() => visible() === '已更新'
            ? { cpu: value('cpu'), memory: value('memory'), load: value('load'), disk: value('disk'), net: value('net'), uptime: value('uptime') } : null, '第二轮快照');
          // 同一条连接：终端仍然收发。
          const data = new DataTransfer();
          data.setData('text/plain', 'monitor-alive\\r');
          document.querySelector('.terminal-pane:not([hidden]) .xterm-helper-textarea').dispatchEvent(
            new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
          await wait(() => document.querySelector('.terminal-pane:not([hidden]) .xterm-rows').textContent.includes('echo:monitor-alive') ? true : null, '终端回声');
          // 同一条连接：SFTP 仍然列目录。走面板按钮，和用户点的是同一个入口。
          document.getElementById('sftp-toggle').click();
          const path = await wait(() => document.getElementById('sftp-path').value || null, 'SFTP 列目录');
          const files = document.querySelectorAll('#sftp-list .file-row').length;
          document.getElementById('disconnect').click();
          await wait(() => document.getElementById('disconnect').disabled ? true : null, '断开连接');
          return { collapsed, beforeExpand, facts: held, first, ready, path, files };
        } finally {
          delete document.hidden;
          document.dispatchEvent(new Event('visibilitychange'));
        }
      })()`) as {
        collapsed: boolean; beforeExpand: string; facts: { cipher: string; key: string }
        first: string; ready: Record<string, string>; path: string; files: number
      }
      // 便宜的完整性检查留在这里，好让失败能落到这一块；定值断言在启动器里。
      if (!monitor.collapsed || monitor.beforeExpand !== '已暂停') throw new Error('Monitor panel must be collapsed by default')
      if (!monitor.ready?.cpu || !monitor.ready?.net || !monitor.ready?.uptime) throw new Error('Monitor panel did not render a complete snapshot')
      if (monitor.files < 1 || !monitor.path.startsWith('/')) throw new Error('SFTP listing failed on the monitored session')
      console.log('[MONITOR-SMOKE] ' + JSON.stringify(monitor))
      console.log('[MONITOR-SMOKE-OK] fixture snapshot and session facts rendered through the real UI')
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

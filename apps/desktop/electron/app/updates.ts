import { app, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import { createUpdateCoordinator } from '../runtime/updates.js'

export function createDesktopUpdates(beforeInstall: () => Promise<void>, onInstallError: () => Promise<void>) {
  const enabled = app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
    && (process.platform !== 'linux' || !!process.env.APPIMAGE)
  return createUpdateCoordinator({
    backend: electronUpdater.autoUpdater,
    enabled,
    unavailableReason: app.isPackaged ? '请使用官方安装包启动 PureTerm，Linux 请运行 AppImage。' : '开发版不检查更新，请安装 GitHub Releases 中的 PureTerm。',
    beforeInstall,
    onInstallError,
    async confirmInstall(version) {
      const result = await dialog.showMessageBox({ type: 'info', title: 'PureTerm 更新',
        message: `PureTerm ${version} 已下载`, detail: '重启安装将关闭当前所有 SSH 会话。',
        buttons: ['稍后', '重启安装'], defaultId: 0, cancelId: 0 })
      return result.response === 1
    },
    async message(message) { await dialog.showMessageBox({ type: 'info', title: 'PureTerm 更新', message }) },
    onState: (state, detail) => console.log(`[updates] ${state}${detail ? `: ${detail}` : ''}`),
  })
}

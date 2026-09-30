import { app, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import { t } from '@pureterm/i18n'
import { createUpdateCoordinator } from '../runtime/updates.js'

export function createDesktopUpdates(beforeInstall: () => Promise<void>, onInstallError: () => Promise<void>) {
  const enabled = app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
    && (process.platform !== 'linux' || !!process.env.APPIMAGE)
  return createUpdateCoordinator({
    backend: electronUpdater.autoUpdater,
    enabled,
    unavailableReason: app.isPackaged ? 'desktop.update.unavailable-packaged' : 'desktop.update.unavailable-development',
    beforeInstall,
    onInstallError,
    async confirmInstall(version) {
      const result = await dialog.showMessageBox({ type: 'info', title: t('desktop.update.title'),
        message: t('desktop.update.downloaded', { version }), detail: t('desktop.update.install-detail'),
        buttons: [t('desktop.update.later'), t('desktop.update.install-now')], defaultId: 0, cancelId: 0 })
      return result.response === 1
    },
    async message(key, params) { await dialog.showMessageBox({ type: 'info', title: t('desktop.update.title'), message: t(key, params) }) },
    onState: (state, detail) => console.log(`[updates] ${state}${detail ? `: ${detail}` : ''}`),
  })
}

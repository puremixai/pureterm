import { app, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import { t } from '@pureterm/i18n'
import type { ShutdownDecision } from '@pureterm/protocol'
import { createUpdateCoordinator } from '../runtime/updates.js'

/*
 * 桌面更新适配器：把 Electron 的 autoUpdater 和「退出前先停 Host」接起来。
 *
 * 确认与停 Host 现在合成一次 `prepareInstall(version)`——它调用的就是普通退出用的
 * 同一个协调器，只是 intent 是 'update'。于是「装包」不再有自己的一套对话框和停机路径：
 * 同一个对话框展示版本和当前中断事实，同一条租约/排空/停进程流程保证只有 graceful
 * 停稳之后才会 `quitAndInstall`。
 */
export function createDesktopUpdates(
  prepareInstall: (version: string) => Promise<ShutdownDecision>,
  onInstallError: () => Promise<void>,
) {
  const enabled = app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
    && (process.platform !== 'linux' || !!process.env.APPIMAGE)
  return createUpdateCoordinator({
    backend: electronUpdater.autoUpdater,
    enabled,
    unavailableReason: app.isPackaged ? 'desktop.update.unavailable-packaged' : 'desktop.update.unavailable-development',
    prepareInstall,
    onInstallError,
    async message(key, params) {
      await dialog.showMessageBox({ type: 'info', title: t('desktop.update.title'), message: t(key, params) })
    },
    onState: (state, detail) => console.log(`[updates] ${state}${detail ? `: ${detail}` : ''}`),
  })
}

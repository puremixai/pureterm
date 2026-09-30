import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { t } from '@pureterm/i18n'
import { collectSwitches, resolvePlatformPlan, type PlatformPlan } from '../runtime/platform-plan.js'

export type { PlatformPlan } from '../runtime/platform-plan.js'

/*
 * ElectronPlatformStrategy —— 平台差异在这里判**一次**，之后只读。
 *
 * 对应 dsh 的 seam：平台相关的东西（启动开关、关闭最后窗口的语义、菜单）集中到一个
 * 启动时选定的对象里，业务代码里不该再出现 process.platform。
 * 以前这些散在 main.ts 顶上，用 if (process.env...) 和 if (process.platform !== 'darwin')
 * 直接判——能用，但没人说得清「这台机器上到底用了哪套开关、为什么」。
 */

let cached: PlatformPlan | undefined

/** 选平台策略。幂等：只第一次生效。必须早于任何窗口创建。 */
export function selectPlatformStrategy(): PlatformPlan {
  if (cached) return cached

  const plan = resolvePlatformPlan({
    platform: process.platform,
    env: process.env,
    existingSwitches: collectSwitches((name) => app.commandLine.hasSwitch(name)),
  })

  if (plan.disableHardwareAcceleration) app.disableHardwareAcceleration()
  for (const name of plan.switches) app.commandLine.appendSwitch(name)
  for (const reason of plan.reasons) console.log(`[platform] ${reason}`)

  cached = plan
  return plan
}

/** 读取已选定的策略。没选过就抛——静默返回默认值会让「策略没生效」变成一个查不出的 bug。 */
export function platformStrategy(): PlatformPlan {
  if (!cached) throw new Error('Platform strategy not selected: selectPlatformStrategy() must run at the very start of startup.')
  return cached
}

/**
 * 装最小应用菜单。
 *
 * 故意**不装 View 子菜单**（Reload / Force Reload / Toggle DevTools / 缩放）：
 *   - Reload 会把用户所有 SSH 会话连根拔掉，在终端客户端里是个陷阱按钮；
 *   - 整体缩放会改 webContents 的 zoomFactor，xterm 的字体度量随之变化，
 *     FitAddon 算出的 cols/rows 就不再等于真实可视区域，远端排版会错位。
 * 但 Edit 子菜单**必须留**：Windows/Linux 上终端的 Ctrl+C/Ctrl+V 是靠菜单加速键提供的，
 * 把菜单整个设成 null 会让复制粘贴一起失效（这在终端里是致命的）。
 *
 * 每一项都自己给 label，而不是靠 role 的默认值：默认值是**操作系统的**语言，而这一栏
 * 要跟页面上的语言开关走。`t()` 读的是进程级的那一份语言（渲染层上报，见 main.ts 的
 * applyLocale），所以重建菜单就是再调一次 applyApplicationMenu。
 */
function menuTemplate(includeAppMenu: boolean, checkUpdates?: () => void): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  if (includeAppMenu) template.push({ role: 'appMenu' })
  template.push({
    label: t('desktop.menu.edit'),
    submenu: [
      { role: 'undo', label: t('desktop.menu.undo') },
      { role: 'redo', label: t('desktop.menu.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('desktop.menu.cut') },
      { role: 'copy', label: t('desktop.menu.copy') },
      { role: 'paste', label: t('desktop.menu.paste') },
      { role: 'selectAll', label: t('desktop.menu.select-all') },
    ],
  })
  if (checkUpdates) template.push({ label: t('desktop.menu.help'), submenu: [{ label: t('desktop.menu.check-updates'), click: checkUpdates }] })
  return template
}

export function applyApplicationMenu(checkUpdates?: () => void): void {
  const plan = platformStrategy()
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(plan.includeAppMenu, checkUpdates)))
}

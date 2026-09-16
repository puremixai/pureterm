import { app, Menu, type MenuItemConstructorOptions } from 'electron'
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
  if (!cached) throw new Error('平台策略还没选：必须在启动最前面调用 selectPlatformStrategy()。')
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
 */
function menuTemplate(includeAppMenu: boolean, checkUpdates?: () => void): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  if (includeAppMenu) template.push({ role: 'appMenu' })
  template.push({
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ],
  })
  if (checkUpdates) template.push({ label: '帮助', submenu: [{ label: '检查更新…', click: checkUpdates }] })
  return template
}

export function applyApplicationMenu(checkUpdates?: () => void): void {
  const plan = platformStrategy()
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(plan.includeAppMenu, checkUpdates)))
}

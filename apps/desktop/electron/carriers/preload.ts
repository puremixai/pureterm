import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_CHANNELS, type DesktopBridge } from '@pureterm/protocol'
import { drawsOwnWindowControls } from '../runtime/platform-plan.js'

declare const window: { location: { protocol: string; host: string; username: string; password: string } }

// Electron compiles this sandboxed preload to CommonJS. The shell exposes only
// startup coordination and, where the platform has no caption buttons of its
// own, the three the top bar draws; every application request travels over
// WebSocket.
if (process.isMainFrame && window.location.protocol === 'pureterm-app:' && window.location.host === 'app'
  && !window.location.username && !window.location.password) {
  const bridge: DesktopBridge = {
    bootstrap: () => ipcRenderer.invoke(DESKTOP_CHANNELS.bootstrap),
    signalReady: payload => ipcRenderer.send(DESKTOP_CHANNELS.ready, payload),
    // send, not invoke: a window command has no answer to wait for, and making
    // the renderer await one would put a round trip between the click and the
    // window moving.
    //
    // Present only where the OS draws nothing itself — macOS keeps its traffic
    // lights under titleBarStyle: 'hidden', so the top bar must not draw a second
    // set beside them. The renderer keys on this key being there, which is why the
    // decision is a platform question and lives in platform-plan.ts.
    ...(drawsOwnWindowControls(process.platform) ? {
      windowControls: {
        minimize: () => ipcRenderer.send(DESKTOP_CHANNELS.windowMinimize),
        toggleMaximize: () => ipcRenderer.send(DESKTOP_CHANNELS.windowToggleMaximize),
        close: () => ipcRenderer.send(DESKTOP_CHANNELS.windowClose),
      },
    } : {}),
  }
  contextBridge.exposeInMainWorld('puretermDesktop', bridge)
}

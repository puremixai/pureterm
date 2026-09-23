import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_CHANNELS, type DesktopBridge } from '@pureterm/protocol'

declare const window: { location: { protocol: string; host: string; username: string; password: string } }

// Electron compiles this sandboxed preload to CommonJS. The shell exposes only
// startup coordination; every application request travels over WebSocket.
if (process.isMainFrame && window.location.protocol === 'pureterm-app:' && window.location.host === 'app'
  && !window.location.username && !window.location.password) {
  const bridge: DesktopBridge = {
    bootstrap: () => ipcRenderer.invoke(DESKTOP_CHANNELS.bootstrap),
    signalReady: payload => ipcRenderer.send(DESKTOP_CHANNELS.ready, payload),
  }
  contextBridge.exposeInMainWorld('puretermDesktop', bridge)
}

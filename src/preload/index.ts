import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  closeApp: () => ipcRenderer.send('close-app'),
  openSettings: () => ipcRenderer.send('open-settings'),
  onSwitchView: (callback: (view: string) => void) => {
    const subscription = (_: any, view: string) => callback(view)
    ipcRenderer.on('switch-view', subscription)
    return () => ipcRenderer.removeListener('switch-view', subscription)
  },
  setActiveView: (view: 'monitor' | 'settings') => ipcRenderer.send('view-changed', view),
  resizeWindow: (width: number, height: number) => ipcRenderer.send('resize-window', width, height),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  loginClaude: () => ipcRenderer.invoke('login-claude'),
  reauthenticateCodexAccount: (accountId: 'a' | 'b') =>
    ipcRenderer.invoke('reauthenticate-codex-account', accountId),
  openCodexAuthUrl: (url: string) => ipcRenderer.invoke('open-codex-auth-url', url),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  onLoginSuccess: (callback: (service: string) => void) => {
    const subscription = (_: any, service: string) => callback(service)
    ipcRenderer.on('login-success', subscription)
    return () => ipcRenderer.removeListener('login-success', subscription)
  },
  onUpdateUsage: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('update-usage', subscription)
    return () => ipcRenderer.removeListener('update-usage', subscription)
  },
  onCodexAuthUpdate: (callback: (result: any) => void) => {
    const subscription = (_: any, result: any) => callback(result)
    ipcRenderer.on('codex-auth-update', subscription)
    return () => ipcRenderer.removeListener('codex-auth-update', subscription)
  },
  getLastCliStatus: () => ipcRenderer.invoke('get-last-cli-status'),
  checkCliPaths: () => ipcRenderer.invoke('check-cli-paths')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

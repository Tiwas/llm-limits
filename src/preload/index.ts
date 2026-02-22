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
  }
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

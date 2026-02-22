/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ELECTRON_RENDERER_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    api: {
      closeApp: () => void
      openSettings: () => void
      onSwitchView: (callback: (view: string) => void) => () => void
      setActiveView: (view: 'monitor' | 'settings') => void
      resizeWindow: (width: number, height: number) => void
      getSettings: () => Promise<any>
      saveSettings: (settings: any) => Promise<boolean>
      loginClaude: () => void
      showContextMenu: () => void
      onLoginSuccess: (callback: (service: string) => void) => () => void
      onUpdateUsage: (callback: (data: any) => void) => () => void
    }
  }
}

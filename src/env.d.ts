/// <reference types="vite/client" />

export {}

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
      reauthenticateCodexAccount: (accountId: 'a' | 'b') => Promise<{
        accountId: 'a' | 'b'
        loginId: string
        verificationUrl: string
        userCode: string
      }>
      openCodexAuthUrl: (url: string) => Promise<boolean>
      showContextMenu: () => void
      onLoginSuccess: (callback: (service: string) => void) => () => void
      onUpdateUsage: (callback: (data: any) => void) => () => void
      onCodexAuthUpdate: (callback: (result: {
        accountId: 'a' | 'b'
        success: boolean
        error: string | null
      }) => void) => () => void
      getLastCliStatus: () => Promise<{ codex: boolean; gcloud: boolean; everRun: boolean }>
      checkCliPaths: () => Promise<{ codex: boolean; gcloud: boolean }>
    }
  }
}

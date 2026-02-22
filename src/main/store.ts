import Store from 'electron-store'

interface StoreSchema {
  openaiKey: string
  geminiKey: string
  anthropicKey: string
  updateFrequency: number
  timeFormat: '24h' | '12h'
  dateFormat: 'dd.mm.yyyy' | 'mm.dd.yyyy'
  dateSeparator: '.' | '/'
  autoStart: boolean
  hasCompletedSetup: boolean
  
  // Integration Settings
  anthropicMode: 'api' | 'web'
  anthropicWebCookie: string
  anthropicOrgId: string
  
  // Debug
  debugMode: boolean
  
  // Window State
  monitorWidth: number
  monitorHeight: number
  monitorX: number
  monitorY: number
}

const store = new Store<StoreSchema>({
  defaults: {
    openaiKey: '',
    geminiKey: '',
    anthropicKey: '',
    updateFrequency: 5,
    timeFormat: '24h',
    dateFormat: 'dd.mm.yyyy',
    dateSeparator: '.',
    autoStart: false,
    hasCompletedSetup: false,
    anthropicMode: 'api',
    anthropicWebCookie: '',
    anthropicOrgId: '',
    debugMode: false,
    monitorWidth: 300,
    monitorHeight: 150,
    monitorX: -1,
    monitorY: -1
  },
  encryptionKey: 'llm-limits-secure-key' // Simple obfuscation, not robust security
})

export default store

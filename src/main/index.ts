import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, session, net } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import store from './store'
import { getClaudeWebUsage, getCodexUsage } from './services/usage'
import { getGcloudGeminiUsage } from './services/gcloud'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let pollingInterval: NodeJS.Timeout | null = null
let activeView: 'monitor' | 'settings' = 'monitor'

type SnapPosition =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'middle-left'
    | 'middle-center'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'

function resolveUpdateFrequency(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 1) return 5
    return parsed
}

function hasAnyConfiguredProvider(): boolean {
    const openaiKey = String(store.get('openaiKey') || '').trim()
    const geminiKey = String(store.get('geminiKey') || '').trim()
    const anthropicKey = String(store.get('anthropicKey') || '').trim()
    const anthropicCookie = String(store.get('anthropicWebCookie') || '').trim()
    const anthropicOrgId = String(store.get('anthropicOrgId') || '').trim()
    return Boolean(openaiKey || geminiKey || anthropicKey || (anthropicCookie && anthropicOrgId))
}

function shouldAutoOpenSettings(): boolean {
    const hasCompletedSetup = Boolean(store.get('hasCompletedSetup'))
    return !hasCompletedSetup || !hasAnyConfiguredProvider()
}

function applyAutoStartSetting(): void {
    const openAtLogin = Boolean(store.get('autoStart'))
    if (process.platform === 'win32') {
        app.setLoginItemSettings({
            openAtLogin,
            path: process.execPath
        })
        return
    }
    if (process.platform === 'darwin') {
        app.setLoginItemSettings({ openAtLogin })
    }
}

// Helper to fetch Organization ID using the captured cookie
async function fetchClaudeOrgId(cookie: string): Promise<string | null> {
    return new Promise((resolve) => {
        const request = net.request({
            method: 'GET',
            url: 'https://claude.ai/api/organizations',
            useSessionCookies: true
        })
        
        request.setHeader('Cookie', cookie)
        request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        
        request.on('response', (response) => {
            let data = ''
            response.on('data', (chunk) => {
                data += chunk.toString()
            })
            response.on('end', () => {
                try {
                    const json = JSON.parse(data)
                    // Take the first organization (most users only have one personal org)
                    if (Array.isArray(json) && json.length > 0) {
                        resolve(json[0].uuid)
                    } else {
                        console.error('No organizations found in response:', data)
                        resolve(null)
                    }
                } catch (e) {
                    console.error('Failed to parse Claude Org response:', e)
                    resolve(null)
                }
            })
        })
        
        request.on('error', (err) => {
            console.error('Network error fetching Org ID:', err)
            resolve(null)
        })
        
        request.end()
    })
}

async function pollUsage() {
    const debug = store.get('debugMode')
    if (debug) console.log('Polling usage...')
    
    // Initialize with null/empty to indicate "no data" by default
    const data: any = {
        openai: null,
        gemini: null,
        anthropic: null
    }

    // --- Claude / Anthropic ---
    const claudeMode = store.get('anthropicMode')
    const claudeCookie = store.get('anthropicWebCookie')
    const claudeOrg = store.get('anthropicOrgId')

    if (claudeMode === 'web' && claudeCookie && claudeOrg) {
        try {
            if (debug) console.log(`Fetching Claude Web usage for Org: ${claudeOrg}`)
            const usage = await getClaudeWebUsage(claudeCookie, claudeOrg)
            if (usage) data.anthropic = usage
        } catch (e) {
            console.error('Error polling Claude:', e)
        }
    } else {
        // Only show if we have explicit settings, otherwise hidden
        const apiKey = store.get('anthropicKey')
        if (apiKey && claudeMode === 'api') {
             // Placeholder for API mode if implemented later
             data.anthropic = { percent: 0, used: 0, limit: 100 }
        }
    }

    // --- Codex / OpenAI ---
    const openaiKey = store.get('openaiKey')
    if (debug) console.log(`Checking Codex Key: ${openaiKey ? 'Present' : 'Missing (Will try local)'}`)
    
    // Always try to fetch, let the service handle fallback to local token
    try {
         if (debug) console.log('Fetching Codex usage...')
         // Pass undefined if key is missing, so service looks for local token
         const usage = await getCodexUsage(openaiKey || undefined)
         if (usage) {
             if (debug) console.log('Codex usage fetched successfully:', usage)
             data.openai = usage
         } else {
             if (debug) console.log('Codex usage returned null')
             // Only use mock if both API key AND local token failed
             if (!openaiKey) {
                 data.openai = { percent: 45, used: 450, limit: 1000 }
             }
         }
    } catch (e) {
        console.error('Error polling Codex:', e)
    }

    // --- Gemini ---
    const geminiKey = store.get('geminiKey')
    if (geminiKey) {
        // Placeholder for real Gemini API implementation
        // For now, return a mock "Connected via API" state
        data.gemini = {
            percent: 0,
            used: 0,
            limit: 100,
            sessionPercent: 0,
            periodPercent: 0,
            sessionResetAt: null,
            periodResetAt: null
        }
    } else {
        // Try gcloud fallback
        try {
            const gcloudUsage = await getGcloudGeminiUsage()
            if (gcloudUsage) {
                if (debug) console.log('Found Gemini via gcloud')
                data.gemini = gcloudUsage
            }
        } catch (e) {
            console.error('Error polling Gemini via gcloud:', e)
        }
    }

    mainWindow?.webContents.send('update-usage', data)
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval)
    const frequency = resolveUpdateFrequency(store.get('updateFrequency'))
    pollingInterval = setInterval(pollUsage, frequency * 60 * 1000)
    pollUsage() // Initial fetch
}

function createSnapSubmenu() {
    return [
        { label: 'Top Left', click: () => snapWindowToPosition('top-left') },
        { label: 'Top Center', click: () => snapWindowToPosition('top-center') },
        { label: 'Top Right', click: () => snapWindowToPosition('top-right') },
        { label: 'Middle Left', click: () => snapWindowToPosition('middle-left') },
        { label: 'Middle Center', click: () => snapWindowToPosition('middle-center') },
        { label: 'Middle Right', click: () => snapWindowToPosition('middle-right') },
        { label: 'Bottom Left', click: () => snapWindowToPosition('bottom-left') },
        { label: 'Bottom Center', click: () => snapWindowToPosition('bottom-center') },
        { label: 'Bottom Right', click: () => snapWindowToPosition('bottom-right') }
    ]
}

function snapWindowToPosition(position: SnapPosition) {
    if (!mainWindow) return
    const bounds = mainWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const { x, y, width, height } = display.workArea

    let targetX = x
    let targetY = y

    if (position.includes('right')) {
        targetX = x + width - bounds.width
    } else if (position.includes('center')) {
        targetX = x + Math.round((width - bounds.width) / 2)
    }

    if (position.startsWith('bottom')) {
        targetY = y + height - bounds.height
    } else if (position.startsWith('middle')) {
        targetY = y + Math.round((height - bounds.height) / 2)
    }

    mainWindow.setPosition(targetX, targetY)
    store.set({ monitorX: targetX, monitorY: targetY })
}

function startClaudeLogin() {
    const loginWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    })

    loginWindow.loadURL('https://claude.ai/login')

    // Listen for cookies
    session.defaultSession.cookies.on('changed', async (event, cookie, cause, removed) => {
        if (!removed && cookie.domain?.includes('claude.ai') && cookie.name === 'sessionKey') {
            const sessionCookie = `${cookie.name}=${cookie.value}`
            console.log('Captured Claude Session Key!')
            
            // Try to fetch Org ID immediately to verify
            const orgId = await fetchClaudeOrgId(sessionCookie)
            
            if (orgId) {
                console.log(`Found Organization ID: ${orgId}`)
                store.set('anthropicWebCookie', sessionCookie)
                store.set('anthropicOrgId', orgId)
                store.set('anthropicMode', 'web')
                
                // Notify renderer
                mainWindow?.webContents.send('login-success', 'anthropic')
                
                loginWindow.close()
                startPolling() // Refresh usage immediately
            }
        }
    })
}

function createTrayIcon(): Electron.NativeImage {
    const iconCandidates = [
        join(process.cwd(), 'build/icons/app.ico'),
        join(app.getAppPath(), 'build/icons/app.ico'),
        join(process.resourcesPath, 'build/icons/app.ico'),
        join(process.resourcesPath, 'app.asar', 'build/icons/app.ico')
    ]

    for (const candidate of iconCandidates) {
        if (!existsSync(candidate)) continue
        const iconFromPath = nativeImage.createFromPath(candidate).resize({ width: 16, height: 16 })
        if (!iconFromPath.isEmpty()) return iconFromPath
    }

    const robotSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="14" y="18" width="36" height="30" rx="8" fill="#2563eb"/>
  <circle cx="26" cy="33" r="4" fill="#e2e8f0"/>
  <circle cx="38" cy="33" r="4" fill="#e2e8f0"/>
  <rect x="24" y="41" width="16" height="3" rx="1.5" fill="#e2e8f0"/>
  <rect x="30" y="9" width="4" height="10" rx="2" fill="#22c55e"/>
  <circle cx="32" cy="8" r="3.5" fill="#22c55e"/>
</svg>`

    const iconFromSvg = nativeImage
        .createFromDataURL(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(robotSvg)}`)
        .resize({ width: 16, height: 16 })

    if (!iconFromSvg.isEmpty()) return iconFromSvg

    // Fallback if SVG parsing fails on a platform/runtime.
    return nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAChJREFUOE9j/P8fCmBnwA4Y/4fC/6Hw/0g0I/z/Hwqj6UA0G4hmA9H8DwB01h/xWw631AAAAABJRU5ErkJggg=='
    )
}

function createTray(): void {
  const icon = createTrayIcon()
  
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Monitor', click: () => {
        mainWindow?.show()
        mainWindow?.webContents.send('switch-view', 'monitor')
    }},
    { label: 'Settings', click: () => {
        mainWindow?.show()
        mainWindow?.webContents.send('switch-view', 'settings')
    }},
    { label: 'Snap Window', submenu: createSnapSubmenu() as any },
    { type: 'separator' },
    { label: 'DevTools', click: () => mainWindow?.webContents.openDevTools({ mode: 'detach' }) },
    { label: 'Quit', click: () => app.quit() }
  ])
  
  tray.setToolTip('AI Limit Monitor')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
        mainWindow.hide()
    } else {
        mainWindow.show()
    }
  })
}

function createWindow(): void {
  const monitorWidth = Number(store.get('monitorWidth')) || 300
  const monitorHeight = Number(store.get('monitorHeight')) || 150
  const monitorX = Number(store.get('monitorX'))
  const monitorY = Number(store.get('monitorY'))
  const hasSavedPosition = Number.isFinite(monitorX) && Number.isFinite(monitorY) && monitorX >= 0 && monitorY >= 0

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: monitorWidth,
    height: monitorHeight,
    ...(hasSavedPosition ? { x: monitorX, y: monitorY } : {}),
    show: false,
    frame: false,
    transparent: false, // Disabled to ensure visibility
    backgroundColor: '#e2e8f0', // Solid Slate-200
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true, // Allow manual resize
    // center: true, // Let it stay where user put it
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // Open DevTools for debugging if needed
    // mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })
  
  // Native Context Menu (Works over drag regions)
  mainWindow.webContents.on('context-menu', (e, params) => {
      const menu = Menu.buildFromTemplate([
          { label: 'Settings', click: () => mainWindow?.webContents.send('switch-view', 'settings') },
          { label: 'Refresh Data', click: () => pollUsage() },
          { label: 'Snap Window', submenu: createSnapSubmenu() as any },
          { type: 'separator' },
          { label: 'Close', click: () => app.quit() }
      ])
      menu.popup()
  })

  mainWindow.on('move', () => {
      if (!mainWindow) return
      const bounds = mainWindow.getBounds()
      store.set({ monitorX: bounds.x, monitorY: bounds.y })
  })

  mainWindow.on('resize', () => {
      if (!mainWindow) return
      if (activeView !== 'monitor') return
      const bounds = mainWindow.getBounds()
      store.set({ monitorWidth: bounds.width, monitorHeight: bounds.height })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => {
      if (!mainWindow) return
      if (shouldAutoOpenSettings()) {
          mainWindow.webContents.send('switch-view', 'settings')
      }
  })
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()
  applyAutoStartSetting()
  startPolling()
  
  ipcMain.on('close-app', () => {
     app.quit()
  })
  
  ipcMain.on('open-settings', () => {
     // TODO: Implement settings window
     console.log('Open settings requested')
  })

  ipcMain.on('resize-window', (_, width, height) => {
    mainWindow?.setSize(width, height)
  })

  ipcMain.on('view-changed', (_, view: 'monitor' | 'settings') => {
    activeView = view
  })

  ipcMain.handle('get-settings', () => {
      return store.store
  })

  ipcMain.handle('save-settings', (_, settings) => {
      const updateFrequency = resolveUpdateFrequency(settings?.updateFrequency)
      const autoStart = Boolean(settings?.autoStart)
      store.set({ ...settings, updateFrequency, autoStart, hasCompletedSetup: true })
      applyAutoStartSetting()
      startPolling() // Restart polling with new frequency/keys
      return true
  })

  ipcMain.handle('login-claude', () => {
      startClaudeLogin()
  })
  
  ipcMain.on('show-context-menu', () => {
      const menu = Menu.buildFromTemplate([
          { label: 'Settings', click: () => mainWindow?.webContents.send('switch-view', 'settings') },
          { label: 'Refresh Data', click: () => pollUsage() },
          { label: 'Snap Window', submenu: createSnapSubmenu() as any },
          { type: 'separator' },
          { label: 'Close', click: () => app.quit() }
      ])
      menu.popup()
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

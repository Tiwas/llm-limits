import { useState, useEffect } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import openaiSimpleIcon from './assets/icons/openai-simple.svg'
import claudeSimpleIcon from './assets/icons/claude-simple.svg'
import geminiSimpleIcon from './assets/icons/gemini-simple.svg'

const BASE_MONITOR_WIDTH = 300
const BASE_MONITOR_HEIGHT = 150

function getViewportSize(): { width: number; height: number } {
  return {
    width: window.innerWidth || BASE_MONITOR_WIDTH,
    height: window.innerHeight || BASE_MONITOR_HEIGHT
  }
}

function App(): JSX.Element {
  const [view, setView] = useState<'monitor' | 'settings'>('monitor')
  const [quotaMode, setQuotaMode] = useState<'session' | 'period'>('session')
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [viewport, setViewport] = useState(getViewportSize)
  const [usageData, setUsageData] = useState<any>({ openai: null, gemini: null, anthropic: null })
  const [settings, setSettings] = useState<any>({
      openaiKey: '', geminiKey: '', updateFrequency: 5, 
      anthropicMode: 'api', anthropicWebCookie: '', anthropicOrgId: '',
      monitorWidth: 300, monitorHeight: 150, timeFormat: '24h',
      dateFormat: 'dd.mm.yyyy', dateSeparator: '.', autoStart: false
  })

  const normalizeSettings = (raw: any) => ({
      ...raw,
      timeFormat: raw?.timeFormat === '12h' ? '12h' : '24h',
      dateFormat: raw?.dateFormat === 'mm.dd.yyyy' ? 'mm.dd.yyyy' : 'dd.mm.yyyy',
      dateSeparator: raw?.dateSeparator === '/' ? '/' : '.',
      autoStart: Boolean(raw?.autoStart)
  })

  useEffect(() => {
    const cleanupSwitch = window.api.onSwitchView((newView) => {
      setView(newView as 'monitor' | 'settings')
    })
    
    // ... rest of effect
    const cleanupUsage = window.api.onUpdateUsage((data) => {
        setUsageData(data)
    })
    const cleanupLogin = window.api.onLoginSuccess((service) => {
        if (service === 'anthropic') {
            window.api.getSettings().then((nextSettings) => {
                setSettings(normalizeSettings(nextSettings))
                setSettingsLoaded(true)
            })
            alert('Successfully logged in to Claude!')
        }
    })
    
    // Global Context Menu Listener (Backup for drag regions)
    const handleRightClick = (e: MouseEvent) => {
        e.preventDefault()
        window.api.showContextMenu()
    }
    window.addEventListener('contextmenu', handleRightClick)
    
    window.api.getSettings().then((nextSettings) => {
        setSettings(normalizeSettings(nextSettings))
        setSettingsLoaded(true)
    })

    return () => {
        cleanupSwitch()
        cleanupUsage()
        cleanupLogin()
        window.removeEventListener('contextmenu', handleRightClick)
    }
  }, [])

  useEffect(() => {
    const handleResize = () => setViewport(getViewportSize())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    window.api.setActiveView(view)
    if (!settingsLoaded) return
    if (view === 'settings') {
      window.api.resizeWindow(460, 820)
      return
    }
    // Always restore latest persisted monitor size when returning to monitor.
    window.api.getSettings().then((latestSettings) => {
      window.api.resizeWindow(latestSettings.monitorWidth || 300, latestSettings.monitorHeight || 150)
    })
  }, [view, settingsLoaded])

  const handleClose = () => window.api.closeApp()
  const handleBack = () => setView('monitor')
  const handleClaudeLogin = () => window.api.loginClaude()
  
  const saveConfig = () => {
      const parsedFrequency = Number.parseInt(String(settings.updateFrequency), 10)
      const payload = {
          ...settings,
          updateFrequency: Number.isFinite(parsedFrequency) && parsedFrequency >= 1 ? parsedFrequency : 5,
          timeFormat: settings.timeFormat === '12h' ? '12h' : '24h',
          dateFormat: settings.dateFormat === 'mm.dd.yyyy' ? 'mm.dd.yyyy' : 'dd.mm.yyyy',
          dateSeparator: settings.dateSeparator === '/' ? '/' : '.'
      }
      window.api.saveSettings(payload).then(() => {
          setView('monitor')
      })
  }

  const formatReset = (rawReset: unknown): string => {
      if (typeof rawReset !== 'string' || !rawReset.trim()) return 'unknown'
      const parsed = new Date(rawReset)
      if (Number.isNaN(parsed.getTime())) return rawReset
      const sep = settings.dateSeparator === '/' ? '/' : '.'
      const dd = String(parsed.getDate()).padStart(2, '0')
      const mm = String(parsed.getMonth() + 1).padStart(2, '0')
      const yyyy = String(parsed.getFullYear())

      const datePart =
        settings.dateFormat === 'mm.dd.yyyy'
          ? `${mm}${sep}${dd}${sep}${yyyy}`
          : `${dd}${sep}${mm}${sep}${yyyy}`

      const minutes = String(parsed.getMinutes()).padStart(2, '0')
      const seconds = String(parsed.getSeconds()).padStart(2, '0')
      if (settings.timeFormat === '12h') {
        const hour24 = parsed.getHours()
        const suffix = hour24 >= 12 ? 'PM' : 'AM'
        const hour12 = hour24 % 12 || 12
        const hours = String(hour12).padStart(2, '0')
        return `${datePart} ${hours}:${minutes}:${seconds} ${suffix}`
      }
      const hours = String(parsed.getHours()).padStart(2, '0')
      return `${datePart} ${hours}:${minutes}:${seconds}`
  }

  const getDisplayedPercent = (providerData: any): number => {
      if (!providerData) return 0
      const key = quotaMode === 'period' ? 'periodPercent' : 'sessionPercent'
      const fromMode = providerData[key]
      if (typeof fromMode === 'number') return fromMode
      if (typeof providerData.percent === 'number') return providerData.percent
      return 0
  }

  const getDisplayedReset = (providerData: any): string => {
      if (!providerData) return 'unknown'
      const key = quotaMode === 'period' ? 'periodResetAt' : 'sessionResetAt'
      return formatReset(providerData[key])
  }

  // Monitor View Component
  if (view === 'monitor') {
      const monitorScale = Math.min(
        viewport.width / BASE_MONITOR_WIDTH,
        viewport.height / BASE_MONITOR_HEIGHT
      )

      // Define providers
      const providers = [
          { key: 'openai', label: 'Codex', data: usageData.openai, icon: openaiSimpleIcon, color: '#10a37f' },
          { key: 'anthropic', label: 'Claude', data: usageData.anthropic, icon: claudeSimpleIcon, color: '#d97706' },
          { key: 'gemini', label: 'Gemini', data: usageData.gemini, icon: geminiSimpleIcon, color: '#2563eb' }
      ]

      // Filter: Show provider if data is NOT null
      const activeProviders = providers.filter(p => p.data !== null)

      // Determine ring color based on usage
      const getRingColor = (percent: number, baseColor: string) => {
          if (percent > 90) return '#ef4444' // Red
          if (percent > 75) return '#f59e0b' // Yellow/Orange
          return baseColor // Default brand color
      }

      return (
        <div 
            style={{ 
                backgroundColor: '#e2e8f0', // slate-200
                width: '100vw',
                height: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '12px', 
                border: '2px solid #94a3b8', // slate-400
                boxSizing: 'border-box',
                color: '#0f172a',
                // Make this specific container draggable, but allow clicks to pass through to children
                // Note: On Windows, drag regions often swallow right-clicks.
                // To fix context menu, we might need to rely ONLY on the drag handle or border.
                // Let's try making the whole thing drag, but relying on the window listener for context menu.
                // If that fails, we'll use a specific drag handle.
                // Strategy: Use a specific "Handle" at the top.
            }}
            className="group"
            onClick={() => setQuotaMode((prev) => (prev === 'session' ? 'period' : 'session'))}
            title="Click to toggle session/period quota"
        >
          {/* CSS for Hover Logic */}
          <style>{`
            #controls { opacity: 0; pointer-events: none; transition: opacity 0.2s ease-in-out; }
            .group:hover #controls { opacity: 1; pointer-events: auto; }
          `}</style>
          
          {/* Drag Handle - Top Strip Only */}
          <div 
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '24px', // Only top area is draggable
                zIndex: 50, // Below controls (9999) but above content
                WebkitAppRegion: 'drag',
                cursor: 'move'
            } as any}
            title="Drag here"
          />
          <div className="w-full h-full flex items-center justify-center">
            <div
              style={{
                width: `${BASE_MONITOR_WIDTH}px`,
                height: `${BASE_MONITOR_HEIGHT}px`,
                transform: `scale(${monitorScale})`,
                transformOrigin: 'center center'
              }}
            >
              <div className="flex flex-col items-center justify-center w-full h-full">
                {activeProviders.length === 0 ? (
                    <div className="text-xs font-medium text-slate-500 select-none">Loading data...</div>
                ) : (
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-600 select-none">
                        {quotaMode === 'session' ? 'Session usage' : 'Period usage'}
                      </div>
                      <div className="flex items-center justify-center space-x-10">
                        {activeProviders.map((p) => {
                            const percent = getDisplayedPercent(p.data)
                            const ringColor = getRingColor(percent, p.color)
                            
                            return (
                                <div key={p.key} className="flex flex-col items-center group/item relative">
                                    <div 
                                        className="relative mb-1 flex items-center justify-center"
                                        style={{ width: '64px', height: '64px', flexShrink: 0 }}
                                    >
                                        {/* Background Ring */}
                                        <svg 
                                            className="absolute top-0 left-0" 
                                            style={{ width: '100%', height: '100%', pointerEvents: 'none', transform: 'rotate(-90deg)' }}
                                        >
                                           <circle cx="32" cy="32" r="28" stroke="#cbd5e1" strokeWidth="3" fill="transparent" />
                                           {/* Progress Ring */}
                                           <circle 
                                                cx="32" 
                                                cy="32" 
                                                r="28" 
                                                stroke={ringColor} 
                                                strokeWidth="3" 
                                                fill="transparent" 
                                                strokeDasharray={`${percent * 1.76} 176`} 
                                                strokeLinecap="butt" 
                                                className="transition-all duration-500 ease-out"
                                            />
                                        </svg>
                                        
                                        {/* Icon in Center - Absolutely centered to avoid layout shift */}
                                        <div style={{ color: p.color, zIndex: 10, position: 'relative' }}> 
                                            <img src={p.icon} alt={`${p.label} icon`} style={{ width: 22, height: 22, display: 'block' }} />
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-600 select-none tracking-wide">{p.label} ({percent}%)</span>
                                </div>
                            )
                        })}
                      </div>
                      <div className="text-[10px] text-slate-500 select-none">
                        Resets: {activeProviders.map((p) => `${p.label}: ${getDisplayedReset(p.data)}`).join(' | ')}
                      </div>
                    </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )
  }

  if (view === 'settings') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', backgroundColor: '#e2e8f0', color: '#0f172a', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #cbd5e1', backgroundColor: '#e2e8f0', flexShrink: 0, userSelect: 'none' }}>
            <button onClick={handleBack} className="p-2 hover:bg-slate-300 rounded-full text-slate-600 hover:text-slate-900 transition-colors" title="Back">
                <ArrowLeft size={18} />
            </button>
            <div className="flex flex-col items-center">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Settings</h2>
                <span className="text-[10px] text-slate-400 font-mono">v1.2.3 (Stable)</span>
            </div>
             <button onClick={handleClose} className="p-2 hover:bg-red-200 rounded-full text-slate-600 hover:text-red-700 transition-colors" title="Close App">
                <X size={18} />
           </button>
        </div>
        <div className="no-drag scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-transparent" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
             <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Codex API Key (OpenAI)</label>
                <input type="password" value={settings.openaiKey} onChange={(e) => setSettings({...settings, openaiKey: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 placeholder-slate-400 shadow-sm transition-all" placeholder="sk-..." />
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Gemini API Key</label>
                <input type="password" value={settings.geminiKey} onChange={(e) => setSettings({...settings, geminiKey: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 placeholder-slate-400 shadow-sm transition-all" placeholder="AIza..." />
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Claude Code Integration</label>
                <div className="flex space-x-2 mb-2">
                    <button onClick={() => setSettings({...settings, anthropicMode: 'api'})} className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.anthropicMode === 'api' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>API Key</button>
                    <button onClick={() => setSettings({...settings, anthropicMode: 'web'})} className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.anthropicMode === 'web' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>Web Login</button>
                </div>
                {settings.anthropicMode === 'api' ? (
                    <input type="password" value={settings.anthropicKey} onChange={(e) => setSettings({...settings, anthropicKey: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 placeholder-slate-400 shadow-sm transition-all" placeholder="sk-ant..." />
                ) : (
                    <div className="bg-white border border-slate-300 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500 font-medium">Status:</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${settings.anthropicOrgId ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{settings.anthropicOrgId ? 'Connected' : 'Not Connected'}</span>
                        </div>
                        {settings.anthropicOrgId && <div className="text-[10px] text-slate-400 font-mono truncate">Org: {settings.anthropicOrgId}</div>}
                        <button onClick={handleClaudeLogin} className="w-full bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 rounded transition-colors flex items-center justify-center space-x-2"><span>{settings.anthropicOrgId ? 'Reconnect / Switch Account' : 'Log in to Claude'}</span></button>
                    </div>
                )}
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Update Frequency (min)</label>
                                <input 
                                    type="number" 
                                    value={settings.updateFrequency ?? 5}
                                    onChange={(e) => {
                                      setSettings({ ...settings, updateFrequency: e.target.value })
                                    }}
                                    min={1} 
                                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 shadow-sm transition-all" 
                                />
                            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Time Format</label>
                <div className="flex space-x-2">
                    <button
                      onClick={() => setSettings({ ...settings, timeFormat: '24h' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.timeFormat === '24h' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      24H
                    </button>
                    <button
                      onClick={() => setSettings({ ...settings, timeFormat: '12h' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.timeFormat === '12h' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      12H
                    </button>
                </div>
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Date Format</label>
                <div className="flex space-x-2">
                    <button
                      onClick={() => setSettings({ ...settings, dateFormat: 'dd.mm.yyyy' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateFormat === 'dd.mm.yyyy' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      DD.MM.YYYY
                    </button>
                    <button
                      onClick={() => setSettings({ ...settings, dateFormat: 'mm.dd.yyyy' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateFormat === 'mm.dd.yyyy' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      MM.DD.YYYY
                    </button>
                </div>
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Date Separator</label>
                <div className="flex space-x-2">
                    <button
                      onClick={() => setSettings({ ...settings, dateSeparator: '.' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateSeparator === '.' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      .
                    </button>
                    <button
                      onClick={() => setSettings({ ...settings, dateSeparator: '/' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateSeparator === '/' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      /
                    </button>
                </div>
            </div>
                
                            <div className="flex items-center space-x-2 pt-2 border-t border-slate-300">
                                <input 
                                    type="checkbox" 
                                    id="autoStart"
                                    checked={settings.autoStart}
                                    onChange={(e) => setSettings({...settings, autoStart: e.target.checked})}
                                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                />
                                <label htmlFor="autoStart" className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                                    Auto Start On OS Login
                                </label>
                            </div>

                            <div className="flex items-center space-x-2">
                                <input 
                                    type="checkbox" 
                                    id="debugMode"
                                    checked={settings.debugMode}
                                    onChange={(e) => setSettings({...settings, debugMode: e.target.checked})}
                                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                />
                                <label htmlFor="debugMode" className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                                    Enable Debug Logging (Console)
                                </label>
                            </div>
                        </div>
        <div style={{ padding: '16px 24px 24px 24px', backgroundColor: '#e2e8f0', borderTop: '1px solid #cbd5e1', flexShrink: 0, zIndex: 10 }}>
            <button onClick={saveConfig} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-3 rounded-lg shadow-lg transition-transform transform active:scale-[0.98] border border-blue-800 flex items-center justify-center">Save & Close</button>
        </div>
      </div>
    )
  }

  return null
}

export default App

import { useState, useEffect, type JSX } from 'react'
import { X, ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react'
import openaiSimpleIcon from './assets/icons/openai-simple.svg'
import claudeSimpleIcon from './assets/icons/claude-simple.svg'
import geminiSimpleIcon from './assets/icons/gemini-simple.svg'

const BASE_MONITOR_WIDTH = 300
const BASE_MONITOR_HEIGHT = 150

type CodexAccountId = 'a' | 'b'

interface CodexAuthFlowState {
  status: 'starting' | 'awaiting' | 'success' | 'error'
  verificationUrl?: string
  userCode?: string
  error?: string
}

function getViewportSize(): { width: number; height: number } {
  return {
    width: window.innerWidth || BASE_MONITOR_WIDTH,
    height: window.innerHeight || BASE_MONITOR_HEIGHT
  }
}

/**
 * Renders the floating quota monitor and its provider settings view.
 *
 * @returns {JSX.Element} Current monitor or settings UI.
 */
function App(): JSX.Element {
  const [view, setView] = useState<'monitor' | 'settings'>('monitor')
  const [quotaMode, setQuotaMode] = useState<'session' | 'period'>('session')
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [viewport, setViewport] = useState(getViewportSize)
  const [usageData, setUsageData] = useState<any>({ openai: null, gemini: null, anthropic: null })
  const [cliStatus, setCliStatus] = useState<{ codex: boolean; gcloud: boolean } | null>(null)
  const [checkingCli, setCheckingCli] = useState(false)
  const [cliWarning, setCliWarning] = useState<string[]>([])
  const [codexAuthFlows, setCodexAuthFlows] = useState<Record<CodexAccountId, CodexAuthFlowState | null>>({
      a: null,
      b: null
  })
  const [settings, setSettings] = useState<any>({
      openaiKey: '', codexRemoteEnabled: true, geminiKey: '', updateFrequency: 5,
      anthropicMode: 'api', anthropicWebCookie: '', anthropicOrgId: '',
      monitorWidth: 300, monitorHeight: 150, timeFormat: '24h',
      dateFormat: 'dd.mm.yyyy', dateSeparator: '.', autoStart: false
  })

  const normalizeSettings = (raw: any) => ({
      ...raw,
      timeFormat: raw?.timeFormat === '12h' ? '12h' : '24h',
      dateFormat: raw?.dateFormat === 'mm.dd.yyyy' ? 'mm.dd.yyyy' : 'dd.mm.yyyy',
      dateSeparator: raw?.dateSeparator === '/' ? '/' : '.',
      autoStart: Boolean(raw?.autoStart),
      codexRemoteEnabled: raw?.codexRemoteEnabled !== false
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
    const cleanupCodexAuth = window.api.onCodexAuthUpdate((result) => {
        setCodexAuthFlows((current) => ({
            ...current,
            [result.accountId]: result.success
              ? { status: 'success' }
              : { status: 'error', error: result.error || 'Authentication failed' }
        }))
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
        cleanupCodexAuth()
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
      setCheckingCli(true)
      setCliStatus(null)
      setCliWarning([])
      window.api.getLastCliStatus().then((last) => {
        window.api.checkCliPaths().then((current) => {
          setCliStatus(current)
          setCheckingCli(false)
          if (last.everRun) {
            const regressed: string[] = []
            if (last.codex && !current.codex) regressed.push('Codex')
            if (last.gcloud && !current.gcloud) regressed.push('gcloud')
            setCliWarning(regressed)
          }
        })
      })
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

  /**
   * Starts device-code reauthentication for one isolated devserver account.
   *
   * @param {CodexAccountId} accountId - Account A or B.
   * @returns {Promise<void>} Resolves after the challenge is displayed or an error is recorded.
   */
  const handleCodexReauthenticate = async (accountId: CodexAccountId): Promise<void> => {
      setCodexAuthFlows((current) => ({ ...current, [accountId]: { status: 'starting' } }))
      try {
          const challenge = await window.api.reauthenticateCodexAccount(accountId)
          setCodexAuthFlows((current) => ({
              ...current,
              [accountId]: {
                  status: 'awaiting',
                  verificationUrl: challenge.verificationUrl,
                  userCode: challenge.userCode
              }
          }))
          await window.api.openCodexAuthUrl(challenge.verificationUrl)
      } catch (error) {
          setCodexAuthFlows((current) => ({
              ...current,
              [accountId]: {
                  status: 'error',
                  error: error instanceof Error ? error.message : 'Authentication failed'
              }
          }))
      }
  }

  const handleCheckCli = async () => {
      setCheckingCli(true)
      setCliStatus(null)
      const result = await window.api.checkCliPaths()
      setCliStatus(result)
      setCheckingCli(false)
  }
  
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

      const remoteCodexAccounts =
          usageData.openai?.source === 'devserver' && Array.isArray(usageData.openai.accounts)
            ? usageData.openai.accounts
            : null
      const codexProviders = remoteCodexAccounts
        ? remoteCodexAccounts.map((account: any) => ({
            key: `openai-${account.id}`,
            label: `Codex ${account.label}`,
            shortLabel: account.label,
            data: account,
            icon: openaiSimpleIcon,
            color: '#10a37f',
            status: account.status,
            resetCredits: account.availableResetCredits,
            detail: account.email || account.error || `Account ${account.label}`
          }))
        : [{
            key: 'openai',
            label: 'Codex',
            shortLabel: 'Codex',
            data: usageData.openai,
            icon: openaiSimpleIcon,
            color: '#10a37f',
            status: usageData.openai ? 'connected' : null,
            resetCredits: null,
            detail: 'Local Windows Codex'
          }]

      const providers = [
          ...codexProviders,
          { key: 'anthropic', label: 'Claude', shortLabel: 'Claude', data: usageData.anthropic, icon: claudeSimpleIcon, color: '#d97706', status: usageData.anthropic ? 'connected' : null, resetCredits: null, detail: 'Windows Claude session' },
          { key: 'gemini', label: 'Gemini', shortLabel: 'Gemini', data: usageData.gemini, icon: geminiSimpleIcon, color: '#2563eb', status: usageData.gemini ? 'connected' : null, resetCredits: null, detail: 'Gemini' }
      ]

      // Filter: Show provider if data is NOT null
      const activeProviders = providers.filter(p => p.data !== null)

      // Determine ring color based on usage
      const getRingColor = (percent: number, baseColor: string) => {
          if (percent > 90) return '#ef4444' // Red
          if (percent > 75) return '#f59e0b' // Yellow/Orange
          return baseColor // Default brand color
      }

      const compactRings = activeProviders.length >= 4
      const ringSize = compactRings ? 50 : 64
      const ringRadius = compactRings ? 22 : 28
      const ringCenter = ringSize / 2
      const ringCircumference = 2 * Math.PI * ringRadius

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
                      <div className="flex items-center justify-center" style={{ gap: compactRings ? '12px' : '40px' }}>
                        {activeProviders.map((p) => {
                            const percent = getDisplayedPercent(p.data)
                            const accountUnavailable = p.status && p.status !== 'connected'
                            const ringColor = accountUnavailable ? '#ef4444' : getRingColor(percent, p.color)
                            const statusLabel = p.status === 'authentication-required'
                              ? 'login'
                              : p.status === 'unavailable'
                                ? 'offline'
                                : `${percent}%`
                            
                            return (
                                <div key={p.key} className="flex flex-col items-center group/item relative" title={p.detail}>
                                    <div 
                                        className="relative mb-1 flex items-center justify-center"
                                        style={{ width: `${ringSize}px`, height: `${ringSize}px`, flexShrink: 0 }}
                                    >
                                        {/* Background Ring */}
                                        <svg 
                                            className="absolute top-0 left-0" 
                                            style={{ width: '100%', height: '100%', pointerEvents: 'none', transform: 'rotate(-90deg)' }}
                                        >
                                           <circle cx={ringCenter} cy={ringCenter} r={ringRadius} stroke="#cbd5e1" strokeWidth="3" fill="transparent" />
                                           {/* Progress Ring */}
                                           <circle 
                                                cx={ringCenter}
                                                cy={ringCenter}
                                                r={ringRadius}
                                                stroke={ringColor} 
                                                strokeWidth="3" 
                                                fill="transparent" 
                                                strokeDasharray={`${(percent / 100) * ringCircumference} ${ringCircumference}`}
                                                strokeLinecap="butt" 
                                                className="transition-all duration-500 ease-out"
                                            />
                                        </svg>
                                        
                                        {/* Icon in Center - Absolutely centered to avoid layout shift */}
                                        <div style={{ color: p.color, zIndex: 10, position: 'relative' }}> 
                                            <img src={p.icon} alt={`${p.label} icon`} style={{ width: compactRings ? 18 : 22, height: compactRings ? 18 : 22, display: 'block', opacity: accountUnavailable ? 0.4 : 1 }} />
                                        </div>
                                        {typeof p.resetCredits === 'number' && (
                                            <span
                                              className={`absolute -top-1 -right-2 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-white shadow-sm ${p.resetCredits > 0 ? 'bg-emerald-600' : 'bg-slate-400'}`}
                                              title={`${p.resetCredits} reset credits available`}
                                            >
                                                +{p.resetCredits}
                                            </span>
                                        )}
                                    </div>
                                    <span className={`font-bold select-none tracking-wide ${compactRings ? 'text-[9px]' : 'text-[10px]'} ${accountUnavailable ? 'text-red-600' : 'text-slate-600'}`}>
                                      {p.label} ({statusLabel})
                                    </span>
                                </div>
                            )
                        })}
                      </div>
                      <div className="max-w-[292px] text-center text-[9px] leading-tight text-slate-500 select-none">
                        Resets: {activeProviders.map((p) => `${p.shortLabel}: ${p.status === 'authentication-required' ? 'login' : p.status === 'unavailable' ? 'offline' : getDisplayedReset(p.data)}`).join(' | ')}
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
    const settingsCodexAccounts =
      usageData.openai?.source === 'devserver' && Array.isArray(usageData.openai.accounts)
        ? usageData.openai.accounts
        : []

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', backgroundColor: '#e2e8f0', color: '#0f172a', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #cbd5e1', backgroundColor: '#e2e8f0', flexShrink: 0, userSelect: 'none' }}>
            <button onClick={handleBack} className="p-2 hover:bg-slate-300 rounded-full text-slate-600 hover:text-slate-900 transition-colors" title="Back">
                <ArrowLeft size={18} />
            </button>
            <div className="flex flex-col items-center">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Settings</h2>
                <span className="text-[10px] text-slate-400 font-mono">v1.3.2 (Stable)</span>
            </div>
             <button onClick={handleClose} className="p-2 hover:bg-red-200 rounded-full text-slate-600 hover:text-red-700 transition-colors" title="Close App">
                <X size={18} />
           </button>
        </div>
        <div className="no-drag scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-transparent" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
             <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Codex / OpenAI</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        <input
                          type="checkbox"
                          checked={settings.codexRemoteEnabled !== false}
                          onChange={(event) => setSettings({ ...settings, codexRemoteEnabled: event.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        devserver A/B
                    </label>
                </div>

                {settings.codexRemoteEnabled !== false && (
                  <div className="space-y-2">
                    {(['a', 'b'] as CodexAccountId[]).map((accountId) => {
                      const account = settingsCodexAccounts.find((candidate: any) => candidate.id === accountId)
                      const flow = codexAuthFlows[accountId]
                      const connected = account?.status === 'connected'
                      const pending = flow?.status === 'starting' || flow?.status === 'awaiting'
                      const statusText = connected
                        ? 'Connected'
                        : account?.status === 'authentication-required'
                          ? 'Login required'
                          : account?.status === 'unavailable'
                            ? 'Unavailable'
                            : 'Checking'

                      return (
                        <div key={accountId} className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-extrabold text-slate-700">Account {accountId.toUpperCase()}</span>
                                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${connected ? 'bg-green-100 text-green-700' : account?.status === 'authentication-required' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>
                                  {statusText}
                                </span>
                                {typeof account?.availableResetCredits === 'number' && (
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold text-white ${account.availableResetCredits > 0 ? 'bg-emerald-600' : 'bg-slate-400'}`}
                                    title={`${account.availableResetCredits} reset credits available`}
                                  >
                                    +{account.availableResetCredits}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 truncate text-[10px] text-slate-500">
                                {account?.email || account?.error || 'Waiting for devserver status'}
                                {account?.plan ? ` · ${account.plan}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCodexReauthenticate(accountId)}
                              disabled={pending}
                              className="flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-[10px] font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              <RefreshCw size={12} className={pending ? 'animate-spin' : ''} />
                              {pending ? 'Waiting' : connected ? 'Re-authenticate' : 'Sign in'}
                            </button>
                          </div>

                          {flow?.status === 'awaiting' && flow.verificationUrl && flow.userCode && (
                            <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-[10px] text-blue-900">
                              <div>Enter code <span className="font-mono text-xs font-extrabold tracking-wider">{flow.userCode}</span></div>
                              <button
                                type="button"
                                onClick={() => window.api.openCodexAuthUrl(flow.verificationUrl!)}
                                className="mt-1 flex items-center gap-1 font-bold text-blue-700 hover:text-blue-900"
                              >
                                <ExternalLink size={11} /> Open sign-in page
                              </button>
                            </div>
                          )}
                          {flow?.status === 'success' && (
                            <div className="mt-2 text-[10px] font-bold text-green-700">Authentication completed.</div>
                          )}
                          {flow?.status === 'error' && (
                            <div className="mt-2 text-[10px] font-medium text-red-700">{flow.error || 'Authentication failed'}</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block ml-1">Local fallback API key</label>
                <input type="password" value={settings.openaiKey} onChange={(e) => setSettings({...settings, openaiKey: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 placeholder-slate-400 shadow-sm transition-all" placeholder="Optional sk-..." />
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Gemini API Key</label>
                <input type="password" value={settings.geminiKey} onChange={(e) => setSettings({...settings, geminiKey: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 placeholder-slate-400 shadow-sm transition-all" placeholder="AIza..." />
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">Claude Code Integration</label>
                <div className="flex space-x-2 mb-2">
                    <button onClick={() => setSettings({...settings, anthropicMode: 'api'})} className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.anthropicMode === 'api' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>API Key</button>
                    <button onClick={() => setSettings({...settings, anthropicMode: 'web'})} className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.anthropicMode === 'web' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>Web Login</button>
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
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.timeFormat === '24h' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      24H
                    </button>
                    <button
                      onClick={() => setSettings({ ...settings, timeFormat: '12h' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.timeFormat === '12h' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
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
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateFormat === 'dd.mm.yyyy' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      DD.MM.YYYY
                    </button>
                    <button
                      onClick={() => setSettings({ ...settings, dateFormat: 'mm.dd.yyyy' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateFormat === 'mm.dd.yyyy' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
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
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateSeparator === '.' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      .
                    </button>
                    <button
                      onClick={() => setSettings({ ...settings, dateSeparator: '/' })}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border ${settings.dateSeparator === '/' ? 'bg-slate-700 text-white border-slate-700 ring-2 ring-offset-1 ring-slate-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    >
                      /
                    </button>
                </div>
            </div>
                
                            <div className="space-y-2 pt-2 border-t border-slate-300">
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block ml-1">CLI Tools</label>
                                {cliWarning.length > 0 && (
                                    <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-800 font-medium">
                                        ⚠ Previously found, now missing from PATH: {cliWarning.join(', ')}
                                    </div>
                                )}
                                <button
                                    onClick={handleCheckCli}
                                    disabled={checkingCli}
                                    className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold py-2 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {checkingCli ? 'Checking...' : 'Test CLI Tools in PATH'}
                                </button>
                                {cliStatus && (
                                    <div className="flex space-x-2">
                                        <div className={`flex-1 text-center text-xs font-bold py-1.5 rounded border ${cliStatus.codex ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-600'}`}>
                                            Codex {cliStatus.codex ? '✓' : '✗'}
                                        </div>
                                        <div className={`flex-1 text-center text-xs font-bold py-1.5 rounded border ${cliStatus.gcloud ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-600'}`}>
                                            gcloud {cliStatus.gcloud ? '✓' : '✗'}
                                        </div>
                                    </div>
                                )}
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

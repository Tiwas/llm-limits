import { net } from 'electron'
import { spawn } from 'child_process'
import store from '../store'

interface UsageData {
    percent: number
    used: number
    limit: number
    sessionPercent?: number
    periodPercent?: number
    sessionResetAt?: string | null
    periodResetAt?: string | null
}

function normalizeResetAt(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) {
        // Codex returns unix seconds in reset_at.
        const ms = value > 1e12 ? value : value * 1000
        return new Date(ms).toISOString()
    }
    return null
}

// Fetch Claude Usage via Internal API (Web Session)
export async function getClaudeWebUsage(cookie: string, orgId: string): Promise<UsageData | null> {
    return new Promise((resolve) => {
        const debug = store.get('debugMode')
        const request = net.request({
            method: 'GET',
            url: `https://claude.ai/api/organizations/${orgId}/usage`,
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
                if (response.statusCode === 200) {
                    try {
                        const json = JSON.parse(data)
                        if (debug) console.log('Claude Usage Response:', json)
                        
                        // Actual Response Structure (verified):
                        // { "five_hour": { "utilization": 26, "resets_at": "..." }, ... }
                        
                        if (json.five_hour && typeof json.five_hour.utilization === 'number') {
                             const sessionPercent = json.five_hour.utilization
                             const sessionResetAt = normalizeResetAt(json.five_hour.resets_at)

                             let periodPercent = sessionPercent
                             let periodResetAt: string | null = sessionResetAt
                             const periodCandidates = ['month', 'monthly', 'seven_day', 'week', 'daily']
                             for (const key of periodCandidates) {
                                const candidate = json[key]
                                if (candidate && typeof candidate.utilization === 'number') {
                                    periodPercent = candidate.utilization
                                    periodResetAt = normalizeResetAt(candidate.resets_at)
                                    break
                                }
                             }

                             // Utilization is percentage (0-100)
                             resolve({
                                 percent: sessionPercent,
                                 used: sessionPercent,
                                 limit: 100,
                                 sessionPercent,
                                 periodPercent,
                                 sessionResetAt,
                                 periodResetAt
                             })
                             return
                        }
                        
                        // Fallback logic
                        resolve({ percent: 0, used: 0, limit: 100 }) 
                    } catch (e) {
                        console.error('Failed to parse Claude Usage:', e)
                        resolve(null)
                    }
                } else {
                    console.error(`Claude Usage API Error: ${response.statusCode}`, data)
                    resolve(null)
                }
            })
        })
        
        request.on('error', (err) => {
            console.error('Network error fetching Claude Usage:', err)
            resolve(null)
        })
        
        request.end()
    })
}

/**
 * Sends a minimal chat completion request to register usage and initialize a new Codex period window.
 * Only works with standard sk-* API keys; OAuth tokens are not supported.
 *
 * @param {string} apiKey - OpenAI API key (must start with 'sk-')
 * @returns {Promise<boolean>} True if the warmup request returned HTTP 200, false otherwise
 *
 * Called by:
 *   - pollUsage() in src/main/index.ts — when Codex secondary_window (period window) expiry is detected
 *
 * Calls:
 *   - net.request() — fires a minimal gpt-4o-mini completion (max_tokens: 1) to open a new period window
 */
export async function triggerCodexPeriodWarmup(apiKey: string): Promise<boolean> {
    return new Promise((resolve) => {
        const debug = store.get('debugMode')
        if (debug) console.log('Triggering Codex period window warmup...')

        const body = JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1
        })

        const request = net.request({
            method: 'POST',
            url: 'https://api.openai.com/v1/chat/completions'
        })

        request.setHeader('Authorization', `Bearer ${apiKey}`)
        request.setHeader('Content-Type', 'application/json')

        request.on('response', (response) => {
            if (debug) console.log(`Codex period warmup response status: ${response.statusCode}`)
            response.on('data', () => {}) // drain response body
            response.on('end', () => resolve(response.statusCode === 200))
        })

        request.on('error', (err) => {
            console.error('Codex period warmup request error:', err)
            resolve(false)
        })

        request.write(body)
        request.end()
    })
}

/**
 * Triggers a new Codex period window for OAuth users by starting the Codex CLI
 * with a minimal prompt and killing it after a short delay. The CLI sends the
 * initial API request within the first second, which is enough to register usage
 * and open a new secondary_window with a fresh reset_at.
 *
 * @returns {Promise<boolean>} True if the CLI process started successfully, false if codex was not found
 *
 * Called by:
 *   - pollUsage() in src/main/index.ts — when Codex period window expiry is detected and no sk-* key is present
 *
 * Calls:
 *   - spawn('codex') — starts the Codex CLI process, then kills it after 2 seconds
 */
export async function triggerCodexPeriodWarmupViaCLI(): Promise<boolean> {
    return new Promise((resolve) => {
        const debug = store.get('debugMode')
        if (debug) console.log('Triggering Codex CLI period window warmup...')

        let settled = false
        const settle = (result: boolean) => {
            if (!settled) {
                settled = true
                resolve(result)
            }
        }

        const proc = spawn('codex', ['hi'], {
            shell: true,
            stdio: 'ignore'
        })

        proc.on('error', (err) => {
            console.error('Codex CLI warmup: could not start process:', err.message)
            settle(false)
        })

        proc.on('spawn', () => {
            if (debug) console.log('Codex CLI warmup process started, will kill after 2s')
        })

        // Kill after 2 seconds — the initial API request fires within the first second
        const killTimer = setTimeout(() => {
            proc.kill()
            if (debug) console.log('Codex CLI warmup process killed after timeout')
            settle(true)
        }, 2000)

        proc.on('close', () => {
            clearTimeout(killTimer)
            settle(true)
        })
    })
}

import { readCodexToken } from './codex_config'

// Fetch Codex (OpenAI) Usage via Official API or Local Token
export async function getCodexUsage(apiKey?: string): Promise<UsageData | null> {
    return new Promise((resolve) => {
        const debug = store.get('debugMode')
        let token = apiKey
        
        // If no API key provided, try to find local Codex CLI token
        if (!token) {
            const localToken = readCodexToken()
            if (localToken) {
                if (debug) console.log('Found local Codex CLI token.')
                token = localToken
            } else {
                if (debug) console.log('No Codex API key or local token found.')
                resolve(null)
                return
            }
        }

        // Determine Endpoint based on Token Type
        let url = ''
        let isOAuth = false
        
        if (token.startsWith('sk-')) {
            // Standard API Key
            const today = new Date().toISOString().split('T')[0]
            url = `https://api.openai.com/v1/organization/usage?date=${today}`
        } else {
            // OAuth Token (ChatGPT / Internal)
            isOAuth = true
            if (debug) console.log('Detected OAuth token, attempting internal API...')
            // Try fetching specific Codex usage endpoint (Reverse engineered guess based on CLI help)
            url = 'https://chatgpt.com/backend-api/codex/usage' 
        }

        const request = net.request({
            method: 'GET',
            url: url, 
        })
        
        request.setHeader('Authorization', `Bearer ${token}`)
        request.setHeader('Content-Type', 'application/json')
        if (isOAuth) {
            request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        }
        
        request.on('response', (response) => {
            let data = ''
            response.on('data', (chunk) => {
                data += chunk.toString()
            })
            
            response.on('end', () => {
                if (response.statusCode === 200) {
                    try {
                        const json = JSON.parse(data)
                        if (debug) console.log('Codex Usage Response (Experimental):', json)
                        
                        // Verified Response Structure:
                        // { rate_limit: { primary_window: { used_percent: 2 }, secondary_window: { used_percent: 12 } } }
                        
                        if (json.rate_limit && json.rate_limit.primary_window && typeof json.rate_limit.primary_window.used_percent === 'number') {
                             const sessionPercent = json.rate_limit.primary_window.used_percent
                             const sessionResetAt =
                                normalizeResetAt(json.rate_limit.primary_window.reset_at) ??
                                normalizeResetAt(json.rate_limit.primary_window.resets_at)
                             const periodPercent = json.rate_limit.secondary_window && typeof json.rate_limit.secondary_window.used_percent === 'number'
                                ? json.rate_limit.secondary_window.used_percent
                                : sessionPercent
                             const periodResetAt = json.rate_limit.secondary_window
                                ? (
                                    normalizeResetAt(json.rate_limit.secondary_window.reset_at) ??
                                    normalizeResetAt(json.rate_limit.secondary_window.resets_at) ??
                                    sessionResetAt
                                  )
                                : sessionResetAt
                             // Limit is abstract (percentage based), so we set 100
                             resolve({
                                 percent: sessionPercent,
                                 used: sessionPercent,
                                 limit: 100,
                                 sessionPercent,
                                 periodPercent,
                                 sessionResetAt,
                                 periodResetAt
                             })
                             return
                        }

                        // Legacy / Other formats fallback
                        if (json.five_hour_limit && typeof json.five_hour_limit.remaining_percent === 'number') {
                             const sessionPercent = 100 - json.five_hour_limit.remaining_percent
                             resolve({
                                 percent: sessionPercent,
                                 used: sessionPercent,
                                 limit: 100,
                                 sessionPercent,
                                 periodPercent: sessionPercent,
                                 sessionResetAt: null,
                                 periodResetAt: null
                             })
                             return
                        }
                        
                        if (json.usage && typeof json.usage.percent === 'number') {
                             resolve({
                                 percent: json.usage.percent,
                                 used: json.usage.used || 0,
                                 limit: json.usage.limit || 100,
                                 sessionPercent: json.usage.percent,
                                 periodPercent: json.usage.percent,
                                 sessionResetAt: null,
                                 periodResetAt: null
                             })
                             return
                        }

                        // API Key logic fallback (if standard API was used)
                        if (!isOAuth) {
                             resolve({ percent: 0, used: 0, limit: 100 })
                             return
                        }
                        
                        // If we got 200 but unknown format
                        resolve({ percent: 0, used: 0, limit: 100 }) 
                    } catch (e) {
                        console.error('Failed to parse Codex Usage:', e)
                        resolve(null)
                    }
                } else {
                    console.error(`Codex Usage API Error: ${response.statusCode}`, data)
                    resolve(null)
                }
            })
        })
        
        request.on('error', (err) => {
            console.error('Network error fetching Codex Usage:', err)
            resolve(null)
        })
        
        request.end()
    })
}

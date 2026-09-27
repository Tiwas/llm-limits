import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

export type CodexRemoteAccountId = 'a' | 'b'
export type CodexRemoteAccountStatus = 'connected' | 'authentication-required' | 'unavailable'

export interface CodexRemoteAccountUsage {
  id: CodexRemoteAccountId
  label: string
  status: CodexRemoteAccountStatus
  email: string | null
  plan: string | null
  percent: number
  used: number
  limit: number
  sessionPercent: number
  periodPercent: number
  sessionResetAt: string | null
  periodResetAt: string | null
  availableResetCredits: number | null
  ordinaryUsageAllowed: boolean | null
  error: string | null
}

export interface CodexRemoteUsage {
  source: 'devserver'
  host: 'devserver'
  accounts: CodexRemoteAccountUsage[]
}

export interface CodexRemoteAuthChallenge {
  accountId: CodexRemoteAccountId
  loginId: string
  verificationUrl: string
  userCode: string
}

export interface CodexRemoteAuthResult {
  accountId: CodexRemoteAccountId
  success: boolean
  error: string | null
}

export interface CodexRemoteLoginHandle {
  challenge: CodexRemoteAuthChallenge
  completion: Promise<CodexRemoteAuthResult>
  cancel: () => void
}

interface RemoteProfile {
  id: CodexRemoteAccountId
  label: string
  codexHome: string
}

interface JsonRpcMessage {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

interface AccountReadResult {
  account?: {
    email?: unknown
    planType?: unknown
  } | null
}

interface RateLimitWindow {
  usedPercent?: unknown
  windowDurationMins?: unknown
  resetsAt?: unknown
}

interface RateLimitSnapshot {
  limitId?: unknown
  limitName?: unknown
  primary?: RateLimitWindow | null
  secondary?: RateLimitWindow | null
}

interface RateLimitsReadResult {
  ordinaryUsageAllowed?: unknown
  rateLimits?: RateLimitSnapshot | null
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot | undefined> | null
  rateLimitResetCredits?: {
    availableCount?: unknown
  } | null
}

interface LoginStartResult {
  type?: unknown
  loginId?: unknown
  verificationUrl?: unknown
  userCode?: unknown
}

interface LoginCompletedNotification {
  loginId?: unknown
  success?: unknown
  error?: unknown
}

/**
 * Identifies errors returned by a valid Codex JSON-RPC response.
 */
class CodexRpcRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexRpcRequestError'
  }
}

const REMOTE_HOST = 'devserver'
const REMOTE_CODEX_BINARY = '$HOME/.codex/packages/standalone/current/bin/codex'
const RPC_TIMEOUT_MS = 12_000
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000

const REMOTE_PROFILES: Record<CodexRemoteAccountId, RemoteProfile> = {
  a: { id: 'a', label: 'A', codexHome: '$HOME/.codex-account-a' },
  b: { id: 'b', label: 'B', codexHome: '$HOME/.codex-account-b' }
}

/**
 * Converts an unknown error into a short message safe for logs and UI display.
 *
 * @param {unknown} error - Error value from SSH or the Codex app-server.
 * @returns {string} Sanitized single-line error text.
 */
function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error')
  return raw.replace(/[\r\n]+/g, ' ').trim().slice(0, 240) || 'Unknown error'
}

/**
 * Checks whether an app-server failure indicates missing or expired authentication.
 *
 * @param {unknown} error - Error returned by the remote account request.
 * @returns {boolean} True when reauthentication is the appropriate user action.
 */
function isAuthenticationError(error: unknown): boolean {
  if (!(error instanceof CodexRpcRequestError)) return false
  return /auth|credential|expired|forbidden|login|token|unauthori[sz]ed|\b401\b|\b403\b/i.test(
    sanitizeErrorMessage(error)
  )
}

/**
 * Bounds a rate-limit percentage to the range supported by the monitor ring.
 *
 * @param {unknown} value - Raw percentage from the app-server response.
 * @returns {number} A finite percentage between zero and one hundred.
 */
function clampPercent(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(100, Math.max(0, parsed))
}

/**
 * Converts a Unix timestamp from the app-server into an ISO timestamp.
 *
 * @param {unknown} value - Timestamp expressed in seconds.
 * @returns {string | null} ISO timestamp or null when unavailable.
 */
function normalizeResetAt(value: unknown): string | null {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

/**
 * Selects the primary Codex quota snapshot from a multi-limit response.
 *
 * @param {RateLimitsReadResult['rateLimitsByLimitId']} limits - Limits keyed by backend limit ID.
 * @param {RateLimitSnapshot | null | undefined} fallback - Backward-compatible single snapshot.
 * @returns {RateLimitSnapshot | null} Main Codex snapshot when present.
 */
function selectCodexSnapshot(
  limits: RateLimitsReadResult['rateLimitsByLimitId'],
  fallback: RateLimitSnapshot | null | undefined
): RateLimitSnapshot | null {
  if (!limits || typeof limits !== 'object') return fallback ?? null
  if (limits.codex) return limits.codex
  const snapshots = Object.values(limits).filter((value): value is RateLimitSnapshot => Boolean(value))
  return snapshots.find((snapshot) => snapshot.limitName == null) ?? snapshots[0] ?? fallback ?? null
}

/**
 * Orders quota windows so the shorter window is shown as session and the longer as period.
 *
 * @param {RateLimitSnapshot} snapshot - Main Codex rate-limit snapshot.
 * @returns {{ session: RateLimitWindow; period: RateLimitWindow } | null} Display windows.
 */
function selectDisplayWindows(
  snapshot: RateLimitSnapshot
): { session: RateLimitWindow; period: RateLimitWindow } | null {
  const windows = [snapshot.primary, snapshot.secondary]
    .filter((value): value is RateLimitWindow => Boolean(value))
    .sort((left, right) => Number(left.windowDurationMins || 0) - Number(right.windowDurationMins || 0))

  if (windows.length === 0) return null
  return { session: windows[0], period: windows[windows.length - 1] }
}

/**
 * Creates a fixed account result for an unavailable or unauthenticated remote profile.
 *
 * @param {RemoteProfile} profile - Fixed account profile.
 * @param {CodexRemoteAccountStatus} status - Failure category for the UI.
 * @param {string} error - User-facing failure detail.
 * @returns {CodexRemoteAccountUsage} Normalized account result.
 */
function createFailureResult(
  profile: RemoteProfile,
  status: CodexRemoteAccountStatus,
  error: string
): CodexRemoteAccountUsage {
  return {
    id: profile.id,
    label: profile.label,
    status,
    email: null,
    plan: null,
    percent: 0,
    used: 0,
    limit: 100,
    sessionPercent: 0,
    periodPercent: 0,
    sessionResetAt: null,
    periodResetAt: null,
    availableResetCredits: null,
    ordinaryUsageAllowed: null,
    error
  }
}

/**
 * Maintains one newline-delimited JSON-RPC session through the Windows SSH client.
 */
class CodexRpcSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private notificationListeners = new Set<(message: JsonRpcMessage) => void>()
  private closeListeners = new Set<(error: Error) => void>()
  private closed = false

  constructor(private readonly profile: RemoteProfile) {}

  /**
   * Starts the remote app-server and completes its initialization handshake.
   *
   * @returns {Promise<void>} Resolves when the session accepts requests.
   */
  async initialize(): Promise<void> {
    await this.launch()
    await this.request('initialize', {
      clientInfo: { name: 'llm-limits', version: '1' }
    })
    this.notify('initialized', {})
  }

  /**
   * Sends a JSON-RPC request and waits for the matching response.
   *
   * @template T
   * @param {string} method - Codex app-server method.
   * @param {unknown} params - JSON-serializable request parameters.
   * @returns {Promise<T>} Parsed method result.
   */
  request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.child || this.closed || !this.child.stdin.writable) {
      return Promise.reject(new Error('Remote Codex session is not available'))
    }

    const id = this.nextId
    this.nextId += 1

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out while waiting for ${method}`))
      }, RPC_TIMEOUT_MS)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })

      this.child?.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  /**
   * Subscribes to app-server notifications such as login completion.
   *
   * @param {(message: JsonRpcMessage) => void} listener - Notification callback.
   * @returns {() => void} Unsubscribe callback.
   */
  onNotification(listener: (message: JsonRpcMessage) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  /**
   * Subscribes to unexpected SSH or app-server termination.
   *
   * @param {(error: Error) => void} listener - Close callback.
   * @returns {() => void} Unsubscribe callback.
   */
  onClose(listener: (error: Error) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  /**
   * Ends the local SSH process, which also closes its isolated remote app-server.
   *
   * @returns {void}
   */
  close(): void {
    if (this.closed) return
    this.fail(new Error('Remote Codex session closed'))
    this.child?.stdin.end()
    this.child?.kill()
  }

  /**
   * Launches SSH with fixed arguments and a fixed remote command for the selected profile.
   *
   * @returns {Promise<void>} Resolves after the SSH process starts.
   */
  private launch(): Promise<void> {
    const remoteCommand = `CODEX_HOME=${this.profile.codexHome} exec ${REMOTE_CODEX_BINARY} app-server --stdio`
    this.child = spawn(
      'ssh',
      ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', REMOTE_HOST, remoteCommand],
      { windowsHide: true, shell: false }
    )

    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-2_000)
    })
    this.child.stdin.on('error', (error) => this.handleTransportError(error))
    this.child.on('close', (code) => this.handleClose(code))

    return new Promise((resolve, reject) => {
      this.child?.once('spawn', resolve)
      this.child?.once('error', reject)
    })
  }

  /**
   * Writes a JSON-RPC notification to the active app-server session.
   *
   * @param {string} method - Notification method.
   * @param {unknown} params - JSON-serializable notification parameters.
   * @returns {void}
   */
  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  /**
   * Splits streamed stdout into complete JSON lines and parses each message.
   *
   * @param {string} chunk - New stdout text from SSH.
   * @returns {void}
   */
  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        this.handleMessage(JSON.parse(line) as JsonRpcMessage)
      } catch {
        // Ignore non-protocol output without echoing it, because remote output is untrusted.
      }
    }
  }

  /**
   * Routes a parsed JSON-RPC response or notification to its listener.
   *
   * @param {JsonRpcMessage} message - Parsed app-server message.
   * @returns {void}
   */
  private handleMessage(message: JsonRpcMessage): void {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new CodexRpcRequestError(message.error.message || 'Remote Codex request failed'))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method) {
      for (const listener of this.notificationListeners) listener(message)
    }
  }

  /**
   * Rejects pending work and reports an unexpected process exit.
   *
   * @param {number | null} code - SSH process exit code.
   * @returns {void}
   */
  private handleClose(code: number | null): void {
    const detail = sanitizeErrorMessage(this.stderrBuffer)
    const error = new Error(
      detail === 'Unknown error' ? `Remote Codex session closed with code ${code ?? 'unknown'}` : detail
    )

    this.fail(error)
  }

  /**
   * Converts SSH stream errors such as EPIPE into an ordinary unavailable-account result.
   *
   * @param {Error} error - Error emitted by the SSH stdin stream.
   * @returns {void}
   */
  private handleTransportError(error: Error): void {
    this.fail(new Error(sanitizeErrorMessage(error)))
    this.child?.kill()
  }

  /**
   * Rejects pending requests and notifies listeners exactly once for a failed session.
   *
   * @param {Error} error - Sanitized session failure.
   * @returns {void}
   */
  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()

    if (this.closed) return
    this.closed = true
    for (const listener of this.closeListeners) listener(error)
  }
}

/**
 * Reads one devserver account without refreshing tokens or changing the shared auth link.
 *
 * @param {RemoteProfile} profile - Fixed account A or B profile.
 * @returns {Promise<CodexRemoteAccountUsage>} Normalized identity, quota, and reset-credit data.
 */
async function readRemoteAccount(profile: RemoteProfile): Promise<CodexRemoteAccountUsage> {
  const session = new CodexRpcSession(profile)

  try {
    await session.initialize()
    const accountResult = await session.request<AccountReadResult>('account/read', { refreshToken: false })
    const account = accountResult?.account
    if (!account) {
      return createFailureResult(profile, 'authentication-required', 'Account login is missing or expired')
    }

    let rateLimits: RateLimitsReadResult
    try {
      rateLimits = await session.request<RateLimitsReadResult>('account/rateLimits/read')
    } catch (error) {
      const status = isAuthenticationError(error) ? 'authentication-required' : 'unavailable'
      const failure = createFailureResult(profile, status, sanitizeErrorMessage(error))
      failure.email = typeof account.email === 'string' ? account.email : null
      failure.plan = typeof account.planType === 'string' ? account.planType : null
      return failure
    }

    const snapshot = selectCodexSnapshot(rateLimits.rateLimitsByLimitId, rateLimits.rateLimits)
    const windows = snapshot ? selectDisplayWindows(snapshot) : null
    if (!windows) {
      const failure = createFailureResult(profile, 'unavailable', 'Quota data is unavailable')
      failure.email = typeof account.email === 'string' ? account.email : null
      failure.plan = typeof account.planType === 'string' ? account.planType : null
      return failure
    }

    const sessionPercent = clampPercent(windows.session.usedPercent)
    const periodPercent = clampPercent(windows.period.usedPercent)
    const resetCount = Number(rateLimits.rateLimitResetCredits?.availableCount)

    return {
      id: profile.id,
      label: profile.label,
      status: 'connected',
      email: typeof account.email === 'string' ? account.email : null,
      plan: typeof account.planType === 'string' ? account.planType : null,
      percent: sessionPercent,
      used: sessionPercent,
      limit: 100,
      sessionPercent,
      periodPercent,
      sessionResetAt: normalizeResetAt(windows.session.resetsAt),
      periodResetAt: normalizeResetAt(windows.period.resetsAt),
      availableResetCredits: Number.isFinite(resetCount) ? Math.max(0, Math.trunc(resetCount)) : null,
      ordinaryUsageAllowed:
        typeof rateLimits.ordinaryUsageAllowed === 'boolean' ? rateLimits.ordinaryUsageAllowed : null,
      error: null
    }
  } catch (error) {
    const status = isAuthenticationError(error) ? 'authentication-required' : 'unavailable'
    return createFailureResult(profile, status, sanitizeErrorMessage(error))
  } finally {
    session.close()
  }
}

/**
 * Reads both fixed devserver accounts in parallel through isolated app-server sessions.
 *
 * @returns {Promise<CodexRemoteUsage>} Account A/B quota snapshot for the renderer.
 */
export async function getDevserverCodexUsage(): Promise<CodexRemoteUsage> {
  const accounts = await Promise.all([
    readRemoteAccount(REMOTE_PROFILES.a),
    readRemoteAccount(REMOTE_PROFILES.b)
  ])
  return { source: 'devserver', host: REMOTE_HOST, accounts }
}

/**
 * Starts a device-code login against the isolated auth directory for account A or B.
 *
 * @param {CodexRemoteAccountId} accountId - Fixed remote profile identifier.
 * @returns {Promise<CodexRemoteLoginHandle>} Challenge details and asynchronous completion handle.
 */
export async function beginDevserverCodexLogin(
  accountId: CodexRemoteAccountId
): Promise<CodexRemoteLoginHandle> {
  const profile = REMOTE_PROFILES[accountId]
  const session = new CodexRpcSession(profile)
  await session.initialize()

  let activeLoginId = ''
  let settled = false
  let timeout: NodeJS.Timeout | null = null
  let resolveCompletion: (result: CodexRemoteAuthResult) => void = () => {}

  const completion = new Promise<CodexRemoteAuthResult>((resolve) => {
    resolveCompletion = resolve
  })

  const finish = (result: CodexRemoteAuthResult): void => {
    if (settled) return
    settled = true
    if (timeout) clearTimeout(timeout)
    session.close()
    resolveCompletion(result)
  }

  session.onNotification((message) => {
    if (message.method !== 'account/login/completed') return
    const params = (message.params || {}) as LoginCompletedNotification
    if (params.loginId !== activeLoginId) return
    finish({
      accountId,
      success: params.success === true,
      error: typeof params.error === 'string' ? params.error : null
    })
  })

  session.onClose((error) => {
    finish({ accountId, success: false, error: sanitizeErrorMessage(error) })
  })

  try {
    const response = await session.request<LoginStartResult>('account/login/start', {
      type: 'chatgptDeviceCode'
    })

    if (
      response.type !== 'chatgptDeviceCode' ||
      typeof response.loginId !== 'string' ||
      typeof response.verificationUrl !== 'string' ||
      typeof response.userCode !== 'string'
    ) {
      throw new Error('Codex did not return a device-code login challenge')
    }

    activeLoginId = response.loginId
    timeout = setTimeout(() => {
      finish({ accountId, success: false, error: 'The authentication request expired' })
    }, LOGIN_TIMEOUT_MS)

    return {
      challenge: {
        accountId,
        loginId: response.loginId,
        verificationUrl: response.verificationUrl,
        userCode: response.userCode
      },
      completion,
      cancel: () => finish({ accountId, success: false, error: 'Authentication was cancelled' })
    }
  } catch (error) {
    session.close()
    throw error
  }
}

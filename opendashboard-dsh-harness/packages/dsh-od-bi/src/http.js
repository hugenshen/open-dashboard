/** Shared Java internal BI HTTP helpers. @module @opendashboard/dsh-od-bi/http */
import { getBridge, loadBridgeFromEnv } from '@opendashboard/dsh-od-auth/bridge-state'

export function biBase() {
  return String(process.env.OD_BI_BASE || 'http://127.0.0.1:8082').replace(/\/$/, '')
}

export function internalHeaders() {
  loadBridgeFromEnv()
  const bridge = getBridge()
  const headers = {
    'Content-Type': 'application/json',
    'X-OD-Internal-Token': process.env.OD_INTERNAL_TOKEN || 'od-dev-internal',
  }
  if (bridge.userId) headers['X-User-Id'] = String(bridge.userId)
  if (bridge.workspaceId) headers['X-Workspace-Id'] = String(bridge.workspaceId)
  if (bridge.perms) headers['X-User-Perms'] = String(bridge.perms)
  return headers
}

/**
 * Client-side BI timeout. Keep ≤ Java opendashboard.query.timeout-sec so the UI
 * fails closed before the warehouse is left spinning forever.
 */
export const BI_FETCH_TIMEOUT_MS = Number(process.env.OD_BI_TIMEOUT_MS || 18_000)

/**
 * Drop undefined / -0 / non-JSON values so dsh tool output passes lossless JSON checks.
 * @param {unknown} value
 */
export function toLosslessJson(value) {
  return JSON.parse(JSON.stringify(value, (_k, v) => {
    if (v === undefined) return undefined // omit
    if (typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v))) return null
    if (typeof v === 'number' && Object.is(v, -0)) return 0
    if (typeof v === 'bigint') return v.toString()
    return v
  }))
}

/** Fire-and-forget: ask Java to Statement.cancel() in-flight warehouse queries. */
export function cancelLiveQueries(reason = 'client-abort') {
  const url = `${biBase()}/api/internal/bi/query/cancel`
  const body = JSON.stringify({ reason })
  // Prefer keepalive so abort during page unload still reaches the server.
  try {
    if (typeof fetch === 'function') {
      void fetch(url, {
        method: 'POST',
        headers: internalHeaders(),
        body,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @param {AbortSignal} [signal]
 * @param {number} [timeoutMs]
 */
export async function biFetch(method, path, body, signal, timeoutMs = BI_FETCH_TIMEOUT_MS) {
  const url = path.startsWith('http') ? path : `${biBase()}${path}`
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort(new Error(`BI ${method} ${path} timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const onAbort = () => {
    cancelLiveQueries(signal?.aborted ? 'user-stop' : 'signal-abort')
    ctrl.abort(signal?.reason)
  }
  if (signal) {
    if (signal.aborted) {
      cancelLiveQueries('already-aborted')
      ctrl.abort(signal.reason)
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }
  try {
    const res = await fetch(url, {
      method,
      headers: internalHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    if (!res.ok) {
      const err = new Error(`BI ${method} ${path} → ${res.status}`)
      err.status = res.status
      err.body = json
      throw err
    }
    return json
  } catch (err) {
    if (timedOut || ctrl.signal.aborted) {
      cancelLiveQueries(timedOut ? 'client-timeout' : 'client-abort')
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/** Cap rows kept in tool meta / Node payload. */
export const PREVIEW_ROW_LIMIT = 50

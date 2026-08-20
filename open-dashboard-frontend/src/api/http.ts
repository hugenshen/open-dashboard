/**
 * Shared fetch helper. Identity is resolved by the backend from an HttpOnly
 * session cookie; the local marker only lets the router avoid a first-frame
 * flicker before /auth/me confirms the session.
 */

const AUTH_STORAGE_KEY = 'od.auth.headers'
const AUTH_SESSION_VERSION = 2

export type AuthHeaderBundle = {
  userId: string
  displayName: string
  permissions: string
  workspaceId: string
  sessionVersion: number
}

export const DEMO_ADMIN_AUTH: AuthHeaderBundle = {
  userId: 'demo',
  displayName: '演示用户',
  permissions: '*',
  workspaceId: 'workspace-retail',
  sessionVersion: AUTH_SESSION_VERSION
}

export const DEMO_ANALYST_AUTH: AuthHeaderBundle = {
  userId: 'analyst',
  displayName: '分析师',
  permissions: 'dataset:use,conversation:use,dashboard:view,report:view',
  workspaceId: 'workspace-retail',
  sessionVersion: AUTH_SESSION_VERSION
}

export function readAuthBundle(): AuthHeaderBundle | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuthHeaderBundle>
      if (
        parsed.sessionVersion !== AUTH_SESSION_VERSION ||
        !parsed.userId ||
        !parsed.permissions ||
        !parsed.workspaceId
      ) {
        return null
      }
      return {
        userId: parsed.userId,
        displayName: parsed.displayName || parsed.userId,
        permissions: parsed.permissions,
        workspaceId: parsed.workspaceId,
        sessionVersion: AUTH_SESSION_VERSION
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function getAuthBundle(): AuthHeaderBundle {
  return readAuthBundle() || DEMO_ADMIN_AUTH
}

export function hasAuthSession(): boolean {
  return readAuthBundle() !== null
}

export function getAuthHeaders(): Record<string, string> {
  const bundle = readAuthBundle()
  if (!bundle) return {}
  // Only direct Harness calls consume these dev headers. Java public APIs ignore
  // them unless the request also carries the internal service token.
  return {
    'X-User-Id': bundle.userId,
    'X-User-Name': encodeURIComponent(bundle.displayName),
    'X-User-Perms': bundle.permissions,
    'X-Workspace-Id': bundle.workspaceId
  }
}

export function setAuthHeaders(bundle: Partial<AuthHeaderBundle>) {
  const next = { ...DEMO_ADMIN_AUTH, ...readAuthBundle(), ...bundle }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next))
}

export function setAuthFromMe(me: {
  userId: string
  displayName: string
  permissions?: string[]
  effectivePermissions?: string[]
  workspaceId: string
}) {
  setAuthHeaders({
    userId: me.userId,
    displayName: me.displayName,
    permissions: (me.effectivePermissions?.length ? me.effectivePermissions : me.permissions || []).join(','),
    workspaceId: me.workspaceId,
    sessionVersion: AUTH_SESSION_VERSION
  })
}

export function clearAuthHeaders() {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}

export function setCurrentWorkspaceId(workspaceId: string) {
  if (!hasAuthSession()) return
  setAuthHeaders({ workspaceId })
}

export function hasStoredPermission(permission: string): boolean {
  const bundle = readAuthBundle()
  if (!bundle || !permission) return false
  const perms = bundle.permissions.split(',').map((x) => x.trim()).filter(Boolean)
  if (perms.includes('*') || perms.includes(permission)) return true
  const colon = permission.indexOf(':')
  return colon > 0 && perms.includes(permission.slice(0, colon + 1) + '*')
}

export async function apiFetch<T>(
  url: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    data?: unknown
    params?: Record<string, string>
    timeoutMs?: number
  } = {}
): Promise<T> {
  const method = opts.method || 'GET'
  const qs = opts.params ? `?${new URLSearchParams(opts.params)}` : ''
  const apiPath = `/api${url}${qs}`
  const res = await fetch(apiPath, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(opts.data ?? {}),
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.message ? `: ${body.message}` : ''
    } catch {
      /* ignore */
    }
    throw new Error(`${method} ${apiPath} → ${res.status}${detail}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** Multipart upload (do not set Content-Type; browser sets boundary). */
export async function apiFetchForm<T>(url: string, form: FormData): Promise<T> {
  const apiPath = `/api${url}`
  const res = await fetch(apiPath, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...getAuthHeaders()
    },
    body: form
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.message ? `: ${body.message}` : ''
    } catch {
      /* ignore */
    }
    throw new Error(`POST ${apiPath} → ${res.status}${detail}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** 下载二进制（CSV 等） */
export async function apiFetchBinary(
  url: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    data?: unknown
    params?: Record<string, string>
  } = {}
): Promise<{ blob: Blob; filename: string }> {
  const method = opts.method || 'GET'
  const qs = opts.params ? `?${new URLSearchParams(opts.params)}` : ''
  const apiPath = `/api${url}${qs}`
  const res = await fetch(apiPath, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(opts.data ?? {})
  })
  if (!res.ok) {
    throw new Error(`${method} ${apiPath} → ${res.status}`)
  }
  const cd = res.headers.get('Content-Disposition') || ''
  const m = /filename="?([^";]+)"?/i.exec(cd)
  const filename = m?.[1] || 'download.csv'
  const blob = await res.blob()
  return { blob, filename }
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

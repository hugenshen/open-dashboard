/**
 * Shared fetch helper: attaches pluggable identity headers (no login page).
 * Customers replace getAuthHeaders() to inject SSO/JWT tokens.
 */

const AUTH_STORAGE_KEY = 'od.auth.headers'

export type AuthHeaderBundle = {
  userId: string
  displayName: string
  permissions: string
}

const DEFAULT_AUTH: AuthHeaderBundle = {
  userId: 'demo',
  displayName: '演示用户',
  permissions: '*'
}

export function getAuthHeaders(): Record<string, string> {
  let bundle = DEFAULT_AUTH
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuthHeaderBundle>
      bundle = {
        userId: parsed.userId || DEFAULT_AUTH.userId,
        displayName: parsed.displayName || DEFAULT_AUTH.displayName,
        permissions: parsed.permissions || DEFAULT_AUTH.permissions
      }
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(DEFAULT_AUTH))
    }
  } catch {
    /* ignore */
  }
  // fetch header values must be ISO-8859-1; encode non-ASCII display names
  return {
    'X-User-Id': bundle.userId,
    'X-User-Name': encodeURIComponent(bundle.displayName),
    'X-User-Perms': bundle.permissions
  }
}

export function setAuthHeaders(bundle: Partial<AuthHeaderBundle>) {
  const next = { ...DEFAULT_AUTH, ...bundle }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next))
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
  const res = await fetch(`/api${url}${qs}`, {
    method,
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
    throw new Error(`${method} ${url} → ${res.status}${detail}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** Multipart upload (do not set Content-Type; browser sets boundary). */
export async function apiFetchForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method: 'POST',
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
    throw new Error(`POST ${url} → ${res.status}${detail}`)
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
  const res = await fetch(`/api${url}${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(opts.data ?? {})
  })
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}`)
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

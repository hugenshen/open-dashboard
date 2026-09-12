/**
 * P017: dsh 0.1.2 iframe must open /dsh/?token=… once per process.
 * Hash od_bridge is a backup; Vue also POSTs /od/bridge because 303 drops the hash.
 */
import { getAuthBundle } from '@/api/http'

export function odBridgePayload(extra: Record<string, unknown> = {}) {
  const bundle = getAuthBundle()
  return {
    userId: bundle.userId || '',
    workspaceId: bundle.workspaceId || '',
    perms: bundle.permissions || '',
    ...extra,
  }
}

export async function fetchDshLaunchToken(): Promise<string> {
  try {
    const res = await fetch('/od/launch', { credentials: 'same-origin' })
    const body = (await res.json()) as { token?: string }
    return String(body?.token || '').trim()
  } catch {
    return ''
  }
}

export async function postOdBridge(bridge: Record<string, unknown>): Promise<void> {
  try {
    await fetch('/od/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(bridge),
    })
  } catch {
    /* iframe hash remains a backup */
  }
}

export function buildDshEmbedSrc(base: string, bridge: Record<string, unknown>, token: string): string {
  const url = new URL(base, window.location.origin)
  if (token) url.searchParams.set('token', token)
  url.hash = `od_bridge=${encodeURIComponent(JSON.stringify(bridge))}`
  if (url.origin !== window.location.origin) return url.toString()
  return url.pathname + url.search + url.hash
}

/**
 * P014: map OD (userId + workspaceId) → durable dsh workspace directory.
 * Agent cwd stays DSH_HOME/runtime; session partition uses tenants/od:… instead.
 * @module @opendashboard/dsh-od-auth/od-workspace
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} workspaceId
 * @param {string} userId
 */
export function odTenantLogicalKey(workspaceId, userId) {
  return `od:${String(workspaceId)}:${String(userId)}`
}

/**
 * Absolute tenant directory under $DSH_HOME (created if missing).
 * @param {string} workspaceId
 * @param {string} userId
 */
export function odTenantAbsPath(workspaceId, userId) {
  const home = String(process.env.DSH_HOME || '').trim()
  if (!home) throw new Error('DSH_HOME is unset')
  return join(home, 'tenants', odTenantLogicalKey(workspaceId, userId))
}

/**
 * Ensure tenant dir exists and register/reuse a dsh workspace for it.
 * @param {{ create: (path: string, title?: string) => Promise<{ id: string, path: string }> }} workspaceRegistry
 * @param {{ userId?: string, workspaceId?: string }} bridge
 * @returns {Promise<{ id: string, path: string, logical: string } | null>}
 */
export async function ensureOdDshWorkspace(workspaceRegistry, bridge) {
  const userId = bridge?.userId != null ? String(bridge.userId).trim() : ''
  const workspaceId = bridge?.workspaceId != null ? String(bridge.workspaceId).trim() : ''
  if (!userId || !workspaceId) return null
  if (!workspaceRegistry || typeof workspaceRegistry.create !== 'function') {
    throw new Error('workspaceRegistry unavailable')
  }
  const logical = odTenantLogicalKey(workspaceId, userId)
  const absPath = odTenantAbsPath(workspaceId, userId)
  await mkdir(absPath, { recursive: true })
  const ws = await workspaceRegistry.create(absPath, logical)
  return {
    id: String(ws.id),
    path: String(ws.path),
    logical,
  }
}

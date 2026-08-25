/**
 * Shared OD↔dsh bridge state (user / workspace / perms).
 * Tools and auth plugin both read this — not process.cwd / git roots.
 * @module @opendashboard/dsh-od-auth/bridge-state
 */

/**
 * @typedef {{
 *   userId?: string,
 *   workspaceId?: string,
 *   perms?: string,
 *   conversationId?: string,
 *   prompt?: string,
 *   datasetId?: string,
 *   dashboardId?: string,
 *   linkedDashboardId?: string,
 *   dshWorkspaceId?: string,
 *   dshWorkspacePath?: string,
 * }} OdBridge
 */

/** @type {OdBridge} */
let bridge = {}

/** @returns {OdBridge} */
export function getBridge() {
  return { ...bridge }
}

/** Replace bridge (used by env bootstrap). */
export function setBridge(next) {
  bridge = { ...(next || {}) }
}

/** Merge fields into bridge (iframe / POST updates). */
export function patchBridge(next) {
  if (!next || typeof next !== 'object') return getBridge()
  const cleaned = { ...next }
  for (const key of ['dashboardId', 'linkedDashboardId', 'datasetId', 'conversationId', 'dshWorkspaceId', 'dshWorkspacePath']) {
    if (cleaned[key] === '') delete cleaned[key]
  }
  if (cleaned.dashboardId && !cleaned.linkedDashboardId) {
    cleaned.linkedDashboardId = cleaned.dashboardId
  }
  bridge = { ...bridge, ...cleaned }
  return getBridge()
}

/** Load once from OD_DSH_BRIDGE env (deploy / single-tenant). */
export function loadBridgeFromEnv() {
  const raw = process.env.OD_DSH_BRIDGE
  if (!raw) return getBridge()
  try {
    setBridge(JSON.parse(raw))
  } catch {
    /* ignore malformed */
  }
  return getBridge()
}

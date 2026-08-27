/**
 * Shared OD↔dsh bridge state (user / workspace / perms).
 * Tools and auth plugin both read this — not process.cwd / git roots.
 * Conversation analysis never asks the user to pick a dsh folder workspace;
 * identity is filled from env / shell / this default and bound internally.
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

/** Local/LAN demo tenant when the Vue shell has not posted a principal yet. */
export const DEFAULT_BRIDGE = Object.freeze({
  userId: 'demo',
  workspaceId: 'workspace-retail',
  perms: '*',
})

/** @type {OdBridge} */
let bridge = {}

/** @param {unknown} value */
export function nonempty(value) {
  const text = value != null ? String(value).trim() : ''
  return text || undefined
}

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

/**
 * Fill missing identity so composer never waits on a user-facing workspace pick.
 * @returns {OdBridge}
 */
export function ensureDefaultIdentity() {
  const current = getBridge()
  const userId = nonempty(current.userId) || DEFAULT_BRIDGE.userId
  const workspaceId = nonempty(current.workspaceId) || DEFAULT_BRIDGE.workspaceId
  const perms = nonempty(current.perms) || DEFAULT_BRIDGE.perms
  if (userId !== current.userId || workspaceId !== current.workspaceId || perms !== current.perms) {
    patchBridge({ userId, workspaceId, perms })
  }
  return getBridge()
}

/**
 * Merge a Vue/iframe POST onto the current bridge.
 * Empty userId / workspaceId / perms must not wipe the env default — that is
 * what left LAN visitors on "选择一个工作区开始".
 * @param {Record<string, unknown>} parsed
 * @returns {OdBridge}
 */
export function mergeClientBridge(parsed) {
  const prev = getBridge()
  const src = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    userId: nonempty(src.userId) || nonempty(prev.userId) || DEFAULT_BRIDGE.userId,
    workspaceId: nonempty(src.workspaceId) || nonempty(prev.workspaceId) || DEFAULT_BRIDGE.workspaceId,
    perms: nonempty(src.perms) || nonempty(prev.perms) || DEFAULT_BRIDGE.perms,
    conversationId: nonempty(src.conversationId),
    prompt: nonempty(src.prompt),
    datasetId: nonempty(src.datasetId),
    dashboardId: nonempty(src.dashboardId) || nonempty(src.linkedDashboardId),
    linkedDashboardId: nonempty(src.linkedDashboardId) || nonempty(src.dashboardId),
  }
}

/** Load once from OD_DSH_BRIDGE env (deploy / single-tenant). */
export function loadBridgeFromEnv() {
  const raw = process.env.OD_DSH_BRIDGE
  if (raw) {
    try {
      setBridge(JSON.parse(raw))
    } catch {
      /* ignore malformed */
    }
  }
  return ensureDefaultIdentity()
}

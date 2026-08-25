/**
 * In-process preview frames + staging charts for the board worker.
 * dsh tools only pass JSON — this is the DataFrame stand-in (JoyAgent context.df).
 * @module @opendashboard/dsh-od-bi/board-store
 */

import { getBridge } from '@opendashboard/dsh-od-auth/bridge-state'

const sessions = new Map()
/** Survives resetBoardSession so Lead's od_board_worker can lift child commit meta. */
const lastPresentation = new Map()
/** Fallback when child remember and parent consume used different keys. */
const LAST_PRESENTATION_KEY = '__last__'

export function boardSessionKey() {
  const b = getBridge()
  // Never key by dashboardId: apply-patch writes it onto the bridge before
  // Lead's spawn presentationMeta runs, which would miss the child's remember.
  const conv = String(b.conversationId || '').trim()
  return `${b.workspaceId || 'ws'}:${b.userId || 'u'}:${conv || 'sess'}`
}

export function getBoardSession(key = boardSessionKey()) {
  let s = sessions.get(key)
  if (!s) {
    s = { key, frames: new Map(), staging: [], dropped: [], insights: [], meta: {} }
    sessions.set(key, s)
  }
  return s
}

export function resetBoardSession(key = boardSessionKey()) {
  const s = { key, frames: new Map(), staging: [], dropped: [], insights: [], meta: {} }
  sessions.set(key, s)
  return s
}

export function putFrame(session, handle, frame) {
  session.frames.set(handle, frame)
  return frame
}

export function getFrame(session, handle) {
  return session.frames.get(String(handle || '')) || null
}

/**
 * Keep the last successful board_ready / report_ready card for the current
 * conversation. Child od_commit_* runs in a spawn session; Lead needs this
 * on the parent od_board_worker tool/result.
 */
export function rememberPresentation(meta, key = boardSessionKey()) {
  if (!meta || typeof meta !== 'object') return
  lastPresentation.set(key, meta)
  lastPresentation.set(LAST_PRESENTATION_KEY, meta)
}

/** Read and clear. Spawn presentationMeta should call this once per worker return. */
export function consumePresentation(key) {
  const explicit = arguments.length > 0
  const k = explicit ? key : boardSessionKey()
  let meta = lastPresentation.get(k)
  if (meta) {
    lastPresentation.delete(k)
    if (lastPresentation.get(LAST_PRESENTATION_KEY) === meta) {
      lastPresentation.delete(LAST_PRESENTATION_KEY)
    }
    return meta
  }
  if (!explicit) {
    meta = lastPresentation.get(LAST_PRESENTATION_KEY)
    if (meta) {
      lastPresentation.delete(LAST_PRESENTATION_KEY)
      return meta
    }
  }
  return null
}

export function resetPresentation(key = boardSessionKey()) {
  lastPresentation.delete(key)
  lastPresentation.delete(LAST_PRESENTATION_KEY)
}

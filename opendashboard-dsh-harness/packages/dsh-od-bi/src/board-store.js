/**
 * In-process preview frames + staging charts for the board worker.
 * dsh tools only pass JSON — this is the DataFrame stand-in (JoyAgent context.df).
 * @module @opendashboard/dsh-od-bi/board-store
 */

import { getBridge } from '@opendashboard/dsh-od-auth/bridge-state'

const sessions = new Map()

export function boardSessionKey() {
  const b = getBridge()
  return `${b.workspaceId || 'ws'}:${b.userId || 'u'}:${b.conversationId || b.dashboardId || 'sess'}`
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

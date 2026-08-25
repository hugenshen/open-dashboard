/**
 * History-row titles for GET /od/sessions (P014).
 * Never show raw session ids (`session-…`); prefer folded title, else first user question.
 * @module @opendashboard/dsh-od-auth/session-list-title
 */
import {
  collectSessionTitleMessages,
  fallbackSessionTitle,
  foldSessionTitle,
} from '@deepseek-ai/dsh-session-title'

const FALLBACK_WORDS = 16
const FALLBACK_BYTES = 120

/** Internal ids must not appear as list labels. */
export function isOpaqueSessionId(value) {
  const s = String(value || '').trim()
  if (!s) return true
  if (/^session-/i.test(s)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true
  return false
}

/** True only when a human typed a message (plugin snapshots do not count). */
export function sessionHasHumanMessage(events) {
  return (Array.isArray(events) ? events : []).some((event) => (
    event?.type === 'user/message' && event?.data?.source?.kind === 'user'
  ))
}

export function lastEventTime(events, fallback = 0) {
  const list = Array.isArray(events) ? events : []
  for (let i = list.length - 1; i >= 0; i--) {
    if (typeof list[i]?.time === 'number') return list[i].time
  }
  return fallback
}

/** Strip /ask /board /report so the list shows the question, not the command. */
export function questionPreview(text) {
  const raw = String(text || '').trim()
  const stripped = raw.replace(/^\/(ask|board|report)\b\s*/i, '').trim()
  return stripped || raw
}

/**
 * @param {object[]} [events]
 * @param {string} [foldedTitle] already-folded sessionTitle, if any
 */
export function displaySessionTitle(events, foldedTitle) {
  const fromFold = String(foldedTitle || foldSessionTitle(events || [])?.title || '').trim()
  if (fromFold && !isOpaqueSessionId(fromFold)) return fromFold
  const first = collectSessionTitleMessages(events || [])[0]?.text
  const preview = questionPreview(first)
  if (preview) {
    const title = fallbackSessionTitle(preview, FALLBACK_WORDS, FALLBACK_BYTES)
    if (title && !isOpaqueSessionId(title)) return title
  }
  return sessionHasHumanMessage(events) ? '对话' : '新会话'
}

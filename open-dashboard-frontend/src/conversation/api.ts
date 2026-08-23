import { apiFetch } from '../api/http'

export type ConversationVO = {
  id: string
  title: string
  ownerId: string
  layoutPrefs: Record<string, unknown>
  datasetIds: string[]
  linkedDashboardId?: string | null
  createTime?: number
  updateTime?: number
}

export type ConversationMessageVO = {
  id: string
  conversationId: string
  role: string
  content: string
  attachments?: Record<string, unknown>[]
  createTime?: number
}

export type StylePresetVO = {
  id: string
  name: string
  description: string
  tokens: Record<string, unknown>
}

export type ConversationRevisionVO = {
  id: string
  conversationId: string
  runId?: string | null
  dashboardId: string
  patch: Record<string, unknown>
  snapshot: Record<string, unknown>
  label?: string | null
  createTime?: number
}

function isUnavailable(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /Failed to fetch|NetworkError|AbortError|ERR_CONNECTION|ECONNREFUSED|→ 50[0234]/.test(m)
}

export function explainConversationError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/Failed to fetch|NetworkError|AbortError|ERR_CONNECTION|ECONNREFUSED/.test(m)) {
    return '对话服务连不上。请确认已启动 opendashboard-dsh-harness（默认 :3090）与后端 :8082。'
  }
  if (/→ 50[0234]/.test(m) && /\/conversations/.test(m)) {
    return '后端 API 连不上（:8082）。请确认后端已启动后再试。'
  }
  return m
}

/** Java conversations CRUD only (P011: Agent runs live in dsh, not /harness). */
export const conversationApi = {
  feature: async () => {
    try {
      return await apiFetch<{ enabled: boolean }>('/conversations/feature', { timeoutMs: 4000 })
    } catch (e) {
      if (!isUnavailable(e)) throw e
      return { enabled: true }
    }
  },
  styles: () => apiFetch<StylePresetVO[]>('/conversations/styles', { timeoutMs: 4000 }),
  list: (limit?: number) =>
    apiFetch<ConversationVO[]>(
      '/conversations',
      limit ? { params: { limit: String(limit) } } : {}
    ),
  create: (data: { title?: string; datasetIds?: string[]; linkedDashboardId?: string }) =>
    apiFetch<ConversationVO>('/conversations', {
      method: 'POST',
      data,
      timeoutMs: 8000
    }),
  get: (id: string) => apiFetch<ConversationVO>(`/conversations/${id}`),
  update: (
    id: string,
    data: {
      title?: string
      layoutPrefs?: Record<string, unknown>
      datasetIds?: string[]
      linkedDashboardId?: string
    }
  ) =>
    apiFetch<ConversationVO>(`/conversations/${id}`, {
      method: 'PATCH',
      data,
      timeoutMs: 8000
    }),
  remove: (id: string) => apiFetch<void>(`/conversations/${id}`, { method: 'DELETE' }),
  messages: (id: string) => apiFetch<ConversationMessageVO[]>(`/conversations/${id}/messages`),
  appendMessage: (
    id: string,
    data: { role?: string; content: string; attachments?: Record<string, unknown>[] }
  ) => apiFetch<ConversationMessageVO>(`/conversations/${id}/messages`, { method: 'POST', data }),
  revisions: (id: string) => apiFetch<ConversationRevisionVO[]>(`/conversations/${id}/revisions`),
  restore: (id: string, rev: string) =>
    apiFetch<ConversationRevisionVO>(`/conversations/${id}/revisions/${rev}/restore`, { method: 'POST' })
}

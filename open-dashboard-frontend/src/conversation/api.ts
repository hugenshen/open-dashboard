import { apiFetch, getAuthHeaders } from '../api/http'

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

export type ConversationRunRequest = {
  message: string
  intent?: 'ask' | 'insight' | 'gen'
  mode?: 'auto' | 'plan'
  styleId?: string
  datasetIds?: string[]
  selectedChartId?: string
  selectedEncode?: Record<string, unknown>
}

export type ConversationAdoptRequest = {
  action?: 'save' | 'generate'
  styleId?: string
}

export type SseHandler = (event: string, data: Record<string, unknown>) => void

async function readSse(res: Response, onEvent: SseHandler): Promise<void> {
  if (!res.ok || !res.body) {
    throw new Error(`SSE → ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const flush = () => {
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    dataLines = []
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      parsed = { text: raw }
    }
    onEvent(eventName || 'message', parsed)
    eventName = 'message'
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() || ''
    for (const line of parts) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      } else if (line === '') {
        flush()
      }
    }
  }
  flush()
}

export const conversationApi = {
  feature: () => apiFetch<{ enabled: boolean }>('/conversations/feature'),
  styles: () => apiFetch<StylePresetVO[]>('/conversations/styles'),
  list: () => apiFetch<ConversationVO[]>('/conversations'),
  create: (data: { title?: string; datasetIds?: string[]; linkedDashboardId?: string }) =>
    apiFetch<ConversationVO>('/conversations', { method: 'POST', data }),
  get: (id: string) => apiFetch<ConversationVO>(`/conversations/${id}`),
  update: (
    id: string,
    data: {
      title?: string
      layoutPrefs?: Record<string, unknown>
      datasetIds?: string[]
      linkedDashboardId?: string
    }
  ) => apiFetch<ConversationVO>(`/conversations/${id}`, { method: 'PATCH', data }),
  remove: (id: string) => apiFetch<void>(`/conversations/${id}`, { method: 'DELETE' }),
  messages: (id: string) => apiFetch<ConversationMessageVO[]>(`/conversations/${id}/messages`),
  revisions: (id: string) => apiFetch<ConversationRevisionVO[]>(`/conversations/${id}/revisions`),
  restore: (id: string, rev: string) =>
    apiFetch<ConversationRevisionVO>(`/conversations/${id}/revisions/${rev}/restore`, { method: 'POST' }),
  cancel: (id: string, runId: string) =>
    apiFetch(`/conversations/${id}/runs/${runId}/cancel`, { method: 'POST' }),

  async startRun(id: string, body: ConversationRunRequest, onEvent: SseHandler) {
    const res = await fetch(`/api/conversations/${id}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...getAuthHeaders()
      },
      body: JSON.stringify(body)
    })
    await readSse(res, onEvent)
  },

  async confirmPlan(id: string, runId: string, onEvent: SseHandler) {
    const res = await fetch(`/api/conversations/${id}/runs/${runId}/confirm-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...getAuthHeaders()
      },
      body: '{}'
    })
    await readSse(res, onEvent)
  },

  async adopt(id: string, runId: string, body: ConversationAdoptRequest, onEvent: SseHandler) {
    const res = await fetch(`/api/conversations/${id}/runs/${runId}/adopt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...getAuthHeaders()
      },
      body: JSON.stringify(body || {})
    })
    await readSse(res, onEvent)
  }
}

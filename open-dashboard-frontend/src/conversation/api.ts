import { getAuthHeaders, apiFetch } from '../api/http'

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

const HARNESS_BASE = '/harness/v1'

function isUnavailable(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /Failed to fetch|NetworkError|AbortError|ERR_CONNECTION|ECONNREFUSED|→ 50[0234]/.test(m)
}

export function explainConversationError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/Failed to fetch|NetworkError|AbortError|ERR_CONNECTION|ECONNREFUSED/.test(m) || /问数失败 \(50[0234]\)/.test(m)) {
    return '问数服务连不上（harness :8091）。请确认已启动后再发送。'
  }
  if (/→ 50[0234]/.test(m) && /\/conversations/.test(m)) {
    return '后端 API 连不上（:8082）。问数未发出，请确认后端已启动后再试。'
  }
  return m
}

async function harnessFetch<T>(
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    data?: unknown
  } = {}
): Promise<T> {
  const method = opts.method || 'GET'
  const res = await fetch(`${HARNESS_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(opts.data ?? {})
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.detail
        ? `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}`
        : body?.message
          ? `: ${body.message}`
          : ''
    } catch {
      /* ignore */
    }
    throw new Error(`${method} ${path} → ${res.status}${detail}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

async function readSse(res: Response, onEvent: SseHandler): Promise<void> {
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.detail
        ? `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}`
        : body?.message
          ? `: ${body.message}`
          : ''
    } catch {
      try {
        const text = await res.text()
        if (text) detail = `: ${text.slice(0, 240)}`
      } catch {
        /* ignore */
      }
    }
    throw new Error(`问数失败 (${res.status})${detail}`)
  }
  if (!res.body) {
    throw new Error('问数失败：未收到流式响应，请确认 harness 已启动')
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

async function ensureRuntime(
  id: string,
  data?: { title?: string; datasetIds?: string[]; linkedDashboardId?: string }
): Promise<void> {
  try {
    await harnessFetch(`/conversations/${id}/ensure`, { method: 'POST', data: data ?? {} })
  } catch {
    /* startRun also ensures */
  }
}

export const conversationApi = {
  feature: async () => {
    try {
      return await apiFetch<{ enabled: boolean }>('/conversations/feature', { timeoutMs: 4000 })
    } catch (e) {
      if (!isUnavailable(e)) throw e
      return harnessFetch<{ enabled: boolean }>('/conversations/feature')
    }
  },
  styles: async () => {
    try {
      return await apiFetch<StylePresetVO[]>('/conversations/styles', { timeoutMs: 4000 })
    } catch (e) {
      if (!isUnavailable(e)) throw e
      return harnessFetch<StylePresetVO[]>('/conversations/styles')
    }
  },
  list: (limit?: number) =>
    apiFetch<ConversationVO[]>(
      '/conversations',
      limit ? { params: { limit: String(limit) } } : {}
    ),
  create: async (data: { title?: string; datasetIds?: string[]; linkedDashboardId?: string }) => {
    try {
      const created = await apiFetch<ConversationVO>('/conversations', {
        method: 'POST',
        data,
        timeoutMs: 8000
      })
      await ensureRuntime(created.id, {
        title: created.title,
        datasetIds: created.datasetIds,
        linkedDashboardId: created.linkedDashboardId || undefined
      })
      return created
    } catch (e) {
      if (!isUnavailable(e)) throw e
      return harnessFetch<ConversationVO>('/conversations', { method: 'POST', data })
    }
  },
  get: (id: string) => apiFetch<ConversationVO>(`/conversations/${id}`),
  /** 运行时(harness)是生成看板 linkedDashboardId 的权威来源；后端记录可能未同步该链接。 */
  getHarness: (id: string) => harnessFetch<ConversationVO>(`/conversations/${id}`),
  update: async (
    id: string,
    data: {
      title?: string
      layoutPrefs?: Record<string, unknown>
      datasetIds?: string[]
      linkedDashboardId?: string
    }
  ) => {
    try {
      return await apiFetch<ConversationVO>(`/conversations/${id}`, {
        method: 'PATCH',
        data,
        timeoutMs: 8000
      })
    } catch (e) {
      if (!isUnavailable(e)) throw e
      return harnessFetch<ConversationVO>(`/conversations/${id}`, { method: 'PATCH', data })
    }
  },
  remove: (id: string) => apiFetch<void>(`/conversations/${id}`, { method: 'DELETE' }),
  messages: (id: string) => apiFetch<ConversationMessageVO[]>(`/conversations/${id}/messages`),
  appendMessage: (
    id: string,
    data: { role?: string; content: string; attachments?: Record<string, unknown>[] }
  ) => apiFetch<ConversationMessageVO>(`/conversations/${id}/messages`, { method: 'POST', data }),
  revisions: (id: string) => apiFetch<ConversationRevisionVO[]>(`/conversations/${id}/revisions`),
  restore: (id: string, rev: string) =>
    apiFetch<ConversationRevisionVO>(`/conversations/${id}/revisions/${rev}/restore`, { method: 'POST' }),
  cancel: (id: string, runId: string) =>
    harnessFetch(`/conversations/${id}/runs/${runId}/cancel`, { method: 'POST' }),

  async startRun(id: string, body: ConversationRunRequest, onEvent: SseHandler) {
    const post = () =>
      fetch(`${HARNESS_BASE}/conversations/${id}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...getAuthHeaders()
        },
        body: JSON.stringify(body)
      })
    let res: Response
    try {
      res = await post()
    } catch (e) {
      throw new Error(explainConversationError(e))
    }
    if (res.status === 404) {
      await ensureRuntime(id, { title: body.message, datasetIds: body.datasetIds })
      try {
        res = await post()
      } catch (e) {
        throw new Error(explainConversationError(e))
      }
    }
    await readSse(res, onEvent)
  },

  async confirmPlan(id: string, runId: string, onEvent: SseHandler) {
    const res = await fetch(`${HARNESS_BASE}/conversations/${id}/runs/${runId}/confirm-plan`, {
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
    const res = await fetch(`${HARNESS_BASE}/conversations/${id}/runs/${runId}/adopt`, {
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

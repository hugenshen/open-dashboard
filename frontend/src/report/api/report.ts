import type { ReportDetailVO, ReportMetaVO } from '../types'

async function http<T>(method: string, url: string, data?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(data ?? {})
  })
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`)
  return res.json()
}

export const reportApi = {
  list: () => http<ReportMetaVO[]>('GET', '/report'),
  get: (id: string) => http<ReportDetailVO>('GET', `/report/${id}`),
  create: (name: string) => http<ReportDetailVO>('POST', '/report', { name }),
  saveDoc: (id: string, content: Record<string, unknown>, contentId: string) =>
    http<ReportDetailVO>('PUT', `/report/${id}/doc`, { content, contentId }),
  publish: (id: string) => http<ReportDetailVO>('POST', `/report/${id}/publish`)
}

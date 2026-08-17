import type { ReportDetailVO, ReportMetaVO } from '../types'
import { apiFetch } from '../../api/http'

async function http<T>(method: string, url: string, data?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    data
  })
}

export const reportApi = {
  list: (limit?: number) =>
    apiFetch<ReportMetaVO[]>(
      '/report',
      limit ? { method: 'GET', params: { limit: String(limit) } } : { method: 'GET' }
    ),
  get: (id: string) => http<ReportDetailVO>('GET', `/report/${id}`),
  create: (name: string) => http<ReportDetailVO>('POST', '/report', { name }),
  updateMeta: (id: string, data: { name?: string; folder?: string; desc?: string }) =>
    http<ReportMetaVO>('PATCH', `/report/${id}`, data),
  saveDoc: (id: string, content: Record<string, unknown>, contentId: string) =>
    http<ReportDetailVO>('PUT', `/report/${id}/doc`, { content, contentId }),
  publish: (id: string) => http<ReportDetailVO>('POST', `/report/${id}/publish`)
}

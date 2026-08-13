import type {
  BusiNodeRequest,
  BusiNodeVO,
  ChartQueryRequest,
  ChartQueryResult,
  ChartViewSaveRequest,
  ChartViewVO,
  DashboardBarVO,
  DashboardComponentVO,
  DashboardComponentsUpdateRequest,
  DashboardCreateRequest,
  DashboardDetailVO,
  DashboardLayoutUpdateRequest,
  DashboardLayoutVO,
  DashboardLinkageVO,
  DashboardMoveRequest,
  DashboardNodeVO,
  DashboardRenameRequest,
  DashboardStatusVO,
  DashboardTemplateVO,
  ViewMode
} from '../types/dashboard'

/**
 * Dashboard / chartQuery HTTP API clients.
 * Wire via `setDashboardHttpClient` (see main.ts → apiFetch).
 */

export type HttpClient = <T>(opts: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  data?: unknown
  params?: Record<string, string>
}) => Promise<T>

let http: HttpClient | null = null

export function setDashboardHttpClient(client: HttpClient) {
  http = client
}

async function call<T>(opts: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  data?: unknown
  params?: Record<string, string>
}): Promise<T> {
  if (!http) {
    throw new Error('setDashboardHttpClient() must be called before using dashboard APIs')
  }
  return http<T>(opts)
}

export const dashboardTreeApi = {
  tree: (data: BusiNodeRequest) =>
    call<BusiNodeVO[]>({ method: 'POST', url: '/dashboardTree/tree', data }),
  create: (data: DashboardCreateRequest) =>
    call<DashboardNodeVO>({ method: 'POST', url: '/dashboardTree/create', data }),
  rename: (data: DashboardRenameRequest) =>
    call<DashboardNodeVO>({ method: 'POST', url: '/dashboardTree/rename', data }),
  move: (data: DashboardMoveRequest) =>
    call<DashboardNodeVO>({ method: 'POST', url: '/dashboardTree/move', data }),
  perDelete: (id: string) =>
    call<boolean>({ method: 'POST', url: `/dashboardTree/perDelete/${id}` }),
  delete: (id: string) => call<void>({ method: 'POST', url: `/dashboardTree/delete/${id}` }),
  barInfo: (id: string) => call<DashboardBarVO>({ method: 'GET', url: `/dashboardTree/barInfo/${id}` })
}

export const dashboardApi = {
  listTemplates: () => call<DashboardTemplateVO[]>({ method: 'GET', url: '/dashboard/templates' }),
  get: (id: string, view: ViewMode = 'draft') =>
    call<DashboardDetailVO>({ method: 'GET', url: `/dashboard/${id}`, params: { view } }),
  updateLayout: (id: string, data: DashboardLayoutUpdateRequest) =>
    call<DashboardLayoutVO>({ method: 'PUT', url: `/dashboard/${id}/layout`, data }),
  updateComponents: (id: string, data: DashboardComponentsUpdateRequest) =>
    call<DashboardComponentVO[]>({ method: 'PUT', url: `/dashboard/${id}/components`, data }),
  saveChart: (id: string, chartId: string, data: ChartViewSaveRequest) =>
    call<ChartViewVO>({ method: 'PUT', url: `/dashboard/${id}/charts/${chartId}`, data }),
  deleteChart: (id: string, chartId: string) =>
    call<void>({ method: 'DELETE', url: `/dashboard/${id}/charts/${chartId}` }),
  getLinkages: (id: string, view: ViewMode = 'draft') =>
    call<DashboardLinkageVO[]>({
      method: 'GET',
      url: `/dashboard/${id}/linkages`,
      params: { view }
    }),
  putLinkages: (id: string, data: DashboardLinkageVO[]) =>
    call<DashboardLinkageVO[]>({ method: 'PUT', url: `/dashboard/${id}/linkages`, data }),
  publish: (id: string) =>
    call<DashboardStatusVO>({ method: 'POST', url: `/dashboard/${id}/publish` }),
  discardDraft: (id: string) =>
    call<DashboardStatusVO>({ method: 'POST', url: `/dashboard/${id}/discardDraft` }),
  status: (id: string) => call<DashboardStatusVO>({ method: 'GET', url: `/dashboard/${id}/status` }),
  share: (id: string, data?: { visibility?: string; perm?: string }) =>
    call<import('../types/dashboard').DashboardShareVO>({
      method: 'POST',
      url: `/dashboard/${id}/share`,
      data
    }),
  getShare: (id: string) =>
    call<import('../types/dashboard').DashboardShareVO>({ method: 'GET', url: `/dashboard/${id}/share` })
}

export const shareApi = {
  view: (token: string) =>
    call<import('../types/dashboard').ShareViewVO>({ method: 'GET', url: `/share/${token}` }),
  chartQuery: (token: string, data: ChartQueryRequest) =>
    call<ChartQueryResult>({ method: 'POST', url: `/share/${token}/chartQuery`, data }),
  exportCsv: async (token: string, chartId: string) => {
    if (!http) throw new Error('setDashboardHttpClient() must be called before using share APIs')
    // binary response — use raw fetch via api layer pattern
    const { apiFetchBinary } = await import('../api/http')
    return apiFetchBinary(`/share/${token}/export`, {
      method: 'POST',
      data: { chartId }
    })
  }
}

export const chartQueryApi = {
  query: (data: ChartQueryRequest) =>
    call<ChartQueryResult>({ method: 'POST', url: '/chartQuery/query', data }),
  exportCsv: async (data: ChartQueryRequest) => {
    const { apiFetchBinary } = await import('../api/http')
    return apiFetchBinary('/chartQuery/export', { method: 'POST', data })
  }
}

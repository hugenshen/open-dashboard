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
  ViewMode
} from '../types/dashboard'

/**
 * API clients for target product.
 * Wire `request` to your HTTP layer (axios/fetch). Default uses in-memory backend for local demos.
 */

export type HttpClient = <T>(opts: {
  method: 'GET' | 'POST' | 'PUT'
  url: string
  data?: unknown
  params?: Record<string, string>
}) => Promise<T>

let http: HttpClient | null = null

export function setDashboardHttpClient(client: HttpClient) {
  http = client
}

async function call<T>(opts: {
  method: 'GET' | 'POST' | 'PUT'
  url: string
  data?: unknown
  params?: Record<string, string>
}): Promise<T> {
  if (!http) {
    throw new Error('setDashboardHttpClient() first, or use createInMemoryClient()')
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
  get: (id: string, view: ViewMode = 'draft') =>
    call<DashboardDetailVO>({ method: 'GET', url: `/dashboard/${id}`, params: { view } }),
  updateLayout: (id: string, data: DashboardLayoutUpdateRequest) =>
    call<DashboardLayoutVO>({ method: 'PUT', url: `/dashboard/${id}/layout`, data }),
  updateComponents: (id: string, data: DashboardComponentsUpdateRequest) =>
    call<DashboardComponentVO[]>({ method: 'PUT', url: `/dashboard/${id}/components`, data }),
  saveChart: (id: string, chartId: string, data: ChartViewSaveRequest) =>
    call<ChartViewVO>({ method: 'PUT', url: `/dashboard/${id}/charts/${chartId}`, data }),
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
  status: (id: string) => call<DashboardStatusVO>({ method: 'GET', url: `/dashboard/${id}/status` })
}

export const chartQueryApi = {
  query: (data: ChartQueryRequest) =>
    call<ChartQueryResult>({ method: 'POST', url: '/chartQuery/query', data })
}

export type ReportChartSource = 'dashboard' | 'inline'

export interface ReportChartAttrs {
  id: string
  source: ReportChartSource
  dashboardId?: string | null
  chartId?: string | null
  view?: 'published' | 'draft'
  datasetId?: string | null
  chartType?: string
  encode?: Record<string, unknown>
  style?: Record<string, unknown>
  senior?: Record<string, unknown>
  title?: string
  width?: 'full' | 'half' | number
  height?: number
}

export interface ReportMetaVO {
  id: string
  name: string
  status: string
  contentId: string
  version: number
  updateTime?: number
}

export interface ReportDetailVO {
  meta: ReportMetaVO
  content: Record<string, unknown>
}

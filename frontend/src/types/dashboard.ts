/**
 * Dashboard redesign — shared types (target product).
 * IDs are strings in JSON wire format.
 */

export type NodeType = 'folder' | 'dashboard'
export type PublishStatus = 'draft' | 'published' | 'publishedWithDraft'
export type CopyType = 'draft' | 'published'
export type LayoutMode = 'grid' | 'free'
export type ComponentType = 'chart' | 'filter' | 'text' | 'image' | 'tabs'
export type ViewMode = 'draft' | 'published'

export interface BusiNodeRequest {
  busiFlag?: string
  id?: string
}

export interface BusiNodeVO {
  id: string
  pid: string
  name: string
  nodeType: NodeType
  leaf: boolean
  weight?: number
  children?: BusiNodeVO[]
}

export interface DashboardCreateRequest {
  pid: string
  name: string
  nodeType: NodeType
  layoutMode?: LayoutMode
}

export interface DashboardRenameRequest {
  id: string
  name: string
}

export interface DashboardMoveRequest {
  id: string
  pid: string
}

export interface DashboardNodeVO {
  id: string
  pid: string
  name: string
  nodeType: NodeType
  status: PublishStatus
  layoutMode: LayoutMode
  contentId: string
  version: number
  updateTime?: number
}

export interface DashboardBarVO {
  id: string
  name: string
  nodeType: NodeType
  status: PublishStatus
  createBy?: string
  createTime?: number
  updateBy?: string
  updateTime?: number
  chartCount: number
}

export interface MobileComponentVO {
  id: string
  refId: string
  x: number
  y: number
  w: number
  h: number
  z?: number
  styleSync?: boolean
  style?: Record<string, unknown>
}

export interface MobileLayoutVO {
  enabled?: boolean
  device?: string
  bg?: string
  components?: MobileComponentVO[]
}

export interface DashboardLayoutVO {
  gridCols: number
  gridRows: number
  themeRef?: string
  refreshSec?: number
  extStyle?: Record<string, unknown>
  mobile?: MobileLayoutVO
}

export interface DashboardComponentVO {
  id: string
  type: ComponentType
  parentId?: string
  chartViewId?: string
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  props?: Record<string, unknown>
}

export interface ChartViewVO {
  id: string
  dashboardId: string
  datasetId: string | null
  chartType: string
  title?: string
  encode: Record<string, unknown>
  style?: Record<string, unknown>
  senior?: Record<string, unknown>
}

export interface DashboardLinkageVO {
  id?: string
  sourceChartId: string
  sourceField: string
  targetChartId: string
  targetField: string
  enabled: boolean
}

export interface DashboardDetailVO {
  meta: DashboardNodeVO
  layout: DashboardLayoutVO
  components: DashboardComponentVO[]
  charts: Record<string, ChartViewVO>
  linkages: DashboardLinkageVO[]
}

export interface DashboardLayoutUpdateRequest {
  gridCols?: number
  gridRows?: number
  themeRef?: string
  refreshSec?: number
  extStyle?: Record<string, unknown>
  contentId: string
}

export interface DashboardComponentsUpdateRequest {
  upsert: DashboardComponentVO[]
  deleteIds: string[]
  contentId: string
}

export interface ChartViewSaveRequest {
  datasetId: string | null
  chartType: string
  title?: string
  encode: Record<string, unknown>
  style?: Record<string, unknown>
  senior?: Record<string, unknown>
  contentId: string
}

export interface DashboardStatusVO {
  id: string
  status: PublishStatus
  contentId: string
  version: number
}

export interface FilterContextItem {
  componentId: string
  field: string
  operator: string
  value: unknown
}

export interface LinkageContextItem {
  sourceChartId: string
  sourceField: string
  value: unknown
  targetChartId: string
  targetField: string
}

export interface ChartQueryRequest {
  chartId?: string
  /** Omit for report inline-only charts */
  dashboardId?: string
  view?: ViewMode
  client?: 'dashboard' | 'report'
  inline?: {
    datasetId: string
    chartType: string
    encode: Record<string, unknown>
    style?: Record<string, unknown>
    senior?: Record<string, unknown>
  }
  context: {
    filters: FilterContextItem[]
    linkages: LinkageContextItem[]
  }
}

export interface ChartQueryResult {
  fields: Array<{ name: string; type: string }>
  data: unknown[][]
  series?: Record<string, unknown>
  extra?: Record<string, unknown>
}

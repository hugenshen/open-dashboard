import type {
  ChartViewVO,
  DashboardComponentVO,
  DashboardDetailVO,
  DashboardLinkageVO,
  MobileLayoutVO
} from '../../types/dashboard'
import type { DatasetDetailVO } from '../../dataset/api'

/** Hi-fi in-memory dash model (subset used by editorCore). */
export interface HiFiDash {
  id: string
  name: string
  status: string
  contentId: string
  version: number
  theme: string
  components: HiFiComp[]
  charts: Record<string, HiFiChart>
  linkages: HiFiLinkage[]
  jumps: unknown[]
  alerts: unknown[]
  tabs: Array<{ id: string; name: string }>
  activeTab: string
  share: { token?: string; visibility?: string; perm?: string } | null
  mobile: MobileLayoutVO & { enabled?: boolean; device?: string; bg?: string; components?: unknown[] }
  folder?: string
  desc?: string
  updateBy?: string
  updateTime?: string
  datasetIds?: string[]
}

export interface HiFiComp {
  id: string
  type: string
  tabId?: string
  x: number
  y: number
  w: number
  h: number
  z: number
  chartId?: string
  props?: Record<string, unknown>
}

export interface HiFiChart {
  id: string
  title?: string
  chartType: string
  datasetId: string | null
  encode: Record<string, unknown>
  style?: Record<string, unknown>
  senior?: Record<string, unknown>
  fieldRoles?: Record<string, string>
}

export interface HiFiLinkage {
  id?: string
  sourceChartId: string
  sourceField: string
  targetChartId: string
  targetField: string
  enabled: boolean
}

export function datasetsToHiFi(details: DatasetDetailVO[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const d of details) {
    const id = d.meta.id
    out[id] = {
      id,
      name: d.meta.name,
      datasourceId: d.meta.datasourceId,
      folder: d.meta.folder,
      fields: d.fields.map((f) => ({
        name: f.name,
        label: f.label,
        group: f.group === 'quota' ? 'quota' : 'dim',
        dataType: f.dataType || ''
      })),
      rows: []
    }
  }
  return out
}

/** Fill DATASETS.rows from POST /dataset/{id}/preview so field pickers match live schema. */
export async function hydrateHiFiDatasetRows(
  details: DatasetDetailVO[],
  datasets: Record<string, unknown>,
  preview: (id: string) => Promise<{
    columns: Array<{ name: string; type?: string; dataType?: string }>
    rows: unknown[][]
  }>
): Promise<void> {
  await Promise.all(
    details.map(async (d) => {
      const id = d.meta.id
      const slot = datasets[id] as { rows?: Record<string, unknown>[] } | undefined
      if (!slot) return
      try {
        const res = await preview(id)
        const cols = (res.columns || []).map((c) => c.name)
        const fieldNames = d.fields.map((f) => f.name)
        const names = cols.length ? cols : fieldNames
        slot.rows = (res.rows || []).map((row) => {
          const obj: Record<string, unknown> = {}
          names.forEach((name, i) => {
            obj[name] = Array.isArray(row) ? row[i] : undefined
          })
          return obj
        })
      } catch {
        slot.rows = []
      }
    })
  )
}

/** Product layout uses 72 cols; hi-fi editor canvas uses 12 cols. */
const GRID_SCALE = 6

function needsDownscale(comps: Array<{ x: number; w: number }>) {
  return comps.some((c) => c.w > 12 || c.x + c.w > 12)
}

/** Hi-fi row units needed so ECharts/KPI are not crushed after 72→12 scale. */
function minHiFiHeight(type: string, chartType?: string) {
  if (type === 'slicer' || type === 'text' || type === 'query') return 1
  if (chartType === 'kpi') return 2
  if (chartType === 'pie') return 4
  if (chartType === 'table' || chartType === 'grouptable' || chartType === 'detailtable' || chartType === 'pivot') {
    return 4
  }
  // bar / line / area / hbar …
  return 4
}

function rectsOverlap(a: HiFiComp, b: HiFiComp) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Clamp short charts and push later ones down so 72-col seed (h=12→2) still paints. */
function normalizeHiFiLayout(comps: HiFiComp[], charts: Record<string, HiFiChart>) {
  for (const c of comps) {
    const chartType = c.chartId ? charts[c.chartId]?.chartType : undefined
    c.h = Math.max(c.h, minHiFiHeight(c.type, chartType))
  }
  const sorted = [...comps].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]
    for (let j = 0; j < i; j++) {
      const prev = sorted[j]
      if (cur.tabId !== prev.tabId) continue
      if (rectsOverlap(cur, prev)) {
        cur.y = Math.max(cur.y, prev.y + prev.h)
      }
    }
  }
}

export function detailToHiFi(detail: DashboardDetailVO): HiFiDash {
  const ext = (detail.layout.extStyle || {}) as Record<string, unknown>
  const tabs = (ext.tabs as HiFiDash['tabs']) || [{ id: 'tab_main', name: '概览' }]
  const activeTab = String(ext.activeTab || tabs[0]?.id || 'tab_main')
  const jumps = (ext.jumps as unknown[]) || []
  const alerts = (ext.alerts as unknown[]) || []
  const share = (ext.share as HiFiDash['share']) || null

  const charts: Record<string, HiFiChart> = {}
  for (const [id, c] of Object.entries(detail.charts || {})) {
    charts[id] = {
      id: c.id,
      title: c.title,
      chartType: c.chartType,
      datasetId: c.datasetId,
      encode: { ...(c.encode || {}) },
      style: { ...(c.style || {}) },
      senior: { ...(c.senior || {}) },
      fieldRoles: ((c.senior as Record<string, unknown> | undefined)?.fieldRoles as Record<string, string>) || undefined
    }
  }

  const rawComps = detail.components || []
  const down = needsDownscale(rawComps)
  const components: HiFiComp[] = rawComps.map((c) => ({
    id: c.id,
    type: c.type,
    tabId: String((c.props as Record<string, unknown> | undefined)?.tabId || activeTab),
    x: down ? Math.round(c.x / GRID_SCALE) : c.x,
    y: down ? Math.round(c.y / GRID_SCALE) : c.y,
    w: down ? Math.max(1, Math.round(c.w / GRID_SCALE)) : c.w,
    h: down ? Math.max(1, Math.round(c.h / GRID_SCALE)) : c.h,
    z: c.zIndex,
    chartId: c.chartViewId,
    props: { ...(c.props || {}), __grid72: true }
  }))
  normalizeHiFiLayout(components, charts)

  const mobile = (detail.layout.mobile || {
    enabled: false,
    device: 'iphone_14',
    bg: '#f0f2f5',
    components: []
  }) as HiFiDash['mobile']

  return {
    id: detail.meta.id,
    name: detail.meta.name,
    status: detail.meta.status,
    contentId: detail.meta.contentId,
    version: detail.meta.version,
    theme: String(ext.theme || 'default'),
    components,
    charts,
    linkages: (detail.linkages || []).map((l) => ({
      id: l.id,
      sourceChartId: l.sourceChartId,
      sourceField: l.sourceField,
      targetChartId: l.targetChartId,
      targetField: l.targetField,
      enabled: l.enabled !== false
    })),
    jumps,
    alerts,
    tabs,
    activeTab,
    share,
    mobile,
    folder: String(ext.folder || '未分组'),
    desc: String(ext.desc || ''),
    updateBy: '当前用户',
    updateTime: detail.meta.updateTime
      ? new Date(detail.meta.updateTime).toLocaleString('zh-CN')
      : '',
    datasetIds: [...new Set(Object.values(charts).map((c) => c.datasetId).filter(Boolean) as string[])]
  }
}

export function hiFiToSavePayload(dash: HiFiDash) {
  const components: DashboardComponentVO[] = (dash.components || []).map((c) => {
    const props = { ...(c.props || {}), tabId: c.tabId }
    delete (props as Record<string, unknown>).__grid72
    return {
      id: c.id,
      type: c.type as DashboardComponentVO['type'],
      parentId: '0',
      chartViewId: c.chartId,
      // persist as 72-col product grid
      x: c.x * GRID_SCALE,
      y: c.y * GRID_SCALE,
      w: c.w * GRID_SCALE,
      h: c.h * GRID_SCALE,
      zIndex: c.z,
      props
    }
  })

  const charts: Record<string, ChartViewVO> = {}
  for (const [id, c] of Object.entries(dash.charts || {})) {
    const senior = { ...(c.senior || {}) }
    if (c.fieldRoles) senior.fieldRoles = c.fieldRoles
    charts[id] = {
      id: c.id,
      dashboardId: dash.id,
      datasetId: c.datasetId,
      chartType: c.chartType,
      title: c.title,
      encode: { ...(c.encode || {}), datasetId: c.datasetId },
      style: c.style || {},
      senior
    }
  }

  const linkages: DashboardLinkageVO[] = (dash.linkages || []).map((l) => ({
    id: l.id,
    sourceChartId: l.sourceChartId,
    sourceField: l.sourceField,
    targetChartId: l.targetChartId,
    targetField: l.targetField,
    enabled: l.enabled !== false
  }))

  const extStyle = {
    theme: dash.theme,
    tabs: dash.tabs,
    activeTab: dash.activeTab,
    jumps: dash.jumps || [],
    alerts: dash.alerts || [],
    share: dash.share,
    folder: dash.folder,
    desc: dash.desc
  }

  return {
    components,
    charts,
    linkages,
    layout: {
      gridCols: 72,
      gridRows: 36,
      extStyle,
      mobile: dash.mobile,
      contentId: dash.contentId
    },
    meta: {
      name: dash.name,
      status: dash.status,
      contentId: dash.contentId,
      version: dash.version
    }
  }
}

import type {
  ChartViewSaveRequest,
  ChartViewVO,
  DashboardComponentVO,
  DashboardComponentsUpdateRequest,
  DashboardDetailVO,
  DashboardLayoutUpdateRequest,
  DashboardLayoutVO,
  DashboardLinkageVO,
  ViewMode
} from '../../frontend/types/dashboard'
import { globalStore, type InMemoryDashboardStore } from '../store/InMemoryDashboardStore'

export class DashboardCanvasManage {
  constructor(private readonly store: InMemoryDashboardStore = globalStore) {}

  getDetail(id: string, view: ViewMode = 'draft'): DashboardDetailVO {
    const d = this.requireDashboard(id)
    if (d.nodeType !== 'dashboard') throw new Error('not a dashboard leaf')
    if (view === 'published' && d.status === 'draft') {
      throw new Error('dashboard not published')
    }
    this.store.ensureCopyBuckets(id)
    const copy = view
    return {
      meta: this.store.toNodeVO(d),
      layout: this.store.deepClone(this.store.layouts.get(id)![copy]),
      components: this.store.deepClone(this.store.components.get(id)![copy]),
      charts: this.store.deepClone(this.store.charts.get(id)![copy]),
      linkages: this.store.deepClone(this.store.linkages.get(id)![copy])
    }
  }

  updateLayout(id: string, req: DashboardLayoutUpdateRequest): DashboardLayoutVO {
    const d = this.requireDashboard(id)
    this.store.ensureCopyBuckets(id)
    const layout = this.store.layouts.get(id)!.draft
    if (req.gridCols != null) layout.gridCols = req.gridCols
    if (req.gridRows != null) layout.gridRows = req.gridRows
    if (req.themeRef != null) layout.themeRef = req.themeRef
    if (req.refreshSec != null) layout.refreshSec = req.refreshSec
    if (req.extStyle != null) layout.extStyle = req.extStyle
    this.store.bumpContent(d)
    return this.store.deepClone(layout)
  }

  updateComponents(id: string, req: DashboardComponentsUpdateRequest): DashboardComponentVO[] {
    const d = this.requireDashboard(id)
    this.store.ensureCopyBuckets(id)
    const bucket = this.store.components.get(id)!
    let list = bucket.draft.filter(c => !req.deleteIds.includes(c.id))
    for (const item of req.upsert) {
      const idx = list.findIndex(c => c.id === item.id)
      if (idx >= 0) list[idx] = { ...item }
      else list.push({ ...item })
    }
    bucket.draft = list
    this.store.bumpContent(d)
    return this.store.deepClone(list)
  }

  saveChart(dashboardId: string, chartId: string, req: ChartViewSaveRequest): ChartViewVO {
    const d = this.requireDashboard(dashboardId)
    this.store.ensureCopyBuckets(dashboardId)
    const charts = this.store.charts.get(dashboardId)!.draft
    const vo: ChartViewVO = {
      id: chartId,
      dashboardId,
      datasetId: req.datasetId,
      chartType: req.chartType,
      title: req.title,
      encode: req.encode,
      style: req.style || {},
      senior: req.senior || {}
    }
    charts[chartId] = vo
    this.store.bumpContent(d)
    return this.store.deepClone(vo)
  }

  getLinkages(id: string, view: ViewMode = 'draft'): DashboardLinkageVO[] {
    this.requireDashboard(id)
    this.store.ensureCopyBuckets(id)
    return this.store.deepClone(this.store.linkages.get(id)![view])
  }

  putLinkages(id: string, linkages: DashboardLinkageVO[]): DashboardLinkageVO[] {
    const d = this.requireDashboard(id)
    this.store.ensureCopyBuckets(id)
    const withIds = linkages.map(l => ({
      ...l,
      id: l.id || this.store.nextId('link'),
      enabled: l.enabled !== false
    }))
    this.store.linkages.get(id)!.draft = withIds
    this.store.bumpContent(d)
    return this.store.deepClone(withIds)
  }

  private requireDashboard(id: string) {
    const d = this.store.dashboards.get(id)
    if (!d) throw new Error(`dashboard not found: ${id}`)
    return d
  }
}

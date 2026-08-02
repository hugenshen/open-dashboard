/**
 * In-memory dual-copy store for vertical-slice demo.
 * Mirrors de_dashboard* tables; not for production.
 */

import type {
  ChartViewVO,
  CopyType,
  DashboardComponentVO,
  DashboardLayoutVO,
  DashboardLinkageVO,
  DashboardNodeVO,
  LayoutMode,
  NodeType,
  PublishStatus
} from '../../frontend/types/dashboard'

export interface DashboardRecord {
  id: string
  pid: string
  name: string
  nodeType: NodeType
  status: PublishStatus
  layoutMode: LayoutMode
  contentId: string
  version: number
  createBy?: string
  createTime: number
  updateBy?: string
  updateTime: number
}

type CopyBucket<T> = Record<CopyType, T>

export class InMemoryDashboardStore {
  readonly dashboards = new Map<string, DashboardRecord>()
  readonly layouts = new Map<string, CopyBucket<DashboardLayoutVO>>()
  readonly components = new Map<string, CopyBucket<DashboardComponentVO[]>>()
  readonly charts = new Map<string, CopyBucket<Record<string, ChartViewVO>>>()
  readonly linkages = new Map<string, CopyBucket<DashboardLinkageVO[]>>()

  private seq = 1

  nextId(prefix = 'id'): string {
    return `${prefix}_${this.seq++}`
  }

  bumpContent(dash: DashboardRecord): void {
    dash.contentId = String(Number(dash.contentId || '0') + 1)
    dash.updateTime = Date.now()
    if (dash.status === 'published') {
      dash.status = 'publishedWithDraft'
    }
  }

  ensureCopyBuckets(dashboardId: string): void {
    if (!this.layouts.has(dashboardId)) {
      const emptyLayout: DashboardLayoutVO = {
        gridCols: 72,
        gridRows: 36,
        refreshSec: 0,
        extStyle: {}
      }
      this.layouts.set(dashboardId, {
        draft: { ...emptyLayout },
        published: { ...emptyLayout }
      })
    }
    if (!this.components.has(dashboardId)) {
      this.components.set(dashboardId, { draft: [], published: [] })
    }
    if (!this.charts.has(dashboardId)) {
      this.charts.set(dashboardId, { draft: {}, published: {} })
    }
    if (!this.linkages.has(dashboardId)) {
      this.linkages.set(dashboardId, { draft: [], published: [] })
    }
  }

  toNodeVO(d: DashboardRecord): DashboardNodeVO {
    return {
      id: d.id,
      pid: d.pid,
      name: d.name,
      nodeType: d.nodeType,
      status: d.status,
      layoutMode: d.layoutMode,
      contentId: d.contentId,
      version: d.version,
      updateTime: d.updateTime
    }
  }

  deepClone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T
  }

  /** Copy draft → published (publish). */
  copyDraftToPublished(dashboardId: string): void {
    this.ensureCopyBuckets(dashboardId)
    const layout = this.layouts.get(dashboardId)!
    const comps = this.components.get(dashboardId)!
    const charts = this.charts.get(dashboardId)!
    const links = this.linkages.get(dashboardId)!
    layout.published = this.deepClone(layout.draft)
    comps.published = this.deepClone(comps.draft)
    charts.published = this.deepClone(charts.draft)
    links.published = this.deepClone(links.draft)
  }

  /** Copy published → draft (discard). */
  copyPublishedToDraft(dashboardId: string): void {
    this.ensureCopyBuckets(dashboardId)
    const layout = this.layouts.get(dashboardId)!
    const comps = this.components.get(dashboardId)!
    const charts = this.charts.get(dashboardId)!
    const links = this.linkages.get(dashboardId)!
    layout.draft = this.deepClone(layout.published)
    comps.draft = this.deepClone(comps.published)
    charts.draft = this.deepClone(charts.published)
    links.draft = this.deepClone(links.published)
  }
}

export const globalStore = new InMemoryDashboardStore()

import type {
  BusiNodeRequest,
  BusiNodeVO,
  DashboardBarVO,
  DashboardCreateRequest,
  DashboardMoveRequest,
  DashboardNodeVO,
  DashboardRenameRequest
} from '../../frontend/types/dashboard'
import { globalStore, type DashboardRecord, type InMemoryDashboardStore } from '../store/InMemoryDashboardStore'

export class DashboardTreeManage {
  constructor(private readonly store: InMemoryDashboardStore = globalStore) {}

  tree(_request: BusiNodeRequest): BusiNodeVO[] {
    const roots: BusiNodeVO[] = []
    const byPid = new Map<string, DashboardRecord[]>()
    for (const d of this.store.dashboards.values()) {
      const list = byPid.get(d.pid) || []
      list.push(d)
      byPid.set(d.pid, list)
    }
    const build = (pid: string): BusiNodeVO[] => {
      const children = byPid.get(pid) || []
      return children.map(d => ({
        id: d.id,
        pid: d.pid,
        name: d.name,
        nodeType: d.nodeType,
        leaf: d.nodeType === 'dashboard',
        children: d.nodeType === 'folder' ? build(d.id) : undefined
      }))
    }
    return build('0')
  }

  create(req: DashboardCreateRequest): DashboardNodeVO {
    if (!req.name?.trim()) throw new Error('name required')
    if (req.nodeType !== 'folder' && req.nodeType !== 'dashboard') {
      throw new Error('invalid nodeType')
    }
    const now = Date.now()
    const id = this.store.nextId('dash')
    const record: DashboardRecord = {
      id,
      pid: req.pid || '0',
      name: req.name.trim(),
      nodeType: req.nodeType,
      status: 'draft',
      layoutMode: req.layoutMode || 'grid',
      contentId: '1',
      version: 1,
      createBy: 'system',
      createTime: now,
      updateBy: 'system',
      updateTime: now
    }
    this.store.dashboards.set(id, record)
    if (req.nodeType === 'dashboard') {
      this.store.ensureCopyBuckets(id)
    }
    return this.store.toNodeVO(record)
  }

  rename(req: DashboardRenameRequest): DashboardNodeVO {
    const d = this.require(req.id)
    d.name = req.name.trim()
    d.updateTime = Date.now()
    return this.store.toNodeVO(d)
  }

  move(req: DashboardMoveRequest): DashboardNodeVO {
    const d = this.require(req.id)
    if (req.pid === req.id) throw new Error('cannot move under self')
    d.pid = req.pid
    d.updateTime = Date.now()
    return this.store.toNodeVO(d)
  }

  perDelete(id: string): boolean {
    const d = this.store.dashboards.get(id)
    if (!d) return true
    if (d.nodeType === 'folder') {
      for (const child of this.store.dashboards.values()) {
        if (child.pid === id) return false
      }
    }
    return true
  }

  delete(id: string): void {
    if (!this.perDelete(id)) throw new Error('node has children or is in use')
    this.store.dashboards.delete(id)
    this.store.layouts.delete(id)
    this.store.components.delete(id)
    this.store.charts.delete(id)
    this.store.linkages.delete(id)
  }

  barInfo(id: string): DashboardBarVO {
    const d = this.require(id)
    this.store.ensureCopyBuckets(id)
    const charts = this.store.charts.get(id)?.draft || {}
    return {
      id: d.id,
      name: d.name,
      nodeType: d.nodeType,
      status: d.status,
      createBy: d.createBy,
      createTime: d.createTime,
      updateBy: d.updateBy,
      updateTime: d.updateTime,
      chartCount: Object.keys(charts).length
    }
  }

  private require(id: string): DashboardRecord {
    const d = this.store.dashboards.get(id)
    if (!d) throw new Error(`dashboard not found: ${id}`)
    return d
  }
}

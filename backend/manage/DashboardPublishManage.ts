import type { DashboardStatusVO } from '../../frontend/types/dashboard'
import { globalStore, type InMemoryDashboardStore } from '../store/InMemoryDashboardStore'

export class DashboardPublishManage {
  constructor(private readonly store: InMemoryDashboardStore = globalStore) {}

  status(id: string): DashboardStatusVO {
    const d = this.require(id)
    return {
      id: d.id,
      status: d.status,
      contentId: d.contentId,
      version: d.version
    }
  }

  publish(id: string): DashboardStatusVO {
    const d = this.require(id)
    if (d.nodeType !== 'dashboard') throw new Error('not a dashboard leaf')
    this.store.ensureCopyBuckets(id)
    this.store.copyDraftToPublished(id)
    d.status = 'published'
    d.version += 1
    d.contentId = String(Number(d.contentId || '0') + 1)
    d.updateTime = Date.now()
    return this.status(id)
  }

  discardDraft(id: string): DashboardStatusVO {
    const d = this.require(id)
    if (d.status === 'draft') throw new Error('nothing published to restore')
    this.store.copyPublishedToDraft(id)
    d.status = 'published'
    d.contentId = String(Number(d.contentId || '0') + 1)
    d.updateTime = Date.now()
    return this.status(id)
  }

  private require(id: string) {
    const d = this.store.dashboards.get(id)
    if (!d) throw new Error(`dashboard not found: ${id}`)
    return d
  }
}

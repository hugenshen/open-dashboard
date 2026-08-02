/**
 * Share / permission / export — Phase A commercial stubs.
 * Wire to real ACL + object storage in target product.
 */

import { globalStore, type InMemoryDashboardStore } from '../store/InMemoryDashboardStore'

export type ShareVisibility = 'public' | 'org'
export type SharePermission = 'view' | 'edit'

export interface ShareRecord {
  token: string
  dashboardId: string
  visibility: ShareVisibility
  permission: SharePermission
  url: string
  createdAt: number
}

export interface ExportRequest {
  format: 'csv' | 'png'
  chartId?: string
}

export interface ExportResult {
  format: string
  filename: string
  contentType: string
  /** csv body or data-url placeholder for png */
  payload: string
}

const shares = new Map<string, ShareRecord>()

export class DashboardShareManage {
  constructor(private readonly store: InMemoryDashboardStore = globalStore) {}

  createShare(
    dashboardId: string,
    visibility: ShareVisibility = 'org',
    permission: SharePermission = 'view'
  ): ShareRecord {
    const dash = this.store.dashboards.get(dashboardId)
    if (!dash) throw new Error(`dashboard not found: ${dashboardId}`)
    if (dash.status === 'draft') throw new Error('publish before sharing')
    const token = `sh_${dashboardId}_${Math.random().toString(36).slice(2, 10)}`
    const rec: ShareRecord = {
      token,
      dashboardId,
      visibility,
      permission,
      url: `/share/${token}`,
      createdAt: Date.now()
    }
    shares.set(token, rec)
    return rec
  }

  getByToken(token: string): ShareRecord {
    const rec = shares.get(token)
    if (!rec) throw new Error('share not found')
    return rec
  }

  listByDashboard(dashboardId: string): ShareRecord[] {
    return [...shares.values()].filter(s => s.dashboardId === dashboardId)
  }

  /** CSV export of aggregated chart rows (png left to frontend canvas). */
  exportCsv(dashboardId: string, chartId: string, rows: Array<Record<string, unknown>>): ExportResult {
    const dash = this.store.dashboards.get(dashboardId)
    if (!dash) throw new Error(`dashboard not found: ${dashboardId}`)
    const keys = rows.length ? Object.keys(rows[0]) : ['empty']
    const lines = [
      keys.join(','),
      ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))
    ]
    return {
      format: 'csv',
      filename: `${dash.name}-${chartId}.csv`,
      contentType: 'text/csv;charset=utf-8',
      payload: lines.join('\n')
    }
  }
}

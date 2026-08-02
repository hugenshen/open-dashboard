/**
 * Bridges frontend api/* to in-memory thin servers (local demo / tests).
 */
import { ChartQueryManage } from '../../backend/manage/ChartQueryManage'
import { DashboardCanvasManage } from '../../backend/manage/DashboardCanvasManage'
import { DashboardPublishManage } from '../../backend/manage/DashboardPublishManage'
import { DashboardTreeManage } from '../../backend/manage/DashboardTreeManage'
import {
  ChartQueryServer,
  DashboardCanvasServer,
  DashboardPublishServer,
  DashboardTreeServer
} from '../../backend/server/servers'
import { InMemoryDashboardStore } from '../../backend/store/InMemoryDashboardStore'
import type { HttpClient } from '../api/dashboard'
import { setDashboardHttpClient } from '../api/dashboard'
import type { ViewMode } from '../types/dashboard'

export function createInMemoryClient(store = new InMemoryDashboardStore()): {
  store: InMemoryDashboardStore
  http: HttpClient
} {
  const tree = new DashboardTreeServer(new DashboardTreeManage(store))
  const canvas = new DashboardCanvasServer(new DashboardCanvasManage(store))
  const publish = new DashboardPublishServer(new DashboardPublishManage(store))
  const query = new ChartQueryServer(new ChartQueryManage(store))

  const http: HttpClient = async ({ method, url, data, params }) => {
    const path = url.replace(/\?.*$/, '')

    if (path === '/dashboardTree/tree' && method === 'POST') return tree.tree(data as never)
    if (path === '/dashboardTree/create' && method === 'POST') return tree.create(data as never)
    if (path === '/dashboardTree/rename' && method === 'POST') return tree.rename(data as never)
    if (path === '/dashboardTree/move' && method === 'POST') return tree.move(data as never)
    if (path.startsWith('/dashboardTree/perDelete/') && method === 'POST') {
      return tree.perDelete(path.split('/').pop()!)
    }
    if (path.startsWith('/dashboardTree/delete/') && method === 'POST') {
      tree.delete(path.split('/').pop()!)
      return undefined as never
    }
    if (path.startsWith('/dashboardTree/barInfo/') && method === 'GET') {
      return tree.barInfo(path.split('/').pop()!)
    }

    const dashMatch = path.match(/^\/dashboard\/([^/]+)(?:\/(.*))?$/)
    if (dashMatch) {
      const id = dashMatch[1]
      const rest = dashMatch[2] || ''
      if (!rest && method === 'GET') {
        return canvas.get(id, (params?.view as ViewMode) || 'draft')
      }
      if (rest === 'layout' && method === 'PUT') return canvas.updateLayout(id, data as never)
      if (rest === 'components' && method === 'PUT') return canvas.updateComponents(id, data as never)
      if (rest.startsWith('charts/') && method === 'PUT') {
        const chartId = rest.slice('charts/'.length)
        return canvas.saveChart(id, chartId, data as never)
      }
      if (rest === 'linkages' && method === 'GET') {
        return canvas.getLinkages(id, (params?.view as ViewMode) || 'draft')
      }
      if (rest === 'linkages' && method === 'PUT') return canvas.putLinkages(id, data as never)
      if (rest === 'publish' && method === 'POST') return publish.publish(id)
      if (rest === 'discardDraft' && method === 'POST') return publish.discardDraft(id)
      if (rest === 'status' && method === 'GET') return publish.status(id)
    }

    if (path === '/chartQuery/query' && method === 'POST') return query.query(data as never)

    throw new Error(`unhandled ${method} ${url}`)
  }

  setDashboardHttpClient(http)
  return { store, http }
}

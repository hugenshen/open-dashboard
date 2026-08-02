/**
 * Vertical slice: tree → canvas → chart+dataset → filter → linkage → publish → preview query.
 * Run from repo root:
 *   npx --yes tsx dashboard-redesign/backend/demo/vertical-slice.ts
 */

import { ChartQueryManage } from '../manage/ChartQueryManage'
import { DashboardCanvasManage } from '../manage/DashboardCanvasManage'
import { DashboardPublishManage } from '../manage/DashboardPublishManage'
import { DashboardTreeManage } from '../manage/DashboardTreeManage'
import {
  ChartQueryServer,
  DashboardCanvasServer,
  DashboardPublishServer,
  DashboardTreeServer
} from '../server/servers'
import { InMemoryDashboardStore } from '../store/InMemoryDashboardStore'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function main() {
  const store = new InMemoryDashboardStore()
  const treeServer = new DashboardTreeServer(new DashboardTreeManage(store))
  const canvasServer = new DashboardCanvasServer(new DashboardCanvasManage(store))
  const publishServer = new DashboardPublishServer(new DashboardPublishManage(store))
  const queryServer = new ChartQueryServer(new ChartQueryManage(store))

  // 1) folder + empty dashboard
  const folder = treeServer.create({ pid: '0', name: '业务分析', nodeType: 'folder' })
  const dash = treeServer.create({
    pid: folder.id,
    name: '销售概览',
    nodeType: 'dashboard',
    layoutMode: 'grid'
  })
  assert(treeServer.tree({ busiFlag: 'dashboard' }).length === 1, 'tree root')
  assert(publishServer.status(dash.id).status === 'draft', 'starts as draft')

  // 2) layout + static text
  canvasServer.updateLayout(dash.id, {
    contentId: dash.contentId,
    themeRef: 'default',
    gridCols: 72
  })
  const textId = store.nextId('comp')
  canvasServer.updateComponents(dash.id, {
    contentId: '1',
    deleteIds: [],
    upsert: [
      {
        id: textId,
        type: 'text',
        x: 0,
        y: 0,
        w: 24,
        h: 4,
        zIndex: 1,
        props: { content: '销售概览' }
      }
    ]
  })

  // 3) chart bound to dataset
  const chartId = store.nextId('chart')
  const chartCompId = store.nextId('comp')
  canvasServer.saveChart(dash.id, chartId, {
    contentId: '1',
    datasetId: 'ds_sales',
    chartType: 'bar',
    title: '区域销售额',
    encode: { category: 'region', value: 'amount' }
  })
  canvasServer.updateComponents(dash.id, {
    contentId: '1',
    deleteIds: [],
    upsert: [
      {
        id: chartCompId,
        type: 'chart',
        chartViewId: chartId,
        x: 0,
        y: 4,
        w: 36,
        h: 16,
        zIndex: 2,
        props: {}
      }
    ]
  })

  // 4) filter
  const filterId = store.nextId('comp')
  canvasServer.updateComponents(dash.id, {
    contentId: '1',
    deleteIds: [],
    upsert: [
      {
        id: filterId,
        type: 'filter',
        x: 36,
        y: 4,
        w: 18,
        h: 4,
        zIndex: 3,
        props: { field: 'region', operator: 'eq' }
      }
    ]
  })

  // 5) second chart + linkage
  const chart2Id = store.nextId('chart')
  canvasServer.saveChart(dash.id, chart2Id, {
    contentId: '1',
    datasetId: 'ds_sales',
    chartType: 'bar',
    title: '产品明细',
    encode: { category: 'product', value: 'amount' }
  })
  canvasServer.putLinkages(dash.id, [
    {
      sourceChartId: chartId,
      sourceField: 'region',
      targetChartId: chart2Id,
      targetField: 'region',
      enabled: true
    }
  ])

  // 6) publish
  assert(publishServer.publish(dash.id).status === 'published', 'published')

  // 7) preview queries
  const resultAll = queryServer.query({
    dashboardId: dash.id,
    chartId,
    view: 'published',
    context: { filters: [], linkages: [] }
  })
  assert(resultAll.data.length === 3, `expect 3 regions, got ${resultAll.data.length}`)

  const resultFiltered = queryServer.query({
    dashboardId: dash.id,
    chartId,
    view: 'published',
    context: {
      filters: [{ componentId: filterId, field: 'region', operator: 'eq', value: '华东' }],
      linkages: []
    }
  })
  assert(resultFiltered.data.length === 1, 'filter to 华东')
  assert(resultFiltered.data[0][0] === '华东', '华东 label')
  assert(Number(resultFiltered.data[0][1]) === 200, '华东 amount 120+80')

  const resultLinked = queryServer.query({
    dashboardId: dash.id,
    chartId: chart2Id,
    view: 'published',
    context: {
      filters: [],
      linkages: [
        {
          sourceChartId: chartId,
          sourceField: 'region',
          value: '华南',
          targetChartId: chart2Id,
          targetField: 'region'
        }
      ]
    }
  })
  assert(resultLinked.data.length === 2, 'products in 华南')
  const sum = resultLinked.data.reduce((s, row) => s + Number(row[1]), 0)
  assert(sum === 200, '华南 A+B = 200')

  // dirty draft then discard
  const detail = canvasServer.get(dash.id, 'draft')
  canvasServer.updateLayout(dash.id, {
    contentId: detail.meta.contentId,
    themeRef: 'dark'
  })
  assert(publishServer.status(dash.id).status === 'publishedWithDraft', 'dirty after edit')
  publishServer.discardDraft(dash.id)
  assert(publishServer.status(dash.id).status === 'published', 'discard restores')
  assert(canvasServer.get(dash.id, 'draft').layout.themeRef !== 'dark', 'theme reverted')

  console.log('vertical-slice OK')
  console.log(
    JSON.stringify(
      {
        tree: treeServer.tree({ busiFlag: 'dashboard' }),
        barInfo: treeServer.barInfo(dash.id),
        status: publishServer.status(dash.id),
        sampleQuery: resultFiltered
      },
      null,
      2
    )
  )
}

main()

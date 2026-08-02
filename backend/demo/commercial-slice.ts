/**
 * Smoke test for Phase A share/export + Phase C explainSql stubs.
 * Run: npx tsx backend/demo/commercial-slice.ts
 */
import { ChartExplainManage, DashboardAlertManage } from '../manage/ChartExplainManage'
import { DashboardShareManage } from '../manage/DashboardShareManage'
import { DashboardTreeManage } from '../manage/DashboardTreeManage'
import { InMemoryDashboardStore } from '../store/InMemoryDashboardStore'

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m)
}

const store = new InMemoryDashboardStore()
const tree = new DashboardTreeManage(store)
const share = new DashboardShareManage(store)
const explain = new ChartExplainManage()
const alerts = new DashboardAlertManage()

const dash = tree.create({ pid: '0', name: '周报', nodeType: 'dashboard' })
try {
  share.createShare(dash.id)
  assert(false, 'should fail share on draft')
} catch {
  /* expected */
}

// simulate publish
const rec = store.dashboards.get(dash.id)!
rec.status = 'published'
const link = share.createShare(dash.id, 'org', 'view')
assert(link.url.startsWith('/share/'), 'share url')
assert(share.getByToken(link.token).dashboardId === dash.id, 'token resolve')

const csv = share.exportCsv(dash.id, 'chart_1', [
  { region: '华东', amount: 200 },
  { region: '华北', amount: 100 }
])
assert(csv.payload.includes('华东'), 'csv rows')

const sql = explain.explainSql({
  datasetId: 'ds_sales',
  chartType: 'bar',
  encode: { category: 'region', value: 'amount', agg: 'SUM' },
  filters: [{ field: 'region', operator: 'eq', value: '华东' }]
})
assert(sql.sql.includes('GROUP BY region'), 'sql group')

alerts.save(dash.id, [
  { id: 'a1', chartId: 'c1', metricField: 'amount', operator: 'lt', threshold: 300, enabled: true }
])
assert(alerts.evaluate(200, alerts.list(dash.id)[0]) === true, 'alert fire')
assert(alerts.evaluate(400, alerts.list(dash.id)[0]) === false, 'alert quiet')

console.log('commercial-slice OK', { link: link.url, sql: sql.sql.split('\n')[0] })

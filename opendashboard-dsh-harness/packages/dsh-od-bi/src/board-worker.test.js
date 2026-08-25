/**
 * P015 data_trans + board worker (get_data → save → commit) unit tests.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { transformRows } from './data-trans.js'
import { resetBoardSession } from './board-store.js'
import {
  callerDepth,
  runCommitBoard,
  runDataTrans,
  runGetData,
  runSaveChart,
  workerGuardReason,
} from './board-worker.js'

describe('transformRows', () => {
  const rows = [
    { Status: '成功', Amt: 80 },
    { Status: '失败', Amt: 20 },
  ]

  it('rate adds a share column that sums to 1', () => {
    const r = transformRows(rows, { transType: 'rate', measure: 'Amt' })
    assert.equal(r.ok, true)
    assert.equal(r.derivedColumn, 'Amt_rate')
    const sum = r.rows.reduce((a, x) => a + x.Amt_rate, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9)
  })

  it('rank is dense 1..n by measure desc', () => {
    const r = transformRows(rows, { transType: 'rank', measure: 'Amt' })
    assert.equal(r.rows.find((x) => x.Status === '成功').Amt_rank, 1)
    assert.equal(r.rows.find((x) => x.Status === '失败').Amt_rank, 2)
  })

  it('increase diffs a sorted series', () => {
    const r = transformRows(
      [{ d: '2024-01', v: 10 }, { d: '2024-02', v: 15 }],
      { transType: 'increase', column: 'd', measure: 'v' },
    )
    assert.equal(r.rows.length, 1)
    assert.equal(r.rows[0].v_increase, 5)
  })

  it('sub_avg is value minus mean', () => {
    const r = transformRows(rows, { transType: 'sub_avg', measure: 'Amt' })
    assert.equal(r.rows[0].Amt_sub_avg, 30)
    assert.equal(r.rows[1].Amt_sub_avg, -30)
  })
})

describe('worker depth guard', () => {
  it('denies Lead (depth 0) and allows worker (depth ≥1)', () => {
    const lead = workerGuardReason({ name: 'od_get_data', agent: { session: { header: { delegationDepth: 0 } } } })
    assert.match(lead, /od_board_worker/)
    const worker = workerGuardReason({
      name: 'od_get_data',
      agent: { session: { header: { delegationDepth: 1 } }, options: {} },
    })
    assert.equal(worker, undefined)
    assert.equal(callerDepth({ agent: { options: { subagentDepth: 1 }, session: { header: {} } } }), 1)
    assert.equal(workerGuardReason({ name: 'od_run_query' }), undefined)
  })
})

describe('runGetData / save / commit', () => {
  const fields = [
    { name: 'Status', label: '支付状态', role: 'dim' },
    { name: 'MchIncome', label: '商户入账,单位分', role: 'measure' },
  ]
  const session = resetBoardSession('test-board')

  it('fills suggestedChartType from rows; model cannot pass chartType', async () => {
    const got = await runGetData({
      datasetId: 'ds1',
      intent: 'compose',
      dim: 'Status',
      measure: 'Status',
      agg: 'count',
      question: '状态构成',
      title: '状态构成',
    }, {
      session,
      fields,
      queryFn: async () => ({
        ok: true,
        rowCount: 3,
        rows: [['成功', 1], ['失败', 2], ['处理中', 3]],
      }),
    })
    assert.equal(got.ok, true)
    assert.equal(got.suggestedChartType, 'pie')
    assert.equal(got.chartType, undefined)
    const saved = runSaveChart({ handle: got.handle }, { session })
    assert.equal(saved.ok, true)
    assert.equal(saved.chartType, 'pie')
  })

  it('drops empty tasks; remaining commit still writes', async () => {
    const s = resetBoardSession('test-board-2')
    const empty = await runGetData({
      datasetId: 'ds1',
      intent: 'compare',
      dim: 'Status',
      measure: 'MchIncome',
      agg: 'sum',
      question: '空',
    }, {
      session: s,
      fields,
      queryFn: async () => ({ ok: true, rowCount: 0, rows: [] }),
    })
    assert.equal(empty.suggestedChartType, null)
    const skip = runSaveChart({ handle: empty.handle }, { session: s })
    assert.equal(skip.ok, false)

    const kpi = await runGetData({
      datasetId: 'ds1',
      intent: 'kpi_sum',
      measure: 'MchIncome',
      question: '入账',
      title: '入账',
    }, { session: s, fields, queryFn: async () => ({ ok: true, rowCount: 1, rows: [[1]] }) })
    assert.equal(kpi.suggestedChartType, 'kpi')
    assert.equal(runSaveChart({ handle: kpi.handle, title: '入账' }, { session: s }).ok, true)

    const committed = await runCommitBoard({ title: 'T', datasetId: 'ds1' }, {
      session: s,
      loadProfile: false,
      applyDashboardPatch: async ({ title, patch }) => ({
        ok: true,
        dashboardId: 'd1',
        title,
        chartCount: (patch?.ops || []).filter((o) => o.op === 'upsert_chart').length,
        source: 'test',
      }),
    })
    assert.equal(committed.ok, true)
    assert.ok(committed.chartCount >= 1)
  })

  it('rank trans updates suggestedChartType to hbar', async () => {
    const s = resetBoardSession('test-board-3')
    const got = await runGetData({
      datasetId: 'ds1',
      intent: 'compare',
      dim: 'Status',
      measure: 'MchIncome',
      agg: 'sum',
      question: '排行预备',
    }, {
      session: s,
      fields,
      queryFn: async () => ({
        ok: true,
        rowCount: 2,
        rows: [{ Status: 'A', MchIncome: 9 }, { Status: 'B', MchIncome: 1 }],
      }),
    })
    const trans = runDataTrans({ handle: got.handle, transType: 'rank', measure: 'MchIncome' }, { session: s })
    assert.equal(trans.ok, true)
    assert.equal(trans.suggestedChartType, 'hbar')
  })
})

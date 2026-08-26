import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeInsights } from './insight.js'
import { renderReport } from './report-render.js'
import { consumePresentation, putFrame, resetBoardSession } from './board-store.js'
import { runGetData, runSaveChart, runCommitBoard, workerGuardReason } from './board-worker.js'
import { runInsight, runSaveInsight, runCommitReport } from './analysis-worker.js'
import { runAnalysisPython } from './analysis-python.js'
import { buildReportFollowup } from './commands.js'
import { reportPresentationMeta } from './answer-meta.js'

describe('computeInsights', () => {
  it('flags concentrated head share', () => {
    const items = computeInsights([
      { city: '上海', gmv: 80 },
      { city: '杭州', gmv: 15 },
      { city: '南京', gmv: 5 },
    ], { breakdown: 'city', measure: 'gmv' })
    const attr = items.find((x) => x.type === 'Attribution')
    assert.equal(attr.evidence.head, '上海')
    assert.ok(attr.evidence.share > 0.5)
    assert.equal(items.some((x) => x.type === 'Evenness'), false)
    assert.equal(items.some((x) => x.type === 'OutstandingLast'), false)
  })

  it('rejects PayOrderId-like detail dumps', () => {
    const items = computeInsights([
      { PayOrderId: 'a', amt: 1 },
      { PayOrderId: 'b', amt: 2 },
    ], { breakdown: 'PayOrderId', measure: 'amt' })
    assert.equal(items[0].type, 'rejected')
  })
})

describe('renderReport', () => {
  it('marks snapshot not dashboard', () => {
    const r = renderReport({
      title: '华东解读',
      insights: [{ items: [{ text: '上海最高' }] }],
      frames: [{ title: '城市 GMV', suggestedChartType: 'bar', rowCount: 2, rows: [{ city: '上海', gmv: 1 }, { city: '杭', gmv: 2 }] }],
    })
    assert.match(r.html, /非可刷新看板/)
    assert.match(r.markdown, /静态快照/)
    assert.match(r.html, /上海/)
    assert.match(r.html, /分析过程/)
  })
})

describe('/report followup (PR-ANR-01)', () => {
  it('shows a human request; protocol stays out of chat', () => {
    const text = buildReportFollowup('华东支付失败归因')
    assert.match(text, /写一份分析报告：华东支付失败归因/)
    assert.doesNotMatch(text, /ANALYSIS_REPORT=1/)
    assert.doesNotMatch(text, /od_board_worker/)
    assert.doesNotMatch(text, /od_get_data/)
    assert.doesNotMatch(text, /od_insight/)
  })
})

describe('analysis worker', () => {
  it('denies Lead on insight tools', () => {
    for (const name of ['od_python', 'od_insight', 'od_save_insight', 'od_commit_report']) {
      const lead = { name, agent: { session: { header: { delegationDepth: 0 } } } }
      assert.match(String(workerGuardReason(lead) || ''), /od_board_worker|delegationDepth/)
    }
  })

  it('ignores model chartType; harness fills suggestedChartType (PR-ANR-06)', async () => {
    const session = resetBoardSession('test-report-charttype')
    const got = await runGetData({
      datasetId: 'ds1',
      intent: 'compose',
      dim: 'Status',
      measure: 'Amt',
      agg: 'sum',
      question: '状态构成',
      purpose: 'analysis',
      chartType: 'pie',
      type: 'line',
    }, {
      session,
      fields: [
        { name: 'Status', label: '状态', role: 'dim' },
        { name: 'Amt', label: '金额', role: 'measure' },
      ],
      queryFn: async () => ({
        ok: true,
        rowCount: 3,
        rows: [{ Status: 'a', Amt: 1 }, { Status: 'b', Amt: 2 }, { Status: 'c', Amt: 3 }],
      }),
    })
    assert.equal(got.ok, true)
    assert.equal(got.chartType, undefined)
    assert.ok(got.suggestedChartType)
    assert.notEqual(got.suggestedChartType, 'line')
  })

  it('allows revised question/dim on same session (PR-ANR-07)', async () => {
    const session = resetBoardSession('test-report-retry')
    const fields = [
      { name: 'Status', label: '状态', role: 'dim' },
      { name: 'Channel', label: '渠道', role: 'dim' },
      { name: 'Amt', label: '金额', role: 'measure' },
    ]
    let calls = 0
    const queryFn = async (chart) => {
      calls += 1
      const dim = chart.encode?.category
      if (dim === 'Status') return { ok: true, rowCount: 0, rows: [] }
      return {
        ok: true,
        rowCount: 2,
        rows: [{ Channel: 'App', Amt: 9 }, { Channel: 'H5', Amt: 1 }],
      }
    }
    const empty = await runGetData({
      datasetId: 'ds1',
      intent: 'compose',
      dim: 'Status',
      measure: 'Amt',
      agg: 'sum',
      question: '按状态',
      purpose: 'analysis',
    }, { session, fields, queryFn })
    assert.equal(empty.rowCount, 0)
    assert.match(String(empty.note || ''), /revised question|different dim/i)

    const retry = await runGetData({
      datasetId: 'ds1',
      intent: 'compose',
      dim: 'Channel',
      measure: 'Amt',
      agg: 'sum',
      question: '改成按渠道看',
      purpose: 'analysis',
    }, { session, fields, queryFn })
    assert.equal(retry.ok, true)
    assert.equal(retry.rowCount, 2)
    assert.ok(retry.suggestedChartType)
    assert.equal(calls, 2)
    assert.equal(session.meta.purpose, 'analysis')
  })

  it('commits html/md without dashboardId; analysis fetch caps at 200/15s', async () => {
    const session = resetBoardSession('test-report')
    let seenLimit
    let seenTimeout
    const got = await runGetData({
      datasetId: 'ds1',
      intent: 'compose',
      dim: 'Status',
      measure: 'Amt',
      agg: 'sum',
      question: '状态构成',
      purpose: 'analysis',
    }, {
      session,
      fields: [
        { name: 'Status', label: '状态', role: 'dim' },
        { name: 'Amt', label: '金额', role: 'measure' },
      ],
      queryFn: async (chart, qopts) => {
        seenLimit = chart.encode.resultLimit
        seenTimeout = qopts.timeoutMs
        return {
          ok: true,
          rowCount: 2,
          rows: [{ Status: '成功', Amt: 80 }, { Status: '失败', Amt: 20 }],
        }
      },
    })
    assert.equal(got.ok, true)
    assert.equal(seenLimit, 200)
    assert.equal(seenTimeout, 15_000)
    assert.ok(got.suggestedChartType)
    assert.equal(got.chartType, undefined)

    assert.equal(runSaveChart({ handle: got.handle }, { session }).ok, false)
    assert.equal((await runCommitBoard({ title: 'x' }, { session, applyDashboardPatch: async () => ({ ok: true }) })).ok, false)

    const ins = runInsight({ handle: got.handle, analysisMethod: 'Attribution' }, { session })
    assert.equal(ins.ok, true)
    assert.ok((ins.insights || []).some((x) => x.type === 'Attribution'))
    const even = runInsight({ handle: got.handle, analysisMethod: 'Evenness' }, { session })
    assert.equal(even.ok, true)
    assert.equal((even.insights || []).length, 0)
    const saved = runSaveInsight({ handle: got.handle, title: '状态', process: 'Attribution 头部占比' }, { session })
    assert.equal(saved.ok, true)
    const report = runCommitReport({ title: '支付解读', summary: '成功状态占主导。' }, { session })
    assert.equal(report.ok, true)
    assert.equal(report.dashboardId, null)
    assert.match(report.html, /支付解读/)
    assert.match(report.html, /分析过程/)
    assert.match(report.html, /成功状态占主导/)
    assert.match(report.markdown, /静态快照/)
    const meta = reportPresentationMeta(report)
    assert.equal(meta.odKind, 'report_ready')
    assert.equal(meta.dashboardId, null)
    assert.ok(meta.html)
    assert.ok(meta.markdown)
    const lifted = consumePresentation(session.key)
    assert.equal(lifted.odKind, 'report_ready')
    assert.ok(lifted.html)
  })

  it('runs python on a cached frame when python3 exists', async () => {
    const session = resetBoardSession('test-report-python')
    putFrame(session, 'h1', {
      handle: 'h1',
      rowCount: 2,
      rows: [{ Status: '成功', Amt: 80 }, { Status: '失败', Amt: 20 }],
      chart: { encode: { category: 'Status', value: 'Amt' } },
    })
    const blocked = await runAnalysisPython({ handle: 'h1', code: 'import subprocess' }, { session })
    assert.equal(blocked.ok, false)
    const out = await runAnalysisPython({
      handle: 'h1',
      code: 'result = sum(r["Amt"] for r in rows)\nprint(result)',
    }, { session })
    if (!out.ok && /python3 unavailable/.test(String(out.error || ''))) return
    assert.equal(out.ok, true)
    assert.match(String(out.stdout || ''), /100/)
  })
})

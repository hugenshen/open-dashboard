import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeInsights } from './insight.js'
import { renderAuthoredReport, renderReport } from './report-render.js'
import { activeAnalysisSessionKey, consumePresentation, getBoardSession, putFrame, resetBoardSession } from './board-store.js'
import { runGetData, runSaveChart, runCommitBoard, workerGuardReason } from './board-worker.js'
import {
  runAnalysisPlan,
  runCommitReport,
  runCompleteAnalysisTask,
  executeReportCommit,
  runInsight,
  runReadAnalysisFiles,
  runSaveInsight,
  sessionForNewAnalysisPlan,
  validateAuthoredReportQuality,
} from './analysis-worker.js'
import { runAnalysisPython } from './analysis-python.js'
import { buildReportFollowup } from './commands.js'
import { reportPresentationMeta } from './answer-meta.js'
import { snapshotReportProgress } from './report-progress.js'
import { acquireReportTask, consumeReportBudget } from './report-execution.js'

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
    assert.match(r.html, /报告摘要/)
    assert.match(r.html, /核心发现/)
    assert.match(r.html, /结论与建议/)
    assert.match(r.markdown, /## 目录/)
    assert.ok(r.html.indexOf('报告摘要') < r.html.indexOf('分主题分析'))
    assert.ok(r.html.indexOf('分主题分析') < r.html.indexOf('附录：数据口径与证据'))
  })

  it('renders business labels, enum names and money units instead of label/value/raw codes', () => {
    const r = renderReport({
      title: '订单经营分析',
      frames: [{
        title: '支付状态结构',
        suggestedChartType: 'bar',
        rowCount: 3,
        chart: { encode: { category: 'Status', value: 'Amount' } },
        fields: [
          { name: 'Status', label: '支付状态,2-支付成功,3-业务处理完成' },
          { name: 'Amount', label: '支付金额,单位分' },
        ],
        rows: [[-1, 41501365020], [2, 642788387], [3, 160258431033]],
      }],
    })
    assert.match(r.html, /支付状态/)
    assert.match(r.html, /未定义状态（-1）/)
    assert.match(r.html, /支付成功/)
    assert.match(r.html, /支付金额/)
    assert.match(r.html, /亿元/)
    assert.doesNotMatch(r.html, />label</)
    assert.doesNotMatch(r.html, />value</)
    assert.doesNotMatch(r.html, />-1</)
  })

  it('orders default business sections as status amount, status count, then merchant rank', () => {
    const fields = [
      { name: 'MchId', label: '商户ID', role: 'id' },
      { name: 'Status', label: '支付状态,2-支付成功,3-业务处理完成', role: 'dim' },
      { name: 'Amount', label: '支付金额,单位分', role: 'measure' },
      { name: 'PayOrderId', label: '支付订单号', role: 'id' },
    ]
    const r = renderReport({ frames: [
      { title: 'Top 商户', chart: { encode: { category: 'MchId', value: 'Amount' } }, fields, rows: [['M1001', 8]], rowCount: 1 },
      { title: '状态订单量', chart: { encode: { category: 'Status', value: 'PayOrderId' } }, fields, rows: [[3, 8]], rowCount: 1 },
      { title: '状态支付金额', chart: { encode: { category: 'Status', value: 'Amount' } }, fields, rows: [[3, 800]], rowCount: 1 },
    ] })
    assert.ok(r.html.indexOf('状态支付金额') < r.html.indexOf('状态订单量'))
    assert.ok(r.html.indexOf('状态订单量') < r.html.indexOf('Top 商户'))
  })
})

it('rejects a numeric value bound to the wrong dimension row, including fen-to-yuan reports', () => {
  const files = [{ content: '# 状态金额\n\n## 业务知识\n\n本任务只分析支付状态，不分析商户。\n\n| Status | Amount |\n| --- | --- |\n| 3 | 1207000 |\n| 2 | 78500 |\n| -1 | 201000 |' }]
  const insights = [{
    chart: { encode: { category: 'Status', value: 'Amount', agg: 'sum' } },
    rows: [
      { Status: '3', Amount: 1207000 },
      { Status: '2', Amount: 78500 },
      { Status: '-1', Amount: 201000 },
    ],
  }]
  const report = (statusRows) => `# 支付状态报告

## 报告摘要

本报告基于一次支付状态金额聚合，金额从分换算为元，覆盖全部三个状态并保留可复核口径。

## 二、核心发现

${statusRows}

## 分主题分析

各状态贡献存在明显差异，应以聚合证据中的状态与金额逐行对应。

## 结论与建议

建议持续监控支付状态金额结构并核对未知状态。

## 附录：数据口径与证据

金额单位为元，原始 Amount 单位分。`
  const wrong = validateAuthoredReportQuality(report('- 状态 2 金额为 12070 元。\n- 状态 3 金额为 2010 元。\n- 状态 -1 金额为 785 元。'), files, insights)
  assert.equal(wrong.ok, false)
  assert.match(wrong.error, /dimension\/value evidence mismatch/)
  const correct = validateAuthoredReportQuality(report('- Status=3 金额为 12070 元。\n- Status=2 金额为 785 元。\n- Status=-1 金额为 2010 元。'), files, insights)
  assert.equal(correct.ok, true)
})

it('rejects wrong semantic status rows when runtime evidence uses label/value columns', () => {
  const files = [{ content: '# 状态金额\n\n| Status | Amount |\n| --- | --- |\n| 业务处理完成 | 1207000 |\n| 支付成功 | 78500 |\n| 未知/缺失 | 201000 |' }]
  const insights = [{
    chart: { encode: { category: 'Status', value: 'Amount', agg: 'sum' } },
    rows: [
      { label: '业务处理完成', value: 1207000 },
      { label: '支付成功', value: 78500 },
      { label: '未知/缺失', value: 201000 },
    ],
  }]
  const wrong = `# 支付状态报告

## 报告摘要

本报告按支付状态汇总金额，覆盖全部三种真实状态，并保留原始分口径和元换算口径。

## 二、核心发现

- 支付成功（Status=2）金额为 1207000 分。
- 业务处理完成（Status=3）金额为 201000 分。
- 未知/缺失（Status=-1）金额为 78500 分。

## 分主题分析

三个支付状态的金额结构存在明显差异，需逐行核对证据。

## 结论与建议

建议持续监控支付状态金额结构，并优先核对未知状态。

## 附录：数据口径与证据

Amount 原始单位为分，金额均来自 Status 分组汇总。`
  const result = validateAuthoredReportQuality(wrong, files, insights)
  assert.equal(result.ok, false)
  assert.match(result.error, /dimension\/value evidence mismatch/)
  assert.match(result.error, /Canonical evidence rows/)
  assert.match(result.error, /支付成功 → Amount=78500/)
})

describe('/report followup (PR-ANR-01)', () => {
  it('shows a human request; protocol stays out of chat', () => {
    const text = buildReportFollowup('华东支付失败归因')
    assert.match(text, /写一份分析报告（不是看板）：华东支付失败归因/)
    assert.doesNotMatch(text, /ANALYSIS_REPORT=1/)
    assert.doesNotMatch(text, /od_board_worker/)
    assert.doesNotMatch(text, /od_get_data/)
    assert.doesNotMatch(text, /od_insight/)
  })
})

describe('analysis worker', () => {
  it('starts a fresh progress run for each new analysis plan in the same session', () => {
    const session = resetBoardSession('test-report-progress-isolation')
    runAnalysisPlan({
      reportTitle: '旧报告',
      tasks: [{ title: '旧任务', task: '旧任务', businessKnowledge: '旧口径' }],
    }, { session })
    assert.match(snapshotReportProgress(session.key).title, /旧报告/)

    const next = resetBoardSession('test-report-progress-isolation')
    runAnalysisPlan({
      reportTitle: '新订单报告',
      tasks: [{ title: '订单质量', task: '分析订单质量', businessKnowledge: '新口径' }],
    }, { session: next })
    const snap = snapshotReportProgress(next.key)
    assert.equal(snap.title, '新订单报告')
    assert.deepEqual(snap.plan.stages, ['订单质量', '生成汇总报告'])
    assert.equal(snap.steps.length, 0)
    assert.doesNotMatch(snap.narrative, /旧报告|旧任务/)
  })

  it('denies Lead on insight tools', () => {
    for (const name of ['od_analysis_plan', 'od_python', 'od_insight', 'od_save_insight', 'od_complete_analysis_task', 'od_read_analysis_files', 'od_commit_report']) {
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

  it('commits html/md without dashboardId; analysis fetch obeys stricter row/time budgets', async () => {
    const session = resetBoardSession('test-report')
    session.meta.reportBudget = { maxRows: 50, queryTimeoutSeconds: 3 }
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
    assert.equal(seenLimit, 50)
    assert.equal(seenTimeout, 3_000)
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
    const report = runCommitReport({ title: '支付解读', markdown: '# 支付解读\n\n## 结论\n\n成功状态占主导。' }, { session })
    assert.equal(report.ok, true)
    assert.equal(report.dashboardId, null)
    assert.equal(report.evidence.length, 1)
    assert.equal(report.evidence[0].datasetId, 'ds1')
    assert.match(report.evidence[0].resultDigest, /^fnv1a-/)
    assert.equal(report.claims.length, 0)
    assert.match(report.html, /支付解读/)
    assert.match(report.html, /结论/)
    assert.match(report.html, /成功状态占主导/)
    assert.match(report.markdown, /静态快照/)
    const meta = reportPresentationMeta(report)
    assert.equal(meta.odKind, 'report_ready')
    assert.equal(meta.dashboardId, null)
    assert.ok(meta.html)
    assert.ok(meta.markdown)
    assert.equal(meta.evidence.length, 1)
    const lifted = consumePresentation(session.key)
    assert.equal(lifted.odKind, 'report_ready')
    assert.ok(lifted.html)
  })

  it('uses a dynamic plan and requires every data_analysis file before report_tool', async () => {
    const session = resetBoardSession('test-report-dynamic-plan')
    const planned = runAnalysisPlan({
      reportTitle: '订单履约分析',
      tasks: [
        { title: '履约状态', task: '分析履约状态差异', businessKnowledge: '已完成口径来自 schema 枚举' },
        { title: '商户差异', task: '分析商户分布', businessKnowledge: '商户只作分组维度' },
      ],
    }, { session })
    assert.equal(planned.taskCount, 2)
    const fields = [
      { name: 'MchId', label: '商户ID', role: 'id' },
      { name: 'Status', label: '支付状态,0-订单生成,2-支付成功', role: 'dim' },
      { name: 'Amount', label: '支付金额,单位分', role: 'measure' },
    ]
    const status = await runGetData({
      datasetId: 'orders', intent: 'compare', dim: 'Status', measure: 'Amount', agg: 'sum', purpose: 'analysis',
    }, {
      session,
      fields,
      queryFn: async () => ({ ok: true, rowCount: 2, rows: [[0, 2000], [2, 8000]] }),
    })
    assert.equal(runSaveInsight({ taskIndex: 0, handle: status.handle, insight: '支付成功金额占主导。' }, { session }).ok, true)
    const first = runCompleteAnalysisTask({ taskIndex: 0, summary: '履约状态存在明显差异。' }, { session })
    assert.equal(first.ok, true)
    assert.match(first.filename, /analysis-task-1/)
    assert.match(String(runCommitReport({ title: '订单报告', markdown: '# 订单报告' }, { session }).error || ''), /incomplete/)

    const merchant = await runGetData({
      datasetId: 'orders', intent: 'rank', dim: 'MchId', measure: 'Amount', agg: 'sum', purpose: 'analysis',
    }, {
      session,
      fields,
      queryFn: async () => ({ ok: true, rowCount: 6, rows: [
        ['M1001', 5000], ['M1002', 3000], ['M1003', 2000],
        ['M1004', 900], ['M1005', 700], ['M1006', 500],
      ] }),
    })
    assert.equal(runSaveInsight({
      taskIndex: 1, handle: merchant.handle,
      title: 'Top 商户支付金额',
      process: '按商户聚合并排序',
      insight: '商户 M1001 的支付金额最高。',
    }, { session }).ok, true)
    const second = runCompleteAnalysisTask({ taskIndex: 1, summary: '商户 M1001 金额最高。' }, { session })
    assert.equal(second.ok, true)
    const sourceFiles = runReadAnalysisFiles({}, { session })
    assert.equal(sourceFiles.ok, true)
    assert.equal(sourceFiles.fileCount, 2)
    assert.match(sourceFiles.files[1].content, /\| MchId \| Amount \|/)
    assert.match(sourceFiles.files[1].content, /\| M1001 \| 5000 \|/)
    const missingEntities = String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 报告摘要\n\n订单履约状态与商户经营贡献均存在明显差异，报告覆盖状态分布和商户排名，但暂未列出经营主体。\n\n## 核心发现\n\n支付成功金额占主导，头部商户贡献集中，需要在正文中补充实际商户标识及金额。\n\n## 分主题分析\n\n履约状态和商户差异都说明订单贡献集中，需要进一步复核。\n\n## 结论与建议\n\n建议优先查看头部商户贡献并持续跟踪。\n\n## 附录：数据口径与证据\n\n证据来自两个 data_analysis 文件，正文暂未逐项引用。',
    }, { session }).error || '')
    assert.match(missingEntities, /M1001, M1002, M1003/)
    assert.doesNotMatch(missingEntities, /example: Top/)
    assert.match(String(runCommitReport({ title: '订单报告' }, { session }).error || ''), /authored markdown/)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 结论\n\n支付成功金额占主导，但不展开商户证据。',
    }, { session }).error || ''), /too thin|chapters|lost business entities/)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 报告摘要\n\n订单履约状态与商户经营贡献均存在明显差异，报告已覆盖状态分布和商户排名两个主题，但这里没有展开具体金额证据。\n\n## 核心发现\n\n- 支付成功金额占主导。\n- 商户 M1001、商户 M1002、商户 M1003 都出现在经营主体排名中，但未给出各自金额。\n\n## 分主题分析\n\n履约状态和商户差异都说明订单贡献集中，需要进一步复核。\n\n## 结论与建议\n\n建议优先查看头部商户贡献。\n\n## 附录：数据口径与证据\n\n证据来自两个 data_analysis 文件。',
    }, { session }).error || ''), /numeric evidence|too generic/)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 报告说明与数据口径\n\n| 任务 | 证据文件 |\n| --- | --- |\n| task0 | task0.md |\n\n## 核心结论\n\n订单履约状态与商户经营贡献均存在明显差异，商户 M1001 金额最高，为 5000；商户 M1002 为 3000；商户 M1003 为 2000。\n\n## 结论与建议\n\n建议优先查看头部商户贡献。\n\n## 附录：数据口径与证据\n\n| MchId | Amount |\n| --- | --- |\n| M1001 | 5000 |\n| M1002 | 3000 |\n| M1003 | 2000 |',
    }, { session }).error || ''), /not user-readable|engineering evidence/)
    const report = runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 报告摘要\n\n订单履约状态与商户经营贡献均存在明显差异，以下结论完全来自两个 data_analysis 文件的聚合证据。\n\n## 核心发现\n\n- 支付成功金额占主导。状态 0 的支付金额为 20 元，状态 2 的支付金额为 80 元，说明已支付状态贡献了主要金额，需要继续结合状态口径解释业务完成情况。\n- 商户 M1001 金额最高，为 50 元；商户 M1002 为 30 元；商户 M1003 为 20 元。源数据只提供 MchId，没有商户名称字段，因此报告保留真实商户 ID，不改写成虚构名称。\n\n## 分主题分析\n\n### 履约状态\n\n状态金额切片显示支付成功金额占主导，业务处理完成状态也贡献主要体量。\n\n### 商户差异\n\n头部商户贡献差异明显，应继续追踪商户 M1001 的订单结构与支付成功率。\n\n## 结论与建议\n\n建议优先围绕头部商户与履约状态交叉复核，识别是否存在集中风险或运营机会。\n\n## 附录：数据口径与证据\n\n金额由源数据的分换算为元（100 分 = 1 元）。\n\n| MchId | Amount（元） |\n| --- | --- |\n| M1001 | 50 |\n| M1002 | 30 |\n| M1003 | 20 |',
    }, { session })
    assert.equal(report.ok, true)
    assert.match(report.markdown, /## 目录/)
    assert.match(report.html, /<table>/)
    assert.match(report.html, /商户 M1001/)
    assert.equal(report.analysisFiles.length, 2)
  })

  it('turns a budget-limited task into a disclosed partial report instead of deadlocking on the file guard', () => {
    const session = resetBoardSession('test-report-partial-budget')
    runAnalysisPlan({ reportTitle: '支付订单分析', tasks: [
      { title: '支付状态', task: '分析支付状态结构', businessKnowledge: '按状态聚合' },
      { title: '渠道与商户', task: '分析渠道和商户结构', businessKnowledge: '按渠道与商户聚合' },
    ], budget: { maxQueries: 16 } }, { session })
    putFrame(session, 'status-count', {
      handle: 'status-count', rowCount: 2,
      rows: [{ label: '业务处理完成', value: 80 }, { label: '支付成功', value: 20 }],
      fields: [
        { name: 'Status', label: '支付状态', role: 'dim' },
        { name: 'PayOrderId', label: '订单量', role: 'measure' },
      ],
      chart: { encode: { category: 'Status', value: 'PayOrderId' } }, suggestedChartType: 'bar',
    })
    assert.equal(runSaveInsight({
      taskIndex: 0, handle: 'status-count', title: '支付状态结构', insight: '业务处理完成订单量高于支付成功。',
    }, { session }).ok, true)
    assert.equal(runCompleteAnalysisTask({ taskIndex: 0, summary: '状态结构已完成。' }, { session }).ok, true)

    session.meta.analysisTaskIndex = 1
    for (let i = 0; i < 4; i += 1) assert.equal(consumeReportBudget(session, 'query').ok, true)
    const exhausted = consumeReportBudget(session, 'query')
    assert.match(exhausted.error, /REPORT_TASK_BUDGET_EXCEEDED/)

    const files = runReadAnalysisFiles({}, { session })
    assert.equal(files.ok, true)
    assert.equal(files.fileCount, 2)
    assert.equal(files.partial, true)
    assert.equal(files.files[1].limitationOnly, true)
    assert.match(files.files[1].content, /分析限制/)
    assert.equal(session.analysisPlan.tasks[1].status, 'skipped')

    const withoutDisclosure = runCommitReport({
      title: '支付订单分析',
      markdown: '# 支付订单分析\n\n## 报告摘要\n\n本报告根据已取得的支付状态聚合证据，对订单处理结构进行说明。\n\n## 核心发现\n\n业务处理完成订单量高于支付成功，当前证据只支持状态维度判断。\n\n## 分主题分析\n\n支付状态聚合显示不同状态之间存在结构差异，后续应结合业务口径持续观察。\n\n## 结论与建议\n\n建议运营团队核对状态流转，并将异常状态纳入日常监控。\n\n## 附录：数据口径与证据\n\n证据来自支付状态聚合结果。',
    }, { session })
    assert.match(String(withoutDisclosure.error || ''), /disclose unfinished budget-limited tasks/)

    const report = runCommitReport({
      title: '支付订单分析',
      markdown: '# 支付订单分析\n\n## 报告摘要\n\n本报告根据已取得的支付状态聚合证据，对订单处理结构进行说明；当前只能作为部分结果使用。\n\n## 核心发现\n\n业务处理完成订单量高于支付成功，当前证据只支持状态维度判断，不能据此推断渠道或商户表现。\n\n## 分主题分析\n\n支付状态聚合显示不同状态之间存在结构差异，后续应结合业务口径持续观察。\n\n## 结论与建议\n\n建议运营团队核对状态流转，并在补齐渠道与商户证据后再制定分渠道或分商户动作。\n\n## 分析限制\n\n渠道与商户任务达到单任务取数预算上限而未完成，本报告未覆盖渠道构成和商户明细，这会限制经营主体层面的判断。\n\n## 附录：数据口径与证据\n\n已完成证据来自支付状态聚合；未完成任务保留了预算限制说明。',
    }, { session })
    assert.equal(report.ok, true)
    assert.equal(report.analysisFiles.length, 2)
  })

  it('completes a task from aggregate evidence when no statistical insight passes the gate', () => {
    const session = resetBoardSession('test-report-evidence-only')
    runAnalysisPlan({ reportTitle: '状态证据报告', tasks: [
      { title: '支付状态', task: '核对支付状态', businessKnowledge: '按状态聚合' },
    ] }, { session })
    putFrame(session, 'status-evidence', {
      handle: 'status-evidence', taskIndex: 0, rowCount: 2,
      rows: [{ label: '支付成功', value: 2 }, { label: '业务处理完成', value: 6 }],
      fields: [
        { name: 'Status', label: '支付状态', role: 'dim' },
        { name: 'PayOrderId', label: '订单量', role: 'measure' },
      ],
      chart: { title: '支付状态订单量', encode: { category: 'Status', value: 'PayOrderId' } },
      suggestedChartType: 'bar',
    })
    const completed = runCompleteAnalysisTask({ taskIndex: 0, summary: '仅保留聚合证据，不输出显著性结论。' }, { session })
    assert.equal(completed.ok, true)
    assert.equal(completed.partial, undefined)
    assert.match(completed.file.content, /保留聚合证据/)
    assert.match(completed.file.content, /\| Status \| PayOrderId \|/)
    assert.equal(session.insights.length, 1)
  })

  it('auto-completes an evidence-backed task after the first gated method finds no significant insight', () => {
    const session = resetBoardSession('test-report-no-insight-loop')
    runAnalysisPlan({ reportTitle: '状态证据报告', tasks: [
      { title: '支付状态', task: '核对支付状态', businessKnowledge: '按状态聚合' },
      { title: '渠道结构', task: '核对渠道结构', businessKnowledge: '按渠道聚合' },
    ] }, { session })
    putFrame(session, 'status-no-insight', {
      handle: 'status-no-insight', taskIndex: 0, rowCount: 2,
      rows: [{ Status: '支付成功', Amount: 50 }, { Status: '业务处理完成', Amount: 50 }],
      fields: [
        { name: 'Status', label: '支付状态', role: 'dim' },
        { name: 'Amount', label: '支付金额', role: 'measure' },
      ],
      chart: { title: '支付状态金额', encode: { category: 'Status', value: 'Amount' } },
      suggestedChartType: 'bar',
    })
    const result = runInsight({ handle: 'value', analysisMethod: 'Evenness' }, { session })
    assert.equal(result.ok, true)
    assert.equal(result.handle, 'status-no-insight')
    assert.deepEqual(result.insights, [])
    assert.equal(result.taskCompleted, true)
    assert.match(result.analysisFile, /analysis-task-1/)
    assert.equal(session.analysisPlan.tasks[0].status, 'completed')
    assert.equal(session.meta.analysisTaskIndex, 1)
    assert.match(acquireReportTask(session, 0).error, /REPORT_TASK_ALREADY_COMPLETE/)
    const repeated = runCompleteAnalysisTask({ taskIndex: 0, summary: '重复调用不应报错。' }, { session })
    assert.equal(repeated.ok, true)
    assert.equal(repeated.alreadyComplete, true)
  })

  it('keeps plan, evidence and files after a repairable commit quality failure', async () => {
    const key = 'test-report-repair-retains-session'
    const session = resetBoardSession(key)
    runAnalysisPlan({ reportTitle: '支付报告', tasks: [
      { title: '支付状态', task: '核对支付状态', businessKnowledge: '按状态聚合' },
    ] }, { session })
    putFrame(session, 'repair-evidence', {
      handle: 'repair-evidence', taskIndex: 0, rowCount: 2,
      rows: [{ Status: '支付成功', Amount: 20 }, { Status: '业务处理完成', Amount: 80 }],
      fields: [
        { name: 'Status', label: '支付状态', role: 'dim' },
        { name: 'Amount', label: '支付金额', role: 'measure' },
      ],
      chart: { title: '支付状态金额', encode: { category: 'Status', value: 'Amount' } }, suggestedChartType: 'bar',
    })
    assert.equal(runCompleteAnalysisTask({ taskIndex: 0, summary: '状态证据。' }, { session }).ok, true)
    const failed = await executeReportCommit({ title: '支付报告', markdown: '# 支付报告' }, { session })
    assert.equal(failed.ok, false)
    const retained = getBoardSession(key)
    assert.equal(retained, session)
    assert.equal(retained.analysisPlan.tasks.length, 1)
    assert.equal(retained.analysisFiles.length, 1)
    assert.equal(retained.frames.size, 1)
    const validMarkdown = '# 支付报告\n\n## 报告摘要\n\n本报告基于支付状态金额聚合证据，覆盖支付成功和业务处理完成两个状态，保留真实金额与业务口径。\n\n## 二、核心发现\n\n- Status=支付成功的金额为 20。\n- Status=业务处理完成的金额为 80。\n\n## 分主题分析\n\n业务处理完成金额高于支付成功金额，后续需要持续观察状态结构。\n\n## 结论与建议\n\n建议按相同口径持续监控，并核对状态流转是否稳定。\n\n## 附录：数据口径与证据\n\n金额来自支付状态聚合结果。'
    const succeeded = await executeReportCommit({ title: '支付报告', markdown: validMarkdown }, { session })
    assert.equal(succeeded.ok, true)
    const repeated = await executeReportCommit({ title: '不应覆盖', markdown: '# 无效重复提交' }, { session })
    assert.equal(repeated.ok, true)
    assert.equal(repeated.alreadyCommitted, true)
    assert.equal(repeated.html, succeeded.html)
    assert.equal(getBoardSession(key), session)
  })

  it('starts a fresh task zero after a completed report in the same conversation', async () => {
    const key = 'test-sequential-reports-same-conversation'
    const first = resetBoardSession(key)
    runAnalysisPlan({ reportTitle: '第一份支付报告', tasks: [
      { title: '支付状态', task: '按状态汇总金额', businessKnowledge: 'Amount 单位为分' },
    ] }, { session: first })
    putFrame(first, 'first-status-amount', {
      handle: 'first-status-amount', taskIndex: 0, rowCount: 2,
      rows: [{ Status: '支付成功', Amount: 20 }, { Status: '业务处理完成', Amount: 80 }],
      fields: [
        { name: 'Status', label: '支付状态', role: 'dim' },
        { name: 'Amount', label: '支付金额，单位分', role: 'measure' },
      ],
      chart: { title: '支付状态金额', encode: { category: 'Status', value: 'Amount' } },
      suggestedChartType: 'bar',
    })
    runSaveInsight({ handle: 'first-status-amount', title: '支付状态金额', insight: '支付成功 20，业务处理完成 80。' }, { session: first })
    assert.equal(runCompleteAnalysisTask({ taskIndex: 0, summary: '按状态汇总支付金额。' }, { session: first }).ok, true)
    const markdown = '# 第一份支付报告\n\n## 报告摘要\n\n本报告基于支付状态金额聚合证据，覆盖支付成功和业务处理完成两个状态，保留真实金额与业务口径。\n\n## 二、核心发现\n\n- Status=支付成功的金额为 20。\n- Status=业务处理完成的金额为 80。\n\n## 分主题分析\n\n业务处理完成金额高于支付成功金额，后续需要持续观察状态结构。\n\n## 结论与建议\n\n建议按相同口径持续监控，并核对状态流转是否稳定。\n\n## 附录：数据口径与证据\n\n金额来自支付状态聚合结果。'
    const committed = await executeReportCommit({ title: '第一份支付报告', markdown }, { session: first })
    assert.equal(committed.ok, true)
    assert.equal(activeAnalysisSessionKey(), '')

    const second = sessionForNewAnalysisPlan(getBoardSession(key))
    assert.notEqual(second, first)
    const planned = runAnalysisPlan({ reportTitle: '第二份支付报告', tasks: [
      { title: '支付状态', task: '重新按状态汇总金额', businessKnowledge: 'Amount 单位为分' },
    ] }, { session: second })
    assert.equal(planned.ok, true)
    assert.equal(acquireReportTask(second, 0).ok, true)
    assert.equal(second.analysisPlan.tasks[0].status, 'in_progress')
  })

  it('does not auto-commit after three insights; report_tool authors the final content', () => {
    const session = resetBoardSession('test-report-no-auto-commit')
    runAnalysisPlan({ reportTitle: '订单报告', tasks: [
      { title: '动态任务', task: '依用户问题分析', businessKnowledge: '仅使用 schema 口径' },
    ] }, { session })
    const fields = [
      { name: 'MchId', label: '商户ID', role: 'id' },
      { name: 'Status', label: '支付状态,2-支付成功,3-业务处理完成', role: 'dim' },
      { name: 'Amount', label: '支付金额,单位分', role: 'measure' },
    ]
    putFrame(session, 'status-amount', {
      handle: 'status-amount', rowCount: 2, rows: [{ label: 2, value: 2000 }, { label: 3, value: 8000 }],
      fields, chart: { encode: { category: 'Status', value: 'Amount' } }, suggestedChartType: 'bar',
    })
    putFrame(session, 'status-count', {
      handle: 'status-count', rowCount: 2, rows: [{ label: 2, value: 20 }, { label: 3, value: 80 }],
      fields, chart: { encode: { category: 'Status', value: 'Status' } }, suggestedChartType: 'pie',
    })
    putFrame(session, 'merchant-amount', {
      handle: 'merchant-amount', rowCount: 2, rows: [{ label: 'M1001', value: 6000 }, { label: 'M1002', value: 4000 }],
      fields, chart: { encode: { category: 'MchId', value: 'Amount' } }, suggestedChartType: 'hbar',
    })
    assert.equal(runSaveInsight({ taskIndex: 0, handle: 'status-amount', insight: '业务处理完成金额占主导。' }, { session }).savedCount, 1)
    assert.equal(runSaveInsight({ taskIndex: 0, handle: 'status-count', insight: '业务处理完成订单数占主导。' }, { session }).savedCount, 2)
    const third = runSaveInsight({ taskIndex: 0, handle: 'merchant-amount', insight: '商户 M1001 金额最高。' }, { session })
    assert.equal(third.autoCommitted, undefined)
    assert.equal(consumePresentation(session.key), null)
    assert.equal(runCompleteAnalysisTask({ taskIndex: 0, summary: '三项证据已汇总。' }, { session }).ok, true)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 实际业务结论\n\n金额最高。',
    }, { session }).error || ''), /too thin|chapters|lost business entities/)
    const authored = '# 订单报告\n\n## 报告摘要\n\n该订单报告基于状态金额、状态订单量与商户金额三个聚合切片整理。业务处理完成状态在金额和订单数上均占主导：状态金额证据中业务处理完成为 8000、支付成功为 2000；状态订单量证据中业务处理完成为 80、支付成功为 20。商户 M1001 金额最高，为 6000；商户 M1002 为 4000。源数据只提供 MchId，没有商户名称字段，因此这里保留真实商户 ID，并把商户作为经营主体维度解读。\n\n## 二、核心发现\n\n- 业务处理完成状态在金额和订单数上均占主导，金额为 8000、订单量为 80。\n- 商户 M1001 是当前样本中的头部经营主体，金额为 6000。\n\n## 分主题分析\n\n状态和商户两个视角共同说明订单贡献集中，需要继续看支付状态与商户的交叉分布。\n\n## 结论与建议\n\n建议对商户 M1001 做进一步订单结构核查，并关注状态完成率是否稳定。\n\n## 附录：数据口径与证据\n\n| MchId | Amount |\n| --- | --- |\n| M1001 | 6000 |\n| M1002 | 4000 |'
    const report = runCommitReport({ title: '订单报告', markdown: authored }, { session })
    assert.match(report.markdown, /## 目录/)
    assert.match(report.markdown, /报告摘要/)
    assert.match(report.markdown, /结论与建议/)
    assert.match(report.markdown, /附录：数据口径与证据/)
    assert.match(report.html, /商户 M1001/)
    assert.equal(report.evidence.length, 3)
    assert.equal(report.claims.length, 2)
    assert.ok(report.claims.every((claim) => claim.evidenceRefs.length > 0 && claim.validationStatus === 'pass'))
    assert.ok(report.evidence.some((item) => item.metric === 'Amount' && item.unit === '分'))
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

  it('allows safe Python introspection helpers used by report analysis', async () => {
    const session = resetBoardSession('test-report-python-introspection')
    putFrame(session, 'h1', {
      handle: 'h1',
      rowCount: 1,
      rows: [{ Status: '成功', Amt: 80 }],
    })
    const out = await runAnalysisPython({
      handle: 'h1',
      code: 'print(hasattr(rows, "__len__"))\nprint(getattr(rows, "__class__", None).__name__)',
    }, { session })
    if (!out.ok && /python3 unavailable/.test(String(out.error || ''))) return
    assert.equal(out.ok, true)
    assert.match(String(out.stdout || ''), /True/)
    assert.match(String(out.stdout || ''), /list/)
  })
})

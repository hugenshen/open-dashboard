import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeInsights } from './insight.js'
import { renderAuthoredReport, renderReport } from './report-render.js'
import { consumePresentation, putFrame, resetBoardSession } from './board-store.js'
import { runGetData, runSaveChart, runCommitBoard, workerGuardReason } from './board-worker.js'
import {
  runAnalysisPlan,
  runCommitReport,
  runCompleteAnalysisTask,
  runInsight,
  runReadAnalysisFiles,
  runSaveInsight,
} from './analysis-worker.js'
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
      { title: 'Top 商户', chart: { encode: { category: 'MchId', value: 'Amount' } }, fields, rows: [[1001, 8]], rowCount: 1 },
      { title: '状态订单量', chart: { encode: { category: 'Status', value: 'PayOrderId' } }, fields, rows: [[3, 8]], rowCount: 1 },
      { title: '状态支付金额', chart: { encode: { category: 'Status', value: 'Amount' } }, fields, rows: [[3, 800]], rowCount: 1 },
    ] })
    assert.ok(r.html.indexOf('状态支付金额') < r.html.indexOf('状态订单量'))
    assert.ok(r.html.indexOf('状态订单量') < r.html.indexOf('Top 商户'))
  })
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
    const report = runCommitReport({ title: '支付解读', markdown: '# 支付解读\n\n## 结论\n\n成功状态占主导。' }, { session })
    assert.equal(report.ok, true)
    assert.equal(report.dashboardId, null)
    assert.match(report.html, /支付解读/)
    assert.match(report.html, /结论/)
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
      queryFn: async () => ({ ok: true, rowCount: 3, rows: [[1001, 5000], [1002, 3000], [1003, 2000]] }),
    })
    assert.equal(runSaveInsight({
      taskIndex: 1, handle: merchant.handle,
      title: 'Top 商户支付金额',
      process: '按商户聚合并排序',
      insight: '商户 1001 的支付金额最高。',
    }, { session }).ok, true)
    const second = runCompleteAnalysisTask({ taskIndex: 1, summary: '商户 1001 金额最高。' }, { session })
    assert.equal(second.ok, true)
    const sourceFiles = runReadAnalysisFiles({}, { session })
    assert.equal(sourceFiles.ok, true)
    assert.equal(sourceFiles.fileCount, 2)
    assert.match(sourceFiles.files[1].content, /\| MchId \| Amount \|/)
    assert.match(sourceFiles.files[1].content, /\| 1001 \| 5000 \|/)
    assert.match(String(runCommitReport({ title: '订单报告' }, { session }).error || ''), /authored markdown/)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 结论\n\n支付成功金额占主导，但不展开商户证据。',
    }, { session }).error || ''), /too thin|chapters|lost business entities/)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 报告摘要\n\n订单履约状态与商户经营贡献均存在明显差异，报告已覆盖状态分布和商户排名两个主题，但这里没有展开具体金额证据。\n\n## 核心发现\n\n- 支付成功金额占主导。\n- 商户 1001、商户 1002、商户 1003 都出现在经营主体排名中，但未给出各自金额。\n\n## 分主题分析\n\n履约状态和商户差异都说明订单贡献集中，需要进一步复核。\n\n## 结论与建议\n\n建议优先查看头部商户贡献。\n\n## 附录：数据口径与证据\n\n证据来自两个 data_analysis 文件。',
    }, { session }).error || ''), /numeric evidence|too generic/)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 报告说明与数据口径\n\n| 任务 | 证据文件 |\n| --- | --- |\n| task0 | task0.md |\n\n## 核心结论\n\n订单履约状态与商户经营贡献均存在明显差异，商户 1001 金额最高，为 5000；商户 1002 为 3000；商户 1003 为 2000。\n\n## 结论与建议\n\n建议优先查看头部商户贡献。\n\n## 附录：数据口径与证据\n\n| MchId | Amount |\n| --- | --- |\n| 1001 | 5000 |\n| 1002 | 3000 |\n| 1003 | 2000 |',
    }, { session }).error || ''), /not user-readable|engineering evidence/)
    const report = runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 报告摘要\n\n订单履约状态与商户经营贡献均存在明显差异，以下结论完全来自两个 data_analysis 文件的聚合证据。\n\n## 核心发现\n\n- 支付成功金额占主导。状态 0 的支付金额为 2000，状态 2 的支付金额为 8000，说明已支付状态贡献了主要金额，需要继续结合状态口径解释业务完成情况。\n- 商户 1001 金额最高，为 5000；商户 1002 为 3000；商户 1003 为 2000。源数据只提供 MchId，没有商户名称字段，因此报告保留真实商户 ID，不改写成虚构名称。\n\n## 分主题分析\n\n### 履约状态\n\n状态金额切片显示支付成功金额占主导，业务处理完成状态也贡献主要体量。\n\n### 商户差异\n\n头部商户贡献差异明显，应继续追踪商户 1001 的订单结构与支付成功率。\n\n## 结论与建议\n\n建议优先围绕头部商户与履约状态交叉复核，识别是否存在集中风险或运营机会。\n\n## 附录：数据口径与证据\n\n| MchId | Amount |\n| --- | --- |\n| 1001 | 5000 |\n| 1002 | 3000 |\n| 1003 | 2000 |',
    }, { session })
    assert.equal(report.ok, true)
    assert.match(report.markdown, /## 目录/)
    assert.match(report.html, /<table>/)
    assert.match(report.html, /商户 1001/)
    assert.equal(report.analysisFiles.length, 2)
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
      handle: 'merchant-amount', rowCount: 2, rows: [{ label: 1001, value: 6000 }, { label: 1002, value: 4000 }],
      fields, chart: { encode: { category: 'MchId', value: 'Amount' } }, suggestedChartType: 'hbar',
    })
    assert.equal(runSaveInsight({ taskIndex: 0, handle: 'status-amount', insight: '业务处理完成金额占主导。' }, { session }).savedCount, 1)
    assert.equal(runSaveInsight({ taskIndex: 0, handle: 'status-count', insight: '业务处理完成订单数占主导。' }, { session }).savedCount, 2)
    const third = runSaveInsight({ taskIndex: 0, handle: 'merchant-amount', insight: '商户 1001 金额最高。' }, { session })
    assert.equal(third.autoCommitted, undefined)
    assert.equal(consumePresentation(session.key), null)
    assert.equal(runCompleteAnalysisTask({ taskIndex: 0, summary: '三项证据已汇总。' }, { session }).ok, true)
    assert.match(String(runCommitReport({
      title: '订单报告',
      markdown: '# 订单报告\n\n## 实际业务结论\n\n金额最高。',
    }, { session }).error || ''), /too thin|chapters|lost business entities/)
    const authored = '# 订单报告\n\n## 报告摘要\n\n该订单报告基于状态金额、状态订单量与商户金额三个聚合切片整理。业务处理完成状态在金额和订单数上均占主导：状态金额证据中业务处理完成为 8000、支付成功为 2000；状态订单量证据中业务处理完成为 80、支付成功为 20。商户 1001 金额最高，为 6000；商户 1002 为 4000。源数据只提供 MchId，没有商户名称字段，因此这里保留真实商户 ID，并把商户作为经营主体维度解读。\n\n## 核心发现\n\n- 业务处理完成状态在金额和订单数上均占主导，金额为 8000、订单量为 80。\n- 商户 1001 是当前样本中的头部经营主体，金额为 6000。\n\n## 分主题分析\n\n状态和商户两个视角共同说明订单贡献集中，需要继续看支付状态与商户的交叉分布。\n\n## 结论与建议\n\n建议对商户 1001 做进一步订单结构核查，并关注状态完成率是否稳定。\n\n## 附录：数据口径与证据\n\n| MchId | Amount |\n| --- | --- |\n| 1001 | 6000 |\n| 1002 | 4000 |'
    const report = runCommitReport({ title: '订单报告', markdown: authored }, { session })
    assert.match(report.markdown, /## 目录/)
    assert.match(report.markdown, /报告摘要/)
    assert.match(report.markdown, /结论与建议/)
    assert.match(report.markdown, /附录：数据口径与证据/)
    assert.match(report.html, /商户 1001/)
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

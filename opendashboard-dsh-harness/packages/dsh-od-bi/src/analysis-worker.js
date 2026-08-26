/**
 * P016 analysis-report worker tools (JoyAgent AutoAnalysis analogue).
 * Lead must spawn od_board_worker with ANALYSIS_REPORT=1.
 * Worker: get_data → python/data_trans → insight(method) → save_insight → commit_report.
 * @module @opendashboard/dsh-od-bi/analysis-worker
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { reportPresentationMeta } from './answer-meta.js'
import { runAnalysisPython } from './analysis-python.js'
import { getBoardSession, getFrame, rememberPresentation, resetBoardSession, boardSessionKey } from './board-store.js'
import { toLosslessJson } from './http.js'
import { computeInsights, insightNote, looksLikeDetailDump, normalizeInsightMethod, INSIGHT_METHODS } from './insight.js'
import { renderReport } from './report-render.js'

export const ANALYSIS_TOOL_NAMES = Object.freeze([
  'od_python',
  'od_insight',
  'od_save_insight',
  'od_commit_report',
])

function sessionOf(opts) {
  return opts.session || getBoardSession()
}

function ensureInsights(session) {
  if (!Array.isArray(session.insights)) session.insights = []
  return session.insights
}

function insightOpts(args, frame) {
  return {
    breakdown: args.breakdown || frame.chart?.encode?.category,
    measure: args.measure || frame.chart?.encode?.value,
    analysisMethod: args.analysisMethod || args.analysis_method,
    isSeries: args.isSeries,
  }
}

function usableInsights(items) {
  return (Array.isArray(items) ? items : []).filter((it) => it && it.type !== 'rejected' && it.type !== 'sparse' && it.text)
}

export function runInsight(args, opts = {}) {
  const session = sessionOf(opts)
  const handle = String(args.handle || '')
  const frame = getFrame(session, handle)
  if (!frame) return { ok: false, error: 'unknown handle — call od_get_data first' }
  const method = normalizeInsightMethod(args.analysisMethod || args.analysis_method)
  if ((args.analysisMethod || args.analysis_method) && !method) {
    return { ok: false, error: `analysis_method must be one of ${INSIGHT_METHODS.join('|')}` }
  }
  if (looksLikeDetailDump(frame.rows, args.breakdown || frame.chart?.encode?.category)) {
    return {
      ok: false,
      error: '明细/高基数 ID 不能做洞察 — 换状态、渠道、类型等分类维再 od_get_data',
    }
  }
  const items = computeInsights(frame.rows, insightOpts(args, frame))
  const useful = usableInsights(items)
  return toLosslessJson({
    ok: true,
    handle,
    analysisMethod: method || null,
    rowCount: frame.rowCount || 0,
    suggestedChartType: frame.suggestedChartType || null,
    insights: useful,
    note: insightNote(useful, method),
  })
}

export function runSaveInsight(args, opts = {}) {
  const session = sessionOf(opts)
  const handle = String(args.handle || '')
  const frame = getFrame(session, handle)
  if (!frame) return { ok: false, error: 'unknown handle — call od_get_data first' }
  if (!frame.rowCount) {
    return { ok: false, error: 'empty result cannot be saved — retry od_get_data with another dim' }
  }
  if (looksLikeDetailDump(frame.rows, args.breakdown || frame.chart?.encode?.category)) {
    return { ok: false, error: '明细切片不能保存 — 换分类维再取数' }
  }
  const computed = usableInsights(computeInsights(frame.rows, insightOpts(args, frame)))
  let items = computed
  if (typeof args.insight === 'string' && args.insight.trim()) {
    items = args.insight.split('<sep>').map((text) => ({ type: 'narrative', text: text.trim(), score: 1 }))
      .filter((it) => it.text && !/无分析结论/.test(it.text))
  } else if (Array.isArray(args.insights) && args.insights.length) {
    items = args.insights
  }
  if (!items.length) {
    return { ok: false, error: '无分析结论 — 不要保存；换维、换 analysis_method 或先 od_python' }
  }
  const block = {
    handle,
    title: String(args.title || frame.chart?.title || frame.chart?.question || handle),
    process: String(args.process || args.analysisProcess || args.analysis_process || ''),
    suggestedChartType: frame.suggestedChartType || null,
    rowCount: frame.rowCount,
    rows: Array.isArray(frame.rows) ? frame.rows.slice(0, 20) : [],
    items,
  }
  ensureInsights(session).push(block)
  session.meta.purpose = 'analysis'
  return toLosslessJson({
    ok: true,
    handle,
    savedCount: session.insights.length,
    suggestedChartType: block.suggestedChartType,
    title: block.title,
    note: 'Saved snapshot insight. Continue other questions / methods, then od_commit_report once.',
  })
}

export function runCommitReport(args, opts = {}) {
  const session = sessionOf(opts)
  const insights = ensureInsights(session)
  if (!insights.length) {
    return { ok: false, error: 'no insights saved — od_get_data then od_save_insight at least once' }
  }
  const title = String(args.title || session.meta.title || session.meta.message || '分析报告')
  const format = String(args.format || 'html').toLowerCase() === 'markdown' ? 'markdown' : 'html'
  const rendered = renderReport({
    title,
    summary: String(args.summary || args.answer || ''),
    insights,
    frames: insights.map((b) => ({
      handle: b.handle,
      title: b.title,
      process: b.process,
      suggestedChartType: b.suggestedChartType,
      rowCount: b.rowCount,
      rows: b.rows,
    })),
  })
  const filename = String(args.filename || (format === 'markdown' ? 'analysis-report.md' : 'analysis-report.html'))
  const result = toLosslessJson({
    ok: true,
    title: rendered.title,
    format,
    filename,
    html: rendered.html,
    markdown: rendered.markdown,
    insightCount: insights.length,
    dashboardId: null,
    source: 'analysis-worker',
    note: 'Static snapshot report. Not a refreshable dashboard.',
  })
  const meta = reportPresentationMeta(result)
  rememberPresentation(meta, session.key)
  const liveKey = boardSessionKey()
  if (liveKey !== session.key) rememberPresentation(meta, liveKey)
  resetBoardSession(session.key)
  return result
}

function toolMeta(name) {
  return {
    presentCall: (args) => ({
      card: 'generic',
      title: `${name} · ${args.title || args.handle || args.datasetId || args.analysisMethod || ''}`,
      kind: name === 'od_commit_report' ? 'write' : 'search',
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: name,
      content: result.content,
    }),
  }
}

export function registerAnalysisWorkerTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'od_python',
    description:
      'ANALYSIS WORKER ONLY. Run Python on cached od_get_data frames (JoyAgent interpreter). '
      + 'pandas/numpy/scipy/sklearn/statsmodels if installed; df is the handle table. '
      + 'Do not invent DataFrames. Do not conclude from df.head() when rowCount>5. '
      + 'Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', description: 'get_data handle; omit to expose all frames' },
      code: { type: 'string', required: true, description: 'Python. Use df / rows / print. Set result= for a return value.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `python ok${value.handle ? ` ${value.handle}` : ''}${value.stdout ? `\n${value.stdout}` : ''}`
          : `python failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_python'),
    async execute(args) {
      return toLosslessJson(await runAnalysisPython(args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_insight',
    description:
      'ANALYSIS WORKER ONLY. Run one JoyAgent insight method on a get_data handle. '
      + `analysis_method: ${INSIGHT_METHODS.join(' | ')}. `
      + 'Omit method to scan all gated methods. Empty insights mean 无分析结论 — do not save. '
      + 'Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', required: true },
      analysisMethod: { type: 'string', description: INSIGHT_METHODS.join('|') },
      breakdown: { type: 'string' },
      measure: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `insight ${value.handle}${value.analysisMethod ? `/${value.analysisMethod}` : ''}: ${(value.insights || []).length} items → ${value.suggestedChartType || 'none'}${value.note ? `\n${value.note}` : ''}`
          : `insight failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_insight'),
    execute(args) {
      return toLosslessJson(runInsight(args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_save_insight',
    description:
      'ANALYSIS WORKER ONLY. Stage a useful conclusion + snapshot rows. Not a dashboard chart. '
      + 'Do not save 无分析结论. Multiple conclusions = multiple calls. Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', required: true },
      title: { type: 'string' },
      process: { type: 'string', description: 'Short analysis process note' },
      insight: { type: 'string', description: 'Agent-written conclusion(s); split multiple with <sep>' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `saved insight ${value.title} (${value.savedCount} staged)`
          : `save_insight failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_save_insight'),
    execute(args) {
      return toLosslessJson(runSaveInsight(args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_commit_report',
    description:
      'ANALYSIS WORKER ONLY. Render a static HTML/Markdown snapshot report (not a dashboard). '
      + 'Call once after save_insight. summary = 中文结论，禁止代码. Conversation lead must not call this.',
    parameters: {
      title: { type: 'string' },
      summary: { type: 'string', description: 'Final Chinese markdown summary of all insights' },
      format: { type: 'string', description: 'html | markdown' },
      filename: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `report ready: ${value.filename} (${value.insightCount} insights)`
          : `commit_report failed: ${value.error || 'unknown'}`,
      }],
      presentationMeta(_args, value) {
        return reportPresentationMeta(value)
      },
    },
    ...toolMeta('od_commit_report'),
    execute(args) {
      return toLosslessJson(runCommitReport(args))
    },
  }))
}

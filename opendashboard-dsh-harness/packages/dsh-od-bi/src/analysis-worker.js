/**
 * P016 analysis-report worker tools (JoyAgent get_data → data_trans → insight → save_insight).
 * Same depth guard as board worker; Lead must spawn od_board_worker with ANALYSIS_REPORT=1.
 * @module @opendashboard/dsh-od-bi/analysis-worker
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { reportPresentationMeta } from './answer-meta.js'
import { getBoardSession, getFrame, resetBoardSession } from './board-store.js'
import { toLosslessJson } from './http.js'
import { computeInsights } from './insight.js'
import { renderReport } from './report-render.js'

export const ANALYSIS_TOOL_NAMES = Object.freeze([
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

export function runInsight(args, opts = {}) {
  const session = sessionOf(opts)
  const handle = String(args.handle || '')
  const frame = getFrame(session, handle)
  if (!frame) return { ok: false, error: 'unknown handle — call od_get_data first' }
  const items = computeInsights(frame.rows, {
    breakdown: args.breakdown || frame.chart?.encode?.category,
    measure: args.measure || frame.chart?.encode?.value,
  })
  return toLosslessJson({
    ok: true,
    handle,
    rowCount: frame.rowCount || 0,
    suggestedChartType: frame.suggestedChartType || null,
    insights: items,
    note: 'Insights are deterministic. Next: od_save_insight, or od_get_data again with a revised question/dim.',
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
  const computed = computeInsights(frame.rows, {
    breakdown: args.breakdown || frame.chart?.encode?.category,
    measure: args.measure || frame.chart?.encode?.value,
  })
  const items = Array.isArray(args.insights) && args.insights.length ? args.insights : computed
  const block = {
    handle,
    title: String(args.title || frame.chart?.title || frame.chart?.question || handle),
    process: String(args.process || args.analysisProcess || ''),
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
    note: 'Saved snapshot insight. Continue other questions, then od_commit_report once.',
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
    insights,
    frames: insights.map((b) => ({
      handle: b.handle,
      title: b.title,
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
  resetBoardSession(session.key)
  return result
}

function toolMeta(name) {
  return {
    presentCall: (args) => ({
      card: 'generic',
      title: `${name} · ${args.title || args.handle || args.datasetId || ''}`,
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
    name: 'od_insight',
    description:
      'ANALYSIS WORKER ONLY. Compute deterministic insights on a get_data handle. '
      + 'Do not pick chart types. Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', required: true },
      breakdown: { type: 'string' },
      measure: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `insight ${value.handle}: ${(value.insights || []).length} items → ${value.suggestedChartType || 'none'}`
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
      'ANALYSIS WORKER ONLY. Stage insights + snapshot rows for the report. Not a dashboard chart. '
      + 'Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', required: true },
      title: { type: 'string' },
      process: { type: 'string', description: 'Short analysis process note' },
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
      + 'Call once after save_insight. Conversation lead must not call this.',
    parameters: {
      title: { type: 'string' },
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

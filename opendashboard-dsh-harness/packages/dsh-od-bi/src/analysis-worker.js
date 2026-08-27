/**
 * P016 analysis-report worker tools (JoyAgent AutoAnalysis analogue).
 * Lead must spawn od_board_worker with ANALYSIS_REPORT=1.
 * Worker: get_data → python/data_trans → insight(method) → save_insight → commit_report.
 * @module @opendashboard/dsh-od-bi/analysis-worker
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { reportPresentationMeta } from './answer-meta.js'
import { runAnalysisPython } from './analysis-python.js'
import { activateAnalysisSession, getBoardSession, getFrame, rememberPresentation, resetBoardSession, boardSessionKey } from './board-store.js'
import { toLosslessJson } from './http.js'
import { computeInsights, insightNote, looksLikeDetailDump, normalizeInsightMethod, INSIGHT_METHODS } from './insight.js'
import { renderAuthoredReport, renderReport } from './report-render.js'
import {
  completeAnalysisPlanTask,
  setAnalysisPlan,
  trackAnalysisTool,
} from './report-progress.js'
import { fname, isEntitySubjectDim, parseValueMapFromLabel } from './gen-board.js'

export const ANALYSIS_TOOL_NAMES = Object.freeze([
  'od_analysis_plan',
  'od_python',
  'od_insight',
  'od_save_insight',
  'od_complete_analysis_task',
  'od_read_analysis_files',
  'od_commit_report',
])

function sessionOf(opts) {
  return opts.session || getBoardSession()
}

function planRequired(session = getBoardSession()) {
  return session.analysisPlan ? null : { ok: false, error: 'JoyAgent workflow requires od_get_schema then od_analysis_plan first.' }
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

function frameCategoryField(frame, breakdown) {
  const category = String(breakdown || frame?.chart?.encode?.category || '')
  return (Array.isArray(frame?.fields) ? frame.fields : []).find((f) => fname(f) === category)
}

function isEntityAggregate(frame, breakdown) {
  const category = String(breakdown || frame?.chart?.encode?.category || '')
  const value = String(frame?.chart?.encode?.value || '')
  return Boolean(category && category !== value && isEntitySubjectDim(frameCategoryField(frame, category)))
}

function semanticRows(frame) {
  const category = String(frame?.chart?.encode?.category || '')
  const value = String(frame?.chart?.encode?.value || '')
  const categoryField = frameCategoryField(frame, category)
  const valueMap = categoryField?.valueMap || parseValueMapFromLabel(categoryField?.label)
  return (Array.isArray(frame?.rows) ? frame.rows : []).map((row) => {
    const rawCategory = Array.isArray(row) ? row[0]
      : row && typeof row === 'object' ? (row[category] ?? row.label) : row
    const rawValue = Array.isArray(row) ? row[1]
      : row && typeof row === 'object' ? (row[value] ?? row.value) : undefined
    return {
      [category || 'label']: valueMap?.[String(rawCategory)]
        ?? (valueMap && Object.keys(valueMap).length ? `未定义状态（${String(rawCategory)}）` : rawCategory),
      [value || 'value']: rawValue,
    }
  })
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
  if (!isEntityAggregate(frame, args.breakdown) && looksLikeDetailDump(frame.rows, args.breakdown || frame.chart?.encode?.category)) {
    return {
      ok: false,
      error: '明细/高基数 ID 不能做洞察 — 换状态、渠道、类型等分类维再 od_get_data',
    }
  }
  const items = computeInsights(semanticRows(frame), insightOpts(args, frame))
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
  if (!isEntityAggregate(frame, args.breakdown) && looksLikeDetailDump(frame.rows, args.breakdown || frame.chart?.encode?.category)) {
    return { ok: false, error: '明细切片不能保存 — 换分类维再取数' }
  }
  const computed = usableInsights(computeInsights(semanticRows(frame), insightOpts(args, frame)))
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
    taskIndex: Number.isFinite(Number(args.taskIndex)) ? Number(args.taskIndex) : Number(session.meta.analysisTaskIndex || 0),
    handle,
    title: String(args.title || frame.chart?.title || frame.chart?.question || handle),
    process: String(args.process || args.analysisProcess || args.analysis_process || ''),
    suggestedChartType: frame.suggestedChartType || null,
    rowCount: frame.rowCount,
    rows: semanticRows(frame).slice(0, 20),
    chart: frame.chart,
    fields: frame.fields,
    items,
  }
  ensureInsights(session).push(block)
  session.meta.purpose = 'analysis'
  const saved = {
    ok: true,
    handle,
    savedCount: session.insights.length,
    suggestedChartType: block.suggestedChartType,
    title: block.title,
    note: 'Saved snapshot insight. Continue other questions / methods, then od_commit_report once.',
  }
  return toLosslessJson(saved)
}

function normalizeTasks(input) {
  const raw = Array.isArray(input) ? input : []
  return raw.map((task, index) => ({
    id: String(task?.id || `analysis-${index + 1}`),
    title: String(task?.title || task?.task || `分析任务 ${index + 1}`),
    task: String(task?.task || task?.title || `分析任务 ${index + 1}`),
    businessKnowledge: String(task?.businessKnowledge || task?.business_knowledge || ''),
    status: index === 0 ? 'in_progress' : 'not_started',
  }))
}

export function runAnalysisPlan(args, opts = {}) {
  const session = opts.session || resetBoardSession(boardSessionKey())
  activateAnalysisSession(session.key)
  if (session.analysisPlan?.tasks?.length) return { ok: false, error: 'od_analysis_plan may only be called once per report run' }
  const tasks = normalizeTasks(args.tasks)
  if (!tasks.length) return { ok: false, error: 'tasks must contain at least one analysis subtask' }
  session.analysisPlan = {
    title: String(args.reportTitle || args.title || '分析报告'),
    tasks,
  }
  session.analysisFiles = []
  session.insights = []
  session.meta.purpose = 'analysis'
  session.meta.analysisTaskIndex = 0
  const progress = setAnalysisPlan({
    reportTitle: session.analysisPlan.title,
    tasks,
  }, { key: session.key })
  return toLosslessJson({
    ok: true,
    reportTitle: session.analysisPlan.title,
    taskCount: tasks.length,
    tasks: tasks.map(({ id, title, task, businessKnowledge }) => ({ id, title, task, businessKnowledge })),
    note: 'Plan created. Execute each data_analysis task in order, then generate one task file.',
    progress,
  })
}

function markdownEvidenceTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return '无可展示的结构化证据行。'
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))]
  if (!columns.length) return '无可展示的结构化证据行。'
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  return [
    `| ${columns.map(escape).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => escape(row?.[column])).join(' | ')} |`),
  ].join('\n')
}

function taskFileMarkdown(task, blocks, summary) {
  const sections = blocks.map((block) => {
    const findings = (block.items || []).map((item) => `- ${item.text}`).join('\n') || '- 无可保存结论'
    const rows = Array.isArray(block.rows) ? block.rows : []
    return `## ${block.title}\n\n分析方法：${block.process || '聚合描述与显著性检查'}\n\n数据快照：查询返回 ${block.rowCount || rows.length} 行；以下保留最多 20 行真实聚合证据。\n\n${markdownEvidenceTable(rows)}\n\n### 基于证据的结论\n\n${findings}`
  }).join('\n\n')
  return `# ${task.title}\n\n## 任务\n\n${task.task}\n\n## 业务知识\n\n${task.businessKnowledge || '未提供额外业务知识，仅依据 schema 与聚合结果。'}\n\n${sections}\n\n## 子任务总结\n\n${String(summary || '').trim() || blocks.flatMap((block) => block.items || []).map((item) => item.text).filter(Boolean).join('\n')}`
}

/** JoyAgent report_tool downloads every product file before invoking its report model. */
export function runReadAnalysisFiles(_args = {}, opts = {}) {
  const session = sessionOf(opts)
  const plan = session.analysisPlan
  if (!plan?.tasks?.length) return { ok: false, error: 'call od_analysis_plan first' }
  if (session.analysisFiles.length < plan.tasks.length) {
    return { ok: false, error: `analysis task files incomplete (${session.analysisFiles.length}/${plan.tasks.length})` }
  }
  return toLosslessJson({
    ok: true,
    reportTitle: plan.title,
    fileCount: session.analysisFiles.length,
    files: session.analysisFiles.map((file) => ({
      fileName: file.name,
      description: file.name,
      content: file.content,
    })),
  })
}

export function runCompleteAnalysisTask(args, opts = {}) {
  const session = sessionOf(opts)
  const plan = session.analysisPlan
  if (!plan?.tasks?.length) return { ok: false, error: 'call od_analysis_plan first' }
  const index = Number.isFinite(Number(args.taskIndex)) ? Number(args.taskIndex) : Number(session.meta.analysisTaskIndex || 0)
  const task = plan.tasks[index]
  if (!task) return { ok: false, error: `unknown taskIndex ${index}` }
  if (index !== Number(session.meta.analysisTaskIndex || 0)) {
    return { ok: false, error: `complete task ${session.meta.analysisTaskIndex || 0} before task ${index}` }
  }
  const blocks = ensureInsights(session).filter((block) => Number(block.taskIndex || 0) === index)
  if (!blocks.length) return { ok: false, error: 'this analysis task has no saved insight' }
  const content = taskFileMarkdown(task, blocks, args.summary)
  const filename = String(args.filename || `analysis-task-${index + 1}.md`)
  const file = { name: filename, type: 'markdown', content, size: Buffer.byteLength(content, 'utf8') }
  session.analysisFiles.push(file)
  task.status = 'completed'
  const next = plan.tasks[index + 1]
  if (next) next.status = 'in_progress'
  session.meta.analysisTaskIndex = index + 1
  completeAnalysisPlanTask(index, file, { key: session.key })
  return toLosslessJson({
    ok: true,
    taskIndex: index,
    title: task.title,
    filename,
    file,
    completedCount: session.analysisFiles.length,
    totalTasks: plan.tasks.length,
    note: next ? `Continue task ${index + 1}: ${next.title}` : 'All analysis task files are ready. Call od_commit_report with the authored final markdown.',
  })
}

export function runCommitReport(args, opts = {}) {
  const session = sessionOf(opts)
  const insights = ensureInsights(session)
  if (!insights.length) {
    return { ok: false, error: 'no insights saved — od_get_data then od_save_insight at least once' }
  }
  const plan = session.analysisPlan
  if (plan?.tasks?.length && session.analysisFiles.length < plan.tasks.length) {
    return { ok: false, error: `analysis task files incomplete (${session.analysisFiles.length}/${plan.tasks.length})` }
  }
  const title = String(args.title || session.meta.title || session.meta.message || '分析报告')
  const format = String(args.format || 'html').toLowerCase() === 'markdown' ? 'markdown' : 'html'
  const authored = String(args.markdown || args.content || '').trim()
  if (plan?.tasks?.length && !authored) {
    return { ok: false, error: 'final authored markdown is required after analysis planning' }
  }
  const rendered = authored ? renderAuthoredReport({ title, markdown: authored }) : renderReport({
    title,
    summary: '',
    insights,
    frames: insights.map((b) => ({
      handle: b.handle,
      title: b.title,
      process: b.process,
      suggestedChartType: b.suggestedChartType,
      rowCount: b.rowCount,
      rows: b.rows,
      chart: b.chart,
      fields: b.fields,
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
    analysisFiles: Array.isArray(session.analysisFiles) ? session.analysisFiles : [],
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
    name: 'od_analysis_plan',
    description:
      'ANALYSIS WORKER ONLY. JoyAgent PlanningAgent analogue. Call exactly once after od_get_schema. '
      + 'Create dynamic, non-overlapping analysis subtasks from the user request and actual schema; do not use a fixed report template. '
      + 'Each task must include task and businessKnowledge. The final report stage is added by the harness.',
    parameters: {
      reportTitle: { type: 'string', required: true },
      tasks: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            title: { type: 'string', required: true },
            task: { type: 'string', required: true },
            businessKnowledge: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok ? `analysis plan: ${value.taskCount} tasks` : `analysis plan failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_analysis_plan'),
    execute(args) {
      return trackAnalysisTool('od_analysis_plan', args, () => runAnalysisPlan(args), { force: true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_python',
    description:
      'ANALYSIS WORKER ONLY. Run Python on cached od_get_data frames (JoyAgent interpreter). '
      + 'rows is ALWAYS available; df is only available when pandas is installed. '
      + 'Never probe builtins/imports/runtime and never retry a failed Python call. '
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
      return trackAnalysisTool(
        'od_python',
        args,
        async () => planRequired() || toLosslessJson(await runAnalysisPython(args)),
        { force: true },
      )
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
      return trackAnalysisTool(
        'od_insight',
        args,
        () => planRequired() || toLosslessJson(runInsight(args)),
        { force: true },
      )
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
      return trackAnalysisTool(
        'od_save_insight',
        args,
        () => planRequired() || toLosslessJson(runSaveInsight(args)),
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_complete_analysis_task',
    description:
      'ANALYSIS WORKER ONLY. JoyAgent data_analysis final_answer analogue. '
      + 'After one planned subtask has saved all useful insights, create its independent Markdown analysis file. '
      + 'Call once per task in plan order. Do not call od_commit_report before every task file exists.',
    parameters: {
      taskIndex: { type: 'integer', required: true, description: 'Zero-based task index from od_analysis_plan' },
      title: { type: 'string' },
      summary: { type: 'string', required: true, description: 'Evidence-backed summary for this subtask only' },
      filename: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok ? `analysis file ready: ${value.filename}` : `analysis task failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_complete_analysis_task'),
    execute(args) {
      return trackAnalysisTool(
        'od_complete_analysis_task',
        args,
        () => runCompleteAnalysisTask(args),
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_read_analysis_files',
    description:
      'REPORT GENERATOR ONLY. JoyAgent report_tool file download analogue. '
      + 'After every data_analysis task is complete, read ALL independent Markdown files in full before authoring the final report.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok ? `loaded ${value.fileCount} analysis files` : `read analysis files failed: ${value.error || 'unknown'}`,
      }],
    },
    ...toolMeta('od_read_analysis_files'),
    execute(args) {
      return trackAnalysisTool(
        'od_read_analysis_files',
        args,
        () => runReadAnalysisFiles(args),
        { force: true },
      )
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_commit_report',
    description:
      'ANALYSIS WORKER ONLY. JoyAgent report_tool analogue. Read all completed analysis task files and author one final report. '
      + 'Call exactly once after od_complete_analysis_task has produced every file. markdown/content must be a complete evidence-backed Chinese report, not a fixed template. '
      + 'The harness only renders the authored Markdown to static HTML/MD and never invents sections. Conversation lead must not call this.',
    parameters: {
      title: { type: 'string' },
      markdown: { type: 'string', description: 'Complete authored final report in Markdown' },
      content: { type: 'string', description: 'Alias of markdown' },
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
      return trackAnalysisTool(
        'od_commit_report',
        args,
        () => toLosslessJson(runCommitReport(args)),
        { force: true },
      )
    },
  }))
}

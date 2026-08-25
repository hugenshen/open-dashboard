/**
 * P015 board worker tools (JoyAgent get_data / data_trans / save_insight analogue).
 * Registered globally so spawn `toolFilter.allow` can name them; Lead (depth 0) is denied.
 * Chart type is never a model argument — harness writes suggestedChartType after rows exist.
 * @module @opendashboard/dsh-od-bi/board-worker
 */

import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { boardPresentationMeta, isAnalysisReportSpawn, spawnWorkerPresentationMeta } from './answer-meta.js'
import { layoutBoardPatch, reviewCharts, retargetWeakTableDim } from './gen-board.js'
import {
  boardSessionKey,
  consumePresentation,
  getBoardSession,
  getFrame,
  putFrame,
  rememberPresentation,
  resetBoardSession,
} from './board-store.js'
import { transformRows } from './data-trans.js'
import { biFetch, toLosslessJson } from './http.js'
import { assessSemanticReadiness, semanticNotReadyMessage } from './semantic-readiness.js'
import {
  applyDisplayFromData,
  categoryIsTimeField,
  queryTask,
  ANALYSIS_RESULT_LIMIT,
  ANALYSIS_TIMEOUT_MS,
  REALIZE_TIMEOUT_MS,
  resultLimitFor,
  suggestChartFromResult,
  typeFromIntent,
} from './realize-task.js'

export const WORKER_TOOL_NAMES = Object.freeze([
  'od_get_data',
  'od_data_trans',
  'od_save_chart',
  'od_commit_board',
  'od_insight',
  'od_save_insight',
  'od_commit_report',
])

export { resetBoardSession } from './board-store.js'

const WORKER_SET = new Set(WORKER_TOOL_NAMES)

export function callerDepth(exec) {
  const agent = exec?.agent
  if (!agent) return 0
  const header = agent.session?.header?.delegationDepth
  const runtime = agent.options?.subagentDepth
  const h = Number.isFinite(Number(header)) ? Number(header) : 0
  const r = Number.isFinite(Number(runtime)) ? Number(runtime) : 0
  return Math.max(h, r)
}

/** Guard reason, or undefined to allow. */
export function workerGuardReason(exec) {
  if (!WORKER_SET.has(exec?.name)) return undefined
  if (callerDepth(exec) < 1) {
    return `${exec.name} is only for od_board_worker (delegationDepth≥1). Conversation lead must call od_board_worker, not this tool.`
  }
  return undefined
}

function clipRows(rows, n = 5) {
  return (Array.isArray(rows) ? rows : []).slice(0, n)
}

function isKpiTask(chart) {
  const intent = String(chart?.intent || '')
  const type = String(chart?.type || '')
  return intent.startsWith('kpi') || type === 'kpi'
}

function scalarValue(rows) {
  const first = Array.isArray(rows) ? rows[0] : null
  if (Array.isArray(first)) return first[first.length - 1]
  if (first && typeof first === 'object') {
    const values = Object.values(first)
    return values[values.length - 1]
  }
  return first
}

function validKpiRows(rows, rowCount) {
  if (Number(rowCount) !== 1) return false
  const raw = scalarValue(rows)
  if (raw == null || raw === '') return false
  return Number.isFinite(Number(raw))
}

function taskToChart(args) {
  const datasetId = String(args.datasetId || '').trim()
  const intent = String(args.intent || '')
  const dim = String(args.dim || args.category || '').trim()
  const measure = String(args.measure || args.value || '').trim()
  const agg = String(args.agg || '').toLowerCase()
  return {
    datasetId,
    intent,
    question: String(args.question || args.title || ''),
    title: String(args.title || args.question || 'task'),
    encode: {
      datasetId,
      category: dim || undefined,
      value: measure || dim || undefined,
      agg: agg || undefined,
    },
  }
}

function suggestForFrame(chart, fields, rows, rowCount) {
  const provisional = typeFromIntent(chart.intent)
  if (isKpiTask(chart)) return 'kpi'
  return suggestChartFromResult({
    intent: chart.intent,
    provisionalType: provisional,
    rowCount,
    categoryIsTime: categoryIsTimeField(chart, fields),
    agg: chart.encode?.agg,
  })
}

async function loadFields(datasetId, signal) {
  const schema = await biFetch(
    'GET',
    `/api/internal/bi/datasets/${encodeURIComponent(datasetId)}/schema`,
    undefined,
    signal,
  )
  return {
    fields: Array.isArray(schema?.fields) ? schema.fields : [],
    name: schema?.name || '',
  }
}

/**
 * One-task get_data. Model cannot pass chartType; harness fills suggestedChartType.
 */
export async function runGetData(args, opts = {}) {
  const session = opts.session || getBoardSession()
  const chart = taskToChart(args)
  const ds = chart.datasetId
  if (!ds) return { ok: false, error: 'datasetId required' }
  // Model must not pick chart type — ignore if passed.
  if (args.chartType != null || args.type != null) {
    /* stripped: suggestedChartType is set after rows exist */
  }
  const handle = String(args.handle || randomUUID())
  let fields = opts.fields
  if (!Array.isArray(fields) || !fields.length) {
    try {
      const loaded = await loadFields(ds, opts.signal)
      fields = loaded.fields
    } catch (err) {
      return { ok: false, error: `schema failed: ${String(err?.message || err)}` }
    }
  }
  const analysis = String(args.purpose || '').toLowerCase() === 'analysis'
  if (analysis) session.meta.purpose = 'analysis'
  chart.encode.resultLimit = analysis ? ANALYSIS_RESULT_LIMIT : resultLimitFor(chart)

  const rewritten = retargetWeakTableDim(chart, fields)
  if (rewritten?.encode?.category && rewritten.encode.category !== chart.encode.category) {
    chart.encode.category = rewritten.encode.category
    if (Array.isArray(rewritten.encode.x)) chart.encode.x = rewritten.encode.x
    if (rewritten.title) chart.title = rewritten.title
    if (rewritten.question) chart.question = rewritten.question
  }

  if (!chart.encode.value) {
    return { ok: false, error: 'measure (value) required' }
  }

  const queryFn = opts.queryFn || queryTask
  let q
  try {
    q = await queryFn(chart, {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs || (analysis ? ANALYSIS_TIMEOUT_MS : REALIZE_TIMEOUT_MS),
    })
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err),
      note: 'query failed — retry once with a different dim, or skip this task',
    }
  }
  if (!q?.ok) {
    return {
      ok: false,
      error: q?.error || 'query failed',
      note: 'retry once with a different dim from od_get_schema, or skip',
    }
  }
  const rowCount = Number(q.rowCount) || 0
  const rows = Array.isArray(q.rows) ? q.rows : []
  if (isKpiTask(chart) && !validKpiRows(rows, rowCount)) {
    return toLosslessJson({
      ok: true,
      handle,
      taskId: handle,
      rowCount: 0,
      sample: [],
      suggestedChartType: null,
      note: 'KPI query returned empty/null/NaN or non-scalar data — skip this task',
    })
  }
  const suggestedChartType = suggestForFrame(chart, fields, rows, rowCount)
  const ready = applyDisplayFromData({
    ...chart,
    type: suggestedChartType || typeFromIntent(chart.intent),
    rowCount,
  }, {
    fields,
    message: args.message || session.meta.message || '',
    rows,
  })
  putFrame(session, handle, {
    handle,
    chart: ready,
    fields,
    rows,
    rowCount,
    suggestedChartType,
    datasetId: ds,
    previewOnlyTransform: false,
  })
  session.meta.datasetId = ds
  if (args.message) session.meta.message = String(args.message)
  if (!rowCount || !suggestedChartType) {
    return toLosslessJson({
      ok: true,
      handle,
      taskId: handle,
      rowCount: 0,
      sample: [],
      suggestedChartType: null,
      note: analysis
        ? 'empty result — retry once with a revised question or different dim, then od_insight; do not od_save_chart'
        : 'empty result — retry once with a different dim, or skip (do not od_save_chart)',
    })
  }
  return toLosslessJson({
    ok: true,
    handle,
    taskId: handle,
    rowCount,
    sample: clipRows(rows),
    suggestedChartType,
    // Never echo model chartType; harness owns the suggestion.
    chartType: undefined,
    note: analysis
      ? 'Chart type was chosen by harness from DATE/row count. Next: od_data_trans optional, then od_insight / od_save_insight. You may od_get_data again with a revised question/dim.'
      : 'Chart type was chosen by harness from DATE/row count. Do not pick pie vs bar. od_save_chart next (or od_data_trans first).',
  })
}

export function runDataTrans(args, opts = {}) {
  const session = opts.session || getBoardSession()
  const handle = String(args.handle || '')
  const frame = getFrame(session, handle)
  if (!frame) return { ok: false, error: 'unknown handle — call od_get_data first' }
  const trans = transformRows(frame.rows, {
    transType: args.transType,
    column: args.column || frame.chart?.encode?.category,
    measure: args.measure || frame.chart?.encode?.value,
    fields: frame.fields,
  })
  if (!trans.ok) return { ok: false, error: trans.error }
  const nextChart = { ...frame.chart, encode: { ...(frame.chart.encode || {}) } }
  if (args.transType === 'rank') nextChart.intent = 'rank'
  if (args.transType === 'increase') nextChart.intent = nextChart.intent || 'trend'
  const suggestedChartType = suggestForFrame(nextChart, frame.fields, trans.rows, trans.rows.length)
  const ready = applyDisplayFromData({
    ...nextChart,
    type: suggestedChartType || nextChart.type,
    rowCount: trans.rows.length,
  }, {
    fields: frame.fields,
    message: session.meta.message || '',
    rows: trans.rows,
  })
  putFrame(session, handle, {
    ...frame,
    chart: ready,
    rows: trans.rows,
    rowCount: trans.rows.length,
    suggestedChartType,
    derivedColumn: trans.derivedColumn,
    previewOnlyTransform: true,
  })
  const analysis = session.meta.purpose === 'analysis'
  return toLosslessJson({
    ok: true,
    handle,
    rowCount: trans.rows.length,
    sample: clipRows(trans.rows),
    derivedColumn: trans.derivedColumn,
    suggestedChartType,
    note: analysis
      ? 'Harness updated suggestedChartType after transform. Next: od_insight / od_save_insight (not od_save_chart).'
      : 'Harness updated suggestedChartType after transform. Call od_save_chart.',
  })
}

export function runSaveChart(args, opts = {}) {
  const session = opts.session || getBoardSession()
  if (session.meta.purpose === 'analysis') {
    return { ok: false, error: 'analysis session: use od_save_insight / od_commit_report, not od_save_chart' }
  }
  const handle = String(args.handle || '')
  const frame = getFrame(session, handle)
  if (!frame) return { ok: false, error: 'unknown handle — call od_get_data first' }
  if (frame.previewOnlyTransform) {
    session.dropped.push({
      title: frame.chart?.title || handle,
      error: 'preview-only transform cannot be reproduced by dashboard runtime',
    })
    return {
      ok: false,
      error: 'preview-only transform cannot be committed until encode.transforms is supported by Java runtime',
    }
  }
  if (!frame.suggestedChartType || !frame.rowCount) {
    session.dropped.push({
      title: frame.chart?.title || handle,
      error: 'empty or no chart type — skipped',
    })
    return {
      ok: false,
      error: 'empty result cannot be saved — skip or retry od_get_data with another dim',
    }
  }
  const chart = {
    ...frame.chart,
    type: frame.suggestedChartType,
    title: String(args.title || frame.chart.title || frame.chart.question || 'chart'),
  }
  session.staging.push(chart)
  return toLosslessJson({
    ok: true,
    handle,
    savedCount: session.staging.length,
    chartType: frame.suggestedChartType,
    title: chart.title,
    note: 'Staged. Continue other tasks, then od_commit_board once.',
  })
}

export async function runCommitBoard(args, opts = {}) {
  const session = opts.session || getBoardSession()
  if (session.meta.purpose === 'analysis') {
    return { ok: false, error: 'analysis session: use od_commit_report, not od_commit_board' }
  }
  const title = String(args.title || session.meta.title || 'AI 生成看板')
  const charts = session.staging
  if (!charts.length) {
    return {
      ok: false,
      error: 'no charts staged — od_get_data then od_save_chart at least one task',
      dropped: session.dropped,
    }
  }
  const datasetId = String(args.datasetId || session.meta.datasetId || charts[0]?.datasetId || '')
  let fields = charts[0] && getFrame(session, [...session.frames.keys()][0])?.fields
  let profile = null
  let knowledge = null
  if (datasetId && opts.loadProfile !== false) {
    try {
      const schema = await biFetch(
        'GET',
        `/api/internal/bi/datasets/${encodeURIComponent(datasetId)}/schema`,
        undefined,
        opts.signal,
      )
      fields = Array.isArray(schema?.fields) ? schema.fields : (fields || [])
      const body = await biFetch('POST', '/api/internal/bi/profile-dataset', { datasetId }, opts.signal)
      profile = body || null
      knowledge = await biFetch(
        'GET',
        `/api/internal/bi/knowledge?datasetIds=${encodeURIComponent(datasetId)}`,
        undefined,
        opts.signal,
      )
    } catch (err) {
      return {
        ok: false,
        error: `semantic readiness check failed: ${String(err?.message || err)}`,
        source: 'semantic-readiness-error',
      }
    }
    const semanticReadiness = assessSemanticReadiness({ fields: fields || [], profile, knowledge })
    if (!semanticReadiness.ready) {
      return {
        ok: false,
        error: semanticNotReadyMessage(semanticReadiness),
        semanticReadiness,
        source: 'semantic-not-ready',
      }
    }
  }
  const reviewed = reviewCharts(charts, {
    fields: fields || [],
    profile,
    message: args.message || session.meta.message || '',
  })
  if (!reviewed.length) {
    return {
      ok: false,
      error: 'reviewCharts dropped every staged chart',
      dropped: session.dropped,
      source: 'commit-review-rejected',
    }
  }
  const built = layoutBoardPatch({
    title,
    styleId: args.styleId,
    charts: reviewed,
    query: args.query,
  })
  if (!built.ok) {
    return { ok: false, error: built.error || 'layout failed' }
  }
  const applyDashboardPatch = opts.applyDashboardPatch
  if (typeof applyDashboardPatch !== 'function') {
    return { ok: false, error: 'applyDashboardPatch missing' }
  }
  const applied = await applyDashboardPatch({
    title: built.title || title,
    mode: 'replace',
    patch: built.patch,
    dashboardId: opts.rememberedDashboardId
      ? opts.rememberedDashboardId(args.dashboardId)
      : args.dashboardId,
    signal: opts.signal,
  })
  if (!applied.ok) return applied
  const dropped = session.dropped
  const committed = toLosslessJson({
    ...applied,
    chartTitles: reviewed.map((c) => c.title || c.question).filter(Boolean),
    droppedTasks: dropped,
    source: applied.source || 'board-worker',
  })
  const meta = boardPresentationMeta(committed)
  rememberPresentation(meta, session.key)
  const liveKey = boardSessionKey()
  if (liveKey !== session.key) rememberPresentation(meta, liveKey)
  resetBoardSession(session.key)
  return committed
}

function workerToolMeta(name) {
  return {
    presentCall: (args) => ({
      card: 'generic',
      title: `${name} · ${args.title || args.question || args.handle || args.datasetId || ''}`,
      kind: name === 'od_commit_board' ? 'write' : 'search',
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: name,
      content: result.content,
    }),
  }
}

function spawnPresentationMeta(args, value) {
  const expectedKind = isAnalysisReportSpawn(args, value) ? 'report_ready' : 'board_ready'
  return spawnWorkerPresentationMeta(value, { consume: consumePresentation, expectedKind })
}
spawnPresentationMeta.__odSpawnMeta = true

function withSpawnPresentation(definition) {
  if (!definition || definition.name !== 'od_board_worker') return definition
  const prev = definition.output?.presentationMeta
  if (typeof prev === 'function' && prev.__odSpawnMeta) return definition
  const presentationMeta = typeof prev === 'function'
    ? (args, value) => {
      const m = prev(args, value)
      if (m && (m.odKind === 'board_ready' || m.odKind === 'report_ready')) return m
      return spawnPresentationMeta(args, value)
    }
    : spawnPresentationMeta
  presentationMeta.__odSpawnMeta = true
  return {
    ...definition,
    output: {
      ...definition.output,
      presentationMeta,
    },
  }
}

function attachSpawnMetaToTool(tool) {
  if (!tool || tool.name !== 'od_board_worker' || !tool.output) return tool
  const prev = tool.output.presentationMeta
  if (typeof prev === 'function' && prev.__odSpawnMeta) return tool
  try {
    tool.output.presentationMeta = spawnPresentationMeta
    return tool
  } catch {
    return {
      ...tool,
      output: { ...tool.output, presentationMeta: spawnPresentationMeta },
    }
  }
}

function patchExistingSpawnTool(ctx) {
  const tool = ctx.tools.get?.('od_board_worker')
  attachSpawnMetaToTool(tool)
}

/** Lift child commit meta onto Lead's spawn tool so the parent chat gets board_ready. */
export function installSpawnWorkerPresentation(ctx) {
  if (!ctx?.tools) return
  if (typeof ctx.tools.register === 'function' && !ctx.tools.register.__odSpawnMeta) {
    const orig = ctx.tools.register.bind(ctx.tools)
    const wrapped = (definition) => orig(withSpawnPresentation(definition))
    wrapped.__odSpawnMeta = true
    ctx.tools.register = wrapped
  }
  // resolveExecution uses this.get at call time — wrap even if register already ran.
  if (typeof ctx.tools.get === 'function' && !ctx.tools.get.__odSpawnMeta) {
    const origGet = ctx.tools.get.bind(ctx.tools)
    const wrappedGet = (name, scope) => attachSpawnMetaToTool(origGet(name, scope))
    wrappedGet.__odSpawnMeta = true
    ctx.tools.get = wrappedGet
  }
  patchExistingSpawnTool(ctx)
  if (typeof ctx.on === 'function' && !ctx.__odSpawnMetaChange) {
    ctx.__odSpawnMetaChange = true
    ctx.on('tools/change', () => patchExistingSpawnTool(ctx))
  }
}

export function registerBoardWorkerTools(ctx, deps) {
  const { applyDashboardPatch, rememberedDashboardId } = deps

  installSpawnWorkerPresentation(ctx)
  ctx.tools.guard((exec) => workerGuardReason(exec))

  ctx.tools.register(defineTool({
    name: 'od_get_data',
    description:
      'WORKER ONLY. Fetch one task as a table. Board: ≤20 rows / 8s. Analysis (purpose=analysis): ≤200 rows / 15s. '
      + 'Do NOT pass chartType — harness sets suggestedChartType from DATE / row count after rows exist. '
      + 'Conversation lead must call od_board_worker instead of this tool.',
    parameters: {
      datasetId: { type: 'string', required: true },
      purpose: { type: 'string', description: 'board (default) | analysis' },
      question: { type: 'string', description: 'Business question for this task' },
      intent: { type: 'string', description: 'kpi_count|kpi_sum|kpi_ratio|compare|rank|compose|trend|table' },
      dim: { type: 'string', description: 'Category / dimension field name' },
      measure: { type: 'string', description: 'Measure field name' },
      agg: { type: 'string', description: 'sum|count|avg' },
      title: { type: 'string' },
      message: { type: 'string', description: 'Original user theme (units)' },
      handle: { type: 'string', description: 'Reuse a handle to retry the same task with a new dim' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `get_data ${value.handle}: ${value.rowCount} rows → ${value.suggestedChartType || 'none'}${value.note ? `\n${value.note}` : ''}`
          : `get_data failed: ${value.error || 'unknown'}`,
      }],
    },
    ...workerToolMeta('od_get_data'),
    async execute(args, exec) {
      return toLosslessJson(await runGetData(args, { signal: exec.signal }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_data_trans',
    description:
      'BOARD WORKER ONLY. Transform a cached get_data table: rate (share), rank, increase (diff), sub_avg. '
      + 'Does not let the model pick a chart type. Conversation lead must not call this.',
    parameters: {
      handle: { type: 'string', required: true },
      transType: { type: 'string', required: true, description: 'rate | rank | increase | sub_avg' },
      column: { type: 'string', description: 'Group / time column (required for increase)' },
      measure: { type: 'string', description: 'Numeric column; defaults to the task measure' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `data_trans ${value.handle}: ${value.derivedColumn} → ${value.suggestedChartType}`
          : `data_trans failed: ${value.error || 'unknown'}`,
      }],
    },
    ...workerToolMeta('od_data_trans'),
    async execute(args) {
      return toLosslessJson(runDataTrans(args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_save_chart',
    description:
      'BOARD WORKER ONLY. Stage this task using harness suggestedChartType (you cannot pass chartType). '
      + 'Skip empty handles. After all tasks, od_commit_board.',
    parameters: {
      handle: { type: 'string', required: true },
      title: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `saved ${value.title} as ${value.chartType} (${value.savedCount} staged)`
          : `save failed: ${value.error || 'unknown'}`,
      }],
    },
    ...workerToolMeta('od_save_chart'),
    async execute(args) {
      return toLosslessJson(runSaveChart(args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_commit_board',
    description:
      'BOARD WORKER ONLY. reviewCharts (cannot skip) + layout + apply-patch replace. '
      + 'Call once after staging. Conversation lead must not call this.',
    parameters: {
      datasetId: { type: 'string' },
      title: { type: 'string' },
      dashboardId: { type: 'string', description: 'Existing draft to replace in place' },
      styleId: { type: 'string' },
      message: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        if (!value.ok) return [{ type: 'text', text: `commit failed: ${value.error || 'unknown'}` }]
        const titles = Array.isArray(value.chartTitles) ? value.chartTitles : []
        const list = titles.length ? `\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : ''
        return [{ type: 'text', text: `board ready: ${value.dashboardId} (${value.chartCount} charts)${list}` }]
      },
      presentationMeta(_args, value) {
        return boardPresentationMeta(value)
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.title || 'commit board',
      kind: 'write',
    }),
    presentResult: (args, result) => {
      if (result.isError) return { card: 'generic', title: 'commit failed', content: result.content }
      const meta = result.meta
      if (meta?.odKind === 'board_ready') {
        return {
          card: 'generic',
          title: `看板 · ${meta.title || args.title || ''}`,
          kind: 'write',
          content: [{
            type: 'text',
            text: `${meta.chartCount} 图已写入 draft${meta.editPath ? ` → ${meta.editPath}` : ''}`,
          }],
        }
      }
      return { card: 'generic', title: 'commit', content: result.content }
    },
    async execute(args, exec) {
      return toLosslessJson(await runCommitBoard(args, {
        signal: exec.signal,
        applyDashboardPatch,
        rememberedDashboardId,
      }))
    },
  }))
}

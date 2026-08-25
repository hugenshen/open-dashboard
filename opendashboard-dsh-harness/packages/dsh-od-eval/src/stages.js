/**
 * Stage runners — deterministic only (E0.1 / E0.2 offline).
 */
import {
  enumerateGoals,
  planChartsFromFields,
  buildReviewedBoard,
  layoutBoardPatch,
  measureKind,
  reviewCharts,
} from '@opendashboard/dsh-od-bi/gen-board'
import { assertAllowedTables, checkSqlRead } from '@opendashboard/dsh-od-bi/sql-guard'
import { suggestChartType } from '@opendashboard/dsh-od-bi/ask-enrich'
import { realizeBoundCharts, suggestChartFromResult } from '@opendashboard/dsh-od-bi/realize-task'
import {
  callerDepth,
  resetBoardSession,
  runDataTrans,
  runGetData,
  runSaveChart,
  workerGuardReason,
} from '@opendashboard/dsh-od-bi/board-worker'
import {
  runInsight,
  runSaveInsight,
  runCommitReport,
} from '@opendashboard/dsh-od-bi/analysis-worker'
import { compareResultSets } from './result-set.js'

function fail(reason, actual = {}) {
  return { ok: false, reason, actual }
}

function pass(actual = {}, notes = '') {
  return { ok: true, reason: notes || '', actual }
}

function intentsOf(goals) {
  return (goals || []).map((g) => String(g.intent || ''))
}

/** Board plan (rule fallback enumerateGoals). */
export function runPlan(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const datasetId = doc.dataset?.id || 'eval_ds'
  const { goals } = enumerateGoals(datasetId, fields, {
    message: input.message || '',
    datasetName: input.datasetName || '',
  })
  const expect = doc.expect || {}
  const gotIntents = intentsOf(goals)

  if (typeof expect.minGoals === 'number' && goals.length < expect.minGoals) {
    return fail(`goals ${goals.length} < minGoals ${expect.minGoals}`, { goals, intents: gotIntents })
  }
  if (typeof expect.maxGoals === 'number' && goals.length > expect.maxGoals) {
    return fail(`goals ${goals.length} > maxGoals ${expect.maxGoals}`, { goals, intents: gotIntents })
  }
  if (Array.isArray(expect.mustIntents)) {
    for (const need of expect.mustIntents) {
      if (!gotIntents.includes(need)) {
        return fail(`missing intent ${need}`, { goals, intents: gotIntents })
      }
    }
  }
  if (Array.isArray(expect.forbidIntents)) {
    for (const bad of expect.forbidIntents) {
      if (gotIntents.includes(bad)) {
        return fail(`forbidden intent ${bad}`, { goals, intents: gotIntents })
      }
    }
  }
  if (Array.isArray(expect.questionIncludes)) {
    const blob = goals.map((g) => g.question || g.title || '').join('|')
    for (const frag of expect.questionIncludes) {
      if (!blob.includes(frag)) {
        return fail(`questions missing "${frag}"`, { goals, intents: gotIntents })
      }
    }
  }
  return pass({ goals, intents: gotIntents, count: goals.length })
}

/** Board bind: planCharts + ratio never SUM on bar/pie/table. */
export function runBind(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const datasetId = doc.dataset?.id || 'eval_ds'
  const { charts, goals } = planChartsFromFields(datasetId, fields, {
    message: input.message || '',
    datasetName: input.datasetName || '',
  })
  const expect = doc.expect || {}
  const actual = { charts, goals }

  if (typeof expect.minCharts === 'number' && charts.length < expect.minCharts) {
    return fail(`charts ${charts.length} < minCharts ${expect.minCharts}`, actual)
  }

  const ratioSumBad = charts.filter((c) => {
    const t = String(c.type || '')
    if (!['bar', 'pie', 'table', 'grouptable'].includes(t)) return false
    const val = fields.find((f) => f.name === c.encode?.value)
    if (!val) return false
    return measureKind(val) === 'ratio' && String(c.encode?.agg || 'sum').toLowerCase() === 'sum'
  })
  if (expect.forbidRatioSum !== false && ratioSumBad.length) {
    return fail('ratio measure used as SUM on bar/pie/table', {
      ...actual,
      ratioSumBad,
    })
  }

  if (expect.barCategory) {
    const bar = charts.find((c) => c.type === 'bar')
    if (String(bar?.encode?.category) !== expect.barCategory) {
      return fail(`bar category ${bar?.encode?.category} !== ${expect.barCategory}`, actual)
    }
  }
  if (Array.isArray(expect.barValueIn)) {
    const bar = charts.find((c) => c.type === 'bar')
    const v = String(bar?.encode?.value || '')
    if (!expect.barValueIn.includes(v)) {
      return fail(`bar value ${v} not in ${expect.barValueIn.join(',')}`, actual)
    }
  }
  if (Array.isArray(expect.forbidEncodeValues)) {
    for (const bad of expect.forbidEncodeValues) {
      if (charts.some((c) => String(c.encode?.value) === bad || String(c.encode?.category) === bad)) {
        return fail(`forbidden encode field ${bad}`, actual)
      }
    }
  }
  return pass(actual)
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Board layout / assembly. */
export function runLayout(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const datasetId = doc.dataset?.id || 'eval_ds'
  const board = buildReviewedBoard({
    datasetId,
    fields,
    message: input.message || '',
    title: input.title || 'eval board',
    datasetName: input.datasetName || '',
  })
  if (board.ok === false) {
    return fail(board.error || 'buildReviewedBoard failed', board)
  }
  const ops = board.ops || board.patch?.ops || []
  const comps = ops.filter((o) => o.op === 'upsert_component')
  const charts = ops.filter((o) => o.op === 'upsert_chart')
  const queries = comps.filter((c) => c.type === 'query')
  const expect = doc.expect || {}

  if (typeof expect.minComponents === 'number' && comps.length < expect.minComponents) {
    return fail(`components ${comps.length} < ${expect.minComponents}`, { comps, charts })
  }
  if (typeof expect.maxQueryBars === 'number' && queries.length > expect.maxQueryBars) {
    return fail(`query bars ${queries.length} > ${expect.maxQueryBars}`, { queries })
  }

  const boxes = comps
    .filter((c) => c.type !== 'query' || true)
    .map((c) => ({ id: c.id, x: c.x || 0, y: c.y || 0, w: c.w || 0, h: c.h || 0 }))
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        return fail(`overlap ${boxes[i].id} × ${boxes[j].id}`, { boxes })
      }
    }
  }

  if (expect.layoutOk === false) {
    return fail('case marked layoutOk=false but layout passed', { comps })
  }
  return pass({
    componentCount: comps.length,
    chartCount: charts.length,
    queryCount: queries.length,
    boxes,
  })
}

/** Ask sql-guard. */
export function runGuard(caseCtx) {
  const { doc } = caseCtx
  const input = doc.input || {}
  const sql = input.sql || ''
  const table = input.table || doc.dataset?.table || 't'
  const expect = doc.expect || {}
  const allow = expect.allow !== false

  let ok = true
  let reason = ''
  try {
    const read = checkSqlRead(sql)
    if (!read.ok) throw new Error(read.reason)
    assertAllowedTables(sql, [table, ...(input.allowedTables || [])])
  } catch (err) {
    ok = false
    reason = String(err?.message || err)
  }

  if (ok !== allow) {
    return fail(
      allow ? `expected allow, got reject: ${reason}` : `expected reject, got allow`,
      { ok, reason },
    )
  }
  return pass({ ok, reason })
}

/** Offline EX: compare fixture pred vs gold rows (BIRD-style). */
export function runEx(caseCtx) {
  const { doc } = caseCtx
  const expect = doc.expect || {}
  const pred = expect.predRows || doc.input?.predRows || []
  const gold = expect.goldRows || []
  if (!gold.length && !expect.allowEmptyGold) {
    return fail('goldRows required for stage=ex', {})
  }
  const cmp = compareResultSets(pred, gold, {
    predColumns: expect.predColumns,
    goldColumns: expect.goldColumns,
  })
  const wantOk = expect.match !== false
  if (cmp.ok !== wantOk) {
    return fail(
      wantOk ? cmp.reason || 'EX mismatch' : 'expected mismatch but sets equal',
      cmp,
    )
  }
  return pass(cmp)
}

/** Ask viz suggestChartType. */
export function runViz(caseCtx) {
  const { doc } = caseCtx
  const input = doc.input || {}
  const got = suggestChartType({
    fields: input.fields || [],
    rows: input.rows || [],
    requested: input.requested || 'auto',
  })
  const expect = doc.expect || {}
  if (expect.chartType && got !== expect.chartType) {
    return fail(`chartType ${got} !== ${expect.chartType}`, { got })
  }
  if (Array.isArray(expect.chartTypeIn) && !expect.chartTypeIn.includes(got)) {
    return fail(`chartType ${got} not in ${expect.chartTypeIn.join(',')}`, { got })
  }
  return pass({ chartType: got })
}

/** Optional: layout-only from prebuilt charts in case. */
export function runLayoutCharts(caseCtx) {
  const { doc } = caseCtx
  const charts = doc.input?.charts
  if (!Array.isArray(charts) || !charts.length) {
    return runLayout(caseCtx)
  }
  const layout = layoutBoardPatch({
    title: doc.input?.title || 'eval',
    charts,
    query: doc.input?.query || null,
  })
  if (layout.ok === false) return fail(layout.error || 'layout failed', layout)
  return pass({ ops: layout.ops })
}

function mockQueryFn(results) {
  const by = results && typeof results === 'object' ? results : {}
  return async (chart) => {
    const key = chart.title || chart.question || ''
    const hit = by[key] || by['*']
    if (!hit) return { ok: false, error: `no mock result for ${key}` }
    if (hit.ok === false) return { ok: false, error: hit.error || 'query failed' }
    const rows = Array.isArray(hit.rows) ? hit.rows : []
    const rowCount = typeof hit.rowCount === 'number' ? hit.rowCount : rows.length
    return { ok: true, rows, rowCount }
  }
}

function countByType(charts) {
  const map = {}
  for (const c of charts || []) {
    const t = String(c.type || '')
    map[t] = (map[t] || 0) + 1
  }
  return map
}

function assertChartQuality(charts, expect, extra = {}) {
  const types = (charts || []).map((c) => String(c.type || ''))
  const byType = countByType(charts)
  if (typeof expect.minCharts === 'number' && charts.length < expect.minCharts) {
    return fail(`charts ${charts.length} < minCharts ${expect.minCharts}`, { charts, ...extra })
  }
  if (typeof expect.maxCharts === 'number' && charts.length > expect.maxCharts) {
    return fail(`charts ${charts.length} > maxCharts ${expect.maxCharts}`, { charts, ...extra })
  }
  if (typeof expect.maxPie === 'number') {
    const pies = byType.pie || 0
    if (pies > expect.maxPie) {
      return fail(`pie count ${pies} > maxPie ${expect.maxPie}`, { charts, byType, ...extra })
    }
  }
  if (typeof expect.minKpi === 'number') {
    const kpis = byType.kpi || 0
    if (kpis < expect.minKpi) {
      return fail(`kpi count ${kpis} < minKpi ${expect.minKpi}`, { charts, byType, ...extra })
    }
  }
  if (Array.isArray(expect.mustTypes)) {
    for (const t of expect.mustTypes) {
      if (!types.includes(t)) return fail(`missing type ${t}`, { charts, types, ...extra })
    }
  }
  if (Array.isArray(expect.forbidTypes)) {
    for (const t of expect.forbidTypes) {
      if (types.includes(t)) return fail(`forbidden type ${t}`, { charts, types, ...extra })
    }
  }
  if (expect.compareNeverPie) {
    const bad = (charts || []).filter((c) => c.intent === 'compare' && c.type === 'pie')
    if (bad.length) return fail('compare SUM rendered as pie', { bad, ...extra })
  }
  if (expect.typesByTitle && typeof expect.typesByTitle === 'object') {
    for (const [title, want] of Object.entries(expect.typesByTitle)) {
      const hit = (charts || []).find((c) => c.title === title || c.question === title)
      if (!hit) return fail(`missing chart "${title}"`, { charts, ...extra })
      if (String(hit.type) !== String(want)) {
        return fail(`"${title}" type ${hit.type} !== ${want}`, { charts, ...extra })
      }
    }
  }
  if (expect.fenAxisUnit) {
    const hit = (charts || []).find((c) => c.style?.axisUnit === expect.fenAxisUnit
      || c.style?.formatter?.unit === 0.01)
    if (!hit) return fail(`no chart with fen display (${expect.fenAxisUnit})`, { charts, ...extra })
  }
  return null
}

/** P015 realize: sampled rows → chart type (model does not pick pie vs bar). */
export async function runRealize(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const expect = doc.expect || {}
  if (Array.isArray(input.suggest) && input.suggest.length) {
    const got = input.suggest.map((s) => suggestChartFromResult(s))
    if (Array.isArray(expect.suggestTypes)) {
      for (let i = 0; i < expect.suggestTypes.length; i += 1) {
        if (got[i] !== expect.suggestTypes[i]) {
          return fail(`suggest[${i}] ${got[i]} !== ${expect.suggestTypes[i]}`, { got })
        }
      }
    }
    return pass({ suggestTypes: got })
  }
  const tasks = input.tasks || []
  const realized = await realizeBoundCharts(tasks, {
    fields,
    message: input.message || '',
    queryFn: mockQueryFn(input.results),
  })
  if (Array.isArray(expect.droppedTitles)) {
    const dropped = (realized.dropped || []).map((d) => d.title)
    for (const title of expect.droppedTitles) {
      if (!dropped.includes(title)) {
        return fail(`expected dropped "${title}"`, { dropped, realized })
      }
    }
  }
  if (expect.ok === false && realized.ok) {
    return fail('expected realize ok=false', realized)
  }
  const quality = assertChartQuality(realized.charts || [], expect, { dropped: realized.dropped })
  if (quality) return quality
  return pass({
    charts: realized.charts,
    dropped: realized.dropped,
    byType: countByType(realized.charts),
  })
}

/** reviewCharts: pie cap, same-dim, junk. */
export function runReview(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const charts = Array.isArray(input.charts) ? input.charts : []
  const reviewed = reviewCharts(charts, {
    fields,
    message: input.message || '',
    profile: input.profile || null,
  })
  const quality = assertChartQuality(reviewed, doc.expect || {})
  if (quality) return quality
  return pass({ charts: reviewed, byType: countByType(reviewed) })
}

/** Worker tools: depth gate + get_data does not accept model chartType. */
export async function runWorker(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const expect = doc.expect || {}
  if (input.mode === 'guard' || expect.leadDenied) {
    const reason = workerGuardReason({
      name: input.tool || 'od_get_data',
      agent: { session: { header: { delegationDepth: input.depth ?? 0 } }, options: {} },
    })
    const wantDeny = expect.denied !== false
    if (wantDeny && !reason) return fail('expected Lead to be denied', { depth: callerDepth({ agent: { session: { header: { delegationDepth: 0 } } } }) })
    if (!wantDeny && reason) return fail(`expected allow, got ${reason}`, { reason })
    return pass({ denied: Boolean(reason), reason: reason || '' })
  }
  const session = resetBoardSession(`eval-${doc.id || 'worker'}-${Date.now()}`)
  const task = input.task || {}
  const got = await runGetData({
    datasetId: task.datasetId || doc.dataset?.id || 'ds1',
    intent: task.intent,
    dim: task.dim,
    measure: task.measure,
    agg: task.agg,
    question: task.question || task.title,
    title: task.title || task.question,
  }, {
    session,
    fields,
    queryFn: mockQueryFn(input.results),
  })
  if (expect.suggestedChartType && got.suggestedChartType !== expect.suggestedChartType) {
    return fail(`suggestedChartType ${got.suggestedChartType} !== ${expect.suggestedChartType}`, got)
  }
  if (expect.noModelChartType !== false && got.chartType != null) {
    return fail('get_data leaked model chartType', got)
  }
  const doSave = input.save !== false && expect.save !== false
  if (doSave && got.ok && got.suggestedChartType) {
    const saved = runSaveChart({ handle: got.handle }, { session })
    if (!saved.ok) return fail(`save failed: ${saved.error}`, { got, saved })
    if (expect.savedType && saved.chartType !== expect.savedType) {
      return fail(`saved type ${saved.chartType} !== ${expect.savedType}`, saved)
    }
  }
  if (input.transType) {
    const trans = runDataTrans({
      handle: got.handle,
      transType: input.transType,
      measure: task.measure,
    }, { session })
    if (!trans.ok) return fail(`data_trans failed: ${trans.error}`, trans)
    if (expect.transType && trans.suggestedChartType !== expect.transType) {
      return fail(`after trans type ${trans.suggestedChartType} !== ${expect.transType}`, trans)
    }
    return pass({ get_data: got, trans })
  }
  return pass({ get_data: got })
}

/**
 * P016 analysis-report path: purpose=analysis → insight → save → commit (no dashboardId).
 */
export async function runAnalysis(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const expect = doc.expect || {}
  const session = resetBoardSession(`eval-anr-${doc.id || 'report'}-${Date.now()}`)
  const task = input.task || {}
  const baseArgs = {
    datasetId: task.datasetId || doc.dataset?.id || 'ds1',
    intent: task.intent || 'compose',
    measure: task.measure,
    agg: task.agg,
    purpose: 'analysis',
  }
  const got = await runGetData({
    ...baseArgs,
    dim: task.dim,
    question: task.question || task.title || input.message,
    title: task.title || task.question,
    chartType: input.modelChartType,
  }, {
    session,
    fields,
    queryFn: mockQueryFn(input.results),
    timeoutMs: input.timeoutMs,
  })
  if (!got.ok) return fail(`get_data failed: ${got.error}`, got)
  if (expect.noModelChartType !== false && got.chartType != null) {
    return fail('get_data leaked model chartType', got)
  }
  if (expect.suggestedChartType && got.suggestedChartType !== expect.suggestedChartType) {
    return fail(`suggestedChartType ${got.suggestedChartType} !== ${expect.suggestedChartType}`, got)
  }

  let useHandle = got.handle
  if (input.retry) {
    const retry = await runGetData({
      ...baseArgs,
      dim: input.retry.dim,
      measure: input.retry.measure || task.measure,
      agg: input.retry.agg || task.agg,
      intent: input.retry.intent || task.intent || 'compose',
      question: input.retry.question || '改维再取',
    }, {
      session,
      fields,
      queryFn: mockQueryFn(input.retry.results || input.results),
    })
    if (!retry.ok || !(retry.rowCount > 0)) {
      return fail('retry get_data expected rows', { got, retry })
    }
    useHandle = retry.handle
  } else if (expect.minRows != null && (got.rowCount || 0) < expect.minRows) {
    return fail(`rowCount ${got.rowCount} < ${expect.minRows}`, got)
  }

  const ins = runInsight({ handle: useHandle }, { session })
  if (!ins.ok) return fail(`insight failed: ${ins.error}`, ins)
  const saved = runSaveInsight({ handle: useHandle, title: task.title || '切片' }, { session })
  if (!saved.ok) return fail(`save_insight failed: ${saved.error}`, saved)
  const report = runCommitReport({
    title: input.title || '分析报告',
    format: input.format || 'html',
  }, { session })
  if (!report.ok) return fail(`commit_report failed: ${report.error}`, report)
  if (report.dashboardId != null) return fail('report must not have dashboardId', report)
  if (expect.requireHtml !== false && !report.html) return fail('missing html', report)
  if (expect.requireMarkdown !== false && !report.markdown) return fail('missing markdown', report)
  if (Array.isArray(expect.footerIncludes)) {
    for (const frag of expect.footerIncludes) {
      if (!String(report.html || '').includes(frag) && !String(report.markdown || '').includes(frag)) {
        return fail(`report missing "${frag}"`, report)
      }
    }
  }
  return pass({
    get_data: got,
    insightCount: report.insightCount,
    dashboardId: report.dashboardId,
    filename: report.filename,
  })
}

/**
 * Full board quality: realize → review → layout.
 * This is the cockpit rubric (slots, pie cap, compare≠pie, no overlap).
 */
export async function runCockpit(caseCtx) {
  const { doc, fields } = caseCtx
  const input = doc.input || {}
  const expect = doc.expect || {}
  const datasetId = doc.dataset?.id || 'eval_ds'
  let tasks = input.tasks
  if (!Array.isArray(tasks) || !tasks.length) {
    const planned = planChartsFromFields(datasetId, fields, {
      message: input.message || '',
      datasetName: input.datasetName || '',
    })
    tasks = planned.charts || []
  }
  const realized = await realizeBoundCharts(tasks, {
    fields,
    message: input.message || '',
    queryFn: mockQueryFn(input.results),
  })
  if (!realized.ok && expect.allowEmptyRealize !== true) {
    return fail(realized.note || 'realize failed', realized)
  }
  const reviewed = reviewCharts(realized.charts || [], {
    fields,
    message: input.message || '',
    profile: input.profile || null,
  })
  const quality = assertChartQuality(reviewed, expect, { dropped: realized.dropped, realized: realized.charts })
  if (quality) return quality
  const layout = layoutBoardPatch({
    title: input.title || 'eval board',
    charts: reviewed,
    query: input.query || null,
  })
  if (layout.ok === false) return fail(layout.error || 'layout failed', layout)
  const ops = layout.patch?.ops || layout.ops || []
  const comps = ops.filter((o) => o.op === 'upsert_component')
  const boxes = comps.map((c) => ({ id: c.id, x: c.x || 0, y: c.y || 0, w: c.w || 0, h: c.h || 0 }))
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        return fail(`overlap ${boxes[i].id} × ${boxes[j].id}`, { boxes })
      }
    }
  }
  if (typeof expect.minComponents === 'number' && comps.length < expect.minComponents) {
    return fail(`components ${comps.length} < ${expect.minComponents}`, { comps })
  }
  return pass({
    realized: realized.charts?.length || 0,
    reviewed: reviewed.length,
    dropped: realized.dropped,
    byType: countByType(reviewed),
    componentCount: comps.length,
    types: reviewed.map((c) => ({ title: c.title, type: c.type, intent: c.intent })),
  })
}

export const STAGE_RUNNERS = {
  plan: runPlan,
  bind: runBind,
  layout: runLayout,
  guard: runGuard,
  ex: runEx,
  viz: runViz,
  realize: runRealize,
  review: runReview,
  worker: runWorker,
  analysis: runAnalysis,
  cockpit: runCockpit,
}

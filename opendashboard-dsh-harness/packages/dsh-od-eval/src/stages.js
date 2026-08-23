/**
 * Stage runners — deterministic only (E0.1 / E0.2 offline).
 */
import {
  enumerateGoals,
  planChartsFromFields,
  buildReviewedBoard,
  layoutBoardPatch,
  measureKind,
} from '@opendashboard/dsh-od-bi/gen-board'
import { assertAllowedTables, checkSqlRead } from '@opendashboard/dsh-od-bi/sql-guard'
import { suggestChartType } from '@opendashboard/dsh-od-bi/ask-enrich'
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

export const STAGE_RUNNERS = {
  plan: runPlan,
  bind: runBind,
  layout: runLayout,
  guard: runGuard,
  ex: runEx,
  viz: runViz,
}

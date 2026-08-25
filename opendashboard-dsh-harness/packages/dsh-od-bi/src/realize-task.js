/**
 * P015: sampled query + deterministic chart/display (JoyAgent checkChartType analogue).
 * Used by the board worker (`od_get_data`) and the last-resort `od_generate_board` path.
 * Conversation Lead never calls od_run_query on /board.
 * @module @opendashboard/dsh-od-bi/realize-task
 */

import { fenDisplayStyle, fname, semanticRole, typeFromIntent } from './gen-board.js'
import { biFetch, toLosslessJson } from './http.js'

export const REALIZE_TIMEOUT_MS = Number(process.env.OD_BOARD_REALIZE_TIMEOUT_MS || 8_000)
export const REALIZE_MAX_TASKS = 8
/** P016 analysis report: tighter than JoyAgent 10k/90s; still above board sample. */
export const ANALYSIS_RESULT_LIMIT = 200
export const ANALYSIS_TIMEOUT_MS = 15_000

export { typeFromIntent }

/**
 * JoyAgent checkChartType, plus OD slot constraints (SUM compare is never pie).
 */
export function suggestChartFromResult({
  intent,
  provisionalType,
  rowCount,
  categoryIsTime,
  agg,
} = {}) {
  const n = Number(rowCount) || 0
  const intentKey = String(intent || '')
  const prov = String(provisionalType || typeFromIntent(intentKey, 'bar'))
  if (intentKey.startsWith('kpi') || prov === 'kpi') return 'kpi'
  if (intentKey === 'table' || prov === 'grouptable' || prov === 'table') return 'grouptable'
  if (intentKey === 'rank' || prov === 'hbar') return 'hbar'
  if (n <= 0) return null
  if (n === 1 && intentKey !== 'compare' && intentKey !== 'compose' && intentKey !== 'rank') return 'kpi'
  if (categoryIsTime || intentKey === 'trend' || prov === 'line' || prov === 'area') return 'line'
  const countAgg = String(agg || '').toLowerCase() === 'count'
  if ((intentKey === 'compose' || prov === 'pie') && n > 1 && n < 6) return 'pie'
  if (countAgg && n > 1 && n < 6 && intentKey !== 'compare') return 'pie'
  if (n >= 6) return 'bar'
  return 'bar'
}

export function numericSampleMax(rows, valueIndex = 1) {
  let max = null
  for (const row of Array.isArray(rows) ? rows : []) {
    const v = Number(rowValue(row, valueIndex))
    if (!Number.isFinite(v)) continue
    const a = Math.abs(v)
    if (max == null || a > max) max = a
  }
  return max
}

export function decimalPlacesFromSample(rows, valueIndex = 1) {
  let maxPlaces = 0
  let sawFloat = false
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = rowValue(row, valueIndex)
    if (raw == null || raw === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const s = String(raw)
    const dot = s.indexOf('.')
    if (dot >= 0) {
      sawFloat = true
      maxPlaces = Math.max(maxPlaces, Math.min(4, s.length - dot - 1))
    }
  }
  if (!sawFloat) return 0
  return maxPlaces <= 1 ? 2 : Math.min(2, maxPlaces)
}

function rowValue(row, valueIndex = 1) {
  if (Array.isArray(row)) return row[valueIndex] ?? row[row.length - 1]
  if (row && typeof row === 'object') {
    const keys = Object.keys(row)
    if (keys[valueIndex] != null) return row[keys[valueIndex]]
    return row[keys[keys.length - 1]]
  }
  return undefined
}

export function applyDisplayFromData(chart, { fields, message, rows } = {}) {
  const next = { ...chart, encode: { ...(chart.encode || {}) }, style: { ...(chart.style || {}) } }
  const list = Array.isArray(fields) ? fields : []
  const valueName = String(next.encode.value || '')
  const vf = list.find((f) => fname(f) === valueName)
  const sampleMax = numericSampleMax(rows)
  const fen = fenDisplayStyle(vf, message, sampleMax)
  if (fen) {
    next.style = {
      ...next.style,
      formatter: fen.formatter,
      axisUnit: fen.axisUnit || next.style.axisUnit || 'none',
      valueSuffix: fen.valueSuffix != null ? fen.valueSuffix : (next.style.valueSuffix || ''),
    }
  } else {
    const decimals = decimalPlacesFromSample(rows)
    if (decimals > 0) {
      next.style = {
        ...next.style,
        formatter: { ...(next.style.formatter || {}), decimal: decimals },
      }
    }
  }
  return next
}

export function resultLimitFor(chart) {
  const t = String(chart?.type || '')
  const intent = String(chart?.intent || '')
  if (t === 'hbar' || intent === 'rank') return 10
  if (t === 'line' || t === 'area' || intent === 'trend') return 60
  if (t === 'kpi' || intent.startsWith('kpi')) return 1
  return 20
}

export function categoryIsTimeField(chart, fields) {
  const cat = String(chart?.encode?.category || '')
  if (!cat) return false
  const f = (fields || []).find((x) => fname(x) === cat)
  return semanticRole(f) === 'time'
}

export async function queryTask(chart, { signal, timeoutMs }) {
  const ds = chart.datasetId || chart.encode?.datasetId
  const encode = {
    ...(chart.encode || {}),
    resultLimit: chart.encode?.resultLimit || resultLimitFor(chart),
  }
  if (!encode.value) return { ok: false, error: 'encode.value required' }
  const result = await biFetch('POST', '/api/internal/bi/query/chart', {
    chartId: 'board_realize',
    dashboardId: null,
    view: 'draft',
    inline: {
      datasetId: ds,
      chartType: 'table',
      title: chart.title || chart.question || 'task',
      encode,
    },
    context: {},
  }, signal, timeoutMs)
  const data = Array.isArray(result?.data) ? result.data : []
  const rowCount = typeof result?.rowCount === 'number' ? result.rowCount : data.length
  return { ok: true, rows: data, rowCount, extra: result?.extra }
}

/**
 * Realize bound charts: skip KPI (formatter from field); others sampled ask-query then suggest type.
 * Failed / empty tasks are dropped — board still writes the rest.
 */
export async function realizeBoundCharts(charts, opts = {}) {
  const list = (Array.isArray(charts) ? charts : []).slice(0, REALIZE_MAX_TASKS)
  if (!list.length) return { ok: false, charts: [], dropped: [], note: 'no tasks' }
  if (/^(0|false|no)$/i.test(String(process.env.OD_BOARD_REALIZE || '1'))) {
    return { ok: true, charts: list, dropped: [], note: 'realize skipped (OD_BOARD_REALIZE)' }
  }
  const fields = opts.fields || []
  const message = opts.message || ''
  const timeoutMs = opts.timeoutMs || REALIZE_TIMEOUT_MS
  const queryFn = opts.queryFn || queryTask
  const realized = []
  const dropped = []
  const jobs = list.map(async (chart) => {
    const provisional = chart.type || typeFromIntent(chart.intent)
    if (provisional === 'kpi' || String(chart.intent || '').startsWith('kpi')) {
      return applyDisplayFromData({ ...chart, type: 'kpi' }, { fields, message, rows: [] })
    }
    try {
      const q = await queryFn(chart, { signal: opts.signal, timeoutMs })
      if (!q?.ok) {
        dropped.push({ title: chart.title, error: q?.error || 'query failed' })
        return null
      }
      if (!q.rowCount) {
        dropped.push({ title: chart.title, error: 'empty result' })
        return null
      }
      const type = suggestChartFromResult({
        intent: chart.intent,
        provisionalType: provisional,
        rowCount: q.rowCount,
        categoryIsTime: categoryIsTimeField(chart, fields),
        agg: chart.encode?.agg,
      })
      if (!type) {
        dropped.push({ title: chart.title, error: 'no chart for result shape' })
        return null
      }
      return applyDisplayFromData({ ...chart, type, rowCount: q.rowCount }, {
        fields,
        message,
        rows: q.rows,
      })
    } catch (err) {
      dropped.push({ title: chart.title, error: String(err?.message || err) })
      return null
    }
  })
  const settled = await Promise.all(jobs)
  for (const item of settled) {
    if (item) realized.push(item)
  }
  return toLosslessJson({
    ok: realized.length > 0,
    charts: realized,
    dropped,
    note: dropped.length
      ? `任务执行器丢弃 ${dropped.length} 个空/超时任务`
      : '',
  })
}

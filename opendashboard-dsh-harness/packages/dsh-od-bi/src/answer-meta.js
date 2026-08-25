/**
 * Shared answer presentation meta for chat cards.
 * Includes SELECT sqlHint for the preview card (read-only, already gated).
 * Intermediate probes (presentAnswer=false) stay as collapsed tool cards — no chart node.
 * @module @opendashboard/dsh-od-bi/answer-meta
 */

import { resolveSampleMeta } from './sample-meta.js'
import { consumePresentation } from './board-store.js'

export function isTableChartType(chartType) {
  const t = String(chartType || 'table').toLowerCase()
  return t === 'table' || t === 'grouptable' || t === 'detail'
}

function attachSampleFields(meta, value) {
  const sample = resolveSampleMeta(
    {
      sampled: value.sampled,
      sampleN: value.sampleN,
      estRows: value.estRows,
      scaleFactor: value.scaleFactor,
    },
    value.sqlHint || value.sql || meta.sqlHint,
  )
  if (!sample.sampled) return
  meta.sampled = true
  if (sample.sampleN != null) meta.sampleN = sample.sampleN
  if (sample.estRows != null) meta.estRows = sample.estRows
  if (sample.scaleFactor != null) meta.scaleFactor = sample.scaleFactor
}

/** dsh snapshotJsonValue rejects own keys whose value is undefined. */
function omitUndefined(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * @param {object} value - successful tool value
 * @param {{ presentAnswer?: boolean }} [opts]
 */
export function answerPresentationMeta(value, opts = {}) {
  if (!value?.ok) {
    return { odKind: 'answer_error', error: value?.error || 'unknown' }
  }
  const presentAnswer = Boolean(
    opts.presentAnswer
    ?? value.presentAnswer
    ?? false,
  )
  // Probe: collapsed tool card only. Omit undefined keys (dsh lossless JSON).
  if (!presentAnswer) {
    return omitUndefined({
      odKind: 'ask_probe',
      title: value.title,
      chartType: 'table',
      datasetId: value.datasetId,
      rowCount: value.rowCount,
      fields: value.fields,
      rows: Array.isArray(value.rows) ? value.rows.slice(0, 12) : [],
      source: value.source,
      empty: Boolean(value.empty),
      insight: value.insight,
    })
  }
  const chartType = value.chartType || 'table'
  const meta = omitUndefined({
    odKind: isTableChartType(chartType) ? 'answer_table' : 'answer_chart',
    answerId: value.answerId,
    title: value.title,
    chartType,
    datasetId: value.datasetId,
    rowCount: value.rowCount,
    fields: value.fields,
    rows: value.rows,
    source: value.source,
    presentAnswer: true,
  })
  if (value.empty) meta.empty = true
  if (value.insight) meta.insight = value.insight
  if (value.chartTypeSuggested) meta.chartTypeSuggested = value.chartTypeSuggested
  if (value.encode && typeof value.encode === 'object') meta.encode = value.encode
  const sqlHint = value.sqlHint || value.sql
  if (sqlHint) meta.sqlHint = String(sqlHint)
  attachSampleFields(meta, value)
  return meta
}

/**
 * Browser-safe board card meta — no full DashboardPatch ops.
 * @param {object} value - od_emit_patch result
 */
export function boardPresentationMeta(value) {
  if (value?.needClarify) {
    return { odKind: 'board_clarify', error: value.clarifyQuestion || 'clarify' }
  }
  if (value?.regenerate) {
    return { odKind: 'board_regenerate' }
  }
  if (!value?.ok) {
    return { odKind: 'board_error', error: value?.error || 'unknown' }
  }
  const dashboardId = value.dashboardId || null
  return omitUndefined({
    odKind: 'board_ready',
    dashboardId,
    title: value.title,
    chartCount: value.chartCount ?? 0,
    mode: value.mode || 'replace',
    editPath: dashboardId ? `/dashboards/${dashboardId}/edit` : null,
    source: value.source || 'java',
  })
}

/**
 * Parse dashboard id from spawn/commit text.
 * Child commit renders `board ready: 12 (8 charts)`.
 * The Lead spawn result is the worker's last sentence, e.g.
 * `看板已提交完成 ✅ 订单经营仪表盘（board 12 · 8 charts · ds_…）`.
 * @param {string} text
 * @returns {{ dashboardId: string, chartCount: number, title?: string } | null}
 */
export function parseBoardReadyFromText(text) {
  const raw = String(text || '')
  if (!raw.trim()) return null
  const titleMatch = raw.match(/✅\s*([^（(\n]+?)\s*[（(]/)
    || raw.match(/^\s*([^\n（(]{1,40}?)已生成完成/)
  const title = titleMatch ? titleMatch[1].trim() : undefined
  const readyEn = raw.match(/\bboard ready:\s*([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*\((\d+)\s*charts?\)/i)
  if (readyEn) {
    const chartCount = Number(readyEn[2])
    return {
      dashboardId: readyEn[1],
      chartCount: Number.isFinite(chartCount) ? chartCount : 0,
      ...(title ? { title } : {}),
    }
  }
  const readyZh = raw.match(/\bboard ready:\s*([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*[，,]\s*含\s*(\d+)\s*个图表/i)
  if (readyZh) {
    const chartCount = Number(readyZh[2])
    return {
      dashboardId: readyZh[1],
      chartCount: Number.isFinite(chartCount) ? chartCount : 0,
      ...(title ? { title } : {}),
    }
  }
  const compact = raw.match(/\bboard\s+([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*[·•・]\s*(\d+)\s*charts?/i)
  if (compact) {
    const chartCount = Number(compact[2])
    return {
      dashboardId: compact[1],
      chartCount: Number.isFinite(chartCount) ? chartCount : 0,
      ...(title ? { title } : {}),
    }
  }
  return null
}

/**
 * Lead spawn `od_board_worker` result → same board_ready / report_ready card
 * the child commit already produced. Child tool/result never reaches the
 * parent conversation event log.
 * @param {object} value - spawn foreground value `{ kind, runId, output }`
 * @param {{ consume?: () => object | null, expectedKind?: string }} [opts] - defaults to board-store consumePresentation
 */
export function spawnWorkerPresentationMeta(value, opts = {}) {
  const consume = opts.consume === undefined ? consumePresentation : opts.consume
  const text = spawnOutputText(value)
  const parsed = parseBoardReadyFromText(text)
  if (parsed) {
    return boardPresentationMeta({
      ok: true,
      dashboardId: parsed.dashboardId,
      chartCount: parsed.chartCount,
      title: parsed.title,
      source: 'board-worker',
    })
  }
  // Foreground output is scoped to this spawn call. Prefer it over the
  // process cache, which can still hold a previous turn when calls overlap.
  const stored = typeof consume === 'function' ? consume() : null
  if (stored && (stored.odKind === 'board_ready' || stored.odKind === 'report_ready')) {
    if (opts.expectedKind && stored.odKind !== opts.expectedKind) return {}
    return omitUndefined({ ...stored })
  }
  return {}
}

function spawnOutputText(value) {
  const blocks = Array.isArray(value?.output) ? value.output : []
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/** Browser-safe analysis-report card — snapshot HTML/MD, never a dashboardId. */
export function reportPresentationMeta(value) {
  if (!value?.ok) {
    return { odKind: 'report_error', error: value?.error || 'unknown' }
  }
  const meta = {
    odKind: 'report_ready',
    title: value.title,
    format: value.format || 'html',
    filename: value.filename,
    html: value.html,
    markdown: value.markdown,
    insightCount: value.insightCount,
    dashboardId: null,
    source: value.source || 'analysis-worker',
  }
  return omitUndefined(meta)
}

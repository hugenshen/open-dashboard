/**
 * Shared answer presentation meta for chat cards.
 * Includes SELECT sqlHint for the preview card (read-only, already gated).
 * Intermediate probes (presentAnswer=false) stay as collapsed tool cards — no chart node.
 * @module @opendashboard/dsh-od-bi/answer-meta
 */

import { resolveSampleMeta } from './sample-meta.js'

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
  return {
    odKind: 'board_ready',
    dashboardId,
    title: value.title,
    chartCount: value.chartCount ?? 0,
    mode: value.mode || 'replace',
    editPath: dashboardId ? `/dashboards/${dashboardId}/edit` : null,
    source: value.source || 'java',
  }
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

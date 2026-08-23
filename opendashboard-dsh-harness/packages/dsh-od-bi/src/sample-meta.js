/**
 * Sample / scale markers from Java chart/sql extra or sqlHint comments.
 * @module @opendashboard/dsh-od-bi/sample-meta
 */

const OD_SAMPLE_RE = /\/\*\s*od_sample\s+est=(-?\d+)\s+n=(\d+)\s*\*\//i
const OD_SCALED_RE = /\/\*\s*scaled\s+x([0-9.]+)(?:\s+est=(-?\d+)\s+n=(\d+))?\s*\*\//i

/**
 * @param {object} [extra]
 * @param {string} [sqlHint]
 * @returns {{ sampled: boolean, sampleN?: number, estRows?: number, scaleFactor?: number }}
 */
export function resolveSampleMeta(extra, sqlHint) {
  const out = { sampled: false }
  if (extra && typeof extra === 'object') {
    if (extra.sampled === true || extra.sampled === 'true') out.sampled = true
    if (extra.sampleN != null && Number.isFinite(Number(extra.sampleN))) {
      out.sampleN = Number(extra.sampleN)
      out.sampled = true
    }
    if (extra.estRows != null && Number.isFinite(Number(extra.estRows))) {
      out.estRows = Number(extra.estRows)
      out.sampled = true
    }
    if (extra.scaleFactor != null && Number.isFinite(Number(extra.scaleFactor))) {
      out.scaleFactor = Number(extra.scaleFactor)
      out.sampled = true
    }
  }
  const sql = sqlHint ? String(sqlHint) : ''
  if (sql) {
    const m = sql.match(OD_SAMPLE_RE)
    if (m) {
      out.sampled = true
      if (out.estRows == null) out.estRows = Number(m[1])
      if (out.sampleN == null) out.sampleN = Number(m[2])
    }
    const s = sql.match(OD_SCALED_RE)
    if (s) {
      out.sampled = true
      if (out.scaleFactor == null) out.scaleFactor = Number(s[1])
      if (s[2] != null && out.estRows == null) out.estRows = Number(s[2])
      if (s[3] != null && out.sampleN == null) out.sampleN = Number(s[3])
    }
  }
  return out
}

/** Attach sample fields onto a tool value (mutates copy via spread at call site). */
export function withSampleMeta(value, extra) {
  if (!value || typeof value !== 'object') return value
  const sqlHint = value.sqlHint || value.sql || ''
  const meta = resolveSampleMeta(extra || value.extra, sqlHint)
  if (!meta.sampled) return value
  return {
    ...value,
    sampled: true,
    sampleN: meta.sampleN,
    estRows: meta.estRows,
    scaleFactor: meta.scaleFactor,
  }
}

/** One-line warning for the LLM — do not treat scaled SUM/COUNT as exact full-table. */
export function sampleWarningForLlm(value) {
  if (!value?.sampled) return ''
  const parts = ['【采样估算 · 非全表精确】']
  if (value.sampleN != null) parts.push(`sampleN=${value.sampleN}`)
  if (value.estRows != null) parts.push(`estRows=${value.estRows}`)
  if (value.scaleFactor != null) parts.push(`scale×${value.scaleFactor}`)
  parts.push('正文禁止把 SUM/COUNT 说成全库精确累计；须标明采样估算。')
  return parts.join(' ')
}

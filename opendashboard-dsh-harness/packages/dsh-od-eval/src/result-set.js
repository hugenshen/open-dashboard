/**
 * BIRD-style execution accuracy: result-set equivalence (ignore column order).
 * @module @opendashboard/dsh-od-eval/result-set
 */

/** Normalize a cell for comparison. */
export function normalizeCell(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.round(v * 1e6) / 1e6
  }
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  if (s !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
    return Math.round(n * 1e6) / 1e6
  }
  return s
}

/**
 * @param {object[]} rows
 * @param {string[]} [columns]
 * @returns {string[]} sorted row fingerprints
 */
export function fingerprintRows(rows, columns) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const cols = columns?.length
    ? columns.map(String)
    : Object.keys(list[0] || {}).sort()
  return list.map((row) => {
    const cells = cols.map((c) => JSON.stringify(normalizeCell(row?.[c])))
    return cells.join('\t')
  }).sort()
}

/**
 * Execution Accuracy style compare.
 * @returns {{ ok: boolean, reason: string, predCount: number, goldCount: number }}
 */
export function compareResultSets(predRows, goldRows, opts = {}) {
  const predCols = opts.predColumns
  const goldCols = opts.goldColumns
  const p = fingerprintRows(predRows, predCols)
  const g = fingerprintRows(goldRows, goldCols)
  if (p.length !== g.length) {
    return {
      ok: false,
      reason: `row count ${p.length} !== gold ${g.length}`,
      predCount: p.length,
      goldCount: g.length,
    }
  }
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] !== g[i]) {
      return {
        ok: false,
        reason: `row mismatch at sorted index ${i}`,
        predCount: p.length,
        goldCount: g.length,
      }
    }
  }
  return { ok: true, reason: '', predCount: p.length, goldCount: g.length }
}

/**
 * P015: JoyAgent-style data_trans on a cached preview table (JSON rows, no pandas).
 * @module @opendashboard/dsh-od-bi/data-trans
 */

const TRANS_TYPES = new Set(['rate', 'rank', 'increase', 'sub_avg'])

export function isTransType(value) {
  return TRANS_TYPES.has(String(value || ''))
}

function toObjects(rows, fields = []) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const first = list[0]
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return list.map((row) => ({ ...row }))
  }
  const keys = (Array.isArray(fields) ? fields : [])
    .map((f) => (typeof f === 'string' ? f : (f?.name || f?.dataeaseName || f?.label)))
    .filter(Boolean)
  return list.map((row) => {
    const arr = Array.isArray(row) ? row : [row]
    const out = {}
    if (keys.length) {
      keys.forEach((k, i) => { out[k] = arr[i] })
      return out
    }
    arr.forEach((v, i) => { out[`c${i}`] = v })
    return out
  })
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Transform a preview table. Adds a derived column; does not invent chartType.
 * @returns {{ ok: boolean, rows: object[], derivedColumn?: string, error?: string }}
 */
export function transformRows(rows, { transType, column, measure, fields } = {}) {
  const kind = String(transType || '')
  if (!TRANS_TYPES.has(kind)) {
    return { ok: false, rows: [], error: `transType must be rate|rank|increase|sub_avg` }
  }
  const measureKey = String(measure || '')
  if (!measureKey) return { ok: false, rows: [], error: 'measure required' }
  const objs = toObjects(rows, fields)
  if (!objs.length) return { ok: false, rows: [], error: 'empty table' }
  const colKey = String(column || '')

  if (kind === 'rate') {
    const sum = objs.reduce((acc, row) => acc + (num(row[measureKey]) || 0), 0)
    const derived = `${measureKey}_rate`
    const next = objs.map((row) => ({
      ...row,
      [derived]: sum ? (num(row[measureKey]) || 0) / sum : 0,
    }))
    return { ok: true, rows: next, derivedColumn: derived }
  }

  if (kind === 'rank') {
    const derived = `${measureKey}_rank`
    const sorted = [...objs].sort((a, b) => (num(b[measureKey]) || 0) - (num(a[measureKey]) || 0))
    let last = null
    let rank = 0
    const ranks = new Map()
    for (const row of sorted) {
      const v = num(row[measureKey])
      if (v !== last) {
        rank += 1
        last = v
      }
      ranks.set(row, rank)
    }
    const next = objs.map((row) => ({ ...row, [derived]: ranks.get(row) }))
    return { ok: true, rows: next, derivedColumn: derived }
  }

  if (kind === 'increase') {
    if (!colKey) return { ok: false, rows: [], error: 'column required for increase' }
    const derived = `${measureKey}_increase`
    const sorted = [...objs].sort((a, b) => String(a[colKey] ?? '').localeCompare(String(b[colKey] ?? '')))
    let prev = null
    const next = sorted.map((row) => {
      const v = num(row[measureKey])
      const delta = prev == null || v == null ? null : v - prev
      prev = v
      return { ...row, [derived]: delta }
    }).filter((row) => row[derived] != null)
    return { ok: true, rows: next, derivedColumn: derived }
  }

  const mean = objs.reduce((acc, row) => acc + (num(row[measureKey]) || 0), 0) / objs.length
  const derived = `${measureKey}_sub_avg`
  const next = objs.map((row) => ({
    ...row,
    [derived]: (num(row[measureKey]) || 0) - mean,
  }))
  return { ok: true, rows: next, derivedColumn: derived }
}

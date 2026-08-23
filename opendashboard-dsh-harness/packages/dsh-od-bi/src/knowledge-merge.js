/**
 * Merge /dimensions confirmed knowledge into schema fields (P012 P0/P1).
 * Pure — no network.
 * @module @opendashboard/dsh-od-bi/knowledge-merge
 */

function fieldKey(f) {
  return String(f?.name || f?.dataeaseName || f?.field || '').trim()
}

/**
 * Map confirmed indicator agg → measureKind + aggDefault.
 * AVG/AVERAGE → ratio; SUM/COUNT/MIN/MAX → additive (COUNT still additive-ish for KPI).
 */
export function kindFromAgg(agg) {
  const a = String(agg || '').toUpperCase()
  if (a === 'AVG' || a === 'AVERAGE' || a === 'MEAN') return 'ratio'
  return 'additive'
}

export function normalizeAggDefault(agg) {
  const a = String(agg || '').toUpperCase()
  if (!a) return undefined
  if (a === 'AVERAGE' || a === 'MEAN') return 'avg'
  if (a === 'SUM') return 'sum'
  if (a === 'COUNT') return 'count'
  if (a === 'AVG') return 'avg'
  if (a === 'MIN') return 'min'
  if (a === 'MAX') return 'max'
  return a.toLowerCase()
}

/**
 * Build valueMap from glossary term.values (codes / labels).
 * Accepts [{value,label}|{code,name}|scalar].
 */
export function valuesToMap(values) {
  if (!Array.isArray(values) || !values.length) return undefined
  const map = {}
  for (const v of values) {
    if (v == null) continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      const code = v.value ?? v.code ?? v.key ?? v.id
      const label = v.label ?? v.name ?? v.text ?? v.alias
      if (code == null) continue
      map[String(code)] = label != null ? String(label) : String(code)
    } else {
      map[String(v)] = String(v)
    }
  }
  return Object.keys(map).length ? map : undefined
}

/**
 * @param {object[]} fields
 * @param {{ metrics?: object[], terms?: object[] }} knowledge
 * @returns {object[]} shallow-copied fields with measureKind / aggDefault / alias / valueMap
 */
export function mergeKnowledgeIntoFields(fields, knowledge) {
  const list = Array.isArray(fields) ? fields.map((f) => (f && typeof f === 'object' ? { ...f } : f)) : []
  const byName = new Map()
  for (const f of list) {
    const k = fieldKey(f)
    if (k) byName.set(k, f)
  }

  const metrics = Array.isArray(knowledge?.metrics) ? knowledge.metrics : []
  for (const m of metrics) {
    if (!m || typeof m !== 'object') continue
    const name = String(m.field || m.fieldName || '').trim()
    if (!name) continue
    const f = byName.get(name)
    if (!f) continue
    const agg = normalizeAggDefault(m.agg)
    if (agg) f.aggDefault = agg
    f.measureKind = kindFromAgg(m.agg)
    if (m.name && !f.alias) f.alias = String(m.name)
    if (m.unit) f.unitHint = String(m.unit)
    if (m.name && (!f.label || f.label === name)) f.label = String(m.name)
  }

  const terms = Array.isArray(knowledge?.terms) ? knowledge.terms : []
  for (const t of terms) {
    if (!t || typeof t !== 'object') continue
    const name = String(t.field || t.canonicalField || '').trim()
    if (!name) continue
    const f = byName.get(name)
    if (!f) continue
    const type = String(t.type || '').toLowerCase()
    if (type === 'metric' || type === 'measure') {
      if (!f.measureKind && t.agg) {
        f.aggDefault = normalizeAggDefault(t.agg)
        f.measureKind = kindFromAgg(t.agg)
      }
    }
    if (type === 'dimension' || type === 'dim') {
      const vm = valuesToMap(t.values)
      if (vm) f.valueMap = { ...(f.valueMap || {}), ...vm }
    }
    if (t.term && !f.alias) f.alias = String(t.term)
  }

  return list
}

/**
 * Coerce encode.agg when value field is ratio (ask path hard gate).
 * @returns {{ encode: object, coerced: boolean, reason?: string }}
 */
export function coerceEncodeAgg(encode, fields) {
  const enc = encode && typeof encode === 'object' ? { ...encode } : {}
  const value = String(enc.value || '').trim()
  if (!value) return { encode: enc, coerced: false }
  const list = Array.isArray(fields) ? fields : []
  const f = list.find((x) => fieldKey(x) === value)
  if (!f) return { encode: enc, coerced: false }
  const kind = String(f.measureKind || '').toLowerCase()
  const aggDef = String(f.aggDefault || '').toLowerCase()
  let agg = String(enc.agg || '').toUpperCase()
  if (kind === 'ratio' || aggDef === 'avg') {
    if (!agg || agg === 'SUM') {
      enc.agg = 'AVG'
      return { encode: enc, coerced: true, reason: `ratio field ${value} coerced SUM→AVG` }
    }
  }
  if (!agg && aggDef) {
    enc.agg = aggDef.toUpperCase()
    return { encode: enc, coerced: true, reason: `default agg ${aggDef}` }
  }
  return { encode: enc, coerced: false }
}

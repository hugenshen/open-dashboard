/**
 * Deterministic snapshot insights (JoyAgent InsightFactory analogue, no scipy).
 * @module @opendashboard/dsh-od-bi/insight
 */

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(String(v).replace(/,/g, ''))
    if (Number.isFinite(n)) return n
  }
  return null
}

function recordsOf(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) return { ...row }
    if (Array.isArray(row)) {
      const out = {}
      row.forEach((v, i) => { out[i === 0 ? 'label' : i === 1 ? 'value' : `c${i}`] = v })
      return out
    }
    return { value: row }
  })
}

function pickMeasure(records, measure) {
  if (measure && records[0] && measure in records[0] && num(records[0][measure]) != null) return measure
  const keys = records[0] ? Object.keys(records[0]) : []
  return keys.find((k) => num(records[0][k]) != null) || keys[1] || keys[0]
}

function pickLabel(records, measureKey) {
  const keys = records[0] ? Object.keys(records[0]) : []
  return keys.find((k) => k !== measureKey) || keys[0] || 'item'
}

function share(values, i) {
  const total = values.reduce((a, b) => a + Math.abs(b), 0)
  if (!total) return 0
  return values[i] / total
}

function mean(values) {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stdev(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length
  return Math.sqrt(v)
}

/**
 * @param {object[]} rows
 * @param {{ breakdown?: string, measure?: string }} [opts]
 * @returns {{ type: string, text: string, score: number, evidence: object }[]}
 */
export function computeInsights(rows, opts = {}) {
  const records = recordsOf(rows)
  if (records.length < 2) {
    return [{
      type: 'sparse',
      text: records.length ? '结果过少，无法做构成/趋势判断，仅作单点快照。' : '无聚合行，不能生成洞察。',
      score: 0,
      evidence: { rowCount: records.length },
    }]
  }
  const measureKey = pickMeasure(records, opts.measure)
  const labelKey = String(opts.breakdown || pickLabel(records, measureKey))
  const values = records.map((r) => num(r[measureKey])).filter((n) => n != null)
  if (values.length < 2) {
    return [{ type: 'sparse', text: '没有可用数值列。', score: 0, evidence: { measureKey } }]
  }
  const labels = records.map((r) => String(r[labelKey] ?? ''))
  const total = values.reduce((a, b) => a + b, 0)
  const maxI = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
  const minI = values.reduce((best, v, i) => (v < values[best] ? i : best), 0)
  const maxShare = share(values, maxI)
  const minShare = share(values, minI)
  const cv = Math.abs(mean(values)) > 1e-9 ? stdev(values) / Math.abs(mean(values)) : 0
  const out = []

  out.push({
    type: 'outstanding_first',
    text: `「${labels[maxI]}」最高，约占 ${((maxShare) * 100).toFixed(1)}%（${values[maxI]}）。`,
    score: maxShare,
    evidence: { label: labels[maxI], value: values[maxI], share: maxShare },
  })
  out.push({
    type: 'outstanding_last',
    text: `「${labels[minI]}」最低，约占 ${((minShare) * 100).toFixed(1)}%。`,
    score: 1 - minShare,
    evidence: { label: labels[minI], value: values[minI], share: minShare },
  })
  if (maxShare >= 0.5) {
    out.push({
      type: 'attribution',
      text: `头部「${labels[maxI]}」超过一半（${((maxShare) * 100).toFixed(1)}%），结构高度集中。`,
      score: maxShare,
      evidence: { head: labels[maxI], share: maxShare, total },
    })
  } else {
    out.push({
      type: 'attribution',
      text: `头部「${labels[maxI]}」占 ${((maxShare) * 100).toFixed(1)}%，未形成单一主导。`,
      score: maxShare,
      evidence: { head: labels[maxI], share: maxShare, total },
    })
  }
  out.push({
    type: 'evenness',
    text: cv < 0.25
      ? `各分项较均匀（变异系数 ${cv.toFixed(2)}）。`
      : `各分项差异大（变异系数 ${cv.toFixed(2)}）。`,
    score: cv,
    evidence: { cv },
  })

  if (values.length >= 3) {
    const first = values[0]
    const last = values[values.length - 1]
    const delta = last - first
    const pct = Math.abs(first) > 1e-9 ? delta / Math.abs(first) : 0
    out.push({
      type: 'trend',
      text: delta === 0
        ? `时序首尾持平（${first} → ${last}）。`
        : `时序从 ${first} ${delta > 0 ? '升' : '降'}至 ${last}（${(pct * 100).toFixed(1)}%）。`,
      score: Math.abs(pct),
      evidence: { first, last, pct },
    })
    let cp = 0
    let cpAbs = 0
    for (let i = 1; i < values.length; i += 1) {
      const d = Math.abs(values[i] - values[i - 1])
      if (d > cpAbs) {
        cpAbs = d
        cp = i
      }
    }
    out.push({
      type: 'change_point',
      text: `最大相邻变化发生在「${labels[cp - 1]}」→「${labels[cp]}」（${values[cp - 1]} → ${values[cp]}）。`,
      score: cpAbs,
      evidence: { from: labels[cp - 1], to: labels[cp], fromValue: values[cp - 1], toValue: values[cp] },
    })
  }

  return out
}

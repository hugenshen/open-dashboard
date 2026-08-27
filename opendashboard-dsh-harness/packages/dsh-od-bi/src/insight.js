/**
 * JoyAgent InsightFactory analogue (Microsoft Insight Types).
 * Methods are gated: only statistically/structurally significant items are returned.
 * @module @opendashboard/dsh-od-bi/insight
 */

export const INSIGHT_METHODS = Object.freeze([
  'OutstandingFirst',
  'OutstandingLast',
  'Attribution',
  'Evenness',
  'Trend',
  'Correlation',
  'ChangePoint',
])

const METHOD_SET = new Set(INSIGHT_METHODS.map((m) => m.toLowerCase()))
const SIGNIFICANCE = 0.01

export function normalizeInsightMethod(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const hit = INSIGHT_METHODS.find((m) => m.toLowerCase() === raw.toLowerCase())
  return hit || ''
}

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
  if (records[0] && 'value' in records[0] && num(records[0].value) != null) return 'value'
  const keys = records[0] ? Object.keys(records[0]) : []
  return keys.find((k) => num(records[0][k]) != null) || keys[1] || keys[0]
}

function pickLabel(records, measureKey) {
  if (records[0] && 'label' in records[0] && measureKey !== 'label') return 'label'
  const keys = records[0] ? Object.keys(records[0]) : []
  return keys.find((k) => k !== measureKey) || keys[0] || 'item'
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

function erf(x) {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * ax)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return sign * y
}

function normSf(x, loc = 0, scale = 1) {
  if (!(scale > 0)) return x > loc ? 0 : 1
  const z = (x - loc) / (scale * Math.SQRT2)
  return 0.5 * (1 - erf(z))
}

function linregress(values) {
  const n = values.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i += 1) {
    sumX += i
    sumY += values[i]
    sumXY += i * values[i]
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  if (!denom) return { slope: 0, intercept: n ? sumY / n : 0, r2: 0 }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const meanY = sumY / n
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i += 1) {
    const pred = slope * i + intercept
    ssRes += (values[i] - pred) ** 2
    ssTot += (values[i] - meanY) ** 2
  }
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 }
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i += 1) {
    const xa = a[i] - ma
    const xb = b[i] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  const den = Math.sqrt(da * db)
  return den ? num / den : 0
}

function fitPowerAlpha(xs, ys, beta = 0.7) {
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i += 1) {
    const xb = xs[i] ** (-beta)
    num += ys[i] * xb
    den += xb * xb
  }
  return den ? num / den : 0
}

function looksLikeSeries(labels) {
  if (!Array.isArray(labels) || labels.length < 3) return false
  const n = labels.filter((lab) => /^\d{4}([-/\s.]?\d{1,2}){0,2}$/.test(String(lab || '').trim())
    || /^\d{4}-\d{2}-\d{2}/.test(String(lab || ''))).length
  return n >= Math.ceil(labels.length * 0.7)
}

function looksLikeIdName(name) {
  const s = String(name || '')
  if (!s) return false
  if (/(type|status|channel|kind|cate|level|state|mchtype|merchant)/i.test(s)) return false
  return /^(id|pk)$/i.test(s) || /(PayOrderId|OrderId|order_id|RecordId|_pk)$/i.test(s)
}

/**
 * High-cardinality / primary-key slices cannot be analysed (JoyAgent: 禁止明细).
 */
export function looksLikeDetailDump(rows, category) {
  if (looksLikeIdName(category)) return true
  const recs = recordsOf(rows)
  if (recs.length < 20) return false
  const measureKey = pickMeasure(recs)
  const labelKey = pickLabel(recs, measureKey)
  const labels = new Set(recs.map((r) => String(r[labelKey] ?? '')))
  return labels.size / recs.length > 0.85
}

function keep(item) {
  if (!item) return null
  const sig = Number(item.significance)
  const score = Number(item.score)
  if (Number.isFinite(sig) && sig < SIGNIFICANCE) return null
  if (Number.isFinite(score) && score < SIGNIFICANCE) return null
  return item
}

function outstandingFirst(labels, values) {
  if (values.length < 3) return null
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
  const y = indexed.map((x) => x.v)
  const total = y.reduce((a, b) => a + b, 0)
  if (!(total > 0) || y[y.length - 1] < 0) return null
  const share = y[0] / total
  if (!(y[0] > y[1] + y[2]) || !(share > 0) || share >= 0.5) return null
  const maxI = indexed[0].i
  const bias = Math.min(...y)
  const xs = y.map((_, i) => i + 1)
  const alpha = fitPowerAlpha(xs.slice(1), y.slice(1).map((v) => v - bias))
  const pred = xs.map((x) => alpha * (x ** -0.7) + bias)
  const resid = y.map((v, i) => v - pred[i])
  const tail = resid.slice(1)
  const p = normSf(resid[0], mean(tail), stdev(tail) || 1e-9)
  return keep({
    type: 'OutstandingFirst',
    text: `「${labels[maxI]}」显著最高（${values[maxI]}），相对其余项偏离幂律拟合。`,
    score: (1 - p) * share,
    significance: 1 - p,
    evidence: { label: labels[maxI], value: values[maxI], share, pValue: p },
  })
}

function outstandingLast(labels, values) {
  if (values.length < 3) return null
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
  const y = indexed.map((x) => x.v)
  if (!(y[y.length - 1] < 0 && y[y.length - 1] < y[y.length - 2] + y[y.length - 3])) return null
  const minI = indexed[indexed.length - 1].i
  return keep({
    type: 'OutstandingLast',
    text: `「${labels[minI]}」显著最低（${values[minI]}）。`,
    score: Math.abs(values[minI]) / (Math.abs(mean(values)) || 1),
    significance: 0.8,
    evidence: { label: labels[minI], value: values[minI] },
  })
}

function attribution(labels, values) {
  if (values.length < 2) return null
  if (values.some((v) => v < 0)) return null
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  const maxI = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
  const share = values[maxI] / total
  if (share < 0.5) return null
  return keep({
    type: 'Attribution',
    text: `头部「${labels[maxI]}」为 ${values[maxI]}，约占 ${((share) * 100).toFixed(1)}%，对总体影响占据主导。`,
    score: share,
    significance: Math.min(0.99, share),
    evidence: { head: labels[maxI], value: values[maxI], share, total },
  })
}

function evenness(labels, values) {
  if (values.length < 3) return null
  if (!(values.every((v) => v >= 0) || values.every((v) => v < 0))) return null
  const total = values.reduce((a, b) => a + b, 0)
  if (!total) return null
  const p = values.map((v) => v / total)
  const shannon = -p.reduce((s, x) => s + (x > 0 ? x * Math.log(x) : 0), 0) / Math.log(values.length)
  if (shannon < 0.85) return null
  return keep({
    type: 'Evenness',
    text: `各分项分布较均匀（Shannon 均匀度 ${shannon.toFixed(2)}）。`,
    score: shannon,
    significance: shannon,
    evidence: { shannon, n: values.length },
  })
}

function trend(labels, values, series) {
  if (!series || values.length < 3) return null
  const fit = linregress(values)
  if (Math.abs(fit.slope) < 0.02) return null
  const rel = Math.abs(mean(values)) > 1e-9 ? Math.abs(fit.slope) * (values.length - 1) / Math.abs(mean(values)) : 0
  if (rel < 0.08 && fit.r2 < 0.5) return null
  const dir = fit.slope > 0 ? '上升' : '下降'
  return keep({
    type: 'Trend',
    text: `「${labels[0]}」→「${labels[labels.length - 1]}」呈${dir}趋势（斜率 ${fit.slope.toFixed(4)}，R² ${fit.r2.toFixed(2)}）。`,
    score: Math.min(0.99, fit.r2 * Math.min(1, rel)),
    significance: Math.min(0.99, fit.r2),
    evidence: { slope: fit.slope, intercept: fit.intercept, r2: fit.r2, first: values[0], last: values[values.length - 1] },
  })
}

function changePoint(labels, values, series) {
  if (!series || values.length < 5) return null
  let bestI = 0
  let bestK = 0
  const sd = stdev(values) || 1e-9
  for (let i = 2; i < values.length - 1; i += 1) {
    const left = mean(values.slice(0, i))
    const right = mean(values.slice(i))
    const k = Math.abs(left - right) / sd
    if (k > bestK) {
      bestK = k
      bestI = i
    }
  }
  if (bestK < 1.2) return null
  const p = 2 * normSf(bestK)
  return keep({
    type: 'ChangePoint',
    text: `在「${labels[bestI]}」处出现转折（${values[bestI - 1]} → ${values[bestI]}）。`,
    score: Math.min(0.99, 1 - p),
    significance: Math.min(0.99, 1 - p),
    evidence: { at: labels[bestI], from: labels[bestI - 1], fromValue: values[bestI - 1], toValue: values[bestI] },
  })
}

function correlation(labels, values, numericBreakdown) {
  if (!numericBreakdown || values.length < 6) return null
  const xs = labels.map((lab) => num(lab)).filter((n) => n != null)
  if (xs.length !== values.length) return null
  const r = pearson(xs, values)
  if (Math.abs(r) < 0.6) return null
  const dir = r > 0 ? '正' : '负'
  return keep({
    type: 'Correlation',
    text: `拆解维与指标呈${dir}相关（Pearson r=${r.toFixed(3)}）。`,
    score: Math.abs(r),
    significance: Math.abs(r),
    evidence: { r },
  })
}

function seriesOf(opts, labels) {
  if (opts.isSeries === true) return true
  if (opts.isSeries === false) return false
  return looksLikeSeries(labels)
}

/**
 * @param {object[]} rows
 * @param {{ breakdown?: string, measure?: string, analysisMethod?: string, isSeries?: boolean }} [opts]
 * @returns {{ type: string, text: string, score: number, evidence: object }[]}
 */
export function computeInsights(rows, opts = {}) {
  const records = recordsOf(rows)
  if (looksLikeDetailDump(records, opts.breakdown)) {
    return [{
      type: 'rejected',
      text: '该切片像明细/高基数 ID，不能做构成或趋势洞察。请换状态、渠道、类型等分类维重新取数。',
      score: 0,
      evidence: { rowCount: records.length, breakdown: opts.breakdown },
    }]
  }
  if (records.length < 2) {
    return [{
      type: 'sparse',
      text: records.length ? '结果过少，无法做构成/趋势判断。' : '无聚合行，不能生成洞察。',
      score: 0,
      evidence: { rowCount: records.length },
    }]
  }
  const method = normalizeInsightMethod(opts.analysisMethod)
  if (opts.analysisMethod && !method) {
    return [{
      type: 'rejected',
      text: `未知分析方法 ${opts.analysisMethod}。仅支持 ${INSIGHT_METHODS.join(' / ')}。`,
      score: 0,
      evidence: { analysisMethod: opts.analysisMethod },
    }]
  }
  const measureKey = pickMeasure(records, opts.measure)
  const labelKey = String(opts.breakdown || pickLabel(records, measureKey))
  const pairs = records.map((r) => ({ label: String(r[labelKey] ?? ''), value: num(r[measureKey]) }))
    .filter((p) => p.value != null)
  if (pairs.length < 2) {
    return [{ type: 'sparse', text: '没有可用数值列。', score: 0, evidence: { measureKey } }]
  }
  const labels = pairs.map((p) => p.label)
  const values = pairs.map((p) => p.value)
  const series = seriesOf(opts, labels)
  const numericBreakdown = pairs.every((p) => num(p.label) != null)

  const runners = {
    OutstandingFirst: () => outstandingFirst(labels, values),
    OutstandingLast: () => outstandingLast(labels, values),
    Attribution: () => attribution(labels, values),
    Evenness: () => evenness(labels, values),
    Trend: () => trend(labels, values, series),
    Correlation: () => correlation(labels, values, numericBreakdown),
    ChangePoint: () => changePoint(labels, values, series),
  }

  const wanted = method ? [method] : INSIGHT_METHODS
  const out = []
  for (const name of wanted) {
    const item = runners[name]?.()
    if (item && item.type !== 'rejected') out.push(item)
  }
  return out
}

export function insightNote(items, analysisMethod) {
  if (analysisMethod && METHOD_SET.has(String(analysisMethod).toLowerCase()) && !items.length) {
    return `无分析结论（${normalizeInsightMethod(analysisMethod)} 未通过显著性/形态门控）。换维、换指标或换分析方法。`
  }
  if (!items.length) return '无分析结论。可 od_python 做描述性统计，或换维再 od_get_data。'
  return `Insights are gated (JoyAgent InsightFactory). Next: od_save_insight only for useful items, or od_python / another analysis_method.`
}

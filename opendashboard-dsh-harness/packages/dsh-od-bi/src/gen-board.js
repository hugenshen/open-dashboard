/**
 * Deterministic board planning / review / layout (P012 M1 / M1.5).
 * Plan = enumerate analysis goals, then one chart per goal (LIDA-style).
 * Roles from schema group / learned profile. Weighting = user text ∩ field name/label.
 * measureKind (additive|ratio) binds goals; no business-word dictionaries.
 * @module @opendashboard/dsh-od-bi/gen-board
 */

export function fname(f) {
  return f?.dataeaseName || f?.name || f?.label || ''
}

export function flabel(f) {
  let raw = f?.label || f?.name || fname(f)
  const normalized = String(raw).replace(/，/g, ',')
  const comma = normalized.indexOf(',')
  if (comma > 0) {
    const head = normalized.slice(0, comma).trim()
    if (head) raw = head
  }
  const colon = String(raw).indexOf(':')
  if (colon > 1) {
    const head = String(raw).slice(0, colon).trim()
    if (head) return head
  }
  return raw
}

export function semanticRole(f) {
  const r = String(f?.role || '').toLowerCase()
  if (r === 'junk' || r === 'text' || r === 'id') return 'junk'
  if (r === 'flag') return 'dim'
  if (r === 'measure' || r === 'quota') return 'measure'
  if (r === 'time') return 'time'
  if (r === 'dim' || r === 'dimension') return 'dim'
  const g = String(f?.group || '').toLowerCase()
  if (g === 't' || g === 'time') return 'time'
  // Code-like dims (Status / *Type / 渠道) often stored as DECIMAL — prefer dim over measure.
  const n = String(fname(f)).toLowerCase()
  const lab = `${flabel(f)} ${f?.label || ''}`
  if (
    n === 'status' || n.endsWith('status') || n.endsWith('type') || n.endsWith('code')
    || (/类型|状态|渠道|方式|等级/.test(lab) && !/金额|费率|收入|数量|笔数|合计/.test(lab))
  ) {
    return 'dim'
  }
  if (g === 'q' || g === 'measure' || g === 'quota') return 'measure'
  if (g === 'd' || g === 'dim' || g === 'dimension') return 'dim'
  const dt = String(f?.dataType || f?.deType || '').toUpperCase()
  if (dt.includes('TIME') || dt.includes('DATE')) return 'time'
  if (['INT', 'BIGINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'LONG'].some((x) => dt.includes(x))) {
    return 'measure'
  }
  return 'dim'
}

function overlapScore(message, f) {
  const q = String(message || '').trim()
  if (!q || !f) return 0
  const blob = `${fname(f)} ${flabel(f)} ${f?.label || ''}`.toLowerCase()
  let hits = 0
  const lower = q.toLowerCase()
  for (const w of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 2 && blob.includes(w)) hits += w.length
  }
  const cjk = q.replace(/[^\u4e00-\u9fff]/g, '')
  if (cjk.length >= 2 && blob.includes(cjk)) hits += cjk.length
  for (let i = 0; i + 2 <= cjk.length; i++) {
    const gram = cjk.slice(i, i + 2)
    if (blob.includes(gram)) hits += 2
  }
  return hits
}

function mergeProfile(fields, profile) {
  const stats = new Map()
  const rows = Array.isArray(profile?.fields) ? profile.fields : []
  for (const p of rows) {
    const n = p?.name || p?.fieldName
    if (n) stats.set(String(n), p)
  }
  return (Array.isArray(fields) ? fields : []).map((f) => {
    const p = stats.get(fname(f))
    if (!p) return { ...f }
    return {
      ...f,
      role: f.role || p.role || p.roleLearned,
      distinctCount: f.distinctCount ?? p.distinctCount,
      numericMin: f.numericMin ?? p.numericMin,
      numericMax: f.numericMax ?? p.numericMax,
      nullRate: f.nullRate ?? p.nullRate,
    }
  })
}

function fieldIndex(fields) {
  const by = new Map()
  for (const f of fields || []) {
    const n = fname(f)
    if (n) by.set(n, f)
  }
  return by
}

function pickByRole(list, role, message, limit) {
  return [...list]
    .filter((f) => semanticRole(f) === role)
    .map((f, i) => ({ f, i, hit: overlapScore(message, f) }))
    .sort((a, b) => (b.hit - a.hit) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.f)
}

function isSingleMode(message) {
  return /只要一张|单图|一个KPI|只要一个KPI/i.test(String(message || ''))
}

function wantsNoPie(message) {
  return /去掉饼|不要饼|删掉?饼|无饼|取消饼|去掉占比/i.test(String(message || ''))
}

function wantsMultiCompare(message) {
  const m = String(message || '')
  return /两个柱|两张柱|再加.*对比|以及.*对比|\+.*对比|和.*对比/.test(m)
    || ((/支付状态|Status/i.test(m)) && (/渠道|ChannelType/i.test(m)))
}

/**
 * additive | ratio — used when binding goals. No business-word ban lists.
 * @param {object} f
 */
export function measureKind(f) {
  if (!f) return 'additive'
  const explicit = String(f.measureKind || '').toLowerCase()
  if (explicit === 'additive' || explicit === 'ratio') return explicit
  const aggDef = String(f.aggDefault || f.defaultAgg || '').toLowerCase()
  if (aggDef === 'avg' || aggDef === 'average' || aggDef === 'mean') return 'ratio'
  if (isFenMeasure(f)) return 'additive'
  const min = Number(f.numericMin)
  const max = Number(f.numericMax)
  if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
    if (min >= 0 && max <= 1) return 'ratio'
    if (min >= 0 && max <= 100 && max - min <= 100) {
      const blob = `${fname(f)} ${flabel(f)} ${f?.label || ''}`.toLowerCase()
      if (/率|占比|比例|rate|ratio|pct|percent/.test(blob)) return 'ratio'
    }
  }
  const blob = `${fname(f)} ${flabel(f)} ${f?.label || ''}`.toLowerCase()
  if (/率|占比|比例|rate|ratio|pct|percent/.test(blob)) return 'ratio'
  return 'additive'
}

function encodeOf(datasetId, valueField, agg, categoryField) {
  const encode = {
    datasetId,
    value: fname(valueField),
    y: [fname(valueField)],
    agg,
  }
  if (categoryField) {
    encode.category = fname(categoryField)
    encode.x = [fname(categoryField)]
  }
  return encode
}

function lowCardDim(f) {
  if (!f) return false
  const n = f.distinctCount
  // Only reject high-cardinality dims. Keep n=1 (e.g. single ChannelType) bindable.
  if (n != null && n > 20) return false
  return true
}

/**
 * Resolve a goal dim/measure ref to a real field name (exact, case, or label).
 * @param {string} ref
 * @param {object[]} fields
 * @param {Set<string>} [allowed]
 */
export function resolveFieldRef(ref, fields, allowed) {
  const r = String(ref || '').trim()
  if (!r) return ''
  const list = Array.isArray(fields) ? fields : []
  const allow = allowed instanceof Set ? allowed : null
  const candidates = list.filter((f) => {
    const n = fname(f)
    return n && (!allow || allow.has(n))
  })
  for (const f of candidates) {
    if (fname(f) === r) return fname(f)
  }
  const lower = r.toLowerCase()
  for (const f of candidates) {
    if (fname(f).toLowerCase() === lower) return fname(f)
  }
  for (const f of candidates) {
    const lab = flabel(f)
    if (lab === r) return fname(f)
  }
  // Prefer longer label matches to avoid 类型 → MchType beating 渠道类型 → ChannelType
  let best = null
  let bestScore = 0
  for (const f of candidates) {
    const lab = flabel(f)
    const blob = `${fname(f)} ${lab} ${f?.label || ''}`
    if (!lab) continue
    let score = 0
    if (blob.includes(r) || r.includes(lab)) score = Math.min(r.length, lab.length)
    if (score > bestScore) {
      bestScore = score
      best = fname(f)
    }
  }
  return best || ''
}

/**
 * Enumerate analysis goals (LIDA-style), then bind each to one chart.
 * @param {string} datasetId
 * @param {object[]} fields
 * @param {{ message?: string, profile?: object, datasetName?: string }} [opts]
 * @returns {{ goals: object[], charts: object[], list: object[], dims: object[], time: object|null }}
 */
export function enumerateGoals(datasetId, fields, opts) {
  const message = opts?.message || ''
  const datasetName = opts?.datasetName || ''
  const list = mergeProfile(fields, opts?.profile)
  const dims = pickByRole(list, 'dim', message, 3).filter(lowCardDim)
  const times = pickByRole(list, 'time', message, 1)
  const measures = pickByRole(list, 'measure', message, 4)
  const additive = measures.filter((m) => measureKind(m) === 'additive')
  const ratios = measures.filter((m) => measureKind(m) === 'ratio')
  const time = times[0] || null
  const dim = dims[0] || null
  const m0 = additive[0] || null
  const goals = []

  const countKey = dim || time
  if (countKey) {
    const title = countKpiTitle(datasetName, list, message)
    goals.push({
      intent: 'kpi_count',
      question: title === '订单数' ? '订单数有多少？' : '记录数有多少？',
      type: 'kpi',
      title,
      datasetId,
      encode: encodeOf(datasetId, countKey, 'count'),
    })
  }

  for (const m of additive.slice(0, countKey ? 2 : 3)) {
    goals.push({
      intent: 'kpi_sum',
      question: `${flabel(m)}合计是多少？`,
      type: 'kpi',
      title: flabel(m),
      datasetId,
      encode: encodeOf(datasetId, m, 'sum'),
    })
  }

  for (const m of ratios.slice(0, 1)) {
    goals.push({
      intent: 'kpi_ratio',
      question: `${flabel(m)}平均水平如何？`,
      type: 'kpi',
      title: `${flabel(m)}（均值）`,
      datasetId,
      encode: encodeOf(datasetId, m, 'avg'),
    })
  }

  if (dim && m0) {
    const compareDims = wantsMultiCompare(message) ? dims.slice(0, 2) : [dim]
    for (const d of compareDims) {
      if (!d || !lowCardDim(d)) continue
      goals.push({
        intent: 'compare',
        question: `各${flabel(d)}下的${flabel(m0)}对比`,
        type: 'bar',
        title: `各${flabel(d)}下的${flabel(m0)}对比`,
        datasetId,
        encode: encodeOf(datasetId, m0, 'sum', d),
      })
    }
  }

  if (dim && lowCardDim(dim) && !wantsNoPie(message)) {
    goals.push({
      intent: 'compose',
      question: `${flabel(dim)}构成占比`,
      type: 'pie',
      title: `${flabel(dim)}构成占比`,
      datasetId,
      encode: encodeOf(datasetId, dim, 'count', dim),
    })
  }

  if (m0 && time && looksDayBucket(time)) {
    goals.push({
      intent: 'trend',
      question: `${flabel(time)}走势 · ${flabel(m0)}`,
      type: 'line',
      title: `${flabel(time)}走势 · ${flabel(m0)}`,
      datasetId,
      encode: encodeOf(datasetId, m0, 'sum', time),
    })
  }

  if (dim && m0) {
    goals.push({
      intent: 'table',
      question: `按${flabel(dim)}汇总${flabel(m0)}`,
      type: 'grouptable',
      title: `按${flabel(dim)}汇总${flabel(m0)}`,
      datasetId,
      encode: encodeOf(datasetId, m0, 'sum', dim),
    })
  }

  if (!goals.length && list.length) {
    const anyMeas = list.find((f) => semanticRole(f) === 'measure') || list[0]
    const anyDim = list.find((f) => semanticRole(f) === 'dim' && f !== anyMeas)
    if (anyMeas && measureKind(anyMeas) === 'ratio') {
      goals.push({
        intent: 'kpi_ratio',
        question: `${flabel(anyMeas)}平均水平如何？`,
        type: 'kpi',
        title: `${flabel(anyMeas)}（均值）`,
        datasetId,
        encode: encodeOf(datasetId, anyMeas, 'avg'),
      })
    } else if (anyMeas) {
      goals.push({
        intent: 'kpi_sum',
        question: `${flabel(anyMeas)}合计是多少？`,
        type: 'kpi',
        title: flabel(anyMeas),
        datasetId,
        encode: encodeOf(datasetId, anyMeas, 'sum'),
      })
    }
    if (anyMeas && anyDim && measureKind(anyMeas) === 'additive') {
      goals.push({
        intent: 'compare',
        question: `各${flabel(anyDim)}下的${flabel(anyMeas)}对比`,
        type: 'bar',
        title: `各${flabel(anyDim)}下的${flabel(anyMeas)}对比`,
        datasetId,
        encode: encodeOf(datasetId, anyMeas, 'sum', anyDim),
      })
    }
  }

  return { goals, list, dims, time }
}

function chartsFromGoals(goals) {
  return (goals || []).map((g) => ({
    type: g.type,
    title: g.title || g.question,
    question: g.question,
    intent: g.intent,
    datasetId: g.datasetId,
    encode: g.encode,
  }))
}

/**
 * @param {string} datasetId
 * @param {object[]} fields
 * @param {{ message?: string, profile?: object, datasetName?: string }} [opts]
 */
export function planChartsFromFields(datasetId, fields, opts) {
  const message = opts?.message || ''
  const { goals, list, dims, time } = enumerateGoals(datasetId, fields, opts)
  let outCharts = chartsFromGoals(goals)
  if (isSingleMode(message) && outCharts.length) {
    const one = outCharts.find((c) => c.type === 'kpi') || outCharts[0]
    outCharts = [one]
  }

  const reviewed = reviewCharts(outCharts, {
    fields: list,
    profile: opts?.profile,
    message,
  })
  const query = buildQuery(time, dims, list)
  return { charts: reviewed, query, goals }
}

function countKpiTitle(datasetName, fields, message) {
  const blob = `${datasetName} ${message} ${(fields || []).map((f) => `${fname(f)} ${flabel(f)}`).join(' ')}`
  if (blob.includes('订单') && /订单/.test(String(message || ''))) return '订单数'
  return '记录数'
}

function buildQuery(time, dims, fields) {
  const items = []
  if (time) {
    const item = { type: 'date-range', field: fname(time), label: flabel(time) }
    const from = formatDateBound(time.numericMin)
    const to = formatDateBound(time.numericMax)
    if (from) item.fromDefault = from
    if (to) item.toDefault = to
    items.push(item)
  }
  for (const d of dims || []) {
    if (items.length >= 3) break
    if (time && fname(d) === fname(time)) continue
    const n = d.distinctCount
    if (n != null && (n < 2 || n > 15)) continue
    items.push({ type: 'select', field: fname(d), label: flabel(d) })
  }
  return items.length ? { label: '查询条件', items } : null
}

export function formatDateBound(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    let ms = null
    if (raw > 1e12) ms = raw
    else if (raw > 1e9) ms = raw * 1000
    if (ms == null) return null
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (!Number.isNaN(d.getTime()) && s.length >= 8) return d.toISOString().slice(0, 10)
  return null
}

function categoryOf(chart) {
  return String(chart?.encode?.category || chart?.encode?.x?.[0] || '')
}

function valueOf(chart) {
  return String(chart?.encode?.value || chart?.encode?.y?.[0] || '')
}

function looksDayBucket(f) {
  const n = String(fname(f)).toLowerCase()
  const l = `${flabel(f)}${f?.label || ''}`
  return n.includes('day') || n.includes('month') || n === 'dt' || l.includes('日期') || l.includes('月份')
}

function looksRawTimestamp(f) {
  if (!f) return false
  if (looksDayBucket(f)) return false
  const n = String(fname(f)).toLowerCase()
  const l = `${flabel(f)}${f?.label || ''}`
  return n.includes('timestamp') || n.includes('time') || l.includes('时间')
}

function isFenMeasure(f) {
  const l = String(f?.label || '')
  return l.includes('单位分') || /单位\s*[:：]?\s*分/.test(l)
}

/**
 * 分 → 元，再按数量级 / 用户原文选万、亿展示（不改查询语义）。
 * @returns {{ formatter: object, axisUnit?: string, valueSuffix?: string } | null}
 */
export function fenDisplayStyle(f, message, sampleMax) {
  if (!isFenMeasure(f)) return null
  const msg = String(message || '')
  const rawMax = sampleMax != null ? Number(sampleMax) : Number(f?.numericMax)
  const yuanMax = Number.isFinite(rawMax) ? Math.abs(rawMax) * 0.01 : null
  let axisUnit = 'none'
  let valueSuffix = '元'
  if (/亿\s*元|单位.?亿|按亿/.test(msg)) {
    axisUnit = 'yi'
    valueSuffix = ''
  } else if (/万\s*元|单位.?万|按万/.test(msg)) {
    axisUnit = 'wan'
    valueSuffix = ''
  } else if (yuanMax != null) {
    if (yuanMax >= 1e8) {
      axisUnit = 'yi'
      valueSuffix = ''
    } else if (yuanMax >= 1e4) {
      axisUnit = 'wan'
      valueSuffix = ''
    }
  }
  return {
    formatter: { unit: 0.01, suffix: '元' },
    axisUnit,
    valueSuffix,
  }
}

function chartSignature(c) {
  return [
    String(c?.type || ''),
    categoryOf(c),
    valueOf(c),
    String(c?.encode?.agg || '').toLowerCase(),
  ].join('|')
}

function attachFieldAliases(chart, byName) {
  const enc = chart.encode && typeof chart.encode === 'object' ? { ...chart.encode } : {}
  const cfg = enc.fieldCfg && typeof enc.fieldCfg === 'object' ? { ...enc.fieldCfg } : {}
  for (const key of [valueOf(chart), categoryOf(chart)].filter(Boolean)) {
    const f = byName.get(key)
    if (!f) continue
    const entry = { ...(cfg[key] || {}) }
    const alias = f.alias || flabel(f)
    if (alias && alias !== key) entry.alias = alias
    if (f.valueMap && typeof f.valueMap === 'object' && !Array.isArray(f.valueMap)) {
      entry.valueMap = { ...f.valueMap }
    }
    if (Object.keys(entry).length) cfg[key] = entry
  }
  if (Object.keys(cfg).length) enc.fieldCfg = cfg
  chart.encode = enc
}

/**
 * Capability card for LLM Goal planning (M1.6). Deterministic from enriched fields.
 */
export function buildCapabilityCard(datasetId, fields, opts = {}) {
  const list = mergeProfile(fields, opts.profile)
  const message = opts.message || ''
  const dims = pickByRole(list, 'dim', message, 8).filter(lowCardDim).map((f) => ({
    field: fname(f),
    label: flabel(f),
    distinctCount: f.distinctCount ?? null,
    valueMap: f.valueMap || undefined,
  }))
  const measures = pickByRole(list, 'measure', message, 12)
  const additive = measures.filter((m) => measureKind(m) === 'additive').map((f) => ({
    field: fname(f),
    label: flabel(f),
    aggDefault: f.aggDefault || 'sum',
    unitHint: f.unitHint || (isFenMeasure(f) ? 'fen' : undefined),
  }))
  const ratio = measures.filter((m) => measureKind(m) === 'ratio').map((f) => ({
    field: fname(f),
    label: flabel(f),
    aggDefault: f.aggDefault || 'avg',
  }))
  const time = pickByRole(list, 'time', message, 2).map((f) => ({
    field: fname(f),
    label: flabel(f),
    dayBucket: looksDayBucket(f),
  }))
  const junk = list.filter((f) => semanticRole(f) === 'junk').map((f) => fname(f))
  return {
    datasetId,
    datasetName: opts.datasetName || '',
    userMessage: message,
    dims,
    additive,
    ratio,
    time,
    junk,
    rules: [
      'compare/table value only from additive; agg=sum|count',
      'ratio only kpi_ratio with agg=avg; never SUM with dim',
      'compose default category=dim agg=count',
      'trend only when time.dayBucket=true',
      'do not use junk fields',
      'prefer 3–6 goals ordered by theme relevance',
    ],
  }
}

/**
 * Bind LLM (or rule) goals onto legal encode using capability card / fields.
 * Drops illegal goals; never invents fields outside card.
 */
export function bindGoals(datasetId, goals, fields, opts = {}) {
  const card = opts.capabilityCard || buildCapabilityCard(datasetId, fields, opts)
  const list = mergeProfile(fields, opts.profile)
  const additiveSet = new Set((card.additive || []).map((x) => x.field))
  const ratioSet = new Set((card.ratio || []).map((x) => x.field))
  const dimSet = new Set((card.dims || []).map((x) => x.field))
  const timeSet = new Set((card.time || []).map((x) => x.field))
  // Explicit binds may target dims omitted from the LLM card (e.g. distinctCount=1).
  for (const f of list) {
    const n = fname(f)
    if (!n) continue
    if (semanticRole(f) === 'dim') dimSet.add(n)
    if (semanticRole(f) === 'time') timeSet.add(n)
    if (semanticRole(f) === 'measure' && measureKind(f) === 'additive') additiveSet.add(n)
    if (semanticRole(f) === 'measure' && measureKind(f) === 'ratio') ratioSet.add(n)
  }
  const junkSet = new Set(card.junk || [])
  const byName = fieldIndex(list)
  const out = []
  for (const raw of Array.isArray(goals) ? goals : []) {
    if (!raw || typeof raw !== 'object') continue
    const intent = String(raw.intent || '')
    const type = String(raw.chartType || raw.type || 'bar')
    let value = resolveFieldRef(
      String(raw.encode?.value || raw.measure || raw.valueField || '').trim(),
      list,
      new Set([...additiveSet, ...ratioSet, ...dimSet, ...timeSet]),
    )
    let category = resolveFieldRef(
      String(raw.encode?.category || raw.dim || raw.categoryField || '').trim(),
      list,
      new Set([...dimSet, ...timeSet]),
    )
    let agg = String(raw.encode?.agg || raw.agg || '').toLowerCase()
    if (junkSet.has(value) || junkSet.has(category)) continue
    // degrade ratio SUM compare → kpi_ratio
    if ((intent === 'compare' || type === 'bar' || intent === 'table' || type === 'grouptable')
        && ratioSet.has(value)) {
      out.push({
        intent: 'kpi_ratio',
        question: raw.question || `${flabel(byName.get(value))}平均水平如何？`,
        type: 'kpi',
        title: raw.title || `${flabel(byName.get(value))}（均值）`,
        datasetId,
        encode: encodeOf(datasetId, byName.get(value) || { name: value }, 'avg'),
      })
      continue
    }
    if (intent === 'kpi_ratio' || (ratioSet.has(value) && type === 'kpi')) {
      if (!ratioSet.has(value) && !additiveSet.has(value)) continue
      if (!ratioSet.has(value)) continue
      agg = 'avg'
      category = ''
    } else if (intent === 'compose' || type === 'pie') {
      if (!dimSet.has(category) && dimSet.has(value)) category = value
      if (!dimSet.has(category)) continue
      value = category
      agg = 'count'
    } else if (intent === 'compare' || type === 'bar' || type === 'grouptable' || intent === 'table') {
      if (!additiveSet.has(value)) continue
      if (category && !dimSet.has(category)) continue
      agg = agg === 'count' ? 'count' : 'sum'
    } else if (intent === 'trend' || type === 'line') {
      if (!additiveSet.has(value)) continue
      const t = card.time?.find((x) => x.field === category)
      if (!t?.dayBucket) continue
      agg = 'sum'
    } else if (intent === 'kpi_count') {
      const key = category || value
      if (!dimSet.has(key) && !timeSet.has(key)) continue
      value = key
      category = ''
      agg = 'count'
    } else if (intent === 'kpi_sum' || type === 'kpi') {
      if (!additiveSet.has(value)) continue
      agg = 'sum'
      category = ''
    } else {
      continue
    }
    const vf = byName.get(value)
    const cf = category ? byName.get(category) : null
    out.push({
      intent: intent || type,
      question: raw.question || raw.title || `${type}:${value}`,
      type,
      title: raw.title || raw.question || flabel(vf) || value,
      datasetId,
      encode: encodeOf(datasetId, vf || { name: value }, agg, cf || (category ? { name: category } : null)),
    })
  }
  return out
}

/**
 * Deterministic review. Mutates copies; never live-queries.
 * @param {object[]} charts
 * @param {{ fields?: object[], profile?: object }} [ctx]
 */
export function reviewCharts(charts, ctx) {
  const fields = mergeProfile(ctx?.fields || [], ctx?.profile)
  const byName = fieldIndex(fields)
  let next = (Array.isArray(charts) ? charts : [])
    .filter((c) => c && valueOf(c))
    .map((c) => structuredClone(c))

  // R8 junk / empty measure
  next = next.filter((c) => {
    const vf = byName.get(valueOf(c))
    if (!vf) return true
    if (semanticRole(vf) === 'junk') return false
    if (vf.role === 'junk') return false
    return true
  })

  // R4 strip unimplemented yoy/mom
  for (const c of next) {
    if (!c.encode || typeof c.encode !== 'object') continue
    delete c.encode.yoy
    delete c.encode.mom
    delete c.encode.compare
  }

  // R5 table → grouptable
  for (const c of next) {
    if (c.type === 'table' && categoryOf(c) && valueOf(c)) c.type = 'grouptable'
  }

  // R0 user asked to drop pie
  if (wantsNoPie(ctx?.message)) {
    next = next.filter((c) => c.type !== 'pie' && c.type !== 'donut')
  }

  // R1 same-dim bar + pie only when same value+agg (compare SUM vs compose COUNT may both stay)
  const bars = next.filter((c) => c.type === 'bar')
  next = next.filter((c) => {
    if (c.type !== 'pie') return true
    const cat = categoryOf(c)
    const twin = bars.find((b) => (
      categoryOf(b) === cat
      && valueOf(b) === valueOf(c)
      && String(b.encode?.agg || '').toLowerCase() === String(c.encode?.agg || '').toLowerCase()
    ))
    if (!twin) return true
    const f = byName.get(cat)
    const n = f?.distinctCount
    if (n != null && n < 6) {
      twin._dropForPie = true
      return true
    }
    return false
  })
  next = next.filter((c) => !c._dropForPie)

  // R10 ratio must not be SUM value on compare/compose/table → drop (kpi_ratio already AVG)
  next = next.filter((c) => {
    const t = String(c.type || '')
    if (!['bar', 'hbar', 'pie', 'donut', 'column', 'grouptable', 'table', 'line', 'area'].includes(t)) {
      return true
    }
    const vf = byName.get(valueOf(c))
    if (!vf) return true
    const agg = String(c.encode?.agg || '').toLowerCase()
    if (measureKind(vf) === 'ratio' && (agg === 'sum' || agg === '')) return false
    return true
  })

  // R2 high-cardinality pie
  next = next.flatMap((c) => {
    if (c.type !== 'pie') return [c]
    const f = byName.get(categoryOf(c))
    const n = f?.distinctCount
    if (n != null && n > 20) {
      return [{
        ...c,
        type: 'grouptable',
        title: `${flabel(f) || categoryOf(c)} 汇总`,
        encode: { ...c.encode, resultLimit: 12 },
      }]
    }
    return [c]
  })

  // R3 raw timestamp line → drop (no day-bucket runtime)
  next = next.filter((c) => {
    if (c.type !== 'line' && c.type !== 'area') return true
    const f = byName.get(categoryOf(c))
    if (!f) {
      // Unknown axis: if title/encode name smells like raw time, drop.
      const axis = categoryOf(c).toLowerCase()
      if (axis.includes('time') || axis.includes('timestamp')) return false
      return true
    }
    if (looksDayBucket(f)) return true
    if (looksRawTimestamp(f)) return false
    const n = f.distinctCount
    if (n != null && n > 60) return false
    return true
  })

  // At most one trend line/area
  let sawTrend = false
  next = next.filter((c) => {
    if (c.type !== 'line' && c.type !== 'area') return true
    if (sawTrend) return false
    sawTrend = true
    return true
  })

  // At most two half-width compare charts (bar/pie/…)
  const halfTypes = new Set(['bar', 'hbar', 'pie', 'donut', 'column'])
  let halfCount = 0
  next = next.filter((c) => {
    const t = String(c.type || '')
    if (!halfTypes.has(t)) return true
    if (halfCount >= 2) return false
    halfCount += 1
    return true
  })

  // R6 at most 1 grouptable (template: one summary table under plots)
  const tables = []
  next = next.filter((c) => {
    if (c.type !== 'grouptable' && c.type !== 'table') return true
    if (tables.length >= 1) return false
    tables.push(c)
    return true
  })

  // R9 exact duplicate charts (same type+encode) — keep first
  const seenSig = new Set()
  next = next.filter((c) => {
    const sig = chartSignature(c)
    if (seenSig.has(sig)) return false
    seenSig.add(sig)
    return true
  })

  // R7 单位分 → formatter + 友好轴单位；字段别名写入 encode.fieldCfg
  const message = ctx?.message || ''
  for (const c of next) {
    const vf = byName.get(valueOf(c))
    const disp = fenDisplayStyle(vf, message)
    if (disp) {
      c.style = {
        ...(c.style || {}),
        formatter: disp.formatter,
        axisUnit: disp.axisUnit || c.style?.axisUnit || 'none',
        valueSuffix: disp.valueSuffix != null ? disp.valueSuffix : (c.style?.valueSuffix || ''),
      }
    }
    attachFieldAliases(c, byName)
  }

  return next
}

/**
 * Plan + review + layout in one shot (same path as od_generate_board).
 */
export function buildReviewedBoard(input) {
  const planned = planChartsFromFields(input.datasetId, input.fields, {
    message: input.message,
    profile: input.profile,
    datasetName: input.datasetName,
  })
  if (!planned.charts.length) {
    return { ok: false, error: 'could not plan charts from schema', charts: [], query: null }
  }
  const layout = layoutBoardPatch({
    title: input.title,
    styleId: input.styleId,
    charts: planned.charts,
    query: planned.query,
  })
  return { ...layout, charts: planned.charts, query: planned.query, goals: planned.goals }
}

/**
 * @param {{ title?: string, styleId?: string, charts: object[], query?: object }} input
 */
export function layoutBoardPatch(input) {
  const charts = Array.isArray(input.charts) ? input.charts : []
  if (!charts.length) {
    return { ok: false, error: 'charts required: [{type,title,datasetId,encode}]' }
  }
  const styleId = input.styleId || 'feishu-blue'
  const title = input.title || 'AI 生成看板'
  let queryItems = []
  const query = input.query
  if (Array.isArray(query)) queryItems = query
  else if (query && typeof query === 'object') queryItems = listOrEmpty(query.items)

  const ops = [
    { op: 'set_layout', gridCols: 72, themeRef: 'default' },
    { op: 'set_theme', styleId },
  ]

  const base = Date.now() % 1_000_000_000
  let seq = 1

  if (queryItems.length) {
    ops.push({
      op: 'upsert_component',
      id: String(base),
      type: 'query',
      x: 0,
      y: 0,
      w: 72,
      h: 8,
      props: { label: (query && query.label) || '查询条件', items: queryItems },
    })
    seq += 1
  }

  const kpis = charts.filter((c) => String(c?.type || '') === 'kpi')
  const tables = charts.filter((c) => ['table', 'grouptable'].includes(String(c?.type || '')))
  const plots = charts.filter((c) => !['kpi', 'table', 'grouptable'].includes(String(c?.type || '')))

  let y = queryItems.length ? 8 : 0

  const addChart = (spec, x, yy, w, h) => {
    const cid = String(base + seq)
    seq += 1
    const chartOp = {
      op: 'upsert_chart',
      chartId: cid,
      type: String(spec.type || 'bar'),
      datasetId: pickDatasetId(spec),
      title: String(spec.title || cid),
      encode: cleanEncode(spec.encode),
    }
    if (spec.style && typeof spec.style === 'object' && !Array.isArray(spec.style)
        && Object.keys(spec.style).length) {
      chartOp.style = spec.style
    }
    ops.push(chartOp)
    ops.push({
      op: 'upsert_component',
      id: cid,
      type: 'chart',
      chartId: cid,
      x,
      y: yy,
      w,
      h,
    })
    return cid
  }

  if (kpis.length) {
    const n = Math.min(kpis.length, 4)
    const w = Math.floor(72 / n)
    kpis.slice(0, n).forEach((spec, i) => {
      addChart(spec, i * w, y, w, 10)
    })
    y += 10
  }

  // Fixed template: pair half-width charts; line/area always full row; never leave a half-empty hole.
  // Cap density so conversation boards stay readable (≤2 compare + ≤1 trend).
  const halfTypes = new Set(['bar', 'hbar', 'pie', 'donut', 'column'])
  const halves = []
  const fulls = []
  for (const spec of plots) {
    const t = String(spec?.type || 'bar').toLowerCase()
    if (t === 'line' || t === 'area') fulls.push(spec)
    else if (halfTypes.has(t) || t === 'bar') halves.push(spec)
    else fulls.push(spec)
  }
  const halfPack = halves.slice(0, 2)
  const fullPack = fulls.slice(0, 1)

  for (let i = 0; i < halfPack.length; i += 2) {
    const a = halfPack[i]
    const b = halfPack[i + 1]
    if (b) {
      addChart(a, 0, y, 36, 20)
      addChart(b, 36, y, 36, 20)
    } else {
      addChart(a, 0, y, 72, 20)
    }
    y += 20
  }
  for (const spec of fullPack) {
    addChart(spec, 0, y, 72, 18)
    y += 18
  }

  tables.slice(0, 1).forEach((spec) => {
    addChart(spec, 0, y, 72, 16)
    y += 16
  })

  const placed = (kpis.length ? Math.min(kpis.length, 4) : 0) + halfPack.length + fullPack.length
    + Math.min(tables.length, 1)
  const patch = { ops }
  const out = {
    ok: true,
    title,
    mode: 'replace',
    patch,
    chartCount: placed,
  }
  if (queryItems.length) out.query = { items: queryItems }
  return out
}

function listOrEmpty(v) {
  return Array.isArray(v) ? v : []
}

function pickDatasetId(spec) {
  const enc = spec?.encode && typeof spec.encode === 'object' ? spec.encode.datasetId : ''
  return String(spec?.datasetId || enc || '').trim()
}

function cleanEncode(enc) {
  if (!enc || typeof enc !== 'object' || Array.isArray(enc)) return {}
  const out = {}
  for (const [k, v] of Object.entries(enc)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

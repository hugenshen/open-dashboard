/**
 * Ask-data enrichment helpers (P012 M2). Pure functions — no network.
 * @module @opendashboard/dsh-od-bi/ask-enrich
 */

/** Cap sample rows for schema prompt (SQLBot-style 3-row peek). */
export function clipSample(sample, limit = 3) {
  if (!Array.isArray(sample) || !sample.length) return []
  return sample.slice(0, Math.max(0, limit))
}

/** Slim knowledge terms for od_get_schema (confirmed / metric / dimension). */
export function slimTerms(knowledge, limit = 24) {
  const terms = Array.isArray(knowledge?.terms) ? knowledge.terms : []
  const out = []
  for (const t of terms) {
    if (!t || typeof t !== 'object') continue
    const term = t.term || t.name || t.alias
    const field = t.canonicalField || t.field || t.canonical
    if (!term && !field) continue
    const row = {
      term: term ? String(term) : undefined,
      field: field ? String(field) : undefined,
      type: t.type ? String(t.type) : undefined,
    }
    if (Array.isArray(t.aliases) && t.aliases.length) {
      row.aliases = t.aliases.slice(0, 6).map(String)
    }
    if (Array.isArray(t.values) && t.values.length) {
      row.values = t.values.slice(0, 12)
    }
    out.push(row)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Project confirmed knowledge into a semantic contract for the ask LLM.
 * Metrics carry an executable agg(field) expression (not a human formula).
 * Dimensions carry literal values. Examples are gold NL→SQL pairs.
 * Does not invent joins or derived metrics.
 */
export function projectSemantic({ knowledge, questions } = {}) {
  const terms = Array.isArray(knowledge?.terms) ? knowledge.terms : []
  const metricsIn = Array.isArray(knowledge?.metrics) ? knowledge.metrics : []
  const synonymsByField = new Map()
  const dimensions = []

  for (const t of terms) {
    if (!t || typeof t !== 'object') continue
    const field = String(t.canonicalField || t.field || t.canonical || '').trim()
    const name = String(t.term || t.name || '').trim()
    const type = String(t.type || '').toLowerCase()
    const aliases = Array.isArray(t.aliases) ? t.aliases.map(String).filter(Boolean) : []
    if (field) {
      const syn = synonymsByField.get(field) || []
      if (name) syn.push(name)
      syn.push(...aliases)
      synonymsByField.set(field, syn)
    }
    if (type === 'dimension' || type === 'dim') {
      const synonyms = [...new Set([name, ...aliases].filter(Boolean))].slice(0, 8)
      const values = Array.isArray(t.values) ? t.values.slice(0, 16) : undefined
      dimensions.push({
        name: name || field,
        field: field || undefined,
        synonyms: synonyms.length ? synonyms : undefined,
        values,
      })
    }
  }

  const metrics = []
  for (const m of metricsIn) {
    if (!m || typeof m !== 'object') continue
    const field = String(m.field || m.fieldName || '').trim()
    const agg = String(m.agg || 'SUM').toUpperCase()
    const name = String(m.name || field).trim()
    if (!name) continue
    const syn = [...new Set([name, ...(synonymsByField.get(field) || [])].filter(Boolean))].slice(0, 8)
    const expression = field ? `${agg}(${field})` : undefined
    const definition = m.formula ? String(m.formula).trim() : ''
    metrics.push({
      name,
      field: field || undefined,
      agg,
      expression,
      unit: m.unit ? String(m.unit) : undefined,
      definition: definition || undefined,
      synonyms: syn.length ? syn : undefined,
    })
    if (metrics.length >= 24) break
  }

  const examples = slimQuestions(questions, 3).map((q) => ({
    question: q.question,
    sql: q.sql,
  }))

  return {
    metrics,
    dimensions: dimensions.filter((d) => d.field).slice(0, 24),
    examples,
  }
}

/** Few-shot questions for SQL generation (NL → SQL, no hit counters). */
export function slimQuestions(questions, limit = 3) {
  const list = Array.isArray(questions) ? questions : []
  return list.slice(0, Math.max(0, limit)).map((q) => ({
    question: q?.question ? String(q.question) : '',
    sql: q?.sql ? String(q.sql) : undefined,
    chartType: q?.chartType ? String(q.chartType) : undefined,
    brief: q?.brief ? String(q.brief) : undefined,
  })).filter((q) => q.question)
}

/**
 * Insight when a live query returns 0 rows (honest empty, not stub).
 */
export function emptyRowInsight({ title, chartType, datasetId } = {}) {
  const t = title ? `「${title}」` : '本题'
  const ds = datasetId ? `（数据集 ${datasetId}）` : ''
  const kind = chartType && chartType !== 'table' ? `图类型 ${chartType}，` : ''
  return `${t}${ds} 查询成功但 0 行。${kind}请检查过滤条件、时间范围或字段是否匹配；不要把空结果当成有数。`
}

function fieldCount(fields) {
  return Array.isArray(fields) ? fields.length : 0
}

function looksLikeSampleTitle(title) {
  return /样例|sample|peek|预览行|schema.?row/i.test(String(title || ''))
}

/**
 * Suggest a result card chart type from column shape.
 * Conservative: sample peeks & wide grids stay table; single scalar → kpi;
 * only clean 2-col compares become bar (prefer bar over pie for ask).
 * @returns {'table'|'bar'|'line'|'pie'|'kpi'}
 */
export function suggestChartType({ fields, rows, requested, title } = {}) {
  const req = String(requested || '').toLowerCase()
  // Explicit non-table request wins
  if (req && req !== 'auto' && req !== 'table') return req

  const cols = fieldCount(fields)
  const data = Array.isArray(rows) ? rows : []
  const n = data.length

  // Sample / schema peeks must stay tables — never auto-chart raw rows.
  if (looksLikeSampleTitle(title)) return 'table'
  // Wide row peeks (many columns) are tables, not pies.
  if (cols >= 4) return 'table'
  if (!n) return 'table'

  // One number / one row → KPI card (not a lonely bar).
  if (n === 1 && cols <= 2) return 'kpi'
  if (cols <= 1) return n <= 1 ? 'kpi' : 'table'

  // Need a clear category + measure pair for charts.
  if (cols !== 2) return 'table'

  // 2 columns: compare / distribution → bar (avoid pie for tiny ask peeks).
  if (n >= 2 && n <= 24) return 'bar'
  if (n > 24) return 'table'
  return 'table'
}

/** Attach insight + optional chart override for ask tool values. */
export function enrichAskResult(value, opts = {}) {
  if (!value || value.ok === false) return value
  const rowCount = typeof value.rowCount === 'number' ? value.rowCount : (value.rows?.length || 0)
  const out = { ...value, rowCount }
  if (rowCount === 0) {
    out.insight = emptyRowInsight({
      title: value.title,
      chartType: value.chartType,
      datasetId: value.datasetId,
    })
    out.empty = true
  }
  if (opts.autoChart && rowCount > 0) {
    const requested = String(opts.requestedChartType || value.chartType || 'table').toLowerCase()
    const suggested = suggestChartType({
      fields: value.fields,
      rows: value.rows,
      title: value.title,
      requested: requested === 'table' || requested === 'auto' ? requested : requested,
    })
    if (suggested && suggested !== value.chartType) {
      out.chartTypeSuggested = suggested
      // Do NOT mutate chartType here — auto-upgrade caused intermediate probes
      // to render as bar cards. Presentation uses explicit chartType + presentAnswer.
    }
    if (looksLikeSampleTitle(value.title)) {
      out.chartType = 'table'
      out.chartTypeSuggested = 'table'
    }
  }
  // Fen→yuan hint for presentation (does not mutate query rows)
  const labels = []
  for (const f of (value.fields || [])) {
    if (f && typeof f === 'object') labels.push(String(f.label || f.name || ''))
  }
  if (labels.some((l) => l.includes('单位分'))) {
    out.style = { ...(out.style || {}), formatter: { unit: 0.01, suffix: '元' } }
  }
  return out
}

/**
 * In-place chart updates on an existing conversation draft (P004 multi-turn).
 * Never creates a new dashboard; never replace-wipes untouched charts.
 * @module @opendashboard/dsh-od-bi/rechart
 */

import {
  bindGoals,
  buildCapabilityCard,
  reviewCharts,
} from './gen-board.js'
import { llmGoalsToBindInput, resolvePlanApiKey } from './goal-planner.js'

export const RECHART_SYSTEM = `你是 DataQ 看板改图规划器。根据用户要求和「现存图表」决定改哪几张。
只输出 JSON，不要 Markdown 围栏。

{"mode":"rechart"|"regenerate"|"clarify","clarifyQuestion":null,"changes":[{"chartId","action","chartType","dim","measure","agg","title","rationale"}]}

规则：
1. mode=rechart：只列出要改的图；chartId 必须来自现存列表；未列出的图保持不动。
2. action 只能是 update。不要编造新 chartId。
3. 用户说整页重做/重新生成全部 → mode=regenerate，changes 为空。
4. 无法判断改哪张 → mode=clarify，只问一个短问题。
5. chartType 限于 bar|line|pie|kpi|grouptable|table|area|hbar。
6. 可一次改多张。`

export function matchChartsByHint(charts, { chartIds, message } = {}) {
  const list = Array.isArray(charts) ? charts : []
  const ids = (Array.isArray(chartIds) ? chartIds : []).map(String).filter(Boolean)
  if (ids.length) {
    return list.filter((c) => ids.includes(String(c.chartId)) || ids.includes(String(c.title || '')))
  }
  const q = String(message || '').trim().toLowerCase()
  if (!q) return []
  const hit = list.filter((c) => {
    const title = String(c.title || '').toLowerCase()
    const type = String(c.chartType || c.type || '').toLowerCase()
    const id = String(c.chartId || '')
    if (title && q.includes(title)) return true
    if (id && q.includes(id)) return true
    if ((/饼图|\bpie\b/.test(q)) && type === 'pie') return true
    if ((/折线|\bline\b/.test(q)) && (type === 'line' || type === 'area')) return true
    if ((/指标卡|\bkpi\b/.test(q)) && type === 'kpi') return true
    return false
  })
  return hit
}

/** Target chartType from 「改成柱图」-style phrasing (hint / skipLlm only). */
export function inferTargetType(message) {
  const q = String(message || '')
  const m = q.match(/改成|换成|变成|改为/)
  const rest = m ? q.slice(m.index) : q
  if (/折线/.test(rest)) return 'line'
  if (/条形|\bhbar\b/i.test(rest)) return 'hbar'
  if (/柱/.test(rest)) return 'bar'
  if (/面积/.test(rest)) return 'area'
  if (/饼/.test(rest)) return 'pie'
  if (/kpi|指标卡/i.test(rest)) return 'kpi'
  if (/汇总表|表格/.test(rest)) return 'grouptable'
  return undefined
}

export function normalizeChartType(raw, fallback) {
  const t = String(raw || '').trim().toLowerCase()
  if (!t) return fallback
  if (['bar', '柱', '柱图', '柱状图'].includes(t) || t === 'column') return 'bar'
  if (['line', '折线', '折线图'].includes(t)) return 'line'
  if (['pie', '饼', '饼图', 'donut', '环形'].includes(t)) return 'pie'
  if (['kpi', '指标卡'].includes(t)) return 'kpi'
  if (['area', '面积', '面积图'].includes(t)) return 'area'
  if (['hbar', '条形', '条形图'].includes(t)) return 'hbar'
  if (['grouptable', 'table', '表', '汇总表', '表格'].includes(t)) {
    return t === 'table' ? 'table' : 'grouptable'
  }
  if (['bar', 'line', 'pie', 'kpi', 'grouptable', 'table', 'area', 'hbar'].includes(t)) return t
  return fallback || t
}

export function parseRechartJson(text) {
  let raw = String(text || '').trim()
  if (!raw) return { ok: false, error: 'empty LLM response' }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  try {
    return normalizeRechart(JSON.parse(raw))
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${String(err?.message || err)}` }
  }
}

export function normalizeRechart(doc) {
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'rechart plan not an object' }
  const modeRaw = String(doc.mode || 'rechart').toLowerCase()
  const mode = modeRaw === 'regenerate' || modeRaw === 'clarify' ? modeRaw : 'rechart'
  if (mode === 'clarify') {
    return {
      ok: true,
      mode: 'clarify',
      clarifyQuestion: doc.clarifyQuestion ? String(doc.clarifyQuestion) : '请指出要改的是哪一张图？',
      changes: [],
    }
  }
  if (mode === 'regenerate') {
    return { ok: true, mode: 'regenerate', clarifyQuestion: null, changes: [] }
  }
  const raw = Array.isArray(doc.changes) ? doc.changes : (Array.isArray(doc.goals) ? doc.goals : [])
  const changes = raw.filter((c) => c && typeof c === 'object').map((c) => ({
    chartId: String(c.chartId || c.id || ''),
    action: 'update',
    chartType: normalizeChartType(c.chartType || c.type, undefined),
    dim: c.dim || c.encode?.category || undefined,
    measure: c.measure || c.encode?.value || undefined,
    agg: c.agg || c.encode?.agg || undefined,
    title: c.title || c.question || undefined,
    rationale: c.rationale || undefined,
  })).filter((c) => c.chartId)
  if (!changes.length) {
    return {
      ok: true,
      mode: 'clarify',
      clarifyQuestion: '请指出要改的是哪一张图？',
      changes: [],
    }
  }
  return { ok: true, mode: 'rechart', clarifyQuestion: null, changes }
}

export function applyChangeToChart(existing, change, fields, opts = {}) {
  if (!existing) return null
  const datasetId = existing.datasetId || opts.datasetId
  const type = normalizeChartType(change.chartType, existing.chartType || existing.type || 'bar')
  const intent = type === 'kpi'
    ? (change.agg === 'avg' ? 'kpi_ratio' : (change.agg === 'count' ? 'kpi_count' : 'kpi_sum'))
    : (type === 'pie' || type === 'donut' ? 'compose' : (type === 'line' || type === 'area' ? 'trend' : (type === 'grouptable' || type === 'table' ? 'table' : 'compare')))
  const card = buildCapabilityCard(datasetId || 'ds', fields, {
    message: opts.message || '',
    profile: opts.profile,
    datasetName: opts.datasetName,
  })
  const prev = existing.encode && typeof existing.encode === 'object' ? existing.encode : {}
  const bindIn = llmGoalsToBindInput([{
    intent,
    chartType: type,
    type,
    question: change.title || existing.title,
    title: change.title || existing.title,
    dim: change.dim || prev.category,
    measure: change.measure || prev.value,
    agg: change.agg || prev.agg,
    encode: {
      value: change.measure || prev.value,
      category: change.dim || prev.category,
      agg: change.agg || prev.agg,
    },
  }])
  const bound = bindGoals(datasetId || 'ds', bindIn, fields, {
    capabilityCard: card,
    profile: opts.profile,
    message: opts.message,
    datasetName: opts.datasetName,
  })
  const next = bound[0]
  const encode = next?.encode
    ? { ...prev, ...next.encode }
    : {
      ...prev,
      ...(change.measure ? { value: change.measure } : {}),
      ...(change.dim ? { category: change.dim } : {}),
      ...(change.agg ? { agg: change.agg } : {}),
    }
  return {
    chartId: String(existing.chartId),
    type,
    title: String(change.title || existing.title || existing.chartId),
    datasetId,
    encode,
    question: change.title || existing.title,
  }
}

export function buildMergeChartPatch(charts) {
  const ops = (Array.isArray(charts) ? charts : []).map((c) => ({
    op: 'upsert_chart',
    chartId: String(c.chartId),
    type: String(c.type || c.chartType || 'bar'),
    datasetId: c.datasetId,
    title: String(c.title || c.chartId),
    encode: c.encode && typeof c.encode === 'object' ? c.encode : {},
    ...(c.style && typeof c.style === 'object' ? { style: c.style } : {}),
  }))
  return { ops }
}

export async function callRechartLlm(userMessage, charts, opts = {}) {
  const apiKey = await resolvePlanApiKey(opts)
  if (!apiKey) return { ok: false, error: 'no LLM api key (dsh DEEPSEEK_API_KEY credential)' }
  if (/^(1|true|yes)$/i.test(String(process.env.OD_PLAN_LLM_DISABLE || ''))) {
    return { ok: false, error: 'OD_PLAN_LLM_DISABLE set' }
  }
  const base = (process.env.OD_PLAN_LLM_BASE || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = opts.model || process.env.OD_PLAN_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const fetchFn = opts.fetch || globalThis.fetch
  if (typeof fetchFn !== 'function') return { ok: false, error: 'fetch unavailable' }
  const slim = (Array.isArray(charts) ? charts : []).map((c) => ({
    chartId: c.chartId,
    title: c.title,
    chartType: c.chartType,
    datasetId: c.datasetId,
    encode: c.encode,
  }))
  try {
    const res = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: RECHART_SYSTEM },
          {
            role: 'user',
            content: `用户要求：${userMessage || ''}\n\n现存图表：\n${JSON.stringify(slim, null, 2)}`,
          },
        ],
      }),
      signal: opts.signal,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: `LLM HTTP ${res.status}: ${t.slice(0, 200)}`, model }
    }
    const json = await res.json()
    const text = json?.choices?.[0]?.message?.content
    if (!text) return { ok: false, error: 'LLM empty content', model }
    return { ok: true, text: String(text), model }
  } catch (err) {
    return { ok: false, error: String(err?.message || err), model }
  }
}

/**
 * Resolve which charts to update. LLM first; chartIds/title hint as fallback only when LLM skipped.
 */
export async function planRechart({ charts, message, chartIds, fieldsByDataset, opts = {} }) {
  const list = Array.isArray(charts) ? charts : []
  if (Array.isArray(opts.changes) && opts.changes.length) {
    return applyPlannedChanges(list, { ok: true, mode: 'rechart', changes: opts.changes }, fieldsByDataset, message, opts)
  }
  if (opts.skipLlm) {
    const matched = matchChartsByHint(list, { chartIds, message })
    if (!matched.length) {
      return { ok: false, error: 'no matching charts', source: 'hint' }
    }
    const targetType = inferTargetType(message)
    const changes = matched.map((c) => ({
      chartId: c.chartId,
      action: 'update',
      ...(targetType ? { chartType: targetType } : {}),
    }))
    return applyPlannedChanges(list, { ok: true, mode: 'rechart', changes }, fieldsByDataset, message, opts)
  }
  const llm = await callRechartLlm(message, list, opts)
  if (!llm.ok) {
    return {
      ok: false,
      error: llm.error,
      note: `改图必须走 LLM（${llm.error}）。未新建看板。`,
      source: 'llm-unavailable',
    }
  }
  const planned = parseRechartJson(llm.text)
  if (!planned.ok) {
    return { ok: false, error: planned.error, source: 'llm-invalid', model: llm.model }
  }
  planned.model = llm.model
  return applyPlannedChanges(list, planned, fieldsByDataset, message, opts)
}

function applyPlannedChanges(list, planned, fieldsByDataset, message, opts) {
  if (planned.mode === 'clarify') {
    return { ok: true, needClarify: true, clarifyQuestion: planned.clarifyQuestion, charts: [], source: 'llm' }
  }
  if (planned.mode === 'regenerate') {
    return { ok: true, regenerate: true, charts: [], source: 'llm', model: planned.model }
  }
  const byId = new Map(list.map((c) => [String(c.chartId), c]))
  const byTitle = new Map(list.map((c) => [String(c.title || '').trim(), c]).filter((e) => e[0]))
  const next = []
  const unknown = []
  for (const change of planned.changes || []) {
    const existing = byId.get(String(change.chartId))
      || byTitle.get(String(change.chartId).trim())
      || (change.title ? byTitle.get(String(change.title).trim()) : null)
    if (!existing) {
      unknown.push(change.chartId)
      continue
    }
    const fields = fieldsByDataset?.[existing.datasetId] || opts.fields || []
    const updated = applyChangeToChart(existing, change, fields, {
      message,
      profile: opts.profile,
      datasetName: opts.datasetName,
      datasetId: existing.datasetId,
    })
    if (updated) next.push(updated)
  }
  if (!next.length) {
    return {
      ok: false,
      error: unknown.length ? `unknown chartId: ${unknown.join(',')}` : 'no charts after bind',
      source: 'quality-rejected',
      model: planned.model,
    }
  }
  const reviewed = reviewCharts(next, { fields: opts.fields || [], profile: opts.profile, message })
  if (!reviewed.length) {
    return {
      ok: false,
      error: 'LLM chart edits failed reviewCharts',
      source: 'quality-rejected',
      model: planned.model,
    }
  }
  const patched = next.map((n) => {
    const r = reviewed.find((x) => x.title === n.title)
      || reviewed.find((x) => x.type === n.type && x.encode?.value === n.encode?.value)
    if (!r) return null
    return { ...n, type: r.type || n.type, encode: r.encode || n.encode, title: r.title || n.title }
  }).filter(Boolean)
  if (!patched.length) {
    return {
      ok: false,
      error: 'quality gate dropped all edited charts',
      source: 'quality-rejected',
      model: planned.model,
    }
  }
  return {
    ok: true,
    charts: patched,
    patch: buildMergeChartPatch(patched),
    source: 'llm',
    model: planned.model,
    unknown,
    quality: { requested: (planned.changes || []).length, updated: patched.length },
  }
}

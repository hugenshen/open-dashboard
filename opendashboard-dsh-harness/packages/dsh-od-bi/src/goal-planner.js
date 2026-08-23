/**
 * M1.6 board Goal planning: LLM / fixture JSON → bind → review; rules fallback.
 * @module @opendashboard/dsh-od-bi/goal-planner
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  bindGoals,
  buildCapabilityCard,
  enumerateGoals,
  planChartsFromFields,
  reviewCharts,
} from './gen-board.js'

export const GOAL_PLAN_SYSTEM = `你是 DataQ 出板分析规划器。根据「用户主题」和「能力卡」枚举 3～6 个分析目标（Goal）。
每个 Goal 是一个要回答的业务问题，并给出 intent 与字段绑定。

硬规则（违反则改写，不要输出非法绑定）：
1. compare / table 的 measure 必须来自 capability.additive，agg 只能是 sum 或 count。
2. ratio 字段只能做 kpi_ratio（agg=avg），禁止与维度做 SUM 对比柱/饼/表。
3. 不得使用 capability.junk 中的字段。
4. trend 仅当对应 time.dayBucket 为 true；否则不要输出 trend。
5. compose 使用低基数 dim，agg=count。
6. question 用中文、像分析师提问；不要输出字段英文名当标题主文案。
7. 按与用户主题的相关度排序；不要为凑数重复同维同度量。

若无法唯一确定度量或维度，设 mode=clarify，只问一个短问题，goals 为空数组。
否则 mode=goals，填写 goals。

intent 枚举：kpi_count | kpi_sum | kpi_ratio | compare | compose | trend | table
只输出 JSON，不要 Markdown 围栏。`

export function buildGoalPlanUserMessage(userMessage, capabilityCard) {
  return `用户主题：${userMessage || '（未提供，请按数据集给出通用经营分析目标）'}

能力卡：
${JSON.stringify(capabilityCard, null, 2)}

请输出：
{"mode":"goals"|"clarify","clarifyQuestion":string|null,"goals":[{"question","intent","dim","measure","agg","chartType","rationale"}]}`
}

export function parseGoalPlanJson(text) {
  let raw = String(text || '').trim()
  if (!raw) return { ok: false, error: 'empty LLM response' }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  try {
    return normalizeGoalPlan(JSON.parse(raw))
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${String(err?.message || err)}` }
  }
}

export function normalizeGoalPlan(doc) {
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'plan not an object' }
  const mode = String(doc.mode || '').toLowerCase() === 'clarify' ? 'clarify' : 'goals'
  const clarifyQuestion = doc.clarifyQuestion != null ? String(doc.clarifyQuestion) : null
  const goals = Array.isArray(doc.goals) ? doc.goals.filter((g) => g && typeof g === 'object') : []
  if (mode === 'clarify') {
    return {
      ok: true,
      mode: 'clarify',
      clarifyQuestion: clarifyQuestion || '请补充要看的指标或维度？',
      goals: [],
    }
  }
  return { ok: true, mode: 'goals', clarifyQuestion: null, goals }
}

export function llmGoalsToBindInput(goals) {
  return (Array.isArray(goals) ? goals : []).map((g) => ({
    intent: g.intent,
    type: g.chartType || g.type || 'bar',
    chartType: g.chartType || g.type,
    question: g.question,
    title: g.title || g.question,
    rationale: g.rationale,
    encode: {
      value: g.measure || g.encode?.value,
      category: g.dim || g.encode?.category,
      agg: g.agg || g.encode?.agg,
    },
    measure: g.measure,
    dim: g.dim,
    agg: g.agg,
  }))
}

function chartsFromBound(goals) {
  return (goals || []).map((g) => ({
    type: g.type,
    title: g.title || g.question,
    question: g.question,
    intent: g.intent,
    datasetId: g.datasetId,
    encode: g.encode,
  }))
}

const PLAN_KEY_REFS = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'OD_PLAN_LLM_API_KEY']

function planEnv() {
  const apiKey = process.env.OD_PLAN_LLM_API_KEY
    || process.env.DEEPSEEK_API_KEY
    || process.env.OPENAI_API_KEY
    || ''
  const base = (process.env.OD_PLAN_LLM_BASE
    || process.env.DEEPSEEK_API_BASE
    || 'https://api.deepseek.com')
    .replace(/\/$/, '')
  const model = process.env.OD_PLAN_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const disabled = /^(1|true|yes)$/i.test(String(process.env.OD_PLAN_LLM_DISABLE || ''))
  return { apiKey, base, model, disabled }
}

function credentialValue(hit) {
  if (!hit) return ''
  if (typeof hit === 'string') return hit
  if (typeof hit.value === 'string') return hit.value
  return ''
}

/**
 * Same key as the conversation LLM: dsh credentials (Models page /
 * `$DSH_HOME/.credentials.yaml` / launch env), then process env fallback.
 */
export async function resolvePlanApiKey(opts = {}) {
  if (opts.apiKey) return String(opts.apiKey)
  if (typeof opts.resolveApiKey === 'function') {
    const v = await opts.resolveApiKey()
    if (v) return String(v)
  }
  const credentials = opts.credentials
  if (credentials && typeof credentials.resolve === 'function') {
    for (const name of PLAN_KEY_REFS) {
      try {
        const value = credentialValue(await credentials.resolve(name))
        if (value) return value
      } catch {
        /* skip invalid refs */
      }
    }
  }
  const fromFile = apiKeyFromCredentialsFile()
  if (fromFile) return fromFile
  return planEnv().apiKey
}

function apiKeyFromCredentialsFile() {
  const home = process.env.DSH_HOME
  if (!home) return ''
  try {
    const raw = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8')
    const m = raw.match(/^\s*DEEPSEEK_API_KEY:\s*(\S+)/m)
    return m ? m[1].replace(/^['"]|['"]$/g, '') : ''
  } catch {
    return ''
  }
}

export async function callGoalPlanLlm(userMessage, capabilityCard, opts = {}) {
  const env = planEnv()
  if (env.disabled) return { ok: false, error: 'OD_PLAN_LLM_DISABLE set' }
  const apiKey = await resolvePlanApiKey(opts)
  if (!apiKey) {
    return { ok: false, error: 'no LLM api key (dsh DEEPSEEK_API_KEY credential)' }
  }
  const url = `${env.base}/chat/completions`
  const model = opts.model || env.model
  const fetchFn = opts.fetch || globalThis.fetch
  if (typeof fetchFn !== 'function') return { ok: false, error: 'fetch unavailable', model }
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: GOAL_PLAN_SYSTEM },
          { role: 'user', content: buildGoalPlanUserMessage(userMessage, capabilityCard) },
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

function bindWithRescue(datasetId, rawGoals, fields, card, opts) {
  const bindIn = llmGoalsToBindInput(rawGoals)
  let bound = bindGoals(datasetId, bindIn, fields, {
    capabilityCard: card,
    profile: opts.profile,
    message: opts.message,
    datasetName: opts.datasetName,
  })
  if (bound.length) return bound
  const rescued = bindIn.map((g) => {
    const v = String(g.encode?.value || g.measure || '')
    if ((card.ratio || []).some((r) => r.field === v)) {
      return {
        ...g,
        intent: 'kpi_ratio',
        type: 'kpi',
        chartType: 'kpi',
        encode: { value: v, agg: 'avg' },
      }
    }
    return g
  })
  return bindGoals(datasetId, rescued, fields, {
    capabilityCard: card,
    profile: opts.profile,
    message: opts.message,
    datasetName: opts.datasetName,
  })
}

function finalizeBound({ datasetId, fields, message, profile, datasetName, card, boundGoals, source, note, model }) {
  const reviewed = reviewCharts(chartsFromBound(boundGoals), { fields, profile, message })
  const { dims, time } = enumerateGoals(datasetId, fields, { message, profile, datasetName })
  // query from rule helper path
  const planned = planChartsFromFields(datasetId, fields, { message, profile, datasetName })
  return {
    ok: true,
    needClarify: false,
    clarifyQuestion: null,
    charts: reviewed,
    goals: boundGoals,
    query: planned.query,
    capabilityCard: card,
    source,
    note: note || '',
    model: model || null,
  }
}

function rulesFallback(datasetId, fields, message, profile, datasetName, card, note, model, source = 'rules-fallback') {
  const planned = planChartsFromFields(datasetId, fields, { message, profile, datasetName })
  return {
    ok: true,
    needClarify: false,
    clarifyQuestion: null,
    charts: planned.charts,
    goals: planned.goals || [],
    query: planned.query,
    capabilityCard: card,
    source,
    note: note || '已用基础规则规划',
    model: model || null,
  }
}

/**
 * Sync path for fixtures / unit tests (no network).
 */
export function planBoardFromGoalPlan(input = {}) {
  const datasetId = input.datasetId || 'ds'
  const fields = input.fields || []
  const message = input.message || ''
  const profile = input.profile
  const datasetName = input.datasetName || ''
  const card = buildCapabilityCard(datasetId, fields, { message, profile, datasetName })

  if (Array.isArray(input.goals) && input.goals.length) {
    const bound = bindWithRescue(datasetId, input.goals, fields, card, { profile, message, datasetName })
    if (!bound.length) {
      return {
        ok: false,
        needClarify: false,
        clarifyQuestion: null,
        charts: [],
        goals: [],
        query: null,
        capabilityCard: card,
        source: 'goals-rejected',
        note: '用户目标无法绑定到合法字段；未回退规则模板（避免覆盖删饼/改维意图）。请改用 od_plan_charts(message=用户改后的原话) 重新规划，展示 goalsForConfirm 后再等确认；不要空 goals 调用 od_generate_board。',
        error: 'provided goals rejected by bind',
        model: null,
      }
    }
    return finalizeBound({
      datasetId, fields, message, profile, datasetName, card, boundGoals: bound, source: 'provided', note: '',
    })
  }

  const parsed = normalizeGoalPlan(input.goalPlan)
  if (!parsed.ok) {
    return rulesFallback(datasetId, fields, message, profile, datasetName, card, parsed.error)
  }
  if (parsed.mode === 'clarify') {
    return {
      ok: true,
      needClarify: true,
      clarifyQuestion: parsed.clarifyQuestion,
      charts: [],
      goals: [],
      query: null,
      capabilityCard: card,
      source: 'fixture',
      note: '',
      model: null,
    }
  }
  const bound = bindWithRescue(datasetId, parsed.goals, fields, card, { profile, message, datasetName })
  if (!bound.length) {
    return rulesFallback(datasetId, fields, message, profile, datasetName, card, 'fixture goals rejected; 已用基础规则规划')
  }
  return finalizeBound({
    datasetId, fields, message, profile, datasetName, card, boundGoals: bound, source: 'fixture', note: '',
  })
}

/**
 * Runtime path: optional goalPlan / goals / LLM / rules.
 */
export async function planBoardAnalysis(input = {}) {
  const datasetId = input.datasetId || 'ds'
  const fields = input.fields || []
  const message = input.message || ''
  const profile = input.profile
  const datasetName = input.datasetName || ''
  const card = buildCapabilityCard(datasetId, fields, { message, profile, datasetName })

  if (Array.isArray(input.goals) && input.goals.length) {
    return planBoardFromGoalPlan(input)
  }
  if (input.goalPlan && typeof input.goalPlan === 'object') {
    return planBoardFromGoalPlan(input)
  }
  if (input.skipLlm) {
    return rulesFallback(datasetId, fields, message, profile, datasetName, card, 'skipLlm', null, 'rules')
  }

  const llm = await callGoalPlanLlm(message, card, {
    signal: input.signal,
    fetch: input.fetch,
    apiKey: input.apiKey,
    resolveApiKey: input.resolveApiKey,
    credentials: input.credentials,
  })
  if (!llm.ok) {
    return rulesFallback(
      datasetId, fields, message, profile, datasetName, card,
      `LLM unavailable (${llm.error}); 已用基础规则规划`,
      llm.model,
    )
  }
  const parsed = parseGoalPlanJson(llm.text)
  if (!parsed.ok) {
    return rulesFallback(
      datasetId, fields, message, profile, datasetName, card,
      `LLM JSON failed (${parsed.error}); 已用基础规则规划`,
      llm.model,
    )
  }
  if (parsed.mode === 'clarify') {
    return {
      ok: true,
      needClarify: true,
      clarifyQuestion: parsed.clarifyQuestion,
      charts: [],
      goals: [],
      query: null,
      capabilityCard: card,
      source: 'llm',
      note: '',
      model: llm.model,
    }
  }
  const bound = bindWithRescue(datasetId, parsed.goals, fields, card, { profile, message, datasetName })
  if (!bound.length) {
    return rulesFallback(
      datasetId, fields, message, profile, datasetName, card,
      'LLM goals all rejected by bind; 已用基础规则规划',
      llm.model,
    )
  }
  return finalizeBound({
    datasetId,
    fields,
    message,
    profile,
    datasetName,
    card,
    boundGoals: bound,
    source: 'llm',
    note: '',
    model: llm.model,
  })
}

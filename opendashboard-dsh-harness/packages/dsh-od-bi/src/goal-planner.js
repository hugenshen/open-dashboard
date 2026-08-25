/**
 * Board Goal planning: LLM or injected goals → bind → reviewCharts.
 * Live /board does not fall back to enumerateGoals.
 * @module @opendashboard/dsh-od-bi/goal-planner
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  bindGoals,
  buildCapabilityCard,
  planChartsFromFields,
  reviewCharts,
  typeFromIntent,
} from './gen-board.js'

export const GOAL_PLAN_SYSTEM = `你是 DataQ 出板分析规划器。先根据数据特征（能力卡）按经营驾驶舱拆「有业务展示意义」的分析任务，不要在规划阶段锁死图种。

每个任务只回答一个业务问题：选维、选度量、写清决策意义。禁止把两个指标塞进同一条。图种由确认后的 board worker：按任务 od_get_data 取样问数 → harness 按结果形态选图（含单位、小数位）。你不要输出 chartType。

对照专业稿面槽位（有字段就填，按此顺序输出 6～10 条任务）：
1. 全景 KPI：记录数/笔数 count 一条；每个 additive 度量各一条 kpi_sum（最多再加一条 kpi_ratio）。至少 3 条 KPI 任务。
2. 趋势：仅当 capability.time 存在且 dayBucket=true → 主度量 intent=trend。没有 dayBucket 就跳过，不要用构成任务填洞。
3. 结构对比：低基数 dim（dims）× 主 additive，intent=compare。状态/类型/渠道对金额必须是对比任务，禁止写成构成（compose）。
4. 排行：若有 rankDims，对主度量 intent=rank（TOP10），不要用明细表冒充排行。
5. 构成：最多 1 条 compose，且 dim 必须在 composeDims（distinct 约 2～8）。禁止第二条构成。
6. 明细：一条 table，按最重要的业务维汇总主度量。

硬规则：
1. compare / table / rank 的 measure 必须来自 additive，agg 只能是 sum 或 count。
2. ratio 只能 kpi_ratio（agg=avg），禁止与维度做 SUM 对比。
3. 不得使用 junk。
4. trend 仅当对应 time.dayBucket 为 true。
5. question 用中文、像分析师提问（「各支付状态下入账差多少」而不是「状态分布」）；rationale 写清本任务回答什么决策问题。
6. 用户说「专业仪表盘」而主题空：仍按驾驶舱出全槽，不要只出两条构成+一张表。

若无法唯一确定度量（≥2 additive 且用户词撞上多个），mode=clarify，只问一个短问题。
否则 mode=goals。

intent：kpi_count | kpi_sum | kpi_ratio | compare | rank | compose | trend | table
只输出 JSON，不要 Markdown 围栏。不要写 chartType。`

export function buildGoalPlanUserMessage(userMessage, capabilityCard) {
  return `用户主题：${userMessage || '（未提供：请按经营驾驶舱给出专业分析目标，不要只做分布饼图）'}

能力卡：
${JSON.stringify(capabilityCard, null, 2)}

请输出：
{"mode":"goals"|"clarify","clarifyQuestion":string|null,"goals":[{"question","intent","dim","measure","agg","rationale","slot"}]}
slot 取 overview|trend|compare|rank|compose|detail。不要写 chartType。`
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

/** Cap pies, map rank/hbar, never invent fields. Call after parse, before bind. */
export function shapeCockpitGoals(goals, card = {}) {
  const list = (Array.isArray(goals) ? goals : []).filter((g) => g && typeof g === 'object').map((g) => ({ ...g }))
  const rankFields = new Set((card.rankDims || []).map((d) => d.field))
  const composeFields = new Set((card.composeDims || []).map((d) => d.field))
  let pieKept = false
  for (const g of list) {
    const type = String(g.chartType || g.type || '').toLowerCase()
    const dim = String(g.dim || g.encode?.category || '')
    const isPie = type === 'pie' || type === 'donut' || g.intent === 'compose'
    if (g.intent === 'rank' || type === 'hbar') {
      g.chartType = 'hbar'
      g.type = 'hbar'
      g.intent = 'rank'
      continue
    }
    if (!isPie) continue
    if (dim && rankFields.has(dim) && !composeFields.has(dim)) {
      g.chartType = 'hbar'
      g.type = 'hbar'
      g.intent = 'rank'
      if (!g.measure && !g.encode?.value && card.additive?.[0]) {
        g.measure = card.additive[0].field
        g.agg = g.agg || 'sum'
      }
      continue
    }
    if (pieKept) {
      g.chartType = 'bar'
      g.type = 'bar'
      g.intent = 'compare'
      if (!g.measure && !g.encode?.value && card.additive?.[0]) {
        g.measure = card.additive[0].field
        g.agg = g.agg || 'sum'
      }
      continue
    }
    pieKept = true
    g.chartType = 'pie'
    g.intent = g.intent || 'compose'
  }
  return list
}

export function llmGoalsToBindInput(goals) {
  return (Array.isArray(goals) ? goals : []).map((g) => {
    const type = g.chartType || g.type || typeFromIntent(g.intent, 'bar')
    return {
      intent: g.intent,
      type,
      chartType: type,
      question: g.question,
      title: g.title || g.question,
      rationale: g.rationale,
      slot: g.slot,
      encode: {
        value: g.measure || g.encode?.value,
        category: g.dim || g.encode?.category,
        agg: g.agg || g.encode?.agg,
      },
      measure: g.measure,
      dim: g.dim,
      agg: g.agg,
    }
  })
}

function chartsFromBound(goals) {
  return (goals || []).map((g) => ({
    type: g.type,
    title: g.title || g.question,
    question: g.question,
    intent: g.intent,
    rationale: g.rationale,
    slot: g.slot,
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
        temperature: 0.2,
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
  const bindIn = llmGoalsToBindInput(shapeCockpitGoals(rawGoals, card))
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

function qualityFail({ card, model, source, error, note, quality }) {
  return {
    ok: false,
    needClarify: false,
    clarifyQuestion: null,
    charts: [],
    goals: [],
    query: null,
    capabilityCard: card,
    source,
    error,
    note: note || error,
    model: model || null,
    quality: quality || null,
  }
}

function finalizeBound({ datasetId, fields, message, profile, datasetName, card, boundGoals, source, note, model, llmGoalCount }) {
  const boundCharts = chartsFromBound(boundGoals)
  const reviewed = reviewCharts(boundCharts, { fields, profile, message })
  const planned = planChartsFromFields(datasetId, fields, { message, profile, datasetName })
  const quality = {
    llmGoalCount: llmGoalCount == null ? boundGoals.length : llmGoalCount,
    boundCount: boundGoals.length,
    reviewedCount: reviewed.length,
    droppedCount: Math.max(0, (llmGoalCount == null ? boundGoals.length : llmGoalCount) - reviewed.length),
  }
  if (!reviewed.length) {
    return qualityFail({
      card,
      model,
      source: 'quality-rejected',
      error: 'LLM goals failed reviewCharts (empty after quality gate)',
      note: '质量闸丢弃全部 Goal（同维饼、高基数碎饼、非法绑定等）。请改主题后重新 od_plan_charts，不要用规则模板凑图。',
      quality,
    })
  }
  const dropped = quality.droppedCount
  return {
    ok: true,
    needClarify: false,
    clarifyQuestion: null,
    charts: reviewed,
    goals: boundGoals,
    query: planned.query,
    capabilityCard: card,
    source,
    note: note || (dropped > 0 ? `质量闸丢弃 ${dropped} 个非法 Goal` : ''),
    model: model || null,
    quality,
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
      return qualityFail({
        card,
        source: 'goals-rejected',
        error: 'provided goals rejected by bind',
        note: '用户目标无法绑定到合法字段。请改用 od_plan_charts(message=用户改后的原话) 重新走 LLM 规划，展示后再等确认；不要空 goals 调用 od_generate_board。',
        quality: { llmGoalCount: input.goals.length, boundCount: 0, reviewedCount: 0, droppedCount: input.goals.length },
      })
    }
    return finalizeBound({
      datasetId, fields, message, profile, datasetName, card, boundGoals: bound, source: 'provided', note: '',
      llmGoalCount: input.goals.length,
    })
  }

  const parsed = normalizeGoalPlan(input.goalPlan)
  if (!parsed.ok) {
    return qualityFail({
      card,
      source: 'fixture-invalid',
      error: parsed.error || 'invalid goalPlan',
      note: '注入的 Goal JSON 无效；未回退规则规划。',
    })
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
  const bound = bindWithRescue(datasetId, shapeCockpitGoals(parsed.goals, card), fields, card, { profile, message, datasetName })
  if (!bound.length) {
    return qualityFail({
      card,
      source: 'quality-rejected',
      error: 'fixture goals rejected by bind',
      note: 'Goal 全部未通过 bind 闸；未回退规则规划。',
      quality: { llmGoalCount: parsed.goals.length, boundCount: 0, reviewedCount: 0, droppedCount: parsed.goals.length },
    })
  }
  return finalizeBound({
    datasetId, fields, message, profile, datasetName, card, boundGoals: bound, source: 'fixture', note: '',
    llmGoalCount: parsed.goals.length,
  })
}

/**
 * Runtime: goals[] / goalPlan skip LLM; otherwise must call LLM then bind+review.
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

  const llm = await callGoalPlanLlm(message, card, {
    signal: input.signal,
    fetch: input.fetch,
    apiKey: input.apiKey,
    resolveApiKey: input.resolveApiKey,
    credentials: input.credentials,
  })
  if (!llm.ok) {
    return qualityFail({
      card,
      model: llm.model,
      source: 'llm-unavailable',
      error: llm.error || 'LLM unavailable',
      note: `规划必须走 LLM（${llm.error}）。未使用规则模板。请检查 DEEPSEEK_API_KEY 后重试。`,
    })
  }
  const parsed = parseGoalPlanJson(llm.text)
  if (!parsed.ok) {
    return qualityFail({
      card,
      model: llm.model,
      source: 'llm-invalid',
      error: parsed.error || 'invalid LLM JSON',
      note: `LLM 规划 JSON 无法解析（${parsed.error}）。未使用规则模板，请重试 od_plan_charts。`,
    })
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
      quality: { llmGoalCount: 0, boundCount: 0, reviewedCount: 0, droppedCount: 0 },
    }
  }
  const bound = bindWithRescue(datasetId, shapeCockpitGoals(parsed.goals, card), fields, card, { profile, message, datasetName })
  if (!bound.length) {
    return qualityFail({
      card,
      model: llm.model,
      source: 'quality-rejected',
      error: 'LLM goals all rejected by bind',
      note: 'LLM 目标全部未通过字段绑定闸。请换主题或先澄清指标/维度，不要用规则模板凑图。',
      quality: {
        llmGoalCount: parsed.goals.length,
        boundCount: 0,
        reviewedCount: 0,
        droppedCount: parsed.goals.length,
      },
    })
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
    llmGoalCount: parsed.goals.length,
  })
}

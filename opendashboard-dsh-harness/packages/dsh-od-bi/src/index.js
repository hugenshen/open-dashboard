/**
 * Open Dashboard BI tools (P011 M1–M3).
 * @module @opendashboard/dsh-od-bi
 */

import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { answerPresentationMeta, boardPresentationMeta } from './answer-meta.js'
import {
  clipSample,
  enrichAskResult,
  projectSemantic,
  slimQuestions,
  slimTerms,
} from './ask-enrich.js'
import { getBridge, patchBridge } from '@opendashboard/dsh-od-auth/bridge-state'
import { planRechart } from './rechart.js'
import {
  layoutBoardPatch,
  parseValueMapFromLabel,
  reviewCharts,
} from './gen-board.js'
import { planBoardAnalysis, planBoardFromGoalPlan } from './goal-planner.js'
import { registerAnalysisWorkerTools } from './analysis-worker.js'
import { callerDepth, registerBoardWorkerTools } from './board-worker.js'
import { realizeBoundCharts } from './realize-task.js'
import { biFetch, PREVIEW_ROW_LIMIT, toLosslessJson } from './http.js'
import {
  coerceEncodeAgg,
  mergeKnowledgeIntoFields,
} from './knowledge-merge.js'
import { sampleWarningForLlm, withSampleMeta } from './sample-meta.js'
import { assessSemanticReadiness, semanticNotReadyMessage } from './semantic-readiness.js'
import { assertAllowedTables } from './sql-guard.js'
import { registerOdCommands } from './commands.js'
import { registerReportProgressRoute } from './report-progress.js'
import {
  DEMO_ORDER_DATASET,
  DEMO_ORDER_DATASET_ID,
  demoOrderSchema,
  isDemoOrderDataset,
} from './demo-order.js'

function countChartsInPatch(patch) {
  const ops = patch?.ops
  if (!Array.isArray(ops)) return 0
  return ops.filter((o) => o && o.op === 'upsert_chart').length
}

function isAnalysisReportPrompt(text) {
  return /写.*分析报告|生成.*报告|分析报告|解读报告|归因报告|经营报告/.test(String(text || ''))
}

export function isAnalysisReportToolRequest(args = {}) {
  const bridge = getBridge()
  return isAnalysisReportPrompt([
    bridge.prompt,
    args.message,
    args.title,
    args.query,
  ].filter(Boolean).join('\n'))
}

function datasetBusinessText(dataset) {
  const d = dataset && typeof dataset === 'object' ? dataset : {}
  return [
    d.id,
    d.datasetId,
    d.name,
    d.title,
    d.tableName,
    d.table,
    d.groupName,
    d.description,
  ].filter(Boolean).join(' ').toLowerCase()
}

function scoreDatasetForPrompt(dataset, promptText) {
  const prompt = String(promptText || '').toLowerCase()
  const haystack = datasetBusinessText(dataset)
  let score = 0
  if (/订单|支付订单|订单表|t_pay_order|pay_order|order/.test(prompt)) {
    if (/ds_012eb19e/.test(haystack)) score += 120
    if (/t_pay_order|pay_order/.test(haystack)) score += 100
    if (/支付/.test(haystack)) score += 45
    if (/订单|order/.test(haystack)) score += 45
    if (/销售|sales|fact_sales/.test(haystack)) score -= 15
    if (/数据源清单|de_datasource|datasource/.test(haystack)) score -= 80
  }
  if (/商户|merchant|mch/.test(prompt) && /商户|merchant|mch/.test(haystack)) score += 20
  return score
}

export function rankDatasetsForPrompt(datasets, promptText) {
  const list = Array.isArray(datasets) ? datasets : []
  return list
    .map((dataset, index) => ({ dataset, index, score: scoreDatasetForPrompt(dataset, promptText) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ dataset }) => dataset)
}

function mergeDatasets(primary, fallback) {
  const seen = new Set()
  const out = []
  for (const dataset of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(fallback) ? fallback : [])]) {
    const key = String(dataset?.id || dataset?.datasetId || dataset?.tableName || JSON.stringify(dataset))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(dataset)
  }
  return out
}

function shouldOfferDemoOrderFallback(promptText) {
  return /订单|支付订单|订单表|t_pay_order|pay_order|order/.test(String(promptText || '').toLowerCase())
}

function withDemoOrderFallback(list, promptText) {
  const rows = Array.isArray(list) ? list : []
  if (!shouldOfferDemoOrderFallback(promptText)) return rows
  if (rows.some((dataset) => String(dataset?.id || dataset?.datasetId || '') === DEMO_ORDER_DATASET_ID)) return rows
  return [...rows, DEMO_ORDER_DATASET]
}

function leadReportSchemaGuard(exec) {
  if (callerDepth(exec) >= 1) return null
  const bridge = getBridge()
  if (!isAnalysisReportPrompt(bridge.prompt)) return null
  return toLosslessJson({
    ok: false,
    error: 'Analysis-report path: Lead must immediately call od_board_worker once with description=写分析报告 and prompt first line ANALYSIS_REPORT=1 plus datasetId and the user question. Do not call schema/profile on the Lead path; PlanningAgent inside the worker reads schema.',
  })
}

function reportMustUseWorkerError() {
  return toLosslessJson({
    ok: false,
    source: 'analysis-report-route',
    error: '这是分析报告任务，不是看板规划任务；报告生成不依赖 semanticReady。请立即调用 od_board_worker，description=写分析报告，prompt 第一行 ANALYSIS_REPORT=1，并包含 datasetId 与用户原话。',
  })
}

/**
 * Write a DashboardPatch. Never stub-success: a fake dashboardId makes the agent stop.
 * Omit live preview rows from the tool value (they can be huge / non-lossless).
 */
async function applyDashboardPatch({ title, mode, patch, dashboardId, signal }) {
  if (!patch || !Array.isArray(patch.ops) || !patch.ops.length) {
    return { ok: false, error: 'patch.ops required', title, mode }
  }
  const chartCount = countChartsInPatch(patch)
  const dash = dashboardId ? String(dashboardId) : undefined
  try {
    const applied = await biFetch('POST', '/api/internal/bi/apply-patch', {
      dashboardId: dash,
      title,
      mode,
      patch,
      preview: false,
    }, signal)
    const id = applied?.dashboardId || dash
    if (id) patchBridge({ dashboardId: String(id) })
    const appliedIds = Array.isArray(applied?.chartIds) ? applied.chartIds : null
    const appliedCount = appliedIds
      ? appliedIds.length
      : (typeof applied?.chartCount === 'number' ? applied.chartCount : chartCount)
    return toLosslessJson({
      ok: true,
      dashboardId: id || null,
      title,
      mode,
      chartCount: appliedCount,
      chartIds: appliedIds || undefined,
      source: 'java',
    })
  } catch (err) {
    return toLosslessJson({
      ok: false,
      dashboardId: dash || null,
      title,
      mode,
      chartCount,
      source: 'java-error',
      error: String(err?.message || err),
    })
  }
}

/** Schema + stored stats profile + confirmed knowledge (P0/P1). Never includeProbes. */
async function loadSchemaAndProfile(datasetId, signal) {
  const out = { fields: [], profile: null, name: '', knowledge: null, semanticReadiness: null, error: '' }
  try {
    const schema = await biFetch(
      'GET',
      `/api/internal/bi/datasets/${encodeURIComponent(datasetId)}/schema`,
      undefined,
      signal,
    )
    out.fields = Array.isArray(schema?.fields) ? schema.fields.map((f) => {
      if (!f || typeof f !== 'object') return f
      const next = { ...f }
      if (!next.valueMap) {
        const vm = parseValueMapFromLabel(next.label)
        if (vm) next.valueMap = vm
      }
      return next
    }) : []
    out.name = schema?.name || ''
  } catch (err) {
    out.error = `schema failed: ${String(err?.message || err)}`
    return out
  }
  try {
    const profile = await biFetch('POST', '/api/internal/bi/profile-dataset', {
      datasetId,
    }, signal)
    out.profile = profile || null
    if (!out.name && profile?.name) out.name = profile.name
    if (Array.isArray(profile?.fields) && profile.fields.length) {
      const by = new Map(out.fields.map((f) => [f.name || f.dataeaseName, f]))
      for (const p of profile.fields) {
        const n = p?.name
        const cur = n ? by.get(n) : null
        if (cur) {
          if (p.role && !cur.role) cur.role = p.role
          if (p.distinctCount != null) cur.distinctCount = p.distinctCount
          if (p.numericMin != null) cur.numericMin = p.numericMin
          if (p.numericMax != null) cur.numericMax = p.numericMax
        }
      }
    }
  } catch {
    // stats optional; schema-only plan still works
  }
  try {
    const knowledge = await biFetch(
      'GET',
      `/api/internal/bi/knowledge?datasetIds=${encodeURIComponent(datasetId)}`,
      undefined,
      signal,
    )
    out.knowledge = knowledge || null
    out.fields = mergeKnowledgeIntoFields(out.fields, knowledge)
  } catch {
    // knowledge optional
  }
  out.semanticReadiness = assessSemanticReadiness(out)
  return out
}

/** Map LLM aliases (x/y) → Java chart encode (category/value/agg). */
function normalizeChartEncode(raw, datasetId, fields) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pick = (v) => {
    if (v == null || v === '') return ''
    if (Array.isArray(v)) return v[0] == null ? '' : String(v[0])
    return String(v)
  }
  const category = pick(src.category ?? src.x)
  let value = pick(src.value ?? src.y)
  let agg = pick(src.agg || '').toUpperCase() || ''
  // Distribution with only a dim → COUNT that dim (or COUNT(*) via same field)
  if (category && !value) {
    value = category
    if (!agg) agg = 'COUNT'
  }
  if (!agg) agg = 'SUM'
  let out = {
    datasetId,
    category,
    value,
    agg,
  }
  if (src.filters) out.filters = src.filters
  if (src.resultLimit != null) out.resultLimit = src.resultLimit
  else out.resultLimit = 1000
  const coerced = coerceEncodeAgg(out, fields)
  out = coerced.encode
  return attachAskFieldCfg(out, fields)
}

/** Copy alias / valueMap onto encode.fieldCfg for preview axis labels. */
function attachAskFieldCfg(encode, fields) {
  const enc = encode && typeof encode === 'object' ? { ...encode } : {}
  const list = Array.isArray(fields) ? fields : []
  const byName = new Map()
  for (const f of list) {
    if (!f || typeof f !== 'object') continue
    const n = f.name || f.dataeaseName
    if (n) byName.set(String(n), f)
  }
  const cfg = enc.fieldCfg && typeof enc.fieldCfg === 'object' ? { ...enc.fieldCfg } : {}
  for (const key of [enc.category, enc.value].filter(Boolean).map(String)) {
    const f = byName.get(key)
    if (!f) continue
    const entry = { ...(cfg[key] || {}) }
    const alias = f.alias || f.label
    if (alias && alias !== key) entry.alias = String(alias)
    const vm = (f.valueMap && typeof f.valueMap === 'object' && !Array.isArray(f.valueMap))
      ? f.valueMap
      : parseValueMapFromLabel(f.label)
    if (vm) entry.valueMap = { ...vm }
    if (Object.keys(entry).length) cfg[key] = entry
  }
  if (Object.keys(cfg).length) enc.fieldCfg = cfg
  return enc
}

export const name = 'od-bi'
export const inject = ['tools', 'commands', 'webServer']

function rememberedDashboardId(explicit) {
  const b = getBridge()
  return String(explicit || b.dashboardId || b.linkedDashboardId || '').trim()
}

/** Same key the conversation LLM uses (Models page / credentials service). */
function harnessCredentials(ctx) {
  return ctx?.get?.('credentials')
}

function fieldLabels(fields) {
  if (!Array.isArray(fields)) return []
  return fields.map((f) => {
    if (typeof f === 'string') return f
    return f?.label || f?.name || f?.dataeaseName || String(f?.id || '')
  }).filter(Boolean)
}

function rowsToMatrix(fields, rows) {
  const labels = fieldLabels(fields)
  const keys = Array.isArray(fields)
    ? fields.map((f) => (typeof f === 'string' ? f : (f?.dataeaseName || f?.name || f?.label)))
    : []
  const header = labels.length ? labels : (rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [])
  const body = (rows || []).slice(0, PREVIEW_ROW_LIMIT).map((row) => {
    if (Array.isArray(row)) return row.map((c) => (c == null ? '' : String(c)))
    if (row && typeof row === 'object') {
      const order = keys.length ? keys : Object.keys(row)
      return order.map((k) => {
        const v = row[k]
        return v == null ? '' : String(v)
      })
    }
    return [String(row)]
  })
  return { header, body }
}

function markdownTable(fields, rows) {
  const { header, body } = rowsToMatrix(fields, rows)
  if (!header.length) return '_empty_'
  const esc = (s) => String(s).replace(/\|/g, '\\|')
  const lines = [
    `| ${header.map(esc).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ]
  return lines.join('\n')
}

/** Compact text for the model (must include sample values — UI cards alone are not visible to the LLM). */
function askResultTextForLlm(value, prefix = 'query') {
  if (!value?.ok) return `${prefix} failed: ${value?.error || 'unknown'}`
  if (value.empty) return `${value.title || prefix}: 0 行 — ${value.insight || '无数据'}`
  const sample = Array.isArray(value.sample) && value.sample.length
    ? value.sample
    : (Array.isArray(value.rows) ? value.rows.slice(0, 8) : [])
  const warn = sampleWarningForLlm(value)
  const head = `${value.title || prefix}: ${value.rowCount} rows (${value.chartType || 'table'})`
    + (warn ? `\n${warn}` : '')
  if (!sample.length) return head
  return `${head}\n样例行（供回答用，勿对用户粘贴 SQL）：\n${markdownTable(value.fields, sample.slice(0, 8))}`
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  registerOdCommands(ctx)
  registerBoardWorkerTools(ctx, { applyDashboardPatch, rememberedDashboardId })
  registerAnalysisWorkerTools(ctx)
  registerReportProgressRoute(ctx.webServer)
  ctx.tools.register(defineTool({
    name: 'od_list_datasets',
    description:
      'List datasets the current user may query in this DataQ workspace. '
      + 'Prefer this before inventing table names.',
    parameters: {
      keyword: { type: 'string', description: 'Optional name filter' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          datasets: { type: 'array' },
          source: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        const rows = Array.isArray(value.datasets) ? value.datasets : []
        const lines = rows.slice(0, 40).map((d) => {
          const id = d?.id || d?.datasetId || '?'
          const name = d?.name || d?.title || ''
          const table = d?.tableName ? ` · ${d.tableName}` : ''
          return `- ${id}: ${name}${table}`
        })
        const more = rows.length > 40 ? `\n… +${rows.length - 40} more` : ''
        const preferred = value.preferredDataset
          ? `\npreferred: ${value.preferredDataset.id || value.preferredDataset.datasetId || '?'} · ${value.preferredDataset.name || value.preferredDataset.title || ''}${value.preferredDataset.tableName ? ` · ${value.preferredDataset.tableName}` : ''}`
          : ''
        return [{
          type: 'text',
          text: `datasets(${rows.length}) via ${value.source}${value.error ? ` err=${value.error}` : ''}${preferred}\n${lines.join('\n')}${more}`,
        }]
      },
    },
    presentCall: () => ({ card: 'generic', title: 'od_list_datasets', kind: 'search' }),
    presentResult: (_args, result) => {
      if (result.isError) return { card: 'generic', title: 'datasets failed', content: result.content }
      return { card: 'generic', title: 'datasets', kind: 'search', content: result.content }
    },
    async execute(args, exec) {
      const q = args.keyword ? `?keyword=${encodeURIComponent(args.keyword)}` : ''
      const bridge = getBridge()
      const promptText = [
        bridge.prompt,
        args.keyword,
        args.message,
        args.query,
        args.title,
      ].filter(Boolean).join('\n')
      try {
        const body = await biFetch('GET', `/api/internal/bi/datasets${q}`, undefined, exec.signal)
        let list = Array.isArray(body) ? body : (body?.data || body?.datasets || [])
        let source = 'java'
        if (args.keyword && /订单|支付订单|订单表|t_pay_order|pay_order|order/.test(promptText)) {
          try {
            const allBody = await biFetch('GET', '/api/internal/bi/datasets', undefined, exec.signal)
            const all = Array.isArray(allBody) ? allBody : (allBody?.data || allBody?.datasets || [])
            const merged = mergeDatasets(list, all)
            if (merged.length > list.length) {
              list = merged
              source = 'java+ranked-all'
            }
          } catch {
            // The keyword-filtered list remains usable; broad fallback is best-effort.
          }
        }
        const withFallback = withDemoOrderFallback(list, promptText)
        if (withFallback.length > list.length) source = `${source}+demo-order`
        const ranked = rankDatasetsForPrompt(withFallback, promptText)
        const preferredDataset = ranked[0] || null
        const preferredScore = preferredDataset ? scoreDatasetForPrompt(preferredDataset, promptText) : 0
        return toLosslessJson({
          datasets: ranked,
          preferredDataset,
          matchReason: preferredScore > 0 ? '已按用户问题中的业务实体优先排序；订单/支付订单请求优先 t_pay_order / ds_012eb19e。' : undefined,
          source,
        })
      } catch (err) {
        const fallback = withDemoOrderFallback([], promptText)
        if (fallback.length) {
          return toLosslessJson({
            ok: true,
            datasets: fallback,
            preferredDataset: fallback[0],
            matchReason: 'Java 数据集目录暂不可用；本地演示环境按订单报告语义提供 t_pay_order / ds_012eb19e 兜底。',
            source: 'java-error+demo-order',
            error: String(err?.message || err),
          })
        }
        return toLosslessJson({
          ok: false,
          datasets: [],
          source: 'java-error',
          error: String(err?.message || err),
        })
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_get_schema',
    description:
      'Get dataset fields (name, label, group, dataType, role) plus up to 3 sample rows, '
      + 'confirmed glossary terms, few-shot questions, and semantic (confirmed metrics with '
      + 'agg(field) expressions, dimension literals, gold NL→SQL). '
      + 'If semantic.metrics is non-empty, use those expressions for named KPIs — do not invent aggregations. '
      + 'Filter with semantic.dimensions.values as exact literals. Call before od_run_query / od_run_sql.',
    parameters: {
      datasetId: { type: 'string', required: true, description: 'Dataset id from od_list_datasets' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          tableName: { type: 'string' },
          fields: { type: 'array' },
          sample: { type: 'array' },
          terms: { type: 'array' },
          questions: { type: 'array' },
          source: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        if (value.ok === false) {
          return [{ type: 'text', text: `schema failed: ${value.error || 'unknown'}` }]
        }
        const fields = Array.isArray(value.fields) ? value.fields : []
        const sample = fields.slice(0, 24).map((f) => {
          if (typeof f === 'string') return f
          return `${f?.name || f?.dataeaseName || '?'}(${f?.label || f?.group || f?.role || ''})`
        })
        const more = fields.length > 24 ? ` …+${fields.length - 24}` : ''
        const peek = Array.isArray(value.sample) && value.sample.length
          ? `\nsample ${value.sample.length} row(s)`
          : ''
        const nQ = Array.isArray(value.questions) ? value.questions.length : 0
        const nT = Array.isArray(value.terms) ? value.terms.length : 0
        const nM = Array.isArray(value.semantic?.metrics) ? value.semantic.metrics.length : 0
        const nD = Array.isArray(value.semantic?.dimensions) ? value.semantic.dimensions.length : 0
        const extra = (nQ || nT || nM || nD)
          ? `\nterms=${nT} · few-shot=${nQ} · semantic metrics=${nM} dims=${nD}`
          : ''
        return [{
          type: 'text',
          text: `schema ${value.datasetId}: ${fields.length} fields (${value.source}${value.error ? `; ${value.error}` : ''})\n${sample.join(', ')}${more}${peek}${extra}`,
        }]
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `schema · ${args.datasetId}`,
      kind: 'read',
    }),
    presentResult: (args, result) => ({
      card: 'generic',
      title: `schema · ${args.datasetId}`,
      kind: 'read',
      content: result.content,
    }),
    async execute(args, exec) {
      const guarded = leadReportSchemaGuard(exec)
      if (guarded) return guarded
      const ds = String(args.datasetId)
      try {
        let schema
        let schemaSource = 'java'
        try {
          schema = await biFetch(
            'GET',
            `/api/internal/bi/datasets/${encodeURIComponent(ds)}/schema`,
            undefined,
            exec.signal,
          )
        } catch (err) {
          if (!isDemoOrderDataset(ds)) throw err
          schema = demoOrderSchema()
          schemaSource = 'demo-fallback'
        }
        let terms = []
        let questions = []
        let knowledge = null
        try {
          knowledge = await biFetch(
            'GET',
            `/api/internal/bi/knowledge?datasetIds=${encodeURIComponent(ds)}`,
            undefined,
            exec.signal,
          )
          terms = slimTerms(knowledge, 24)
        } catch {
          /* optional */
        }
        try {
          const qs = await biFetch(
            'GET',
            `/api/internal/bi/datasets/${encodeURIComponent(ds)}/questions?limit=3`,
            undefined,
            exec.signal,
          )
          questions = slimQuestions(qs, 3)
        } catch {
          /* optional */
        }
        const rawFields = schema?.fields || schema?.data || []
        const fields = mergeKnowledgeIntoFields(rawFields, knowledge)
        const semantic = projectSemantic({ knowledge, questions })
        return toLosslessJson({
          ok: true,
          datasetId: ds,
          name: schema?.name ?? null,
          tableName: schema?.tableName ?? null,
          engine: schema?.engine ?? null,
          fields,
          sample: clipSample(schema?.sample, 3),
          terms,
          metrics: Array.isArray(knowledge?.metrics) ? knowledge.metrics.slice(0, 24) : [],
          questions,
          semantic,
          source: schemaSource,
        })
      } catch (err) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          fields: [],
          sample: [],
          terms: [],
          questions: [],
          source: 'error',
          error: String(err?.message || err),
        })
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_run_query',
    description:
      'Run a controlled chartQuery with inline encode (no raw SQL). '
      + 'encode MUST use category (dim) + value (measure) + agg (SUM|COUNT|AVG). '
      + 'Aliases x→category and y→value are accepted. For 分布/构成 use agg=COUNT. '
      + 'Do NOT use on /board path — plan/layout/emit_patch only. '
      + 'Ratio/费率 fields must use AVG (Harness coerces illegal SUM). '
      + 'Large tables are sample-aggregated server-side (~50k rows). Prefer after od_get_schema. '
      + 'Presentation: intermediate probes leave presentAnswer unset/false (collapsed tool + table only). '
      + 'Only the final answer(s) set presentAnswer=true — that is when an inline chart/table card with SQL appears. '
      + 'Multi-part user questions: one presentAnswer=true call per sub-question (prefer chartType=table). '
      + 'Probes must use chartType=table; final may use table|bar|line|pie|kpi. '
      + 'If result is sampled/scaled, never claim full-table exact totals in the user summary.',
    parameters: {
      datasetId: { type: 'string', required: true },
      chartType: { type: 'string', required: true, description: 'table | bar | line | pie | kpi — probes=table; final answer may chart' },
      title: { type: 'string', description: 'Result title' },
      presentAnswer: {
        type: 'boolean',
        description: 'true = show final answer card (chart/table+SQL) in chat; false/omit = collapsed tool with table preview only',
      },
      encode: {
        type: 'object',
        required: true,
        description: 'category + value + agg (or x/y aliases). Field names from od_get_schema.',
        additionalProperties: true,
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          answerId: { type: 'string' },
          title: { type: 'string' },
          chartType: { type: 'string' },
          datasetId: { type: 'string' },
          rowCount: { type: 'number' },
          fields: { type: 'array' },
          rows: { type: 'array' },
          sample: { type: 'array' },
          source: { type: 'string' },
          presentAnswer: { type: 'boolean' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: askResultTextForLlm(value, 'query'),
      }],
      presentationMeta(args, value) {
        return toLosslessJson(answerPresentationMeta(value, { presentAnswer: Boolean(args?.presentAnswer) }))
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.presentAnswer
        ? (args.title || `答案 · ${args.chartType}`)
        : (args.title || `查询 · ${args.chartType || 'table'}`),
      kind: 'search',
    }),
    presentResult: (args, result) => {
      if (result.isError) {
        return { card: 'generic', title: 'query failed', content: result.content }
      }
      const meta = result.meta
      if (meta?.odKind === 'ask_probe') {
        const md = meta.empty
          ? (meta.insight || '查询成功但 0 行')
          : markdownTable(meta.fields, meta.rows)
        return {
          card: 'generic',
          title: `查询 · ${meta.title || args.title || '探查'} · ${meta.rowCount ?? 0} 行`,
          kind: 'search',
          content: [{ type: 'text', text: md }],
        }
      }
      if (meta && (meta.odKind === 'answer_table' || meta.odKind === 'answer_chart')) {
        const label = meta.odKind === 'answer_chart' ? '图' : '表'
        const sqlLine = meta.sqlHint ? `\n\n\`\`\`sql\n${meta.sqlHint}\n\`\`\`` : ''
        const md = meta.empty
          ? (meta.insight || '查询成功但 0 行')
          : (meta.odKind === 'answer_table'
            ? markdownTable(meta.fields, meta.rows)
            : `${meta.title || args.title || '临时图'} · ${meta.rowCount} 点 · ${meta.chartType}`)
        return {
          card: 'generic',
          title: `${label} · ${meta.title || args.title || '结果'} · ${meta.rowCount}`,
          kind: 'search',
          content: [{ type: 'text', text: md + sqlLine }],
        }
      }
      return { card: 'generic', title: args.title || 'query', content: result.content }
    },
    async execute(args, exec) {
      const ds = String(args.datasetId)
      const chartType = String(args.chartType || 'table')
      const title = String(args.title || '问数结果')
      const presentAnswer = Boolean(args.presentAnswer)
      const loaded = await loadSchemaAndProfile(ds, exec.signal)
      const encode = normalizeChartEncode(args.encode || {}, ds, loaded.fields)
      const answerId = randomUUID()
      if (!encode.category || !encode.value) {
        return toLosslessJson({
          ok: false,
          answerId,
          title,
          chartType,
          datasetId: ds,
          encode,
          presentAnswer,
          error: 'encode requires category (or x) and value (or y). For 分布 use {category, value: same-or-measure, agg:"COUNT"}',
          source: 'gate',
        })
      }
      try {
        const result = await biFetch('POST', '/api/internal/bi/query/chart', {
          chartId: 'ask_preview',
          dashboardId: null,
          view: 'draft',
          inline: { datasetId: ds, chartType, title, encode },
          context: {},
        }, exec.signal)
        const data = result?.data || []
        const fields = result?.fields || []
        const rows = Array.isArray(data) ? data.slice(0, PREVIEW_ROW_LIMIT) : []
        const rowCount = typeof result?.rowCount === 'number' ? result.rowCount : data.length
        return toLosslessJson(withSampleMeta(enrichAskResult({
          ok: true,
          answerId,
          title,
          chartType,
          datasetId: ds,
          encode,
          fields,
          rows,
          sample: rows.slice(0, 8),
          rowCount,
          source: 'java',
          presentAnswer,
          sqlHint: result?.extra?.sql || result?.sql || undefined,
        }, { autoChart: true, requestedChartType: chartType }), result?.extra))
      } catch (err) {
        const aborted = Boolean(exec.signal?.aborted)
          || err?.name === 'AbortError'
          || /aborted|timed out|timeout/i.test(String(err?.message || err))
        if (aborted) {
          return toLosslessJson({
            ok: false,
            answerId,
            title,
            chartType,
            datasetId: ds,
            presentAnswer,
            error: exec.signal?.aborted ? 'cancelled by user' : String(err?.message || err),
            source: 'cancelled',
          })
        }
        return toLosslessJson({
          ok: false,
          answerId,
          title,
          chartType,
          datasetId: ds,
          encode,
          presentAnswer,
          error: String(err?.message || err),
          source: 'java-error',
        })
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_run_sql',
    description:
      'SQLBot Ask-3: execute a SELECT generated from M-Schema. '
      + 'Only SELECT/WITH against the current dataset physical table. '
      + 'Do NOT use this to generate a dashboard (use od_board_worker). '
      + 'Do NOT GROUP BY a fact table without a tight WHERE — LIMIT on the outer query still full-scans and will time out. '
      + 'Prefer od_run_query for aggregations (server samples large tables). '
      + 'Prefer after od_get_schema. '
      + 'Presentation: intermediate probes omit presentAnswer (collapsed tool + table). '
      + 'Only final answer(s) set presentAnswer=true to show the inline card with 查看 SQL. '
      + 'Multi-part questions: one presentAnswer=true card per sub-question (prefer table). '
      + 'Probes: chartType=table. Final: table|bar|line|pie|kpi. '
      + 'Sampled/scaled results are preview-grade — do not present as exact full-table. '
      + '问「有多少 X」时：探查 COUNT 用 table；最终小结果（≤20）用 presentAnswer=true 的 table 列出 X。',
    parameters: {
      datasetId: { type: 'string', required: true },
      sql: { type: 'string', required: true, description: 'SELECT/WITH only; shown on the final answer card as 查看 SQL' },
      title: { type: 'string' },
      chartType: { type: 'string', description: 'table (default) | bar | line | pie | kpi — probes must be table' },
      presentAnswer: {
        type: 'boolean',
        description: 'true = final answer card in chat; false/omit = collapsed tool with table preview',
      },
      limit: { type: 'number', description: 'Row cap (default 1000)' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          answerId: { type: 'string' },
          title: { type: 'string' },
          chartType: { type: 'string' },
          datasetId: { type: 'string' },
          rowCount: { type: 'number' },
          fields: { type: 'array' },
          rows: { type: 'array' },
          sample: { type: 'array' },
          source: { type: 'string' },
          gate: { type: 'string' },
          presentAnswer: { type: 'boolean' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? (value.empty
            ? `sql ok: 0 行 — ${value.insight || '无数据'}`
            : `sql ok (gate=${value.gate || 'pass'}):\n${askResultTextForLlm(value, 'sql')}`)
          : `sql rejected: ${value.error || 'unknown'}`,
      }],
      presentationMeta(args, value) {
        const v = value && typeof value === 'object' ? { ...value } : value
        if (v && !v.sqlHint && args?.sql) v.sqlHint = String(args.sql)
        return toLosslessJson(answerPresentationMeta(v, { presentAnswer: Boolean(args?.presentAnswer) }))
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.presentAnswer
        ? (args.title || `答案 · ${args.chartType || 'table'}`)
        : (args.title || `sql · ${args.chartType || 'table'}`),
      kind: 'search',
    }),
    presentResult: (args, result) => {
      if (result.isError) {
        return { card: 'generic', title: 'sql failed', content: result.content }
      }
      const meta = result.meta
      if (meta?.odKind === 'ask_probe') {
        const md = meta.empty
          ? (meta.insight || '查询成功但 0 行')
          : markdownTable(meta.fields, meta.rows)
        return {
          card: 'generic',
          title: `查询 · ${meta.title || args.title || '探查'} · ${meta.rowCount ?? 0} 行`,
          kind: 'search',
          content: [{ type: 'text', text: md }],
        }
      }
      if (meta && meta.odKind === 'answer_table') {
        const sqlLine = meta.sqlHint ? `\n\n\`\`\`sql\n${meta.sqlHint}\n\`\`\`` : ''
        return {
          card: 'generic',
          title: `表 · ${meta.title || 'SQLBot'} · ${meta.rowCount}`,
          content: [{
            type: 'text',
            text: (meta.empty ? (meta.insight || '查询成功但 0 行') : markdownTable(meta.fields, meta.rows)) + sqlLine,
          }],
        }
      }
      if (meta && meta.odKind === 'answer_chart') {
        const sqlLine = meta.sqlHint ? `\n\n\`\`\`sql\n${meta.sqlHint}\n\`\`\`` : ''
        return {
          card: 'generic',
          title: `图 · ${meta.title || 'SQLBot'} · ${meta.chartType}`,
          content: [{
            type: 'text',
            text: meta.empty
              ? (meta.insight || '查询成功但 0 行')
              : `${meta.rowCount} points\n${markdownTable(meta.fields, (meta.rows || []).slice(0, 8))}${sqlLine}`,
          }],
        }
      }
      return { card: 'generic', title: args.title || 'sql', content: result.content }
    },
    async execute(args, exec) {
      const ds = String(args.datasetId)
      const sql = String(args.sql || '')
      const chartType = String(args.chartType || 'table')
      const title = String(args.title || 'SQLBot')
      const presentAnswer = Boolean(args.presentAnswer)
      const limit = Number(args.limit) > 0 ? Number(args.limit) : 1000
      const answerId = randomUUID()

      let tableName
      let engine
      try {
        const schema = await biFetch(
          'GET',
          `/api/internal/bi/datasets/${encodeURIComponent(ds)}/schema`,
          undefined,
          exec.signal,
        )
        tableName = schema?.tableName
        engine = schema?.engine
      } catch (err) {
        return toLosslessJson({
          ok: false,
          answerId,
          datasetId: ds,
          chartType,
          title,
          presentAnswer,
          error: `schema unavailable: ${String(err?.message || err)}`,
          source: 'java-error',
          gate: 'reject',
        })
      }
      if (!tableName) {
        return toLosslessJson({
          ok: false,
          answerId,
          datasetId: ds,
          presentAnswer,
          error: 'dataset has no physical table',
          source: 'gate',
          gate: 'reject',
        })
      }
      try {
        assertAllowedTables(sql, [tableName])
      } catch (err) {
        return toLosslessJson({
          ok: false,
          answerId,
          datasetId: ds,
          chartType,
          title,
          presentAnswer,
          error: String(err?.message || err),
          source: 'gate',
          gate: 'reject',
        })
      }

      try {
        const executed = await biFetch('POST', '/api/internal/bi/query/sql', {
          datasetId: ds,
          sql,
          limit,
        }, exec.signal)
        const data = executed?.data || []
        const fields = executed?.fields || []
        const rows = Array.isArray(data) ? data.slice(0, PREVIEW_ROW_LIMIT) : []
        const rowCount = typeof executed?.rowCount === 'number' ? executed.rowCount : data.length
        return toLosslessJson(withSampleMeta(enrichAskResult({
          ok: true,
          answerId,
          title,
          chartType,
          datasetId: ds,
          fields,
          rows,
          sample: rows.slice(0, 8),
          rowCount,
          source: 'java',
          gate: 'pass',
          engine: engine || undefined,
          presentAnswer,
          sqlHint: sql,
        }, { autoChart: true, requestedChartType: chartType }), executed))
      } catch (err) {
        const aborted = Boolean(exec.signal?.aborted)
          || err?.name === 'AbortError'
          || /aborted|timed out|timeout/i.test(String(err?.message || err))
        if (aborted) {
          return toLosslessJson({
            ok: false,
            answerId,
            datasetId: ds,
            chartType,
            title,
            presentAnswer,
            error: exec.signal?.aborted ? 'cancelled by user' : String(err?.message || err),
            source: 'cancelled',
            gate: 'reject',
          })
        }
        // Never invent demo rows (华东/华北 stub). Fail closed so the model can clarify.
        return toLosslessJson({
          ok: false,
          presentAnswer,
          answerId,
          datasetId: ds,
          chartType,
          title,
          error: String(err?.message || err),
          source: 'java-error',
          gate: 'reject',
        })
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_profile_dataset',
    description:
      'Optional field stats for ask-data. Do NOT use on /board — od_plan_charts already loads stats profile (no live GROUP BY). '
      + 'Prefer od_board_worker for creating a dashboard. Do not call od_run_query / od_run_sql on the board path.',
    parameters: {
      datasetId: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          datasetId: { type: 'string' },
          fields: { type: 'array' },
          source: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        if (!value.ok) {
          return [{ type: 'text', text: `profile failed: ${value.error || 'unknown'}` }]
        }
        const fields = Array.isArray(value.fields) ? value.fields : []
        const sample = fields.slice(0, 20).map((f) => {
          if (typeof f === 'string') return f
          return `${f?.name || '?'}[${f?.role || f?.group || ''}]`
        })
        return [{
          type: 'text',
          text: `profile ${value.datasetId}: ${fields.length} fields (${value.source}${value.error ? `; ${value.error}` : ''})\n${sample.join(', ')}`,
        }]
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `profile · ${args.datasetId}`,
      kind: 'search',
    }),
    presentResult: (args, result) => ({
      card: 'generic',
      title: `profile · ${args.datasetId}`,
      content: result.content,
    }),
    async execute(args, exec) {
      const guarded = leadReportSchemaGuard(exec)
      if (guarded) return guarded
      const ds = String(args.datasetId)
      try {
        // Heavy on large MySQL tables (multiple full-table probes). Prefer schema+plan for gen.
        const profile = await biFetch('POST', '/api/internal/bi/profile-dataset', {
          datasetId: ds,
        }, exec.signal)
        const fields = Array.isArray(profile?.fields) ? profile.fields : []
        const probes = Array.isArray(profile?.probes)
          ? profile.probes.map((p) => {
            if (!p || typeof p !== 'object') return p
            const { sql: _sql, ...rest } = p
            return rest
          })
          : []
        return toLosslessJson({
          ok: true,
          datasetId: ds,
          name: profile?.name || null,
          tableName: profile?.tableName || null,
          fields,
          probes,
          measures: profile?.measures || null,
          dims: profile?.dims || null,
          timeFields: profile?.timeFields || null,
          liveRowHint: profile?.liveRowHint ?? null,
          source: 'java',
        })
      } catch (err) {
        try {
          const schema = await biFetch(
            'GET',
            `/api/internal/bi/datasets/${encodeURIComponent(ds)}/schema`,
            undefined,
            exec.signal,
          )
          return toLosslessJson({
            ok: true,
            datasetId: ds,
            fields: schema?.fields || [],
            tableName: schema?.tableName || null,
            source: 'schema-fallback',
            note: 'profile-dataset unavailable; used schema',
            error: String(err?.message || err),
          })
        } catch (err2) {
          return toLosslessJson({
            ok: false,
            datasetId: ds,
            fields: [],
            source: 'error',
            error: String(err2?.message || err2),
          })
        }
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_plan_charts',
    description:
      'Dashboard-only. Do NOT use for analysis reports; reports must call od_board_worker(description=写分析报告) and must not depend on semanticReady. '
      + 'Plan dashboard analysis tasks from schema/profile (CapabilityCard → LLM tasks → bind + review). '
      + 'Each task is a business question + dim/measure — do NOT lock chartType here. '
      + 'Live path NEVER uses rule enumerateGoals. If LLM is unavailable or all tasks fail the quality gate, '
      + 'return error — do not invent charts. Shows question list and ALWAYS ends the turn — do NOT call '
      + 'od_board_worker or od_generate_board in the same turn. If needClarify, only ask the user. '
      + 'After the user replies 确认/生成, call od_board_worker once (prompt must include datasetId, title, '
      + 'goalsForConfirm JSON, linked dashboardId). Last-resort only: od_generate_board. '
      + 'Pass datasetId + message. No od_run_query/od_run_sql. Do not invent a patch.',
    parameters: {
      datasetId: { type: 'string', required: true },
      fields: { type: 'array', description: 'Optional field list; else fetch schema + stats + knowledge' },
      title: { type: 'string' },
      message: { type: 'string', description: 'User theme; weights matching fields' },
      goalPlan: {
        type: 'object',
        description: 'Optional injected Goal JSON {mode,goals} for tests / offline; skips live LLM',
        additionalProperties: true,
      },
      goals: {
        type: 'array',
        description: 'Optional pre-bound goals; skips LLM',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          charts: { type: 'array' },
          query: { type: 'object', additionalProperties: true },
          source: { type: 'string' },
          needClarify: { type: 'boolean' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        if (!value.ok) {
          return [{ type: 'text', text: `plan failed: ${value.note || value.error || 'unknown'}` }]
        }
        if (value.needClarify) {
          return [{
            type: 'text',
            text: `需要澄清后再规划：${value.clarifyQuestion || '请补充指标或维度'}\n（本轮不要调用 od_board_worker / od_generate_board）`,
          }]
        }
        const charts = Array.isArray(value.charts) ? value.charts : []
        const SLOT_ZH = {
          kpi_count: '全景', kpi_sum: '全景', kpi_ratio: '全景', kpi: '全景',
          trend: '趋势', compare: '结构', rank: '排行', compose: '构成', table: '明细',
        }
        const lines = charts.map((c, i) => {
          const q = c?.question || c?.title || ''
          const slot = SLOT_ZH[c?.intent] || ''
          const why = c?.rationale ? ` — ${c.rationale}` : ''
          return `${i + 1}. ${slot ? `【${slot}】` : ''}${q}（图种待取数后定）${why}`
        })
        const queryItems = value.query?.items
        const queryLine = Array.isArray(queryItems) && queryItems.length
          ? `\n查询条：${queryItems.map((q) => q.label || q.field).join('、')}`
          : ''
        const q = value.quality
        const qualityLine = q
          ? `\n质量闸：LLM ${q.llmGoalCount || 0} → bind ${q.boundCount || 0} → review ${q.reviewedCount || 0}`
          : ''
        const note = value.note ? `\n${value.note}` : ''
        const src = value.source ? ` · ${value.source}` : ''
        const slimGoals = (Array.isArray(value.goals) && value.goals.length
          ? value.goals
          : charts).map((g) => ({
          intent: g.intent || undefined,
          question: g.question || g.title || '',
          dim: g.encode?.category || g.dim || undefined,
          measure: g.encode?.value || g.measure || undefined,
          agg: g.encode?.agg || g.agg || undefined,
          slot: g.slot || undefined,
        }))
        const goalsBlock = slimGoals.length
          ? `\ngoalsForConfirm=${JSON.stringify(slimGoals)}\n（确认生成时把上述 goalsForConfirm 原样写入 od_board_worker.prompt；用户改目标时先 od_plan_charts(message=改后原话) 再等确认）`
          : ''
        return [{
          type: 'text',
          text: `经营驾驶舱规划 ${charts.length} 个分析任务（待确认${src}）\n${lines.join('\n')}${queryLine}${qualityLine}${note}${goalsBlock}`
            + `\n\n本轮不要调用 od_board_worker / od_generate_board。回复「确认」后由 board worker 按任务取数再定图种；要改任务请直接说。`,
        }]
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `plan · ${args.datasetId}`,
      kind: 'search',
    }),
    presentResult: (args, result) => ({
      card: 'generic',
      title: `plan · ${args.datasetId}`,
      content: result.content,
    }),
    async execute(args, exec) {
      if (isAnalysisReportToolRequest(args)) return reportMustUseWorkerError()
      const ds = String(args.datasetId)
      const loaded = await loadSchemaAndProfile(ds, exec.signal)
      let fields = Array.isArray(args.fields) && args.fields.length ? args.fields : loaded.fields
      if (!fields.length) {
        return toLosslessJson({
          ok: false,
          error: loaded.error || 'no fields to plan from',
          datasetId: ds,
        })
      }
      const semanticReadiness = assessSemanticReadiness({
        fields,
        profile: loaded.profile,
        knowledge: loaded.knowledge,
      })
      if (!semanticReadiness.ready) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          error: semanticNotReadyMessage(semanticReadiness),
          note: 'semanticReady=false; full-board planning is fail-closed',
          source: 'semantic-not-ready',
          semanticReadiness,
        })
      }
      const planned = await planBoardAnalysis({
        datasetId: ds,
        fields,
        message: args.message || '',
        profile: loaded.profile,
        datasetName: loaded.name,
        goalPlan: args.goalPlan,
        goals: args.goals,
        signal: exec.signal,
        credentials: harnessCredentials(ctx),
      })
      if (planned.ok === false || planned.source === 'goals-rejected') {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title: args.title || 'AI 生成看板',
          error: planned.error || planned.note || 'goals rejected',
          note: planned.note,
          source: planned.source || 'goals-rejected',
          needClarify: false,
          charts: [],
          goals: [],
          quality: planned.quality || null,
        })
      }
      return toLosslessJson({
        ok: true,
        datasetId: ds,
        title: args.title || 'AI 生成看板',
        charts: planned.charts,
        goals: planned.goals,
        query: planned.query,
        capabilityCard: planned.capabilityCard,
        needClarify: !!planned.needClarify,
        clarifyQuestion: planned.clarifyQuestion || null,
        source: planned.source,
        note: planned.note || '',
        model: planned.model || null,
        quality: planned.quality || null,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_layout_board',
    description:
      'DEPRECATED for dashboard creation. Prefer od_board_worker. '
      + 'This only turns charts into a DashboardPatch; do not use on /board path.',
    parameters: {
      title: { type: 'string' },
      styleId: { type: 'string' },
      charts: { type: 'array', required: true },
      query: { type: 'object', additionalProperties: true },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          title: { type: 'string' },
          mode: { type: 'string' },
          patch: { type: 'object', additionalProperties: true },
          chartCount: { type: 'number' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `layout: ${value.chartCount} charts → ${(value.patch?.ops || []).length} ops`
          : `layout failed: ${value.error || 'unknown'}`,
      }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.title || 'layout board',
      kind: 'search',
    }),
    presentResult: (args, result) => ({
      card: 'generic',
      title: args.title || 'layout',
      content: result.content,
    }),
    async execute(args) {
      return toLosslessJson(layoutBoardPatch({
        title: args.title,
        styleId: args.styleId,
        charts: args.charts,
        query: args.query,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_compose_board',
    description:
      'DISABLED. Do not call. Planning failed or missing worker must NOT invent a template board. '
      + 'Tell the user to retry od_plan_charts / od_board_worker. Never SUM identifier fields.',
    parameters: {
      message: { type: 'string', required: true },
      datasetIds: { type: 'array', required: true },
      dashboardId: { type: 'string' },
      styleId: { type: 'string' },
      mode: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok === false
          ? `compose failed: ${value.error}`
          : `board ready: ${value.dashboardId} (${value.chartCount || 0} charts)`,
      }],
      presentationMeta(_args, value) {
        return boardPresentationMeta(value)
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.message || 'compose board',
      kind: 'write',
    }),
    presentResult: (args, result) => {
      if (result.isError) {
        return { card: 'generic', title: 'compose failed', content: result.content }
      }
      const meta = result.meta
      if (meta?.odKind === 'board_ready') {
        return {
          card: 'generic',
          title: `看板 · ${meta.title || args.message || 'compose'}`,
          kind: 'write',
          content: [{
            type: 'text',
            text: `${meta.chartCount} 图已写入 draft${meta.editPath ? ` → ${meta.editPath}` : ''}`,
          }],
        }
      }
      return { card: 'generic', title: 'compose', content: result.content }
    },
    async execute() {
      return toLosslessJson({
        ok: false,
        error: 'od_compose_board is disabled. Retry od_plan_charts, then od_board_worker after the user confirms. Do not invent a template board.',
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_get_board_summary',
    description:
      'Read charts on the current conversation draft (chartId, title, type, encode). '
      + 'Required before changing charts. Does not create a dashboard.',
    parameters: {
      dashboardId: { type: 'string', description: 'Defaults to the last generated / linked draft' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        if (!value.ok) return [{ type: 'text', text: `board summary failed: ${value.error || 'unknown'}` }]
        const charts = Array.isArray(value.charts) ? value.charts : []
        const lines = charts.map((c, i) => `${i + 1}. ${c.title || c.chartId}（${c.chartType || '?'} · ${c.chartId}）`)
        return [{ type: 'text', text: `看板 ${value.dashboardId} · ${charts.length} 图\n${lines.join('\n') || '（空）'}` }]
      },
    },
    presentCall: (args) => ({ card: 'generic', title: `summary · ${args.dashboardId || 'linked'}`, kind: 'search' }),
    presentResult: (args, result) => ({ card: 'generic', title: 'board summary', content: result.content }),
    async execute(args, exec) {
      const id = rememberedDashboardId(args.dashboardId)
      if (!id) return toLosslessJson({ ok: false, error: 'dashboardId required (no linked draft yet)' })
      try {
        const body = await biFetch('GET', `/api/internal/bi/board-summary?dashboardId=${encodeURIComponent(id)}`, undefined, exec.signal)
        const charts = Array.isArray(body?.charts) ? body.charts : []
        patchBridge({ dashboardId: id })
        return toLosslessJson({ ok: true, dashboardId: id, charts, components: body?.components || [], name: body?.name || '' })
      } catch (err) {
        return toLosslessJson({ ok: false, dashboardId: id, error: String(err?.message || err) })
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_rechart_chart',
    description:
      'Update one or more EXISTING charts on the linked draft in place (same chartId, merge patch). '
      + 'Use after a board exists when the user wants to change type/metric/title of specific charts. '
      + 'Do NOT call od_generate_board for that (it would wipe or spawn another draft). '
      + 'Pass dashboardId of the open draft + message. Optional chartIds[]. '
      + 'LLM plans which charts to change, then bind+reviewCharts. Untouched charts stay. '
      + 'If the model returns regenerate, tell the user to confirm a full rewrite, then od_board_worker with the SAME dashboardId.',
    parameters: {
      dashboardId: { type: 'string', description: 'Existing draft; defaults to last generated' },
      message: { type: 'string', required: true, description: 'User edit, e.g. 把类型分布改成柱图' },
      chartIds: { type: 'array', description: 'Optional explicit chartId list' },
      datasetId: { type: 'string' },
      changes: { type: 'array', description: 'Optional injected changes for tests' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        if (value.needClarify) {
          return [{ type: 'text', text: `需要澄清：${value.clarifyQuestion || '请指出要改哪张图'}` }]
        }
        if (value.regenerate) {
          return [{ type: 'text', text: '用户要求整页重做：确认后 od_board_worker(同一 dashboardId)，不要新建草稿。' }]
        }
        if (!value.ok) return [{ type: 'text', text: `rechart failed: ${value.note || value.error || 'unknown'}` }]
        const titles = (value.charts || []).map((c) => c.title || c.chartId)
        return [{ type: 'text', text: `已原地更新 ${value.chartCount} 图（${value.dashboardId}）：${titles.join('、')}` }]
      },
      presentationMeta(_args, value) {
        return boardPresentationMeta(value)
      },
    },
    presentCall: (args) => ({ card: 'generic', title: `rechart · ${args.dashboardId || 'linked'}`, kind: 'write' }),
    presentResult: (args, result) => {
      if (result.isError) {
        return { card: 'generic', title: 'rechart failed', content: result.content }
      }
      const meta = result.meta
      if (meta?.odKind === 'board_ready') {
        return {
          card: 'generic',
          title: `看板已更新 · ${meta.title || args.message || ''}`,
          kind: 'write',
          content: [{
            type: 'text',
            text: `${meta.chartCount} 图已原地写入同一 draft${meta.editPath ? ` → ${meta.editPath}` : ''}`,
          }],
        }
      }
      return { card: 'generic', title: 'rechart', content: result.content }
    },
    async execute(args, exec) {
      const id = rememberedDashboardId(args.dashboardId)
      if (!id) return toLosslessJson({ ok: false, error: 'dashboardId required (generate a board first)' })
      let summary
      try {
        summary = await biFetch('GET', `/api/internal/bi/board-summary?dashboardId=${encodeURIComponent(id)}`, undefined, exec.signal)
      } catch (err) {
        return toLosslessJson({ ok: false, dashboardId: id, error: String(err?.message || err) })
      }
      const charts = Array.isArray(summary?.charts) ? summary.charts : []
      if (!charts.length) {
        return toLosslessJson({ ok: false, dashboardId: id, error: 'draft has no charts' })
      }
      const dsIds = [...new Set(charts.map((c) => c.datasetId).filter(Boolean))]
      if (args.datasetId) dsIds.unshift(String(args.datasetId))
      const fieldsByDataset = {}
      let fallbackFields = []
      for (const ds of dsIds) {
        const loaded = await loadSchemaAndProfile(ds, exec.signal)
        fieldsByDataset[ds] = loaded.fields || []
        if (!fallbackFields.length) fallbackFields = loaded.fields || []
      }
      const planned = await planRechart({
        charts,
        message: args.message || '',
        chartIds: args.chartIds,
        fieldsByDataset,
        opts: {
          fields: fallbackFields,
          changes: args.changes,
          signal: exec.signal,
          credentials: harnessCredentials(ctx),
        },
      })
      if (planned.needClarify) {
        return toLosslessJson({
          ok: true,
          dashboardId: id,
          needClarify: true,
          clarifyQuestion: planned.clarifyQuestion,
        })
      }
      if (planned.regenerate) {
        return toLosslessJson({ ok: true, dashboardId: id, regenerate: true, source: planned.source })
      }
      if (!planned.ok) {
        return toLosslessJson({
          ok: false,
          dashboardId: id,
          error: planned.error,
          note: planned.note,
          source: planned.source,
        })
      }
      const applied = await applyDashboardPatch({
        title: summary?.name || 'AI 生成看板',
        mode: 'merge',
        patch: planned.patch,
        dashboardId: id,
        signal: exec.signal,
      })
      if (!applied.ok) return applied
      return toLosslessJson({
        ...applied,
        charts: planned.charts,
        chartTitles: planned.charts.map((c) => c.title).filter(Boolean),
        planSource: planned.source,
        quality: planned.quality,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_generate_board',
    description:
      'Dashboard-only. Do NOT use for analysis reports; reports must call od_board_worker(description=写分析报告) and must not depend on semanticReady. '
      + 'LAST-RESORT write of a full dashboard draft when od_board_worker is unavailable. '
      + 'Prefer od_board_worker after the user confirms plan tasks (确认/生成/可以/OK). '
      + 'Never call in the same turn as od_plan_charts. '
      + 'This path realizes each task with a sampled chartQuery then picks chart type — still do NOT call od_run_query yourself. '
      + 'If a draft is already linked, ALWAYS pass that dashboardId so this overwrites the SAME board. '
      + 'To change one/several existing charts, use od_rechart_chart instead. '
      + 'Prefer passing goals[] = goalsForConfirm from od_plan_charts. '
      + 'After ok, END THE TURN immediately.',
    parameters: {
      datasetId: { type: 'string', required: true },
      title: { type: 'string', description: 'Dashboard title' },
      message: { type: 'string', description: 'User theme; same weighting as od_plan_charts' },
      styleId: { type: 'string' },
      dashboardId: { type: 'string', description: 'Existing draft to replace in place; defaults to last generated' },
      goals: {
        type: 'array',
        description: 'Goals from od_plan_charts (preferred; keeps plan/generate consistent)',
      },
      goalPlan: {
        type: 'object',
        description: 'Optional Goal JSON when goals[] not passed',
        additionalProperties: true,
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          dashboardId: { type: 'string' },
          title: { type: 'string' },
          chartCount: { type: 'number' },
          chartTitles: { type: 'array' },
          source: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        if (!value.ok) {
          return [{ type: 'text', text: `generate failed: ${value.error || 'unknown'}` }]
        }
        const titles = Array.isArray(value.chartTitles) ? value.chartTitles : []
        const list = titles.length ? `\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : ''
        return [{
          type: 'text',
          text: `board ready: ${value.dashboardId} (${value.chartCount} charts)${list}`,
        }]
      },
      presentationMeta(_args, value) {
        return boardPresentationMeta(value)
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.title || `generate · ${args.datasetId}`,
      kind: 'write',
    }),
    presentResult: (args, result) => {
      if (result.isError) {
        return { card: 'generic', title: 'generate failed', content: result.content }
      }
      const meta = result.meta
      if (meta?.odKind === 'board_ready') {
        return {
          card: 'generic',
          title: `看板 · ${meta.title || args.title}`,
          kind: 'write',
          content: [{
            type: 'text',
            text: `${meta.chartCount} 图已写入 draft${meta.editPath ? ` → ${meta.editPath}` : ''}`,
          }],
        }
      }
      return { card: 'generic', title: args.title || 'generate', content: result.content }
    },
    async execute(args, exec) {
      if (isAnalysisReportToolRequest(args)) return reportMustUseWorkerError()
      const ds = String(args.datasetId || '').trim()
      const title = String(args.title || 'AI 生成看板')
      if (!ds) {
        return toLosslessJson({ ok: false, error: 'datasetId required', title })
      }
      const loaded = await loadSchemaAndProfile(ds, exec.signal)
      const fields = loaded.fields
      if (!fields.length) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          error: loaded.error || 'dataset has no fields',
          source: loaded.error ? 'java-error' : 'ts-deterministic',
        })
      }
      const semanticReadiness = assessSemanticReadiness({
        fields,
        profile: loaded.profile,
        knowledge: loaded.knowledge,
      })
      if (!semanticReadiness.ready) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          error: semanticNotReadyMessage(semanticReadiness),
          source: 'semantic-not-ready',
          semanticReadiness,
        })
      }
      const planned = await planBoardAnalysis({
        datasetId: ds,
        fields,
        message: args.message || '',
        profile: loaded.profile,
        datasetName: loaded.name,
        goals: args.goals,
        goalPlan: args.goalPlan,
        signal: exec.signal,
        credentials: harnessCredentials(ctx),
      })
      if (planned.ok === false || planned.source === 'goals-rejected') {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          error: planned.error || planned.note || 'goals rejected',
          note: planned.note,
          source: planned.source || 'goals-rejected',
        })
      }
      if (planned.needClarify) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          needClarify: true,
          clarifyQuestion: planned.clarifyQuestion,
          error: 'plan needs clarify; do not write draft yet',
          source: planned.source,
        })
      }
      if (!planned.charts?.length) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          error: 'no charts after plan/bind',
          source: planned.source,
        })
      }
      const realized = await realizeBoundCharts(planned.charts, {
        fields,
        message: args.message || '',
        signal: exec.signal,
      })
      if (!realized.ok || !realized.charts?.length) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          error: realized.note || 'all tasks empty or timed out after realize',
          dropped: realized.dropped,
          source: 'realize-rejected',
        })
      }
      const reviewed = reviewCharts(realized.charts, {
        fields,
        profile: loaded.profile,
        message: args.message || '',
      })
      if (!reviewed.length) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          error: 'no charts after realize/review',
          dropped: realized.dropped,
          source: 'realize-review-rejected',
        })
      }
      const built = layoutBoardPatch({
        title,
        styleId: args.styleId,
        charts: reviewed,
        query: planned.query,
      })
      if (!built.ok) {
        return toLosslessJson({
          ok: false,
          datasetId: ds,
          title,
          error: built.error || 'layout failed',
        })
      }
      const layout = built
      const applied = await applyDashboardPatch({
        title: layout.title || title,
        mode: 'replace',
        patch: layout.patch,
        dashboardId: rememberedDashboardId(args.dashboardId),
        signal: exec.signal,
      })
      if (!applied.ok) return applied
      return toLosslessJson({
        ...applied,
        chartTitles: reviewed.map((c) => c.title || c.question).filter(Boolean),
        planSource: planned.source,
        goals: planned.goals,
        droppedTasks: realized.dropped,
        realizeNote: realized.note || undefined,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_emit_patch',
    description:
      'DEPRECATED for new boards. Prefer od_board_worker. '
      + 'Only use to apply a patch already returned by od_layout_board (legacy).',
    parameters: {
      title: { type: 'string', required: true },
      mode: { type: 'string', required: true, description: 'replace | append' },
      patch: { type: 'object', required: true, description: 'DashboardPatch { ops: [...] }', additionalProperties: true },
      dashboardId: { type: 'string', description: 'Existing draft id; omit to create' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          dashboardId: { type: 'string' },
          title: { type: 'string' },
          chartCount: { type: 'number' },
          mode: { type: 'string' },
          source: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `board ready: ${value.dashboardId} (${value.chartCount} charts)`
          : `emit failed: ${value.error || 'unknown'}`,
      }],
      presentationMeta(_args, value) {
        return boardPresentationMeta(value)
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.title || 'emit patch',
      kind: 'write',
    }),
    presentResult: (args, result) => {
      if (result.isError) {
        return { card: 'generic', title: 'emit failed', content: result.content }
      }
      const meta = result.meta
      if (meta?.odKind === 'board_ready') {
        return {
          card: 'generic',
          title: `看板 · ${meta.title || args.title}`,
          kind: 'write',
          content: [{
            type: 'text',
            text: `${meta.chartCount} 图已写入 draft${meta.editPath ? ` → ${meta.editPath}` : ''}`,
          }],
        }
      }
      return { card: 'generic', title: args.title || 'emit', content: result.content }
    },
    async execute(args, exec) {
      return applyDashboardPatch({
        title: String(args.title || 'AI 生成看板'),
        mode: String(args.mode || 'replace'),
        patch: args.patch && typeof args.patch === 'object' ? args.patch : null,
        dashboardId: rememberedDashboardId(args.dashboardId),
        signal: exec.signal,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'od_finish',
    description: 'Mark the current ask/gen turn complete. Call when the user question is answered.',
    parameters: {
      summary: { type: 'string', description: 'One-line summary for the user' },
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, summary: { type: 'string' } },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.summary || 'done' }],
    },
    async execute(args) {
      return toLosslessJson({ ok: true, summary: args.summary || 'done' })
    },
  }))
}

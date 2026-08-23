/**
 * Live L3: merchant orders (ds_31e4ffe9) ask + board against Java BI.
 * Usage: from opendashboard-dsh-harness/
 *   OD_BI_BASE=http://127.0.0.1:8082 node scripts/live-merchant-l3.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setBridge } from '../packages/dsh-od-auth/src/bridge-state.js'
import { biFetch, toLosslessJson } from '../packages/dsh-od-bi/src/http.js'
import { enrichAskResult } from '../packages/dsh-od-bi/src/ask-enrich.js'
import {
  coerceEncodeAgg,
  mergeKnowledgeIntoFields,
} from '../packages/dsh-od-bi/src/knowledge-merge.js'
import { planBoardAnalysis } from '../packages/dsh-od-bi/src/goal-planner.js'
import { layoutBoardPatch } from '../packages/dsh-od-bi/src/gen-board.js'

const DS = process.env.OD_TEST_DATASET || 'ds_31e4ffe9'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = join(ROOT, 'docs/proposals/P012-ask-gen-quality')
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

setBridge({
  userId: process.env.OD_TEST_USER || 'u_demo',
  workspaceId: process.env.OD_TEST_WS || 'workspace-retail',
  perms: process.env.OD_TEST_PERMS || '*',
})

const report = {
  meta: {
    at: new Date().toISOString(),
    biBase: process.env.OD_BI_BASE || 'http://127.0.0.1:8082',
    datasetId: DS,
    userId: process.env.OD_TEST_USER || 'u_demo',
    workspaceId: process.env.OD_TEST_WS || 'workspace-retail',
  },
  cases: [],
}

function pass(name, detail) {
  report.cases.push({ name, ok: true, ...detail })
  console.log(`PASS  ${name}`)
}
function fail(name, detail) {
  report.cases.push({ name, ok: false, ...detail })
  console.error(`FAIL  ${name}`, detail?.error || '')
}

async function loadSchemaKnowledge() {
  const t0 = Date.now()
  const schema = await biFetch('GET', `/api/internal/bi/datasets/${encodeURIComponent(DS)}/schema`)
  let knowledge = null
  try {
    knowledge = await biFetch('GET', `/api/internal/bi/knowledge?datasetIds=${encodeURIComponent(DS)}`)
  } catch (e) {
    knowledge = { error: String(e.message || e) }
  }
  let profile = null
  try {
    profile = await biFetch('POST', '/api/internal/bi/profile-dataset', { datasetId: DS })
  } catch (e) {
    profile = { error: String(e.message || e) }
  }
  const rawFields = Array.isArray(schema?.fields) ? schema.fields : []
  const fields = mergeKnowledgeIntoFields(rawFields, knowledge)
  const ms = Date.now() - t0
  return { schema, knowledge, profile, fields, ms }
}

async function runAsk(title, encode, chartType = 'bar') {
  const t0 = Date.now()
  const { fields } = await loadSchemaKnowledge()
  const coerced = coerceEncodeAgg({ ...encode, datasetId: DS }, fields)
  const enc = { ...coerced.encode, datasetId: DS }
  try {
    const result = await biFetch('POST', '/api/internal/bi/query/chart', {
      chartId: 'ask_preview',
      dashboardId: null,
      view: 'draft',
      inline: { datasetId: DS, chartType, title, encode: enc },
      context: {},
    }, undefined, 60_000)
    const data = result?.data || []
    const rows = Array.isArray(data) ? data.slice(0, 20) : []
    const rowCount = typeof result?.rowCount === 'number' ? result.rowCount : data.length
    const enriched = enrichAskResult({
      ok: true,
      title,
      chartType,
      datasetId: DS,
      encode: enc,
      fields: result?.fields || [],
      rows,
      sample: rows.slice(0, 8),
      rowCount,
      source: 'java',
      sqlHint: result?.extra?.sql || result?.sql || undefined,
    }, { autoChart: true, requestedChartType: chartType })
    return {
      ok: true,
      ms: Date.now() - t0,
      coerced: coerced.coerced,
      coerceReason: coerced.reason,
      encode: enc,
      rowCount: enriched.rowCount,
      empty: enriched.empty,
      insight: enriched.insight,
      chartType: enriched.chartType,
      sample: enriched.sample,
      sqlHint: enriched.sqlHint,
      fields: (enriched.fields || []).slice(0, 6),
    }
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - t0,
      coerced: coerced.coerced,
      encode: enc,
      error: String(e.message || e),
    }
  }
}

function slimGoal(g) {
  const enc = g?.encode || {}
  return {
    intent: g.intent,
    dim: g.dim || enc.category || enc.x || '',
    measure: g.measure || enc.value || (Array.isArray(enc.y) ? enc.y[0] : enc.y) || '',
    agg: g.agg || enc.agg || '',
    chartType: g.chartType || g.type,
    title: g.title || g.question,
  }
}

function slimCardFields(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10).map((x) => {
    if (typeof x === 'string') return x
    if (x && typeof x === 'object') return x.field || x.name || JSON.stringify(x)
    return String(x)
  })
}

async function runBoard(message, title) {
  const t0 = Date.now()
  const loaded = await loadSchemaKnowledge()
  const planned = await planBoardAnalysis({
    datasetId: DS,
    fields: loaded.fields,
    message,
    profile: loaded.profile,
    datasetName: loaded.schema?.name || '商户订单表',
  })
  if (planned.needClarify) {
    return {
      ok: true,
      phase: 'clarify',
      ms: Date.now() - t0,
      source: planned.source,
      clarifyQuestion: planned.clarifyQuestion,
      note: planned.note,
      capabilityJunk: planned.capabilityCard?.junk?.slice?.(0, 8),
      additive: slimCardFields(planned.capabilityCard?.additive),
      ratios: slimCardFields(planned.capabilityCard?.ratio),
    }
  }
  const built = layoutBoardPatch({
    title,
    charts: planned.charts,
    query: planned.query,
  })
  if (!built.ok) {
    return {
      ok: false,
      phase: 'layout',
      ms: Date.now() - t0,
      source: planned.source,
      error: built.error,
      chartCount: planned.charts?.length || 0,
    }
  }
  const applied = await biFetch('POST', '/api/internal/bi/apply-patch', {
    title: built.title || title,
    mode: 'replace',
    patch: built.patch,
    preview: false,
  }, undefined, 60_000)
  return {
    ok: true,
    phase: 'generate',
    ms: Date.now() - t0,
    source: planned.source,
    note: planned.note,
    model: planned.model,
    dashboardId: applied?.dashboardId,
    chartCount: applied?.chartCount ?? planned.charts?.length,
    chartTitles: (planned.charts || []).map((c) => c.title || c.question).filter(Boolean),
    goals: (planned.goals || []).map(slimGoal),
    charts: (planned.charts || []).map(slimGoal),
    capabilityJunk: planned.capabilityCard?.junk?.slice?.(0, 10),
    additive: slimCardFields(planned.capabilityCard?.additive),
    ratios: slimCardFields(planned.capabilityCard?.ratio),
  }
}

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|')
}

function toMarkdown(r) {
  const lines = []
  lines.push('# P012 商户订单表 · 问数 & 出板实测报告')
  lines.push('')
  lines.push(`- **时间**：${r.meta.at}`)
  lines.push(`- **BI**：\`${r.meta.biBase}\``)
  lines.push(`- **数据集**：\`${r.meta.datasetId}\`（商户订单表 / \`t_pay_order\`）`)
  lines.push(`- **身份**：\`${r.meta.userId}\` @ \`${r.meta.workspaceId}\``)
  lines.push(`- **结果**：${r.cases.filter((c) => c.ok).length}/${r.cases.length} pass`)
  lines.push('')
  lines.push('> 路径：Java internal BI（schema / knowledge / profile / query/chart / apply-patch）+ harness `planBoardAnalysis` / `layoutBoardPatch` / `coerceEncodeAgg` / `enrichAskResult`。等价于 dsh `od_*` 工具链，不经对话 LLM 选工具。')
  lines.push('')

  for (const c of r.cases) {
    lines.push(`## ${c.ok ? '✅' : '❌'} ${c.name}`)
    lines.push('')
    if (c.ms != null) lines.push(`- 耗时：${c.ms} ms`)
    if (c.error) lines.push(`- 错误：\`${mdEscape(c.error)}\``)
    if (c.summary) lines.push(`- ${c.summary}`)
    if (c.encode) {
      lines.push(`- encode：\`${JSON.stringify(c.encode)}\`${c.coerced ? `（强制 ${mdEscape(c.coerceReason)}）` : ''}`)
    }
    if (c.rowCount != null) lines.push(`- 行数：${c.rowCount}${c.empty ? '（空结果）' : ''}`)
    if (c.insight) lines.push(`- insight：${mdEscape(c.insight)}`)
    if (c.sample?.length) {
      lines.push('- sample：')
      lines.push('```json')
      lines.push(JSON.stringify(c.sample.slice(0, 5), null, 2))
      lines.push('```')
    }
    if (c.dashboardId) lines.push(`- draft：\`${c.dashboardId}\` · ${c.chartCount} 图`)
    if (c.chartTitles?.length) {
      lines.push('- 图标题：')
      c.chartTitles.forEach((t, i) => lines.push(`  ${i + 1}. ${mdEscape(t)}`))
    }
    const goalRows = c.charts?.length ? c.charts : c.goals
    if (goalRows?.length) {
      lines.push('- 落盘图表 / goals：')
      lines.push('| intent | dim | measure | agg | type | title |')
      lines.push('|--------|-----|---------|-----|------|-------|')
      for (const g of goalRows) {
        lines.push(`| ${g.intent || ''} | ${g.dim || ''} | ${g.measure || ''} | ${g.agg || ''} | ${g.chartType || ''} | ${mdEscape(g.title)} |`)
      }
    }
    if (c.source) lines.push(`- plan source：\`${c.source}\`${c.note ? ` · ${mdEscape(c.note)}` : ''}`)
    if (c.clarifyQuestion) lines.push(`- 澄清：${mdEscape(c.clarifyQuestion)}`)
    if (c.capabilityJunk) lines.push(`- junk：\`${c.capabilityJunk.join(', ')}\``)
    if (c.additive) lines.push(`- additive：\`${(c.additive || []).join(', ')}\``)
    if (c.ratios) lines.push(`- ratio：\`${(c.ratios || []).join(', ')}\``)
    if (c.fieldCount != null) lines.push(`- 字段数：${c.fieldCount} · sample 行：${c.sampleRows ?? 0}`)
    if (c.knowledgeMetrics != null) lines.push(`- knowledge metrics：${c.knowledgeMetrics} · terms：${c.knowledgeTerms}`)
    lines.push('')
  }

  lines.push('## 结论')
  lines.push('')
  const failed = r.cases.filter((c) => !c.ok)
  if (!failed.length) {
    lines.push('商户订单表问数与出板主链路可用：schema/knowledge 合并、费率 AVG 闸、状态入账查询、空结果 insight、plan→generate 写 draft 均通过。')
  } else {
    lines.push(`失败 ${failed.length} 项：${failed.map((f) => f.name).join('、')}。`)
  }
  lines.push('')
  return lines.join('\n')
}

async function main() {
  // 0 health
  try {
    const h = await biFetch('GET', '/api/internal/bi/health')
    pass('BI health', { summary: JSON.stringify(h), ms: 0 })
  } catch (e) {
    fail('BI health', { error: String(e.message || e) })
    throw e
  }

  // 1 schema + knowledge
  try {
    const loaded = await loadSchemaKnowledge()
    const metrics = Array.isArray(loaded.knowledge?.metrics) ? loaded.knowledge.metrics.length
      : Array.isArray(loaded.knowledge?.indicators) ? loaded.knowledge.indicators.length : 0
    const terms = Array.isArray(loaded.knowledge?.terms) ? loaded.knowledge.terms.length : 0
    const ratioFields = loaded.fields.filter((f) => String(f.measureKind || '').toLowerCase() === 'ratio').map((f) => f.name)
    const withValueMap = loaded.fields.filter((f) => f.valueMap && Object.keys(f.valueMap).length).map((f) => f.name)
    pass('schema + knowledge + profile', {
      ms: loaded.ms,
      fieldCount: loaded.fields.length,
      sampleRows: (loaded.schema?.sample || []).length,
      knowledgeMetrics: metrics,
      knowledgeTerms: terms,
      summary: `表 ${loaded.schema?.tableName}；ratio 字段 ${ratioFields.join(',') || '无'}；含 valueMap：${withValueMap.join(',') || '无'}`,
      ratios: ratioFields,
      valueMapFields: withValueMap,
    })
  } catch (e) {
    fail('schema + knowledge + profile', { error: String(e.message || e) })
  }

  // 2 ask: Status × Amount SUM
  {
    const r = await runAsk('按支付状态汇总金额', {
      category: 'Status',
      value: 'Amount',
      agg: 'SUM',
    }, 'bar')
    if (r.ok && !r.empty && r.rowCount > 0) {
      pass('ask · Status×Amount SUM', r)
    } else if (r.ok && r.empty) {
      fail('ask · Status×Amount SUM', { ...r, error: 'unexpected empty' })
    } else {
      fail('ask · Status×Amount SUM', r)
    }
  }

  // 3 ask: Status × MchIncome
  {
    const r = await runAsk('按支付状态看商户入账', {
      category: 'Status',
      value: 'MchIncome',
      agg: 'SUM',
    }, 'bar')
    if (r.ok) pass('ask · Status×MchIncome SUM', r)
    else fail('ask · Status×MchIncome SUM', r)
  }

  // 4 ask: ratio coerce MchRate SUM→AVG
  {
    const r = await runAsk('按商户类型看费率（故意 SUM）', {
      category: 'MchType',
      value: 'MchRate',
      agg: 'SUM',
    }, 'bar')
    if (r.ok && r.coerced && r.encode?.agg === 'AVG') {
      pass('ask · MchRate SUM→AVG 闸', r)
    } else if (r.ok && !r.coerced) {
      // field may not be tagged ratio without knowledge — still record
      fail('ask · MchRate SUM→AVG 闸', {
        ...r,
        error: '未触发 coerce（字段可能未标 measureKind=ratio）',
      })
    } else {
      fail('ask · MchRate SUM→AVG 闸', r)
    }
  }

  // 5 ask: forced empty via SQL WHERE 1=0 (insight path)
  {
    const t0 = Date.now()
    try {
      const table = 't_pay_order'
      const executed = await biFetch('POST', '/api/internal/bi/query/sql', {
        datasetId: DS,
        sql: `SELECT Status, SUM(Amount) AS Amount FROM ${table} WHERE 1=0 GROUP BY Status`,
      }, undefined, 60_000)
      const data = executed?.data || executed?.rows || []
      const rows = Array.isArray(data) ? data : []
      const enriched = enrichAskResult({
        ok: true,
        title: '空结果探测 WHERE 1=0',
        chartType: 'table',
        datasetId: DS,
        encode: { category: 'Status', value: 'Amount', agg: 'SUM' },
        fields: executed?.fields || [],
        rows,
        sample: [],
        rowCount: rows.length,
        source: 'java',
      }, { autoChart: true, requestedChartType: 'table' })
      const r = {
        ms: Date.now() - t0,
        rowCount: enriched.rowCount,
        empty: enriched.empty,
        insight: enriched.insight,
        sample: enriched.sample,
      }
      if (enriched.empty && enriched.insight) {
        pass('ask · 空结果 insight（SQL WHERE 1=0）', r)
      } else {
        fail('ask · 空结果 insight（SQL WHERE 1=0）', {
          ...r,
          error: enriched.empty ? 'empty but no insight' : `expected empty, got ${enriched.rowCount}`,
        })
      }
    } catch (e) {
      fail('ask · 空结果 insight（SQL WHERE 1=0）', { error: String(e.message || e), ms: Date.now() - t0 })
    }
  }

  // 6 ask: ChannelType compose COUNT
  {
    const r = await runAsk('渠道类型订单构成', {
      category: 'ChannelType',
      value: 'PayOrderId',
      agg: 'COUNT',
    }, 'pie')
    if (r.ok) pass('ask · ChannelType COUNT', r)
    else fail('ask · ChannelType COUNT', r)
  }

  // 7 board: 按支付状态看入账
  {
    const r = await runBoard('按支付状态看商户订单入账', '商户订单·支付状态入账')
    if (r.ok && r.phase === 'generate' && r.dashboardId && r.chartCount > 0) {
      pass('board · 按支付状态看入账', r)
    } else if (r.ok && r.phase === 'clarify') {
      pass('board · 按支付状态看入账（澄清）', r)
    } else {
      fail('board · 按支付状态看入账', r)
    }
  }

  // 8 board: 费率主题（应避免 SUM ratio）
  {
    const r = await runBoard('看商户费率和渠道费率分布', '商户订单·费率看板')
    const bad = (r.charts || r.goals || []).filter((g) =>
      /rate/i.test(String(g.measure || '')) && String(g.agg || '').toLowerCase() === 'sum')
    if (r.ok && !bad.length) {
      pass('board · 费率主题不 SUM ratio', {
        ...r,
        summary: '无 SUM(rate) 落盘图',
      })
    } else if (r.ok && bad.length) {
      fail('board · 费率主题不 SUM ratio', { ...r, error: `落盘含 SUM rate: ${JSON.stringify(bad)}` })
    } else {
      fail('board · 费率主题不 SUM ratio', r)
    }
  }

  // write outputs
  mkdirSync(OUT_DIR, { recursive: true })
  const jsonPath = join(OUT_DIR, `test-report-merchant-${TS}.json`)
  const mdPath = join(OUT_DIR, `test-report-merchant-${TS}.md`)
  const latestMd = join(OUT_DIR, 'test-report-merchant-latest.md')
  const latestJson = join(OUT_DIR, 'test-report-merchant-latest.json')
  const md = toMarkdown(report)
  writeFileSync(jsonPath, JSON.stringify(toLosslessJson(report), null, 2))
  writeFileSync(mdPath, md)
  writeFileSync(latestMd, md)
  writeFileSync(latestJson, JSON.stringify(toLosslessJson(report), null, 2))
  console.log('\nWrote', mdPath)
  console.log('Also', latestMd)
  const failed = report.cases.filter((c) => !c.ok).length
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})

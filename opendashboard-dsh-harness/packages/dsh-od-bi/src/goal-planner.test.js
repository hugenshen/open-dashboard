/**
 * P012 M1.6 Goal planner tests (fixture path — no live LLM).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeKnowledgeIntoFields } from './knowledge-merge.js'
import {
  callGoalPlanLlm,
  normalizeGoalPlan,
  parseGoalPlanJson,
  planBoardFromGoalPlan,
  llmGoalsToBindInput,
  resolvePlanApiKey,
} from './goal-planner.js'
import { MERCHANT_ORDER_FIELDS } from './quality-cases.js'

const S1_FIELDS = mergeKnowledgeIntoFields(
  [
    ...MERCHANT_ORDER_FIELDS,
    { name: 'FeeRate', label: '商户费率', role: 'measure', group: 'q' },
  ],
  {
    metrics: [
      { field: 'MchIncome', name: '商户入账', agg: 'SUM' },
      { field: 'Amount', name: '支付金额', agg: 'SUM' },
      { field: 'FeeRate', name: '商户费率', agg: 'AVG' },
    ],
    terms: [{
      field: 'Status',
      type: 'dimension',
      values: [{ value: '0', label: '订单生成' }, { value: '2', label: '支付成功' }],
    }],
  },
)

const S1_GOAL_PLAN = {
  mode: 'goals',
  clarifyQuestion: null,
  goals: [
    {
      question: '商户入账合计是多少？',
      intent: 'kpi_sum',
      measure: 'MchIncome',
      agg: 'sum',
      chartType: 'kpi',
    },
    {
      question: '各支付状态下的商户入账对比',
      intent: 'compare',
      dim: 'Status',
      measure: 'MchIncome',
      agg: 'sum',
      chartType: 'bar',
    },
    {
      question: '支付状态构成占比',
      intent: 'compose',
      dim: 'Status',
      agg: 'count',
      chartType: 'pie',
    },
    {
      question: '按支付状态汇总商户入账',
      intent: 'table',
      dim: 'Status',
      measure: 'MchIncome',
      agg: 'sum',
      chartType: 'grouptable',
    },
  ],
}

describe('parseGoalPlanJson', () => {
  it('parses fenced JSON', () => {
    const r = parseGoalPlanJson('```json\n{"mode":"goals","goals":[{"intent":"kpi_sum","measure":"Amount","chartType":"kpi"}]}\n```')
    assert.equal(r.ok, true)
    assert.equal(r.mode, 'goals')
    assert.equal(r.goals.length, 1)
  })

  it('normalize clarify', () => {
    const r = normalizeGoalPlan({ mode: 'clarify', clarifyQuestion: '用入账还是金额？', goals: [] })
    assert.equal(r.mode, 'clarify')
    assert.match(r.clarifyQuestion, /入账/)
  })
})

describe('PR-QG-12 fixture Goal path', () => {
  it('S1 goals bind without FeeRate SUM compare', () => {
    const planned = planBoardFromGoalPlan({
      datasetId: 'ds_orders',
      fields: S1_FIELDS,
      message: '按支付状态看入账',
      goalPlan: S1_GOAL_PLAN,
    })
    assert.equal(planned.needClarify, false)
    assert.equal(planned.source, 'fixture')
    assert.ok(planned.charts.length >= 3)
    assert.equal(
      planned.charts.some((c) => c.type === 'bar' && c.encode?.value === 'FeeRate'),
      false,
    )
    const bar = planned.charts.find((c) => c.type === 'bar')
    assert.equal(bar?.encode?.category, 'Status')
    assert.equal(bar?.encode?.value, 'MchIncome')
    assert.ok(planned.charts.some((c) => c.question?.includes('入账')))
  })

  it('clarify mode returns no charts', () => {
    const planned = planBoardFromGoalPlan({
      datasetId: 'ds_orders',
      fields: S1_FIELDS,
      message: '按支付状态看',
      goalPlan: {
        mode: 'clarify',
        clarifyQuestion: '按支付状态拆解时，指标用「商户入账」还是「支付金额」？',
        goals: [],
      },
    })
    assert.equal(planned.needClarify, true)
    assert.equal(planned.charts.length, 0)
    assert.match(planned.clarifyQuestion, /入账|金额/)
  })

  it('ratio compare degrades or drops (no SUM bar)', () => {
    const planned = planBoardFromGoalPlan({
      datasetId: 'ds',
      fields: S1_FIELDS,
      message: '看费率',
      goalPlan: {
        mode: 'goals',
        goals: [{
          question: '各状态下费率',
          intent: 'compare',
          dim: 'Status',
          measure: 'FeeRate',
          agg: 'sum',
          chartType: 'bar',
        }],
      },
    })
    assert.equal(
      planned.charts.some((c) => c.type === 'bar' && c.encode?.value === 'FeeRate'),
      false,
    )
    // either kpi_ratio or rules-fallback charts without FeeRate bar
    if (planned.source === 'fixture') {
      assert.ok(planned.charts.some((c) => c.type === 'kpi' && c.encode?.value === 'FeeRate' && c.encode?.agg === 'avg'))
    }
  })

  it('llmGoalsToBindInput maps dim/measure', () => {
    const rows = llmGoalsToBindInput([{ intent: 'compare', dim: 'Status', measure: 'Amount', chartType: 'bar' }])
    assert.equal(rows[0].encode.category, 'Status')
    assert.equal(rows[0].encode.value, 'Amount')
  })

  it('explicit goals[] all rejected → ok:false goals-rejected (no rules silent fill)', () => {
    const planned = planBoardFromGoalPlan({
      datasetId: 'ds_orders',
      fields: S1_FIELDS,
      message: '不要饼图，按渠道类型',
      goals: [{
        question: '用不存在的维',
        intent: 'compose',
        dim: 'TotallyFakeDim',
        chartType: 'pie',
      }],
    })
    assert.equal(planned.ok, false)
    assert.equal(planned.source, 'goals-rejected')
    assert.equal(planned.charts.length, 0)
    assert.match(String(planned.note || planned.error), /未回退|rejected/i)
  })

  it('ChannelType label binds without falling back to MchType', () => {
    const planned = planBoardFromGoalPlan({
      datasetId: 'ds_orders',
      fields: MERCHANT_ORDER_FIELDS,
      message: '按渠道类型看金额，不要饼',
      goals: [{
        question: '各渠道类型支付金额对比',
        intent: 'compare',
        dim: '渠道类型',
        measure: 'Amount',
        agg: 'sum',
        chartType: 'bar',
      }],
    })
    assert.equal(planned.ok !== false, true)
    assert.equal(planned.source, 'provided')
    const bar = planned.charts.find((c) => c.type === 'bar')
    assert.equal(bar?.encode?.category, 'ChannelType')
    assert.equal(bar?.encode?.value, 'Amount')
  })
})

describe('resolvePlanApiKey / callGoalPlanLlm harness credentials', () => {
  it('reads DEEPSEEK_API_KEY from dsh credentials.resolve', async () => {
    const key = await resolvePlanApiKey({
      credentials: {
        resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-from-dsh', source: 'file' } : undefined),
      },
    })
    assert.equal(key, 'sk-from-dsh')
  })

  it('sends the credentials key on the planning request', async () => {
    let auth = ''
    const r = await callGoalPlanLlm('按支付状态看出账', { additive: [] }, {
      credentials: {
        resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-from-dsh' } : undefined),
      },
      fetch: async (_url, init) => {
        auth = init.headers.authorization
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"mode":"goals","goals":[]}' } }],
          }),
        }
      },
    })
    assert.equal(auth, 'Bearer sk-from-dsh')
    assert.equal(r.ok, true)
  })
})

/**
 * P012 P0/P1 knowledge-merge unit tests.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  coerceEncodeAgg,
  kindFromAgg,
  mergeKnowledgeIntoFields,
  valuesToMap,
} from './knowledge-merge.js'
import { buildCapabilityCard, bindGoals, measureKind, planChartsFromFields } from './gen-board.js'
import { MERCHANT_ORDER_FIELDS } from './quality-cases.js'

describe('knowledge-merge P0', () => {
  it('maps AVG indicator to ratio measureKind', () => {
    assert.equal(kindFromAgg('AVG'), 'ratio')
    assert.equal(kindFromAgg('SUM'), 'additive')
  })

  it('merges confirmed metrics onto fields', () => {
    const fields = mergeKnowledgeIntoFields(
      [
        { name: 'FeeRate', label: 'FeeRate', role: 'measure' },
        { name: 'MchIncome', label: 'MchIncome', role: 'measure' },
      ],
      {
        metrics: [
          { field: 'FeeRate', name: '商户费率', agg: 'AVG', unit: '%' },
          { field: 'MchIncome', name: '商户入账', agg: 'SUM', unit: '分' },
        ],
      },
    )
    assert.equal(fields[0].measureKind, 'ratio')
    assert.equal(fields[0].aggDefault, 'avg')
    assert.equal(fields[0].label, '商户费率')
    assert.equal(fields[1].measureKind, 'additive')
    assert.equal(measureKind(fields[0]), 'ratio')
  })

  it('merges dimension values into valueMap (P1)', () => {
    const fields = mergeKnowledgeIntoFields(
      [{ name: 'Status', label: '支付状态', role: 'dim' }],
      {
        terms: [{
          field: 'Status',
          type: 'dimension',
          term: '支付状态',
          values: [{ value: 0, label: '订单生成' }, { value: 2, label: '支付成功' }],
        }],
      },
    )
    assert.deepEqual(fields[0].valueMap, { 0: '订单生成', 2: '支付成功' })
    assert.ok(valuesToMap([{ code: 'a', name: 'A' }]).a === 'A')
  })

  it('coerces SUM→AVG for ratio on ask encode', () => {
    const fields = [{ name: 'FeeRate', measureKind: 'ratio', aggDefault: 'avg' }]
    const { encode, coerced } = coerceEncodeAgg(
      { datasetId: 'ds', category: 'Status', value: 'FeeRate', agg: 'SUM' },
      fields,
    )
    assert.equal(coerced, true)
    assert.equal(encode.agg, 'AVG')
  })
})

describe('capability + bind (M1.6 prep)', () => {
  it('buildCapabilityCard splits additive/ratio/junk', () => {
    const base = [
      ...MERCHANT_ORDER_FIELDS,
      { name: 'FeeRate', label: 'x', role: 'measure', group: 'q' },
    ]
    const fields = mergeKnowledgeIntoFields(base, {
      metrics: [
        { field: 'FeeRate', name: '商户费率', agg: 'AVG' },
        { field: 'MchIncome', name: '商户入账', agg: 'SUM' },
      ],
    })
    const card = buildCapabilityCard('ds', fields, { message: '' })
    assert.ok(card.additive.some((x) => x.field === 'MchIncome'), JSON.stringify(card.additive))
    assert.ok(card.ratio.some((x) => x.field === 'FeeRate'), JSON.stringify(card.ratio))
    assert.ok(card.junk.includes('PayOrderId'))
  })

  it('bindGoals drops ratio SUM compare', () => {
    const base = [
      ...MERCHANT_ORDER_FIELDS,
      { name: 'FeeRate', label: '商户费率', role: 'measure', group: 'q' },
    ]
    const fields = mergeKnowledgeIntoFields(base, {
      metrics: [
        { field: 'FeeRate', agg: 'AVG' },
        { field: 'Amount', agg: 'SUM' },
      ],
    })
    const card = buildCapabilityCard('ds', fields, {})
    const bound = bindGoals('ds', [
      { intent: 'compare', type: 'bar', question: 'bad', encode: { value: 'FeeRate', category: 'Status', agg: 'sum' } },
      { intent: 'compare', type: 'bar', question: 'ok', encode: { value: 'Amount', category: 'Status', agg: 'sum' } },
    ], fields, { capabilityCard: card })
    assert.equal(bound.length, 2)
    assert.ok(bound.some((g) => g.intent === 'kpi_ratio' && g.encode?.value === 'FeeRate'))
    assert.ok(bound.some((g) => g.encode?.value === 'Amount' && g.type === 'bar'))
    assert.equal(bound.some((g) => g.type === 'bar' && g.encode?.value === 'FeeRate'), false)
  })

  it('plan with confirmed FeeRate AVG never SUM bar', () => {
    const fields = mergeKnowledgeIntoFields(
      [
        { name: 'Status', label: '支付状态', role: 'dim', group: 'd', distinctCount: 4 },
        { name: 'FeeRate', label: 'x', role: 'measure', group: 'q' },
        { name: 'Amount', label: '支付金额,单位分', role: 'measure', group: 'q' },
      ],
      { metrics: [{ field: 'FeeRate', name: '商户费率', agg: 'AVG' }] },
    )
    const { charts } = planChartsFromFields('ds', fields, { message: '按支付状态看费率' })
    assert.equal(
      charts.some((c) => c.type === 'bar' && c.encode?.value === 'FeeRate'),
      false,
    )
  })

  it('attaches valueMap onto encode.fieldCfg', () => {
    const fields = mergeKnowledgeIntoFields(MERCHANT_ORDER_FIELDS, {
      terms: [{
        field: 'Status',
        type: 'dimension',
        values: [{ value: '0', label: '订单生成' }],
      }],
      metrics: [{ field: 'Amount', agg: 'SUM' }],
    })
    const { charts } = planChartsFromFields('ds', fields, { message: '按支付状态看' })
    const bar = charts.find((c) => c.type === 'bar')
    assert.ok(bar?.encode?.fieldCfg?.Status?.valueMap?.['0'] === '订单生成')
  })
})

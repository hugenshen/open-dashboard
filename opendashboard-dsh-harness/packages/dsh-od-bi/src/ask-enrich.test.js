/**
 * P012 M2 ask-enrich unit tests.
 * Run: node --test packages/dsh-od-bi/src/ask-enrich.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  clipSample,
  emptyRowInsight,
  enrichAskResult,
  projectSemantic,
  slimQuestions,
  slimTerms,
  suggestChartType,
} from './ask-enrich.js'

describe('clipSample', () => {
  it('keeps at most 3 rows', () => {
    assert.deepEqual(clipSample([[1], [2], [3], [4]]), [[1], [2], [3]])
    assert.deepEqual(clipSample(null), [])
  })
})

describe('slimTerms / slimQuestions', () => {
  it('maps knowledge terms', () => {
    const terms = slimTerms({
      terms: [
        { term: '支付金额', canonicalField: 'Amount', type: 'metric', aliases: ['金额'] },
        { term: '状态', canonicalField: 'Status', type: 'dimension', values: [0, 1, 2] },
      ],
    })
    assert.equal(terms.length, 2)
    assert.equal(terms[0].field, 'Amount')
    assert.deepEqual(terms[1].values, [0, 1, 2])
  })
  it('maps few-shot questions', () => {
    const qs = slimQuestions([
      { question: '近一周支付金额', sql: 'SELECT 1', chartType: 'line' },
      { question: '按状态', sql: 'SELECT 2' },
      { question: '多余', sql: 'SELECT 3' },
      { question: '不该出现', sql: 'SELECT 4' },
    ], 3)
    assert.equal(qs.length, 3)
    assert.equal(qs[0].question, '近一周支付金额')
  })
})

describe('projectSemantic', () => {
  it('builds executable metric expressions and dimension literals', () => {
    const semantic = projectSemantic({
      knowledge: {
        metrics: [
          { name: 'GMV', field: 'pay_amount', agg: 'SUM', unit: '元', formula: '不含退款（说明）' },
        ],
        terms: [
          { term: '成交额', canonicalField: 'pay_amount', type: 'metric', aliases: ['GMV'] },
          { term: '区域', field: 'region', type: 'dimension', values: ['华东', '华南'] },
        ],
      },
      questions: [{ question: '上周华东 GMV', sql: 'SELECT SUM(pay_amount) FROM t WHERE region = \'华东\'' }],
    })
    assert.equal(semantic.metrics[0].expression, 'SUM(pay_amount)')
    assert.equal(semantic.metrics[0].definition, '不含退款（说明）')
    assert.ok(semantic.metrics[0].synonyms.includes('成交额'))
    assert.deepEqual(semantic.dimensions[0].values, ['华东', '华南'])
    assert.equal(semantic.examples[0].question, '上周华东 GMV')
  })
  it('does not treat human formula as SQL', () => {
    const semantic = projectSemantic({
      knowledge: { metrics: [{ name: '净支付', field: 'amt', agg: 'SUM', formula: '支付-退款' }] },
    })
    assert.equal(semantic.metrics[0].expression, 'SUM(amt)')
    assert.equal(semantic.metrics[0].definition, '支付-退款')
  })
})

describe('empty insight + enrichAskResult', () => {
  it('adds insight on 0 rows', () => {
    const r = enrichAskResult({
      ok: true,
      title: '按状态',
      datasetId: 'ds1',
      chartType: 'bar',
      rowCount: 0,
      rows: [],
    })
    assert.equal(r.empty, true)
    assert.match(r.insight, /0 行/)
    assert.match(r.insight, /按状态/)
  })
  it('suggests bar for clean 2-col compare but keeps chartType=table', () => {
    const r = enrichAskResult({
      ok: true,
      chartType: 'table',
      rowCount: 4,
      fields: [{ name: 'Status' }, { name: 'Amount', label: '支付金额,单位分' }],
      rows: [[1, 2], [3, 4], [5, 6], [7, 8]],
    }, { autoChart: true, requestedChartType: 'table' })
    assert.equal(r.chartType, 'table')
    assert.equal(r.chartTypeSuggested, 'bar')
    assert.equal(r.style?.formatter?.unit, 0.01)
  })
  it('keeps sample peeks as table', () => {
    const r = enrichAskResult({
      ok: true,
      title: '商户订单表样例',
      chartType: 'table',
      rowCount: 3,
      fields: [{ name: 'PayOrderId' }, { name: 'Amount' }, { name: 'Status' }, { name: 'MchId' }],
      rows: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],
    }, { autoChart: true, requestedChartType: 'table' })
    assert.equal(r.chartType, 'table')
  })
  it('suggests kpi for scalar but does not auto-flip chartType', () => {
    const r = enrichAskResult({
      ok: true,
      title: '2026年有交易数据的商户数',
      chartType: 'table',
      rowCount: 1,
      fields: [{ name: 'merchant_count' }],
      rows: [[2]],
    }, { autoChart: true, requestedChartType: 'table' })
    assert.equal(r.chartType, 'table')
    assert.equal(r.chartTypeSuggested, 'kpi')
  })
})

describe('suggestChartType', () => {
  it('respects explicit request', () => {
    assert.equal(suggestChartType({ requested: 'line', rows: [[1]] }), 'line')
  })
  it('bar for small 2-col cardinality (not pie)', () => {
    assert.equal(suggestChartType({
      fields: [{ name: 'd' }, { name: 'm' }],
      rows: [[1, 1], [2, 2], [3, 3]],
    }), 'bar')
  })
  it('sample title forces table', () => {
    assert.equal(suggestChartType({
      title: '商户订单表样例',
      fields: [{ name: 'a' }, { name: 'b' }],
      rows: [[1, 2], [3, 4], [5, 6]],
    }), 'table')
  })
})

describe('PR-QG-M2 no stub rows contract', () => {
  it('emptyRowInsight never invents 华东/华北', () => {
    const s = emptyRowInsight({ title: 'x', datasetId: 'ds_orders' })
    assert.equal(s.includes('华东'), false)
    assert.equal(s.includes('华北'), false)
  })
})

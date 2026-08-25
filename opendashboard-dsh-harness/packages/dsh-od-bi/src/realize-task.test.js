/**
 * P015 realize-task: sampled ask-query then pick chart + display format.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDisplayFromData,
  realizeBoundCharts,
  suggestChartFromResult,
} from './realize-task.js'

describe('suggestChartFromResult', () => {
  it('keeps kpi / table / rank regardless of row count', () => {
    assert.equal(suggestChartFromResult({ intent: 'kpi_sum', rowCount: 9 }), 'kpi')
    assert.equal(suggestChartFromResult({ intent: 'table', rowCount: 9 }), 'grouptable')
    assert.equal(suggestChartFromResult({ intent: 'rank', rowCount: 9 }), 'hbar')
  })

  it('picks pie only for compose with 2–5 rows; compare SUM stays bar', () => {
    assert.equal(suggestChartFromResult({ intent: 'compose', agg: 'count', rowCount: 3 }), 'pie')
    assert.equal(suggestChartFromResult({ intent: 'compose', agg: 'count', rowCount: 8 }), 'bar')
    assert.equal(suggestChartFromResult({ intent: 'compare', agg: 'sum', rowCount: 3 }), 'bar')
    assert.equal(suggestChartFromResult({ intent: 'compare', agg: 'sum', rowCount: 12 }), 'bar')
  })

  it('uses line for time / trend; drops empty', () => {
    assert.equal(suggestChartFromResult({ intent: 'trend', rowCount: 12, categoryIsTime: true }), 'line')
    assert.equal(suggestChartFromResult({ intent: 'compare', rowCount: 0 }), null)
  })
})

describe('applyDisplayFromData', () => {
  const fenField = { name: 'MchIncome', label: '商户入账,单位分' }

  it('converts 分 using sample magnitude', () => {
    const chart = applyDisplayFromData(
      { type: 'bar', encode: { value: 'MchIncome' }, style: {} },
      { fields: [fenField], message: '', rows: [['成功', 8_500_000]] },
    )
    assert.equal(chart.style.formatter.unit, 0.01)
    assert.equal(chart.style.axisUnit, 'wan')
  })

  it('sets decimal places from float samples', () => {
    const chart = applyDisplayFromData(
      { type: 'bar', encode: { value: 'Rate' }, style: {} },
      { fields: [{ name: 'Rate', label: '费率' }], rows: [['A', 0.12], ['B', 0.085]] },
    )
    assert.equal(chart.style.formatter.decimal, 2)
  })
})

describe('realizeBoundCharts', () => {
  const fields = [
    { name: 'Status', label: '支付状态', role: 'dim' },
    { name: 'MchIncome', label: '商户入账,单位分', role: 'measure' },
  ]

  it('skips query for kpi and drops empty compare tasks', async () => {
    const r = await realizeBoundCharts([
      {
        type: 'kpi',
        intent: 'kpi_sum',
        title: '入账',
        datasetId: 'ds1',
        encode: { value: 'MchIncome', agg: 'sum' },
      },
      {
        type: 'bar',
        intent: 'compare',
        title: '状态入账',
        datasetId: 'ds1',
        encode: { category: 'Status', value: 'MchIncome', agg: 'sum' },
      },
    ], {
      fields,
      queryFn: async (chart) => {
        if (chart.intent === 'compare') return { ok: true, rows: [], rowCount: 0 }
        return { ok: true, rows: [[1]], rowCount: 1 }
      },
    })
    assert.equal(r.ok, true)
    assert.equal(r.charts.length, 1)
    assert.equal(r.charts[0].type, 'kpi')
    assert.equal(r.dropped.length, 1)
    assert.match(r.dropped[0].error, /empty/)
  })

  it('turns 3-row compose into pie and 8-row compose into bar', async () => {
    const tasks = [
      {
        type: 'pie',
        intent: 'compose',
        title: '状态构成',
        datasetId: 'ds1',
        encode: { category: 'Status', value: 'Status', agg: 'count' },
      },
      {
        type: 'pie',
        intent: 'compose',
        title: '渠道构成',
        datasetId: 'ds1',
        encode: { category: 'Status', value: 'Status', agg: 'count' },
      },
    ]
    let n = 0
    const r = await realizeBoundCharts(tasks, {
      fields,
      queryFn: async () => {
        n += 1
        if (n === 1) {
          return { ok: true, rowCount: 3, rows: [['a', 1], ['b', 2], ['c', 3]] }
        }
        return {
          ok: true,
          rowCount: 8,
          rows: Array.from({ length: 8 }, (_, i) => [`d${i}`, i + 1]),
        }
      },
    })
    assert.equal(r.charts[0].type, 'pie')
    assert.equal(r.charts[1].type, 'bar')
  })
})

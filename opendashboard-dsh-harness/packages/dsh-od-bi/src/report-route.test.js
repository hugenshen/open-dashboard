import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setBridge } from '@opendashboard/dsh-od-auth/bridge-state'
import { isAnalysisReportToolRequest, rankDatasetsForPrompt } from './index.js'

describe('analysis report routing guard', () => {
  it('detects report intent from tool args before dashboard semantic readiness gates', () => {
    setBridge({ prompt: '' })
    assert.equal(isAnalysisReportToolRequest({ message: '使用订单表生成报告' }), true)
    assert.equal(isAnalysisReportToolRequest({ title: '订单经营分析报告' }), true)
  })

  it('detects report intent from the synced bridge prompt', () => {
    setBridge({ prompt: '写一份分析报告：使用订单表生成报告' })
    assert.equal(isAnalysisReportToolRequest({ message: '订单表' }), true)
  })

  it('does not treat a dashboard request as a report', () => {
    setBridge({ prompt: '生成仪表盘：订单经营驾驶舱' })
    assert.equal(isAnalysisReportToolRequest({ message: '订单经营驾驶舱' }), false)
  })

  it('ranks the real payment order dataset before datasource inventory and demo sales for order reports', () => {
    const ranked = rankDatasetsForPrompt([
      { id: 'ds_48a4ff9e', name: '数据源清单', tableName: 'de_datasource' },
      { id: 'ds_sales', name: '销售演示数据', tableName: 'fact_sales' },
      { id: 'ds_012eb19e', name: '支付订单表', tableName: 't_pay_order' },
    ], '写一份分析报告：使用订单表生成报告')

    assert.equal(ranked[0].id, 'ds_012eb19e')
    assert.equal(ranked.at(-1).tableName, 'de_datasource')
  })
})

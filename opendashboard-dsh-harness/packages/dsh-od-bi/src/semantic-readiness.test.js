import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assessSemanticReadiness, semanticNotReadyMessage } from './semantic-readiness.js'

const rawPayOrder = [
  { name: 'PayOrderId', label: '支付订单号', group: 'quota', dataType: 'VARCHAR' },
  { name: 'MchId', label: '商户ID', group: 'quota', dataType: 'DECIMAL' },
  { name: 'Status', label: '支付状态,0-生成,2-成功', group: 'quota', dataType: 'DECIMAL' },
  { name: 'MchIncome', label: '商户入账,单位分', group: 'quota', dataType: 'DECIMAL' },
]

describe('assessSemanticReadiness', () => {
  it('blocks a raw wide-table schema when stored profile and confirmed metrics are absent', () => {
    const result = assessSemanticReadiness({
      fields: rawPayOrder,
      profile: { fields: rawPayOrder.map((f) => ({ ...f, roleSource: 'schema' })), profileFieldCount: 0 },
      knowledge: { metrics: [] },
    })
    assert.equal(result.ready, false)
    assert.ok(result.reasons.includes('PROFILE_OR_CONFIRMED_METRIC_MISSING'))
    assert.match(semanticNotReadyMessage(result), /字段语义尚未准备好/)
  })

  it('allows a sufficiently profiled dataset with a safe metric and dimension', () => {
    const result = assessSemanticReadiness({
      fields: rawPayOrder,
      profile: { profileFieldCount: 4, profileCoverage: 1, profileReady: true },
      knowledge: { metrics: [] },
    })
    assert.equal(result.ready, true)
  })

  it('accepts confirmed metric evidence even before profile coverage is complete', () => {
    const result = assessSemanticReadiness({
      fields: rawPayOrder,
      profile: { profileFieldCount: 0, profileCoverage: 0, profileReady: false },
      knowledge: { metrics: [{ field: 'MchIncome', name: '商户入账', agg: 'SUM' }] },
    })
    assert.equal(result.ready, true)
    assert.equal(result.evidence.confirmedMetricCount, 1)
  })
})

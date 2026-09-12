import test from 'node:test'
import assert from 'node:assert/strict'
import { quantitativeClaims, reportBrief } from './report-run-client.js'

test('report brief exposes ambiguity instead of silently confirming defaults', () => {
  const brief = reportBrief({ reportTitle: '经营分析' })
  assert.equal(brief.confirmed, false)
  assert.deepEqual(brief.ambiguities, ['audience', 'timeRange', 'metrics', 'comparison'])
  const confirmed = reportBrief({ reportTitle: '经营分析', audience: '经营负责人',
    timeRange: { from: '2026-01-01', to: '2026-01-31' },
    metrics: [{ field: 'sales', agg: 'sum', unit: '元' }], comparison: { type: 'previous_period' } })
  assert.equal(confirmed.confirmed, true)
  assert.deepEqual(confirmed.ambiguities, [])
})

test('quantitative claims bind matching evidence and leave unmatched values visible', () => {
  const rows = [{ block: { rows: [{ sales: 100, rate: 0.25 }] }, evidence: { id: 'ev-1' } }]
  const claims = quantitativeClaims('## 摘要\n销售额为 100 元。转化率为 25%。未知值为 999 元。', rows, 3)
  assert.equal(claims.length, 3)
  assert.deepEqual(claims[0].evidenceRefs, ['ev-1'])
  assert.deepEqual(claims[1].evidenceRefs, ['ev-1'])
  assert.deepEqual(claims[2].evidenceRefs, [])
  assert.equal(claims[2].confidence, 'low')
})

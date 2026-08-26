/**
 * Slash follow-ups are human-readable (protocol lives on tools / persona).
 * Run: node --test packages/dsh-od-bi/src/commands.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAskFollowup,
  buildBoardFollowup,
  buildDatasetsFollowup,
  buildReportFollowup,
} from './commands.js'

function assertNoProtocol(text) {
  assert.doesNotMatch(text, /ANALYSIS_REPORT=1/)
  assert.doesNotMatch(text, /od_board_worker/)
  assert.doesNotMatch(text, /od_plan_charts/)
  assert.doesNotMatch(text, /od_run_query/)
  assert.doesNotMatch(text, /od_get_data/)
  assert.doesNotMatch(text, /run_in_background/)
  assert.doesNotMatch(text, /delegationDepth/)
}

describe('slash follow-up copy', () => {
  it('/report keeps the user question and drops tool protocol', () => {
    const text = buildReportFollowup('订单表生成报告')
    assert.equal(text, '写一份分析报告：订单表生成报告')
    assertNoProtocol(text)
  })

  it('/board keeps the theme and drops HITL protocol', () => {
    const text = buildBoardFollowup('用订单数据做专业经营仪表盘')
    assert.equal(text, '生成仪表盘：用订单数据做专业经营仪表盘')
    assertNoProtocol(text)
  })

  it('/ask uses the question as-is', () => {
    const text = buildAskFollowup('上个月 GMV 是多少')
    assert.equal(text, '上个月 GMV 是多少')
    assertNoProtocol(text)
  })

  it('/datasets is a short list request', () => {
    const text = buildDatasetsFollowup()
    assert.equal(text, '列出我当前可以问的数据集。')
    assertNoProtocol(text)
  })
})

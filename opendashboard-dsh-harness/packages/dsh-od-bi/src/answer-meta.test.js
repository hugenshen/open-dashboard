/**
 * answer-meta presentation gate tests.
 * Run: node --test packages/dsh-od-bi/src/answer-meta.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import { answerPresentationMeta } from './answer-meta.js'

function assertLossless(value) {
  assert.notEqual(snapshotJsonValue(value), undefined, 'dsh lossless JSON snapshot')
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
}

describe('answerPresentationMeta presentAnswer gate', () => {
  it('defaults to ask_probe (no chart card)', () => {
    const m = answerPresentationMeta({
      ok: true,
      title: '各商户收入',
      chartType: 'bar',
      rowCount: 17,
      fields: [{ name: 'MchId' }, { name: 'MchIncome' }],
      rows: [[1, 2]],
      sqlHint: 'SELECT 1',
    })
    assert.equal(m.odKind, 'ask_probe')
    assert.equal(m.chartType, 'table')
    assert.equal(m.sqlHint, undefined)
    assert.equal(Object.hasOwn(m, 'insight'), false)
    assertLossless(m)
  })
  it('empty probe keeps insight string and stays lossless', () => {
    const m = answerPresentationMeta({
      ok: true,
      title: '无匹配',
      chartType: 'table',
      rowCount: 0,
      empty: true,
      insight: '本题查询成功但 0 行。',
      fields: [{ name: 'MchId' }],
      rows: [],
    })
    assert.equal(m.odKind, 'ask_probe')
    assert.equal(m.empty, true)
    assert.equal(typeof m.insight, 'string')
    assertLossless(m)
  })
  it('presentAnswer=true emits answer_chart with sql', () => {
    const m = answerPresentationMeta({
      ok: true,
      title: '各商户收入',
      chartType: 'bar',
      rowCount: 17,
      fields: [{ name: 'MchId' }],
      rows: [[1]],
      sqlHint: 'SELECT MchId',
      presentAnswer: true,
    })
    assert.equal(m.odKind, 'answer_chart')
    assert.equal(m.sqlHint, 'SELECT MchId')
    assertLossless(m)
  })
  it('opts.presentAnswer wins', () => {
    const m = answerPresentationMeta({
      ok: true,
      chartType: 'kpi',
      rowCount: 1,
      fields: [{ name: 'n' }],
      rows: [[2]],
    }, { presentAnswer: true })
    assert.equal(m.odKind, 'answer_chart')
    assertLossless(m)
  })
  it('marks sampled from sqlHint', () => {
    const m = answerPresentationMeta({
      ok: true,
      chartType: 'table',
      rowCount: 2,
      fields: [{ name: 'a' }],
      rows: [[1]],
      presentAnswer: true,
      sqlHint: '/* od_sample est=1000000 n=50000 */ SELECT 1 /* scaled x20.000 */',
    })
    assert.equal(m.sampled, true)
    assert.equal(m.sampleN, 50000)
    assert.equal(m.estRows, 1000000)
    assert.equal(m.scaleFactor, 20)
    assertLossless(m)
  })
})

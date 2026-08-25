/**
 * answer-meta presentation gate tests.
 * Run: node --test packages/dsh-od-bi/src/answer-meta.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import {
  answerPresentationMeta,
  isAnalysisReportSpawn,
  parseReportReadyFromText,
  spawnArgsText,
  spawnWorkerPresentationMeta,
} from './answer-meta.js'
import { consumePresentation, rememberPresentation, resetPresentation } from './board-store.js'

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

describe('spawnWorkerPresentationMeta', () => {
  it('lifts stored board_ready from child commit', () => {
    resetPresentation('lift-board')
    rememberPresentation({
      odKind: 'board_ready',
      dashboardId: '13',
      title: '销售分析看板',
      chartCount: 9,
      mode: 'replace',
      editPath: '/dashboards/13/edit',
      source: 'board-worker',
    }, 'lift-board')
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [{ type: 'text', text: 'done' }],
    }, { consume: () => consumePresentation('lift-board') })
    assert.equal(meta.odKind, 'board_ready')
    assert.equal(meta.dashboardId, '13')
    assert.equal(meta.editPath, '/dashboards/13/edit')
    assert.equal(consumePresentation('lift-board'), null)
    assertLossless(meta)
  })

  it('lifts stored report_ready', () => {
    resetPresentation('lift-report')
    rememberPresentation({
      odKind: 'report_ready',
      title: '归因报告',
      html: '<p>ok</p>',
      markdown: 'ok',
      dashboardId: null,
      source: 'analysis-worker',
    }, 'lift-report')
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [],
    }, { consume: () => consumePresentation('lift-report') })
    assert.equal(meta.odKind, 'report_ready')
    assert.equal(meta.html, '<p>ok</p>')
    assertLossless(meta)
  })

  it('parses board ready text when store is empty', () => {
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [{ type: 'text', text: 'board ready: 13 (9 charts)\n1. 总支付金额' }],
    }, { consume: () => null })
    assert.equal(meta.odKind, 'board_ready')
    assert.equal(meta.dashboardId, '13')
    assert.equal(meta.chartCount, 9)
    assert.equal(meta.editPath, '/dashboards/13/edit')
    assertLossless(meta)
  })

  it('parses worker summary text that is not board ready:', () => {
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [{
        type: 'text',
        text: '看板已提交完成 ✅ 订单经营仪表盘（board 12 · 8 charts · ds_012eb19e）',
      }],
    }, { consume: () => null })
    assert.equal(meta.odKind, 'board_ready')
    assert.equal(meta.dashboardId, '12')
    assert.equal(meta.chartCount, 8)
    assert.equal(meta.title, '订单经营仪表盘')
    assert.equal(meta.editPath, '/dashboards/12/edit')
    assertLossless(meta)
  })

  it('parses Chinese worker board ready: id，含 N 个图表', () => {
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [{
        type: 'text',
        text: '订单经营仪表盘已生成完成（board ready: 11，含 9 个图表）。',
      }],
    }, { consume: () => null })
    assert.equal(meta.odKind, 'board_ready')
    assert.equal(meta.dashboardId, '11')
    assert.equal(meta.chartCount, 9)
    assert.equal(meta.title, '订单经营仪表盘')
    assert.equal(meta.editPath, '/dashboards/11/edit')
    assertLossless(meta)
  })

  it('ignores prompt text that is not a board id', () => {
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [{
        type: 'text',
        text: 'od_rechart_chart（同一 dashboardId，merge，禁止另开草稿） board ready: 11，含 board 11，含 · 8 charts',
      }],
    }, { consume: () => null })
    assert.deepEqual(meta, {})
  })

  it('returns empty object when worker produced nothing', () => {
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [{ type: 'text', text: 'skipped' }],
    }, { consume: () => null })
    assert.deepEqual(meta, {})
    assertLossless(meta)
  })

  it('does not lift stale board meta into an analysis-report spawn', () => {
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r-report',
      output: [{ type: 'text', text: 'done' }],
    }, {
      expectedKind: 'report_ready',
      consume: () => ({ odKind: 'board_ready', dashboardId: 'old-board' }),
    })
    assert.deepEqual(meta, {})
    assertLossless(meta)
  })

  it('still lifts report_ready when expectedKind defaults to board_ready', () => {
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r-report',
      output: [{ type: 'text', text: '分析报告已完成' }],
    }, {
      expectedKind: 'board_ready',
      consume: () => ({
        odKind: 'report_ready',
        title: '支付状态与金额结构分析报告',
        filename: 'payment-status-amount-structure-report.html',
        html: '<h1>支付状态与金额结构分析报告</h1>',
        markdown: '# 支付状态与金额结构分析报告',
        dashboardId: null,
        source: 'analysis-worker',
      }),
    })
    assert.equal(meta.odKind, 'report_ready')
    assert.match(String(meta.html), /支付状态与金额结构分析报告/)
    assert.equal(meta.filename, 'payment-status-amount-structure-report.html')
    assertLossless(meta)
  })

  it('reads ANALYSIS_REPORT=1 from ContentBlock[] prompt', () => {
    assert.equal(
      isAnalysisReportSpawn({
        description: '写分析报告',
        prompt: [{ type: 'text', text: 'ANALYSIS_REPORT=1\ndatasetId=ds_1' }],
      }, { output: [] }),
      true,
    )
    assert.equal(spawnArgsText({ prompt: [{ type: 'text', text: 'ANALYSIS_REPORT=1' }] }).includes('ANALYSIS_REPORT=1'), true)
    assert.equal(isAnalysisReportSpawn({ prompt: '生成看板' }, { output: [] }), false)
  })

  it('parses report ready text when store is empty', () => {
    const parsed = parseReportReadyFromText('report ready: payment-status-amount-structure-report.html (4 insights)')
    assert.equal(parsed.filename, 'payment-status-amount-structure-report.html')
    assert.equal(parsed.insightCount, 4)
    const meta = spawnWorkerPresentationMeta({
      kind: 'foreground',
      runId: 'r1',
      output: [{ type: 'text', text: 'report ready: payment-status-amount-structure-report.html (4 insights)' }],
    }, { consume: () => null })
    assert.equal(meta.odKind, 'report_ready')
    assert.equal(meta.filename, 'payment-status-amount-structure-report.html')
    assert.equal(meta.insightCount, 4)
    assertLossless(meta)
  })
})

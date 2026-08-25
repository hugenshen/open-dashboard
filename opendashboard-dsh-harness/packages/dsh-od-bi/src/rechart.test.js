/**
 * In-place rechart (P004): merge patch, same chartId, no extra drafts.
 * Run: node --test packages/dsh-od-bi/src/rechart.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boardPresentationMeta } from './answer-meta.js'
import {
  applyChangeToChart,
  buildMergeChartPatch,
  inferTargetType,
  matchChartsByHint,
  parseRechartJson,
  planRechart,
} from './rechart.js'

const FIELDS = [
  { name: 'type', label: '类型', role: 'dim', group: 'd', distinctCount: 3 },
  { name: 'status', label: '状态', role: 'dim', group: 'd', distinctCount: 4 },
]

const BOARD = [
  {
    chartId: '101',
    title: '类型分布',
    chartType: 'pie',
    datasetId: 'ds1',
    encode: { category: 'type', value: 'type', agg: 'COUNT' },
  },
  {
    chartId: '102',
    title: '状态分布',
    chartType: 'pie',
    datasetId: 'ds1',
    encode: { category: 'status', value: 'status', agg: 'COUNT' },
  },
]

describe('matchChartsByHint', () => {
  it('matches by title substring', () => {
    const hit = matchChartsByHint(BOARD, { message: '把类型分布改成柱图' })
    assert.deepEqual(hit.map((c) => c.chartId), ['101'])
  })

  it('matches explicit chartIds', () => {
    const hit = matchChartsByHint(BOARD, { chartIds: ['102'] })
    assert.deepEqual(hit.map((c) => c.chartId), ['102'])
  })

  it('matches both pies when user says 饼图', () => {
    const hit = matchChartsByHint(BOARD, { message: '把两张饼图都改成柱图' })
    assert.deepEqual(hit.map((c) => c.chartId), ['101', '102'])
  })
})

describe('inferTargetType', () => {
  it('reads 改成柱图', () => {
    assert.equal(inferTargetType('把类型分布改成柱图'), 'bar')
    assert.equal(inferTargetType('换成折线图'), 'line')
  })
})

describe('parseRechartJson', () => {
  it('parses rechart changes and chinese types', () => {
    const parsed = parseRechartJson(JSON.stringify({
      mode: 'rechart',
      changes: [{ chartId: '101', chartType: '柱图', title: '类型对比' }],
    }))
    assert.equal(parsed.ok, true)
    assert.equal(parsed.mode, 'rechart')
    assert.equal(parsed.changes[0].chartType, 'bar')
  })

  it('empty changes become clarify', () => {
    const parsed = parseRechartJson('{"mode":"rechart","changes":[]}')
    assert.equal(parsed.mode, 'clarify')
  })

  it('regenerate has no changes', () => {
    const parsed = parseRechartJson('{"mode":"regenerate"}')
    assert.equal(parsed.mode, 'regenerate')
    assert.equal(parsed.changes.length, 0)
  })
})

describe('buildMergeChartPatch', () => {
  it('only upserts named charts — no set_layout / new ids', () => {
    const updated = applyChangeToChart(BOARD[0], { chartType: 'bar' }, FIELDS, { message: '改成柱图' })
    assert.equal(updated.chartId, '101')
    assert.equal(updated.type, 'bar')
    const patch = buildMergeChartPatch([updated])
    assert.ok(patch.ops.every((op) => op.op === 'upsert_chart'))
    assert.deepEqual(patch.ops.map((op) => op.chartId), ['101'])
    assert.equal(patch.ops.some((op) => op.op === 'set_layout' || op.op === 'upsert_component'), false)
  })
})

describe('planRechart', () => {
  it('updates one chart in place and leaves the other out of the patch', async () => {
    const planned = await planRechart({
      charts: BOARD,
      message: '把类型分布改成柱图',
      fieldsByDataset: { ds1: FIELDS },
      opts: { fields: FIELDS, skipLlm: true },
    })
    assert.equal(planned.ok, true)
    assert.equal(planned.charts.length, 1)
    assert.equal(planned.charts[0].chartId, '101')
    assert.equal(planned.charts[0].type, 'bar')
    assert.deepEqual(planned.patch.ops.map((op) => op.chartId), ['101'])
    assert.ok(planned.patch.ops.every((op) => op.op === 'upsert_chart'))
  })

  it('updates multiple charts in one merge patch', async () => {
    const planned = await planRechart({
      charts: BOARD,
      message: '把类型分布和状态分布都改成柱图',
      fieldsByDataset: { ds1: FIELDS },
      opts: { fields: FIELDS, skipLlm: true },
    })
    assert.equal(planned.ok, true)
    assert.deepEqual(planned.charts.map((c) => c.chartId).sort(), ['101', '102'])
    assert.ok(planned.charts.every((c) => c.type === 'bar'))
  })

  it('fails on unknown chartId and does not invent a patch', async () => {
    const planned = await planRechart({
      charts: BOARD,
      message: '改图',
      fieldsByDataset: { ds1: FIELDS },
      opts: {
        fields: FIELDS,
        changes: [{ chartId: '999', chartType: 'bar' }],
      },
    })
    assert.equal(planned.ok, false)
    assert.match(String(planned.error), /unknown chartId/)
    assert.equal(planned.patch, undefined)
  })

  it('resolves LLM chartId that is actually the title', async () => {
    const planned = await planRechart({
      charts: BOARD,
      message: '改类型分布',
      fieldsByDataset: { ds1: FIELDS },
      opts: {
        fields: FIELDS,
        changes: [{ chartId: '类型分布', chartType: 'bar' }],
      },
    })
    assert.equal(planned.ok, true)
    assert.equal(planned.charts[0].chartId, '101')
  })
})

describe('boardPresentationMeta rechart holds', () => {
  it('does not emit board_ready for clarify / regenerate', () => {
    assert.equal(boardPresentationMeta({ ok: true, needClarify: true, clarifyQuestion: '哪张？' }).odKind, 'board_clarify')
    assert.equal(boardPresentationMeta({ ok: true, regenerate: true }).odKind, 'board_regenerate')
  })

  it('merge success is board_ready with same dashboardId', () => {
    const meta = boardPresentationMeta({
      ok: true,
      dashboardId: '74',
      title: '数据源清单',
      chartCount: 1,
      mode: 'merge',
      source: 'java',
    })
    assert.equal(meta.odKind, 'board_ready')
    assert.equal(meta.dashboardId, '74')
    assert.equal(meta.mode, 'merge')
  })
})

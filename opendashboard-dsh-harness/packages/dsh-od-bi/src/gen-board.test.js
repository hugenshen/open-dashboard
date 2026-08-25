/**
 * P012 M1 board quality fixtures + layout regression.
 * Run: node --test packages/dsh-od-bi/src/gen-board.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bindGoals,
  buildCapabilityCard,
  buildReviewedBoard,
  looksLikeIdentifier,
  isRankDim,
  layoutBoardPatch,
  measureKind,
  parseValueMapFromLabel,
  planChartsFromFields,
  resolveFieldRef,
  reviewCharts,
  semanticRole,
} from './gen-board.js'
import { boardPresentationMeta } from './answer-meta.js'
import { MERCHANT_ORDER_FIELDS, OPS_FIELDS } from './quality-cases.js'

describe('planChartsFromFields', () => {
  it('builds kpi + bar + table from dim/measure', () => {
    const { charts, query } = planChartsFromFields('ds1', [
      { name: 'region', label: '区域', group: 'd', role: 'dim' },
      { name: 'amount', label: '金额', group: 'q', role: 'measure' },
    ])
    assert.ok(charts.length >= 2)
    assert.ok(charts.some((c) => c.type === 'kpi'))
    assert.ok(charts.some((c) => c.type === 'bar' || c.type === 'grouptable' || c.type === 'pie'))
    assert.equal(charts[0].datasetId, 'ds1')
    assert.ok(query === null || Array.isArray(query?.items))
  })

  it('prefers Amount/Status over junk PayOrderId for merchant orders', () => {
    const { charts } = planChartsFromFields('ds_orders', MERCHANT_ORDER_FIELDS)
    assert.ok(charts.length >= 3)
    const titles = charts.map((c) => c.title || c.question).join('|')
    assert.ok(!titles.includes('支付订单号'), 'must not use junk order id as axis')
    assert.ok(!charts.some((c) => String(c.encode?.value || '') === 'MchId'), 'must not sum merchant id')
    assert.ok(titles.includes('支付金额') || charts.some((c) => String(c.encode?.value || '').includes('Amount')))
    assert.ok(
      charts.some((c) => ['Status', 'MchType'].includes(String(c.encode?.category || c.encode?.x?.[0] || ''))),
      'should use a real business dim',
    )
  })

  it('does not SUM MchId even when schema marks it quota without role=id', () => {
    const untyped = MERCHANT_ORDER_FIELDS.map((f) => {
      const { role, ...rest } = f
      return rest
    })
    const { charts } = planChartsFromFields('ds_orders', untyped, { message: '专业经营仪表盘' })
    assert.equal(
      charts.some((c) => ['MchId', 'PayOrderId'].includes(String(c.encode?.value))),
      false,
    )
    assert.equal(
      charts.some((c) => String(c.encode?.category) === 'PayOrderId'),
      false,
    )
  })

  it('enumerates analysis goals before charts (question visible)', () => {
    const { charts } = planChartsFromFields('ds_orders', MERCHANT_ORDER_FIELDS, {
      message: '按支付状态看入账',
    })
    const qs = charts.map((c) => c.question || c.title).join('|')
    assert.ok(qs.includes('对比') || qs.includes('构成'), 'goals should read as analysis questions')
    const bar = charts.find((c) => c.type === 'bar')
    assert.ok(bar?.question)
    assert.match(bar.question, /支付状态/)
    assert.equal(bar.encode?.category, 'Status')
    assert.ok(['Amount', 'MchIncome'].includes(String(bar.encode?.value)))
    const pie = charts.find((c) => c.type === 'pie')
    assert.ok(pie, 'compose COUNT pie can coexist with compare SUM bar')
    assert.equal(String(pie.encode?.agg || '').toLowerCase(), 'count')
  })
})

describe('identifier + comment enum', () => {
  it('treats quota MchId / 支付订单号 as junk identifiers', () => {
    assert.equal(looksLikeIdentifier({ name: 'MchId', label: '商户ID', group: 'quota' }), true)
    assert.equal(semanticRole({ name: 'MchId', label: '商户ID', group: 'quota', dataType: 'DECIMAL' }), 'junk')
    assert.equal(looksLikeIdentifier({ name: 'PayOrderId', label: '支付订单号', group: 'dim' }), true)
    assert.equal(looksLikeIdentifier({ name: 'Amount', label: '支付金额,单位分', group: 'quota' }), false)
  })

  it('parses status comment into valueMap', () => {
    const vm = parseValueMapFromLabel('支付状态,0-订单生成,1-支付中,2-支付成功,3-业务处理完成,4-已退款')
    assert.equal(vm['0'], '订单生成')
    assert.equal(vm['2'], '支付成功')
    assert.equal(vm['4'], '已退款')
  })
})

describe('measureKind', () => {
  it('marks 费率 as ratio; 单位分 as additive', () => {
    assert.equal(measureKind({ name: 'FeeRate', label: '商户费率', role: 'measure' }), 'ratio')
    assert.equal(measureKind({ name: 'Amount', label: '支付金额,单位分', role: 'measure' }), 'additive')
  })

  it('ratio never becomes SUM bar value', () => {
    const fields = [
      { name: 'Status', label: '支付状态', role: 'dim', group: 'd', distinctCount: 4 },
      { name: 'FeeRate', label: '商户费率', role: 'measure', group: 'q' },
      { name: 'Amount', label: '支付金额,单位分', role: 'measure', group: 'q' },
    ]
    const { charts } = planChartsFromFields('ds_fee', fields, { message: '按支付状态看费率' })
    assert.equal(
      charts.some((c) => c.type === 'bar' && String(c.encode?.value) === 'FeeRate'),
      false,
    )
    assert.ok(charts.some((c) => c.type === 'kpi' && String(c.encode?.value) === 'FeeRate' && c.encode?.agg === 'avg'))
    assert.ok(charts.some((c) => c.type === 'bar' && String(c.encode?.value) === 'Amount'))
  })
})

describe('PR-QG-02 message weighting', () => {
  it('message 按支付状态看 uses Status as category; title-only does not count', () => {
    const fields = MERCHANT_ORDER_FIELDS
    const barCat = (charts) => charts.find((c) => c.type === 'bar')?.encode?.category
    const withMsg = planChartsFromFields('ds_orders', fields, { message: '按支付状态看' })
    assert.equal(barCat(withMsg.charts), 'Status')
    const noMsg = planChartsFromFields('ds_orders', fields, { message: '' })
    assert.equal(barCat(noMsg.charts), 'MchType')
  })
})

describe('PR-QG-03 review', () => {
  it('drops pie when bar shares the same category', () => {
    const charts = reviewCharts([
      { type: 'bar', title: '状态柱', encode: { category: 'Status', value: 'Amount' } },
      { type: 'pie', title: '状态饼', encode: { category: 'Status', value: 'Amount' } },
    ], { fields: MERCHANT_ORDER_FIELDS })
    const kinds = charts.filter((c) => ['bar', 'pie'].includes(c.type)).map((c) => c.type)
    assert.ok(!(kinds.includes('bar') && kinds.includes('pie')))
  })

  it('downgrades high-cardinality pie', () => {
    const fields = [
      { name: 'MchId', label: '商户ID', role: 'dim', distinctCount: 80 },
      { name: 'Amount', label: '支付金额,单位分', role: 'measure' },
    ]
    const charts = reviewCharts([
      { type: 'pie', title: '商户饼', encode: { category: 'MchId', value: 'Amount' } },
    ], { fields })
    assert.equal(charts.some((c) => c.type === 'pie'), false)
    assert.ok(charts.some((c) => c.type === 'grouptable' || c.type === 'bar'))
  })

  it('drops raw CreateTime line without a day bucket', () => {
    const { charts } = planChartsFromFields('ds_orders', MERCHANT_ORDER_FIELDS)
    assert.equal(charts.some((c) => c.type === 'line'), false)
  })
})

describe('PR-QG-04 layout and query defaults', () => {
  it('pairs compares after a full-width trend; no half-empty hole', () => {
    const r = layoutBoardPatch({
      charts: [
        { type: 'bar', title: 'a', datasetId: 'ds1', encode: { category: 'x', value: 'v' } },
        { type: 'pie', title: 'b', datasetId: 'ds1', encode: { category: 'y', value: 'v' } },
        { type: 'line', title: 'c', datasetId: 'ds1', encode: { category: 'z', value: 'v' } },
        { type: 'bar', title: 'd', datasetId: 'ds1', encode: { category: 'w', value: 'v' } },
      ],
    })
    const comps = r.patch.ops.filter((o) => o.op === 'upsert_component' && o.type === 'chart')
    assert.equal(comps.length, 4)
    assert.equal(comps[0].w, 72)
    assert.equal(comps[0].x, 0)
    assert.equal(comps[1].w, 36)
    assert.equal(comps[2].w, 36)
    assert.equal(comps[2].x, 36)
    assert.equal(comps[3].w, 72)
    const solo = layoutBoardPatch({
      charts: [{ type: 'bar', title: 'only', datasetId: 'ds1', encode: { category: 'x', value: 'v' } }],
    })
    const one = solo.patch.ops.find((o) => o.op === 'upsert_component' && o.type === 'chart')
    assert.equal(one.w, 72)
  })

  it('places two rows of half charts (up to 4)', () => {
    const r = layoutBoardPatch({
      charts: [
        { type: 'bar', title: 'a', datasetId: 'ds1', encode: { category: 'x', value: 'v' } },
        { type: 'hbar', title: 'b', datasetId: 'ds1', encode: { category: 'y', value: 'v' } },
        { type: 'pie', title: 'c', datasetId: 'ds1', encode: { category: 'z', value: 'v' } },
        { type: 'bar', title: 'd', datasetId: 'ds1', encode: { category: 'w', value: 'v' } },
      ],
    })
    const comps = r.patch.ops.filter((o) => o.op === 'upsert_component' && o.type === 'chart')
    assert.equal(comps.length, 4)
    assert.equal(comps[0].w, 36)
    assert.equal(comps[1].w, 36)
    assert.equal(comps[2].w, 36)
    assert.equal(comps[3].w, 36)
    assert.equal(comps[2].y > comps[0].y, true)
  })

  it('fills date defaults from profile min/max and never invents 近30天', () => {
    const fields = [
      {
        name: 'CreateTime',
        label: '创建时间',
        role: 'time',
        group: 't',
        numericMin: Date.parse('2024-01-01T00:00:00Z'),
        numericMax: Date.parse('2024-03-31T00:00:00Z'),
      },
      { name: 'Status', label: '支付状态', role: 'dim', group: 'd', distinctCount: 5 },
      { name: 'Amount', label: '金额', role: 'measure', group: 'q' },
    ]
    const { query } = planChartsFromFields('ds1', fields)
    const date = query?.items?.find((i) => i.type === 'date-range')
    assert.ok(date)
    assert.equal(date.fromDefault, '2024-01-01')
    assert.equal(date.toDefault, '2024-03-31')
    const blob = JSON.stringify(query)
    assert.equal(blob.includes('近 30'), false)
    assert.equal(blob.includes('近30'), false)

    const bare = planChartsFromFields('ds2', [
      { name: 'CreateTime', label: '创建时间', role: 'time', group: 't' },
      { name: 'Amount', label: '金额', role: 'measure', group: 'q' },
    ])
    const bareDate = bare.query?.items?.find((i) => i.type === 'date-range')
    assert.ok(bareDate)
    assert.equal(bareDate.fromDefault, undefined)
    assert.equal(bareDate.toDefault, undefined)
  })
})

describe('PR-QG-05 KPI title and fen formatter', () => {
  it('ops dataset has 记录数 not 订单数', () => {
    const { charts } = planChartsFromFields('ds_ops', OPS_FIELDS, { datasetName: '运营流量' })
    const titles = charts.map((c) => c.title)
    assert.equal(titles.includes('订单数'), false)
    assert.ok(titles.includes('记录数'))
  })

  it('单位分 measure gets formatter and patch has no data rows', () => {
    const built = buildReviewedBoard({
      datasetId: 'ds_orders',
      fields: MERCHANT_ORDER_FIELDS,
      title: '商户',
      datasetName: '商户订单',
      message: '渠道与商户收入分析',
    })
    assert.equal(built.ok, true)
    const amount = built.patch.ops.find((o) => o.op === 'upsert_chart' && String(o.encode?.value || '').includes('Amount'))
    assert.ok(amount)
    assert.equal(amount.style?.formatter?.unit, 0.01)
    assert.equal(amount.style?.formatter?.suffix, '元')
    assert.ok(amount.encode?.fieldCfg?.Amount?.alias === '支付金额' || amount.encode?.fieldCfg?.Amount?.alias?.includes('支付'))
    const blob = JSON.stringify(built.patch)
    assert.equal(/"data"\s*:\s*\[\[/.test(blob), false)
  })

  it('dedupes identical type+encode charts', () => {
    const dup = {
      type: 'bar',
      title: '重复',
      encode: { category: 'Status', value: 'Amount', agg: 'sum' },
    }
    const out = reviewCharts([dup, { ...dup, title: '另一标题' }], {
      fields: MERCHANT_ORDER_FIELDS,
    })
    assert.equal(out.filter((c) => c.type === 'bar' && c.encode?.category === 'Status').length, 1)
  })
})

describe('layoutBoardPatch', () => {
  it('requires charts', () => {
    const r = layoutBoardPatch({ charts: [] })
    assert.equal(r.ok, false)
  })
  it('emits set_layout + upsert_chart ops with numeric component ids', () => {
    const r = layoutBoardPatch({
      title: '测试看板',
      charts: [
        { type: 'kpi', title: '金额', datasetId: 'ds1', encode: { y: ['amount'] } },
        { type: 'bar', title: '按区', datasetId: 'ds1', encode: { x: ['region'], y: ['amount'] } },
        { type: 'grouptable', title: '表', datasetId: 'ds1', encode: { x: ['region'], y: ['amount'] } },
      ],
      query: { items: [{ type: 'select', field: 'region', label: '区域' }] },
    })
    assert.equal(r.ok, true)
    assert.equal(r.mode, 'replace')
    assert.ok(r.patch.ops.some((o) => o.op === 'set_layout'))
    assert.ok(r.patch.ops.some((o) => o.op === 'upsert_component' && o.type === 'query'))
    const charts = r.patch.ops.filter((o) => o.op === 'upsert_chart')
    assert.equal(charts.length, 3)
    assert.equal(r.chartCount, 3)
    const comps = r.patch.ops.filter((o) => o.op === 'upsert_component')
    for (const c of comps) {
      assert.ok(/^\d+$/.test(String(c.id)), `component id must be digits, got ${c.id}`)
    }
    assert.ok(!comps.some((c) => String(c.id).startsWith('c_')))
  })

  it('omits undefined so dsh lossless JSON snapshot succeeds', () => {
    const r = layoutBoardPatch({
      title: '商户订单',
      charts: [{
        type: 'bar',
        title: '商户类型订单量',
        encode: { category: 'MchType', value: 'PayOrderId', agg: 'COUNT', datasetId: 'ds_31e4ffe9' },
      }],
    })
    assert.equal(r.ok, true)
    const chart = r.patch.ops.find((o) => o.op === 'upsert_chart')
    assert.equal(chart.datasetId, 'ds_31e4ffe9')
    assert.equal(Object.hasOwn(chart, 'style'), false)
    assert.equal(Object.hasOwn(r, 'query'), false)
    const walk = (v, path) => {
      assert.notEqual(v, undefined, `undefined at ${path}`)
      if (typeof v === 'number') {
        assert.ok(Number.isFinite(v) && !Object.is(v, -0), `bad number at ${path}`)
      }
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`)
      }
    }
    walk(r, 'layout')
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r)
  })
})

describe('resolveFieldRef / ChannelType', () => {
  it('resolves ChannelType by name and 渠道类型 label', () => {
    assert.equal(resolveFieldRef('ChannelType', MERCHANT_ORDER_FIELDS), 'ChannelType')
    assert.equal(resolveFieldRef('渠道类型', MERCHANT_ORDER_FIELDS), 'ChannelType')
  })

  it('bindGoals keeps ChannelType dim with distinctCount=1', () => {
    const bound = bindGoals('ds_orders', [{
      intent: 'compose',
      question: '渠道类型构成',
      dim: 'ChannelType',
      chartType: 'pie',
    }], MERCHANT_ORDER_FIELDS)
    assert.equal(bound.length, 1)
    assert.equal(bound[0].encode?.category, 'ChannelType')
  })

  it('message 去掉饼图 + 渠道 drops pie and adds ChannelType bar', () => {
    const { charts } = planChartsFromFields('ds_orders', MERCHANT_ORDER_FIELDS, {
      message: '去掉饼图；支付状态入账对比 + 渠道类型（ChannelType）入账对比',
    })
    assert.equal(charts.some((c) => c.type === 'pie'), false)
    assert.ok(charts.some((c) => c.type === 'bar' && c.encode?.category === 'Status'))
    assert.ok(charts.some((c) => c.type === 'bar' && c.encode?.category === 'ChannelType'))
  })
})

describe('boardPresentationMeta', () => {
  it('exposes editPath without patch ops', () => {
    const meta = boardPresentationMeta({
      ok: true,
      dashboardId: 'd1',
      title: '看板',
      chartCount: 2,
      mode: 'replace',
      source: 'java',
    })
    assert.equal(meta.odKind, 'board_ready')
    assert.equal(meta.editPath, '/dashboards/d1/edit')
    assert.equal(meta.patch, undefined)
  })
})

describe('cockpit IA', () => {
  it('capability card exposes compose/rank slots and cockpit rules', () => {
    const fields = [
      ...MERCHANT_ORDER_FIELDS,
      { name: 'StoreName', label: '门店', group: 'd', role: 'dim', distinctCount: 48 },
    ]
    const card = buildCapabilityCard('ds_orders', fields, { datasetName: '订单表' })
    assert.ok(card.rules.some((r) => /Cockpit|Never two pies/.test(r)))
    assert.ok(card.composeDims.some((d) => d.field === 'Status' || d.field === 'MchType'))
    assert.ok(isRankDim(fields.find((f) => f.name === 'StoreName')))
    assert.ok(card.rankDims.some((d) => d.field === 'StoreName'))
    assert.equal(card.rankDims.some((d) => d.field === 'MchId'), false)
    assert.ok(card.entityDims.some((d) => d.field === 'MchId'))
  })

  it('review keeps one pie and turns the second into a bar', () => {
    const out = reviewCharts([
      {
        type: 'pie',
        title: '状态占比',
        encode: { category: 'Status', value: 'Status', agg: 'count' },
      },
      {
        type: 'pie',
        title: '渠道占比',
        encode: { category: 'ChannelType', value: 'ChannelType', agg: 'count' },
      },
    ], { fields: MERCHANT_ORDER_FIELDS })
    assert.equal(out.filter((c) => c.type === 'pie').length, 1)
    assert.equal(out.filter((c) => c.type === 'bar').length, 1)
  })

  it('binds rank as hbar with resultLimit 10', () => {
    const fields = [
      ...MERCHANT_ORDER_FIELDS,
      { name: 'StoreName', label: '门店', group: 'd', role: 'dim', distinctCount: 48 },
    ]
    const bound = bindGoals('ds_orders', [{
      intent: 'rank',
      chartType: 'hbar',
      question: '门店入账 TOP10',
      dim: 'StoreName',
      measure: 'MchIncome',
      agg: 'sum',
    }], fields)
    assert.equal(bound.length, 1)
    assert.equal(bound[0].type, 'hbar')
    assert.equal(bound[0].encode?.category, 'StoreName')
    assert.equal(bound[0].encode?.resultLimit, 10)
  })

  it('infers chart type from intent when chartType omitted', () => {
    const bound = bindGoals('ds_orders', [
      { intent: 'kpi_sum', question: '入账合计', measure: 'MchIncome', agg: 'sum' },
      { intent: 'compare', question: '状态入账', dim: 'Status', measure: 'MchIncome', agg: 'sum' },
      { intent: 'compose', question: '状态构成', dim: 'Status' },
    ], MERCHANT_ORDER_FIELDS)
    assert.equal(bound.find((c) => c.intent === 'kpi_sum')?.type, 'kpi')
    assert.equal(bound.find((c) => c.intent === 'compare')?.type, 'bar')
    assert.equal(bound.find((c) => c.intent === 'compose')?.type, 'pie')
  })
})

describe('detail table requires an entity subject', () => {
  it('rewrites Status×MchIncome grouptable to MchId when a compare bar already uses Status', () => {
    const out = reviewCharts([
      {
        type: 'bar',
        title: '各支付状态商户入账金额对比',
        encode: { category: 'Status', value: 'MchIncome', agg: 'sum' },
      },
      {
        type: 'grouptable',
        title: '按支付状态汇总订单明细',
        encode: { category: 'Status', value: 'MchIncome', agg: 'sum' },
      },
    ], { fields: MERCHANT_ORDER_FIELDS })
    const table = out.find((c) => c.type === 'grouptable')
    assert.ok(table)
    assert.equal(table.encode?.category, 'MchId')
    assert.equal(table.encode?.value, 'MchIncome')
    assert.equal(out.some((c) => c.type === 'grouptable' && c.encode?.category === 'Status'), false)
  })

  it('prefers unused merchant over app already used by rank', () => {
    const fields = [
      ...MERCHANT_ORDER_FIELDS,
      { name: 'AppId', label: '应用ID', role: 'id', group: 'dim', dataType: 'STRING' },
    ]
    const out = reviewCharts([
      {
        type: 'hbar',
        title: '应用 Top10',
        encode: { category: 'AppId', value: 'MchIncome', agg: 'sum', resultLimit: 10 },
      },
      {
        type: 'grouptable',
        title: '按应用汇总',
        encode: { category: 'AppId', value: 'MchIncome', agg: 'sum' },
      },
    ], { fields })
    const table = out.find((c) => c.type === 'grouptable')
    assert.equal(table?.encode?.category, 'MchId')
  })

  it('drops enum-only table when there is no entity subject', () => {
    const out = reviewCharts([
      {
        type: 'bar',
        title: '状态对比',
        encode: { category: 'Status', value: 'Amount', agg: 'sum' },
      },
      {
        type: 'grouptable',
        title: '按状态汇总',
        encode: { category: 'Status', value: 'Amount', agg: 'sum' },
      },
    ], { fields: [
      { name: 'Status', label: '支付状态', role: 'dim', group: 'd', distinctCount: 3 },
      { name: 'Amount', label: '金额', role: 'measure', group: 'q' },
    ] })
    assert.equal(out.some((c) => c.type === 'grouptable'), false)
  })

  it('binds MchId as table category even though it is junk as a measure', () => {
    const bound = bindGoals('ds_orders', [{
      intent: 'table',
      question: '按商户汇总入账',
      dim: 'MchId',
      measure: 'MchIncome',
      agg: 'sum',
    }], MERCHANT_ORDER_FIELDS)
    assert.equal(bound.length, 1)
    assert.equal(bound[0].type, 'grouptable')
    assert.equal(bound[0].encode?.category, 'MchId')
    assert.equal(bound[0].encode?.value, 'MchIncome')
  })

  it('enumerates merchant-order table on MchId not Status', () => {
    const { charts } = planChartsFromFields('ds_orders', MERCHANT_ORDER_FIELDS, {
      message: '专业经营仪表盘',
    })
    const table = charts.find((c) => c.type === 'grouptable')
    assert.ok(table)
    assert.equal(table.encode?.category, 'MchId')
    assert.equal(['Amount', 'MchIncome'].includes(String(table.encode?.value)), true)
  })
})

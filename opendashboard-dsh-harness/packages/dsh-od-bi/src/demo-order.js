/**
 * Local demo payment-order dataset for P016 commercial E2E.
 *
 * This is not a production fallback. It only keeps the local/LAN demo harness
 * from drifting to ds_sales when the Java dataset catalog has not been migrated
 * yet. Results are clearly marked as demo-fallback.
 * @module @opendashboard/dsh-od-bi/demo-order
 */

export const DEMO_ORDER_DATASET_ID = 'ds_012eb19e'

export const DEMO_ORDER_DATASET = Object.freeze({
  id: DEMO_ORDER_DATASET_ID,
  name: '支付订单表',
  folder: '订单经营',
  tableName: 't_pay_order',
  datasourceId: 'src_demo',
  status: 'ready',
  source: 'demo-fallback',
})

export const DEMO_ORDER_FIELDS = Object.freeze([
  { name: 'PayOrderId', label: '支付订单ID', group: 'dim', role: 'id', dataType: 'STRING' },
  { name: 'CreatedDate', label: '下单日期', group: 'dim', role: 'time', dataType: 'DATE' },
  { name: 'Status', label: '支付状态（-1=未知/缺失；2=支付成功；3=业务处理完成）', group: 'dim', role: 'dim', dataType: 'STRING', valueMap: { '-1': '未知/缺失', '2': '支付成功', '3': '业务处理完成' } },
  { name: 'ChannelId', label: '渠道ID', group: 'dim', role: 'dim', dataType: 'STRING' },
  { name: 'ProductId', label: '产品ID', group: 'dim', role: 'dim', dataType: 'STRING' },
  { name: 'MchId', label: '商户ID', group: 'dim', role: 'dim', dataType: 'STRING' },
  { name: 'Amount', label: '订单金额（单位分）', group: 'quota', role: 'measure', dataType: 'DECIMAL' },
  { name: 'MchIncome', label: '商户入账金额（单位分）', group: 'quota', role: 'measure', dataType: 'DECIMAL' },
  { name: 'AgentProfit', label: '平台代理利润（单位分）', group: 'quota', role: 'measure', dataType: 'DECIMAL' },
  { name: 'MchRate', label: '商户费率', group: 'quota', role: 'measure', dataType: 'DECIMAL' },
])

export const DEMO_ORDER_ROWS = Object.freeze([
  { PayOrderId: 'P202609010001', CreatedDate: '2026-09-01', Status: '3', ChannelId: 'wx_app', ProductId: 'loan_a', MchId: 'M10001', Amount: 186_000, MchIncome: 181_350, AgentProfit: 4_650, MchRate: 0.025 },
  { PayOrderId: 'P202609010002', CreatedDate: '2026-09-01', Status: '3', ChannelId: 'wx_app', ProductId: 'loan_a', MchId: 'M10001', Amount: 92_000, MchIncome: 89_700, AgentProfit: 2_300, MchRate: 0.025 },
  { PayOrderId: 'P202609010003', CreatedDate: '2026-09-01', Status: '2', ChannelId: 'alipay', ProductId: 'loan_b', MchId: 'M10002', Amount: 31_500, MchIncome: 30_870, AgentProfit: 630, MchRate: 0.020 },
  { PayOrderId: 'P202609010004', CreatedDate: '2026-09-01', Status: '-1', ChannelId: 'bank', ProductId: 'loan_c', MchId: 'M10003', Amount: 128_000, MchIncome: 124_160, AgentProfit: 3_840, MchRate: 0.030 },
  { PayOrderId: 'P202609020001', CreatedDate: '2026-09-02', Status: '3', ChannelId: 'wx_app', ProductId: 'loan_a', MchId: 'M10001', Amount: 216_000, MchIncome: 210_600, AgentProfit: 5_400, MchRate: 0.025 },
  { PayOrderId: 'P202609020002', CreatedDate: '2026-09-02', Status: '3', ChannelId: 'alipay', ProductId: 'loan_b', MchId: 'M10002', Amount: 143_000, MchIncome: 140_140, AgentProfit: 2_860, MchRate: 0.020 },
  { PayOrderId: 'P202609020003', CreatedDate: '2026-09-02', Status: '3', ChannelId: 'bank', ProductId: 'loan_c', MchId: 'M10004', Amount: 268_000, MchIncome: 258_620, AgentProfit: 9_380, MchRate: 0.035 },
  { PayOrderId: 'P202609020004', CreatedDate: '2026-09-02', Status: '2', ChannelId: 'wx_app', ProductId: 'loan_b', MchId: 'M10005', Amount: 47_000, MchIncome: 45_825, AgentProfit: 1_175, MchRate: 0.025 },
  { PayOrderId: 'P202609030001', CreatedDate: '2026-09-03', Status: '3', ChannelId: 'bank', ProductId: 'loan_c', MchId: 'M10004', Amount: 302_000, MchIncome: 291_430, AgentProfit: 10_570, MchRate: 0.035 },
  { PayOrderId: 'P202609030002', CreatedDate: '2026-09-03', Status: '-1', ChannelId: 'alipay', ProductId: 'loan_a', MchId: 'M10006', Amount: 73_000, MchIncome: 71_175, AgentProfit: 1_825, MchRate: 0.025 },
])

export function isDemoOrderDataset(datasetId) {
  return String(datasetId || '') === DEMO_ORDER_DATASET_ID
}

export function demoOrderSchema() {
  return {
    ok: true,
    id: DEMO_ORDER_DATASET_ID,
    datasetId: DEMO_ORDER_DATASET_ID,
    name: DEMO_ORDER_DATASET.name,
    tableName: DEMO_ORDER_DATASET.tableName,
    folder: DEMO_ORDER_DATASET.folder,
    engine: 'demo-fallback',
    fields: DEMO_ORDER_FIELDS.map((field) => ({ ...field })),
    sample: DEMO_ORDER_ROWS.slice(0, 3).map((row) => DEMO_ORDER_FIELDS.map((field) => row[field.name])),
    source: 'demo-fallback',
  }
}

function aggregate(values, agg) {
  const nums = values.map(Number).filter(Number.isFinite)
  if (!nums.length) return 0
  const op = String(agg || 'SUM').toUpperCase()
  if (op === 'COUNT') return nums.length
  if (op === 'AVG' || op === 'AVERAGE') return nums.reduce((a, b) => a + b, 0) / nums.length
  if (op === 'MAX') return Math.max(...nums)
  if (op === 'MIN') return Math.min(...nums)
  return nums.reduce((a, b) => a + b, 0)
}

export function queryDemoOrder(chart = {}) {
  const encode = chart.encode || {}
  const category = String(encode.category || encode.x || '').trim()
  const value = String(encode.value || encode.y || '').trim()
  const agg = String(encode.agg || 'SUM').toUpperCase()
  const limit = Math.max(1, Math.min(Number(encode.resultLimit || chart.resultLimit || 20), 200))
  if (!value) return { ok: false, error: 'encode.value required' }
  if (!category) {
    return {
      ok: true,
      rows: [[aggregate(DEMO_ORDER_ROWS.map((row) => value === category ? 1 : row[value]), agg)]],
      rowCount: 1,
      extra: { source: 'demo-fallback', datasetId: DEMO_ORDER_DATASET_ID },
    }
  }
  const grouped = new Map()
  for (const row of DEMO_ORDER_ROWS) {
    const key = row[category] == null ? '其他' : String(row[category])
    const raw = agg === 'COUNT' || value === category ? 1 : row[value]
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(raw)
  }
  const rows = [...grouped.entries()]
    .map(([key, values]) => [key, aggregate(values, agg)])
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
  return {
    ok: true,
    rows,
    rowCount: rows.length,
    extra: { source: 'demo-fallback', datasetId: DEMO_ORDER_DATASET_ID },
  }
}

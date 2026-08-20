/** Display names for table headers / chart series: prefer 中文 label, else snake_case tokens. */

const FIELD_TOKENS: Record<string, string> = {
  order: '订单',
  cnt: '数',
  count: '数',
  num: '数',
  mch: '商户',
  merchant: '商户',
  app: '应用',
  total: '总',
  amount: '金额',
  amt: '金额',
  avg: '平均',
  average: '平均',
  success: '成功',
  succ: '成功',
  refund: '退款',
  income: '收入',
  plat: '平台',
  platform: '平台',
  profit: '利润',
  pay: '支付',
  fee: '手续费',
  qty: '数量',
  id: 'ID',
  name: '名称',
  time: '时间',
  date: '日期',
  status: '状态',
  type: '类型',
  user: '用户',
  rate: '率'
}

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

export function humanizeFieldName(name: string): string {
  const raw = String(name || '').trim()
  if (!raw || hasCjk(raw)) return raw
  const parts = raw.split(/[_\s]+/).filter(Boolean)
  if (!parts.length) return raw
  const mapped: string[] = []
  for (const part of parts) {
    const token = FIELD_TOKENS[part.toLowerCase()]
    if (!token) return raw
    mapped.push(token)
  }
  return mapped.join('') || raw
}

export function displayFieldNames(columns: string[] | undefined, labels?: string[]): string[] {
  const cols = columns || []
  if (labels && labels.length === cols.length) {
    return labels.map((lab, i) => (hasCjk(String(lab || '')) ? String(lab) : humanizeFieldName(cols[i] || lab)))
  }
  return cols.map((c) => humanizeFieldName(c))
}

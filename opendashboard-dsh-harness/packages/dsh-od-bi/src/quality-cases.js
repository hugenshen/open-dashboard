/**
 * Offline golden fixtures for ask-data gates and board planning (P012).
 * Used by gen-board.test.js / sql-guard.test.js. No network.
 */

export const MERCHANT_ORDER_FIELDS = [
  { name: 'PayOrderId', label: '支付订单号', group: 'dim', role: 'id', dataType: 'STRING' },
  { name: 'MchId', label: '商户ID', group: 'quota', role: 'id', dataType: 'DECIMAL' },
  { name: 'MchType', label: '商户类型:1-平台', group: 'quota', role: 'dim', dataType: 'DECIMAL' },
  { name: 'ChannelType', label: '渠道类型,对接支付接口类型代码', group: 'quota', role: 'dim', dataType: 'DECIMAL', distinctCount: 1 },
  { name: 'Status', label: '支付状态,0-订单生成', group: 'quota', role: 'dim', dataType: 'DECIMAL' },
  { name: 'Amount', label: '支付金额,单位分', group: 'quota', role: 'measure', dataType: 'DECIMAL' },
  { name: 'MchIncome', label: '商户入账,单位分', group: 'quota', role: 'measure', dataType: 'DECIMAL' },
  { name: 'CreateTime', label: '创建时间', group: 'dim', role: 'time', dataType: 'TIME' },
]

export const OPS_FIELDS = [
  { name: 'module', label: '模块', group: 'd', role: 'dim' },
  { name: 'uv', label: '访客数', group: 'q', role: 'measure' },
  { name: 'day', label: '日期', group: 't', role: 'time' },
]

export const ASK_SQL_CASES = [
  { id: 'ASK-SQL-01', sql: 'SELECT region, SUM(amount) FROM sales_detail GROUP BY region', table: 'sales_detail', allow: true },
  { id: 'ASK-SQL-02', sql: 'INSERT INTO sales_detail VALUES (1)', table: 'sales_detail', allow: false },
  { id: 'ASK-SQL-03', sql: 'SELECT * FROM sales_detail JOIN secret s ON 1=1', table: 'sales_detail', allow: false },
  { id: 'ASK-SQL-04', sql: 'SELECT 1; DROP TABLE t', table: 't', allow: false },
]

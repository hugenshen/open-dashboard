/**
 * Phase C: explainSql / jump / alert stubs for commercial depth.
 */

export interface ExplainSqlRequest {
  datasetId: string
  chartType: string
  encode: {
    category?: string
    value?: string
    color?: string
    agg?: string
  }
  filters?: Array<{ field: string; operator: string; value: unknown }>
}

export interface JumpConfig {
  id: string
  sourceChartId: string
  triggerField: string
  targetType: 'url' | 'dashboard'
  target: string
  paramMap?: Record<string, string>
}

export interface AlertConfig {
  id: string
  chartId: string
  metricField: string
  operator: 'gt' | 'lt' | 'gte' | 'lte'
  threshold: number
  enabled: boolean
}

export class ChartExplainManage {
  explainSql(req: ExplainSqlRequest): { sql: string; dialect: string } {
    const agg = (req.encode.agg || 'SUM').toUpperCase()
    const value = req.encode.value || 'metric'
    const category = req.encode.category
    const where = (req.filters || [])
      .map(f => `${f.field} ${f.operator === 'eq' ? '=' : f.operator} '${String(f.value)}'`)
      .join(' AND ')
    const sql = category
      ? `SELECT ${category} AS dim, ${agg}(${value}) AS measure\nFROM dataset_${req.datasetId}\n${where ? `WHERE ${where}\n` : ''}GROUP BY ${category}\nORDER BY measure DESC`
      : `SELECT ${agg}(${value}) AS measure\nFROM dataset_${req.datasetId}${where ? `\nWHERE ${where}` : ''}`
    return { sql, dialect: 'ansi' }
  }

  /** Mock YoY: current * (1 + delta). */
  applyMom(value: number, mode: 'yoy' | 'mom' | 'none'): { value: number; deltaPct: number } {
    if (mode === 'none') return { value, deltaPct: 0 }
    const deltaPct = mode === 'yoy' ? 0.126 : 0.048
    return { value: Math.round(value * (1 + deltaPct) * 100) / 100, deltaPct }
  }
}

const jumps = new Map<string, JumpConfig[]>()
const alerts = new Map<string, AlertConfig[]>()

export class DashboardJumpManage {
  list(dashboardId: string): JumpConfig[] {
    return jumps.get(dashboardId) || []
  }
  save(dashboardId: string, list: JumpConfig[]): JumpConfig[] {
    jumps.set(dashboardId, list)
    return list
  }
}

export class DashboardAlertManage {
  list(dashboardId: string): AlertConfig[] {
    return alerts.get(dashboardId) || []
  }
  save(dashboardId: string, list: AlertConfig[]): AlertConfig[] {
    alerts.set(dashboardId, list)
    return list
  }
  evaluate(value: number, alert: AlertConfig): boolean {
    if (!alert.enabled) return false
    switch (alert.operator) {
      case 'gt':
        return value > alert.threshold
      case 'gte':
        return value >= alert.threshold
      case 'lt':
        return value < alert.threshold
      case 'lte':
        return value <= alert.threshold
    }
  }
}

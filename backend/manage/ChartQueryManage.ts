import type {
  ChartQueryRequest,
  ChartQueryResult,
  ChartViewVO,
  FilterContextItem,
  LinkageContextItem
} from '../../frontend/types/dashboard'
import { globalStore, type InMemoryDashboardStore } from '../store/InMemoryDashboardStore'

/**
 * Runtime query orchestrator.
 * Production: compile filters/linkages → Dataset query API.
 * Slice demo: in-memory sample facts filtered by context.
 */
export class ChartQueryManage {
  constructor(private readonly store: InMemoryDashboardStore = globalStore) {}

  query(req: ChartQueryRequest): ChartQueryResult {
    const view = req.view || 'published'
    const chart = this.resolveChart(req, view)
    if (!chart.datasetId && !req.inline?.datasetId) {
      throw new Error('chart has no dataset binding')
    }

    const datasetId = chart.datasetId || req.inline!.datasetId
    const rows = this.sampleDataset(datasetId)
    const applicableFilters = this.filtersForChart(chart.id, req.context.filters, req.context.linkages)
    const filtered = rows.filter(row => this.matchFilters(row, applicableFilters))

    const categoryField = String((chart.encode as { category?: string }).category || 'region')
    const valueField = String((chart.encode as { value?: string }).value || 'amount')

    const aggregated = new Map<string, number>()
    for (const row of filtered) {
      const key = String(row[categoryField] ?? 'unknown')
      const val = Number(row[valueField] ?? 0)
      aggregated.set(key, (aggregated.get(key) || 0) + val)
    }

    const data = [...aggregated.entries()].map(([k, v]) => [k, v])
    return {
      fields: [
        { name: categoryField, type: 'string' },
        { name: valueField, type: 'number' }
      ],
      data,
      series: { chartType: chart.chartType },
      extra: {
        datasetId,
        filterCount: applicableFilters.length,
        rowCount: filtered.length
      }
    }
  }

  private resolveChart(req: ChartQueryRequest, view: 'draft' | 'published'): ChartViewVO {
    if (req.inline) {
      return {
        id: req.chartId || 'inline',
        dashboardId: req.dashboardId,
        datasetId: req.inline.datasetId,
        chartType: req.inline.chartType,
        encode: req.inline.encode
      }
    }
    if (!req.chartId) throw new Error('chartId or inline required')
    const d = this.store.dashboards.get(req.dashboardId)
    if (!d) throw new Error(`dashboard not found: ${req.dashboardId}`)
    if (view === 'published' && d.status === 'draft') {
      throw new Error('dashboard not published')
    }
    this.store.ensureCopyBuckets(req.dashboardId)
    const chart = this.store.charts.get(req.dashboardId)![view][req.chartId]
    if (!chart) throw new Error(`chart not found: ${req.chartId}`)
    return chart
  }

  private filtersForChart(
    chartId: string,
    filters: FilterContextItem[],
    linkages: LinkageContextItem[]
  ): Array<{ field: string; operator: string; value: unknown }> {
    const out: Array<{ field: string; operator: string; value: unknown }> = filters.map(f => ({
      field: f.field,
      operator: f.operator,
      value: f.value
    }))
    for (const l of linkages) {
      if (l.targetChartId === chartId) {
        out.push({ field: l.targetField, operator: 'eq', value: l.value })
      }
    }
    return out
  }

  private matchFilters(
    row: Record<string, unknown>,
    filters: Array<{ field: string; operator: string; value: unknown }>
  ): boolean {
    return filters.every(f => {
      const cell = row[f.field]
      switch (f.operator) {
        case 'eq':
          return String(cell) === String(f.value)
        case 'ne':
          return String(cell) !== String(f.value)
        case 'in':
          return Array.isArray(f.value) && f.value.map(String).includes(String(cell))
        default:
          return String(cell) === String(f.value)
      }
    })
  }

  /** Demo facts keyed by dataset id — replace with DatasetDataManage. */
  private sampleDataset(datasetId: string): Array<Record<string, unknown>> {
    const base = [
      { region: '华东', product: 'A', amount: 120 },
      { region: '华东', product: 'B', amount: 80 },
      { region: '华北', product: 'A', amount: 60 },
      { region: '华北', product: 'B', amount: 40 },
      { region: '华南', product: 'A', amount: 90 },
      { region: '华南', product: 'B', amount: 110 }
    ]
    // Keep datasetId visible for debugging; data shape identical for slice.
    return base.map(r => ({ ...r, _datasetId: datasetId }))
  }
}

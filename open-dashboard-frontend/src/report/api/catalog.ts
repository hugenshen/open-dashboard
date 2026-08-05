import { apiFetch } from '../../api/http'

export interface DashboardChartCatalogItem {
  id: string
  title: string
  chartType: string
  datasetId: string
}

export interface DashboardCatalogItem {
  id: string
  name: string
  charts: DashboardChartCatalogItem[]
}

export interface DatasetFieldItem {
  name: string
  label: string
  group: 'dim' | 'quota' | string
}

export interface DatasetCatalogItem {
  id: string
  name: string
  fields: DatasetFieldItem[]
}

export interface CatalogBundle {
  dashboards: DashboardCatalogItem[]
  datasets: DatasetCatalogItem[]
}

export const catalogApi = {
  get: () => apiFetch<CatalogBundle>('/catalog')
}

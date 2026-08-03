/**
 * Split Pinia stores — avoid a monolithic dvMain.
 * Target product: copy into src/store/modules/dashboard/
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  BusiNodeVO,
  ChartQueryResult,
  ChartViewVO,
  DashboardBarVO,
  DashboardComponentVO,
  DashboardDetailVO,
  DashboardLayoutVO,
  DashboardLinkageVO,
  DashboardNodeVO,
  DashboardStatusVO,
  FilterContextItem,
  LinkageContextItem,
  PublishStatus,
  ViewMode
} from '../types/dashboard'
import { chartQueryApi, dashboardApi, dashboardTreeApi } from '../api/dashboard'

export const useDashboardMetaStore = defineStore('dashboardMeta', () => {
  const tree = ref<BusiNodeVO[]>([])
  const currentId = ref<string | null>(null)
  const barInfo = ref<DashboardBarVO | null>(null)
  const meta = ref<DashboardNodeVO | null>(null)

  const loadTree = async () => {
    tree.value = await dashboardTreeApi.tree({ busiFlag: 'dashboard' })
  }

  const selectNode = async (id: string) => {
    currentId.value = id
    barInfo.value = await dashboardTreeApi.barInfo(id)
  }

  const createDashboard = async (pid: string, name: string) => {
    const node = await dashboardTreeApi.create({ pid, name, nodeType: 'dashboard' })
    await loadTree()
    return node
  }

  const setMeta = (m: DashboardNodeVO) => {
    meta.value = m
  }

  return { tree, currentId, barInfo, meta, loadTree, selectNode, createDashboard, setMeta }
})

export const useCanvasStore = defineStore('dashboardCanvas', () => {
  const layout = ref<DashboardLayoutVO | null>(null)
  const components = ref<DashboardComponentVO[]>([])
  const charts = ref<Record<string, ChartViewVO>>({})
  const linkages = ref<DashboardLinkageVO[]>([])
  const contentId = ref('0')
  const dirty = ref(false)

  const load = async (id: string, view: ViewMode = 'draft') => {
    const detail: DashboardDetailVO = await dashboardApi.get(id, view)
    layout.value = detail.layout
    components.value = detail.components
    charts.value = detail.charts
    linkages.value = detail.linkages
    contentId.value = detail.meta.contentId
    dirty.value = false
    return detail
  }

  const saveLayout = async (id: string, patch: Partial<DashboardLayoutVO>) => {
    layout.value = await dashboardApi.updateLayout(id, {
      ...patch,
      contentId: contentId.value
    })
    dirty.value = true
  }

  const saveComponents = async (
    id: string,
    upsert: DashboardComponentVO[],
    deleteIds: string[] = []
  ) => {
    components.value = await dashboardApi.updateComponents(id, {
      upsert,
      deleteIds,
      contentId: contentId.value
    })
    dirty.value = true
  }

  const saveChart = async (dashboardId: string, chartId: string, chart: Omit<ChartViewVO, 'id' | 'dashboardId'> & { contentId?: string }) => {
    const vo = await dashboardApi.saveChart(dashboardId, chartId, {
      datasetId: chart.datasetId,
      chartType: chart.chartType,
      title: chart.title,
      encode: chart.encode,
      style: chart.style,
      senior: chart.senior,
      contentId: contentId.value
    })
    charts.value = { ...charts.value, [chartId]: vo }
    dirty.value = true
    return vo
  }

  const saveLinkages = async (id: string, next: DashboardLinkageVO[]) => {
    linkages.value = await dashboardApi.putLinkages(id, next)
    dirty.value = true
  }

  return {
    layout,
    components,
    charts,
    linkages,
    contentId,
    dirty,
    load,
    saveLayout,
    saveComponents,
    saveChart,
    saveLinkages
  }
})

export const useSelectionStore = defineStore('dashboardSelection', () => {
  const selectedComponentId = ref<string | null>(null)
  const selectedChartId = ref<string | null>(null)

  const selectComponent = (componentId: string | null, chartViewId?: string | null) => {
    selectedComponentId.value = componentId
    selectedChartId.value = chartViewId || null
  }

  const clear = () => {
    selectedComponentId.value = null
    selectedChartId.value = null
  }

  return { selectedComponentId, selectedChartId, selectComponent, clear }
})

export const useFilterStateStore = defineStore('dashboardFilterState', () => {
  const filters = ref<FilterContextItem[]>([])
  const linkages = ref<LinkageContextItem[]>([])

  const setFilter = (item: FilterContextItem) => {
    const idx = filters.value.findIndex(f => f.componentId === item.componentId)
    if (idx >= 0) filters.value[idx] = item
    else filters.value.push(item)
  }

  const clearFilters = () => {
    filters.value = []
  }

  const setLinkageHit = (item: LinkageContextItem) => {
    // replace linkages targeting same chart+field
    linkages.value = [
      ...linkages.value.filter(
        l => !(l.targetChartId === item.targetChartId && l.targetField === item.targetField)
      ),
      item
    ]
  }

  const clearLinkages = () => {
    linkages.value = []
  }

  const context = computed(() => ({
    filters: filters.value,
    linkages: linkages.value
  }))

  return { filters, linkages, setFilter, clearFilters, setLinkageHit, clearLinkages, context }
})

export const usePublishStore = defineStore('dashboardPublish', () => {
  const status = ref<PublishStatus | null>(null)
  const contentId = ref<string>('0')
  const version = ref(0)

  const refresh = async (id: string) => {
    const vo: DashboardStatusVO = await dashboardApi.status(id)
    status.value = vo.status
    contentId.value = vo.contentId
    version.value = vo.version
    return vo
  }

  const publish = async (id: string) => {
    const vo = await dashboardApi.publish(id)
    status.value = vo.status
    contentId.value = vo.contentId
    version.value = vo.version
    return vo
  }

  const discardDraft = async (id: string) => {
    const vo = await dashboardApi.discardDraft(id)
    status.value = vo.status
    contentId.value = vo.contentId
    version.value = vo.version
    return vo
  }

  const canPreviewPublished = computed(
    () => status.value === 'published' || status.value === 'publishedWithDraft'
  )

  return { status, contentId, version, refresh, publish, discardDraft, canPreviewPublished }
})

export const useChartDataStore = defineStore('dashboardChartData', () => {
  const results = ref<Record<string, ChartQueryResult>>({})
  const loading = ref<Record<string, boolean>>({})
  const errors = ref<Record<string, string>>({})

  const queryChart = async (
    dashboardId: string,
    chartId: string,
    view: ViewMode,
    context: { filters: FilterContextItem[]; linkages: LinkageContextItem[] }
  ) => {
    loading.value = { ...loading.value, [chartId]: true }
    try {
      const result = await chartQueryApi.query({
        dashboardId,
        chartId,
        view,
        context
      })
      results.value = { ...results.value, [chartId]: result }
      const { [chartId]: _, ...rest } = errors.value
      errors.value = rest
      return result
    } catch (e) {
      errors.value = { ...errors.value, [chartId]: (e as Error).message }
      throw e
    } finally {
      loading.value = { ...loading.value, [chartId]: false }
    }
  }

  return { results, loading, errors, queryChart }
})

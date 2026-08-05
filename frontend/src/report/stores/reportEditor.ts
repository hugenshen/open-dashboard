import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ReportChartAttrs } from '../types'

export type InspTab = 'data' | 'style' | 'senior'

export const useReportEditorStore = defineStore('reportEditor', () => {
  const selectedChartId = ref<string | null>(null)
  const inspectorCollapsed = ref(false)
  const inspTab = ref<InspTab>('data')
  const dirty = ref(false)
  const savedAt = ref<string | null>(null)

  let patchChartFn: ((id: string, patch: Partial<ReportChartAttrs>) => void) | null = null
  let selectChartFn: ((id: string) => void) | null = null
  let deleteChartFn: ((id: string) => void) | null = null
  let refreshChartFn: ((id: string) => void) | null = null
  const refreshHandlers = new Map<string, () => void>()

  function registerRefreshHandler(id: string, fn: () => void) {
    refreshHandlers.set(id, fn)
  }

  function unregisterRefreshHandler(id: string) {
    refreshHandlers.delete(id)
  }

  function registerEditorApi(api: {
    patchChart: (id: string, patch: Partial<ReportChartAttrs>) => void
    selectChart: (id: string) => void
    deleteChart: (id: string) => void
    refreshChart: (id: string) => void
  }) {
    patchChartFn = api.patchChart
    selectChartFn = api.selectChart
    deleteChartFn = api.deleteChart
    refreshChartFn = api.refreshChart
  }

  function unregisterEditorApi() {
    patchChartFn = selectChartFn = deleteChartFn = refreshChartFn = null
  }

  function selectChart(id: string | null) {
    selectedChartId.value = id
  }

  function patchChart(id: string, patch: Partial<ReportChartAttrs>) {
    patchChartFn?.(id, patch)
    markDirty()
  }

  function deleteChart(id: string) {
    deleteChartFn?.(id)
    if (selectedChartId.value === id) selectedChartId.value = null
    markDirty()
  }

  function refreshChart(id: string) {
    refreshHandlers.get(id)?.()
    refreshChartFn?.(id)
  }

  function focusChart(id: string) {
    selectChartFn?.(id)
    selectedChartId.value = id
    inspectorCollapsed.value = false
    inspTab.value = 'data'
  }

  function markDirty() {
    dirty.value = true
  }

  function markSaved() {
    dirty.value = false
    savedAt.value = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }

  function saveLabel() {
    if (dirty.value) return '文档未保存'
    if (savedAt.value) return `${savedAt.value}保存`
    return '文档已保存'
  }

  return {
    selectedChartId,
    inspectorCollapsed,
    inspTab,
    dirty,
    savedAt,
    selectChart,
    patchChart,
    deleteChart,
    refreshChart,
    focusChart,
    markDirty,
    markSaved,
    saveLabel,
    registerEditorApi,
    unregisterEditorApi,
    registerRefreshHandler,
    unregisterRefreshHandler
  }
})

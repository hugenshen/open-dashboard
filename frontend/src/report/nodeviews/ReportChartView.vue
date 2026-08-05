<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import * as echarts from 'echarts'
import { chartQueryApi } from '../../api/dashboard'
import type { ChartQueryResult } from '../../types/dashboard'
import { useReportEditorStore } from '../stores/reportEditor'

const props = defineProps<{
  node: {
    attrs: Record<string, unknown>
  }
  selected: boolean
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
}>()

const store = useReportEditorStore()
const attrs = computed(() => props.node.attrs)
const loading = ref(false)
const error = ref('')
const result = ref<ChartQueryResult | null>(null)
const el = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const chartId = computed(() => String(attrs.value.id || ''))

const title = computed(() => {
  const t = String(attrs.value.title || '')
  if (t) return t
  if (attrs.value.source === 'dashboard') {
    return `看板图 ${attrs.value.chartId || ''}`
  }
  return `${attrs.value.chartType || 'chart'} · ${attrs.value.datasetId || ''}`
})

const sourceTag = computed(() =>
  attrs.value.source === 'dashboard' ? '引用看板' : '仅报告'
)

const metaLine = computed(() => {
  if (attrs.value.source === 'dashboard') {
    return `${attrs.value.dashboardId || '—'} / ${attrs.value.chartId || '—'} · 实时`
  }
  return `${attrs.value.chartType || 'bar'} · ${attrs.value.datasetId || '—'} · 实时`
})

const isSelected = computed(
  () => props.selected || store.selectedChartId === chartId.value
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const a = attrs.value
    if (a.source === 'dashboard') {
      result.value = await chartQueryApi.query({
        dashboardId: String(a.dashboardId || ''),
        chartId: String(a.chartId || ''),
        view: (a.view as 'draft' | 'published') || 'draft',
        context: { filters: [], linkages: [] }
      })
    } else {
      result.value = await chartQueryApi.query({
        client: 'report',
        inline: {
          datasetId: String(a.datasetId || ''),
          chartType: String(a.chartType || 'bar'),
          encode: (a.encode as Record<string, unknown>) || {}
        },
        context: { filters: [], linkages: [] }
      })
    }
    renderChart()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function renderChart() {
  if (!el.value || !result.value) return
  const chartType = String(attrs.value.chartType || result.value.extra?.chartType || 'bar')
  if (chartType === 'kpi') {
    chart?.dispose()
    chart = null
    const kpi = Number((result.value.series as { kpi?: number })?.kpi || 0)
    const label = String((result.value.series as { label?: string })?.label || '指标')
    el.value.innerHTML = `<div class="kpi-body"><div class="kpi-label">${label}</div><div class="kpi-val">${kpi.toLocaleString()}</div></div>`
    return
  }
  if (!chart) chart = echarts.init(el.value)
  const categories = (result.value.series?.categories as string[]) || []
  const seriesArr =
    (result.value.series?.series as Array<{ name: string; data: number[]; type?: string }>) || []
  if (chartType === 'pie') {
    chart.setOption(
      {
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'pie',
            radius: '60%',
            data: categories.map((name, i) => ({ name, value: seriesArr[0]?.data[i] || 0 }))
          }
        ]
      },
      true
    )
    return
  }
  const seriesType = chartType === 'line' || chartType === 'area' ? 'line' : 'bar'
  chart.setOption(
    {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 16, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value' },
      series: seriesArr.map((s) => ({ type: seriesType, name: s.name, data: s.data }))
    },
    true
  )
}

function onSelect() {
  if (!chartId.value) return
  store.selectChart(chartId.value)
  store.inspectorCollapsed = false
}

function onConfig(e: Event) {
  e.stopPropagation()
  onSelect()
  store.inspTab = 'data'
}

function onRefresh(e: Event) {
  e.stopPropagation()
  load()
}

function onDelete(e: Event) {
  e.stopPropagation()
  if (chartId.value) store.deleteChart(chartId.value)
  else props.deleteNode()
}

function onDblClick() {
  onSelect()
  store.inspTab = 'data'
}

onMounted(() => {
  load()
  if (chartId.value) store.registerRefreshHandler(chartId.value, load)
})

onBeforeUnmount(() => {
  if (chartId.value) store.unregisterRefreshHandler(chartId.value)
  chart?.dispose()
  chart = null
})

watch(chartId, (newId, oldId) => {
  if (oldId) store.unregisterRefreshHandler(oldId)
  if (newId) store.registerRefreshHandler(newId, load)
})

watch(
  () => [
    attrs.value.source,
    attrs.value.dashboardId,
    attrs.value.chartId,
    attrs.value.datasetId,
    attrs.value.chartType,
    attrs.value.encode,
    attrs.value.height
  ],
  () => load(),
  { deep: true }
)
</script>

<template>
  <NodeViewWrapper
    class="report-chart-node"
    :class="{ selected: isSelected }"
    data-type="report-chart"
    :data-rc="chartId"
    @click="onSelect"
    @dblclick="onDblClick"
  >
    <div class="report-chart-head">
      <strong>{{ title }}</strong>
      <span class="tag" :class="{ inline: attrs.source === 'inline' }">{{ sourceTag }}</span>
      <span class="muted">{{ metaLine }}</span>
      <span class="spacer" />
      <button type="button" class="ghost" @click="onConfig">配置</button>
      <button type="button" class="ghost" @click="onRefresh">刷新</button>
      <button type="button" class="ghost danger" @click="onDelete">删除</button>
    </div>
    <p v-if="loading" class="muted pad">取数中…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <div
      ref="el"
      class="report-chart-body"
      :style="{ height: `${Number(attrs.height) || 320}px` }"
    />
  </NodeViewWrapper>
</template>

<style scoped>
.report-chart-node {
  border: 1px solid #d8dee6;
  border-radius: 8px;
  background: #fff;
  margin: 0.5rem 0;
  overflow: hidden;
  cursor: pointer;
}
.report-chart-node.selected {
  border-color: #3480f9;
  box-shadow: 0 0 0 2px rgba(52, 128, 249, 0.18);
}
.report-chart-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.75rem;
  background: #f7f8fa;
  border-bottom: 1px solid #eef1f5;
  font-size: 0.88rem;
}
.tag {
  font-size: 0.68rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: #e8f3ff;
  color: #3480f9;
  white-space: nowrap;
}
.tag.inline {
  background: #e8ffea;
  color: #00b42a;
}
.muted {
  color: #86909c;
  font-size: 0.75rem;
}
.pad {
  padding: 0.5rem 0.75rem;
  margin: 0;
}
.spacer {
  flex: 1;
}
.ghost {
  border: 0;
  background: transparent;
  color: #3480f9;
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.15rem 0.3rem;
}
.ghost.danger {
  color: #b42318;
}
.err {
  color: #b42318;
  font-size: 0.85rem;
  padding: 0.5rem 0.75rem;
  margin: 0;
}
.report-chart-body {
  width: 100%;
  padding: 0.5rem 0.75rem 0.75rem;
}
:deep(.kpi-body) {
  height: 100%;
  display: grid;
  place-items: center;
  text-align: center;
}
:deep(.kpi-val) {
  font-size: 2rem;
  font-weight: 700;
  color: #3480f9;
}
:deep(.kpi-label) {
  font-size: 0.8rem;
  color: #86909c;
  margin-bottom: 0.5rem;
}
</style>

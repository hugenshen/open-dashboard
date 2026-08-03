<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import * as echarts from 'echarts'
import { chartQueryApi } from '../../api/dashboard'
import type { ChartQueryResult } from '../../types/dashboard'

const props = defineProps<{
  node: {
    attrs: Record<string, unknown>
  }
  selected: boolean
  deleteNode: () => void
}>()

const attrs = computed(() => props.node.attrs)
const loading = ref(false)
const error = ref('')
const result = ref<ChartQueryResult | null>(null)
const el = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const title = computed(() => {
  const t = String(attrs.value.title || '')
  if (t) return t
  if (attrs.value.source === 'dashboard') {
    return `看板图 ${attrs.value.chartId || ''}`
  }
  return `${attrs.value.chartType || 'chart'} · ${attrs.value.datasetId || ''}`
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const a = attrs.value
    if (a.source === 'dashboard') {
      result.value = await chartQueryApi.query({
        dashboardId: String(a.dashboardId || ''),
        chartId: String(a.chartId || ''),
        view: (a.view as 'draft' | 'published') || 'published',
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
  if (!chart) chart = echarts.init(el.value)
  const categories = (result.value.series?.categories as string[]) || []
  const seriesArr = (result.value.series?.series as Array<{ name: string; data: number[] }>) || []
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 28, bottom: 28 },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value' },
    series: seriesArr.map((s) => ({ type: 'bar', name: s.name, data: s.data }))
  })
}

onMounted(load)
watch(
  () => [
    attrs.value.source,
    attrs.value.dashboardId,
    attrs.value.chartId,
    attrs.value.datasetId,
    attrs.value.chartType
  ],
  () => load()
)

onBeforeUnmount(() => {
  chart?.dispose()
  chart = null
})
</script>

<template>
  <NodeViewWrapper
    class="report-chart-node"
    :class="{ selected }"
    data-type="report-chart"
  >
    <div class="report-chart-head">
      <strong>{{ title }}</strong>
      <span class="muted">{{ attrs.source }} · 实时</span>
      <button type="button" class="ghost" @click="load">刷新</button>
      <button type="button" class="ghost danger" @click="deleteNode">删除</button>
    </div>
    <p v-if="loading" class="muted">取数中…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <div ref="el" class="report-chart-body" :style="{ height: `${Number(attrs.height) || 320}px` }" />
  </NodeViewWrapper>
</template>

<style scoped>
.report-chart-node {
  border: 1px solid #d8dee6;
  border-radius: 8px;
  background: #fff;
  margin: 0.5rem 0;
  padding: 0.5rem 0.75rem 0.75rem;
}
.report-chart-node.selected {
  border-color: #1f6feb;
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.15);
}
.report-chart-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.9rem;
}
.muted {
  color: #5c6b7a;
  font-size: 0.8rem;
}
.err {
  color: #b42318;
  font-size: 0.85rem;
}
.ghost {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: #1f6feb;
  cursor: pointer;
}
.ghost.danger {
  margin-left: 0;
  color: #b42318;
}
.report-chart-body {
  width: 100%;
}
</style>

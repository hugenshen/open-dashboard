<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { chartQueryApi } from '../../api/dashboard'
import type { ChartQueryResult, FilterContextItem } from '../../types/dashboard'

const props = withDefaults(
  defineProps<{
    dashboardId?: string
    chartId?: string
    datasetId?: string
    chartType?: string
    encode?: Record<string, unknown>
    title?: string
    filters?: FilterContextItem[]
    /** Ask/SQLBot rows already fetched — skip chartQuery (encode may use SQL aliases). */
    rows?: unknown[][]
    columns?: string[]
    height?: number
  }>(),
  {
    chartType: 'bar',
    encode: () => ({}),
    filters: () => [],
    height: 220
  }
)

const el = ref<HTMLDivElement | null>(null)
const loading = ref(false)
const error = ref('')
const empty = ref(false)
let chart: echarts.ECharts | null = null

function hasInline() {
  return !!(props.datasetId && (props.encode.category || props.encode.value || props.chartType === 'kpi'))
}

function hasBoard() {
  return !!(props.dashboardId && props.chartId)
}

function hasPreviewRows() {
  return Array.isArray(props.rows) && props.rows.length > 0
}

function previewFromRows(): ChartQueryResult | null {
  const rows = props.rows
  if (!rows?.length) return null
  const fields = (props.columns || []).map((name) => ({ name, type: 'string' }))
  const valueName = String(props.encode?.value || props.columns?.[1] || 'value')
  const categories = rows.map((r) => String((r as unknown[])?.[0] ?? ''))
  const seriesData = rows.map((r) => {
    const row = r as unknown[]
    const raw = row?.[1] ?? row?.[0]
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  })
  return {
    fields,
    data: rows,
    series: {
      categories,
      series: [{ name: valueName, data: seriesData }]
    },
    extra: { chartType: props.chartType }
  }
}

async function load() {
  const preview = previewFromRows()
  if (preview) {
    render(preview)
    return
  }
  if (!hasBoard() && !hasInline()) {
    error.value = '未绑定数据集'
    empty.value = true
    return
  }
  loading.value = true
  error.value = ''
  empty.value = false
  try {
    const result = await chartQueryApi.query({
      chartId: props.chartId,
      dashboardId: props.dashboardId,
      view: 'draft',
      inline: hasInline()
        ? {
            datasetId: String(props.datasetId),
            chartType: String(props.chartType || 'bar'),
            encode: { ...(props.encode || {}), datasetId: props.datasetId }
          }
        : undefined,
      context: { filters: props.filters || [], linkages: [] }
    })
    render(result)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    empty.value = true
    chart?.clear()
  } finally {
    loading.value = false
  }
}

function render(result: ChartQueryResult) {
  if (!el.value) return
  const chartType = String(result.extra?.chartType || props.chartType || 'bar')
  const rows = result.data || []
  if (!rows.length && chartType !== 'kpi') {
    empty.value = true
    chart?.dispose()
    chart = null
    el.value.innerHTML = ''
    return
  }
  if (chartType === 'kpi') {
    chart?.dispose()
    chart = null
    const kpi = Number((result.series as { kpi?: number })?.kpi ?? rows[0]?.[0] ?? rows[0]?.[1] ?? 0)
    const label = String((result.series as { label?: string })?.label || props.title || '指标')
    el.value.innerHTML = `<div class="kpi"><div class="l">${escapeHtml(label)}</div><div class="v">${formatKpi(kpi)}</div></div>`
    return
  }
  if (
    chartType === 'table' ||
    chartType === 'grouptable' ||
    chartType === 'detailtable' ||
    chartType === 'pivot'
  ) {
    chart?.dispose()
    chart = null
    const fields = result.fields || []
    const head = fields.map((f) => `<th>${escapeHtml(f.name)}</th>`).join('')
    const body = rows
      .slice(0, 12)
      .map((r) => `<tr>${fields.map((_, i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('')}</tr>`)
      .join('')
    el.value.innerHTML = `<div class="tbl"><table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td>暂无数据</td></tr>'}</tbody></table></div>`
    return
  }
  el.value.innerHTML = ''
  if (!chart) chart = echarts.init(el.value)
  const categories = (result.series?.categories as string[]) || rows.map((r) => String(r[0] ?? ''))
  const seriesArr =
    (result.series?.series as Array<{ name: string; data: number[] }>) ||
    [
      {
        name: String(props.encode.value || 'value'),
        data: rows.map((r) => Number(r[1] ?? r[0] ?? 0))
      }
    ]
  if (chartType === 'pie') {
    chart.setOption(
      {
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'pie',
            radius: ['36%', '64%'],
            data: categories.map((name, i) => ({ name, value: seriesArr[0]?.data[i] || 0 }))
          }
        ]
      },
      true
    )
    return
  }
  const isHbar = chartType === 'hbar'
  const seriesType = chartType === 'line' || chartType === 'area' ? 'line' : 'bar'
  chart.setOption(
    {
      tooltip: { trigger: 'axis' },
      grid: { left: isHbar ? 72 : 36, right: 12, top: 24, bottom: 28 },
      xAxis: isHbar ? { type: 'value' } : { type: 'category', data: categories, axisLabel: { fontSize: 10 } },
      yAxis: isHbar ? { type: 'category', data: categories, axisLabel: { fontSize: 10 } } : { type: 'value' },
      series: seriesArr.map((s) => ({
        type: seriesType,
        name: s.name,
        data: s.data,
        areaStyle: chartType === 'area' ? {} : undefined
      }))
    },
    true
  )
  chart.resize()
}

function formatKpi(n: number) {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 10000) return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function escapeHtml(v: unknown) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

onMounted(load)
onBeforeUnmount(() => {
  chart?.dispose()
  chart = null
})

watch(
  () => [
    props.dashboardId,
    props.chartId,
    props.datasetId,
    props.chartType,
    JSON.stringify(props.encode || {}),
    JSON.stringify(props.filters || []),
    JSON.stringify(props.rows || []),
    JSON.stringify(props.columns || [])
  ],
  () => load()
)
</script>

<template>
  <div class="live-preview">
    <p v-if="loading" class="hint">取数中…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="empty && !error" class="hint">暂无数据</p>
    <div ref="el" class="body" :style="{ height: `${height}px` }" />
  </div>
</template>

<style scoped>
.live-preview {
  width: 100%;
  min-height: 80px;
}
.hint,
.err {
  margin: 0 0 6px;
  font-size: 12px;
}
.hint {
  color: #8f959e;
}
.err {
  color: #f54a45;
}
.body {
  width: 100%;
}
:deep(.kpi) {
  height: 100%;
  display: grid;
  place-items: center;
  text-align: center;
}
:deep(.kpi .l) {
  font-size: 12px;
  color: #8f959e;
}
:deep(.kpi .v) {
  font-size: 26px;
  font-weight: 700;
  color: #1f2329;
}
:deep(.tbl) {
  height: 100%;
  overflow: auto;
}
:deep(.tbl table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
:deep(.tbl th),
:deep(.tbl td) {
  border: 1px solid #eef1f5;
  padding: 4px 8px;
  text-align: left;
}
:deep(.tbl th) {
  background: #f7f8fa;
}
</style>

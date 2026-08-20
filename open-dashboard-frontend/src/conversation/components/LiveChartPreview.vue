<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { chartQueryApi } from '../../api/dashboard'
import type { ChartQueryResult, FilterContextItem } from '../../types/dashboard'
import { displayFieldNames, humanizeFieldName } from '../../utils/fieldLabel'

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
    columnLabels?: string[]
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
let resizeTid: number | null = null

/** 容器在挂载瞬间可能为 0 宽（父级刚显示），等布局稳定后再 resize，否则 echarts 不画 canvas */
function resizeWhenReady() {
  if (resizeTid != null) cancelAnimationFrame(resizeTid)
  let attempt = 0
  const tick = () => {
    resizeTid = null
    if (!chart || !el.value) return
    const w = el.value.clientWidth
    if (w > 0 && el.value.clientHeight > 0) {
      chart.resize()
    }
    if (attempt++ < 8) {
      resizeTid = window.setTimeout(tick, 60)
    }
  }
  resizeTid = window.setTimeout(tick, 0)
}

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
  const displayCols = displayFieldNames(props.columns, props.columnLabels)
  const fields = displayCols.map((name) => ({ name, type: 'string' }))
  const valueName = String(
    props.encode?.valueLabel || displayCols[1] || humanizeFieldName(String(props.encode?.value || '指标'))
  )
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
  if (Array.isArray(props.rows)) {
    if (!props.rows.length) {
      empty.value = true
      error.value = ''
      loading.value = false
      chart?.dispose()
      chart = null
      if (el.value) el.value.innerHTML = ''
      return
    }
    const preview = previewFromRows()
    if (preview) {
      empty.value = false
      render(preview)
      return
    }
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
    const s = result.series as { kpi?: number; label?: string }
    // data 行是权威值（如 [[610]]），series.kpi 在某些后端路径为占位(1.0)，优先用 data
    const kpi = Number(rows[0]?.[0] ?? rows[0]?.[1] ?? s.kpi ?? 0)
    // 标题即人读的指标名（如「记录数」），优先于 SQL 别名（如 call_status）
    const label = String(
      props.title || s.label || humanizeFieldName(String(props.encode?.valueLabel || props.encode?.value || '指标'))
    )
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
    const head = fields
      .map((f) => `<th>${escapeHtml(humanizeFieldName(String(f.name || '')))}</th>`)
      .join('')
    const body = rows
      .slice(0, 12)
      .map((r) => `<tr>${fields.map((_, i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('')}</tr>`)
      .join('')
    el.value.innerHTML = `<div class="tbl"><table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td>暂无数据</td></tr>'}</tbody></table></div>`
    return
  }
  el.value.innerHTML = ''
  // 每次重建全新容器再 init：避免 v-for 复用节点时残留/失效实例导致 echarts 不画 canvas
  if (chart && chart.isDisposed()) chart = null
  chart = null
  const host = document.createElement('div')
  host.style.width = '100%'
  host.style.height = '100%'
  el.value.appendChild(host)
  chart = echarts.init(host)
  const categories = (result.series?.categories as string[]) || rows.map((r) => String(r[0] ?? ''))
  const rawSeries =
    (result.series?.series as Array<{ name: string; data: number[] }>) ||
    [
      {
        name: String(props.encode.valueLabel || props.encode.value || '指标'),
        data: rows.map((r) => Number(r[1] ?? r[0] ?? 0))
      }
    ]
  const seriesArr = rawSeries.map((s) => ({ ...s, name: humanizeFieldName(s.name) }))
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
    resizeWhenReady()
    return
  }
  const isHbar = chartType === 'hbar'
  const seriesType = chartType === 'line' || chartType === 'area' ? 'line' : 'bar'
  const valueAxis = {
    type: 'value' as const,
    axisLabel: { fontSize: 10, formatter: compactAxisNum }
  }
  const categoryAxis = {
    type: 'category' as const,
    data: categories,
    axisLabel: { fontSize: 10, hideOverlap: true }
  }
  chart.setOption(
    {
      tooltip: { trigger: 'axis' },
      grid: { left: 8, right: 16, top: 28, bottom: 32, containLabel: true },
      xAxis: isHbar ? valueAxis : categoryAxis,
      yAxis: isHbar ? categoryAxis : valueAxis,
      series: seriesArr.map((s) => ({
        type: seriesType,
        name: s.name,
        data: s.data,
        areaStyle: chartType === 'area' ? {} : undefined
      }))
    },
    true
  )
  resizeWhenReady()
}

function compactAxisNum(n: number) {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${(n / 1e8).toFixed(abs >= 1e9 ? 1 : 0)}亿`
  if (abs >= 1e4) return `${(n / 1e4).toFixed(abs >= 1e6 ? 1 : 0)}万`
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
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
  if (resizeTid != null) {
    clearTimeout(resizeTid)
    resizeTid = null
  }
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
    JSON.stringify(props.columns || []),
    JSON.stringify(props.columnLabels || [])
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

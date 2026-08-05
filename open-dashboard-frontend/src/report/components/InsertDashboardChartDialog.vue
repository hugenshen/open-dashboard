<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { catalogApi, type DashboardCatalogItem, type DashboardChartCatalogItem } from '../api/catalog'
import { chartQueryApi } from '../../api/dashboard'
import type { ReportChartAttrs } from '../types'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  confirm: [attrs: ReportChartAttrs[]]
}>()

const loading = ref(false)
const thumbsLoading = ref(false)
const dashboards = ref<DashboardCatalogItem[]>([])
const dashId = ref('')
const search = ref('')
const selected = ref<Set<string>>(new Set())
const thumbEls = new Map<string, HTMLDivElement>()
const thumbCharts = new Map<string, echarts.ECharts>()
let renderToken = 0

const currentDash = computed(() => dashboards.value.find((d) => d.id === dashId.value))
const filteredCharts = computed(() => {
  const list = currentDash.value?.charts || []
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.chartType.toLowerCase().includes(q) ||
      (c.datasetId || '').toLowerCase().includes(q)
  )
})

const typeLabel = (t: string) =>
  ({
    bar: '柱状',
    line: '折线',
    area: '面积',
    pie: '饼图',
    kpi: 'KPI',
    hbar: '条形',
    table: '表格',
    grouptable: '分组表',
    detailtable: '明细表'
  }[t] || t)

watch(open, async (v) => {
  if (!v) {
    disposeThumbs()
    return
  }
  loading.value = true
  selected.value = new Set()
  search.value = ''
  try {
    const cat = await catalogApi.get()
    dashboards.value = cat.dashboards
    dashId.value = cat.dashboards[0]?.id || ''
  } finally {
    loading.value = false
  }
})

watch([dashId, filteredCharts, open, loading], async () => {
  if (!open.value || loading.value) return
  await nextTick()
  await renderThumbs()
}, { flush: 'post' })

onBeforeUnmount(() => disposeThumbs())

function setThumbEl(id: string, el: unknown) {
  if (el instanceof HTMLDivElement) thumbEls.set(id, el)
  else thumbEls.delete(id)
}

function disposeThumbs() {
  thumbCharts.forEach((c) => c.dispose())
  thumbCharts.clear()
  thumbEls.clear()
}

function pickDash(id: string) {
  dashId.value = id
  selected.value = new Set()
  search.value = ''
}

function toggleChart(c: DashboardChartCatalogItem) {
  const next = new Set(selected.value)
  if (next.has(c.id)) next.delete(c.id)
  else next.add(c.id)
  selected.value = next
}

function selectAll() {
  selected.value = new Set(filteredCharts.value.map((c) => c.id))
}

function clearAll() {
  selected.value = new Set()
}

function paintThumb(
  el: HTMLDivElement,
  chartType: string,
  result: Awaited<ReturnType<typeof chartQueryApi.query>>
) {
  thumbCharts.get(el.dataset.chartId || '')?.dispose()
  if (chartType === 'kpi') {
    const kpi = Number((result.series as { kpi?: number })?.kpi || 0)
    el.innerHTML = `<div class="kpi-thumb"><div class="kpi-val">${kpi.toLocaleString()}</div></div>`
    return
  }
  if (chartType === 'table' || chartType === 'grouptable' || chartType === 'detailtable') {
    const fields = result.fields || []
    const rows = (result.data || []).slice(0, 4)
    const head = fields
      .slice(0, 3)
      .map((f) => `<th>${f.name}</th>`)
      .join('')
    const body = rows
      .map(
        (r) =>
          `<tr>${fields
            .slice(0, 3)
            .map((_, i) => `<td>${r[i] ?? ''}</td>`)
            .join('')}</tr>`
      )
      .join('')
    el.innerHTML = `<div class="tbl-thumb"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    return
  }
  el.innerHTML = ''
  const chart = echarts.init(el)
  const id = el.dataset.chartId || ''
  thumbCharts.set(id, chart)
  const categories = (result.series?.categories as string[]) || []
  const seriesArr =
    (result.series?.series as Array<{ name: string; data: number[]; type?: string }>) || []
  if (chartType === 'pie') {
    chart.setOption({
      animation: false,
      series: [
        {
          type: 'pie',
          radius: ['35%', '70%'],
          label: { show: false },
          data: categories.map((name, i) => ({ name, value: seriesArr[0]?.data[i] || 0 }))
        }
      ]
    })
    return
  }
  const isHbar = chartType === 'hbar'
  const seriesType = chartType === 'line' || chartType === 'area' ? 'line' : 'bar'
  chart.setOption({
    animation: false,
    grid: { left: isHbar ? 36 : 28, right: 8, top: 8, bottom: 20 },
    xAxis: isHbar
      ? { type: 'value', show: false }
      : { type: 'category', data: categories, axisLabel: { fontSize: 9 } },
    yAxis: isHbar
      ? { type: 'category', data: categories, axisLabel: { fontSize: 9 } }
      : { type: 'value', show: false },
    series: seriesArr.map((s) => ({
      type: seriesType,
      data: s.data,
      areaStyle: chartType === 'area' ? {} : undefined,
      itemStyle: { color: '#3480f9' },
      lineStyle: { width: 1.5 }
    }))
  })
}

async function renderThumbs() {
  const token = ++renderToken
  thumbsLoading.value = true
  thumbCharts.forEach((c) => c.dispose())
  thumbCharts.clear()
  const dash = dashId.value
  const charts = filteredCharts.value
  try {
    await Promise.all(
      charts.map(async (c) => {
        const el = thumbEls.get(c.id)
        if (!el) return
        el.dataset.chartId = c.id
        el.innerHTML = '<div class="thumb-loading">…</div>'
        try {
          const result = await chartQueryApi.query({
            dashboardId: dash,
            chartId: c.id,
            view: 'draft',
            context: { filters: [], linkages: [] }
          })
          if (token !== renderToken) return
          const chartType = String(c.chartType || result.extra?.chartType || 'bar')
          paintThumb(el, chartType, result)
        } catch {
          if (token !== renderToken) return
          el.innerHTML = '<div class="thumb-fail">加载失败</div>'
        }
      })
    )
  } finally {
    if (token === renderToken) thumbsLoading.value = false
  }
}

function confirm() {
  const dash = currentDash.value
  if (!dash || !selected.value.size) return
  const charts = dash.charts.filter((c) => selected.value.has(c.id))
  const ts = Date.now()
  emit(
    'confirm',
    charts.map((c, i) => ({
      id: `rc_${ts}_${i}_${c.id}`,
      source: 'dashboard' as const,
      dashboardId: dash.id,
      chartId: c.id,
      view: 'draft' as const,
      datasetId: c.datasetId || null,
      chartType: c.chartType,
      title: `${c.title}（引用）`,
      height: 320,
      width: 'full' as const
    }))
  )
  open.value = false
}

function close() {
  open.value = false
}
</script>

<template>
  <div v-if="open" class="mask" @click.self="close">
    <div class="wizard">
      <header class="wizard-hd">
        <div>
          <h3>引用仪表盘 · 选择图表</h3>
          <p>左侧选看板，勾选右侧缩略图（可多选），再插入报告</p>
        </div>
        <button type="button" class="btn ghost" @click="close">关闭</button>
      </header>

      <div v-if="loading" class="loading">加载目录…</div>
      <div v-else class="cite-body">
        <aside class="pane dash-pane">
          <div class="col-hd">仪表盘 <span>{{ dashboards.length }}</span></div>
          <button
            v-for="d in dashboards"
            :key="d.id"
            type="button"
            class="dash-item"
            :class="{ on: d.id === dashId }"
            @click="pickDash(d.id)"
          >
            {{ d.name }}
            <span class="sub">{{ d.charts.length }} 个可引用图表</span>
          </button>
        </aside>

        <section class="pane chart-pane">
          <div class="col-hd">
            图表缩略图 <span>{{ filteredCharts.length }}</span>
            <div class="acts">
              <button type="button" @click="selectAll">全选</button>
              <button type="button" @click="clearAll">清空</button>
            </div>
          </div>
          <input v-model="search" class="search" placeholder="搜索图表名称 / 类型…" />
          <div class="thumb-grid" :class="{ dim: thumbsLoading }">
            <button
              v-for="c in filteredCharts"
              :key="c.id"
              type="button"
              class="thumb"
              :class="{ on: selected.has(c.id) }"
              @click="toggleChart(c)"
            >
              <span
                class="thumb-check"
                :class="{ checked: selected.has(c.id) }"
                @click.stop="toggleChart(c)"
              >
                <svg v-if="selected.has(c.id)" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 4.6-4.6L12.2 5.5z"
                  />
                </svg>
              </span>
              <div class="thumb-chart" :ref="(el) => setThumbEl(c.id, el)" />
              <div class="thumb-meta">
                <div class="t" :title="c.title">{{ c.title }}</div>
                <span class="badge">{{ typeLabel(c.chartType) }}</span>
              </div>
            </button>
            <div v-if="!filteredCharts.length" class="empty">无匹配图表</div>
          </div>
        </section>
      </div>

      <footer class="wizard-ft">
        <span class="hint">已选 <b>{{ selected.size }}</b> 张 · 将按勾选顺序一次性插入编辑器</span>
        <div class="ft-actions">
          <button type="button" class="btn" @click="close">取消</button>
          <button type="button" class="btn primary" :disabled="!selected.size" @click="confirm">
            插入所选图表
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 30, 45, 0.45);
  display: grid;
  place-items: center;
  z-index: 2000;
}
.wizard {
  width: min(980px, 96vw);
  max-height: 90vh;
  background: #fff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}
.wizard-hd {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #e8ecf0;
}
.wizard-hd h3 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}
.wizard-hd p {
  margin: 0;
  font-size: 0.8rem;
  color: #5c6b7a;
}
.cite-body {
  display: grid;
  grid-template-columns: 200px 1fr;
  min-height: 420px;
  max-height: 58vh;
}
.pane {
  border-right: 1px solid #e8ecf0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.chart-pane {
  border-right: 0;
}
.col-hd {
  padding: 0.6rem 0.75rem;
  font-size: 0.82rem;
  font-weight: 600;
  border-bottom: 1px solid #eef1f5;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.col-hd span {
  color: #86909c;
  font-weight: 400;
}
.col-hd .acts {
  margin-left: auto;
  display: flex;
  gap: 0.35rem;
}
.col-hd .acts button {
  border: 0;
  background: transparent;
  color: #3480f9;
  cursor: pointer;
  font-size: 0.75rem;
}
.dash-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-bottom: 1px solid #f0f2f5;
  background: transparent;
  padding: 0.65rem 0.75rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.dash-item.on {
  background: #eef4ff;
  color: #3480f9;
}
.dash-item .sub {
  display: block;
  font-size: 0.72rem;
  color: #86909c;
  margin-top: 0.15rem;
}
.search {
  margin: 0.5rem 0.75rem 0.25rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 0.82rem;
}
.thumb-grid {
  flex: 1;
  overflow: auto;
  padding: 0.75rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
  align-content: start;
}
.thumb-grid.dim {
  opacity: 0.85;
}
.thumb {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid #e4e9ef;
  border-radius: 10px;
  background: #fff;
  padding: 0;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.thumb:hover {
  border-color: #b7cef9;
}
.thumb.on {
  border-color: #3480f9;
  box-shadow: 0 0 0 2px rgba(52, 128, 249, 0.18);
}
.thumb-check {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1.5px solid #c5ced9;
  background: rgba(255, 255, 255, 0.95);
  display: grid;
  place-items: center;
  color: #fff;
}
.thumb-check.checked {
  background: #3480f9;
  border-color: #3480f9;
}
.thumb-chart {
  height: 110px;
  background: #fafbfc;
  border-bottom: 1px solid #f0f2f5;
}
.thumb-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.55rem;
  min-height: 40px;
}
.thumb-meta .t {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  flex-shrink: 0;
  font-size: 0.66rem;
  background: #f4f5f7;
  padding: 0.12rem 0.35rem;
  border-radius: 4px;
  color: #5c6b7a;
}
.thumb-loading,
.thumb-fail {
  height: 100%;
  display: grid;
  place-items: center;
  color: #86909c;
  font-size: 0.75rem;
}
:deep(.kpi-thumb) {
  height: 100%;
  display: grid;
  place-items: center;
}
:deep(.kpi-val) {
  font-size: 1.35rem;
  font-weight: 700;
  color: #3480f9;
}
:deep(.tbl-thumb) {
  height: 100%;
  overflow: hidden;
  padding: 0.35rem;
  font-size: 0.62rem;
}
:deep(.tbl-thumb table) {
  width: 100%;
  border-collapse: collapse;
}
:deep(.tbl-thumb th),
:deep(.tbl-thumb td) {
  border: 1px solid #eef1f5;
  padding: 0.12rem 0.2rem;
  white-space: nowrap;
}
:deep(.tbl-thumb th) {
  background: #f7f8fa;
}
.wizard-ft {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid #e8ecf0;
  font-size: 0.8rem;
}
.hint {
  color: #86909c;
}
.hint b {
  color: #1d2129;
}
.ft-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.btn {
  border: 1px solid #d8dee6;
  background: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  font-size: 0.82rem;
}
.btn.primary {
  background: #3480f9;
  border-color: #3480f9;
  color: #fff;
}
.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.ghost {
  border: 0;
  background: transparent;
}
.loading {
  padding: 3rem;
  text-align: center;
  color: #86909c;
}
.empty {
  grid-column: 1 / -1;
  padding: 2rem;
  text-align: center;
  color: #86909c;
  font-size: 0.82rem;
}
</style>

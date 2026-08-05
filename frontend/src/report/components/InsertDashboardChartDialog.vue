<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { catalogApi, type DashboardCatalogItem, type DashboardChartCatalogItem } from '../api/catalog'
import { chartQueryApi } from '../../api/dashboard'
import type { ReportChartAttrs } from '../types'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  confirm: [attrs: ReportChartAttrs[]]
}>()

const loading = ref(false)
const dashboards = ref<DashboardCatalogItem[]>([])
const dashId = ref('')
const focusId = ref<string | null>(null)
const search = ref('')
const selected = ref<Set<string>>(new Set())
const previewEl = ref<HTMLDivElement | null>(null)
let previewChart: echarts.ECharts | null = null

const currentDash = computed(() => dashboards.value.find((d) => d.id === dashId.value))
const filteredCharts = computed(() => {
  const list = currentDash.value?.charts || []
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.chartType.toLowerCase().includes(q)
  )
})

const typeLabel = (t: string) =>
  ({ bar: '柱状', line: '折线', pie: '饼图', kpi: 'KPI', table: '表格' }[t] || t)

watch(open, async (v) => {
  if (!v) {
    previewChart?.dispose()
    previewChart = null
    return
  }
  loading.value = true
  selected.value = new Set()
  search.value = ''
  try {
    const cat = await catalogApi.get()
    dashboards.value = cat.dashboards
    dashId.value = cat.dashboards[0]?.id || ''
    focusId.value = cat.dashboards[0]?.charts[0]?.id || null
  } finally {
    loading.value = false
  }
})

watch([dashId, focusId, open], () => {
  if (open.value) refreshPreview()
})

function pickDash(id: string) {
  dashId.value = id
  selected.value = new Set()
  focusId.value = currentDash.value?.charts[0]?.id || null
  search.value = ''
}

function toggleChart(c: DashboardChartCatalogItem, fromCheckbox = false) {
  focusId.value = c.id
  if (fromCheckbox) {
    if (selected.value.has(c.id)) selected.value.delete(c.id)
    else selected.value.add(c.id)
  }
}

function toggleSelect(c: DashboardChartCatalogItem) {
  focusId.value = c.id
  if (selected.value.has(c.id)) selected.value.delete(c.id)
  else selected.value.add(c.id)
  refreshPreview()
}

function selectAll() {
  filteredCharts.value.forEach((c) => selected.value.add(c.id))
}

function clearAll() {
  selected.value.clear()
}

async function refreshPreview() {
  if (!previewEl.value || !focusId.value) return
  const c = currentDash.value?.charts.find((x) => x.id === focusId.value)
  if (!c) return
  previewChart?.dispose()
  previewChart = null
  try {
    const result = await chartQueryApi.query({
      dashboardId: dashId.value,
      chartId: c.id,
      view: 'draft',
      context: { filters: [], linkages: [] }
    })
    if (c.chartType === 'kpi') {
      previewEl.value.innerHTML = `<div class="kpi-preview"><div class="kpi-label">指标</div><div class="kpi-val">${Number((result.series as { kpi?: number })?.kpi || 0).toLocaleString()}</div></div>`
      return
    }
    previewChart = echarts.init(previewEl.value)
    const categories = (result.series?.categories as string[]) || []
    const seriesArr = (result.series?.series as Array<{ name: string; data: number[]; type?: string }>) || []
    previewChart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 16, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value' },
      series: seriesArr.map((s) => ({
        type: (s.type as 'bar' | 'line') || 'bar',
        name: s.name,
        data: s.data
      }))
    })
  } catch {
    previewEl.value.innerHTML = '<div class="pv-empty">预览加载失败</div>'
  }
}

function confirm() {
  const dash = currentDash.value
  if (!dash || !selected.value.size) return
  const charts = dash.charts.filter((c) => selected.value.has(c.id))
  emit(
    'confirm',
    charts.map((c) => ({
      id: `rc_${Date.now()}_${c.id}`,
      source: 'dashboard' as const,
      dashboardId: dash.id,
      chartId: c.id,
      view: 'draft' as const,
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
          <p>左侧选看板 → 中间勾选图表（可多选）→ 右侧预览 → 确认插入</p>
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
            图表 <span>{{ filteredCharts.length }}</span>
            <div class="acts">
              <button type="button" @click="selectAll">全选</button>
              <button type="button" @click="clearAll">清空</button>
            </div>
          </div>
          <input v-model="search" class="search" placeholder="搜索图表名称 / 类型…" />
          <div class="chart-list">
            <div
              v-for="c in filteredCharts"
              :key="c.id"
              class="chart-item"
              :class="{ on: selected.has(c.id), focus: focusId === c.id }"
              @click="toggleChart(c)"
              @dblclick="toggleSelect(c)"
            >
              <input
                type="checkbox"
                :checked="selected.has(c.id)"
                @click.stop
                @change="toggleChart(c, true)"
              />
              <span class="info">
                <div class="t">{{ c.title }}</div>
                <div class="m">{{ c.datasetId }}</div>
              </span>
              <span class="badge">{{ typeLabel(c.chartType) }}</span>
            </div>
            <div v-if="!filteredCharts.length" class="empty">无匹配图表</div>
          </div>
        </section>

        <aside class="pane preview-pane">
          <div class="col-hd">效果预览 <span class="tag">实时取数</span></div>
          <div class="pv-card">
            <div v-if="!focusId" class="pv-empty">在中间列表点选一张图表<br />右侧将显示实时预览</div>
            <template v-else>
              <div class="pv-title">{{ currentDash?.charts.find(c => c.id === focusId)?.title }}</div>
              <div ref="previewEl" class="pv-chart" />
            </template>
            <div class="pv-selected">已选 <b>{{ selected.size }}</b> 张 · 将按勾选顺序插入报告</div>
          </div>
        </aside>
      </div>

      <footer class="wizard-ft">
        <span class="hint">引用后取数实时；文档只存 dashboardId + chartId</span>
        <div class="ft-actions">
          <span>已选 {{ selected.size }}</span>
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
  width: min(960px, 96vw);
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
  grid-template-columns: 200px 1fr 280px;
  min-height: 380px;
  max-height: 52vh;
}
.pane {
  border-right: 1px solid #e8ecf0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.preview-pane {
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
  margin: 0.5rem 0.75rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 0.82rem;
}
.chart-list {
  flex: 1;
  overflow: auto;
  padding: 0 0.5rem 0.5rem;
}
.chart-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
}
.chart-item.on {
  background: #eef4ff;
}
.chart-item.focus {
  outline: 1px solid #3480f9;
}
.chart-item .info {
  flex: 1;
  min-width: 0;
}
.chart-item .t {
  font-weight: 500;
}
.chart-item .m {
  font-size: 0.72rem;
  color: #86909c;
}
.badge {
  font-size: 0.68rem;
  background: #f4f5f7;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  color: #5c6b7a;
}
.pv-card {
  padding: 0.75rem;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.pv-title {
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
}
.pv-chart {
  flex: 1;
  min-height: 200px;
}
.pv-empty {
  flex: 1;
  display: grid;
  place-items: center;
  text-align: center;
  color: #86909c;
  font-size: 0.82rem;
  min-height: 200px;
}
.pv-selected {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #86909c;
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
  padding: 2rem;
  text-align: center;
  color: #86909c;
  font-size: 0.82rem;
}
.tag {
  font-size: 0.68rem;
  background: #eef4ff;
  color: #3480f9;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
}
:deep(.kpi-preview) {
  height: 200px;
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
  font-size: 0.75rem;
  color: #86909c;
  margin-bottom: 0.5rem;
}
</style>

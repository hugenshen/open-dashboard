<script setup lang="ts">
/**
 * Dashboard editor shell.
 * Layout: left library / center grid / right properties / top publish actions.
 * Stores are split: meta / canvas / selection / filter / publish.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  useCanvasStore,
  useChartDataStore,
  useDashboardMetaStore,
  useFilterStateStore,
  usePublishStore,
  useSelectionStore
} from '../../stores/dashboardStores'
import type { DashboardComponentVO } from '../../types/dashboard'

const route = useRoute()
const router = useRouter()
const dashboardId = computed(() => String(route.query.id || ''))

const metaStore = useDashboardMetaStore()
const canvas = useCanvasStore()
const selection = useSelectionStore()
const filters = useFilterStateStore()
const publish = usePublishStore()
const chartData = useChartDataStore()

const saving = ref(false)
const message = ref('')

const selectedComponent = computed(() =>
  canvas.components.find(c => c.id === selection.selectedComponentId) || null
)

const selectedChart = computed(() => {
  const id = selection.selectedChartId
  return id ? canvas.charts[id] || null : null
})

onMounted(async () => {
  if (!dashboardId.value) return
  const detail = await canvas.load(dashboardId.value, 'draft')
  metaStore.setMeta(detail.meta)
  await publish.refresh(dashboardId.value)
  await refreshAllCharts()
})

watch(
  () => filters.context,
  () => {
    refreshAllCharts()
  },
  { deep: true }
)

async function refreshAllCharts() {
  for (const chart of Object.values(canvas.charts)) {
    if (!chart.datasetId) continue
    try {
      await chartData.queryChart(dashboardId.value, chart.id, 'draft', filters.context)
    } catch {
      /* errors stored in chartData.errors */
    }
  }
}

function onSelect(comp: DashboardComponentVO) {
  selection.selectComponent(comp.id, comp.chartViewId || null)
}

async function addChart() {
  const chartId = `chart_${Date.now()}`
  const compId = `comp_${Date.now()}`
  await canvas.saveChart(dashboardId.value, chartId, {
    datasetId: null,
    chartType: 'bar',
    title: '新图表',
    encode: { category: 'region', value: 'amount' }
  })
  await canvas.saveComponents(dashboardId.value, [
    {
      id: compId,
      type: 'chart',
      chartViewId: chartId,
      x: 0,
      y: 0,
      w: 24,
      h: 12,
      zIndex: canvas.components.length + 1,
      props: {}
    }
  ])
  selection.selectComponent(compId, chartId)
}

async function addFilter() {
  const compId = `comp_${Date.now()}`
  await canvas.saveComponents(dashboardId.value, [
    {
      id: compId,
      type: 'filter',
      x: 24,
      y: 0,
      w: 12,
      h: 4,
      zIndex: canvas.components.length + 1,
      props: { field: 'region', operator: 'eq' }
    }
  ])
  selection.selectComponent(compId, null)
}

async function bindDataset() {
  if (!selection.selectedChartId) return
  await canvas.saveChart(dashboardId.value, selection.selectedChartId, {
    datasetId: 'ds_sales',
    chartType: selectedChart.value?.chartType || 'bar',
    title: selectedChart.value?.title || '图表',
    encode: selectedChart.value?.encode || { category: 'region', value: 'amount' }
  })
  await refreshAllCharts()
}

async function onFilterChange(compId: string, field: string, value: string) {
  filters.setFilter({
    componentId: compId,
    field,
    operator: 'eq',
    value
  })
}

async function onChartClick(sourceChartId: string, field: string, value: unknown) {
  for (const link of canvas.linkages) {
    if (link.enabled && link.sourceChartId === sourceChartId && link.sourceField === field) {
      filters.setLinkageHit({
        sourceChartId,
        sourceField: field,
        value,
        targetChartId: link.targetChartId,
        targetField: link.targetField
      })
    }
  }
}

async function doPublish() {
  saving.value = true
  try {
    await publish.publish(dashboardId.value)
    message.value = '已发布'
  } finally {
    saving.value = false
  }
}

async function doDiscard() {
  await publish.discardDraft(dashboardId.value)
  await canvas.load(dashboardId.value, 'draft')
  message.value = '已丢弃草稿'
}

function goPreview() {
  router.push({ path: '/dashboard/preview', query: { id: dashboardId.value } })
}

function goList() {
  router.push({ path: '/dashboard' })
}
</script>

<template>
  <div class="dashboard-editor">
    <header class="toolbar">
      <button @click="goList">返回</button>
      <strong>{{ metaStore.meta?.name || '仪表盘' }}</strong>
      <span class="status">{{ publish.status }}</span>
      <div class="spacer" />
      <button @click="goPreview">预览</button>
      <button :disabled="saving" @click="doPublish">发布</button>
      <button
        v-if="publish.status === 'publishedWithDraft'"
        @click="doDiscard"
      >
        丢弃草稿
      </button>
      <span v-if="message" class="msg">{{ message }}</span>
    </header>

    <div class="body">
      <aside class="left">
        <h3>组件</h3>
        <button @click="addChart">图表</button>
        <button @click="addFilter">筛选器</button>
        <h3>图层</h3>
        <ul>
          <li
            v-for="c in canvas.components"
            :key="c.id"
            :class="{ active: selection.selectedComponentId === c.id }"
            @click="onSelect(c)"
          >
            {{ c.type }} · {{ c.id }}
          </li>
        </ul>
      </aside>

      <main class="canvas">
        <div
          v-for="c in canvas.components"
          :key="c.id"
          class="widget"
          :class="{ selected: selection.selectedComponentId === c.id }"
          :style="{
            gridColumn: `${c.x + 1} / span ${c.w}`,
            gridRow: `${c.y + 1} / span ${c.h}`
          }"
          @click="onSelect(c)"
        >
          <template v-if="c.type === 'filter'">
            <label>{{ c.props?.field }}</label>
            <select @change="onFilterChange(c.id, String(c.props?.field), ($event.target as HTMLSelectElement).value)">
              <option value="">全部</option>
              <option value="华东">华东</option>
              <option value="华北">华北</option>
              <option value="华南">华南</option>
            </select>
          </template>
          <template v-else-if="c.type === 'chart' && c.chartViewId">
            <div class="chart-title">{{ canvas.charts[c.chartViewId]?.title }}</div>
            <pre
              class="chart-data"
              @click.stop="onChartClick(c.chartViewId!, 'region', chartData.results[c.chartViewId!]?.data?.[0]?.[0])"
            >{{ chartData.results[c.chartViewId] || chartData.errors[c.chartViewId] || '无数据' }}</pre>
          </template>
          <template v-else>
            <div>{{ c.type }}</div>
            <div class="muted">{{ c.props?.content }}</div>
          </template>
        </div>
      </main>

      <aside class="right">
        <h3>属性</h3>
        <template v-if="selectedComponent">
          <p>类型：{{ selectedComponent.type }}</p>
          <p>位置：{{ selectedComponent.x }},{{ selectedComponent.y }} · {{ selectedComponent.w }}×{{ selectedComponent.h }}</p>
          <template v-if="selectedChart">
            <p>图表：{{ selectedChart.title }}</p>
            <p>数据集：{{ selectedChart.datasetId || '未绑定' }}</p>
            <button @click="bindDataset">绑定示例数据集 ds_sales</button>
          </template>
        </template>
        <p v-else class="muted">选中画布组件以编辑</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.dashboard-editor {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e5e5;
}
.spacer {
  flex: 1;
}
.status {
  color: #666;
  font-size: 12px;
}
.msg {
  color: #0a7;
}
.body {
  display: grid;
  grid-template-columns: 200px 1fr 260px;
  flex: 1;
  min-height: 0;
}
.left,
.right {
  border-right: 1px solid #e5e5e5;
  padding: 12px;
  overflow: auto;
}
.right {
  border-right: none;
  border-left: 1px solid #e5e5e5;
}
.canvas {
  display: grid;
  grid-template-columns: repeat(72, 1fr);
  grid-auto-rows: 8px;
  gap: 2px;
  padding: 12px;
  background: #f7f8fa;
  overflow: auto;
}
.widget {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px;
  overflow: hidden;
}
.widget.selected {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px #3b82f6;
}
.chart-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.chart-data {
  font-size: 11px;
  margin: 0;
  max-height: 120px;
  overflow: auto;
}
.muted {
  color: #888;
}
.left ul {
  list-style: none;
  padding: 0;
}
.left li {
  padding: 4px;
  cursor: pointer;
}
.left li.active {
  background: #f0f4ff;
}
</style>

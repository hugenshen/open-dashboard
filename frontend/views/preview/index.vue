<script setup lang="ts">
/**
 * Read-only preview — always loads published copy + chartQuery view=published.
 */
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  useCanvasStore,
  useChartDataStore,
  useFilterStateStore,
  usePublishStore
} from '../../stores/dashboardStores'

const route = useRoute()
const router = useRouter()
const dashboardId = computed(() => String(route.query.id || ''))

const canvas = useCanvasStore()
const publish = usePublishStore()
const filters = useFilterStateStore()
const chartData = useChartDataStore()

onMounted(async () => {
  if (!dashboardId.value) return
  await publish.refresh(dashboardId.value)
  if (!publish.canPreviewPublished) {
    return
  }
  await canvas.load(dashboardId.value, 'published')
  for (const chart of Object.values(canvas.charts)) {
    if (!chart.datasetId) continue
    await chartData.queryChart(dashboardId.value, chart.id, 'published', filters.context)
  }
})

function back() {
  router.push({ path: '/dashboard/editor', query: { id: dashboardId.value } })
}
</script>

<template>
  <div class="dashboard-preview">
    <header class="toolbar">
      <button @click="back">返回编辑</button>
      <strong>预览（已发布）</strong>
      <span class="status">{{ publish.status }}</span>
    </header>
    <p v-if="!publish.canPreviewPublished" class="warn">尚未发布，无可预览内容</p>
    <main v-else class="canvas">
      <div
        v-for="c in canvas.components"
        :key="c.id"
        class="widget"
        :style="{
          gridColumn: `${c.x + 1} / span ${c.w}`,
          gridRow: `${c.y + 1} / span ${c.h}`
        }"
      >
        <template v-if="c.type === 'chart' && c.chartViewId">
          <div class="chart-title">{{ canvas.charts[c.chartViewId]?.title }}</div>
          <pre class="chart-data">{{ chartData.results[c.chartViewId] || '加载中…' }}</pre>
        </template>
        <template v-else-if="c.type === 'text'">
          <div>{{ c.props?.content }}</div>
        </template>
        <template v-else>
          <div>{{ c.type }}</div>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.dashboard-preview {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e5e5;
}
.status {
  color: #666;
  font-size: 12px;
}
.warn {
  padding: 24px;
  color: #b45309;
}
.canvas {
  display: grid;
  grid-template-columns: repeat(72, 1fr);
  grid-auto-rows: 8px;
  gap: 2px;
  padding: 12px;
  background: #f7f8fa;
  flex: 1;
}
.widget {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px;
}
.chart-title {
  font-weight: 600;
}
.chart-data {
  font-size: 11px;
  margin: 0;
}
</style>

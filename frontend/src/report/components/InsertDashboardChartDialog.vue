<script setup lang="ts">
import { ref } from 'vue'
import type { ReportChartAttrs } from '../types'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  confirm: [attrs: ReportChartAttrs]
}>()

/** Scaffold catalog — later from dashboard APIs */
const dashboards = [
  {
    id: '1',
    name: '销售周报（脚手架）',
    charts: [
      { id: 'c_bar', title: '区域销售额', chartType: 'bar' },
      { id: 'c_kpi', title: '总金额 KPI', chartType: 'kpi' }
    ]
  }
]

const dashboardId = ref('1')
const chartId = ref('c_bar')

const charts = () => dashboards.find((d) => d.id === dashboardId.value)?.charts || []

function confirm() {
  const dash = dashboards.find((d) => d.id === dashboardId.value)
  const chart = charts().find((c) => c.id === chartId.value)
  emit('confirm', {
    id: `rc_${Date.now()}`,
    source: 'dashboard',
    dashboardId: dashboardId.value,
    chartId: chartId.value,
    view: 'published',
    title: chart?.title || '',
    height: 320,
    width: 'full'
  })
  open.value = false
}
</script>

<template>
  <div v-if="open" class="mask" @click.self="open = false">
    <div class="dialog">
      <h3>引用仪表盘图表</h3>
      <label>
        仪表盘
        <select v-model="dashboardId">
          <option v-for="d in dashboards" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </label>
      <label>
        图表
        <select v-model="chartId">
          <option v-for="c in charts()" :key="c.id" :value="c.id">{{ c.title }} ({{ c.chartType }})</option>
        </select>
      </label>
      <p class="hint">插入后实时走 chartQuery；文档只存 dashboardId + chartId。</p>
      <div class="actions">
        <button type="button" @click="open = false">取消</button>
        <button type="button" class="primary" @click="confirm">插入</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 30, 45, 0.35);
  display: grid;
  place-items: center;
  z-index: 1000;
}
.dialog {
  width: min(420px, 92vw);
  background: #fff;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  display: grid;
  gap: 0.75rem;
}
label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.9rem;
}
select {
  padding: 0.4rem 0.5rem;
}
.hint {
  margin: 0;
  color: #5c6b7a;
  font-size: 0.8rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.primary {
  background: #1f6feb;
  color: #fff;
  border: 0;
  border-radius: 6px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
}
</style>

<script setup lang="ts">
import { ref } from 'vue'
import type { ReportChartAttrs } from '../types'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  confirm: [attrs: ReportChartAttrs]
}>()

const datasets = [
  { id: 'ds_sales', name: '销售明细（脚手架）' },
  { id: 'ds_ops', name: '运营指标（脚手架）' }
]
const chartTypes = ['bar', 'line', 'pie', 'kpi', 'table']

const datasetId = ref('ds_sales')
const chartType = ref('bar')
const category = ref('region')
const value = ref('amount')
const title = ref('')

function confirm() {
  emit('confirm', {
    id: `rc_${Date.now()}`,
    source: 'inline',
    datasetId: datasetId.value,
    chartType: chartType.value,
    encode: {
      category: category.value,
      value: value.value,
      agg: 'SUM'
    },
    style: {},
    senior: {},
    title: title.value || `${chartType.value} · ${datasetId.value}`,
    height: 320,
    width: 'full'
  })
  open.value = false
}
</script>

<template>
  <div v-if="open" class="mask" @click.self="open = false">
    <div class="dialog">
      <h3>新建图表（仅报告）</h3>
      <label>
        数据集
        <select v-model="datasetId">
          <option v-for="d in datasets" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </label>
      <label>
        图表类型
        <select v-model="chartType">
          <option v-for="t in chartTypes" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <label>
        维度字段
        <input v-model="category" />
      </label>
      <label>
        指标字段
        <input v-model="value" />
      </label>
      <label>
        标题（可选）
        <input v-model="title" placeholder="留空则自动生成" />
      </label>
      <p class="hint">配置只存在于报告节点（source=inline），不会写入仪表盘。</p>
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
  width: min(440px, 92vw);
  background: #fff;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  display: grid;
  gap: 0.65rem;
}
label {
  display: grid;
  gap: 0.3rem;
  font-size: 0.9rem;
}
input,
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

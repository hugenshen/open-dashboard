<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { catalogApi, type DatasetCatalogItem, type DatasetFieldItem } from '../api/catalog'
import { chartQueryApi } from '../../api/dashboard'
import type { ReportChartAttrs } from '../types'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  confirm: [attrs: ReportChartAttrs]
}>()

const CHART_TYPES = [
  { id: 'bar', label: '柱状图' },
  { id: 'line', label: '折线图' },
  { id: 'pie', label: '饼图' },
  { id: 'kpi', label: 'KPI' }
]

const datasets = ref<DatasetCatalogItem[]>([])
const datasetId = ref('')
const chartType = ref('bar')
const category = ref('')
const value = ref('')
const agg = ref('SUM')
const title = ref('')
const height = ref(320)
const formError = ref('')
const previewEl = ref<HTMLDivElement | null>(null)
let previewChart: echarts.ECharts | null = null

const currentDs = computed(() => datasets.value.find((d) => d.id === datasetId.value))
const dimFields = computed(() => (currentDs.value?.fields || []).filter((f) => f.group === 'dim'))
const quotaFields = computed(() => (currentDs.value?.fields || []).filter((f) => f.group === 'quota'))

const previewTitle = computed(() => {
  if (title.value.trim()) return title.value.trim()
  const ds = currentDs.value?.name || datasetId.value
  const ct = CHART_TYPES.find((t) => t.id === chartType.value)?.label || chartType.value
  return `${ct} · ${ds}`
})

watch(open, async (v) => {
  if (!v) {
    previewChart?.dispose()
    previewChart = null
    return
  }
  const cat = await catalogApi.get()
  datasets.value = cat.datasets
  datasetId.value = cat.datasets[0]?.id || ''
  chartType.value = 'bar'
  category.value = dimFields.value[0]?.name || ''
  value.value = quotaFields.value[0]?.name || ''
  title.value = ''
  refreshPreview()
})

watch(datasetId, () => {
  if (!open.value) return
  category.value = dimFields.value[0]?.name || ''
  value.value = quotaFields.value[0]?.name || ''
})

watch([datasetId, chartType, category, value, agg, title], () => {
  if (open.value) refreshPreview()
})

function fillSlot(field: DatasetFieldItem, slot: 'category' | 'value') {
  if (slot === 'category') category.value = field.name
  else value.value = field.name
  refreshPreview()
}

async function refreshPreview() {
  if (!previewEl.value) return
  previewChart?.dispose()
  previewChart = null
  try {
    const result = await chartQueryApi.query({
      client: 'report',
      inline: {
        datasetId: datasetId.value,
        chartType: chartType.value,
        encode: { category: category.value, value: value.value, agg: agg.value }
      },
      context: { filters: [], linkages: [] }
    })
    if (chartType.value === 'kpi') {
      previewEl.value.innerHTML = `<div class="kpi-preview"><div class="kpi-label">${value.value}</div><div class="kpi-val">${Number((result.series as { kpi?: number })?.kpi || 0).toLocaleString()}</div></div>`
      return
    }
    previewChart = echarts.init(previewEl.value)
    const categories = (result.series?.categories as string[]) || []
    const seriesArr = (result.series?.series as Array<{ name: string; data: number[]; type?: string }>) || []
    const opt =
      chartType.value === 'pie'
        ? {
            tooltip: { trigger: 'item' },
            series: [
              {
                type: 'pie',
                radius: '60%',
                data: categories.map((name, i) => ({
                  name,
                  value: seriesArr[0]?.data[i] || 0
                }))
              }
            ]
          }
        : {
            tooltip: { trigger: 'axis' },
            grid: { left: 40, right: 16, top: 28, bottom: 28 },
            xAxis: { type: 'category', data: categories },
            yAxis: { type: 'value' },
            series: seriesArr.map((s) => ({
              type: chartType.value === 'line' ? 'line' : 'bar',
              name: s.name,
              data: s.data
            }))
          }
    previewChart.setOption(opt)
  } catch {
    previewEl.value.innerHTML = '<div class="pv-empty">预览加载失败</div>'
  }
}

function confirm() {
  formError.value = ''
  if (!datasetId.value) {
    formError.value = '请选择数据集'
    return
  }
  if (chartType.value !== 'table' && !value.value) {
    formError.value = '请选择指标字段'
    return
  }
  emit('confirm', {
    id: `rc_${Date.now()}`,
    source: 'inline',
    datasetId: datasetId.value,
    chartType: chartType.value,
    encode: {
      category: category.value,
      value: value.value,
      agg: agg.value,
      format: 'raw'
    },
    style: {},
    senior: {},
    title: previewTitle.value,
    height: height.value,
    width: 'full'
  })
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
          <h3>新建图表（仅报告）</h3>
          <p>配置只存在于本报告，不会写回仪表盘。左侧实时预览，确认后再插入。</p>
        </div>
        <button type="button" class="btn ghost" @click="close">关闭</button>
      </header>

      <div class="wizard-body">
        <div class="preview-col">
          <div class="col-hd">效果预览 <span class="tag">实时聚合</span></div>
          <div class="pv-card">
            <div class="pv-title">{{ previewTitle }}</div>
            <div ref="previewEl" class="pv-chart" />
          </div>
        </div>

        <div class="form-col">
          <section>
            <div class="sec-t">基础</div>
            <div class="row2">
              <label class="f">
                标题
                <input v-model="title" placeholder="留空则自动生成" />
              </label>
              <label class="f">
                图表类型
                <select v-model="chartType">
                  <option v-for="t in CHART_TYPES" :key="t.id" :value="t.id">{{ t.label }}</option>
                </select>
              </label>
            </div>
            <label class="f">
              高度 (px)
              <input v-model.number="height" type="number" min="160" max="800" />
            </label>
          </section>

          <section>
            <div class="sec-t">1. 数据集</div>
            <label class="f">
              选择数据集
              <select v-model="datasetId">
                <option v-for="d in datasets" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>
            </label>
          </section>

          <section>
            <div class="sec-t">2. 字段银行（点击填入槽位）</div>
            <div class="chips">
              <span class="chip-label">维度</span>
              <button
                v-for="f in dimFields"
                :key="'d-' + f.name"
                type="button"
                class="chip dim"
                @click="fillSlot(f, 'category')"
              >
                {{ f.label || f.name }}
              </button>
              <span class="chip-label">指标</span>
              <button
                v-for="f in quotaFields"
                :key="'q-' + f.name"
                type="button"
                class="chip quota"
                @click="fillSlot(f, 'value')"
              >
                {{ f.label || f.name }}
              </button>
            </div>
          </section>

          <section>
            <div class="sec-t">3. 编码槽</div>
            <div class="row2">
              <label v-if="chartType !== 'kpi'" class="f">
                维度
                <select v-model="category">
                  <option v-for="f in dimFields" :key="f.name" :value="f.name">
                    {{ f.label || f.name }}
                  </option>
                </select>
              </label>
              <label class="f">
                指标
                <select v-model="value">
                  <option v-for="f in quotaFields" :key="f.name" :value="f.name">
                    {{ f.label || f.name }}
                  </option>
                </select>
              </label>
              <label class="f">
                聚合
                <select v-model="agg">
                  <option value="SUM">SUM</option>
                  <option value="AVG">AVG</option>
                  <option value="COUNT">COUNT</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      </div>

      <footer class="wizard-ft">
        <span class="hint" :class="{ err: !!formError }">{{ formError || 'source=inline · 不写回仪表盘' }}</span>
        <div class="ft-actions">
          <button type="button" class="btn" @click="close">取消</button>
          <button type="button" class="btn primary" @click="confirm">确认插入</button>
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
  width: min(880px, 96vw);
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
.wizard-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 400px;
  max-height: 55vh;
  overflow: hidden;
}
.preview-col {
  border-right: 1px solid #e8ecf0;
  display: flex;
  flex-direction: column;
}
.form-col {
  overflow: auto;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.col-hd {
  padding: 0.6rem 0.75rem;
  font-size: 0.82rem;
  font-weight: 600;
  border-bottom: 1px solid #eef1f5;
}
.tag {
  font-size: 0.68rem;
  background: #eef4ff;
  color: #3480f9;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  margin-left: 0.35rem;
}
.pv-card {
  flex: 1;
  padding: 0.75rem;
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
  min-height: 260px;
}
.sec-t {
  font-size: 0.78rem;
  font-weight: 600;
  color: #86909c;
  margin-bottom: 0.4rem;
}
.f {
  display: grid;
  gap: 0.25rem;
  font-size: 0.82rem;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
input,
select {
  padding: 0.35rem 0.5rem;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 0.82rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}
.chip-label {
  font-size: 0.72rem;
  color: #86909c;
  width: 100%;
  margin-top: 0.25rem;
}
.chip {
  border: 1px solid #d8dee6;
  background: #f8f9fb;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  cursor: pointer;
}
.chip.dim {
  border-color: #b3d4ff;
  color: #3480f9;
}
.chip.quota {
  border-color: #ffd6a5;
  color: #d46b08;
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
.hint.err {
  color: #b42318;
}
.ft-actions {
  display: flex;
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
.btn.ghost {
  border: 0;
  background: transparent;
}
:deep(.kpi-preview) {
  height: 260px;
  display: grid;
  place-items: center;
  text-align: center;
}
:deep(.kpi-val) {
  font-size: 2.2rem;
  font-weight: 700;
  color: #3480f9;
}
:deep(.kpi-label) {
  font-size: 0.75rem;
  color: #86909c;
  margin-bottom: 0.5rem;
}
:deep(.pv-empty) {
  height: 260px;
  display: grid;
  place-items: center;
  color: #86909c;
  font-size: 0.82rem;
}
</style>

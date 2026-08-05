<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { catalogApi, type CatalogBundle, type DashboardCatalogItem } from '../api/catalog'
import { useReportEditorStore } from '../stores/reportEditor'
import type { ReportChartAttrs } from '../types'

const props = defineProps<{
  chart: ReportChartAttrs | null
}>()

const store = useReportEditorStore()
const catalog = ref<CatalogBundle | null>(null)

onMounted(async () => {
  catalog.value = await catalogApi.get()
})

const dashList = computed(() => catalog.value?.dashboards || [])
const datasets = computed(() => catalog.value?.datasets || [])

const currentDash = computed(() =>
  dashList.value.find((d) => d.id === props.chart?.dashboardId)
)

const dashCharts = computed(() => currentDash.value?.charts || [])

const dimFields = computed(() => {
  const ds = datasets.value.find((d) => d.id === props.chart?.datasetId)
  return (ds?.fields || []).filter((f) => f.group === 'dim')
})

const quotaFields = computed(() => {
  const ds = datasets.value.find((d) => d.id === props.chart?.datasetId)
  return (ds?.fields || []).filter((f) => f.group === 'quota')
})

const encode = computed(() => (props.chart?.encode || {}) as Record<string, string>)

function patch(p: Partial<ReportChartAttrs>) {
  if (!props.chart?.id) return
  store.patchChart(props.chart.id, p)
}

function patchEncode(key: string, value: string) {
  if (!props.chart?.id) return
  store.patchChart(props.chart.id, {
    encode: { ...encode.value, [key]: value }
  })
}

function onDashChange(dashId: string) {
  const dash = dashList.value.find((d: DashboardCatalogItem) => d.id === dashId)
  const first = dash?.charts[0]
  if (!first || !props.chart?.id) return
  store.patchChart(props.chart.id, {
    dashboardId: dashId,
    chartId: first.id,
    title: `${first.title}（引用）`
  })
}

function onChartChange(chartId: string) {
  const c = dashCharts.value.find((x) => x.id === chartId)
  if (!c || !props.chart?.id) return
  store.patchChart(props.chart.id, {
    chartId: c.id,
    title: `${c.title}（引用）`
  })
}

function fillSlot(field: string, slot: 'category' | 'value') {
  patchEncode(slot, field)
}

function onSourceChange(mode: string) {
  if (!props.chart?.id) return
  if (mode === 'inline' && props.chart.source === 'dashboard') {
    const c = dashCharts.value.find((x) => x.id === props.chart?.chartId)
    const dsId = c?.datasetId || datasets.value[0]?.id || 'ds_sales'
    store.patchChart(props.chart.id, {
      source: 'inline',
      datasetId: dsId,
      chartType: c?.chartType || 'bar',
      encode: { category: 'region', value: 'amount', agg: 'SUM', format: 'raw' },
      dashboardId: null,
      chartId: null,
      title: props.chart.title?.replace(/（引用）$/, '') || c?.title || '图表'
    })
    return
  }
  if (mode === 'dashboard' && props.chart.source === 'inline') {
    const dash = dashList.value[0]
    const first = dash?.charts[0]
    if (!dash || !first) return
    store.patchChart(props.chart.id, {
      source: 'dashboard',
      dashboardId: dash.id,
      chartId: first.id,
      view: 'draft',
      title: `${first.title}（引用）`,
      datasetId: null,
      chartType: undefined,
      encode: {}
    })
  }
}

watch(
  () => props.chart?.id,
  () => {
    if (props.chart) store.inspTab = store.inspTab || 'data'
  }
)
</script>

<template>
  <aside v-show="!!chart && !store.inspectorCollapsed" class="rpt-insp">
    <header class="insp-hd">
      <span>图表配置</span>
      <button type="button" class="ghost" @click="store.inspectorCollapsed = true">收起</button>
    </header>
    <nav class="insp-tabs">
      <button type="button" :class="{ on: store.inspTab === 'data' }" @click="store.inspTab = 'data'">
        数据
      </button>
      <button
        type="button"
        :class="{ on: store.inspTab === 'style' }"
        @click="store.inspTab = 'style'"
      >
        样式
      </button>
      <button
        type="button"
        :class="{ on: store.inspTab === 'senior' }"
        @click="store.inspTab = 'senior'"
      >
        高级
      </button>
    </nav>

    <div v-if="!chart" class="insp-empty">
      点选报告中的图表进行配置<br />数据 / 样式 / 高级与仪表盘编辑器一致
    </div>

    <div v-else class="insp-body">
      <template v-if="store.inspTab === 'data'">
        <section class="sec">
          <h4>来源</h4>
          <label class="fld">
            模式
            <select
              class="inp"
              :value="chart.source"
              @change="onSourceChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="dashboard">引用看板图</option>
              <option value="inline">报告内配置</option>
            </select>
          </label>
          <p class="hint">
            {{
              chart.source === 'dashboard'
                ? '引用模式：encode 以看板为准；可更换看板/图表。'
                : '报告内配置（source=inline），不写回仪表盘。'
            }}
          </p>
        </section>

        <template v-if="chart.source === 'dashboard'">
          <section class="sec">
            <h4>1. 仪表盘</h4>
            <select
              class="inp"
              :value="chart.dashboardId || ''"
              @change="onDashChange(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="d in dashList" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </section>
          <section class="sec">
            <h4>2. 图表</h4>
            <select
              class="inp"
              :value="chart.chartId || ''"
              @change="onChartChange(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="c in dashCharts" :key="c.id" :value="c.id">
                {{ c.title }} ({{ c.chartType }})
              </option>
            </select>
          </section>
          <section class="sec">
            <h4>显示</h4>
            <label class="fld">
              标题
              <input
                class="inp"
                :value="chart.title || ''"
                @change="patch({ title: ($event.target as HTMLInputElement).value })"
              />
            </label>
          </section>
          <section class="sec">
            <h4>编码（只读）</h4>
            <p class="hint">跟随仪表盘原图 · 实时 chartQuery</p>
          </section>
        </template>

        <template v-else>
          <section class="sec">
            <h4>1. 数据集</h4>
            <select
              class="inp"
              :value="chart.datasetId || ''"
              @change="patch({ datasetId: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="d in datasets" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </section>
          <section class="sec">
            <h4>2. 字段银行</h4>
            <div class="chips">
              <span class="chip-label">维度</span>
              <button
                v-for="f in dimFields"
                :key="'d-' + f.name"
                type="button"
                class="chip dim"
                @click="fillSlot(f.name, 'category')"
              >
                {{ f.label || f.name }}
              </button>
              <span class="chip-label">指标</span>
              <button
                v-for="f in quotaFields"
                :key="'q-' + f.name"
                type="button"
                class="chip quota"
                @click="fillSlot(f.name, 'value')"
              >
                {{ f.label || f.name }}
              </button>
            </div>
          </section>
          <section class="sec">
            <h4>3. 编码槽</h4>
            <label class="fld">
              图表类型
              <select
                class="inp"
                :value="chart.chartType || 'bar'"
                @change="patch({ chartType: ($event.target as HTMLSelectElement).value })"
              >
                <option value="bar">柱状图</option>
                <option value="line">折线图</option>
                <option value="pie">饼图</option>
                <option value="kpi">KPI</option>
              </select>
            </label>
            <label v-if="chart.chartType !== 'kpi'" class="fld">
              维度
              <select
                class="inp"
                :value="encode.category || ''"
                @change="patchEncode('category', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="f in dimFields" :key="f.name" :value="f.name">
                  {{ f.label || f.name }}
                </option>
              </select>
            </label>
            <label class="fld">
              指标
              <select
                class="inp"
                :value="encode.value || ''"
                @change="patchEncode('value', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="f in quotaFields" :key="f.name" :value="f.name">
                  {{ f.label || f.name }}
                </option>
              </select>
            </label>
            <label class="fld">
              聚合
              <select
                class="inp"
                :value="encode.agg || 'SUM'"
                @change="patchEncode('agg', ($event.target as HTMLSelectElement).value)"
              >
                <option value="SUM">SUM</option>
                <option value="AVG">AVG</option>
                <option value="COUNT">COUNT</option>
                <option value="MAX">MAX</option>
                <option value="MIN">MIN</option>
              </select>
            </label>
            <label class="fld">
              数值格式
              <select
                class="inp"
                :value="encode.format || 'raw'"
                @change="patchEncode('format', ($event.target as HTMLSelectElement).value)"
              >
                <option value="raw">智能（默认）</option>
                <option value="integer">整数</option>
                <option value="thousand">千分位</option>
                <option value="fixed1">一位小数</option>
                <option value="fixed2">两位小数</option>
                <option value="percent">百分比</option>
              </select>
            </label>
          </section>
        </template>
      </template>

      <template v-else-if="store.inspTab === 'style'">
        <section class="sec">
          <label class="fld">
            标题
            <input
              class="inp"
              :value="chart.title || ''"
              @change="patch({ title: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="fld">
            高度 (px)
            <input
              class="inp"
              type="number"
              min="160"
              max="560"
              :value="chart.height || 320"
              @change="patch({ height: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
        </section>
      </template>

      <template v-else>
        <section class="sec">
          <h4>来源摘要</h4>
          <dl class="meta">
            <dt>source</dt>
            <dd>{{ chart.source }}</dd>
            <template v-if="chart.source === 'dashboard'">
              <dt>dashboardId</dt>
              <dd>{{ chart.dashboardId }}</dd>
              <dt>chartId</dt>
              <dd>{{ chart.chartId }}</dd>
            </template>
            <template v-else>
              <dt>datasetId</dt>
              <dd>{{ chart.datasetId }}</dd>
              <dt>chartType</dt>
              <dd>{{ chart.chartType }}</dd>
            </template>
          </dl>
        </section>
        <section class="sec acts">
          <button type="button" class="btn" @click="store.refreshChart(chart.id!)">刷新取数</button>
          <button type="button" class="btn danger" @click="store.deleteChart(chart.id!)">
            删除图表块
          </button>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.rpt-insp {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rpt-insp.collapsed {
  width: 0;
  border: 0;
  overflow: hidden;
}
.insp-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid #eef1f5;
  font-size: 0.82rem;
  font-weight: 600;
}
.insp-tabs {
  display: flex;
  border-bottom: 1px solid #eef1f5;
}
.insp-tabs button {
  flex: 1;
  border: 0;
  background: transparent;
  padding: 0.45rem 0;
  font-size: 0.78rem;
  cursor: pointer;
  color: #86909c;
}
.insp-tabs button.on {
  color: #3480f9;
  box-shadow: inset 0 -2px 0 #3480f9;
}
.insp-empty {
  padding: 2rem 1rem;
  text-align: center;
  color: #86909c;
  font-size: 0.78rem;
  line-height: 1.7;
}
.insp-body {
  flex: 1;
  overflow: auto;
}
.sec {
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid #f4f5f7;
}
.sec h4 {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  color: #86909c;
  font-weight: 600;
}
.hint {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  color: #86909c;
  line-height: 1.5;
}
.fld {
  display: grid;
  gap: 0.25rem;
  font-size: 0.78rem;
  margin-bottom: 0.5rem;
}
.inp {
  width: 100%;
  padding: 0.35rem 0.45rem;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 0.78rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.chip-label {
  width: 100%;
  font-size: 0.68rem;
  color: #86909c;
}
.chip {
  border: 1px solid #d8dee6;
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  font-size: 0.72rem;
  cursor: pointer;
  background: #f8f9fb;
}
.chip.dim {
  border-color: #b3d4ff;
  color: #3480f9;
}
.chip.quota {
  border-color: #ffd6a5;
  color: #d46b08;
}
.meta {
  margin: 0;
  font-size: 0.75rem;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 0.5rem;
}
.meta dt {
  color: #86909c;
}
.meta dd {
  margin: 0;
  word-break: break-all;
}
.acts {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.btn {
  border: 1px solid #d8dee6;
  background: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  font-size: 0.78rem;
  cursor: pointer;
}
.btn.danger {
  color: #b42318;
  border-color: #f5c2c0;
}
.ghost {
  border: 0;
  background: transparent;
  color: #3480f9;
  cursor: pointer;
  font-size: 0.75rem;
}
</style>

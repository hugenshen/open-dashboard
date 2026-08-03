<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { chartQueryApi, dashboardApi } from '../../api/dashboard'
import type { ChartQueryResult, DashboardDetailVO } from '../../types/dashboard'

const route = useRoute()
const id = computed(() => String(route.params.id || '1'))

type Surface = 'pc' | 'mobile'
const surface = ref<Surface>('pc')
const detail = ref<DashboardDetailVO | null>(null)
const queryResult = ref<ChartQueryResult | null>(null)
const message = ref('')

onMounted(async () => {
  try {
    detail.value = await dashboardApi.get(id.value, 'draft')
    queryResult.value = await chartQueryApi.query({
      chartId: 'stub-chart',
      dashboardId: id.value,
      view: 'draft',
      context: { filters: [], linkages: [] }
    })
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
})
</script>

<template>
  <div>
    <div class="editor-toolbar">
      <div>
        <strong>编辑器 · {{ detail?.meta.name || id }}</strong>
        <span class="muted" style="margin-left: 0.5rem">contentId={{ detail?.meta.contentId }}</span>
      </div>
      <div class="seg">
        <button type="button" :class="{ active: surface === 'pc' }" @click="surface = 'pc'">PC</button>
        <button type="button" :class="{ active: surface === 'mobile' }" @click="surface = 'mobile'">
          移动
        </button>
      </div>
    </div>

    <p v-if="message" class="muted" style="color: #b42318">{{ message }}</p>

    <div class="editor-shell">
      <section>
        <h3>组件库</h3>
        <p class="muted" style="font-size: 0.85rem">
          占位：图表 / 筛选 / 文本。移动态将显示 PC 组件池勾选上板（见高保）。
        </p>
        <ul>
          <li>柱状图</li>
          <li>KPI</li>
          <li>表格</li>
        </ul>
      </section>

      <section>
        <h3>{{ surface === 'pc' ? 'PC 画布' : '移动画布' }}</h3>
        <div v-if="surface === 'pc'" class="canvas-stage">
          网格画布占位（72 列）· 组件拖放后续从高保迁入
        </div>
        <div v-else class="canvas-stage">
          <div class="phone-frame">
            6 列独立布局 · styleSync<br />
            device={{ detail?.layout.mobile?.device || 'iphone-14' }}
          </div>
        </div>
        <p v-if="queryResult" class="muted" style="margin-top: 0.75rem; font-size: 0.85rem">
          chartQuery stub rows: {{ queryResult.data.length }} · series keys:
          {{ Object.keys(queryResult.series || {}).join(', ') || '—' }}
        </p>
      </section>

      <section>
        <h3>属性</h3>
        <p class="muted" style="font-size: 0.85rem">Encode / Style / Advanced 占位</p>
        <pre style="font-size: 0.75rem; overflow: auto">{{
          JSON.stringify(detail?.layout.mobile || { enabled: false }, null, 2)
        }}</pre>
      </section>
    </div>
  </div>
</template>

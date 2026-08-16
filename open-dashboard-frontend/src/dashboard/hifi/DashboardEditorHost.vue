<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dashboardApi, dashboardTreeApi, chartQueryApi } from '../../api/dashboard'
import { datasetApi } from '../../dataset/api'
import {
  datasetsToHiFi,
  detailToHiFi,
  hiFiToSavePayload,
  hydrateHiFiDatasetRows,
  type HiFiDash
} from './adapter'
import ModuleTopbar from '../../shell/ModuleTopbar.vue'
import EditorOnboarding from './EditorOnboarding.vue'
import ConversationAiPanel from '../../conversation/components/ConversationAiPanel.vue'
import './editor.css'

const props = defineProps<{
  mode?: 'editor' | 'preview'
}>()

const route = useRoute()
const router = useRouter()
const error = ref('')
const loading = ref(true)
const saving = ref(false)
const guideReady = ref(false)
const forceGuide = computed(() => route.query.guide === '1')
const selectedChartId = ref<string | undefined>()
const selectedEncode = ref<Record<string, unknown> | undefined>()

let runtime: {
  getDash: () => HiFiDash
  setDash: (d: HiFiDash) => void
  destroy: () => void
  rerender: () => void
} | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let knownCompIds = new Set<string>()
let knownChartIds = new Set<string>()

const dashId = () => String(route.params.id || '')

async function loadHiFiDatasets() {
  const list = await datasetApi.list()
  const details = await Promise.all(list.map((m) => datasetApi.get(m.id)))
  const datasets = datasetsToHiFi(details)
  await hydrateHiFiDatasetRows(details, datasets, (id) => datasetApi.preview(id))
  return datasets
}

function pickCurrentChart() {
  const dash = runtime?.getDash()
  if (!dash) return
  const selectedEl = document.querySelector('.widget.selected') as HTMLElement | null
  const wid = selectedEl?.dataset?.wid
  const comp =
    dash.components.find((c) => c.id === wid && c.type === 'chart') ||
    dash.components.find((c) => c.type === 'chart')
  const chartId = comp?.chartId
  if (!chartId) {
    selectedChartId.value = undefined
    selectedEncode.value = undefined
    return
  }
  const chart = dash.charts[chartId]
  selectedChartId.value = chartId
  selectedEncode.value = {
    ...(chart?.encode || {}),
    datasetId: chart?.datasetId,
    chartType: chart?.chartType
  }
}

async function persist(dash: HiFiDash, { publish = false } = {}) {
  if (props.mode === 'preview') return
  saving.value = true
  try {
    const payload = hiFiToSavePayload(dash)
    const contentId = payload.meta.contentId || '1'

    // rename if needed
    try {
      await dashboardTreeApi.rename({ id: dash.id, name: dash.name })
    } catch {
      /* ignore */
    }

    await dashboardApi.updateLayout(dash.id, {
      gridCols: payload.layout.gridCols,
      gridRows: payload.layout.gridRows,
      extStyle: payload.layout.extStyle,
      mobile: payload.layout.mobile as never,
      contentId
    })

    const deleteIds = [...knownCompIds].filter((id) => !payload.components.some((c) => c.id === id))
    await dashboardApi.updateComponents(dash.id, {
      upsert: payload.components,
      deleteIds,
      contentId
    })
    knownCompIds = new Set(payload.components.map((c) => c.id))

    for (const chart of Object.values(payload.charts)) {
      await dashboardApi.saveChart(dash.id, chart.id, {
        datasetId: chart.datasetId,
        chartType: chart.chartType,
        title: chart.title,
        encode: chart.encode,
        style: chart.style,
        senior: chart.senior,
        contentId
      })
    }
    const deleteChartIds = [...knownChartIds].filter((cid) => !payload.charts[cid])
    for (const chartId of deleteChartIds) {
      try {
        await dashboardApi.deleteChart(dash.id, chartId)
      } catch {
        /* chart may already be gone */
      }
    }
    knownChartIds = new Set(Object.keys(payload.charts))

    try {
      await dashboardApi.putLinkages(dash.id, payload.linkages)
    } catch {
      /* backend may lag */
    }

    if (publish) {
      await dashboardApi.publish(dash.id)
    }
  } finally {
    saving.value = false
  }
}

function scheduleSave(dash: HiFiDash) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    persist(dash).catch((e) => {
      error.value = e instanceof Error ? e.message : String(e)
    })
  }, 600)
}

async function boot() {
  loading.value = true
  error.value = ''
  try {
    const id = dashId()
    let detail
    if (props.mode === 'preview') {
      // 对齐高保：预览只读已发布版，不静默回退草稿
      detail = await dashboardApi.get(id, 'published')
    } else {
      detail = await dashboardApi.get(id, 'draft')
    }

    const dash = detailToHiFi(detail)
    const datasets = await loadHiFiDatasets()
    try {
      const share = await dashboardApi.getShare(id)
      if (share?.token) {
        dash.share = {
          token: share.token,
          visibility: share.visibility,
          perm: share.perm,
          url: `/share/${share.token}`
        }
      }
    } catch {
      /* no share yet */
    }
    knownCompIds = new Set(dash.components.map((c) => c.id))
    knownChartIds = new Set(Object.keys(dash.charts))

    loading.value = false
    await nextTick()
    const mod = await import('./editorCore.js')
    runtime?.destroy()
    runtime = mod.mountHiFiDashboard({
      mode: props.mode || 'editor',
      previewFrom: route.query.from === 'edit' ? 'editor' : 'list',
      dash,
      datasets,
      // 与 Vue 根 #app 隔离，避免渲染/销毁时清空整站
      rootIds: {
        app: 'od-hifi-app',
        ctx: 'od-hifi-ctx',
        mask: 'od-hifi-mask',
        toasts: 'od-hifi-toasts'
      },
      onDirty: (d: HiFiDash) => scheduleSave(d),
      onBack: () => {
        if (props.mode === 'preview') {
          if (route.query.from === 'edit') {
            router.push(`/dashboards/${id}/edit`)
          } else {
            router.push(`/dashboards/${id}`)
          }
          return
        }
        router.push(`/dashboards/${id}`)
      },
      onPreview: () => {
        const d = runtime?.getDash()
        if (!d || d.status === 'draft') return
        // 先落盘草稿再看已发布快照（发布后 status 非 draft）
        persist(d)
          .then(() => router.push(`/dashboards/${id}/preview?from=edit`))
          .catch((e) => {
            error.value = e instanceof Error ? e.message : String(e)
          })
      },
      onPublish: async (d: HiFiDash) => {
        await persist(d, { publish: true })
      },
      onShare: async ({ visibility, perm }: { visibility: string; perm: string }) => {
        return dashboardApi.share(id, { visibility, perm })
      },
      onExportChart: async (chartId: string) => {
        const { blob, filename } = await chartQueryApi.exportCsv({
          chartId,
          dashboardId: id,
          view: props.mode === 'preview' ? 'published' : 'draft',
          context: { filters: [], linkages: [] }
        })
        const { triggerBlobDownload } = await import('../../api/http')
        triggerBlobDownload(blob, filename)
      },
      refreshDatasets: () => loadHiFiDatasets(),
      queryChart: (chartId: string, meta?: { datasetId?: string | null; chartType?: string; encode?: Record<string, unknown>; title?: string }) =>
        chartQueryApi.query({
          chartId,
          dashboardId: id,
          view: props.mode === 'preview' ? 'published' : 'draft',
          inline: meta?.datasetId
            ? {
                datasetId: String(meta.datasetId),
                chartType: String(meta.chartType || 'bar'),
                encode: { ...(meta.encode || {}), datasetId: meta.datasetId }
              }
            : undefined,
          context: { filters: [], linkages: [] }
        })
    })
    guideReady.value = props.mode !== 'preview'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
    guideReady.value = false
  }
}

/** Reload draft without unmounting SQLBot (full boot would flash the panel). */
async function reloadDraftQuiet() {
  if (props.mode === 'preview' || !runtime) return
  const id = dashId()
  const detail = await dashboardApi.get(id, 'draft')
  const dash = detailToHiFi(detail)
  const current = runtime.getDash()
  if (current?.share) dash.share = current.share
  knownCompIds = new Set(dash.components.map((c) => c.id))
  knownChartIds = new Set(Object.keys(dash.charts))
  runtime.setDash(dash)
}

function onGuideDone() {
  if (route.query.guide) {
    const q = { ...route.query }
    delete q.guide
    router.replace({ path: route.path, query: q })
  }
}

onMounted(boot)
watch(
  () => [route.params.id, props.mode],
  () => boot()
)

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  runtime?.destroy()
  runtime = null
})
</script>

<template>
  <div class="hifi-dash-root">
    <ModuleTopbar module="dashboards" theme="dark" />
    <div v-if="loading" class="boot">加载编辑器…</div>
    <div v-if="error" class="boot err">{{ error }}</div>
    <div class="app" id="od-hifi-app" />
    <div class="ctx" id="od-hifi-ctx" />
    <div class="modal-mask" id="od-hifi-mask" />
    <div class="toast-wrap" id="od-hifi-toasts" />
    <div v-if="saving" class="save-chip">保存中…</div>
    <ConversationAiPanel
      v-if="!loading && !error && props.mode !== 'preview'"
      :dashboard-id="dashId()"
      :selected-chart-id="selectedChartId"
      :selected-encode="selectedEncode"
      @pick="pickCurrentChart"
      @applied="reloadDraftQuiet"
    />
    <EditorOnboarding
      v-if="guideReady && !loading && !error"
      :force="forceGuide"
      @done="onGuideDone"
    />
  </div>
</template>

<style scoped>
.hifi-dash-root {
  height: 100vh;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.boot {
  height: 100%;
  display: grid;
  place-items: center;
  color: #646a73;
  font-size: 14px;
}
.boot.err {
  color: #f54a45;
  padding: 2rem;
}
.save-chip {
  position: fixed;
  right: 316px;
  bottom: 60px;
  z-index: 80;
  background: rgba(31, 35, 41, 0.88);
  color: #fff;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
}
</style>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { shareApi } from '../../api/dashboard'
import { triggerBlobDownload } from '../../api/http'
import { datasetsToHiFi, detailToHiFi, type HiFiDash } from '../hifi/adapter'
import { downloadChartResult } from '../utils/chartDownload'
import type { DatasetDetailVO } from '../../dataset/api'
import '../hifi/editor.css'

const route = useRoute()
const router = useRouter()
const token = () => String(route.params.token || '')

const loading = ref(true)
const error = ref('')
const title = ref('分享仪表盘')
const shareUrl = ref('')
const copied = ref(false)

let runtime: { getDash: () => HiFiDash; destroy: () => void } | null = null

async function boot() {
  loading.value = true
  error.value = ''
  try {
    const view = await shareApi.view(token())
    title.value = view.detail.meta.name
    shareUrl.value = `${window.location.origin}/share/${view.share.token}`
    const dash = detailToHiFi(view.detail)
    dash.share = {
      token: view.share.token,
      visibility: view.share.visibility,
      perm: view.share.perm
    }
    dash.status = 'published'

    let details = (view.datasets || []) as DatasetDetailVO[]
    if (!details.length) {
      try {
        const { datasetApi } = await import('../../dataset/api')
        const list = await datasetApi.list()
        details = await Promise.all(list.map((m) => datasetApi.get(m.id)))
      } catch {
        /* 公开分享无鉴权时可能拉不到，依赖 stub 行 */
      }
    }
    const datasets = datasetsToHiFi(details)

    loading.value = false
    await nextTick()
    const mod = await import('../hifi/editorCore.js')
    runtime?.destroy()
    runtime = mod.mountHiFiDashboard({
      mode: 'preview',
      previewFrom: 'list',
      dash,
      datasets,
      rootIds: {
        app: 'od-share-app',
        ctx: 'od-share-ctx',
        mask: 'od-share-mask',
        toasts: 'od-share-toasts'
      },
      onBack: () => router.push('/dashboards'),
      onShare: async () => view.share,
      onExportChart: async (chartId: string) => {
        try {
          const { blob, filename } = await shareApi.exportCsv(token(), chartId)
          triggerBlobDownload(blob, filename)
        } catch {
          // fallback: query then client csv
          const result = await shareApi.chartQuery(token(), {
            chartId,
            dashboardId: view.detail.meta.id,
            view: 'published',
            context: { filters: [], linkages: [] }
          })
          downloadChartResult({
            fields: result.fields,
            data: result.data as unknown[][],
            series: result.series,
            filename: `${chartId}.csv`
          })
        }
      }
    } as never)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    error.value = '复制失败'
  }
}

onMounted(boot)
onBeforeUnmount(() => {
  runtime?.destroy()
  runtime = null
})
</script>

<template>
  <div class="share-root">
    <header class="share-bar">
      <strong>{{ title }}</strong>
      <span class="tag">分享只读</span>
      <div class="spacer" />
      <span class="url" :title="shareUrl">{{ shareUrl }}</span>
      <button type="button" class="btn" @click="copyLink">{{ copied ? '已复制' : '复制链接' }}</button>
    </header>
    <div v-if="loading" class="boot">加载分享页…</div>
    <div v-if="error" class="boot err">{{ error }}</div>
    <div class="app" id="od-share-app" />
    <div class="ctx" id="od-share-ctx" />
    <div class="mask" id="od-share-mask" />
    <div class="toasts" id="od-share-toasts" />
  </div>
</template>

<style scoped>
.share-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f4f5f7;
  overflow: hidden;
}
.share-bar {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.85rem;
  background: #1a2332;
  color: #fff;
}
.tag {
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  background: rgba(52, 128, 249, 0.25);
  color: #9ec5ff;
}
.spacer {
  flex: 1;
}
.url {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.55);
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: #fff;
  border-radius: 6px;
  padding: 0.25rem 0.7rem;
  font-size: 0.82rem;
  cursor: pointer;
  height: 28px;
}
.btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.boot {
  padding: 2rem;
  text-align: center;
  color: #86909c;
}
.boot.err {
  color: #cb2634;
}
.app {
  flex: 1;
  min-height: 0;
}
</style>

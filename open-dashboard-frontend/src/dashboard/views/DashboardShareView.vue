<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { shareApi } from '../../api/dashboard'
import { datasetsToHiFi, detailToHiFi, hydrateHiFiDatasetRows, type HiFiDash } from '../hifi/adapter'
import type { DatasetDetailVO } from '../../dataset/api'
import '../hifi/editor.css'

const route = useRoute()
const token = () => String(route.params.token || '')

const loading = ref(true)
const error = ref('')

let runtime: { getDash: () => HiFiDash; destroy: () => void } | null = null

async function boot() {
  loading.value = true
  error.value = ''
  try {
    const view = await shareApi.view(token())
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
    try {
      const { datasetApi } = await import('../../dataset/api')
      await hydrateHiFiDatasetRows(details, datasets, (id) => datasetApi.preview(id))
    } catch {
      /* public share may lack auth for preview */
    }

    loading.value = false
    await nextTick()
    const mod = await import('../hifi/editorCore.js')
    runtime?.destroy()
    runtime = mod.mountHiFiDashboard({
      mode: 'share',
      previewFrom: 'list',
      dash,
      datasets,
      rootIds: {
        app: 'od-share-app',
        ctx: 'od-share-ctx',
        mask: 'od-share-mask',
        toasts: 'od-share-toasts'
      }
    } as never)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

onMounted(boot)
onBeforeUnmount(() => {
  runtime?.destroy()
  runtime = null
})
</script>

<template>
  <div class="share-root hifi-dash-root">
    <div v-if="loading" class="boot">加载分享页…</div>
    <div v-if="error" class="boot err">{{ error }}</div>
    <div class="app" id="od-share-app" />
    <div class="ctx" id="od-share-ctx" />
    <div class="modal-mask" id="od-share-mask" />
    <div class="toast-wrap" id="od-share-toasts" />
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

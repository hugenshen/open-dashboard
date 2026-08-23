<script setup lang="ts">
/**
 * P011 M4: editor-side AI panel embeds the same dsh Web surface (no /harness SSE).
 */
import { computed, onMounted, ref } from 'vue'
import { getAuthBundle } from '@/api/http'

const props = defineProps<{
  dashboardId: string
  selectedChartId?: string
  selectedEncode?: Record<string, unknown>
}>()

defineEmits<{
  pick: []
  applied: []
}>()

const open = ref(false)
const ready = ref(false)

const dshSrc = computed(() => {
  const base =
    (import.meta.env.VITE_OD_DSH_URL as string)
    || (import.meta.env.DEV ? 'http://127.0.0.1:3090/' : '/dsh/')
  const url = new URL(base, window.location.origin)
  const bundle = getAuthBundle()
  const bridge = {
    userId: bundle.userId || '',
    workspaceId: bundle.workspaceId || '',
    perms: bundle.permissions || '',
    linkedDashboardId: props.dashboardId || '',
    selectedChartId: props.selectedChartId || '',
  }
  url.hash = `od_bridge=${encodeURIComponent(JSON.stringify(bridge))}`
  if (url.origin !== window.location.origin) {
    return url.toString()
  }
  return url.pathname + url.search + url.hash
})

onMounted(() => {
  try {
    open.value = localStorage.getItem('od.dsh.panel.open') === '1'
  } catch {
    /* ignore */
  }
  ready.value = true
})

function toggle() {
  open.value = !open.value
  try {
    localStorage.setItem('od.dsh.panel.open', open.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="od-dsh-panel">
    <button class="od-dsh-panel__fab" type="button" @click="toggle">
      {{ open ? '收起对话' : '对话' }}
    </button>
    <aside v-if="open" class="od-dsh-panel__drawer" aria-label="对话（DeepSeek Harness）">
      <header class="od-dsh-panel__head">
        <span>对话</span>
        <button type="button" class="od-dsh-panel__close" @click="toggle">×</button>
      </header>
      <iframe
        v-if="ready"
        class="od-dsh-panel__frame"
        title="DataQ 对话"
        :src="dshSrc"
        allow="clipboard-read; clipboard-write"
      />
      <p v-else class="od-dsh-panel__loading">加载中…</p>
    </aside>
  </div>
</template>

<style scoped>
.od-dsh-panel__fab {
  position: fixed;
  right: 20px;
  bottom: 72px;
  z-index: 90;
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  background: #1f2329;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}
.od-dsh-panel__drawer {
  position: fixed;
  right: 16px;
  bottom: 120px;
  z-index: 91;
  width: min(420px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 160px));
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
}
.od-dsh-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.od-dsh-panel__close {
  border: 0;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: #666;
}
.od-dsh-panel__frame {
  flex: 1;
  width: 100%;
  border: 0;
  min-height: 0;
}
.od-dsh-panel__loading {
  margin: auto;
  color: #888;
  font-size: 13px;
}
</style>

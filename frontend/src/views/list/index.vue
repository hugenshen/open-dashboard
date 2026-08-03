<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardApi } from '../../api/dashboard'
import type { DashboardDetailVO } from '../../types/dashboard'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const sample = ref<DashboardDetailVO | null>(null)

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    sample.value = await dashboardApi.get('1', 'draft')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

const openEditor = (id: string) => router.push(`/editor/${id}`)
</script>

<template>
  <div class="panel">
    <h1>仪表盘列表</h1>
    <p class="muted">
      Vue3 脚手架壳。完整树 / 创建 API 后续接入；交互参照
      <code>prototypes/hi-fi/dashboard-commercial.html</code>（<code>npm run hi-fi</code>）。
    </p>

    <p v-if="loading">加载中…</p>
    <p v-else-if="error" style="color: #b42318">
      无法连接后端：{{ error }}（请先 <code>mvn spring-boot:run</code>，可用 stub profile）
    </p>

    <ul v-else-if="sample" style="list-style: none; padding: 0">
      <li
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 0;
          border-top: 1px solid var(--line);
        "
      >
        <div>
          <strong>{{ sample.meta.name }}</strong>
          <div class="muted" style="font-size: 0.85rem">
            id={{ sample.meta.id }} · {{ sample.meta.status }}
            <span v-if="sample.layout.mobile?.enabled"> · 移动端</span>
          </div>
        </div>
        <button type="button" @click="openEditor(sample.meta.id)">打开编辑器</button>
      </li>
    </ul>
  </div>
</template>

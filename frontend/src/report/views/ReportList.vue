<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { reportApi } from '../api/report'
import type { ReportMetaVO } from '../types'

const router = useRouter()
const items = ref<ReportMetaVO[]>([])
const error = ref('')
const creating = ref(false)

async function load() {
  error.value = ''
  try {
    items.value = await reportApi.list()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function create() {
  creating.value = true
  try {
    const detail = await reportApi.create(`报告 ${new Date().toLocaleString()}`)
    router.push(`/reports/${detail.meta.id}/edit`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="panel">
    <div class="editor-toolbar">
      <h1 style="margin: 0; font-size: 1.25rem">在线报告</h1>
      <button type="button" :disabled="creating" @click="create">新建报告</button>
    </div>
    <p class="muted">
      Umo Editor + 引用看板图 / 报告内新建图。规格见 docs/specs/v0.4.0-report-umo-charts.md
    </p>
    <p v-if="error" style="color: #b42318">{{ error }}</p>
    <ul style="list-style: none; padding: 0">
      <li
        v-for="r in items"
        :key="r.id"
        style="
          display: flex;
          justify-content: space-between;
          padding: 0.75rem 0;
          border-top: 1px solid var(--line);
        "
      >
        <div>
          <strong>{{ r.name }}</strong>
          <div class="muted" style="font-size: 0.85rem">
            id={{ r.id }} · {{ r.status }} · contentId={{ r.contentId }}
          </div>
        </div>
        <button type="button" @click="router.push(`/reports/${r.id}/edit`)">编辑</button>
      </li>
    </ul>
  </div>
</template>

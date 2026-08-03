<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { dashboardApi } from '../../api/dashboard'
import type { DashboardDetailVO } from '../../types/dashboard'

const route = useRoute()
const id = computed(() => String(route.params.id || '1'))
const mobileWide = ref(false)
const detail = ref<DashboardDetailVO | null>(null)

onMounted(async () => {
  try {
    detail.value = await dashboardApi.get(id.value, 'draft')
  } catch {
    detail.value = null
  }
})
</script>

<template>
  <div class="panel">
    <div class="editor-toolbar">
      <h1 style="margin: 0; font-size: 1.25rem">预览 · {{ detail?.meta.name || id }}</h1>
      <label class="muted">
        <input v-model="mobileWide" type="checkbox" /> 移动宽
      </label>
    </div>
    <div class="canvas-stage" :style="mobileWide ? { maxWidth: '390px', margin: '0 auto' } : undefined">
      <template v-if="mobileWide">
        渲染 <code>layout.mobile.components</code>（脚手架占位）
      </template>
      <template v-else> 渲染 PC components（脚手架占位） </template>
    </div>
  </div>
</template>

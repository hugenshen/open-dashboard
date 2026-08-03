<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { UmoEditor } from '@umoteam/editor'
import '@umoteam/editor/style'
import { ReportChart } from '../extensions/reportChart'
import { reportApi } from '../api/report'
import type { ReportChartAttrs, ReportDetailVO } from '../types'
import InsertDashboardChartDialog from '../components/InsertDashboardChartDialog.vue'
import CreateInlineChartWizard from '../components/CreateInlineChartWizard.vue'

const route = useRoute()
const id = computed(() => String(route.params.id || '1'))
const editorRef = ref<{
  insertContent?: (content: unknown) => void
  getJSON?: () => Record<string, unknown>
  setContent?: (content: unknown) => void
  useMessage?: (type: string, opts: { content: string }) => void
} | null>(null)

const detail = ref<ReportDetailVO | null>(null)
const message = ref('')
const saving = ref(false)
const showRefDialog = ref(false)
const showNewDialog = ref(false)
const contentReady = ref(false)

const options = shallowRef({
  locale: 'zh-CN',
  theme: 'light',
  height: '100%',
  extensions: [ReportChart],
  toolbar: {
    defaultMode: 'ribbon'
  },
  document: {
    title: '报告',
    content: ''
  },
  page: {
    layouts: ['page', 'web'],
    defaultLayout: 'web'
  }
})

onMounted(async () => {
  try {
    detail.value = await reportApi.get(id.value)
    options.value = {
      ...options.value,
      document: {
        title: detail.value.meta.name,
        content: detail.value.content as never
      }
    }
    contentReady.value = true
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
    contentReady.value = true
  }
})

function insertChart(attrs: ReportChartAttrs) {
  editorRef.value?.insertContent?.({
    type: 'reportChart',
    attrs
  })
}

async function save() {
  if (!detail.value) return
  saving.value = true
  message.value = ''
  try {
    const content = editorRef.value?.getJSON?.() || detail.value.content
    detail.value = await reportApi.saveDoc(id.value, content, detail.value.meta.contentId)
    editorRef.value?.useMessage?.('success', { content: '已保存' })
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (!detail.value) return
  await save()
  detail.value = await reportApi.publish(id.value)
  editorRef.value?.useMessage?.('success', { content: '已发布' })
}
</script>

<template>
  <div class="report-editor-page">
    <div class="editor-toolbar">
      <div>
        <strong>{{ detail?.meta.name || '报告编辑器' }}</strong>
        <span class="muted" style="margin-left: 0.5rem">
          {{ detail?.meta.status }} · contentId={{ detail?.meta.contentId }}
        </span>
      </div>
      <div style="display: flex; gap: 0.5rem">
        <button type="button" :disabled="saving" @click="save">保存</button>
        <button type="button" @click="publish">发布</button>
      </div>
    </div>
    <p v-if="message" style="color: #b42318">{{ message }}</p>

    <div class="umo-wrap">
      <UmoEditor v-if="contentReady" ref="editorRef" v-bind="options">
        <template #toolbar_insert>
          <button type="button" class="umo-tool-btn" @click="showRefDialog = true">引用看板图</button>
          <button type="button" class="umo-tool-btn" @click="showNewDialog = true">新建图表</button>
        </template>
      </UmoEditor>
    </div>

    <InsertDashboardChartDialog v-model:open="showRefDialog" @confirm="insertChart" />
    <CreateInlineChartWizard v-model:open="showNewDialog" @confirm="insertChart" />
  </div>
</template>

<style scoped>
.report-editor-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: calc(100vh - 5rem);
}
.umo-wrap {
  flex: 1;
  min-height: 640px;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.umo-tool-btn {
  margin-left: 0.35rem;
  border: 1px solid #c9d4e3;
  background: #f5f8fc;
  color: #1a2332;
  border-radius: 6px;
  padding: 0.25rem 0.55rem;
  font-size: 0.82rem;
  cursor: pointer;
}
.umo-tool-btn:hover {
  border-color: #1f6feb;
  color: #1f6feb;
}
</style>

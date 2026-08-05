<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Editor } from '@tiptap/core'
import { UmoEditor } from '@umoteam/editor'
import '@umoteam/editor/style'
import { ReportChart } from '../extensions/reportChart'
import { reportApi } from '../api/report'
import type { ReportChartAttrs, ReportDetailVO } from '../types'
import InsertDashboardChartDialog from '../components/InsertDashboardChartDialog.vue'
import CreateInlineChartWizard from '../components/CreateInlineChartWizard.vue'
import ReportChartInspector from '../components/ReportChartInspector.vue'
import { useReportEditorStore } from '../stores/reportEditor'
import {
  buildReportToc,
  deleteReportChartEditor,
  findReportChartAttrs,
  patchReportChartEditor,
  selectReportChartEditor,
  type TocItem
} from '../utils/chartDoc'

const route = useRoute()
const router = useRouter()
const store = useReportEditorStore()
const id = computed(() => String(route.params.id || '1'))

const editorRef = ref<{
  insertContent?: (content: unknown) => void
  getJSON?: () => Record<string, unknown>
  getText?: () => string
  setLayout?: (layout: string) => void
  useEditor?: () => Editor
  useMessage?: (type: string, opts: { content: string }) => void
} | null>(null)

const detail = ref<ReportDetailVO | null>(null)
const docTitle = ref('')
const message = ref('')
const saving = ref(false)
const showRefDialog = ref(false)
const showNewDialog = ref(false)
const contentReady = ref(false)
const docVersion = ref(0)
const showToc = ref(false)
const pageLayout = ref<'page' | 'web'>('page')
const zoom = ref(1)
const wordCount = ref(0)

const selectedChart = computed<ReportChartAttrs | null>(() => {
  docVersion.value
  const cid = store.selectedChartId
  if (!cid) return null
  const json = editorRef.value?.getJSON?.()
  if (!json) return null
  return findReportChartAttrs(json as never, cid)
})

const tocItems = computed<TocItem[]>(() => {
  docVersion.value
  const json = editorRef.value?.getJSON?.()
  if (!json) return []
  return buildReportToc(json as never)
})

const statusLabel = computed(() => {
  const s = detail.value?.meta.status
  if (s === 'published') return '已发布'
  if (s === 'publishedWithDraft') return '有改动'
  return '草稿'
})

const zoomPct = computed(() => Math.round(zoom.value * 100))

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
    showToc: false
  }
})

function getEditor() {
  return editorRef.value?.useEditor?.() || null
}

function refreshWordCount() {
  const text = editorRef.value?.getText?.() || ''
  wordCount.value = text.replace(/\s/g, '').length
}

function bindEditorEvents() {
  const editor = getEditor()
  if (!editor) return
  editor.on('update', () => {
    store.markDirty()
    docVersion.value++
    refreshWordCount()
  })
  editor.on('selectionUpdate', ({ editor: ed }) => {
    const { selection } = ed.state
    const node = ed.state.doc.nodeAt(selection.from)
    if (node?.type.name === 'reportChart' && node.attrs.id) {
      store.selectChart(String(node.attrs.id))
      store.inspectorCollapsed = false
    }
  })
}

function registerApi() {
  store.registerEditorApi({
    patchChart: (chartId, patch) => {
      const ed = getEditor()
      if (ed) patchReportChartEditor(ed, chartId, patch)
      docVersion.value++
    },
    selectChart: (chartId) => {
      const ed = getEditor()
      if (ed) selectReportChartEditor(ed, chartId)
      store.selectChart(chartId)
    },
    deleteChart: (chartId) => {
      const ed = getEditor()
      if (ed) deleteReportChartEditor(ed, chartId)
      docVersion.value++
    },
    refreshChart: () => {}
  })
}

function onKeySave(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
  }
}

onMounted(async () => {
  store.selectedChartId = null
  store.dirty = false
  store.savedAt = null
  store.inspectorCollapsed = false
  store.inspTab = 'data'
  window.addEventListener('keydown', onKeySave)
  try {
    detail.value = await reportApi.get(id.value)
    docTitle.value = detail.value.meta.name
    options.value = {
      ...options.value,
      document: {
        title: detail.value.meta.name,
        content: detail.value.content as never
      }
    }
    contentReady.value = true
    await nextTick()
    registerApi()
    bindEditorEvents()
    refreshWordCount()
    store.markSaved()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
    contentReady.value = true
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeySave)
  store.unregisterEditorApi()
})

watch(contentReady, async (v) => {
  if (!v) return
  await nextTick()
  registerApi()
  bindEditorEvents()
  refreshWordCount()
})

function insertCharts(items: ReportChartAttrs | ReportChartAttrs[]) {
  const list = Array.isArray(items) ? items : [items]
  list.forEach((attrs) => {
    editorRef.value?.insertContent?.({ type: 'reportChart', attrs })
  })
  store.markDirty()
  docVersion.value++
  const last = list[list.length - 1]
  if (last?.id) {
    nextTick(() => store.focusChart(last.id))
  }
}

async function save() {
  if (!detail.value) return
  saving.value = true
  message.value = ''
  try {
    const content = editorRef.value?.getJSON?.() || detail.value.content
    detail.value = await reportApi.saveDoc(id.value, content, detail.value.meta.contentId)
    store.markSaved()
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

async function onTitleBlur() {
  if (!detail.value || docTitle.value === detail.value.meta.name) return
  try {
    const meta = await reportApi.updateMeta(id.value, { name: docTitle.value })
    detail.value = { ...detail.value, meta }
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

function toggleInspector() {
  store.inspectorCollapsed = !store.inspectorCollapsed
}

function setLayout(layout: 'page' | 'web') {
  pageLayout.value = layout
  try {
    editorRef.value?.setLayout?.(layout)
  } catch {
    /* Umo API may differ by version */
  }
}

function zoomBy(delta: number) {
  zoom.value = Math.min(1.5, Math.max(0.5, Math.round((zoom.value + delta) * 10) / 10))
}

function onTocClick(item: TocItem) {
  if (item.kind === 'chart' && item.chartId) {
    store.focusChart(item.chartId)
    return
  }
  const el = document.querySelector(`[data-toc-id="${item.id}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
</script>

<template>
  <div class="rpt-editor">
    <header class="rpt-hostbar">
      <button type="button" class="btn" @click="router.push('/reports')">← 列表</button>
      <input v-model="docTitle" class="doc-title" @blur="onTitleBlur" />
      <span class="status-tag">{{ statusLabel }}</span>
      <div class="spacer" />
      <button type="button" class="btn" @click="toggleInspector">
        {{ store.inspectorCollapsed ? '显示图表配置' : '收起图表配置' }}
      </button>
      <button type="button" class="btn primary" :disabled="saving" @click="publish">发布</button>
    </header>

    <p v-if="message" class="err">{{ message }}</p>

    <div class="editor-body">
      <aside v-show="showToc" class="umo-toc">
        <div class="toc-hd">页面大纲</div>
        <button
          v-for="t in tocItems"
          :key="t.id"
          type="button"
          class="toc-item"
          :class="{
            l2: t.level === 2,
            l3: t.level >= 3,
            chart: t.kind === 'chart',
            on: t.kind === 'chart' && t.chartId === store.selectedChartId
          }"
          @click="onTocClick(t)"
        >
          <template v-if="t.kind === 'chart'">▣ {{ t.text }}</template>
          <template v-else>{{ t.text }}</template>
        </button>
        <div v-if="!tocItems.length" class="toc-empty">暂无标题或图表</div>
      </aside>

      <div class="umo-center">
        <div class="umo-toolbar-wrap">
          <button
            type="button"
            class="umo-save-chip"
            :class="{ dirty: store.dirty }"
            title="保存文档 (⌘S)"
            @click="save"
          >
            <span class="dot" />
            <span>{{ store.saveLabel() }}</span>
          </button>
          <div class="umo-wrap" :style="{ zoom }">
            <UmoEditor v-if="contentReady" ref="editorRef" v-bind="options">
              <template #toolbar_tools>
                <button type="button" class="umo-tool-btn primary" @click="showRefDialog = true">
                  引用仪表盘
                </button>
                <button type="button" class="umo-tool-btn primary" @click="showNewDialog = true">
                  新建图表
                </button>
              </template>
            </UmoEditor>
          </div>
        </div>
      </div>

      <ReportChartInspector :chart="selectedChart" />
    </div>

    <footer class="umo-status-bar">
      <div class="left">
        <button type="button" class="sb-btn" :class="{ on: showToc }" @click="showToc = !showToc">
          页面大纲
        </button>
        <button
          type="button"
          class="sb-btn"
          :class="{ on: pageLayout === 'page' }"
          @click="setLayout('page')"
        >
          页面视图
        </button>
        <button
          type="button"
          class="sb-btn"
          :class="{ on: pageLayout === 'web' }"
          @click="setLayout('web')"
        >
          Web 视图
        </button>
        <span class="sb-meta">{{ wordCount }} 字</span>
      </div>
      <div class="right">
        <button type="button" class="sb-btn" @click="zoomBy(-0.1)">−</button>
        <span class="sb-meta">{{ zoomPct }}%</span>
        <button type="button" class="sb-btn" @click="zoomBy(0.1)">+</button>
      </div>
    </footer>

    <InsertDashboardChartDialog v-model:open="showRefDialog" @confirm="insertCharts" />
    <CreateInlineChartWizard v-model:open="showNewDialog" @confirm="insertCharts" />
  </div>
</template>

<style scoped>
.rpt-editor {
  --umo-primary-color: #3480f9;
  --umo-container-background: #f4f5f7;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--umo-container-background);
  overflow: hidden;
}
.rpt-hostbar {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  background: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
}
.doc-title {
  border: 1px solid transparent;
  background: transparent;
  font-size: 0.95rem;
  font-weight: 600;
  padding: 0.2rem 0.45rem;
  border-radius: 6px;
  min-width: 160px;
  max-width: 360px;
}
.doc-title:focus {
  outline: none;
  border-color: var(--umo-primary-color);
  background: #fff;
}
.status-tag {
  font-size: 0.72rem;
  color: #86909c;
  background: #f4f5f7;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
}
.spacer {
  flex: 1;
}
.btn {
  border: 1px solid #d8dee6;
  background: #fff;
  border-radius: 6px;
  padding: 0 0.65rem;
  font-size: 0.78rem;
  cursor: pointer;
  height: 28px;
}
.btn.primary {
  background: var(--umo-primary-color);
  border-color: var(--umo-primary-color);
  color: #fff;
}
.err {
  color: #b42318;
  margin: 0.25rem 0.75rem;
  font-size: 0.85rem;
}
.editor-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.umo-toc {
  width: 280px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.toc-hd {
  padding: 0.65rem 0.85rem;
  font-size: 0.82rem;
  font-weight: 600;
  border-bottom: 1px solid #eef1f5;
}
.toc-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 0.4rem 0.85rem;
  font-size: 0.82rem;
  cursor: pointer;
  color: #1a2332;
}
.toc-item.l2 {
  padding-left: 1.25rem;
}
.toc-item.l3 {
  padding-left: 1.65rem;
}
.toc-item.chart {
  color: #0fc6c2;
}
.toc-item.on {
  background: #eef4ff;
  color: var(--umo-primary-color);
}
.toc-empty {
  padding: 1.5rem;
  font-size: 0.78rem;
  color: #86909c;
  text-align: center;
}
.umo-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.umo-toolbar-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
.umo-save-chip {
  position: absolute;
  top: 10px;
  right: 14px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
  border-radius: 999px;
  padding: 0.2rem 0.7rem;
  font-size: 0.75rem;
  color: #86909c;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.umo-save-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(26, 187, 26);
}
.umo-save-chip.dirty {
  color: #ef3f35;
}
.umo-save-chip.dirty .dot {
  background: rgb(187, 26, 26);
}
.umo-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  transform-origin: top center;
}
.umo-tool-btn {
  margin-left: 0.35rem;
  border: 1px solid #c9d4e3;
  background: #f5f8fc;
  color: #1a2332;
  border-radius: 6px;
  padding: 0.35rem 0.65rem;
  font-size: 0.82rem;
  cursor: pointer;
}
.umo-tool-btn.primary {
  border-color: var(--umo-primary-color);
  background: #eef4ff;
  color: var(--umo-primary-color);
  font-weight: 600;
}
.umo-status-bar {
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  background: #fff;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  font-size: 0.75rem;
}
.umo-status-bar .left,
.umo-status-bar .right {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.sb-btn {
  border: 0;
  background: transparent;
  padding: 0.2rem 0.45rem;
  border-radius: 4px;
  cursor: pointer;
  color: #5c6b7a;
  font-size: 0.75rem;
}
.sb-btn.on {
  background: #eef4ff;
  color: var(--umo-primary-color);
}
.sb-meta {
  color: #86909c;
  min-width: 2.5rem;
  text-align: center;
}
</style>

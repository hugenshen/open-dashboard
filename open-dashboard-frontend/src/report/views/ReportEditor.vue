<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
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
  setToolbar?: (params: { mode?: 'classic' | 'ribbon'; show?: boolean }) => void
  useEditor?: () => Editor
  useMessage?: (type: string, opts: { content: string }) => void
} | null>(null)

const detail = ref<ReportDetailVO | null>(null)
const docTitle = ref('')
const message = ref('')
const saving = ref(false)
const publishing = ref(false)
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
  editorKey: 'report-editor',
  extensions: [ReportChart],
  // 工具栏只保留「图表」；签名/印章/二维码等全部禁用
  disableExtensions: [
    'signature',
    'stamp',
    'qrcode',
    'barcode',
    'math',
    'diagrams',
    'mermaid',
    'chinese-case'
  ],
  toolbar: {
    // 专业 ribbon；菜单以「工具」为首，进入编辑页默认展示工具
    defaultMode: 'ribbon' as const,
    menus: ['tools', 'base', 'insert', 'table', 'page', 'view', 'export'],
    showSaveLabel: false
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

function toastSoon(name: string) {
  editorRef.value?.useMessage?.('info', { content: `「${name}」待实现` })
}

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
    const chartNode =
      selection instanceof NodeSelection && selection.node.type.name === 'reportChart'
        ? selection.node
        : ed.state.doc.nodeAt(selection.from)
    if (chartNode?.type.name === 'reportChart' && chartNode.attrs.id) {
      store.selectChart(String(chartNode.attrs.id))
      store.inspectorCollapsed = false
    } else if (store.selectedChartId) {
      // 光标回到正文时收起右侧配置，避免挤占编辑区
      store.selectChart(null)
      store.inspectorCollapsed = true
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
  store.inspectorCollapsed = true
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
    bindToolbarRelocate()
    store.markSaved()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
    contentReady.value = true
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeySave)
  store.unregisterEditorApi()
  toolbarObserver?.disconnect()
  toolbarObserver = null
  toolbarModeForced = false
  toolsTabForced = false
  if (toolbarRelocateTimer) {
    clearInterval(toolbarRelocateTimer)
    toolbarRelocateTimer = null
  }
})

watch(contentReady, async (v) => {
  if (!v) return
  await nextTick()
  registerApi()
  bindEditorEvents()
  refreshWordCount()
  bindToolbarRelocate()
})

let toolbarObserver: MutationObserver | null = null
let toolbarRelocateTimer: ReturnType<typeof setInterval> | null = null
let toolbarModeForced = false

let toolsTabForced = false

/** 进入编辑页默认切到 Ribbon「工具」 */
function ensureToolsTab(root: Element) {
  if (toolsTabForced) return
  const tabs = root.querySelectorAll<HTMLElement>('.umo-ribbon-tabs-item')
  if (!tabs.length) return
  let tools: HTMLElement | null = null
  let activeIsTools = false
  tabs.forEach((el) => {
    const text = el.textContent?.trim()
    if (text === '工具') {
      tools = el
      if (el.classList.contains('active')) activeIsTools = true
    }
  })
  if (!tools) return
  toolsTabForced = true
  if (!activeIsTools) tools.click()
}

/** 将业务工具排到 Ribbon「图表」后面 */
function relocateReportTools() {
  const root = document.querySelector('.rpt-editor')
  if (!root) return
  const tools = (['ref', 'new', 'ask', 'insight', 'summary'] as const)
    .map((k) => root.querySelector<HTMLElement>(`[data-rpt-tool="${k}"]`))
    .filter((el): el is HTMLElement => !!el)
  if (tools.length < 2) return

  let chartWrap: HTMLElement | null = null
  const textNodes = root.querySelectorAll(
    '.umo-ribbon-container .umo-button-text, .umo-classic-menu .umo-button-text'
  )
  for (const el of textNodes) {
    if (el.textContent?.trim() === '图表') {
      chartWrap = el.closest('.umo-menu-button-wrap')
      break
    }
  }
  if (!chartWrap?.parentElement) return
  const parent = chartWrap.parentElement
  let anchor: HTMLElement = chartWrap
  let already = true
  for (const el of tools) {
    if (el.previousElementSibling !== anchor) {
      already = false
      break
    }
    anchor = el
  }
  if (already) return
  anchor = chartWrap
  for (const el of tools) {
    parent.insertBefore(el, anchor.nextSibling)
    anchor = el
  }
}

function bindToolbarRelocate() {
  const root = document.querySelector('.rpt-editor')
  if (!root) return

  const ensure = () => {
    if (!toolbarModeForced && editorRef.value?.setToolbar) {
      try {
        editorRef.value.setToolbar({ mode: 'ribbon', show: true })
        toolbarModeForced = true
      } catch {
        /* ignore */
      }
    }
    // 若本地缓存曾停在「开始」，强制点一次「工具」
    ensureToolsTab(root)
    relocateReportTools()
    const tabs = root.querySelector<HTMLElement>('.umo-ribbon-tabs')
    if (tabs && !tabs.dataset.rptBound) {
      tabs.dataset.rptBound = '1'
      tabs.addEventListener('click', () => {
        requestAnimationFrame(() => relocateReportTools())
        setTimeout(relocateReportTools, 50)
        setTimeout(relocateReportTools, 200)
      })
    }
    const menuRoot = root.querySelector('.umo-ribbon-menu, .umo-classic-menu')
    if (menuRoot && !toolbarObserver) {
      toolbarObserver = new MutationObserver(() => relocateReportTools())
      toolbarObserver.observe(menuRoot, { childList: true, subtree: true })
    }
  }

  ensure()
  if (toolbarRelocateTimer) clearInterval(toolbarRelocateTimer)
  let n = 0
  toolbarRelocateTimer = setInterval(() => {
    ensure()
    if ((toolbarModeForced && root.querySelector('.umo-ribbon-menu, .umo-classic-menu')) || ++n > 40) {
      if (toolbarRelocateTimer) clearInterval(toolbarRelocateTimer)
      toolbarRelocateTimer = null
    }
  }, 100)
}

function insertCharts(items: ReportChartAttrs | ReportChartAttrs[]) {
  const list = Array.isArray(items) ? items : [items]
  if (!list.length) return
  // 一次性插入，避免多次 insertContent 在 NodeSelection 下互相覆盖（只剩最后一张）
  editorRef.value?.insertContent?.(
    list.map((attrs) => ({ type: 'reportChart', attrs }))
  )
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
  publishing.value = true
  message.value = ''
  try {
    if (store.dirty) await save()
    detail.value = await reportApi.publish(id.value)
    editorRef.value?.useMessage?.('success', { content: '已发布' })
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    publishing.value = false
  }
}

function openPreview() {
  const { href } = router.resolve({ name: 'report-preview', params: { id: id.value } })
  window.open(href, '_blank')
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
  if (!store.selectedChartId) return
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
  const headings = document.querySelectorAll(
    '.rpt-editor .umo-wrap h1, .rpt-editor .umo-wrap h2, .rpt-editor .umo-wrap h3, .rpt-editor .umo-wrap h4, .rpt-editor .umo-wrap h5, .rpt-editor .umo-wrap h6'
  )
  const idx = Number(String(item.id).replace(/^h_/, ''))
  const el = headings[idx] as HTMLElement | undefined
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(
  () => tocItems.value.some((i) => i.kind === 'heading'),
  (hasHeading, prev) => {
    if (hasHeading && !prev) showToc.value = true
    if (!hasHeading) showToc.value = false
  },
  { immediate: true }
)
</script>

<template>
  <div class="rpt-editor">
    <header class="rpt-hostbar">
      <button type="button" class="btn" @click="router.push('/reports')">← 列表</button>
      <input v-model="docTitle" class="doc-title" @blur="onTitleBlur" />
      <span class="status-tag">{{ statusLabel }}</span>
      <div class="spacer" />
      <button
        v-if="store.selectedChartId"
        type="button"
        class="btn"
        @click="toggleInspector"
      >
        {{ store.inspectorCollapsed ? '显示图表配置' : '收起图表配置' }}
      </button>
      <button type="button" class="btn" :disabled="saving" @click="save">保存</button>
      <button type="button" class="btn" @click="openPreview">预览</button>
      <button type="button" class="btn primary" :disabled="publishing || saving" @click="publish">
        发布
      </button>
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
                <div class="umo-menu-button-wrap rpt-ribbon-tool" data-rpt-tool="ref">
                  <button
                    type="button"
                    class="umo-menu-button huge show-text rpt-ribbon-btn"
                    title="引用仪表盘"
                    @click="showRefDialog = true"
                  >
                    <div class="umo-button-content">
                      <span class="umo-button-icon-svg" aria-hidden="true">
                        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect
                            x="6"
                            y="8"
                            width="36"
                            height="32"
                            rx="2"
                            stroke="currentColor"
                            stroke-width="3"
                          />
                          <path d="M6 20h36M24 20v20" stroke="currentColor" stroke-width="3" />
                          <path
                            d="M12 28h6v8h-6zM30 26h6v10h-6z"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </span>
                      <p class="umo-button-text">引用仪表盘</p>
                    </div>
                  </button>
                </div>
                <div class="umo-menu-button-wrap rpt-ribbon-tool" data-rpt-tool="new">
                  <button
                    type="button"
                    class="umo-menu-button huge show-text rpt-ribbon-btn"
                    title="新建图表"
                    @click="showNewDialog = true"
                  >
                    <div class="umo-button-content">
                      <span class="umo-button-icon-svg" aria-hidden="true">
                        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M4 42h28"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                          />
                          <path
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linejoin="round"
                            d="M8 28h6v14H8zM18 18h6v24h-6z"
                          />
                          <path
                            d="M38 8v16M30 16h16"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                          />
                        </svg>
                      </span>
                      <p class="umo-button-text">新建图表</p>
                    </div>
                  </button>
                </div>
                <div class="umo-menu-button-wrap rpt-ribbon-tool" data-rpt-tool="ask">
                  <button
                    type="button"
                    class="umo-menu-button huge show-text rpt-ribbon-btn"
                    title="智能问数"
                    @click="toastSoon('智能问数')"
                  >
                    <div class="umo-button-content">
                      <span class="umo-button-icon-svg" aria-hidden="true">
                        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="22" cy="22" r="14" stroke="currentColor" stroke-width="3" />
                          <path
                            d="M32 32l10 10"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                          />
                          <path
                            d="M16 20h12M16 26h8"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                          />
                        </svg>
                      </span>
                      <p class="umo-button-text">智能问数</p>
                    </div>
                  </button>
                </div>
                <div class="umo-menu-button-wrap rpt-ribbon-tool" data-rpt-tool="insight">
                  <button
                    type="button"
                    class="umo-menu-button huge show-text rpt-ribbon-btn"
                    title="数据解读"
                    @click="toastSoon('数据解读')"
                  >
                    <div class="umo-button-content">
                      <span class="umo-button-icon-svg" aria-hidden="true">
                        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M8 36V12h8l4 8 4-8h8v24h-8V22l-4 8-4-8v14H8z"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linejoin="round"
                          />
                          <path
                            d="M34 28c4 0 6 3 6 6s-2 6-6 6c-2.5 0-4.5-1.2-5.5-3"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                          />
                        </svg>
                      </span>
                      <p class="umo-button-text">数据解读</p>
                    </div>
                  </button>
                </div>
                <div class="umo-menu-button-wrap rpt-ribbon-tool" data-rpt-tool="summary">
                  <button
                    type="button"
                    class="umo-menu-button huge show-text rpt-ribbon-btn"
                    title="文本总结"
                    @click="toastSoon('文本总结')"
                  >
                    <div class="umo-button-content">
                      <span class="umo-button-icon-svg" aria-hidden="true">
                        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M10 8h20l8 8v24H10V8z"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linejoin="round"
                          />
                          <path d="M30 8v8h8" stroke="currentColor" stroke-width="3" />
                          <path
                            d="M16 24h16M16 30h12M16 36h8"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                          />
                        </svg>
                      </span>
                      <p class="umo-button-text">文本总结</p>
                    </div>
                  </button>
                </div>
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
  height: 100%;
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
/* 禁用扩展后留下的空分组不占位 */
:deep(.umo-ribbon-container .umo-virtual-group:empty),
:deep(.umo-classic-menu .umo-virtual-group:empty),
:deep(.umo-ribbon-container .umo-virtual-group.is-slot:empty) {
  display: none !important;
}
/* 禁用扩展后留下的空分组不占位 */
:deep(.umo-ribbon-container .umo-virtual-group:empty),
:deep(.umo-classic-menu .umo-virtual-group:empty),
:deep(.umo-ribbon-container .umo-virtual-group.is-slot:empty) {
  display: none !important;
}
.rpt-ribbon-tool {
  display: inline-flex;
}
.rpt-ribbon-tool:not(:last-child) {
  margin-right: 5px;
}
.rpt-ribbon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  width: auto;
  padding: 0 5px;
  height: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: var(--umo-radius, 4px);
  color: var(--umo-text-color, #333);
}
.rpt-ribbon-btn:hover {
  background: var(--umo-button-hover-background, rgba(0, 0, 0, 0.05));
}
.rpt-ribbon-btn .umo-button-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 32px;
}
.rpt-ribbon-btn .umo-button-icon-svg {
  display: flex;
  margin-top: 3px;
  color: inherit;
}
.rpt-ribbon-btn .umo-button-icon-svg :deep(svg),
.rpt-ribbon-btn .umo-button-icon-svg svg {
  width: 24px;
  height: 24px;
}
.rpt-ribbon-btn .umo-button-text {
  display: block;
  margin: 0;
  font-size: 12px;
  line-height: 1.2;
  color: var(--umo-text-color, #333);
  white-space: nowrap;
}
/* 经典（简洁）工具栏下改为单行紧凑样式 */
:deep(.umo-classic-menu) .rpt-ribbon-btn.huge {
  height: 32px;
  flex-direction: row;
  padding: 0 6px;
}
:deep(.umo-classic-menu) .rpt-ribbon-btn .umo-button-content {
  flex-direction: row;
  gap: 4px;
  min-width: auto;
}
:deep(.umo-classic-menu) .rpt-ribbon-btn .umo-button-icon-svg {
  margin-top: 0;
}
:deep(.umo-classic-menu) .rpt-ribbon-btn .umo-button-icon-svg svg {
  width: 16px;
  height: 16px;
}
:deep(.umo-classic-menu) .rpt-ribbon-btn .umo-button-text {
  font-size: 12px;
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

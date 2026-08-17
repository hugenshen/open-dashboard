<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { UmoEditor } from '@umoteam/editor'
import '@umoteam/editor/style'
import { ReportChart } from '../extensions/reportChart'
import { reportApi } from '../api/report'
import type { ReportDetailVO } from '../types'
import { buildReportToc, type TocItem } from '../utils/chartDoc'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id || ''))

const detail = ref<ReportDetailVO | null>(null)
const message = ref('')
const contentReady = ref(false)
const docVersion = ref(0)

const editorRef = ref<{
  getJSON?: () => Record<string, unknown>
  setToolbar?: (params: { mode?: 'classic' | 'ribbon'; show?: boolean }) => void
} | null>(null)

const options = shallowRef({
  locale: 'zh-CN',
  theme: 'light',
  height: '100%',
  editorKey: 'report-preview',
  extensions: [ReportChart],
  toolbar: {
    defaultMode: 'classic' as const
  },
  document: {
    title: '报告预览',
    content: '',
    readOnly: true,
    autoSave: { enabled: false }
  },
  page: {
    layouts: ['page', 'web'],
    showToc: false
  }
})

/** 预览目录：仅一级标题 */
const h1Toc = computed<TocItem[]>(() => {
  docVersion.value
  const json = editorRef.value?.getJSON?.() || (detail.value?.content as Record<string, unknown>)
  if (!json) return []
  return buildReportToc(json as never).filter((i) => i.kind === 'heading' && i.level === 1)
})

onMounted(async () => {
  try {
    detail.value = await reportApi.get(id.value)
    options.value = {
      ...options.value,
      document: {
        title: detail.value.meta.name,
        content: detail.value.content as never,
        readOnly: true,
        autoSave: { enabled: false }
      }
    }
    contentReady.value = true
    await nextTick()
    try {
      editorRef.value?.setToolbar?.({ show: false })
    } catch {
      /* ignore */
    }
    docVersion.value++
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
    contentReady.value = true
  }
})

function onTocClick(index: number) {
  const headings = document.querySelectorAll('.umo-wrap h1')
  const el = headings[index] as HTMLElement | undefined
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="rpt-preview">
    <header class="rpt-hostbar">
      <button type="button" class="btn" @click="router.push('/reports')">← 列表</button>
      <button
        v-if="detail"
        type="button"
        class="btn"
        @click="router.push(`/reports/${id}/edit`)"
      >
        编辑
      </button>
      <strong class="doc-title">{{ detail?.meta.name || '报告预览' }}</strong>
      <span class="status-tag">预览</span>
    </header>

    <p v-if="message" class="err">{{ message }}</p>

    <div class="editor-body">
      <div class="page-stack">
        <nav v-if="h1Toc.length" class="doc-toc" aria-label="目录">
          <div class="doc-toc-title">目录</div>
          <ol>
            <li v-for="(t, i) in h1Toc" :key="t.id">
              <button type="button" @click="onTocClick(i)">{{ t.text }}</button>
            </li>
          </ol>
        </nav>
        <div class="umo-wrap">
          <UmoEditor v-if="contentReady && detail" ref="editorRef" v-bind="options" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rpt-preview {
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
  font-size: 0.92rem;
  font-weight: 600;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-tag {
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  background: #e8f3ff;
  color: #3480f9;
}
.btn {
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #fff;
  border-radius: 6px;
  padding: 0.25rem 0.7rem;
  font-size: 0.82rem;
  cursor: pointer;
  height: 28px;
}
.btn:hover {
  background: #f7f8fa;
}
.err {
  margin: 0;
  padding: 0.4rem 0.75rem;
  color: #cb2634;
  font-size: 0.82rem;
  background: #fff1f0;
}
.editor-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.page-stack {
  min-height: 100%;
  transform-origin: top center;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.25rem 1rem 2rem;
  box-sizing: border-box;
}
.doc-toc {
  width: min(794px, 100%);
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  padding: 1.25rem 2rem 0.75rem;
  box-sizing: border-box;
}
.doc-toc-title {
  font-size: 1rem;
  font-weight: 650;
  margin-bottom: 0.65rem;
  color: #1a2332;
}
.doc-toc ol {
  margin: 0;
  padding: 0 0 0 1.25rem;
}
.doc-toc li {
  margin: 0.25rem 0;
  color: #3480f9;
}
.doc-toc button {
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 0.92rem;
  cursor: pointer;
  text-align: left;
}
.doc-toc button:hover {
  text-decoration: underline;
}
.umo-wrap {
  width: min(794px, 100%);
  background: #fff;
  flex: 1;
}
/* 目录贴在正文页上方时，去掉编辑器顶栏空隙感 */
.umo-wrap :deep(.umo-toolbar-container),
.umo-wrap :deep(.umo-toolbar),
.umo-wrap :deep(.umo-status-bar),
.umo-wrap :deep(.umo-footer) {
  display: none !important;
}
</style>

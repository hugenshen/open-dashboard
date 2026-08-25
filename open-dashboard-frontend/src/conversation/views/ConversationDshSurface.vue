<script setup lang="ts">
/**
 * P011: conversation surface — dsh Web embed; split with DashboardEditorHost on board_ready.
 * P014: open history via postMessage; never remount iframe on route id change.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAuthBundle } from '@/api/http'
import DashboardEditorHost from '@/dashboard/hifi/DashboardEditorHost.vue'

const route = useRoute()
const router = useRouter()
const ready = ref(false)
const hasDash = ref(false)
const hasReport = ref(false)
const linkedDashboardId = ref('')
const boardTitle = ref('')
const editorEpoch = ref(0)
const frameEl = ref<HTMLIFrameElement | null>(null)
const reportTitle = ref('')
const reportFilename = ref('')
/** Viewing format — commit always ships both HTML and Markdown payloads. */
const reportFormat = ref<'html' | 'markdown'>('html')
const reportHtml = ref('')
const reportMarkdown = ref('')

const reportDisplayName = computed(() => {
  const base = String(reportFilename.value || 'analysis-report').replace(/\.(html?|md|markdown)$/i, '')
  return reportFormat.value === 'markdown' ? `${base}.md` : `${base}.html`
})

const dshBase = computed(() =>
  (import.meta.env.VITE_OD_DSH_URL as string)
  || (import.meta.env.DEV ? 'http://127.0.0.1:3090/' : '/dsh/'),
)

const allowedOrigins = computed(() => {
  const set = new Set<string>([window.location.origin])
  try {
    set.add(new URL(dshBase.value, window.location.origin).origin)
  } catch {
    /* ignore */
  }
  return set
})

const dshSrc = computed(() => {
  const url = new URL(dshBase.value, window.location.origin)
  const bundle = getAuthBundle()
  const bridge = {
    userId: bundle.userId || '',
    workspaceId: bundle.workspaceId || '',
    perms: bundle.permissions || '',
    conversationId: String(route.params.id || ''),
    prompt: String(route.query.q || ''),
    datasetId: String(route.query.datasetId || ''),
    dashboardId: String(route.query.dashboardId || ''),
  }
  url.hash = `od_bridge=${encodeURIComponent(JSON.stringify(bridge))}`
  if (url.origin !== window.location.origin) {
    return url.toString()
  }
  return url.pathname + url.search + url.hash
})

/** Changing iframe src remounts dsh and drops the in-memory thread. */
const frameSrc = ref('')
watch(
  dshSrc,
  (src) => {
    if (src && !frameSrc.value) frameSrc.value = src
  },
  { immediate: true },
)

const fullEditPath = computed(() =>
  linkedDashboardId.value ? `/dashboards/${linkedDashboardId.value}/edit` : '',
)

const splitOpen = computed(() => hasDash.value || hasReport.value)

const reportMdHtml = computed(() => renderMarkdownLite(reportMarkdown.value))

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/** Lightweight MD preview — no marked dependency. */
function renderMarkdownLite(src: string) {
  const lines = String(src || '').split('\n')
  const out: string[] = []
  let inList = false
  let inTable = false
  const flushList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  const flushTable = () => {
    if (inTable) {
      out.push('</tbody></table>')
      inTable = false
    }
  }
  const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  for (const raw of lines) {
    const line = escapeHtml(raw)
    if (/^\|(.+)\|$/.test(line.trim()) && !/^\|[\s|:-]+\|$/.test(line.trim())) {
      flushList()
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim())
      if (!inTable) {
        out.push('<table><thead><tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>')
        inTable = true
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
      }
      continue
    }
    if (/^\|[\s|:-]+\|$/.test(line.trim())) continue
    flushTable()
    if (line.startsWith('### ')) {
      flushList()
      out.push(`<h3>${inline(line.slice(4))}</h3>`)
    } else if (line.startsWith('## ')) {
      flushList()
      out.push(`<h2>${inline(line.slice(3))}</h2>`)
    } else if (line.startsWith('# ')) {
      flushList()
      out.push(`<h1>${inline(line.slice(2))}</h1>`)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(line.slice(2))}</li>`)
    } else if (/^---+$/.test(line.trim())) {
      flushList()
      out.push('<hr/>')
    } else if (!line.trim()) {
      flushList()
    } else {
      flushList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  flushList()
  flushTable()
  return out.join('')
}

function setReportFormat(fmt: 'html' | 'markdown') {
  if (!hasReport.value) return
  if (fmt === 'markdown' && !reportMarkdown.value) return
  if (fmt === 'html' && !reportHtml.value) return
  reportFormat.value = fmt
}

function downloadReport() {
  const isMd = reportFormat.value === 'markdown'
  const body = isMd ? reportMarkdown.value : reportHtml.value
  if (!body) return
  const blob = new Blob([body], { type: isMd ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = reportDisplayName.value
  a.click()
  URL.revokeObjectURL(url)
}

function dshOrigin(): string {
  try {
    return new URL(dshBase.value, window.location.origin).origin
  } catch {
    return window.location.origin
  }
}

/** Ask iframe to open a dsh session (P014). Does not change iframe src. */
function postOpenSession(sessionId: string) {
  const id = String(sessionId || '').trim()
  if (!id || !frameEl.value?.contentWindow) return
  frameEl.value.contentWindow.postMessage(
    {
      source: 'opendashboard-shell',
      type: 'od-open-session',
      sessionId: id,
    },
    dshOrigin(),
  )
}

function closeReport() {
  hasReport.value = false
  reportTitle.value = ''
  reportFilename.value = ''
  reportHtml.value = ''
  reportMarkdown.value = ''
  reportFormat.value = 'html'
}

function openReport(payload: {
  title?: string
  format?: string
  filename?: string
  html?: string
  markdown?: string
}) {
  closeDash()
  reportTitle.value = String(payload.title || '分析报告')
  reportFilename.value = String(payload.filename || (payload.format === 'markdown' ? 'analysis-report.md' : 'analysis-report.html'))
  reportFormat.value = String(payload.format || '').toLowerCase() === 'markdown' ? 'markdown' : 'html'
  reportHtml.value = String(payload.html || '')
  reportMarkdown.value = String(payload.markdown || '')
  hasReport.value = true
}

function openDashboard(payload: { dashboardId: string; title?: string }) {
  const id = String(payload.dashboardId || '').trim()
  if (!id) return
  closeReport()
  const same = linkedDashboardId.value === id && hasDash.value
  linkedDashboardId.value = id
  boardTitle.value = payload.title || boardTitle.value || `看板 ${id}`
  hasDash.value = true
  editorEpoch.value += 1
  const q = { ...route.query, dashboardId: id }
  if (!same || String(route.query.dashboardId || '') !== id) {
    void router.replace({ path: route.path, query: q })
  }
}

function closeDash() {
  hasDash.value = false
  linkedDashboardId.value = ''
  boardTitle.value = ''
  const q = { ...route.query }
  delete q.dashboardId
  if (route.query.dashboardId) {
    void router.replace({ path: route.path, query: q })
  }
}

function onMessage(event: MessageEvent) {
  if (!allowedOrigins.value.has(event.origin)) return
  const data = event.data
  if (!data || data.source !== 'opendashboard-dsh') return
  if (data.type === 'od-session-changed') {
    closeDash()
    closeReport()
    return
  }
  if (data.type === 'od-open-report') {
    openReport({
      title: data.title ? String(data.title) : undefined,
      format: data.format ? String(data.format) : undefined,
      filename: data.filename ? String(data.filename) : undefined,
      html: data.html ? String(data.html) : undefined,
      markdown: data.markdown ? String(data.markdown) : undefined,
    })
    return
  }
  if (data.type !== 'od-open-dashboard') return
  openDashboard({
    dashboardId: String(data.dashboardId || ''),
    title: data.title ? String(data.title) : undefined,
  })
}

function syncFromQuery() {
  const id = String(route.query.dashboardId || '').trim()
  if (id) {
    linkedDashboardId.value = id
    if (!boardTitle.value) boardTitle.value = `看板 ${id}`
    hasDash.value = true
    return
  }
  hasDash.value = false
  linkedDashboardId.value = ''
}

/** Optional deep link: ?sessionId=<dshSessionId> opens that thread without remount. */
function syncSessionDeepLink() {
  const sid = String(route.query.sessionId || '').trim()
  if (sid) postOpenSession(sid)
}

onMounted(() => {
  ready.value = true
  syncFromQuery()
  window.addEventListener('message', onMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
})

watch(
  () => route.query.dashboardId,
  () => syncFromQuery(),
)

watch(
  () => route.query.sessionId,
  () => syncSessionDeepLink(),
)

function onFrameLoad() {
  syncSessionDeepLink()
}
</script>

<template>
  <div class="od-dsh-surface" :class="{ 'has-dash': splitOpen }">
    <div class="od-dsh-surface__chat">
      <iframe
        v-if="ready"
        ref="frameEl"
        class="od-dsh-surface__frame"
        title="DataQ 对话"
        :src="frameSrc"
        allow="clipboard-read; clipboard-write"
        @load="onFrameLoad"
      />
      <p v-else class="od-dsh-surface__loading">正在加载对话…</p>
    </div>

    <aside v-if="hasReport" class="od-dsh-surface__dash od-dsh-surface__file" aria-label="分析报告预览">
      <header class="od-dsh-surface__dash-bar">
        <span class="od-dsh-surface__file-glyph" aria-hidden="true"></span>
        <div class="od-dsh-surface__dash-title" :title="reportTitle">{{ reportTitle }}</div>
        <span class="od-dsh-surface__dash-id">{{ reportDisplayName }} · 静态快照</span>
        <span class="od-dsh-surface__sp" />
        <div class="od-dsh-surface__fmt" role="tablist" aria-label="报告格式">
          <button
            type="button"
            role="tab"
            class="od-dsh-surface__fmt-btn"
            :class="{ on: reportFormat === 'html' }"
            :aria-selected="reportFormat === 'html'"
            :disabled="!reportHtml"
            @click="setReportFormat('html')"
          >HTML</button>
          <button
            type="button"
            role="tab"
            class="od-dsh-surface__fmt-btn"
            :class="{ on: reportFormat === 'markdown' }"
            :aria-selected="reportFormat === 'markdown'"
            :disabled="!reportMarkdown"
            @click="setReportFormat('markdown')"
          >MD</button>
        </div>
        <button type="button" class="od-dsh-surface__btn" @click="downloadReport">下载</button>
        <button type="button" class="od-dsh-surface__btn ghost" @click="closeReport">收起</button>
      </header>
      <div class="od-dsh-surface__dash-body">
        <iframe
          v-if="reportFormat === 'html'"
          class="od-dsh-surface__report-frame"
          title="分析报告"
          sandbox=""
          :srcdoc="reportHtml"
        />
        <div v-else class="od-dsh-surface__report-md" v-html="reportMdHtml" />
      </div>
    </aside>

    <aside v-else-if="hasDash && linkedDashboardId" class="od-dsh-surface__dash" aria-label="仪表盘编辑器">
      <header class="od-dsh-surface__dash-bar">
        <div class="od-dsh-surface__dash-title" :title="boardTitle">{{ boardTitle }}</div>
        <span class="od-dsh-surface__dash-id">draft {{ linkedDashboardId }}</span>
        <span class="od-dsh-surface__sp" />
        <a
          v-if="fullEditPath"
          class="od-dsh-surface__btn"
          :href="fullEditPath"
          target="_blank"
          rel="noopener"
        >全屏编辑</a>
        <button type="button" class="od-dsh-surface__btn ghost" @click="closeDash">收起</button>
      </header>
      <div class="od-dsh-surface__dash-body">
        <DashboardEditorHost
          :key="`${linkedDashboardId}:${editorEpoch}`"
          mode="editor"
          embedded
          :dashboard-id="linkedDashboardId"
        />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.od-dsh-surface {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: #ffffff;
}
.od-dsh-surface__chat {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.od-dsh-surface.has-dash .od-dsh-surface__chat {
  flex: 0 0 34%;
  max-width: 34%;
  border-right: 1px solid var(--od-line, #e5e7eb);
}
.od-dsh-surface__frame {
  flex: 1;
  width: 100%;
  border: 0;
  min-height: 0;
}
.od-dsh-surface__loading {
  margin: auto;
  padding: 24px;
  color: #666;
  font-size: 14px;
}
.od-dsh-surface__dash {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.od-dsh-surface__dash-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--od-line, #e5e7eb);
  background: #fafbfc;
  font-size: 13px;
}
.od-dsh-surface__dash-title {
  font-weight: 650;
  color: #1f2329;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.od-dsh-surface__dash-id {
  color: #8f959e;
  font-size: 12px;
}
.od-dsh-surface__sp {
  flex: 1;
}
.od-dsh-surface__btn {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid #d0d3d6;
  background: #fff;
  color: #1f2329;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.od-dsh-surface__btn.ghost {
  background: transparent;
}
.od-dsh-surface__btn:hover {
  border-color: #bbb;
}
.od-dsh-surface__dash-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.od-dsh-surface__file-glyph {
  flex-shrink: 0;
  width: 14px;
  height: 16px;
  border: 1.5px solid #8f959e;
  border-radius: 2px;
  background:
    linear-gradient(#8f959e, #8f959e) 3px 5px / 8px 1.5px no-repeat,
    linear-gradient(#8f959e, #8f959e) 3px 8px / 8px 1.5px no-repeat,
    linear-gradient(#8f959e, #8f959e) 3px 11px / 5px 1.5px no-repeat,
    #fff;
}
.od-dsh-surface__fmt {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid #d0d3d6;
  background: #f3f4f6;
  gap: 2px;
}
.od-dsh-surface__fmt-btn {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #646a73;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}
.od-dsh-surface__fmt-btn.on {
  background: #fff;
  color: #1f2329;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.od-dsh-surface__fmt-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.od-dsh-surface__report-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
.od-dsh-surface__report-md {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 20px 24px 32px;
  font-size: 14px;
  line-height: 1.55;
  color: #1f2329;
}
.od-dsh-surface__report-md :deep(h1) { font-size: 22px; margin: 0 0 8px; }
.od-dsh-surface__report-md :deep(h2) { font-size: 16px; margin: 20px 0 8px; }
.od-dsh-surface__report-md :deep(h3) { font-size: 14px; margin: 16px 0 6px; }
.od-dsh-surface__report-md :deep(p) { margin: 0 0 10px; }
.od-dsh-surface__report-md :deep(ul) { margin: 0 0 12px 18px; }
.od-dsh-surface__report-md :deep(hr) { border: 0; border-top: 1px solid #eceef2; margin: 16px 0; }
.od-dsh-surface__report-md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 16px;
  font-size: 13px;
}
.od-dsh-surface__report-md :deep(th),
.od-dsh-surface__report-md :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 6px 8px;
  text-align: left;
}
.od-dsh-surface__report-md :deep(th) { background: #f5f6f8; }
</style>

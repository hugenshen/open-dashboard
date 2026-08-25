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
const hasReportProcess = ref(false)
const linkedDashboardId = ref('')
const boardTitle = ref('')
const editorEpoch = ref(0)
const frameEl = ref<HTMLIFrameElement | null>(null)
const reportTitle = ref('')
const reportFilename = ref('')
/** Viewing format — commit always ships both HTML and Markdown payloads. */
const reportFormat = ref<'html' | 'markdown'>('html')
const reportView = ref<'process' | 'html' | 'markdown'>('process')
const reportHtml = ref('')
const reportMarkdown = ref('')
type ReportProcessStep = {
  id: string
  nodeName?: string
  category?: string
  title: string
  detail?: string
  status: 'pending' | 'running' | 'done' | 'error'
  depth?: number
  durationMs?: number
  inputs?: Array<{ label: string; value: string }>
  output?: string
}
const reportProcessSteps = ref<ReportProcessStep[]>([])
const reportProcessStatus = ref<'running' | 'done' | 'error'>('running')
const reportActiveNode = ref('')
const completedReportNodes = computed(() => reportProcessSteps.value.filter((step) => step.status === 'done').length)

function formatDuration(ms?: number) {
  const value = Number(ms || 0)
  if (value < 1000) return value > 0 ? `${Math.round(value)} ms` : ''
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
}

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

const splitOpen = computed(() => hasDash.value || hasReport.value || hasReportProcess.value)

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
  reportView.value = fmt
}

function showReportProcess() {
  if (reportProcessSteps.value.length) reportView.value = 'process'
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
  hasReportProcess.value = false
  reportTitle.value = ''
  reportFilename.value = ''
  reportHtml.value = ''
  reportMarkdown.value = ''
  reportFormat.value = 'html'
  reportView.value = 'process'
  reportProcessSteps.value = []
  reportProcessStatus.value = 'running'
  reportActiveNode.value = ''
}

function openReportProcess(payload: {
  title?: string
  status?: string
  activeNode?: string
  steps?: ReportProcessStep[]
}) {
  closeDash()
  hasReport.value = false
  hasReportProcess.value = true
  reportView.value = 'process'
  reportTitle.value = String(payload.title || reportTitle.value || '分析报告')
  reportProcessStatus.value = payload.status === 'error'
    ? 'error'
    : payload.status === 'done'
      ? 'done'
      : 'running'
  reportActiveNode.value = String(payload.activeNode || '')
  reportProcessSteps.value = Array.isArray(payload.steps)
    ? payload.steps.map((step, index) => ({
      id: String(step.id || `step-${index + 1}`),
      nodeName: step.nodeName ? String(step.nodeName) : undefined,
      category: step.category ? String(step.category) : undefined,
      title: String(step.title || `步骤 ${index + 1}`),
      detail: step.detail ? String(step.detail) : undefined,
      status: ['pending', 'running', 'done', 'error'].includes(step.status)
        ? step.status
        : 'pending',
      depth: Math.max(0, Number(step.depth || 0)),
      durationMs: Math.max(0, Number(step.durationMs || 0)),
      inputs: Array.isArray(step.inputs)
        ? step.inputs.map((item) => ({ label: String(item.label || ''), value: String(item.value || '') })).filter((item) => item.label && item.value)
        : [],
      output: step.output ? String(step.output) : undefined,
    }))
    : reportProcessSteps.value
}

function openReport(payload: {
  title?: string
  format?: string
  filename?: string
  html?: string
  markdown?: string
}) {
  closeDash()
  hasReportProcess.value = false
  reportTitle.value = String(payload.title || '分析报告')
  reportFilename.value = String(payload.filename || (payload.format === 'markdown' ? 'analysis-report.md' : 'analysis-report.html'))
  reportFormat.value = String(payload.format || '').toLowerCase() === 'markdown' ? 'markdown' : 'html'
  reportView.value = reportFormat.value
  reportProcessStatus.value = 'done'
  reportActiveNode.value = '报告已生成'
  reportProcessSteps.value = reportProcessSteps.value.map((step) => (
    step.status === 'running' ? { ...step, status: 'done' } : step
  ))
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
  if (data.type === 'od-report-progress') {
    openReportProcess({
      title: data.title ? String(data.title) : undefined,
      status: data.status ? String(data.status) : undefined,
      steps: Array.isArray(data.steps) ? data.steps : undefined,
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

    <aside v-if="hasReport || hasReportProcess" class="od-dsh-surface__dash od-dsh-surface__file" aria-label="分析报告预览">
      <header class="od-dsh-surface__dash-bar">
        <span class="od-dsh-surface__file-glyph" aria-hidden="true"></span>
        <div class="od-dsh-surface__dash-title" :title="reportTitle">{{ reportTitle }}</div>
        <span class="od-dsh-surface__dash-id">
          {{ reportView === 'process' ? '节点执行轨迹' : `${reportDisplayName} · 静态快照` }}
        </span>
        <span class="od-dsh-surface__sp" />
        <div v-if="hasReport" class="od-dsh-surface__fmt" role="tablist" aria-label="报告格式">
          <button
            v-if="reportProcessSteps.length"
            type="button"
            role="tab"
            class="od-dsh-surface__fmt-btn"
            :class="{ on: reportView === 'process' }"
            :aria-selected="reportView === 'process'"
            @click="showReportProcess"
          >过程</button>
          <button
            type="button"
            role="tab"
            class="od-dsh-surface__fmt-btn"
            :class="{ on: reportView === 'html' }"
            :aria-selected="reportView === 'html'"
            :disabled="!reportHtml"
            @click="setReportFormat('html')"
          >HTML</button>
          <button
            type="button"
            role="tab"
            class="od-dsh-surface__fmt-btn"
            :class="{ on: reportView === 'markdown' }"
            :aria-selected="reportView === 'markdown'"
            :disabled="!reportMarkdown"
            @click="setReportFormat('markdown')"
          >MD</button>
        </div>
        <button v-if="hasReport && reportView !== 'process'" type="button" class="od-dsh-surface__btn" @click="downloadReport">下载</button>
        <button type="button" class="od-dsh-surface__btn ghost" @click="closeReport">收起</button>
      </header>
      <div class="od-dsh-surface__dash-body">
        <div v-if="reportView === 'process'" class="od-dsh-surface__report-process">
          <div class="od-dsh-surface__process-head">
            <span class="od-dsh-surface__process-pulse" :class="reportProcessStatus" />
            <div class="od-dsh-surface__process-head-copy">
              <strong>{{ reportProcessStatus === 'error' ? '分析未完成' : reportProcessStatus === 'done' ? '正在整理报告' : '正在分析数据' }}</strong>
              <p>{{ reportActiveNode ? `当前节点：${reportActiveNode}` : '正在等待分析 Agent 下发节点' }}</p>
            </div>
            <span class="od-dsh-surface__process-count">{{ completedReportNodes }} / {{ reportProcessSteps.length }} 节点</span>
          </div>
          <div class="od-dsh-surface__process-section-title">
            <strong>节点执行轨迹</strong>
            <span>点击节点查看输入与产出</span>
          </div>
          <ol class="od-dsh-surface__process-list">
            <li
              v-for="(step, index) in reportProcessSteps"
              :key="step.id"
              :class="step.status"
              :style="{ '--node-depth': Math.min(step.depth || 0, 3) }"
            >
              <span class="od-dsh-surface__process-rail">
                <span class="od-dsh-surface__process-dot" />
              </span>
              <details class="od-dsh-surface__node" :open="step.status === 'running' || step.status === 'error'">
                <summary>
                  <span class="od-dsh-surface__node-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="od-dsh-surface__node-main">
                    <span class="od-dsh-surface__node-line">
                      <strong>{{ step.title }}</strong>
                      <code v-if="step.nodeName">{{ step.nodeName }}</code>
                    </span>
                    <span v-if="step.detail" class="od-dsh-surface__node-summary">{{ step.detail }}</span>
                  </span>
                  <span v-if="formatDuration(step.durationMs)" class="od-dsh-surface__node-duration">{{ formatDuration(step.durationMs) }}</span>
                  <span class="od-dsh-surface__process-state">
                    {{ step.status === 'done' ? '已完成' : step.status === 'running' ? '执行中' : step.status === 'error' ? '失败' : '等待' }}
                  </span>
                </summary>
                <div class="od-dsh-surface__node-detail">
                  <div class="od-dsh-surface__node-meta">
                    <span>节点类型</span><strong>{{ step.category || '工具调用' }}</strong>
                  </div>
                  <div v-if="step.inputs?.length" class="od-dsh-surface__node-block">
                    <div class="od-dsh-surface__node-block-title">输入</div>
                    <dl>
                      <template v-for="item in step.inputs" :key="`${step.id}-${item.label}`">
                        <dt>{{ item.label }}</dt><dd>{{ item.value }}</dd>
                      </template>
                    </dl>
                  </div>
                  <div class="od-dsh-surface__node-block">
                    <div class="od-dsh-surface__node-block-title">输出</div>
                    <pre v-if="step.output">{{ step.output }}</pre>
                    <p v-else class="od-dsh-surface__node-empty">{{ step.status === 'running' ? '节点正在执行，产出将实时更新' : '该节点无额外输出' }}</p>
                  </div>
                </div>
              </details>
            </li>
          </ol>
        </div>
        <iframe
          v-else-if="reportView === 'html'"
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
.od-dsh-surface__report-process {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 28px 32px 40px;
  background: #fbfcfe;
}
.od-dsh-surface__process-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid #e3e8f2;
  border-radius: 10px;
  background: #fff;
}
.od-dsh-surface__process-head-copy { flex: 1; min-width: 0; }
.od-dsh-surface__process-head strong { color: #1f2329; font-size: 15px; }
.od-dsh-surface__process-head p,
.od-dsh-surface__process-list p { margin: 4px 0 0; color: #7b828c; font-size: 12px; line-height: 1.55; }
.od-dsh-surface__process-count {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f1f4ff;
  color: #4d6bfe;
  font-size: 11px;
  font-weight: 650;
}
.od-dsh-surface__process-pulse {
  width: 10px;
  height: 10px;
  margin-top: 6px;
  border-radius: 50%;
  background: #4d6bfe;
  box-shadow: 0 0 0 5px rgba(77, 107, 254, 0.12);
  animation: od-report-pulse 1.4s ease-in-out infinite;
}
.od-dsh-surface__process-pulse.done { background: #16a34a; box-shadow: 0 0 0 5px rgba(22, 163, 74, 0.12); animation: none; }
.od-dsh-surface__process-pulse.error { background: #dc2626; box-shadow: 0 0 0 5px rgba(220, 38, 38, 0.12); animation: none; }
.od-dsh-surface__process-section-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 22px 2px 10px;
  color: #1f2329;
  font-size: 13px;
}
.od-dsh-surface__process-section-title span { color: #8f959e; font-size: 11px; }
.od-dsh-surface__process-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.od-dsh-surface__process-list li {
  --node-depth: 0;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: stretch;
  gap: 8px;
  margin-left: calc(var(--node-depth) * 12px);
}
.od-dsh-surface__process-rail {
  position: relative;
  display: flex;
  justify-content: center;
}
.od-dsh-surface__process-rail::after {
  content: '';
  position: absolute;
  top: 24px;
  bottom: -8px;
  width: 1px;
  background: #dfe3eb;
}
.od-dsh-surface__process-list li:last-child .od-dsh-surface__process-rail::after { display: none; }
.od-dsh-surface__process-list strong { color: #4e5969; font-size: 13px; font-weight: 600; }
.od-dsh-surface__process-list li.running strong { color: #1f2329; }
.od-dsh-surface__process-list li.done strong { color: #374151; }
.od-dsh-surface__process-dot {
  position: relative;
  z-index: 1;
  width: 8px;
  height: 8px;
  margin-top: 20px;
  border-radius: 50%;
  border: 2px solid #c7cbd1;
  background: #fff;
}
.od-dsh-surface__process-list li.running .od-dsh-surface__process-dot { border-color: #4d6bfe; background: #4d6bfe; }
.od-dsh-surface__process-list li.done .od-dsh-surface__process-dot { border-color: #16a34a; background: #16a34a; }
.od-dsh-surface__process-list li.error .od-dsh-surface__process-dot { border-color: #dc2626; background: #dc2626; }
.od-dsh-surface__node {
  min-width: 0;
  margin-bottom: 10px;
  border: 1px solid #e3e8f2;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}
.od-dsh-surface__node[open] { border-color: #cfd8ff; box-shadow: 0 4px 16px rgba(38, 58, 120, 0.06); }
.od-dsh-surface__node summary {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  cursor: pointer;
  list-style: none;
}
.od-dsh-surface__node summary::-webkit-details-marker { display: none; }
.od-dsh-surface__node-index {
  color: #a2a8b2;
  font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.od-dsh-surface__node-main { min-width: 0; }
.od-dsh-surface__node-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.od-dsh-surface__node-line code {
  padding: 2px 6px;
  border-radius: 4px;
  background: #f3f4f7;
  color: #697180;
  font: 500 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.od-dsh-surface__node-summary {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: #7b828c;
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.od-dsh-surface__node-duration { color: #8f959e; font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.od-dsh-surface__process-state { color: #9aa0a9; font-size: 11px; line-height: 20px; white-space: nowrap; }
.od-dsh-surface__process-list li.running .od-dsh-surface__process-state { color: #4d6bfe; }
.od-dsh-surface__process-list li.done .od-dsh-surface__process-state { color: #16a34a; }
.od-dsh-surface__process-list li.error .od-dsh-surface__process-state { color: #dc2626; }
.od-dsh-surface__node-detail {
  padding: 0 14px 14px 52px;
  border-top: 1px solid #eef1f5;
  background: #fbfcfe;
}
.od-dsh-surface__node-meta {
  display: flex;
  gap: 12px;
  padding: 11px 0;
  color: #8f959e;
  font-size: 11px;
}
.od-dsh-surface__node-meta strong { color: #4e5969; font-size: 11px; }
.od-dsh-surface__node-block { margin-top: 8px; }
.od-dsh-surface__node-block-title { margin-bottom: 6px; color: #8f959e; font-size: 10px; font-weight: 700; letter-spacing: .08em; }
.od-dsh-surface__node-block dl {
  display: grid;
  grid-template-columns: minmax(72px, 18%) minmax(0, 1fr);
  margin: 0;
  border: 1px solid #e5e8ee;
  border-radius: 7px;
  overflow: hidden;
  font-size: 11px;
}
.od-dsh-surface__node-block dt,
.od-dsh-surface__node-block dd { margin: 0; padding: 7px 9px; border-bottom: 1px solid #eceff3; }
.od-dsh-surface__node-block dt { background: #f4f6f9; color: #727986; }
.od-dsh-surface__node-block dd { background: #fff; color: #303846; overflow-wrap: anywhere; }
.od-dsh-surface__node-block dt:nth-last-of-type(1),
.od-dsh-surface__node-block dd:nth-last-of-type(1) { border-bottom: 0; }
.od-dsh-surface__node-block pre {
  margin: 0;
  padding: 9px 10px;
  border: 1px solid #e5e8ee;
  border-radius: 7px;
  background: #fff;
  color: #303846;
  font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.od-dsh-surface__node-empty { margin: 0 !important; padding: 8px 10px; border-radius: 7px; background: #f4f6f9; color: #8f959e !important; }
@keyframes od-report-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.84); }
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

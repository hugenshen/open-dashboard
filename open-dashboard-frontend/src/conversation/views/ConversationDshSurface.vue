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
/** 收起 / 切会话后忽略同一轮 progress，避免 400ms 轮询把右栏再打开。 */
const reportDismissed = ref(false)
const dismissedStartedAt = ref(0)
const linkedDashboardId = ref('')
const boardTitle = ref('')
const editorEpoch = ref(0)
const frameEl = ref<HTMLIFrameElement | null>(null)
const reportTitle = ref('')
const reportFilename = ref('')
/** Viewing format — commit always ships both HTML and Markdown payloads. */
const reportFormat = ref<'html' | 'markdown'>('html')
/** Analysis pane top-level tabs. File format is a second-level choice. */
const reportView = ref<'process' | 'browser' | 'files'>('process')
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
  code?: string
}
type ReportPlan = {
  stages: string[]
  stepStatus: Array<'not_started' | 'in_progress' | 'completed' | 'error'>
  steps: string[]
  taskIds?: string[]
}
type ReportArtifact = { name: string; type: string; content: string; size: number }
const reportProcessSteps = ref<ReportProcessStep[]>([])
const reportPlan = ref<ReportPlan>({ stages: [], stepStatus: [], steps: [] })
const reportArtifacts = ref<ReportArtifact[]>([])
const selectedArtifactName = ref('')
const reportProcessStatus = ref<'running' | 'done' | 'error'>('running')
const reportActiveNode = ref('')
const reportNarrative = ref('')
const selectedStepId = ref('')
const followPinned = ref(false)
const planExpanded = ref(false)
const followStep = computed(() => {
  const steps = reportProcessSteps.value
  if (!steps.length) return null
  const selected = steps.find((step) => step.id === selectedStepId.value)
  if (selected) return selected
  return [...steps].reverse().find((step) => step.status === 'running' && step.nodeName !== 'od_board_worker')
    || [...steps].reverse().find((step) => step.status === 'running')
    || [...steps].reverse().find((step) => step.status === 'done')
    || steps[0]
})
const followMarkdown = computed(() => {
  const step = followStep.value
  const parts: string[] = []
  if (step?.title) parts.push(`### ${step.title}`)
  if (step?.detail) parts.push(step.detail)
  if (step?.code) parts.push(`\`\`\`python\n${step.code}\n\`\`\``)
  if (step?.output) parts.push(step.output)
  else if (reportNarrative.value) {
    const last = reportNarrative.value.split('\n\n').filter(Boolean).pop()
    if (last) parts.push(last)
  }
  return parts.join('\n\n')
})
const followHtml = computed(() => renderMarkdownLite(followMarkdown.value))
const planIndex = computed(() => {
  const statuses = reportPlan.value.stepStatus
  if (!statuses.length) return 0
  const active = statuses.findIndex((status) => status === 'in_progress' || status === 'error')
  if (active >= 0) return active
  const lastCompleted = statuses.reduce((last, status, index) => status === 'completed' ? index : last, -1)
  return Math.max(0, lastCompleted)
})
const planStage = computed(() => {
  const index = planIndex.value
  const title = reportPlan.value.stages[index]
  if (!title) return null
  const status = reportPlan.value.stepStatus[index]
  return {
    id: reportPlan.value.taskIds?.[index] || `plan-${index + 1}`,
    title,
    detail: reportPlan.value.steps[index] || '',
    status: status === 'completed' ? 'done' : status === 'in_progress' ? 'running' : status === 'error' ? 'error' : 'pending',
  } as ReportProcessStep
})
const planStatusLabel = computed(() => {
  const status = planStage.value?.status
  if (status === 'done') return '已完成'
  if (status === 'running') return '进行中'
  if (status === 'error') return '失败'
  return '未开始'
})

const followIndex = computed(() => {
  const step = followStep.value
  if (!step) return 0
  return Math.max(0, reportProcessSteps.value.findIndex((item) => item.id === step.id))
})

const browserSteps = computed(() => reportProcessSteps.value.filter((step) => {
  const key = `${step.nodeName || ''} ${step.category || ''} ${step.title}`.toLowerCase()
  return /(browser|search|web|网页|搜索)/.test(key)
}))

const reportFiles = computed(() => {
  const base = String(reportFilename.value || 'analysis-report').replace(/\.(html?|md|markdown)$/i, '')
  return [
    ...reportArtifacts.value.map((file) => ({ format: 'artifact' as const, name: file.name, size: file.size })),
    reportHtml.value ? { format: 'html' as const, name: `${base}.html`, size: new Blob([reportHtml.value]).size } : null,
    reportMarkdown.value ? { format: 'markdown' as const, name: `${base}.md`, size: new Blob([reportMarkdown.value]).size } : null,
  ].filter(Boolean) as Array<{ format: 'artifact' | 'html' | 'markdown'; name: string; size: number }>
})

const selectedArtifact = computed(() => reportArtifacts.value.find((file) => file.name === selectedArtifactName.value) || null)

const reportDisplayName = computed(() => {
  if (selectedArtifact.value) return selectedArtifact.value.name
  const base = String(reportFilename.value || 'analysis-report').replace(/\.(html?|md|markdown)$/i, '')
  return reportFormat.value === 'markdown' ? `${base}.md` : `${base}.html`
})

const dshBase = computed(() =>
  (import.meta.env.VITE_OD_DSH_URL as string) || '/dsh/',
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
const selectedFileHtml = computed(() => selectedArtifact.value
  ? renderMarkdownLite(selectedArtifact.value.content)
  : reportMdHtml.value)

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
  let inFence = false
  const fence: string[] = []
  const flushFence = () => {
    if (!inFence) return
    out.push(`<pre class="od-md-code"><code>${fence.join('\n')}</code></pre>`)
    fence.length = 0
    inFence = false
  }
  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (inFence) {
        flushList()
        flushTable()
        flushFence()
      } else {
        flushList()
        flushTable()
        inFence = true
      }
      continue
    }
    if (inFence) {
      fence.push(escapeHtml(raw))
      continue
    }
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
    if (line.startsWith('#### ')) {
      flushList()
      out.push(`<h4>${inline(line.slice(5))}</h4>`)
    } else if (line.startsWith('### ')) {
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
  flushFence()
  return out.join('')
}

function setReportFormat(fmt: 'html' | 'markdown') {
  if (!hasReport.value) return
  if (fmt === 'markdown' && !reportMarkdown.value) return
  if (fmt === 'html' && !reportHtml.value) return
  reportFormat.value = fmt
  selectedArtifactName.value = ''
  reportView.value = 'files'
}

function selectReportFile(file: { format: 'artifact' | 'html' | 'markdown'; name: string }) {
  if (file.format === 'artifact') {
    selectedArtifactName.value = file.name
    reportView.value = 'files'
    return
  }
  setReportFormat(file.format)
}

function showReportProcess() {
  reportView.value = 'process'
}

function showBrowser() {
  reportView.value = 'browser'
}

function showFiles() {
  reportView.value = 'files'
}

function downloadReport() {
  const artifact = selectedArtifact.value
  const isMd = artifact ? true : reportFormat.value === 'markdown'
  const body = artifact?.content || (isMd ? reportMarkdown.value : reportHtml.value)
  if (!body) return
  const blob = new Blob([body], { type: isMd ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = reportDisplayName.value
  a.click()
  URL.revokeObjectURL(url)
}

async function copyReport() {
  const body = selectedArtifact.value?.content || (reportFormat.value === 'markdown' ? reportMarkdown.value : reportHtml.value)
  if (!body || !navigator.clipboard) return
  await navigator.clipboard.writeText(body)
}

function selectFollowOffset(offset: number) {
  const steps = reportProcessSteps.value
  if (!steps.length) return
  const next = Math.min(steps.length - 1, Math.max(0, followIndex.value + offset))
  selectedStepId.value = steps[next]?.id || ''
  followPinned.value = next !== steps.length - 1
  reportView.value = 'process'
}

function resumeLiveFollow() {
  selectedStepId.value = ''
  followPinned.value = false
  reportView.value = 'process'
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

function isDismissedRun(startedAt) {
  if (!reportDismissed.value) return false
  const at = Number(startedAt || 0)
  if (!at) return true
  return at <= dismissedStartedAt.value
}

function closeReport() {
  reportDismissed.value = true
  dismissedStartedAt.value = Date.now()
  hasReport.value = false
  hasReportProcess.value = false
  reportTitle.value = ''
  reportFilename.value = ''
  reportHtml.value = ''
  reportMarkdown.value = ''
  reportFormat.value = 'html'
  reportView.value = 'process'
  reportProcessSteps.value = []
  reportPlan.value = { stages: [], stepStatus: [], steps: [] }
  reportArtifacts.value = []
  selectedArtifactName.value = ''
  reportProcessStatus.value = 'running'
  reportActiveNode.value = ''
  reportNarrative.value = ''
  selectedStepId.value = ''
  followPinned.value = false
  planExpanded.value = false
}

function openReportProcess(payload: {
  title?: string
  status?: string
  startedAt?: number
  activeNode?: string
  narrative?: string
  steps?: ReportProcessStep[]
  plan?: ReportPlan
  files?: ReportArtifact[]
}) {
  if (payload.status === 'idle' || isDismissedRun(payload.startedAt)) return
  reportDismissed.value = false
  closeDash()
  const fileReady = hasReport.value && Boolean(reportHtml.value || reportMarkdown.value)
  hasReportProcess.value = true
  if (!fileReady) {
    hasReport.value = false
    reportView.value = 'process'
  }
  reportTitle.value = String(payload.title || reportTitle.value || '分析报告')
  if (fileReady) {
    reportProcessStatus.value = payload.status === 'error' ? 'error' : 'done'
  } else {
    reportProcessStatus.value = payload.status === 'error'
      ? 'error'
      : payload.status === 'done'
        ? 'done'
        : 'running'
    reportActiveNode.value = String(payload.activeNode || '')
  }
  if (payload.narrative != null) reportNarrative.value = String(payload.narrative)
  if (payload.plan && Array.isArray(payload.plan.stages)) {
    reportPlan.value = {
      stages: payload.plan.stages.map(String),
      stepStatus: (payload.plan.stepStatus || []).map((status) => (
        ['not_started', 'in_progress', 'completed', 'error'].includes(status) ? status : 'not_started'
      )),
      steps: (payload.plan.steps || []).map(String),
      taskIds: Array.isArray(payload.plan.taskIds) ? payload.plan.taskIds.map(String) : undefined,
    }
  }
  if (Array.isArray(payload.files)) {
    reportArtifacts.value = payload.files.map((file) => ({
      name: String(file.name || ''),
      type: String(file.type || 'markdown'),
      content: String(file.content || ''),
      size: Math.max(0, Number(file.size || new Blob([String(file.content || '')]).size)),
    })).filter((file) => file.name)
  }
  reportProcessSteps.value = Array.isArray(payload.steps)
    ? payload.steps.map((step, index) => ({
      id: String(step.id || `step-${index + 1}`),
      nodeName: step.nodeName ? String(step.nodeName) : undefined,
      category: step.category ? String(step.category) : undefined,
      title: String(step.title || `步骤 ${index + 1}`),
      detail: step.detail ? String(step.detail) : undefined,
      status: fileReady
        ? (step.status === 'error' ? 'error' : 'done')
        : ['pending', 'running', 'done', 'error'].includes(step.status)
          ? step.status
        : 'pending',
      depth: Math.max(0, Number(step.depth || 0)),
      durationMs: Math.max(0, Number(step.durationMs || 0)),
      inputs: Array.isArray(step.inputs)
        ? step.inputs.map((item) => ({ label: String(item.label || ''), value: String(item.value || '') })).filter((item) => item.label && item.value)
        : [],
      output: fileReady && String(step.nodeName || '') === 'od_commit_report'
        ? '报告文件已生成，可在「文件」中查看 HTML / Markdown。'
        : step.output ? String(step.output) : undefined,
      code: step.code ? String(step.code) : undefined,
    }))
    : reportProcessSteps.value
  if (!followPinned.value) selectedStepId.value = ''
  else if (!reportProcessSteps.value.some((step) => step.id === selectedStepId.value)) resumeLiveFollow()
}

function selectReportStep(id: string) {
  selectedStepId.value = String(id || '')
  followPinned.value = true
  reportView.value = 'process'
  planExpanded.value = true
}

function openReport(payload: {
  title?: string
  format?: string
  filename?: string
  html?: string
  markdown?: string
  startedAt?: number
}) {
  if (isDismissedRun(payload.startedAt)) return
  reportDismissed.value = false
  closeDash()
  reportTitle.value = String(payload.title || '分析报告')
  reportFilename.value = String(payload.filename || (payload.format === 'markdown' ? 'analysis-report.md' : 'analysis-report.html'))
  reportFormat.value = String(payload.format || '').toLowerCase() === 'markdown' ? 'markdown' : 'html'
  selectedArtifactName.value = ''
  reportView.value = 'files'
  reportProcessStatus.value = 'done'
  reportActiveNode.value = '报告已生成'
  reportProcessSteps.value = reportProcessSteps.value.map((step) => (
    step.status === 'running' ? { ...step, status: 'done' } : step
  ))
  reportHtml.value = String(payload.html || '')
  reportMarkdown.value = String(payload.markdown || '')
  hasReport.value = Boolean(reportHtml.value || reportMarkdown.value)
  hasReportProcess.value = reportProcessSteps.value.length > 0 || hasReportProcess.value
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
      startedAt: data.startedAt != null ? Number(data.startedAt) : undefined,
    })
    return
  }
  if (data.type === 'od-report-select-step') {
    selectReportStep(String(data.id || ''))
    return
  }
  if (data.type === 'od-report-progress') {
    openReportProcess({
      title: data.title ? String(data.title) : undefined,
      status: data.status ? String(data.status) : undefined,
      startedAt: data.startedAt != null ? Number(data.startedAt) : undefined,
      activeNode: data.activeNode ? String(data.activeNode) : undefined,
      narrative: data.narrative != null ? String(data.narrative) : undefined,
      steps: Array.isArray(data.steps) ? data.steps : undefined,
      plan: data.plan && typeof data.plan === 'object' ? data.plan : undefined,
      files: Array.isArray(data.files) ? data.files : undefined,
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
        <div class="od-dsh-surface__dash-title">分析</div>
        <span class="od-dsh-surface__dash-id" :title="reportTitle">{{ reportTitle }}</span>
        <span class="od-dsh-surface__sp" />
        <button type="button" class="od-dsh-surface__btn ghost" @click="closeReport">收起</button>
      </header>
      <nav class="od-dsh-surface__workspace-tabs" role="tablist" aria-label="分析">
        <button type="button" role="tab" :class="{ on: reportView === 'process' }" :aria-selected="reportView === 'process'" @click="showReportProcess">实时跟随</button>
        <button type="button" role="tab" :class="{ on: reportView === 'browser' }" :aria-selected="reportView === 'browser'" @click="showBrowser">浏览器</button>
        <button type="button" role="tab" :class="{ on: reportView === 'files' }" :aria-selected="reportView === 'files'" @click="showFiles">文件</button>
      </nav>
      <div class="od-dsh-surface__dash-body">
        <div v-if="reportView === 'process'" class="od-dsh-surface__report-process">
          <div class="od-dsh-surface__workspace">
            <div class="od-dsh-surface__follow-title">{{ followStep?.title || '任务跟随' }}</div>
            <div class="od-dsh-surface__follow-body">
              <template v-if="followStep">
                <div class="od-dsh-surface__follow-meta">
                  <span class="od-dsh-surface__process-dot" :class="followStep.status" />
                  <code>{{ followStep.nodeName || followStep.category || 'agent' }}</code>
                  <span>{{ followStep.status === 'done' ? '已完成' : followStep.status === 'error' ? '失败' : '执行中' }}</span>
                  <span v-if="followStep.durationMs">{{ (followStep.durationMs / 1000).toFixed(1) }}s</span>
                </div>
                <p v-if="followStep.detail" class="od-dsh-surface__follow-detail">{{ followStep.detail }}</p>
                <dl v-if="followStep.inputs?.length" class="od-dsh-surface__follow-inputs">
                  <template v-for="item in followStep.inputs" :key="`${item.label}:${item.value}`">
                    <dt>{{ item.label }}</dt><dd>{{ item.value }}</dd>
                  </template>
                </dl>
                <pre v-if="followStep.code" class="od-dsh-surface__tool-output"><code>{{ followStep.code }}</code></pre>
                <pre v-if="followStep.output" class="od-dsh-surface__tool-output"><code>{{ followStep.output }}</code></pre>
                <div v-else-if="followHtml" class="od-dsh-surface__process-narrative-body" v-html="followHtml" />
              </template>
              <p v-else class="od-dsh-surface__node-empty">任务正在执行，产出会实时出现在这里</p>
            </div>
            <div v-if="reportProcessSteps.length" class="od-dsh-surface__follow-nav">
              <button type="button" :disabled="followIndex <= 0" aria-label="上一个节点" @click="selectFollowOffset(-1)">‹</button>
              <button type="button" :disabled="followIndex >= reportProcessSteps.length - 1" aria-label="下一个节点" @click="selectFollowOffset(1)">›</button>
              <div class="od-dsh-surface__follow-track"><span :style="{ width: `${((followIndex + 1) / reportProcessSteps.length) * 100}%` }" /></div>
              <span>{{ followIndex + 1 }} / {{ reportProcessSteps.length }}</span>
              <button v-if="followPinned" type="button" class="live" @click="resumeLiveFollow">回到实时</button>
            </div>
          </div>
          <div v-if="reportPlan.stages.length" class="od-dsh-surface__plan">
            <button type="button" class="od-dsh-surface__plan-head" @click="planExpanded = !planExpanded">
              <span>任务进度</span>
              <span class="od-dsh-surface__plan-count">{{ planIndex + 1 }} / {{ reportPlan.stages.length }}</span>
            </button>
            <div v-if="!planExpanded && planStage" class="od-dsh-surface__plan-current">
              <span class="od-dsh-surface__process-dot" :class="planStage.status" />
              <div>
                <strong>{{ planStage.title }}</strong>
                <p>{{ planStage.detail || planStatusLabel }}</p>
              </div>
            </div>
            <ol v-else class="od-dsh-surface__plan-list">
              <li
                v-for="(stage, index) in reportPlan.stages"
                :key="reportPlan.taskIds?.[index] || `plan-${index}`"
                :class="[
                  reportPlan.stepStatus[index] === 'completed' ? 'done' : reportPlan.stepStatus[index] === 'in_progress' ? 'running' : reportPlan.stepStatus[index],
                  { selected: index === planIndex },
                ]"
              >
                <span class="od-dsh-surface__process-dot" :class="reportPlan.stepStatus[index] === 'completed' ? 'done' : reportPlan.stepStatus[index] === 'in_progress' ? 'running' : reportPlan.stepStatus[index]" />
                <div>
                  <strong>{{ stage }}</strong>
                  <p>{{ reportPlan.steps[index] }}</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
        <div v-else-if="reportView === 'browser'" class="od-dsh-surface__browser-list">
          <article v-for="step in browserSteps" :key="step.id" @click="selectReportStep(step.id)">
            <span class="od-dsh-surface__browser-icon">⌕</span>
            <div><strong>{{ step.title }}</strong><p>{{ step.detail || step.output || '网页访问记录' }}</p></div>
            <span>{{ step.status === 'done' ? '已完成' : '执行中' }}</span>
          </article>
          <div v-if="!browserSteps.length" class="od-dsh-surface__workspace-empty">
            <span>⌕</span><strong>本次任务未使用浏览器</strong><p>网页搜索或访问记录会按时间出现在这里。</p>
          </div>
        </div>
        <div v-else class="od-dsh-surface__files-view">
          <aside class="od-dsh-surface__file-list">
            <button v-for="file in reportFiles" :key="file.name" type="button" :class="{ on: file.format === 'artifact' ? selectedArtifactName === file.name : !selectedArtifactName && reportFormat === file.format }" @click="selectReportFile(file)">
              <span class="od-dsh-surface__file-type">{{ file.format === 'html' ? 'HTML' : 'MD' }}</span>
              <span><strong>{{ file.name }}</strong><small>{{ Math.max(1, Math.round(file.size / 1024)) }} KB · {{ file.format === 'artifact' ? '分析任务产物' : '最终报告' }}</small></span>
            </button>
            <div v-if="!reportFiles.length" class="od-dsh-surface__file-wait">每个 data_analysis 子任务完成后，文件会实时出现在这里。</div>
          </aside>
          <section v-if="hasReport || selectedArtifact" class="od-dsh-surface__file-preview">
            <header>
              <strong>{{ reportDisplayName }}</strong>
              <span class="od-dsh-surface__sp" />
              <button type="button" @click="copyReport">复制</button>
              <button type="button" @click="downloadReport">下载</button>
            </header>
            <iframe v-if="!selectedArtifact && reportFormat === 'html'" class="od-dsh-surface__report-frame" title="分析报告" sandbox="" :srcdoc="reportHtml" />
            <div v-else class="od-dsh-surface__report-md" v-html="selectedFileHtml" />
          </section>
        </div>
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
.od-dsh-surface__workspace-tabs {
  flex: none;
  height: 38px;
  padding: 0 16px;
  display: flex;
  align-items: flex-end;
  gap: 24px;
  border-bottom: 1px solid #e9e9f0;
  background: #fff;
}
.od-dsh-surface__workspace-tabs button {
  height: 38px;
  padding: 0 2px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #646a73;
  font-size: 13px;
  cursor: pointer;
}
.od-dsh-surface__workspace-tabs button.on { color: #1f2329; border-bottom-color: #4040ff; font-weight: 650; }
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px 16px 16px;
  background: #fff;
}
.od-dsh-surface__workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #e9e9f0;
  border-radius: 12px;
  overflow: hidden;
}
.od-dsh-surface__follow-title {
  flex: none;
  height: 34px;
  padding: 0 16px;
  border-bottom: 1px solid #e9e9f0;
  color: #1f2329;
  font-size: 12px;
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
}
.od-dsh-surface__follow-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
.od-dsh-surface__follow-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: #646a73; font-size: 12px; }
.od-dsh-surface__follow-meta .od-dsh-surface__process-dot { margin-top: 0; }
.od-dsh-surface__follow-meta code { padding: 2px 6px; border-radius: 5px; background: #f2f3f5; color: #4040ff; font-size: 11px; }
.od-dsh-surface__follow-detail { margin: 0 0 12px; color: #303133; font-size: 13px; line-height: 1.6; }
.od-dsh-surface__follow-inputs { display: grid; grid-template-columns: minmax(90px, auto) 1fr; margin: 0 0 12px; border: 1px solid #e6e8eb; border-radius: 8px; overflow: hidden; font-size: 12px; }
.od-dsh-surface__follow-inputs dt,
.od-dsh-surface__follow-inputs dd { margin: 0; padding: 7px 9px; border-bottom: 1px solid #eceef2; overflow-wrap: anywhere; }
.od-dsh-surface__follow-inputs dt { background: #f7f8fa; color: #646a73; font-weight: 600; }
.od-dsh-surface__follow-inputs dd { color: #303133; }
.od-dsh-surface__tool-output { margin: 0; padding: 14px 16px; border-radius: 8px; background: #0b0d12; color: #d6dae3; font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow: auto; }
.od-dsh-surface__follow-nav { flex: none; height: 38px; padding: 0 12px; display: flex; align-items: center; gap: 8px; border-top: 1px solid #e9e9f0; color: #848581; font-size: 11px; }
.od-dsh-surface__follow-nav button { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #525865; font-size: 20px; cursor: pointer; }
.od-dsh-surface__follow-nav button:hover:not(:disabled) { background: #f0f1f4; }
.od-dsh-surface__follow-nav button:disabled { opacity: .35; cursor: default; }
.od-dsh-surface__follow-nav button.live { width: auto; padding: 0 7px; color: #4040ff; font-size: 11px; }
.od-dsh-surface__follow-track { flex: 1; height: 3px; border-radius: 99px; overflow: hidden; background: #e6e8eb; }
.od-dsh-surface__follow-track span { display: block; height: 100%; border-radius: inherit; background: #6464ff; transition: width .2s; }
.od-dsh-surface__process-narrative-body { font-size: 13px; line-height: 1.6; color: #1f2329; }
.od-dsh-surface__process-narrative-body :deep(p) { margin: 0 0 8px; }
.od-dsh-surface__process-narrative-body :deep(strong) { font-weight: 650; }
.od-dsh-surface__process-narrative-body :deep(ul) { margin: 0 0 8px 18px; }
.od-dsh-surface__process-narrative-body :deep(pre),
.od-dsh-surface__report-md :deep(pre) {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: auto;
  white-space: pre-wrap;
}
.od-dsh-surface__plan {
  flex: none;
  margin-top: 12px;
  padding: 12px 16px 8px;
  border: 1px solid #e9e9f0;
  border-radius: 12px;
  background: #fff;
}
.od-dsh-surface__plan-head {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #1f2329;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.od-dsh-surface__plan-count {
  margin-left: auto;
  color: #848581;
  font-size: 12px;
}
.od-dsh-surface__plan-current,
.od-dsh-surface__plan-list li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0 4px;
}
.od-dsh-surface__plan-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 6px;
  background: #f9f9fc;
}
.od-dsh-surface__plan-list li {
  cursor: pointer;
  border-radius: 6px;
  padding: 8px;
}
.od-dsh-surface__plan-list li.selected { background: #eef1ff; }
.od-dsh-surface__plan-current strong,
.od-dsh-surface__plan-list strong { color: #27272a; font-size: 13px; font-weight: 600; }
.od-dsh-surface__plan-current p,
.od-dsh-surface__plan-list p { margin: 2px 0 0; color: #2029459e; font-size: 12px; line-height: 1.45; }
.od-dsh-surface__process-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  border: 2px solid #c7cbd1;
  background: #fff;
}
.od-dsh-surface__process-dot.running { border-color: #4040ff; background: #4040ff; box-shadow: 0 0 0 4px rgba(64, 64, 255, 0.15); }
.od-dsh-surface__process-dot.done { border-color: #16a34a; background: #16a34a; }
.od-dsh-surface__process-dot.error { border-color: #dc2626; background: #dc2626; }
.od-dsh-surface__process-dot.pending { border-color: #c7cbd1; background: #fff; }
.od-dsh-surface__node-empty { margin: 0 !important; padding: 8px 10px; border-radius: 7px; background: #f4f6f9; color: #8f959e !important; }
.od-dsh-surface__browser-list { position: absolute; inset: 0; overflow: auto; padding: 16px; }
.od-dsh-surface__browser-list article { display: grid; grid-template-columns: 24px 1fr auto; gap: 8px; align-items: start; padding: 12px 4px; border-bottom: 1px solid #eceef2; cursor: pointer; }
.od-dsh-surface__browser-list article:hover { background: #fafaff; }
.od-dsh-surface__browser-list article strong { color: #303133; font-size: 13px; }
.od-dsh-surface__browser-list article p { margin: 4px 0 0; color: #848581; font-size: 12px; line-height: 1.45; }
.od-dsh-surface__browser-list article > span:last-child { color: #848581; font-size: 11px; }
.od-dsh-surface__browser-icon { color: #4040ff; font-size: 18px; }
.od-dsh-surface__workspace-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #8f959e; text-align: center; }
.od-dsh-surface__workspace-empty > span { font-size: 28px; color: #b8bfc7; }
.od-dsh-surface__workspace-empty strong { color: #646a73; font-size: 13px; }
.od-dsh-surface__workspace-empty p { margin: 0; font-size: 12px; }
.od-dsh-surface__files-view { position: absolute; inset: 0; display: flex; min-width: 0; }
.od-dsh-surface__file-list { flex: 0 0 210px; padding: 12px; overflow: auto; border-right: 1px solid #e9e9f0; background: #fafbfc; }
.od-dsh-surface__file-list > button { width: 100%; display: flex; gap: 9px; align-items: center; padding: 9px; border: 1px solid transparent; border-radius: 8px; background: transparent; text-align: left; cursor: pointer; }
.od-dsh-surface__file-list > button:hover,
.od-dsh-surface__file-list > button.on { border-color: #dcdfff; background: #f0f1ff; }
.od-dsh-surface__file-list > button > span:last-child { min-width: 0; display: flex; flex-direction: column; }
.od-dsh-surface__file-list strong { overflow: hidden; color: #303133; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.od-dsh-surface__file-list small { margin-top: 3px; color: #8f959e; font-size: 10px; }
.od-dsh-surface__file-type { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 6px; background: #fff; color: #4040ff; box-shadow: 0 1px 4px rgba(31,35,41,.1); font-size: 9px; font-weight: 700; }
.od-dsh-surface__file-wait { padding: 12px 8px; color: #8f959e; font-size: 12px; line-height: 1.6; }
.od-dsh-surface__file-preview { position: relative; flex: 1; min-width: 0; }
.od-dsh-surface__file-preview > header { height: 38px; padding: 0 12px; display: flex; align-items: center; border-bottom: 1px solid #e9e9f0; font-size: 12px; }
.od-dsh-surface__file-preview > header button { height: 24px; margin-left: 6px; padding: 0 8px; border: 1px solid #d0d3d6; border-radius: 5px; background: #fff; color: #525865; font-size: 11px; cursor: pointer; }
.od-dsh-surface__file-preview .od-dsh-surface__report-frame,
.od-dsh-surface__file-preview .od-dsh-surface__report-md { top: 38px; }
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
.od-dsh-surface__report-md :deep(h4) { font-size: 13px; margin: 14px 0 6px; }
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

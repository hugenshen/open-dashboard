<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ModuleTopbar from '../../shell/ModuleTopbar.vue'
import { datasetApi, type DatasetMetaVO } from '../../datasource/api'
import {
  conversationApi,
  type ConversationMessageVO,
  type ConversationVO,
  type StylePresetVO
} from '../api'
import ToolStepList, { type ToolPreview, type ToolStep } from '../components/ToolStepList.vue'

type ChatLine = { role: 'user' | 'assistant' | 'system'; text: string; tools?: ToolStep[] }
type StepLine = { id: string; label: string }
type QueryBarItem = { kind?: string; field?: string; label?: string }
type QueryBar = { label?: string; items: QueryBarItem[] }
type ChartReady = {
  chartId: string
  dashboardId: string
  rowCount?: number
  title?: string
  chartType?: string
  datasetId?: string
  encode?: Record<string, unknown>
  labels?: string[]
  heights?: number[]
  kpiValue?: unknown
}
type AnswerTable = {
  title: string
  columns: string[]
  rows: unknown[][]
  rowCount: number
  truncated?: boolean
  sql?: string
}
type AnswerChart = {
  title: string
  chartType: string
  datasetId: string
  datasetName?: string
  encode: Record<string, unknown>
  rowCount: number
  labels: string[]
  heights: number[]
  insightHtml?: string
  question?: string
  follows?: string[]
}
type AnswerInsight = {
  title: string
  headlineHtml: string
  insightHtml: string
  drivers: Array<{ k?: string; d?: string; delta?: string; neg?: boolean }>
  follows: string[]
  question?: string
  datasetName?: string
}
type AnswerClarify = {
  title: string
  headlineHtml: string
  insightHtml: string
  follows: string[]
  question?: string
}
type IntentMap = {
  rewrite?: string
  datasetName?: string
  time?: { field?: string; label?: string; phrase?: string }
  mapping: Array<{ phrase: string; kind: string; field?: string; label?: string; note?: string }>
  unresolved: Array<{ phrase: string; reason: string }>
}

const router = useRouter()
const enabled = ref(false)
const loading = ref(true)
const error = ref('')
const phase = ref<'landing' | 'workspace'>('landing')
const sidePanel = ref<'none' | 'history' | 'explore'>('none')
const sideSlim = ref(false)

const conversations = ref<ConversationVO[]>([])
const current = ref<ConversationVO | null>(null)
const messages = ref<ConversationMessageVO[]>([])
const chat = ref<ChatLine[]>([])
const steps = ref<StepLine[]>([])
const charts = ref<ChartReady[]>([])
const boardTitle = ref('数据分析看板')
const emptyPreview = ref(false)
const queryBar = ref<QueryBar | null>(null)
const styles = ref<StylePresetVO[]>([])
const datasets = ref<DatasetMetaVO[]>([])

const prompt = ref('')
const intent = ref<'ask' | 'gen'>('ask')
const mode = ref<'auto' | 'plan'>('auto')
const styleId = ref('feishu-blue')
const selectedDatasets = ref<string[]>([])
const streaming = ref(false)
const runId = ref('')
const awaitingConfirm = ref(false)
const canAdopt = ref(false)
const planPayload = ref<Record<string, unknown> | null>(null)
const linkedDashboardId = ref<string | null>(null)
const assistantBuf = ref('')
const answerTable = ref<AnswerTable | null>(null)
const answerChart = ref<AnswerChart | null>(null)
const answerInsight = ref<AnswerInsight | null>(null)
const answerClarify = ref<AnswerClarify | null>(null)
const lastIntent = ref('')
const lastQuestion = ref('')
const intentMap = ref<IntentMap | null>(null)
const dsMenuOpen = ref(false)

const EXAMPLES = [
  { label: '区域销售额', text: '各区域销售额分别是多少？按从高到低排一下。', intent: 'ask' as const },
  { label: '渠道利润对比', text: '线上和线下渠道的利润对比如何？', intent: 'ask' as const },
  { label: '营收趋势', text: '近几个月营收趋势怎么样？哪个月最高？', intent: 'ask' as const },
  { label: '华南为什么下滑？', text: '华南为什么下滑？', intent: 'ask' as const },
  { label: '直接生成仪表盘', text: '根据当前数据集生成分析看板', intent: 'gen' as const }
]

const TOOL_LABELS: Record<string, string> = {
  write_todos: '规划任务',
  od_list_datasets: '列出数据集',
  od_profile_dataset: '分析数据特征',
  od_plan_charts: '按特征规划图表',
  od_get_schema: '读取字段 Schema',
  od_run_query: '试查询',
  od_run_sql: '执行 SQL',
  od_get_board_summary: '读取当前看板',
  od_layout_board: '编排看板布局',
  od_compose_board: '平台构图兜底',
  od_emit_patch: '写入看板草稿',
  od_finish: '完成',
  schema: '读取字段 Schema',
  sqlbot: 'SQLBot 生成 SQL',
  sqlbot_sql: 'SQL 已生成',
  sqlbot_exec: '执行查询'
}

const liveTools = ref<ToolStep[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const importHint = ref('')

const canSend = computed(() => prompt.value.trim().length > 0 && !streaming.value)
const hasAnswer = computed(
  () => !!(answerChart.value || answerInsight.value || answerTable.value || answerClarify.value)
)
const canSave = computed(() => canAdopt.value && !answerClarify.value && !!(answerChart.value || answerInsight.value))
const ctxName = computed(() => {
  const ids = selectedDatasets.value
  if (!ids.length) return '未选数据集'
  const hit = datasets.value.find((d) => d.id === ids[0])
  return hit?.name || ids[0]
})
const previewDatasetName = computed(() => {
  const id = charts.value[0]?.datasetId
  if (!id) return ctxName.value
  return datasets.value.find((d) => d.id === id)?.name || id
})
function isLiveChart(c: ChartReady): boolean {
  if ((c.rowCount || 0) <= 0) return false
  if (c.chartType === 'kpi' && (c.kpiValue == null || c.kpiValue === '')) return false
  return true
}
function isTableType(t?: string): boolean {
  return t === 'table' || t === 'grouptable'
}
const kpiCharts = computed(() => charts.value.filter((x) => x.chartType === 'kpi' && isLiveChart(x)))
const plotCharts = computed(() =>
  charts.value.filter((x) => x.chartType !== 'kpi' && !isTableType(x.chartType) && isLiveChart(x))
)
const tableCharts = computed(() => charts.value.filter((x) => isTableType(x.chartType) && isLiveChart(x)))

function formatKpi(v: unknown): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) return String(v)
  if (Math.abs(n) >= 10000) return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function pickDefaultDatasets(list: DatasetMetaVO[]): string[] {
  const score = (d: DatasetMetaVO) => {
    const n = `${d.name || ''} ${d.tableName || ''} ${d.folder || ''}`
    let s = 0
    if (/验证|测试|工作室|拖拽|de_|dashboard|dashborad|数据源清单|低能/i.test(n)) s -= 120
    if (/订单|代理|销售|财务|运营|order|sales|agent/.test(n)) s += 50
    return s
  }
  const ranked = [...list].sort((a, b) => score(b) - score(a))
  return ranked[0] ? [ranked[0].id] : list[0] ? [list[0].id] : []
}

function barHeightsFromRows(rows: unknown[][]): number[] {
  const nums = rows.slice(0, 8).map((r) => {
    const v = r?.[1]
    const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''))
    return Number.isFinite(n) ? Math.abs(n) : 0
  })
  const max = Math.max(1, ...nums)
  return nums.map((n) => Math.round(Math.max(8, (n / max) * 100)))
}

function ingestLiveTool(
  id: string,
  rawLabel: string,
  kind: string,
  tool: string,
  preview?: ToolPreview,
  hint?: string,
  parent?: string
) {
  if (/^(turn_|message_end|agent_end|agent_start|context|think)/.test(id)) return
  if (/推理轮次|轮次\s*\d+\s*结束|transformContext|model=|skills \+ memory|assistant turn|^Pi Agent|^Lead /i.test(rawLabel)) return
  const toolName = tool || (rawLabel.match(/od_[a-z_]+/) || [])[0] || ''
  const label =
    (toolName && TOOL_LABELS[toolName]) ||
    TOOL_LABELS[id] ||
    rawLabel.replace(/^调用\s+/, '').replace(/\s+完成$/, '') ||
    id
  const ended = kind === 'tool_end' || id === 'tool_execution_end'
  const child: ToolStep = {
    id: toolName || id,
    label,
    status: ended ? 'done' : 'run',
    tool: toolName || undefined,
    preview,
    hint,
    open: !!preview
  }
  if (parent) {
    const host = [...liveTools.value]
      .reverse()
      .find((t) => t.tool === parent || t.id === parent)
    if (host) {
      if (!host.children) host.children = []
      host.open = true
      if (ended) {
        const hit = [...host.children]
          .reverse()
          .find((t) => t.status === 'run' && (!toolName || t.tool === toolName || t.id === id))
        if (hit) {
          hit.status = 'done'
          hit.label = label
          if (preview) hit.preview = preview
          if (hint) hit.hint = hint
        } else {
          host.children.push(child)
        }
      } else {
        const running = host.children.find((t) => t.status === 'run' && (t.tool === toolName || t.id === id))
        if (running) {
          running.label = label
          if (preview) running.preview = preview
          if (hint) running.hint = hint
        } else {
          host.children.push({ ...child, status: 'run' })
        }
      }
      return
    }
  }
  if (ended) {
    const hit = [...liveTools.value].reverse().find((t) => t.status === 'run' && (!toolName || t.tool === toolName))
    if (hit) {
      hit.status = 'done'
      if (preview) hit.preview = preview
      if (hint) hit.hint = hint
      if (hit.preview || hit.children?.length) hit.open = true
    } else {
      liveTools.value.push({
        id: `${toolName || id}-${liveTools.value.length}`,
        label,
        status: 'done',
        tool: toolName || undefined,
        preview,
        hint,
        open: !!preview
      })
    }
    return
  }
  liveTools.value.forEach((t) => {
    if (t.status === 'run' && t.tool && toolName && t.tool !== toolName) t.status = 'done'
  })
  const runningSame = [...liveTools.value]
    .reverse()
    .find((t) => t.status === 'run' && toolName && t.tool === toolName)
  if (runningSame) {
    if (preview) runningSame.preview = preview
    if (hint) runningSame.hint = hint
    return
  }
  liveTools.value.push({
    id: `${toolName || id}-${liveTools.value.length}`,
    label: TOOL_LABELS[toolName] || TOOL_LABELS[id] || label,
    status: 'run',
    tool: toolName || undefined,
    preview,
    hint,
    open: !!preview
  })
}

function asPreview(raw: unknown): ToolPreview | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  return raw as ToolPreview
}

async function onPickFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  importHint.value = ''
  try {
    const detail = await datasetApi.importFile(file)
    const list = await datasetApi.list()
    datasets.value = list
    const id = detail.meta?.id
    if (id) selectedDatasets.value = [id]
    importHint.value = `已导入「${detail.meta?.name || file.name}」，可直接问数`
    chat.value.push({
      role: 'system',
      text: `已把 ${file.name} 作为问数数据集（${(detail.fields || []).length} 个字段）。对齐 DataEase：先落表再查，不是每次上传都打 HTTP。`
    })
  } catch (e) {
    importHint.value = e instanceof Error ? e.message : String(e)
  } finally {
    importing.value = false
  }
}

const styleName = computed(() => styles.value.find((s) => s.id === styleId.value)?.name || '智能风格')

onMounted(async () => {
  try {
    const feat = await conversationApi.feature()
    enabled.value = !!feat.enabled
    if (!enabled.value) {
      error.value = '对话功能未开启（opendashboard.conversation.enabled）'
      return
    }
    const [list, styleList, ds] = await Promise.all([
      conversationApi.list(),
      conversationApi.styles(),
      datasetApi.list()
    ])
    conversations.value = list
    styles.value = styleList
    datasets.value = ds
    if (ds.length) {
      selectedDatasets.value = pickDefaultDatasets(ds)
    } else {
      selectedDatasets.value = ['ds_sales']
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

watch(
  () => current.value?.linkedDashboardId,
  (id) => {
    linkedDashboardId.value = id || null
  }
)

async function ensureConversation(): Promise<ConversationVO> {
  if (current.value) return current.value
  const title = prompt.value.trim().slice(0, 32) || '新对话'
  const created = await conversationApi.create({
    title,
    datasetIds: selectedDatasets.value
  })
  conversations.value = [created, ...conversations.value]
  current.value = created
  return created
}

async function openConversation(id: string) {
  const detail = await conversationApi.get(id)
  current.value = detail
  messages.value = await conversationApi.messages(id)
  chat.value = messages.value.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    text: m.content
  }))
  selectedDatasets.value = detail.datasetIds?.length ? [...detail.datasetIds] : selectedDatasets.value
  linkedDashboardId.value = detail.linkedDashboardId || null
  resetAnswer()
  sidePanel.value = 'none'
  phase.value = 'workspace'
}

function useExample(ex: { text: string; intent: 'ask' | 'gen' }) {
  prompt.value = ex.text
  intent.value = ex.intent
}

function resetAnswer() {
  answerTable.value = null
  answerChart.value = null
  answerInsight.value = null
  answerClarify.value = null
  canAdopt.value = false
  lastIntent.value = ''
  lastQuestion.value = ''
}

async function send() {
  if (!canSend.value) return
  const text = prompt.value.trim()
  prompt.value = ''
  phase.value = 'workspace'
  sidePanel.value = 'none'
  steps.value = []
  liveTools.value = []
  charts.value = []
  boardTitle.value = '数据分析看板'
  emptyPreview.value = false
  queryBar.value = null
  awaitingConfirm.value = false
  planPayload.value = null
  assistantBuf.value = ''
  intentMap.value = null
  resetAnswer()

  chat.value.push({ role: 'user', text })
  lastQuestion.value = text
  streaming.value = true
  try {
    const conv = await ensureConversation()
    await conversationApi.update(conv.id, { datasetIds: selectedDatasets.value })
    await conversationApi.startRun(
      conv.id,
      {
        message: text,
        ...(intent.value === 'gen' ? { intent: 'gen' as const } : {}),
        mode: mode.value,
        styleId: styleId.value,
        datasetIds: selectedDatasets.value
      },
      handleEvent
    )
    current.value = await conversationApi.get(conv.id)
    linkedDashboardId.value = current.value.linkedDashboardId || linkedDashboardId.value
    conversations.value = await conversationApi.list()
  } catch (e) {
    chat.value.push({
      role: 'system',
      text: e instanceof Error ? e.message : String(e)
    })
  } finally {
    streaming.value = false
    flushAssistant()
  }
}

function flushAssistant() {
  const tools = liveTools.value.map((t) => ({ ...t, status: 'done' as const }))
  const text = assistantBuf.value.trim()
  if (text || tools.length) {
    chat.value.push({
      role: 'assistant',
      text: text || (charts.value.length ? '仪表盘已生成。' : ''),
      tools
    })
  }
  assistantBuf.value = ''
  liveTools.value = []
}

function handleEvent(event: string, data: Record<string, unknown>) {
  if (event === 'run') {
    runId.value = String(data.runId || '')
    if (data.intent) lastIntent.value = String(data.intent)
  } else if (event === 'step') {
    const id = String(data.id || data.name || steps.value.length)
    const rawLabel = String(data.label || data.detail || '')
    const kind = String(data.kind || '')
    const tool = String(data.tool || '')
    steps.value.push({ id, label: rawLabel })
    ingestLiveTool(
      id,
      rawLabel,
      kind,
      tool,
      asPreview(data.preview),
      data.hint ? String(data.hint) : undefined,
      data.parent ? String(data.parent) : undefined
    )
  } else if (event === 'intent_map') {
    const mapping = Array.isArray(data.mapping) ? (data.mapping as IntentMap['mapping']) : []
    const unresolved = Array.isArray(data.unresolved) ? (data.unresolved as IntentMap['unresolved']) : []
    intentMap.value = {
      rewrite: data.rewrite ? String(data.rewrite) : '',
      datasetName: data.datasetName ? String(data.datasetName) : undefined,
      time: data.time && typeof data.time === 'object' ? (data.time as IntentMap['time']) : undefined,
      mapping,
      unresolved
    }
    const bits = mapping.map((x) => `${x.phrase} → ${x.label || x.field}`)
    if (bits.length) {
      steps.value.push({ id: 'intent_map', label: bits.join('；') })
    }
  } else if (event === 'plan') {
    planPayload.value = data
    awaitingConfirm.value = data.awaitingConfirm === true
    if (awaitingConfirm.value) {
      chat.value.push({ role: 'assistant', text: '已生成计划，请确认后继续写入看板。' })
    }
  } else if (event === 'patch') {
    steps.value.push({ id: 'patch', label: '收到 DashboardPatch' })
  } else if (event === 'answer_sql') {
    const sql = String(data.sql || '')
    if (sql) {
      steps.value.push({ id: 'answer_sql', label: '已生成 SQL' })
      if (answerTable.value) answerTable.value.sql = sql
      else answerTable.value = { title: String(data.title || 'SQL'), columns: [], rows: [], rowCount: 0, sql }
    }
  } else if (event === 'answer_table') {
    if (intent.value === 'gen' || charts.value.length) return
    answerTable.value = {
      title: String(data.title || '明细表'),
      columns: Array.isArray(data.columns) ? (data.columns as string[]) : [],
      rows: Array.isArray(data.rows) ? (data.rows as unknown[][]) : [],
      rowCount: typeof data.rowCount === 'number' ? data.rowCount : 0,
      truncated: !!data.truncated,
      sql: data.sql ? String(data.sql) : answerTable.value?.sql
    }
  } else if (event === 'answer_chart') {
    if (intent.value === 'gen' || charts.value.length) return
    const rows = answerTable.value?.rows || []
    const labels = Array.isArray(data.labels)
      ? (data.labels as string[])
      : rows.map((r) => String(r?.[0] ?? '')).filter(Boolean).slice(0, 8)
    const rawHeights = Array.isArray(data.heights) ? (data.heights as number[]) : []
    const heights = rawHeights.length ? rawHeights : barHeightsFromRows(rows)
    answerChart.value = {
      title: String(data.title || '图表'),
      chartType: String(data.chartType || 'bar'),
      datasetId: String(data.datasetId || ''),
      datasetName: data.datasetName ? String(data.datasetName) : undefined,
      encode: (data.encode as Record<string, unknown>) || {},
      rowCount: typeof data.rowCount === 'number' ? data.rowCount : 0,
      labels,
      heights,
      insightHtml: data.insightHtml ? String(data.insightHtml) : undefined,
      question: data.question ? String(data.question) : lastQuestion.value,
      follows: Array.isArray(data.follows) ? (data.follows as string[]) : []
    }
  } else if (event === 'answer_insight') {
    if (intent.value === 'gen' || charts.value.length) return
    answerInsight.value = {
      title: String(data.title || '洞察'),
      headlineHtml: String(data.headlineHtml || ''),
      insightHtml: String(data.insightHtml || ''),
      drivers: Array.isArray(data.drivers) ? (data.drivers as AnswerInsight['drivers']) : [],
      follows: Array.isArray(data.follows) ? (data.follows as string[]) : [],
      question: data.question ? String(data.question) : lastQuestion.value,
      datasetName: data.datasetName ? String(data.datasetName) : undefined
    }
  } else if (event === 'answer_clarify') {
    answerClarify.value = {
      title: String(data.title || '需要澄清'),
      headlineHtml: String(data.headlineHtml || ''),
      insightHtml: String(data.insightHtml || ''),
      follows: Array.isArray(data.follows) ? (data.follows as string[]) : [],
      question: data.question ? String(data.question) : lastQuestion.value
    }
    canAdopt.value = false
  } else if (event === 'chart_ready') {
    charts.value.push({
      chartId: String(data.chartId || ''),
      dashboardId: String(data.dashboardId || ''),
      rowCount: typeof data.rowCount === 'number' ? data.rowCount : undefined,
      title: data.title ? String(data.title) : undefined,
      chartType: data.chartType ? String(data.chartType) : undefined,
      datasetId: data.datasetId ? String(data.datasetId) : undefined,
      encode: (data.encode as Record<string, unknown>) || undefined,
      labels: Array.isArray(data.labels) ? (data.labels as string[]) : undefined,
      heights: Array.isArray(data.heights) ? (data.heights as number[]) : undefined,
      kpiValue: data.kpiValue
    })
    if (data.boardTitle) boardTitle.value = String(data.boardTitle)
    if (data.dashboardId) linkedDashboardId.value = String(data.dashboardId)
  } else if (event === 'board_ready') {
    if (data.title) boardTitle.value = String(data.title)
    emptyPreview.value = !!data.emptyPreview
    if (data.dashboardId) linkedDashboardId.value = String(data.dashboardId)
    if (data.query && typeof data.query === 'object') {
      const q = data.query as { label?: string; items?: QueryBarItem[] }
      const items = Array.isArray(q.items) ? q.items : []
      queryBar.value = items.length ? { label: q.label ? String(q.label) : '查询条件', items } : null
    }
    if (!charts.value.length && Array.isArray(data.charts)) {
      for (const raw of data.charts as Record<string, unknown>[]) {
        charts.value.push({
          chartId: String(raw.chartId || ''),
          dashboardId: String(raw.dashboardId || data.dashboardId || ''),
          rowCount: typeof raw.rowCount === 'number' ? raw.rowCount : undefined,
          title: raw.title ? String(raw.title) : undefined,
          chartType: raw.chartType ? String(raw.chartType) : undefined,
          datasetId: raw.datasetId ? String(raw.datasetId) : undefined,
          encode: (raw.encode as Record<string, unknown>) || undefined,
          labels: Array.isArray(raw.labels) ? (raw.labels as string[]) : undefined,
          heights: Array.isArray(raw.heights) ? (raw.heights as number[]) : undefined,
          kpiValue: raw.kpiValue
        })
      }
    }
  } else if (event === 'message_delta') {
    assistantBuf.value += String(data.text || '')
  } else if (event === 'error') {
    chat.value.push({ role: 'system', text: String(data.message || '错误') })
  } else if (event === 'finish') {
    const reason = String(data.reason || '')
    const detail = String(data.detail || '')
    if (reason === 'awaiting_confirm') awaitingConfirm.value = true
    if (reason === 'answered' && detail !== 'clarify') canAdopt.value = true
    if (detail === 'clarify') canAdopt.value = false
  }
}

async function confirmPlan() {
  if (!current.value || !runId.value || streaming.value) return
  streaming.value = true
  awaitingConfirm.value = false
  assistantBuf.value = ''
  try {
    await conversationApi.confirmPlan(current.value.id, runId.value, handleEvent)
    current.value = await conversationApi.get(current.value.id)
    linkedDashboardId.value = current.value.linkedDashboardId || linkedDashboardId.value
  } catch (e) {
    chat.value.push({ role: 'system', text: e instanceof Error ? e.message : String(e) })
  } finally {
    streaming.value = false
    flushAssistant()
  }
}

async function adopt(action: 'save' | 'generate') {
  if (!current.value || !runId.value || streaming.value || !canSave.value) return
  streaming.value = true
  assistantBuf.value = ''
  charts.value = []
  queryBar.value = null
  if (action === 'generate') {
    answerTable.value = null
    answerChart.value = null
    answerInsight.value = null
    answerClarify.value = null
  }
  try {
    await conversationApi.adopt(
      current.value.id,
      runId.value,
      { action, styleId: styleId.value },
      handleEvent
    )
    current.value = await conversationApi.get(current.value.id)
    linkedDashboardId.value = current.value.linkedDashboardId || linkedDashboardId.value
    canAdopt.value = false
  } catch (e) {
    chat.value.push({ role: 'system', text: e instanceof Error ? e.message : String(e) })
  } finally {
    streaming.value = false
    flushAssistant()
  }
}

function followAsk(text: string) {
  prompt.value = text
  intent.value = 'ask'
  void send()
}

function newChat() {
  current.value = null
  chat.value = []
  steps.value = []
  charts.value = []
  queryBar.value = null
  messages.value = []
  linkedDashboardId.value = null
  awaitingConfirm.value = false
  intentMap.value = null
  resetAnswer()
  sidePanel.value = 'none'
  phase.value = 'landing'
  prompt.value = ''
}

function openEditor() {
  const id = linkedDashboardId.value
  if (!id) return
  router.push(`/dashboards/${id}/edit?conversationId=${current.value?.id || ''}`)
}

function toggleDataset(id: string) {
  const set = new Set(selectedDatasets.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  selectedDatasets.value = [...set]
}

function toggleSide(panel: 'history' | 'explore') {
  sidePanel.value = sidePanel.value === panel ? 'none' : panel
}
</script>

<template>
  <div class="conv-root">
    <ModuleTopbar module="conversations" />
    <input
      ref="fileInput"
      type="file"
      class="file-hidden"
      accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      @change="onPickFile"
    />
    <div v-if="loading" class="boot">加载对话…</div>
    <div v-else-if="!enabled || error" class="boot err">{{ error || '对话未启用' }}</div>
    <div v-else class="body">
      <nav class="side" :class="{ slim: sideSlim }" aria-label="对话侧栏">
        <button class="nav on" type="button" @click="newChat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span class="nav-txt">新对话</span>
        </button>
        <button
          class="nav"
          type="button"
          :class="{ on: sidePanel === 'history' }"
          @click="toggleSide('history')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          <span class="nav-txt">历史</span>
        </button>
        <div class="side-div" />
        <button
          class="nav"
          type="button"
          :class="{ on: sidePanel === 'explore' }"
          @click="toggleSide('explore')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span class="nav-txt">探索示例</span>
        </button>
        <button class="nav soon" type="button" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M8 8h8v8H8zM4 12h4M16 12h4M12 4v4M12 16v4" />
          </svg>
          <span class="nav-txt">AI 扩展<span class="tag-soon">二期</span></span>
        </button>
        <div class="gap" />
        <button class="nav" type="button" @click="sideSlim = !sideSlim">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 6h16M4 12h10M4 18h16" />
          </svg>
          <span class="nav-txt">{{ sideSlim ? '展开侧栏' : '收起侧栏' }}</span>
        </button>
      </nav>

      <aside v-if="sidePanel !== 'none'" class="side-panel">
        <div class="sp-hd">
          {{ sidePanel === 'history' ? '最近对话' : '探索示例' }}
          <button class="ico" type="button" @click="sidePanel = 'none'">✕</button>
        </div>
        <div v-if="sidePanel === 'history'" class="sp-body">
          <button
            v-for="c in conversations"
            :key="c.id"
            type="button"
            class="recent-item"
            :class="{ on: current?.id === c.id }"
            @click="openConversation(c.id)"
          >
            <span class="dot" />
            <span class="t">{{ c.title }}</span>
            <span class="st">{{ c.linkedDashboardId ? '已生成' : '会话' }}</span>
          </button>
          <div v-if="!conversations.length" class="muted pad">暂无历史</div>
        </div>
        <div v-else class="sp-body">
          <button
            v-for="ex in EXAMPLES"
            :key="ex.label"
            type="button"
            class="recent-item"
            @click="useExample(ex); sidePanel = 'none'"
          >
            <span class="dot" />
            <span class="t">{{ ex.label }}</span>
            <span class="st">{{ ex.intent === 'gen' ? '生成' : '问数' }}</span>
          </button>
        </div>
      </aside>

      <!-- Landing：对齐高保 Kimi 式居中 -->
      <section v-if="phase === 'landing'" class="stage landing">
        <div class="landing-stack">
          <div class="hero-zone">
            <div class="brand-mark">先<em>问数</em></div>
            <div class="brand-sub">看清结论后再决定：保存到仪表盘，或一键生成整页看板</div>
          </div>

          <div class="dock">
            <div class="intent-hint">
              当前意图：{{ intent === 'gen' ? '生成看板' : '问数' }} ·
              {{ intent === 'gen' ? '将写入 Dashboard draft' : '结果仅会话预览' }}
            </div>
            <div class="composer">
              <div class="comp-row">
                <button class="gbtn" type="button" @click="dsMenuOpen = !dsMenuOpen">
                  ＋ 数据集 ▾
                </button>
                <button class="gbtn" type="button" :disabled="importing" @click="fileInput?.click()">
                  {{ importing ? '导入中…' : '上传 CSV / Excel' }}
                </button>
                <span class="ctx-pill">上下文 <b>{{ ctxName }}</b></span>
                <span v-if="importHint" class="import-hint">{{ importHint }}</span>
                <span class="sp" />
              </div>
              <div v-if="dsMenuOpen" class="ds-menu">
                <label v-for="d in datasets" :key="d.id" class="ds">
                  <input
                    type="checkbox"
                    :checked="selectedDatasets.includes(d.id)"
                    @change="toggleDataset(d.id)"
                  />
                  {{ d.name }}
                </label>
                <span v-if="!datasets.length" class="muted">将使用演示 ds_sales</span>
              </div>
              <textarea
                v-model="prompt"
                rows="4"
                placeholder="问一句业务问题，例如：各区域销售额是多少？"
                @keydown.meta.enter="send"
                @keydown.ctrl.enter="send"
              />
              <div class="comp-row">
                <button
                  class="pill"
                  :class="{ 'on-intent': intent === 'ask' }"
                  type="button"
                  @click="intent = 'ask'"
                >
                  <b>问数</b>
                </button>
                <button
                  class="pill"
                  :class="{ 'on-intent': intent === 'gen' }"
                  type="button"
                  @click="intent = 'gen'"
                >
                  <b>生成看板</b>
                </button>
                <button class="pill" type="button" @click="mode = mode === 'auto' ? 'plan' : 'auto'">
                  ⚡ <b>{{ mode === 'auto' ? 'Auto' : 'Plan' }}</b>
                </button>
                <button
                  v-if="intent === 'gen'"
                  class="pill"
                  type="button"
                  @click="
                    styleId =
                      styles[(styles.findIndex((s) => s.id === styleId) + 1) % Math.max(styles.length, 1)]
                        ?.id || styleId
                  "
                >
                  ▦ <b>{{ styleName }}</b>
                </button>
                <span class="sp" />
                <button class="send" type="button" :disabled="!canSend" @click="send" title="发送">
                  ↑
                </button>
              </div>
            </div>

            <div class="chips">
              <button
                v-for="ex in EXAMPLES"
                :key="ex.label"
                type="button"
                class="chip"
                :class="{ secondary: ex.intent === 'gen' }"
                @click="useExample(ex)"
              >
                {{ ex.label }}
              </button>
            </div>

            <div class="recent">
              <div class="recent-hd">最近对话</div>
              <button
                v-for="c in conversations.slice(0, 6)"
                :key="c.id"
                type="button"
                class="recent-item"
                @click="openConversation(c.id)"
              >
                <span class="dot" />
                <span class="t">{{ c.title }}</span>
                <span class="st">{{ c.linkedDashboardId ? '已生成' : '可打开' }}</span>
              </button>
              <div v-if="!conversations.length" class="muted pad">发送第一条问数后会出现在这里</div>
            </div>

            <div class="foot-note">
              Open Dashboard 内测 · 问数结果为会话预览，写入看板前不落查询结果行
            </div>
          </div>
        </div>
      </section>

      <!-- Workspace -->
      <section v-else class="stage workspace">
        <div class="chat-col">
          <div class="chat-hd">
            <span>{{ current?.title || '新对话' }}</span>
          </div>
          <div class="flow-bar">
            <span class="step-dot on">① 提问</span>
            <span class="sep">→</span>
            <span class="step-dot" :class="{ on: !!steps.length, done: hasAnswer || charts.length }">
              ② 问数 / 规划
            </span>
            <span class="sep">→</span>
            <span class="step-dot" :class="{ on: hasAnswer || charts.length }">③ 结果</span>
            <span class="sep">→</span>
            <span class="step-dot" :class="{ done: !!linkedDashboardId }">④ 保存 / 生成看板</span>
          </div>

          <div class="msgs">
            <div v-for="(m, i) in chat" :key="i" class="msg" :class="m.role">
              <div class="av" :class="m.role === 'user' ? 'me' : 'ai'">
                {{ m.role === 'user' ? '我' : 'AI' }}
              </div>
              <div class="asst-col">
                <ToolStepList v-if="m.role === 'assistant' && m.tools?.length" :steps="m.tools" />
                <div v-if="m.text" class="bub">
                  <div class="bub-text">{{ m.text }}</div>
                </div>
              </div>
            </div>
            <div v-if="streaming || liveTools.length" class="msg assistant">
              <div class="av ai">AI</div>
              <div class="asst-col">
                <ToolStepList :steps="liveTools" live />
                <div v-if="intentMap?.mapping?.length" class="intent-map in-bub">
                  <div v-for="(x, i) in intentMap.mapping" :key="'lm' + i" class="imap ok">
                    {{ x.phrase }} → {{ x.label || x.field }}
                  </div>
                  <div v-for="(u, i) in intentMap.unresolved" :key="'lu' + i" class="imap miss">
                    {{ u.phrase }}
                  </div>
                </div>
                <div v-if="assistantBuf" class="bub">
                  <div class="bub-text">{{ assistantBuf }}</div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="awaitingConfirm" class="plan-box">
            <div class="plan-title">待确认计划</div>
            <ol class="plan-ol">
              <li>数据：{{ ctxName }}</li>
              <li>{{ String(planPayload?.title || '分析看板') }} · {{ planPayload?.opsCount || '多' }} 个组件</li>
              <li>写入方式：{{ planPayload?.mode === 'append' ? '追加到当前看板' : '整页替换' }}</li>
            </ol>
            <button class="btn primary" type="button" :disabled="streaming" @click="confirmPlan">
              确认并写入
            </button>
          </div>
          <div v-if="canSave" class="adopt-box">
            <button class="btn primary" type="button" :disabled="streaming" @click="adopt('save')">
              保存到仪表盘
            </button>
            <button class="btn" type="button" :disabled="streaming" @click="adopt('generate')">
              直接生成仪表盘
            </button>
          </div>

            <div class="dock workspace-dock">
            <div class="ctx-row-ws">
              <span class="ctx-pill">上下文 <b>{{ ctxName }}</b></span>
              <button class="gbtn" type="button" @click="dsMenuOpen = !dsMenuOpen">更换数据集 ▾</button>
              <button class="gbtn" type="button" :disabled="importing" @click="fileInput?.click()">
                {{ importing ? '导入中…' : '上传 CSV / Excel' }}
              </button>
            </div>
            <div v-if="dsMenuOpen" class="ds-menu">
              <label v-for="d in datasets" :key="d.id" class="ds">
                <input
                  type="checkbox"
                  :checked="selectedDatasets.includes(d.id)"
                  @change="toggleDataset(d.id)"
                />
                {{ d.name }}
              </label>
            </div>
            <div class="composer">
              <textarea
                v-model="prompt"
                rows="2"
                placeholder="继续问数，或切换为生成看板…"
                @keydown.meta.enter="send"
                @keydown.ctrl.enter="send"
              />
              <div class="comp-row">
                <button
                  class="pill"
                  :class="{ 'on-intent': intent === 'ask' }"
                  type="button"
                  @click="intent = 'ask'"
                >
                  <b>问数</b>
                </button>
                <button
                  class="pill"
                  :class="{ 'on-intent': intent === 'gen' }"
                  type="button"
                  @click="intent = 'gen'"
                >
                  <b>生成看板</b>
                </button>
                <span class="sp" />
                <button class="send" type="button" :disabled="!canSend" @click="send">↑</button>
              </div>
            </div>
          </div>
        </div>

        <aside class="files-col">
          <div class="col-h">本会话产物</div>
          <button
            v-if="linkedDashboardId"
            type="button"
            class="file dash"
            @click="openEditor"
          >
            ▦ dashboard-{{ linkedDashboardId }}.dash
          </button>
          <div v-else class="muted pad">问数结果不落文件；保存/生成后出现 .dash</div>
        </aside>

        <section class="canvas-col">
          <div v-if="linkedDashboardId" class="bridge-bar">
            <span>产物已写入 Dashboard draft</span>
            <code class="path">/dashboards/{{ linkedDashboardId }}/edit</code>
            <span class="sp" />
            <button class="btn primary" type="button" @click="openEditor">在编辑器打开</button>
          </div>
          <div class="ask-pane">
            <template v-if="!charts.length && answerClarify">
              <div class="ask-toolbar">
                <span class="ttl">需要澄清</span>
                <span class="muted">未取数 · 请补充指标与维度</span>
              </div>
              <div class="ask-result">
                <div class="ask-hd">
                  <span class="badge warn">CLARIFY</span>
                  <div>
                    <h3>{{ answerClarify.title }}</h3>
                    <div class="meta">「{{ answerClarify.question || lastQuestion }}」</div>
                  </div>
                </div>
                <div v-if="answerClarify.headlineHtml" class="insight" v-html="answerClarify.headlineHtml" />
                <div class="insight" v-html="answerClarify.insightHtml" />
                <div v-if="intentMap" class="intent-map">
                  <div v-for="(x, i) in intentMap.mapping" :key="'m' + i" class="imap ok">
                    {{ x.phrase }} → {{ x.label || x.field }}
                  </div>
                  <div v-for="(u, i) in intentMap.unresolved" :key="'u' + i" class="imap miss">
                    {{ u.phrase }}：{{ u.reason }}
                  </div>
                </div>
                <div class="ask-follow">
                  <button
                    v-for="f in answerClarify.follows"
                    :key="f"
                    type="button"
                    class="chip"
                    @click="followAsk(f)"
                  >
                    {{ f }}
                  </button>
                </div>
              </div>
            </template>

            <template v-else-if="!charts.length && answerInsight">
              <div class="ask-toolbar">
                <span class="ttl">洞察诊断</span>
                <span class="muted">归因结论 · 证据表 · 不是普通问数图</span>
                <span class="sp" />
                <button class="btn" type="button" :disabled="!canSave || streaming" @click="adopt('generate')">
                  生成诊断看板
                </button>
                <button class="btn primary" type="button" :disabled="!canSave || streaming" @click="adopt('save')">
                  保存证据图
                </button>
              </div>
              <div class="ask-result">
                <div class="ask-hd">
                  <span class="badge diag">DIAG</span>
                  <div>
                    <h3>{{ answerInsight.title }}</h3>
                    <div class="meta">
                      {{ answerInsight.datasetName || '数据集' }} · 「{{ answerInsight.question || lastQuestion }}」
                    </div>
                  </div>
                </div>
                <div class="insight">
                  <span v-if="answerInsight.headlineHtml" v-html="answerInsight.headlineHtml" />
                  <br v-if="answerInsight.headlineHtml" />
                  <span v-html="answerInsight.insightHtml" />
                </div>
                <div v-if="answerInsight.drivers.length" class="ask-drivers">
                  <div
                    v-for="(d, i) in answerInsight.drivers"
                    :key="i"
                    class="drv"
                  >
                    <div class="k">{{ d.k }}</div>
                    <div class="d">{{ d.d }}</div>
                    <div class="delta" :class="d.neg ? 'neg' : 'pos'">{{ d.delta }}</div>
                  </div>
                </div>
                <div v-if="answerTable" class="ask-body single">
                  <div class="viz">
                    <div class="vl">证据表 · 归因拆解</div>
                    <table>
                      <thead>
                        <tr>
                          <th v-for="c in answerTable.columns" :key="c">{{ c }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(row, ri) in answerTable.rows" :key="ri">
                          <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div class="ask-follow">
                  <button
                    v-for="f in answerInsight.follows"
                    :key="f"
                    type="button"
                    class="chip"
                    @click="followAsk(f)"
                  >
                    {{ f }}
                  </button>
                </div>
                <div class="ask-foot">
                  <span class="muted">洞察 ≠ 再画一张普通对比图；证据可采纳为看板组件</span>
                  <span class="sp" />
                  <button class="btn" type="button" :disabled="!canSave || streaming" @click="adopt('generate')">
                    生成诊断看板
                  </button>
                  <button class="btn primary" type="button" :disabled="!canSave || streaming" @click="adopt('save')">
                    保存证据图
                  </button>
                </div>
              </div>
            </template>

            <template v-else-if="!charts.length && (answerChart || answerTable)">
              <div class="ask-toolbar">
                <span class="ttl">问数结果</span>
                <span class="muted">会话预览 · 不落结果行</span>
                <span class="sp" />
                <button class="btn" type="button" :disabled="!canSave || streaming" @click="adopt('generate')">
                  直接生成仪表盘
                </button>
                <button class="btn primary" type="button" :disabled="!canSave || streaming" @click="adopt('save')">
                  保存到仪表盘
                </button>
              </div>
              <div class="ask-result">
                <div class="ask-hd">
                  <span class="badge">ASK</span>
                  <div>
                    <h3>{{ answerChart?.title || answerTable?.title || '问数结果' }}</h3>
                    <div class="meta">
                      数据集 · {{ answerChart?.datasetName || answerChart?.datasetId || ctxName }}
                      · 「{{ answerChart?.question || lastQuestion }}」
                    </div>
                    <div v-if="intentMap?.rewrite" class="meta">{{ intentMap.rewrite }}</div>
                  </div>
                </div>
                <div v-if="intentMap" class="intent-map">
                  <div v-for="(x, i) in intentMap.mapping" :key="'am' + i" class="imap ok">
                    {{ x.phrase }} → {{ x.label || x.field }}
                  </div>
                </div>
                <div
                  v-if="answerChart?.insightHtml"
                  class="insight"
                  v-html="answerChart.insightHtml"
                />
                <div class="ask-body">
                  <div v-if="answerChart" class="viz">
                    <div class="vl">临时图 · {{ answerChart.chartType }}</div>
                    <div class="ask-bars">
                      <span
                        v-for="(h, i) in answerChart.heights"
                        :key="i"
                        :style="{ height: h + '%' }"
                        :title="answerChart.labels[i] || ''"
                      />
                    </div>
                    <div class="lab">
                      <span v-for="(l, i) in answerChart.labels" :key="i">{{ l }}</span>
                    </div>
                  </div>
                  <div v-if="answerTable" class="viz">
                    <div class="vl">明细表 · {{ answerTable.rowCount }} 行</div>
                    <pre v-if="answerTable.sql" class="sql-block">{{ answerTable.sql }}</pre>
                    <table>
                      <thead>
                        <tr>
                          <th v-for="c in answerTable.columns" :key="c">{{ c }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(row, ri) in answerTable.rows" :key="ri">
                          <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div v-if="answerChart?.encode" class="ask-encode">
                  <span v-if="answerChart.encode.category" class="tag">
                    dim · <em>{{ answerChart.encode.category }}</em>
                  </span>
                  <span v-if="answerChart.encode.value" class="tag">
                    measure · <em>{{ answerChart.encode.value }}</em>
                  </span>
                  <span v-if="answerChart.encode.agg" class="tag">
                    agg · <em>{{ answerChart.encode.agg }}</em>
                  </span>
                </div>
                <div v-if="answerChart?.follows?.length" class="ask-follow">
                  <button
                    v-for="f in answerChart.follows"
                    :key="f"
                    type="button"
                    class="chip"
                    @click="followAsk(f)"
                  >
                    {{ f }}
                  </button>
                </div>
                <div class="ask-foot">
                  <span class="muted">下一步：写入 DashboardPatch（仅配置，不含结果行）</span>
                  <span class="sp" />
                  <button class="btn" type="button" :disabled="!canSave || streaming" @click="adopt('generate')">
                    直接生成仪表盘
                  </button>
                  <button class="btn primary" type="button" :disabled="!canSave || streaming" @click="adopt('save')">
                    保存到仪表盘
                  </button>
                </div>
              </div>
            </template>

            <template v-else-if="charts.length || emptyPreview || queryBar">
              <div class="ask-toolbar">
                <span class="ttl">看板草稿</span>
                <span class="muted">已写入 draft · 配置不含结果行</span>
                <span class="sp" />
                <button class="btn primary" type="button" :disabled="!linkedDashboardId" @click="openEditor">
                  在编辑器打开
                </button>
              </div>
              <div v-if="emptyPreview" class="dash-warn">
                预览无有效数据：底层表可能为空，或字段聚合结果为 null。请换「订单表」等有行的业务数据集，或先确认数据源里该表有数据。
              </div>
              <div class="dash-preview">
                <div class="dash-hd">
                  <div>
                    <h2>{{ boardTitle }}</h2>
                    <div class="meta">
                      看板 #{{ linkedDashboardId }} · {{ charts.length }} 个组件 · {{ previewDatasetName }}
                    </div>
                  </div>
                  <div class="mock" :class="{ bad: emptyPreview }">
                    {{ emptyPreview ? '无数据预览' : 'Live 预览 · chartQuery' }}
                  </div>
                </div>
                <div v-if="queryBar?.items?.length" class="query-bar" title="本轮筛选仅展示，不进入 chartQuery">
                  <b>{{ queryBar.label || '查询条件' }}</b>
                  <div class="query-items">
                    <label v-for="(it, i) in queryBar.items" :key="it.field || i" class="q-item">
                      <span>{{ it.label || it.field }}</span>
                      <template v-if="it.kind === 'date' || it.kind === 'dateRange'">
                        <input type="date" disabled />
                        <span>~</span>
                        <input type="date" disabled />
                      </template>
                      <select v-else disabled>
                        <option>全部</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div v-if="kpiCharts.length" class="kpi-row" :style="{ gridTemplateColumns: `repeat(${Math.min(kpiCharts.length, 4)}, 1fr)` }">
                  <div v-for="c in kpiCharts" :key="c.chartId" class="kpi-card">
                    <div class="l">{{ c.title || 'KPI' }}</div>
                    <div class="v">{{ formatKpi(c.kpiValue) }}</div>
                    <div class="d">{{ c.rowCount }} 行聚合</div>
                  </div>
                </div>
                <div v-if="plotCharts.length" class="chart-grid" :class="{ single: plotCharts.length === 1 }">
                  <div v-for="c in plotCharts" :key="c.chartId" class="ccard">
                    <h3>{{ c.title || c.chartType || c.chartId }}</h3>
                    <div v-if="c.heights?.length" class="ask-bars mini">
                      <span
                        v-for="(h, i) in c.heights"
                        :key="i"
                        :style="{ height: h + '%' }"
                        :title="c.labels?.[i] || ''"
                      />
                    </div>
                    <div v-if="c.labels?.length" class="lab">
                      <span v-for="(l, i) in c.labels" :key="i">{{ l }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="tableCharts.length" class="table-grid">
                  <div v-for="c in tableCharts" :key="c.chartId" class="ccard table-card">
                    <h3>{{ c.title || '汇总表' }}</h3>
                    <table class="mini-table">
                      <tbody>
                        <tr v-for="(l, i) in (c.labels || []).slice(0, 8)" :key="i">
                          <td>{{ l }}</td>
                          <td class="num">{{ c.rowCount ? '·' : '' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </template>

            <div v-else class="empty">
              <div class="empty-t">从问数开始，再落到可编辑看板</div>
              <div class="muted">左侧提问即可出表/图预览；满意后再保存到仪表盘，或直接生成整页 draft。</div>
            </div>
          </div>
        </section>
      </section>
    </div>
  </div>
</template>

<style scoped>
.conv-root {
  --ink: #1f2329;
  --muted: #646a73;
  --faint: #8f959e;
  --line: #eff0f1;
  --line-2: #dee0e3;
  --soft: #f2f3f5;
  --brand: #3370ff;
  --brand-soft: #eaefff;
  --ok: #00b578;
  --danger: #f54a45;
  --shadow: 0 6px 24px rgba(31, 35, 41, 0.08);
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f6f8;
  color: var(--ink);
  font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
.boot {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
}
.boot.err {
  color: var(--danger);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  width: 100%;
  background: #f5f6f8;
}
.side {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--line);
  background: #fff;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 2px;
}
.side.slim {
  width: 56px;
}
.side.slim .nav-txt {
  display: none;
}
.nav {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  color: var(--muted);
  font-size: 13px;
  text-align: left;
  border: 0;
  background: none;
  cursor: pointer;
}
.nav svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.nav:hover {
  background: var(--soft);
  color: var(--ink);
}
.nav.on {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 600;
}
.nav.soon {
  opacity: 0.42;
  cursor: not-allowed;
}
.tag-soon {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  height: 16px;
  line-height: 16px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  background: #eef0f3;
}
.side-div {
  height: 1px;
  background: var(--line);
  margin: 6px;
}
.gap {
  flex: 1;
}
.side-panel {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--line);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.sp-hd {
  height: 44px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}
.ico {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  color: var(--muted);
}
.ico:hover {
  background: var(--soft);
}
.sp-body {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.stage.landing {
  flex: 1;
  min-width: 0;
  display: flex;
  /* Defend against leaked dashboard editor.css `.stage { flex-direction: column }` */
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
  overflow: auto;
  padding: min(14vh, 110px) 24px 48px;
  background: #f5f6f8;
}
.landing-stack {
  width: min(960px, 94%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hero-zone {
  text-align: center;
  padding: 0 0 28px;
}
.brand-mark {
  font-size: clamp(36px, 5vw, 48px);
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1.1;
  color: var(--ink);
}
.brand-mark em {
  font-style: normal;
  color: var(--brand);
}
.brand-sub {
  margin-top: 10px;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.5;
}
.dock {
  width: 100%;
  display: flex;
  flex-direction: column;
}
.intent-hint {
  font-size: 12px;
  color: var(--faint);
  margin-bottom: 8px;
  padding-left: 4px;
}
.composer {
  border: 1px solid #e5e6eb;
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 8px 32px rgba(31, 35, 41, 0.08);
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.composer:focus-within {
  border-color: #b7c9ff;
  box-shadow: 0 0 0 3px rgba(51, 112, 255, 0.1), var(--shadow);
}
.comp-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.comp-row .sp {
  flex: 1;
}
.gbtn {
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--muted);
  border: 0;
  background: transparent;
  cursor: pointer;
}
.gbtn:hover {
  background: var(--soft);
  color: var(--ink);
}
.ctx-pill {
  font-size: 12px;
  color: var(--muted);
}
.import-hint {
  font-size: 12px;
  color: var(--ok, #34c759);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-hidden {
  display: none;
}
.ctx-pill b {
  color: var(--ink);
  font-weight: 600;
}
.ds-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 4px 2px 8px;
}
.ds {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12.5px;
  color: var(--muted);
}
textarea {
  width: 100%;
  border: 0;
  outline: 0;
  resize: none;
  min-height: 108px;
  font: inherit;
  font-size: 15.5px;
  line-height: 1.55;
  background: transparent;
}
.pill {
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--muted);
  border: 0;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pill:hover {
  background: var(--soft);
  color: var(--ink);
}
.pill b {
  font-weight: 600;
  color: var(--ink);
}
.pill.on-intent {
  background: var(--brand-soft);
  color: var(--brand);
}
.pill.on-intent b {
  color: var(--brand);
}
.send {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #1f2329;
  color: #fff;
  border: 0;
  display: grid;
  place-items: center;
  font-size: 14px;
  cursor: pointer;
}
.send:hover {
  background: #000;
}
.send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 18px;
}
.chip {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--line-2);
  background: #fff;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}
.chip:hover,
.chip.secondary:hover {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-soft);
}
.recent {
  width: 100%;
  margin-top: 28px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.recent-hd {
  font-size: 12px;
  font-weight: 600;
  color: var(--faint);
  padding: 0 4px 8px;
}
.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13.5px;
  color: var(--ink);
  text-align: left;
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.recent-item:hover,
.recent-item.on {
  background: var(--soft);
}
.recent-item .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand);
  flex-shrink: 0;
}
.recent-item .t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-item .st {
  font-size: 12px;
  color: var(--faint);
  flex-shrink: 0;
}
.foot-note {
  margin-top: 20px;
  text-align: center;
  font-size: 11px;
  color: var(--faint);
}
.muted {
  color: var(--faint);
  font-size: 12.5px;
}
.pad {
  padding: 8px 12px;
}

/* workspace */
.stage.workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 440px 180px 1fr;
  /* Reset leaked dashboard `.stage` flex/overflow */
  flex-direction: initial;
  overflow: hidden;
  background: #f5f6f7;
}
.chat-col,
.files-col,
.canvas-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--line);
}
.canvas-col {
  border-right: 0;
  background: #f5f6f7;
}
.chat-hd {
  height: 44px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}
.flow-bar {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  background: #fafbfd;
  font-size: 12px;
  color: var(--faint);
  flex-shrink: 0;
}
.step-dot.on {
  color: var(--brand);
  font-weight: 600;
}
.step-dot.done {
  color: var(--ok);
}
.sep {
  color: var(--line-2);
}
.msgs {
  flex: 1;
  overflow: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  display: flex;
  gap: 8px;
}
.msg.user {
  flex-direction: row-reverse;
}
.msg.system {
  justify-content: center;
}
.av {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
}
.av.ai {
  background: var(--brand);
}
.av.me {
  background: #646a73;
}
.asst-col {
  flex: 1;
  min-width: 0;
  max-width: calc(100% - 36px);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  overflow: hidden;
}
.bub {
  max-width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.55;
  background: var(--soft);
}
.bub-text {
  white-space: pre-wrap;
}
.msg.user .asst-col {
  align-items: flex-end;
}
.msg.user .bub {
  background: var(--brand);
  color: #fff;
  border-radius: 12px 12px 4px 12px;
}
.msg.assistant .bub {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 4px 12px 12px 12px;
}
.bub.soft {
  background: #fff8eb;
  color: #9a6700;
  font-size: 12.5px;
}
.plan-box,
.adopt-box {
  margin: 0 12px 8px;
  padding: 10px;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: #f7f9fc;
}
.adopt-box {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.plan-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.plan-ol {
  margin: 0 0 10px;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink);
}
.btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: #fff;
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
}
.btn.primary {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.workspace-dock {
  border-top: 1px solid var(--line);
  padding: 10px 12px 14px;
}
.ctx-row-ws {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.workspace-dock .composer {
  border-radius: 12px;
  padding: 8px;
  box-shadow: none;
}
.workspace-dock textarea {
  min-height: 56px;
  font-size: 13px;
}
.files-col {
  background: #fafbfc;
}
.col-h {
  padding: 12px 12px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.steps-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 10px 14px;
}
.steps-list .step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  color: var(--muted);
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--line);
  line-height: 1.45;
}
.steps-list .step i {
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--faint);
  flex-shrink: 0;
}
.steps-list .step.run {
  border-color: #c9d8ff;
  background: #f5f8ff;
  color: var(--ink);
}
.steps-list .step.run i {
  background: var(--brand);
  box-shadow: 0 0 0 3px rgba(51, 112, 255, 0.15);
}
.steps-list .step.done i {
  background: var(--ok);
}
.files-col ul {
  margin: 0;
  padding: 0 12px 12px 28px;
  font-size: 12.5px;
}
.file.dash {
  margin: 0 12px;
  text-align: left;
  border: 1px solid var(--line-2);
  background: var(--brand-soft);
  color: var(--brand);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12.5px;
}
.bridge-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #eef6ff;
  border-bottom: 1px solid #d6e8ff;
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
.bridge-bar .path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  color: var(--brand);
}
.bridge-bar .sp {
  flex: 1;
}
.ask-pane {
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: linear-gradient(180deg, #f3f5f8 0%, #f5f6f7 120px);
}
.ask-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.ask-toolbar .ttl {
  font-size: 13px;
  font-weight: 650;
}
.ask-toolbar .muted {
  font-size: 12px;
}
.ask-toolbar .sp {
  flex: 1;
}
.ask-result {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow);
  max-width: 860px;
}
.ask-hd {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #fafbfd, #fff);
}
.ask-hd h3 {
  font-size: 15px;
  margin: 0 0 4px;
  letter-spacing: -0.01em;
}
.ask-hd .meta {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
.intent-map {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 12px;
}
.imap {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f5f6f7;
  color: var(--muted);
}
.imap.ok {
  background: #eef3ff;
  color: #3370ff;
}
.imap.miss {
  background: #fff1f0;
  color: #c2410c;
}
.intent-map.in-bub {
  padding: 8px 0 0;
}
.badge {
  flex-shrink: 0;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 22px;
  background: #e8f3ff;
  color: #1677ff;
}
.badge.diag {
  background: #fff1f0;
  color: #cf1322;
}
.badge.warn {
  background: #fff7e6;
  color: #d46b08;
}
.insight {
  margin: 12px 16px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f7f9fc;
  border: 1px solid #e8ecf2;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink);
}
.ask-drivers {
  margin: 12px 16px 0;
  display: grid;
  gap: 8px;
}
.drv {
  display: grid;
  grid-template-columns: 88px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #fff;
  font-size: 12.5px;
}
.drv .k {
  font-weight: 700;
}
.drv .d {
  color: var(--muted);
  line-height: 1.45;
}
.drv .delta.neg {
  color: #cf1322;
  font-weight: 700;
}
.drv .delta.pos {
  color: #08979c;
  font-weight: 700;
}
.ask-body {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 14px;
  padding: 14px 16px;
}
.ask-body.single {
  grid-template-columns: 1fr;
}
@media (max-width: 900px) {
  .ask-body {
    grid-template-columns: 1fr;
  }
}
.viz {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  background: #fbfcfe;
  min-height: 160px;
}
.viz .vl {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
  font-weight: 600;
}
.sql-block {
  margin: 0 0 10px;
  padding: 10px 12px;
  background: #0f1728;
  color: #d7e2ff;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 180px;
  white-space: pre-wrap;
}
.ask-bars {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 140px;
  margin: 8px 0 6px;
  padding: 0 4px;
}
.ask-bars span {
  flex: 1;
  background: linear-gradient(180deg, #7aa2ff, #3370ff);
  border-radius: 5px 5px 2px 2px;
  min-height: 12px;
}
.lab {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  font-size: 11px;
  color: var(--faint);
  margin-top: 4px;
}
.ask-result table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.ask-result th,
.ask-result td {
  border-bottom: 1px solid var(--line);
  padding: 9px 6px;
  text-align: left;
  white-space: nowrap;
}
.ask-result th {
  color: var(--muted);
  font-weight: 600;
  background: #fafbfc;
}
.ask-encode {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 12px;
}
.ask-encode .tag {
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--soft);
  color: var(--muted);
  border: 1px solid var(--line);
}
.ask-encode .tag em {
  font-style: normal;
  color: var(--ink);
  font-weight: 650;
}
.ask-follow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 14px;
}
.ask-follow .chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px dashed var(--line-2);
  background: #fff;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
.ask-follow .chip:hover {
  border-color: var(--brand);
  color: var(--brand);
  background: var(--brand-soft);
}
.ask-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: #fafbfc;
}
.ask-foot .sp {
  flex: 1;
}
.ask-card-mini {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  max-width: 480px;
}
.dash-warn {
  max-width: 920px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #ffe2ad;
  background: #fff8eb;
  color: #9a6700;
  font-size: 12.5px;
  line-height: 1.45;
}
.dash-preview {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow);
  max-width: 920px;
}
.dash-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #fafbfd, #fff);
}
.dash-hd h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.dash-hd .meta {
  font-size: 12px;
  color: var(--muted);
}
.dash-hd .mock {
  flex-shrink: 0;
  font-size: 11.5px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #ffe2ad;
  background: #fff8eb;
  color: #9a6700;
  font-weight: 500;
}
.dash-hd .mock.bad {
  border-color: #ffccc7;
  background: #fff2f0;
  color: #cf1322;
}
.query-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 16px 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fafbfc;
}
.query-bar b {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 650;
  color: var(--ink);
}
.query-items {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  min-width: 0;
}
.q-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.q-item input,
.q-item select {
  height: 28px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  padding: 0 8px;
  background: #fff;
  color: var(--ink);
  font-size: 12px;
}
.q-item input[type='date'] {
  width: 124px;
}
.kpi-row {
  display: grid;
  gap: 10px;
  padding: 14px 16px 6px;
}
.kpi-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(31, 35, 41, 0.03);
}
.kpi-card .l {
  font-size: 12px;
  color: var(--muted);
}
.kpi-card .v {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.kpi-card .d {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ok);
}
.kpi-card .d.muted {
  color: var(--faint);
}
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 10px 16px 16px;
}
.chart-grid.single {
  grid-template-columns: 1fr;
}
.chart-grid:not(.single) .ccard:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}
@media (max-width: 900px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
  .chart-grid:not(.single) .ccard:last-child:nth-child(odd) {
    grid-column: auto;
  }
}
.table-grid {
  padding: 0 16px 16px;
}
.table-card {
  min-height: 0;
}
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.mini-table td {
  padding: 6px 4px;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
}
.mini-table td.num {
  width: 28px;
  color: var(--faint);
  text-align: right;
}
.ccard {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  background: #fff;
  min-height: 200px;
}
.ccard h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 650;
  color: var(--muted);
}
.ask-bars.mini {
  height: 140px;
}
.chart-empty {
  height: 140px;
  display: grid;
  place-items: center;
  gap: 8px;
  color: var(--faint);
  font-size: 12px;
  border-radius: 8px;
  background:
    linear-gradient(#eef0f3 1px, transparent 1px) 0 0 / 100% 25%,
    #fafbfc;
}
.ghost-bars {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 56px;
  opacity: 0.45;
}
.ghost-bars i {
  display: block;
  width: 14px;
  border-radius: 3px 3px 0 0;
  background: #c9cdd4;
}
.ghost-bars i:nth-child(1) { height: 28%; }
.ghost-bars i:nth-child(2) { height: 62%; }
.ghost-bars i:nth-child(3) { height: 44%; }
.ghost-bars i:nth-child(4) { height: 78%; }
.ghost-bars i:nth-child(5) { height: 36%; }
.lab {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  overflow: hidden;
}
.lab span {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: var(--faint);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ask-encode.tight {
  padding: 8px 0 0;
}
.ct {
  font-weight: 600;
}
.cd {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--muted);
}
.empty {
  padding: 48px 24px;
  text-align: center;
}
.empty-t {
  font-weight: 650;
  margin-bottom: 6px;
}
@media (max-width: 1100px) {
  .stage.workspace {
    grid-template-columns: 1fr;
  }
  .files-col {
    display: none;
  }
}
</style>

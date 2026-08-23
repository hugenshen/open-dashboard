<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  datasetApi,
  datasourceApi,
  indicatorApi,
  questionApi,
  type DatasetDetailVO,
  type DatasetFieldVO,
  type DatasetMetaVO,
  type DatasetQuestionVO,
  type DatasourceVO,
  type IndicatorVO,
  type TableItem
} from '../api'
import '../../shell/catalog.css'
import '../../shell/studio.css'

type DragPayload = {
  kind: 'pool' | 'selected'
  name: string
  label: string
  group: string
  dataType?: string
  origin?: 'table' | 'calc'
  expression?: string
  index?: number
}

const route = useRoute()
const router = useRouter()

const items = ref<DatasetMetaVO[]>([])
const sources = ref<DatasourceVO[]>([])
const selectedId = ref<string | null>(null)
const detail = ref<DatasetDetailVO | null>(null)
const preview = ref<{ columns: Array<{ name: string; type: string }>; rows: unknown[][] } | null>(null)
const fieldProfile = ref<Awaited<ReturnType<typeof datasetApi.profile>> | null>(null)
const indicators = ref<IndicatorVO[]>([])
const indLoading = ref(false)
const showIndForm = ref(false)
const indForm = ref({
  fieldName: '',
  name: '',
  agg: 'SUM',
  unit: '',
  formula: ''
})
const questions = ref<DatasetQuestionVO[]>([])
const qLoading = ref(false)
const showQForm = ref(false)
const editingQid = ref<number | null>(null)
const qForm = ref({
  question: '',
  sql: '',
  chartType: 'bar',
  brief: ''
})
const search = ref('')
const folderFilter = ref('全部')
const srcFilter = ref('all')
const statusFilter = ref('all')
const tab = ref<'fields' | 'preview' | 'indicators' | 'questions' | 'lineage'>('fields')
const error = ref('')
const loading = ref(false)
const learning = ref(false)
const showStudio = ref(false)
const saving = ref(false)
const studioEditing = ref(false)
const poolLoading = ref(false)
const poolSearch = ref('')
const tableSearch = ref('')
const dropTarget = ref<'dim' | 'quota' | null>(null)

const studio = ref({
  name: '',
  folder: '',
  datasourceId: '',
  tableName: '',
  fields: [] as DatasetFieldVO[]
})
const studioTables = ref<TableItem[]>([])
const studioPool = ref<DatasetFieldVO[]>([])

const showCalc = ref(false)
const calcForm = ref({
  name: '',
  label: '',
  expression: '',
  group: 'quota' as 'dim' | 'quota',
  dataType: 'DECIMAL'
})

const defaultFields: Record<string, DatasetFieldVO[]> = {
  fact_sales: [
    { name: 'region', label: '区域', group: 'dim', dataType: 'STRING', origin: 'table' },
    { name: 'channel', label: '渠道', group: 'dim', dataType: 'STRING', origin: 'table' },
    { name: 'product', label: '产品', group: 'dim', dataType: 'STRING', origin: 'table' },
    { name: 'amount', label: '销售额', group: 'quota', dataType: 'DECIMAL', origin: 'table' },
    { name: 'qty', label: '销量', group: 'quota', dataType: 'DECIMAL', origin: 'table' },
    { name: 'profit', label: '利润', group: 'quota', dataType: 'DECIMAL', origin: 'table' }
  ],
  ops_daily: [
    { name: 'day', label: '日期', group: 'dim', dataType: 'STRING', origin: 'table' },
    { name: 'module', label: '模块', group: 'dim', dataType: 'STRING', origin: 'table' },
    { name: 'uv', label: 'UV', group: 'quota', dataType: 'DECIMAL', origin: 'table' },
    { name: 'pv', label: 'PV', group: 'quota', dataType: 'DECIMAL', origin: 'table' }
  ]
}

const folders = computed(() => {
  const map = new Map<string, number>()
  for (const d of items.value) {
    const f = d.folder || '未分组'
    map.set(f, (map.get(f) || 0) + 1)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count }))
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter((d) => {
    if (folderFilter.value !== '全部' && (d.folder || '未分组') !== folderFilter.value) return false
    if (srcFilter.value !== 'all' && d.datasourceId !== srcFilter.value) return false
    if (statusFilter.value !== 'all' && (d.status || 'ready') !== statusFilter.value) return false
    if (!q) return true
    const src = srcNameOf(d.datasourceId).toLowerCase()
    return (
      d.name.toLowerCase().includes(q) ||
      (d.folder || '').toLowerCase().includes(q) ||
      src.includes(q) ||
      (d.tableName || '').toLowerCase().includes(q)
    )
  })
})

const srcName = computed(() => {
  const id = detail.value?.meta.datasourceId
  return sources.value.find((s) => s.id === id)?.name || id || '—'
})

function srcNameOf(id?: string) {
  if (!id) return '—'
  return sources.value.find((s) => s.id === id)?.name || id
}

function srcOf(id?: string) {
  return sources.value.find((s) => s.id === id)
}

const TYPE_STYLE: Record<string, { short: string; bg: string }> = {
  mysql: { short: 'My', bg: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' },
  mariadb: { short: 'Ma', bg: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' },
  pg: { short: 'PG', bg: 'linear-gradient(135deg,#38bdf8,#0369a1)' },
  postgresql: { short: 'PG', bg: 'linear-gradient(135deg,#38bdf8,#0369a1)' },
  postgres: { short: 'PG', bg: 'linear-gradient(135deg,#38bdf8,#0369a1)' },
  demo: { short: 'Demo', bg: 'linear-gradient(135deg,#94a3b8,#475569)' }
}

function typeStyle(type?: string) {
  if (type && TYPE_STYLE[type]) return TYPE_STYLE[type]
  return { short: (type || 'DS').slice(0, 2).toUpperCase(), bg: 'linear-gradient(135deg,#818cf8,#4f46e5)' }
}

function srcTypeOf(id?: string) {
  return srcOf(id)?.type
}

const isDetail = computed(() => typeof route.params.id === 'string' && !!route.params.id)

const dimN = computed(() => detail.value?.fields.filter((f) => f.group === 'dim').length || 0)
const quotaN = computed(() => detail.value?.fields.filter((f) => f.group === 'quota').length || 0)

const selectedNames = computed(() => new Set(studio.value.fields.map((f) => f.name)))

const filteredPool = computed(() => {
  const q = poolSearch.value.trim().toLowerCase()
  if (!q) return studioPool.value
  return studioPool.value.filter(
    (f) => f.name.toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q)
  )
})

const dimFields = computed(() => studio.value.fields.filter((f) => f.group === 'dim'))
const quotaFields = computed(() => studio.value.fields.filter((f) => f.group === 'quota'))

/** 字段的自动识别角色（learned role），供字段表展示"系统识别"列 */
function isAutoRole(src?: string) {
  return src === 'learned' || src === 'llm' || src === 'stats'
}
function learnedRoleOf(fieldName: string): { role: string; src: string } | null {
  const f = fieldProfile.value?.fields.find((x) => x.name === fieldName)
  if (!f || !f.role || !isAutoRole(f.roleSource)) return null
  return { role: f.role, src: f.roleSource || 'learned' }
}
const learnedRoles = computed(() => {
  const m = new Map<string, string>()
  for (const f of fieldProfile.value?.fields || []) {
    if (f.role && isAutoRole(f.roleSource)) m.set(f.name, f.role)
  }
  return m
})
const hasLearned = computed(() => learnedRoles.value.size > 0)

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    dim: '维度',
    measure: '指标',
    time: '时间',
    flag: '标志位',
    id: 'ID',
    junk: '忽略',
    text: '文本'
  }
  return map[role] || role
}

function isNumericType(t?: string) {
  const u = (t || '').toUpperCase()
  return (
    u === 'DECIMAL' ||
    u === 'NUMBER' ||
    u === 'INT' ||
    u === 'INTEGER' ||
    u === 'BIGINT' ||
    u === 'FLOAT' ||
    u === 'DOUBLE' ||
    u.includes('INT') ||
    u.includes('NUMERIC') ||
    u.includes('DECIMAL') ||
    u.includes('FLOAT') ||
    u.includes('DOUBLE')
  )
}

function inferGroup(dataType?: string): 'dim' | 'quota' {
  return isNumericType(dataType) ? 'quota' : 'dim'
}

function normalizeField(f: DatasetFieldVO): DatasetFieldVO {
  return {
    name: f.name,
    label: f.label || f.name,
    group: f.group === 'quota' ? 'quota' : 'dim',
    dataType: f.dataType,
    origin: f.origin === 'calc' ? 'calc' : 'table',
    expression: f.expression || undefined
  }
}

async function load() {
  error.value = ''
  try {
    const [list, srcs] = await Promise.all([datasetApi.list(), datasourceApi.list()])
    items.value = list
    sources.value = srcs
    const wanted = typeof route.params.id === 'string' ? route.params.id : ''
    const id = list.some((d) => d.id === wanted) ? wanted : list[0]?.id || ''
    if (!id) {
      selectedId.value = null
      detail.value = null
      return
    }
    if (wanted !== id) {
      await router.replace(`/datasets/${id}`)
      return
    }
    await selectDs(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function selectDs(id: string, { keepQuery = false }: { keepQuery?: boolean } = {}) {
  selectedId.value = id
  loading.value = true
  preview.value = null
  fieldProfile.value = null
  try {
    detail.value = await datasetApi.get(id)
    loading.value = false
    loadIndicators()
    loadQuestions()
    void loadFieldProfile(id)
    if (keepQuery) {
      router.replace({ path: `/datasets/${id}`, query: { ...route.query } })
    } else {
      router.replace(`/datasets/${id}`)
    }
    if (tab.value === 'preview') await loadPreview()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

async function loadFieldProfile(id: string) {
  try {
    const p = await datasetApi.profile(id)
    if (selectedId.value === id) fieldProfile.value = p
  } catch {
    if (selectedId.value === id) fieldProfile.value = null
  }
}

async function loadPreview() {
  if (!selectedId.value) return
  try {
    preview.value = await datasetApi.preview(selectedId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 手动触发字段自学习：重算角色/统计/采样，刷新字段画像 */
const learnConfirm = ref(false)
const learnJobId = ref<string | null>(null)
const learnPhase = ref('queued')
const learnPhaseLabel = ref('排队中')
const learnStopping = ref(false)
const learnStopRequested = ref(false)
const learnResult = ref<{
  fieldCount?: number
  dimensionCount?: number
  roleCounts?: Record<string, number>
  llmReviewed?: boolean
  llmChanged?: number
  llmSkipReason?: string
  cancelled?: boolean
} | null>(null)

const LEARN_STEPS = [
  { id: 'sample', label: '采样', hint: '读取表内最多 30 行' },
  { id: 'stats', label: '统计', hint: '取值分布 / 唯一值 / 空值率' },
  { id: 'extract', label: '抽取', hint: '指标与公共维度候选' },
  { id: 'llm', label: '复核', hint: '模型校正角色与业务名' }
]

function learnStepState(id: string): 'wait' | 'on' | 'done' {
  const order = LEARN_STEPS.map((s) => s.id)
  const cur = order.indexOf(learnPhase.value)
  const idx = order.indexOf(id)
  if (learnPhase.value === 'done') return 'done'
  if (cur < 0) return idx === 0 && learning.value ? 'on' : 'wait'
  if (idx < cur) return 'done'
  if (idx === cur) return 'on'
  return 'wait'
}

function askLearn() {
  learnConfirm.value = true
}
function cancelLearn() {
  if (learning.value) return
  learnConfirm.value = false
}
async function confirmLearn() {
  if (!selectedId.value) return
  learning.value = true
  learnStopping.value = false
  learnStopRequested.value = false
  error.value = ''
  learnResult.value = null
  learnPhase.value = 'queued'
  learnPhaseLabel.value = '排队中'
  try {
    const started = await datasetApi.startLearn(selectedId.value)
    if (!started.jobId) {
      throw new Error('后端未返回学习任务，请刷新页面后重试')
    }
    learnJobId.value = started.jobId
    const ds = selectedId.value
    const jobId = started.jobId
    if (learnStopRequested.value) {
      await datasetApi.cancelLearn(ds, jobId).catch(() => undefined)
    }
    for (;;) {
      const snap = await datasetApi.learnJob(ds, jobId)
      learnPhase.value = snap.phase || snap.status
      learnPhaseLabel.value = snap.phaseLabel || snap.status
      if (snap.status === 'cancelling') {
        learnStopping.value = true
        learnPhaseLabel.value = snap.phaseLabel || '正在停止…'
      }
      if (snap.status === 'done') {
        const r = snap.result || {}
        learnConfirm.value = false
        fieldProfile.value = await datasetApi.profile(ds).catch(() => fieldProfile.value)
        if (tab.value === 'indicators') await loadIndicators()
        if (tab.value === 'questions') await loadQuestions()
        learnResult.value = {
          fieldCount: r.fieldCount,
          dimensionCount: r.dimensionCount,
          roleCounts: r.roleCounts,
          llmReviewed: r.llmReviewed,
          llmChanged: r.llmChanged,
          llmSkipReason: r.llmSkipReason
        }
        break
      }
      if (snap.status === 'cancelled') {
        learnConfirm.value = false
        learnResult.value = { cancelled: true }
        try {
          fieldProfile.value = await datasetApi.profile(ds)
        } catch {
          /* ignore */
        }
        break
      }
      if (snap.status === 'error') {
        error.value = snap.error || snap.result?.error || '学习失败'
        learnConfirm.value = false
        break
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    learnConfirm.value = false
  } finally {
    learning.value = false
    learnStopping.value = false
    learnStopRequested.value = false
    learnJobId.value = null
  }
}
async function stopLearn() {
  learnStopRequested.value = true
  learnStopping.value = true
  learnPhaseLabel.value = '正在停止…'
  if (!selectedId.value || !learnJobId.value) return
  try {
    await datasetApi.cancelLearn(selectedId.value, learnJobId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    learnStopping.value = false
  }
}
function goList() {
  const first = items.value[0]?.id
  if (first) void router.push(`/datasets/${first}`)
  else void router.push('/datasets')
}

function goSrc() {
  const id = detail.value?.meta.datasourceId
  if (id) void router.push(`/datasources/${id}`)
}

function goAskBlank() {
  const ds = selectedId.value || ''
  const params = new URLSearchParams()
  if (ds) params.set('datasetId', ds)
  void router.push(`/conversations?${params.toString()}`)
}

async function toggleDetailRole(name: string, group: 'dim' | 'quota') {
  if (!selectedId.value || !detail.value) return
  const current = detail.value.fields.find((f) => f.name === name)
  if (!current || current.group === group) return
  const fields = detail.value.fields.map((f) => (f.name === name ? { ...f, group } : f))
  try {
    const saved = await datasetApi.putFields(selectedId.value, fields.map(normalizeField))
    if (saved) detail.value = saved
    else detail.value = { ...detail.value, fields }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function openDataset(id: string) {
  void router.push(`/datasets/${id}`)
}

function formatDsTime(t?: number) {
  if (!t) return '—'
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function dsStatusLabel(s?: string) {
  if (s === 'ready' || s === 'active') return '就绪'
  if (s === 'draft') return '草稿'
  if (s === 'error') return '异常'
  return s || '—'
}

function goDimensions() {
  learnResult.value = null
  void router.push('/knowledge')
}
function roleLabel2(r: string): string {
  const map: Record<string, string> = { dim: '维度', measure: '指标', time: '时间', flag: '标志位', id: 'ID', junk: '忽略' }
  return map[r] || r
}

/** 指标注册表（阶段2「指标确认」）：自学习 draft 候选 + 人工确认 confirmed */
async function loadIndicators() {
  if (!selectedId.value) return
  indLoading.value = true
  try {
    indicators.value = await indicatorApi.byDataset(selectedId.value)
  } catch {
    indicators.value = []
  } finally {
    indLoading.value = false
  }
}

async function confirmIndicator(ind: IndicatorVO) {
  try {
    const updated = await indicatorApi.confirm(ind.id)
    const i = indicators.value.findIndex((x) => x.id === ind.id)
    if (i >= 0) indicators.value[i] = updated
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function deprecateIndicator(ind: IndicatorVO) {
  try {
    const updated = await indicatorApi.deprecate(ind.id)
    const i = indicators.value.findIndex((x) => x.id === ind.id)
    if (i >= 0) indicators.value[i] = updated
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeIndicator(ind: IndicatorVO) {
  try {
    await indicatorApi.remove(ind.id)
    indicators.value = indicators.value.filter((x) => x.id !== ind.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function addIndicator() {
  if (!selectedId.value) return
  const name = indForm.value.name.trim()
  const field = indForm.value.fieldName.trim()
  if (!name || !field) {
    error.value = '指标名与字段必填'
    return
  }
  try {
    const created = await indicatorApi.create({
      datasetId: selectedId.value,
      fieldName: field,
      name,
      agg: indForm.value.agg || 'SUM',
      unit: indForm.value.unit.trim() || undefined,
      formula: indForm.value.formula.trim() || undefined,
      status: 'draft'
    })
    indicators.value.unshift(created)
    showIndForm.value = false
    indForm.value = { fieldName: '', name: '', agg: 'SUM', unit: '', formula: '' }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function resetQForm() {
  editingQid.value = null
  qForm.value = { question: '', sql: '', chartType: 'bar', brief: '' }
}

function toggleQForm() {
  if (showQForm.value) {
    showQForm.value = false
    resetQForm()
    return
  }
  showQForm.value = true
}

async function loadQuestions() {
  if (!selectedId.value) return
  qLoading.value = true
  try {
    questions.value = await questionApi.byDataset(selectedId.value)
  } catch {
    questions.value = []
  } finally {
    qLoading.value = false
  }
}

async function saveQuestion() {
  if (!selectedId.value) return
  const question = qForm.value.question.trim()
  const sql = qForm.value.sql.trim()
  if (!question || !sql) {
    error.value = '问法与 SQL 必填'
    return
  }
  const table = detail.value?.meta.tableName || ''
  if (table && !sql.toLowerCase().includes(table.toLowerCase())) {
    error.value = `SQL 必须使用当前物理表 ${table}，表名不可改`
    return
  }
  try {
    const body = {
      question,
      sql,
      chartType: qForm.value.chartType || undefined,
      brief: qForm.value.brief.trim() || undefined,
      status: 'active'
    }
    if (editingQid.value != null) {
      const updated = await questionApi.update(selectedId.value, editingQid.value, body)
      const i = questions.value.findIndex((x) => x.id === updated.id)
      if (i >= 0) questions.value[i] = updated
    } else {
      const created = await questionApi.create(selectedId.value, body)
      questions.value.unshift(created)
    }
    showQForm.value = false
    resetQForm()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function startEditQuestion(q: DatasetQuestionVO) {
  editingQid.value = q.id
  qForm.value = {
    question: q.question,
    sql: q.sql,
    chartType: q.chartType || 'bar',
    brief: q.brief || ''
  }
  showQForm.value = true
}

async function toggleQuestion(q: DatasetQuestionVO) {
  if (!selectedId.value) return
  const next = q.status === 'active' ? 'disabled' : 'active'
  try {
    const updated = await questionApi.toggle(selectedId.value, q.id, next)
    const i = questions.value.findIndex((x) => x.id === q.id)
    if (i >= 0) questions.value[i] = updated
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeQuestion(q: DatasetQuestionVO) {
  if (!selectedId.value) return
  try {
    await questionApi.remove(selectedId.value, q.id)
    questions.value = questions.value.filter((x) => x.id !== q.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function tryAsk(q: DatasetQuestionVO) {
  const ds = selectedId.value || ''
  const params = new URLSearchParams({ q: q.question, autorun: '1' })
  if (ds) params.set('datasetId', ds)
  void router.push(`/conversations?${params.toString()}`)
}

async function openStudio(mode: 'create' | 'edit', seed?: { src?: string; table?: string }) {
  studioEditing.value = mode === 'edit'
  error.value = ''
  poolSearch.value = ''
  showCalc.value = false
  if (mode === 'edit' && detail.value) {
    studio.value = {
      name: detail.value.meta.name,
      folder: detail.value.meta.folder || '未分组',
      datasourceId: detail.value.meta.datasourceId || '',
      tableName: detail.value.meta.tableName || '',
      fields: detail.value.fields.map(normalizeField)
    }
  } else {
    const src = seed?.src || (route.query.src as string) || ''
    const table = seed?.table || (route.query.table as string) || ''
    studio.value = {
      name: '',
      folder: '',
      datasourceId: src,
      tableName: table,
      fields: []
    }
  }
  tableSearch.value = studio.value.tableName
  showStudio.value = true
  await onSrcChange()
  if (studio.value.tableName) await loadPool()
  else studioPool.value = []
}

async function onDatasourceChange() {
  tableSearch.value = ''
  await onSrcChange()
}

async function onSrcChange() {
  if (!studio.value.datasourceId) {
    studioTables.value = []
    studio.value.tableName = ''
    studioPool.value = []
    studio.value.fields = studio.value.fields.filter((f) => f.origin === 'calc')
    return
  }
  try {
    const src = sources.value.find((s) => s.id === studio.value.datasourceId)
    const schema =
      typeof route.query.schema === 'string' ? route.query.schema : src?.schema || undefined
    studioTables.value = await datasourceApi.tables(studio.value.datasourceId, schema)
    if (studio.value.tableName && !studioTables.value.some((t) => t.name === studio.value.tableName)) {
      studio.value.tableName = ''
      studioPool.value = []
      studio.value.fields = studio.value.fields.filter((f) => f.origin === 'calc')
    } else if (studio.value.tableName) {
      await loadPool()
    }
  } catch {
    studioTables.value = []
  }
}

function onTableSearchInput() {
  if (tableSearch.value.trim() === studio.value.tableName) return
  studio.value.tableName = ''
  studioPool.value = []
  studio.value.fields = studio.value.fields.filter((f) => f.origin === 'calc')
}

async function onTableSearchCommit() {
  const query = tableSearch.value.trim().toLowerCase()
  const table = studioTables.value.find((t) => t.name.toLowerCase() === query)
  if (!table) return
  tableSearch.value = table.name
  if (studio.value.tableName === table.name) return
  studio.value.tableName = table.name
  await onTableChange()
}

async function onTableChange() {
  studio.value.fields = studio.value.fields.filter((f) => f.origin === 'calc')
  await loadPool()
}

async function loadPool() {
  if (!studio.value.datasourceId || !studio.value.tableName) {
    studioPool.value = []
    return
  }
  poolLoading.value = true
  try {
    const defs = defaultFields[studio.value.tableName]
    if (defs?.length) {
      studioPool.value = defs.map((f) => ({ ...f }))
      return
    }
    const src = sources.value.find((s) => s.id === studio.value.datasourceId)
    const schema =
      typeof route.query.schema === 'string' ? route.query.schema : src?.schema || undefined
    const cols = await datasourceApi.columns(
      studio.value.datasourceId,
      studio.value.tableName,
      schema
    )
    studioPool.value = cols.map((c) => ({
      name: c.name,
      label: c.comment || c.name,
      group: inferGroup(c.dataType),
      dataType: c.dataType,
      origin: 'table' as const
    }))
  } catch {
    studioPool.value = []
    error.value = '无法加载表字段，请检查数据源连通性'
  } finally {
    poolLoading.value = false
  }
}

function addField(f: DatasetFieldVO, forceGroup?: 'dim' | 'quota') {
  if (selectedNames.value.has(f.name)) {
    if (forceGroup) setFieldGroup(f.name, forceGroup)
    return
  }
  studio.value.fields.push(
    normalizeField({
      ...f,
      group: forceGroup || f.group || inferGroup(f.dataType)
    })
  )
}

function removeField(name: string) {
  studio.value.fields = studio.value.fields.filter((f) => f.name !== name)
}

function setFieldGroup(name: string, group: 'dim' | 'quota') {
  const f = studio.value.fields.find((x) => x.name === name)
  if (f) f.group = group
}

function clearSelected() {
  studio.value.fields = []
}

function addAllPool() {
  for (const f of studioPool.value) addField(f)
}

function onPoolDblClick(f: DatasetFieldVO) {
  addField(f)
}

function parseDrag(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer?.getData('application/x-od-field') || e.dataTransfer?.getData('text/plain')
  if (!raw) return null
  try {
    return JSON.parse(raw) as DragPayload
  } catch {
    return null
  }
}

function onPoolDragStart(e: DragEvent, f: DatasetFieldVO) {
  const payload: DragPayload = {
    kind: 'pool',
    name: f.name,
    label: f.label,
    group: f.group,
    dataType: f.dataType,
    origin: f.origin || 'table',
    expression: f.expression
  }
  e.dataTransfer?.setData('application/x-od-field', JSON.stringify(payload))
  e.dataTransfer?.setData('text/plain', JSON.stringify(payload))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
}

function onSelectedDragStart(e: DragEvent, f: DatasetFieldVO, indexInGroup: number, group: 'dim' | 'quota') {
  const globalIndex = studio.value.fields.findIndex((x) => x.name === f.name)
  const payload: DragPayload = {
    kind: 'selected',
    name: f.name,
    label: f.label,
    group,
    dataType: f.dataType,
    origin: f.origin,
    expression: f.expression,
    index: globalIndex >= 0 ? globalIndex : indexInGroup
  }
  e.dataTransfer?.setData('application/x-od-field', JSON.stringify(payload))
  e.dataTransfer?.setData('text/plain', JSON.stringify(payload))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onZoneDragOver(e: DragEvent, zone: 'dim' | 'quota') {
  e.preventDefault()
  dropTarget.value = zone
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onZoneDragLeave(zone: 'dim' | 'quota') {
  if (dropTarget.value === zone) dropTarget.value = null
}

function reorderWithinGroup(name: string, targetGroup: 'dim' | 'quota', beforeName?: string) {
  const list = [...studio.value.fields]
  const from = list.findIndex((f) => f.name === name)
  if (from < 0) return
  const [item] = list.splice(from, 1)
  item.group = targetGroup
  if (beforeName) {
    const to = list.findIndex((f) => f.name === beforeName)
    if (to >= 0) list.splice(to, 0, item)
    else list.push(item)
  } else {
    // append after last of same group, or at end
    let insertAt = list.length
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].group === targetGroup) {
        insertAt = i + 1
        break
      }
    }
    // if no same-group yet, put dims before quotas / quotas after dims
    if (!list.some((f) => f.group === targetGroup)) {
      if (targetGroup === 'dim') {
        insertAt = 0
      } else {
        insertAt = list.length
      }
    }
    list.splice(insertAt, 0, item)
  }
  studio.value.fields = list
}

function onZoneDrop(e: DragEvent, zone: 'dim' | 'quota', beforeName?: string) {
  e.preventDefault()
  dropTarget.value = null
  const payload = parseDrag(e)
  if (!payload) return
  if (payload.kind === 'pool') {
    addField(
      {
        name: payload.name,
        label: payload.label,
        group: zone,
        dataType: payload.dataType,
        origin: payload.origin || 'table',
        expression: payload.expression
      },
      zone
    )
    if (beforeName) reorderWithinGroup(payload.name, zone, beforeName)
    return
  }
  reorderWithinGroup(payload.name, zone, beforeName)
}

function openCalcDialog() {
  calcForm.value = {
    name: '',
    label: '',
    expression: '',
    group: 'quota',
    dataType: 'DECIMAL'
  }
  showCalc.value = true
}

function saveCalcField() {
  const name = calcForm.value.name.trim()
  const expr = calcForm.value.expression.trim()
  const label = calcForm.value.label.trim() || name
  if (!name) {
    error.value = '请填写计算列字段名'
    return
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    error.value = '字段名需以字母或下划线开头，仅含字母数字下划线'
    return
  }
  if (!expr) {
    error.value = '请填写计算表达式'
    return
  }
  if (selectedNames.value.has(name) || studioPool.value.some((f) => f.name === name)) {
    error.value = `字段名「${name}」已存在`
    return
  }
  error.value = ''
  addField({
    name,
    label,
    group: calcForm.value.group,
    dataType: calcForm.value.dataType,
    origin: 'calc',
    expression: expr
  })
  showCalc.value = false
}

function closeStudio() {
  showStudio.value = false
  showCalc.value = false
  if (studioEditing.value) {
    router.replace({ path: route.path, query: {} })
  }
}

async function saveStudio() {
  if (!studio.value.name.trim()) {
    error.value = '请填写数据集名称'
    return
  }
  if (!studio.value.datasourceId) {
    error.value = '请选择数据源'
    return
  }
  if (!studio.value.tableName) {
    error.value = '请选择数据表'
    return
  }
  if (!studio.value.fields.length) {
    error.value = '请至少拖入一个字段到维度或指标'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const fields = studio.value.fields.map(normalizeField)
    let saved: DatasetDetailVO
    if (studioEditing.value && selectedId.value) {
      await datasetApi.update(selectedId.value, {
        name: studio.value.name.trim(),
        folder: studio.value.folder.trim() || '未分组',
        tableName: studio.value.tableName
      })
      saved = (await datasetApi.putFields(selectedId.value, fields))!
    } else {
      saved = await datasetApi.create({
        name: studio.value.name.trim(),
        folder: studio.value.folder.trim() || '未分组',
        datasourceId: studio.value.datasourceId,
        tableName: studio.value.tableName,
        fields
      })
    }
    showStudio.value = false
    showCalc.value = false
    studioEditing.value = false
    router.replace(`/datasets/${saved.meta.id}`)
    await load()
    await selectDs(saved.meta.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  const bootStudio = route.query.studio === '1'
  const bootSrc = typeof route.query.src === 'string' ? route.query.src : ''
  const bootTable = typeof route.query.table === 'string' ? route.query.table : ''
  const bootId = typeof route.params.id === 'string' ? route.params.id : ''
  await load()
  if (bootStudio) {
    if (bootId && detail.value?.meta?.id === bootId) {
      await openStudio('edit')
    } else {
      await openStudio('create', { src: bootSrc, table: bootTable })
    }
    router.replace({ path: route.path, query: {} })
  }
})

watch(
  () => route.params.id,
  async (id) => {
    if (typeof id === 'string' && id) {
      if (id !== selectedId.value) await selectDs(id)
      return
    }
    if (items.value[0]) {
      await router.replace(`/datasets/${items.value[0].id}`)
      return
    }
    selectedId.value = null
    detail.value = null
  }
)

watch(tab, (t) => {
  if (t === 'preview') loadPreview()
  if (t === 'questions') loadQuestions()
  if (t === 'indicators') loadIndicators()
})
</script>

<template>
  <div class="page asset-studio">
    <p v-if="error && !showStudio" class="banner-err">{{ error }}</p>

    <div class="asset-body">
      <aside class="asset-rail">
        <div class="rail-head"><span>数据集</span><span>{{ filtered.length }}</span></div>
        <div class="rail-tools">
          <label class="asset-search">
            <span class="ico">⌕</span>
            <input v-model="search" type="search" placeholder="搜索名称、分组、数据源" />
          </label>
          <div class="rail-tools-row">
            <select v-model="folderFilter" class="rail-select" aria-label="分组">
              <option value="全部">全部分组</option>
              <option v-for="f in folders" :key="f.name" :value="f.name">{{ f.name }}（{{ f.count }}）</option>
            </select>
            <select v-model="srcFilter" class="rail-select" aria-label="数据源">
              <option value="all">全部数据源</option>
              <option v-for="s in sources" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
        </div>
        <div class="rail-scroll">
          <button
            v-for="d in filtered"
            :key="d.id"
            type="button"
            class="asset-item"
            :class="{ on: d.id === selectedId }"
            @click="openDataset(d.id)"
          >
            <span class="type-badge" :style="{ background: typeStyle(srcTypeOf(d.datasourceId)).bg }">
              {{ typeStyle(srcTypeOf(d.datasourceId)).short }}
            </span>
            <div class="meta">
              <div class="name">{{ d.name }}</div>
              <div class="desc">
                <span>{{ d.folder || '未分组' }}</span>
                <span>·</span>
                <span>{{ srcNameOf(d.datasourceId) }}</span>
              </div>
            </div>
          </button>
          <div v-if="!filtered.length" class="empty-illus">
            <div class="big">⌀</div>
            {{ items.length ? '无匹配数据集' : '还没有数据集' }}
          </div>
        </div>
      </aside>

      <div class="asset-main">
        <div class="asset-bar">
          <div class="spacer"></div>
          <button type="button" class="btn primary" @click="openStudio('create')">+ 新建数据集</button>
        </div>
        <section class="asset-stage">
        <template v-if="detail && !loading">
          <div class="hero-card">
            <div class="hero-top">
              <span class="type-badge lg" :style="{ background: typeStyle(srcTypeOf(detail.meta.datasourceId)).bg }">
                {{ typeStyle(srcTypeOf(detail.meta.datasourceId)).short }}
              </span>
              <div class="hero-copy">
                <h2>{{ detail.meta.name }}</h2>
                <div class="sub">
                  {{ detail.meta.folder || '未分组' }} · 来自
                  <button type="button" class="link" @click="goSrc">{{ srcName }}</button>
                  · <code>{{ detail.meta.tableName || '—' }}</code>
                  · {{ dsStatusLabel(detail.meta.status) }}
                </div>
              </div>
              <div class="hero-actions">
                <button type="button" class="btn" @click="goSrc">数据源</button>
                <button type="button" class="btn" :disabled="learning" @click="askLearn">
                  {{ learning ? '学习中…' : '重新学习' }}
                </button>
                <button type="button" class="btn" @click="openStudio('edit')">编辑数据集</button>
                <button type="button" class="btn" @click="tab = 'preview'">预览取数</button>
                <button type="button" class="btn primary" @click="goAskBlank">问数</button>
              </div>
            </div>
            <div class="metric-strip">
              <div class="metric-cell">
                <div class="k">维度</div>
                <div class="v" style="color:#245bdb">{{ dimN }}</div>
                <div class="h">Dimension</div>
              </div>
              <div class="metric-cell">
                <div class="k">指标</div>
                <div class="v" style="color:#047857">{{ quotaN }}</div>
                <div class="h">Measure</div>
              </div>
              <div class="metric-cell">
                <div class="k">字段</div>
                <div class="v">{{ detail.fields.length }}</div>
                <div class="h">Fields</div>
              </div>
              <div class="metric-cell">
                <div class="k">高频问法</div>
                <div class="v">{{ questions.length }}</div>
                <div class="h">Few-shot</div>
              </div>
            </div>
          </div>

          <div class="tab-row">
            <div class="studio-tabs">
              <button type="button" :class="{ on: tab === 'fields' }" @click="tab = 'fields'">字段</button>
              <button type="button" :class="{ on: tab === 'indicators' }" @click="tab = 'indicators'">指标确认</button>
              <button type="button" :class="{ on: tab === 'questions' }" @click="tab = 'questions'">高频问法</button>
              <button type="button" :class="{ on: tab === 'preview' }" @click="tab = 'preview'">预览</button>
              <button type="button" :class="{ on: tab === 'lineage' }" @click="tab = 'lineage'">血缘</button>
            </div>
            <span class="hint">切换页签不会丢失字段角色修改</span>
          </div>

          <div v-if="tab === 'fields'" class="soft-panel">
            <div class="phd">
              <h3>字段配置</h3>
              <span class="hint">切换维度 / 指标角色 · 供图表编码槽使用</span>
            </div>
            <div class="pbd flush">
              <div v-if="hasLearned" class="learn-banner" style="margin:12px 16px 0">
                <b>系统已自动识别字段角色</b>
                <span>基于真实采样统计：ID/标志位/时间/维度/指标。</span>
              </div>
              <table class="field-table">
                <thead>
                  <tr>
                    <th>显示名</th>
                    <th>字段</th>
                    <th>角色</th>
                    <th>自动识别</th>
                    <th>类型</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in detail.fields" :key="f.name">
                    <td><b>{{ f.label }}</b></td>
                    <td><code>{{ f.name }}</code></td>
                    <td>
                      <div class="role-seg">
                        <button type="button" :class="{ on: f.group === 'dim', dim: f.group === 'dim' }" @click="toggleDetailRole(f.name, 'dim')">维度</button>
                        <button type="button" :class="{ on: f.group === 'quota', quota: f.group === 'quota' }" @click="toggleDetailRole(f.name, 'quota')">指标</button>
                      </div>
                    </td>
                    <td>
                      <template v-if="learnedRoles.get(f.name)">
                        <span class="mini-tag" :class="learnedRoles.get(f.name) === 'quota' || learnedRoles.get(f.name) === 'measure' ? 'green' : 'blue'">
                          {{ roleLabel(learnedRoles.get(f.name)!) }}
                        </span>
                      </template>
                      <span v-else class="muted">—</span>
                    </td>
                    <td class="muted">{{ f.dataType || '—' }}</td>
                    <td>
                      <template v-if="f.origin === 'calc'">
                        <span class="mini-tag">计算</span>
                        <code v-if="f.expression" class="expr" :title="f.expression">{{ f.expression }}</code>
                      </template>
                      <span v-else class="muted">表字段</span>
                    </td>
                  </tr>
                  <tr v-if="!detail.fields.length">
                    <td colspan="6" class="muted" style="text-align:center">暂无字段，点「编辑数据集」配置</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else-if="tab === 'indicators'" class="soft-panel">
            <div class="phd">
              <h3>指标注册表</h3>
              <span class="hint">自学习产出候选，确认后成为权威口径</span>
              <button type="button" class="btn sm" @click="showIndForm = !showIndForm">
                {{ showIndForm ? '收起' : '手动新增' }}
              </button>
            </div>
            <div class="pbd">
              <div v-if="showIndForm" class="ind-form">
                <input v-model="indForm.fieldName" placeholder="字段名（如 spending_amount）" class="ipt sm" />
                <input v-model="indForm.name" placeholder="业务名（如 消费金额）" class="ipt sm" />
                <select v-model="indForm.agg" class="ipt sm">
                  <option value="SUM">SUM</option>
                  <option value="AVG">AVG</option>
                  <option value="COUNT">COUNT</option>
                  <option value="MIN">MIN</option>
                  <option value="MAX">MAX</option>
                </select>
                <input v-model="indForm.unit" placeholder="单位（元/万元/%/件）" class="ipt sm" />
                <input v-model="indForm.formula" placeholder="口径说明（可选）" class="ipt sm grow" />
                <button type="button" class="btn sm primary" @click="addIndicator">新增</button>
              </div>
              <table class="field-table">
                <thead>
                  <tr>
                    <th>业务名</th>
                    <th>字段</th>
                    <th>聚合</th>
                    <th>单位</th>
                    <th>口径</th>
                    <th>状态</th>
                    <th>可信度</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="ind in indicators" :key="ind.id">
                    <td>{{ ind.name }}</td>
                    <td><code>{{ ind.fieldName }}</code></td>
                    <td>{{ ind.agg || '—' }}</td>
                    <td>{{ ind.unit || '—' }}</td>
                    <td class="muted" :title="ind.formula">{{ ind.formula || '—' }}</td>
                    <td>
                      <span class="mini-tag" :class="ind.status === 'confirmed' ? 'green' : 'blue'">
                        {{ ind.status === 'confirmed' ? '已确认' : ind.status === 'deprecated' ? '已作废' : '候选' }}
                      </span>
                    </td>
                    <td class="muted">{{ Math.round((ind.confidence || 0) * 100) }}%</td>
                    <td class="ind-ops">
                      <template v-if="ind.status === 'draft'">
                        <button type="button" class="link" @click="confirmIndicator(ind)">确认</button>
                        <button type="button" class="link danger" @click="removeIndicator(ind)">删除</button>
                      </template>
                      <template v-else-if="ind.status === 'confirmed'">
                        <button type="button" class="link" @click="deprecateIndicator(ind)">作废</button>
                      </template>
                      <template v-else>
                        <button type="button" class="link" @click="confirmIndicator(ind)">恢复</button>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="!indLoading && !indicators.length">
                    <td colspan="8" class="muted" style="text-align:center">暂无候选指标。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else-if="tab === 'questions'" class="soft-panel">
            <div class="phd">
              <h3>高频问法</h3>
              <span class="hint">自然语言 + 已验证 SQL · 表名必须是 {{ detail.meta.tableName || '当前物理表' }}</span>
              <button type="button" class="btn sm" @click="toggleQForm">
                {{ showQForm ? '收起' : editingQid != null ? '继续编辑' : '新增问法' }}
              </button>
            </div>
            <div class="pbd">
              <div v-if="showQForm" class="q-form">
                <input v-model="qForm.question" class="ipt sm" placeholder="问法，如：人民币订单有多少" />
                <textarea
                  v-model="qForm.sql"
                  class="ipt sm q-sql-input"
                  :placeholder="`标准 SQL，表名必须是 ${detail.meta.tableName || '当前物理表'}`"
                />
                <div class="q-form-row">
                  <select v-model="qForm.chartType" class="ipt sm">
                    <option value="bar">柱状图</option>
                    <option value="line">折线</option>
                    <option value="pie">饼图</option>
                    <option value="table">表格</option>
                  </select>
                  <input v-model="qForm.brief" class="ipt sm grow" placeholder="简短标题（可选）" />
                  <button type="button" class="btn sm primary" @click="saveQuestion">
                    {{ editingQid != null ? '保存修改' : '新增' }}
                  </button>
                </div>
              </div>
              <table class="field-table">
                <thead>
                  <tr>
                    <th>问法</th>
                    <th>SQL</th>
                    <th>图</th>
                    <th>状态</th>
                    <th>命中</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="q in questions" :key="q.id">
                    <td>{{ q.question }}</td>
                    <td><code class="q-sql" :title="q.sql">{{ q.sql }}</code></td>
                    <td class="muted">{{ q.chartType || '—' }}</td>
                    <td>
                      <span class="mini-tag" :class="q.status === 'active' ? 'green' : 'blue'">
                        {{ q.status === 'active' ? '启用' : '停用' }}
                      </span>
                    </td>
                    <td class="muted">{{ q.hitCount || 0 }}</td>
                    <td class="ind-ops">
                      <button type="button" class="link" @click="tryAsk(q)">试问</button>
                      <button type="button" class="link" @click="startEditQuestion(q)">编辑</button>
                      <button type="button" class="link" @click="toggleQuestion(q)">
                        {{ q.status === 'active' ? '停用' : '启用' }}
                      </button>
                      <button type="button" class="link danger" @click="removeQuestion(q)">删除</button>
                    </td>
                  </tr>
                  <tr v-if="!qLoading && !questions.length">
                    <td colspan="6" class="muted" style="text-align:center">暂无高频问法。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else-if="tab === 'preview'" class="soft-panel">
            <div class="phd">
              <h3>数据预览</h3>
              <span class="hint">datasetQuery.execute · 前 {{ preview ? preview.rows.slice(0, 10).length : 0 }} 行</span>
              <button type="button" class="btn" @click="loadPreview">运行取数</button>
            </div>
            <div class="pbd flush">
              <table v-if="preview" class="schema-table">
                <thead>
                  <tr>
                    <th v-for="f in preview.columns" :key="f.name">{{ f.name }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in preview.rows.slice(0, 10)" :key="i">
                    <td v-for="(cell, j) in row" :key="j">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-illus">加载预览…</div>
            </div>
          </div>

          <div v-else class="soft-panel">
            <div class="phd">
              <h3>血缘与消费</h3>
              <span class="hint">数据源 → 数据集 → 仪表盘</span>
            </div>
            <div class="pbd">
              <div class="lineage">
                <button type="button" class="node" @click="goSrc">
                  <b>数据源</b>{{ srcName }}
                </button>
                <div class="arrow">→</div>
                <div class="node on">
                  <b>数据集</b>{{ detail.meta.name }}
                  <div style="margin-top:4px;font-size:11px;color:var(--as-faint)">{{ dimN }} 维 · {{ quotaN }} 指标</div>
                </div>
                <div class="arrow">→</div>
                <div class="node">
                  <b>问数 / 看板</b>
                  可在对话或仪表盘编辑器中绑定
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="empty-illus">
          <div class="big">▦</div>
          {{ loading ? '加载中…' : items.length ? '请选择左侧数据集' : '还没有数据集，先新建一个' }}
          <div v-if="!loading && !items.length" style="margin-top:12px">
            <button type="button" class="btn primary" @click="openStudio('create')">新建数据集</button>
          </div>
        </div>
      </section>
      </div>
    </div>

    <div v-if="showStudio" class="modal-mask" @click.self="closeStudio">
      <div class="studio" role="dialog" :aria-label="studioEditing ? '编辑数据集' : '新建数据集'">
        <header class="studio-head">
          <div>
            <h3>{{ studioEditing ? '编辑数据集' : '新建数据集' }}</h3>
            <p class="sub">从左侧拖字段到维度 / 指标，或双击快速添加</p>
          </div>
        </header>

        <p v-if="error && showStudio" class="dlg-err">{{ error }}</p>

        <div class="studio-meta">
          <label class="field">
            名称
            <input v-model="studio.name" placeholder="请输入数据集名称" />
          </label>
          <label class="field">
            文件夹
            <input v-model="studio.folder" placeholder="可选，如：销售分析" />
          </label>
          <label class="field">
            数据源
            <select v-model="studio.datasourceId" @change="onDatasourceChange">
              <option value="">请选择数据源</option>
              <option v-for="s in sources" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </label>
          <label class="field">
            表
            <input
              v-model="tableSearch"
              type="search"
              list="studio-table-options"
              placeholder="搜索并选择表"
              autocomplete="off"
              :disabled="!studio.datasourceId"
              @input="onTableSearchInput"
              @change="onTableSearchCommit"
            />
            <datalist id="studio-table-options">
              <option v-for="t in studioTables" :key="t.name" :value="t.name">
                {{ t.comment || t.name }}
              </option>
            </datalist>
          </label>
        </div>

        <div class="studio-body">
          <section class="col pool-col">
            <div class="col-hd">
              <span>表字段</span>
              <span class="hint">{{ filteredPool.length }}</span>
              <div class="col-hd-acts">
                <button type="button" class="linkish" :disabled="!filteredPool.length" @click="addAllPool">
                  全部加入
                </button>
                <button type="button" class="linkish" :disabled="!studio.fields.length" @click="clearSelected">
                  清空
                </button>
              </div>
            </div>
            <div class="col-bd">
              <label class="pool-search" :class="{ disabled: !studio.tableName }">
                <svg class="pool-search-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
                  <path d="M10.5 10.5 L14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <input
                  v-model="poolSearch"
                  type="search"
                  class="pool-search-inp"
                  placeholder="搜索字段名 / 显示名"
                  autocomplete="off"
                  :disabled="!studio.tableName"
                />
                <button
                  v-if="poolSearch"
                  type="button"
                  class="pool-search-clear"
                  title="清空"
                  :disabled="!studio.tableName"
                  @click="poolSearch = ''"
                >
                  ×
                </button>
              </label>
              <div v-if="poolLoading" class="empty-zone">加载字段…</div>
              <div v-else-if="!studio.tableName" class="empty-zone">请先选择数据表</div>
              <div v-else-if="!filteredPool.length" class="empty-zone">无匹配字段</div>
              <div v-else class="field-pool">
                <button
                  v-for="f in filteredPool"
                  :key="f.name"
                  type="button"
                  class="pool-row"
                  :class="[f.group, { used: selectedNames.has(f.name) }]"
                  draggable="true"
                  :title="selectedNames.has(f.name) ? '已添加 · 仍可拖到另一角色区' : '拖到右侧，或双击添加'"
                  @dragstart="onPoolDragStart($event, f)"
                  @dblclick="onPoolDblClick(f)"
                >
                  <i class="ftype">{{ f.group === 'dim' ? 'Abc' : '#' }}</i>
                  <span class="chip-label">{{ f.label }}</span>
                  <code class="chip-name">{{ f.name }}</code>
                  <span class="pool-type">{{ f.dataType || '' }}</span>
                </button>
              </div>
            </div>
          </section>

          <section
            class="col drop-zone"
            :class="{ over: dropTarget === 'dim' }"
            @dragover="onZoneDragOver($event, 'dim')"
            @dragleave="onZoneDragLeave('dim')"
            @drop="onZoneDrop($event, 'dim')"
          >
            <div class="col-hd">
              <span>维度</span>
              <span class="hint">{{ dimFields.length }}</span>
            </div>
            <div class="zone-list">
              <div v-if="!dimFields.length" class="empty-zone sm">拖入或双击添加维度</div>
              <div
                v-for="(f, idx) in dimFields"
                :key="f.name"
                class="sel-row dim"
                draggable="true"
                @dragstart="onSelectedDragStart($event, f, idx, 'dim')"
                @dragover.prevent
                @drop.stop="onZoneDrop($event, 'dim', f.name)"
              >
                <span class="grip" aria-hidden="true">⋮⋮</span>
                <div class="sel-main">
                  <input v-model="f.label" class="label-inp" :title="f.name" />
                  <code>{{ f.name }}</code>
                  <code v-if="f.origin === 'calc' && f.expression" class="expr" :title="f.expression">
                    = {{ f.expression }}
                  </code>
                </div>
                <span v-if="f.origin === 'calc'" class="tag calc">计算</span>
                <div class="role-seg">
                  <button type="button" class="on dim" disabled>维度</button>
                  <button type="button" @click="setFieldGroup(f.name, 'quota')">指标</button>
                </div>
                <button type="button" class="rm" title="移除" @click="removeField(f.name)">×</button>
              </div>
            </div>
          </section>

          <section
            class="col drop-zone"
            :class="{ over: dropTarget === 'quota' }"
            @dragover="onZoneDragOver($event, 'quota')"
            @dragleave="onZoneDragLeave('quota')"
            @drop="onZoneDrop($event, 'quota')"
          >
            <div class="col-hd">
              <span>指标</span>
              <span class="hint">{{ quotaFields.length }}</span>
              <button type="button" class="linkish calc-btn" @click="openCalcDialog">+ 计算列</button>
            </div>
            <div class="zone-list">
              <div v-if="!quotaFields.length" class="empty-zone sm">拖入指标，或新建计算列</div>
              <div
                v-for="(f, idx) in quotaFields"
                :key="f.name"
                class="sel-row quota"
                draggable="true"
                @dragstart="onSelectedDragStart($event, f, idx, 'quota')"
                @dragover.prevent
                @drop.stop="onZoneDrop($event, 'quota', f.name)"
              >
                <span class="grip" aria-hidden="true">⋮⋮</span>
                <div class="sel-main">
                  <input v-model="f.label" class="label-inp" :title="f.name" />
                  <code>{{ f.name }}</code>
                  <code v-if="f.origin === 'calc' && f.expression" class="expr" :title="f.expression">
                    = {{ f.expression }}
                  </code>
                </div>
                <span v-if="f.origin === 'calc'" class="tag calc">计算</span>
                <div class="role-seg">
                  <button type="button" @click="setFieldGroup(f.name, 'dim')">维度</button>
                  <button type="button" class="on quota" disabled>指标</button>
                </div>
                <button type="button" class="rm" title="移除" @click="removeField(f.name)">×</button>
              </div>
            </div>
          </section>
        </div>

        <footer class="studio-foot">
          <span class="foot-hint">已选 {{ studio.fields.length }} 个字段 · {{ dimFields.length }} 维 / {{ quotaFields.length }} 指标</span>
          <div class="studio-foot-acts">
            <button type="button" class="btn ghost" @click="closeStudio">取消</button>
            <button type="button" class="btn primary" :disabled="saving" @click="saveStudio">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </footer>
      </div>
    </div>

    <div v-if="showCalc" class="modal-mask nested" @click.self="showCalc = false">
      <div class="calc-dlg" role="dialog" aria-label="新建计算列">
        <header class="dlg-head">
          <h3>新建计算列</h3>
          <button type="button" class="icon-x" aria-label="关闭" @click="showCalc = false">×</button>
        </header>
        <p class="calc-tip">表达式可引用表字段名，如 <code>amount * qty</code>。本期仅保存配置，查询引擎后续执行。</p>
        <label class="field">
          字段名
          <input v-model="calcForm.name" placeholder="如 profit_rate" />
        </label>
        <label class="field">
          显示名
          <input v-model="calcForm.label" placeholder="可选，默认用字段名" />
        </label>
        <label class="field">
          表达式
          <input v-model="calcForm.expression" placeholder="如 amount / NULLIF(qty, 0)" />
        </label>
        <div class="calc-row">
          <label class="field grow">
            角色
            <select v-model="calcForm.group">
              <option value="quota">指标</option>
              <option value="dim">维度</option>
            </select>
          </label>
          <label class="field grow">
            类型
            <select v-model="calcForm.dataType">
              <option value="DECIMAL">DECIMAL</option>
              <option value="STRING">STRING</option>
              <option value="INT">INT</option>
            </select>
          </label>
        </div>
        <div class="actions">
          <button type="button" class="btn ghost sm" @click="showCalc = false">取消</button>
          <button type="button" class="btn primary sm" @click="saveCalcField">加入</button>
        </div>
      </div>
    </div>

    <div v-if="learnConfirm" class="modal-mask" @click.self="cancelLearn">
      <div class="learn-dlg" role="dialog" aria-label="确认重新学习">
        <div class="learn-ico">🧠</div>
        <h3>{{ learning ? '正在学习字段' : '重新学习字段' }}</h3>
        <p class="learn-lead">
          {{ learning ? learnPhaseLabel : `系统将重新分析「${detail?.meta.name}」的字段，自动识别角色并抽取公共维度。` }}
        </p>
        <div class="learn-steps">
          <div
            v-for="s in LEARN_STEPS"
            :key="s.id"
            class="step"
            :class="learnStepState(s.id)"
          >
            <i>{{ LEARN_STEPS.findIndex((x) => x.id === s.id) + 1 }}</i>
            <span><b>{{ s.label }}</b>{{ s.hint }}</span>
          </div>
        </div>
        <p class="learn-note">字段角色会立刻用于问数规划。指标与公共维度仍是候选，需确认后才注入对话。</p>
        <div class="learn-ft">
          <button v-if="!learning" type="button" class="btn ghost" @click="cancelLearn">取消</button>
          <button v-if="!learning" type="button" class="btn primary" @click="confirmLearn">开始学习</button>
          <button
            v-else
            type="button"
            class="btn ghost"
            :disabled="learnStopping"
            @click="stopLearn"
          >
            {{ learnStopping ? '正在停止…' : '停止学习' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="learnResult" class="modal-mask" @click.self="learnResult = null">
      <div class="learn-dlg" role="dialog" :aria-label="learnResult.cancelled ? '已停止' : '学习完成'">
        <div class="learn-ico" :class="{ ok: !learnResult.cancelled }">{{ learnResult.cancelled ? '■' : '✅' }}</div>
        <h3>{{ learnResult.cancelled ? '已停止学习' : '学习完成' }}</h3>
        <p v-if="learnResult.cancelled" class="learn-lead">已发出停止。采样若已完成，规则结果会保留；模型复核不会继续写库。</p>
        <template v-else>
          <p class="learn-lead">已识别 {{ learnResult.fieldCount ?? '—' }} 个字段角色，抽取 {{ learnResult.dimensionCount ?? 0 }} 个公共维度。</p>
          <p v-if="learnResult.llmReviewed" class="learn-note">模型复核了 {{ learnResult.llmChanged ?? 0 }} 个字段角色或业务名。</p>
          <p v-else-if="learnResult.llmSkipReason" class="learn-note">规则结果已保存；模型复核跳过（{{ learnResult.llmSkipReason }}）。</p>
          <div v-if="learnResult.roleCounts" class="learn-roles">
            <span v-for="(n, r) in learnResult.roleCounts" :key="r" class="role-chip">
              {{ roleLabel2(r) }} <b>{{ n }}</b>
            </span>
          </div>
          <p class="learn-note">公共维度可在「维度管理」里确认或手工补充后，才会用于问数。</p>
        </template>
        <div class="learn-ft">
          <button type="button" class="btn ghost" @click="learnResult = null">留在本页</button>
          <button v-if="!learnResult.cancelled" type="button" class="btn primary" @click="goDimensions">去维度管理确认 →</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  --primary: var(--od-brand, #4f46e5);
  --ink: var(--od-ink, #111827);
  --muted: var(--od-muted, #4b5563);
  --line: var(--od-line, #dfe3ea);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--od-bg, #f6f7fb);
  color: var(--ink);
  min-height: 0;
}
.banner-err {
  margin: 0;
  padding: 0.45rem 1rem;
  background: #fff2f0;
  color: #b42318;
  font-size: 0.82rem;
  border-bottom: 1px solid #ffccc7;
}
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.rail {
  background: #fff;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rail-top {
  padding: 0.85rem 0.85rem 0.55rem;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.rail-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.rail-title h1 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}
.rail-title span {
  font-size: 0.75rem;
  color: var(--muted);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #d0d5dd;
  background: #fff;
  border-radius: 6px;
  font-size: 12.5px;
  line-height: 1;
  cursor: pointer;
  color: var(--ink);
  white-space: nowrap;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}
.btn.sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.btn.block {
  width: 100%;
  height: 32px;
}
.search {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 0.6rem;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 0.82rem;
}
.pool-search {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  height: 30px;
  margin-bottom: 0.45rem;
  padding: 0 0.55rem;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  background: var(--od-bg, #f6f7fb);
  color: #8a96a3;
  box-sizing: border-box;
  cursor: text;
}
.pool-search:focus-within {
  border-color: var(--primary);
  background: #fff;
  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.12);
  color: var(--primary);
}
.pool-search.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pool-search-ico {
  flex-shrink: 0;
}
.pool-search-inp {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 0.78rem;
  color: #1f2a37;
  padding: 0;
}
.pool-search-inp::placeholder {
  color: #9aa5b1;
}
.pool-search-inp::-webkit-search-cancel-button {
  display: none;
}
.pool-search-inp:disabled {
  cursor: not-allowed;
}
.pool-search-clear {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: #d8dee6;
  color: #5c6b7a;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pool-search-clear:hover {
  background: #c5ced8;
  color: #1f2a37;
}
.pool-search-clear:disabled {
  cursor: not-allowed;
}
.rail-list {
  flex: 1;
  overflow: auto;
  padding: 0.4rem;
}
.ds {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0.5rem 0.55rem;
  border-radius: 8px;
  cursor: pointer;
}
.ds:hover {
  background: var(--od-bg, #f6f7fb);
}
.ds.on {
  background: var(--od-brand-soft, #eef2ff);
}
.ds-name {
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ds-sub {
  font-size: 0.7rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.empty-main {
  align-items: center;
  justify-content: center;
}
.head {
  background: #fff;
  border-bottom: 1px solid var(--line);
  padding: 0.7rem 1.1rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  flex-shrink: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
}
.pill {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: #f6ffed;
  color: #389e0d;
}
.meta-line {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}
.meta-line code {
  font-size: 0.76rem;
  background: #f3f4f6;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  color: #4e5969;
}
.sep {
  opacity: 0.5;
}
.head-acts {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
}
.work {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.75rem 1.1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.tabs {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 2px;
  background: #eef0f3;
  border-radius: 8px;
}
.tabs button {
  border: 0;
  background: transparent;
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #5c6b7a;
  font-size: 12.5px;
  line-height: 1;
}
.tabs button.on {
  background: #fff;
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.panel.pad {
  padding: 0.9rem 1rem;
}
.panel-preview {
  overflow: auto;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.tbl-preview {
  width: max-content;
  min-width: 100%;
}
.tbl th,
.tbl td {
  padding: 0.45rem 0.85rem;
  border-bottom: 1px solid #f0f2f5;
  text-align: left;
  vertical-align: middle;
}
.tbl-preview th,
.tbl-preview td {
  white-space: nowrap;
}
.tbl th {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--muted);
  background: #fafbfc;
}
.tbl-preview th {
  position: sticky;
  top: 0;
  z-index: 1;
}
.tbl code {
  font-size: 0.8rem;
}
.tag {
  display: inline-block;
  padding: 0.08rem 0.35rem;
  border-radius: 4px;
  font-size: 0.68rem;
  background: var(--od-bg, #f6f7fb);
}
.tag.dim {
  background: #e6f4ff;
  color: #1677ff;
}
.tag.quota {
  background: #f6ffed;
  color: #389e0d;
}
.tag.calc {
  background: #fff7e6;
  color: #d46b08;
  margin-right: 0.35rem;
}
.tag.lrn {
  border: 1px solid #d9d9d9;
  background: #fafafa;
  color: #595959;
}
.tag.lrn.dim {
  background: #e6f4ff;
  border-color: #91caff;
  color: #1677ff;
}
.tag.lrn.measure {
  background: #f6ffed;
  border-color: #b7eb8f;
  color: #389e0d;
}
.tag.lrn.time {
  background: #fff0f6;
  border-color: #ffadd2;
  color: #c41d7f;
}
.tag.lrn.flag {
  background: #f9f0ff;
  border-color: #d3adf7;
  color: #722ed1;
}
.tag.lrn.id {
  background: #f5f5f5;
  border-color: #d9d9d9;
  color: #8c8c8c;
}
.tag.lrn.junk {
  background: #fff1f0;
  border-color: #ffa39e;
  color: #cf1322;
}
.learn-banner {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f0f7ff;
  border: 1px solid #b7d7f5;
  font-size: 0.72rem;
  color: #555;
}
.learn-banner b {
  color: #1677ff;
  font-weight: 600;
}
.ind-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.ind-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ind-title b {
  font-size: 0.85rem;
}
.ind-form {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: #f7f8fa;
  border: 1px solid #e8eaef;
  flex-wrap: wrap;
}
.ind-form .ipt.grow {
  flex: 1;
  min-width: 160px;
}
.ipt {
  height: 30px;
  padding: 0 8px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 0.78rem;
  background: #fff;
}
textarea.ipt {
  height: auto;
  padding: 8px;
  line-height: 1.4;
}
.ipt.sm {
  font-size: 0.75rem;
}
.ind-ops {
  display: flex;
  gap: 10px;
  white-space: nowrap;
}
.q-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: #f7f8fa;
  border: 1px solid #e8eaef;
}
.q-form-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.q-form-row .ipt.grow {
  flex: 1;
  min-width: 160px;
}
.q-sql-input {
  min-height: 88px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  resize: vertical;
}
.q-sql {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: bottom;
}
.link {
  border: none;
  background: none;
  color: #1677ff;
  cursor: pointer;
  font-size: 0.72rem;
  padding: 0;
}
.link.danger {
  color: #cf1322;
}
.tag.draft {
  background: #fffbe6;
  border-color: #ffe58f;
  color: #d48806;
}
.tag.confirmed {
  background: #f6ffed;
  border-color: #b7eb8f;
  color: #389e0d;
}
.tag.deprecated {
  background: #f5f5f5;
  border-color: #d9d9d9;
  color: #8c8c8c;
}
.expr {
  font-size: 0.72rem;
  color: #8c8c8c;
  max-width: 220px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 0.75rem;
  margin: 0.45rem 0 0;
}
.pad {
  padding: 1.2rem;
  text-align: center;
}
.center {
  text-align: center;
}
.lineage {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.6;
}
.lineage .arrow {
  margin: 0 0.35rem;
  color: var(--muted);
}
.lineage code {
  font-size: 0.82rem;
  background: #f3f4f6;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
}

/* —— studio —— */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: grid;
  place-items: center;
  z-index: 50;
  padding: 0.5rem;
}
.modal-mask.nested {
  z-index: 60;
  background: rgba(15, 23, 42, 0.45);
}
.studio {
  width: min(1360px, 98vw);
  height: min(92vh, 900px);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.18);
}
.studio-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.95rem 1.15rem 0.75rem;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.studio-head h3 {
  margin: 0;
  font-size: 1.05rem;
}
.studio-head .sub {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}
.studio-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1.15rem;
  border-top: 1px solid var(--line);
  background: #fafbfc;
  flex-shrink: 0;
}
.foot-hint {
  font-size: 0.78rem;
  color: var(--muted);
}
.studio-foot-acts {
  display: flex;
  gap: 0.45rem;
  flex-shrink: 0;
}
.studio-foot .btn {
  height: 34px;
  min-width: 84px;
  padding: 0 16px;
  font-size: 13px;
}
.dlg-err {
  margin: 0;
  padding: 0.45rem 1rem;
  background: #fff2f0;
  color: #b42318;
  font-size: 0.8rem;
  border-bottom: 1px solid #ffccc7;
}
.studio-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem 0.65rem;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  font-size: 0.72rem;
  color: #5c6b7a;
}
.field.grow {
  flex: 1;
}
.field input,
.field select {
  height: 32px;
  padding: 0 0.55rem;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 0.84rem;
  color: var(--ink);
  background: #fff;
}
.studio-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(240px, 0.9fr) minmax(260px, 1fr) minmax(260px, 1fr);
  gap: 0;
}
.col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
}
.col:last-child {
  border-right: 0;
}
.col-hd {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  height: 40px;
  padding: 0 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  border-bottom: 1px solid #eff0f1;
  background: #fafbfc;
  flex-shrink: 0;
}
.col-hd .hint {
  font-weight: 500;
  color: var(--muted);
  font-size: 0.72rem;
}
.col-hd-acts {
  margin-left: auto;
  display: flex;
  gap: 0.45rem;
}
.col-hd .calc-btn,
.col-hd .linkish.calc-btn {
  margin-left: auto;
}
.linkish {
  border: 0;
  background: transparent;
  color: var(--primary);
  font-size: 0.72rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.linkish:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.col-bd {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
}
.zones-col {
  display: none;
}
.drop-zone {
  min-height: 0;
  display: flex;
  flex-direction: column;
  transition: background 0.12s ease;
}
.drop-zone.over {
  background: #f0f5ff;
}
.zone-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.4rem 0.55rem 0.55rem;
}
.empty-zone {
  padding: 1.4rem 0.75rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--muted);
}
.empty-zone.sm {
  padding: 1rem 0.5rem;
  font-size: 0.76rem;
}
.field-pool {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  flex: 1;
}
.pool-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 0.35rem;
  row-gap: 0.05rem;
  align-items: center;
  width: 100%;
  border: 1px solid #e8eaed;
  background: #fff;
  border-radius: 7px;
  padding: 0.35rem 0.45rem;
  font-size: 0.78rem;
  cursor: grab;
  color: var(--ink);
  text-align: left;
}
.pool-row:active {
  cursor: grabbing;
}
.pool-row .ftype {
  grid-row: 1 / span 2;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  font-style: normal;
  font-size: 0.62rem;
  font-weight: 700;
  background: #f3f4f6;
  color: #5c6b7a;
}
.pool-row.dim .ftype {
  background: #e6f4ff;
  color: #1677ff;
}
.pool-row.quota .ftype {
  background: #f6ffed;
  color: #389e0d;
}
.pool-row .chip-label {
  grid-column: 2;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: none;
}
.pool-row .chip-name {
  grid-column: 2;
  font-size: 0.65rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: none;
  opacity: 1;
}
.pool-row .pool-type {
  grid-column: 3;
  grid-row: 1 / span 2;
  font-size: 0.62rem;
  color: #a0a7b2;
}
.pool-row.used {
  opacity: 0.45;
}
.drag-chip {
  display: none;
}
.ftype {
  font-style: normal;
  font-size: 0.62rem;
  font-weight: 700;
}
.chip-label {
  font-weight: 600;
}
.chip-name {
  font-size: 0.65rem;
}
.pool-acts {
  display: none;
}
.sel-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.4rem;
  border: 1px solid #e8eaed;
  border-radius: 7px;
  margin-bottom: 0.35rem;
  background: #fff;
  cursor: grab;
}
.sel-row.dim {
  border-color: #c9defe;
  background: #f7fbff;
}
.sel-row.quota {
  border-color: #b7e4cc;
  background: #f3faf6;
}
.grip {
  color: #c0c4cc;
  font-size: 0.65rem;
  letter-spacing: -1px;
  user-select: none;
}
.sel-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
}
.sel-main code {
  font-size: 0.65rem;
  color: var(--muted);
}
.label-inp {
  height: 24px;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0 0.3rem;
  font-size: 0.8rem;
  font-weight: 600;
  background: transparent;
  color: var(--ink);
  width: 100%;
  box-sizing: border-box;
}
.label-inp:hover,
.label-inp:focus {
  border-color: #d8dee6;
  background: #fff;
  outline: none;
}
.role-seg {
  display: inline-flex;
  background: #eef0f3;
  border-radius: 5px;
  padding: 2px;
  flex-shrink: 0;
}
.role-seg button {
  border: 0;
  background: transparent;
  height: 22px;
  min-width: 36px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 0.68rem;
  cursor: pointer;
  color: #8c8c8c;
}
.role-seg button.on.dim {
  background: #fff;
  color: #1677ff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.role-seg button.on.quota {
  background: #fff;
  color: #047857;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.role-seg button:disabled {
  cursor: default;
}
.rm {
  border: 0;
  background: transparent;
  color: #c0c4cc;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.2rem;
  flex-shrink: 0;
}
.rm:hover {
  color: #b42318;
}

.calc-dlg {
  width: min(420px, 92vw);
  background: #fff;
  border-radius: 10px;
  padding: 0.9rem 1rem 1rem;
}
.dlg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.55rem;
}
.dlg-head h3 {
  margin: 0;
  font-size: 0.95rem;
}
.icon-x {
  border: 0;
  background: transparent;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
  padding: 0.15rem 0.35rem;
}
.calc-tip {
  margin: 0 0 0.65rem;
  font-size: 0.75rem;
  color: var(--muted);
  line-height: 1.45;
}
.calc-tip code {
  font-size: 0.72rem;
  background: #f3f4f6;
  padding: 0.05rem 0.25rem;
  border-radius: 3px;
}
.calc-row {
  display: flex;
  gap: 0.55rem;
  margin-bottom: 0.55rem;
}
.calc-dlg .field {
  margin-bottom: 0.5rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.35rem;
}

.catalog {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.catalog-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 20px;
  background: #fff;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.title-block h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.title-block span {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
}
.spacer {
  flex: 1;
  min-width: 8px;
}
.search.bar-search {
  width: min(280px, 40vw);
}
.table-wrap {
  overflow: auto;
  padding: 12px 16px 24px;
}
.catalog-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 13px;
}
.catalog-table th {
  text-align: left;
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 650;
  color: var(--muted);
  background: #fafbfc;
  border-bottom: 1px solid var(--line);
}
.catalog-table td {
  padding: 12px 14px;
  border-bottom: 1px solid #f0f2f5;
  vertical-align: middle;
}
.catalog-table tbody tr {
  cursor: pointer;
}
.catalog-table tbody tr:hover {
  background: #f7f9ff;
}
.catalog-table tbody tr:last-child td {
  border-bottom: 0;
}
.catalog-table td.acts {
  text-align: right;
}
.catalog-table td.muted {
  color: var(--muted);
  font-size: 12px;
}
.catalog-table .empty-cell {
  text-align: center;
  color: var(--muted);
  padding: 48px 16px;
  cursor: default;
}
.catalog-table .empty-cell .btn {
  display: inline-flex;
  margin-left: 8px;
  vertical-align: middle;
}
.btn.ghost.back {
  padding: 0 8px;
  color: var(--muted);
}
.switcher {
  height: 32px;
  max-width: min(360px, 50vw);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  background: #fff;
}

@media (max-width: 900px) {
  .studio-meta {
    grid-template-columns: 1fr 1fr;
  }
  .studio-body {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .pool-col,
  .drop-zone {
    min-height: 220px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}
.learn-dlg {
  width: min(440px, 92vw);
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
}
.learn-ico {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--brand-soft, #eef2ff);
  display: grid;
  place-items: center;
  font-size: 22px;
  margin-bottom: 14px;
}
.learn-ico.ok {
  background: #f0fdf4;
}
.learn-dlg h3 {
  margin: 0 0 8px;
  font-size: 17px;
}
.learn-lead {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted, #4b5563);
  line-height: 1.55;
}
.learn-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}
.learn-steps .step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 12.5px;
  color: var(--faint, #6b7280);
  line-height: 1.45;
}
.learn-steps .step.on {
  color: var(--ink, #111827);
  font-weight: 550;
}
.learn-steps .step.on i {
  animation: learn-pulse 1.2s ease-in-out infinite;
}
@keyframes learn-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.45); }
  50% { box-shadow: 0 0 0 6px rgba(79, 70, 229, 0); }
}
.learn-steps .step.done {
  color: #047857;
}
.learn-steps .step.on i {
  background: var(--brand, #4f46e5);
  color: #fff;
}
.learn-steps .step.done i {
  background: #ecfdf3;
  color: #047857;
}
.learn-steps .step i {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--brand-soft, #eef2ff);
  color: var(--brand, #4f46e5);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.learn-steps .step b {
  font-weight: 650;
}
.learn-note {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--faint, #6b7280);
  line-height: 1.5;
  background: #f9fafb;
  border-radius: 8px;
  padding: 8px 10px;
}
.learn-roles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.role-chip {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f5f7fa;
  border: 1px solid var(--line, #dfe3ea);
  color: var(--muted, #4b5563);
}
.role-chip b {
  color: var(--ink, #111827);
}
.learn-ft {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  datasetApi,
  glossaryApi,
  indicatorApi,
  questionApi,
  type DatasetFieldVO,
  type DatasetQuestionVO,
  type GlossaryItemVO,
  type IndicatorVO
} from '../../datasource/api'

type InboxKind = 'dimension' | 'metric' | 'term'

type InboxItem = {
  key: string
  kind: InboxKind
  id: number
  title: string
  datasetId?: string
  field?: string
  status: string
  values?: unknown[]
  aliases?: string[]
  agg?: string
  unit?: string
  confidence?: number
  source?: string
}

const router = useRouter()
const glossary = ref<GlossaryItemVO[]>([])
const indicators = ref<IndicatorVO[]>([])
const datasets = ref<Array<{ id: string; name: string; tableName?: string }>>([])
const datasetFilter = ref('')
const dsSearch = ref('')
const tab = ref<'inbox' | 'metrics' | 'terms' | 'gold' | 'memory'>('inbox')
const questions = ref<DatasetQuestionVO[]>([])
const qLoading = ref(false)
const kindFilter = ref<'' | InboxKind>('')
const search = ref('')
const loading = ref(false)
const error = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
const selectedKey = ref('')
const renaming = ref<string | null>(null)
const renameText = ref('')
const busy = ref<string | null>(null)
const discardKey = ref<string | null>(null)
const didPick = ref(false)
const showCreate = ref(false)
const creating = ref(false)
const createFields = ref<DatasetFieldVO[]>([])
const createForm = ref({ term: '', field: '', values: '' })
const VALUE_PAGE = 20
const profiles = ref<Record<string, Array<{ name: string; distinctCount?: number; distinctValues?: unknown[] }>>>({})
const valueQuery = ref('')
const valuePage = ref(1)
const newValue = ref('')
const valueBusy = ref(false)

function flash(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 2200)
}

function normalizeValues(v: unknown[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of v || []) {
    const s = String(x ?? '').trim()
    if (!s || s.length > 200) continue
    if (s.length > 40 && /^\s*[{\[]/.test(s)) continue
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

const datasetName = (id?: string) => datasets.value.find((d) => d.id === id)?.name || id || '—'
const datasetTable = (id?: string) => datasets.value.find((d) => d.id === id)?.tableName || ''
const inDataset = (id?: string) => !datasetFilter.value || id === datasetFilter.value
const currentTitle = computed(() => (datasetFilter.value ? datasetName(datasetFilter.value) : '全部数据集'))
const currentTable = computed(() => (datasetFilter.value ? datasetTable(datasetFilter.value) : ''))
const kindNoun = computed(() =>
  kindFilter.value === 'dimension'
    ? '公共维度'
    : kindFilter.value === 'metric'
      ? '指标'
      : kindFilter.value === 'term'
        ? '同义词'
        : '条目'
)

const confirmedMetrics = computed(() => scopedConfirmed.value.filter((x) => x.kind === 'metric'))
const confirmedDims = computed(() => scopedConfirmed.value.filter((x) => x.kind === 'dimension'))
const confirmedTerms = computed(() => scopedConfirmed.value.filter((x) => x.kind === 'term'))
const allMetrics = computed(() =>
  indicators.value.filter((i) => inDataset(i.datasetId)).map(toMetricItem)
)
const inboxCards = computed(() => {
  const kw = search.value.trim().toLowerCase()
  const list = scopedPending.value
  return kw ? list.filter((x) => matchKw(x, kw)) : list
})
const termCards = computed(() => {
  const kw = search.value.trim().toLowerCase()
  const list = [...confirmedDims.value, ...confirmedTerms.value]
  return kw ? list.filter((x) => matchKw(x, kw)) : list
})
const activeQuestions = computed(() => questions.value.filter((q) => q.status === 'active'))
const injectLines = computed(() => {
  const lines: string[] = []
  for (const m of confirmedMetrics.value) {
    const agg = (m.agg || 'SUM').toUpperCase()
    lines.push(`指标  ${m.title} → ${m.field || '—'}（${agg}${m.unit ? '，' + m.unit : ''}）`)
  }
  for (const t of confirmedTerms.value) {
    const extra = (t.aliases || []).filter((a) => a && a !== t.title).slice(0, 4)
    lines.push(`词表  ${[t.title, ...extra].join(' / ')} → ${t.field || '—'}`)
  }
  for (const d of confirmedDims.value) {
    const vals = valuesOf(d).slice(0, 8)
    lines.push(`维度  ${d.title} = ${vals.length ? vals.join(' / ') : '（无枚举）'}`)
  }
  for (const q of activeQuestions.value.slice(0, 3)) {
    lines.push(`问法  ${q.question}`)
  }
  return lines
})

const pendingByDataset = computed(() => {
  const map = new Map<string, number>()
  for (const g of glossary.value) {
    if (g.status === 'candidate' && g.datasetId) map.set(g.datasetId, (map.get(g.datasetId) || 0) + 1)
  }
  for (const i of indicators.value) {
    if (i.status === 'draft') map.set(i.datasetId, (map.get(i.datasetId) || 0) + 1)
  }
  return map
})

const pendingTotal = computed(() => {
  let n = 0
  for (const v of pendingByDataset.value.values()) n += v
  return n
})

const datasetsShown = computed(() => {
  const q = dsSearch.value.trim().toLowerCase()
  const list = datasets.value.filter((d) => {
    if (!q) return true
    return d.name.toLowerCase().includes(q) || (d.tableName || '').toLowerCase().includes(q)
  })
  return [...list].sort((a, b) => (pendingByDataset.value.get(b.id) || 0) - (pendingByDataset.value.get(a.id) || 0))
})

function toInboxItem(g: GlossaryItemVO): InboxItem {
  return {
    key: `g-${g.id}`,
    kind: g.type === 'dimension' ? 'dimension' : 'term',
    id: g.id,
    title: g.term,
    datasetId: g.datasetId,
    field: g.canonicalField,
    status: g.status,
    values: g.values,
    aliases: g.aliases,
    confidence: g.confidence,
    source: g.source || 'learned'
  }
}
function toMetricItem(i: IndicatorVO): InboxItem {
  return {
    key: `i-${i.id}`,
    kind: 'metric',
    id: i.id,
    title: i.name,
    datasetId: i.datasetId,
    field: i.fieldName,
    status: i.status,
    agg: i.agg,
    unit: i.unit,
    confidence: i.confidence,
    source: i.source || 'learned'
  }
}

const scopedPending = computed(() => {
  const items: InboxItem[] = []
  for (const g of glossary.value) {
    if (g.status === 'candidate' && inDataset(g.datasetId)) items.push(toInboxItem(g))
  }
  for (const i of indicators.value) {
    if (i.status === 'draft' && inDataset(i.datasetId)) items.push(toMetricItem(i))
  }
  return items
})

const scopedConfirmed = computed(() => {
  const items: InboxItem[] = []
  for (const g of glossary.value) {
    if (g.status === 'confirmed' && inDataset(g.datasetId)) items.push(toInboxItem(g))
  }
  for (const i of indicators.value) {
    if (i.status === 'confirmed' && inDataset(i.datasetId)) items.push(toMetricItem(i))
  }
  return items
})

function matchKw(it: InboxItem, kw: string) {
  const vals = (it.values || []).map((v) => String(v).toLowerCase()).join(' ')
  return (
    it.title.toLowerCase().includes(kw) ||
    (it.field || '').toLowerCase().includes(kw) ||
    datasetName(it.datasetId).toLowerCase().includes(kw) ||
    vals.includes(kw)
  )
}

function filterList(items: InboxItem[]) {
  let list = items
  if (kindFilter.value) list = list.filter((x) => x.kind === kindFilter.value)
  const kw = search.value.trim().toLowerCase()
  if (kw) list = list.filter((x) => matchKw(x, kw))
  return list
}

const inbox = computed(() => inboxCards.value)
const showing = computed(() => {
  if (tab.value === 'inbox') return inboxCards.value
  if (tab.value === 'terms') return termCards.value
  if (tab.value === 'metrics') return allMetrics.value
  return []
})
const selected = computed(() => showing.value.find((x) => x.key === selectedKey.value) || showing.value[0] || null)

watch(showing, (list) => {
  if (!list.some((x) => x.key === selectedKey.value)) selectedKey.value = list[0]?.key || ''
})
watch(selectedKey, () => {
  valueQuery.value = ''
  valuePage.value = 1
  newValue.value = ''
})

const kindCounts = computed(() => {
  const src = tab.value === 'inbox' ? scopedPending.value : scopedConfirmed.value
  const n = { dimension: 0, metric: 0, term: 0 }
  for (const it of src) n[it.kind]++
  return n
})

async function ensureProfile(datasetId?: string) {
  if (!datasetId || profiles.value[datasetId]) return
  try {
    const p = await datasetApi.profile(datasetId)
    profiles.value = { ...profiles.value, [datasetId]: p.fields || [] }
  } catch {
    profiles.value = { ...profiles.value, [datasetId]: [] }
  }
}

watch(
  () => datasetFilter.value || selected.value?.datasetId,
  (id) => {
    if (id) void ensureProfile(id)
  }
)

function profileField(it: InboxItem | null) {
  if (!it?.datasetId || !it.field) return undefined
  return profiles.value[it.datasetId]?.find((f) => f.name === it.field)
}

function valuesOf(it: InboxItem | null): string[] {
  if (!it) return []
  const stored = normalizeValues(it.values)
  if (stored.length) return stored
  return normalizeValues(profileField(it)?.distinctValues)
}

function distinctCountOf(it: InboxItem | null) {
  return profileField(it)?.distinctCount
}

function isHighCard(it: InboxItem | null) {
  const dc = distinctCountOf(it)
  const n = valuesOf(it).length
  return dc != null && dc > 20 && n <= 2
}

function valueSummary(it: InboxItem) {
  if (it.kind !== 'dimension') return '—'
  const n = valuesOf(it).length
  const dc = distinctCountOf(it)
  if (isHighCard(it) && dc) return `${dc}+`
  if (n) return String(n)
  if (dc) return String(dc)
  return '—'
}

const filteredValues = computed(() => {
  const all = valuesOf(selected.value)
  const q = valueQuery.value.trim().toLowerCase()
  return q ? all.filter((v) => v.toLowerCase().includes(q)) : all
})

const valuePageCount = computed(() => Math.max(1, Math.ceil(filteredValues.value.length / VALUE_PAGE)))
const pagedValues = computed(() => {
  const page = Math.min(valuePage.value, valuePageCount.value)
  const start = (page - 1) * VALUE_PAGE
  return filteredValues.value.slice(start, start + VALUE_PAGE)
})

watch(filteredValues, () => {
  if (valuePage.value > valuePageCount.value) valuePage.value = 1
})

const selectedInject = computed(() => {
  const it = selected.value
  if (!it) return ''
  if (it.status === 'candidate' || it.status === 'draft') {
    return `自学习候选。确认后，问「${it.title}」会对到字段 ${it.field || '—'}；下面的值会给问数当枚举参考。`
  }
  if (it.kind === 'metric') {
    return `问数会把「${it.title}」对到 ${it.field || '—'}（${it.agg || 'SUM'}${it.unit ? '，' + it.unit : ''}）。`
  }
  if (it.kind === 'dimension') {
    if (isHighCard(it)) {
      return `问「按${it.title}看」用字段 ${it.field || '—'}。去重后约 ${distinctCountOf(it)} 个值，不会全部塞进问数；可搜索后把常用值加进来。`
    }
    return `问「按${it.title}看 / ${it.title}是某某」时，用字段 ${it.field || '—'}，并参考下面这些值。`
  }
  return `问数会把「${it.title}」当成 ${it.field || '—'} 的同义词。`
})

function sourceLabel(it: InboxItem) {
  if (it.source === 'manual') return '手工'
  if (it.status === 'candidate' || it.status === 'draft') return '候选'
  return '自学习'
}

function pickDefaultDataset() {
  if (didPick.value) return
  const ranked = [...pendingByDataset.value.entries()].sort((a, b) => b[1] - a[1])
  if (ranked[0]?.[1]) {
    datasetFilter.value = ranked[0][0]
    tab.value = 'inbox'
  } else {
    datasetFilter.value = ''
    tab.value = 'metrics'
  }
  didPick.value = true
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const ds = await datasetApi.list()
    datasets.value = ds
    const [g, inds] = await Promise.all([
      glossaryApi.list(),
      Promise.all(ds.map((d) => indicatorApi.byDataset(d.id).catch(() => [] as IndicatorVO[])))
    ])
    glossary.value = g
    indicators.value = inds.flat()
    pickDefaultDataset()
    if (datasetFilter.value) {
      void ensureProfile(datasetFilter.value)
      void loadQuestions()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function kindLabel(k: InboxKind) {
  return k === 'dimension' ? '维度' : k === 'metric' ? '指标' : '词表'
}

async function confirmItem(it: InboxItem) {
  busy.value = it.key
  try {
    if (it.kind === 'metric') await indicatorApi.confirm(it.id)
    else await glossaryApi.confirm(it.id)
    flash(`「${it.title}」已确认`)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = null
  }
}

async function confirmAll() {
  const items = inboxCards.value.slice()
  if (!items.length) return
  busy.value = 'all'
  try {
    await Promise.all(
      items.map((it) => (it.kind === 'metric' ? indicatorApi.confirm(it.id) : glossaryApi.confirm(it.id)))
    )
    flash(`已确认 ${items.length} 条`)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = null
  }
}

function startRename(it: InboxItem) {
  renaming.value = it.key
  renameText.value = it.title
}

async function saveRename(it: InboxItem) {
  const name = renameText.value.trim()
  if (!name || it.kind === 'metric') {
    renaming.value = null
    return
  }
  busy.value = it.key
  try {
    await glossaryApi.rename(it.id, name)
    flash('已改名')
    renaming.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = null
  }
}

async function discardItem(it: InboxItem) {
  if (discardKey.value !== it.key) {
    discardKey.value = it.key
    return
  }
  busy.value = it.key
  try {
    if (it.kind === 'metric') await indicatorApi.remove(it.id)
    else await glossaryApi.remove(it.id)
    flash('已去掉')
    discardKey.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = null
  }
}

function goDataset(id?: string) {
  if (id) void router.push(`/datasets/${id}`)
  else void router.push('/datasets')
}

async function loadQuestions() {
  if (!datasetFilter.value) {
    questions.value = []
    return
  }
  qLoading.value = true
  try {
    questions.value = await questionApi.byDataset(datasetFilter.value)
  } catch {
    questions.value = []
  } finally {
    qLoading.value = false
  }
}

function tryAsk(q: DatasetQuestionVO) {
  const params = new URLSearchParams({ q: q.question, autorun: '1' })
  if (datasetFilter.value) params.set('datasetId', datasetFilter.value)
  void router.push(`/conversations?${params.toString()}`)
}

watch(datasetFilter, () => {
  void loadQuestions()
  if (tab.value === 'gold' && !datasetFilter.value) tab.value = 'metrics'
})

async function persistValues(it: InboxItem, next: string[]) {
  valueBusy.value = true
  try {
    await glossaryApi.updateValues(it.id, next)
    glossary.value = glossary.value.map((g) => (g.id === it.id ? { ...g, values: next } : g))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    valueBusy.value = false
  }
}

async function addValue() {
  const it = selected.value
  if (!it || it.kind === 'metric') return
  const v = newValue.value.trim()
  if (!v) return
  const cur = valuesOf(it)
  if (cur.includes(v)) {
    flash('这个值已经在列表里')
    return
  }
  newValue.value = ''
  await persistValues(it, [...cur, v])
  flash('已加入枚举值')
}

async function removeValue(v: string) {
  const it = selected.value
  if (!it || it.kind === 'metric') return
  await persistValues(
    it,
    valuesOf(it).filter((x) => x !== v)
  )
}

async function adoptProfileValues() {
  const it = selected.value
  if (!it) return
  const fromProfile = normalizeValues(profileField(it)?.distinctValues)
  if (!fromProfile.length) return
  await persistValues(it, fromProfile)
  flash(`已写入 ${fromProfile.length} 个值`)
}

async function openCreate() {
  if (!datasetFilter.value) {
    flash('请先在左侧选一张表，再手工新建公共维度')
    return
  }
  createForm.value = { term: '', field: '', values: '' }
  showCreate.value = true
  try {
    const d = await datasetApi.get(datasetFilter.value)
    const fields = d.fields || []
    const dims = fields.filter((f) => f.group === 'dim')
    createFields.value = dims.length ? dims : fields
    if (!createForm.value.field && createFields.value[0]) {
      createForm.value.field = createFields.value[0].name
      if (!createForm.value.term) createForm.value.term = createFields.value[0].label || createFields.value[0].name
    }
  } catch {
    createFields.value = []
  }
}

async function saveCreate() {
  const datasetId = datasetFilter.value
  const term = createForm.value.term.trim()
  const field = createForm.value.field.trim()
  if (!datasetId || !term || !field) {
    error.value = '请填写名称和字段'
    return
  }
  creating.value = true
  error.value = ''
  try {
    const values = createForm.value.values
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    await glossaryApi.create({
      term,
      type: 'dimension',
      datasetId,
      canonicalField: field,
      aliases: [],
      values,
      status: 'confirmed',
      confidence: 1,
      source: 'manual'
    })
    showCreate.value = false
    tab.value = 'terms'
    flash('已添加公共维度，问数会立刻使用')
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

function chipsOf(it: InboxItem): string[] {
  if (it.kind === 'dimension') return valuesOf(it).slice(0, 8)
  return (it.aliases || []).filter(Boolean).slice(0, 8)
}

function kindMeta(it: InboxItem) {
  const ds = datasetName(it.datasetId)
  const field = it.field || '—'
  if (it.kind === 'metric') {
    return `指标 · ${ds} · ${field}${it.agg ? ' · ' + it.agg.toUpperCase() : ''}${it.unit ? ' · ' + it.unit : ''}`
  }
  if (it.kind === 'dimension') return `公共维度 · ${ds} · ${field} · 基数 ${valueSummary(it)}`
  return `词表 · ${ds} · ${field}`
}

function dsCaption(d: { id: string; tableName?: string }) {
  const n = pendingByDataset.value.get(d.id) || 0
  const table = d.tableName || '—'
  return n ? `${table} · ${n} 条待确认` : `${table} · 已确认`
}

onMounted(load)
onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div class="kb-page">
    <p v-if="error" class="banner err">{{ error }}</p>
    <p v-if="toast" class="banner ok">{{ toast }}</p>
    <div class="kb">
      <aside class="panel rail">
        <div class="side-h">按数据集</div>
        <input v-model="dsSearch" class="search" placeholder="搜索数据集…" />
        <button type="button" class="ds" :class="{ on: !datasetFilter }" @click="datasetFilter = ''">
          <div>
            <b>全部数据集</b>
            <span>{{ pendingTotal ? `${pendingTotal} 条待确认` : `${scopedConfirmed.length} 条已确认` }}</span>
          </div>
          <span v-if="pendingTotal" class="pill-count">{{ pendingTotal }}</span>
        </button>
        <button
          v-for="d in datasetsShown"
          :key="d.id"
          type="button"
          class="ds"
          :class="{ on: datasetFilter === d.id }"
          @click="datasetFilter = d.id"
        >
          <div>
            <b>{{ d.name }}</b>
            <span>{{ dsCaption(d) }}</span>
          </div>
          <span v-if="pendingByDataset.get(d.id)" class="pill-count">{{ pendingByDataset.get(d.id) }}</span>
        </button>
        <p v-if="!datasetsShown.length" class="empty">没有匹配的数据集</p>
      </aside>

      <section class="panel main">
        <div class="hero">
          <h1>知识库</h1>
          <p>管理当前工作区的指标、术语、SQL 示例和个人记忆。自学习只给候选，人工确认后才进入对话分析。</p>
          <div class="scopebar">
            <span class="scope">当前范围 <b>{{ currentTitle }}</b></span>
            <span v-if="currentTable" class="scope">物理表 <b>{{ currentTable }}</b></span>
            <span class="scope">注入边界 <b>已确认才注入</b></span>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><em>待确认</em><b>{{ scopedPending.length }}</b></div>
          <div class="stat"><em>已确认指标</em><b>{{ confirmedMetrics.length }}</b></div>
          <div class="stat"><em>公共维度</em><b>{{ confirmedDims.length }}</b></div>
          <div class="stat"><em>金标准问法</em><b>{{ datasetFilter ? activeQuestions.length : '—' }}</b></div>
        </div>
        <div class="tabs">
          <button type="button" class="tab" :class="{ on: tab === 'inbox' }" @click="tab = 'inbox'">待确认</button>
          <button type="button" class="tab" :class="{ on: tab === 'metrics' }" @click="tab = 'metrics'">指标口径</button>
          <button type="button" class="tab" :class="{ on: tab === 'terms' }" @click="tab = 'terms'">词表与维度</button>
          <button type="button" class="tab" :class="{ on: tab === 'gold' }" @click="tab = 'gold'">金标准问法</button>
          <button type="button" class="tab" :class="{ on: tab === 'memory' }" @click="tab = 'memory'">我的记忆</button>
        </div>

        <div v-if="tab === 'inbox'" class="pane">
          <div class="pane-tools">
            <input v-model="search" class="search" placeholder="搜索候选名称 / 字段 / 值…" />
            <button
              v-if="inboxCards.length"
              type="button"
              class="btn primary"
              :disabled="busy === 'all'"
              @click="confirmAll"
            >
              {{ busy === 'all' ? '确认中…' : `全部确认 ${inboxCards.length}` }}
            </button>
            <button type="button" class="btn" @click="goDataset(datasetFilter || undefined)">去数据集学习</button>
          </div>
          <p v-if="loading" class="empty">加载中…</p>
          <div v-else-if="!inboxCards.length" class="empty">
            <p>{{ datasetFilter ? '这张表没有待确认的自学习结果' : '当前没有待确认候选' }}</p>
            <p>学习没抽到，或已经确认完。可去数据集重新学习，或手工补一条公共维度。</p>
            <button type="button" class="btn primary" :disabled="!datasetFilter" @click="openCreate">新建公共维度</button>
          </div>
          <article
            v-for="it in inboxCards"
            :key="it.key"
            class="card"
            :class="{ on: selected?.key === it.key }"
            @click="selectedKey = it.key"
          >
            <div>
              <h3>
                <template v-if="renaming === it.key">
                  <input
                    v-model="renameText"
                    class="rename"
                    @click.stop
                    @keyup.enter="saveRename(it)"
                    @keyup.esc="renaming = null"
                  />
                </template>
                <template v-else>{{ it.title }}</template>
                <span class="st wait">候选</span>
              </h3>
              <div class="meta">{{ kindMeta(it) }}{{ it.confidence != null ? ` · 置信度 ${Number(it.confidence).toFixed(2)}` : '' }}</div>
              <div v-if="chipsOf(it).length" class="chips">
                <span v-for="c in chipsOf(it)" :key="c" class="chip">{{ c }}</span>
              </div>
            </div>
            <div class="acts" @click.stop>
              <button type="button" class="btn primary" :disabled="busy === it.key || busy === 'all'" @click="confirmItem(it)">
                确认并用于问数
              </button>
              <button v-if="it.kind !== 'metric'" type="button" class="btn ghost" @click="startRename(it)">改名</button>
              <button type="button" class="btn ghost" :disabled="busy === it.key" @click="discardItem(it)">
                {{ discardKey === it.key ? '确定去掉？' : '废弃' }}
              </button>
            </div>
          </article>
        </div>

        <div v-else-if="tab === 'metrics'" class="pane">
          <div class="row head"><span>指标</span><span>字段 / 聚合</span><span>状态</span><span></span></div>
          <p v-if="!allMetrics.length" class="empty">还没有指标。先确认自学习候选，或去数据集学习。</p>
          <div v-for="it in allMetrics" :key="it.key" class="row">
            <span>{{ it.title }}</span>
            <span>{{ it.field || '—' }} · {{ (it.agg || 'SUM').toUpperCase() }}{{ it.unit ? ' · ' + it.unit : '' }}</span>
            <span class="st" :class="it.status === 'confirmed' ? 'ok' : 'wait'">
              {{ it.status === 'confirmed' ? '已确认' : '候选' }}
            </span>
            <span>
              <button
                v-if="it.status !== 'confirmed'"
                type="button"
                class="btn primary sm"
                :disabled="busy === it.key"
                @click="confirmItem(it)"
              >
                确认
              </button>
            </span>
          </div>
        </div>

        <div v-else-if="tab === 'terms'" class="pane">
          <div class="pane-tools">
            <input v-model="search" class="search" placeholder="搜索词表 / 维度…" />
            <button type="button" class="btn primary" :disabled="!datasetFilter" @click="openCreate">新建公共维度</button>
          </div>
          <p v-if="!termCards.length" class="empty">还没有已确认的词表或维度。先在「待确认」里确认，或手工新建。</p>
          <article
            v-for="it in termCards"
            :key="it.key"
            class="card"
            :class="{ on: selected?.key === it.key }"
            @click="selectedKey = it.key"
          >
            <div>
              <h3>{{ it.title }} <span class="st ok">已确认</span></h3>
              <div class="meta">{{ kindMeta(it) }}</div>
              <div v-if="chipsOf(it).length" class="chips">
                <span v-for="c in chipsOf(it)" :key="c" class="chip">{{ c }}</span>
              </div>
              <div v-if="selected?.key === it.key && it.kind === 'dimension'" class="val-edit" @click.stop>
                <p v-if="isHighCard(it)" class="hint">去重后太多，没有全部收录。搜索后把常用值加进来即可。</p>
                <div class="val-add">
                  <input v-model="newValue" class="search" placeholder="添加一个值，例如 华东" @keyup.enter="addValue" />
                  <button type="button" class="btn primary sm" :disabled="valueBusy || !newValue.trim()" @click="addValue">添加</button>
                </div>
                <ul v-if="pagedValues.length" class="val-list">
                  <li v-for="v in pagedValues" :key="v">
                    <span>{{ v }}</span>
                    <button type="button" class="btn ghost sm" :disabled="valueBusy" @click="removeValue(v)">去掉</button>
                  </li>
                </ul>
              </div>
            </div>
          </article>
        </div>

        <div v-else-if="tab === 'gold'" class="pane">
          <p class="hint">
            自然语言 + 已验证 SQL。问数时按相似度注入最多 3 条。增改请到数据集页「高频问法」。
            <button type="button" class="link" :disabled="!datasetFilter" @click="goDataset(datasetFilter)">去维护问法</button>
          </p>
          <p v-if="!datasetFilter" class="empty">请先在左侧选一张表，再预览金标准问法。</p>
          <p v-else-if="qLoading" class="empty">加载中…</p>
          <p v-else-if="!questions.length" class="empty">这张表还没有金标准问法。</p>
          <article v-for="q in questions" :key="q.id" class="card">
            <div>
              <h3>
                {{ q.question }}
                <span class="st" :class="q.status === 'active' ? 'ok' : 'wait'">
                  {{ q.status === 'active' ? '金标准' : '草稿' }}
                </span>
              </h3>
              <div class="meta">{{ q.status === 'active' ? '只读 SQL · 表白名单仍生效' : '未启用，问数时不会当 few-shot' }}</div>
              <pre class="sql">{{ q.sql }}</pre>
            </div>
            <div class="acts">
              <button v-if="q.status === 'active'" type="button" class="btn primary" @click="tryAsk(q)">在对话试问</button>
            </div>
          </article>
        </div>

        <div v-else class="pane">
          <p class="empty">
            还没有个人记忆。在对话里纠正过口径后才会出现。
            <br />可删除沉淀偏好，不能手写查询结果行。本期记忆管理尚未接产品接口。
          </p>
        </div>
      </section>

      <aside class="panel preview">
        <h2>问数时会注入</h2>
        <p class="hint">与问数 <code>&lt;knowledge&gt;</code> 同构。候选未确认前这里是空的。</p>
        <pre v-if="!injectLines.length" class="inject"><b>尚未注入</b>
点左侧「确认并用于问数」后，才会进入对话。</pre>
        <pre v-else class="inject"><b>&lt;knowledge&gt;</b>
{{ injectLines.join('\n') }}
<b>&lt;/knowledge&gt;</b></pre>
        <p class="hint">对话思考过程会显示「用到的知识」。文件列可打开本页。</p>
      </aside>
    </div>

    <div v-if="showCreate" class="mask" @click.self="showCreate = false">
      <div class="dlg" role="dialog" aria-label="新建公共维度">
        <h3>新建公共维度</h3>
        <p class="hint">手工维护会立刻启用，问数马上能用。</p>
        <label>所属数据集<input :value="datasetName(datasetFilter)" disabled /></label>
        <label>业务名称<input v-model="createForm.term" placeholder="例如：区域、支付状态" /></label>
        <label>
          对应字段
          <select v-model="createForm.field">
            <option value="" disabled>选择字段</option>
            <option v-for="f in createFields" :key="f.name" :value="f.name">
              {{ f.label || f.name }}（{{ f.name }}）
            </option>
          </select>
        </label>
        <label>枚举值（可选，逗号分隔）<input v-model="createForm.values" placeholder="华东, 华南, 华北" /></label>
        <div class="dlg-ft">
          <button type="button" class="btn ghost" @click="showCreate = false">取消</button>
          <button type="button" class="btn primary" :disabled="creating" @click="saveCreate">
            {{ creating ? '保存中…' : '保存并启用' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kb-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--od-bg, #f6f7fb);
  color: var(--od-ink, #111827);
}
.banner {
  margin: 0;
  padding: 8px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--od-line, #dfe3ea);
}
.banner.err { background: #fff1f0; color: #cf1322; }
.banner.ok { background: #f6ffed; color: #389e0d; }
.kb {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 252px minmax(760px, 1fr) clamp(340px, 18vw, 420px);
  gap: 16px;
  padding: 12px 16px 20px;
  align-items: stretch;
}
.panel {
  background: var(--od-card, #fff);
  border: 1px solid var(--od-line, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  min-width: 0;
  min-height: 0;
}
.rail {
  padding: 14px 12px;
  overflow: auto;
}
.side-h {
  font-size: 12px;
  font-weight: 700;
  color: var(--od-faint, #6b7280);
  padding: 4px 8px 10px;
}
.search {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  margin-bottom: 8px;
  padding: 0 10px;
  border: 1px solid #d8dee6;
  border-radius: 8px;
  font-size: 13px;
}
.ds {
  width: 100%;
  text-align: left;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  color: inherit;
}
.ds:hover { background: var(--od-bg, #f6f7fb); }
.ds.on { background: var(--od-brand-soft, #eef2ff); color: var(--od-brand, #4f46e5); }
.ds b { display: block; font-size: 13.5px; font-weight: 650; }
.ds span { display: block; font-size: 11.5px; color: var(--od-faint, #6b7280); margin-top: 2px; }
.ds.on span { color: #6366f1; }
.pill-count {
  margin-left: auto;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: #fff4e5;
  color: #b45309;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.ds.on .pill-count { background: #fff; }
.main { display: flex; flex-direction: column; overflow: hidden; }
.hero { padding: 20px 22px 8px; }
.hero h1 { margin: 0; font-size: 22px; font-weight: 760; letter-spacing: -.03em; }
.hero p { margin: 6px 0 0; font-size: 13.5px; color: var(--od-muted, #6b7280); line-height: 1.55; }
.scopebar { margin: 16px 0 0; display: flex; gap: 8px; flex-wrap: wrap; }
.scope {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--od-line, #e5e7eb);
  border-radius: 8px;
  background: var(--od-bg, #f6f7fb);
  color: var(--od-muted, #6b7280);
  font-size: 12px;
}
.scope b { color: var(--od-ink, #111827); font-weight: 700; }
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 0 22px 16px;
}
.stat {
  padding: 12px 14px;
  border: 1px solid var(--od-line, #e5e7eb);
  border-radius: 8px;
  background: #fafbfd;
}
.stat em { display: block; font-style: normal; font-size: 11.5px; color: var(--od-faint, #9ca3af); }
.stat b { display: block; margin-top: 4px; font-size: 20px; letter-spacing: -.03em; }
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 14px;
  border-bottom: 1px solid var(--od-line, #e5e7eb);
}
.tab {
  height: 40px;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--od-muted, #6b7280);
  font-size: 13.5px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tab:hover { color: var(--od-ink, #111827); }
.tab.on { color: var(--od-brand, #4f46e5); font-weight: 650; border-bottom-color: var(--od-brand, #4f46e5); }
.pane { flex: 1; overflow: auto; padding: 14px 16px 18px; }
.pane-tools { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.pane-tools .search { margin: 0; flex: 1; }
.card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--od-line, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 10px;
  background: #fff;
  cursor: pointer;
}
.card.on { border-color: #c7d2fe; box-shadow: 0 0 0 3px #eef2ff; }
.card h3 { margin: 0; font-size: 14px; font-weight: 680; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.meta { margin-top: 4px; font-size: 12px; color: var(--od-muted, #6b7280); line-height: 1.5; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #e8ecf2;
  background: #f5f6f8;
  font-size: 11.5px;
  color: var(--od-muted, #6b7280);
  line-height: 22px;
}
.st {
  display: inline-flex;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
}
.st.wait { background: #fff7e6; color: #d46b08; }
.st.ok { background: #ecfdf3; color: #047857; }
.acts { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--od-line, #e5e7eb);
  background: #fff;
  font-size: 12.5px;
  font-weight: 620;
  cursor: pointer;
  white-space: nowrap;
}
.btn.primary { background: var(--od-brand, #4f46e5); color: #fff; border-color: var(--od-brand, #4f46e5); }
.btn.ghost { background: transparent; color: var(--od-muted, #6b7280); border-color: transparent; }
.btn.sm { height: 26px; padding: 0 8px; font-size: 12px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.link { border: 0; background: none; color: var(--od-brand, #4f46e5); cursor: pointer; font-size: 13px; padding: 0; }
.row {
  display: grid;
  grid-template-columns: 1.2fr .9fr .7fr auto;
  gap: 8px;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 13px;
}
.row.head { font-size: 11.5px; color: var(--od-faint, #9ca3af); font-weight: 650; }
.sql {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #0f1728;
  color: #d7e2ff;
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.5;
  white-space: pre-wrap;
}
.preview { padding: 16px; overflow: auto; position: sticky; top: 16px; }
.preview h2 { margin: 0; font-size: 13px; font-weight: 700; }
.hint { margin: 6px 0 12px; font-size: 12px; color: var(--od-muted, #6b7280); line-height: 1.5; }
.inject {
  padding: 12px;
  border-radius: 8px;
  background: #0f1728;
  color: #e2e8f0;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}
.inject b { color: #93c5fd; font-weight: 650; }
.empty { padding: 28px 8px; text-align: center; color: var(--od-faint, #9ca3af); font-size: 13px; line-height: 1.6; }
.rename { height: 28px; padding: 0 8px; border: 1px solid #c7d2fe; border-radius: 6px; font-size: 13px; }
.val-edit { margin-top: 10px; }
.val-add { display: flex; gap: 8px; }
.val-list { list-style: none; margin: 8px 0 0; padding: 0; }
.val-list li { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 13px; }
.mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  z-index: 40;
}
.dlg {
  width: min(440px, 92vw);
  background: #fff;
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dlg h3 { margin: 0; }
.dlg label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #6b7280; }
.dlg input, .dlg select {
  height: 34px;
  padding: 0 10px;
  border: 1px solid #d8dee6;
  border-radius: 8px;
  font-size: 13px;
}
.dlg-ft { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
@media (max-width: 1100px) {
  .kb { grid-template-columns: 1fr; }
  .stats { grid-template-columns: 1fr 1fr; }
  .preview { position: static; }
}
</style>


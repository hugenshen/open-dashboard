<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  datasetApi,
  glossaryApi,
  indicatorApi,
  type DatasetFieldVO,
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
const tab = ref<'inbox' | 'confirmed'>('confirmed')
const kindFilter = ref<'' | InboxKind>('dimension')
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

const inbox = computed(() => filterList(scopedPending.value))
const confirmed = computed(() => filterList(scopedConfirmed.value))
const showing = computed(() => (tab.value === 'inbox' ? inbox.value : confirmed.value))
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
  if (ranked[0]?.[1]) datasetFilter.value = ranked[0][0]
  else if (datasets.value[0]) datasetFilter.value = datasets.value[0].id
  const pendingDims = glossary.value.filter(
    (g) =>
      g.status === 'candidate' &&
      g.type === 'dimension' &&
      (!datasetFilter.value || g.datasetId === datasetFilter.value)
  ).length
  tab.value = pendingDims > 0 ? 'inbox' : 'confirmed'
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
    if (datasetFilter.value) void ensureProfile(datasetFilter.value)
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
  const items = inbox.value.slice()
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
      aliases: [term],
      values,
      status: 'confirmed',
      confidence: 1,
      source: 'manual'
    })
    showCreate.value = false
    tab.value = 'confirmed'
    kindFilter.value = 'dimension'
    flash('已添加公共维度，问数会立刻使用')
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

onMounted(load)
onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div class="page">
    <p v-if="error" class="banner-err">{{ error }}</p>
    <p v-if="toast" class="banner-ok">{{ toast }}</p>
    <div class="layout">
      <aside class="rail">
        <div class="rail-top">
          <div class="rail-title">
            <h1>维度管理</h1>
            <span>{{ pendingTotal }} 待确认</span>
          </div>
          <input v-model="dsSearch" class="search" placeholder="搜索数据集…" />
        </div>
        <div class="rail-list">
          <button type="button" class="ds" :class="{ on: !datasetFilter }" @click="datasetFilter = ''">
            <span class="ds-name">全部数据集</span>
            <span class="ds-sub">{{ pendingTotal ? `${pendingTotal} 条待确认` : '没有待确认' }}</span>
            <span v-if="pendingTotal" class="pill">{{ pendingTotal }}</span>
          </button>
          <button
            v-for="d in datasetsShown"
            :key="d.id"
            type="button"
            class="ds"
            :class="{ on: datasetFilter === d.id }"
            @click="datasetFilter = d.id"
          >
            <span class="ds-name">{{ d.name }}</span>
            <span class="ds-sub">{{ d.tableName || '—' }}</span>
            <span v-if="pendingByDataset.get(d.id)" class="pill">{{ pendingByDataset.get(d.id) }}</span>
          </button>
          <p v-if="!datasetsShown.length" class="side-empty">没有匹配的数据集</p>
        </div>
      </aside>

      <section class="workspace">
        <header class="head">
          <div class="head-left">
            <div class="title-row">
              <h2>{{ currentTitle }}</h2>
              <code v-if="currentTable" class="table-pill">{{ currentTable }}</code>
            </div>
            <p class="meta-line">
              学习只出候选 · 这里确认或手工新建后才会进入问数
            </p>
          </div>
          <div class="head-acts">
            <button type="button" class="btn sm" @click="goDataset(datasetFilter || undefined)">去数据集学习</button>
            <button
              type="button"
              class="btn sm primary"
              :disabled="!datasetFilter"
              :title="datasetFilter ? '手工新建并立刻用于问数' : '请先在左侧选一张表'"
              @click="openCreate"
            >
              新建公共维度
            </button>
          </div>
        </header>

        <div class="tabs">
          <button type="button" :class="{ on: tab === 'inbox' }" @click="tab = 'inbox'">
            自学习待确认 {{ scopedPending.length }}
          </button>
          <button type="button" :class="{ on: tab === 'confirmed' }" @click="tab = 'confirmed'">
            已启用 {{ scopedConfirmed.length }}
          </button>
        </div>

        <div class="body" :class="{ 'has-detail': !!selected }">
          <div class="list-wrap">
            <div class="list-tools">
              <div class="chips">
                <button type="button" class="chip-btn" :class="{ on: kindFilter === 'dimension' }" @click="kindFilter = 'dimension'">
                  公共维度 {{ kindCounts.dimension }}
                </button>
                <button type="button" class="chip-btn" :class="{ on: kindFilter === 'metric' }" @click="kindFilter = 'metric'">
                  指标 {{ kindCounts.metric }}
                </button>
                <button type="button" class="chip-btn" :class="{ on: kindFilter === 'term' }" @click="kindFilter = 'term'">
                  同义词 {{ kindCounts.term }}
                </button>
                <button type="button" class="chip-btn" :class="{ on: !kindFilter }" @click="kindFilter = ''">全部</button>
              </div>
              <input v-model="search" class="search list-search" placeholder="搜索名称 / 字段 / 值…" />
              <button
                v-if="tab === 'inbox' && inbox.length"
                type="button"
                class="btn sm primary"
                :disabled="busy === 'all'"
                @click="confirmAll"
              >
                {{ busy === 'all' ? '确认中…' : `全部确认 ${inbox.length}` }}
              </button>
            </div>
            <div v-if="loading" class="empty">加载中…</div>
            <div v-else-if="!showing.length" class="empty">
              <template v-if="tab === 'inbox'">
                <p>{{ datasetFilter ? '这张表没有待确认的自学习结果' : '当前没有待确认候选' }}</p>
                <p class="empty-hint">
                  {{
                    datasetFilter
                      ? '学习没抽到，或已经确认完。去数据集重新学习，或手工补一条公共维度。'
                      : '从左侧选一张表查看，或先去数据集学习。'
                  }}
                </p>
              </template>
              <template v-else>
                <p>还没有已启用的{{ kindNoun }}</p>
                <p class="empty-hint">
                  {{
                    datasetFilter
                      ? '先确认自学习候选，或手工新建公共维度。'
                      : '从左侧选一张表查看已启用条目。'
                  }}
                </p>
              </template>
              <div class="empty-acts">
                <button v-if="tab === 'confirmed' && scopedPending.length" type="button" class="btn sm" @click="tab = 'inbox'">
                  去待确认 {{ scopedPending.length }}
                </button>
                <button type="button" class="btn sm" @click="goDataset(datasetFilter || undefined)">去数据集学习</button>
                <button
                  type="button"
                  class="btn sm primary"
                  :disabled="!datasetFilter"
                  :title="datasetFilter ? '' : '请先在左侧选一张表'"
                  @click="openCreate"
                >
                  新建公共维度
                </button>
              </div>
            </div>
            <div v-else class="rows">
              <div class="row head">
                <span>来源</span>
                <span>业务名</span>
                <span>字段</span>
                <span>值</span>
                <span></span>
              </div>
              <button
                v-for="it in showing"
                :key="it.key"
                type="button"
                class="row"
                :class="{ on: selected?.key === it.key }"
                @click="selectedKey = it.key"
              >
                <span class="kind" :data-k="it.source === 'manual' ? 'manual' : it.kind">{{ sourceLabel(it) }}</span>
                <span class="title">
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
                </span>
                <code class="field">{{ it.field || '—' }}</code>
                <span class="meta">{{ valueSummary(it) }}</span>
                <span class="acts" @click.stop>
                  <button
                    v-if="it.status !== 'confirmed'"
                    type="button"
                    class="btn primary sm"
                    :disabled="busy === it.key || busy === 'all'"
                    @click="confirmItem(it)"
                  >
                    确认
                  </button>
                </span>
              </button>
            </div>
          </div>

          <aside v-if="selected" class="detail">
            <div class="detail-h">
              <span class="kind" :data-k="selected.source === 'manual' ? 'manual' : selected.kind">{{ sourceLabel(selected) }}</span>
              <h3>{{ selected.title }}</h3>
            </div>
            <dl>
              <div>
                <dt>类型</dt>
                <dd>{{ kindLabel(selected.kind) }}</dd>
              </div>
              <div>
                <dt>数据集</dt>
                <dd>
                  <button type="button" class="link" @click="goDataset(selected.datasetId)">
                    {{ datasetName(selected.datasetId) }}
                  </button>
                </dd>
              </div>
              <div>
                <dt>字段</dt>
                <dd><code>{{ selected.field || '—' }}</code></dd>
              </div>
              <div v-if="selected.agg">
                <dt>聚合</dt>
                <dd>{{ selected.agg }}{{ selected.unit ? ` / ${selected.unit}` : '' }}</dd>
              </div>
              <div v-if="selected.source !== 'manual' && selected.confidence != null">
                <dt>置信度</dt>
                <dd>{{ Number(selected.confidence).toFixed(2) }}</dd>
              </div>
            </dl>
            <div class="inject">
              <em>问数时怎么用</em>
              <p>{{ selectedInject }}</p>
            </div>

            <div v-if="selected.kind === 'dimension'" class="vals">
              <div class="vals-h">
                <h4>值</h4>
                <span>
                  {{ filteredValues.length }} 个
                  <template v-if="distinctCountOf(selected) && distinctCountOf(selected)! > valuesOf(selected).length">
                    · 画像去重 {{ distinctCountOf(selected) }}
                  </template>
                </span>
              </div>
              <p v-if="isHighCard(selected)" class="vals-note">
                去重后太多，没有全部收录。搜索后把常用值加进来即可。
              </p>
              <input v-model="valueQuery" class="search" placeholder="搜索值…" />
              <ul v-if="pagedValues.length" class="val-list">
                <li v-for="v in pagedValues" :key="v">
                  <span>{{ v }}</span>
                  <button type="button" class="btn ghost danger sm" :disabled="valueBusy" @click="removeValue(v)">
                    去掉
                  </button>
                </li>
              </ul>
              <p v-else class="vals-empty">
                {{ valueQuery ? '没有匹配的值' : '还没有枚举值。可从画像写入，或下面手工添加。' }}
              </p>
              <div v-if="valuePageCount > 1" class="pager">
                <button type="button" class="btn ghost sm" :disabled="valuePage <= 1" @click="valuePage -= 1">上一页</button>
                <span>{{ valuePage }} / {{ valuePageCount }}</span>
                <button
                  type="button"
                  class="btn ghost sm"
                  :disabled="valuePage >= valuePageCount"
                  @click="valuePage += 1"
                >
                  下一页
                </button>
              </div>
              <div class="val-add">
                <input
                  v-model="newValue"
                  class="search"
                  placeholder="添加一个值，例如 CNY"
                  @keyup.enter="addValue"
                />
                <button type="button" class="btn primary sm" :disabled="valueBusy || !newValue.trim()" @click="addValue">
                  添加
                </button>
              </div>
              <button
                v-if="!valuesOf(selected).length && normalizeValues(profileField(selected)?.distinctValues).length"
                type="button"
                class="btn ghost block"
                :disabled="valueBusy"
                @click="adoptProfileValues"
              >
                从字段画像写入 {{ normalizeValues(profileField(selected)?.distinctValues).length }} 个值
              </button>
            </div>

            <div class="detail-acts">
              <button
                v-if="selected.status !== 'confirmed'"
                type="button"
                class="btn primary"
                :disabled="busy === selected.key || busy === 'all'"
                @click="confirmItem(selected)"
              >
                确认并用于问数
              </button>
              <button
                v-if="selected.kind !== 'metric' && selected.status !== 'confirmed' && renaming !== selected.key"
                type="button"
                class="btn ghost"
                @click="startRename(selected)"
              >
                改名
              </button>
              <button
                v-if="renaming === selected.key"
                type="button"
                class="btn ghost"
                @click="saveRename(selected)"
              >
                保存
              </button>
              <button
                v-if="selected.status !== 'confirmed'"
                type="button"
                class="btn ghost danger"
                :disabled="busy === selected.key"
                @click="discardItem(selected)"
              >
                {{ discardKey === selected.key ? '确定去掉？' : '不采用' }}
              </button>
            </div>
          </aside>
        </div>
      </section>
    </div>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="create-dlg" role="dialog" aria-label="新建公共维度">
        <h3>新建公共维度</h3>
        <p class="create-lead">手工维护会立刻启用，问数马上能用。适合自学习没抽到、或你已经知道业务口径的字段。</p>
        <label>
          所属数据集
          <input :value="datasetName(datasetFilter)" disabled />
        </label>
        <label>
          业务名称
          <input v-model="createForm.term" placeholder="例如：区域、支付状态" />
        </label>
        <label>
          对应字段
          <select v-model="createForm.field">
            <option value="" disabled>选择字段</option>
            <option v-for="f in createFields" :key="f.name" :value="f.name">
              {{ f.label || f.name }}（{{ f.name }}）
            </option>
          </select>
        </label>
        <label>
          枚举值（可选，逗号分隔）
          <input v-model="createForm.values" placeholder="华东, 华南, 华北" />
        </label>
        <div class="create-ft">
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
.page {
  --primary: var(--od-brand, #4f46e5);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--od-bg, #f6f7fb);
  color: var(--od-ink, #111827);
}
.banner-err, .banner-ok {
  margin: 0;
  padding: 8px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--od-line, #dfe3ea);
}
.banner-err { background: #fff1f0; color: #cf1322; }
.banner-ok { background: #f6ffed; color: #389e0d; }
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
}
.rail {
  background: #fff;
  border-right: 1px solid var(--od-line, #dfe3ea);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rail-top {
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--od-line, #dfe3ea);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rail-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.rail-title h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.rail-title span {
  font-size: 12px;
  color: var(--od-faint, #6b7280);
  white-space: nowrap;
}
.search {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 13px;
}
.rail-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
}
.ds {
  width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 28px 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: inherit;
}
.ds:hover { background: var(--od-bg, #f6f7fb); }
.ds.on { background: var(--od-brand-soft, #eef2ff); }
.ds-name {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-sub {
  font-size: 11.5px;
  color: var(--od-faint, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill {
  position: absolute;
  top: 10px;
  right: 8px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #fff4e5;
  color: #b45309;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.ds.on .pill { background: #fff; }
.side-empty {
  margin: 16px 8px;
  font-size: 12px;
  color: var(--od-faint, #6b7280);
  text-align: center;
}
.workspace {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 10px;
}
.head-left { min-width: 0; }
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -.02em;
}
.table-pill {
  font-size: 12px;
  color: var(--od-faint, #6b7280);
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 4px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-line {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--od-faint, #6b7280);
}
.head-acts { display: flex; gap: 8px; flex-shrink: 0; }
.tabs {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  margin: 0 20px 10px;
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
.list-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--od-line, #dfe3ea);
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}
.chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}
.chip-btn {
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--od-muted, #4b5563);
  font-size: 12px;
  cursor: pointer;
}
.chip-btn.on {
  background: var(--od-brand-soft, #eef2ff);
  color: var(--primary);
}
.list-search {
  width: 200px;
  margin-left: auto;
  height: 30px;
  flex-shrink: 0;
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.body.has-detail {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
}
.list-wrap {
  min-width: 0;
  overflow: auto;
}
.body.has-detail .list-wrap {
  border-right: 1px solid var(--od-line, #dfe3ea);
}
.empty {
  max-width: 420px;
  margin: 48px auto;
  padding: 0 16px;
  text-align: center;
  color: var(--od-faint, #6b7280);
  font-size: 13px;
}
.empty p { margin: 0 0 8px; color: var(--od-ink, #111827); font-weight: 600; }
.empty-hint { margin: 0 0 16px !important; line-height: 1.55; font-weight: 400 !important; color: var(--od-faint, #6b7280) !important; }
.empty-acts {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 72px minmax(0, 1.6fr) minmax(0, 1fr) 56px 64px;
  gap: 8px;
  align-items: center;
  padding: 9px 16px;
  border: 0;
  border-bottom: 1px solid #f0f2f5;
  background: #fff;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.row:hover { background: #fafbfd; }
.row.on { background: var(--od-brand-soft, #eef2ff); }
.row.head {
  cursor: default;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--od-faint, #6b7280);
  background: #fafbfd;
  padding-top: 8px;
  padding-bottom: 8px;
  position: sticky;
  top: 0;
  z-index: 1;
}
.row.head:hover { background: #fafbfd; }
.row.head span:nth-child(4) { text-align: right; }
.kind {
  display: inline-flex;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 650;
  line-height: 20px;
  background: #f3f4f6;
  color: #4b5563;
  justify-content: center;
}
.kind[data-k='dimension'] { background: #eef2ff; color: #4338ca; }
.kind[data-k='metric'] { background: #ecfdf3; color: #047857; }
.kind[data-k='term'] { background: #fff7ed; color: #c2410c; }
.kind[data-k='manual'] { background: #f3f4f6; color: #111827; }
.title {
  font-size: 13.5px;
  font-weight: 620;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field {
  font-size: 12px;
  color: var(--od-muted, #4b5563);
  background: transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 12px;
  color: var(--od-faint, #6b7280);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.acts {
  display: flex;
  justify-content: flex-end;
}
.btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #d0d5dd;
  background: #fff;
  font-size: 12.5px;
  font-weight: 620;
  cursor: pointer;
  white-space: nowrap;
  color: inherit;
}
.btn.primary { background: var(--primary); color: #fff; border-color: var(--primary); }
.btn.ghost { background: transparent; color: var(--od-muted, #4b5563); border-color: transparent; }
.btn.danger { color: #cf1322; }
.btn.sm { height: 26px; padding: 0 10px; font-size: 12px; }
.btn:disabled { opacity: .55; cursor: default; }
.rename {
  height: 26px;
  width: 100%;
  padding: 0 8px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  font-size: 13px;
}
.detail {
  min-width: 0;
  overflow: auto;
  padding: 16px;
}
.detail-h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.detail h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 680;
}
.detail dl {
  margin: 0;
  display: grid;
  gap: 8px;
}
.detail dl > div {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 8px;
  font-size: 13px;
}
.detail dt {
  margin: 0;
  color: var(--od-faint, #6b7280);
}
.detail dd { margin: 0; }
.link {
  border: 0;
  background: transparent;
  color: var(--primary);
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.vals {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--od-line, #dfe3ea);
}
.vals-h {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.vals-h h4 { margin: 0; font-size: 13px; }
.vals-h span { font-size: 12px; color: var(--od-faint, #6b7280); }
.vals-note, .vals-empty {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--od-muted, #4b5563);
  line-height: 1.5;
}
.val-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 8px;
  max-height: 280px;
  overflow: auto;
}
.val-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 13px;
}
.val-list li:last-child { border-bottom: 0; }
.val-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--od-faint, #6b7280);
}
.val-add {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  margin-top: 10px;
}
.btn.block { width: 100%; margin-top: 10px; }
.inject {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--od-bg, #f6f7fb);
}
.inject em {
  display: block;
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  color: var(--od-faint, #6b7280);
}
.inject p {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.5;
}
.detail-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.4);
  display: grid;
  place-items: center;
  z-index: 40;
}
.create-dlg {
  width: min(420px, 92vw);
  background: #fff;
  border-radius: 12px;
  padding: 20px 22px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.2);
}
.create-dlg h3 { margin: 0; font-size: 16px; }
.create-lead {
  margin: 8px 0 16px;
  font-size: 13px;
  color: var(--od-muted, #4b5563);
  line-height: 1.5;
}
.create-dlg label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12.5px;
  color: var(--od-faint, #6b7280);
}
.create-dlg input,
.create-dlg select {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  font-size: 13px;
  color: var(--od-ink, #111827);
}
.create-ft {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
  .body, .body.has-detail { grid-template-columns: 1fr; }
  .list-wrap, .body.has-detail .list-wrap { border-right: 0; }
  .list-search { width: 140px; }
  .rail { border-right: 0; border-bottom: 1px solid var(--od-line, #dfe3ea); max-height: 220px; }
  .row { grid-template-columns: 52px minmax(0, 1fr) 48px 64px; }
  .field { display: none; }
}
</style>

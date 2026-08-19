<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  datasetApi,
  datasourceApi,
  indicatorApi,
  type DatasetDetailVO,
  type DatasetFieldVO,
  type DatasetMetaVO,
  type DatasourceVO,
  type IndicatorVO,
  type TableItem
} from '../api'

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
const search = ref('')
const folderFilter = ref('全部')
const tab = ref<'fields' | 'preview' | 'indicators' | 'lineage'>('fields')
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
    if (q && !d.name.toLowerCase().includes(q)) return false
    return true
  })
})

const srcName = computed(() => {
  const id = detail.value?.meta.datasourceId
  return sources.value.find((s) => s.id === id)?.name || id || '—'
})

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
function learnedRoleOf(fieldName: string): { role: string; src: string } | null {
  const f = fieldProfile.value?.fields.find((x) => x.name === fieldName)
  if (!f || !f.role || f.roleSource !== 'learned') return null
  return { role: f.role, src: f.roleSource }
}
const learnedRoles = computed(() => {
  const m = new Map<string, string>()
  for (const f of fieldProfile.value?.fields || []) {
    if (f.role && f.roleSource === 'learned') m.set(f.name, f.role)
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
    const routeId = typeof route.params.id === 'string' ? route.params.id : null
    if (routeId && list.some((d) => d.id === routeId)) await selectDs(routeId)
    else if (!selectedId.value && list.length) await selectDs(list[0].id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function selectDs(id: string, { keepQuery = false }: { keepQuery?: boolean } = {}) {
  selectedId.value = id
  loading.value = true
  preview.value = null
  try {
    detail.value = await datasetApi.get(id)
    // 加载字段自学习画像（角色/统计/采样），展示"系统自动识别"成果
    try {
      fieldProfile.value = await datasetApi.profile(id)
    } catch {
      fieldProfile.value = null // 学习未完成或失败时仅展示基础字段表
    }
    loadIndicators()
    if (keepQuery) {
      router.replace({ path: `/datasets/${id}`, query: { ...route.query } })
    } else {
      router.replace(`/datasets/${id}`)
    }
    if (tab.value === 'preview') await loadPreview()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
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
const learnResult = ref<{ fieldCount?: number; dimensionCount?: number; roleCounts?: Record<string, number> } | null>(null)

function askLearn() {
  learnConfirm.value = true
}
function cancelLearn() {
  learnConfirm.value = false
}
async function confirmLearn() {
  learnConfirm.value = false
  if (!selectedId.value) return
  learning.value = true
  error.value = ''
  try {
    const r = await datasetApi.learn(selectedId.value)
    if (r && r.ok === false) {
      error.value = r.error || '学习失败'
    } else {
      fieldProfile.value = await datasetApi.profile(selectedId.value)
      if (tab.value === 'indicators') await loadIndicators()
      learnResult.value = {
        fieldCount: (r as { fieldCount?: number })?.fieldCount,
        dimensionCount: (r as { dimensionCount?: number })?.dimensionCount,
        roleCounts: (r as { roleCounts?: Record<string, number> })?.roleCounts
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    learning.value = false
  }
}
function goDimensions() {
  learnResult.value = null
  void router.push('/dimensions')
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

watch(tab, (t) => {
  if (t === 'preview') loadPreview()
})
</script>

<template>
  <div class="page">
    <p v-if="error && !showStudio" class="banner-err">{{ error }}</p>

    <div class="layout">
      <aside class="rail">
        <div class="rail-top">
          <div class="rail-title">
            <h1>数据集</h1>
            <span>{{ items.length }}</span>
          </div>
          <button type="button" class="btn primary block" @click="openStudio('create')">新建数据集</button>
          <input v-model="search" class="search" placeholder="搜索名称…" />
          <div class="filters">
            <button
              type="button"
              class="filter"
              :class="{ on: folderFilter === '全部' }"
              @click="folderFilter = '全部'"
            >
              全部
            </button>
            <button
              v-for="f in folders"
              :key="f.name"
              type="button"
              class="filter"
              :class="{ on: folderFilter === f.name }"
              @click="folderFilter = f.name"
            >
              {{ f.name }}
            </button>
          </div>
        </div>

        <div class="rail-list">
          <button
            v-for="d in filtered"
            :key="d.id"
            type="button"
            class="ds"
            :class="{ on: selectedId === d.id }"
            @click="selectDs(d.id)"
          >
            <span class="ds-name">{{ d.name }}</span>
            <span class="ds-sub">{{ d.folder || '未分组' }} · {{ d.tableName || '—' }}</span>
          </button>
          <div v-if="!filtered.length" class="muted pad">无匹配数据集</div>
        </div>
      </aside>

      <section v-if="detail && !loading" class="main">
        <header class="head">
          <div class="head-left">
            <div class="title-row">
              <h2>{{ detail.meta.name }}</h2>
              <span class="pill">{{ detail.meta.status || 'ready' }}</span>
            </div>
            <p class="meta-line">
              <span>{{ srcName }}</span>
              <span class="sep">·</span>
              <code>{{ detail.meta.tableName || '—' }}</code>
              <span class="sep">·</span>
              <span>{{ detail.meta.folder || '未分组' }}</span>
              <span class="sep">·</span>
              <span>{{ dimN }} 维 / {{ quotaN }} 指标</span>
            </p>
          </div>
          <div class="head-acts">
            <button type="button" class="btn sm" :disabled="learning" @click="askLearn">
              {{ learning ? '学习中…' : '重新学习' }}
            </button>
            <button type="button" class="btn sm" @click="openStudio('edit')">编辑</button>
          </div>
        </header>

        <div class="work">
          <div class="tabs">
            <button type="button" :class="{ on: tab === 'fields' }" @click="tab = 'fields'">字段</button>
            <button type="button" :class="{ on: tab === 'indicators' }" @click="tab = 'indicators'">指标确认</button>
            <button type="button" :class="{ on: tab === 'preview' }" @click="tab = 'preview'">预览</button>
            <button type="button" :class="{ on: tab === 'lineage' }" @click="tab = 'lineage'">血缘</button>
          </div>

          <div v-if="tab === 'fields'" class="panel">
            <div v-if="hasLearned" class="learn-banner">
              <b>系统已自动识别字段角色</b>
              <span>基于真实采样统计：ID/标志位/时间/维度/指标。可在问数与生成看板时直接使用。</span>
            </div>
            <table class="tbl">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>显示名</th>
                  <th>角色</th>
                  <th>自动识别</th>
                  <th>类型</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in detail.fields" :key="f.name">
                  <td><code>{{ f.name }}</code></td>
                  <td>{{ f.label }}</td>
                  <td>
                    <span class="tag" :class="f.group">{{ f.group === 'dim' ? '维度' : '指标' }}</span>
                  </td>
                  <td>
                    <template v-if="learnedRoles.get(f.name)">
                      <span class="tag lrn" :class="learnedRoles.get(f.name)">
                        {{ roleLabel(learnedRoles.get(f.name)!) }}
                      </span>
                    </template>
                    <span v-else class="muted">—</span>
                  </td>
                  <td class="muted">{{ f.dataType || '—' }}</td>
                  <td>
                    <template v-if="f.origin === 'calc'">
                      <span class="tag calc">计算</span>
                      <code v-if="f.expression" class="expr" :title="f.expression">{{ f.expression }}</code>
                    </template>
                    <span v-else class="muted">表字段</span>
                  </td>
                </tr>
                <tr v-if="!detail.fields.length">
                  <td colspan="6" class="muted center">暂无字段，点「编辑」配置</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else-if="tab === 'indicators'" class="panel">
            <div class="ind-head">
              <div class="ind-title">
                <b>指标注册表</b>
                <span class="muted tiny">自学习产出候选（draft），确认后成为权威口径（agg/unit），问数与生成看板优先使用。</span>
              </div>
              <button type="button" class="btn sm" @click="showIndForm = !showIndForm">
                {{ showIndForm ? '收起' : '手动新增' }}
              </button>
            </div>

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

            <table class="tbl">
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
                    <span class="tag" :class="ind.status">
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
                  <td colspan="8" class="muted center">
                    暂无候选指标。可在「字段」tab 看自动识别结果，或点「手动新增」录入。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else-if="tab === 'preview'" class="panel panel-preview">
            <table v-if="preview" class="tbl tbl-preview">
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
            <div v-else class="muted pad">加载预览…</div>
          </div>

          <div v-else class="panel pad">
            <p class="lineage">
              数据源 <b>{{ srcName }}</b>
              <span class="arrow">→</span>
              表 <code>{{ detail.meta.tableName }}</code>
              <span class="arrow">→</span>
              数据集 <b>{{ detail.meta.name }}</b>
            </p>
            <p class="muted tiny">可在仪表盘编辑器中绑定本数据集。</p>
          </div>
        </div>
      </section>

      <section v-else class="main empty-main">
        <div class="muted pad">{{ loading ? '加载中…' : '选择左侧数据集，或新建一个' }}</div>
      </section>
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

    <!-- 重新学习：确认弹窗（说明学习逻辑） -->
    <div v-if="learnConfirm" class="modal-mask" @click.self="cancelLearn">
      <div class="learn-dlg" role="dialog" aria-label="确认重新学习">
        <div class="learn-ico">🧠</div>
        <h3>重新学习字段</h3>
        <p class="learn-lead">系统将重新分析「{{ detail?.meta.name }}」的字段，自动识别角色并抽取公共维度。</p>
        <div class="learn-steps">
          <div class="step"><i>1</i><span><b>采样</b>读取表内最多 30 行真实数据</span></div>
          <div class="step"><i>2</i><span><b>统计</b>逐字段计算取值分布 / 唯一值数 / 空值率</span></div>
          <div class="step"><i>3</i><span><b>识别</b>按统计判定：维度 / 指标 / 时间 / ID / 标志位</span></div>
          <div class="step"><i>4</i><span><b>抽取</b>低基数维度连同取值，沉淀为公共维度</span></div>
        </div>
        <p class="learn-note">学习结果会立即生效：字段角色用于问数与看板生成，公共维度可在「维度管理」确认后使用。</p>
        <div class="learn-ft">
          <button type="button" class="btn ghost" @click="cancelLearn">取消</button>
          <button type="button" class="btn primary" :disabled="learning" @click="confirmLearn">
            {{ learning ? '学习中…' : '开始学习' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 学习结果：确认弹窗（展示结果 + 引导去维度管理） -->
    <div v-if="learnResult" class="modal-mask" @click.self="learnResult = null">
      <div class="learn-dlg" role="dialog" aria-label="学习完成">
        <div class="learn-ico ok">✅</div>
        <h3>学习完成</h3>
        <p class="learn-lead">已识别 {{ learnResult.fieldCount ?? '—' }} 个字段角色，抽取 {{ learnResult.dimensionCount ?? 0 }} 个公共维度。</p>
        <div v-if="learnResult.roleCounts" class="learn-roles">
          <span v-for="(n, r) in learnResult.roleCounts" :key="r" class="role-chip">
            {{ roleLabel2(r) }} <b>{{ n }}</b>
          </span>
        </div>
        <p class="learn-note">公共维度可在「维度管理」中查看值、确认或改名，确认后用于查询条预填与问数意图对齐。</p>
        <div class="learn-ft">
          <button type="button" class="btn ghost" @click="learnResult = null">留在本页</button>
          <button type="button" class="btn primary" @click="goDimensions">去维度管理 →</button>
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
  grid-template-columns: 260px minmax(0, 1fr);
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
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.filter {
  border: 0;
  background: #f3f4f6;
  color: #5c6b7a;
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  font-size: 0.72rem;
  cursor: pointer;
  line-height: 1.4;
}
.filter.on {
  background: var(--od-brand-soft, #eef2ff);
  color: var(--primary);
  font-weight: 600;
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
.ind-ops {
  display: flex;
  gap: 10px;
  white-space: nowrap;
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
  color: var(--ink, #111827);
  line-height: 1.45;
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

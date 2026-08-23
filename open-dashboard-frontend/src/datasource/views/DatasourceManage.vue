<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { datasourceApi, datasetApi, type DatasourceVO, type TableItem } from '../api'
import '../../shell/catalog.css'
import '../../shell/studio.css'
import { useCatalogPage } from '../../shell/useCatalogPage'

const route = useRoute()
const router = useRouter()

const items = ref<DatasourceVO[]>([])
const datasets = ref<Awaited<ReturnType<typeof datasetApi.list>>>([])
const selectedId = ref<string | null>(null)
const tables = ref<TableItem[]>([])
const schemas = ref<string[]>([])
const activeSchema = ref('')
const listQuery = ref('')
const tableQuery = ref('')
const typeFilter = ref('all')
const statusFilter = ref('all')
const error = ref('')
const toast = ref('')
const loadingList = ref(false)
const loadingTables = ref(false)
const pinging = ref(false)

const showEditor = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const saving = ref(false)
const probing = ref(false)
const probeOk = ref(false)
const dbOptions = ref<string[]>([])
const schemaOptions = ref<string[]>([])
const form = ref(emptyForm())

function emptyForm() {
  return {
    name: '',
    type: 'pg' as string,
    host: '127.0.0.1',
    port: 5432 as number | null,
    dbName: '',
    schema: '',
    username: '',
    password: ''
  }
}

const typeMeta: Record<string, { label: string; short: string; color: string }> = {
  mysql: { label: 'MySQL', short: 'My', color: '#00758f' },
  pg: { label: 'PostgreSQL', short: 'PG', color: '#336791' },
  postgresql: { label: 'PostgreSQL', short: 'PG', color: '#336791' },
  demo: { label: '演示模版', short: 'Demo', color: '#6b7280' }
}

function isJdbcType(t: string | undefined | null) {
  return t === 'mysql' || t === 'mariadb' || t === 'pg' || t === 'postgresql' || t === 'postgres'
}

function typeLabel(t: string) {
  return typeMeta[t]?.label || t
}

function typeShort(t: string) {
  return typeMeta[t]?.short || t.slice(0, 2).toUpperCase()
}

function typeStyle(type?: string) {
  if (type === 'mysql' || type === 'mariadb') return { short: 'My', bg: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' }
  if (type === 'pg' || type === 'postgresql' || type === 'postgres') {
    return { short: 'PG', bg: 'linear-gradient(135deg,#38bdf8,#0369a1)' }
  }
  if (type === 'demo') return { short: 'Demo', bg: 'linear-gradient(135deg,#94a3b8,#475569)' }
  return { short: typeShort(type || 'DS'), bg: 'linear-gradient(135deg,#818cf8,#4f46e5)' }
}

function statusText(s: string) {
  if (s === 'ok') return '已连通'
  if (s === 'error') return '连接失败'
  if (s === 'unknown') return '未测通'
  return s || '未知'
}

function endpoint(s: DatasourceVO) {
  const host = s.host || '—'
  return s.port ? `${host}:${s.port}` : host
}

function formatStamp(t?: number) {
  if (!t) return '—'
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const typeKeys = computed(() => {
  const set = new Set(items.value.map((s) => s.type))
  return ['all', ...set]
})

const filtered = computed(() => {
  const q = listQuery.value.trim().toLowerCase()
  return items.value.filter((s) => {
    if (typeFilter.value !== 'all' && s.type !== typeFilter.value) return false
    if (statusFilter.value !== 'all' && s.status !== statusFilter.value) return false
    if (!q) return true
    const desc = typeof s.ext?.desc === 'string' ? s.ext.desc : ''
    return (
      s.name.toLowerCase().includes(q) ||
      typeLabel(s.type).toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q) ||
      desc.toLowerCase().includes(q) ||
      (s.host || '').toLowerCase().includes(q) ||
      (s.dbName || '').toLowerCase().includes(q)
    )
  })
})

const selected = computed(() => items.value.find((s) => s.id === selectedId.value) || null)
const isDetail = computed(() => typeof route.params.id === 'string' && !!route.params.id)

const usedDatasets = computed(() =>
  datasets.value.filter((d) => d.datasourceId === selected.value?.id)
)

function datasetCount(id: string) {
  return datasets.value.filter((d) => d.datasourceId === id).length
}

const filteredTables = computed(() => {
  const q = tableQuery.value.trim().toLowerCase()
  if (!q) return tables.value
  return tables.value.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.comment || '').toLowerCase().includes(q)
  )
})

const {
  page: tablePage,
  pageCount: tablePageCount,
  pageNumbers: tablePageNumbers,
  paged: pagedTables,
  rangeLabel: tableRangeLabel,
  pageSize: tablePageSize,
  resetPage: resetTablePage,
  goPage: goTablePage,
} = useCatalogPage(filteredTables)

watch([tableQuery, selectedId, activeSchema], resetTablePage)

const selectedIsPg = computed(() => {
  const t = selected.value?.type
  return t === 'pg' || t === 'postgresql'
})

const selectedIsJdbc = computed(() => isJdbcType(selected.value?.type))

const formIsPg = computed(() => form.value.type === 'pg' || form.value.type === 'postgresql')

const canSave = computed(() => {
  if (!form.value.name.trim() || !form.value.type || !form.value.host.trim()) return false
  if (!form.value.dbName.trim()) return false
  if (editorMode.value === 'create' && !form.value.password) return false
  return true
})

function flash(msg: string) {
  toast.value = msg
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 3200)
}

async function load() {
  loadingList.value = true
  error.value = ''
  try {
    const [srcs, ds] = await Promise.all([datasourceApi.list(), datasetApi.list()])
    items.value = srcs
    datasets.value = ds
    const wanted = typeof route.params.id === 'string' ? route.params.id : ''
    const id = srcs.some((s) => s.id === wanted) ? wanted : srcs[0]?.id || ''
    if (!id) {
      selectedId.value = null
      return
    }
    if (wanted !== id) {
      await router.replace(`/datasources/${id}`)
      return
    }
    selectedId.value = id
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingList.value = false
  }
}

async function loadTables(id: string) {
  loadingTables.value = true
  schemas.value = []
  tables.value = []
  tableQuery.value = ''
  const src = items.value.find((s) => s.id === id)
  if (!src) {
    loadingTables.value = false
    return
  }
  if (!isJdbcType(src.type)) {
    loadingTables.value = false
    return
  }
  try {
    if (src.type === 'pg' || src.type === 'postgresql') {
      schemas.value = await datasourceApi.schemas(id)
      activeSchema.value = src.schema || schemas.value[0] || 'public'
    } else {
      activeSchema.value = ''
    }
    tables.value = await datasourceApi.tables(id, activeSchema.value || undefined)
  } catch (e) {
    tables.value = []
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingTables.value = false
  }
}

async function selectSrc(id: string) {
  selectedId.value = id
  error.value = ''
  if (route.params.id !== id) await router.push(`/datasources/${id}`)
  await loadTables(id)
}

function goList() {
  const first = items.value[0]?.id
  if (first) void router.push(`/datasources/${first}`)
  else void router.push('/datasources')
}

async function onSchemaChange() {
  if (!selected.value) return
  loadingTables.value = true
  try {
    tables.value = await datasourceApi.tables(selected.value.id, activeSchema.value || undefined)
    if (activeSchema.value && activeSchema.value !== (selected.value.schema || '')) {
      await datasourceApi.update(selected.value.id, { schema: activeSchema.value })
      const idx = items.value.findIndex((s) => s.id === selected.value!.id)
      if (idx >= 0) {
        items.value[idx] = { ...items.value[idx], schema: activeSchema.value }
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingTables.value = false
  }
}

async function ping() {
  if (!selected.value) return
  pinging.value = true
  error.value = ''
  try {
    const r = await datasourceApi.ping(selected.value.id)
    if (r.ok) {
      flash(`${r.message}${r.latencyMs != null ? ` · ${r.latencyMs}ms` : ''}`)
      await load()
      if (selectedId.value) await loadTables(selectedId.value)
    } else {
      error.value = r.message || '连接失败'
      await load()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    pinging.value = false
  }
}

async function pingAll() {
  pinging.value = true
  error.value = ''
  try {
    let ok = 0
    for (const s of items.value) {
      if (!isJdbcType(s.type)) continue
      const r = await datasourceApi.ping(s.id).catch(() => ({ ok: false }))
      if (r.ok) ok += 1
    }
    await load()
    if (selectedId.value) await loadTables(selectedId.value)
    flash(`已检测 ${items.value.length} 个数据源 · ${ok} 个连通`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    pinging.value = false
  }
}

function openCreate() {
  editorMode.value = 'create'
  editingId.value = null
  form.value = emptyForm()
  form.value.type = 'pg'
  form.value.port = 5432
  probeOk.value = false
  dbOptions.value = []
  schemaOptions.value = []
  error.value = ''
  showEditor.value = true
}

function openEdit() {
  if (!selected.value) return
  const s = selected.value
  editorMode.value = 'edit'
  editingId.value = s.id
  form.value = {
    name: s.name,
    type: s.type === 'postgresql' ? 'pg' : s.type,
    host: s.host || '',
    port: s.port ?? null,
    dbName: s.dbName || '',
    schema: s.schema || '',
    username: s.username || '',
    password: ''
  }
  probeOk.value = false
  dbOptions.value = []
  schemaOptions.value = []
  error.value = ''
  showEditor.value = true
}

function onTypePick(t: string) {
  form.value.type = t
  form.value.port = t === 'mysql' ? 3306 : 5432
  probeOk.value = false
  dbOptions.value = []
  schemaOptions.value = []
}

async function testAndLoadCatalog() {
  if (!form.value.host.trim() || !form.value.username.trim()) {
    error.value = '请填写 Host 与用户名'
    return
  }
  if (editorMode.value === 'create' && !form.value.password) {
    error.value = '新建连接请填写密码'
    return
  }
  probing.value = true
  error.value = ''
  probeOk.value = false
  try {
    const base = {
      type: form.value.type === 'postgresql' ? 'pg' : form.value.type,
      host: form.value.host.trim(),
      port: form.value.port ?? undefined,
      username: form.value.username.trim(),
      password: form.value.password || undefined,
      dbName: form.value.dbName.trim() || undefined
    }
    const ping = await datasourceApi.probe({ ...base, action: 'ping' })
    if (!ping.ok) {
      error.value = ping.message || '连接失败'
      return
    }
    const dbs = await datasourceApi.probe({ ...base, action: 'databases' })
    if (!dbs.ok) {
      error.value = dbs.message || '无法列举数据库'
      return
    }
    dbOptions.value = dbs.databases || []
    if (!form.value.dbName && dbOptions.value.length) {
      form.value.dbName = dbOptions.value[0]
    } else if (form.value.dbName && !dbOptions.value.includes(form.value.dbName)) {
      dbOptions.value = [form.value.dbName, ...dbOptions.value]
    }
    await loadSchemaOptions()
    probeOk.value = true
    flash(`连接成功${ping.latencyMs != null ? ` · ${ping.latencyMs}ms` : ''}，请确认库与 Schema`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    probing.value = false
  }
}

async function loadSchemaOptions() {
  schemaOptions.value = []
  if (!formIsPg.value || !form.value.dbName) return
  try {
    const r = await datasourceApi.probe({
      type: 'pg',
      host: form.value.host.trim(),
      port: form.value.port ?? undefined,
      username: form.value.username.trim(),
      password: form.value.password || undefined,
      dbName: form.value.dbName,
      action: 'schemas'
    })
    if (r.ok) {
      schemaOptions.value = r.schemas || []
      if (!form.value.schema) {
        form.value.schema = schemaOptions.value.includes('public')
          ? 'public'
          : schemaOptions.value[0] || ''
      }
    }
  } catch {
    schemaOptions.value = []
  }
}

async function saveEditor() {
  if (!canSave.value) {
    error.value =
      editorMode.value === 'create'
        ? '请填写名称、Host、Database 与密码'
        : '请填写名称、Host 与 Database'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = {
      name: form.value.name.trim(),
      type: form.value.type === 'postgresql' ? 'pg' : form.value.type,
      host: form.value.host.trim(),
      port: form.value.port ?? undefined,
      dbName: form.value.dbName.trim(),
      schema: form.value.schema.trim() || undefined,
      username: form.value.username.trim() || undefined,
      password: form.value.password || undefined,
      ext: { desc: `${typeLabel(form.value.type)} 连接` }
    }
    let id = editingId.value
    if (editorMode.value === 'create') {
      const vo = await datasourceApi.create(payload)
      id = vo.id
    } else if (id) {
      const { type: _t, ...patch } = payload
      await datasourceApi.update(id, patch)
    }
    showEditor.value = false
    await load()
    if (id) await selectSrc(id)
    flash(editorMode.value === 'create' ? '已保存连接' : '已更新连接')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function removeSrc() {
  if (!selected.value) return
  if (!window.confirm(`确定删除「${selected.value.name}」？引用它的数据集不会自动删除。`)) return
  try {
    await datasourceApi.remove(selected.value.id)
    await load()
    goList()
    flash('已删除连接')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function goMakeDataset(tableName?: string) {
  const q = new URLSearchParams()
  if (selected.value) q.set('src', selected.value.id)
  if (tableName) q.set('table', tableName)
  if (activeSchema.value) q.set('schema', activeSchema.value)
  q.set('studio', '1')
  router.push(`/datasets?${q.toString()}`)
}

onMounted(async () => {
  await load()
  if (selectedId.value) await loadTables(selectedId.value)
})

watch(
  () => route.params.id,
  async (id) => {
    if (typeof id === 'string' && id) {
      if (id !== selectedId.value) await selectSrc(id)
      return
    }
    if (items.value[0]) {
      await router.replace(`/datasources/${items.value[0].id}`)
      return
    }
    selectedId.value = null
    tables.value = []
  }
)
</script>

<template>
  <div class="page asset-studio">
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <p v-if="error && !showEditor" class="banner-err">{{ error }}</p>

    <div class="asset-body">
      <aside class="asset-rail">
        <div class="rail-head"><span>连接列表</span><span>{{ filtered.length }}</span></div>
        <div class="rail-tools">
          <label class="asset-search">
            <span class="ico">⌕</span>
            <input v-model="listQuery" type="search" placeholder="搜索名称、类型、备注" />
          </label>
          <div class="rail-tools-row">
            <select v-model="typeFilter" class="rail-select" aria-label="类型">
              <option v-for="t in typeKeys" :key="t" :value="t">{{ t === 'all' ? '全部类型' : typeLabel(t) }}</option>
            </select>
            <select v-model="statusFilter" class="rail-select" aria-label="状态">
              <option value="all">全部状态</option>
              <option value="ok">已连通</option>
              <option value="error">连接失败</option>
              <option value="unknown">未测通</option>
            </select>
          </div>
        </div>
        <div class="rail-scroll">
          <button
            v-for="s in filtered"
            :key="s.id"
            type="button"
            class="asset-item"
            :class="{ on: s.id === selectedId }"
            @click="selectSrc(s.id)"
          >
            <span class="type-badge" :style="{ background: typeStyle(s.type).bg }">{{ typeStyle(s.type).short }}</span>
            <div class="meta">
              <div class="name">{{ s.name }}</div>
              <div class="desc">
                <span class="status-dot" :class="s.status"></span>
                <span>{{ typeLabel(s.type) }}</span>
                <span>·</span>
                <span>{{ statusText(s.status) }}</span>
              </div>
            </div>
          </button>
          <div v-if="!filtered.length" class="empty-illus">
            <div class="big">⌀</div>
            {{ items.length ? '无匹配连接' : '还没有数据源' }}
          </div>
        </div>
      </aside>

      <div class="asset-main">
        <div class="asset-bar">
          <div class="spacer"></div>
          <button type="button" class="btn" :disabled="pinging" @click="pingAll">全部检测</button>
          <button type="button" class="btn primary" @click="openCreate">+ 新建连接</button>
        </div>
        <section class="asset-stage">
        <template v-if="selected">
          <div class="hero-card">
            <div class="hero-top">
              <span class="type-badge lg" :style="{ background: typeStyle(selected.type).bg }">{{ typeStyle(selected.type).short }}</span>
              <div class="hero-copy">
                <h2>{{ selected.name }}</h2>
                <div class="sub">
                  {{ typeof selected.ext?.desc === 'string' ? selected.ext.desc : typeLabel(selected.type) }} ·
                  {{ statusText(selected.status) }} ·
                  {{ selected.username || '未填用户' }}
                </div>
              </div>
              <div class="hero-actions">
                <button v-if="selectedIsJdbc" type="button" class="btn" :disabled="pinging" @click="ping">
                  {{ pinging ? '测试中…' : '测试连接' }}
                </button>
                <button v-if="selectedIsJdbc" type="button" class="btn" :disabled="loadingTables" @click="loadTables(selected.id)">浏览结构</button>
                <button v-if="selectedIsJdbc" type="button" class="btn" @click="openEdit">编辑</button>
                <button type="button" class="btn" @click="removeSrc">删除</button>
                <button type="button" class="btn primary" @click="goMakeDataset()">以此创建数据集</button>
              </div>
            </div>
            <div class="metric-strip">
              <div class="metric-cell">
                <div class="k">引擎类型</div>
                <div class="v" :style="{ color: typeMeta[selected.type]?.color || '#4f46e5' }">{{ typeLabel(selected.type) }}</div>
                <div class="h">Connector</div>
              </div>
              <div class="metric-cell">
                <div class="k">主机 / 入口</div>
                <div class="v" style="font-size:13px">{{ endpoint(selected) }}</div>
                <div class="h">Network</div>
              </div>
              <div class="metric-cell">
                <div class="k">库 / Schema</div>
                <div class="v">{{ selected.dbName || '—' }}{{ selected.schema ? ' / ' + selected.schema : '' }}</div>
                <div class="h">Catalog</div>
              </div>
              <div class="metric-cell">
                <div class="k">上次检测</div>
                <div class="v" style="font-size:13px">{{ formatStamp(selected.updateTime) }}</div>
                <div class="h">Health check</div>
              </div>
            </div>
          </div>

          <div class="soft-panel">
            <div class="phd">
              <h3>连接属性</h3>
              <span class="hint">结构化展示 · 非终端日志</span>
            </div>
            <div class="pbd">
              <div class="kv-grid">
                <div class="kv"><div class="kk">显示名</div><div class="vv">{{ selected.name }}</div></div>
                <div class="kv"><div class="kk">类型</div><div class="vv">{{ typeLabel(selected.type) }}</div></div>
                <div class="kv"><div class="kk">Host</div><div class="vv">{{ selected.host || '—' }}</div></div>
                <div class="kv"><div class="kk">Port</div><div class="vv">{{ selected.port ?? '—' }}</div></div>
                <div class="kv"><div class="kk">Database</div><div class="vv">{{ selected.dbName || '—' }}</div></div>
                <div class="kv"><div class="kk">Schema</div><div class="vv">{{ selected.schema || '—' }}</div></div>
                <div class="kv"><div class="kk">用户名</div><div class="vv">{{ selected.username || '—' }}</div></div>
                <div class="kv"><div class="kk">引用数据集</div><div class="vv">{{ usedDatasets.length }} 个</div></div>
              </div>
            </div>
          </div>

          <div class="soft-panel">
            <div class="phd">
              <h3>库表结构预览</h3>
              <span class="hint">点击行可直接创建数据集 · 每页 {{ tablePageSize }} 条</span>
              <select
                v-if="selectedIsPg && schemas.length"
                v-model="activeSchema"
                class="asset-filter"
                style="height:28px;margin-left:auto"
                @change="onSchemaChange"
              >
                <option v-for="s in schemas" :key="s" :value="s">{{ s }}</option>
              </select>
              <input
                v-if="selectedIsJdbc"
                v-model="tableQuery"
                class="asset-search"
                style="width:180px;height:28px"
                placeholder="筛选表名"
              />
              <button v-if="selectedIsJdbc" type="button" class="btn" :disabled="loadingTables" @click="loadTables(selected.id)">刷新</button>
            </div>
            <div class="pbd flush">
              <div v-if="!selectedIsJdbc" class="empty-illus">
                <div class="big">⌀</div>
                演示模版数据源，不连真实库
              </div>
              <div v-else-if="loadingTables" class="empty-illus">正在拉取表清单…</div>
              <div v-else-if="!tables.length" class="empty-illus">
                <div class="big">▦</div>
                没有拉到表，请先测试连接或编辑确认库名
              </div>
              <div v-else-if="!filteredTables.length" class="empty-illus">无匹配表名</div>
              <table v-else class="schema-table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>说明</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in pagedTables" :key="t.name" @click="goMakeDataset(t.name)">
                    <td><b>{{ t.name }}</b></td>
                    <td style="color:var(--as-muted)">{{ t.comment || '点此用这张表创建数据集' }}</td>
                    <td>
                      <button type="button" class="btn" @click.stop="goMakeDataset(t.name)">选用</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="filteredTables.length" class="catalog-pager">
                <span class="pager-info">第 {{ tableRangeLabel }} 条，共 {{ filteredTables.length }} 张表 · 每页 {{ tablePageSize }} 条</span>
                <button type="button" :disabled="tablePage <= 1" @click="goTablePage(tablePage - 1)">上一页</button>
                <button
                  v-for="n in tablePageNumbers"
                  :key="n"
                  type="button"
                  :class="{ on: n === tablePage }"
                  @click="goTablePage(n)"
                >
                  {{ n }}
                </button>
                <button type="button" :disabled="tablePage >= tablePageCount" @click="goTablePage(tablePage + 1)">下一页</button>
              </div>
            </div>
          </div>

          <div class="soft-panel">
            <div class="phd">
              <h3>下游数据集</h3>
              <span class="hint">{{ usedDatasets.length }} 个引用</span>
            </div>
            <div class="pbd">
              <div v-if="usedDatasets.length" class="ref-grid">
                <button
                  v-for="d in usedDatasets"
                  :key="d.id"
                  type="button"
                  class="ref-card"
                  @click="router.push(`/datasets/${d.id}`)"
                >
                  <div class="rt">{{ d.name }}</div>
                  <div class="rm">{{ d.tableName || d.folder || '—' }}</div>
                  <div class="rf">
                    <span class="mini-tag">{{ d.folder || '未分组' }}</span>
                    <span class="mini-tag blue">{{ d.status || 'ready' }}</span>
                  </div>
                </button>
              </div>
              <div v-else class="empty-illus">
                <div class="big">▦</div>
                还没有数据集引用此连接
                <div style="margin-top:10px">
                  <button type="button" class="btn primary" @click="goMakeDataset()">以此创建第一个数据集</button>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="empty-illus">
          <div class="big">⌀</div>
          {{ loadingList ? '加载中…' : '还没有数据源，先新建一个连接' }}
          <div v-if="!loadingList && !items.length" style="margin-top:12px">
            <button type="button" class="btn primary" @click="openCreate">新建连接</button>
          </div>
        </div>
      </section>
      </div>
    </div>

    <!-- 新建 / 编辑：单页表单，测通后选库 -->
    <div v-if="showEditor" class="mask" @click.self="showEditor = false">
      <div class="dialog" role="dialog" :aria-label="editorMode === 'create' ? '新建连接' : '编辑连接'">
        <header class="dlg-head">
          <div>
            <h3>{{ editorMode === 'create' ? '新建数据源' : '编辑连接' }}</h3>
            <p class="muted">测通后选择 Database{{ formIsPg ? ' / Schema' : '' }}，再保存</p>
          </div>
          <button type="button" class="icon-x" aria-label="关闭" @click="showEditor = false">×</button>
        </header>

        <p v-if="error && showEditor" class="dlg-err">{{ error }}</p>

        <div class="engine">
          <button
            v-for="t in ['pg', 'mysql']"
            :key="t"
            type="button"
            class="engine-btn"
            :class="{ on: form.type === t }"
            :disabled="editorMode === 'edit'"
            @click="onTypePick(t)"
          >
            <strong>{{ typeLabel(t) }}</strong>
            <span>JDBC</span>
          </button>
        </div>

        <label class="field">
          显示名称
          <input v-model="form.name" placeholder="例如：本地分析库" />
        </label>
        <div class="grid2">
          <label class="field">Host<input v-model="form.host" placeholder="127.0.0.1" /></label>
          <label class="field">Port<input v-model.number="form.port" type="number" /></label>
        </div>
        <div class="grid2">
          <label class="field">用户名<input v-model="form.username" autocomplete="username" /></label>
          <label class="field">
            密码
            <input
              v-model="form.password"
              type="password"
              :placeholder="editorMode === 'edit' ? '留空则不修改' : '连接密码'"
              autocomplete="new-password"
            />
          </label>
        </div>

        <div class="probe-row">
          <button type="button" class="btn" :disabled="probing" @click="testAndLoadCatalog">
            {{ probing ? '测试中…' : '测试连接并加载库列表' }}
          </button>
          <span v-if="probeOk" class="ok-tag">已测通</span>
        </div>

        <div class="grid2" :class="{ dim: !probeOk && !form.dbName }">
          <label class="field">
            Database
            <select v-if="dbOptions.length" v-model="form.dbName" @change="loadSchemaOptions">
              <option v-for="d in dbOptions" :key="d" :value="d">{{ d }}</option>
            </select>
            <input v-else v-model="form.dbName" placeholder="测通后可下拉选择，也可手填" />
          </label>
          <label v-if="formIsPg" class="field">
            Schema
            <select v-if="schemaOptions.length" v-model="form.schema">
              <option v-for="s in schemaOptions" :key="s" :value="s">{{ s }}</option>
            </select>
            <input v-else v-model="form.schema" placeholder="public" />
          </label>
        </div>

        <footer class="dlg-foot">
          <button type="button" class="btn ghost" @click="showEditor = false">取消</button>
          <button type="button" class="btn primary" :disabled="saving || !canSave" @click="saveEditor">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </footer>
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
  --bg: var(--od-bg, #f6f7fb);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--ink);
  min-height: 0;
}
.toast {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  background: #1f2329;
  color: #fff;
  padding: 0.55rem 1rem;
  border-radius: 8px;
  font-size: 0.85rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
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
  gap: 0.55rem;
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
  border: 1px solid #d0d5dd;
  background: #fff;
  border-radius: 7px;
  padding: 0.4rem 0.75rem;
  font-size: 0.82rem;
  cursor: pointer;
  color: var(--ink);
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
.btn.danger {
  color: #b42318;
  border-color: #f0b4ae;
}
.btn.sm {
  padding: 0.3rem 0.65rem;
  font-size: 0.78rem;
}
.btn.block {
  width: 100%;
}
.search {
  width: 100%;
  box-sizing: border-box;
  padding: 0.4rem 0.6rem;
  border: 1px solid #d8dee6;
  border-radius: 7px;
  font-size: 0.82rem;
}
.search.sm {
  width: 160px;
}
.rail-list {
  flex: 1;
  overflow: auto;
  padding: 0.4rem;
}
.src {
  width: 100%;
  display: grid;
  grid-template-columns: 36px 1fr 8px;
  gap: 0.55rem;
  align-items: center;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0.55rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
}
.src:hover {
  background: var(--od-bg, #f6f7fb);
}
.src.on {
  background: var(--od-brand-soft, #eef2ff);
}
.mark {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 0.68rem;
  font-weight: 700;
}
.src-body {
  min-width: 0;
}
.src-name {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.src-sub {
  display: block;
  font-size: 0.7rem;
  color: var(--muted);
  margin-top: 0.12rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.st {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c5cc;
}
.st.ok {
  background: #52c41a;
}
.st.error {
  background: #f5222d;
}
.st.unknown {
  background: #faad14;
}
.main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.head {
  background: #fff;
  border-bottom: 1px solid var(--line);
  padding: 0.85rem 1.15rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.head h2 {
  margin: 0;
  font-size: 1.15rem;
}
.pill {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: var(--od-bg, #f6f7fb);
  color: var(--muted);
}
.pill.ok {
  background: #f6ffed;
  color: #389e0d;
}
.pill.error {
  background: #fff2f0;
  color: #cf1322;
}
.ep {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}
.ep code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  color: #3d4a5c;
  background: #f3f5f8;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
}
.sep {
  opacity: 0.5;
}
.head-acts {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}
.work {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 0;
}
.tables-pane {
  min-height: 0;
  overflow: auto;
  background: #fff;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
}
.tool {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #fff;
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--line);
}
.tool-left,
.tool-right {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.tool h3 {
  margin: 0;
  font-size: 0.9rem;
}
.count {
  font-size: 0.72rem;
  color: var(--muted);
}
.sel {
  height: 28px;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  padding: 0 0.4rem;
  font-size: 0.78rem;
  background: #fff;
}
.table-list {
  list-style: none;
  margin: 0;
  padding: 0.35rem 0 1rem;
}
.table-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid #f0f2f5;
  cursor: pointer;
}
.table-row:hover {
  background: #f7f9fc;
}
.t-name {
  font-size: 0.88rem;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.t-meta {
  font-size: 0.72rem;
  color: var(--muted);
  margin-top: 0.15rem;
}
.side {
  overflow: auto;
  padding: 0.75rem;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.side-card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.75rem 0.85rem;
}
.side-card h4 {
  margin: 0 0 0.25rem;
  font-size: 0.82rem;
}
.side-card.tip ol {
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  color: #5c6b7a;
  line-height: 1.55;
}
.ds-link {
  display: flex;
  flex-direction: column;
  width: 100%;
  text-align: left;
  border: 0;
  background: #f7f9fc;
  border-radius: 7px;
  padding: 0.45rem 0.55rem;
  margin-top: 0.35rem;
  cursor: pointer;
}
.ds-link:hover {
  background: var(--od-brand-soft, #eef2ff);
}
.ds-name {
  font-size: 0.82rem;
  font-weight: 600;
}
.ds-sub {
  font-size: 0.7rem;
  color: var(--muted);
  margin-top: 0.1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.muted {
  color: var(--muted);
  font-size: 0.82rem;
}
.muted.tiny {
  font-size: 0.72rem;
  margin: 0;
}
.pad {
  padding: 1.25rem;
  text-align: center;
}
.pad-sm {
  padding: 0.5rem 0 0;
}
.empty-box {
  margin: 2rem auto;
  max-width: 320px;
  text-align: center;
  color: var(--ink);
}
.empty-box p {
  margin: 0 0 0.45rem;
}
.empty-acts {
  display: flex;
  justify-content: center;
  gap: 0.45rem;
  margin-top: 0.85rem;
}
.empty-main {
  display: grid;
  place-items: center;
  background: #fff;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: grid;
  place-items: center;
  z-index: 50;
  padding: 1rem;
}
.dialog {
  width: min(520px, 100%);
  background: #fff;
  border-radius: 12px;
  padding: 1rem 1.15rem 1.1rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.18);
  max-height: min(90vh, 720px);
  overflow: auto;
}
.dlg-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.dlg-head h3 {
  margin: 0 0 0.2rem;
  font-size: 1.05rem;
}
.icon-x {
  border: 0;
  background: transparent;
  font-size: 1.35rem;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
  padding: 0 0.2rem;
}
.dlg-err {
  margin: 0 0 0.65rem;
  padding: 0.45rem 0.6rem;
  background: #fff2f0;
  color: #b42318;
  border-radius: 6px;
  font-size: 0.8rem;
}
.engine {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.engine-btn {
  border: 1px solid #d8dee6;
  background: #fff;
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.engine-btn span {
  font-size: 0.7rem;
  color: var(--muted);
}
.engine-btn.on {
  border-color: var(--primary);
  background: var(--od-brand-soft, #eef2ff);
}
.engine-btn:disabled {
  opacity: 0.7;
  cursor: default;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: #5c6b7a;
  margin-bottom: 0.55rem;
}
.field input,
.field select {
  height: 34px;
  padding: 0 0.55rem;
  border: 1px solid #d8dee6;
  border-radius: 7px;
  font-size: 0.88rem;
  color: var(--ink);
  background: #fff;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.grid2.dim {
  opacity: 0.85;
}
.probe-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin: 0.15rem 0 0.75rem;
}
.ok-tag {
  font-size: 0.75rem;
  color: #389e0d;
  font-weight: 600;
}
.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
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
.name-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.mark.sm {
  width: 28px;
  height: 28px;
  font-size: 0.62rem;
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
.catalog-table td.muted {
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .rail {
    max-height: 40vh;
  }
  .work {
    grid-template-columns: 1fr;
  }
  .side {
    border-top: 1px solid var(--line);
  }
}
</style>

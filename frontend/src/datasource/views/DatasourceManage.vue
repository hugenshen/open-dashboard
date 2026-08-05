<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ModuleTopbar from '../../shell/ModuleTopbar.vue'
import { datasourceApi, datasetApi, type DatasourceVO, type TableItem } from '../api'

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
  postgresql: { label: 'PostgreSQL', short: 'PG', color: '#336791' }
}

function typeLabel(t: string) {
  return typeMeta[t]?.label || t
}

function typeShort(t: string) {
  return typeMeta[t]?.short || t.slice(0, 2).toUpperCase()
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

const typeKeys = computed(() => {
  const set = new Set(items.value.map((s) => s.type))
  return ['all', ...set]
})

const filtered = computed(() => {
  const q = listQuery.value.trim().toLowerCase()
  return items.value.filter((s) => {
    if (typeFilter.value !== 'all' && s.type !== typeFilter.value) return false
    if (!q) return true
    return (
      s.name.toLowerCase().includes(q) ||
      (s.host || '').toLowerCase().includes(q) ||
      (s.dbName || '').toLowerCase().includes(q)
    )
  })
})

const selected = computed(() => items.value.find((s) => s.id === selectedId.value) || null)

const usedDatasets = computed(() =>
  datasets.value.filter((d) => d.datasourceId === selected.value?.id)
)

const filteredTables = computed(() => {
  const q = tableQuery.value.trim().toLowerCase()
  if (!q) return tables.value
  return tables.value.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.comment || '').toLowerCase().includes(q)
  )
})

const selectedIsPg = computed(() => {
  const t = selected.value?.type
  return t === 'pg' || t === 'postgresql'
})

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
    const routeId = typeof route.params.id === 'string' ? route.params.id : null
    if (routeId && srcs.some((s) => s.id === routeId)) selectedId.value = routeId
    else if (selectedId.value && srcs.some((s) => s.id === selectedId.value)) {
      /* keep */
    } else if (srcs.length) selectedId.value = srcs[0].id
    else selectedId.value = null
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
  router.replace(`/datasources/${id}`)
  await loadTables(id)
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
    selectedId.value = null
    await load()
    if (selectedId.value) await selectSrc(selectedId.value)
    else tables.value = []
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
  if (selectedId.value) await selectSrc(selectedId.value)
})

watch(
  () => route.params.id,
  async (id) => {
    if (typeof id === 'string' && id !== selectedId.value) await selectSrc(id)
  }
)
</script>

<template>
  <div class="page">
    <ModuleTopbar module="datasources" />

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <p v-if="error && !showEditor" class="banner-err">{{ error }}</p>

    <div class="layout">
      <!-- 左：连接列表 -->
      <aside class="rail">
        <div class="rail-top">
          <div class="rail-title">
            <h1>数据源</h1>
            <span>{{ items.length }}</span>
          </div>
          <button type="button" class="btn primary block" @click="openCreate">新建连接</button>
          <input v-model="listQuery" class="search" placeholder="搜索名称 / 主机 / 库" />
          <div class="filters">
            <button
              v-for="t in typeKeys"
              :key="t"
              type="button"
              class="filter"
              :class="{ on: typeFilter === t }"
              @click="typeFilter = t"
            >
              {{ t === 'all' ? '全部' : typeLabel(t) }}
            </button>
          </div>
        </div>

        <div class="rail-list">
          <button
            v-for="s in filtered"
            :key="s.id"
            type="button"
            class="src"
            :class="{ on: selected?.id === s.id }"
            @click="selectSrc(s.id)"
          >
            <span class="mark" :style="{ background: (typeMeta[s.type]?.color || '#3480f9') + '18', color: typeMeta[s.type]?.color || '#3480f9' }">
              {{ typeShort(s.type) }}
            </span>
            <span class="src-body">
              <span class="src-name">{{ s.name }}</span>
              <span class="src-sub">{{ endpoint(s) }} · {{ s.dbName || '未选库' }}</span>
            </span>
            <span class="st" :class="s.status" :title="statusText(s.status)" />
          </button>
          <div v-if="loadingList" class="muted pad">加载中…</div>
          <div v-else-if="!filtered.length" class="muted pad">
            {{ items.length ? '无匹配连接' : '还没有数据源，点上方新建' }}
          </div>
        </div>
      </aside>

      <!-- 右：当前连接 + 表 -->
      <section v-if="selected" class="main">
        <header class="head">
          <div class="head-left">
            <div class="title-row">
              <h2>{{ selected.name }}</h2>
              <span class="pill" :class="selected.status">{{ statusText(selected.status) }}</span>
            </div>
            <p class="ep">
              <span>{{ typeLabel(selected.type) }}</span>
              <span class="sep">·</span>
              <code>{{ endpoint(selected) }}</code>
              <span class="sep">·</span>
              <code>{{ selected.dbName || '—' }}</code>
              <template v-if="selected.schema">
                <span class="sep">/</span>
                <code>{{ selected.schema }}</code>
              </template>
              <template v-if="selected.username">
                <span class="sep">·</span>
                <span>{{ selected.username }}</span>
              </template>
            </p>
          </div>
          <div class="head-acts">
            <button type="button" class="btn" :disabled="pinging" @click="ping">
              {{ pinging ? '测试中…' : '测试连接' }}
            </button>
            <button type="button" class="btn" @click="openEdit">编辑</button>
            <button type="button" class="btn danger" @click="removeSrc">删除</button>
          </div>
        </header>

        <div class="work">
          <div class="tables-pane">
            <div class="tool">
              <div class="tool-left">
                <h3>库表</h3>
                <span class="count">{{ filteredTables.length }}{{ tableQuery ? ` / ${tables.length}` : '' }}</span>
                <select
                  v-if="selectedIsPg && schemas.length"
                  v-model="activeSchema"
                  class="sel"
                  title="Schema"
                  @change="onSchemaChange"
                >
                  <option v-for="s in schemas" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
              <div class="tool-right">
                <input v-model="tableQuery" class="search sm" placeholder="筛选表名" />
                <button type="button" class="btn" :disabled="loadingTables" @click="selectedId && loadTables(selectedId)">
                  刷新
                </button>
              </div>
            </div>

            <div v-if="loadingTables" class="muted pad">正在拉取表清单…</div>
            <div v-else-if="!tables.length" class="empty-box">
              <p>没有拉到表</p>
              <p class="muted">请先「测试连接」，或点「编辑」确认库名、Schema 与密码。</p>
              <div class="empty-acts">
                <button type="button" class="btn" @click="ping">测试连接</button>
                <button type="button" class="btn primary" @click="openEdit">编辑连接</button>
              </div>
            </div>
            <div v-else-if="!filteredTables.length" class="muted pad">无匹配表名</div>
            <ul v-else class="table-list">
              <li v-for="t in filteredTables" :key="t.name" class="table-row">
                <div class="t-main">
                  <div class="t-name">{{ t.name }}</div>
                  <div class="t-meta">{{ t.comment || 'table' }}</div>
                </div>
                <button type="button" class="btn primary sm" @click="goMakeDataset(t.name)">
                  创建数据集
                </button>
              </li>
            </ul>
          </div>

          <aside class="side">
            <div class="side-card">
              <h4>下游数据集</h4>
              <p class="muted tiny">{{ usedDatasets.length }} 个引用此连接</p>
              <button
                v-for="d in usedDatasets"
                :key="d.id"
                type="button"
                class="ds-link"
                @click="router.push(`/datasets/${d.id}`)"
              >
                <span class="ds-name">{{ d.name }}</span>
                <span class="ds-sub">{{ d.tableName || '—' }}</span>
              </button>
              <p v-if="!usedDatasets.length" class="muted tiny pad-sm">从左侧表点「创建数据集」开始</p>
            </div>
            <div class="side-card tip">
              <h4>使用顺序</h4>
              <ol>
                <li>测通连接</li>
                <li>选 Schema / 表</li>
                <li>创建数据集</li>
              </ol>
            </div>
          </aside>
        </div>
      </section>

      <section v-else class="main empty-main">
        <div class="empty-box">
          <p>选择左侧连接，或新建一个</p>
          <button type="button" class="btn primary" @click="openCreate">新建连接</button>
        </div>
      </section>
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
  --primary: #3480f9;
  --ink: #1a2332;
  --muted: #86909c;
  --line: rgba(0, 0, 0, 0.08);
  --bg: #f0f2f5;
  height: 100vh;
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
  grid-template-columns: 280px minmax(0, 1fr);
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
  padding: 0.18rem 0.55rem;
  font-size: 0.72rem;
  cursor: pointer;
}
.filter.on {
  background: #e8f0ff;
  color: var(--primary);
  font-weight: 600;
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
  background: #f5f7fa;
}
.src.on {
  background: #eef4ff;
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
  background: #f0f0f0;
  color: #5c6b7a;
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
  background: #eef4ff;
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
  background: #eef4ff;
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

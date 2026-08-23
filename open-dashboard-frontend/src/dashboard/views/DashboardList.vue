<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dashboardApi, dashboardTreeApi } from '../../api/dashboard'
import type { DashboardBarVO, DashboardTemplateVO, BusiNodeVO } from '../../types/dashboard'
import '../../shell/catalog.css'
import { useCatalogPage } from '../../shell/useCatalogPage'

const route = useRoute()
const router = useRouter()

const tree = ref<BusiNodeVO[]>([])
const bars = ref<Record<string, DashboardBarVO>>({})
const search = ref('')
const statusFilter = ref<'all' | 'draft' | 'publishedWithDraft' | 'published'>('all')
const updaterFilter = ref('all')
const timeFrom = ref('')
const timeTo = ref('')
const error = ref('')
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | null = null
const creating = ref(false)
const deleting = ref<string | null>(null)
const publishing = ref<string | null>(null)
const showTemplateModal = ref(false)
const templates = ref<DashboardTemplateVO[]>([])
const selectedTemplateId = ref('blank')
const createName = ref('')
const loadingTemplates = ref(false)
const templateError = ref('')

const flat = computed(() => {
  const out: BusiNodeVO[] = []
  const walk = (nodes: BusiNodeVO[]) => {
    for (const n of nodes) {
      if (n.nodeType === 'dashboard') out.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(tree.value)
  return out
})

const updaters = computed(() => {
  const set = new Set<string>()
  for (const n of flat.value) {
    const b = bars.value[n.id]
    const u = b?.updateBy || b?.createBy
    if (u) set.add(u)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
})

function dayStart(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return d.getTime()
}

function dayEnd(iso: string) {
  const d = new Date(`${iso}T23:59:59.999`)
  return d.getTime()
}

function matchTime(t?: number) {
  if (!timeFrom.value && !timeTo.value) return true
  if (!t) return false
  if (timeFrom.value && t < dayStart(timeFrom.value)) return false
  if (timeTo.value && t > dayEnd(timeTo.value)) return false
  return true
}

function clearTimeRange() {
  timeFrom.value = ''
  timeTo.value = ''
}

const hasActiveFilter = computed(
  () =>
    !!search.value.trim() ||
    statusFilter.value !== 'all' ||
    updaterFilter.value !== 'all' ||
    !!timeFrom.value ||
    !!timeTo.value
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = flat.value.filter((n) => {
    const b = bars.value[n.id]
    const s = b?.status || 'draft'
    if (statusFilter.value !== 'all' && s !== statusFilter.value) return false
    if (updaterFilter.value !== 'all') {
      const u = b?.updateBy || b?.createBy || ''
      if (u !== updaterFilter.value) return false
    }
    if (!matchTime(b?.updateTime || b?.createTime)) return false
    return !q || n.name.toLowerCase().includes(q)
  })
  const rank = (id: string) => {
    const s = bars.value[id]?.status
    if (s === 'publishedWithDraft') return 0
    if (s === 'draft') return 1
    return 2
  }
  const time = (id: string) => bars.value[id]?.updateTime || bars.value[id]?.createTime || 0
  return [...list].sort((a, b) => rank(a.id) - rank(b.id) || time(b.id) - time(a.id) || a.name.localeCompare(b.name, 'zh'))
})

const { page, pageCount, pageNumbers, paged, rangeLabel, pageSize, resetPage, goPage } = useCatalogPage(filtered)

watch([search, statusFilter, updaterFilter, timeFrom, timeTo], resetPage)

function statusLabel(s?: string) {
  if (s === 'published') return '已发布'
  if (s === 'publishedWithDraft') return '有改动'
  return '草稿'
}

function statusClass(s?: string) {
  if (s === 'published') return 'pub'
  if (s === 'publishedWithDraft') return 'dirty'
  return 'draft'
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

function updaterOf(id: string) {
  const b = bars.value[id]
  return b?.updateBy || b?.createBy || '—'
}

function updatedAt(id: string) {
  const b = bars.value[id]
  return formatStamp(b?.updateTime || b?.createTime)
}

function createdAt(id: string) {
  return formatStamp(bars.value[id]?.createTime)
}

async function hydrateBars(ids: string[]) {
  const missing = ids.filter((id) => !bars.value[id])
  if (!missing.length) return
  const results = await Promise.all(
    missing.map((id) => dashboardTreeApi.barInfo(id).catch(() => null))
  )
  const next = { ...bars.value }
  results.forEach((b, i) => {
    if (b) next[missing[i]] = b
  })
  bars.value = next
}

async function load() {
  error.value = ''
  try {
    tree.value = await dashboardTreeApi.tree({})
    await hydrateBars(flat.value.map((n) => n.id))
    const routeId = typeof route.params.id === 'string' ? route.params.id : null
    if (routeId && flat.value.some((n) => n.id === routeId) && !String(route.path).endsWith('/edit')) {
      await router.replace(`/dashboards/${routeId}/edit`)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function openCreateModal() {
  await router.push({ name: 'dashboard-templates' })
}

function pickTemplate(id: string) {
  selectedTemplateId.value = id
  const tpl = templates.value.find((t) => t.id === id)
  if (tpl && tpl.id !== 'blank' && !createName.value.trim()) {
    createName.value = tpl.name
  }
}

function closeCreateModal() {
  if (creating.value) return
  showTemplateModal.value = false
}

async function confirmCreate() {
  const templateId = selectedTemplateId.value || 'blank'
  const tpl = templates.value.find((t) => t.id === templateId)
  const name =
    createName.value.trim() ||
    (templateId === 'blank'
      ? `仪表盘 ${new Date().toLocaleString('zh-CN')}`
      : tpl?.name || '未命名仪表盘')
  creating.value = true
  error.value = ''
  try {
    const node = await dashboardTreeApi.create({
      pid: '0',
      name,
      nodeType: 'dashboard',
      templateId
    })
    showTemplateModal.value = false
    await load()
    router.push(`/dashboards/${node.id}/edit`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

function openEditor(id: string) {
  router.push(`/dashboards/${id}/edit`)
}

function showNotice(msg: string) {
  notice.value = msg
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 3200)
}

function needsPublish(id: string) {
  const s = bars.value[id]?.status || 'draft'
  return s === 'draft' || s === 'publishedWithDraft'
}

function openPreview(id: string) {
  if ((bars.value[id]?.status || 'draft') === 'draft') {
    showNotice('当前是草稿，请先点「发布」后再预览已发布版')
    return
  }
  router.push(`/dashboards/${id}/preview`)
}

async function publishDash(id: string) {
  if (publishing.value || !needsPublish(id)) return
  publishing.value = id
  error.value = ''
  try {
    const st = await dashboardApi.publish(id)
    const prev = bars.value[id]
    if (prev) {
      bars.value = { ...bars.value, [id]: { ...prev, status: st.status } }
    }
    showNotice('已发布')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    publishing.value = null
  }
}

async function removeDash(id: string, name: string) {
  if (deleting.value) return
  if (!window.confirm(`确定删除仪表盘「${name}」？此操作不可恢复。`)) return
  deleting.value = id
  error.value = ''
  try {
    await dashboardTreeApi.delete(id)
    delete bars.value[id]
    tree.value = await dashboardTreeApi.tree({})
    await hydrateBars(flat.value.map((n) => n.id))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    deleting.value = null
  }
}

onMounted(load)

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string' && id && flat.value.some((n) => n.id === id)) {
      void router.replace(`/dashboards/${id}/edit`)
    }
  }
)
</script>

<template>
  <div class="page">
    <p v-if="error" class="banner-err">{{ error }}</p>
    <p v-if="notice" class="banner-warn">{{ notice }}</p>

    <section class="panel">
      <header class="toolbar">
        <div class="filters">
          <label class="filter">
            <span>状态</span>
            <select v-model="statusFilter">
              <option value="all">全部</option>
              <option value="draft">草稿</option>
              <option value="publishedWithDraft">有改动</option>
              <option value="published">已发布</option>
            </select>
          </label>
          <label class="filter">
            <span>更新人</span>
            <select v-model="updaterFilter">
              <option value="all">全部</option>
              <option v-for="u in updaters" :key="u" :value="u">{{ u }}</option>
            </select>
          </label>
          <label class="filter range">
            <span>更新时间</span>
            <input v-model="timeFrom" type="date" :max="timeTo || undefined" />
            <i>—</i>
            <input v-model="timeTo" type="date" :min="timeFrom || undefined" />
            <button
              v-if="timeFrom || timeTo"
              type="button"
              class="clear"
              title="清除时间"
              @click="clearTimeRange"
            >
              ×
            </button>
          </label>
          <label class="filter search">
            <input v-model="search" type="search" placeholder="搜索名称" />
          </label>
        </div>
        <button type="button" class="btn primary" :disabled="creating" @click="openCreateModal">
          新建
        </button>
      </header>

      <div class="table-scroll">
        <table class="catalog-table">
          <thead>
            <tr>
              <th class="col-name">名称</th>
              <th class="col-tight">状态</th>
              <th class="col-tight">图表</th>
              <th class="col-tight">更新人</th>
              <th class="col-tight">更新时间</th>
              <th class="col-tight">创建时间</th>
              <th class="acts">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in paged" :key="n.id" @click="openEditor(n.id)">
              <td class="col-name">
                <span class="name-link">{{ n.name }}</span>
              </td>
              <td class="col-tight">
                <span class="pill" :class="statusClass(bars[n.id]?.status)">
                  {{ statusLabel(bars[n.id]?.status) }}
                </span>
              </td>
              <td class="col-tight">{{ bars[n.id]?.chartCount ?? '—' }}</td>
              <td class="col-tight muted">{{ updaterOf(n.id) }}</td>
              <td class="col-tight muted">{{ updatedAt(n.id) }}</td>
              <td class="col-tight muted">{{ createdAt(n.id) }}</td>
              <td class="acts" @click.stop>
                <div class="row-acts">
                  <button type="button" class="act-btn" @click="openEditor(n.id)">打开</button>
                  <button
                    v-if="needsPublish(n.id)"
                    type="button"
                    class="act-btn"
                    :disabled="publishing === n.id"
                    @click="publishDash(n.id)"
                  >
                    {{ publishing === n.id ? '发布中' : '发布' }}
                  </button>
                  <button
                    type="button"
                    class="act-btn"
                    :title="
                      (bars[n.id]?.status || 'draft') === 'draft'
                        ? '草稿尚未发布，请先发布'
                        : '打开已发布只读预览'
                    "
                    @click="openPreview(n.id)"
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    class="act-btn danger"
                    :disabled="deleting === n.id"
                    @click="removeDash(n.id, n.name)"
                  >
                    {{ deleting === n.id ? '删除中' : '删除' }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="7" class="empty-cell">
                <template v-if="hasActiveFilter">没有符合筛选的仪表盘</template>
                <template v-else>
                  还没有仪表盘
                  <button type="button" class="btn primary sm" @click="openCreateModal">新建</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="filtered.length" class="pager">
        <span class="pager-info">共 {{ filtered.length }} 条</span>
        <div class="pager-btns">
          <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <template v-for="(n, i) in pageNumbers" :key="n">
            <span v-if="i > 0 && n - pageNumbers[i - 1] > 1" class="ellipsis">…</span>
            <button type="button" :class="{ on: n === page }" @click="goPage(n)">{{ n }}</button>
          </template>
          <button type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
        </div>
      </footer>
    </section>

    <div
      v-if="showTemplateModal"
      class="modal-mask"
      @click.self="closeCreateModal"
    >
      <div class="modal" role="dialog" aria-label="新建仪表盘">
        <h3>新建仪表盘</h3>
        <p class="modal-sub">选择模版或空白画布</p>
        <label class="field">
          名称
          <input v-model="createName" placeholder="可选，默认用模版名或时间戳" />
        </label>
        <p v-if="templateError" class="banner-err inline">{{ templateError }}</p>
        <p v-if="loadingTemplates" class="muted">加载模版…</p>
        <div v-else class="tpl-grid">
          <button
            v-for="t in templates"
            :key="t.id"
            type="button"
            class="tpl"
            :class="{ on: selectedTemplateId === t.id }"
            @click="pickTemplate(t.id)"
          >
            <b>{{ t.name }}</b>
            <span>{{ t.description || t.domain }}</span>
          </button>
        </div>
        <div class="modal-acts">
          <button type="button" class="btn" :disabled="creating" @click="closeCreateModal">取消</button>
          <button type="button" class="btn primary" :disabled="creating" @click="confirmCreate">
            {{ creating ? '创建中…' : '创建并编辑' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  --primary: var(--od-brand, #4f46e5);
  --ink: var(--od-ink, #111827);
  --muted: var(--od-muted, #6b7280);
  --line: var(--od-line, #e5e7eb);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 16px;
  box-sizing: border-box;
  background: var(--od-bg, #f5f6fa);
  color: var(--ink);
}
.banner-err {
  margin: 0 0 8px;
  padding: 0.45rem 0.85rem;
  background: #fff2f0;
  color: #b42318;
  font-size: 0.82rem;
  border-radius: 8px;
}
.banner-warn {
  margin: 0 0 8px;
  padding: 0.45rem 0.85rem;
  background: #fff7e6;
  color: #ad6800;
  font-size: 0.82rem;
  border-radius: 8px;
}
.banner-err.inline {
  border: 0;
  border-radius: 6px;
  margin-bottom: 0.5rem;
}
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}
.filters {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.filter {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.filter > span {
  flex-shrink: 0;
}
.filter select,
.filter input[type='search'] {
  min-width: 0;
  height: 30px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  outline: none;
}
.filter select {
  cursor: pointer;
}
.filter.search {
  flex: 1;
  min-width: 180px;
  max-width: 280px;
}
.filter.search input {
  width: 100%;
}
.filter.range {
  padding-right: 6px;
}
.filter.range input[type='date'] {
  width: 122px;
  height: 30px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  outline: none;
}
.filter.range i {
  color: #c0c4cc;
  font-style: normal;
}
.filter .clear {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #9ca3af;
  font-size: 16px;
  line-height: 20px;
  cursor: pointer;
}
.filter .clear:hover {
  background: #f3f4f6;
  color: #374151;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 14px;
  border: 1px solid #e5e7eb;
  background: #fff;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  color: var(--ink);
  white-space: nowrap;
  flex-shrink: 0;
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
.btn.sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.table-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.catalog-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: #fff;
  font-size: 13px;
}
.catalog-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #8b95a5;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
}
.catalog-table td {
  padding: 11px 16px;
  border-bottom: 1px solid #f5f6f8;
  vertical-align: middle;
}
.catalog-table tbody tr:last-child td {
  border-bottom: 0;
}
.catalog-table tbody tr {
  cursor: pointer;
}
.catalog-table tbody tr:hover {
  background: #f7f8fa;
}
.name-link {
  font-weight: 600;
  color: var(--ink);
}
.catalog-table tbody tr:hover .name-link {
  color: var(--primary);
}
.catalog-table td.muted {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.catalog-table th.acts,
.catalog-table td.acts {
  width: 220px;
  text-align: right;
  white-space: nowrap;
  padding-right: 12px;
}
.row-acts {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}
.act-btn {
  position: relative;
  height: 24px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  line-height: 24px;
  cursor: pointer;
  white-space: nowrap;
}
.act-btn + .act-btn::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: #eceef2;
}
.act-btn:hover {
  color: #3730a3;
}
.act-btn.danger {
  color: #9ca3af;
}
.act-btn.danger:hover:not(:disabled) {
  color: #dc2626;
}
.act-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.catalog-table .empty-cell {
  text-align: center;
  color: var(--muted);
  padding: 80px 16px;
  cursor: default;
}
.catalog-table .empty-cell .btn {
  display: inline-flex;
  margin-left: 8px;
  vertical-align: middle;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 48px;
  padding: 0 16px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
  flex-shrink: 0;
}
.pager-info {
  color: var(--muted);
  font-size: 13px;
}
.pager-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pager-btns button {
  height: 28px;
  min-width: 28px;
  padding: 0 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
}
.pager-btns button:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.pager-btns button.on {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.pager-btns button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager .ellipsis {
  width: 20px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}
.pill {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: var(--od-bg, #f6f7fb);
  color: var(--muted);
}
.pill.pub {
  background: #e6fffb;
  color: #08979c;
}
.pill.dirty {
  background: #fff7e6;
  color: #d48806;
}
.drawer {
  border-left: 1px solid var(--line);
  background: #fff;
  padding: 18px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.drawer-hd {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.drawer-hd h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.meta-line {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}
.drawer-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.panel-hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}
.panel-hd h3 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: #4e5969;
}
.hint {
  font-size: 0.72rem;
  color: var(--muted);
}
.empty-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.65rem;
  color: #5c6b7a;
  font-size: 0.88rem;
  padding: 0.5rem 0;
}
.empty-box p {
  margin: 0;
}
.chart-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.chart-list li {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  gap: 0.65rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid #f0f2f5;
}
.chart-list li:last-child {
  border-bottom: 0;
}
.ctype {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--primary);
  background: var(--od-brand-soft, #eef2ff);
  border-radius: 4px;
  padding: 0.15rem 0.35rem;
  text-align: center;
}
.ctitle {
  font-size: 0.86rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmeta {
  font-size: 0.7rem;
  color: var(--muted);
}
.muted {
  color: var(--muted);
}
.pad {
  padding: 1.2rem;
  text-align: center;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 17, 21, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 80;
}
.modal {
  background: #fff;
  border-radius: 12px;
  padding: 18px;
  width: min(520px, calc(100vw - 24px));
  max-height: 80vh;
  overflow: auto;
}
.modal h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.modal-sub {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 12px;
}
.field input {
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--ink);
}
.tpl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.tpl {
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
  cursor: pointer;
}
.tpl.on {
  border-color: var(--primary);
  background: var(--od-brand-soft, #eef2ff);
}
.tpl b {
  display: block;
  font-size: 13px;
}
.tpl span {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.modal-acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 960px) {
  .catalog-body.with-drawer {
    grid-template-columns: 1fr;
  }
  .drawer {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
</style>

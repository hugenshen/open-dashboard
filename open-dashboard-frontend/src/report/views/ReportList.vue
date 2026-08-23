<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { reportApi } from '../api/report'
import { formatUpdateTime } from '../utils/chartDoc'
import type { ReportMetaVO } from '../types'
import '../../shell/catalog.css'
import { useCatalogPage } from '../../shell/useCatalogPage'

const route = useRoute()
const router = useRouter()
const items = ref<ReportMetaVO[]>([])
const search = ref('')
const statusFilter = ref<'all' | 'draft' | 'publishedWithDraft' | 'published'>('all')
const timeFilter = ref<'all' | 'today' | '7d' | '30d'>('all')
const error = ref('')
const creating = ref(false)

function matchTime(t?: number) {
  if (timeFilter.value === 'all') return true
  if (!t) return false
  if (timeFilter.value === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return t >= start.getTime()
  }
  const days = timeFilter.value === '7d' ? 7 : 30
  return t >= Date.now() - days * 86400000
}

const hasActiveFilter = computed(
  () => !!search.value.trim() || statusFilter.value !== 'all' || timeFilter.value !== 'all'
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = items.value.filter((r) => {
    if (statusFilter.value !== 'all' && r.status !== statusFilter.value) return false
    if (!matchTime(r.updateTime)) return false
    if (q && !r.name.toLowerCase().includes(q)) return false
    return true
  })
  const rank = (s: string) => (s === 'publishedWithDraft' ? 0 : s === 'draft' ? 1 : 2)
  return [...list].sort(
    (a, b) => rank(a.status) - rank(b.status) || (b.updateTime || 0) - (a.updateTime || 0) || a.name.localeCompare(b.name, 'zh')
  )
})

const { page, pageCount, pageNumbers, paged, rangeLabel, pageSize, resetPage, goPage } = useCatalogPage(filtered)

watch([search, statusFilter, timeFilter], resetPage)

function statusLabel(status: string) {
  if (status === 'published') return '已发布'
  if (status === 'publishedWithDraft') return '有改动'
  return '草稿'
}

function statusClass(status: string) {
  if (status === 'published') return 'pub'
  if (status === 'publishedWithDraft') return 'dirty'
  return 'draft'
}

async function load() {
  error.value = ''
  try {
    items.value = await reportApi.list()
    const routeId = typeof route.params.id === 'string' ? route.params.id : null
    if (routeId && items.value.some((r) => r.id === routeId) && !String(route.path).endsWith('/edit')) {
      await router.replace(`/reports/${routeId}/edit`)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function create() {
  creating.value = true
  try {
    const detail = await reportApi.create(`报告 ${new Date().toLocaleString('zh-CN')}`)
    await load()
    router.push(`/reports/${detail.meta.id}/edit`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

function openEditor(id: string) {
  router.push(`/reports/${id}/edit`)
}

function openPreview(id: string) {
  router.push(`/reports/${id}/preview`)
}

onMounted(load)

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string' && id && items.value.some((r) => r.id === id)) {
      void router.replace(`/reports/${id}/edit`)
    }
  }
)
</script>

<template>
  <div class="page">
    <p v-if="error" class="banner-err">{{ error }}</p>

    <div class="catalog-bar">
      <div class="title-block">
        <h1>报告</h1>
        <span>{{ filtered.length }} / {{ items.length }} 份 · 点名称打开</span>
      </div>
      <div class="field-filters">
        <label class="field-filter">
          <span>状态</span>
          <select v-model="statusFilter">
            <option value="all">全部</option>
            <option value="draft">草稿</option>
            <option value="publishedWithDraft">有改动</option>
            <option value="published">已发布</option>
          </select>
        </label>
        <label class="field-filter">
          <span>更新时间</span>
          <select v-model="timeFilter">
            <option value="all">全部</option>
            <option value="today">今天</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select>
        </label>
        <label class="field-filter search-filter">
          <span>搜索</span>
          <input v-model="search" type="search" placeholder="名称…" />
        </label>
      </div>
      <button type="button" class="btn primary" :disabled="creating" @click="create">
        {{ creating ? '创建中…' : '+ 新建报告' }}
      </button>
    </div>

    <div class="catalog-body">
      <div class="table-wrap">
        <table class="catalog-table">
          <thead>
            <tr>
              <th class="col-name">名称</th>
              <th class="col-tight">状态</th>
              <th class="col-tight">版本</th>
              <th class="col-tight">更新时间</th>
              <th class="acts">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paged" :key="r.id" @click="openEditor(r.id)">
              <td class="col-name"><span class="name-link">{{ r.name }}</span></td>
              <td class="col-tight">
                <span class="pill" :class="statusClass(r.status)">{{ statusLabel(r.status) }}</span>
              </td>
              <td class="col-tight muted">v{{ r.version ?? '—' }}</td>
              <td class="col-tight muted">{{ formatUpdateTime(r.updateTime) }}</td>
              <td class="acts" @click.stop>
                <div class="row-acts">
                  <button type="button" class="text-btn" @click="openEditor(r.id)">打开</button>
                  <button type="button" class="text-btn" @click="openPreview(r.id)">预览</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="5" class="empty-cell">
                <template v-if="hasActiveFilter">无匹配报告</template>
                <template v-else>
                  还没有报告
                  <button type="button" class="btn primary sm" :disabled="creating" @click="create">新建第一份</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="filtered.length" class="catalog-pager">
        <span class="pager-info">第 {{ rangeLabel }} 条，共 {{ filtered.length }} 条 · 每页 {{ pageSize }} 条</span>
        <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button
          v-for="n in pageNumbers"
          :key="n"
          type="button"
          :class="{ on: n === page }"
          @click="goPage(n)"
        >
          {{ n }}
        </button>
        <button type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
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
.search {
  width: min(280px, 40vw);
  height: 34px;
  padding: 0 0.7rem;
  border: 1px solid #d8dee6;
  border-radius: 8px;
  font-size: 0.82rem;
  background: #fff;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #d0d5dd;
  background: #fff;
  border-radius: 8px;
  font-size: 12.5px;
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
.btn.sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.catalog-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr;
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
.catalog-table tbody tr:last-child td {
  border-bottom: 0;
}
.catalog-table tbody tr {
  cursor: pointer;
}
.catalog-table tbody tr:hover {
  background: #f7f9ff;
}
.catalog-table td b {
  font-weight: 650;
}
.catalog-table td.muted {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.catalog-table td.acts {
  text-align: right;
  white-space: nowrap;
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
</style>

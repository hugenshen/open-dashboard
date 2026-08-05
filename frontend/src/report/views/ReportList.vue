<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ModuleTopbar from '../../shell/ModuleTopbar.vue'
import { reportApi } from '../api/report'
import { countReportCharts, formatUpdateTime, inferReportFolder } from '../utils/chartDoc'
import type { ReportDetailVO, ReportMetaVO } from '../types'

const route = useRoute()
const router = useRouter()
const items = ref<ReportMetaVO[]>([])
const selectedId = ref<string | null>(null)
const selectedDetail = ref<ReportDetailVO | null>(null)
const search = ref('')
const folderFilter = ref('全部')
const error = ref('')
const creating = ref(false)
const loadingDetail = ref(false)

const folders = computed(() => {
  const map = new Map<string, number>()
  for (const r of items.value) {
    const f = inferReportFolder(r.name)
    map.set(f, (map.get(f) || 0) + 1)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count }))
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter((r) => {
    if (folderFilter.value !== '全部' && inferReportFolder(r.name) !== folderFilter.value) {
      return false
    }
    if (q && !r.name.toLowerCase().includes(q)) return false
    return true
  })
})

const stats = computed(() => {
  if (!selectedDetail.value) return null
  return countReportCharts(selectedDetail.value.content)
})

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
    const id =
      (routeId && items.value.some((r) => r.id === routeId) ? routeId : null) ||
      selectedId.value ||
      items.value[0]?.id
    if (id) await selectReport(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function selectReport(id: string) {
  selectedId.value = id
  router.replace(`/reports/${id}`)
  loadingDetail.value = true
  try {
    selectedDetail.value = await reportApi.get(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingDetail.value = false
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

function openEditor(id?: string) {
  router.push(`/reports/${id || selectedId.value || '1'}/edit`)
}

onMounted(load)

watch(filtered, (list) => {
  if (selectedId.value && list.some((r) => r.id === selectedId.value)) return
  if (list.length) selectReport(list[0].id)
  else {
    selectedId.value = null
    selectedDetail.value = null
  }
})
</script>

<template>
  <div class="page">
    <ModuleTopbar module="reports" />
    <p v-if="error" class="banner-err">{{ error }}</p>

    <div class="layout">
      <aside class="rail">
        <div class="rail-top">
          <div class="rail-title">
            <h1>报告</h1>
            <span>{{ items.length }}</span>
          </div>
          <button type="button" class="btn primary block" :disabled="creating" @click="create">
            {{ creating ? '创建中…' : '新建报告' }}
          </button>
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
            v-for="r in filtered"
            :key="r.id"
            type="button"
            class="item"
            :class="{ on: selectedId === r.id }"
            @click="selectReport(r.id)"
            @dblclick="openEditor(r.id)"
          >
            <span class="item-name">{{ r.name }}</span>
            <span class="item-sub">
              {{ inferReportFolder(r.name) }} · {{ statusLabel(r.status) }}
            </span>
          </button>
          <div v-if="!filtered.length" class="muted pad">无匹配报告</div>
        </div>
      </aside>

      <section v-if="selectedDetail && !loadingDetail" class="main">
        <header class="head">
          <div class="head-left">
            <div class="title-row">
              <h2>{{ selectedDetail.meta.name }}</h2>
              <span class="pill" :class="statusClass(selectedDetail.meta.status)">
                {{ statusLabel(selectedDetail.meta.status) }}
              </span>
            </div>
            <p class="meta-line">
              <span v-if="stats">{{ stats.total }} 图表 · {{ stats.dashboard }} 引用 · {{ stats.inline }} 新建</span>
              <span v-if="stats" class="sep">·</span>
              <span>{{ formatUpdateTime(selectedDetail.meta.updateTime) }}</span>
            </p>
          </div>
          <div class="head-acts">
            <button type="button" class="btn primary sm" @click="openEditor()">编辑</button>
          </div>
        </header>

        <div class="work">
          <div class="panel pad">
            <p class="lineage">
              在线报告文档
              <span class="arrow">·</span>
              图表实时取数
              <span class="arrow">·</span>
              配置存于文档节点
            </p>
            <p class="muted tiny">
              双击左侧列表或点「编辑」进入编辑器。可引用仪表盘图表，也可新建仅属于本报告的图表。
            </p>
          </div>
        </div>
      </section>

      <section v-else class="main empty-main">
        <div class="muted pad">{{ loadingDetail ? '加载中…' : '选择左侧报告，或新建一个' }}</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  --primary: #3370ff;
  --ink: #1a2332;
  --muted: #86909c;
  --line: rgba(0, 0, 0, 0.08);
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f4f5f7;
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
  background: #e8f0ff;
  color: var(--primary);
  font-weight: 600;
}
.rail-list {
  flex: 1;
  overflow: auto;
  padding: 0.4rem;
}
.item {
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
.item:hover {
  background: #f5f7fa;
}
.item.on {
  background: #eef4ff;
}
.item-name {
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-sub {
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
  background: #f4f5f7;
  color: #86909c;
}
.pill.pub {
  background: #e6fffb;
  color: #08979c;
}
.pill.dirty {
  background: #fff7e6;
  color: #d48806;
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
}
.panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.panel.pad {
  padding: 0.9rem 1rem;
}
.lineage {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.6;
}
.lineage .arrow {
  margin: 0 0.25rem;
  color: var(--muted);
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
</style>

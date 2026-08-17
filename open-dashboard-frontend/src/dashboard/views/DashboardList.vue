<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dashboardApi, dashboardTreeApi } from '../../api/dashboard'
import type {
  DashboardBarVO,
  DashboardDetailVO,
  DashboardTemplateVO,
  BusiNodeVO
} from '../../types/dashboard'

const route = useRoute()
const router = useRouter()

const tree = ref<BusiNodeVO[]>([])
const selectedId = ref<string | null>(null)
const bar = ref<DashboardBarVO | null>(null)
const detail = ref<DashboardDetailVO | null>(null)
const search = ref('')
const error = ref('')
const creating = ref(false)
const deleting = ref(false)
const loadingDetail = ref(false)
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

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return flat.value.filter((n) => !q || n.name.toLowerCase().includes(q))
})

const chartList = computed(() => {
  if (!detail.value) return []
  return Object.values(detail.value.charts || {}).map((ch) => ({
    id: ch.id,
    title: ch.title || '未命名图表',
    type: ch.chartType || '—',
    datasetId: ch.datasetId
  }))
})

const layoutHint = computed(() => {
  const comps = detail.value?.components || []
  const charts = comps.filter((c) => c.type === 'chart').length
  const others = comps.length - charts
  if (!comps.length) return '画布为空'
  return `${comps.length} 组件 · ${charts} 图表${others > 0 ? ` · ${others} 其它` : ''}`
})

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

function typeLabel(t: string) {
  const map: Record<string, string> = {
    bar: '柱状图',
    hbar: '条形图',
    line: '折线图',
    area: '面积图',
    pie: '饼图',
    kpi: '指标卡',
    table: '明细表',
    grouptable: '汇总表',
    pivot: '透视表'
  }
  return map[t] || t
}

async function load() {
  error.value = ''
  try {
    tree.value = await dashboardTreeApi.tree({})
    const routeId = typeof route.params.id === 'string' ? route.params.id : null
    const id = routeId || selectedId.value || filtered.value[0]?.id
    if (id) await selectDash(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function selectDash(id: string) {
  selectedId.value = id
  router.replace(`/dashboards/${id}`)
  loadingDetail.value = true
  detail.value = null
  try {
    bar.value = await dashboardTreeApi.barInfo(id)
    try {
      detail.value = await dashboardApi.get(id, 'draft')
    } catch {
      try {
        detail.value = await dashboardApi.get(id, 'published')
      } catch {
        detail.value = null
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingDetail.value = false
  }
}

async function openCreateModal() {
  showTemplateModal.value = true
  selectedTemplateId.value = 'blank'
  createName.value = ''
  templateError.value = ''
  if (templates.value.length) return
  loadingTemplates.value = true
  try {
    templates.value = await dashboardApi.listTemplates()
    if (!templates.value.length) {
      templateError.value = '后端未返回仪表盘模版'
    }
  } catch (e) {
    templates.value = []
    templateError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingTemplates.value = false
  }
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

function openEditor(id?: string) {
  router.push(`/dashboards/${id || selectedId.value}/edit`)
}

function openPreview(id?: string) {
  router.push(`/dashboards/${id || selectedId.value}/preview`)
}

async function removeDash() {
  const id = selectedId.value
  if (!id || deleting.value) return
  const name = bar.value?.name || id
  if (!window.confirm(`确定删除仪表盘「${name}」？此操作不可恢复。`)) return
  deleting.value = true
  error.value = ''
  try {
    await dashboardTreeApi.delete(id)
    selectedId.value = null
    bar.value = null
    detail.value = null
    await router.replace('/dashboards')
    tree.value = await dashboardTreeApi.tree({})
    if (filtered.value.length) {
      await selectDash(filtered.value[0].id)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    deleting.value = false
  }
}

onMounted(load)

watch(filtered, (list) => {
  if (selectedId.value && list.some((n) => n.id === selectedId.value)) return
  if (list.length) selectDash(list[0].id)
  else {
    selectedId.value = null
    bar.value = null
    detail.value = null
  }
})
</script>

<template>
  <div class="page">
    <p v-if="error" class="banner-err">{{ error }}</p>

    <div class="layout">
      <aside class="rail">
        <div class="rail-top">
          <div class="rail-title">
            <h1>仪表盘</h1>
            <span>{{ flat.length }}</span>
          </div>
          <button type="button" class="btn primary block" :disabled="creating" @click="openCreateModal">
            新建仪表盘
          </button>
          <input v-model="search" class="search" placeholder="搜索名称…" />
        </div>

        <div class="rail-list">
          <button
            v-for="n in filtered"
            :key="n.id"
            type="button"
            class="item"
            :class="{ on: selectedId === n.id }"
            @click="selectDash(n.id)"
            @dblclick="openEditor(n.id)"
          >
            <span class="item-name">{{ n.name }}</span>
            <span class="item-sub">id {{ n.id }}</span>
          </button>
          <div v-if="!filtered.length" class="muted pad">暂无仪表盘</div>
        </div>
      </aside>

      <section v-if="bar && !loadingDetail" class="main">
        <header class="head">
          <div class="head-left">
            <div class="title-row">
              <h2>{{ bar.name }}</h2>
              <span class="pill" :class="statusClass(bar.status)">{{ statusLabel(bar.status) }}</span>
            </div>
            <p class="meta-line">
              <span>{{ layoutHint }}</span>
              <span class="sep">·</span>
              <span>{{ bar.updateBy || bar.createBy || '—' }}</span>
              <span class="sep">·</span>
              <span>{{ bar.updateTime ? new Date(bar.updateTime).toLocaleString('zh-CN') : '—' }}</span>
            </p>
          </div>
          <div class="head-acts">
            <button type="button" class="btn sm" @click="openPreview()">预览</button>
            <button type="button" class="btn primary sm" @click="openEditor()">编辑</button>
            <button type="button" class="btn danger sm" :disabled="deleting" @click="removeDash">
              {{ deleting ? '删除中…' : '删除' }}
            </button>
          </div>
        </header>

        <div class="work">
          <div class="panel-hd">
            <h3>图表</h3>
            <span class="hint">双击左侧可打开编辑器</span>
          </div>

          <div v-if="!chartList.length" class="panel pad empty-box">
            <p>还没有图表</p>
            <button type="button" class="btn primary sm" @click="openEditor()">去编辑器添加</button>
          </div>

          <ul v-else class="chart-list panel">
            <li v-for="ch in chartList" :key="ch.id">
              <span class="ctype">{{ typeLabel(ch.type) }}</span>
              <span class="ctitle">{{ ch.title }}</span>
              <span class="cmeta">{{ ch.datasetId ? '已绑数据集' : '未绑数据' }}</span>
            </li>
          </ul>
        </div>
      </section>

      <section v-else class="main empty-main">
        <div class="muted pad">{{ loadingDetail ? '加载中…' : '选择左侧仪表盘，或新建一个' }}</div>
      </section>
    </div>

    <div
      v-if="showTemplateModal"
      class="modal-mask"
      role="dialog"
      aria-modal="true"
      aria-label="选择仪表盘模版"
      @click.self="closeCreateModal"
    >
      <div class="modal">
        <header class="modal-hd">
          <div>
            <h3>新建仪表盘</h3>
            <p>选择业务领域模版，或从空白开始</p>
          </div>
          <button type="button" class="btn sm" :disabled="creating" @click="closeCreateModal">关闭</button>
        </header>

        <label class="name-field">
          <span>名称</span>
          <input
            v-model="createName"
            class="search"
            placeholder="可选，默认使用模版名"
            :disabled="creating"
          />
        </label>

        <div v-if="loadingTemplates" class="muted pad">加载模版…</div>
        <div v-else-if="templateError" class="muted pad" style="color:#f54a45">{{ templateError }}</div>
        <div v-else class="tpl-grid">
          <button
            v-for="t in templates"
            :key="t.id"
            type="button"
            class="tpl-card"
            :class="{ on: selectedTemplateId === t.id }"
            :disabled="creating"
            @click="pickTemplate(t.id)"
          >
            <span class="tpl-domain">{{ t.domain }}</span>
            <span class="tpl-name">{{ t.name }}</span>
            <span class="tpl-desc">{{ t.description }}</span>
          </button>
        </div>

        <footer class="modal-ft">
          <button type="button" class="btn" :disabled="creating" @click="closeCreateModal">取消</button>
          <button type="button" class="btn primary" :disabled="creating || !templates.length" @click="confirmCreate">
            {{ creating ? '创建中…' : '使用模版创建' }}
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
.btn.danger {
  color: #c62828;
  border-color: #f0c0c0;
  background: #fff5f5;
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
  background: var(--od-bg, #f6f7fb);
}
.item.on {
  background: var(--od-brand-soft, #eef2ff);
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
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
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
.panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.panel.pad {
  padding: 1.2rem;
}
.empty-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.65rem;
  color: #5c6b7a;
  font-size: 0.88rem;
}
.empty-box p {
  margin: 0;
}
.chart-list {
  list-style: none;
  margin: 0;
  padding: 0;
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
  font-size: 0.72rem;
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
  z-index: 80;
  background: rgba(15, 23, 42, 0.45);
  display: grid;
  place-items: center;
  padding: 1rem;
}
.modal {
  width: min(720px, 100%);
  max-height: min(86vh, 720px);
  overflow: auto;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.2);
  padding: 1rem 1.1rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.modal-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.modal-hd h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}
.modal-hd p {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.name-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: #4e5969;
  font-weight: 600;
}
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}
.tpl-card {
  text-align: left;
  border: 1px solid #d0d5dd;
  border-radius: 10px;
  background: #fff;
  padding: 0.75rem 0.85rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  color: var(--ink);
}
.tpl-card:hover:not(:disabled) {
  border-color: var(--primary);
}
.tpl-card.on {
  border-color: var(--primary);
  background: var(--od-brand-soft, #eef2ff);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.tpl-card:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.tpl-domain {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 0.02em;
}
.tpl-name {
  font-size: 0.92rem;
  font-weight: 700;
}
.tpl-desc {
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--muted);
}
.modal-ft {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.15rem;
  border-top: 1px solid var(--line);
}
@media (max-width: 640px) {
  .tpl-grid {
    grid-template-columns: 1fr;
  }
}
</style>

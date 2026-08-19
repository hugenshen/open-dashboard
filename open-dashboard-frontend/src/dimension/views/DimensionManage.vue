<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { datasetApi, datasourceApi, glossaryApi, type GlossaryItemVO } from '../../datasource/api'

const items = ref<GlossaryItemVO[]>([])
const datasets = ref<Array<{ id: string; name: string; tableName?: string; datasourceId?: string }>>([])
const sources = ref<Array<{ id: string; name: string }>>([])
const search = ref('')
const typeFilter = ref('dimension')
const statusFilter = ref('')
const loading = ref(false)
const error = ref('')
const toast = ref('')
const expanded = ref<Set<number>>(new Set())

// ── 值清洗（去掉工号尾巴/异常 token，保留业务可读部分；清洗后无意义才算噪声）──
/** 清洗单个值：去掉尾部工号数字、???、admin 前缀等技术 token，返回可读业务名。 */
function cleanValue(v: unknown): string {
  let s = String(v ?? '').trim()
  if (!s) return ''
  // JSON 对象/数组/超长值 → 噪声
  if (s.length > 60 || /\{[^}]*\}/.test(s) || /\[[^\]]*\]/.test(s) || /[<>]/.test(s)) return ''
  // 去掉尾部连续数字（工号）：张婉琴0668001373 → 张婉琴
  s = s.replace(/\d{6,}\s*$/, '').trim()
  // 去掉 ??? 异常占位及其后内容
  s = s.replace(/\?{2,}.*$/, '').trim()
  // 去掉 admin 技术账号前缀（adminv → ''）
  s = s.replace(/^\s*admin\w*/i, '').trim()
  // 清洗后为空 / 纯数字 / 太短无意义 → 噪声
  if (!s || /^\d+$/.test(s) || s.length < 2) return ''
  return s
}
/** 有效值（清洗后非空且去重） */
function cleanValues(v: unknown[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of v || []) {
    const c = cleanValue(x)
    if (c && !seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}
/** 全量原始值（未清洗，供「全部值」查看） */
const rawValues = (v: unknown[] | undefined): unknown[] => (v || [])

// ── 分页查看状态 ──
const viewer = ref<{ item: GlossaryItemVO; page: number; pageSize: number; showAll: boolean } | null>(null)
const PAGE_SIZE = 20

function openViewer(it: GlossaryItemVO, showAll: boolean) {
  viewer.value = { item: it, page: 1, pageSize: PAGE_SIZE, showAll }
}
function closeViewer() {
  viewer.value = null
}
const viewerValues = computed(() => {
  if (!viewer.value) return []
  const src = viewer.value.showAll ? rawValues(viewer.value.item.values) : cleanValues(viewer.value.item.values)
  const start = (viewer.value.page - 1) * viewer.value.pageSize
  return src.slice(start, start + viewer.value.pageSize)
})
const viewerTotal = computed(() => {
  if (!viewer.value) return 0
  return viewer.value.showAll ? rawValues(viewer.value.item.values).length : cleanValues(viewer.value.item.values).length
})
const viewerPages = computed(() => Math.max(1, Math.ceil(viewerTotal.value / PAGE_SIZE)))
function viewerGo(p: number) {
  if (viewer.value && p >= 1 && p <= viewerPages.value) viewer.value.page = p
}

const datasetName = (id?: string) => datasets.value.find((d) => d.id === id)?.name || id || '—'
const sourceName = (datasetId?: string) => {
  const ds = datasets.value.find((d) => d.id === datasetId)
  if (!ds?.datasourceId) return ''
  return sources.value.find((s) => s.id === ds.datasourceId)?.name || ''
}

const filtered = computed(() => {
  let list = items.value
  if (typeFilter.value) list = list.filter((x) => x.type === typeFilter.value)
  if (statusFilter.value) list = list.filter((x) => x.status === statusFilter.value)
  const kw = search.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((x) => {
      const vals = (x.values || []).map((v) => String(v).toLowerCase()).join(' ')
      return (
        (x.term || '').toLowerCase().includes(kw) ||
        (x.canonicalField || '').toLowerCase().includes(kw) ||
        datasetName(x.datasetId).toLowerCase().includes(kw) ||
        vals.includes(kw)
      )
    })
  }
  return list
})

const dims = computed(() => filtered.value.filter((x) => x.type === 'dimension'))
const metrics = computed(() => filtered.value.filter((x) => x.type !== 'dimension'))
const totalValues = computed(() => items.value.reduce((n, x) => n + (x.values || []).length, 0))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [g, ds, src] = await Promise.all([
      glossaryApi.list(typeFilter.value || undefined, statusFilter.value || undefined),
      datasetApi.list(),
      datasourceApi.list()
    ])
    items.value = g
    datasets.value = ds
    sources.value = src
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggleExpand(id: number) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}

async function confirm(it: GlossaryItemVO) {
  try {
    await glossaryApi.confirm(it.id)
    toast.value = `已确认「${it.term}」`
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function remove(it: GlossaryItemVO) {
  if (!confirm(`删除「${it.term}」？`)) return
  try {
    await glossaryApi.remove(it.id)
    toast.value = '已删除'
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function statusLabel(s?: string) {
  const map: Record<string, string> = { candidate: '候选', confirmed: '已确认', merged: '已合并', deprecated: '已废弃' }
  return (s && map[s]) || s || '候选'
}

onMounted(load)
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
            <span>{{ items.length }}</span>
          </div>
          <input v-model="search" class="search" placeholder="搜索维度名 / 字段 / 数据集 / 值…" />
          <div class="filters">
            <button
              type="button"
              class="filter"
              :class="{ on: typeFilter === 'dimension' }"
              @click="typeFilter = 'dimension'; load()"
            >
              维度
            </button>
            <button
              type="button"
              class="filter"
              :class="{ on: typeFilter === '' }"
              @click="typeFilter = ''; load()"
            >
              全部
            </button>
          </div>
          <div class="filters" style="margin-top: 6px">
            <button
              type="button"
              class="filter"
              :class="{ on: statusFilter === '' }"
              @click="statusFilter = ''; load()"
            >
              全部状态
            </button>
            <button
              type="button"
              class="filter"
              :class="{ on: statusFilter === 'candidate' }"
              @click="statusFilter = 'candidate'; load()"
            >
              候选
            </button>
            <button
              type="button"
              class="filter"
              :class="{ on: statusFilter === 'confirmed' }"
              @click="statusFilter = 'confirmed'; load()"
            >
              已确认
            </button>
          </div>
          <div class="rail-stat muted">
            共 {{ dims.length }} 个维度 · {{ totalValues }} 个维度值
          </div>
        </div>
        <div v-if="loading" class="muted pad">加载中…</div>
        <div v-else-if="!dims.length" class="muted pad">暂无匹配维度</div>
        <div v-else class="rail-list">
          <button
            v-for="d in dims"
            :key="d.id"
            type="button"
            class="ds"
            :class="{ on: expanded.has(d.id) }"
            @click="toggleExpand(d.id)"
          >
            <span class="ds-name">{{ d.term }}</span>
            <span class="ds-sub">
              {{ datasetName(d.datasetId) }} · {{ (d.values || []).length }} 值
            </span>
          </button>
        </div>
      </aside>

      <section class="main">
        <header class="head">
          <div class="head-left">
            <div class="title-row">
              <h2>{{ typeFilter === 'dimension' ? '公共维度' : '全部词条' }}</h2>
              <span class="pill">{{ dims.length }} 个</span>
            </div>
            <p class="meta-line">
              <span>自学习抽取低基数业务维度</span>
              <span class="sep">·</span>
              <span>候选需人工确认后进入生成</span>
            </p>
          </div>
        </header>

        <div class="work">
          <div v-if="loading" class="muted pad">加载中…</div>
          <div v-else-if="!dims.length" class="muted pad">暂无维度。上传/学习数据集后，低基数字段会自动抽取到这里。</div>

          <div v-else class="dims">
            <div v-for="d in dims" :key="d.id" class="dim-card" :class="d.status">
              <div class="dim-card-hd">
                <div class="dim-title">
                  <b>{{ d.term }}</b>
                  <span class="tag" :class="d.status">{{ statusLabel(d.status) }}</span>
                </div>
              </div>
              <div class="dim-card-meta">
                <code>{{ d.canonicalField }}</code>
                <span class="sep">·</span>
                <span class="ds-ref">{{ datasetName(d.datasetId) }}</span>
                <span v-if="sourceName(d.datasetId)" class="muted">（{{ sourceName(d.datasetId) }}）</span>
              </div>
              <div class="dim-card-ft">
                <button type="button" class="btn sm" @click="openViewer(d, false)">
                  查看值（{{ rawValues(d.values).length }}）
                </button>
                <button v-if="d.status !== 'confirmed'" type="button" class="btn sm" @click="confirm(d)">确认</button>
                <button type="button" class="btn sm danger" @click="remove(d)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 分页查看维度值 -->
    <div v-if="viewer" class="vdialog" role="dialog">
      <div class="vdialog-box">
        <div class="vdialog-hd">
          <div>
            <b>{{ viewer.item.term }}</b>
            <span class="muted"> · {{ viewer.item.canonicalField }} · {{ datasetName(viewer.item.datasetId) }}</span>
          </div>
          <button type="button" class="btn sm" @click="closeViewer">✕</button>
        </div>
        <div class="vdialog-tabs">
          <button
            type="button"
            class="filter"
            :class="{ on: !viewer.showAll }"
            @click="viewer.showAll = false; viewer.page = 1"
          >
            有效值（{{ cleanValues(viewer.item.values).length }}）
          </button>
          <button
            type="button"
            class="filter"
            :class="{ on: viewer.showAll }"
            @click="viewer.showAll = true; viewer.page = 1"
          >
            全部值（{{ rawValues(viewer.item.values).length }}）
          </button>
        </div>
        <div class="vdialog-list">
          <div v-if="!viewerValues.length" class="muted pad">无值</div>
          <div v-for="(v, i) in viewerValues" :key="i" class="vrow">
            <span class="v-idx">{{ (viewer.page - 1) * viewer.pageSize + i + 1 }}</span>
            <code>{{ v }}</code>
          </div>
        </div>
        <div class="vdialog-ft">
          <button type="button" class="btn sm" :disabled="viewer.page <= 1" @click="viewerGo(viewer.page - 1)">上一页</button>
          <span class="muted">{{ viewer.page }} / {{ viewerPages }}</span>
          <button type="button" class="btn sm" :disabled="viewer.page >= viewerPages" @click="viewerGo(viewer.page + 1)">下一页</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100%;
  background: var(--od-bg, #f6f7fb);
  padding: 20px;
  display: flex;
  flex-direction: column;
}
.banner-err {
  background: #fff1f0;
  color: #cf1322;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
}
.banner-ok {
  background: #f6ffed;
  color: #389e0d;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
}
.layout {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}
.rail {
  width: 300px;
  flex-shrink: 0;
  background: var(--od-card, #fff);
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rail-top {
  padding: 16px;
  border-bottom: 1px solid var(--od-line, #dfe3ea);
}
.rail-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}
.rail-title h1 {
  margin: 0;
  font-size: 18px;
  color: var(--od-ink, #111827);
}
.rail-title span {
  font-size: 12px;
  color: var(--od-faint, #6b7280);
}
.search {
  width: 100%;
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--od-line-2, #e5e7eb);
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
  color: var(--od-ink, #111827);
  outline: 0;
}
.search:focus {
  border-color: var(--od-brand, #4f46e5);
  box-shadow: 0 0 0 3px var(--od-brand-soft, #eef2ff);
}
.filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.filter {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 999px;
  background: #fff;
  font-size: 12px;
  color: var(--od-muted, #4b5563);
  cursor: pointer;
}
.filter.on {
  background: var(--od-brand-soft, #eef2ff);
  border-color: var(--od-brand, #4f46e5);
  color: var(--od-brand, #4f46e5);
  font-weight: 600;
}
.rail-stat {
  margin-top: 12px;
  font-size: 12px;
}
.rail-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
}
.ds {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ds:hover {
  background: var(--od-rail-hover, #f3f4f6);
}
.ds.on {
  background: var(--od-brand-soft, #eef2ff);
}
.ds-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--od-ink, #111827);
}
.ds-sub {
  font-size: 11.5px;
  color: var(--od-faint, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main {
  flex: 1;
  min-width: 0;
  background: var(--od-card, #fff);
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head {
  padding: 18px 20px;
  border-bottom: 1px solid var(--od-line, #dfe3ea);
}
.head-left h2 {
  margin: 0 0 6px;
  font-size: 19px;
  color: var(--od-ink, #111827);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.meta-line {
  margin: 0;
  font-size: 12.5px;
  color: var(--od-muted, #4b5563);
}
.sep {
  color: var(--od-line-2, #e5e7eb);
  margin: 0 4px;
}
.work {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
}
.pill {
  display: inline-block;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--od-brand-soft, #eef2ff);
  color: var(--od-brand, #4f46e5);
  font-weight: 600;
}
.dims {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dim-card {
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 12px;
  padding: 14px 16px;
  background: #fff;
}
.dim-card.confirmed {
  border-color: #b7eb8f;
  background: #fcfff8;
}
.dim-card-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dim-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dim-title b {
  font-size: 15px;
  color: var(--od-ink, #111827);
}
.dim-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 12px;
  font-size: 12px;
  color: var(--od-muted, #4b5563);
}
.dim-card-meta code {
  font-size: 12px;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--od-ink, #111827);
}
.ds-ref {
  color: var(--od-brand, #4f46e5);
}
.dim-card-ft {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: var(--od-ink, #111827);
}
.btn.sm {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}
.btn.danger {
  color: #cf1322;
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
}
.tag.candidate {
  background: #fff7e6;
  color: #d46b08;
}
.tag.confirmed {
  background: #f6ffed;
  color: #389e0d;
}
.tag.merged {
  background: #e6f4ff;
  color: #1677ff;
}
.muted {
  color: var(--od-faint, #6b7280);
  font-size: 12px;
}
.pad {
  padding: 12px 16px;
}
.vdialog {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
  display: grid;
  place-items: center;
  z-index: 100;
}
.vdialog-box {
  width: min(560px, 92vw);
  max-height: 80vh;
  background: #fff;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(17, 24, 39, 0.25);
}
.vdialog-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--od-line, #dfe3ea);
}
.vdialog-hd b {
  font-size: 15px;
  color: var(--od-ink, #111827);
}
.vdialog-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 18px 0;
}
.vdialog-list {
  flex: 1;
  overflow: auto;
  padding: 10px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12.5px;
}
.vrow:nth-child(odd) {
  background: #fafbfc;
}
.v-idx {
  flex-shrink: 0;
  width: 26px;
  text-align: right;
  color: var(--od-faint, #6b7280);
  font-size: 11px;
}
.vrow code {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  color: var(--od-ink, #111827);
}
.vdialog-ft {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 10px 18px 16px;
  border-top: 1px solid var(--od-line, #dfe3ea);
}
</style>

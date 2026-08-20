<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAuthBundle } from '../../api/http'
import { workspaceApi, type DataAssetVO, type DataPlazaVO } from '../../workspace/api'

type PlazaView = 'all' | 'askable' | 'requestable' | 'pending' | 'added'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const data = ref<DataPlazaVO | null>(null)
const keyword = ref('')
const activeSpace = ref('all')
const activeType = ref('all')
const activeView = ref<PlazaView>('all')
const displayMode = ref<'grid' | 'list'>('list')
const requestAsset = ref<DataAssetVO | null>(null)
const requestPurpose = ref('用于经营分析、日报追踪和异常复盘。')
const selectedIds = ref<string[]>([])
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const workspaceId = computed(() => data.value?.currentWorkspace.id || getAuthBundle().workspaceId)
const assets = computed(() => data.value?.assets || [])
const myData = computed(() => data.value?.myData || [])
const requests = computed(() => data.value?.requests || [])
const askableAssets = computed(() => assets.value.filter((asset) => asset.actions.includes('ask')))
const requestableAssets = computed(() =>
  assets.value.filter((asset) => asset.authStatus === 'requestable' && asset.actions.includes('request'))
)
const pendingAssets = computed(() => assets.value.filter((asset) => asset.authStatus === 'pending'))

const typeTabs = [
  { key: 'all', label: '全部资产' },
  { key: 'dataset', label: '数据集' },
  { key: 'dashboard', label: '仪表板' },
  { key: 'combo', label: '数据表组合' },
  { key: 'file', label: '文件' },
  { key: 'api', label: 'API 数据' }
] as const

const statusTabs: Array<{ key: PlazaView; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'askable', label: '已获权' },
  { key: 'requestable', label: '可申请' },
  { key: 'pending', label: '申请中' },
  { key: 'added', label: '我的数据' }
]

const visibleAssets = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return assets.value.filter((asset) => {
    const matchesSpace = activeSpace.value === 'all' || asset.workspaceId === activeSpace.value
    const matchesType = activeType.value === 'all' || asset.type === activeType.value
    const matchesView =
      activeView.value === 'all' ||
      (activeView.value === 'askable' && asset.actions.includes('ask')) ||
      (activeView.value === 'requestable' && asset.authStatus === 'requestable') ||
      (activeView.value === 'pending' && asset.authStatus === 'pending') ||
      (activeView.value === 'added' && asset.added)
    const text = `${asset.name} ${asset.description} ${asset.owner} ${asset.workspaceName} ${asset.tags.join(' ')}`.toLowerCase()
    return matchesSpace && matchesType && matchesView && (!q || text.includes(q))
  })
})

const selectableAssets = computed(() => visibleAssets.value.filter((asset) => asset.actions.includes('add')))

const selectedAddableAssets = computed(() =>
  assets.value.filter((asset) => selectedIds.value.includes(asset.id) && asset.actions.includes('add'))
)

function focusView(key: PlazaView) {
  activeView.value = key
  selectedIds.value = []
}

function toggleAsset(asset: DataAssetVO) {
  if (!asset.actions.includes('add')) return
  selectedIds.value = selectedIds.value.includes(asset.id)
    ? selectedIds.value.filter((id) => id !== asset.id)
    : [...selectedIds.value, asset.id]
}

function selectVisibleAddable() {
  selectedIds.value = selectableAssets.value.map((asset) => asset.id)
}

function clearSelected() {
  selectedIds.value = []
}

function flash(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 1600)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await workspaceApi.dataPlaza(getAuthBundle().workspaceId)
    selectedIds.value = []
  } catch (e) {
    error.value = e instanceof Error ? e.message : '数据广场加载失败'
  } finally {
    loading.value = false
  }
}

function typeLabel(type: DataAssetVO['type']) {
  return typeTabs.find((t) => t.key === type)?.label || type
}

function statusLabel(asset: DataAssetVO) {
  if (asset.added) return '已添加'
  if (asset.authStatus === 'granted') return '已获权'
  if (asset.authStatus === 'requestable') return '可申请'
  if (asset.authStatus === 'pending') return '申请中'
  return '不可用'
}

function rowActionLabel(asset: DataAssetVO) {
  if (asset.added) return '已添加'
  if (asset.authStatus === 'pending') return '待审批'
  if (asset.actions.includes('add')) return '添加'
  if (asset.actions.includes('request')) return '申请'
  return '查看'
}

function dateLabel(ts: number) {
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60000))
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return new Date(ts).toLocaleDateString()
}

async function addAsset(asset: DataAssetVO) {
  try {
    await workspaceApi.addToMyData(workspaceId.value, asset.id)
    await load()
    flash('已加入我的数据')
  } catch (e) {
    flash(e instanceof Error ? e.message : '加入失败')
  }
}

async function bulkAdd() {
  const targets = selectedAddableAssets.value
  if (!targets.length) return
  try {
    await Promise.all(targets.map((asset) => workspaceApi.addToMyData(workspaceId.value, asset.id)))
    await load()
    flash(`已加入 ${targets.length} 个资产`)
  } catch (e) {
    flash(e instanceof Error ? e.message : '批量加入失败')
  }
}

async function submitRequest() {
  if (!requestAsset.value) return
  try {
    await workspaceApi.requestDataset(workspaceId.value, {
      assetId: requestAsset.value.id,
      purpose: requestPurpose.value,
      expireDays: 90,
      requestedActions: ['consume', 'ask']
    })
    requestAsset.value = null
    await load()
    flash('已提交申请')
  } catch (e) {
    flash(e instanceof Error ? e.message : '提交失败')
  }
}

function startAsk(asset: DataAssetVO) {
  router.push({ path: '/conversations', query: { datasetId: asset.source || asset.id } })
}

function openAsset(asset: DataAssetVO) {
  if (asset.type === 'dashboard') {
    router.push('/dashboards')
  } else {
    router.push('/datasets')
  }
}

onMounted(load)
</script>

<template>
  <main class="plaza-page">
    <section class="market-frame">
      <div class="market-hero">
        <p>企业资产</p>
        <h1>优选数据资产</h1>
        <span>组织内可用的全部数据资产，添加到 <button type="button" @click="focusView('added')">我的数据</button> 后可用于分析</span>
        <label class="hero-search">
          <span aria-hidden="true">⌕</span>
          <input v-model="keyword" type="search" placeholder="您需要什么数据？搜一下" />
        </label>
      </div>

      <div class="type-tabs" aria-label="资产分类">
        <button
          v-for="tab in typeTabs.filter((item) => item.key !== 'all')"
          :key="tab.key"
          type="button"
          :class="{ on: activeType === tab.key }"
          @click="activeType = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <section class="asset-workspace">
        <aside class="space-pane">
          <div class="space-title">数据空间</div>
          <label class="space-search">
            <span aria-hidden="true">⌕</span>
            <input v-model="keyword" type="search" placeholder="搜索空间" />
          </label>
          <button class="space-btn" :class="{ on: activeSpace === 'all' }" type="button" @click="activeSpace = 'all'">
            <span>全部空间</span><em>{{ assets.length }}</em>
          </button>
          <button
            v-for="space in data?.spaces || []"
            :key="space.id"
            class="space-btn"
            :class="{ on: activeSpace === space.id }"
            type="button"
            @click="activeSpace = space.id"
          >
            <span>{{ space.name }}</span><em>{{ space.assetCount }}</em>
          </button>
          <div class="space-group">快捷筛选</div>
          <button class="space-btn" :class="{ on: activeView === 'added' }" type="button" @click="focusView('added')">
            <span>已加入空间</span><em>{{ myData.length }}</em>
          </button>
          <button class="space-btn" :class="{ on: activeView === 'pending' }" type="button" @click="focusView('pending')">
            <span>我的申请</span><em>{{ requests.length }}</em>
          </button>
        </aside>

        <section class="asset-panel">
          <div class="list-tools">
            <div class="seg" aria-label="消费状态">
              <button
                v-for="tab in statusTabs"
                :key="tab.key"
                type="button"
                :class="{ on: activeView === tab.key }"
                @click="focusView(tab.key)"
              >
                {{ tab.label }}
              </button>
            </div>
            <div class="tool-spacer"></div>
            <span class="asset-count">{{ visibleAssets.length }} 个资产</span>
            <div class="view-toggle" aria-label="视图切换">
              <button type="button" :class="{ on: displayMode === 'grid' }" title="卡片视图" @click="displayMode = 'grid'">
                <span aria-hidden="true">▦</span>
              </button>
              <button type="button" :class="{ on: displayMode === 'list' }" title="列表视图" @click="displayMode = 'list'">
                <span aria-hidden="true">☰</span>
              </button>
            </div>
          </div>

          <div class="bulk-line" :class="{ show: selectedIds.length }">
            <span>已选择 {{ selectedIds.length }} 个资产</span>
            <button type="button" @click="selectVisibleAddable" :disabled="!selectableAssets.length">选择可添加</button>
            <button type="button" @click="clearSelected">取消</button>
            <button class="primary" type="button" @click="bulkAdd" :disabled="!selectedAddableAssets.length">
              批量添加
            </button>
          </div>

          <div v-if="loading" class="empty">正在加载数据广场资产...</div>
          <div v-else-if="error" class="empty error">{{ error }}</div>
          <div v-else-if="!visibleAssets.length" class="empty">
            没有匹配资产，可以切换数据空间、资产类型或搜索关键词。
          </div>

          <div v-else-if="displayMode === 'list'" class="asset-list">
            <article v-for="asset in visibleAssets" :key="asset.id" class="asset-row">
              <input
                class="check"
                type="checkbox"
                :checked="selectedIds.includes(asset.id)"
                :disabled="!asset.actions.includes('add')"
                :aria-label="`选择 ${asset.name}`"
                @change="toggleAsset(asset)"
              />
              <span class="asset-icon" aria-hidden="true">▣</span>
              <div class="asset-copy">
                <button type="button" @click="openAsset(asset)">{{ asset.name }}</button>
                <p>{{ asset.description }}</p>
                <div class="asset-meta">
                  <span>{{ asset.owner }}</span>
                  <span>{{ dateLabel(asset.updatedAt) }}</span>
                  <span>{{ asset.workspaceName }}</span>
                </div>
              </div>
              <div class="row-action">
                <button
                  v-if="asset.added"
                  class="state ok"
                  type="button"
                  @click="asset.actions.includes('ask') ? startAsk(asset) : openAsset(asset)"
                >
                  ✓ {{ rowActionLabel(asset) }}
                </button>
                <button
                  v-else-if="asset.authStatus === 'pending'"
                  class="state wait"
                  type="button"
                  disabled
                >
                  ··· {{ rowActionLabel(asset) }}
                </button>
                <button v-else-if="asset.actions.includes('add')" class="link-action" type="button" @click="addAsset(asset)">
                  {{ rowActionLabel(asset) }}
                </button>
                <button
                  v-else-if="asset.actions.includes('request')"
                  class="link-action"
                  type="button"
                  @click="requestAsset = asset"
                >
                  {{ rowActionLabel(asset) }}
                </button>
                <button v-else class="link-action" type="button" @click="openAsset(asset)">查看</button>
              </div>
            </article>
          </div>

          <div v-else class="asset-card-grid">
            <article v-for="asset in visibleAssets" :key="asset.id" class="asset-card">
              <div class="card-top">
                <input
                  class="check"
                  type="checkbox"
                  :checked="selectedIds.includes(asset.id)"
                  :disabled="!asset.actions.includes('add')"
                  :aria-label="`选择 ${asset.name}`"
                  @change="toggleAsset(asset)"
                />
                <span class="asset-icon" aria-hidden="true">▣</span>
                <span :class="['state', asset.added ? 'ok' : asset.authStatus === 'pending' ? 'wait' : 'plain']">
                  {{ statusLabel(asset) }}
                </span>
              </div>
              <button class="card-title" type="button" @click="openAsset(asset)">{{ asset.name }}</button>
              <p>{{ asset.description }}</p>
              <div class="asset-meta">
                <span>{{ asset.owner }}</span>
                <span>{{ dateLabel(asset.updatedAt) }}</span>
                <span>{{ asset.workspaceName }}</span>
              </div>
            </article>
          </div>
        </section>
      </section>
    </section>

    <div v-if="requestAsset" class="modal-mask" @click.self="requestAsset = null">
      <section class="request-modal">
        <h2>申请消费 {{ requestAsset.name }}</h2>
        <p>{{ requestAsset.description }}</p>
        <label>
          <span>用途说明</span>
          <textarea v-model="requestPurpose" rows="4" />
        </label>
        <div class="modal-actions">
          <button type="button" @click="requestAsset = null">取消</button>
          <button class="primary" type="button" @click="submitRequest">提交申请</button>
        </div>
      </section>
    </div>

    <div class="page-toast" :class="{ show: !!toast }">{{ toast }}</div>
  </main>
</template>

<style scoped>
.plaza-page {
  --brand: var(--od-brand, #4f46e5);
  --brand-soft: var(--od-brand-soft, #eef2ff);
  --ink: var(--od-ink, #111827);
  --muted: var(--od-muted, #4b5563);
  --faint: var(--od-faint, #6b7280);
  --line: var(--od-line, #dfe3ea);
  --bg: var(--od-bg, #f6f7fb);
  --card: var(--od-card, #fff);
  min-height: 100%;
  padding: 24px 28px 56px;
  overflow: auto;
  background: var(--bg);
  color: var(--ink);
}

button {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink);
  padding: 7px 12px;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}

button:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand);
}

button:disabled {
  cursor: not-allowed;
  color: #9ca3af;
}

.primary {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}

.primary:hover:not(:disabled) {
  background: var(--od-brand-hover, #4338ca);
  color: #fff;
}

.plaza-hero,
.space-nav,
.asset-panel,
.side-card,
.asset-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
}

.plaza-hero {
  padding: 20px 22px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.plaza-hero p {
  margin: 0;
  color: var(--brand);
  font-size: 12px;
  font-weight: 760;
}

.plaza-hero h1 {
  margin: 7px 0 0;
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: 0;
}

.plaza-hero span {
  display: block;
  max-width: 1120px;
  margin-top: 7px;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.62;
}

.hero-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex-shrink: 0;
}

.plaza-grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 256px minmax(760px, 1fr) clamp(320px, 18vw, 380px);
  gap: 16px;
  align-items: start;
}

.space-nav {
  padding: 12px;
}

.nav-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 760;
}

.nav-title button {
  min-height: 28px;
  padding: 4px 9px;
  font-size: 12px;
}

.space-btn {
  width: 100%;
  min-height: 40px;
  border: 0;
  background: transparent;
  color: var(--muted);
  justify-content: space-between;
  padding: 8px 10px;
  text-align: left;
}

.space-btn:hover {
  background: var(--bg);
  color: var(--ink);
}

.space-btn.on {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 720;
}

.space-btn span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.space-btn em {
  color: var(--faint);
  flex-shrink: 0;
  font-size: 11px;
  font-style: normal;
}

.space-divider {
  height: 1px;
  background: var(--line);
  margin: 10px 0;
}

.mini-stat {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mini-stat button {
  min-height: 76px;
  display: grid;
  justify-items: start;
  align-content: center;
  border-color: var(--line);
  background: var(--bg);
  white-space: normal;
}

.mini-stat button.on {
  border-color: #c7d2fe;
  background: var(--brand-soft);
  color: var(--brand);
}

.mini-stat b {
  color: var(--ink);
  font-size: 18px;
  line-height: 1.1;
}

.mini-stat span {
  color: var(--muted);
  font-size: 11.5px;
}

.asset-panel {
  min-width: 0;
  overflow: hidden;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid var(--line);
  align-items: center;
}

.search-wrap {
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  min-width: 0;
}

.search-wrap span {
  color: var(--faint);
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.search-wrap input {
  min-width: 0;
  width: 100%;
  height: 32px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.head-actions button {
  min-height: 32px;
  padding: 6px 10px;
  font-size: 13px;
}

.type-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 14px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--line);
}

.type-tabs button {
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

.type-tabs button.on {
  color: var(--brand);
  border-bottom-color: var(--brand);
}

.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

.filters > span {
  color: var(--faint);
  font-size: 12px;
}

.seg {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}

.seg button {
  height: 30px;
  min-height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 650;
}

.seg button.on {
  background: var(--card);
  color: var(--brand);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.06);
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}

.asset-card {
  min-width: 0;
  min-height: 244px;
  padding: 14px;
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  gap: 10px;
  box-shadow: none;
}

.asset-card:hover {
  box-shadow: 0 10px 30px rgba(17, 24, 39, 0.08);
}

.asset-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.check-wrap {
  display: grid;
  padding-top: 2px;
}

.check {
  width: 18px;
  height: 18px;
  accent-color: var(--brand);
}

.asset-title {
  min-width: 0;
}

.asset-title button {
  display: inline;
  min-height: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  padding: 0;
  font-weight: 760;
  font-size: 15px;
  line-height: 1.35;
  text-align: left;
  white-space: normal;
}

.asset-title button:hover {
  color: var(--brand);
}

.asset-title p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.55;
}

.asset-type {
  min-height: 24px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 760;
  border: 1px solid var(--line);
  color: var(--muted);
  background: var(--bg);
  white-space: nowrap;
}

.asset-type.dataset {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #bfdbfe;
}

.asset-type.dashboard {
  color: #047857;
  background: #ecfdf3;
  border-color: #bbf7d0;
}

.asset-type.combo {
  color: #7c2d12;
  background: #fff7ed;
  border-color: #fed7aa;
}

.asset-type.file {
  color: #854d0e;
  background: #fefce8;
  border-color: #fde68a;
}

.asset-type.api {
  color: #6d28d9;
  background: #f5f3ff;
  border-color: #ddd6fe;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.meta-grid div {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  padding: 8px;
}

.meta-grid span {
  display: block;
  color: var(--faint);
  font-size: 11px;
  margin-bottom: 3px;
}

.meta-grid b {
  display: block;
  color: var(--ink);
  font-size: 12px;
  font-weight: 680;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip,
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 3px 7px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 680;
  background: var(--card);
  color: var(--muted);
  border: 1px solid var(--line);
}

.badge.granted {
  color: #047857;
  border-color: #bbf7d0;
  background: #ecfdf3;
}

.badge.mine {
  color: #4338ca;
  border-color: #c7d2fe;
  background: var(--brand-soft);
}

.badge.requestable {
  color: #92400e;
  border-color: #fed7aa;
  background: #fff7ed;
}

.badge.pending {
  color: #b45309;
  border-color: #fde68a;
  background: #fffbeb;
}

.badge.denied {
  color: var(--muted);
  background: #eef0f3;
}

.asset-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.asset-actions button {
  min-height: 30px;
  padding: 5px 9px;
  font-size: 13px;
}

.side {
  display: grid;
  gap: 12px;
}

.side-card {
  padding: 14px;
}

.side-card h2 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 760;
}

.side-card h2 button {
  min-height: 30px;
  padding: 5px 9px;
  font-size: 12px;
}

.side-card p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.55;
}

.my-list,
.flow {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.my-item,
.flow div {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}

.my-item b,
.flow b {
  color: var(--ink);
  font-size: 13px;
}

.my-item span,
.flow span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.my-item.muted {
  color: var(--faint);
  font-size: 12px;
}

.empty {
  margin: 14px;
  padding: 46px 16px;
  text-align: center;
  border: 1px dashed #cfd5df;
  border-radius: 8px;
  color: var(--muted);
  background: #fafbff;
  font-size: 13px;
  line-height: 1.6;
}

.empty.error {
  color: #b42318;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(17, 24, 39, 0.38);
  display: grid;
  place-items: center;
  padding: 24px;
}

.request-modal {
  width: min(560px, 100%);
  background: #fff;
  border: 1px solid #dfe3ea;
  border-radius: 8px;
  box-shadow: 0 24px 64px rgba(17, 24, 39, 0.22);
  padding: 20px;
}

.request-modal h2 {
  margin: 0 0 8px;
  font-size: 20px;
}

.request-modal p {
  color: #4b5563;
  line-height: 1.6;
}

.request-modal label,
.request-modal label span {
  display: block;
}

.request-modal label span {
  margin-bottom: 8px;
  font-weight: 700;
}

.request-modal textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  padding: 10px;
  resize: vertical;
  font: inherit;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.page-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translate(-50%, 12px);
  background: #111827;
  color: #fff;
  border-radius: 8px;
  padding: 9px 14px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
}

.page-toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

@media (max-width: 1700px) {
  .plaza-grid {
    grid-template-columns: 248px minmax(0, 1fr) 318px;
  }

  .asset-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1400px) {
  .plaza-grid {
    grid-template-columns: 248px minmax(0, 1fr);
  }

  .side {
    grid-column: 1 / -1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1180px) {
  .plaza-grid {
    grid-template-columns: 220px minmax(0, 1fr);
  }
}

@media (max-width: 860px) {
  .plaza-page {
    padding: 16px;
  }

  .plaza-hero {
    flex-direction: column;
    padding: 18px;
  }

  .hero-actions {
    justify-content: flex-start;
  }

  .plaza-grid,
  .side,
  .toolbar,
  .asset-grid {
    grid-template-columns: 1fr;
  }

  .toolbar {
    align-items: stretch;
  }

  .head-actions {
    justify-content: flex-start;
  }

  .type-tabs {
    padding-left: 14px;
    padding-right: 14px;
  }

  .seg {
    overflow-x: auto;
    max-width: 100%;
  }

  .asset-card {
    min-height: 0;
  }

  .asset-head {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .asset-type {
    grid-column: 2;
    justify-self: start;
  }

  .asset-actions {
    justify-content: flex-start;
  }
}
</style>

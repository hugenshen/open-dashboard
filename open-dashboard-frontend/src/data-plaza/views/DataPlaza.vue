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
const activeType = ref('dataset')
const activeView = ref<PlazaView>('all')
const displayMode = ref<'grid' | 'list'>('list')
const requestAsset = ref<DataAssetVO | null>(null)
const previewAsset = ref<DataAssetVO | null>(null)
const addAssetTarget = ref<DataAssetVO | null>(null)
const addTargetFolder = ref('root')
const addDialogOpen = ref(false)
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
const addTargets = computed(() => (addAssetTarget.value ? [addAssetTarget.value] : selectedAddableAssets.value))
const showFolderRows = computed(
  () => displayMode.value === 'list' && activeSpace.value === 'all' && activeView.value === 'all' && !keyword.value.trim()
)
const visibleFolders = computed(() =>
  (data.value?.spaces || []).filter((space) => {
    if (activeType.value === 'all') return space.assetCount > 0
    return assets.value.some((asset) => asset.workspaceId === space.id && asset.type === activeType.value)
  })
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

function switchSpace(spaceId: string) {
  activeSpace.value = spaceId
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
  if (asset.added) return asset.actions.includes('ask') ? '开始问数' : '打开'
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

function openAddDialog(asset?: DataAssetVO) {
  addAssetTarget.value = asset || null
  addTargetFolder.value = 'root'
  addDialogOpen.value = true
}

function closeAddDialog() {
  addAssetTarget.value = null
  addDialogOpen.value = false
}

async function confirmAdd() {
  const targets = addTargets.value
  if (!targets.length) return
  try {
    await Promise.all(targets.map((asset) => workspaceApi.addToMyData(workspaceId.value, asset.id)))
    await load()
    addAssetTarget.value = null
    addDialogOpen.value = false
    flash(targets.length === 1 ? '已添加到我的数据' : `已添加 ${targets.length} 个资产`)
  } catch (e) {
    flash(e instanceof Error ? e.message : '添加失败')
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
  previewAsset.value = asset
}

function consumeAsset(asset: DataAssetVO) {
  if (asset.actions.includes('ask')) startAsk(asset)
  else if (asset.type === 'dashboard') router.push('/dashboards')
  else router.push('/datasets')
}

onMounted(load)
</script>

<template>
  <main class="plaza-page">
    <section class="market-frame">
      <div class="market-hero">
        <h1>优选数据资产</h1>
        <span>组织内可用的全部数据资产，添加到 <button type="button" @click="focusView('added')">我的数据</button> 后可用于分析</span>
        <form class="hero-search" role="search" @submit.prevent>
          <span aria-hidden="true">⌕</span>
          <input v-model="keyword" type="search" placeholder="您需要什么数据？搜一下" />
          <button class="search-submit" type="submit">搜索</button>
        </form>
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
          <form class="space-search" role="search" @submit.prevent>
            <span aria-hidden="true">⌕</span>
            <input v-model="keyword" type="search" placeholder="搜索空间" />
            <button type="submit">搜索</button>
          </form>
          <button class="space-btn" :class="{ on: activeSpace === 'all' }" type="button" @click="switchSpace('all')">
            <span>全部空间</span><em>{{ assets.length }}</em>
          </button>
          <button
            v-for="space in data?.spaces || []"
            :key="space.id"
            class="space-btn"
            :class="{ on: activeSpace === space.id }"
            type="button"
            @click="switchSpace(space.id)"
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
            <button class="primary" type="button" @click="openAddDialog()" :disabled="!selectedAddableAssets.length">
              批量添加
            </button>
          </div>

          <div v-if="loading" class="empty">正在加载数据广场资产...</div>
          <div v-else-if="error" class="empty error">{{ error }}</div>
          <div v-else-if="!visibleAssets.length" class="empty">
            没有匹配资产，可以切换数据空间、资产类型或搜索关键词。
          </div>

          <div v-else-if="displayMode === 'list'" class="asset-list">
            <div class="list-head-row">
              <input class="check" type="checkbox" :checked="!!selectedIds.length" @change="selectedIds.length ? clearSelected() : selectVisibleAddable()" />
              <span>名称</span>
              <span>所有者</span>
              <span>最近修改时间</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            <button
              v-for="space in visibleFolders"
              v-show="showFolderRows"
              :key="space.id"
              class="folder-row"
              type="button"
              @click="switchSpace(space.id)"
            >
              <span></span>
              <span class="folder-cell"><i aria-hidden="true">▸</i><b aria-hidden="true">▰</b>{{ space.name }}</span>
              <span>{{ data?.currentWorkspace.name || '当前工作区' }}</span>
              <span>-</span>
              <span></span>
              <span></span>
            </button>
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
              </div>
              <span class="owner-cell">{{ asset.owner }}</span>
              <span class="time-cell">{{ dateLabel(asset.updatedAt) }}</span>
              <span :class="['state', asset.added ? 'ok' : asset.authStatus === 'pending' ? 'wait' : 'plain']">
                {{ statusLabel(asset) }}
              </span>
              <div class="row-action">
                <button
                  v-if="asset.added"
                  class="link-action row-consume"
                  type="button"
                  @click="consumeAsset(asset)"
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
                <button v-else-if="asset.actions.includes('add')" class="link-action" type="button" @click="openAddDialog(asset)">
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
              <button v-if="asset.actions.includes('add')" class="link-action card-add" type="button" @click="openAddDialog(asset)">添加</button>
              <button v-else-if="asset.actions.includes('request')" class="link-action card-add" type="button" @click="requestAsset = asset">申请</button>
            </article>
          </div>
        </section>
      </section>
    </section>

    <div v-if="addDialogOpen" class="modal-mask add-mask" @click.self="closeAddDialog">
      <section class="request-modal add-modal">
        <div class="modal-head">
          <h2>
            将「{{ addAssetTarget ? addAssetTarget.name : `${selectedAddableAssets.length} 个资产` }}」添加到
          </h2>
          <button type="button" title="关闭" @click="closeAddDialog">×</button>
        </div>
        <label>
          <span>目标文件夹</span>
          <select v-model="addTargetFolder">
            <option value="root">我的数据 / 根目录</option>
            <option v-for="space in data?.spaces || []" :key="space.id" :value="space.id">我的数据 / {{ space.name }}</option>
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" @click="closeAddDialog">取消</button>
          <button class="primary" type="button" @click="confirmAdd">确定添加</button>
        </div>
      </section>
    </div>

    <div v-if="previewAsset" class="modal-mask preview-mask" @click.self="previewAsset = null">
      <section class="preview-panel">
        <div class="preview-head">
          <div>
            <span :class="['asset-icon', previewAsset.type]" aria-hidden="true">▣</span>
            <h2>{{ previewAsset.name }}</h2>
          </div>
          <button type="button" title="关闭" @click="previewAsset = null">×</button>
        </div>
        <div class="preview-meta">
          <span>所有者 <b>{{ previewAsset.owner }}</b></span>
          <span>最近修改于 <b>{{ dateLabel(previewAsset.updatedAt) }}</b></span>
          <span>数据空间 <b>{{ previewAsset.workspaceName }}</b></span>
        </div>
        <p>{{ previewAsset.description }}</p>
        <div class="preview-tabs">
          <b>数据预览</b>
          <span>字段详情</span>
        </div>
        <div class="preview-empty">未获权资产不展示字段明细、样例数据或查询结果。</div>
        <div class="modal-actions">
          <button v-if="previewAsset.actions.includes('add')" type="button" @click="openAddDialog(previewAsset)">添加</button>
          <button v-if="previewAsset.actions.includes('request')" class="primary" type="button" @click="requestAsset = previewAsset; previewAsset = null">申请消费</button>
          <button v-if="previewAsset.actions.includes('ask')" class="primary" type="button" @click="consumeAsset(previewAsset)">开始问数</button>
        </div>
      </section>
    </div>

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

.plaza-page {
  padding: 22px 26px 36px;
}

.market-frame {
  min-height: calc(100vh - 92px);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  overflow: hidden;
}

.market-hero {
  display: grid;
  justify-items: center;
  gap: 18px;
  padding: 70px 28px 36px;
  text-align: center;
}

.market-hero p {
  margin: 0;
  color: var(--faint);
  font-size: 14px;
  font-weight: 650;
}

.market-hero h1 {
  margin: 0;
  color: var(--ink);
  font-size: 34px;
  line-height: 1.15;
  letter-spacing: 0;
}

.market-hero > span {
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin: 0;
  color: #8a8f99;
  font-size: 17px;
  line-height: 1.5;
}

.market-hero > span button {
  min-height: 0;
  border: 0;
  background: transparent;
  color: var(--brand);
  padding: 0;
  font-size: inherit;
}

.hero-search {
  width: min(640px, 100%);
  height: 54px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #d6d8dd;
  border-radius: 18px;
  background: #fff;
  padding: 0 18px;
}

.hero-search span,
.space-search span {
  color: #8f949c;
  font-size: 21px;
  line-height: 1;
}

.hero-search input,
.space-search input {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
}

.hero-search input {
  font-size: 18px;
}

.type-tabs {
  width: min(1180px, calc(100% - 240px));
  margin: 0 auto;
  padding: 0 0 30px;
  border-bottom: 0;
  justify-content: flex-start;
  gap: 24px;
}

.type-tabs button {
  min-width: 92px;
  min-height: 44px;
  border: 0;
  border-radius: 22px;
  background: transparent;
  color: #555a62;
  padding: 0 18px;
  font-size: 17px;
  font-weight: 650;
}

.type-tabs button.on {
  border-bottom-color: transparent;
  background: #f2f3f5;
  color: #22252a;
  font-weight: 760;
}

.asset-workspace {
  width: min(1180px, calc(100% - 240px));
  margin: 0 auto;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  border-top: 1px solid #edf0f2;
}

.space-pane {
  min-height: 600px;
  padding: 22px 22px 28px 0;
  border-right: 1px solid #edf0f2;
  background: #fff;
}

.space-title,
.space-group {
  color: #8a8f99;
  font-size: 14px;
  font-weight: 650;
}

.space-title {
  margin-bottom: 16px;
}

.space-search {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #d8dadd;
  border-radius: 18px;
  padding: 0 12px;
  margin-bottom: 18px;
}

.space-search input {
  font-size: 15px;
}

.space-btn {
  min-height: 42px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #555a62;
  padding: 0 12px;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
}

.space-btn.on {
  background: #f3f5ff;
  color: var(--brand);
}

.space-btn em {
  color: #8a8f99;
  font-size: 13px;
}

.space-group {
  margin: 28px 0 8px;
}

.asset-panel {
  border: 0;
  border-radius: 0;
  background: #fff;
  overflow: visible;
}

.list-tools {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 0 0 28px;
}

.seg {
  border: 0;
  background: transparent;
  gap: 8px;
  padding: 0;
}

.seg button {
  min-height: 32px;
  height: 32px;
  border-radius: 8px;
  color: #555a62;
  font-size: 14px;
}

.seg button.on {
  background: #f2f3f5;
  color: #22252a;
  box-shadow: none;
}

.tool-spacer {
  flex: 1;
}

.asset-count {
  color: #8a8f99;
  font-size: 13px;
}

.view-toggle {
  display: inline-flex;
  gap: 4px;
  border-radius: 8px;
  background: #f0f1f3;
  padding: 3px;
}

.view-toggle button {
  width: 34px;
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #727780;
  padding: 0;
  font-size: 18px;
}

.view-toggle button.on {
  background: #fff;
  color: #22252a;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.08);
}

.bulk-line {
  position: sticky;
  bottom: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  min-height: 46px;
  margin-left: 28px;
  padding: 0 10px;
  border: 1px solid #dfe3ea;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: #fff;
  color: #8a8f99;
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(10px);
  transition: opacity 0.16s, transform 0.16s;
}

.bulk-line.show {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.bulk-line button {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 13px;
}

.asset-list {
  margin-left: 28px;
}

.list-head-row,
.folder-row,
.asset-row {
  display: grid;
  grid-template-columns: 22px 34px minmax(180px, 1fr) 92px 100px 76px 54px;
  gap: 10px;
  align-items: center;
}

.list-head-row {
  min-height: 56px;
  border-top: 1px solid #edf0f2;
  color: #555a62;
  font-size: 16px;
  font-weight: 650;
}

.list-head-row span:first-of-type {
  grid-column: 2 / 4;
}

.folder-row {
  width: 100%;
  min-height: 70px;
  border: 0;
  border-top: 1px solid #edf0f2;
  border-radius: 0;
  background: #fff;
  color: #555a62;
  padding: 0;
  text-align: left;
}

.folder-row:hover {
  background: #fafbff;
}

.folder-cell {
  grid-column: 2 / 4;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  color: #22252a;
  font-size: 17px;
  font-weight: 650;
}

.folder-cell i {
  color: #8a8f99;
  font-style: normal;
}

.folder-cell b {
  color: #f6a500;
  font-size: 24px;
  line-height: 1;
}

.asset-row {
  min-height: 86px;
  border-top: 1px solid #edf0f2;
}

.check {
  width: 16px;
  height: 16px;
  accent-color: var(--brand);
}

.asset-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid #e8ebef;
  border-radius: 9px;
  background: #fff;
  color: #6d63ff;
  font-size: 18px;
}

.asset-copy {
  min-width: 0;
}

.asset-copy > button,
.card-title {
  min-height: 0;
  border: 0;
  background: transparent;
  color: #22252a;
  padding: 0;
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
  justify-content: flex-start;
  white-space: normal;
  text-align: left;
}

.asset-copy > button:hover,
.card-title:hover {
  color: var(--brand);
}

.asset-copy p,
.asset-card p {
  margin: 5px 0 0;
  color: #7c818a;
  font-size: 13px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.owner-cell,
.time-cell {
  color: #555a62;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin-top: 8px;
  color: #8a8f99;
  font-size: 14px;
}

.row-action {
  display: flex;
  justify-content: flex-end;
}

.state,
.link-action {
  min-height: 34px;
  border: 0;
  border-radius: 18px;
  padding: 0 10px;
  font-size: 13px;
}

.asset-row > .state {
  justify-self: start;
}

.state.ok {
  background: #e9f8f0;
  color: #18b96f;
}

.state.wait {
  background: #f3edff;
  color: #8a58ff;
}

.state.plain {
  background: #f3f5ff;
  color: var(--brand);
}

.link-action {
  background: transparent;
  color: var(--brand);
}

.asset-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 14px 0 28px 28px;
}

.asset-card {
  min-height: 176px;
  border: 1px solid #edf0f2;
  border-radius: 8px;
  padding: 14px;
}

.card-add {
  justify-self: start;
  margin-top: 10px;
  padding-left: 0;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.card-top .state {
  margin-left: auto;
  min-height: 28px;
  font-size: 13px;
}

.empty {
  margin: 18px 0 28px 28px;
  padding: 58px 16px;
  border: 1px dashed #d8dadd;
  border-radius: 8px;
  background: #fff;
  color: #8a8f99;
  text-align: center;
}

.modal-head,
.preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-head h2,
.preview-head h2 {
  margin: 0;
}

.modal-head button,
.preview-head button {
  min-height: 28px;
  border: 0;
  background: transparent;
  color: #8a8f99;
  padding: 0 4px;
  font-size: 24px;
}

.request-modal select {
  width: 100%;
  height: 38px;
  border: 1px solid #d8dde7;
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  padding: 0 10px;
  font: inherit;
}

.preview-panel {
  width: min(960px, calc(100vw - 80px));
  max-height: min(760px, calc(100vh - 80px));
  overflow: auto;
  border: 1px solid #dfe3ea;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 24px 64px rgba(17, 24, 39, 0.22);
  padding: 22px;
}

.preview-head > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  margin-top: 22px;
  color: #8a8f99;
  font-size: 14px;
}

.preview-meta b {
  margin-left: 6px;
  color: #22252a;
}

.preview-panel > p {
  margin: 12px 0 18px;
  color: #555a62;
}

.preview-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.preview-tabs b,
.preview-tabs span {
  border-radius: 6px;
  padding: 8px 14px;
}

.preview-tabs b {
  background: #f2f3f5;
}

.preview-empty {
  min-height: 180px;
  display: grid;
  place-items: center;
  border: 1px dashed #d8dadd;
  border-radius: 8px;
  color: #8a8f99;
  background: #fbfcff;
}

@media (max-width: 1400px) {
  .type-tabs,
  .asset-workspace {
    width: calc(100% - 64px);
  }

  .asset-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 920px) {
  .market-hero {
    padding: 42px 18px 28px;
  }

  .market-hero h1 {
    font-size: 28px;
  }

  .type-tabs,
  .asset-workspace {
    width: calc(100% - 32px);
  }

  .asset-workspace {
    grid-template-columns: 1fr;
  }

  .space-pane {
    min-height: 0;
    padding-right: 0;
    border-right: 0;
    border-bottom: 1px solid #edf0f2;
  }

  .list-tools,
  .asset-list,
  .bulk-line,
  .asset-card-grid,
  .empty {
    margin-left: 0;
    padding-left: 0;
  }

  .asset-row {
    grid-template-columns: 24px 42px minmax(0, 1fr);
    padding: 14px 0;
  }

  .row-action {
    grid-column: 3;
    justify-content: flex-start;
  }
}

/* Layout balance overrides: keep the plaza aligned inside the shell card. */
.market-frame {
  width: 100%;
  max-width: none;
  margin: 0 auto;
}

.market-hero {
  padding: 32px 40px 22px;
  gap: 10px;
}

.market-hero h1 {
  font-size: 29px;
}

.hero-search {
  width: min(640px, 50vw);
  height: 46px;
}

.hero-search input {
  font-size: 16px;
}

.type-tabs,
.asset-workspace {
  width: calc(100% - 64px);
  max-width: 1440px;
}

.type-tabs {
  padding-bottom: 18px;
}

.asset-workspace {
  grid-template-columns: 220px minmax(0, 1fr);
}

.space-pane {
  padding-right: 18px;
}

.list-tools {
  padding-left: 22px;
}

.asset-list {
  margin-left: 22px;
}

.bulk-line,
.empty {
  margin-left: 22px;
}

.list-head-row,
.folder-row,
.asset-row {
  grid-template-columns: 22px 30px minmax(190px, 1.4fr) minmax(64px, 0.42fr) minmax(84px, 0.48fr) 62px 54px;
  gap: 10px;
}

.asset-copy p {
  max-width: 520px;
}

.row-action {
  justify-content: flex-end;
}

@media (min-width: 1500px) {
  .type-tabs,
  .asset-workspace {
    width: calc(100% - 96px);
    max-width: 1560px;
  }

  .list-head-row,
  .folder-row,
  .asset-row {
    grid-template-columns: 22px 34px minmax(340px, 1.8fr) minmax(108px, 0.5fr) minmax(138px, 0.58fr) 76px 62px;
  }
}

@media (max-width: 1180px) {
  .type-tabs,
  .asset-workspace {
    width: calc(100% - 48px);
  }
}

/* Fine tune plaza rhythm: quieter hero, lighter table, compact actions. */
.plaza-page {
  padding: 12px 28px 18px;
}

.market-frame {
  min-height: calc(100vh - 86px);
}

.market-hero {
  padding: 24px 40px 18px;
  gap: 8px;
}

.market-hero h1 {
  font-size: 27px;
  line-height: 1.18;
}

.market-hero > span {
  color: #6f7682;
  font-size: 15px;
  line-height: 1.42;
}

.hero-search {
  width: min(600px, 44vw);
  height: 44px;
  margin-top: 2px;
  border-radius: 14px;
  padding: 0 4px 0 16px;
}

.hero-search span,
.space-search span {
  font-size: 17px;
}

.hero-search input {
  font-size: 15px;
}

.search-submit {
  min-width: 78px;
  height: 36px;
  border: 0;
  border-radius: 11px;
  background: var(--brand);
  color: #fff;
  padding: 0 18px;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 6px 14px rgba(82, 70, 230, 0.16);
}

.search-submit:hover {
  background: #4338d8;
}

.type-tabs {
  padding-bottom: 14px;
}

.type-tabs button {
  min-height: 40px;
  padding: 0 20px;
  font-size: 15px;
  font-weight: 650;
}

.asset-workspace {
  grid-template-columns: 210px minmax(0, 1fr);
}

.space-title,
.space-group {
  font-size: 13px;
}

.space-search {
  height: 38px;
  border-radius: 13px;
  padding: 0 4px 0 12px;
}

.space-search input,
.space-btn {
  font-size: 14px;
}

.space-search button {
  min-width: 44px;
  height: 28px;
  border: 1px solid #dfe3eb;
  border-radius: 9px;
  background: #fff;
  color: #4b5565;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 650;
}

.space-search button:hover {
  border-color: #bfc7d5;
  color: var(--brand);
}

.list-tools {
  min-height: 54px;
}

.seg button {
  min-height: 32px;
  padding: 0 12px;
  font-size: 13px;
}

.asset-count {
  font-size: 13px;
}

.view-toggle {
  height: 36px;
}

.view-toggle button {
  width: 34px;
  height: 32px;
}

.list-head-row {
  min-height: 48px;
  font-size: 14px;
}

.folder-row {
  min-height: 58px;
}

.folder-cell {
  font-size: 15px;
  gap: 9px;
}

.asset-row {
  min-height: 72px;
}

.asset-copy > button,
.card-title {
  font-size: 15px;
}

.asset-copy p,
.asset-card p,
.owner-cell,
.time-cell {
  font-size: 12px;
}

.state,
.link-action {
  min-height: 28px;
  border-radius: 14px;
  padding: 0 9px;
  font-size: 12px;
}

.link-action {
  min-width: 48px;
  border: 1px solid #dfe4ee;
  border-radius: 9px;
  background: #fff;
  color: #3f36d8;
  padding: 0 10px;
  font-weight: 650;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease;
}

.link-action:hover {
  border-color: #c8ccff;
  background: #f7f8ff;
  color: var(--brand);
  box-shadow: 0 4px 10px rgba(82, 70, 230, 0.08);
}

.row-consume {
  color: #11a968;
  border-color: #c9efdc;
  background: #f6fcf9;
}

.row-consume:hover {
  border-color: #97e3bd;
  background: #ecfaf3;
  color: #079659;
}

.asset-row > .state {
  justify-self: start;
}

@media (min-width: 1500px) {
  .plaza-page {
    padding-left: 22px;
    padding-right: 22px;
  }

  .hero-search {
    width: 620px;
  }
}
</style>

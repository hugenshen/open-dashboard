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
const spaceKeyword = ref('')
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
  { key: 'pending', label: '申请中' }
]

const filteredSpaces = computed(() => {
  const q = spaceKeyword.value.trim().toLowerCase()
  return (data.value?.spaces || []).filter((space) => !q || space.name.toLowerCase().includes(q))
})

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
  filteredSpaces.value.filter((space) => {
    if (activeType.value === 'all') return space.assetCount > 0
    return assets.value.some((asset) => asset.workspaceId === space.id && asset.type === activeType.value)
  })
)

function focusView(key: PlazaView) {
  activeView.value = key
  if (key === 'added' || key === 'pending') activeSpace.value = 'all'
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
  if (activeView.value === 'added' || activeView.value === 'pending') activeView.value = 'all'
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

function statusLabel(asset: DataAssetVO) {
  if (asset.added) return '已添加'
  if (asset.authStatus === 'granted') return '已获权'
  if (asset.authStatus === 'requestable') return '可申请'
  if (asset.authStatus === 'pending') return '申请中'
  return '不可用'
}

function statusTone(asset: DataAssetVO) {
  if (asset.added) return 'ok'
  if (asset.authStatus === 'pending') return 'wait'
  if (asset.authStatus === 'requestable') return 'apply'
  return 'plain'
}

function rowActionLabel(asset: DataAssetVO) {
  if (asset.added) return asset.actions.includes('ask') ? '开始问数' : '打开'
  if (asset.authStatus === 'pending') return '待审批'
  if (asset.actions.includes('add')) return '添加'
  if (asset.actions.includes('request')) return '申请'
  return '查看'
}

function dateLabel(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
    <header class="plaza-head">
      <div>
        <h1>数据广场</h1>
        <p>
          组织内可用的全部数据资产，添加到
          <button type="button" class="text-link" @click="focusView('added')">我的数据</button>
          后可用于分析
        </p>
      </div>
    </header>

    <div class="plaza-toolbar">
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
      <form class="asset-search" role="search" @submit.prevent>
        <span aria-hidden="true">⌕</span>
        <input v-model="keyword" type="search" placeholder="关键词搜索" />
      </form>
      <div class="view-toggle" aria-label="视图切换">
        <button type="button" :class="{ on: displayMode === 'grid' }" title="卡片视图" @click="displayMode = 'grid'">
          <span aria-hidden="true">▦</span>
        </button>
        <button type="button" :class="{ on: displayMode === 'list' }" title="列表视图" @click="displayMode = 'list'">
          <span aria-hidden="true">☰</span>
        </button>
      </div>
    </div>

    <section class="asset-workspace">
      <aside class="space-pane">
        <div class="space-title">数据空间</div>
        <form class="space-search" role="search" @submit.prevent>
          <span aria-hidden="true">⌕</span>
          <input v-model="spaceKeyword" type="search" placeholder="搜索空间" />
        </form>
        <button class="space-btn" :class="{ on: activeSpace === 'all' && activeView !== 'added' && activeView !== 'pending' }" type="button" @click="switchSpace('all')">
          <span>全部空间</span><em>{{ assets.length }}</em>
        </button>
        <button
          v-for="space in filteredSpaces"
          :key="space.id"
          class="space-btn"
          :class="{ on: activeSpace === space.id }"
          type="button"
          @click="switchSpace(space.id)"
        >
          <span>{{ space.name }}</span><em>{{ space.assetCount }}</em>
        </button>
        <div class="space-group">我的</div>
        <button class="space-btn" :class="{ on: activeView === 'added' }" type="button" @click="focusView('added')">
          <span>我的数据</span><em>{{ myData.length }}</em>
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
          <span class="asset-count">{{ visibleAssets.length }} 个资产</span>
        </div>

        <div v-if="loading" class="empty">正在加载数据广场资产...</div>
        <div v-else-if="error" class="empty error">{{ error }}</div>
        <div v-else-if="!visibleAssets.length && !(showFolderRows && visibleFolders.length)" class="empty">
          没有匹配资产，可以切换数据空间、资产类型或搜索关键词。
        </div>

        <div v-else-if="displayMode === 'list'" class="asset-list">
          <div class="list-head-row">
            <input
              class="check"
              type="checkbox"
              :checked="!!selectedIds.length"
              @change="selectedIds.length ? clearSelected() : selectVisibleAddable()"
            />
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
            <span class="name-cell folder-cell">
              <i aria-hidden="true">▸</i>
              <b aria-hidden="true">▰</b>
              {{ space.name }}
            </span>
            <span class="owner-cell">{{ data?.currentWorkspace.name || '当前工作区' }}</span>
            <span class="time-cell">—</span>
            <span></span>
            <span></span>
          </button>
          <article v-for="asset in visibleAssets" :key="asset.id" class="asset-row" :class="{ picked: selectedIds.includes(asset.id) }">
            <input
              class="check"
              type="checkbox"
              :checked="selectedIds.includes(asset.id)"
              :disabled="!asset.actions.includes('add')"
              :aria-label="`选择 ${asset.name}`"
              @change="toggleAsset(asset)"
            />
            <div class="name-cell">
              <span class="asset-icon" aria-hidden="true">▣</span>
              <button type="button" class="asset-name" :title="asset.description" @click="openAsset(asset)">
                {{ asset.name }}
              </button>
            </div>
            <span class="owner-cell" :title="asset.owner">{{ asset.owner }}</span>
            <span class="time-cell">{{ dateLabel(asset.updatedAt) }}</span>
            <span :class="['state', statusTone(asset)]">
              <i aria-hidden="true"></i>{{ statusLabel(asset) }}
            </span>
            <div class="row-action">
              <button
                v-if="asset.added"
                class="link-action consume"
                type="button"
                @click="consumeAsset(asset)"
              >
                {{ rowActionLabel(asset) }}
              </button>
              <button v-else-if="asset.authStatus === 'pending'" class="link-action muted" type="button" disabled>
                {{ rowActionLabel(asset) }}
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
              <span :class="['state', statusTone(asset)]">
                <i aria-hidden="true"></i>{{ statusLabel(asset) }}
              </span>
            </div>
            <button class="asset-name" type="button" @click="openAsset(asset)">{{ asset.name }}</button>
            <p>{{ asset.description }}</p>
            <div class="asset-meta">
              <span>{{ asset.owner }}</span>
              <span>{{ dateLabel(asset.updatedAt) }}</span>
              <span>{{ asset.workspaceName }}</span>
            </div>
            <button v-if="asset.actions.includes('add')" class="link-action" type="button" @click="openAddDialog(asset)">添加</button>
            <button v-else-if="asset.actions.includes('request')" class="link-action" type="button" @click="requestAsset = asset">申请</button>
            <button v-else-if="asset.added" class="link-action consume" type="button" @click="consumeAsset(asset)">
              {{ rowActionLabel(asset) }}
            </button>
          </article>
        </div>

        <div class="bulk-line" :class="{ show: selectedIds.length }">
          <label>
            <input
              class="check"
              type="checkbox"
              :checked="!!selectedIds.length"
              @change="selectedIds.length ? clearSelected() : selectVisibleAddable()"
            />
            全选
          </label>
          <span>已选 {{ selectedIds.length }} 项</span>
          <button type="button" class="text-link" @click="clearSelected">取消选择</button>
          <button class="primary" type="button" @click="openAddDialog()" :disabled="!selectedAddableAssets.length">
            添加
          </button>
        </div>
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
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--card);
  color: var(--ink);
  overflow: hidden;
}

button {
  font: inherit;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  color: #9ca3af;
}

.primary {
  min-height: 32px;
  border: 1px solid var(--brand);
  border-radius: 6px;
  background: var(--brand);
  color: #fff;
  padding: 0 12px;
  font-weight: 650;
}

.primary:hover:not(:disabled) {
  background: var(--od-brand-hover, #4338ca);
}

.text-link {
  min-height: 0;
  border: 0;
  background: transparent;
  color: var(--brand);
  padding: 0;
  font-weight: 650;
}

.text-link:hover {
  text-decoration: underline;
}

.plaza-head {
  flex-shrink: 0;
  padding: 16px 20px 0;
}

.plaza-head h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
  font-weight: 720;
}

.plaza-head p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.plaza-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px 10px;
}

.type-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
}

.type-tabs button {
  min-height: 32px;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: var(--muted);
  padding: 0 12px;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}

.type-tabs button.on {
  background: #f2f3f5;
  color: var(--ink);
}

.asset-search,
.space-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
}

.asset-search {
  width: 220px;
  height: 32px;
  margin-left: auto;
  padding: 0 12px;
  flex-shrink: 0;
}

.asset-search span,
.space-search span {
  color: var(--faint);
  font-size: 15px;
  line-height: 1;
}

.asset-search input,
.space-search input {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}

.view-toggle {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: #f0f1f3;
}

.view-toggle button {
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #727780;
  padding: 0;
  font-size: 15px;
}

.view-toggle button.on {
  background: #fff;
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.08);
}

.asset-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  border-top: 1px solid #edf0f2;
}

.space-pane {
  min-width: 0;
  overflow: auto;
  padding: 16px 8px 20px 12px;
  border-right: 1px solid #edf0f2;
}

.space-title,
.space-group {
  color: var(--faint);
  font-size: 12px;
  font-weight: 650;
}

.space-title {
  padding: 0 8px;
  margin-bottom: 10px;
}

.space-search {
  height: 32px;
  margin: 0 8px 12px;
  padding: 0 10px;
}

.space-btn {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  padding: 0 8px;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
}

.space-btn:hover {
  background: var(--bg);
  color: var(--ink);
}

.space-btn.on {
  background: var(--brand-soft);
  color: var(--brand);
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
  font-size: 12px;
  font-style: normal;
}

.space-group {
  margin: 18px 8px 6px;
}

.asset-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
}

.seg {
  display: inline-flex;
  gap: 2px;
}

.seg button {
  min-height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  padding: 0 10px;
  font-size: 13px;
  font-weight: 650;
}

.seg button.on {
  background: #f2f3f5;
  color: var(--ink);
}

.asset-count {
  margin-left: auto;
  color: var(--faint);
  font-size: 12px;
}

.asset-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 8px 16px;
}

.list-head-row,
.folder-row,
.asset-row {
  display: grid;
  grid-template-columns: 28px minmax(180px, 1.5fr) minmax(96px, 0.7fr) 148px 88px 72px;
  gap: 12px;
  align-items: center;
}

.list-head-row {
  position: sticky;
  top: 0;
  z-index: 1;
  min-height: 40px;
  border-bottom: 1px solid #edf0f2;
  background: #fff;
  color: var(--muted);
  font-size: 13px;
  font-weight: 650;
}

.folder-row {
  width: 100%;
  min-height: 48px;
  border: 0;
  border-bottom: 1px solid #edf0f2;
  border-radius: 0;
  background: #fff;
  color: var(--muted);
  padding: 0;
  text-align: left;
}

.folder-row:hover,
.asset-row:hover {
  background: #fafbff;
}

.asset-row {
  min-height: 48px;
  border-bottom: 1px solid #edf0f2;
}

.asset-row.picked {
  background: #f5f7ff;
}

.check {
  width: 15px;
  height: 15px;
  accent-color: var(--brand);
}

.name-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.folder-cell i {
  color: var(--faint);
  font-style: normal;
}

.folder-cell b {
  color: #f6a500;
  font-size: 18px;
  line-height: 1;
}

.asset-icon {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border: 1px solid #e8ebef;
  border-radius: 6px;
  background: #fff;
  color: #6d63ff;
  font-size: 14px;
}

.asset-name {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0;
  background: transparent;
  color: var(--ink);
  padding: 0;
  font-size: 14px;
  font-weight: 650;
  text-align: left;
}

.asset-name:hover {
  color: var(--brand);
}

.owner-cell,
.time-cell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 13px;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}

.state i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.state.ok {
  color: #18b96f;
}

.state.wait {
  color: #8a58ff;
}

.state.apply,
.state.plain {
  color: var(--brand);
}

.row-action {
  display: flex;
  justify-content: flex-start;
}

.link-action {
  min-height: 0;
  border: 0;
  background: transparent;
  color: var(--brand);
  padding: 0;
  font-size: 13px;
  font-weight: 650;
}

.link-action:hover:not(:disabled) {
  text-decoration: underline;
}

.link-action.consume {
  color: #11a968;
}

.link-action.muted {
  color: var(--faint);
}

.asset-card-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  align-content: start;
  padding: 8px 16px 16px;
}

.asset-card {
  min-width: 0;
  border: 1px solid #edf0f2;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.card-top .state {
  margin-left: auto;
}

.asset-card .asset-name {
  display: block;
  width: 100%;
}

.asset-card p {
  margin: 6px 0 0;
  color: var(--faint);
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 10px 0;
  color: var(--faint);
  font-size: 12px;
}

.empty {
  margin: 16px;
  padding: 48px 16px;
  text-align: center;
  border: 1px dashed #d8dadd;
  border-radius: 8px;
  color: var(--muted);
  background: #fafbff;
  font-size: 13px;
  line-height: 1.6;
}

.empty.error {
  color: #b42318;
}

.bulk-line {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
  border-top: 1px solid #edf0f2;
  background: #fff;
  color: var(--muted);
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
}

.bulk-line.show {
  opacity: 1;
  pointer-events: auto;
}

.bulk-line label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.bulk-line .primary {
  margin-left: auto;
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

.request-modal h2,
.preview-head h2,
.modal-head h2 {
  margin: 0;
  font-size: 18px;
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

.request-modal textarea,
.request-modal select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  padding: 10px;
  font: inherit;
}

.request-modal textarea {
  resize: vertical;
}

.request-modal select {
  height: 38px;
  background: #fff;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.modal-actions button:not(.primary) {
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  padding: 0 12px;
}

.modal-head,
.preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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

@media (max-width: 920px) {
  .plaza-toolbar {
    flex-wrap: wrap;
  }

  .asset-search {
    width: 100%;
    margin-left: 0;
    order: 3;
  }

  .asset-workspace {
    grid-template-columns: 1fr;
  }

  .space-pane {
    max-height: 220px;
    border-right: 0;
    border-bottom: 1px solid #edf0f2;
  }

  .list-head-row,
  .folder-row,
  .asset-row {
    grid-template-columns: 28px minmax(0, 1fr) 72px;
  }

  .list-head-row span:nth-child(n + 3),
  .owner-cell,
  .time-cell,
  .asset-row > .state {
    display: none;
  }

  .row-action {
    grid-column: 3;
  }
}
</style>

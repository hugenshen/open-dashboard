<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getAuthBundle } from '../../api/http'
import { workspaceApi, type DataAssetVO, type DataPlazaVO, type DataRequestVO } from '../../workspace/api'
import { plazaScope, setPlazaScope, type PlazaScope } from '../plazaScope'

type MineView = 'added' | 'pending'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const data = ref<DataPlazaVO | null>(null)
const keyword = ref('')
const activeType = ref('dataset')
const mineView = ref<MineView>('added')
const displayMode = ref<'grid' | 'list'>('list')
const requestAsset = ref<DataAssetVO | null>(null)
const previewAsset = ref<DataAssetVO | null>(null)
const viewingRequest = ref<{ asset: DataAssetVO; request: DataRequestVO | null } | null>(null)
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
const assetScope = plazaScope

const typeTabs = [
  { key: 'all', label: '全部' },
  { key: 'dataset', label: '数据集' },
  { key: 'dashboard', label: '仪表板' },
  { key: 'combo', label: '数据表组合' },
  { key: 'file', label: '文件' },
  { key: 'api', label: 'API 数据' }
] as const

const typeLabels: Record<string, string> = {
  dataset: '数据集',
  dashboard: '仪表板',
  combo: '数据表组合',
  file: '文件',
  api: 'API 数据'
}

const mineStatusTabs: Array<{ key: MineView; label: string }> = [
  { key: 'added', label: '已添加' },
  { key: 'pending', label: '申请中' }
]

const visibleAssets = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return assets.value.filter((asset) => {
    const matchesType = activeType.value === 'all' || asset.type === activeType.value
    const matchesScope =
      assetScope.value === 'org'
        ? asset.authStatus !== 'pending'
        : mineView.value === 'added'
          ? asset.added
          : asset.authStatus === 'pending'
    const text = `${asset.name} ${asset.description} ${asset.owner} ${asset.workspaceName} ${asset.tags.join(' ')}`.toLowerCase()
    return matchesType && matchesScope && (!q || text.includes(q))
  })
})

const selectableAssets = computed(() => visibleAssets.value.filter((asset) => asset.actions.includes('add')))
const selectedAddableAssets = computed(() =>
  assets.value.filter((asset) => selectedIds.value.includes(asset.id) && asset.actions.includes('add'))
)
const addTargets = computed(() => (addAssetTarget.value ? [addAssetTarget.value] : selectedAddableAssets.value))
const showBulk = computed(() => assetScope.value === 'org' && selectedIds.value.length > 0)

function switchScope(scope: PlazaScope) {
  setPlazaScope(scope)
}

watch(
  assetScope,
  (scope) => {
    if (scope === 'mine') mineView.value = 'added'
    selectedIds.value = []
  },
  { immediate: true }
)

function focusMineView(key: MineView) {
  mineView.value = key
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

function statusLabel(asset: DataAssetVO) {
  if (asset.added) return '已添加'
  if (asset.authStatus === 'granted') return '已获权'
  if (asset.authStatus === 'requestable') return asset.type === 'dashboard' ? '可申请查看' : '可申请'
  if (asset.authStatus === 'pending') return '申请中'
  return '不可用'
}

function publishLabel(asset: DataAssetVO) {
  if (asset.type !== 'dashboard') return ''
  if (asset.publishStatus === 'publishedWithDraft') return '有改动'
  if (asset.publishStatus === 'published') return '已发布'
  if (asset.publishStatus === 'draft') return '草稿'
  return asset.tags.find((t) => t === '已发布' || t === '有未发布改动') || ''
}

function rowActionLabel(asset: DataAssetVO) {
  if (asset.added || (asset.type === 'dashboard' && asset.actions.includes('open'))) {
    if (asset.actions.includes('ask')) return '开始问数'
    return '打开'
  }
  if (asset.authStatus === 'pending') return '查看申请'
  if (asset.actions.includes('add')) return '添加'
  if (asset.actions.includes('request')) return asset.type === 'dashboard' ? '申请查看' : '申请'
  return '查看'
}

function dateLabel(ts: number) {
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60000))
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return new Date(ts).toLocaleDateString()
}

function requestFor(asset: DataAssetVO) {
  return requests.value.find((item) => item.assetId === asset.id) || null
}

function openRequest(asset: DataAssetVO) {
  viewingRequest.value = { asset, request: requestFor(asset) }
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
  const isDash = requestAsset.value.type === 'dashboard'
  try {
    await workspaceApi.requestDataset(workspaceId.value, {
      assetId: requestAsset.value.id,
      purpose: requestPurpose.value,
      expireDays: 90,
      requestedActions: isDash ? ['view'] : ['consume', 'ask']
    })
    requestAsset.value = null
    await load()
    flash('已提交申请')
    switchScope('mine')
    focusMineView('pending')
  } catch (e) {
    flash(e instanceof Error ? e.message : '提交失败')
  }
}

function startAsk(asset: DataAssetVO) {
  const datasetId = asset.source || asset.id
  try {
    localStorage.setItem('od.ask.datasetId', datasetId)
  } catch {
    /* ignore */
  }
  router.push({
    path: '/conversations',
    query: { datasetId, datasetName: asset.name }
  })
}

function openAsset(asset: DataAssetVO) {
  previewAsset.value = asset
}

function consumeAsset(asset: DataAssetVO) {
  if (asset.actions.includes('ask')) startAsk(asset)
  else if (asset.type === 'dashboard') router.push(`/dashboards/${asset.id}/preview`)
  else router.push('/datasets')
}

function emptyCopy() {
  if (assetScope.value === 'mine' && mineView.value === 'pending') return '没有进行中的申请。'
  if (assetScope.value === 'mine') return '还没有添加到我的数据的资产，可切换到企业里添加。'
  return '没有匹配资产，可以切换类型或搜索关键词。'
}

const heroCopy = computed(() =>
  assetScope.value === 'mine'
    ? '已添加到我的数据的资产可直接分析；申请中的资产可查看进度'
    : '组织内可用的全部数据资产，添加到我的数据后可对该数据进行分析'
)

onMounted(load)
</script>

<template>
  <main class="plaza-page">
    <section class="plaza-hero">
      <h1>优选数据资产</h1>
      <p>{{ heroCopy }}</p>
      <form class="hero-search" role="search" @submit.prevent>
        <span aria-hidden="true">⌕</span>
        <input v-model="keyword" type="search" placeholder="您需要什么数据？搜一下" />
        <button class="search-submit" type="submit">搜索</button>
      </form>
    </section>

    <div class="plaza-toolbar">
      <div class="type-tabs" aria-label="资产分类">
        <button
          v-for="tab in typeTabs"
          :key="tab.key"
          type="button"
          :class="{ on: activeType === tab.key }"
          @click="activeType = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
      <span class="asset-count">{{ visibleAssets.length }} 个资产</span>
      <div v-if="assetScope === 'mine'" class="mine-switch" aria-label="我的资产状态">
        <button
          v-for="tab in mineStatusTabs"
          :key="tab.key"
          type="button"
          :class="{ on: mineView === tab.key }"
          @click="focusMineView(tab.key)"
        >
          {{ tab.label }}
          <em v-if="tab.key === 'added'">{{ myData.length }}</em>
          <em v-else>{{ requests.length }}</em>
        </button>
      </div>
      <div class="view-toggle" aria-label="视图切换">
        <button type="button" :class="{ on: displayMode === 'list' }" title="列表" @click="displayMode = 'list'">☰</button>
        <button type="button" :class="{ on: displayMode === 'grid' }" title="卡片" @click="displayMode = 'grid'">▦</button>
      </div>
    </div>

    <div class="bulk-line" :class="{ show: showBulk }">
      <span>已选择 {{ selectedIds.length }} 个资产</span>
      <button type="button" @click="selectVisibleAddable" :disabled="!selectableAssets.length">选择可添加</button>
      <button type="button" @click="clearSelected">取消</button>
      <button class="primary" type="button" @click="openAddDialog()" :disabled="!selectedAddableAssets.length">
        批量添加
      </button>
    </div>

    <section class="plaza-body">
      <div v-if="loading" class="plaza-empty">正在加载数据广场资产...</div>
      <div v-else-if="error" class="plaza-empty error">{{ error }}</div>
      <div v-else-if="!visibleAssets.length" class="plaza-empty">
        <p>{{ emptyCopy() }}</p>
        <button v-if="assetScope === 'mine' && mineView === 'added'" type="button" class="primary" @click="switchScope('org')">
          去企业添加
        </button>
      </div>

      <div v-else-if="displayMode === 'list'" class="asset-list">
        <div class="list-head-row" :class="{ 'no-check': assetScope === 'mine' }">
          <input
            v-if="assetScope === 'org'"
            class="check"
            type="checkbox"
            :checked="!!selectedIds.length"
            @change="selectedIds.length ? clearSelected() : selectVisibleAddable()"
          />
          <span class="icon-spacer" aria-hidden="true" />
          <span>名称</span>
          <span>所有者</span>
          <span>最近修改</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        <article
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="asset-row"
          :class="{ 'no-check': assetScope === 'mine' }"
        >
          <input
            v-if="assetScope === 'org'"
            class="check"
            type="checkbox"
            :checked="selectedIds.includes(asset.id)"
            :disabled="!asset.actions.includes('add')"
            :aria-label="`选择 ${asset.name}`"
            @change="toggleAsset(asset)"
          />
          <span class="asset-icon" aria-hidden="true">▣</span>
          <div class="asset-copy">
            <div class="name-line">
              <button type="button" @click="openAsset(asset)">{{ asset.name }}</button>
              <span class="type-text">{{ typeLabels[asset.type] || asset.type }}</span>
              <span v-if="publishLabel(asset)" class="pub-chip" :data-pub="asset.publishStatus || ''">{{ publishLabel(asset) }}</span>
            </div>
            <p>{{ asset.description }}</p>
          </div>
          <span class="owner-cell">{{ asset.owner }}</span>
          <span class="time-cell">{{ dateLabel(asset.updatedAt) }}</span>
          <span :class="['state', asset.added ? 'ok' : asset.authStatus === 'pending' ? 'wait' : asset.authStatus === 'requestable' ? 'ask' : 'plain']">
            <i aria-hidden="true">{{ asset.added ? '✓' : asset.authStatus === 'requestable' ? '+' : asset.authStatus === 'pending' ? '…' : '●' }}</i>
            {{ statusLabel(asset) }}
          </span>
          <div class="row-action">
            <button
              v-if="asset.added || (asset.type === 'dashboard' && asset.actions.includes('open'))"
              class="link-action row-consume"
              type="button"
              @click="consumeAsset(asset)"
            >
              {{ rowActionLabel(asset) }}
            </button>
            <button
              v-else-if="asset.authStatus === 'pending'"
              class="link-action"
              type="button"
              @click="openRequest(asset)"
            >
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
              v-if="assetScope === 'org'"
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
            <span v-if="publishLabel(asset)" class="pub-chip" :data-pub="asset.publishStatus || ''">{{ publishLabel(asset) }}</span>
            <span>{{ dateLabel(asset.updatedAt) }}</span>
          </div>
          <div class="card-actions">
            <button
              v-if="asset.added || (asset.type === 'dashboard' && asset.actions.includes('open'))"
              class="link-action card-add"
              type="button"
              @click="consumeAsset(asset)"
            >
              {{ rowActionLabel(asset) }}
            </button>
            <button v-else-if="asset.authStatus === 'pending'" class="link-action card-add" type="button" @click="openRequest(asset)">
              查看申请
            </button>
            <button v-else-if="asset.actions.includes('add')" class="link-action card-add" type="button" @click="openAddDialog(asset)">
              添加
            </button>
            <button v-else-if="asset.actions.includes('request')" class="link-action card-add" type="button" @click="requestAsset = asset">
              {{ asset.type === 'dashboard' ? '申请查看' : '申请' }}
            </button>
          </div>
        </article>
      </div>
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
          <span v-if="publishLabel(previewAsset)">发布状态 <b>{{ publishLabel(previewAsset) }}</b></span>
        </div>
        <p>{{ previewAsset.description }}</p>
        <div class="preview-tabs">
          <b>数据预览</b>
          <span>字段详情</span>
        </div>
        <div class="preview-empty">未获权资产不展示字段明细、样例数据或查询结果。</div>
        <div class="modal-actions">
          <button v-if="previewAsset.actions.includes('add')" type="button" @click="openAddDialog(previewAsset)">添加</button>
          <button
            v-if="previewAsset.actions.includes('request')"
            class="primary"
            type="button"
            @click="requestAsset = previewAsset; previewAsset = null"
          >
            {{ previewAsset.type === 'dashboard' ? '申请查看' : '申请消费' }}
          </button>
          <button v-if="previewAsset.actions.includes('ask')" class="primary" type="button" @click="consumeAsset(previewAsset)">开始问数</button>
          <button
            v-if="previewAsset.actions.includes('open') || (previewAsset.added && previewAsset.type === 'dashboard')"
            class="primary"
            type="button"
            @click="consumeAsset(previewAsset)"
          >
            打开
          </button>
        </div>
      </section>
    </div>

    <div v-if="viewingRequest" class="modal-mask" @click.self="viewingRequest = null">
      <section class="request-modal">
        <h2>申请进度 · {{ viewingRequest.asset.name }}</h2>
        <p>{{ viewingRequest.asset.description }}</p>
        <dl class="request-meta">
          <div>
            <dt>状态</dt>
            <dd>{{ viewingRequest.request?.status === 'pending' ? '审批中' : statusLabel(viewingRequest.asset) }}</dd>
          </div>
          <div>
            <dt>审批人</dt>
            <dd>{{ viewingRequest.request?.approver || '数据负责人' }}</dd>
          </div>
          <div>
            <dt>提交时间</dt>
            <dd>{{ viewingRequest.request ? dateLabel(viewingRequest.request.createdAt) : '—' }}</dd>
          </div>
        </dl>
        <p v-if="viewingRequest.request?.purpose" class="purpose">{{ viewingRequest.request.purpose }}</p>
        <div class="modal-actions">
          <button type="button" @click="viewingRequest = null">关闭</button>
        </div>
      </section>
    </div>

    <div v-if="requestAsset" class="modal-mask" @click.self="requestAsset = null">
      <section class="request-modal">
        <h2>{{ requestAsset.type === 'dashboard' ? '申请查看' : '申请消费' }} {{ requestAsset.name }}</h2>
        <p>{{ requestAsset.description }}</p>
        <p v-if="publishLabel(requestAsset)" class="purpose">发布状态：{{ publishLabel(requestAsset) }}</p>
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
  --bg: #fff;
  --card: var(--od-card, #fff);
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  color: var(--ink);
}

.plaza-page button {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink);
  padding: 6px 12px;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}

.plaza-page button:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand);
}

.plaza-page button:disabled {
  cursor: not-allowed;
  color: #9ca3af;
}

.plaza-page .primary {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}

.plaza-page .primary:hover:not(:disabled) {
  background: var(--od-brand-hover, #4338ca);
  color: #fff;
}

.plaza-hero {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 32px 10px;
  text-align: center;
}

.plaza-hero h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 780;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.plaza-hero p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.45;
  max-width: 640px;
}

.hero-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(820px, 100%);
  height: 54px;
  margin-top: 16px;
  border: 1px solid #d7dce6;
  border-radius: 16px;
  background: #fff;
  padding: 0 6px 0 18px;
  box-shadow: 0 10px 28px rgba(79, 70, 229, 0.1);
}

.hero-search:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12);
}

.hero-search span {
  color: #8b93a3;
  font-size: 20px;
}

.hero-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 16px;
}

.plaza-page .search-submit {
  min-width: 92px;
  height: 42px;
  border: 0;
  border-radius: 12px;
  background: var(--brand);
  color: #fff;
  padding: 0 22px;
  font-size: 15px;
  font-weight: 700;
}

.plaza-page .search-submit:hover:not(:disabled) {
  background: #4338d8;
  color: #fff;
  border-color: transparent;
}

.plaza-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 10px;
  padding: 8px 32px 10px;
  border-bottom: 1px solid #e5e8ef;
}
.mine-switch {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  padding: 2px;
  border: 1px solid #e5e8ef;
  border-radius: 8px;
  background: #f6f7fa;
}
.mine-switch button {
  min-height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  padding: 0 10px;
  font-size: 12.5px;
  font-weight: 650;
}
.mine-switch button.on {
  background: #fff;
  color: var(--brand);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.mine-switch em {
  font-style: normal;
  opacity: 0.72;
}
.type-tabs {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  gap: 2px;
  overflow-x: auto;
}
.type-tabs button {
  min-height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  padding: 0 10px;
  font-size: 13px;
  font-weight: 650;
}
.type-tabs button.on {
  background: var(--brand-soft);
  color: var(--brand);
}
.asset-count {
  color: var(--faint);
  font-size: 12.5px;
  font-weight: 650;
  white-space: nowrap;
}
.view-toggle {
  display: flex;
  height: 28px;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.view-toggle button {
  width: 28px;
  height: 26px;
  min-height: 26px;
  border: 0;
  border-radius: 0;
  background: #fff;
  color: #8b93a3;
  padding: 0;
  font-size: 13px;
}
.view-toggle button.on {
  background: var(--brand-soft);
  color: var(--brand);
}
.bulk-line {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 0 16px 8px;
  color: var(--muted);
  font-size: 13px;
}
.bulk-line.show {
  display: flex;
}
.bulk-line button {
  min-height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.plaza-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  background: #fff;
}
.plaza-empty {
  position: relative;
  inset: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
  min-height: 280px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 13.5px;
}
.plaza-empty p { margin: 0; }
.plaza-empty.error {
  color: #b42318;
}

.asset-list {
  min-height: 100%;
}

.list-head-row,
.asset-row {
  display: grid;
  grid-template-columns: 28px 36px minmax(280px, 1.6fr) minmax(88px, 0.55fr) minmax(96px, 0.55fr) 92px 104px;
  gap: 12px;
  align-items: center;
  padding: 0 28px;
}

.list-head-row.no-check,
.asset-row.no-check {
  grid-template-columns: 36px minmax(280px, 1.6fr) minmax(88px, 0.55fr) minmax(96px, 0.55fr) 92px 104px;
}

.list-head-row {
  position: sticky;
  top: 0;
  z-index: 1;
  min-height: 40px;
  border-bottom: 1px solid #e5e8ef;
  background: #f8f9fc;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

.icon-spacer {
  width: 36px;
  height: 1px;
}

.asset-row {
  min-height: 64px;
  padding-top: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eef0f4;
}

.asset-row:hover {
  background: #fafbff;
}

.check {
  width: 15px;
  height: 15px;
  justify-self: center;
  accent-color: var(--brand);
}

.asset-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid #e8ebef;
  border-radius: 9px;
  background: #f8f9ff;
  color: #6d63ff;
  font-size: 15px;
}

.asset-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.name-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.name-line > button,
.card-title {
  min-height: 0;
  border: 0;
  background: transparent;
  color: #111827;
  padding: 0;
  font-size: 15px;
  font-weight: 680;
  line-height: 1.35;
  justify-content: flex-start;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  max-width: 100%;
}

.name-line > button:hover,
.card-title:hover {
  color: var(--brand);
}

.type-text {
  flex-shrink: 0;
  color: #9ca3af;
  font-size: 12px;
  font-weight: 600;
}

.pub-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  border: 1px solid #dbe4ff;
  border-radius: 999px;
  background: #f4f6ff;
  color: #4338ca;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 680;
}
.pub-chip[data-pub='publishedWithDraft'] {
  border-color: #fde68a;
  background: #fffbeb;
  color: #b45309;
}

.asset-copy p,
.asset-card p {
  margin: 0;
  color: #6b7280;
  font-size: 12.5px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.owner-cell,
.time-cell {
  color: #4b5563;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-action,
.card-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}

.state i {
  font-style: normal;
  font-size: 12px;
  line-height: 1;
}

.asset-row > .state {
  justify-self: start;
}

.state.ok {
  color: #12a869;
}

.state.wait {
  color: #8a58ff;
}

.state.ask,
.state.plain {
  color: #5b53e6;
}

.link-action {
  min-width: 56px;
  min-height: 30px;
  border: 1px solid #dfe4ee;
  border-radius: 8px;
  background: #fff;
  color: #3f36d8;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 680;
}

.link-action:hover {
  border-color: #c8ccff;
  background: #f7f8ff;
  color: var(--brand);
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

.asset-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  padding: 12px;
}

.asset-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 148px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  padding: 12px;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-top .state {
  margin-left: auto;
}

.asset-meta {
  display: flex;
  gap: 12px;
  margin-top: auto;
  color: #8a8f99;
  font-size: 12px;
}

.card-add {
  align-self: flex-start;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgba(17, 24, 39, 0.28);
  padding: 24px;
}

.request-modal,
.preview-panel {
  width: min(520px, 100%);
  border-radius: 14px;
  background: #fff;
  padding: 20px 22px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
}

.request-modal h2,
.preview-head h2,
.modal-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 740;
}

.request-modal p,
.preview-panel > p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
}

.request-modal label,
.request-modal label span {
  display: block;
}

.request-modal label {
  margin-top: 14px;
}

.request-modal label span {
  margin-bottom: 6px;
  color: var(--faint);
  font-size: 12px;
  font-weight: 650;
}

.request-modal textarea,
.request-modal select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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
  width: 28px;
  min-height: 28px;
  border: 0;
  background: transparent;
  color: var(--faint);
  padding: 0;
  font-size: 20px;
}

.preview-panel {
  width: min(680px, 100%);
}

.preview-head > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 12px;
  color: var(--faint);
  font-size: 12px;
}

.preview-meta b {
  color: var(--ink);
  font-weight: 650;
}

.preview-tabs {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  border-bottom: 1px solid #edf0f2;
  color: var(--faint);
  font-size: 13px;
}

.preview-tabs b {
  color: var(--ink);
  box-shadow: inset 0 -2px 0 var(--brand);
  padding-bottom: 8px;
  font-weight: 700;
}

.preview-tabs span {
  padding-bottom: 8px;
}

.preview-empty {
  margin-top: 16px;
  border: 1px dashed #e5e8ee;
  border-radius: 10px;
  background: #fafbfd;
  color: var(--faint);
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
}

.request-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0 0;
}

.request-meta dt {
  color: var(--faint);
  font-size: 11px;
}

.request-meta dd {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 650;
}

.purpose {
  margin-top: 12px !important;
}

.page-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 50;
  transform: translateX(-50%) translateY(8px);
  border-radius: 999px;
  background: #111827;
  color: #fff;
  padding: 8px 14px;
  font-size: 13px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s, transform 0.16s;
}

.page-toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

@media (max-width: 960px) {
  .plaza-toolbar {
    flex-wrap: wrap;
  }

  .type-tabs {
    flex: 1 1 100%;
  }

  .list-head-row,
  .asset-row {
    grid-template-columns: 28px 32px minmax(160px, 1fr) 88px;
    padding: 0 16px;
  }

  .list-head-row.no-check,
  .asset-row.no-check {
    grid-template-columns: 32px minmax(160px, 1fr) 88px;
  }

  .hero-search {
    width: min(100%, 820px);
    height: 48px;
  }

  .hero-search input {
    font-size: 15px;
  }

  .plaza-page .search-submit {
    min-width: 80px;
    height: 38px;
  }

  .owner-cell,
  .time-cell,
  .list-head-row span:nth-of-type(3),
  .list-head-row span:nth-of-type(4) {
    display: none;
  }
}
</style>

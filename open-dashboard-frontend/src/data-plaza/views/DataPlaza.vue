<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAuthBundle } from '../../api/http'
import { workspaceApi, type DataAssetVO, type DataPlazaVO } from '../../workspace/api'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const data = ref<DataPlazaVO | null>(null)
const keyword = ref('')
const activeSpace = ref('all')
const activeType = ref('all')
type PlazaView = 'all' | 'askable' | 'requestable' | 'pending' | 'added'
const activeView = ref<PlazaView>('all')
const requestAsset = ref<DataAssetVO | null>(null)
const requestPurpose = ref('用于经营分析、日报追踪和异常复盘。')
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
    const text = `${asset.name} ${asset.description} ${asset.owner} ${asset.tags.join(' ')}`.toLowerCase()
    return matchesSpace && matchesType && matchesView && (!q || text.includes(q))
  })
})

const statCards = computed<Array<{ key: PlazaView; label: string; value: number; hint: string }>>(() => [
  { key: 'askable', label: '直接问数', value: askableAssets.value.length, hint: '已授权数据集' },
  { key: 'requestable', label: '申请消费', value: requestableAssets.value.length, hint: '等审批后可用' },
  { key: 'added', label: '我的数据', value: myData.value.length, hint: '已加入范围' }
])

const typeTabs = [
  { key: 'all', label: '全部' },
  { key: 'dataset', label: '数据集' },
  { key: 'dashboard', label: '仪表板' },
  { key: 'combo', label: '数据表组合' },
  { key: 'file', label: '文件' },
  { key: 'api', label: 'API 数据' }
]

const statusTabs = [
  { key: 'all', label: '全部' },
  { key: 'askable', label: '可问' },
  { key: 'requestable', label: '可申请' },
  { key: 'pending', label: '申请中' },
  { key: 'added', label: '我的数据' }
] as const

function focusTask(key: PlazaView) {
  activeView.value = key
  if (key === 'askable') {
    activeType.value = 'dataset'
  } else if (key === 'all') {
    activeType.value = 'all'
  }
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
  if (asset.added) return '我的数据'
  if (asset.authStatus === 'granted') return '已授权'
  if (asset.authStatus === 'requestable') return '可申请'
  if (asset.authStatus === 'pending') return '申请中'
  return '不可用'
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
    <section class="plaza-head">
      <div class="head-copy">
        <p>用户使用端 · 企业资产发现</p>
        <h1>数据广场</h1>
        <span>
          先看可直接问数的数据集；没有合适资产时再申请消费，审批通过后会进入我的数据。
        </span>
      </div>
      <div class="task-cards" aria-label="数据广场任务入口">
        <button
          v-for="card in statCards"
          :key="card.key"
          type="button"
          class="task-card"
          :class="{ on: activeView === card.key }"
          @click="focusTask(card.key)"
        >
          <strong>{{ card.value }}</strong>
          <span>{{ card.label }}</span>
          <small>{{ card.hint }}</small>
        </button>
      </div>
    </section>

    <section class="plaza-grid">
      <aside class="plaza-side">
        <div class="side-title">按数据空间看</div>
        <button class="space-row" :class="{ on: activeSpace === 'all' }" type="button" @click="activeSpace = 'all'">
          <b>全部资产</b><span>{{ assets.length }}</span>
        </button>
        <button
          v-for="space in data?.spaces || []"
          :key="space.id"
          class="space-row"
          :class="{ on: activeSpace === space.id }"
          type="button"
          @click="activeSpace = space.id"
        >
          <b>{{ space.name }}</b><span>{{ space.assetCount }}</span>
        </button>
        <button class="refresh-row" type="button" @click="load" :disabled="loading">
          {{ loading ? '刷新中...' : '刷新资产' }}
        </button>
      </aside>

      <section class="plaza-main">
        <div class="plaza-toolbar">
          <input v-model="keyword" type="search" placeholder="搜索资产、业务域、负责人或标签" />
          <button type="button" @click="focusTask('askable')">只看可问</button>
        </div>

        <div class="view-tabs" aria-label="消费状态筛选">
          <button
            v-for="tab in statusTabs"
            :key="tab.key"
            type="button"
            :class="{ on: activeView === tab.key }"
            @click="focusTask(tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="type-tabs" aria-label="资产类型筛选">
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

        <div v-if="loading" class="empty">正在加载数据广场资产...</div>
        <div v-else-if="error" class="empty error">{{ error }}</div>
        <div v-else-if="!visibleAssets.length" class="empty">当前筛选条件下没有可见资产</div>

        <div v-else class="asset-list">
          <article v-for="asset in visibleAssets" :key="asset.id" class="asset-row">
            <div class="asset-main">
              <div class="asset-title">
                <strong>{{ asset.name }}</strong>
                <span :class="['asset-type', asset.type]">{{ typeLabel(asset.type) }}</span>
                <span :class="['status-badge', asset.authStatus, { added: asset.added }]">{{ statusLabel(asset) }}</span>
              </div>
              <p>{{ asset.description }}</p>
              <div class="asset-foot">
                <span>{{ asset.workspaceName }}</span>
                <span>{{ asset.owner }}</span>
                <span>{{ dateLabel(asset.updatedAt) }}</span>
                <span v-for="tag in asset.tags.slice(0, 3)" :key="tag">{{ tag }}</span>
              </div>
            </div>
            <div class="asset-actions">
              <button v-if="asset.actions.includes('ask')" class="primary" type="button" @click="startAsk(asset)">
                开始问数
              </button>
              <button v-if="asset.actions.includes('open')" class="primary" type="button" @click="openAsset(asset)">
                打开
              </button>
              <button v-if="asset.actions.includes('add')" type="button" @click="addAsset(asset)">
                加入我的数据
              </button>
              <button
                v-if="asset.actions.includes('request') && asset.authStatus !== 'pending'"
                class="primary"
                type="button"
                @click="requestAsset = asset"
              >
                申请消费
              </button>
              <button v-if="asset.authStatus === 'pending'" type="button" disabled>申请中</button>
              <button type="button" @click="openAsset(asset)">查看说明</button>
            </div>
          </article>
        </div>
      </section>

      <aside class="plaza-right">
        <section>
          <div class="side-title">下一步</div>
          <div class="next-step">
            <b>先用可问数据集</b>
            <span>看到“开始问数”就可以直接分析，不需要理解后台数据源。</span>
            <button type="button" @click="focusTask('askable')">查看可问</button>
          </div>
          <div class="next-step muted">
            <b>没有合适数据</b>
            <span>申请消费后，资产负责人审批通过才会进入可用范围。</span>
            <button type="button" @click="focusTask('requestable')">去申请</button>
          </div>
        </section>

        <section>
          <div class="side-title">我的数据</div>
          <div v-for="asset in myData.slice(0, 4)" :key="asset.id" class="mini-card">
            <b>{{ asset.name }}</b>
            <span>{{ typeLabel(asset.type) }} · 可消费</span>
          </div>
          <div v-if="!myData.length" class="mini-card muted">暂无已加入资产</div>
        </section>

        <section v-if="requests.length">
          <div class="side-title">申请进度</div>
          <div v-for="req in requests" :key="req.id" class="mini-card">
            <b>{{ req.assetName }}</b>
            <span>{{ req.status === 'pending' ? '审批中' : req.status }} · {{ req.approver }}</span>
          </div>
        </section>
      </aside>
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
  min-height: 100%;
  padding: 22px 28px 40px;
  overflow: auto;
  background: #f6f7fb;
  color: #111827;
}

.plaza-head {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 10px;
  padding: 20px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.head-copy {
  min-width: 0;
}

.head-copy > p {
  margin: 0 0 8px;
  color: #4f46e5;
  font-size: 13px;
  font-weight: 700;
}

.head-copy > h1 {
  margin: 0 0 8px;
  font-size: 28px;
  line-height: 1.1;
}

.head-copy > span {
  display: block;
  max-width: 980px;
  color: #4b5563;
  line-height: 1.7;
}

.task-cards {
  display: grid;
  grid-template-columns: repeat(3, 150px);
  gap: 10px;
  flex-shrink: 0;
}

.task-card {
  min-height: 76px;
  display: grid;
  align-content: center;
  justify-items: start;
  padding: 12px;
  text-align: left;
  background: #f8fafc;
}

.task-card strong {
  font-size: 22px;
  line-height: 1;
}

.task-card span {
  margin-top: 4px;
  color: #111827;
}

.task-card small {
  margin-top: 2px;
  color: #6b7280;
}

.task-card.on {
  border-color: #c7d2fe;
  background: #eef2ff;
  color: #3730a3;
}

button {
  min-height: 34px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  padding: 0 13px;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: #4f46e5;
  color: #4338ca;
}

button:disabled {
  cursor: not-allowed;
  color: #9ca3af;
}

.primary {
  border-color: #4f46e5;
  background: #4f46e5;
  color: #fff;
}

.primary:hover:not(:disabled) {
  background: #4338ca;
  color: #fff;
}

.plaza-grid {
  display: grid;
  grid-template-columns: 240px minmax(720px, 1fr) 300px;
  gap: 16px;
  margin-top: 16px;
  align-items: start;
}

.plaza-side,
.plaza-main,
.plaza-right section {
  border: 1px solid #dfe3ea;
  background: #fff;
  border-radius: 10px;
}

.plaza-side {
  padding: 14px;
  position: sticky;
  top: 0;
}

.side-title {
  font-size: 14px;
  font-weight: 750;
  margin-bottom: 10px;
}

.space-row {
  width: 100%;
  min-height: 42px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 0;
  background: transparent;
  padding: 0 10px;
  color: #4b5563;
}

.space-row.on {
  background: #eef2ff;
  color: #3730a3;
}

.refresh-row {
  width: 100%;
  margin-top: 14px;
  border-top: 1px solid #e5e7eb;
  padding-top: 14px;
}

.plaza-main {
  min-width: 0;
  overflow: hidden;
}

.plaza-toolbar {
  display: flex;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid #dfe3ea;
}

.plaza-toolbar input {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 1px solid #d8dde7;
  border-radius: 8px;
  background: #f7f8fc;
  padding: 0 12px;
  font: inherit;
}

.view-tabs,
.type-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 11px 14px;
  border-bottom: 1px solid #e5e7eb;
}

.view-tabs button,
.type-tabs button {
  min-height: 32px;
  border-radius: 8px;
  background: #fff;
}

.view-tabs button.on,
.type-tabs button.on {
  background: #eef2ff;
  border-color: #c7d2fe;
  color: #3730a3;
}

.type-tabs {
  background: #fbfcff;
}

.type-tabs button {
  min-height: 28px;
  color: #4b5563;
  font-size: 13px;
  font-weight: 600;
}

.asset-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}

.asset-row {
  border: 1px solid #dfe3ea;
  border-radius: 10px;
  background: #fff;
  padding: 14px 14px 14px 16px;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
}

.asset-title,
.asset-foot,
.asset-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.asset-title {
  min-width: 0;
}

.asset-title strong {
  font-size: 16px;
}

.asset-type,
.status-badge,
.asset-foot span {
  border: 1px solid #d8dde7;
  border-radius: 7px;
  padding: 3px 7px;
  color: #4b5563;
  font-size: 12px;
  font-weight: 650;
}

.asset-foot span {
  border: 0;
  background: #f3f4f6;
  color: #4b5563;
}

.asset-type.dataset {
  color: #2563eb;
  border-color: #bfdbfe;
  background: #eff6ff;
}

.asset-type.dashboard {
  color: #16a34a;
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.asset-type.combo {
  color: #c2410c;
  border-color: #fed7aa;
  background: #fff7ed;
}

.status-badge.granted,
.status-badge.added {
  color: #047857;
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.status-badge.requestable {
  color: #92400e;
  border-color: #fed7aa;
  background: #fffbeb;
}

.status-badge.pending {
  color: #4338ca;
  border-color: #c7d2fe;
  background: #eef2ff;
}

.asset-row p {
  margin: 8px 0 10px;
  color: #4b5563;
  line-height: 1.55;
}

.asset-actions {
  justify-content: flex-end;
  min-width: 220px;
}

.plaza-right {
  display: grid;
  gap: 12px;
}

.plaza-right section {
  padding: 14px;
}

.next-step {
  border: 1px solid #dfe3ea;
  border-radius: 8px;
  background: #f8fafc;
  padding: 12px;
}

.next-step + .next-step,
.mini-card {
  margin-top: 8px;
}

.next-step b,
.mini-card b {
  display: block;
  font-size: 14px;
  line-height: 1.25;
}

.next-step span,
.mini-card span {
  display: block;
  margin-top: 5px;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.55;
}

.next-step button {
  margin-top: 10px;
  width: 100%;
}

.mini-card {
  min-height: 54px;
  border: 1px solid #dfe3ea;
  border-radius: 8px;
  background: #f8fafc;
  padding: 10px;
}

.mini-card.muted,
.next-step.muted {
  color: #6b7280;
}

.empty {
  margin: 14px;
  min-height: 220px;
  display: grid;
  place-items: center;
  border: 1px dashed #cfd5df;
  border-radius: 10px;
  color: #6b7280;
  background: #fafbff;
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
  border-radius: 10px;
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
  border-radius: 10px;
  padding: 9px 14px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
}

.page-toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

@media (min-width: 1720px) {
  .plaza-grid {
    grid-template-columns: 250px minmax(860px, 1fr) 320px;
  }
}

@media (max-width: 1180px) {
  .plaza-grid {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .plaza-right {
    grid-column: 1 / -1;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .task-cards {
    grid-template-columns: repeat(3, minmax(120px, 1fr));
  }
}

@media (max-width: 820px) {
  .plaza-page {
    padding: 16px;
  }

  .plaza-head,
  .plaza-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .plaza-grid,
  .plaza-right {
    grid-template-columns: 1fr;
  }

  .task-cards,
  .asset-row {
    grid-template-columns: 1fr;
  }

  .asset-actions {
    min-width: 0;
    justify-content: flex-start;
  }

  .plaza-side {
    position: static;
  }
}
</style>

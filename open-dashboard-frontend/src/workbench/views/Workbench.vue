<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { datasourceApi, datasetApi, type DatasourceVO, type DatasetMetaVO } from '../../datasource/api'
import { dashboardTreeApi } from '../../api/dashboard'
import { conversationApi, type ConversationVO } from '../../conversation/api'
import type { BusiNodeVO, DashboardBarVO, PublishStatus } from '../../types/dashboard'
import RecentDashCover, { type CoverDomain } from '../components/RecentDashCover.vue'
import { hasStoredPermission } from '../../api/http'

const ASK_Q = 'od.ask.q'
const ASK_DRAFT = 'od.ask.draft'
const ASK_AUTORUN = 'od.ask.autorun'

const router = useRouter()
const route = useRoute()

const loading = ref(false)
const error = ref('')
const toast = ref('')
const ask = ref('')
const askInput = ref<HTMLInputElement | null>(null)

const datasources = ref<DatasourceVO[]>([])
const datasets = ref<DatasetMetaVO[]>([])
const dashTotal = ref(0)
const dashBars = ref<DashboardBarVO[]>([])
const folderById = ref<Record<string, string>>({})
const conversations = ref<ConversationVO[]>([])
const convError = ref('')

const EXAMPLES = ['本月各区域 GMV 环比？', '库存周转超过 30 天的 SKU', '今年收入多少']

const emptyForced = computed(() => String(route.query.state || '') === 'empty')
const countParam = computed(() => {
  const n = Number.parseInt(String(route.query.count || ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
})
const emptyMode = computed(
  () => emptyForced.value || (!loading.value && !datasources.value.length && !dashBars.value.length && !datasets.value.length)
)

const srcOk = computed(() => datasources.value.filter((s) => s.status === 'ok').length)
const srcPending = computed(() => datasources.value.length - srcOk.value)
const dirty = computed(() => dashBars.value.filter((d) => d.status === 'publishedWithDraft').length)
const canManageDatasource = computed(() => hasStoredPermission('datasource:manage') || hasStoredPermission('dataset:manage'))
const todoCount = computed(() => dirty.value + (canManageDatasource.value ? srcPending.value : 0))

const hello = computed(() => {
  const h = new Date().getHours()
  const part = h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好'
  return emptyMode.value ? '欢迎使用 DataQ' : `${part}，继续分析`
})
const subtitle = computed(() =>
  emptyMode.value ? '连接业务数据，完成你的第一次分析' : '用一句话问数，或从最近看板接着看'
)

const lastSync = computed(() => {
  const times = [
    ...datasources.value.map((s) => s.updateTime || 0),
    ...dashBars.value.map((d) => d.updateTime || 0)
  ].filter((t) => t > 0)
  if (!times.length) return ''
  const d = new Date(Math.max(...times))
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === new Date().toDateString()) return `今天 ${hm}`
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
})

const DESKTOP_RECENT = 3

const recentDashboards = computed(() => {
  const sorted = [...dashBars.value].sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))
  if (emptyForced.value) return []
  const cap = countParam.value != null && countParam.value < DESKTOP_RECENT ? countParam.value : DESKTOP_RECENT
  return sorted.slice(0, cap)
})

const showCreateCard = computed(() => {
  if (emptyMode.value) return false
  const n = recentDashboards.value.length
  return n > 0 && n < DESKTOP_RECENT
})

const recentAsks = computed(() => {
  if (emptyMode.value) return []
  return [...conversations.value]
    .filter((c) => {
      const t = (c.title || '').trim()
      return t && t !== '新对话'
    })
    .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))
    .slice(0, 3)
})

const continueAskTo = computed(() =>
  recentAsks.value[0] ? `/conversations/${recentAsks.value[0].id}` : '/conversations'
)

type TodoItem = {
  key: string
  to?: string
  mark: 'warn' | 'info'
  strong: string
  rest: string
  ask?: string
}

const todos = computed<TodoItem[]>(() => {
  if (emptyMode.value) return []
  const items: TodoItem[] = []
  if (dirty.value) {
    items.push({
      key: 'dirty',
      to: '/dashboards',
      mark: 'warn',
      strong: `${dirty.value} 个看板`,
      rest: '有未发布改动'
    })
  }
  if (canManageDatasource.value && srcPending.value) {
    items.push({
      key: 'src',
      to: '/datasources',
      mark: 'warn',
      strong: `${srcPending.value} 个数据源`,
      rest: '待处理'
    })
  }
  items.push({
    key: 'try',
    mark: 'info',
    strong: '今年收入多少',
    rest: '',
    ask: '今年收入多少'
  })
  return items
})

const briefs = computed(() => {
  const items: Array<{ to: string; text: string }> = []
  if (dirty.value) items.push({ to: '/dashboards', text: `${dirty.value} 个看板有未发布改动` })
  if (canManageDatasource.value && srcPending.value) {
    items.push({ to: '/datasources', text: `${srcPending.value} 个数据源待处理` })
  }
  if (datasets.value.length && items.length < 2) {
    items.push({ to: '/conversations', text: `已准备 ${datasets.value.length} 个数据集，可以直接问数` })
  }
  return items.slice(0, 2)
})

function flash(msg: string) {
  toast.value = msg
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 2200)
}

function flattenDashboards(nodes: BusiNodeVO[], parentName = '未分组'): Array<{ id: string; folder: string }> {
  const out: Array<{ id: string; folder: string }> = []
  for (const n of nodes) {
    if (n.nodeType === 'folder') {
      const name = n.name || '未分组'
      if (n.children?.length) out.push(...flattenDashboards(n.children, name))
    } else if (n.nodeType === 'dashboard') {
      out.push({ id: n.id, folder: parentName })
    }
  }
  return out
}

function formatShortTime(t?: number) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function statusLabel(s?: PublishStatus | string) {
  if (s === 'published') return '已发布'
  if (s === 'publishedWithDraft') return '有未发布改动'
  return '草稿'
}

function statusDot(s?: PublishStatus | string) {
  if (s === 'published') return 'pub'
  if (s === 'publishedWithDraft') return 'dirty'
  return ''
}

function hashDomain(id: string): CoverDomain {
  const fallback: CoverDomain[] = ['analysis', 'ops', 'sales', 'finance']
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return fallback[h % fallback.length]
}

function coverDomain(d: DashboardBarVO): CoverDomain {
  const t = `${d.name || ''} ${folderById.value[d.id] || ''}`
  if (/对话|问数|sqlbot/i.test(t)) return 'ask'
  if (/销售|gmv|区域|渠道|营收/i.test(t)) return 'sales'
  if (/财务|收入|利润|费用|资金|结算/i.test(t)) return 'finance'
  if (/订单|交易|客户|履约/i.test(t)) return 'orders'
  if (/库存|供应链|sku|仓储|周转/i.test(t)) return 'supply'
  if (/运营|活动|监控|企业|人效|经营/i.test(t)) return 'ops'
  return hashDomain(d.id)
}

function askMeta(c: ConversationVO) {
  return c.linkedDashboardId ? '已关联看板' : '会话结果 · 未写入看板'
}

async function load(opts?: { quiet?: boolean }) {
  loading.value = true
  error.value = ''
  try {
    const [srcsR, dtsR, treeR, convR] = await Promise.allSettled([
      canManageDatasource.value ? datasourceApi.list() : Promise.resolve([] as DatasourceVO[]),
      datasetApi.listAskable(),
      dashboardTreeApi.tree({}),
      conversationApi.list(8)
    ])

    const errs: string[] = []
    if (srcsR.status === 'fulfilled') datasources.value = srcsR.value
    else {
      datasources.value = []
      errs.push(srcsR.reason instanceof Error ? srcsR.reason.message : String(srcsR.reason))
    }
    if (dtsR.status === 'fulfilled') datasets.value = dtsR.value
    else {
      datasets.value = []
      errs.push(dtsR.reason instanceof Error ? dtsR.reason.message : String(dtsR.reason))
    }
    if (convR.status === 'fulfilled') {
      conversations.value = Array.isArray(convR.value) ? convR.value : []
      convError.value = ''
    } else {
      conversations.value = []
      convError.value = convR.reason instanceof Error ? convR.reason.message : String(convR.reason)
      errs.push(`最近问数：${convError.value}`)
    }

    if (treeR.status === 'fulfilled') {
      const flat = flattenDashboards(treeR.value)
      dashTotal.value = flat.length
      const map: Record<string, string> = {}
      for (const f of flat) map[f.id] = f.folder
      folderById.value = map
      const candidates = flat.slice(0, 20)
      const bars = await Promise.all(
        candidates.map(async (c) => {
          try {
            return await dashboardTreeApi.barInfo(c.id)
          } catch {
            return {
              id: c.id,
              name: c.id,
              nodeType: 'dashboard' as const,
              status: 'draft' as PublishStatus,
              chartCount: 0
            }
          }
        })
      )
      dashBars.value = bars
    } else {
      dashTotal.value = 0
      dashBars.value = []
      folderById.value = {}
      errs.push(treeR.reason instanceof Error ? treeR.reason.message : String(treeR.reason))
    }

    if (errs.length) error.value = errs[0]
    else if (!opts?.quiet) flash('工作台数据已刷新')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function persistAsk(q: string) {
  sessionStorage.setItem(ASK_Q, q)
  sessionStorage.setItem(ASK_DRAFT, q)
  sessionStorage.setItem(ASK_AUTORUN, '1')
}

function openAsk(c: ConversationVO) {
  void router.push(`/conversations/${c.id}`)
}

function goAsk(preset?: string) {
  if (preset) ask.value = preset
  const q = ask.value.trim()
  if (!q) {
    askInput.value?.focus()
    flash('请先输入一个数据问题')
    return
  }
  persistAsk(q)
  if (emptyMode.value) {
    flash('请先连接数据源，问题已为你保留')
    window.setTimeout(() => {
      void router.push('/datasources')
    }, 400)
    return
  }
  void router.push({ path: '/conversations', query: { q, autorun: '1' } })
}

function onTodoClick(item: TodoItem, e: Event) {
  if (item.ask) {
    e.preventDefault()
    goAsk(item.ask)
  }
}

function createDash() {
  void router.push('/dashboards')
}

function onKey(e: KeyboardEvent) {
  const el = askInput.value
  if (
    e.key === '/' &&
    document.activeElement !== el &&
    !(document.activeElement instanceof HTMLInputElement) &&
    !(document.activeElement instanceof HTMLTextAreaElement)
  ) {
    e.preventDefault()
    el?.focus()
  }
  if (e.key === 'Escape' && document.activeElement === el && ask.value) {
    ask.value = ''
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  void load({ quiet: true })
})
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="wb-stage">
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <p v-if="error" class="banner-err">{{ error }}</p>
    <div class="wb-home">
      <div class="wb-layout">
        <div class="wb-main">
          <div class="wb-hero">
            <div class="wb-greet">
              <h1 class="hello">{{ hello }}</h1>
              <div class="sub">{{ subtitle }}</div>
              <div class="wb-stats" aria-label="工作台摘要">
                <template v-if="emptyMode">
                  <span class="wb-stat"><b>1</b> 连接数据源</span>
                  <span class="wb-stat"><b>2</b> 准备数据集</span>
                  <span class="wb-stat"><b>3</b> 问数或建看板</span>
                </template>
                <template v-else>
                  <span class="wb-stat"><b>{{ dashTotal }}</b> 个仪表盘</span>
                  <span class="wb-stat"><b>{{ datasets.length }}</b> 个可问数据集</span>
                  <span v-if="canManageDatasource || dirty" class="wb-stat"><b>{{ todoCount }}</b> 项待处理</span>
                </template>
              </div>
            </div>
            <div class="wb-search" role="search">
              <span class="ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
              </span>
              <input
                ref="askInput"
                v-model="ask"
                type="search"
                aria-label="输入想分析的数据问题"
                :placeholder="emptyMode ? '连接数据源后，即可用自然语言问数' : '用自然语言问数，例如：本月华东 GMV 环比多少？'"
                @keydown.enter.prevent="goAsk()"
              />
              <button class="go" type="button" @click="goAsk()">{{ emptyMode ? '开始配置' : '问数' }}</button>
            </div>
            <div class="wb-examples">
              <span>试试</span>
              <button v-for="q in EXAMPLES" :key="q" type="button" @click="goAsk(q)">{{ q }}</button>
            </div>
          </div>

          <section class="wb-block wb-common">
            <div class="wb-block-hd"><h3>常用</h3></div>
            <div class="wb-apps">
              <router-link class="wb-app" to="/conversations">
                <div class="icon c1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </div>
                <div class="label">对话分析</div>
              </router-link>
              <router-link class="wb-app" to="/dashboards">
                <div class="icon c2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <div class="label">新建看板</div>
              </router-link>
              <router-link class="wb-app" to="/data-plaza">
                <div class="icon c3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 7h16l-1 13H5L4 7z" />
                    <path d="M8 7a4 4 0 0 1 8 0" />
                    <path d="M8 12h8M8 16h5" />
                  </svg>
                </div>
                <div class="label">数据广场</div>
              </router-link>
              <router-link class="wb-app" to="/datasets">
                <div class="icon c4">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 6h16M4 12h16M4 18h10" />
                  </svg>
                </div>
                <div class="label">我的数据</div>
              </router-link>
              <router-link class="wb-app" to="/dashboards">
                <div class="icon c5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="9" rx="1.5" />
                    <rect x="14" y="3" width="7" height="5" rx="1.5" />
                    <rect x="14" y="12" width="7" height="9" rx="1.5" />
                    <rect x="3" y="16" width="7" height="5" rx="1.5" />
                  </svg>
                </div>
                <div class="label">仪表盘</div>
              </router-link>
              <router-link class="wb-app" to="/reports">
                <div class="icon c6">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <div class="label">在线报告</div>
              </router-link>
            </div>
          </section>

          <section class="wb-block" id="wbRecentSection">
            <div class="wb-block-hd">
              <h3>{{ emptyMode ? '开始搭建工作区' : '最近打开' }}</h3>
              <router-link v-if="!emptyMode" class="link" to="/dashboards">全部</router-link>
            </div>
            <div v-if="emptyMode" class="wb-empty">
              <div class="wb-empty-visual" aria-hidden="true">
                <svg viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="3">
                  <ellipse cx="48" cy="26" rx="25" ry="10" />
                  <path d="M23 26v20c0 5.5 11.2 10 25 10s25-4.5 25-10V26" />
                  <path d="M23 46v20c0 5.5 11.2 10 25 10s25-4.5 25-10V46" />
                  <path d="M73 58h12M79 52v12" />
                </svg>
              </div>
              <div class="wb-empty-copy">
                <h4>先连接一个数据源</h4>
                <p>支持数据库、文件和业务系统。连接后即可创建数据集，用自然语言问数或生成第一个仪表盘。</p>
                <div class="wb-onboard-steps">
                  <div class="wb-onboard-step"><i>1</i><span>连接并验证数据源</span></div>
                  <div class="wb-onboard-step"><i>2</i><span>选择字段，准备分析数据集</span></div>
                  <div class="wb-onboard-step"><i>3</i><span>开始问数或创建仪表盘</span></div>
                </div>
                <div class="wb-empty-actions">
                  <router-link class="primary" to="/datasources">连接数据源</router-link>
                  <router-link to="/conversations">查看问数示例</router-link>
                </div>
              </div>
            </div>
            <div v-else class="wb-dash-grid">
              <router-link
                v-for="d in recentDashboards"
                :key="d.id"
                class="wb-dash"
                :to="`/dashboards/${d.id}/edit`"
              >
                <RecentDashCover :domain="coverDomain(d)" />
                <div class="meta">
                  <div class="name">{{ d.name }}</div>
                  <div class="desc">
                    <span class="dot-st" :class="statusDot(d.status)" />
                    <span>{{ folderById[d.id] || '未分组' }} · {{ statusLabel(d.status) }}</span>
                  </div>
                </div>
              </router-link>
              <button v-if="showCreateCard" class="wb-dash-create" type="button" @click="createDash">
                <i aria-hidden="true">+</i>
                <b>创建新看板</b>
                <span>从数据集开始搭建</span>
              </button>
              <div v-if="!recentDashboards.length" class="wb-empty-note">
                <b>还没有仪表盘</b>
                可以先问数，满意后再保存生成仪表盘
              </div>
            </div>
          </section>
        </div>

        <aside class="wb-aside" aria-label="工作概览与最近活动">
          <section class="wb-panel wb-overview-panel" id="wbOverviewPanel">
            <div class="phd">
              <h4>今日概览</h4>
              <button class="link" type="button" :disabled="loading" @click="load()">
                {{ loading ? '同步中…' : '刷新' }}
              </button>
            </div>
            <div class="wb-kpis">
              <router-link v-if="canManageDatasource" class="wb-kpi" to="/datasources">
                <span>数据源状态</span>
                <strong>{{ emptyMode ? '0 / 0' : `${srcOk} / ${datasources.length || 0}` }}</strong>
                <small :class="emptyMode ? '' : srcPending ? 'warn' : 'ok'">
                  {{ emptyMode ? '尚未连接数据源' : srcPending ? `${srcPending} 个待处理` : '全部连接正常' }}
                </small>
              </router-link>
              <router-link v-else class="wb-kpi" to="/data-plaza">
                <span>可问数据集</span>
                <strong>{{ emptyMode ? 0 : datasets.length }}</strong>
                <small>{{ emptyMode ? '连接数据后可问数' : datasets.length ? '可直接进入问数' : '暂无可问数据' }}</small>
              </router-link>
              <router-link class="wb-kpi" to="/dashboards">
                <span>待发布看板</span>
                <strong>{{ emptyMode ? 0 : dirty }}</strong>
                <small :class="emptyMode ? '' : dirty ? 'warn' : ''">
                  {{ emptyMode ? '暂无仪表盘' : dirty ? '存在未发布改动' : '没有待发布改动' }}
                </small>
              </router-link>
            </div>
            <div class="wb-health">
              <span v-if="emptyMode">
                <i class="faint" aria-hidden="true" />等待首次配置
              </span>
              <span v-else>
                <i aria-hidden="true" />数据已同步
              </span>
              <b v-if="!emptyMode && lastSync">{{ lastSync }}</b>
            </div>
            <div class="wb-briefs" aria-label="近期业务动态">
              <span>{{ emptyMode ? '新手提示' : '近期动态' }}</span>
              <template v-if="emptyMode">
                <router-link to="/datasources">连接数据后，这里会展示异常和增长线索</router-link>
              </template>
              <template v-else-if="briefs.length">
                <template v-for="(b, i) in briefs" :key="b.text">
                  <i v-if="i > 0" aria-hidden="true" />
                  <router-link :to="b.to">{{ b.text }}</router-link>
                </template>
              </template>
              <router-link v-else to="/conversations">还没有可跟进的事项，先问一个数据问题</router-link>
            </div>
          </section>

          <section class="wb-panel" id="wbTodoPanel">
            <div class="phd"><h4>待处理</h4></div>
            <template v-if="emptyMode || (!dirty && !(canManageDatasource && srcPending) && !todos.length)">
              <div class="wb-empty-note">
                <b>目前没有待处理事项</b>
                完成数据连接后，异常和提醒会出现在这里
              </div>
            </template>
            <template v-else>
              <component
                :is="item.to ? 'router-link' : 'button'"
                v-for="item in todos"
                :key="item.key"
                class="wb-todo"
                :to="item.to"
                :type="item.to ? undefined : 'button'"
                @click="onTodoClick(item, $event)"
              >
                <span class="mark" :class="item.mark" />
                <span class="txt">
                  <template v-if="item.ask">试问：<b>{{ item.strong }}</b></template>
                  <template v-else><b>{{ item.strong }}</b> {{ item.rest }}</template>
                </span>
              </component>
            </template>
          </section>

          <section class="wb-panel" id="wbRecentAskPanel">
            <div class="phd">
              <h4>最近问数</h4>
              <router-link v-if="!emptyMode && recentAsks.length" class="link" :to="continueAskTo">继续</router-link>
            </div>
            <div v-if="convError" class="wb-empty-note">
              <b>问数记录暂时读不到</b>
              点概览「刷新」重试
            </div>
            <div v-else-if="emptyMode || !recentAsks.length" class="wb-empty-note">
              <b>还没有问数记录</b>
              你的分析历史会保存在这里
            </div>
            <template v-else>
              <router-link
                v-for="c in recentAsks"
                :key="c.id"
                class="wb-row"
                :to="`/conversations/${c.id}`"
                @click.prevent="openAsk(c)"
              >
                <div class="av">问</div>
                <div class="body">
                  <div class="t">{{ c.title || '未命名对话' }}</div>
                  <div class="m">{{ askMeta(c) }}</div>
                </div>
                <div v-if="c.updateTime" class="side">
                  <div class="num">{{ formatShortTime(c.updateTime) }}</div>
                </div>
              </router-link>
            </template>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wb-stage {
  height: 100%;
  overflow: auto;
  background: var(--od-bg, #f6f7fb);
  color: var(--od-ink, #111827);
}
.wb-home {
  max-width: none;
  padding: 24px 32px 40px;
}
.wb-layout {
  display: grid;
  grid-template-columns: minmax(680px, 1.65fr) minmax(320px, 0.72fr);
  grid-template-areas:
    'hero overview'
    'common todo'
    'recent asks';
  column-gap: 24px;
  row-gap: 22px;
  align-items: start;
}
.wb-main,
.wb-aside {
  display: contents;
}
.wb-hero {
  grid-area: hero;
  max-width: none;
  margin: 0;
  padding: 24px 28px 22px;
  border: 1px solid #dfe4f2;
  border-radius: 20px;
  background:
    radial-gradient(circle at 92% 0, rgba(99, 102, 241, 0.14), transparent 34%),
    linear-gradient(135deg, #fff 0%, #f8f9ff 100%);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03);
}
.wb-greet {
  margin-bottom: 16px;
}
.hello {
  margin: 0;
  font-size: clamp(26px, 2.2vw, 34px);
  font-weight: 720;
  letter-spacing: -0.035em;
  line-height: 1.2;
}
.sub {
  margin-top: 10px;
  font-size: 15px;
  color: var(--od-muted, #4b5563);
  line-height: 1.6;
}
.wb-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--od-muted, #4b5563);
  letter-spacing: -0.01em;
}
.wb-stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 3px 10px;
  border: 1px solid #e1e5f2;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.76);
}
.wb-stats b {
  color: #3730a3;
  font-weight: 700;
}
.wb-search {
  display: flex;
  align-items: center;
  height: 54px;
  padding: 5px 5px 5px 16px;
  background: var(--od-card, #fff);
  border-radius: 13px;
  border: 1px solid #cfd5e2;
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.05);
}
.wb-search:focus-within {
  border-color: #6366f1;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.14), 0 4px 14px rgba(17, 24, 39, 0.07);
}
.wb-search .ico {
  width: 18px;
  color: var(--od-faint, #6b7280);
  display: grid;
  place-items: center;
}
.wb-search .ico svg {
  width: 16px;
  height: 16px;
}
.wb-search input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 15px;
  margin: 0 12px;
  min-width: 0;
  color: inherit;
  font-family: inherit;
}
.wb-search .go {
  height: 42px;
  min-width: 76px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: var(--od-brand, #4f46e5);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 0 4px 10px rgba(79, 70, 229, 0.22);
}
.wb-search .go:hover {
  background: var(--od-brand-hover, #4338ca);
}
.wb-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.wb-examples span {
  font-size: 13px;
  color: var(--od-faint, #6b7280);
  align-self: center;
  margin-right: 2px;
}
.wb-examples button {
  min-height: 30px;
  border: 1px solid #e1e5eb;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--od-muted, #4b5563);
  font-size: 13px;
  padding: 4px 9px;
  cursor: pointer;
  font-family: inherit;
}
.wb-examples button:hover {
  color: #3730a3;
  border-color: #a5b4fc;
  background: #fff;
}
.wb-block {
  margin: 0;
}
.wb-common {
  grid-area: common;
}
#wbRecentSection {
  grid-area: recent;
}
#wbOverviewPanel {
  grid-area: overview;
  align-self: stretch;
}
#wbTodoPanel {
  grid-area: todo;
  align-self: stretch;
}
#wbRecentAskPanel {
  grid-area: asks;
  align-self: stretch;
}
.wb-block-hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
}
.wb-block-hd h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.link,
.phd .link {
  min-height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--od-brand, #4f46e5);
  font-size: 14px;
  font-weight: 600;
  padding: 5px 8px;
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
}
.link:hover,
.phd .link:hover {
  color: var(--od-ink, #111827);
}
.wb-apps {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr));
  gap: 12px;
}
.wb-app {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 66px;
  padding: 10px 12px;
  border: 1px solid var(--od-line, #dfe3ea);
  background: var(--od-card, #fff);
  border-radius: 12px;
  color: inherit;
  text-decoration: none;
  font: inherit;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03);
  cursor: pointer;
}
.wb-app:hover {
  border-color: #c7d2fe;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
  transform: translateY(-2px);
}
.wb-app .icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: #eef2ff;
  color: #4f46e5;
  flex-shrink: 0;
}
.wb-app .icon svg {
  width: 16px;
  height: 16px;
}
.wb-app .icon.c2 {
  background: #ecfdf5;
  color: #047857;
}
.wb-app .icon.c3 {
  background: #eff6ff;
  color: #1d4ed8;
}
.wb-app .icon.c4 {
  background: #fff7ed;
  color: #c2410c;
}
.wb-app .icon.c5 {
  background: #f5f3ff;
  color: #7c3aed;
}
.wb-app .icon.c6 {
  background: #fdf2f8;
  color: #be185d;
}
.wb-app .label {
  font-size: 14px;
  font-weight: 650;
}
.wb-dash-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.wb-dash {
  display: flex;
  flex-direction: column;
  background: var(--od-card, #fff);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--od-line, #dfe3ea);
  color: inherit;
  text-decoration: none;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03);
}
.wb-dash:hover {
  border-color: #a5b4fc;
  box-shadow: 0 10px 28px rgba(17, 24, 39, 0.08);
  transform: translateY(-3px);
}
.wb-dash .meta {
  padding: 14px 16px 16px;
}
.wb-dash .name {
  font-size: 15px;
  font-weight: 680;
  letter-spacing: -0.015em;
}
.wb-dash .desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--od-muted, #4b5563);
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot-st {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d4d4d8;
}
.dot-st.pub {
  background: #047857;
}
.dot-st.dirty {
  background: #d97706;
}
.wb-dash-create {
  min-height: 189px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px dashed #c7cdd8;
  border-radius: 10px;
  color: var(--od-muted, #4b5563);
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.wb-dash-create:hover {
  border-color: #818cf8;
  color: var(--od-brand, #4f46e5);
  background: var(--od-brand-soft, #eef2ff);
}
.wb-dash-create i {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--od-brand-soft, #eef2ff);
  color: var(--od-brand, #4f46e5);
  font-style: normal;
  font-size: 22px;
}
.wb-panel {
  background: var(--od-card, #fff);
  border-radius: 14px;
  padding: 4px 6px 10px;
  border: 1px solid var(--od-line, #dfe3ea);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03);
}
.phd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 8px;
}
.phd h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 680;
}
.wb-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 12px;
  width: 100%;
  text-decoration: none;
  color: inherit;
  border-radius: 8px;
}
.wb-row:hover {
  background: #f7f7fb;
}
.wb-row .av {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  background: #eef2ff;
  color: #4338ca;
  flex-shrink: 0;
}
.wb-row .body {
  flex: 1;
  min-width: 0;
}
.wb-row .t {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-row .m {
  font-size: 12.5px;
  color: var(--od-faint, #6b7280);
  margin-top: 3px;
}
.wb-row .side {
  flex-shrink: 0;
  text-align: right;
}
.wb-row .side .num {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--od-muted, #4b5563);
  font-variant-numeric: tabular-nums;
}
.wb-todo {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  min-height: 42px;
  padding: 9px 12px;
  margin: 0 2px;
  border-radius: 8px;
  width: calc(100% - 4px);
  text-decoration: none;
  color: inherit;
  background: transparent;
  border: 0;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.wb-todo:hover {
  background: #f7f7fb;
}
.mark {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 7px;
  flex-shrink: 0;
  background: #d4d4d8;
}
.mark.warn {
  background: #d97706;
}
.mark.info {
  background: var(--od-ink, #111827);
}
.wb-todo .txt {
  font-size: 14px;
  color: var(--od-muted, #4b5563);
  line-height: 1.55;
}
.wb-todo .txt b {
  color: var(--od-ink, #111827);
  font-weight: 600;
}
.wb-kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 4px 12px 12px;
}
.wb-kpi {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 11px;
  background: var(--od-bg, #f6f7fb);
  color: inherit;
  text-decoration: none;
}
.wb-kpi:hover {
  border-color: #a5b4fc;
  background: var(--od-brand-soft, #eef2ff);
}
.wb-kpi span {
  display: block;
  font-size: 12.5px;
  color: var(--od-muted, #4b5563);
}
.wb-kpi strong {
  display: block;
  margin-top: 6px;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 740;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.wb-kpi small {
  display: block;
  margin-top: 7px;
  font-size: 12px;
  color: var(--od-faint, #6b7280);
}
.wb-kpi small.ok {
  color: #047857;
}
.wb-kpi small.warn {
  color: #d97706;
}
.wb-health {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 12px 8px;
  padding: 12px 2px 4px;
  border-top: 1px solid var(--od-line, #dfe3ea);
  font-size: 12.5px;
  color: var(--od-faint, #6b7280);
}
.wb-health span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.wb-health i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #047857;
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.12);
}
.wb-health i.faint {
  background: var(--od-faint, #6b7280);
  box-shadow: none;
}
.wb-health b {
  color: var(--od-muted, #4b5563);
  font-weight: 600;
}
.wb-briefs {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding-top: 9px;
  border-top: 1px solid var(--od-line, #dfe3ea);
  white-space: nowrap;
  overflow: hidden;
}
.wb-briefs > span {
  flex-shrink: 0;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--od-brand-soft, #eef2ff);
  color: var(--od-brand, #4f46e5);
  font-size: 11px;
  font-weight: 700;
}
.wb-briefs a {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--od-muted, #4b5563);
  text-decoration: none;
  font-size: 12px;
}
.wb-briefs a:hover {
  color: var(--od-brand, #4f46e5);
}
.wb-briefs i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--od-faint, #6b7280);
  flex-shrink: 0;
}
.wb-empty {
  grid-column: 1 / -1;
  min-height: 280px;
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.1fr);
  gap: 28px;
  align-items: center;
  padding: 32px;
  border: 1px dashed #c7cdd8;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--od-card, #fff), var(--od-bg, #f6f7fb));
}
.wb-empty-visual {
  min-height: 190px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background:
    radial-gradient(circle at 50% 35%, rgba(99, 102, 241, 0.16), transparent 38%),
    var(--od-brand-soft, #eef2ff);
}
.wb-empty-visual svg {
  width: 76px;
  height: 76px;
  color: var(--od-brand, #4f46e5);
}
.wb-empty-copy h4 {
  margin: 0;
  font-size: 20px;
  font-weight: 720;
  letter-spacing: -0.025em;
}
.wb-empty-copy > p {
  margin-top: 9px;
  color: var(--od-muted, #4b5563);
  font-size: 14px;
  line-height: 1.65;
}
.wb-onboard-steps {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 20px;
}
.wb-onboard-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: var(--od-muted, #4b5563);
}
.wb-onboard-step i {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--od-brand-soft, #eef2ff);
  color: var(--od-brand, #4f46e5);
  font-style: normal;
  font-weight: 700;
  font-size: 12px;
}
.wb-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}
.wb-empty-actions a {
  min-height: 40px;
  padding: 0 15px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--od-line, #dfe3ea);
  color: var(--od-ink, #111827);
  background: var(--od-card, #fff);
  text-decoration: none;
  font-size: 14px;
  font-weight: 650;
}
.wb-empty-actions a.primary {
  border-color: var(--od-brand, #4f46e5);
  background: var(--od-brand, #4f46e5);
  color: #fff;
}
.wb-empty-note {
  grid-column: 1 / -1;
  padding: 22px 16px;
  text-align: center;
  color: var(--od-faint, #6b7280);
  font-size: 13px;
  line-height: 1.6;
}
.wb-empty-note b {
  display: block;
  color: var(--od-muted, #4b5563);
  font-size: 14px;
  margin-bottom: 3px;
}
.banner-err {
  margin: 0;
  padding: 8px 32px;
  background: #fff1f0;
  color: #cf1322;
  font-size: 13px;
}
.toast {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  padding: 8px 14px;
  border-radius: 8px;
  background: #1f2329;
  color: #fff;
  font-size: 13px;
}

html[data-od-theme='dark'] .wb-hero {
  border-color: #343846;
  background:
    radial-gradient(circle at 92% 0, rgba(99, 102, 241, 0.2), transparent 34%),
    linear-gradient(135deg, #1a1d24 0%, #171922 100%);
}
html[data-od-theme='dark'] .wb-stat,
html[data-od-theme='dark'] .wb-examples button {
  border-color: #353946;
  background: rgba(24, 27, 34, 0.72);
}
html[data-od-theme='dark'] .wb-stats b,
html[data-od-theme='dark'] .wb-examples button:hover {
  color: #c7d2fe;
}
html[data-od-theme='dark'] .wb-search {
  border-color: #3d4250;
}
html[data-od-theme='dark'] .wb-app:hover,
html[data-od-theme='dark'] .wb-row:hover,
html[data-od-theme='dark'] .wb-todo:hover {
  background: #27272a;
}
html[data-od-theme='dark'] .wb-app .icon,
html[data-od-theme='dark'] .wb-row .av {
  background: #27272a;
  color: #d4d4d8;
}
html[data-od-theme='dark'] .wb-kpi {
  background: #161920;
}
html[data-od-theme='dark'] .wb-kpi:hover {
  background: rgba(99, 102, 241, 0.15);
}
html[data-od-theme='dark'] .wb-empty {
  border-color: #3d4451;
}
html[data-od-theme='dark'] .wb-dash-create {
  border-color: #3d4451;
}
html[data-od-theme='dark'] .wb-search .go {
  background: #fafafa;
  color: #18181b;
}

@media (max-width: 1180px) {
  .wb-layout {
    grid-template-columns: 1fr;
    grid-template-areas:
      'hero'
      'overview'
      'common'
      'todo'
      'recent'
      'asks';
  }
}
@media (max-width: 960px) {
  .wb-apps {
    grid-template-columns: repeat(2, minmax(150px, 1fr));
  }
  .wb-dash-grid {
    grid-template-columns: repeat(2, minmax(190px, 1fr));
  }
  .wb-dash-grid .wb-dash:nth-child(n + 3) {
    display: none;
  }
  .wb-empty {
    grid-template-columns: 1fr;
  }
  .wb-empty-visual {
    min-height: 140px;
  }
  .wb-hero {
    padding: 24px;
  }
  .wb-home {
    padding: 24px 20px 48px;
  }
}
@media (max-width: 560px) {
  .wb-hero {
    padding: 20px 16px;
    border-radius: 16px;
  }
  .wb-search {
    height: auto;
    min-height: 52px;
    flex-wrap: wrap;
  }
  .wb-search .go {
    width: 100%;
    margin-top: 4px;
  }
  .wb-apps,
  .wb-dash-grid,
  .wb-kpis {
    grid-template-columns: 1fr;
  }
  .wb-empty {
    padding: 20px;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ModuleTopbar from '../../shell/ModuleTopbar.vue'
import { datasourceApi, datasetApi, type DatasourceVO, type DatasetMetaVO } from '../../datasource/api'
import { dashboardTreeApi } from '../../api/dashboard'
import { reportApi } from '../../report/api/report'
import type { BusiNodeVO, DashboardBarVO, PublishStatus } from '../../types/dashboard'
import type { ReportMetaVO } from '../../report/types'

const router = useRouter()

const loading = ref(false)
const creating = ref(false)
const error = ref('')
const toast = ref('')

const datasources = ref<DatasourceVO[]>([])
const datasets = ref<DatasetMetaVO[]>([])
const reports = ref<ReportMetaVO[]>([])
const dashTotal = ref(0)
const dashBars = ref<DashboardBarVO[]>([])
const folderById = ref<Record<string, string>>({})

const PIPE = [
  { go: '/datasources', n: '01', t: '接入数据源', d: 'MySQL / PG / API / Excel · 测连通' },
  { go: '/datasets', n: '02', t: '维护数据集', d: '选表 · 字段语义 · 预览取数' },
  { go: '/dashboards', n: '03', t: '配置仪表盘', d: '绑定数据集 · 编码槽 · 发布分享' },
  { go: '/reports', n: '04', t: '撰写报告', d: 'Umo 排版 · 引用看板图 / 新建图' }
] as const

const srcOk = computed(() => datasources.value.filter((s) => s.status === 'ok').length)
const srcPending = computed(() => datasources.value.length - srcOk.value)

const pubs = computed(
  () => dashBars.value.filter((d) => d.status === 'published' || d.status === 'publishedWithDraft').length
)
const dirty = computed(() => dashBars.value.filter((d) => d.status === 'publishedWithDraft').length)

const datasetHint = computed(() => {
  const folders = [
    ...new Set(datasets.value.map((d) => d.folder).filter((f): f is string => !!f && f.trim().length > 0))
  ]
  if (folders.length) return `覆盖 ${folders.slice(0, 5).join(' / ')}`
  return datasets.value.length ? `已配置 ${datasets.value.length} 个` : '暂无数据集'
})

const recentDashboards = computed(() =>
  [...dashBars.value]
    .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))
    .slice(0, 5)
)

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

function statusLabel(s?: PublishStatus | string) {
  if (s === 'published') return '已发布'
  if (s === 'publishedWithDraft') return '已发布·有未发布改动'
  return '草稿'
}

function statusClass(s?: PublishStatus | string) {
  if (s === 'published') return 'pub'
  if (s === 'publishedWithDraft') return 'dirty'
  return 'draft'
}

function srcStatusLabel(s?: string) {
  if (s === 'ok') return '连通'
  if (s === 'warn') return '告警'
  if (s === 'unknown') return '未测通'
  return '异常'
}

function srcStatusClass(s?: string) {
  if (s === 'ok') return 'ok'
  if (s === 'warn') return 'warn'
  if (s === 'unknown') return 'warn'
  return 'err'
}

function srcIcoBg(s?: string) {
  if (s === 'ok') return '#e3f7ef'
  if (s === 'warn' || s === 'unknown') return '#fff7ed'
  return '#fef2f2'
}

function typeShort(t: string) {
  return (t || '??').slice(0, 2).toUpperCase()
}

function fmtTime(ts?: number) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function load(opts?: { quiet?: boolean }) {
  loading.value = true
  error.value = ''
  try {
    const [srcsR, dtsR, treeR, rptsR] = await Promise.allSettled([
      datasourceApi.list(),
      datasetApi.list(),
      dashboardTreeApi.tree({}),
      reportApi.list()
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
    if (rptsR.status === 'fulfilled') reports.value = rptsR.value
    else {
      reports.value = []
      errs.push(rptsR.reason instanceof Error ? rptsR.reason.message : String(rptsR.reason))
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
    else if (!opts?.quiet) flash('已同步')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function refresh() {
  await load()
}

async function createDash() {
  if (creating.value) return
  creating.value = true
  error.value = ''
  try {
    const node = await dashboardTreeApi.create({
      pid: '0',
      name: '未命名仪表盘',
      nodeType: 'dashboard',
      templateId: 'blank'
    })
    await router.push(`/dashboards/${node.id}/edit`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

function go(path: string) {
  router.push(path)
}

function openDash(id: string) {
  router.push(`/dashboards/${id}/edit`)
}

function openSrc(id: string) {
  router.push(`/datasources/${id}`)
}

onMounted(() => load({ quiet: true }))
</script>

<template>
  <div class="page">
    <ModuleTopbar module="workbench" />

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <p v-if="error" class="banner-err">{{ error }}</p>

    <div class="body">
      <div class="bar">
        <strong class="title">工作台</strong>
        <span class="crumb">概览数据链路与最近资产</span>
        <div class="spacer" />
        <button type="button" class="btn" :disabled="loading" @click="refresh">
          {{ loading ? '同步中…' : '刷新状态' }}
        </button>
        <button type="button" class="btn primary" :disabled="creating" @click="createDash">
          {{ creating ? '创建中…' : '+ 新建仪表盘' }}
        </button>
      </div>

      <div class="detail">
        <div class="stat-row">
          <div class="stat-card">
            <div class="k">数据源</div>
            <div class="v">{{ datasources.length }}</div>
            <div class="s">{{ srcOk }} 连通 · {{ srcPending }} 待处理</div>
          </div>
          <div class="stat-card">
            <div class="k">数据集</div>
            <div class="v">{{ datasets.length }}</div>
            <div class="s">{{ datasetHint }}</div>
          </div>
          <div class="stat-card">
            <div class="k">仪表盘</div>
            <div class="v">{{ dashTotal }}</div>
            <div class="s">{{ pubs }} 已发布 · {{ dirty }} 有未发布改动</div>
          </div>
          <div class="stat-card">
            <div class="k">在线报告</div>
            <div class="v">{{ reports.length }}</div>
            <div class="s">引用看板图 / 报告内新建图</div>
          </div>
        </div>

        <div class="panel-card">
          <h3>推荐链路（点一步跳转）</h3>
          <div class="pipe">
            <template v-for="(step, i) in PIPE" :key="step.go">
              <button type="button" class="pipe-step" @click="go(step.go)">
                <div class="n">{{ step.n }}</div>
                <div class="t">{{ step.t }}</div>
                <div class="d">{{ step.d }}</div>
              </button>
              <div v-if="i < PIPE.length - 1" class="pipe-arrow" aria-hidden="true">→</div>
            </template>
          </div>
        </div>

        <div class="grid-2">
          <div class="panel-card">
            <h3>最近仪表盘</h3>
            <div v-if="!recentDashboards.length" class="empty">暂无仪表盘，点击右上角新建</div>
            <div v-else class="recent-list">
              <button
                v-for="d in recentDashboards"
                :key="d.id"
                type="button"
                class="recent-item"
                @click="openDash(d.id)"
              >
                <div class="ico">▣</div>
                <div class="meta">
                  <div class="t">{{ d.name }}</div>
                  <div class="m">
                    {{ folderById[d.id] || '未分组' }} · {{ d.updateBy || d.createBy || '—' }} ·
                    {{ fmtTime(d.updateTime || d.createTime) }}
                  </div>
                </div>
                <span class="pill" :class="statusClass(d.status)">{{ statusLabel(d.status) }}</span>
              </button>
            </div>
          </div>

          <div class="panel-card">
            <h3>数据源健康</h3>
            <div v-if="!datasources.length" class="empty">暂无数据源连接</div>
            <div v-else class="recent-list">
              <button
                v-for="s in datasources"
                :key="s.id"
                type="button"
                class="recent-item"
                @click="openSrc(s.id)"
              >
                <div class="ico" :style="{ background: srcIcoBg(s.status) }">{{ typeShort(s.type) }}</div>
                <div class="meta">
                  <div class="t">{{ s.name }}</div>
                  <div class="m">{{ s.type }} · 上次检测 {{ fmtTime(s.updateTime) }}</div>
                </div>
                <span class="pill-soft" :class="srcStatusClass(s.status)">{{ srcStatusLabel(s.status) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  --primary: #3370ff;
  --brand-soft: #eaefff;
  --ink: #1a2332;
  --text-2: #646a73;
  --text-3: #8f959e;
  --line: rgba(0, 0, 0, 0.08);
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f6f8;
  color: var(--ink);
  overflow: hidden;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.title {
  font-size: 14px;
  font-weight: 650;
}

.crumb {
  font-size: 12px;
  color: var(--text-3);
}

.spacer {
  flex: 1;
}

.detail {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
}

.stat-card .k {
  font-size: 12px;
  color: var(--text-3);
}

.stat-card .v {
  font-size: 22px;
  font-weight: 700;
  margin-top: 4px;
  letter-spacing: -0.02em;
}

.stat-card .s {
  font-size: 11px;
  color: var(--text-2);
  margin-top: 4px;
}

.panel-card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 12px;
}

.panel-card h3 {
  font-size: 13px;
  margin: 0 0 10px;
  font-weight: 650;
}

.pipe {
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
  margin-top: 4px;
}

.pipe-step {
  flex: 1;
  min-width: 140px;
  text-align: left;
  background: #f7f8fa;
  border: 1px dashed #c5cdd6;
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  color: inherit;
  font: inherit;
}

.pipe-step:hover {
  border-color: var(--primary);
  background: var(--brand-soft);
}

.pipe-step .n {
  font-size: 11px;
  color: var(--text-3);
  margin-bottom: 4px;
}

.pipe-step .t {
  font-size: 13px;
  font-weight: 600;
}

.pipe-step .d {
  font-size: 11px;
  color: var(--text-2);
  margin-top: 4px;
  line-height: 1.4;
}

.pipe-arrow {
  align-self: center;
  color: var(--text-3);
  font-size: 16px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  background: #fafbfc;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
}

.recent-item:hover {
  border-color: #c2d8ff;
  background: var(--brand-soft);
}

.recent-item .ico {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #e8f0ff;
  color: var(--primary);
  display: grid;
  place-items: center;
  font-size: 14px;
  flex-shrink: 0;
  font-weight: 650;
}

.recent-item .meta {
  flex: 1;
  min-width: 0;
}

.recent-item .t {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item .m {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
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

.pill-soft {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  background: #f0f2f5;
  color: var(--text-2);
}

.pill-soft.ok {
  background: #e3f7ef;
  color: #0d7a4f;
}

.pill-soft.warn {
  background: #fff7ed;
  color: #c2410c;
}

.pill-soft.err {
  background: #fef2f2;
  color: #b91c1c;
}

.empty {
  font-size: 12px;
  color: var(--text-3);
  padding: 16px 4px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  font-size: 13px;
  cursor: pointer;
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

.btn.primary:hover:not(:disabled) {
  filter: brightness(0.96);
}

.banner-err {
  margin: 0;
  padding: 8px 16px;
  background: #fff1f0;
  color: #cf1322;
  font-size: 13px;
  border-bottom: 1px solid #ffccc7;
}

.toast {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  padding: 8px 14px;
  border-radius: 8px;
  background: #1f2329;
  color: #fff;
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

@media (max-width: 960px) {
  .stat-row {
    grid-template-columns: 1fr 1fr;
  }
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>

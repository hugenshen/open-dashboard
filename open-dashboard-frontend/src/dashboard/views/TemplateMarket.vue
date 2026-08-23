<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardApi, dashboardTreeApi } from '../../api/dashboard'
import type { DashboardTemplateVO } from '../../types/dashboard'

const CATS = [
  { id: 'all', label: '全部' },
  { id: '推荐', label: '推荐' },
  { id: '销售', label: '销售' },
  { id: '运营', label: '运营' },
  { id: '财务', label: '财务' },
  { id: '零售', label: '零售' },
  { id: '客户', label: '客户' },
  { id: '供应', label: '供应' },
  { id: '空白', label: '空白' }
] as const

const router = useRouter()
const templates = ref<DashboardTemplateVO[]>([])
const loading = ref(true)
const error = ref('')
const q = ref('')
const cat = ref<(typeof CATS)[number]['id']>('all')
const applying = ref<string | null>(null)
const preview = ref<DashboardTemplateVO | null>(null)
const device = ref<'pc' | 'tablet' | 'phone'>('pc')

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  return templates.value.filter((t) => {
    if (cat.value === '推荐' && !t.recommended) return false
    if (cat.value !== 'all' && cat.value !== '推荐' && (t.category || t.domain) !== cat.value) return false
    if (!needle) return true
    return (
      t.name.toLowerCase().includes(needle) ||
      (t.description || '').toLowerCase().includes(needle) ||
      t.id.toLowerCase().includes(needle)
    )
  })
})

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    templates.value = await dashboardApi.listTemplates()
    if (templates.value.length < 20) {
      error.value = `模板目录仅 ${templates.value.length} 张，期望 ≥20`
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

function family(id: string) {
  if (id === 'blank') return 'blank'
  if (id === 'exec' || id === 'kpi-wall' || id === 'hr' || id === 'store') return 'hero'
  if (['ops', 'promo', 'funnel', 'traffic', 'sla'].includes(id)) return 'ops'
  if (['finance', 'cash', 'cost'].includes(id)) return 'fin'
  if (['inventory', 'supply', 'quality'].includes(id)) return 'stock'
  if (['crm', 'cohort', 'nps'].includes(id)) return 'crm'
  return 'sales'
}

async function apply(t: DashboardTemplateVO) {
  if (applying.value) return
  applying.value = t.id
  error.value = ''
  try {
    const node = await dashboardTreeApi.create({
      pid: '0',
      name: t.id === 'blank' ? `仪表盘 ${new Date().toLocaleString('zh-CN')}` : t.name,
      nodeType: 'dashboard',
      templateId: t.id
    })
    await router.push(`/dashboards/${node.id}/edit`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    applying.value = null
  }
}
</script>

<template>
  <div class="tpl-market">
    <header class="tpl-top">
      <button type="button" class="back" @click="router.push('/dashboards')">← 仪表盘</button>
      <div>
        <h1>模板市场</h1>
        <p>选一张开箱稿面，应用后自带画布筛选和移动布局</p>
      </div>
      <input v-model="q" type="search" placeholder="搜索模板…" />
    </header>
    <p v-if="error" class="err">{{ error }}</p>
    <div class="tpl-body">
      <aside>
        <button
          v-for="c in CATS"
          :key="c.id"
          type="button"
          :class="{ on: cat === c.id }"
          @click="cat = c.id"
        >
          {{ c.label }}
        </button>
      </aside>
      <section>
        <p v-if="loading" class="muted">加载模板…</p>
        <div v-else class="grid">
          <article v-for="t in filtered" :key="t.id" class="card">
            <div class="cover" :class="'fam-' + family(t.id)">
              <div class="mini-bar"></div>
              <div v-if="family(t.id) === 'hero'" class="mini-hero"></div>
              <div class="mini-kpis">
                <i /><i /><i /><i />
              </div>
              <div class="mini-charts">
                <b /><b /><b />
              </div>
              <div class="hover">
                <button type="button" @click="preview = t; device = 'pc'">预览</button>
                <button type="button" class="pri" :disabled="!!applying" @click="apply(t)">
                  {{ applying === t.id ? '创建中…' : '应用' }}
                </button>
              </div>
            </div>
            <div class="meta">
              <strong>{{ t.name }}</strong>
              <span>{{ t.description }}</span>
              <em v-if="t.responsive">多端</em>
            </div>
          </article>
          <p v-if="!filtered.length" class="muted">没有匹配的模板</p>
        </div>
      </section>
    </div>

    <div v-if="preview" class="mask" @click.self="preview = null">
      <div class="preview-dlg">
        <header>
          <h2>{{ preview.name }}</h2>
          <div class="devs">
            <button type="button" :class="{ on: device === 'pc' }" @click="device = 'pc'">PC</button>
            <button type="button" :class="{ on: device === 'tablet' }" @click="device = 'tablet'">平板</button>
            <button type="button" :class="{ on: device === 'phone' }" @click="device = 'phone'">手机</button>
          </div>
          <button type="button" class="pri" :disabled="!!applying" @click="apply(preview)">应用</button>
          <button type="button" @click="preview = null">关闭</button>
        </header>
        <p class="hint">
          {{ preview.responsive ? '应用后已写入移动布局，无需再勾选上板。' : '空白画布仍走 P001 C 档，可稍后手排移动端。' }}
        </p>
        <div class="stage" :class="device">
          <div class="cover lg" :class="'fam-' + family(preview.id)">
            <div class="mini-bar"></div>
            <div v-if="family(preview.id) === 'hero'" class="mini-hero"></div>
            <div class="mini-kpis"><i /><i /><i /><i /></div>
            <div class="mini-charts"><b /><b /><b /></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpl-market {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #eef2ff 0%, #f6f7fb 28%);
  color: var(--od-ink, #111827);
  min-height: 0;
}
.tpl-top {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  flex-shrink: 0;
}
.tpl-top h1 {
  margin: 0;
  font-size: 18px;
}
.tpl-top p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--od-muted, #4b5563);
}
.tpl-top input {
  margin-left: auto;
  height: 34px;
  width: 220px;
  border: 1px solid var(--od-line, #dfe3ea);
  border-radius: 8px;
  padding: 0 10px;
}
.back,
.devs button,
.hover button,
.preview-dlg header button {
  height: 32px;
  border: 1px solid var(--od-line, #dfe3ea);
  background: #fff;
  border-radius: 8px;
  padding: 0 12px;
  cursor: pointer;
}
.err {
  margin: 0 20px 8px;
  color: #b42318;
  font-size: 13px;
}
.tpl-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 8px;
  padding: 0 16px 16px;
}
aside {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
aside button {
  text-align: left;
  border: 0;
  background: transparent;
  height: 36px;
  border-radius: 8px;
  padding: 0 12px;
  cursor: pointer;
  color: var(--od-muted, #4b5563);
}
aside button.on {
  background: #fff;
  color: var(--od-brand, #4f46e5);
  font-weight: 700;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  overflow: auto;
  padding: 4px 4px 24px;
}
.card {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
  overflow: hidden;
}
.cover {
  position: relative;
  aspect-ratio: 320 / 194;
  background: #e8edf4;
  overflow: hidden;
}
.cover .mini-bar {
  height: 14px;
  background: #fff;
}
.mini-hero {
  margin: 8px 10px 0;
  height: 28px;
  border-radius: 6px;
  background: linear-gradient(135deg, #6d5efc, #ff7a59 52%, #3ec8ff);
}
.mini-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 8px 10px 0;
}
.mini-kpis i {
  height: 28px;
  background: #fff;
  border-radius: 4px;
  display: block;
}
.mini-charts {
  display: grid;
  grid-template-columns: 1.1fr 1fr 0.9fr;
  gap: 6px;
  padding: 8px 10px 10px;
}
.mini-charts b {
  height: 46px;
  background: #fff;
  border-radius: 4px;
  display: block;
}
.fam-ops .mini-kpis i:first-child { background: #e6f4ff; }
.fam-fin .mini-kpis i:first-child { background: #fff7e6; }
.fam-crm .mini-kpis i:first-child { background: #fff0f6; }
.fam-stock .mini-kpis i:first-child { background: #f6ffed; }
.fam-blank .mini-kpis,
.fam-blank .mini-charts {
  opacity: 0.35;
}
.hover {
  position: absolute;
  inset: 0;
  display: none;
  place-items: center;
  gap: 8px;
  background: rgba(17, 24, 39, 0.28);
}
.cover:hover .hover {
  display: flex;
  justify-content: center;
  align-items: center;
}
.pri {
  background: var(--od-brand, #4f46e5) !important;
  border-color: transparent !important;
  color: #fff !important;
}
.meta {
  padding: 10px 12px 12px;
}
.meta strong {
  display: block;
  font-size: 13px;
}
.meta span {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--od-muted, #4b5563);
}
.meta em {
  display: inline-block;
  margin-top: 6px;
  font-style: normal;
  font-size: 10px;
  color: var(--od-brand, #4f46e5);
  background: var(--od-brand-soft, #eef2ff);
  border-radius: 999px;
  padding: 1px 7px;
}
.muted {
  color: var(--od-muted, #4b5563);
  font-size: 13px;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
  display: grid;
  place-items: center;
  z-index: 40;
}
.preview-dlg {
  width: min(920px, 94vw);
  background: #fff;
  border-radius: 16px;
  padding: 16px;
}
.preview-dlg header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-dlg h2 {
  margin: 0;
  font-size: 16px;
  flex: 1;
}
.devs button.on {
  border-color: var(--od-brand, #4f46e5);
  color: var(--od-brand, #4f46e5);
}
.hint {
  font-size: 12px;
  color: var(--od-muted, #4b5563);
}
.stage {
  margin: 8px auto 0;
  background: #eef1f6;
  border-radius: 12px;
  padding: 16px;
  display: grid;
  place-items: center;
}
.stage .cover.lg {
  width: 100%;
  max-width: 640px;
}
.stage.tablet .cover.lg {
  max-width: 420px;
}
.stage.phone .cover.lg {
  max-width: 280px;
}
</style>

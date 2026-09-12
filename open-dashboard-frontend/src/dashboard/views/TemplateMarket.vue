<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardApi, dashboardTreeApi } from '../../api/dashboard'
import { templateHeat, templateSketchHtml } from '../pageTemplates'
import type { DashboardTemplateVO } from '../../types/dashboard'

const CATS = [
  { id: 'all', label: '企业内部模板' },
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
const device = ref<'pc' | 'pad' | 'phone'>('pc')

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

const catLabel = computed(() => CATS.find((c) => c.id === cat.value)?.label ?? '企业内部模板')
const searchQuery = computed(() => q.value.trim())

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

function heat(id: string) {
  return templateHeat(id)
}

function sketch(id: string) {
  return templateSketchHtml(id)
}

function openPreview(t: DashboardTemplateVO) {
  preview.value = t
  device.value = 'pc'
}

function closePreview() {
  preview.value = null
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
  <div v-if="preview" class="tpl-preview">
    <div class="tpl-prev-bar">
      <button type="button" class="btn ghost" @click="closePreview">← 返回市场</button>
      <h2>{{ preview.name }}</h2>
      <span class="sub">{{ preview.responsive ? '开箱多端' : '空白 · 可手排移动端' }}</span>
      <div class="spacer" />
      <div class="tpl-devices" role="tablist">
        <button type="button" :class="{ on: device === 'pc' }" @click="device = 'pc'">PC</button>
        <button type="button" :class="{ on: device === 'pad' }" @click="device = 'pad'">平板</button>
        <button type="button" :class="{ on: device === 'phone' }" @click="device = 'phone'">手机</button>
      </div>
      <button type="button" class="btn primary" :disabled="!!applying" @click="apply(preview)">
        {{ applying === preview.id ? '创建中…' : '应用此模板' }}
      </button>
    </div>
    <div class="tpl-prev-stage">
      <div
        class="tpl-frame"
        :class="{ 'is-pad': device === 'pad', 'is-phone': device === 'phone' }"
      >
        <div class="tpl-sketch" v-html="sketch(preview.id)" />
        <p class="tpl-desc">{{ preview.description }}</p>
      </div>
    </div>
  </div>

  <div v-else class="tpl-market">
    <header class="tpl-head">
      <button type="button" class="btn ghost" @click="router.push('/dashboards')">← 仪表盘</button>
      <div>
        <h2>从模板新建</h2>
        <div class="sub">{{ templates.length }} 张 · 应用后手机端已排好，不必再改造</div>
      </div>
      <div class="spacer" />
      <label class="tpl-search">
        <span aria-hidden="true">⌕</span>
        <input v-model="q" type="search" placeholder="搜索模板" />
      </label>
    </header>

    <p v-if="error" class="tpl-err">{{ error }}</p>

    <div class="tpl-body">
      <aside class="tpl-cats">
        <div class="tpl-cats-head">模板市场</div>
        <button
          v-for="c in CATS"
          :key="c.id"
          type="button"
          class="tpl-cat"
          :class="{ on: cat === c.id }"
          @click="cat = c.id"
        >
          {{ c.label }}
        </button>
      </aside>

      <div class="tpl-grid-wrap">
        <p v-if="loading" class="tpl-muted">加载模板…</p>
        <template v-else>
          <div v-if="searchQuery" class="tpl-search-hit">
            搜索「{{ searchQuery }}」为你找到 {{ filtered.length }} 个结果
          </div>
          <div class="tpl-sec">
            {{ catLabel }}
            <small>{{ filtered.length }} 张</small>
          </div>
          <div class="tpl-grid">
            <article
              v-for="t in filtered"
              :key="t.id"
              class="tpl-card"
              @click="openPreview(t)"
            >
              <i v-if="t.recommended" class="tpl-ribbon" aria-hidden="true" />
              <div class="tpl-cover">
                <div class="tpl-sketch" v-html="sketch(t.id)" />
                <div class="tpl-hover" @click.stop>
                  <button type="button" class="btn" @click="openPreview(t)">预览</button>
                  <button
                    type="button"
                    class="btn primary"
                    :disabled="!!applying"
                    @click="apply(t)"
                  >
                    {{ applying === t.id ? '创建中…' : '应用' }}
                  </button>
                </div>
              </div>
              <div class="tpl-meta">
                <div class="tpl-meta-row">
                  <b>{{ t.name }}</b>
                  <span class="tpl-heat">{{ heat(t.id).views }} · {{ heat(t.id).uses }}</span>
                </div>
                <span class="tpl-official">{{ t.id === 'blank' ? '空白画布' : '官方' }}</span>
              </div>
            </article>
            <p v-if="!filtered.length" class="tpl-muted">没有匹配的模板</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpl-market,
.tpl-preview {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--od-ink, #1f2329);
}

.tpl-market {
  background: #f4f7fc;
}

.tpl-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 56px;
  padding: 10px 20px;
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(222, 226, 233, 0.8);
  backdrop-filter: blur(10px);
}

.tpl-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 720;
}

.tpl-head .sub,
.tpl-prev-bar .sub {
  font-size: 12px;
  color: #8f959e;
}

.spacer {
  flex: 1;
}

.tpl-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #e4e7ed;
  border-radius: 18px;
  background: #fff;
  width: min(280px, 42vw);
  box-shadow: 0 1px 2px rgba(31, 35, 41, 0.04);
}

.tpl-search input {
  border: 0;
  outline: 0;
  flex: 1;
  font-size: 13px;
  min-width: 0;
  background: transparent;
}

.tpl-err {
  margin: 0;
  padding: 8px 20px;
  color: #b42318;
  font-size: 13px;
  background: #fff5f5;
}

.tpl-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
}

.tpl-cats {
  overflow: auto;
  padding: 12px 10px;
  border-right: 1px solid rgba(222, 226, 233, 0.85);
  background: rgba(255, 255, 255, 0.9);
}

.tpl-cats-head {
  font-size: 15px;
  font-weight: 700;
  padding: 4px 12px 12px;
  color: #1f2329;
}

.tpl-cat {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #646a73;
  cursor: pointer;
}

.tpl-cat:hover {
  background: #f5f7fb;
}

.tpl-cat.on {
  background: #e8f0ff;
  color: #2f6bff;
  font-weight: 650;
  position: relative;
}

.tpl-cat.on::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 3px;
  background: #3370ff;
}

.tpl-grid-wrap {
  overflow: auto;
  padding: 18px 24px 40px;
  background:
    radial-gradient(900px 280px at 12% -10%, rgba(120, 160, 255, 0.22), transparent 60%),
    radial-gradient(700px 240px at 92% 8%, rgba(186, 160, 255, 0.18), transparent 55%),
    linear-gradient(180deg, #eef3fb 0%, #f5f7fb 42%, #f4f6f8 100%);
}

.tpl-search-hit {
  font-size: 18px;
  font-weight: 650;
  margin: 2px 0 16px;
  color: #1f2329;
}

.tpl-sec {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  font-weight: 700;
  margin: 4px 0 14px;
  color: #1f2329;
}

.tpl-sec small {
  font-size: 12px;
  font-weight: 500;
  color: #8f959e;
}

.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}

.tpl-card {
  position: relative;
  border: 0;
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
  cursor: pointer;
  text-align: left;
  padding: 0;
  font: inherit;
  color: inherit;
  min-width: 0;
  box-shadow:
    0 1px 2px rgba(31, 35, 41, 0.04),
    0 8px 24px rgba(47, 90, 160, 0.06);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.tpl-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(47, 90, 160, 0.14);
}

.tpl-cover {
  position: relative;
  overflow: hidden;
  aspect-ratio: 320 / 194;
  background: #eef2f7;
}

.tpl-sketch :deep(.tpl-shot) {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 0;
  background: #eef2f7;
  max-width: 100%;
  min-width: 0;
}

.tpl-sketch :deep(.tpl-shot-blank) {
  height: 100%;
  aspect-ratio: 320 / 194;
  background: repeating-linear-gradient(-45deg, #fafbfc 0 8px, #f3f4f7 8px 16px);
  display: grid;
  place-items: center;
  color: #8f959e;
  font-size: 13px;
  font-weight: 650;
}

.tpl-ribbon {
  position: absolute;
  top: 0;
  right: 16px;
  z-index: 2;
  width: 18px;
  height: 26px;
  background: linear-gradient(180deg, #5b8cff, #3370ff);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
  pointer-events: none;
}

.tpl-hover {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 1;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(20, 28, 48, 0.38);
  backdrop-filter: blur(3px);
}

.tpl-card:hover .tpl-hover,
.tpl-card:focus-within .tpl-hover {
  display: flex;
}

.tpl-meta {
  padding: 10px 14px 14px;
}

.tpl-meta-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.tpl-meta b {
  display: block;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.tpl-heat {
  font-size: 12px;
  color: #8f959e;
  white-space: nowrap;
}

.tpl-official {
  display: inline-block;
  margin-top: 4px;
  font-size: 12px;
  color: #8f959e;
}

.tpl-muted {
  color: #8f959e;
  font-size: 13px;
}

.btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  color: #1f2329;
}

.btn.primary {
  background: var(--od-brand, #3370ff);
  border-color: var(--od-brand, #3370ff);
  color: #fff;
}

.btn.primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.btn.ghost {
  background: transparent;
  border-color: transparent;
  color: #646a73;
}

.tpl-cover .tpl-hover .btn:not(.primary) {
  background: #fff;
  border-color: #fff;
  color: #1f2329;
}

.tpl-cover .tpl-hover .btn {
  min-width: 76px;
}

/* 全页预览 */
.tpl-preview {
  background: var(--od-bg, #f5f7fb);
}

.tpl-prev-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-height: 52px;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid var(--od-line, #e4e7ed);
}

.tpl-prev-bar h2 {
  font-size: 15px;
  margin: 0;
}

.tpl-devices {
  display: flex;
  gap: 4px;
  background: #f0f2f5;
  padding: 3px;
  border-radius: 8px;
}

.tpl-devices button {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-weight: 650;
  color: #646a73;
  cursor: pointer;
}

.tpl-devices button.on {
  background: #fff;
  color: #1f2329;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.tpl-prev-stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background:
    radial-gradient(900px 280px at 8% -20%, rgba(120, 160, 255, 0.2), transparent 60%),
    radial-gradient(640px 220px at 96% 0%, rgba(186, 160, 255, 0.16), transparent 55%),
    linear-gradient(180deg, #eef3fb, #f5f7fb);
}

.tpl-frame {
  background: #fff;
  border: 1px solid var(--od-line, #e4e7ed);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.06);
  width: min(960px, 100%);
}

.tpl-frame.is-pad {
  width: min(720px, 100%);
}

.tpl-frame.is-phone {
  width: 390px;
  border-radius: 28px;
  border-width: 6px;
  border-color: #2f343c;
  padding: 10px;
}

.tpl-frame .tpl-sketch :deep(.tpl-shot) {
  min-height: 360px;
}

.tpl-frame .tpl-sketch :deep(.tpl-shot-blank) {
  min-height: 360px;
  height: 360px;
}

.tpl-desc {
  margin: 10px 0 0;
  font-size: 12px;
  color: #8f959e;
  line-height: 1.55;
}

@media (max-width: 900px) {
  .tpl-body {
    grid-template-columns: 1fr;
  }

  .tpl-cats {
    display: flex;
    gap: 6px;
    overflow: auto;
    border-right: 0;
    border-bottom: 1px solid var(--od-line, #e4e7ed);
    padding: 8px 12px;
  }

  .tpl-cats-head {
    display: none;
  }

  .tpl-cat {
    width: auto;
    white-space: nowrap;
  }
}

@media (max-width: 560px) {
  .tpl-grid {
    grid-template-columns: 1fr;
  }

  .tpl-frame.is-phone {
    width: 100%;
  }
}
</style>

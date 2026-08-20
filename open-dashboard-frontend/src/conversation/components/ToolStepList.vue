<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { humanizeFieldName } from '../../utils/fieldLabel'

export type ToolPreview = {
  kind?: string
  hint?: string
  tableName?: string
  summary?: string
  sql?: string
  fields?: Array<{ name?: string; label?: string; dataType?: string; group?: string }>
  columns?: string[]
  sample?: unknown[]
  items?: string[]
  encode?: Record<string, unknown>
  title?: string
  chartType?: string
  rowCount?: number
  dims?: string[]
  measures?: string[]
  timeFields?: string[]
}

export type ToolStep = {
  id: string
  label: string
  status: 'run' | 'done'
  tool?: string
  hint?: string
  preview?: ToolPreview
  open?: boolean
  children?: ToolStep[]
}

const props = defineProps<{
  steps: ToolStep[]
  live?: boolean
  defaultOpen?: boolean
}>()

const bodyOpen = ref(props.defaultOpen !== false)

watch(
  () => props.live,
  (v) => {
    if (v) bodyOpen.value = true
  }
)

const visible = computed(() => props.steps.filter((t) => !isNoise(t)))

const show = computed(() => !!props.live || visible.value.length > 0)

const running = computed(() => !!props.live && (visible.value.some((t) => t.status === 'run') || !visible.value.length))

const headerText = computed(() => (running.value ? '思考中' : '已思考'))

function isNoise(t: ToolStep): boolean {
  const id = t.id || ''
  const lab = t.label || ''
  if (/^(turn_|message_end|agent_end|agent_start|context|think)/.test(id)) return true
  if (
    /推理轮次|轮次\s*\d+\s*结束|transformContext|skills \+ memory|^调用\s+od_|assistant turn|^Pi Agent|^Lead |^model=/.test(
      lab
    )
  ) {
    return true
  }
  return false
}

function isCard(t: ToolStep): boolean {
  if (t.preview || t.tool) return true
  return /schema|sql|query|profile|sqlbot|od_|exec/.test(`${t.id} ${t.tool || ''}`)
}

function hintOf(t: ToolStep): string {
  if (t.hint) return t.hint
  if (t.preview?.hint) return t.preview.hint
  const n = t.preview?.fields?.length
  if (n) return `${n} 个字段`
  const rows = t.preview?.sample?.length
  if (rows) return `${rows} 行`
  if (t.preview?.sql) return 'SQL'
  if (t.preview) return '详情'
  return ''
}

function iconOf(t: ToolStep): string {
  const k = t.preview?.kind || t.tool || t.id || ''
  if (/schema|od_get_schema/.test(k) || /Schema|字段/.test(t.label)) return 'schema'
  if (/sql|od_run_sql|sqlbot/.test(k) || /SQL/.test(t.label)) return 'sql'
  if (/query|od_run_query|exec/.test(k) || /查询/.test(t.label)) return 'query'
  if (/profile|od_profile/.test(k) || /特征/.test(t.label)) return 'profile'
  if (/plan|write_todos|layout|compose/.test(k)) return 'plan'
  return 'tool'
}

function cell(v: unknown, max = 28): string {
  if (v == null) return '—'
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function sampleCols(p: ToolPreview): string[] {
  if (p.columns?.length) return p.columns.map((c) => humanizeFieldName(String(c)))
  const rows = sampleRows(p)
  const n = Math.max(0, ...rows.map((r) => r.length))
  if (!n) return []
  return Array.from({ length: n }, (_, i) => `列${i + 1}`)
}

function visibleSampleCols(p: ToolPreview, expanded: boolean): string[] {
  return sampleCols(p).slice(0, expanded ? 12 : 6)
}

function toggleBody() {
  bodyOpen.value = !bodyOpen.value
}

function isOpen(t: ToolStep): boolean {
  if (t.open === false) return false
  return !!t.preview || !!(t.children && t.children.length)
}

function toggleStep(t: ToolStep) {
  if (!t.preview && !hintOf(t)) return
  t.open = isOpen(t) ? false : true
}

function fieldChips(t: ToolStep) {
  return t.preview?.fields || []
}

function sampleRows(p: ToolPreview): unknown[][] {
  const sample = p.sample || []
  return sample.map((row) => {
    if (Array.isArray(row)) return row
    if (row && typeof row === 'object') {
      const cols = p.columns?.length ? p.columns : Object.keys(row as object)
      return cols.map((c) => (row as Record<string, unknown>)[c])
    }
    return [row]
  })
}

const reduced = ref(false)
let mq: MediaQueryList | null = null
function onMq(e: MediaQueryListEvent) {
  reduced.value = e.matches
}
if (typeof window !== 'undefined') {
  mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduced.value = mq.matches
  mq.addEventListener('change', onMq)
}
onUnmounted(() => mq?.removeEventListener('change', onMq))
</script>

<template>
  <div v-if="show" class="kimi">
    <button type="button" class="kimi-hd" @click="toggleBody">
      <span class="spark" :class="{ spin: running && !reduced }" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path
            fill="currentColor"
            d="M8 1.2 9.1 6 14 7.1 9.1 8.2 8 13 6.9 8.2 2 7.1 6.9 6z"
          />
        </svg>
      </span>
      <span class="hd-lab">{{ headerText }}</span>
      <span v-if="running" class="dots" aria-hidden="true"><i /><i /><i /></span>
      <span class="chev" :class="{ open: bodyOpen }" aria-hidden="true" />
    </button>
    <div v-if="bodyOpen" class="kimi-body">
      <div v-if="live && !visible.length" class="line">正在理解问题…</div>
      <template v-for="(t, ti) in visible" :key="t.id + '-' + ti">
        <div v-if="!isCard(t)" class="line" :class="t.status">{{ t.label }}</div>
        <div v-else class="bar" :class="[t.status, { open: isOpen(t), fold: !!(t.preview || hintOf(t)) }]">
          <button type="button" class="bar-sum" @click="toggleStep(t)">
            <span class="ico" aria-hidden="true">
              <svg v-if="iconOf(t) === 'schema'" viewBox="0 0 16 16">
                <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M2 6.5h12M6 6.5v6.5" fill="none" stroke="currentColor" stroke-width="1.4" />
              </svg>
              <svg v-else-if="iconOf(t) === 'sql'" viewBox="0 0 16 16">
                <path
                  d="M5 4.5 2.5 8 5 11.5M11 4.5 13.5 8 11 11.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg v-else-if="iconOf(t) === 'query'" viewBox="0 0 16 16">
                <circle cx="7" cy="7" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M10 10.5 13.5 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
              <svg v-else-if="iconOf(t) === 'profile'" viewBox="0 0 16 16">
                <path d="M8 2.5 9.2 6h3.8L10 8.3 11.2 12 8 9.8 4.8 12 6 8.3 3 6h3.8z" fill="currentColor" />
              </svg>
              <svg v-else viewBox="0 0 16 16">
                <rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" />
              </svg>
            </span>
            <span class="name">{{ t.label }}</span>
            <span v-if="hintOf(t) || t.preview" class="more">
              {{ hintOf(t) || '详情' }}
              <em>{{ isOpen(t) ? '▾' : '>' }}</em>
            </span>
          </button>
          <div v-if="t.preview && !t.children?.length" class="peek">
            <div v-if="t.preview.summary" class="sum">{{ t.preview.summary }}</div>
            <div v-if="t.preview.dims?.length || t.preview.measures?.length || t.preview.timeFields?.length" class="roles">
              <p v-if="t.preview.dims?.length"><b>维度</b>{{ t.preview.dims.join('、') }}</p>
              <p v-if="t.preview.measures?.length"><b>指标</b>{{ t.preview.measures.join('、') }}</p>
              <p v-if="t.preview.timeFields?.length"><b>时间</b>{{ t.preview.timeFields.join('、') }}</p>
            </div>
            <div v-if="fieldChips(t).length" class="chips">
              <span v-for="(f, fi) in fieldChips(t).slice(0, isOpen(t) ? 40 : 10)" :key="(f.name || '') + fi" class="chip" :class="f.group">
                {{ f.label || f.name }}
              </span>
              <span v-if="!isOpen(t) && fieldChips(t).length > 10" class="chip more-chip">
                +{{ fieldChips(t).length - 10 }}
              </span>
            </div>
            <ul v-if="t.preview.items?.length && !t.preview.dims?.length" class="items">
              <li v-for="(it, ii) in t.preview.items.slice(0, isOpen(t) ? 12 : 4)" :key="ii">{{ it }}</li>
            </ul>
          </div>
          <div v-if="t.children?.length" class="kids">
            <div v-for="(c, ci) in t.children" :key="c.id + '-' + ci" class="kid" :class="c.status">
              <div class="kid-hd">
                <span class="kid-dot" />
                <span class="kid-name">{{ c.label }}</span>
                <span v-if="hintOf(c)" class="kid-hint">{{ hintOf(c) }}</span>
              </div>
              <div v-if="c.preview?.summary" class="sum">{{ c.preview.summary }}</div>
              <div v-if="fieldChips(c).length" class="chips">
                <span
                  v-for="(f, fi) in fieldChips(c).slice(0, 16)"
                  :key="(f.name || '') + fi"
                  class="chip"
                  :class="f.group"
                >
                  {{ f.label || f.name }}
                </span>
              </div>
              <pre v-if="c.preview?.sql" class="sql">{{ c.preview.sql }}</pre>
              <div v-if="c.preview && sampleRows(c.preview).length" class="tbl-scroll">
                <table class="tbl sample">
                  <thead>
                    <tr>
                      <th v-for="col in visibleSampleCols(c.preview, false)" :key="col" :title="col">
                        {{ cell(col, 16) }}
                      </th>
                      <th v-if="sampleCols(c.preview).length > 6" class="more-col">
                        +{{ sampleCols(c.preview).length - 6 }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in sampleRows(c.preview).slice(0, 4)" :key="ri">
                      <td
                        v-for="(col, ci2) in visibleSampleCols(c.preview, false)"
                        :key="col"
                        :title="String(row[ci2] ?? '')"
                      >
                        {{ cell(row[ci2]) }}
                      </td>
                      <td v-if="sampleCols(c.preview).length > 6" class="more-col">…</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div v-if="isOpen(t) && t.preview && !t.children?.length" class="nested">
            <div v-if="t.preview.tableName" class="meta">表 {{ t.preview.tableName }}</div>
            <ul v-if="t.preview.items?.length && t.preview.dims?.length" class="items">
              <li v-for="(it, ii) in t.preview.items" :key="'p' + ii">{{ it }}</li>
            </ul>
            <div v-if="t.preview.fields?.length && t.preview.kind !== 'query'" class="tbl-scroll">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>名称</th>
                    <th>类型</th>
                    <th>角色</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(f, fi) in t.preview.fields" :key="(f.name || '') + fi">
                    <td>
                      <code>{{ f.name }}</code>
                    </td>
                    <td>{{ f.label || f.name }}</td>
                    <td>{{ f.dataType || '—' }}</td>
                    <td>{{ f.group || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <pre v-if="t.preview.sql" class="sql">{{ t.preview.sql }}</pre>
            <div v-if="sampleRows(t.preview).length" class="tbl-scroll">
              <table class="tbl sample">
                <thead>
                  <tr>
                    <th v-for="c in visibleSampleCols(t.preview, true)" :key="c" :title="c">
                      {{ cell(c, 16) }}
                    </th>
                    <th v-if="sampleCols(t.preview).length > 12" class="more-col">
                      +{{ sampleCols(t.preview).length - 12 }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in sampleRows(t.preview).slice(0, 5)" :key="ri">
                    <td
                      v-for="(c, ci) in visibleSampleCols(t.preview, true)"
                      :key="c"
                      :title="String(row[ci] ?? '')"
                    >
                      {{ cell(row[ci]) }}
                    </td>
                    <td v-if="sampleCols(t.preview).length > 12" class="more-col">…</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.kimi {
  margin: 0;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.kimi-hd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: #8b8f97;
  cursor: pointer;
  line-height: 1.6;
  user-select: none;
}
.kimi-hd:hover {
  color: #5c6066;
}
.spark {
  width: 16px;
  height: 16px;
  display: inline-flex;
  color: #c2c6cc;
  flex-shrink: 0;
}
.spark svg {
  width: 14px;
  height: 14px;
  margin: auto;
}
.spark.spin {
  color: #3370ff;
  animation: twinkle 1.15s ease-in-out infinite;
}
.hd-lab {
  font-weight: 500;
  letter-spacing: 0.02em;
}
.dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 1px;
}
.dots i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.35;
  animation: blink 1.2s infinite;
}
.dots i:nth-child(2) {
  animation-delay: 0.2s;
}
.dots i:nth-child(3) {
  animation-delay: 0.4s;
}
.chev {
  width: 0;
  height: 0;
  margin-left: 2px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #c2c6cc;
  transform: rotate(-90deg);
  transition: transform 0.16s ease;
}
.chev.open {
  transform: rotate(0deg);
}
.kimi-body {
  margin: 6px 0 2px 7px;
  padding: 0 0 4px 12px;
  border-left: 1px solid #eceef1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.line {
  font-size: 13px;
  line-height: 1.7;
  color: #8b8f97;
}
.line.run {
  color: #646a73;
}
.bar {
  background: #f4f5f7;
  border-radius: 12px;
  overflow: hidden;
  min-width: 0;
  max-width: 100%;
}
.bar.run {
  background: #f0f3fa;
}
.bar-sum {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: #1f2329;
  text-align: left;
  cursor: default;
}
.bar.fold .bar-sum {
  cursor: pointer;
}
.bar.fold .bar-sum:hover {
  background: rgba(0, 0, 0, 0.03);
}
.peek {
  padding: 0 12px 10px;
}
.kids {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.kid {
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #eceef1;
  min-width: 0;
  overflow: hidden;
}
.kid.run {
  border-color: #c9d8ff;
  background: #f5f8ff;
}
.kid-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.kid-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00b578;
  flex-shrink: 0;
}
.kid.run .kid-dot {
  background: #3370ff;
  box-shadow: 0 0 0 3px rgba(51, 112, 255, 0.15);
}
.kid-name {
  font-weight: 600;
  color: #2b2f36;
}
.kid-hint {
  margin-left: auto;
  color: #8b8f97;
  font-size: 12px;
}
.kid .sum {
  margin-top: 6px;
}
.kid .chips,
.kid .sql,
.kid .tbl-scroll {
  margin-top: 6px;
}
.sum {
  font-size: 12.5px;
  color: #4e5969;
  line-height: 1.55;
  margin: 0 0 6px;
}
.roles p {
  margin: 0 0 4px;
  font-size: 12.5px;
  color: #4e5969;
  line-height: 1.5;
}
.roles b {
  display: inline-block;
  min-width: 2.5em;
  margin-right: 6px;
  color: #8b8f97;
  font-weight: 600;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #eceef1;
  color: #2b2f36;
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip.quota,
.chip.measure {
  border-color: #c9d8ff;
  background: #f5f8ff;
  color: #245bdb;
}
.chip.time {
  border-color: #ffd8a8;
  background: #fff7e8;
  color: #d25f00;
}
.chip.more-chip {
  color: #8b8f97;
  border-style: dashed;
}
.ico {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: #8b8f97;
  display: inline-flex;
}
.ico svg {
  width: 15px;
  height: 15px;
  margin: auto;
}
.name {
  flex-shrink: 0;
  font-weight: 500;
  color: #2b2f36;
}
.snip {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8b8f97;
  font-size: 12px;
}
.more {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #8b8f97;
  font-size: 12px;
  margin-left: auto;
}
.more em {
  font-style: normal;
  color: #8b8f97;
  font-weight: 500;
}
.nested {
  padding: 0 12px 12px;
  border-top: 1px solid #eceef1;
  background: #fff;
  min-width: 0;
  overflow: hidden;
}
.meta {
  margin: 8px 0 6px;
  font-size: 12px;
  color: #8b8f97;
}
.tbl-scroll {
  margin-top: 6px;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  border: 1px solid #eceef1;
  border-radius: 8px;
  background: #fafbfc;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tbl.sample {
  width: max-content;
  min-width: 100%;
}
.tbl th,
.tbl td {
  padding: 5px 8px;
  border-bottom: 1px solid #f0f1f3;
  text-align: left;
  color: #1f2329;
  white-space: nowrap;
  max-width: 9.5em;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tbl.sample th,
.tbl.sample td {
  max-width: 8.5em;
}
.tbl th {
  color: #8b8f97;
  font-weight: 600;
  background: #f7f8fa;
}
.tbl .more-col {
  color: #8b8f97;
  font-weight: 500;
  max-width: 4em;
}
.tbl code {
  font-size: 11.5px;
}
.sql {
  margin: 8px 0 0;
  padding: 8px;
  border-radius: 8px;
  background: #f7f8fa;
  border: 1px solid #eceef1;
  font-size: 11.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
}
.items {
  margin: 8px 0 0;
  padding-left: 16px;
  font-size: 12px;
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.82) rotate(18deg);
  }
}
@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
</style>

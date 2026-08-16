<script setup lang="ts">
/**
 * Dashboard-editor SQLBot.
 * Pipeline from refs/sqlbot: generate SQL → read-only guard → execute → chart.
 * Does not write the canvas unless the user clicks 保存到仪表盘.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dashboardApi } from '../../api/dashboard'
import { datasetApi, type DatasetMetaVO } from '../../datasource/api'
import { conversationApi } from '../api'
import ToolStepList, { type ToolPreview, type ToolStep } from './ToolStepList.vue'

const props = defineProps<{
  dashboardId: string
  selectedChartId?: string
  selectedEncode?: Record<string, unknown>
}>()

const emit = defineEmits<{
  pick: []
  applied: []
}>()

type ChatLine = {
  role: 'user' | 'assistant' | 'system'
  text: string
  tools?: ToolStep[]
  mapping?: Array<{ phrase: string; field?: string; label?: string }>
  unresolved?: Array<{ phrase: string; reason: string }>
  columns?: string[]
  rows?: unknown[][]
  chartType?: string
  labels?: string[]
  heights?: number[]
  sql?: string
  clarify?: boolean
}

const route = useRoute()
const router = useRouter()

const open = ref(false)
const enabled = ref(false)
const conversationId = ref('')
const prompt = ref('')
const streaming = ref(false)
const chat = ref<ChatLine[]>([])
const runId = ref('')
const canSave = ref(false)
const datasets = ref<DatasetMetaVO[]>([])
const boardDatasetIds = ref<string[]>([])
const selectedDatasetId = ref('')
const liveTools = ref<ToolStep[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const msgsEl = ref<HTMLElement | null>(null)

const TOOL_LABELS: Record<string, string> = {
  od_get_schema: '读取字段 Schema',
  od_profile_dataset: '分析数据特征',
  od_run_query: '试查询',
  od_run_sql: '执行 SQL',
  schema: '读取字段 Schema',
  sqlbot: 'SQLBot 生成 SQL',
  sqlbot_sql: 'SQL 已生成',
  sqlbot_exec: '执行查询'
}

const STORAGE_KEY = 'od.conversationId'
const OPEN_KEY = 'od.sqlbot.open'

const datasetOptions = computed(() => {
  const board = new Set(boardDatasetIds.value)
  const preferred = datasets.value.filter((d) => board.has(d.id))
  const rest = datasets.value.filter((d) => !board.has(d.id))
  return preferred.length ? [...preferred, ...rest] : datasets.value
})

const selectedDatasetName = computed(() => {
  const hit = datasets.value.find((d) => d.id === selectedDatasetId.value)
  return hit?.name || ''
})

function persistOpen(v: boolean) {
  sessionStorage.setItem(OPEN_KEY, v ? '1' : '0')
  window.dispatchEvent(new CustomEvent('od:sqlbot-set', { detail: { open: v } }))
}

function onSqlbotSet(ev: Event) {
  const next = Boolean((ev as CustomEvent<{ open?: boolean }>).detail?.open)
  if (open.value !== next) open.value = next
}

onMounted(async () => {
  try {
    const feat = await conversationApi.feature()
    enabled.value = !!feat.enabled
  } catch {
    enabled.value = false
  }
  const fromQuery = String(route.query.conversationId || '')
  const fromStore = sessionStorage.getItem(STORAGE_KEY) || ''
  conversationId.value = fromQuery || fromStore
  if (fromQuery) sessionStorage.setItem(STORAGE_KEY, fromQuery)
  if (enabled.value) {
    await loadDatasets()
    open.value = false
  }
  window.addEventListener('od:sqlbot-set', onSqlbotSet)
})

onUnmounted(() => {
  window.removeEventListener('od:sqlbot-set', onSqlbotSet)
})

watch(open, (v) => persistOpen(v))

watch(
  () => route.query.conversationId,
  (v) => {
    if (v) {
      conversationId.value = String(v)
      sessionStorage.setItem(STORAGE_KEY, conversationId.value)
    }
  }
)

watch(
  () => props.selectedEncode?.datasetId,
  (id) => {
    if (id) selectedDatasetId.value = String(id)
  }
)

watch(
  () => props.dashboardId,
  () => {
    if (enabled.value) loadDatasets()
  }
)

async function loadDatasets() {
  try {
    const [list, detail] = await Promise.all([
      datasetApi.list(),
      dashboardApi.get(props.dashboardId, 'draft').catch(() => null)
    ])
    datasets.value = list
    const ids = new Set<string>()
    if (detail?.charts) {
      for (const chart of Object.values(detail.charts)) {
        if (chart.datasetId) ids.add(String(chart.datasetId))
      }
    }
    boardDatasetIds.value = [...ids]
    const fromChart = props.selectedEncode?.datasetId
      ? String(props.selectedEncode.datasetId)
      : ''
    selectedDatasetId.value =
      fromChart || boardDatasetIds.value[0] || list[0]?.id || ''
  } catch {
    datasets.value = []
  }
}

function scrollMsgs() {
  const el = msgsEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

async function ensureConversation() {
  const datasetIds = selectedDatasetId.value ? [selectedDatasetId.value] : undefined
  if (conversationId.value) {
    try {
      await conversationApi.update(conversationId.value, {
        linkedDashboardId: props.dashboardId,
        datasetIds
      })
      return conversationId.value
    } catch {
      conversationId.value = ''
      sessionStorage.removeItem(STORAGE_KEY)
    }
  }
  const created = await conversationApi.create({
    title: `SQLBot · ${props.dashboardId}`,
    linkedDashboardId: props.dashboardId,
    datasetIds
  })
  conversationId.value = created.id
  sessionStorage.setItem(STORAGE_KEY, created.id)
  return created.id
}

async function newChat() {
  conversationId.value = ''
  sessionStorage.removeItem(STORAGE_KEY)
  chat.value = []
  runId.value = ''
  canSave.value = false
  liveTools.value = []
  const q = { ...route.query }
  delete q.conversationId
  router.replace({ path: route.path, query: q })
}

function onEvent(event: string, data: Record<string, unknown>) {
  if (event === 'run') runId.value = String(data.runId || '')
  if (event === 'step') {
    const id = String(data.id || data.name || '')
    const raw = String(data.label || data.detail || id)
    if (/^(turn_|message_end|agent_end|agent_start|context|think)/.test(id)) return
    if (/推理轮次|轮次\s*\d+\s*结束|transformContext|skills \+ memory|assistant turn|^Pi Agent|^Lead /i.test(raw)) return
    const tool = String(data.tool || '')
    const label = (tool && TOOL_LABELS[tool]) || TOOL_LABELS[id] || raw.replace(/^调用\s+/, '').replace(/\s+完成$/, '')
    const preview = data.preview && typeof data.preview === 'object' ? (data.preview as ToolPreview) : undefined
    const hint = data.hint ? String(data.hint) : preview?.hint
    const kind = String(data.kind || '')
    const parent = data.parent ? String(data.parent) : ''
    const ended = kind === 'tool_end' || id === 'tool_execution_end'
    const child: ToolStep = {
      id: tool || id,
      label,
      status: ended ? 'done' : 'run',
      tool: tool || undefined,
      preview,
      hint,
      open: !!preview
    }
    if (parent) {
      const host = [...liveTools.value].reverse().find((t) => t.tool === parent || t.id === parent)
      if (host) {
        if (!host.children) host.children = []
        host.open = true
        if (ended) {
          const hit = [...host.children]
            .reverse()
            .find((t) => t.status === 'run' && (!tool || t.tool === tool || t.id === id))
          if (hit) {
            hit.status = 'done'
            hit.label = label
            if (preview) hit.preview = preview
            if (hint) hit.hint = hint
          } else {
            host.children.push(child)
          }
        } else {
          const running = host.children.find((t) => t.status === 'run' && (t.tool === tool || t.id === id))
          if (running) {
            running.label = label
            if (preview) running.preview = preview
            if (hint) running.hint = hint
          } else {
            host.children.push({ ...child, status: 'run' })
          }
        }
      }
    }
    if (!parent || ![...liveTools.value].some((t) => t.tool === parent || t.id === parent)) {
      if (ended) {
        const hit = [...liveTools.value].reverse().find((t) => t.status === 'run' && (!tool || t.tool === tool))
        if (hit) {
          hit.status = 'done'
          if (preview) hit.preview = preview
          if (hint) hit.hint = hint
          if (hit.preview || hit.children?.length) hit.open = true
        } else {
          liveTools.value.push({
            id: `${tool || id}-${liveTools.value.length}`,
            label,
            status: 'done',
            tool: tool || undefined,
            preview,
            hint,
            open: !!preview
          })
        }
      } else {
        const runningSame = [...liveTools.value]
          .reverse()
          .find((t) => t.status === 'run' && tool && t.tool === tool)
        if (runningSame) {
          if (preview) runningSame.preview = preview
          if (hint) runningSame.hint = hint
        } else {
          liveTools.value.push({
            id: `${tool || id}-${liveTools.value.length}`,
            label,
            status: 'run',
            tool: tool || undefined,
            preview,
            hint,
            open: !!preview
          })
        }
      }
    }
  }
  if (event === 'intent_map') {
    const mapping = Array.isArray(data.mapping)
      ? (data.mapping as ChatLine['mapping'])
      : []
    const unresolved = Array.isArray(data.unresolved)
      ? (data.unresolved as ChatLine['unresolved'])
      : []
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') {
      last.mapping = mapping
      last.unresolved = unresolved
    }
  }
  if (event === 'answer_sql') {
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') {
      last.sql = String(data.sql || '')
      if (!last.text) last.text = String(data.title || '已生成 SQL')
    }
  }
  if (event === 'answer_table') {
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') {
      last.columns = Array.isArray(data.columns) ? (data.columns as string[]) : []
      last.rows = Array.isArray(data.rows) ? (data.rows as unknown[][]) : []
      if (!last.text) last.text = String(data.title || '明细表')
    }
    canSave.value = true
  }
  if (event === 'answer_chart') {
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') {
      last.chartType = String(data.chartType || 'bar')
      last.labels = Array.isArray(data.labels) ? (data.labels as string[]) : []
      last.heights = Array.isArray(data.heights) ? (data.heights as number[]) : []
      if (!last.text) last.text = String(data.title || '图表')
    }
    canSave.value = true
  }
  if (event === 'answer_clarify') {
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') {
      last.clarify = true
      last.text = String(data.headlineHtml || data.title || '需要澄清后再问')
        .replace(/<[^>]+>/g, '')
    }
    canSave.value = false
  }
  if (event === 'message_delta') {
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') last.text += String(data.text || '')
  }
  if (event === 'error') {
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') {
      last.text = `错误: ${data.message || ''}`
    }
    canSave.value = false
  }
  if (event === 'chart_ready' && String(data.dashboardId || '') === props.dashboardId) {
    emit('applied')
  }
  nextTick(scrollMsgs)
}

async function send() {
  const text = prompt.value.trim()
  if (!text || streaming.value || !enabled.value) return
  streaming.value = true
  canSave.value = false
  liveTools.value = []
  prompt.value = ''
  chat.value.push({ role: 'user', text })
  chat.value.push({ role: 'assistant', text: '', tools: [] })
  await nextTick()
  scrollMsgs()
  try {
    const id = await ensureConversation()
    const datasetIds = selectedDatasetId.value ? [selectedDatasetId.value] : undefined
    await conversationApi.startRun(
      id,
      {
        message: text,
        intent: 'ask',
        mode: 'auto',
        selectedChartId: props.selectedChartId,
        selectedEncode: props.selectedEncode,
        datasetIds
      },
      onEvent
    )
    const last = chat.value[chat.value.length - 1]
    if (last?.role === 'assistant') {
      last.tools = [...liveTools.value]
      if (!last.text && !last.columns?.length && !last.chartType && !last.sql) {
        last.text = canSave.value ? '已查出结果（未写入画布）。' : '已完成。'
      }
    }
  } catch (e) {
    const last = chat.value[chat.value.length - 1]
    const msg = e instanceof Error ? e.message : String(e)
    if (last?.role === 'assistant') last.text = msg
    else chat.value.push({ role: 'system', text: msg })
  } finally {
    streaming.value = false
    liveTools.value = []
    await nextTick()
    scrollMsgs()
  }
}

async function saveToBoard() {
  if (!conversationId.value || !runId.value || streaming.value) return
  streaming.value = true
  try {
    await conversationApi.adopt(
      conversationId.value,
      runId.value,
      { action: 'save' },
      onEvent
    )
    chat.value.push({ role: 'system', text: '已保存到当前仪表盘草稿。' })
    emit('applied')
  } catch (e) {
    chat.value.push({
      role: 'system',
      text: e instanceof Error ? e.message : String(e)
    })
  } finally {
    streaming.value = false
  }
}

function goWorkspace() {
  router.push(conversationId.value ? `/conversations/${conversationId.value}` : '/conversations')
}

function closePanel() {
  open.value = false
}

function cell(v: unknown) {
  if (v == null) return ''
  return String(v)
}

async function onPickFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const detail = await datasetApi.importFile(file)
    datasets.value = await datasetApi.list()
    if (detail.meta?.id) selectedDatasetId.value = detail.meta.id
    chat.value.push({
      role: 'system',
      text: `已导入 ${file.name}，当前问数数据集切换为「${detail.meta?.name || file.name}」。`
    })
  } catch (e) {
    chat.value.push({
      role: 'system',
      text: e instanceof Error ? e.message : String(e)
    })
  } finally {
    importing.value = false
  }
}

function barStyle(h: number) {
  const n = Number.isFinite(h) ? Math.max(8, Math.min(100, h)) : 8
  return { height: `${n}%` }
}
</script>

<template>
  <div v-if="enabled && open" class="sqlbot-dock">
    <aside class="panel" role="dialog" aria-label="SQLBot 问数">
      <div class="head">
        <div class="brand">
          <span class="logo" aria-hidden="true">✦</span>
          <strong>SQLBot</strong>
        </div>
        <div class="head-acts">
          <button type="button" class="icon-btn" title="新对话" @click="newChat">＋</button>
          <button type="button" class="link" @click="goWorkspace">工作区</button>
          <button type="button" class="icon-btn" title="关闭" aria-label="关闭 SQLBot" @click="closePanel">
            ✕
          </button>
        </div>
      </div>

      <div ref="msgsEl" class="msgs">
        <div v-if="!chat.length" class="welcome">
          <div class="i-am">你好，我是 SQLBot</div>
          <div class="i-can">根据当前数据集生成查询 SQL、查出结果并画图。默认不改画布。</div>
        </div>
        <div v-for="(line, i) in chat" :key="i" class="msg" :class="line.role">
          <div class="asst-col">
            <ToolStepList
              v-if="line.role === 'assistant' && streaming && i === chat.length - 1"
              :steps="liveTools"
              live
            />
            <ToolStepList
              v-else-if="line.role === 'assistant' && line.tools?.length"
              :steps="line.tools"
            />
            <div
              v-if="
                line.mapping?.length ||
                line.text ||
                line.sql ||
                line.heights?.length ||
                line.columns?.length
              "
              class="bub"
            >
              <div v-if="line.mapping?.length" class="imap">
                <span v-for="(x, mi) in line.mapping" :key="'m' + mi" class="ok">
                  {{ x.phrase }} → {{ x.label || x.field }}
                </span>
                <span v-for="(u, ui) in line.unresolved" :key="'u' + ui" class="miss">
                  {{ u.phrase }}？
                </span>
              </div>
              <div v-if="line.text" class="bub-text" :class="{ clarify: line.clarify }">{{ line.text }}</div>
              <pre v-if="line.sql" class="sql">{{ line.sql }}</pre>
              <div v-if="line.heights?.length" class="mini-bars" :title="line.chartType">
                <i v-for="(h, hi) in line.heights.slice(0, 8)" :key="hi" :style="barStyle(h)" />
              </div>
              <div v-if="line.labels?.length" class="mini-labs">
                <span v-for="(l, li) in line.labels.slice(0, 8)" :key="li">{{ l }}</span>
              </div>
              <div v-if="line.columns?.length" class="mini-tbl">
                <table>
                  <thead>
                    <tr>
                      <th v-for="c in line.columns" :key="c">{{ c }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in (line.rows || []).slice(0, 6)" :key="ri">
                      <td v-for="(c, ci) in line.columns" :key="c">{{ cell(row[ci]) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="canSave && !streaming" class="adopt">
        <button class="primary" type="button" @click="saveToBoard">保存到仪表盘</button>
        <span class="hint">默认不改画布，与 DataEase SQLBot 一致</span>
      </div>

      <div class="ds-row">
        <span class="ds-lab">当前数据集</span>
        <select v-model="selectedDatasetId" :disabled="streaming">
          <option v-if="!datasetOptions.length" value="">暂无数据集</option>
          <option v-for="d in datasetOptions" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
        <button type="button" class="ghost" title="拾取当前图" @click="emit('pick')">拾取</button>
        <button type="button" class="ghost" :disabled="importing" @click="fileInput?.click()">
          {{ importing ? '导入中' : '上传' }}
        </button>
      </div>
      <input
        ref="fileInput"
        type="file"
        class="file-hidden"
        accept=".csv,.tsv,.txt,.xlsx"
        @change="onPickFile"
      />

      <div class="composer">
        <textarea
          v-model="prompt"
          rows="2"
          :disabled="streaming"
          :placeholder="selectedDatasetName ? `问 ${selectedDatasetName}，例如「近一年各商户收入」` : '描述要查的数据…'"
          @keydown.enter.exact.prevent="send"
        />
        <button
          class="primary send"
          type="button"
          :disabled="streaming || !prompt.trim()"
          @click.prevent="send"
        >
          {{ streaming ? '查询中' : '发送' }}
        </button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.sqlbot-dock {
  position: absolute;
  top: 48px;
  right: 12px;
  z-index: 130;
}
.panel {
  width: min(420px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 60px));
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #dee0e3;
  border-radius: 12px;
  box-shadow: 0 6px 24px #1f232914;
  overflow: hidden;
  animation: ai-in 0.16s ease-out;
}
@keyframes ai-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 56px;
  padding: 0 12px 0 16px;
  background: #1cba901a;
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #1f2329;
}
.logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #1cba90;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 13px;
}
.head-acts {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.link {
  border: 0;
  background: transparent;
  color: #1cba90;
  cursor: pointer;
  font-size: 12.5px;
  padding: 4px 6px;
}
.icon-btn {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #646a73;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.icon-btn:hover {
  background: #1f23291a;
  color: #1f2329;
}
.msgs {
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.welcome {
  margin: auto 0;
  text-align: center;
  padding: 24px 8px;
}
.i-am {
  font-size: 16px;
  font-weight: 600;
  color: #1f2329;
  margin-bottom: 8px;
}
.i-can {
  font-size: 13px;
  color: #646a73;
  line-height: 1.55;
}
.msg {
  display: flex;
}
.msg.user {
  justify-content: flex-end;
}
.msg.system {
  justify-content: center;
}
.asst-col {
  flex: 1;
  min-width: 0;
  max-width: 92%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  overflow: hidden;
}
.msg.user .asst-col {
  align-items: flex-end;
}
.bub {
  max-width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
}
.msg.user .bub {
  background: #1cba90;
  color: #fff;
  border-radius: 12px 12px 4px 12px;
}
.msg.assistant .bub {
  background: #fff;
  border: 1px solid #dee0e3;
  border-radius: 4px 12px 12px 12px;
}
.msg.system .bub {
  background: #fff8eb;
  color: #9a6700;
  font-size: 12px;
}
.bub-text {
  white-space: pre-wrap;
}
.bub-text.clarify {
  color: #d83931;
}
.sql {
  margin: 8px 0 0;
  padding: 8px;
  background: #0f1728;
  color: #d7e2ff;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.45;
  overflow: auto;
  max-height: 140px;
  white-space: pre-wrap;
  word-break: break-all;
}
.imap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.imap span {
  font-size: 11px;
  border-radius: 6px;
  padding: 2px 6px;
}
.imap .ok {
  background: #e8f8f3;
  color: #1cba90;
}
.imap .miss {
  background: #fdecec;
  color: #d83931;
}
.mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 56px;
  margin-top: 8px;
}
.mini-bars i {
  flex: 1;
  background: #1cba90;
  border-radius: 3px 3px 0 0;
  min-width: 8px;
  opacity: 0.85;
}
.mini-labs {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  font-size: 10px;
  color: #8f959e;
}
.mini-labs span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.mini-tbl {
  margin-top: 8px;
  overflow: auto;
  max-height: 160px;
}
.mini-tbl table {
  border-collapse: collapse;
  width: 100%;
  font-size: 11.5px;
}
.mini-tbl th,
.mini-tbl td {
  border-bottom: 1px solid #eee;
  padding: 4px 6px;
  text-align: left;
  white-space: nowrap;
}
.mini-tbl th {
  color: #8f959e;
  font-weight: 600;
}
.adopt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #f2f3f5;
  flex-shrink: 0;
}
.hint {
  font-size: 11.5px;
  color: #8f959e;
}
.ds-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #f2f3f5;
  flex-shrink: 0;
}
.ds-lab {
  font-size: 12px;
  color: #646a73;
  flex-shrink: 0;
}
.ds-row select {
  flex: 1;
  min-width: 0;
  height: 28px;
  border-radius: 6px;
  border: 1px solid #dee0e3;
  font-size: 12.5px;
}
.ghost {
  border: 1px solid #dee0e3;
  border-radius: 6px;
  padding: 4px 8px;
  background: #fff;
  color: #1cba90;
  cursor: pointer;
  font-size: 12px;
}
.ghost:disabled {
  opacity: 0.4;
}
.file-hidden {
  display: none;
}
.composer {
  display: flex;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid #dee0e3;
  flex-shrink: 0;
}
textarea {
  flex: 1;
  border: 1px solid #dee0e3;
  border-radius: 10px;
  padding: 8px;
  resize: none;
  font: inherit;
  font-size: 13px;
  box-sizing: border-box;
}
.primary {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: #1cba90;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.primary.send {
  align-self: flex-end;
}
.primary:disabled {
  opacity: 0.4;
}
</style>

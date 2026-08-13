<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { conversationApi } from '../api'

const props = defineProps<{
  dashboardId: string
  /** Optional encode snapshot from editor selection */
  selectedChartId?: string
  selectedEncode?: Record<string, unknown>
}>()

const emit = defineEmits<{
  pick: []
}>()

const route = useRoute()
const router = useRouter()

const open = ref(false)
const enabled = ref(false)
const conversationId = ref('')
const prompt = ref('')
const mode = ref<'auto' | 'plan'>('auto')
const streaming = ref(false)
const log = ref<string[]>([])
const runId = ref('')
const awaitingConfirm = ref(false)

const STORAGE_KEY = 'od.conversationId'

const title = computed(() => (conversationId.value ? `对话 #${conversationId.value}` : '对话（新建）'))

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
  if (enabled.value && conversationId.value) open.value = true
})

watch(
  () => route.query.conversationId,
  (v) => {
    if (v) {
      conversationId.value = String(v)
      sessionStorage.setItem(STORAGE_KEY, conversationId.value)
      open.value = true
    }
  }
)

async function ensureConversation() {
  if (conversationId.value) {
    await conversationApi.update(conversationId.value, { linkedDashboardId: props.dashboardId })
    return conversationId.value
  }
  const created = await conversationApi.create({
    title: `编辑器 · ${props.dashboardId}`,
    linkedDashboardId: props.dashboardId
  })
  conversationId.value = created.id
  sessionStorage.setItem(STORAGE_KEY, created.id)
  router.replace({ query: { ...route.query, conversationId: created.id } })
  return created.id
}

function onEvent(event: string, data: Record<string, unknown>) {
  if (event === 'run') runId.value = String(data.runId || '')
  if (event === 'step') log.value.push(String(data.label || data.id || 'step'))
  if (event === 'plan') {
    awaitingConfirm.value = true
    log.value.push('计划待确认')
  }
  if (event === 'chart_ready') log.value.push(`chart_ready ${data.chartId}`)
  if (event === 'message_delta') log.value.push(String(data.text || ''))
  if (event === 'error') log.value.push(`错误: ${data.message || ''}`)
  if (event === 'finish' && String(data.reason) === 'awaiting_confirm') awaitingConfirm.value = true
}

async function send() {
  if (!prompt.value.trim() || streaming.value || !enabled.value) return
  streaming.value = true
  awaitingConfirm.value = false
  log.value = []
  try {
    const id = await ensureConversation()
    const datasetIds =
      props.selectedEncode?.datasetId != null
        ? [String(props.selectedEncode.datasetId)]
        : undefined
    await conversationApi.startRun(
      id,
      {
        message: prompt.value.trim(),
        intent: 'gen',
        mode: mode.value,
        selectedChartId: props.selectedChartId,
        selectedEncode: props.selectedEncode,
        datasetIds
      },
      onEvent
    )
    prompt.value = ''
  } catch (e) {
    log.value.push(e instanceof Error ? e.message : String(e))
  } finally {
    streaming.value = false
  }
}

async function confirmPlan() {
  if (!conversationId.value || !runId.value || streaming.value) return
  streaming.value = true
  awaitingConfirm.value = false
  try {
    await conversationApi.confirmPlan(conversationId.value, runId.value, onEvent)
  } catch (e) {
    log.value.push(e instanceof Error ? e.message : String(e))
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
</script>

<template>
  <div v-if="enabled" class="ai-dock">
    <!-- Collapsed: single FAB -->
    <button v-if="!open" class="fab" type="button" title="打开 AI 对话" @click="open = true">
      AI
    </button>

    <!-- Open: panel with close in header (no floating 收起 pill) -->
    <aside v-else class="panel" role="dialog" aria-label="AI 对话">
      <div class="head">
        <strong>{{ title }}</strong>
        <div class="head-acts">
          <button type="button" class="link" @click="goWorkspace">工作区</button>
          <button type="button" class="icon-close" title="关闭" aria-label="关闭 AI 面板" @click="closePanel">
            ✕
          </button>
        </div>
      </div>
      <p class="hint">共享 conversationId；拾取当前图后发送，将写入本看板 draft。</p>
      <div class="pick-row">
        <button type="button" class="ghost" @click="emit('pick')">拾取当前图</button>
        <span class="meta">{{ selectedChartId ? `已选 ${selectedChartId}` : '未选图' }}</span>
      </div>
      <textarea v-model="prompt" rows="3" placeholder="描述要改的图表或布局…" />
      <div class="bar">
        <select v-model="mode">
          <option value="auto">Auto</option>
          <option value="plan">Plan</option>
        </select>
        <button class="primary" type="button" :disabled="streaming || !prompt.trim()" @click="send">
          发送
        </button>
      </div>
      <div v-if="awaitingConfirm" class="confirm">
        <button class="primary" type="button" :disabled="streaming" @click="confirmPlan">确认计划</button>
      </div>
      <ul class="log">
        <li v-for="(line, i) in log" :key="i">{{ line }}</li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.ai-dock {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 50;
}
.fab {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  border: 0;
  background: #3370ff;
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(51, 112, 255, 0.32);
}
.fab:hover {
  background: #2860e1;
}
.panel {
  width: min(360px, calc(100vw - 32px));
  max-height: min(480px, 60vh);
  overflow: auto;
  background: #fff;
  border: 1px solid #dee0e3;
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 16px 40px rgba(31, 35, 41, 0.14);
  animation: ai-in 0.16s ease-out;
}
@keyframes ai-in {
  from {
    opacity: 0;
    transform: translateY(8px);
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
  margin-bottom: 6px;
  gap: 8px;
}
.head-acts {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.link,
.ghost {
  border: 0;
  background: transparent;
  color: #3370ff;
  cursor: pointer;
  font-size: 12.5px;
}
.icon-close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #646a73;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.icon-close:hover {
  background: #f2f3f5;
  color: #1f2329;
}
.ghost {
  border: 1px solid #dee0e3;
  border-radius: 8px;
  padding: 4px 8px;
}
.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #8f959e;
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.meta {
  font-size: 12px;
  color: #646a73;
}
textarea {
  width: 100%;
  border: 1px solid #dee0e3;
  border-radius: 10px;
  padding: 8px;
  resize: vertical;
  font: inherit;
  box-sizing: border-box;
}
.bar {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
select {
  height: 32px;
  border-radius: 8px;
  border: 1px solid #dee0e3;
}
.primary {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: #3370ff;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.4;
}
.confirm {
  margin-top: 8px;
}
.log {
  margin: 10px 0 0;
  padding-left: 16px;
  font-size: 12px;
  color: #646a73;
  max-height: 160px;
  overflow: auto;
}
</style>

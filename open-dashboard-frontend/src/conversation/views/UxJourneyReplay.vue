<script setup lang="ts">
/**
 * P012 旅程回放：与真实「对话分析」同壳；内部对齐 dsh 高保表面
 *（用户气泡 / Think / 工具卡 / od-answer-* Node / Composer 打字发送）。
 * 不调用 Agent。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import DashboardEditorHost from '@/dashboard/hifi/DashboardEditorHost.vue'
import {
  UX_JOURNEY_DEFAULT_DELAY_MS,
  UX_JOURNEY_SCENES,
  UX_JOURNEY_TYPE_MS_PER_CHAR,
  type JourneyScene,
  type ReplayMsg,
} from '../uxJourneyReplay'

const router = useRouter()
const scenes = UX_JOURNEY_SCENES

const sceneIndex = ref(0)
const msgIndex = ref(-1)
const playing = ref(true)
const speed = ref(1)
const playAll = ref(false)
const threadEl = ref<HTMLElement | null>(null)
const composerText = ref('')
const typing = ref(false)
const hasDash = ref(false)
const linkedDashboardId = ref('')
const boardTitle = ref('')
const editorEpoch = ref(0)

let timer: ReturnType<typeof setTimeout> | null = null
let typeTimer: ReturnType<typeof setTimeout> | null = null

const scene = computed<JourneyScene>(() => scenes[sceneIndex.value] || scenes[0])
const messages = computed(() => scene.value.messages)
const visible = computed<ReplayMsg[]>(() => {
  if (msgIndex.value < 0) return []
  return messages.value.slice(0, msgIndex.value + 1)
})
const totalMsgs = computed(() => messages.value.length)
const isSceneEnd = computed(() => msgIndex.value >= totalMsgs.value - 1)
const isJourneyEnd = computed(
  () => sceneIndex.value >= scenes.length - 1 && isSceneEnd.value,
)
const progress = computed(() => {
  if (totalMsgs.value <= 0) return 0
  return ((msgIndex.value + 1) / totalMsgs.value) * 100
})

const cardKindLabel: Record<string, string> = {
  plan: 'od-plan',
  chart: 'od-answer-chart',
  table: 'od-answer-table',
  board: 'od-board-preview',
}

function clearTimers() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (typeTimer) {
    clearTimeout(typeTimer)
    typeTimer = null
  }
  typing.value = false
}

async function scrollBottom() {
  await nextTick()
  const el = threadEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function delayMs(base?: number) {
  return Math.max(160, (base ?? UX_JOURNEY_DEFAULT_DELAY_MS) / speed.value)
}

function openDash(id: string, title?: string) {
  const dashId = String(id || '').trim()
  if (!dashId) return
  linkedDashboardId.value = dashId
  boardTitle.value = title || `看板 ${dashId}`
  hasDash.value = true
  editorEpoch.value += 1
}

function closeDash() {
  hasDash.value = false
  linkedDashboardId.value = ''
  boardTitle.value = ''
}

function maybeOpenBoardFromMsg(msg: ReplayMsg) {
  if (msg.role === 'card' && msg.kind === 'board' && msg.dashboardId) {
    openDash(msg.dashboardId, msg.title)
  }
}

function typeUserThenCommit(text: string, onDone: () => void) {
  typing.value = true
  composerText.value = ''
  const chars = Array.from(text)
  let i = 0
  const step = () => {
    if (!playing.value) {
      composerText.value = text
      typing.value = false
      onDone()
      return
    }
    if (i >= chars.length) {
      typing.value = false
      typeTimer = setTimeout(() => {
        composerText.value = ''
        onDone()
      }, delayMs(320))
      return
    }
    composerText.value += chars[i]
    i += 1
    void scrollBottom()
    typeTimer = setTimeout(step, Math.max(8, UX_JOURNEY_TYPE_MS_PER_CHAR / speed.value))
  }
  step()
}

function revealNext() {
  clearTimers()
  if (!playing.value) return

  if (msgIndex.value >= totalMsgs.value - 1) {
    if (playAll.value && sceneIndex.value < scenes.length - 1) {
      timer = setTimeout(() => {
        sceneIndex.value += 1
        msgIndex.value = -1
        closeDash()
        composerText.value = ''
        revealNext()
      }, delayMs(700))
      return
    }
    playing.value = false
    return
  }

  const nextIdx = msgIndex.value + 1
  const next = messages.value[nextIdx]
  const wait = delayMs(next?.delayMs)

  timer = setTimeout(() => {
    if (next?.role === 'user') {
      typeUserThenCommit(next.text, () => {
        msgIndex.value = nextIdx
        void scrollBottom()
        revealNext()
      })
      return
    }
    msgIndex.value = nextIdx
    if (next) maybeOpenBoardFromMsg(next)
    void scrollBottom()
    revealNext()
  }, wait)
}

function startPlay() {
  playing.value = true
  revealNext()
}

function pause() {
  playing.value = false
  clearTimers()
  // 若打字中途暂停，把完整用户句立刻落进线程
  const nextIdx = msgIndex.value + 1
  const next = messages.value[nextIdx]
  if (composerText.value && next?.role === 'user' && composerText.value === next.text) {
    /* keep */
  }
}

function togglePlay() {
  if (playing.value) {
    pause()
    return
  }
  if (isSceneEnd.value) {
    if (isJourneyEnd.value) {
      sceneIndex.value = 0
      playAll.value = false
      closeDash()
    }
    msgIndex.value = -1
    composerText.value = ''
  }
  startPlay()
}

function goScene(i: number) {
  clearTimers()
  sceneIndex.value = Math.max(0, Math.min(scenes.length - 1, i))
  msgIndex.value = -1
  playAll.value = false
  composerText.value = ''
  closeDash()
  if (playing.value) revealNext()
  else void scrollBottom()
}

function seekMsg(i: number) {
  clearTimers()
  const target = Math.max(-1, Math.min(totalMsgs.value - 1, i))
  msgIndex.value = target
  composerText.value = ''
  closeDash()
  for (let k = 0; k <= target; k++) {
    const m = messages.value[k]
    if (m) maybeOpenBoardFromMsg(m)
  }
  void scrollBottom()
  if (playing.value) revealNext()
}

function prevMsg() {
  pause()
  if (msgIndex.value <= -1) {
    if (sceneIndex.value > 0) {
      const prev = sceneIndex.value - 1
      sceneIndex.value = prev
      closeDash()
      seekMsg(scenes[prev].messages.length - 1)
      pause()
    }
    return
  }
  seekMsg(msgIndex.value - 1)
  pause()
}

function nextMsg() {
  pause()
  if (msgIndex.value < totalMsgs.value - 1) {
    const next = messages.value[msgIndex.value + 1]
    msgIndex.value += 1
    composerText.value = ''
    if (next) maybeOpenBoardFromMsg(next)
    void scrollBottom()
    return
  }
  if (sceneIndex.value < scenes.length - 1) {
    goScene(sceneIndex.value + 1)
    pause()
  }
}

function setSpeed(v: number) {
  speed.value = v
  if (playing.value) {
    clearTimers()
    revealNext()
  }
}

function startPlayAll() {
  playAll.value = true
  sceneIndex.value = 0
  msgIndex.value = -1
  composerText.value = ''
  closeDash()
  startPlay()
}

function tryConversations() {
  void router.push('/conversations')
}

function onSeekInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  seekMsg(v - 1)
  pause()
}

watch(sceneIndex, () => {
  void scrollBottom()
})

onMounted(() => startPlay())
onBeforeUnmount(() => clearTimers())
</script>

<template>
  <div class="od-dsh-surface" :class="{ 'has-dash': hasDash }">
    <div class="od-dsh-surface__chat">
      <div class="od-dsh-surface__chrome">
        <span class="od-dsh-surface__chrome-label">对话分析</span>
        <span class="od-dsh-surface__chip">旅程回放 · 不调用 Agent</span>
        <span class="od-dsh-surface__sp" />
        <button
          v-for="(s, i) in scenes"
          :key="s.id"
          type="button"
          class="od-dsh-surface__btn ghost"
          :class="{ on: i === sceneIndex }"
          @click="goScene(i)"
        >{{ s.id }}</button>
        <button type="button" class="od-dsh-surface__btn ghost" @click="startPlayAll">全部</button>
        <router-link class="od-dsh-surface__btn" to="/conversations">退出回放</router-link>
      </div>

      <div class="dsh-replay">
        <header class="dsh-replay__top">
          <div class="dsh-replay__top-row">
            <div class="dsh-replay__title">{{ scene.sessionTitle }}</div>
            <span class="dsh-replay__sp" />
            <span class="dsh-replay__badge" :data-v="scene.verdict">{{ scene.verdictLabel }}</span>
            <span v-if="scene.draftHint" class="dsh-replay__draft">{{ scene.draftHint }}</span>
          </div>
          <div class="dsh-replay__tabs">
            <span class="dsh-replay__tab on">对话</span>
            <span class="dsh-replay__tab dim">轨迹</span>
          </div>
        </header>

        <div class="dsh-replay__body">
          <div ref="threadEl" class="dsh-replay__scroll">
            <div class="dsh-replay__feed">
              <div v-if="visible.length === 0 && !composerText" class="dsh-replay__empty">
                即将回放 {{ scene.id }} · {{ scene.title }}
              </div>

              <template v-for="(m, i) in visible" :key="`${scene.id}-${i}`">
                <div v-if="m.role === 'user'" class="bubble-user">{{ m.text }}</div>

                <div v-else-if="m.role === 'think'" class="think" :class="{ collapsed: m.collapsed !== false }">
                  <div class="think-hd">
                    <span>Think</span>
                    <span class="preview">{{ m.preview }}</span>
                  </div>
                  <div v-if="m.collapsed === false" class="think-body">{{ m.body }}</div>
                </div>

                <div v-else-if="m.role === 'tool'" class="tool collapsed">
                  <div class="tool-hd">
                    <span class="glyph">工</span>
                    <span class="name">{{ m.name }}</span>
                    <span class="hint">{{ m.hint }}</span>
                    <span class="st" :class="{ run: m.status === 'running' }">
                      {{ m.status === 'running' ? '运行中' : '完成' }}
                    </span>
                  </div>
                  <div v-if="m.body" class="tool-body">{{ m.body }}</div>
                </div>

                <div v-else-if="m.role === 'assistant'" class="assistant">
                  <p>{{ m.text }}</p>
                </div>

                <article v-else-if="m.role === 'card'" class="node">
                  <div class="node-hd">
                    <span class="badge">{{ cardKindLabel[m.kind] || m.kind }}</span>
                    <span class="ttl">{{ m.title }}</span>
                    <button
                      v-if="m.kind === 'board' && m.dashboardId"
                      type="button"
                      class="act"
                      @click="openDash(m.dashboardId!, m.title)"
                    >在右侧打开</button>
                  </div>
                  <div class="node-bd">
                    <pre>{{ m.body }}</pre>
                  </div>
                </article>

                <p v-else-if="m.role === 'system'" class="sys-note">{{ m.text }}</p>
              </template>
            </div>
          </div>

          <div class="dsh-replay__dock">
            <div class="dsh-replay__controls">
              <button type="button" class="ctl" @click="togglePlay">
                {{ playing ? '暂停' : isJourneyEnd ? '重播' : '播放' }}
              </button>
              <button type="button" class="ctl" :disabled="sceneIndex === 0 && msgIndex < 0" @click="prevMsg">上一条</button>
              <button type="button" class="ctl" :disabled="isJourneyEnd" @click="nextMsg">下一条</button>
              <span class="speeds">
                <button
                  v-for="s in [0.5, 1, 1.5]"
                  :key="s"
                  type="button"
                  class="ctl"
                  :class="{ on: speed === s }"
                  @click="setSpeed(s)"
                >{{ s }}x</button>
              </span>
              <label class="seek">
                <input
                  type="range"
                  min="0"
                  :max="totalMsgs"
                  :value="msgIndex + 1"
                  @input="onSeekInput"
                >
                <span>{{ Math.max(0, msgIndex + 1) }}/{{ totalMsgs }}</span>
              </label>
            </div>

            <div class="composer" :class="{ typing }">
              <textarea
                rows="2"
                readonly
                :value="composerText"
                :placeholder="playing || typing ? '回放输入中…' : '回放中 · 不可输入（与真实对话同表面）'"
              />
              <div class="bar">
                <button type="button" class="plus" disabled>+</button>
                <span class="sp" />
                <span class="seat">DeepSeek · replay</span>
                <button type="button" class="send" disabled>{{ typing ? '…' : '↑' }}</button>
              </div>
            </div>
            <div class="stats">
              {{ scene.id }} · {{ scene.title }} · 脚本回放
              <template v-if="scene.evidence?.length">
                ·
                <a
                  v-for="src in scene.evidence"
                  :key="src"
                  class="ev"
                  :href="src"
                  target="_blank"
                  rel="noopener"
                >截图</a>
              </template>
            </div>
          </div>
        </div>

        <div class="dsh-replay__track" aria-hidden="true">
          <div class="dsh-replay__track-fill" :style="{ width: `${progress}%` }" />
        </div>
      </div>
    </div>

    <aside v-if="hasDash && linkedDashboardId" class="od-dsh-surface__dash" aria-label="仪表盘编辑器">
      <header class="od-dsh-surface__dash-bar">
        <div class="od-dsh-surface__dash-title" :title="boardTitle">{{ boardTitle }}</div>
        <span class="od-dsh-surface__dash-id">draft {{ linkedDashboardId }}</span>
        <span class="od-dsh-surface__sp" />
        <a
          class="od-dsh-surface__btn"
          :href="`/dashboards/${linkedDashboardId}/edit`"
          target="_blank"
          rel="noopener"
        >全屏编辑</a>
        <button type="button" class="od-dsh-surface__btn ghost" @click="closeDash">收起</button>
      </header>
      <div class="od-dsh-surface__dash-body">
        <DashboardEditorHost
          :key="`${linkedDashboardId}:${editorEpoch}`"
          mode="editor"
          embedded
          :dashboard-id="linkedDashboardId"
        />
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* —— 与 ConversationDshSurface 同壳 —— */
.od-dsh-surface {
  display: flex;
  flex: 1;
  min-height: calc(100vh - 48px);
  width: 100%;
  height: 100%;
  background: #ffffff;
}
.od-dsh-surface__chat {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.od-dsh-surface__chrome {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--od-line, #e5e7eb);
  background: #fafbfc;
  overflow-x: auto;
}
.od-dsh-surface__chrome-label {
  font-size: 12px;
  font-weight: 650;
  color: #8f959e;
  white-space: nowrap;
}
.od-dsh-surface__chip {
  font-size: 11px;
  color: #4d6bfe;
  background: #eef1ff;
  border-radius: 6px;
  padding: 2px 8px;
  white-space: nowrap;
}
.od-dsh-surface.has-dash .od-dsh-surface__chat {
  flex: 0 0 34%;
  max-width: 34%;
  border-right: 1px solid var(--od-line, #e5e7eb);
}
.od-dsh-surface__sp { flex: 1; min-width: 8px; }
.od-dsh-surface__btn {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid #d0d3d6;
  background: #fff;
  color: #1f2329;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}
.od-dsh-surface__btn.ghost {
  background: transparent;
}
.od-dsh-surface__btn.on {
  border-color: #4d6bfe;
  color: #4d6bfe;
  background: #eef1ff;
}
.od-dsh-surface__btn:hover { border-color: #bbb; }
.od-dsh-surface__dash {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.od-dsh-surface__dash-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--od-line, #e5e7eb);
  background: #fafbfc;
  font-size: 13px;
}
.od-dsh-surface__dash-title {
  font-weight: 650;
  color: #1f2329;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.od-dsh-surface__dash-id {
  color: #8f959e;
  font-size: 12px;
}
.od-dsh-surface__dash-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* —— 对齐 hi-fi conversation-ask-dsh —— */
.dsh-replay {
  --ink: #0f1115;
  --ink-2: #3d4450;
  --muted: #6b7280;
  --faint: #9aa3af;
  --line: #eceef2;
  --line-2: #e2e5eb;
  --soft: #f5f6f8;
  --soft-2: #eef0f4;
  --accent: #4d6bfe;
  --accent-soft: #eef1ff;
  --ok: #1a7f4b;
  --user-bg: #f0f1f4;
  --chat-max: 760px;
  --shadow: 0 10px 40px rgba(15, 17, 21, 0.06);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}

.dsh-replay__top {
  flex-shrink: 0;
  padding: 12px 28px 0;
}
.dsh-replay__top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, var(--chat-max));
  margin: 0 auto;
}
.dsh-replay__title {
  font-size: 15px;
  font-weight: 650;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-replay__sp { flex: 1; }
.dsh-replay__badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fff7ed;
  color: #c2410c;
  white-space: nowrap;
}
.dsh-replay__badge[data-v='pass'] {
  background: #ecfdf5;
  color: #047857;
}
.dsh-replay__badge[data-v='fail'] {
  background: #fef2f2;
  color: #b91c1c;
}
.dsh-replay__draft {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.dsh-replay__tabs {
  display: flex;
  gap: 4px;
  width: min(100%, var(--chat-max));
  margin: 10px auto 0;
  border-bottom: 1px solid var(--line);
}
.dsh-replay__tab {
  height: 34px;
  padding: 0 12px;
  font-size: 13.5px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  position: relative;
}
.dsh-replay__tab.on {
  color: var(--accent);
  font-weight: 620;
}
.dsh-replay__tab.on::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
  border-radius: 2px 2px 0 0;
}
.dsh-replay__tab.dim { opacity: 0.45; }

.dsh-replay__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dsh-replay__scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 28px;
}
.dsh-replay__feed {
  width: min(100%, var(--chat-max));
  padding: 20px 0 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dsh-replay__empty {
  text-align: center;
  color: var(--faint);
  font-size: 13px;
  padding: 48px 12px;
}

.bubble-user {
  align-self: flex-end;
  max-width: 78%;
  padding: 8px 14px;
  border-radius: 18px;
  background: var(--user-bg);
  font-size: 14.5px;
  line-height: 1.45;
  animation: in 0.25s ease-out;
}
.assistant {
  font-size: 15px;
  line-height: 1.65;
  animation: in 0.25s ease-out;
}
.assistant p { margin: 0; }

.think-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  color: var(--muted);
  font-size: 13.5px;
}
.think-hd .preview {
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.think-body {
  margin-left: 22px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--soft);
  font-size: 13px;
  color: var(--muted);
  line-height: 1.55;
  white-space: pre-wrap;
}
.think.collapsed .think-body { display: none; }

.tool {
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  animation: in 0.25s ease-out;
}
.tool-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
}
.tool-hd .glyph {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--soft-2);
  display: grid;
  place-items: center;
  font-size: 10px;
  color: var(--muted);
  font-weight: 700;
}
.tool-hd .name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  font-weight: 600;
}
.tool-hd .hint {
  flex: 1;
  min-width: 0;
  color: var(--faint);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-hd .st {
  font-size: 11.5px;
  color: var(--ok);
  font-weight: 600;
}
.tool-hd .st.run { color: var(--accent); }
.tool-body {
  border-top: 1px solid var(--line);
  padding: 10px 12px;
  background: #fafbfc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
  line-height: 1.45;
  color: var(--ink-2);
}
.tool.collapsed .tool-body { display: none; }

.node {
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  animation: in 0.25s ease-out;
}
.node-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  background: #fafbfc;
}
.node-hd .badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.node-hd .ttl {
  flex: 1;
  font-size: 13px;
  font-weight: 650;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-hd .act {
  border: 1px solid var(--line-2);
  background: #fff;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
}
.node-bd {
  padding: 10px 12px 12px;
}
.node-bd pre {
  margin: 0;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-2);
  white-space: pre-wrap;
}

.sys-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
  background: #f8fafc;
  border: 1px dashed rgba(100, 106, 115, 0.35);
  border-radius: 8px;
  padding: 8px 10px;
}

.dsh-replay__dock {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 28px 10px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0), #fff 40%);
}
.dsh-replay__controls {
  width: min(100%, var(--chat-max));
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}
.ctl {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  cursor: pointer;
}
.ctl:disabled { opacity: 0.4; cursor: not-allowed; }
.ctl.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.speeds { display: inline-flex; gap: 4px; }
.seek {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 120px;
  font-size: 11px;
  color: var(--faint);
}
.seek input {
  flex: 1;
  accent-color: var(--accent);
}

.composer {
  width: min(100%, var(--chat-max));
  border: 1.5px dashed #d5d8e0;
  border-radius: 18px;
  background: #fff;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.composer.typing {
  border-color: #c5cae0;
}
.composer textarea {
  width: 100%;
  min-height: 52px;
  max-height: 140px;
  resize: none;
  border: 0;
  padding: 14px 16px 4px;
  outline: none;
  font-size: 15px;
  line-height: 1.45;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
}
.composer textarea::placeholder { color: var(--faint); }
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 10px;
}
.plus {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: var(--muted);
  display: grid;
  place-items: center;
  font-size: 20px;
  border: 0;
  background: none;
}
.seat {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--ink-2);
  display: inline-flex;
  align-items: center;
}
.bar .sp { flex: 1; }
.send {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 16px;
  border: 0;
  opacity: 0.55;
  cursor: not-allowed;
}

.stats {
  width: min(100%, var(--chat-max));
  padding: 6px 4px 0;
  font-size: 11.5px;
  color: var(--faint);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.stats .ev { color: var(--accent); }

.dsh-replay__track {
  height: 3px;
  background: rgba(15, 23, 42, 0.06);
  margin: 0 0 0;
}
.dsh-replay__track-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

@keyframes in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

@media (max-width: 900px) {
  .od-dsh-surface.has-dash .od-dsh-surface__chat {
    flex: 1;
    max-width: none;
    border-right: 0;
  }
  .od-dsh-surface__dash {
    display: none;
  }
}
</style>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  force?: boolean
}>()

const emit = defineEmits<{
  done: []
}>()

type Placement = 'right' | 'left' | 'center' | 'below'

type Step = {
  title: string
  body: string
  /** 优先匹配的选择器列表 */
  selectors: string[]
  placement: Placement
  /** 高亮区相对面板的内边距 */
  pad?: number
}

const visible = ref(false)
const step = ref(0)
const box = ref({ top: 0, left: 0, width: 0, height: 0 })
const cardPos = ref({ top: 80, left: 24 })

const steps: Step[] = [
  {
    title: '顶部 · 全局导航',
    body: '从这里切换工作台、数据源、数据集、仪表盘和报告，快速进入不同的数据分析流程。',
    selectors: ['.app-nav'],
    placement: 'below',
    pad: 4
  },
  {
    title: '顶部 · 编辑操作',
    body: '这里可切换 PC / 移动布局，撤销改动，并进行预览、分享和发布。',
    selectors: ['.hifi-dash-root .bar-editor .bar-actions', '.bar-editor .bar-actions', '.hifi-dash-root .bar', '.bar'],
    placement: 'below',
    pad: 4
  },
  {
    title: '左侧 · 组件库',
    body: '从这里挑选图表、查询控件、切片器或文本，点击或拖入中间画布。新建组件不会预填数据。',
    selectors: ['.editor > .pane:not(.insp)', '.pane:not(.insp)'],
    placement: 'right',
    pad: 6
  },
  {
    title: '中间 · 画布',
    body: '在画布拖拽移动、缩放布局。筛选条件请拖入「查询控件」组件，由你自行配置字段，不再固定在顶部。',
    selectors: ['.editor > .stage', '.stage'],
    placement: 'center',
    pad: 8
  },
  {
    title: '右侧 · 配置面板',
    body: '选中图表后，标题在页签上方。用胶囊切换数据 / 样式 / 高级（数据集列保持不动）。可分别收起图表配置或数据集；改完字段后点「更新数据」出图。',
    selectors: ['.editor > .pane.insp', '.pane.insp', '.insp'],
    placement: 'left',
    pad: 6
  }
]

const current = computed(() => steps[step.value])
const isLast = computed(() => step.value >= steps.length - 1)

function findTarget(selectors: string[]) {
  for (const s of selectors) {
    const el = document.querySelector(s) as HTMLElement | null
    if (el && el.getBoundingClientRect().width > 40) return el
  }
  return null
}

function measure() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const el = findTarget(current.value.selectors)
  const pad = current.value.pad ?? 8
  const cardW = Math.min(300, vw - 24)
  const cardH = 168

  if (!el) {
    // 兜底：按左 / 中 / 右三栏估算
    const top = 56
    const height = Math.max(200, vh - top - 16)
    if (step.value === 0) box.value = { top, left: 8, width: 220, height }
    else if (step.value === 1) box.value = { top, left: 236, width: Math.max(240, vw - 560), height }
    else box.value = { top, left: Math.max(8, vw - 308), width: 292, height }
  } else {
    const r = el.getBoundingClientRect()
    const top = Math.max(8, r.top - pad)
    const left = Math.max(8, r.left - pad)
    const right = Math.min(vw - 8, r.right + pad)
    const bottom = Math.min(vh - 8, r.bottom + pad)
    box.value = {
      top,
      left,
      width: Math.max(48, right - left),
      height: Math.max(48, bottom - top)
    }
  }

  const b = box.value
  let left = 16
  let top = b.top + 24

  if (current.value.placement === 'below') {
    left = b.left + (b.width - cardW) / 2
    top = b.top + b.height + 12
    if (left < 12) left = 12
    if (left + cardW > vw - 12) left = vw - cardW - 12
    if (top + cardH > vh - 12) top = Math.max(12, b.top - cardH - 12)
  } else if (current.value.placement === 'right') {
    // 卡片贴在高亮区右侧
    left = b.left + b.width + 14
    top = Math.min(b.top + 36, vh - cardH - 16)
    if (left + cardW > vw - 12) {
      left = Math.min(vw - cardW - 12, b.left + 16)
      top = Math.min(b.top + 48, vh - cardH - 16)
    }
  } else if (current.value.placement === 'left') {
    // 卡片贴在高亮区左侧
    left = b.left - cardW - 14
    top = Math.min(b.top + 36, vh - cardH - 16)
    if (left < 12) {
      left = Math.max(12, b.left - cardW + 24)
      top = Math.min(b.top + 48, vh - cardH - 16)
    }
  } else {
    // 画布：卡片落在高亮区中下部，避免挡住顶部工具条
    left = b.left + (b.width - cardW) / 2
    top = b.top + Math.min(b.height * 0.42, b.height - cardH - 24)
    if (left < 12) left = 12
    if (left + cardW > vw - 12) left = vw - cardW - 12
    if (top + cardH > vh - 12) top = Math.max(12, vh - cardH - 12)
    if (top < b.top + 12) top = b.top + 24
  }

  cardPos.value = { top: Math.max(12, top), left: Math.max(12, left) }
}

function finish() {
  visible.value = false
  emit('done')
}

function next() {
  if (isLast.value) {
    finish()
    return
  }
  step.value += 1
}

function prev() {
  if (step.value <= 0) return
  step.value -= 1
}

function skip() {
  finish()
}

/** 只在用户点「新手指引」或 URL 带 ?guide=1 时打开，不自动弹出 */
function open() {
  visible.value = true
  step.value = 0
  nextTick(() => setTimeout(measure, 160))
}

function onOpenRequest() {
  open()
}

watch(step, () => nextTick(measure))
watch(
  () => props.force,
  (v) => {
    if (v) open()
  }
)

onMounted(() => {
  if (props.force) setTimeout(open, 220)
  window.addEventListener('resize', measure)
  window.addEventListener('od:open-dashboard-guide', onOpenRequest)
})

onUnmounted(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('od:open-dashboard-guide', onOpenRequest)
})

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="guide" role="dialog" aria-modal="true" aria-label="新手指引">
      <div
        class="spot"
        :style="{
          top: box.top + 'px',
          left: box.left + 'px',
          width: box.width + 'px',
          height: box.height + 'px'
        }"
      />
      <div class="scrim" @click="skip" />
      <div class="card" :style="{ top: cardPos.top + 'px', left: cardPos.left + 'px' }">
        <div class="meta">
          <span class="step">{{ step + 1 }} / {{ steps.length }}</span>
          <span class="zone">{{ current.placement === 'below' ? '顶部操作' : current.placement === 'right' ? '左侧区域' : current.placement === 'left' ? '右侧区域' : '中间区域' }}</span>
        </div>
        <h3>{{ current.title }}</h3>
        <p>{{ current.body }}</p>
        <div class="acts">
          <button type="button" class="ghost" @click="skip">跳过</button>
          <button v-if="step > 0" type="button" class="ghost" @click="prev">上一步</button>
          <button type="button" class="primary" @click="next">{{ isLast ? '开始使用' : '下一步' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.guide {
  position: fixed;
  inset: 0;
  z-index: 120;
}
.scrim {
  position: absolute;
  inset: 0;
  background: transparent;
}
.spot {
  position: absolute;
  border-radius: 12px;
  box-shadow:
    0 0 0 9999px rgba(15, 23, 42, 0.52),
    0 0 0 2px #3370ff;
  pointer-events: none;
  transition:
    top 0.22s ease,
    left 0.22s ease,
    width 0.22s ease,
    height 0.22s ease;
  z-index: 1;
}
.card {
  position: absolute;
  width: min(300px, calc(100vw - 24px));
  background: #fff;
  border-radius: 12px;
  padding: 14px 16px 12px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
  z-index: 2;
  transition:
    top 0.22s ease,
    left 0.22s ease;
}
.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.step {
  font-size: 11px;
  color: #8f959e;
  font-weight: 600;
}
.zone {
  font-size: 11px;
  color: #3370ff;
  font-weight: 600;
}
h3 {
  margin: 0 0 6px;
  font-size: 15px;
  color: #1f2329;
}
p {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: #646a73;
}
.acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
button {
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid #dee0e3;
  background: #fff;
}
button.ghost {
  color: #646a73;
}
button.primary {
  background: #3370ff;
  border-color: #3370ff;
  color: #fff;
  font-weight: 600;
}
</style>

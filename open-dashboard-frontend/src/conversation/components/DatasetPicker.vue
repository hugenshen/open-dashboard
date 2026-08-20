<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DatasetMetaVO } from '../../datasource/api'

const props = withDefaults(
  defineProps<{
    datasets: DatasetMetaVO[]
    selectedIds: string[]
    open: boolean
    allowMulti?: boolean
    /** 落地页在输入框下方，列表朝下；工作区 Composer 贴底时朝上以免被裁切 */
    placement?: 'below' | 'above'
  }>(),
  { allowMulti: false, placement: 'below' }
)

const emit = defineEmits<{
  'update:open': [boolean]
  'update:selectedIds': [string[]]
}>()

const root = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const keyword = ref('')

const SYSTEM_RE = /验证|测试|工作室|拖拽|de_|dashboard|dashborad|数据源清单|低能/i

function isSystem(d: DatasetMetaVO) {
  return SYSTEM_RE.test(`${d.name || ''} ${d.tableName || ''} ${d.folder || ''}`)
}

const ranked = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const list = props.datasets.filter((d) => {
    if (!kw) return true
    return (
      (d.name || '').toLowerCase().includes(kw) || (d.tableName || '').toLowerCase().includes(kw)
    )
  })
  const selected = new Set(props.selectedIds)
  return [...list].sort((a, b) => {
    const as = selected.has(a.id) ? 2 : isSystem(a) ? 0 : 1
    const bs = selected.has(b.id) ? 2 : isSystem(b) ? 0 : 1
    return bs - as
  })
})

const chipLabel = computed(() => {
  const ids = props.selectedIds
  if (!ids.length) return '选择数据集'
  const names = ids
    .map((id) => props.datasets.find((d) => d.id === id)?.name)
    .filter((n): n is string => !!n)
  if (!names.length) return `${ids.length} 个数据集`
  if (names.length === 1) return names[0]
  return `${names[0]} +${names.length - 1}`
})

function toggleOpen() {
  emit('update:open', !props.open)
}

function pick(id: string) {
  if (props.allowMulti) {
    const set = new Set(props.selectedIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    emit('update:selectedIds', [...set])
    return
  }
  emit('update:selectedIds', [id])
  emit('update:open', false)
}

function onDocDown(ev: MouseEvent) {
  if (!props.open) return
  const t = ev.target as Node
  if (root.value && !root.value.contains(t)) emit('update:open', false)
}

watch(
  () => props.open,
  async (v) => {
    if (v) {
      await nextTick()
      searchEl.value?.focus()
    } else {
      keyword.value = ''
    }
  }
)

onMounted(() => document.addEventListener('mousedown', onDocDown))
onUnmounted(() => document.removeEventListener('mousedown', onDocDown))
</script>

<template>
  <div ref="root" class="ds-picker">
    <button
      type="button"
      class="chip"
      :class="{ empty: !selectedIds.length, open }"
      @click="toggleOpen"
    >
      <span class="lab">{{ chipLabel }}</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>
    <div v-if="open" class="pop" :class="placement" role="listbox">
      <div class="search">
        <input ref="searchEl" v-model="keyword" type="text" placeholder="搜索表名…" />
        <span class="n">{{ selectedIds.length }} 已选</span>
      </div>
      <div class="list">
        <button
          v-for="d in ranked"
          :key="d.id"
          type="button"
          class="row"
          :class="{ on: selectedIds.includes(d.id), sys: isSystem(d) && !selectedIds.includes(d.id) }"
          @click="pick(d.id)"
        >
          <span class="name">{{ d.name }}</span>
          <span class="meta">{{ d.tableName || d.folder || '' }}</span>
        </button>
        <div v-if="!ranked.length" class="empty">没有匹配的数据集</div>
      </div>
      <div class="tip">{{ allowMulti ? '可多选，点空白处关闭' : '点选一张表即用，点空白处关闭' }}</div>
    </div>
  </div>
</template>

<style scoped>
.ds-picker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line-2, #e5e6eb);
  border-radius: 999px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #1f2329);
  cursor: pointer;
}
.chip .lab {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.chip .chev {
  color: #8b8f97;
  font-size: 10px;
  flex-shrink: 0;
}
.chip.open {
  border-color: #c9d7ff;
  background: #f5f8ff;
  color: #245bdb;
}
.chip.empty {
  color: #d25f00;
  border-style: dashed;
}
.pop {
  position: absolute;
  left: 0;
  z-index: 20;
  width: min(380px, calc(100vw - 48px));
  padding: 8px;
  border: 1px solid #eceef1;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 32px rgba(31, 35, 41, 0.12);
}
.pop.below {
  top: calc(100% + 8px);
}
.pop.above {
  bottom: calc(100% + 8px);
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.search input {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 1px solid #eceef1;
  border-radius: 8px;
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  outline: 0;
}
.search input:focus {
  border-color: #3370ff;
}
.search .n {
  flex-shrink: 0;
  font-size: 12px;
  color: #8b8f97;
}
.list {
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: #f7f8fa;
}
.row.on {
  background: #f0f4ff;
}
.row.sys .name,
.row.sys .meta {
  color: #8b8f97;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}
.meta {
  flex-shrink: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: #8b8f97;
}
.empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12.5px;
  color: #8b8f97;
}
.tip {
  margin-top: 6px;
  padding: 4px 6px 2px;
  font-size: 11.5px;
  color: #8b8f97;
}
</style>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import './catalog.css'

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(e: Event) {
  e.stopPropagation()
  open.value = !open.value
}

function onDoc(e: Event) {
  if (!open.value) return
  const el = root.value
  if (el && e.target instanceof Node && !el.contains(e.target)) open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

function close() {
  open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDoc)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDoc)
  document.removeEventListener('keydown', onKey)
})

defineExpose({ close })
</script>

<template>
  <div ref="root" class="catalog-more">
    <button
      type="button"
      class="icon-btn"
      :class="{ open }"
      aria-label="更多"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="3.5" cy="8" r="1.4" />
        <circle cx="8" cy="8" r="1.4" />
        <circle cx="12.5" cy="8" r="1.4" />
      </svg>
    </button>
    <div v-if="open" class="row-menu" role="menu" @click="close">
      <slot />
    </div>
  </div>
</template>

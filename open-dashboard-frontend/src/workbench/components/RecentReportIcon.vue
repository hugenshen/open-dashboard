<script setup lang="ts">
export type ReportIconKind = 'draft' | 'published'

defineProps<{
  kind: ReportIconKind
}>()
</script>

<template>
  <div class="ico" :class="kind" aria-hidden="true">
    <svg v-if="kind === 'published'" viewBox="0 0 36 36" fill="none">
      <rect x="8.5" y="6.5" width="19" height="23" rx="3.2" fill="#fff" stroke="#047857" stroke-width="1.6" />
      <path d="M20 6.5v5.2h5.2" stroke="#047857" stroke-width="1.6" fill="#a7f3d0" />
      <path d="M13.5 20.5l3.2 3.2 6.4-6.8" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <svg v-else viewBox="0 0 36 36" fill="none">
      <rect x="8.5" y="6.5" width="19" height="23" rx="3.2" fill="#fff" stroke="#7c3aed" stroke-width="1.6" />
      <path d="M20 6.5v5.2h5.2" stroke="#7c3aed" stroke-width="1.6" fill="#ddd6fe" />
      <path d="M13 17.5h10M13 21.5h10M13 25.5h6.5" stroke="#c4b5fd" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  </div>
</template>

<style scoped>
.ico {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.ico svg {
  width: 36px;
  height: 36px;
  display: block;
}
.ico.draft {
  background: linear-gradient(145deg, #f5f3ff, #ede9fe);
}
.ico.published {
  background: linear-gradient(145deg, #ecfdf5, #d1fae5);
}

html[data-od-theme='dark'] .ico.draft {
  background: linear-gradient(145deg, #2a2244, #221b38);
}
html[data-od-theme='dark'] .ico.published {
  background: linear-gradient(145deg, #163028, #12241e);
}
</style>

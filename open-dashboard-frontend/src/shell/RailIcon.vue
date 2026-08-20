<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <template v-if="name === 'workbench'">
      <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </template>
    <template v-else-if="name === 'conversations'">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </template>
    <template v-else-if="name === 'datasources'">
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </template>
    <template v-else-if="name === 'datasets'">
      <path d="M4 6h16M4 12h16M4 18h10" />
      <circle cx="18" cy="18" r="2" />
    </template>
    <template v-else-if="name === 'dataPlaza'">
      <path d="M4 8h16l-2 11H6z" />
      <path d="M8 8V5h8v3" />
      <path d="M9 13h6M9 17h4" />
    </template>
    <template v-else-if="name === 'dimensions'">
      <path d="M5 5h14v14H5z" />
      <path d="M9 5v14M5 10h14M5 15h14" />
    </template>
    <template v-else-if="name === 'workspaceAdmin'">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M18 8v6M15 11h6" />
    </template>
    <template v-else-if="name === 'reports'">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
    </template>
    <template v-else>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </template>
  </svg>
</template>

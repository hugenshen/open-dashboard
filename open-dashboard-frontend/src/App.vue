<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './shell/AppShell.vue'

const route = useRoute()
const hideShell = computed(() => !!route.meta.hideShell)
</script>

<template>
  <AppShell v-if="!hideShell">
    <router-view />
  </AppShell>
  <router-view v-else />
</template>

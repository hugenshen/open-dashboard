<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const fullBleed = computed(() => !!route.meta.fullBleed)
</script>

<template>
  <div class="app-shell" :class="{ 'full-bleed': fullBleed }">
    <main class="main" :class="{ 'main-bleed': fullBleed }">
      <router-view />
    </main>
  </div>
</template>

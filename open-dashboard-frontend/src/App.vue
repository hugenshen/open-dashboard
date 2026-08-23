<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './shell/AppShell.vue'
import ConversationDshSurface from './conversation/views/ConversationDshSurface.vue'

const route = useRoute()
const hideShell = computed(() => !!route.meta.hideShell)
/** Live dsh iframe must stay in the DOM; keep-alive still unloads it. */
const isConversationSurface = computed(() => route.name === 'conversations')
const keepConversation = ref(false)
watch(
  isConversationSurface,
  (on) => {
    if (on) keepConversation.value = true
  },
  { immediate: true },
)
</script>

<template>
  <AppShell v-if="!hideShell">
    <ConversationDshSurface v-if="keepConversation" v-show="isConversationSurface" />
    <router-view v-if="!isConversationSurface" />
  </AppShell>
  <router-view v-else />
</template>

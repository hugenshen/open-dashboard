<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number
  }>(),
  { size: 36 }
)
</script>

<template>
  <img
    class="dataq-mark"
    src="/od-ip-B1-otter-lower-left.png"
    alt=""
    :width="size"
    :height="size"
    draggable="false"
  />
</template>

<style scoped>
.dataq-mark {
  display: block;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  object-position: 18% 78%;
  image-rendering: -webkit-optimize-contrast;
}
</style>

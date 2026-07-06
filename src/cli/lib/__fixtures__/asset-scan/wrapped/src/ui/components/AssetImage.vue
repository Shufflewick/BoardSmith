<template>
  <img v-if="loaded" :src="src" :alt="alt" />
  <div v-else class="asset-fallback" :class="kind">{{ alt ?? kind }}</div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  src: string;
  kind: 'card' | 'piece' | 'token';
  alt?: string;
}>();

const loaded = ref(false);

watch(
  () => props.src,
  (src) => {
    loaded.value = false;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      loaded.value = true;
    };
    img.onerror = () => {
      loaded.value = false;
    };
    img.src = src;
  },
  { immediate: true },
);
</script>

<script setup lang="ts">
/**
 * CardBack — the back of one face-down card: the given back image, or the
 * theme's card-back token when there is none. Shared by every renderer that
 * draws a card nobody may read.
 */
import { getSpriteStyle, type ImageInfo } from '../../../utils/image.js';

defineProps<{
  image: ImageInfo | null;
}>();
</script>

<template>
  <div class="card-back" :class="{ 'has-image': !!image }">
    <img v-if="image?.type === 'url'" :src="image.src" class="card-back-image" alt="Card back" />
    <div
      v-else-if="image?.type === 'sprite'"
      class="card-back-image"
      :style="getSpriteStyle(image)"
    ></div>
  </div>
</template>

<style scoped>
.card-back {
  width: var(--card-w);
  height: var(--card-h);
  background: var(--bsg-card-back);
  border-radius: var(--bsg-r-sm);
  border: 1px solid var(--bsg-line-2);
  box-shadow: var(--bsg-shadow-sm);
  flex-shrink: 0;
}

.card-back.has-image {
  background: transparent;
  border: none;
}

.card-back-image {
  width: 100%;
  height: 100%;
  border-radius: var(--bsg-r-sm);
  object-fit: contain;
}
</style>

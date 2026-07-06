<template>
  <div class="game-table">
    <div v-for="card in hand" :key="card.id" class="card">
      <AssetImage :src="cardImage(card, 'face')" kind="card" :alt="card.name" />
    </div>
  </div>
</template>

<script setup lang="ts">
import AssetImage from './AssetImage.vue';

defineProps<{ hand: Array<{ id: string; name: string }> }>();

function cardImage(card: { id: string; name: string }, side: 'face' | 'back'): string {
  return `/cards/${card.id}-${side}.svg`;
}
</script>

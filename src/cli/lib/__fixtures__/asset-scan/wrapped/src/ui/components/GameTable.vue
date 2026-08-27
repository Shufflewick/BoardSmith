<template>
  <div class="game-table">
    <div v-for="card in hand" :key="card.id" class="card">
      <AssetImage :src="cardImage(card, 'face')" aspect-ratio="2 / 3" :alt="card.name">
        <span class="card-drawn">{{ card.name }}</span>
      </AssetImage>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AssetImage } from 'boardsmith/ui';

defineProps<{ hand: Array<{ id: string; name: string }> }>();

function cardImage(card: { id: string; name: string }, side: 'face' | 'back'): string {
  return `/cards/${card.id}-${side}.svg`;
}
</script>

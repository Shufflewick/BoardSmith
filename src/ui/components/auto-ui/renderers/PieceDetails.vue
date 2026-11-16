<script setup lang="ts">
/**
 * PieceDetails — a piece's full name and the game's own attributes, drawn
 * beside its token where the row has room, so a player sees the state their
 * actions change without hovering or tapping anything (#1628).
 */
import type { GameElement } from '../auto-ui-helpers.js';
import AttributeList from './AttributeList.vue';

defineProps<{
  element: GameElement;
}>();
</script>

<template>
  <div class="piece-details">
    <span class="piece-name">{{ element.name ?? element.className }}</span>
    <AttributeList :element="element" />
  </div>
</template>

<style scoped>
.piece-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 13px;
  color: var(--bsg-ink-2);
}

.piece-name {
  font-weight: 700;
  color: var(--bsg-ink);
  overflow-wrap: anywhere;
}
</style>

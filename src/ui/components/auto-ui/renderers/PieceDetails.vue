<script setup lang="ts">
/**
 * PieceDetails — a piece's full name and the game's own attributes, drawn
 * beside its token where the row has room, so a player sees the state their
 * actions change without hovering or tapping anything (#1628).
 */
import { computed, inject } from 'vue';
import { GAME_VIEW_KEY, gameAttributeRows, type GameElement } from '../auto-ui-helpers.js';

const props = defineProps<{
  element: GameElement;
}>();

const gameView = inject(GAME_VIEW_KEY, undefined);

const rows = computed(() => gameAttributeRows(props.element, gameView?.value));
</script>

<template>
  <div class="piece-details">
    <span class="piece-name">{{ element.name ?? element.className }}</span>
    <dl v-if="rows.length" class="piece-attributes">
      <div v-for="[key, text] in rows" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ text }}</dd>
      </div>
    </dl>
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

.piece-attributes {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}

.piece-attributes > div {
  display: flex;
  gap: 4px;
}

.piece-attributes dt {
  color: var(--bsg-ink-3);
}

.piece-attributes dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
</style>

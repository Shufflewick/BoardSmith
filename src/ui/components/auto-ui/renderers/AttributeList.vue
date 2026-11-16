<script setup lang="ts">
/**
 * AttributeList — an element's own game attributes as label and value pairs,
 * engine structure left out and references named (#1628, #1667).
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
  <dl v-if="rows.length" class="attribute-list">
    <div v-for="[key, text] in rows" :key="key">
      <dt>{{ key }}</dt>
      <dd>{{ text }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.attribute-list {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  font-size: 13px;
  color: var(--bsg-ink-2);
}

.attribute-list > div {
  display: flex;
  gap: 4px;
}

.attribute-list dt {
  color: var(--bsg-ink-3);
}

.attribute-list dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
</style>

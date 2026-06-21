<script setup lang="ts">
/**
 * CardTemplate — Hand-dominant layout archetype (RENDER-03, D-02).
 *
 * Layout hierarchy:
 *   peripheral zone — auto height; decks, discard piles, other non-hand elements
 *   hand zone       — flex: 1; DOMINANT; hand(s) centered here
 *
 * C6 anti-pattern explicitly avoided: hands get the dominant flex:1 area.
 * Decks/discards are treated as peripheral (auto-height) above the hands.
 *
 * Children are rendered exclusively through ElementRenderer.
 */

import { computed } from 'vue';
import ElementRenderer from '../renderers/ElementRenderer.vue';

// ---------------------------------------------------------------------------
// Local GameElement interface — mirrors auto-ui-helpers.ts / ElementRenderer.vue
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
  __hidden?: boolean;
}

const props = defineProps<{
  topLevelChildren: GameElement[];
  gameView?: GameElement | null;
}>();

// ---------------------------------------------------------------------------
// Child classification
// ---------------------------------------------------------------------------

/** Hand elements: dominant zone — fill remaining space */
const handElements = computed(() =>
  props.topLevelChildren.filter(el =>
    el.attributes?.$type === 'hand' || el.className === 'Hand'
  )
);

/** Peripheral elements: decks, discards, any non-hand zones — auto-height above hands */
const peripheralElements = computed(() =>
  props.topLevelChildren.filter(el =>
    el.attributes?.$type !== 'hand' && el.className !== 'Hand'
  )
);
</script>

<template>
  <div class="card-template">
    <!-- Peripheral zones: decks, discard piles — auto height -->
    <div v-if="peripheralElements.length > 0" class="card-template__peripheral">
      <ElementRenderer
        v-for="el in peripheralElements"
        :key="el.id"
        :element="el"
        :depth="0"
      />
    </div>

    <!-- Hand zone: DOMINANT — flex: 1; hands are centered here -->
    <div class="card-template__hands">
      <ElementRenderer
        v-for="el in handElements"
        :key="el.id"
        :element="el"
        :depth="0"
      />
    </div>
  </div>
</template>

<style scoped>
.card-template {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Peripheral zones: auto height — decks, discards above the hands */
.card-template__peripheral {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px;
}

/* Hand zone: DOMINANT — hands fill remaining vertical space */
.card-template__hands {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
</style>

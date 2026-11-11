<script setup lang="ts">
/**
 * GridBoardTemplate — Focal-board / docked-hand / peripheral-chrome archetype.
 *
 * Layout hierarchy (RENDER-03, D-02):
 *   chrome row  — auto height; colllapses when no peripheral elements (decks, scores, etc.)
 *   board area  — 1fr; DOMINANT; grid/hex board renders here
 *   hand strip  — auto height (max 30vh); absent when no hand elements
 *
 * C6 anti-pattern explicitly avoided: non-board elements (decks, discards) go in
 * the chrome slot — they are NEVER given equal grid area alongside the focal board.
 *
 * Children are rendered exclusively through ElementRenderer (no direct element rendering).
 */

import { computed } from 'vue';
import ElementRenderer from '../renderers/ElementRenderer.vue';
import type { GameElement } from '../auto-ui-helpers.js';

const props = defineProps<{
  topLevelChildren: GameElement[];
}>();

// ---------------------------------------------------------------------------
// Child classification
// ---------------------------------------------------------------------------

/** Grid board elements: $layout === 'grid' or 'hex-grid' — occupy the dominant 1fr area */
const boardElements = computed(() =>
  props.topLevelChildren.filter(el =>
    el.attributes?.$layout === 'grid' || el.attributes?.$layout === 'hex-grid'
  )
);

/** Hand elements: $type === 'hand' — docked at the bottom as a collapsed strip */
const handElements = computed(() =>
  props.topLevelChildren.filter(el => el.attributes?.$type === 'hand')
);

/** Chrome elements: everything else — decks, discards, scores, etc. — docked at the top */
const chromeElements = computed(() =>
  props.topLevelChildren.filter(el =>
    el.attributes?.$layout !== 'grid' &&
    el.attributes?.$layout !== 'hex-grid' &&
    el.attributes?.$type !== 'hand'
  )
);
</script>

<template>
  <div class="grid-board-template">
    <!-- Peripheral chrome: decks, discard piles, scores — auto height, collapses when empty -->
    <div v-if="chromeElements.length > 0" class="grid-board-template__chrome">
      <ElementRenderer
        v-for="el in chromeElements"
        :key="el.id"
        :element="el"
      />
    </div>

    <!-- Focal board area: dominant 1fr — grid or hex board goes here -->
    <div class="grid-board-template__board">
      <ElementRenderer
        v-for="el in boardElements"
        :key="el.id"
        :element="el"
      />
    </div>

    <!-- Docked hand strip: auto height (max 30vh), absent when no hands exist -->
    <div v-if="handElements.length > 0" class="grid-board-template__hand">
      <ElementRenderer
        v-for="el in handElements"
        :key="el.id"
        :element="el"
      />
    </div>
  </div>
</template>

<style scoped>
.grid-board-template {
  display: grid;
  /* Every row as wide as the template, so the hand wraps; a board wider than that overflows its row (issue 1608). */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "chrome"
    "board"
    "hand";
  height: 100%;
}

/* Chrome slot: peripheral zones (decks, scores) — auto height, collapses when empty */
.grid-board-template__chrome {
  grid-area: chrome;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
}

/* Board slot: DOMINANT area — the focal grid/hex board, its cells sized from the
   region's width. A board that cannot fit at the tap floor overflows, and the board
   region scrolls to it: `safe` keeps its left edge reachable (issue 1608). A second board wraps below. */
.grid-board-template__board {
  grid-area: board;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
  justify-content: safe center;
}

/* Hand strip: docked at bottom — fluid clamp replaces fixed 30vh viewport unit */
.grid-board-template__hand {
  grid-area: hand;
  max-height: clamp(96px, 22vh, 180px);
  overflow-x: auto;
  display: flex;
  gap: 8px;
  padding: 8px;
}
</style>

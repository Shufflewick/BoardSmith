<script setup lang="ts">
/**
 * GridBoardTemplate — Focal-board / docked-hand / peripheral-chrome archetype.
 *
 * Layout hierarchy (RENDER-03, D-02):
 *   chrome row  — auto height; colllapses when no peripheral elements (decks, scores, etc.)
 *   board area  — 1fr; DOMINANT; grid/hex board renders here
 *   hand strip  — auto height (96px to 180px), wraps its hands and scrolls down; absent when no hand elements
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
        details
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

    <!-- Docked hand strip: wraps its hands, absent when no hands exist -->
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
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "chrome"
    "board"
    "hand";
  height: 100%;
}

/* Chrome slot (decks, scores) and hand strip: each a row that wraps at the region's width */
.grid-board-template__chrome,
.grid-board-template__hand {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  /* The board region's width, so the row wraps there (issue 1608). */
  max-width: 100cqw;
  box-sizing: border-box;
}

/* Chrome slot: peripheral zones — auto height, collapses when empty */
.grid-board-template__chrome {
  grid-area: chrome;
}

/* Board slot: DOMINANT area — the focal grid/hex board, its cells sized from the
   region's width. A second board wraps below at the region's width; a board that
   cannot fit at the tap floor widens the slot, and the board region scrolls to it.
   `safe` keeps a board's left edge reachable (issue 1608). */
.grid-board-template__board {
  grid-area: board;
  min-height: 0;
  max-width: 100cqw;
  min-width: min-content;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
  justify-content: safe center;
}

/* Hand strip: docked at bottom, its hands wrapped and scrolled down past the clamp */
.grid-board-template__hand {
  grid-area: hand;
  max-height: clamp(96px, 22vh, 180px);
  overflow-y: auto;
}
</style>

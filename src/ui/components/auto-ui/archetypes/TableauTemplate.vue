<script setup lang="ts">
/**
 * TableauTemplate — General flex-wrap fallback archetype (RENDER-03).
 *
 * This is the catch-all for addressable-but-unspecialized topologies (stack,
 * hand, space containers) that did not match the grid-board or card archetypes.
 *
 * Every child is rendered via ElementRenderer — this template MUST never produce
 * a blank screen. All zones render through their per-element renderer.
 *
 * No prescribed hierarchy — flex-wrap of zone containers.
 */

import ElementRenderer from '../renderers/ElementRenderer.vue';
import type { GameElement } from '../auto-ui-helpers.js';

defineProps<{
  topLevelChildren: GameElement[];
}>();
</script>

<template>
  <div class="tableau-template">
    <!-- Every child is rendered via ElementRenderer — never blank -->
    <ElementRenderer
      v-for="el in topLevelChildren"
      :key="el.id"
      :element="el"
    />
  </div>
</template>

<style scoped>
.tableau-template {
  display: flex;
  flex-wrap: wrap;
  gap: var(--bsg-s4);
  height: 100%;
  overflow: auto;
  padding: var(--bsg-s4);
  /* The board region's width, so the row wraps there (issue 1608). */
  max-width: 100cqw;
  box-sizing: border-box;
  align-content: flex-start;
}
</style>

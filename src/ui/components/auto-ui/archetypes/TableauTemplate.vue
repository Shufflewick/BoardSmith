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

defineProps<{
  topLevelChildren: GameElement[];
  gameView?: GameElement | null;
}>();
</script>

<template>
  <div class="tableau-template">
    <!-- Every child is rendered via ElementRenderer — never blank -->
    <ElementRenderer
      v-for="el in topLevelChildren"
      :key="el.id"
      :element="el"
      :depth="0"
    />
  </div>
</template>

<style scoped>
.tableau-template {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  height: 100%;
  overflow: auto;
  padding: 16px;
  align-content: flex-start;
}
</style>

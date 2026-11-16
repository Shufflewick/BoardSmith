<script setup lang="ts">
/**
 * PieceDetailsTip — a piece's PieceDetails in a tip beside it, for a piece
 * whose row has no room to draw them (a board cell, a hand fan, a deck stack, #1667).
 *
 * Teleported to body so a cell, fan or stack cannot clip it; Teleport keeps the
 * component tree, so PieceDetails still names references from the game view.
 */
import { ref, onMounted } from 'vue';
import { computePopoverPosition } from '../../helpers/popover-position.js';
import type { GameElement } from '../auto-ui-helpers.js';
import PieceDetails from './PieceDetails.vue';

const props = defineProps<{
  id: string;
  element: GameElement;
  anchor: HTMLElement;
}>();

const box = ref<HTMLDivElement | null>(null);
const place = ref({ top: '0px', left: '0px', maxHeight: '' });

onMounted(() => {
  const { top, left, maxHeight } = computePopoverPosition(
    props.anchor.getBoundingClientRect(),
    box.value!.offsetHeight,
    box.value!.offsetWidth,
    // Pointer-transparent, so covering the piece costs nothing (#1459).
    'cover-trigger',
  );
  place.value = { top: `${top}px`, left: `${left}px`, maxHeight: `${maxHeight}px` };
});
</script>

<template>
  <Teleport to="body">
    <div :id="id" ref="box" role="tooltip" class="piece-details-tip" :style="place">
      <PieceDetails :element="element" />
    </div>
  </Teleport>
</template>

<style scoped>
.piece-details-tip {
  position: fixed;
  z-index: 70;
  max-width: 260px;
  box-sizing: border-box;
  overflow-y: auto;
  padding: var(--bsg-s2) var(--bsg-s3);
  /* Teleported out of the shell root, so it does not inherit the shell's font (#451). */
  font-family: var(--bsg-font);
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-md);
  box-shadow: var(--bsg-shadow-sm);
  /* Never eats the pointer: it can open right under a finger about to tap again. */
  pointer-events: none;
}
</style>

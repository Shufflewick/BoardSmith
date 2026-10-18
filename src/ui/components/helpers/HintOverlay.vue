<script setup lang="ts">
/**
 * HintOverlay — the bot's move hint as one ring + bubble.
 *
 * Reads a single `Annotation` from `gameState.state.hint?.annotation` and draws
 * it with AnnotationLayer, the same layer TutorialOverlay uses. An 'auto' hint
 * with no found target sits below the board, so it never covers the squares
 * the player needs to read; its text ("Suggested: c5 → a3") stands on its own.
 */

import { computed, inject, type Ref } from 'vue';
import AnnotationLayer from './AnnotationLayer.vue';
import type { Annotation } from '../../../engine/tutorial/types.js';
import { NOTHING_TO_SHOW } from './overlay-utils.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

// The typed key, so a rename in GameShell is a compile error here rather than
// a silently undefined ref (#39). Optional injection on purpose: an overlay
// mounted outside a shell renders nothing rather than throwing.
const gameState = inject(GAME_CONTEXT_KEYS.gameState, undefined) as
  | Ref<{ state: { hint?: { annotation: Annotation } } } | null>
  | undefined;

const annotations = computed<readonly Annotation[]>(() => {
  const annotation = gameState?.value?.state?.hint?.annotation;
  return annotation ? [annotation] : NOTHING_TO_SHOW;
});
</script>

<template>
  <AnnotationLayer :annotations="annotations" overlay-class="bsg-hint-overlay" untargeted="below-board" />
</template>

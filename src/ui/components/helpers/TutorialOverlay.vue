<script setup lang="ts">
/**
 * TutorialOverlay — the current tutorial step's annotations as rings + bubbles.
 *
 * Reads `gameState.state.tutorial.content` and draws it with AnnotationLayer,
 * the same layer HintOverlay uses. An 'auto' annotation with no found target
 * sits at the top of the board.
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
  | Ref<{ state: { tutorial?: { content?: Annotation[] } } } | null>
  | undefined;

const annotations = computed<readonly Annotation[]>(
  () => gameState?.value?.state?.tutorial?.content ?? NOTHING_TO_SHOW,
);
</script>

<template>
  <AnnotationLayer :annotations="annotations" overlay-class="bsg-tutorial-overlay" untargeted="board-top" />
</template>

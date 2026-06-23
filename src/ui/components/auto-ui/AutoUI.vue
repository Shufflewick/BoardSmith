<script setup lang="ts">
/**
 * AutoUI - Automatic game board rendering
 *
 * Renders the game element tree automatically. ActionPanel is now
 * part of GameShell's header, so this just handles the board.
 *
 * Usage:
 * <AutoUI
 *   :game-view="gameView"
 *   :player-seat="playerSeat"
 * />
 */
import AutoRenderer from './AutoRenderer.vue';
import type { GameElement } from './index';
import type { PresentationOverlay } from './presentation.js';

interface FlowState {
  complete?: boolean;
}

defineProps<{
  /** The game view tree */
  gameView: GameElement | null | undefined;
  /** Flow state (for game complete detection) */
  flowState?: FlowState;
  /** Current player's seat */
  playerSeat: number;
  /** Per-UI presentation overlay — keyed by element class/name/attribute → visuals (D-04). */
  presentation?: PresentationOverlay;
}>();
</script>

<template>
  <div class="auto-ui">
    <!-- Game board: always rendered — the result card (GameOverCard.vue) is
         GameShell's responsibility and overlays inside .boardregion above this. -->
    <AutoRenderer
      :game-view="gameView"
      :player-seat="playerSeat"
      :presentation="presentation"
    />
  </div>
</template>

<style scoped>
.auto-ui {
  height: 100%;
}
</style>

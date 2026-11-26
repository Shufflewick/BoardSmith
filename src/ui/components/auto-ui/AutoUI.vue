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
import { inject, onUnmounted } from 'vue';
import AutoRenderer from './AutoRenderer.vue';
import { AUTO_UI_ON_SCREEN } from '../../composables/actionBarStart.js';
import type { GameViewElement } from './index';
import type { PresentationOverlay } from './presentation.js';

defineProps<{
  /** The game view tree */
  gameView: GameViewElement | null | undefined;
  /** Current player's seat */
  playerSeat: number;
  /** Per-UI presentation overlay — keyed by element class/name/attribute → visuals (D-04). */
  presentation?: PresentationOverlay;
}>();

// The panel is the only way to start most actions here, so the shell keeps the bar open (#1826).
const onScreen = inject(AUTO_UI_ON_SCREEN, null);
if (onScreen) {
  onScreen.value++;
  onUnmounted(() => { onScreen.value--; });
}
</script>

<template>
  <div class="auto-ui">
    <!-- Game board: always rendered — the result card (GameOverCard.vue) is
         GameShell's responsibility and overlays over .board-viewport above this. -->
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
  position: relative;
}
</style>

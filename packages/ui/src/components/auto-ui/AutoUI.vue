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
 *   :player-position="playerPosition"
 * />
 */
import AutoGameBoard from './AutoGameBoard.vue';
import type { GameElement } from './index';

interface FlowState {
  complete?: boolean;
}

defineProps<{
  /** The game view tree */
  gameView: GameElement | null | undefined;
  /** Flow state (for game complete detection) */
  flowState?: FlowState;
  /** Current player's position */
  playerPosition: number;
}>();
</script>

<template>
  <div class="auto-ui">
    <!-- Game complete banner -->
    <div v-if="flowState?.complete" class="game-complete">
      <h2>Game Over!</h2>
      <slot name="game-over">
        <p>The game has ended.</p>
      </slot>
    </div>

    <!-- Game board -->
    <AutoGameBoard
      v-else
      :game-view="gameView"
      :player-position="playerPosition"
    />
  </div>
</template>

<style scoped>
.auto-ui {
  height: 100%;
}

.game-complete {
  text-align: center;
  padding: 40px;
  background: rgba(0, 255, 136, 0.1);
  border-radius: 16px;
}

.game-complete h2 {
  font-size: 2rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 16px;
}
</style>

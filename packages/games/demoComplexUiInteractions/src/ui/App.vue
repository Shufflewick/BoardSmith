<!--
  Demo: Complex UI Interactions

  This demo showcases how to use boardInteraction.currentAction to coordinate
  between the ActionPanel and a custom GameBoard.

  The game displays:
  - Custom UI (left): Shows action state detection and custom visual feedback
  - Auto-Generated UI (right): Standard AutoUI for comparison

  Key feature demonstrated:
  - boardInteraction.currentAction: Detects which action button was clicked
  - boardInteraction.currentSelectionName: Shows which selection step is active
  - Different visual styles for each action type
-->
<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
import GameBoard from './components/GameBoard.vue';
</script>

<template>
  <GameShell
    game-type="demoComplexUiInteractions"
    display-name="Demo: Complex UI Interactions"
    :player-count="2"
  >
    <template #game-board="{ state, gameView, playerPosition, isMyTurn, availableActions, actionArgs, actionController, setBoardPrompt }">
      <div class="board-comparison">
        <div class="board-section custom-board">
          <h2 class="board-title">
            <span class="title-icon">🎯</span>
            Custom UI with Action Detection
          </h2>
          <p class="board-description">
            Uses <code>boardInteraction.currentAction</code> to show which action is being filled in
          </p>
          <GameBoard
            :game-view="gameView"
            :player-position="playerPosition"
            :is-my-turn="isMyTurn"
            :available-actions="availableActions"
            :action-args="actionArgs"
            :action-controller="actionController"
            :set-board-prompt="setBoardPrompt"
          />
        </div>
        <div class="board-section auto-board">
          <h2 class="board-title">
            <span class="title-icon">🤖</span>
            Auto-Generated UI
          </h2>
          <p class="board-description">
            Standard AutoUI for comparison - no action state detection
          </p>
          <AutoUI
            :game-view="gameView || null"
            :player-position="playerPosition"
            :flow-state="state?.flowState as any"
          />
        </div>
      </div>
    </template>

    <template #player-stats="{ player, gameView }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span class="stat-value" data-player-stat="score" :data-player-position="(player as any).position">
          {{ (player as any).score || 0 }}
        </span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Cards:</span>
        <span class="stat-value">
          {{ getCardCount(gameView, (player as any).position) }}
        </span>
      </div>
    </template>
  </GameShell>
</template>

<script lang="ts">
// Helper to count cards in player's hand
function getCardCount(gameView: any, position: number): number {
  if (!gameView?.children) return 0;
  const hand = gameView.children.find(
    (c: any) => c.className === 'Hand' && c.attributes?.player?.position === position
  );
  return hand?.children?.length || 0;
}

export { getCardCount };
</script>

<style scoped>
.board-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  width: 100%;
  height: 100%;
}

@media (max-width: 1200px) {
  .board-comparison {
    grid-template-columns: 1fr;
  }
}

.board-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  padding: 12px;
}

.custom-board {
  border: 2px solid rgba(0, 217, 255, 0.3);
}

.auto-board {
  border: 2px solid rgba(255, 255, 255, 0.1);
}

.board-title {
  font-size: 1rem;
  margin: 0 0 4px 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-icon {
  font-size: 1.2rem;
}

.board-description {
  font-size: 0.75rem;
  color: #888;
  margin: 0 0 12px 0;
}

.board-description code {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  color: #00d9ff;
}

.player-stat {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-top: 8px;
}

.stat-label {
  color: #888;
}

.stat-value {
  font-weight: bold;
  color: #00d9ff;
}
</style>

<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
import GoFishBoard from './components/GoFishBoard.vue';

// Get card count from a hand
function getCardCount(hand: any): number {
  return hand?.children?.length || 0;
}

// Count books for a player
function getBookCount(playerPosition: number, gameView: any): number {
  if (!gameView?.children) return 0;
  // Find the Books space for this player
  const booksSpace = gameView.children.find((child: any) =>
    child.className === 'Books' &&
    child.attributes?.player?.position === playerPosition
  );
  // Each book is 4 cards
  return booksSpace ? Math.floor((booksSpace.children?.length || 0) / 4) : 0;
}
</script>

<template>
  <GameShell game-type="go-fish" display-name="Go Fish">
    <template #game-board="{ state, gameView, players, playerPosition, isMyTurn, availableActions, action, actionArgs, executeAction, setBoardPrompt }">
      <div class="board-comparison">
        <div class="board-section">
          <h2 class="board-title">Custom UI</h2>
          <GoFishBoard
            :game-view="gameView"
            :players="players"
            :player-position="playerPosition"
            :is-my-turn="isMyTurn"
            :available-actions="availableActions"
            :action="action"
            :action-args="actionArgs"
            :execute-action="executeAction"
            :set-board-prompt="setBoardPrompt"
          />
        </div>
        <div class="board-section">
          <h2 class="board-title">Auto-Generated UI</h2>
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
        <span class="stat-label">Cards:</span>
        <span class="stat-value">
          {{
            gameView?.children?.find((c: any) =>
              c.className === 'Hand' && c.attributes?.player?.position === player.position
            )?.children?.length || 0
          }}
        </span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Books:</span>
        <span
          class="stat-value books"
          data-player-stat="books"
          :data-player-position="player.position"
        >{{ getBookCount(player.position, gameView) }}</span>
      </div>
    </template>
  </GameShell>
</template>

<style scoped>
.board-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  width: 100%;
  height: 100%;
}

.board-section {
  display: flex;
  flex-direction: column;
  min-height: 0; /* Allow flex children to shrink */
}

.board-title {
  font-size: 1.2rem;
  margin: 0 0 12px 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  text-align: center;
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

.stat-value.books {
  color: #ffd700;
}
</style>

<script setup lang="ts">
import { GameShell, AutoUI, findElement, getElementOwner } from '@boardsmith/ui';
import HexBoard from './components/HexBoard.vue';

// Get player color name
function getPlayerColor(playerPosition: number): string {
  return playerPosition === 0 ? 'Red' : 'Blue';
}

// Count stones for a player from gameView using shared helpers
function getStoneCount(playerPosition: number, gameView: any): number {
  const board = findElement(gameView, { className: 'Board' });
  if (!board?.children) return 0;

  let count = 0;
  for (const cell of board.children) {
    if (cell.className !== 'Cell') continue;
    for (const piece of cell.children || []) {
      if (piece.className === 'Stone' && getElementOwner(piece) === playerPosition) {
        count++;
      }
    }
  }
  return count;
}
</script>

<template>
  <GameShell
    game-type="hex"
    display-name="Hex"
    :player-count="2"
  >
    <template #game-board="{ state, gameView, playerPosition, isMyTurn, availableActions, action, actionArgs, executeAction, setBoardPrompt }">
      <div class="board-comparison">
        <div class="board-section">
          <h2 class="board-title">Custom UI</h2>
          <p class="board-instructions">
            <span class="red">Red</span> connects top to bottom.
            <span class="blue">Blue</span> connects left to right.
          </p>
          <HexBoard
            :game-view="gameView"
            :player-position="playerPosition"
            :is-my-turn="isMyTurn"
            :available-actions="availableActions"
            :action="action"
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
      <div class="player-color">
        <span class="color-indicator" :class="getPlayerColor(player.position).toLowerCase()"></span>
        <span class="color-name">{{ getPlayerColor(player.position) }} stones</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Stones placed:</span>
        <span
          class="stat-value"
          data-player-stat="stones"
          :data-player-position="player.position"
        >{{ getStoneCount(player.position, gameView) }}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Goal:</span>
        <span class="stat-value goal">{{ player.position === 0 ? 'Top-Bottom' : 'Left-Right' }}</span>
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
  align-items: center;
  min-height: 0;
}

.board-title {
  font-size: 1.2rem;
  margin: 0 0 8px 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  text-align: center;
}

.board-instructions {
  font-size: 0.9rem;
  color: #aaa;
  margin-bottom: 12px;
}

.board-instructions .red {
  color: #ff6b6b;
  font-weight: bold;
}

.board-instructions .blue {
  color: #4dabf7;
  font-weight: bold;
}

.player-color {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.color-indicator {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.color-indicator.red {
  background: linear-gradient(145deg, #ff6b6b, #c92a2a);
  border: 2px solid #a01a1a;
}

.color-indicator.blue {
  background: linear-gradient(145deg, #4dabf7, #228be6);
  border: 2px solid #1864ab;
}

.color-name {
  font-size: 0.85rem;
  color: #ccc;
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

.stat-value.goal {
  color: #ffd700;
}
</style>

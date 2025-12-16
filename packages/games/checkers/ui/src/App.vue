<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
import CheckersBoard from './components/CheckersBoard.vue';

// Default checkers colors
const DEFAULT_CHECKERS_COLORS = ['#e74c3c', '#2c3e50'] as const;

// Get player color hex code (falls back to position-based default)
function getPlayerColorHex(player: { position: number; color?: string }): string {
  if (player.color) {
    return player.color;
  }
  // Fallback to default colors
  return DEFAULT_CHECKERS_COLORS[player.position] ?? DEFAULT_CHECKERS_COLORS[0];
}

// Get display name for a color
function getColorDisplayName(hex: string): string {
  const colorNames: Record<string, string> = {
    '#e74c3c': 'Red',
    '#2c3e50': 'Black',
    '#ecf0f1': 'White',
    '#e67e22': 'Orange',
    '#27ae60': 'Green',
    '#3498db': 'Blue',
  };
  return colorNames[hex.toLowerCase()] || 'Custom';
}

// Count pieces for a player from gameView
function getPieceCount(playerPosition: number, gameView: any): number {
  if (!gameView?.children) return 0;
  const board = gameView.children.find((c: any) => c.className === 'Board');
  if (!board?.children) return 0;

  let count = 0;
  for (const square of board.children) {
    if (square.className !== 'Square') continue;
    for (const piece of square.children || []) {
      if (piece.className === 'CheckerPiece' && piece.attributes?.player?.position === playerPosition) {
        count++;
      }
    }
  }
  return count;
}

// Count kings for a player
function getKingCount(playerPosition: number, gameView: any): number {
  if (!gameView?.children) return 0;
  const board = gameView.children.find((c: any) => c.className === 'Board');
  if (!board?.children) return 0;

  let count = 0;
  for (const square of board.children) {
    if (square.className !== 'Square') continue;
    for (const piece of square.children || []) {
      if (piece.className === 'CheckerPiece' &&
          piece.attributes?.player?.position === playerPosition &&
          piece.attributes?.isKing) {
        count++;
      }
    }
  }
  return count;
}

// Get captured count from player data
function getCapturedCount(playerPosition: number, gameView: any): number {
  // Calculate from missing opponent pieces (12 - opponent's pieces)
  const opponentPosition = playerPosition === 0 ? 1 : 0;
  const opponentPieces = getPieceCount(opponentPosition, gameView);
  return 12 - opponentPieces;
}
</script>

<template>
  <GameShell
    game-type="checkers"
    display-name="Checkers"
    :player-count="2"
  >
    <template #game-board="{ state, gameView, playerPosition, isMyTurn, availableActions, action, actionArgs, executeAction, setBoardPrompt }">
      <div class="board-comparison">
        <div class="board-section">
          <h2 class="board-title">Custom UI</h2>
          <CheckersBoard
            :game-view="gameView"
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
      <div class="player-color">
        <span class="color-indicator" :style="{ backgroundColor: getPlayerColorHex(player) }"></span>
        <span class="color-name">{{ getColorDisplayName(getPlayerColorHex(player)) }} pieces</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Pieces:</span>
        <span
          class="stat-value"
          data-player-stat="pieces"
          :data-player-position="player.position"
        >{{ getPieceCount(player.position, gameView) }}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Kings:</span>
        <span
          class="stat-value kings"
          data-player-stat="kings"
          :data-player-position="player.position"
        >{{ getKingCount(player.position, gameView) }}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Captured:</span>
        <span
          class="stat-value captured"
          data-player-stat="captured"
          :data-player-position="player.position"
        >{{ getCapturedCount(player.position, gameView) }}</span>
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
  border: 2px solid rgba(0, 0, 0, 0.3);
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

.stat-value.kings {
  color: #ffd700;
}

.stat-value.captured {
  color: #00ff88;
}
</style>

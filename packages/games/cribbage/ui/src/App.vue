<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
import CribbageBoard from './components/CribbageBoard.vue';

// Check if a player is the dealer based on gameView
function isDealer(playerSeat: number, gameView: any): boolean {
  const dealerPosition = gameView?.attributes?.dealerPosition ?? 1;  // 1-indexed
  return playerSeat === dealerPosition;
}

// Get player's hand data from gameView
function getPlayerHand(playerSeat: number, gameView: any) {
  if (!gameView?.children) return null;
  return gameView.children.find(
    (c: any) => c.attributes?.$type === 'hand' && c.attributes?.player?.seat === playerSeat
  );
}

// Get player's score from gameView (stored in Hand element)
function getPlayerScore(playerSeat: number, gameView: any): number {
  const hand = getPlayerHand(playerSeat, gameView);
  return hand?.attributes?.player?.score ?? 0;
}

// Get player's card count from gameView
function getCardCount(playerSeat: number, gameView: any): number {
  const hand = getPlayerHand(playerSeat, gameView);
  // Count all children in hand (includes face-down cards without visible rank)
  return hand?.children?.length ?? 0;
}
</script>

<template>
  <GameShell
    game-type="cribbage"
    display-name="Cribbage"
    :player-count="2"
  >
    <template #game-board="{ state, gameView, playerSeat, isMyTurn, availableActions, actionArgs, actionController }">
      <div class="board-comparison">
        <div class="board-section">
          <h2 class="board-title">Custom UI</h2>
          <CribbageBoard
            :game-view="gameView"
            :player-seat="playerSeat"
            :is-my-turn="isMyTurn"
            :available-actions="availableActions"
            :action-args="actionArgs"
            :action-controller="actionController"
          />
        </div>
        <div class="board-section">
          <h2 class="board-title">Auto-Generated UI</h2>
          <AutoUI
            :game-view="gameView || null"
            :player-seat="playerSeat"
            :flow-state="state?.flowState as any"
          />
        </div>
      </div>
    </template>

    <template #player-stats="{ player, gameView }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span class="stat-value">{{ getPlayerScore(player.seat, gameView) }}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Cards:</span>
        <span class="stat-value cards">{{ getCardCount(player.seat, gameView) }}</span>
      </div>
      <span v-if="isDealer(player.seat, gameView)" class="dealer-badge">Dealer</span>
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
  color: #d4a574;
}

.stat-value.cards {
  color: #aaa;
}

.dealer-badge {
  display: inline-block;
  background: #f39c12;
  color: #1a1a2e;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: bold;
  margin-top: 6px;
}
</style>

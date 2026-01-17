<!--
  Demo: Animation Showcase

  This demo showcases ALL BoardSmith animation capabilities:
  - useAutoFlyingElements: Automatic flying between containers
  - useAutoFLIP: Element reordering within containers
  - useAutoFlyToStat: Flying to player stat displays
  - useFlyOnAppear: Animation when elements appear
  - useActionAnimations: Action-triggered animations
  - useFlyingCards: Manual/low-level flying control
  - Card flip animations
-->
<script setup lang="ts">
import { GameShell } from '@boardsmith/ui';
import GameBoard from './components/GameBoard.vue';
</script>

<template>
  <GameShell
    game-type="demoAnimation"
    display-name="Demo: Animation Showcase"
    :player-count="1"
  >
    <template #game-board="{ state, gameView, playerPosition, isMyTurn, availableActions, actionArgs, actionController, setBoardPrompt }">
      <GameBoard
        :game-view="gameView"
        :player-position="playerPosition"
        :is-my-turn="isMyTurn"
        :available-actions="availableActions"
        :action-args="actionArgs"
        :action-controller="actionController"
        :set-board-prompt="setBoardPrompt"
      />
    </template>

    <template #player-stats="{ player, gameView }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span
          class="stat-value"
          data-player-stat="score"
          :data-player-position="(player as any).position"
        >
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

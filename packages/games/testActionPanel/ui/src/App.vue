<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
</script>

<template>
  <GameShell game-type="test-action-panel" display-name="Test Action Panel">
    <template #game-board="{ state, gameView, playerPosition }">
      <AutoUI
        :game-view="gameView || null"
        :player-position="playerPosition"
        :flow-state="state?.flowState as any"
      />
    </template>

    <template #player-stats="{ player, gameView }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span class="stat-value">{{ player.score || 0 }}</span>
      </div>
    </template>
  </GameShell>
</template>

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

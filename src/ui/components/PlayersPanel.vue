<script setup lang="ts">
/**
 * PlayersPanel - Displays the list of players with their stats
 *
 * Shows each player's name, turn indicator, and custom stats via slot.
 */

export interface Player {
  position: number;
  name: string;
  color?: string;
}

defineProps<{
  /** Array of players in the game */
  players: Player[];
  /** Current player's position (the viewer) */
  playerPosition: number;
  /** Position of the player whose turn it is */
  currentPlayerPosition?: number;
}>();

defineSlots<{
  /** Custom stats for each player */
  'player-stats'(props: { player: Player }): any;
}>();
</script>

<template>
  <div class="players-panel">
    <div
      v-for="player in players"
      :key="player.position"
      class="player-card"
      :class="{ current: player.position === currentPlayerPosition }"
    >
      <div class="player-name-row">
        <span v-if="player.position === currentPlayerPosition" class="turn-indicator-dot"></span>
        <span class="player-name">{{ player.name }}</span>
        <span v-if="player.color" class="player-color" :style="{ backgroundColor: player.color }"></span>
        <span v-if="player.position === playerPosition" class="you-badge">(You)</span>
      </div>
      <slot name="player-stats" :player="player"></slot>
    </div>
  </div>
</template>

<style scoped>
.players-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.player-card {
  background: rgba(255, 255, 255, 0.05);
  padding: 12px;
  border-radius: 8px;
  transition: all 0.2s;
}

.player-card.current {
  background: rgba(0, 217, 255, 0.15);
  border: 1px solid rgba(0, 217, 255, 0.3);
}

.player-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.player-name {
  font-weight: 600;
}

.player-color {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.you-badge {
  color: #00d9ff;
  font-size: 0.8rem;
  margin-left: 8px;
}

.turn-indicator-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  animation: pulse-glow 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse-glow {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 8px rgba(0, 217, 255, 0.6);
  }
  50% {
    transform: scale(1.15);
    box-shadow: 0 0 16px rgba(0, 255, 136, 0.8);
  }
}
</style>

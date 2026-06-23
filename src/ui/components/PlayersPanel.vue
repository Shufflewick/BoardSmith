<script setup lang="ts">
/**
 * PlayersPanel - Displays the list of players with their stats
 *
 * Shows each player's name, turn indicator, and custom stats via slot.
 */

export interface Player {
  seat: number;
  name: string;
  color?: string;
}

const props = defineProps<{
  /** Array of players in the game */
  players: Player[];
  /** Current player's seat (the viewer) */
  playerSeat: number;
  /** Seat of the player whose turn it is */
  currentPlayerSeat?: number;
  /** Whether color selection is enabled (controls color indicator display) */
  colorSelectionEnabled?: boolean;
  /** Seats of players currently awaiting action during simultaneous steps */
  awaitingPlayerSeats?: number[];
}>();

function isPlayerActive(seat: number): boolean {
  if (seat === props.currentPlayerSeat) return true;
  if (props.awaitingPlayerSeats?.includes(seat)) return true;
  return false;
}

defineSlots<{
  /** Custom stats for each player */
  'player-stats'(props: { player: Player }): any;
}>();
</script>

<template>
  <div class="players-panel">
    <div
      v-for="player in players"
      :key="player.seat"
      class="player-card"
      :class="{ current: isPlayerActive(player.seat) }"
    >
      <div class="player-name-row">
        <span v-if="isPlayerActive(player.seat)" class="turn-indicator-dot"></span>
        <span class="player-name">{{ player.name }}</span>
        <span v-if="colorSelectionEnabled && player.color" class="player-color" :style="{ backgroundColor: player.color }"></span>
        <span v-if="player.seat === playerSeat" class="you-badge">(You)</span>
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
  background: var(--bsg-surface);
  color: var(--bsg-ink);
  padding: 12px;
  border-radius: 8px;
  transition: all 0.2s;
}

.player-card.current {
  background: color-mix(in srgb, var(--bsg-accent) 12%, var(--bsg-surface));
  border: 1px solid var(--bsg-accent);
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
  border: 1px solid var(--bsg-line-2);
}

.you-badge {
  color: var(--bsg-accent);
  font-size: 0.8rem;
  margin-left: 8px;
}

.turn-indicator-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bsg-accent);
  border: 2px solid color-mix(in srgb, var(--bsg-accent) 40%, transparent);
  animation: breathe 2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (prefers-reduced-motion: reduce) {
  .turn-indicator-dot {
    animation: none;
  }
}
</style>

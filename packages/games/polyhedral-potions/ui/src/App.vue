<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
import GameTable from './components/GameTable.vue';

// Get player data from players array (passed from GameShell)
function getPlayerData(playerPosition: number, players: any[]) {
  if (!players) return null;
  return players.find((p: any) => p.position === playerPosition);
}

// Get player score from their attributes
function getPlayerScore(playerPosition: number, players: any[]): number {
  const player = getPlayerData(playerPosition, players);
  return player?.score ?? 0;
}

// Get player's star count
function getPlayerStars(playerPosition: number, players: any[]): number {
  const player = getPlayerData(playerPosition, players);
  return player?.stars ?? 0;
}

// Get unused abilities grouped by type
function getAbilitiesByType(playerPosition: number, players: any[]): Record<string, number> {
  const player = getPlayerData(playerPosition, players);
  if (!player?.abilities) return {};

  const counts: Record<string, number> = {};
  for (const ability of player.abilities) {
    if (!ability.used) {
      counts[ability.type] = (counts[ability.type] || 0) + 1;
    }
  }
  return counts;
}

// Ability display info
const ABILITY_INFO: Record<string, { icon: string; label: string; color: string }> = {
  'reroll-2': { icon: '🎲', label: 'Reroll', color: '#2196F3' },
  'flip': { icon: '🔄', label: 'Flip', color: '#9C27B0' },
  'refresh': { icon: '♻️', label: 'Refresh', color: '#FF9800' },
  'subtract': { icon: '➖', label: 'Subtract', color: '#E91E63' },
  'adjust': { icon: '±', label: 'Adjust', color: '#4CAF50' },
  'draft-again': { icon: '🔁', label: 'Draft Again', color: '#00BCD4' },
};

// Get potions crafted count
function getPotionCount(playerPosition: number, players: any[]): number {
  const player = getPlayerData(playerPosition, players);
  if (!player?.potionsCrafted) return 0;
  return player.potionsCrafted.filter((p: boolean) => p).length;
}
</script>

<template>
  <GameShell game-type="polyhedral-potions" display-name="Polyhedral Potions" :player-count="2">
    <template #game-board="{ state, gameView, players, playerPosition, isMyTurn, availableActions, actionArgs, actionController }">
      <div class="board-comparison">
        <div class="board-section">
          <h2 class="board-title">Custom UI</h2>
          <GameTable
            :game-view="gameView"
            :players="players"
            :player-position="playerPosition"
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
            :player-position="playerPosition"
            :flow-state="state?.flowState as any"
          />
        </div>
      </div>
    </template>

    <template #player-stats="{ player, players }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span class="stat-value">{{ getPlayerScore(player.position, players) }}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Stars:</span>
        <span class="stat-value stars">
          <span v-for="i in 3" :key="i" :class="{ earned: i <= getPlayerStars(player.position, players) }">★</span>
        </span>
      </div>
      <div class="player-stat">
        <span class="stat-label">Potions:</span>
        <span class="stat-value potions">{{ getPotionCount(player.position, players) }}/32</span>
      </div>
      <div class="player-stat abilities-row">
        <span class="stat-label">Abilities:</span>
        <div class="abilities-list">
          <template v-for="(count, abilityType) in getAbilitiesByType(player.position, players)" :key="abilityType">
            <span
              v-if="count > 0"
              class="ability-badge"
              :style="{ backgroundColor: ABILITY_INFO[abilityType as string]?.color || '#666' }"
              :title="ABILITY_INFO[abilityType as string]?.label || abilityType"
            >
              {{ ABILITY_INFO[abilityType as string]?.icon || '?' }}
              <span v-if="count > 1" class="ability-count">{{ count }}</span>
            </span>
          </template>
          <span v-if="Object.keys(getAbilitiesByType(player.position, players)).length === 0" class="no-abilities">
            None
          </span>
        </div>
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
  min-height: 0;
  overflow: hidden;
}

.board-title {
  font-size: 1.2rem;
  margin: 0 0 12px 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  text-align: center;
  color: #ba68c8;
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

.stat-value.stars {
  color: #444;
  letter-spacing: 2px;
}

.stat-value.stars .earned {
  color: #ffd700;
}

.stat-value.potions {
  color: #9C27B0;
}

.abilities-row {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.abilities-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ability-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8rem;
  color: white;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.ability-count {
  font-size: 0.7rem;
  font-weight: bold;
  background: rgba(0,0,0,0.3);
  padding: 0 4px;
  border-radius: 3px;
  margin-left: 2px;
}

.no-abilities {
  color: #666;
  font-style: italic;
  font-size: 0.8rem;
}
</style>

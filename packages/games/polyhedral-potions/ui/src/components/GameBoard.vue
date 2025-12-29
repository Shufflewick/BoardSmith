<script setup lang="ts">
import { computed, provide } from 'vue';
import DiceShelf from './DiceShelf.vue';
import ScoreSheet from './ScoreSheet.vue';
import { DIE_ANIMATION_CONTEXT_KEY, createDieAnimationContext, type UseActionControllerReturn } from '@boardsmith/ui';

// Create and provide animation context for dice in this custom UI
// This ensures dice animate independently from dice in AutoUI
const dieAnimationContext = createDieAnimationContext();
provide(DIE_ANIMATION_CONTEXT_KEY, dieAnimationContext);

const props = defineProps<{
  gameView: any;
  players: any[];
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionArgs: Record<string, any>;
  actionController: UseActionControllerReturn;
}>();

// Get current phase from available actions
const currentPhase = computed(() => {
  if (props.availableActions.includes('draft')) return 'draft';
  if (props.availableActions.includes('craft')) return 'craft';
  if (props.availableActions.includes('record')) return 'record';
  return 'waiting';
});

// Get crafted value from game state
const craftedValue = computed(() => {
  return props.gameView?.attributes?.craftedValue ?? 0;
});

const craftedPoison = computed(() => {
  return props.gameView?.attributes?.craftedPoison ?? false;
});

// Get drafted values from game state
const draftedValues = computed(() => {
  return props.gameView?.attributes?.draftedValues ?? [];
});

// Get current round
const currentRound = computed(() => {
  return props.gameView?.attributes?.round ?? 1;
});

// Handle craft action
function handleCraft(operation: string, adjustment: string) {
  props.actionController.execute('craft', { operation, adjustment });
}

// Handle record action
function handleRecord(track: string) {
  props.actionController.execute('record', { track });
}

// Get player data for abilities
const playerData = computed(() => {
  if (!props.players) return null;
  return props.players.find((p: any) => p.position === props.playerPosition);
});

// Check if player has subtract ability
const hasSubtractAbility = computed(() => {
  return playerData.value?.abilities?.some((a: any) => a.type === 'subtract' && !a.used) ?? false;
});

// Check if player has adjust ability
const hasAdjustAbility = computed(() => {
  return playerData.value?.abilities?.some((a: any) => a.type === 'adjust' && !a.used) ?? false;
});
</script>

<template>
  <div class="game-board">
    <!-- Header with round and phase info -->
    <div class="game-header">
      <div class="round-info">Round {{ currentRound }}</div>
      <div class="phase-indicator" :class="currentPhase">
        <span v-if="currentPhase === 'draft'">Draft Phase - Select a die</span>
        <span v-else-if="currentPhase === 'craft'">Craft Phase - Combine your dice</span>
        <span v-else-if="currentPhase === 'record'">Record Phase - Choose a track</span>
        <span v-else-if="isMyTurn">Your turn</span>
        <span v-else>Waiting for other players...</span>
      </div>
    </div>

    <!-- Main game area -->
    <div class="game-content">
      <!-- Left side: Dice Shelf and Actions -->
      <div class="left-panel">
        <DiceShelf
          :game-view="gameView"
          :player-position="playerPosition"
          :is-my-turn="isMyTurn"
          :available-actions="availableActions"
          :action-args="actionArgs"
          :action-controller="actionController"
          :players="players"
        />

        <!-- Craft Panel -->
        <div v-if="currentPhase === 'craft'" class="craft-panel">
          <h4>Craft Your Potion</h4>
          <div class="drafted-values">
            <span class="value">{{ draftedValues[0] ?? '?' }}</span>
            <span class="operator">+</span>
            <span class="value">{{ draftedValues[1] ?? '?' }}</span>
            <span class="equals">=</span>
            <span class="result">{{ (draftedValues[0] ?? 0) + (draftedValues[1] ?? 0) }}</span>
          </div>

          <div class="craft-options">
            <button class="craft-btn add" @click="handleCraft('add', 'none')">
              Add: {{ (draftedValues[0] ?? 0) + (draftedValues[1] ?? 0) }}
            </button>

            <button
              v-if="hasSubtractAbility"
              class="craft-btn subtract"
              @click="handleCraft('subtract', 'none')"
            >
              Subtract: {{ Math.abs((draftedValues[0] ?? 0) - (draftedValues[1] ?? 0)) }}
            </button>
          </div>

          <div v-if="hasAdjustAbility" class="adjust-options">
            <span class="adjust-label">With Adjust:</span>
            <div class="adjust-buttons">
              <button @click="handleCraft('add', '-2')">-2</button>
              <button @click="handleCraft('add', '-1')">-1</button>
              <button @click="handleCraft('add', '+1')">+1</button>
              <button @click="handleCraft('add', '+2')">+2</button>
            </div>
          </div>
        </div>

        <!-- Record Panel -->
        <div v-if="currentPhase === 'record'" class="record-panel">
          <h4>Record Your {{ craftedPoison ? 'Poison' : 'Potion' }}</h4>
          <div class="crafted-display">
            <span class="crafted-label">Value:</span>
            <span class="crafted-value" :class="{ poison: craftedPoison }">
              {{ craftedValue }}
              <span v-if="craftedPoison" class="poison-icon">💀</span>
            </span>
          </div>

          <div class="record-options">
            <div class="track-group">
              <span class="group-label">Distillation (decreasing):</span>
              <div class="track-buttons">
                <button
                  v-for="col in 4"
                  :key="`distill-${col-1}`"
                  class="track-btn distill"
                  @click="handleRecord(`distill-${col-1}`)"
                >
                  Column {{ col }}
                </button>
              </div>
            </div>

            <div class="track-group">
              <span class="group-label">Fulminate (increasing):</span>
              <button class="track-btn fulminate" @click="handleRecord('fulminate')">
                Add to Fulminate
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right side: Score Sheet -->
      <div class="right-panel">
        <ScoreSheet
          :game-view="gameView"
          :player-position="playerPosition"
          :players="players"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
}

.game-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.round-info {
  font-size: 1rem;
  font-weight: bold;
  color: #ba68c8;
}

.phase-indicator {
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 500;
}

.phase-indicator.draft {
  background: rgba(76, 175, 80, 0.2);
  color: #4CAF50;
  border: 1px solid rgba(76, 175, 80, 0.4);
}

.phase-indicator.craft {
  background: rgba(255, 152, 0, 0.2);
  color: #FF9800;
  border: 1px solid rgba(255, 152, 0, 0.4);
}

.phase-indicator.record {
  background: rgba(33, 150, 243, 0.2);
  color: #2196F3;
  border: 1px solid rgba(33, 150, 243, 0.4);
}

.phase-indicator.waiting {
  background: rgba(150, 150, 150, 0.2);
  color: #999;
  border: 1px solid rgba(150, 150, 150, 0.4);
}

.game-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.left-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.right-panel {
  overflow-y: auto;
}

/* Craft Panel */
.craft-panel {
  background: linear-gradient(135deg, #3d2a1a 0%, #2a1a0a 100%);
  border-radius: 12px;
  padding: 16px;
  border: 2px solid rgba(255, 152, 0, 0.3);
}

.craft-panel h4 {
  margin: 0 0 12px 0;
  color: #FF9800;
  font-size: 1rem;
}

.drafted-values {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 1.5rem;
}

.drafted-values .value {
  background: rgba(0, 217, 255, 0.2);
  padding: 8px 16px;
  border-radius: 8px;
  color: #00d9ff;
  font-weight: bold;
}

.drafted-values .operator,
.drafted-values .equals {
  color: #888;
}

.drafted-values .result {
  background: rgba(255, 152, 0, 0.2);
  padding: 8px 16px;
  border-radius: 8px;
  color: #FF9800;
  font-weight: bold;
}

.craft-options {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.craft-btn {
  flex: 1;
  min-width: 120px;
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
}

.craft-btn.add {
  background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%);
  color: white;
}

.craft-btn.subtract {
  background: linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%);
  color: white;
}

.craft-btn:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.adjust-options {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.adjust-label {
  display: block;
  margin-bottom: 8px;
  color: #888;
  font-size: 0.85rem;
}

.adjust-buttons {
  display: flex;
  gap: 8px;
}

.adjust-buttons button {
  flex: 1;
  padding: 8px;
  background: rgba(255, 152, 0, 0.2);
  border: 1px solid #FF9800;
  border-radius: 4px;
  color: #FF9800;
  cursor: pointer;
  transition: all 0.2s ease;
}

.adjust-buttons button:hover {
  background: rgba(255, 152, 0, 0.4);
}

/* Record Panel */
.record-panel {
  background: linear-gradient(135deg, #1a2a3a 0%, #0a1a2a 100%);
  border-radius: 12px;
  padding: 16px;
  border: 2px solid rgba(33, 150, 243, 0.3);
}

.record-panel h4 {
  margin: 0 0 12px 0;
  color: #2196F3;
  font-size: 1rem;
}

.crafted-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
}

.crafted-label {
  color: #888;
}

.crafted-value {
  font-size: 2rem;
  font-weight: bold;
  color: #4CAF50;
  padding: 8px 20px;
  background: rgba(76, 175, 80, 0.2);
  border-radius: 8px;
}

.crafted-value.poison {
  color: #9C27B0;
  background: rgba(156, 39, 176, 0.2);
}

.poison-icon {
  margin-left: 8px;
}

.record-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.track-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-label {
  font-size: 0.85rem;
  color: #888;
}

.track-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.track-btn {
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.track-btn.distill {
  background: linear-gradient(135deg, #FF5722 0%, #E64A19 100%);
  color: white;
}

.track-btn.fulminate {
  background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
  color: white;
}

.track-btn:hover {
  transform: scale(1.02);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
</style>

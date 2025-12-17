<script setup lang="ts">
/**
 * WaitingRoom - Enhanced lobby screen for waiting/joining games
 *
 * For Creators:
 * - Shows game code to share
 * - Shows all player slots with status
 * - Waits for all players to join
 *
 * For Joiners:
 * - Shows game configuration
 * - Shows name input + "Join" button on open slots
 * - Can join any available slot
 */
import { ref, computed, watch } from 'vue';
import { useToast } from '../composables/useToast';

interface LobbySlot {
  position: number;
  status: 'open' | 'ai' | 'claimed';
  name: string;
  playerId?: string;
  aiLevel?: string;
  playerOptions?: Record<string, unknown>;
}

interface LobbyInfo {
  state: 'waiting' | 'playing' | 'finished';
  gameType: string;
  displayName?: string;
  slots: LobbySlot[];
  gameOptions?: Record<string, unknown>;
  creatorId?: string;
  openSlots: number;
  isReady: boolean;
}

const props = defineProps<{
  /** The game ID/code to share */
  gameId: string;
  /** Current lobby information */
  lobby: LobbyInfo;
  /** Current player's ID */
  playerId: string;
  /** Whether this player is the creator */
  isCreator: boolean;
}>();

const emit = defineEmits<{
  (e: 'claim-position', position: number, name: string): void;
  (e: 'update-name', name: string): void;
  (e: 'cancel'): void;
}>();

// State for joining - track name per slot for open positions
const slotNames = ref<Record<number, string>>({});

// For name update after claiming
const myName = ref('');

// Toast notifications
const toast = useToast();

// Find the player's current position (if claimed)
const myPosition = computed(() => {
  return props.lobby.slots.find(s => s.playerId === props.playerId)?.position;
});

// Check if player has already claimed a position
const hasClaimed = computed(() => {
  return props.lobby.slots.some(s => s.playerId === props.playerId);
});

// Sync name when player claims
watch(() => props.lobby, (lobby) => {
  const mySlot = lobby.slots.find(s => s.playerId === props.playerId);
  if (mySlot) {
    myName.value = mySlot.name;
  }
}, { immediate: true });

// Filter out internal options like playerConfigs from display
const displayableGameOptions = computed(() => {
  if (!props.lobby.gameOptions) return null;
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props.lobby.gameOptions)) {
    // Skip internal options
    if (key === 'playerConfigs') continue;
    filtered[key] = value;
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
});

function copyGameCode() {
  navigator.clipboard.writeText(props.gameId);
  toast.success('Copied!');
}

function handleJoinSlot(position: number) {
  const name = slotNames.value[position]?.trim();
  if (!name) {
    return;
  }
  emit('claim-position', position, name);
}

function handleUpdateName() {
  if (!myName.value.trim()) return;
  emit('update-name', myName.value.trim());
}

function getSlotStatusClass(slot: LobbySlot): string {
  if (slot.status === 'ai') return 'ai';
  if (slot.status === 'claimed') return 'claimed';
  return 'open';
}

function getSlotStatusLabel(slot: LobbySlot): string {
  if (slot.status === 'ai') return `AI (${slot.aiLevel || 'medium'})`;
  if (slot.status === 'claimed') {
    // Check if this is the creator's slot
    if (slot.playerId === props.lobby.creatorId) {
      return 'Creator';
    }
    return 'Joined';
  }
  return 'Open';
}

function canJoinSlot(slot: LobbySlot): boolean {
  // Can join if: not creator, haven't claimed yet, slot is open
  return !props.isCreator && !hasClaimed.value && slot.status === 'open';
}
</script>

<template>
  <div class="waiting-room">
    <!-- Header -->
    <h2 v-if="isCreator">Waiting for Players</h2>
    <h2 v-else-if="!hasClaimed">Join Game</h2>
    <h2 v-else>Waiting for Game to Start</h2>

    <!-- Game Info -->
    <div class="game-info">
      <div class="game-title">{{ lobby.displayName || lobby.gameType }}</div>
      <div v-if="displayableGameOptions" class="game-options">
        <span v-for="(value, key) in displayableGameOptions" :key="key" class="option-badge">
          {{ key }}: {{ value }}
        </span>
      </div>
    </div>

    <!-- Share Code -->
    <div class="share-code">
      <p>Share this code with your friends:</p>
      <div class="code-display">
        <span class="code">{{ gameId }}</span>
        <button @click="copyGameCode" class="btn small">Copy</button>
      </div>
    </div>

    <!-- Player Slots -->
    <div class="slots-container">
      <h3>Players ({{ lobby.slots.length - lobby.openSlots }}/{{ lobby.slots.length }})</h3>

      <div class="slots-list">
        <div
          v-for="slot in lobby.slots"
          :key="slot.position"
          class="slot"
          :class="[
            getSlotStatusClass(slot),
            { 'is-me': slot.playerId === playerId }
          ]"
        >
          <div class="slot-position">Player {{ slot.position + 1 }}</div>

          <!-- Open slot that joiner can claim: show name input + Join button -->
          <template v-if="canJoinSlot(slot)">
            <div class="join-input-row">
              <input
                v-model="slotNames[slot.position]"
                type="text"
                placeholder="Your name"
                class="join-name-input"
                @keyup.enter="handleJoinSlot(slot.position)"
              />
              <button
                @click="handleJoinSlot(slot.position)"
                class="btn join-btn"
                :disabled="!slotNames[slot.position]?.trim()"
              >
                Join
              </button>
            </div>
          </template>

          <!-- Taken slot: show name and status -->
          <template v-else>
            <div class="slot-name">{{ slot.name }}</div>
            <div class="slot-status">{{ getSlotStatusLabel(slot) }}</div>
          </template>
        </div>
      </div>
    </div>

    <!-- Name Edit (only for joiners who have claimed, not for creator) -->
    <div v-if="!isCreator && hasClaimed && myPosition !== undefined" class="name-edit">
      <label>Your Name (Player {{ myPosition + 1 }})</label>
      <div class="name-edit-row">
        <input
          v-model="myName"
          type="text"
          placeholder="Enter your name"
          @keyup.enter="handleUpdateName"
        />
        <button @click="handleUpdateName" class="btn small">Update</button>
      </div>
    </div>

    <!-- Status Message -->
    <div class="status-message">
      <div v-if="lobby.isReady" class="ready">
        All players have joined! Starting game...
      </div>
      <div v-else-if="hasClaimed || isCreator" class="waiting">
        Waiting for {{ lobby.openSlots }} more player{{ lobby.openSlots !== 1 ? 's' : '' }}...
      </div>
      <div v-else class="instruction">
        Enter your name and click "Join" to take a player slot
      </div>
    </div>

    <!-- Cancel Button -->
    <button @click="emit('cancel')" class="btn text">
      {{ isCreator ? 'Cancel Game' : 'Leave' }}
    </button>
  </div>
</template>

<style scoped>
.waiting-room {
  max-width: 500px;
  margin: 0 auto;
  text-align: center;
  padding: 40px 20px;
}

.waiting-room h2 {
  margin-bottom: 20px;
  color: #fff;
}

.waiting-room h3 {
  margin-bottom: 12px;
  color: #aaa;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Game Info */
.game-info {
  margin-bottom: 20px;
}

.game-title {
  font-size: 1.5rem;
  color: #00d9ff;
  margin-bottom: 8px;
}

.game-options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.option-badge {
  background: rgba(255, 255, 255, 0.1);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.85rem;
  color: #888;
}

/* Share Code */
.share-code {
  background: rgba(0, 217, 255, 0.1);
  padding: 20px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.share-code p {
  margin-bottom: 10px;
  color: #aaa;
  font-size: 0.9rem;
}

.code-display {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.code {
  font-family: monospace;
  font-size: 1.8rem;
  color: #00d9ff;
  letter-spacing: 3px;
}

/* Slots */
.slots-container {
  margin-bottom: 24px;
}

.slots-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slot {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: 2px solid transparent;
  transition: all 0.2s;
}

.slot.is-me {
  border-color: #00d9ff;
  background: rgba(0, 217, 255, 0.1);
}

.slot-position {
  font-size: 0.85rem;
  color: #666;
  width: 80px;
  text-align: left;
  flex-shrink: 0;
}

.slot-name {
  flex: 1;
  font-weight: 500;
  color: #fff;
  text-align: left;
}

.slot-status {
  font-size: 0.8rem;
  padding: 4px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.slot-action {
  flex-shrink: 0;
}

.slot.open .slot-status {
  color: #f39c12;
  background: rgba(243, 156, 18, 0.2);
}

.slot.claimed .slot-status {
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.2);
}

.slot.ai .slot-status {
  color: #9b59b6;
  background: rgba(155, 89, 182, 0.2);
}

.slot.ai .slot-name {
  color: #9b59b6;
}

/* Join button on slots */
.join-btn {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  font-weight: bold;
  padding: 6px 16px;
  font-size: 0.85rem;
}

.join-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 10px rgba(0, 217, 255, 0.4);
}

.join-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Inline join input */
.join-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.join-name-input {
  flex: 1;
  padding: 8px 12px;
  border: 2px solid #00d9ff;
  border-radius: 6px;
  background: rgba(0, 217, 255, 0.1);
  color: #fff;
  font-size: 0.9rem;
}

.join-name-input:focus {
  outline: none;
}

.join-name-input::placeholder {
  color: #666;
}


/* Name Edit */
.name-edit {
  margin-bottom: 20px;
  text-align: left;
}

.name-edit label {
  display: block;
  margin-bottom: 8px;
  color: #888;
  font-size: 0.9rem;
}

.name-edit-row {
  display: flex;
  gap: 8px;
}

.name-edit-row input {
  flex: 1;
  padding: 10px 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
}

.name-edit-row input:focus {
  outline: none;
  border-color: #00d9ff;
}

/* Status Message */
.status-message {
  margin-bottom: 20px;
  padding: 16px;
  border-radius: 8px;
}

.status-message .ready {
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.1);
  padding: 12px;
  border-radius: 8px;
}

.status-message .waiting {
  color: #f39c12;
}

.status-message .instruction {
  color: #888;
}

/* Buttons */
.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn.primary {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  font-weight: bold;
  width: 100%;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4);
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.btn.secondary:hover {
  border-color: #00d9ff;
}

.btn.text {
  background: transparent;
  color: #888;
}

.btn.text:hover {
  color: #fff;
}

.btn.small {
  padding: 8px 16px;
  font-size: 0.9rem;
}
</style>

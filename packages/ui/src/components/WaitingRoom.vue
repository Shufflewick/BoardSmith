<script setup lang="ts">
/**
 * WaitingRoom - Video game-style lobby for multiplayer games
 *
 * Features:
 * - Host can modify game settings and manage player slots
 * - Players can modify their own settings (name, options)
 * - Everyone has a "Ready" button
 * - Game starts only when ALL players (including host) click "Ready"
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
  ready: boolean;
  connected?: boolean;
}

// Game option types (must be defined before LobbyInfo)
interface NumberGameOption {
  type: 'number';
  label: string;
  description?: string;
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

interface SelectGameOption {
  type: 'select';
  label: string;
  description?: string;
  default?: string | number;
  choices: Array<{ value: string | number; label: string }>;
}

interface BooleanGameOption {
  type: 'boolean';
  label: string;
  description?: string;
  default?: boolean;
}

type GameOptionDefinition = NumberGameOption | SelectGameOption | BooleanGameOption;

interface LobbyInfo {
  state: 'waiting' | 'playing' | 'finished';
  gameType: string;
  displayName?: string;
  slots: LobbySlot[];
  gameOptions?: Record<string, unknown>;
  gameOptionsDefinitions?: Record<string, GameOptionDefinition>;
  creatorId?: string;
  openSlots: number;
  isReady: boolean;
  minPlayers?: number;
  maxPlayers?: number;
}

// Player option types
interface StandardPlayerOption {
  type: 'select' | 'color' | 'text';
  label: string;
  description?: string;
  default?: string;
  choices?: Array<{ value: string; label: string }> | string[];
}

interface ExclusivePlayerOption {
  type: 'exclusive';
  label: string;
  description?: string;
  default?: 'first' | 'last' | number;
}

type PlayerOptionDefinition = StandardPlayerOption | ExclusivePlayerOption;

const props = defineProps<{
  /** The game ID/code to share */
  gameId: string;
  /** Current lobby information */
  lobby: LobbyInfo;
  /** Current player's ID */
  playerId: string;
  /** Whether this player is the creator/host */
  isCreator: boolean;
  /** Player option definitions from game definition */
  playerOptions?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  (e: 'claim-position', position: number, name: string): void;
  (e: 'update-name', name: string): void;
  (e: 'set-ready', ready: boolean): void;
  (e: 'add-slot'): void;
  (e: 'remove-slot', position: number): void;
  (e: 'set-slot-ai', position: number, isAI: boolean, aiLevel?: string): void;
  (e: 'kick-player', position: number): void;
  (e: 'update-player-options', options: Record<string, unknown>): void;
  (e: 'update-game-options', options: Record<string, unknown>): void;
  (e: 'cancel'): void;
}>();

// State for joining - track name per slot for open positions
const slotNames = ref<Record<number, string>>({});

// For name update after claiming
const myName = ref('');

// Toast notifications
const toast = useToast();

// Find the player's current slot (if claimed)
const mySlot = computed(() => {
  return props.lobby.slots.find(s => s.playerId === props.playerId);
});

// Check if player has already claimed a position
const hasClaimed = computed(() => {
  return mySlot.value !== undefined;
});

// Whether current player is ready
const isReady = computed(() => {
  return mySlot.value?.ready ?? false;
});

// Sync name when player claims
watch(() => props.lobby, (lobby) => {
  const slot = lobby.slots.find(s => s.playerId === props.playerId);
  if (slot) {
    myName.value = slot.name;
  }
}, { immediate: true });

// Type-safe player options
const typedPlayerOptions = computed(() => {
  if (!props.playerOptions) return null;
  return props.playerOptions as Record<string, PlayerOptionDefinition>;
});

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

// Check if host can add more slots
const canAddSlot = computed(() => {
  if (!props.isCreator) return false;
  const maxPlayers = props.lobby.maxPlayers ?? 10;
  return props.lobby.slots.length < maxPlayers;
});

// Check if host can remove slots
const canRemoveSlots = computed(() => {
  if (!props.isCreator) return false;
  const minPlayers = props.lobby.minPlayers ?? 2;
  return props.lobby.slots.length > minPlayers;
});

// Count of players ready (excluding open slots)
const readyCount = computed(() => {
  return props.lobby.slots.filter(s => s.status !== 'open' && s.ready).length;
});

// Count of filled slots
const filledCount = computed(() => {
  return props.lobby.slots.filter(s => s.status !== 'open').length;
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

function handleToggleReady() {
  emit('set-ready', !isReady.value);
}

function handleAddSlot() {
  emit('add-slot');
}

function handleRemoveSlot(position: number) {
  emit('remove-slot', position);
}

function handleToggleAI(slot: LobbySlot) {
  if (slot.status === 'ai') {
    // Convert to open
    emit('set-slot-ai', slot.position, false);
  } else if (slot.status === 'open') {
    // Convert to AI
    emit('set-slot-ai', slot.position, true, 'medium');
  }
}

function getSlotStatusClass(slot: LobbySlot): string {
  if (slot.status === 'ai') return 'ai';
  if (slot.status === 'claimed') return 'claimed';
  return 'open';
}

function canJoinSlot(slot: LobbySlot): boolean {
  // Can join if: not creator, haven't claimed yet, slot is open
  return !props.isCreator && !hasClaimed.value && slot.status === 'open';
}

function canHostManageSlot(slot: LobbySlot): boolean {
  // Host can manage open or AI slots (not claimed by humans, not position 0)
  return props.isCreator && slot.position !== 0 && slot.status !== 'claimed';
}

function canHostRemoveSlot(slot: LobbySlot): boolean {
  // Host can remove open slots (not claimed, not position 0, above min players)
  return props.isCreator && slot.position !== 0 && slot.status === 'open' && canRemoveSlots.value;
}

function canHostKickPlayer(slot: LobbySlot): boolean {
  // Host can kick claimed players (not themselves, not AI, not position 0)
  return props.isCreator && slot.position !== 0 && slot.status === 'claimed';
}

function handleKickPlayer(position: number) {
  emit('kick-player', position);
}

// Player options helpers
function getPlayerOptionChoices(opt: PlayerOptionDefinition): Array<{ value: string; label: string }> {
  if (opt.type === 'exclusive') return [];
  const stdOpt = opt as StandardPlayerOption;
  if (!stdOpt.choices) return [];
  return stdOpt.choices.map((c) => (typeof c === 'string' ? { value: c, label: c } : c));
}

/**
 * Get values taken by OTHER players for a given option key
 */
function getTakenValues(playerPosition: number, key: string): Set<string> {
  const takenValues = new Set<string>();
  for (const slot of props.lobby.slots) {
    if (slot.position !== playerPosition && slot.playerOptions) {
      const val = slot.playerOptions[key];
      if (val !== undefined) {
        takenValues.add(String(val));
      }
    }
  }
  return takenValues;
}

/**
 * Check if a choice is taken by another player
 */
function isChoiceTaken(playerPosition: number, key: string, choiceValue: string): boolean {
  return getTakenValues(playerPosition, key).has(choiceValue);
}

/**
 * Get current player's option value
 */
function getMyOptionValue(key: string, opt: PlayerOptionDefinition): string {
  if (!mySlot.value?.playerOptions) {
    if (opt.type !== 'exclusive') {
      return (opt as StandardPlayerOption).default ?? '';
    }
    return '';
  }
  const value = mySlot.value.playerOptions[key];
  if (value !== undefined) return String(value);
  if (opt.type !== 'exclusive') {
    return (opt as StandardPlayerOption).default ?? '';
  }
  return '';
}

/**
 * Update a player option
 */
function handleUpdateOption(key: string, value: unknown) {
  const currentOptions = mySlot.value?.playerOptions ?? {};
  const updatedOptions = { ...currentOptions, [key]: value };
  emit('update-player-options', updatedOptions);
}

/**
 * Check if this player has the exclusive option
 */
function hasExclusiveOption(key: string, opt: ExclusivePlayerOption): boolean {
  if (!mySlot.value) return false;

  // Check if any player has it explicitly set
  for (const slot of props.lobby.slots) {
    const value = slot.playerOptions?.[key];
    if (value === true) {
      return slot.position === mySlot.value.position;
    }
  }

  // No one has it set - use default
  const defaultIndex = getExclusiveDefaultIndex(opt);
  return mySlot.value.position === defaultIndex;
}

/**
 * Get the default player index for an exclusive option
 */
function getExclusiveDefaultIndex(opt: ExclusivePlayerOption): number {
  if (opt.default === 'first' || opt.default === undefined) return 0;
  if (opt.default === 'last') return props.lobby.slots.length - 1;
  return opt.default;
}

/**
 * Set the exclusive option for this player
 */
function handleSetExclusiveOption(key: string) {
  handleUpdateOption(key, true);
}

// ============================================
// Game Options Helpers (for host)
// ============================================

/**
 * Check if there are editable game options for the host
 */
const hasEditableGameOptions = computed(() => {
  return props.isCreator &&
    props.lobby.gameOptionsDefinitions &&
    Object.keys(props.lobby.gameOptionsDefinitions).length > 0;
});

/**
 * Get current game option value
 */
function getGameOptionValue(key: string, opt: GameOptionDefinition): unknown {
  const currentOptions = props.lobby.gameOptions ?? {};
  if (key in currentOptions) {
    return currentOptions[key];
  }
  return opt.default;
}

/**
 * Update a game option (host only)
 */
function handleUpdateGameOption(key: string, value: unknown) {
  const currentOptions = props.lobby.gameOptions ?? {};
  const updatedOptions = { ...currentOptions, [key]: value };
  emit('update-game-options', updatedOptions);
}
</script>

<template>
  <div class="waiting-room">
    <!-- Header -->
    <h2>{{ lobby.displayName || lobby.gameType }}</h2>

    <!-- Share Code -->
    <div class="share-code">
      <div class="code-row">
        <span class="code-label">Game Code:</span>
        <span class="code">{{ gameId }}</span>
        <button @click="copyGameCode" class="btn small">Copy</button>
      </div>
    </div>

    <!-- Game Options (read-only for non-hosts) -->
    <div v-if="displayableGameOptions && !hasEditableGameOptions" class="game-options">
      <span v-for="(value, key) in displayableGameOptions" :key="key" class="option-badge">
        {{ key }}: {{ value }}
      </span>
    </div>

    <!-- Game Settings (editable for host) -->
    <div v-if="hasEditableGameOptions" class="game-settings">
      <h3>Game Settings</h3>
      <div class="game-settings-grid">
        <div
          v-for="(opt, key) in lobby.gameOptionsDefinitions"
          :key="key"
          class="game-option"
        >
          <label class="game-option-label">{{ opt.label }}</label>
          <p v-if="opt.description" class="game-option-description">{{ opt.description }}</p>

          <!-- Number type -->
          <input
            v-if="opt.type === 'number'"
            type="number"
            class="game-option-input"
            :value="getGameOptionValue(String(key), opt)"
            :min="(opt as NumberGameOption).min"
            :max="(opt as NumberGameOption).max"
            :step="(opt as NumberGameOption).step"
            @change="handleUpdateGameOption(String(key), Number(($event.target as HTMLInputElement).value))"
          />

          <!-- Select type -->
          <select
            v-else-if="opt.type === 'select'"
            class="game-option-select"
            :value="getGameOptionValue(String(key), opt)"
            @change="handleUpdateGameOption(String(key), ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="choice in (opt as SelectGameOption).choices"
              :key="String(choice.value)"
              :value="choice.value"
            >
              {{ choice.label }}
            </option>
          </select>

          <!-- Boolean type -->
          <label v-else-if="opt.type === 'boolean'" class="boolean-toggle">
            <input
              type="checkbox"
              :checked="!!getGameOptionValue(String(key), opt)"
              @change="handleUpdateGameOption(String(key), ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle-switch"></span>
            <span class="toggle-label">{{ getGameOptionValue(String(key), opt) ? 'On' : 'Off' }}</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Main content area - side by side on larger screens -->
    <div class="main-content">
      <!-- Player Slots -->
      <div class="slots-container">
        <div class="slots-header">
          <h3>Players ({{ filledCount }}/{{ lobby.slots.length }})</h3>
          <button
            v-if="canAddSlot"
            @click="handleAddSlot"
            class="btn small add-player-btn"
          >
            + Add Player
          </button>
        </div>

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
          <div class="slot-position">P{{ slot.position + 1 }}</div>

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

          <!-- Open slot for host: show management controls -->
          <template v-else-if="isCreator && slot.status === 'open'">
            <div class="slot-content">
              <span class="slot-name open-label">Open Slot</span>
              <div class="slot-controls">
                <button
                  @click="handleToggleAI(slot)"
                  class="btn small control-btn"
                  title="Make AI"
                >
                  Make AI
                </button>
                <button
                  v-if="canRemoveSlots"
                  @click="handleRemoveSlot(slot.position)"
                  class="btn small control-btn danger"
                  title="Remove slot"
                >
                  Remove
                </button>
              </div>
            </div>
          </template>

          <!-- AI slot -->
          <template v-else-if="slot.status === 'ai'">
            <div class="slot-content">
              <span class="slot-name ai-name">{{ slot.name }}</span>
              <span class="slot-badge ai-badge">AI ({{ slot.aiLevel || 'medium' }})</span>
              <span class="ready-indicator ready">Ready</span>
              <div v-if="isCreator && slot.position !== 0" class="slot-controls">
                <button
                  @click="handleToggleAI(slot)"
                  class="btn small control-btn"
                  title="Make open"
                >
                  Open
                </button>
              </div>
            </div>
          </template>

          <!-- Claimed slot (human player) - MY slot with Ready button -->
          <template v-else-if="slot.playerId === playerId">
            <div class="slot-content">
              <span class="connection-dot online" title="Connected"></span>
              <span class="slot-name">{{ slot.name }}</span>
              <span v-if="slot.playerId === lobby.creatorId" class="slot-badge host-badge">Host</span>
              <span class="slot-badge you-badge">You</span>
            </div>
            <button
              @click="handleToggleReady"
              class="btn inline-ready-btn"
              :class="isReady ? 'ready' : 'not-ready'"
            >
              {{ isReady ? 'Ready' : 'Ready?' }}
            </button>
          </template>

          <!-- Claimed slot (human player) - OTHER player -->
          <template v-else>
            <div class="slot-content">
              <span class="connection-dot" :class="slot.connected ? 'online' : 'offline'" :title="slot.connected ? 'Connected' : 'Disconnected'"></span>
              <span class="slot-name" :class="{ 'disconnected': !slot.connected }">{{ slot.name }}</span>
              <span v-if="slot.playerId === lobby.creatorId" class="slot-badge host-badge">Host</span>
              <span
                class="ready-indicator"
                :class="slot.ready ? 'ready' : 'not-ready'"
              >
                {{ slot.ready ? 'Ready' : 'Not Ready' }}
              </span>
              <button
                v-if="canHostKickPlayer(slot)"
                @click="handleKickPlayer(slot.position)"
                class="btn kick-btn"
                title="Kick player"
              >
                Kick
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

      <!-- My Settings (for players who have claimed) -->
      <div v-if="hasClaimed" class="my-settings">
      <h3>Your Settings</h3>

      <div class="name-edit-row">
        <label>Name:</label>
        <input
          v-model="myName"
          type="text"
          placeholder="Enter your name"
          @keyup.enter="handleUpdateName"
        />
        <button @click="handleUpdateName" class="btn small">Update</button>
      </div>

      <!-- Player Options (color, etc.) -->
      <div v-if="typedPlayerOptions && Object.keys(typedPlayerOptions).length > 0" class="player-options-section">
        <div v-for="(opt, key) in typedPlayerOptions" :key="key" class="player-option">
          <label class="player-option-label">{{ opt.label }}</label>

          <!-- Select type -->
          <select
            v-if="opt.type === 'select'"
            class="player-option-select"
            :value="getMyOptionValue(String(key), opt)"
            @change="handleUpdateOption(String(key), ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="choice in getPlayerOptionChoices(opt)"
              :key="choice.value"
              :value="choice.value"
              :disabled="isChoiceTaken(mySlot?.position ?? -1, String(key), choice.value)"
            >
              {{ choice.label }}{{ isChoiceTaken(mySlot?.position ?? -1, String(key), choice.value) ? ' (taken)' : '' }}
            </option>
          </select>

          <!-- Color type - show ALL colors, disable taken ones -->
          <div v-else-if="opt.type === 'color'" class="color-picker">
            <button
              v-for="color in getPlayerOptionChoices(opt)"
              :key="color.value"
              class="color-swatch"
              :class="{
                selected: getMyOptionValue(String(key), opt) === color.value,
                taken: isChoiceTaken(mySlot?.position ?? -1, String(key), color.value)
              }"
              :style="{ backgroundColor: color.value }"
              :title="isChoiceTaken(mySlot?.position ?? -1, String(key), color.value) ? `${color.label} (taken)` : color.label"
              :disabled="isChoiceTaken(mySlot?.position ?? -1, String(key), color.value)"
              @click="!isChoiceTaken(mySlot?.position ?? -1, String(key), color.value) && handleUpdateOption(String(key), color.value)"
            />
          </div>

          <!-- Text type -->
          <input
            v-else-if="opt.type === 'text'"
            type="text"
            class="player-option-input"
            :value="getMyOptionValue(String(key), opt)"
            :placeholder="(opt as StandardPlayerOption).default"
            @input="handleUpdateOption(String(key), ($event.target as HTMLInputElement).value)"
          />

          <!-- Exclusive type (radio button style) -->
          <label
            v-else-if="opt.type === 'exclusive'"
            class="exclusive-option"
            :class="{ selected: hasExclusiveOption(String(key), opt as ExclusivePlayerOption) }"
          >
            <input
              type="checkbox"
              :checked="hasExclusiveOption(String(key), opt as ExclusivePlayerOption)"
              @change="handleSetExclusiveOption(String(key))"
            />
            <span class="exclusive-indicator"></span>
            <span class="exclusive-label">{{ opt.label }}</span>
          </label>
        </div>
      </div>
    </div>
    </div>

    <!-- Status Message -->
    <div class="status-message">
      <div v-if="lobby.isReady" class="starting">
        All players ready! Starting game...
      </div>
      <div v-else-if="lobby.openSlots > 0" class="waiting">
        Waiting for {{ lobby.openSlots }} more player{{ lobby.openSlots !== 1 ? 's' : '' }} to join...
      </div>
      <div v-else-if="readyCount < filledCount" class="waiting">
        Waiting for players to ready up ({{ readyCount }}/{{ filledCount }})...
      </div>
      <div v-else-if="!hasClaimed && !isCreator" class="instruction">
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
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  text-align: center;
  padding: 40px 40px;
}

.waiting-room h2 {
  margin-bottom: 20px;
  color: #00d9ff;
  font-size: 1.8rem;
}

.waiting-room h3 {
  margin: 0;
  color: #aaa;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Share Code */
.share-code {
  background: rgba(0, 217, 255, 0.1);
  padding: 16px 20px;
  border-radius: 12px;
  margin-bottom: 16px;
}

.code-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.code-label {
  color: #888;
  font-size: 0.9rem;
}

.code {
  font-family: monospace;
  font-size: 1.5rem;
  color: #00d9ff;
  letter-spacing: 2px;
}

/* Game Options (read-only badges) */
.game-options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-bottom: 20px;
}

/* Game Settings (editable for host) */
.game-settings {
  background: rgba(255, 255, 255, 0.05);
  padding: 20px;
  border-radius: 12px;
  margin-bottom: 20px;
  text-align: left;
}

.game-settings h3 {
  margin-bottom: 16px;
  text-align: center;
}

.game-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.game-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.game-option-label {
  font-size: 0.9rem;
  color: #ccc;
  font-weight: 500;
}

.game-option-description {
  font-size: 0.8rem;
  color: #888;
  margin: 0 0 4px 0;
}

.game-option-input,
.game-option-select {
  padding: 10px 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
}

.game-option-input:focus,
.game-option-select:focus {
  outline: none;
  border-color: #00d9ff;
}

.game-option-select option {
  background: #1a1a2e;
  color: #fff;
}

/* Boolean toggle switch */
.boolean-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.boolean-toggle input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-switch {
  width: 48px;
  height: 26px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 13px;
  position: relative;
  transition: background 0.2s;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  top: 3px;
  left: 3px;
  transition: transform 0.2s;
}

.boolean-toggle input:checked + .toggle-switch {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
}

.boolean-toggle input:checked + .toggle-switch::after {
  transform: translateX(22px);
}

.toggle-label {
  font-size: 0.9rem;
  color: #888;
}

.boolean-toggle input:checked ~ .toggle-label {
  color: #2ecc71;
}

/* Main content - side by side on larger screens */
.main-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

@media (min-width: 700px) {
  .main-content {
    flex-direction: row;
    align-items: flex-start;
    gap: 32px;
  }

  .main-content .slots-container {
    flex: 1;
    min-width: 0;
  }

  .main-content .my-settings {
    flex: 0 0 340px;
    margin-top: 0;
  }
}

.option-badge {
  background: rgba(255, 255, 255, 0.1);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.85rem;
  color: #888;
}

/* Slots */
.slots-container {
  margin-bottom: 24px;
}

.slots-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.add-player-btn {
  background: rgba(0, 217, 255, 0.2);
  color: #00d9ff;
  border: 1px solid #00d9ff;
}

.add-player-btn:hover {
  background: rgba(0, 217, 255, 0.3);
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
  gap: 12px;
}

.slot.is-me {
  border-color: #00d9ff;
  background: rgba(0, 217, 255, 0.1);
}

.slot-position {
  font-size: 0.85rem;
  font-weight: bold;
  color: #666;
  width: 30px;
  flex-shrink: 0;
}

.slot-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.slot-name {
  font-weight: 500;
  color: #fff;
}

.slot-name.disconnected {
  color: #888;
  opacity: 0.7;
}

/* Connection status indicator */
.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.connection-dot.online {
  background: #2ecc71;
  box-shadow: 0 0 6px rgba(46, 204, 113, 0.6);
}

.connection-dot.offline {
  background: #888;
}

.slot-name.open-label {
  color: #666;
  font-style: italic;
}

.slot-name.ai-name {
  color: #9b59b6;
}

.slot-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.host-badge {
  background: rgba(255, 215, 0, 0.2);
  color: #ffd700;
}

.you-badge {
  background: rgba(0, 217, 255, 0.2);
  color: #00d9ff;
}

.ai-badge {
  background: rgba(155, 89, 182, 0.2);
  color: #9b59b6;
}

.ready-indicator {
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 4px;
  margin-left: auto;
}

.ready-indicator.ready {
  background: rgba(46, 204, 113, 0.2);
  color: #2ecc71;
}

.ready-indicator.not-ready {
  background: rgba(243, 156, 18, 0.2);
  color: #f39c12;
}

.slot-controls {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.control-btn {
  padding: 4px 10px;
  font-size: 0.75rem;
  background: rgba(255, 255, 255, 0.1);
  color: #888;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.control-btn.danger {
  color: #e74c3c;
}

.control-btn.danger:hover {
  background: rgba(231, 76, 60, 0.2);
}

/* Kick button */
.kick-btn {
  padding: 4px 8px;
  font-size: 0.9rem;
  background: rgba(231, 76, 60, 0.2);
  color: #e74c3c;
  border: 1px solid transparent;
  border-radius: 4px;
  margin-left: 8px;
  line-height: 1;
}

.kick-btn:hover {
  background: rgba(231, 76, 60, 0.4);
  border-color: #e74c3c;
}

/* Inline Ready button (in slot row) */
.inline-ready-btn {
  padding: 6px 16px;
  font-size: 0.85rem;
  font-weight: bold;
  border-radius: 6px;
  flex-shrink: 0;
}

.inline-ready-btn.not-ready {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  border: none;
}

.inline-ready-btn.not-ready:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 10px rgba(0, 217, 255, 0.4);
}

.inline-ready-btn.ready {
  background: rgba(46, 204, 113, 0.2);
  color: #2ecc71;
  border: 2px solid #2ecc71;
}

/* Join button on slots */
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

/* My Settings */
.my-settings {
  background: rgba(255, 255, 255, 0.05);
  padding: 24px;
  border-radius: 12px;
  margin-bottom: 20px;
  text-align: left;
}

.my-settings h3 {
  margin-bottom: 16px;
}

.name-edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.name-edit-row label {
  color: #888;
  font-size: 0.9rem;
  flex-shrink: 0;
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

.status-message .starting {
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.1);
  padding: 12px;
  border-radius: 8px;
  font-weight: 500;
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

/* Player Options */
.player-options-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.player-option {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.player-option-label {
  font-size: 0.85rem;
  color: #888;
}

.player-option-select,
.player-option-input {
  padding: 10px 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
}

.player-option-select:focus,
.player-option-input:focus {
  outline: none;
  border-color: #00d9ff;
}

.player-option-select option {
  background: #1a1a2e;
  color: #fff;
}

.color-picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.color-swatch:hover:not(.taken):not(:disabled) {
  transform: scale(1.1);
}

.color-swatch.selected {
  border-color: #fff;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.5);
}

.color-swatch.taken,
.color-swatch:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* X mark over taken colors */
.color-swatch.taken::before,
.color-swatch.taken::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 80%;
  height: 3px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
  border-radius: 1px;
}

.color-swatch.taken::before {
  transform: translate(-50%, -50%) rotate(45deg);
}

.color-swatch.taken::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

/* Exclusive option (checkbox style) */
.exclusive-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.exclusive-option:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.25);
}

.exclusive-option.selected {
  background: rgba(0, 217, 255, 0.1);
  border-color: #00d9ff;
}

.exclusive-option input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.exclusive-indicator {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  background: transparent;
  position: relative;
  transition: all 0.2s;
  flex-shrink: 0;
}

.exclusive-option.selected .exclusive-indicator {
  border-color: #00d9ff;
}

.exclusive-option.selected .exclusive-indicator::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, #00d9ff, #00ff88);
}

.exclusive-label {
  font-size: 0.95rem;
  color: #ccc;
  transition: color 0.2s;
}

.exclusive-option.selected .exclusive-label {
  color: #fff;
  font-weight: 500;
}
</style>

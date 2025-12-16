<script setup lang="ts">
/**
 * GameLobby - Enhanced lobby for creating or joining a game
 *
 * Features:
 * - Create game with configurable options
 * - Player configuration (names, AI, colors, roles)
 * - Quick start presets
 * - Join existing game by code
 */
import { ref, reactive, computed, onMounted } from 'vue';
import GameOptionsForm from './GameOptionsForm.vue';
import PlayerConfigList from './PlayerConfigList.vue';
import PresetsPanel from './PresetsPanel.vue';

interface NumberOption {
  type: 'number';
  label: string;
  description?: string;
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

interface SelectOption {
  type: 'select';
  label: string;
  description?: string;
  default?: string | number;
  choices: Array<{ value: string | number; label: string }>;
}

interface BooleanOption {
  type: 'boolean';
  label: string;
  description?: string;
  default?: boolean;
}

type GameOptionDefinition = NumberOption | SelectOption | BooleanOption;

interface PlayerOptionDefinition {
  type: 'select' | 'color' | 'text';
  label: string;
  description?: string;
  default?: string;
  choices?: Array<{ value: string; label: string }> | string[];
}

interface PlayerConfig {
  name: string;
  isAI: boolean;
  aiLevel: string;
  [key: string]: unknown;
}

// Preset player configs have all fields optional
interface PresetPlayerConfig {
  name?: string;
  isAI?: boolean;
  aiLevel?: string;
  [key: string]: unknown;
}

interface GamePreset {
  name: string;
  description?: string;
  options: Record<string, unknown>;
  players?: PresetPlayerConfig[];
}

interface GameDefinitionMeta {
  gameType: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  hasAI: boolean;
  gameOptions: Record<string, GameOptionDefinition>;
  playerOptions: Record<string, PlayerOptionDefinition>;
  presets: GamePreset[];
}

interface LobbyConfig {
  playerCount: number;
  gameOptions: Record<string, unknown>;
  playerConfigs: PlayerConfig[];
}

const props = defineProps<{
  /** Display name for the game */
  displayName: string;
  /** API base URL (optional, defaults to same origin with port 8787) */
  apiUrl?: string;
}>();

const joinGameId = defineModel<string>('joinGameId', { required: true });
const joinPlayerName = ref('');

const emit = defineEmits<{
  (e: 'create', config: LobbyConfig): void;
  (e: 'join', playerName?: string): void;
}>();

// Game definition metadata (fetched from server)
const definition = ref<GameDefinitionMeta | null>(null);
const isLoading = ref(true);
const fetchError = ref<string | null>(null);

// Configuration state
const playerCount = ref(2);
const gameOptions = reactive<Record<string, unknown>>({});
const playerConfigs = ref<PlayerConfig[]>([]);

// Computed: can we show game options?
const hasGameOptions = computed(
  () => definition.value?.gameOptions && Object.keys(definition.value.gameOptions).length > 0
);

// Computed: can we show player options?
const hasPlayerOptions = computed(
  () => definition.value?.playerOptions && Object.keys(definition.value.playerOptions).length > 0
);

// Get unique default value for a player option
function getUniqueDefault(
  optKey: string,
  opt: PlayerOptionDefinition,
  playerIndex: number,
  configs: PlayerConfig[]
): string | undefined {
  if (!opt.choices) return opt.default;

  // Get values already assigned to previous players
  const usedValues = new Set<string>();
  for (let i = 0; i < playerIndex; i++) {
    const val = configs[i]?.[optKey];
    if (val !== undefined) {
      usedValues.add(String(val));
    }
  }

  // Normalize choices to array of {value, label}
  const choices = opt.choices.map((c) =>
    typeof c === 'string' ? { value: c, label: c } : c
  );

  // Find first unused choice
  for (const choice of choices) {
    if (!usedValues.has(choice.value)) {
      return choice.value;
    }
  }

  // Fallback to default if all choices are taken
  return opt.default;
}

// Initialize player configs when player count changes
function initPlayerConfigs() {
  const count = playerCount.value;
  const existingConfigs = playerConfigs.value;
  const playerOpts = definition.value?.playerOptions;

  const newConfigs: PlayerConfig[] = [];

  for (let i = 0; i < count; i++) {
    // Preserve existing config if available
    if (existingConfigs[i]) {
      newConfigs.push({ ...existingConfigs[i] });
      continue;
    }

    // Create new config with defaults
    const config: PlayerConfig = {
      name: `Player ${i + 1}`,
      isAI: false,
      aiLevel: 'medium',
    };

    // Apply unique defaults for player options
    if (playerOpts) {
      for (const [key, opt] of Object.entries(playerOpts)) {
        config[key] = getUniqueDefault(key, opt, i, newConfigs);
      }
    }

    newConfigs.push(config);
  }

  playerConfigs.value = newConfigs;
}

// Fetch game definition on mount
onMounted(async () => {
  try {
    // Determine API URL (default to worker port on same host)
    const baseUrl =
      props.apiUrl || window.location.origin.replace(/:\d+$/, ':8787');
    const res = await fetch(`${baseUrl}/games/definitions`);
    const data = await res.json();

    if (data.success && data.definitions?.length > 0) {
      // Dev server typically has just one game
      definition.value = data.definitions[0];

      // Set initial player count
      playerCount.value = definition.value?.minPlayers ?? 2;

      // Initialize options with defaults
      if (definition.value?.gameOptions) {
        for (const [key, opt] of Object.entries(definition.value.gameOptions)) {
          if (opt.default !== undefined) {
            gameOptions[key] = opt.default;
          }
        }
      }

      initPlayerConfigs();
    }
  } catch (e) {
    console.warn('Could not fetch game definitions:', e);
    fetchError.value = 'Could not load game configuration';
  } finally {
    isLoading.value = false;
  }
});

// Apply a preset
function applyPreset(preset: GamePreset) {
  // Apply game options
  for (const [key, value] of Object.entries(preset.options)) {
    gameOptions[key] = value;
  }

  // Apply player configs if provided
  if (preset.players) {
    const count = Math.max(preset.players.length, definition.value?.minPlayers ?? 2);
    playerCount.value = count;

    playerConfigs.value = Array.from({ length: count }, (_, i) => {
      const presetPlayer = preset.players?.[i];

      return {
        name: presetPlayer?.name ?? `Player ${i + 1}`,
        isAI: presetPlayer?.isAI ?? false,
        aiLevel: presetPlayer?.aiLevel ?? 'medium',
        ...Object.fromEntries(
          Object.entries(presetPlayer ?? {}).filter(
            ([k]) => !['name', 'isAI', 'aiLevel'].includes(k)
          )
        ),
      };
    });
  }
}

// Handle create game
function handleCreate() {
  emit('create', {
    playerCount: playerCount.value,
    gameOptions: { ...gameOptions },
    playerConfigs: playerConfigs.value.slice(0, playerCount.value),
  });
}

// Generate player count options
const playerCountOptions = computed(() => {
  if (!definition.value) return [];
  const min = definition.value.minPlayers;
  const max = definition.value.maxPlayers;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
});
</script>

<template>
  <div class="game-lobby">
    <h1>{{ displayName }}</h1>

    <div class="lobby-form">
      <div class="lobby-actions">
        <!-- Create Game Section -->
        <div class="action-box create-section">
          <h3>Create New Game</h3>

          <!-- Loading State -->
          <div v-if="isLoading" class="loading">Loading game options...</div>

          <!-- Error State -->
          <div v-else-if="fetchError" class="error">{{ fetchError }}</div>

          <!-- Configuration -->
          <template v-else-if="definition">
            <!-- Presets -->
            <PresetsPanel
              v-if="definition.presets?.length"
              :presets="definition.presets"
              @select="applyPreset"
            />

            <!-- Player Count -->
            <div v-if="playerCountOptions.length > 1" class="form-group inline">
              <label>Players:</label>
              <select v-model="playerCount" @change="initPlayerConfigs">
                <option v-for="n in playerCountOptions" :key="n" :value="n">
                  {{ n }} Players
                </option>
              </select>
            </div>

            <!-- Game Options -->
            <GameOptionsForm
              v-if="hasGameOptions"
              :options="definition.gameOptions"
              v-model="gameOptions"
            />

            <!-- Player Configuration -->
            <PlayerConfigList
              :player-count="playerCount"
              v-model="playerConfigs"
              :has-a-i="definition.hasAI"
              :player-options="hasPlayerOptions ? definition.playerOptions : undefined"
            />
          </template>

          <!-- Fallback when no definition loaded -->
          <p v-else class="hint">Start a new game and invite friends</p>

          <button @click="handleCreate" class="btn primary">Create Game</button>
        </div>

        <div class="divider">OR</div>

        <!-- Join Game Section -->
        <div class="action-box">
          <h3>Join Existing Game</h3>
          <p>Enter the game code from your friend</p>
          <input
            v-model="joinGameId"
            type="text"
            placeholder="Enter game code"
            class="game-code-input"
          />
          <input
            v-model="joinPlayerName"
            type="text"
            placeholder="Your name (optional)"
            class="player-name-join-input"
          />
          <button @click="emit('join', joinPlayerName.trim() || undefined)" class="btn secondary">Join Game</button>
        </div>
      </div>
    </div>

    <slot></slot>
  </div>
</template>

<style scoped>
.game-lobby {
  max-width: 500px;
  margin: 0 auto;
  padding: 40px 20px;
  text-align: center;
}

.game-lobby h1 {
  font-size: 2.5rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 30px;
}

.lobby-form {
  max-width: 500px;
  margin: 0 auto;
}

.form-group {
  margin-bottom: 20px;
  text-align: left;
}

.form-group.inline {
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-group.inline label {
  margin-bottom: 0;
  white-space: nowrap;
}

.form-group.inline select {
  flex: 1;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #aaa;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 12px 15px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
  transition: border-color 0.2s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #00d9ff;
}

.form-group input::placeholder {
  color: #666;
}

.form-group select option {
  background: #1a1a2e;
  color: #fff;
}

.lobby-actions {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.action-box {
  background: rgba(255, 255, 255, 0.05);
  padding: 25px;
  border-radius: 12px;
  text-align: center;
}

.action-box h3 {
  margin-bottom: 16px;
  color: #fff;
}

.action-box p,
.action-box .hint {
  color: #aaa;
  margin-bottom: 16px;
  font-size: 0.9rem;
}

.create-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}

.create-section h3 {
  text-align: center;
}

.game-code-input {
  width: 100%;
  padding: 12px;
  margin-bottom: 15px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
  font-family: monospace;
}

.game-code-input:focus {
  outline: none;
  border-color: #00d9ff;
}

.player-name-join-input {
  width: 100%;
  padding: 12px;
  margin-bottom: 15px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
}

.player-name-join-input:focus {
  outline: none;
  border-color: #00d9ff;
}

.player-name-join-input::placeholder {
  color: #666;
}

.game-code-input::placeholder {
  color: #666;
}

.divider {
  color: #666;
  font-size: 0.9rem;
}

.loading,
.error {
  padding: 12px;
  border-radius: 8px;
  text-align: center;
}

.loading {
  color: #888;
}

.error {
  color: #e74c3c;
  background: rgba(231, 76, 60, 0.1);
}

/* Buttons */
.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;
}

.btn.primary {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  font-weight: bold;
}

.btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4);
}

.btn.secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.btn.secondary:hover {
  border-color: #00d9ff;
}
</style>

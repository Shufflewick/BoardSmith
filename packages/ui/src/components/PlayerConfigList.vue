<script setup lang="ts">
/**
 * PlayerConfigList - Per-player configuration UI
 *
 * For each player slot, shows:
 * - Player name input
 * - AI toggle
 * - AI level dropdown (when AI is on)
 * - Custom player options (color, role, etc.)
 */
import { computed, watch } from 'vue';

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

const props = defineProps<{
  /** Number of player slots to show */
  playerCount: number;
  /** Current player configurations */
  modelValue: PlayerConfig[];
  /** Whether AI is available */
  hasAI: boolean;
  /** Per-player option definitions */
  playerOptions?: Record<string, PlayerOptionDefinition>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: PlayerConfig[]): void;
}>();

// Ensure we always have the right number of configs
const configs = computed(() => {
  const result: PlayerConfig[] = [];
  for (let i = 0; i < props.playerCount; i++) {
    result.push(
      props.modelValue[i] ?? {
        name: `Player ${i + 1}`,
        isAI: false,
        aiLevel: 'medium',
      }
    );
  }
  return result;
});

// Watch for player count changes and emit updated configs
watch(
  () => props.playerCount,
  () => {
    emit('update:modelValue', configs.value);
  }
);

function updatePlayer(index: number, field: string, value: unknown) {
  const updated = [...configs.value];
  updated[index] = { ...updated[index], [field]: value };
  emit('update:modelValue', updated);
}

function getPlayerOptionChoices(opt: PlayerOptionDefinition): Array<{ value: string; label: string }> {
  if (!opt.choices) return [];
  return opt.choices.map((c) => (typeof c === 'string' ? { value: c, label: c } : c));
}

/**
 * Get available choices for a player option, filtering out values already chosen by other players.
 * This prevents two players from selecting the same color, for example.
 */
function getAvailableChoices(playerIndex: number, key: string, opt: PlayerOptionDefinition): Array<{ value: string; label: string }> {
  const allChoices = getPlayerOptionChoices(opt);

  // Get values chosen by OTHER players
  const takenValues = new Set<string>();
  for (let i = 0; i < configs.value.length; i++) {
    if (i !== playerIndex) {
      const val = configs.value[i][key];
      if (val !== undefined) {
        takenValues.add(String(val));
      }
    }
  }

  // Filter out taken values (but keep the current player's selection visible)
  const currentValue = configs.value[playerIndex][key];
  return allChoices.filter(
    (choice) => !takenValues.has(choice.value) || choice.value === String(currentValue)
  );
}

function getPlayerOptionValue(index: number, key: string, opt: PlayerOptionDefinition): string {
  const value = configs.value[index][key];
  if (value !== undefined) return String(value);
  return opt.default ?? '';
}
</script>

<template>
  <div class="player-config-list">
    <h4 class="section-title">Players</h4>

    <div v-for="(config, i) in configs" :key="i" class="player-row">
      <div class="player-header">
        <span class="player-label">Player {{ i + 1 }}</span>
        <label v-if="hasAI" class="ai-toggle">
          <input
            type="checkbox"
            :checked="config.isAI"
            @change="updatePlayer(i, 'isAI', ($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle-text">AI</span>
        </label>
      </div>

      <input
        type="text"
        class="player-name-input"
        :value="config.name"
        :placeholder="`Player ${i + 1}`"
        @input="updatePlayer(i, 'name', ($event.target as HTMLInputElement).value)"
      />

      <!-- AI Level dropdown -->
      <select
        v-if="config.isAI"
        class="ai-level-select"
        :value="config.aiLevel"
        @change="updatePlayer(i, 'aiLevel', ($event.target as HTMLSelectElement).value)"
      >
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
      </select>

      <!-- Custom player options -->
      <div v-if="playerOptions" class="player-options">
        <div v-for="(opt, key) in playerOptions" :key="key" class="player-option">
          <label class="player-option-label">{{ opt.label }}</label>

          <!-- Select type -->
          <select
            v-if="opt.type === 'select'"
            class="player-option-select"
            :value="getPlayerOptionValue(i, key, opt)"
            @change="updatePlayer(i, key, ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="choice in getAvailableChoices(i, key, opt)"
              :key="choice.value"
              :value="choice.value"
            >
              {{ choice.label }}
            </option>
          </select>

          <!-- Color type -->
          <div v-else-if="opt.type === 'color'" class="color-picker">
            <button
              v-for="color in getAvailableChoices(i, key, opt)"
              :key="color.value"
              class="color-swatch"
              :class="{ selected: getPlayerOptionValue(i, key, opt) === color.value }"
              :style="{ backgroundColor: color.value }"
              :title="color.label"
              @click="updatePlayer(i, key, color.value)"
            />
          </div>

          <!-- Text type -->
          <input
            v-else-if="opt.type === 'text'"
            type="text"
            class="player-option-input"
            :value="getPlayerOptionValue(i, key, opt)"
            :placeholder="opt.default"
            @input="updatePlayer(i, key, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-config-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 0.9rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.player-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.player-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.player-label {
  font-weight: 500;
  color: #fff;
}

.ai-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.ai-toggle input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.toggle-text {
  font-size: 0.85rem;
  color: #888;
}

.ai-toggle input:checked + .toggle-text {
  color: #00d9ff;
}

.player-name-input,
.ai-level-select,
.player-option-select,
.player-option-input {
  padding: 8px 12px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 0.95rem;
  transition: border-color 0.2s;
}

.player-name-input:focus,
.ai-level-select:focus,
.player-option-select:focus,
.player-option-input:focus {
  outline: none;
  border-color: #00d9ff;
}

.player-name-input::placeholder {
  color: #666;
}

.ai-level-select option,
.player-option-select option {
  background: #1a1a2e;
  color: #fff;
}

.player-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.player-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.player-option-label {
  font-size: 0.85rem;
  color: #888;
}

.color-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.selected {
  border-color: #fff;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
}
</style>

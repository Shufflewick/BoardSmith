<script setup lang="ts">
/**
 * GameOptionsForm - Dynamic form for game options
 *
 * Renders form controls based on option metadata:
 * - Number inputs with min/max/step
 * - Select dropdowns
 * - Boolean toggles
 */

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

const props = defineProps<{
  /** Option definitions from game */
  options: Record<string, GameOptionDefinition>;
  /** Current option values */
  modelValue: Record<string, unknown>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void;
}>();

function getValue(key: string, opt: GameOptionDefinition): unknown {
  return props.modelValue[key] ?? opt.default;
}

function updateOption(key: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function handleNumberInput(key: string, event: Event) {
  const target = event.target as HTMLInputElement;
  updateOption(key, Number(target.value));
}

function handleSelectChange(key: string, event: Event) {
  const target = event.target as HTMLSelectElement;
  const opt = props.options[key] as SelectOption;
  // Preserve number type if original choices used numbers
  const choice = opt.choices.find((c) => String(c.value) === target.value);
  updateOption(key, choice?.value ?? target.value);
}

function handleBooleanChange(key: string, event: Event) {
  const target = event.target as HTMLInputElement;
  updateOption(key, target.checked);
}
</script>

<template>
  <div v-if="Object.keys(options).length > 0" class="game-options-form">
    <h4 class="section-title">Game Options</h4>

    <div v-for="(opt, key) in options" :key="key" class="option-row">
      <label :for="`opt-${key}`" class="option-label">{{ opt.label }}</label>

      <!-- Number input -->
      <input
        v-if="opt.type === 'number'"
        :id="`opt-${key}`"
        type="number"
        class="option-input"
        :min="(opt as NumberOption).min"
        :max="(opt as NumberOption).max"
        :step="(opt as NumberOption).step ?? 1"
        :value="getValue(key, opt)"
        @input="handleNumberInput(key, $event)"
      />

      <!-- Select input -->
      <select
        v-else-if="opt.type === 'select'"
        :id="`opt-${key}`"
        class="option-select"
        :value="getValue(key, opt)"
        @change="handleSelectChange(key, $event)"
      >
        <option
          v-for="choice in (opt as SelectOption).choices"
          :key="String(choice.value)"
          :value="choice.value"
        >
          {{ choice.label }}
        </option>
      </select>

      <!-- Boolean toggle -->
      <label v-else-if="opt.type === 'boolean'" class="option-toggle">
        <input
          :id="`opt-${key}`"
          type="checkbox"
          :checked="getValue(key, opt) as boolean"
          @change="handleBooleanChange(key, $event)"
        />
        <span class="toggle-slider"></span>
      </label>

      <p v-if="opt.description" class="option-description">{{ opt.description }}</p>
    </div>
  </div>
</template>

<style scoped>
.game-options-form {
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

.option-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-label {
  font-weight: 500;
  color: #fff;
  font-size: 0.95rem;
}

.option-input,
.option-select {
  padding: 10px 12px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
  transition: border-color 0.2s;
}

.option-input:focus,
.option-select:focus {
  outline: none;
  border-color: #00d9ff;
}

.option-select option {
  background: #1a1a2e;
  color: #fff;
}

.option-toggle {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
}

.option-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 26px;
  transition: 0.3s;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: 0.3s;
}

.option-toggle input:checked + .toggle-slider {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
}

.option-toggle input:checked + .toggle-slider:before {
  transform: translateX(22px);
}

.option-description {
  font-size: 0.85rem;
  color: #888;
  margin: 2px 0 0;
}
</style>

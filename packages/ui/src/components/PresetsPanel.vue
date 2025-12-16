<script setup lang="ts">
/**
 * PresetsPanel - Quick game setup presets
 *
 * Displays a grid of preset cards that users can click
 * to apply predefined game options and player configurations.
 */

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

defineProps<{
  /** Available presets */
  presets: GamePreset[];
}>();

const emit = defineEmits<{
  (e: 'select', preset: GamePreset): void;
}>();
</script>

<template>
  <div v-if="presets.length > 0" class="presets-panel">
    <h4 class="section-title">Quick Start</h4>
    <div class="preset-grid">
      <button
        v-for="preset in presets"
        :key="preset.name"
        class="preset-card"
        @click="emit('select', preset)"
      >
        <span class="preset-name">{{ preset.name }}</span>
        <span v-if="preset.description" class="preset-desc">{{ preset.description }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.presets-panel {
  margin-bottom: 16px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 0.9rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  background: rgba(0, 217, 255, 0.08);
  border: 1px solid rgba(0, 217, 255, 0.2);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.preset-card:hover {
  background: rgba(0, 217, 255, 0.15);
  border-color: #00d9ff;
  transform: translateY(-2px);
}

.preset-name {
  font-weight: 500;
  color: #fff;
  font-size: 0.95rem;
}

.preset-desc {
  font-size: 0.8rem;
  color: #888;
  line-height: 1.3;
}
</style>

<script setup lang="ts">
/**
 * GameHeader - Top header bar for the game screen
 *
 * Contains the hamburger menu, game title, zoom control, game code, and connection status.
 */
import HamburgerMenu from './HamburgerMenu.vue';

const props = defineProps<{
  /** Display name for the game */
  gameTitle: string;
  /** Current game ID/code */
  gameId: string | null;
  /** Connection status */
  connectionStatus: string;
  /** Current zoom level (0.5 to 2.0, default 1.0) */
  zoom?: number;
  /** Auto-end turn after making a move (default: true) */
  autoEndTurn?: boolean;
  /** Show undo button when undo is available (default: true) */
  showUndo?: boolean;
}>();

const emit = defineEmits<{
  (e: 'menu-item-click', id: string): void;
  (e: 'update:zoom', zoom: number): void;
  (e: 'update:autoEndTurn', value: boolean): void;
  (e: 'update:showUndo', value: boolean): void;
}>();

function handleZoomChange(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value);
  emit('update:zoom', value);
}

function resetZoom() {
  emit('update:zoom', 1.0);
}

const zoomPercent = computed(() => Math.round((props.zoom ?? 1.0) * 100));

import { computed } from 'vue';
</script>

<template>
  <header class="game-header">
    <div class="header-left">
      <HamburgerMenu
        :game-title="gameTitle"
        :game-id="gameId"
        :connection-status="connectionStatus"
        @menu-item-click="(id) => emit('menu-item-click', id)"
      />
      <h1>{{ gameTitle }}</h1>
    </div>
    <div class="header-center">
      <div class="zoom-control">
        <button class="zoom-reset" @click="resetZoom" title="Reset zoom to 100%">
          {{ zoomPercent }}%
        </button>
        <input
          type="range"
          class="zoom-slider"
          min="0.5"
          max="2"
          step="0.1"
          :value="zoom ?? 1.0"
          @input="handleZoomChange"
          title="Zoom level"
        />
      </div>
      <label class="auto-end-turn-toggle" title="Automatically end turn after making a move">
        <input
          type="checkbox"
          :checked="autoEndTurn ?? true"
          @change="emit('update:autoEndTurn', ($event.target as HTMLInputElement).checked)"
        />
        <span class="toggle-label">Auto</span>
      </label>
      <label class="auto-end-turn-toggle" title="Show undo button when undo is available">
        <input
          type="checkbox"
          :checked="showUndo ?? true"
          @change="emit('update:showUndo', ($event.target as HTMLInputElement).checked)"
        />
        <span class="toggle-label">Undo</span>
      </label>
    </div>
    <div class="header-right">
      <span v-if="gameId" class="game-code">Game: <strong>{{ gameId }}</strong></span>
      <span class="connection-badge" :class="connectionStatus">{{ connectionStatus }}</span>
    </div>
  </header>
</template>

<style scoped>
.game-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  gap: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Hide game title on mobile - it's in the hamburger menu */
.game-header h1 {
  display: none;
  font-size: 1.3rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

/* Hide header-right on mobile - info is in hamburger menu */
.header-right {
  display: none;
  align-items: center;
  gap: 15px;
}

.game-code {
  font-size: 0.85rem;
  color: #aaa;
}

.game-code strong {
  color: #00d9ff;
  font-family: monospace;
}

.connection-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.connection-badge.connected { background: #27ae60; }
.connection-badge.connecting, .connection-badge.reconnecting { background: #f39c12; }
.connection-badge.disconnected, .connection-badge.error { background: #e74c3c; }

/* Zoom Control */
.header-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.1);
  padding: 4px 10px;
  border-radius: 16px;
}

.zoom-reset {
  background: none;
  border: none;
  color: #00d9ff;
  font-size: 0.75rem;
  font-weight: bold;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 42px;
  text-align: center;
}

.zoom-reset:hover {
  background: rgba(0, 217, 255, 0.2);
}

.zoom-slider {
  width: 80px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #00d9ff;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.zoom-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.zoom-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: #00d9ff;
  border-radius: 50%;
  border: none;
  cursor: pointer;
}

/* Auto End Turn Toggle */
.auto-end-turn-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.1);
  padding: 4px 10px;
  border-radius: 16px;
  cursor: pointer;
  user-select: none;
  margin-left: 8px;
}

.auto-end-turn-toggle input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 32px;
  height: 18px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 9px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}

.auto-end-turn-toggle input[type="checkbox"]::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}

.auto-end-turn-toggle input[type="checkbox"]:checked {
  background: #00d9ff;
}

.auto-end-turn-toggle input[type="checkbox"]:checked::before {
  transform: translateX(14px);
}

.toggle-label {
  font-size: 0.75rem;
  color: #aaa;
}

.auto-end-turn-toggle:hover .toggle-label {
  color: #fff;
}

/* Desktop: Show header elements */
@media (min-width: 768px) {
  .game-header {
    padding: 12px 20px;
  }

  .header-left {
    gap: 20px;
  }

  .game-header h1 {
    display: block;
  }

  .header-right {
    display: flex;
  }

  .zoom-slider {
    width: 100px;
  }
}
</style>

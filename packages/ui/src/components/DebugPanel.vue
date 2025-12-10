<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface DebugPanelProps {
  /** Current game state (raw) */
  state: any;
  /** Current player position */
  playerPosition: number;
  /** Total number of players */
  playerCount: number;
  /** Game ID */
  gameId: string | null;
  /** API base URL */
  apiUrl?: string;
  /** Whether panel is expanded */
  expanded?: boolean;
}

const props = withDefaults(defineProps<DebugPanelProps>(), {
  apiUrl: 'http://localhost:8787',
  expanded: false,
});

const emit = defineEmits<{
  'switch-player': [position: number];
  'restart-game': [];
  'update:expanded': [value: boolean];
}>();

// Local state
const isExpanded = ref(props.expanded);
const activeTab = ref<'state' | 'actions' | 'settings'>('state');
const showRawState = ref(false);

// Sync expanded state
watch(() => props.expanded, (val) => {
  isExpanded.value = val;
});

function togglePanel() {
  isExpanded.value = !isExpanded.value;
  emit('update:expanded', isExpanded.value);
}

// Format state for display
const formattedState = computed(() => {
  if (!props.state) return 'No state available';
  try {
    return JSON.stringify(props.state, null, 2);
  } catch {
    return 'Error formatting state';
  }
});

// Player switching
function switchToPlayer(position: number) {
  emit('switch-player', position);
}

// Restart game
async function restartGame() {
  if (confirm('Are you sure you want to restart the game? All progress will be lost.')) {
    emit('restart-game');
  }
}

// Copy state to clipboard
function copyState() {
  navigator.clipboard.writeText(formattedState.value);
  alert('State copied to clipboard!');
}

// Download state as JSON
function downloadState() {
  const blob = new Blob([formattedState.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game-state-${props.gameId || 'unknown'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="debug-panel" :class="{ expanded: isExpanded }">
    <!-- Toggle tab (always visible on right edge) -->
    <div class="debug-toggle" @click="togglePanel">
      <span class="toggle-icon">{{ isExpanded ? '›' : '‹' }}</span>
      <span class="toggle-label">Debug</span>
    </div>

    <!-- Drawer content -->
    <div class="debug-drawer" :class="{ open: isExpanded }">
      <div class="debug-header">
        <span class="debug-title">Debug Panel</span>
        <span class="debug-hint">(Dev Mode)</span>
        <button class="close-btn" @click="togglePanel">✕</button>
      </div>

    <!-- Expanded content -->
    <div class="debug-content">
      <!-- Tabs -->
      <div class="debug-tabs">
        <button
          :class="{ active: activeTab === 'state' }"
          @click="activeTab = 'state'"
        >
          State
        </button>
        <button
          :class="{ active: activeTab === 'actions' }"
          @click="activeTab = 'actions'"
        >
          Actions
        </button>
        <button
          :class="{ active: activeTab === 'settings' }"
          @click="activeTab = 'settings'"
        >
          Settings
        </button>
      </div>

      <!-- State Tab -->
      <div v-if="activeTab === 'state'" class="tab-content state-tab">
        <div class="state-actions">
          <button @click="copyState" class="debug-btn small">Copy</button>
          <button @click="downloadState" class="debug-btn small">Download</button>
          <label class="toggle-raw">
            <input type="checkbox" v-model="showRawState" />
            Raw JSON
          </label>
        </div>
        <div class="state-display">
          <pre v-if="showRawState">{{ formattedState }}</pre>
          <div v-else class="state-summary">
            <div class="state-item">
              <span class="label">Game ID:</span>
              <span class="value">{{ gameId || 'N/A' }}</span>
            </div>
            <div class="state-item">
              <span class="label">Phase:</span>
              <span class="value">{{ state?.state?.phase || 'N/A' }}</span>
            </div>
            <div class="state-item">
              <span class="label">Current Player:</span>
              <span class="value">{{ state?.state?.currentPlayer ?? 'N/A' }}</span>
            </div>
            <div class="state-item">
              <span class="label">Players:</span>
              <span class="value">{{ state?.state?.players?.length || 0 }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions Tab -->
      <div v-if="activeTab === 'actions'" class="tab-content actions-tab">
        <div class="action-group">
          <h4>Player Perspective</h4>
          <div class="player-buttons">
            <button
              v-for="i in playerCount"
              :key="i - 1"
              @click="switchToPlayer(i - 1)"
              :class="{ active: playerPosition === i - 1 }"
              class="debug-btn"
            >
              Player {{ i }}
            </button>
          </div>
          <p class="hint">Switch to view the game as a different player</p>
        </div>

        <div class="action-group">
          <h4>Game Controls</h4>
          <button @click="restartGame" class="debug-btn danger">
            Restart Game
          </button>
          <p class="hint">Start a new game (current progress will be lost)</p>
        </div>

        <div class="action-group">
          <h4>Time Travel</h4>
          <p class="coming-soon">Coming soon: Scrub through action history</p>
        </div>
      </div>

      <!-- Settings Tab -->
      <div v-if="activeTab === 'settings'" class="tab-content settings-tab">
        <div class="setting-group">
          <h4>Display</h4>
          <label class="setting-item">
            <input type="checkbox" v-model="showRawState" />
            Show raw JSON by default
          </label>
        </div>
        <div class="setting-group">
          <h4>Connection</h4>
          <div class="state-item">
            <span class="label">API URL:</span>
            <span class="value monospace">{{ apiUrl }}</span>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.debug-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  pointer-events: none;
}

/* Toggle tab on right edge */
.debug-toggle {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  cursor: pointer;
  background: rgba(0, 217, 255, 0.9);
  border-radius: 8px 0 0 8px;
  transition: all 0.2s;
  pointer-events: auto;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

.debug-toggle:hover {
  background: rgba(0, 217, 255, 1);
  padding-right: 10px;
}

.toggle-icon {
  font-size: 12px;
  color: #1a1a2e;
  font-weight: bold;
}

.toggle-label {
  font-weight: 600;
  color: #1a1a2e;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Drawer panel */
.debug-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 90vw;
  background: #1a1a2e;
  border-left: 2px solid #00d9ff;
  transform: translateX(100%);
  transition: transform 0.3s ease-in-out;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.debug-drawer.open {
  transform: translateX(0);
}

.debug-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(0, 217, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.debug-title {
  font-weight: 600;
  color: #fff;
}

.debug-hint {
  color: #666;
  font-size: 11px;
}

.close-btn {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
}

.close-btn:hover {
  color: #fff;
}

.debug-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.debug-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 16px 0;
  background: rgba(0, 0, 0, 0.3);
}

.debug-tabs button {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: none;
  border-radius: 6px 6px 0 0;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.debug-tabs button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.debug-tabs button.active {
  background: rgba(0, 217, 255, 0.2);
  color: #00d9ff;
}

.tab-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

/* State Tab */
.state-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.toggle-raw {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #aaa;
  font-size: 12px;
  cursor: pointer;
}

.toggle-raw input {
  cursor: pointer;
}

.state-display {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  overflow: hidden;
}

.state-display pre {
  padding: 12px;
  margin: 0;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 11px;
  color: #00ff88;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.state-summary {
  padding: 12px;
}

.state-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.state-item:last-child {
  border-bottom: none;
}

.state-item .label {
  color: #888;
}

.state-item .value {
  color: #00d9ff;
  font-weight: 500;
}

.state-item .value.monospace {
  font-family: monospace;
  font-size: 11px;
}

/* Actions Tab */
.action-group {
  margin-bottom: 20px;
}

.action-group h4 {
  color: #fff;
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

.action-group .hint {
  color: #666;
  font-size: 11px;
  margin-top: 8px;
}

.player-buttons {
  display: flex;
  gap: 8px;
}

.coming-soon {
  color: #666;
  font-style: italic;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

/* Settings Tab */
.setting-group {
  margin-bottom: 20px;
}

.setting-group h4 {
  color: #fff;
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #aaa;
  cursor: pointer;
}

/* Buttons */
.debug-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.debug-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: #00d9ff;
}

.debug-btn.active {
  background: rgba(0, 217, 255, 0.2);
  border-color: #00d9ff;
  color: #00d9ff;
}

.debug-btn.small {
  padding: 4px 10px;
  font-size: 11px;
}

.debug-btn.danger {
  border-color: #e74c3c;
  color: #e74c3c;
}

.debug-btn.danger:hover {
  background: rgba(231, 76, 60, 0.2);
}
</style>

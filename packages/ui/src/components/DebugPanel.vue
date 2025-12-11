<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

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
const panelExpanded = ref(props.expanded);
const activeTab = ref<'state' | 'actions' | 'settings'>('state');
const showRawState = ref(false);
const stateSearchQuery = ref('');
const expandedPaths = ref<Set<string>>(new Set(['root']));

// Sync expanded state
watch(() => props.expanded, (val) => {
  panelExpanded.value = val;
});

function togglePanel() {
  panelExpanded.value = !panelExpanded.value;
  emit('update:expanded', panelExpanded.value);
}

// Keyboard shortcut handler
function handleKeyDown(e: KeyboardEvent) {
  // Don't trigger if typing in an input
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  // 'D' key toggles debug panel
  if (e.key === 'd' || e.key === 'D') {
    togglePanel();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

// Format state for display
const formattedState = computed(() => {
  if (!props.state) return 'No state available';
  try {
    return JSON.stringify(props.state, null, 2);
  } catch {
    return 'Error formatting state';
  }
});

// Tree node expansion
function toggleExpand(path: string) {
  if (expandedPaths.value.has(path)) {
    expandedPaths.value.delete(path);
  } else {
    expandedPaths.value.add(path);
  }
  // Force reactivity
  expandedPaths.value = new Set(expandedPaths.value);
}

function isNodeExpanded(path: string): boolean {
  return expandedPaths.value.has(path);
}

function expandAll() {
  const paths = new Set<string>(['root']);
  function traverse(obj: any, path: string) {
    if (obj && typeof obj === 'object') {
      paths.add(path);
      for (const key in obj) {
        traverse(obj[key], `${path}.${key}`);
      }
    }
  }
  traverse(props.state, 'root');
  expandedPaths.value = paths;
}

function collapseAll() {
  expandedPaths.value = new Set(['root']);
}

// Get type color for value
function getTypeColor(value: any): string {
  if (value === null) return '#e74c3c';
  if (value === undefined) return '#95a5a6';
  if (typeof value === 'string') return '#2ecc71';
  if (typeof value === 'number') return '#3498db';
  if (typeof value === 'boolean') return '#e67e22';
  if (Array.isArray(value)) return '#9b59b6';
  if (typeof value === 'object') return '#00d9ff';
  return '#fff';
}

// Format value for display
function formatValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return `{${keys.length} keys}`;
  }
  return String(value);
}

// Check if value is expandable
function isExpandable(value: any): boolean {
  return value !== null && typeof value === 'object';
}

// Filter state based on search query
function matchesSearch(key: string, value: any, query: string): boolean {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  if (key.toLowerCase().includes(lowerQuery)) return true;
  if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) return true;
  if (typeof value === 'number' && String(value).includes(query)) return true;
  return false;
}

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
  <div class="debug-panel" :class="{ expanded: panelExpanded }">
    <!-- Toggle tab (always visible on right edge) -->
    <div class="debug-toggle" @click="togglePanel">
      <span class="toggle-icon">{{ panelExpanded ? '›' : '‹' }}</span>
      <span class="toggle-label">Debug</span>
    </div>

    <!-- Drawer content -->
    <div class="debug-drawer" :class="{ open: panelExpanded }">
      <div class="debug-header">
        <span class="debug-title">Debug Panel</span>
        <span class="debug-hint">(Press D to toggle)</span>
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
            Controls
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
            <button @click="expandAll" class="debug-btn small">Expand</button>
            <button @click="collapseAll" class="debug-btn small">Collapse</button>
            <label class="toggle-raw">
              <input type="checkbox" v-model="showRawState" />
              Raw
            </label>
          </div>

          <!-- Search box -->
          <div class="state-search">
            <input
              type="text"
              v-model="stateSearchQuery"
              placeholder="Search state..."
              class="search-input"
            />
          </div>

          <div class="state-display">
            <pre v-if="showRawState">{{ formattedState }}</pre>

            <!-- Tree View -->
            <div v-else class="state-tree">
              <!-- Recursive tree component inline -->
              <template v-if="state">
                <div class="tree-root">
                  <!-- Game info summary -->
                  <div class="tree-summary">
                    <span class="summary-item">
                      <span class="summary-label">ID:</span>
                      <span class="summary-value">{{ gameId || 'N/A' }}</span>
                    </span>
                    <span class="summary-item">
                      <span class="summary-label">Phase:</span>
                      <span class="summary-value">{{ state?.state?.phase || 'N/A' }}</span>
                    </span>
                    <span class="summary-item">
                      <span class="summary-label">Turn:</span>
                      <span class="summary-value">P{{ (state?.state?.currentPlayer ?? 0) + 1 }}</span>
                    </span>
                  </div>

                  <!-- State tree -->
                  <div class="tree-node" v-for="(value, key) in state" :key="key">
                    <div
                      class="tree-row"
                      :class="{ expandable: isExpandable(value), hidden: !matchesSearch(String(key), value, stateSearchQuery) }"
                      @click="isExpandable(value) && toggleExpand(`root.${key}`)"
                    >
                      <span v-if="isExpandable(value)" class="tree-arrow">
                        {{ isNodeExpanded(`root.${key}`) ? '▼' : '▶' }}
                      </span>
                      <span v-else class="tree-arrow-placeholder"></span>
                      <span class="tree-key">{{ key }}</span>
                      <span class="tree-separator">:</span>
                      <span class="tree-value" :style="{ color: getTypeColor(value) }">
                        {{ formatValue(value) }}
                      </span>
                    </div>

                    <!-- Nested children (1 level deep for performance) -->
                    <div v-if="isExpandable(value) && isNodeExpanded(`root.${key}`)" class="tree-children">
                      <div
                        class="tree-node"
                        v-for="(childValue, childKey) in value"
                        :key="childKey"
                      >
                        <div
                          class="tree-row"
                          :class="{ expandable: isExpandable(childValue), hidden: !matchesSearch(String(childKey), childValue, stateSearchQuery) }"
                          @click="isExpandable(childValue) && toggleExpand(`root.${key}.${childKey}`)"
                        >
                          <span v-if="isExpandable(childValue)" class="tree-arrow">
                            {{ isNodeExpanded(`root.${key}.${childKey}`) ? '▼' : '▶' }}
                          </span>
                          <span v-else class="tree-arrow-placeholder"></span>
                          <span class="tree-key">{{ childKey }}</span>
                          <span class="tree-separator">:</span>
                          <span class="tree-value" :style="{ color: getTypeColor(childValue) }">
                            {{ formatValue(childValue) }}
                          </span>
                        </div>

                        <!-- Level 3 -->
                        <div v-if="isExpandable(childValue) && isNodeExpanded(`root.${key}.${childKey}`)" class="tree-children">
                          <div
                            class="tree-node"
                            v-for="(grandchildValue, grandchildKey) in childValue"
                            :key="grandchildKey"
                          >
                            <div
                              class="tree-row"
                              :class="{ expandable: isExpandable(grandchildValue) }"
                              @click="isExpandable(grandchildValue) && toggleExpand(`root.${key}.${childKey}.${grandchildKey}`)"
                            >
                              <span v-if="isExpandable(grandchildValue)" class="tree-arrow">
                                {{ isNodeExpanded(`root.${key}.${childKey}.${grandchildKey}`) ? '▼' : '▶' }}
                              </span>
                              <span v-else class="tree-arrow-placeholder"></span>
                              <span class="tree-key">{{ grandchildKey }}</span>
                              <span class="tree-separator">:</span>
                              <span class="tree-value" :style="{ color: getTypeColor(grandchildValue) }">
                                {{ formatValue(grandchildValue) }}
                              </span>
                            </div>

                            <!-- Level 4 - show as JSON -->
                            <div v-if="isExpandable(grandchildValue) && isNodeExpanded(`root.${key}.${childKey}.${grandchildKey}`)" class="tree-children tree-json">
                              <pre>{{ JSON.stringify(grandchildValue, null, 2) }}</pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="no-state">No state available</div>
            </div>
          </div>
        </div>

        <!-- Controls Tab -->
        <div v-if="activeTab === 'actions'" class="tab-content actions-tab">
          <!-- Player Perspective -->
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

          <!-- Game Controls -->
          <div class="action-group">
            <h4>Game Controls</h4>
            <button @click="restartGame" class="debug-btn danger">
              Restart Game
            </button>
            <p class="hint">Start a new game (current progress will be lost)</p>
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
            <h4>Keyboard Shortcuts</h4>
            <div class="shortcut-list">
              <div class="shortcut-item">
                <kbd>D</kbd>
                <span>Toggle debug panel</span>
              </div>
            </div>
          </div>
          <div class="setting-group">
            <h4>Connection</h4>
            <div class="state-item">
              <span class="label">API URL:</span>
              <span class="value monospace">{{ apiUrl }}</span>
            </div>
            <div class="state-item">
              <span class="label">Game ID:</span>
              <span class="value monospace">{{ gameId || 'N/A' }}</span>
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
  width: 420px;
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
  gap: 6px;
  margin-bottom: 10px;
  align-items: center;
  flex-wrap: wrap;
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

.state-search {
  margin-bottom: 10px;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: #00d9ff;
}

.search-input::placeholder {
  color: #666;
}

.state-display {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  overflow: hidden;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
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

/* Tree View */
.state-tree {
  padding: 8px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 11px;
}

.tree-summary {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: rgba(0, 217, 255, 0.1);
  border-radius: 6px;
  margin-bottom: 12px;
}

.summary-item {
  display: flex;
  gap: 4px;
}

.summary-label {
  color: #888;
}

.summary-value {
  color: #00d9ff;
  font-weight: 500;
}

.tree-node {
  margin-left: 0;
}

.tree-children {
  margin-left: 16px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  padding-left: 8px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
  border-radius: 3px;
  cursor: default;
}

.tree-row.expandable {
  cursor: pointer;
}

.tree-row.expandable:hover {
  background: rgba(255, 255, 255, 0.05);
}

.tree-row.hidden {
  display: none;
}

.tree-arrow {
  color: #666;
  font-size: 10px;
  width: 12px;
  text-align: center;
}

.tree-arrow-placeholder {
  width: 12px;
}

.tree-key {
  color: #e0e0e0;
}

.tree-separator {
  color: #666;
}

.tree-value {
  margin-left: 4px;
}

.tree-json {
  margin-top: 4px;
}

.tree-json pre {
  margin: 0;
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  color: #00ff88;
  font-size: 10px;
  overflow-x: auto;
}

.no-state {
  color: #666;
  text-align: center;
  padding: 20px;
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

.action-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-btn {
  min-width: 100px;
}

.action-prompt {
  color: #888;
  font-size: 11px;
}

.no-actions {
  color: #666;
  font-style: italic;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.player-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #aaa;
}

.shortcut-item kbd {
  display: inline-block;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: #00d9ff;
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

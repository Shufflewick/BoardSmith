<script lang="ts">
export interface DebugPanelProps {
  /** Current game state (raw) */
  state: any;
  /** Current player seat */
  playerSeat: number;
  /** Total number of players */
  playerCount: number;
  /** Game ID (null in the dev host — kept for state-download filenames) */
  gameId: string | null;
  /** Whether panel is expanded */
  expanded?: boolean;
  /**
   * Whether the game history log has any messages. Drives the :disabled state
   * of the Copy button in the Controls tab — sourced from GameHistory.hasMessages
   * via GameShell (IN-03, DEV-06 single source of truth).
   */
  historyHasMessages?: boolean;
}
</script>

<script setup lang="ts">
/**
 * The in-game debug panel.
 *
 * This component owns the panel's chrome — which tab is showing, when a tab
 * refreshes itself, and what the reader has selected. Everything it does beyond
 * that is delegated (#41):
 *
 *  - `useDebugBridge` is the one place the `debug:*` wire protocol is spelled
 *    out. This file names no ops and builds no payloads.
 *  - `useDebugTimeline` owns the action history, time travel and rewind.
 *  - `useDeckWorkbench` owns the deck edits and the transfer dialog.
 *  - `useStateTree` owns which rows of the State tab are open.
 *  - `debug-view-tree` derives the Elements and Decks tabs from the view tree.
 *  - `debug-format` renders values, and is shared with `TreeNode`.
 *
 * Each of those is tested on its own; `DebugPanel.characterization.test.ts`
 * pins the behaviour they add up to.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { TreeNode } from './debug/TreeNode.js';
import { searchStateTree } from './debug/state-tree-search.js';
import {
  formatState,
  formatConditionValue,
  formatActionName,
  formatActionArgs,
  formatTimestamp,
} from './debug/debug-format.js';
import {
  groupElementsByClass,
  discoverDecks,
  discoverCardContainers,
  filterElementGroups,
  filterDecks,
  decksExpandedBySearch,
  cardMatchesSearch,
  getElementDisplayName,
  getCardDisplayName,
  type GroupedElement,
  type DeckInfo,
} from './debug/debug-view-tree.js';
import DebugButton from './debug/DebugButton.vue';
import DebugDialog from './debug/DebugDialog.vue';
import DecksTab from './debug/DecksTab.vue';
import ElementsTab from './debug/ElementsTab.vue';
import ActionsTab from './debug/ActionsTab.vue';
import HistoryTab from './debug/HistoryTab.vue';
import LogsTab from './debug/LogsTab.vue';
import ControlsTab from './debug/ControlsTab.vue';
import StateTab from './debug/StateTab.vue';
import DebugSearchInput from './debug/DebugSearchInput.vue';
import { useDebugBridge, type ActionTrace, type FlowContext, type FlowStateInfo, type LogEntry, type ElementDiff } from '../composables/useDebugBridge.js';
import { useDebugTimeline } from '../composables/useDebugTimeline.js';
import { useDeckWorkbench } from '../composables/useDeckWorkbench.js';
import { useStateTree } from '../composables/useStateTree.js';

const props = withDefaults(defineProps<DebugPanelProps>(), {
  expanded: false,
  historyHasMessages: false,
});

const emit = defineEmits<{
  'switch-player': [position: number];
  'restart-game': [];
  'update:expanded': [value: boolean];
  'time-travel': [state: any | null, actionIndex: number | null, diff: ElementDiff | null];
  'highlight-element': [elementId: number | null];
  'copy-history': [];
  'clear-history': [];
}>();

// All debug data/edits flow through the host bridge that GameShell provides in
// platform mode (the dev host answers from its in-process session). There is no
// debug HTTP server, so this is the only transport.
const bridge = useDebugBridge();

// How stale a tab's data may be before re-entering it refetches. Switching back
// and forth must not hammer the host.
const TAB_REFRESH_MAX_AGE_MS = 2000;

// ── Panel chrome ────────────────────────────────────────────────────────────

const panelExpanded = ref(props.expanded);

// Tab descriptor for ARIA pattern — order matters for arrow-key navigation
const DEBUG_TABS = [
  { id: 'state' as const, label: 'State' },
  { id: 'elements' as const, label: 'Elements' },
  { id: 'decks' as const, label: 'Decks' },
  { id: 'actions' as const, label: 'Actions' },
  { id: 'history' as const, label: 'History' },
  { id: 'logs' as const, label: 'Logs' },
  { id: 'controls' as const, label: 'Controls' },
] as const;
type TabId = typeof DEBUG_TABS[number]['id'];
const activeTab = ref<TabId>('state');

watch(() => props.expanded, (val) => {
  panelExpanded.value = val;
});

function togglePanel() {
  panelExpanded.value = !panelExpanded.value;
  emit('update:expanded', panelExpanded.value);
}

// Keyboard shortcut handler — requires Ctrl/Cmd modifier; skips form fields
function handleKeyDown(e: KeyboardEvent) {
  // Don't trigger when typing inside form controls or contenteditable elements
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLSelectElement ||
    (e.target instanceof HTMLElement && e.target.isContentEditable)
  ) {
    return;
  }
  // Ctrl+D or Cmd+D toggles the debug panel; suppress the browser bookmark dialog
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    togglePanel();
  }
}

// Arrow-key / Home / End navigation within the tablist
function handleTabKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();

  const ids = DEBUG_TABS.map(t => t.id);
  const currentIndex = ids.indexOf(activeTab.value);

  let nextIndex: number;
  if (e.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % ids.length;
  } else if (e.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + ids.length) % ids.length;
  } else if (e.key === 'Home') {
    nextIndex = 0;
  } else {
    nextIndex = ids.length - 1;
  }

  activeTab.value = ids[nextIndex] as TabId;
  nextTick(() => {
    const el = document.getElementById(`debug-tab-${activeTab.value}`);
    el?.focus();
  });
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  // Clear the restart-confirm timer if the component unmounts while the 5-second
  // window is open (e.g. page transition), so the callback never writes to dead refs.
  if (restartConfirmTimer !== null) {
    clearTimeout(restartConfirmTimer);
    restartConfirmTimer = null;
  }
});

// ── Time travel, history and rewind ─────────────────────────────────────────

const playerSeat = computed(() => props.playerSeat);

const {
  actionHistory,
  historyLoading,
  historyError,
  fetchHistory,
  refreshHistoryIfStale,
  selectedActionIndex,
  historicalState,
  historicalStateLoading,
  historicalStateError,
  stateDiff,
  isViewingHistory,
  selectAction,
  fetchStateAtAction,
  clearHistoricalState,
  pendingRewindIndex,
  pendingRewindDiscardCount,
  rewindLoading,
  rewindError,
  requestRewind,
  cancelRewind,
  confirmRewind,
} = useDebugTimeline({
  bridge,
  playerSeat,
  onTimeTravel: (state, actionIndex, diff) => emit('time-travel', state, actionIndex, diff),
});

/**
 * The state every tab reads from: the historical snapshot while time
 * travelling, the live props otherwise.
 *
 * `props.state` is `{ state: PlayerGameState, flowState: FlowState }`, while a
 * historical snapshot is a bare `PlayerGameState`, so it is wrapped to match.
 */
const displayedState = computed(() => {
  if (isViewingHistory.value && historicalState.value) {
    return { state: historicalState.value, flowState: null };
  }
  return props.state;
});

/** The player view tree every derivation below walks. */
const displayedView = computed(() => (displayedState.value as { state?: { view?: unknown } } | null)?.state?.view);

// ── State tab ───────────────────────────────────────────────────────────────

const showRawState = ref(false);
const stateSearchQuery = ref('');

const { expandedPaths, toggleExpand, expandAll: expandTreePaths, collapseAll } = useStateTree();

/** Which rows the State tab's search box leaves standing, and what to open. */
const stateSearch = computed(() => searchStateTree(displayedState.value, stateSearchQuery.value));

/**
 * The paths the tree renders as open: what the reader opened, plus whatever the
 * running search had to open to put its matches on screen. Merged rather than
 * replaced, so clearing the box returns the reader to the tree they had.
 */
const treeExpandedPaths = computed(
  () => new Set([...expandedPaths.value, ...stateSearch.value.expandedPaths])
);

/** True once the reader has typed a term that matches no row at all. */
const stateSearchFoundNothing = computed(
  () => stateSearchQuery.value.trim().length > 0 && stateSearch.value.matchCount === 0
);

/** Open every path in the LIVE state, which is what the tree is keyed against. */
function expandAll() {
  expandTreePaths(props.state);
}

const formattedState = computed(() => formatState(props.state));

// Copy toast state
const copyToastVisible = ref(false);
const copyToastTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

/** Copy any value to the clipboard as JSON, and say so briefly. */
async function copyNodeToClipboard(value: unknown) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    if (copyToastTimeout.value) clearTimeout(copyToastTimeout.value);
    copyToastVisible.value = true;
    copyToastTimeout.value = setTimeout(() => {
      copyToastVisible.value = false;
    }, 1500);
  } catch (e) {
    console.error('Failed to copy to clipboard:', e);
  }
}

function copyState() {
  navigator.clipboard.writeText(formattedState.value);
}

function downloadState() {
  const blob = new Blob([formattedState.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game-state-${props.gameId || 'unknown'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Actions tab ─────────────────────────────────────────────────────────────

const actionTraces = ref<ActionTrace[]>([]);
const tracesLoading = ref(false);
const tracesError = ref<string | null>(null);
const tracesLastFetched = ref(0);
const flowContext = ref<FlowContext | null>(null);
const flowStateInfo = ref<FlowStateInfo | null>(null);

async function fetchActionTraces() {
  if (tracesLoading.value) return;

  tracesLoading.value = true;
  tracesError.value = null;
  try {
    const { traces, flowContext: context } = await bridge.actionTraces(props.playerSeat);
    actionTraces.value = traces;
    flowContext.value = context;
    tracesLastFetched.value = Date.now();
  } catch (e) {
    tracesError.value = e instanceof Error ? e.message : 'Unknown error';
  } finally {
    tracesLoading.value = false;
  }
}

/**
 * Where the flow currently stands. A host that cannot say is not an error worth
 * showing — the Actions tab simply omits the section.
 */
async function fetchFlowState() {
  try {
    flowStateInfo.value = await bridge.flowState(props.playerSeat);
  } catch {
    flowStateInfo.value = null;
  }
}

/** Actions that pass their conditions but that the flow will not accept. */
const flowRestrictedActions = computed(() => {
  if (!flowContext.value) return [];
  const flowAllowed = new Set(flowContext.value.flowAllowedActions);
  return actionTraces.value
    .filter(t => t.available && !flowAllowed.has(t.actionName))
    .sort((a, b) => a.actionName.localeCompare(b.actionName));
});

/** Actions that pass their conditions AND that the flow will accept. */
const trulyAvailableActions = computed(() => {
  const flowAllowed = flowContext.value ? new Set(flowContext.value.flowAllowedActions) : null;
  return actionTraces.value
    .filter(t => t.available && (flowAllowed === null || flowAllowed.has(t.actionName)))
    .sort((a, b) => a.actionName.localeCompare(b.actionName));
});

/** Actions that fail their own conditions. */
const conditionFailedActions = computed(() =>
  actionTraces.value
    .filter(t => !t.available)
    .sort((a, b) => a.actionName.localeCompare(b.actionName))
);

async function copyAvailableActions() {
  await copyNodeToClipboard(actionTraces.value.filter(t => t.available));
}

async function copyUnavailableActions() {
  await copyNodeToClipboard(actionTraces.value.filter(t => !t.available));
}

// ── Logs tab (ERR-04) ───────────────────────────────────────────────────────

const logEntries = ref<LogEntry[]>([]);
const logsLoading = ref(false);
const logsError = ref<string | null>(null);
const logsLastFetched = ref(0);

async function fetchLogs() {
  if (logsLoading.value) return;

  logsLoading.value = true;
  logsError.value = null;
  try {
    logEntries.value = await bridge.logs();
    logsLastFetched.value = Date.now();
  } catch (e) {
    logsError.value = e instanceof Error ? e.message : 'Unknown error';
  } finally {
    logsLoading.value = false;
  }
}

// ── Tab-driven refreshing ───────────────────────────────────────────────────
// Entering a tab loads it, unless it was loaded moments ago; a new game state
// reloads whichever tab is showing, because that state is what it describes.

watch(activeTab, (tab) => {
  if (!props.gameId) return;
  if (tab === 'actions' && Date.now() - tracesLastFetched.value > TAB_REFRESH_MAX_AGE_MS) {
    fetchActionTraces();
    fetchFlowState();
  }
  if (tab === 'history') {
    refreshHistoryIfStale(TAB_REFRESH_MAX_AGE_MS);
  }
  if (tab === 'logs' && Date.now() - logsLastFetched.value > TAB_REFRESH_MAX_AGE_MS) {
    fetchLogs();
  }
});

watch(() => props.state, () => {
  if (activeTab.value === 'actions') {
    fetchActionTraces();
    fetchFlowState();
  }
  if (activeTab.value === 'history') fetchHistory();
  if (activeTab.value === 'logs') fetchLogs();
}, { deep: false });

/**
 * How many decks the view holds, for the Decks tab's badge.
 *
 * The tab discovers its own decks; this is the one fact about them the CHROME
 * needs, and reading it here keeps the badge from depending on a tab that is
 * not mounted yet.
 */
const deckCount = computed(() => discoverDecks(displayedView.value).length);

/** Whatever extra the game itself chose to publish for debugging. */
const customDebugData = computed(
  () => (displayedState.value as { state?: { customDebug?: unknown } } | null)?.state?.customDebug ?? null
);

// ── Controls tab ────────────────────────────────────────────────────────────

function switchToPlayer(position: number) {
  emit('switch-player', position);
}

// Restart confirm state (two-click guard — prevents single-click data loss)
const restartConfirming = ref(false);
// Plain let — no reactive consumers read the timer ID; a ref would track
// reads/writes unnecessarily (matches DevHost.vue's pattern for the same).
let restartConfirmTimer: ReturnType<typeof setTimeout> | null = null;

/** Restart the game — first click arms, second fires, five seconds disarms. */
function handleRestartClick() {
  if (!restartConfirming.value) {
    restartConfirming.value = true;
    restartConfirmTimer = setTimeout(() => {
      restartConfirming.value = false;
      restartConfirmTimer = null;
    }, 5000);
    return;
  }

  if (restartConfirmTimer) {
    clearTimeout(restartConfirmTimer);
    restartConfirmTimer = null;
  }
  restartConfirming.value = false;
  emit('restart-game');
}
</script>


<template>
  <div class="debug-panel" :class="{ expanded: panelExpanded }">
    <!-- Opened from the Dev header (DevHost chrome) or Ctrl/Cmd+D; closed via the
         header toggle, the in-panel ✕, or Ctrl/Cmd+D. No floating edge tab. -->

    <!-- Drawer content -->
    <div class="debug-drawer" :class="{ open: panelExpanded }">
      <div class="debug-header">
        <span class="debug-title">Debug Panel</span>
        <span class="debug-hint">(Ctrl/Cmd+D to toggle)</span>
        <button class="close-btn" @click="togglePanel" aria-label="Close debug panel">
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <!-- Expanded content -->
      <div class="debug-content">
        <!-- Tabs — ARIA tablist pattern -->
        <div class="debug-tabs" role="tablist" aria-label="Debug sections">
          <button
            v-for="tab in DEBUG_TABS"
            :key="tab.id"
            role="tab"
            :id="`debug-tab-${tab.id}`"
            :aria-selected="activeTab === tab.id"
            :aria-controls="`debug-panel-${tab.id}`"
            :tabindex="activeTab === tab.id ? 0 : -1"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
            @keydown="handleTabKeydown"
          >
            {{ tab.label }}
            <span v-if="tab.id === 'decks' && deckCount > 0" class="tab-badge">{{ deckCount }}</span>
          </button>
        </div>

        <!-- State Tab -->
        <StateTab
          v-show="activeTab === 'state'"
          :displayed-state="displayedState"
          :formatted-state="formattedState"
          v-model:show-raw-state="showRawState"
          v-model:state-search-query="stateSearchQuery"
          :visible-paths="stateSearch.visiblePaths"
          :state-search-found-nothing="stateSearchFoundNothing"
          :tree-expanded-paths="treeExpandedPaths"
          :is-viewing-history="isViewingHistory"
          :selected-action-index="selectedActionIndex"
          :historical-state-loading="historicalStateLoading"
          :historical-state-error="historicalStateError"
          :game-id="props.gameId ?? null"
          @back-to-live="clearHistoricalState"
          @copy="copyState"
          @download="downloadState"
          @expand-all="expandAll"
          @collapse-all="collapseAll"
          @toggle-path="toggleExpand($event)"
          @copy-node="copyNodeToClipboard($event)"
        />

        <!-- Elements Tab -->
        <ElementsTab
          v-show="activeTab === 'elements'"
          :view="displayedView"
          :custom-debug-data="customDebugData"
          :copy="copyNodeToClipboard"
          @highlight-element="emit('highlight-element', $event)"
        />

        <!-- Decks Tab -->
        <DecksTab
          v-show="activeTab === 'decks'"
          :view="displayedView"
          :copy="copyNodeToClipboard"
        />

        <!-- Actions Tab -->
        <ActionsTab
          v-show="activeTab === 'actions'"
          :action-traces="actionTraces"
          :traces-loading="tracesLoading"
          :traces-error="tracesError"
          :flow-context="flowContext"
          :flow-state-info="flowStateInfo"
          :truly-available-actions="trulyAvailableActions"
          :flow-restricted-actions="flowRestrictedActions"
          :condition-failed-actions="conditionFailedActions"
          @refresh="fetchActionTraces(); fetchFlowState()"
          @copy-available="copyAvailableActions"
          @copy-unavailable="copyUnavailableActions"
        />

        <!-- History Tab -->
        <HistoryTab
          v-show="activeTab === 'history'"
          :action-history="actionHistory"
          :history-loading="historyLoading"
          :history-error="historyError"
          :selected-action-index="selectedActionIndex"
          :is-viewing-history="isViewingHistory"
          :pending-rewind-index="pendingRewindIndex"
          :pending-rewind-discard-count="pendingRewindDiscardCount"
          :rewind-loading="rewindLoading"
          :rewind-error="rewindError"
          :history-has-messages="props.historyHasMessages"
          @refresh="fetchHistory"
          @select-action="selectAction($event)"
          @back-to-live="clearHistoricalState"
          @rewind="$event !== null && requestRewind($event)"
          @confirm-rewind="confirmRewind"
          @cancel-rewind="cancelRewind"
          @copy-history="emit('copy-history')"
          @clear-history="emit('clear-history')"
        />

        <!-- Logs Tab (ERR-04) -->
        <LogsTab
          v-show="activeTab === 'logs'"
          :log-entries="logEntries"
          :logs-loading="logsLoading"
          :logs-error="logsError"
          @refresh="fetchLogs"
        />

        <!-- Controls Tab -->
        <ControlsTab
          v-show="activeTab === 'controls'"
          :player-seat="props.playerSeat"
          :player-count="props.playerCount"
          :restart-confirming="restartConfirming"
          :history-has-messages="props.historyHasMessages"
          v-model:show-raw-state="showRawState"
          @switch-player="switchToPlayer($event)"
          @restart-click="handleRestartClick"
          @copy-history="emit('copy-history')"
          @clear-history="emit('clear-history')"
        />

      </div>
    </div>

    <!-- Copy toast notification -->
    <Transition name="toast">
      <div v-if="copyToastVisible" class="copy-toast">
        Copied to clipboard
      </div>
    </Transition>
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
/* Drawer panel */
.debug-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 90vw;
  background: var(--bsg-surface);
  border-left: 1px solid var(--bsg-line);
  transform: translateX(100%);
  transition: transform 0.3s ease-in-out;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.debug-drawer.open {
  transform: translateX(0);
}

/* Phone bottom-sheet — slides up from the bottom on narrow viewports */
@media (max-width: 639px) {
  .debug-drawer {
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    width: 100%;
    max-width: 100%;
    height: 60dvh;
    border-radius: var(--bsg-r-sm) var(--bsg-r-sm) 0 0;
    border-left: none;
    border-top: 1px solid var(--bsg-line);
    transform: translateY(100%);
  }

  .debug-drawer.open {
    transform: translateY(0);
  }
}

.debug-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
  border-bottom: 1px solid var(--bsg-line);
}

.debug-title {
  font-weight: 600;
  color: var(--bsg-ink);
}

.debug-hint {
  color: var(--bsg-ink-3);
  font-size: 11px;
}

.close-btn {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--bsg-ink-2);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
}

.close-btn:hover {
  color: var(--bsg-ink);
}

.debug-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.debug-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px 16px 0;
  background: var(--bsg-surface-3);
}

.debug-tabs button {
  padding: 8px 16px;
  background: var(--bsg-surface-2);
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  color: var(--bsg-ink-3);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.debug-tabs button:hover {
  background: var(--bsg-surface-3);
  color: var(--bsg-ink);
}

.debug-tabs button.active,
.debug-tabs button[aria-selected="true"] {
  background: color-mix(in srgb, var(--bsg-accent) 10%, transparent);
  color: var(--bsg-ink);
  border-bottom-color: var(--bsg-accent);
}

.tab-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}















.tree-node {
  margin-left: 0;
}

.tree-children {
  margin-left: 16px;
  border-left: 1px solid var(--bsg-line);
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
  background: var(--bsg-surface-2);
}

.tree-row.hidden {
  display: none;
}

.tree-arrow {
  color: var(--bsg-ink-3);
  font-size: 10px;
  width: 12px;
  text-align: center;
}

.tree-arrow-placeholder {
  width: 12px;
}

.tree-key {
  color: var(--bsg-ink);
}

.tree-separator {
  color: var(--bsg-ink-3);
}

.tree-value {
  margin-left: 4px;
}

.tree-copy-btn {
  opacity: 0;
  margin-left: auto;
  padding: 2px 6px;
  font-size: 10px;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: 3px;
  color: var(--bsg-ink-2);
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}

.tree-row:hover .tree-copy-btn {
  opacity: 1;
}

.tree-copy-btn:hover {
  background: var(--bsg-line-2);
  color: var(--bsg-ink);
}

.tree-json {
  margin-top: 4px;
}

.tree-json pre {
  margin: 0;
  padding: 8px;
  background: var(--bsg-surface-3);
  border-radius: 4px;
  color: var(--bsg-ok);
  font-size: 10px;
  overflow-x: auto;
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
  color: var(--bsg-ink-2);
  font-size: 11px;
}

.no-actions {
  color: var(--bsg-ink-3);
  font-style: italic;
  padding: 12px;
  background: var(--bsg-surface-2);
  border-radius: 6px;
}


/* Settings Tab */
.setting-group {
  margin-bottom: 20px;
}

.setting-group h4 {
  color: var(--bsg-ink);
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
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
  color: var(--bsg-ink-2);
}

.shortcut-item kbd,







/* Buttons */






/* Two-click restart confirming state — danger outline, no fill */
.debug-btn.restart-confirming {
  border-color: var(--bsg-danger);
  color: var(--bsg-danger);
  animation: restart-pulse 1s ease-in-out infinite alternate;
}

.debug-btn.restart-confirming:hover {
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
}

@keyframes restart-pulse {
  from { opacity: 1; }
  to { opacity: 0.7; }
}







.history-loading,





























































































































/* Copy toast */
.copy-toast {
  position: absolute;
  bottom: 60px;
  right: 20px;
  padding: 8px 16px;
  background: var(--bsg-accent-2);
  color: var(--bsg-accent-ink);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  z-index: 1000;
  pointer-events: none;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* Tab badge */
.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  margin-left: 4px;
  font-size: 10px;
  font-weight: 600;
  background: color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
  color: var(--bsg-accent-2);
  border-radius: 8px;
}





































/* Transfer dialog */






/* Confirmation copy (the rewind dialog): the body's own gap does the spacing. */



















</style>

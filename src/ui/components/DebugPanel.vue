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

// ── Elements tab ────────────────────────────────────────────────────────────

const selectedElementId = ref<number | null>(null);
const elementSearchQuery = ref('');
const expandedElementGroups = ref<Set<string>>(new Set());

const groupedElements = computed(() => groupElementsByClass(displayedView.value));

const filteredElementGroups = computed(() =>
  filterElementGroups(groupedElements.value, elementSearchQuery.value)
);

const selectedElement = computed<GroupedElement | null>(() => {
  if (selectedElementId.value === null) return null;
  for (const elements of Object.values(groupedElements.value)) {
    const found = elements.find(el => el.id === selectedElementId.value);
    if (found) return found;
  }
  return null;
});

function toggleElementGroup(className: string) {
  const next = new Set(expandedElementGroups.value);
  if (next.has(className)) next.delete(className);
  else next.add(className);
  expandedElementGroups.value = next;
}

/** Select an element and highlight it on the board; selecting it again clears. */
function selectElement(element: GroupedElement) {
  const next = selectedElementId.value === element.id ? null : element.id;
  selectedElementId.value = next;
  emit('highlight-element', next);
}

async function copyElementToClipboard(element: GroupedElement) {
  await copyNodeToClipboard(element.fullObject);
}

/** Whatever extra the game itself chose to publish for debugging. */
const customDebugData = computed(
  () => (displayedState.value as { state?: { customDebug?: unknown } } | null)?.state?.customDebug ?? null
);

// ── Decks tab ───────────────────────────────────────────────────────────────

const deckSearchQuery = ref('');
const expandedDecks = ref<Set<number>>(new Set());
const selectedDeckCard = ref<{ deckId: number; cardId: number } | null>(null);

const discoveredDecks = computed(() => discoverDecks(displayedView.value));
const discoveredCardContainers = computed(() => discoverCardContainers(displayedView.value));

const filteredDecks = computed(() => filterDecks(discoveredDecks.value, deckSearchQuery.value));

/** Decks the search pulled open on its own, because the match is on a card. */
const searchExpandedDecks = computed(() =>
  decksExpandedBySearch(filteredDecks.value, deckSearchQuery.value)
);

function isDeckExpanded(deckId: number): boolean {
  return expandedDecks.value.has(deckId) || searchExpandedDecks.value.has(deckId);
}

function toggleDeck(deckId: number) {
  const next = new Set(expandedDecks.value);
  if (next.has(deckId)) next.delete(deckId);
  else next.add(deckId);
  expandedDecks.value = next;
}

function selectDeckCard(deckId: number, cardId: number) {
  const isSelected = selectedDeckCard.value?.deckId === deckId
    && selectedDeckCard.value?.cardId === cardId;
  selectedDeckCard.value = isSelected ? null : { deckId, cardId };
}

const selectedCard = computed(() => {
  const selection = selectedDeckCard.value;
  if (!selection) return null;
  const deck = discoveredDecks.value.find(d => d.id === selection.deckId);
  return deck?.cards.find(c => c.id === selection.cardId) ?? null;
});

async function copyDeckToClipboard(deck: DeckInfo) {
  await copyNodeToClipboard({
    ...deck.fullObject,
    cards: deck.cards.map(c => c.fullObject),
  });
}

const {
  deckManipulationLoading,
  deckManipulationError,
  moveCardToTop,
  reorderCard,
  transferCard,
  shuffleDeck,
  moveCardUp,
  moveCardDown,
  transferDialogOpen,
  transferDialogCardId,
  transferDialogSourceDeckId,
  transferDialogTargetDeckId,
  transferDialogPosition,
  availableTargetContainers,
  openTransferDialog,
  closeTransferDialog,
  confirmTransfer,
} = useDeckWorkbench({ bridge, cardContainers: discoveredCardContainers });

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
            <span v-if="tab.id === 'decks' && discoveredDecks.length > 0" class="tab-badge">{{ discoveredDecks.length }}</span>
          </button>
        </div>

        <!-- State Tab -->
        <div
          v-show="activeTab === 'state'"
          id="debug-panel-state"
          role="tabpanel"
          aria-labelledby="debug-tab-state"
          class="tab-content state-tab"
        >
          <!-- Historical state banner -->
          <div v-if="isViewingHistory" class="historical-banner">
            <span class="historical-icon">&#9200;</span>
            <span>Viewing state after action {{ selectedActionIndex }}</span>
            <button class="debug-btn small" @click="clearHistoricalState">Back to Live</button>
          </div>

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

          <!--
            A time-travel read that is still running, or that failed. Without
            these the panel falls back to the LIVE state while `isViewingHistory`
            is still true, and shows it inside the historical border: the reader
            cannot tell a failed read from a state that genuinely looks that way.
          -->
          <div v-if="historicalStateLoading" class="historical-state-loading">
            Reading the state after action {{ selectedActionIndex }}&hellip;
          </div>
          <div v-else-if="historicalStateError" class="historical-state-error" role="alert">
            <strong>Could not read the state after action {{ selectedActionIndex }}.</strong>
            <span class="historical-state-reason">{{ historicalStateError }}</span>
            <span>
              Pick a more recent action, or press Back to Live to return to the current state.
            </span>
          </div>

          <div
            v-else
            class="state-display"
            :class="{ historical: isViewingHistory }"
          >
            <pre v-if="showRawState">{{ formattedState }}</pre>

            <!-- Tree View -->
            <div v-else class="state-tree">
              <!-- Recursive tree component inline -->
              <template v-if="displayedState">
                <div class="tree-root">
                  <!-- Game info summary -->
                  <div class="tree-summary" :class="{ historical: isViewingHistory }">
                    <span class="summary-item">
                      <span class="summary-label">ID:</span>
                      <span class="summary-value">{{ gameId || 'N/A' }}</span>
                    </span>
                    <span class="summary-item">
                      <span class="summary-label">Phase:</span>
                      <span class="summary-value">{{ displayedState?.state?.phase || 'N/A' }}</span>
                    </span>
                    <!-- Whose turn it is is already shown in the players panel; no need to repeat it here. -->
                  </div>

                  <!-- State tree (recursive component) -->
                  <TreeNode
                    v-for="(value, key) in displayedState"
                    :key="key"
                    :node-key="String(key)"
                    :value="value"
                    :path="`root.${key}`"
                    :depth="0"
                    :expanded-paths="treeExpandedPaths"
                    :visible-paths="stateSearch.visiblePaths"
                    @toggle="toggleExpand"
                    @copy="copyNodeToClipboard"
                  />

                  <div v-if="stateSearchFoundNothing" class="state-search-empty">
                    No part of the state matches &ldquo;{{ stateSearchQuery }}&rdquo;. The search
                    reads property names and leaf values.
                  </div>
                </div>
              </template>
              <div v-else class="no-state">No state available</div>
            </div>
          </div>
        </div>

        <!-- Elements Tab -->
        <div
          v-show="activeTab === 'elements'"
          id="debug-panel-elements"
          role="tabpanel"
          aria-labelledby="debug-tab-elements"
          class="tab-content elements-tab"
        >
          <!-- Search -->
          <div class="element-search">
            <input
              type="text"
              v-model="elementSearchQuery"
              placeholder="Search elements..."
              class="search-input"
            />
          </div>

          <!-- Split View: List + Details -->
          <div class="elements-split-view" :class="{ 'has-selection': selectedElement }">
            <!-- Element List -->
            <div class="elements-list-panel">
              <div v-if="Object.keys(filteredElementGroups).length === 0" class="no-elements">
                No elements found
              </div>

              <div v-else class="element-groups">
                <div
                  v-for="(elements, className) in filteredElementGroups"
                  :key="className"
                  class="element-group"
                >
                  <div
                    class="element-group-header"
                    @click="toggleElementGroup(className)"
                  >
                    <span class="group-arrow">
                      {{ expandedElementGroups.has(className) ? '▼' : '▶' }}
                    </span>
                    <span class="group-name">{{ className }}</span>
                    <span class="group-count">[{{ elements.length }}]</span>
                  </div>

                  <div v-if="expandedElementGroups.has(className)" class="element-list">
                    <div
                      v-for="element in elements"
                      :key="element.id"
                      class="element-item"
                      :class="{ selected: selectedElementId === element.id }"
                      @click="selectElement(element)"
                    >
                      <span class="element-name">{{ getElementDisplayName(element) }}</span>
                      <span class="element-id">#{{ element.id }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Element Detail Panel -->
            <div v-if="selectedElement" class="element-detail-panel">
              <div class="element-detail-header">
                <span class="element-detail-title">
                  {{ selectedElement.className }} #{{ selectedElement.id }}
                </span>
                <div class="element-detail-actions">
                  <button
                    @click="copyElementToClipboard(selectedElement)"
                    class="debug-btn small"
                    title="Copy JSON"
                  >
                    Copy
                  </button>
                  <button
                    @click="selectedElementId = null; emit('highlight-element', null)"
                    class="debug-btn small"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div class="element-detail-content">
                <pre class="element-json">{{ JSON.stringify(selectedElement.fullObject, null, 2) }}</pre>
              </div>
            </div>
          </div>

          <!-- Custom Debug Section -->
          <div v-if="customDebugData" class="custom-debug-section">
            <h4 class="section-title">Custom Debug</h4>
            <div class="custom-debug-content">
              <div
                v-for="(value, key) in customDebugData"
                :key="key"
                class="custom-debug-item"
              >
                <div class="custom-debug-key">
                  <span>{{ key }}</span>
                  <button
                    class="debug-btn small custom-debug-copy"
                    @click="copyNodeToClipboard(value)"
                    title="Copy JSON"
                  >
                    Copy
                  </button>
                </div>
                <pre class="custom-debug-value">{{ JSON.stringify(value, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Decks Tab -->
        <div
          v-show="activeTab === 'decks'"
          id="debug-panel-decks"
          role="tabpanel"
          aria-labelledby="debug-tab-decks"
          class="tab-content decks-tab"
        >
          <!-- Search -->
          <div class="deck-search">
            <input
              type="text"
              v-model="deckSearchQuery"
              placeholder="Search decks or cards..."
              class="search-input"
            />
          </div>

          <!-- Error message -->
          <div v-if="deckManipulationError" class="deck-error">
            {{ deckManipulationError }}
            <button class="debug-btn small" @click="deckManipulationError = null">Dismiss</button>
          </div>

          <!-- No decks found -->
          <div v-if="filteredDecks.length === 0" class="no-decks">
            <template v-if="discoveredDecks.length === 0">
              No deck elements found in game state.
              <div class="deck-hint">
                Decks are elements with <code>$type: 'deck'</code> or className containing "Deck".
              </div>
            </template>
            <template v-else>
              No decks match your search.
            </template>
          </div>

          <!-- Decks list with split view -->
          <div v-else class="decks-split-view" :class="{ 'has-selection': selectedCard }">
            <!-- Deck List Panel -->
            <div class="decks-list-panel">
              <div
                v-for="deck in filteredDecks"
                :key="deck.id"
                class="deck-item"
              >
                <div
                  class="deck-header"
                  @click="toggleDeck(deck.id)"
                >
                  <span class="deck-arrow">
                    {{ isDeckExpanded(deck.id) ? '▼' : '▶' }}
                  </span>
                  <span class="deck-name">{{ deck.name }}</span>
                  <span class="deck-count">[{{ deck.cards.length }} cards]</span>
                  <div class="deck-actions" @click.stop>
                    <button
                      class="debug-btn small deck-action-btn"
                      @click="shuffleDeck(deck.id)"
                      :disabled="deckManipulationLoading"
                      title="Shuffle deck"
                      aria-label="Shuffle deck"
                    >
                      <span aria-hidden="true">🔀</span>
                    </button>
                    <button
                      class="debug-btn small deck-action-btn"
                      @click="copyDeckToClipboard(deck)"
                      title="Copy deck JSON"
                      aria-label="Copy deck JSON"
                    >
                      <span aria-hidden="true">📋</span>
                    </button>
                  </div>
                </div>

                <!-- Expanded card list -->
                <div v-if="isDeckExpanded(deck.id)" class="deck-cards">
                  <div v-if="deck.cards.length === 0" class="deck-empty">
                    Deck is empty
                  </div>
                  <div
                    v-for="(card, index) in deck.cards"
                    :key="card.id"
                    class="card-item"
                    :class="{
                      selected: selectedDeckCard?.deckId === deck.id && selectedDeckCard?.cardId === card.id,
                      'search-match': deckSearchQuery && cardMatchesSearch(card, deckSearchQuery)
                    }"
                    @click="selectDeckCard(deck.id, card.id)"
                  >
                    <span class="card-position">{{ index }}</span>
                    <span class="card-name">{{ getCardDisplayName(card) }}</span>
                    <span class="card-class">{{ card.className }}</span>
                    <span class="card-id">#{{ card.id }}</span>
                    <div class="card-actions" @click.stop>
                      <button
                        class="card-action-btn"
                        @click="moveCardToTop(card.id)"
                        :disabled="index === 0 || deckManipulationLoading"
                        title="Move to top"
                        aria-label="Move to top"
                      >
                        <span aria-hidden="true">⬆️</span>
                      </button>
                      <button
                        class="card-action-btn"
                        @click="moveCardUp(deck, card.id)"
                        :disabled="index === 0 || deckManipulationLoading"
                        title="Move up"
                        aria-label="Move up"
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        class="card-action-btn"
                        @click="moveCardDown(deck, card.id)"
                        :disabled="index === deck.cards.length - 1 || deckManipulationLoading"
                        title="Move down"
                        aria-label="Move down"
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        class="card-action-btn"
                        @click="openTransferDialog(card.id, deck.id)"
                        :disabled="discoveredCardContainers.length < 2 || deckManipulationLoading"
                        title="Transfer to another container"
                        aria-label="Transfer to another container"
                      >
                        <span aria-hidden="true">➡️</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Card Detail Panel -->
            <div v-if="selectedCard" class="card-detail-panel">
              <div class="card-detail-header">
                <span class="card-detail-title">
                  {{ selectedCard.className }} #{{ selectedCard.id }}
                </span>
                <div class="card-detail-actions">
                  <button
                    @click="copyNodeToClipboard(selectedCard.fullObject)"
                    class="debug-btn small"
                    title="Copy JSON"
                  >
                    Copy
                  </button>
                  <button
                    @click="selectedDeckCard = null"
                    class="debug-btn small"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div class="card-detail-content">
                <pre class="card-json">{{ JSON.stringify(selectedCard.fullObject, null, 2) }}</pre>
              </div>
            </div>
          </div>

          <!-- Transfer Dialog -->
          <div v-if="transferDialogOpen" class="debug-dialog-overlay" @click.self="closeTransferDialog">
            <div class="debug-dialog">
              <div class="debug-dialog-header">
                <span>Transfer Card</span>
                <button class="close-btn" @click="closeTransferDialog" aria-label="Close transfer dialog">
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <div class="debug-dialog-body">
                <div class="form-group">
                  <label>Target Container:</label>
                  <select v-model="transferDialogTargetDeckId">
                    <option :value="null" disabled>Select a container...</option>
                    <option v-for="container in availableTargetContainers" :key="container.id" :value="container.id">
                      {{ container.name }} ({{ container.className }}, {{ container.cardCount }} cards)
                    </option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Position:</label>
                  <div class="radio-group">
                    <label>
                      <input type="radio" v-model="transferDialogPosition" value="first" />
                      Top (first)
                    </label>
                    <label>
                      <input type="radio" v-model="transferDialogPosition" value="last" />
                      Bottom (last)
                    </label>
                  </div>
                </div>
              </div>
              <div class="debug-dialog-footer">
                <button class="debug-btn" @click="closeTransferDialog">Cancel</button>
                <button
                  class="debug-btn primary"
                  @click="confirmTransfer"
                  :disabled="transferDialogTargetDeckId === null || deckManipulationLoading"
                >
                  {{ deckManipulationLoading ? 'Transferring...' : 'Transfer' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Loading indicator -->
          <div v-if="deckManipulationLoading" class="deck-loading">
            Processing...
          </div>
        </div>

        <!-- Actions Tab -->
        <div
          v-show="activeTab === 'actions'"
          id="debug-panel-actions"
          role="tabpanel"
          aria-labelledby="debug-tab-actions"
          class="tab-content actions-tab"
        >
          <div class="actions-header">
            <span class="actions-count">{{ actionTraces.length }} actions</span>
            <button @click="fetchActionTraces" class="debug-btn small" :disabled="tracesLoading">
              {{ tracesLoading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>

          <!-- Flow Context Info Box -->
          <div v-if="flowContext || flowStateInfo" class="flow-context-box">
            <div class="flow-context-header">
              <span class="flow-context-icon">⚡</span>
              <span class="flow-context-title">Flow Context</span>
            </div>
            <div class="flow-context-details">
              <div v-if="flowStateInfo" class="flow-context-item">
                <span class="flow-context-label">Flow position:</span>
                <span class="flow-context-value">{{ flowStateInfo.description }}</span>
              </div>
              <template v-if="flowContext">
                <div v-if="flowContext.currentPhase" class="flow-context-item">
                  <span class="flow-context-label">Phase:</span>
                  <span class="flow-context-value">{{ flowContext.currentPhase }}</span>
                </div>
                <div class="flow-context-item">
                  <span class="flow-context-label">Current player:</span>
                  <span class="flow-context-value">{{ flowContext.currentPlayer ?? 'none' }}</span>
                  <span v-if="flowContext.isMyTurn" class="flow-context-badge my-turn">Your turn</span>
                  <span v-else class="flow-context-badge not-turn">Not your turn</span>
                </div>
                <div class="flow-context-item">
                  <span class="flow-context-label">Flow allows:</span>
                  <span class="flow-context-value flow-allowed-list">
                    <template v-if="flowContext.flowAllowedActions.length > 0">
                      {{ flowContext.flowAllowedActions.join(', ') }}
                    </template>
                    <template v-else>
                      <em>no actions</em>
                    </template>
                  </span>
                </div>
              </template>
            </div>
          </div>

          <div v-if="tracesError" class="traces-error">
            {{ tracesError }}
          </div>

          <div v-else-if="actionTraces.length === 0" class="no-traces">
            No action traces available
          </div>

          <div v-else class="traces-list">
            <!-- Truly Available Actions (pass conditions AND in flow) -->
            <div class="trace-group">
              <div class="trace-group-header available">
                <span class="trace-icon">✓</span>
                <span class="trace-group-label">Available ({{ trulyAvailableActions.length }})</span>
                <button
                  class="debug-btn small trace-copy-btn"
                  @click="copyAvailableActions"
                  title="Copy available actions"
                >
                  Copy
                </button>
              </div>
              <div class="trace-items">
                <div
                  v-for="trace in trulyAvailableActions"
                  :key="trace.actionName"
                  class="trace-item available"
                >
                  <span class="trace-name">{{ trace.actionName }}</span>
                  <span v-if="trace.selections.length > 0" class="trace-selections">
                    ({{ trace.selections.map(s => `${s.name}: ${s.choiceCount}`).join(', ') }})
                  </span>
                </div>
                <div v-if="trulyAvailableActions.length === 0" class="trace-empty">
                  No actions currently available
                </div>
              </div>
            </div>

            <!-- Flow-Restricted Actions (pass conditions but blocked by flow) -->
            <div v-if="flowRestrictedActions.length > 0" class="trace-group">
              <div class="trace-group-header flow-restricted">
                <span class="trace-icon">🚫</span>
                <span class="trace-group-label">Flow-Restricted ({{ flowRestrictedActions.length }})</span>
              </div>
              <div class="trace-items">
                <div class="flow-restricted-explanation">
                  These actions pass their conditions but are not allowed by the current flow step.
                  Add them to <code>actionStep({ actions: [...] })</code> in the flow definition.
                </div>
                <div
                  v-for="trace in flowRestrictedActions"
                  :key="trace.actionName"
                  class="trace-item flow-restricted"
                >
                  <span class="trace-name">{{ trace.actionName }}</span>
                  <span class="trace-badge">would be available</span>
                  <span v-if="trace.selections.length > 0" class="trace-selections">
                    ({{ trace.selections.map(s => `${s.name}: ${s.choiceCount}`).join(', ') }})
                  </span>
                </div>
              </div>
            </div>

            <!-- Unavailable Actions (fail conditions) -->
            <div class="trace-group">
              <div class="trace-group-header unavailable">
                <span class="trace-icon">✗</span>
                <span class="trace-group-label">Condition Failed ({{ conditionFailedActions.length }})</span>
                <button
                  class="debug-btn small trace-copy-btn"
                  @click="copyUnavailableActions"
                  title="Copy unavailable actions"
                >
                  Copy
                </button>
              </div>
              <div class="trace-items">
                <div
                  v-for="trace in conditionFailedActions"
                  :key="trace.actionName"
                  class="trace-item-detailed unavailable"
                >
                  <div class="trace-item-header">
                    <span class="trace-name">{{ trace.actionName }}</span>
                    <span class="trace-reason">
                      <template v-if="trace.conditionError">
                        error: {{ trace.conditionError }}
                      </template>
                      <template v-else-if="trace.selections.some(s => s.choiceCount === 0)">
                        no choices for: {{ trace.selections.filter(s => s.choiceCount === 0).map(s => s.name).join(', ') }}
                      </template>
                      <!-- Don't show "condition failed" - it's noise. Details below will explain if available. -->
                    </span>
                  </div>
                  <!-- Show condition details if available -->
                  <div v-if="trace.conditionDetails && trace.conditionDetails.length > 0" class="condition-details">
                    <div
                      v-for="(detail, idx) in trace.conditionDetails"
                      :key="idx"
                      class="condition-detail"
                      :class="{ passed: detail.passed, failed: !detail.passed }"
                    >
                      <span class="condition-icon">{{ detail.passed ? '✓' : '✗' }}</span>
                      <span class="condition-label">{{ detail.label }}</span>
                      <span class="condition-value">= {{ formatConditionValue(detail.value) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- History Tab -->
        <div
          v-show="activeTab === 'history'"
          id="debug-panel-history"
          role="tabpanel"
          aria-labelledby="debug-tab-history"
          class="tab-content history-tab"
        >
          <div class="history-header">
            <span class="history-count">{{ actionHistory.length }} actions</span>
            <button @click="fetchHistory" class="debug-btn small" :disabled="historyLoading">
              {{ historyLoading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>

          <div v-if="historyError" class="history-error">
            {{ historyError }}
          </div>

          <div v-else-if="historyLoading && actionHistory.length === 0" class="history-loading">
            Loading history...
          </div>

          <div v-else-if="actionHistory.length === 0" class="history-empty">
            No actions yet
          </div>

          <!-- Timeline slider -->
          <div v-if="actionHistory.length > 0" class="timeline-controls">
            <button
              class="debug-btn small"
              :disabled="selectedActionIndex === null || selectedActionIndex <= 0"
              @click="selectAction((selectedActionIndex ?? actionHistory.length) - 1)"
            >
              &lt;
            </button>
            <input
              type="range"
              :min="0"
              :max="actionHistory.length"
              :value="selectedActionIndex ?? actionHistory.length"
              @input="selectAction(parseInt(($event.target as HTMLInputElement).value))"
              class="timeline-slider"
            />
            <button
              class="debug-btn small"
              :disabled="selectedActionIndex === null || selectedActionIndex >= actionHistory.length"
              @click="selectAction((selectedActionIndex ?? actionHistory.length - 1) + 1)"
            >
              &gt;
            </button>
            <span class="timeline-position">
              {{ selectedActionIndex ?? actionHistory.length }} / {{ actionHistory.length }}
            </span>
            <button
              v-if="isViewingHistory"
              class="debug-btn small live-btn"
              @click="clearHistoricalState"
            >
              Live
            </button>
            <button
              v-if="isViewingHistory && selectedActionIndex !== null && selectedActionIndex < actionHistory.length"
              class="debug-btn small rewind-btn"
              :disabled="rewindLoading"
              @click="requestRewind(selectedActionIndex)"
              title="Permanently rewind game to this action"
            >
              {{ rewindLoading ? 'Rewinding...' : 'Rewind Here' }}
            </button>
          </div>
          <!-- Rewind confirmation. In-panel, NOT window.confirm — see
               `pendingRewindIndex` for the three ways the native dialog broke
               this control (page freeze, silent no-op inside the platform
               iframe, and Chrome's suppress-dialogs box). -->
          <div
            v-if="pendingRewindIndex !== null"
            class="debug-dialog-overlay"
            @click.self="cancelRewind"
          >
            <div class="debug-dialog" role="dialog" aria-modal="true" aria-labelledby="rewind-confirm-title">
              <div class="debug-dialog-header">
                <span id="rewind-confirm-title">Rewind to action {{ pendingRewindIndex }}?</span>
                <button class="close-btn" @click="cancelRewind" aria-label="Cancel rewind">
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <div class="debug-dialog-body">
                <p>
                  This permanently discards
                  {{ pendingRewindDiscardCount }}
                  action{{ pendingRewindDiscardCount === 1 ? '' : 's' }} and cannot be undone.
                </p>
              </div>
              <div class="debug-dialog-footer">
                <button class="debug-btn" @click="cancelRewind">Cancel</button>
                <button class="debug-btn primary" :disabled="rewindLoading" @click="confirmRewind">
                  {{ rewindLoading ? 'Rewinding...' : 'Rewind' }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="rewindError" class="rewind-error">
            {{ rewindError }}
          </div>

          <!-- Action list -->
          <div v-if="actionHistory.length > 0" class="history-list">
            <div
              v-for="(action, index) in actionHistory"
              :key="index"
              class="history-item"
              :class="{
                current: index === actionHistory.length - 1 && !isViewingHistory,
                selected: selectedActionIndex === index + 1
              }"
              @click="selectAction(index + 1)"
            >
              <div class="history-item-header">
                <span class="history-index">{{ index + 1 }}</span>
                <span class="history-player" :class="`player-${action.player}`">
                  P{{ action.player + 1 }}
                </span>
                <span class="history-action-name">{{ formatActionName(action.name) }}</span>
                <span v-if="action.timestamp" class="history-time">
                  {{ formatTimestamp(action.timestamp) }}
                </span>
              </div>
              <div v-if="formatActionArgs(action.args)" class="history-item-args">
                {{ formatActionArgs(action.args) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Logs Tab (ERR-04) -->
        <div
          v-show="activeTab === 'logs'"
          id="debug-panel-logs"
          role="tabpanel"
          aria-labelledby="debug-tab-logs"
          class="tab-content logs-tab"
        >
          <div class="history-header">
            <span class="history-count">{{ logEntries.length }} entries</span>
            <button @click="fetchLogs" class="debug-btn small" :disabled="logsLoading">
              {{ logsLoading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>

          <div v-if="logsError" class="history-error">
            {{ logsError }}
          </div>

          <div v-else-if="logsLoading && logEntries.length === 0" class="history-loading">
            Loading logs...
          </div>

          <div v-else-if="logEntries.length === 0" class="history-empty">
            No captured server-side errors or warnings
          </div>

          <div v-else class="history-list log-list">
            <div
              v-for="(entry, index) in logEntries"
              :key="index"
              class="history-item log-entry"
              :class="`log-severity-${entry.severity}`"
            >
              <div class="history-item-header">
                <span class="log-severity-badge" :class="`log-severity-${entry.severity}`">
                  {{ entry.severity }}
                </span>
                <span class="history-action-name">{{ entry.source }}</span>
                <span class="history-time">{{ formatTimestamp(entry.timestamp) }}</span>
              </div>
              <div class="history-item-args">{{ entry.message }}</div>
            </div>
          </div>
        </div>

        <!-- Controls Tab -->
        <div
          v-show="activeTab === 'controls'"
          id="debug-panel-controls"
          role="tabpanel"
          aria-labelledby="debug-tab-controls"
          class="tab-content controls-tab"
        >
          <!-- Player Perspective -->
          <div class="action-group">
            <h4>Player Perspective</h4>
            <div class="player-buttons">
              <button
                v-for="i in playerCount"
                :key="i - 1"
                @click="switchToPlayer(i - 1)"
                :class="{ active: playerSeat === i - 1 }"
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
            <button
              @click="handleRestartClick"
              class="debug-btn"
              :class="restartConfirming ? 'restart-confirming' : 'danger'"
            >
              {{ restartConfirming ? 'Confirm restart?' : 'Restart game' }}
            </button>
            <p class="hint">
              {{ restartConfirming ? 'Click again to confirm — auto-cancels in 5 s' : 'Start a new game (current progress will be lost)' }}
            </p>
          </div>

          <!-- Game History — copy/clear the player-visible message log.
               Buttons emit events; GameShell drives the live GameHistory ref. -->
          <div class="action-group">
            <h4>Game history</h4>
            <div class="player-buttons">
              <button class="debug-btn small" :disabled="!props.historyHasMessages" @click="emit('copy-history')">
                Copy
              </button>
              <button class="debug-btn small danger" @click="emit('clear-history')">
                Clear
              </button>
            </div>
            <p class="hint">Copy or clear the player-facing game message log</p>
          </div>

          <!-- Settings -->
          <div class="action-group">
            <h4>Settings</h4>
            <label class="setting-item">
              <input type="checkbox" v-model="showRawState" />
              Show raw JSON by default
            </label>
          </div>

          <!-- Connection Info -->
          <div class="action-group">
            <h4>Connection</h4>
            <div class="state-item">
              <span class="label">Transport:</span>
              <span class="value monospace">host bridge (dev)</span>
            </div>
            <div class="state-item">
              <span class="label">Seat:</span>
              <span class="value monospace">{{ playerSeat }} / {{ playerCount }}</span>
            </div>
            <div class="shortcut-hint">
              <kbd>Ctrl/Cmd+D</kbd> Toggle debug panel
            </div>
          </div>
        </div>
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
  color: var(--bsg-ink-2);
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
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  color: var(--bsg-ink);
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: var(--bsg-accent-2);
}

.search-input::placeholder {
  color: var(--bsg-ink-3);
}

.state-display {
  background: var(--bsg-surface-3);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
  overflow-y: auto;
  flex: 1;
}

.state-display pre {
  padding: 12px;
  margin: 0;
  font-family: var(--bsg-mono);
  font-size: 11px;
  color: var(--bsg-ok);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Tree View */
.state-tree {
  padding: 8px;
  font-family: var(--bsg-mono);
  font-size: 11px;
}

.tree-summary {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
  border-radius: 6px;
  margin-bottom: 12px;
}

.summary-item {
  display: flex;
  gap: 4px;
}

.summary-label {
  color: var(--bsg-ink-2);
}

.summary-value {
  color: var(--bsg-accent-2);
  font-weight: 500;
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

.no-state {
  color: var(--bsg-ink-3);
  text-align: center;
  padding: 20px;
}

/* Actions Tab */
.action-group {
  margin-bottom: 20px;
}

.action-group h4 {
  color: var(--bsg-ink);
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

.action-group .hint {
  color: var(--bsg-ink-3);
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
  color: var(--bsg-ink);
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bsg-ink-2);
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
  color: var(--bsg-ink-2);
}

.shortcut-item kbd,
.shortcut-hint kbd {
  display: inline-block;
  padding: 4px 8px;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: var(--bsg-accent-2);
}

.shortcut-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--bsg-ink-2);
}

.state-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--bsg-line);
}

.state-item:last-child {
  border-bottom: none;
}

.state-item .label {
  color: var(--bsg-ink-2);
}

.state-item .value {
  color: var(--bsg-accent-2);
  font-weight: 500;
}

.state-item .value.monospace {
  font-family: monospace;
  font-size: 11px;
}

/* Buttons */
.debug-btn {
  padding: 8px 16px;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line-2);
  border-radius: 6px;
  color: var(--bsg-ink);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.debug-btn:hover {
  background: var(--bsg-surface-3);
  border-color: var(--bsg-accent-2);
}

.debug-btn.active {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border-color: var(--bsg-accent-2);
  color: var(--bsg-accent-2);
}

.debug-btn.small {
  padding: 4px 10px;
  font-size: 11px;
}

.debug-btn.danger {
  border-color: var(--bsg-danger);
  color: var(--bsg-danger);
}

.debug-btn.danger:hover {
  background: color-mix(in srgb, var(--bsg-danger) 20%, transparent);
}

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

/* History Tab */
.history-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-count {
  color: var(--bsg-ink-2);
  font-size: 12px;
}

.actions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.actions-count {
  color: var(--bsg-ink-2);
  font-size: 12px;
}

.history-error {
  color: var(--bsg-danger);
  padding: 12px;
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
  border-radius: 6px;
  font-size: 12px;
}

.history-loading,
.history-empty {
  color: var(--bsg-ink-3);
  font-style: italic;
  padding: 20px;
  text-align: center;
  background: var(--bsg-surface-2);
  border-radius: 6px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
}

.history-item {
  padding: 8px 12px;
  background: var(--bsg-surface-2);
  border-radius: 6px;
  border-left: 3px solid transparent;
  transition: all 0.2s;
}

.history-item:hover {
  background: var(--bsg-surface-3);
}

.history-item.current {
  border-left-color: var(--bsg-accent-2);
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
}

.history-item.selected {
  border-left-color: var(--bsg-warn);
  background: color-mix(in srgb, var(--bsg-warn) 15%, transparent);
}

.history-item {
  cursor: pointer;
}

.history-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-index {
  min-width: 24px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bsg-surface-3);
  border-radius: 10px;
  font-size: 10px;
  color: var(--bsg-ink-2);
}

.history-player {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.history-player.player-0 {
  background: color-mix(in srgb, var(--bsg-seat-2) 30%, transparent);
  color: var(--bsg-seat-2);
}

.history-player.player-1 {
  background: color-mix(in srgb, var(--bsg-seat-1) 30%, transparent);
  color: var(--bsg-seat-1);
}

.history-player.player-2 {
  background: color-mix(in srgb, var(--bsg-seat-3) 30%, transparent);
  color: var(--bsg-seat-3);
}

.history-player.player-3 {
  background: color-mix(in srgb, var(--bsg-seat-5) 30%, transparent);
  color: var(--bsg-seat-5);
}

.history-action-name {
  color: var(--bsg-ink);
  font-weight: 500;
  flex: 1;
}

.history-time {
  color: var(--bsg-ink-3);
  font-size: 10px;
}

.history-item-args {
  margin-top: 4px;
  padding-left: 32px;
  font-size: 11px;
  color: var(--bsg-ink-2);
  font-family: var(--bsg-mono);
}

/* Logs Tab (ERR-04) */
.logs-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-entry.log-severity-error {
  border-left-color: var(--bsg-danger);
}

.log-entry.log-severity-warning {
  border-left-color: var(--bsg-warn);
}

.log-severity-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.log-severity-badge.log-severity-error {
  background: color-mix(in srgb, var(--bsg-danger) 20%, transparent);
  color: var(--bsg-danger);
}

.log-severity-badge.log-severity-warning {
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent);
  color: var(--bsg-warn);
}

.log-severity-badge.log-severity-info {
  background: var(--bsg-surface-3);
  color: var(--bsg-ink-2);
}

/* Timeline Controls */
.timeline-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--bsg-line);
  margin-bottom: 8px;
}

.timeline-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  background: var(--bsg-surface-3);
  border-radius: 3px;
  cursor: pointer;
}

.timeline-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: var(--bsg-accent-2);
  border-radius: 50%;
  cursor: pointer;
}

.timeline-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--bsg-accent-2);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

.timeline-position {
  font-size: 11px;
  color: var(--bsg-ink-2);
  min-width: 50px;
  text-align: center;
}

.live-btn {
  background: color-mix(in srgb, var(--bsg-ok) 20%, transparent) !important;
  border-color: var(--bsg-ok) !important;
  color: var(--bsg-ok) !important;
}

.rewind-btn {
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent) !important;
  border-color: var(--bsg-warn) !important;
  color: var(--bsg-warn) !important;
}

.rewind-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bsg-warn) 40%, transparent) !important;
}

.rewind-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rewind-error {
  background: color-mix(in srgb, var(--bsg-danger) 20%, transparent);
  border: 1px solid var(--bsg-danger);
  color: var(--bsg-danger);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 12px;
}

/* Historical State Banner */
.historical-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--bsg-warn) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-warn) 30%, transparent);
  border-radius: 6px;
  margin-bottom: 12px;
  color: var(--bsg-warn);
  font-size: 12px;
}

.historical-icon {
  font-size: 16px;
}

.historical-banner button {
  margin-left: auto;
}

.historical-state-loading {
  padding: 12px;
  color: var(--bsg-ink-2);
  font-size: 12px;
  font-style: italic;
}

.historical-state-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: color-mix(in srgb, var(--bsg-danger) 12%, transparent);
  border: 1px solid var(--bsg-danger);
  border-radius: 6px;
  color: var(--bsg-danger);
  font-size: 12px;
  line-height: 1.5;
}

.historical-state-reason {
  font-family: var(--bsg-font-mono, monospace);
  color: var(--bsg-ink-2);
  word-break: break-word;
}

.state-search-empty {
  padding: 12px 4px;
  color: var(--bsg-ink-2);
  font-size: 12px;
  line-height: 1.5;
}

/* Historical state indicator */
.state-display.historical {
  border: 2px solid color-mix(in srgb, var(--bsg-warn) 30%, transparent);
  border-radius: 8px;
}

.tree-summary.historical {
  background: color-mix(in srgb, var(--bsg-warn) 15%, transparent);
}

/* Elements Tab */
.elements-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.element-search {
  margin-bottom: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bsg-ink);
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

/* Actions Section */
.actions-section {
  border-bottom: 1px solid var(--bsg-line);
  padding-bottom: 16px;
}

.traces-error {
  color: var(--bsg-danger);
  padding: 8px;
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
  border-radius: 6px;
  font-size: 11px;
}

.no-traces {
  color: var(--bsg-ink-3);
  font-style: italic;
  font-size: 11px;
}

.traces-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trace-group {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}

.trace-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.trace-group-header.available {
  background: color-mix(in srgb, var(--bsg-ok) 15%, transparent);
  color: var(--bsg-ok);
}

.trace-group-header.unavailable {
  background: color-mix(in srgb, var(--bsg-danger) 15%, transparent);
  color: var(--bsg-danger);
}

.trace-group-header.flow-restricted {
  background: color-mix(in srgb, var(--bsg-warn) 15%, transparent);
  color: var(--bsg-warn);
}

.trace-group-label {
  flex: 1;
}

/* Flow Context Box */
.flow-context-box {
  background: color-mix(in srgb, var(--bsg-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-accent) 30%, transparent);
  border-radius: 6px;
  margin-bottom: 12px;
  overflow: hidden;
}

.flow-context-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-accent) 15%, transparent);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--bsg-accent);
}

.flow-context-icon {
  font-size: 12px;
}

.flow-context-details {
  padding: 8px 12px;
  font-size: 11px;
}

.flow-context-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}

.flow-context-label {
  color: var(--bsg-ink-2);
  min-width: 100px;
}

.flow-context-value {
  color: var(--bsg-ink);
}

.flow-context-value.flow-allowed-list {
  color: var(--bsg-ok);
  font-family: monospace;
  font-size: 10px;
}

.flow-context-badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}

.flow-context-badge.my-turn {
  background: color-mix(in srgb, var(--bsg-ok) 20%, transparent);
  color: var(--bsg-ok);
}

.flow-context-badge.not-turn {
  background: color-mix(in srgb, var(--bsg-ink-2) 20%, transparent);
  color: var(--bsg-away);
}

/* Flow-restricted action items */
.trace-item.flow-restricted {
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bsg-warn);
}

.trace-item.flow-restricted .trace-name {
  color: var(--bsg-warn);
}

.trace-badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 9px;
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent);
  color: var(--bsg-warn);
}

.flow-restricted-explanation {
  padding: 8px 12px;
  font-size: 10px;
  color: var(--bsg-away);
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}

.flow-restricted-explanation code {
  background: var(--bsg-surface-3);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  color: var(--bsg-warn);
}

.trace-empty {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--bsg-ink-3);
  font-style: italic;
}

.trace-copy-btn {
  opacity: 0.6;
  font-size: 9px !important;
  padding: 2px 6px !important;
  text-transform: none;
}

.trace-copy-btn:hover {
  opacity: 1;
}

.trace-icon {
  font-size: 12px;
}

.trace-items {
  padding: 4px 8px;
}

.trace-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 4px;
}

.trace-item.available .trace-name {
  color: var(--bsg-ok);
}

.trace-item.unavailable .trace-name {
  color: var(--bsg-danger);
}

.trace-selections {
  color: var(--bsg-ink-2);
  font-size: 10px;
}

.trace-reason {
  color: var(--bsg-ink-2);
  font-size: 10px;
  font-style: italic;
}

/* Detailed trace item for unavailable actions */
.trace-item-detailed {
  padding: 8px;
  background: var(--bsg-surface-2);
  border-radius: 6px;
  margin-bottom: 4px;
}

.trace-item-detailed.unavailable {
  border-left: 3px solid var(--bsg-danger);
}

.trace-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.trace-item-detailed .trace-name {
  color: var(--bsg-danger);
  font-weight: 500;
}

/* Condition details */
.condition-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--bsg-line);
}

.condition-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 10px;
  font-family: monospace;
}

.condition-detail.passed {
  color: var(--bsg-ok);
}

.condition-detail.failed {
  color: var(--bsg-danger);
}

.condition-icon {
  font-size: 9px;
  width: 12px;
  text-align: center;
}

.condition-label {
  color: var(--bsg-ink-2);
}

.condition-value {
  color: var(--bsg-ink-2);
  font-size: 9px;
}

/* Elements Section */
.elements-section {
  border-bottom: 1px solid var(--bsg-line);
  padding-bottom: 16px;
}

.no-elements {
  color: var(--bsg-ink-3);
  font-style: italic;
  font-size: 11px;
}

/* Elements split view layout */
.elements-split-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.elements-split-view.has-selection {
  flex-direction: row;
  gap: 12px;
}

.elements-list-panel {
  flex: 1;
  min-width: 0;
  max-height: 400px;
  overflow-y: auto;
}

.elements-split-view.has-selection .elements-list-panel {
  flex: 0 0 40%;
  max-height: 400px;
}

.element-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bsg-surface-3);
  border-radius: 8px;
  overflow: hidden;
  max-height: 400px;
}

.element-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}

.element-detail-title {
  font-weight: 600;
  color: var(--bsg-accent);
  font-size: 13px;
}

.element-detail-actions {
  display: flex;
  gap: 4px;
}

.element-detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.element-json {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--bsg-ink-2);
}

.element-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: none;
  overflow-y: visible;
}

.element-group {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}

.element-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.element-group-header:hover {
  background: var(--bsg-surface-3);
}

.group-arrow {
  color: var(--bsg-ink-3);
  font-size: 10px;
  width: 12px;
}

.group-name {
  color: var(--bsg-accent-2);
  font-weight: 500;
  font-size: 12px;
}

.group-count {
  color: var(--bsg-ink-2);
  font-size: 11px;
}

.element-list {
  padding: 4px 8px 8px;
  border-top: 1px solid var(--bsg-line);
}

.element-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.element-item:hover {
  background: var(--bsg-surface-3);
}

.element-item.selected {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-accent-2) 40%, transparent);
}

.element-name {
  color: var(--bsg-ink);
  font-size: 11px;
}

.element-id {
  color: var(--bsg-ink-3);
  font-size: 10px;
  font-family: var(--bsg-mono);
}

/* Custom Debug Section */
.custom-debug-section {
  padding-bottom: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.custom-debug-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.custom-debug-item {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}

.custom-debug-key {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
  color: var(--bsg-accent-2);
  font-weight: 500;
  font-size: 11px;
}

.custom-debug-copy {
  opacity: 0.6;
  font-size: 9px !important;
  padding: 2px 6px !important;
}

.custom-debug-copy:hover {
  opacity: 1;
}

.custom-debug-value {
  margin: 0;
  padding: 8px 12px;
  font-family: var(--bsg-mono);
  font-size: 10px;
  color: var(--bsg-ok);
  overflow: auto;
  max-height: 200px;
  white-space: pre-wrap;
  word-break: break-all;
}

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

/* Decks Tab */
.decks-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.deck-search {
  margin-bottom: 4px;
}

.deck-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--bsg-danger) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-danger) 30%, transparent);
  border-radius: 6px;
  color: var(--bsg-danger);
  font-size: 12px;
}

.no-decks {
  color: var(--bsg-ink-2);
  font-style: italic;
  padding: 20px;
  text-align: center;
  background: var(--bsg-surface-2);
  border-radius: 6px;
}

.deck-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--bsg-ink-3);
}

.deck-hint code {
  background: color-mix(in srgb, var(--bsg-accent-2) 10%, transparent);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--bsg-accent-2);
  font-size: 10px;
}

/* Decks split view */
.decks-split-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.decks-split-view.has-selection {
  flex-direction: row;
  gap: 12px;
}

.decks-list-panel {
  flex: 1;
  min-width: 0;
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.decks-split-view.has-selection .decks-list-panel {
  flex: 0 0 50%;
  max-height: 400px;
}

/* Deck item */
.deck-item {
  background: var(--bsg-surface-2);
  border-radius: 6px;
  overflow: hidden;
}

.deck-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.deck-header:hover {
  background: var(--bsg-surface-3);
}

.deck-arrow {
  color: var(--bsg-ink-3);
  font-size: 10px;
  width: 12px;
}

.deck-name {
  color: var(--bsg-ink-2);
  font-weight: 500;
  font-size: 12px;
  flex: 1;
}

.deck-count {
  color: var(--bsg-ink-2);
  font-size: 11px;
}

.deck-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.deck-action-btn {
  opacity: 0.6;
  font-size: 12px !important;
  padding: 2px 6px !important;
  line-height: 1;
}

.deck-action-btn:hover:not(:disabled) {
  opacity: 1;
}

.deck-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Deck cards list */
.deck-cards {
  padding: 4px 8px 8px;
  border-top: 1px solid var(--bsg-line);
  max-height: 300px;
  overflow-y: auto;
}

.deck-empty {
  color: var(--bsg-ink-3);
  font-style: italic;
  padding: 8px;
  text-align: center;
  font-size: 11px;
}

.card-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 11px;
}

.card-item:hover {
  background: var(--bsg-surface-3);
}

.card-item.selected {
  background: color-mix(in srgb, var(--bsg-ink-2) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-ink-2) 40%, transparent);
}

.card-item.search-match {
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-warn) 50%, transparent);
}

.card-item.search-match .card-name {
  color: var(--bsg-warn);
  font-weight: bold;
}

.card-position {
  min-width: 20px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bsg-surface-3);
  border-radius: 9px;
  font-size: 9px;
  color: var(--bsg-ink-2);
}

.card-name {
  color: var(--bsg-ink);
  flex: 1;
}

.card-class {
  color: var(--bsg-ink-3);
  font-size: 10px;
}

.card-id {
  color: var(--bsg-ink-3);
  font-size: 10px;
  font-family: var(--bsg-mono);
}

/* Card action buttons */
.card-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.2s;
}

.card-item:hover .card-actions {
  opacity: 1;
}

.card-action-btn {
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--bsg-line);
  border-radius: 4px;
  background: var(--bsg-surface-3);
  color: var(--bsg-ink-2);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.card-action-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border-color: color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
  color: var(--bsg-accent-2);
}

.card-action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Transfer dialog */
.debug-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: color-mix(in srgb, black 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.debug-dialog {
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  border-radius: 8px;
  width: 300px;
  max-width: 90vw;
  box-shadow: var(--bsg-shadow);
}

.debug-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bsg-line);
  font-weight: 600;
  color: var(--bsg-ink);
}

.debug-dialog-header .close-btn {
  background: none;
  border: none;
  color: var(--bsg-ink-2);
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.debug-dialog-header .close-btn:hover {
  color: var(--bsg-ink);
}

.debug-dialog-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Confirmation copy (the rewind dialog): the body's own gap does the spacing. */
.debug-dialog-body p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--bsg-ink);
}

.debug-dialog-body .form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.debug-dialog-body label {
  color: var(--bsg-ink-2);
  font-size: 12px;
}

.debug-dialog-body select {
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line);
  border-radius: 4px;
  padding: 8px 12px;
  color: var(--bsg-ink);
  font-size: 13px;
}

.debug-dialog-body select:focus {
  outline: none;
  border-color: var(--bsg-accent-2);
}

.debug-dialog-body .radio-group {
  display: flex;
  gap: 16px;
}

.debug-dialog-body .radio-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--bsg-ink-2);
}

.debug-dialog-body .radio-group input[type="radio"] {
  accent-color: var(--bsg-accent-2);
}

.debug-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--bsg-line);
}

.debug-btn.primary {
  background: color-mix(in srgb, var(--bsg-accent-2) 20%, transparent);
  border-color: color-mix(in srgb, var(--bsg-accent-2) 40%, transparent);
  color: var(--bsg-accent-2);
}

.debug-btn.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bsg-accent-2) 30%, transparent);
}

.debug-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Deck loading indicator */
.deck-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--bsg-bg);
  padding: 12px 20px;
  border-radius: 6px;
  color: var(--bsg-accent-2);
  font-size: 12px;
  z-index: 100;
}

/* Card detail panel */
.card-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bsg-surface-3);
  border-radius: 8px;
  overflow: hidden;
  max-height: 400px;
}

.card-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}

.card-detail-title {
  font-weight: 600;
  color: var(--bsg-ink-2);
  font-size: 13px;
}

.card-detail-actions {
  display: flex;
  gap: 4px;
}

.card-detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.card-json {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--bsg-ink-2);
}

/* Deck tab positioning */
.decks-tab {
  position: relative;
}
</style>

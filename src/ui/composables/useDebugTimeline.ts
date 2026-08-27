/**
 * The debug panel's action timeline: history, time travel and rewind (#41).
 *
 * These three read as separate features in the UI but are one concern — where
 * in the game's action history the panel is currently pointed. History supplies
 * the list, time travel moves the pointer off "live", and rewind makes that
 * move permanent. They shared eight refs inside `DebugPanel.vue` and could only
 * be exercised by mounting the panel with a host bridge attached.
 *
 * Everything it needs is passed in: a `DebugBridge`, the viewing seat, and one
 * callback for telling the rest of the shell which state to render. A test
 * supplies a stub bridge and reads what came back.
 *
 * @module
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { DebugBridge, ElementDiff, SerializedAction } from './useDebugBridge.js';

export interface DebugTimelineOptions {
  /** How the panel talks to the running game. */
  bridge: DebugBridge;
  /** The viewing seat, whose view of historical state is fetched. */
  playerSeat: Ref<number>;
  /**
   * Called whenever the pointer moves. `state` is `null` at the live head, and
   * so are `actionIndex` and `diff` — that triple is how the shell is told to
   * go back to rendering the live game.
   */
  onTimeTravel: (state: unknown | null, actionIndex: number | null, diff: ElementDiff | null) => void;
}

export interface DebugTimeline {
  /** Every action played so far, oldest first. */
  actionHistory: Ref<SerializedAction[]>;
  historyLoading: Ref<boolean>;
  historyError: Ref<string | null>;
  /** Reload the history. Ignored while a load is already in flight. */
  fetchHistory: () => Promise<void>;
  /** Reload the history unless it was loaded within the last `maxAgeMs`. */
  refreshHistoryIfStale: (maxAgeMs: number) => Promise<void>;

  /** Which action the panel is pointed at, or `null` at the live head. */
  selectedActionIndex: Ref<number | null>;
  historicalState: Ref<unknown>;
  historicalStateLoading: Ref<boolean>;
  historicalStateError: Ref<string | null>;
  stateDiff: Ref<ElementDiff | null>;
  isViewingHistory: ComputedRef<boolean>;
  /** Point at an action, or return to live when it is already selected. */
  selectAction: (index: number) => Promise<void>;
  /** Load one action's state and the diff that produced it. */
  fetchStateAtAction: (actionIndex: number) => Promise<void>;
  /** Return to the live head. */
  clearHistoricalState: () => void;

  /**
   * Which action a rewind would return to, while its confirmation is open.
   *
   * The confirmation is an IN-PANEL dialog, never `window.confirm`. A native
   * dialog is the wrong tool here for three separate reasons, each of which
   * broke this control:
   *
   *  - It BLOCKS the whole page while open. The game holds a live WebSocket and
   *    renders continuously; a modal dialog freezes the renderer, so nothing in
   *    the tab (including the debug panel that opened it) responds until it is
   *    dismissed. That is also what it looks like to any browser automation
   *    driving the shell — an unresponsive page, not a prompt.
   *  - The game runs INSIDE AN IFRAME in platform mode. Chrome blocks modal
   *    dialogs from cross-origin iframes outright: `confirm()` returns false
   *    without ever showing anything, so "Rewind Here" silently did nothing —
   *    no rewind, no error, no explanation.
   *  - One tick of Chrome's "prevent this page from creating additional
   *    dialogs" box makes every later `confirm()` return false, permanently and
   *    silently disabling the control for that session.
   *
   * The rewind is irreversible, so it keeps a confirmation — just one this app
   * actually controls, which can state what will be discarded and stay
   * operable.
   */
  pendingRewindIndex: Ref<number | null>;
  /** How many actions the pending rewind would permanently discard. */
  pendingRewindDiscardCount: ComputedRef<number>;
  rewindLoading: Ref<boolean>;
  rewindError: Ref<string | null>;
  /** Open the confirmation for a rewind to `actionIndex`. Sends nothing. */
  requestRewind: (actionIndex: number) => void;
  /** Close the confirmation without rewinding. */
  cancelRewind: () => void;
  /** Carry out the pending rewind. Does nothing when none is pending. */
  confirmRewind: () => Promise<void>;
}

export function useDebugTimeline(options: DebugTimelineOptions): DebugTimeline {
  const { bridge, playerSeat, onTimeTravel } = options;

  const actionHistory = ref<SerializedAction[]>([]);
  const historyLoading = ref(false);
  const historyError = ref<string | null>(null);
  const historyLastFetched = ref(0);

  const selectedActionIndex = ref<number | null>(null);
  const historicalState = ref<unknown>(null);
  const historicalStateLoading = ref(false);
  const historicalStateError = ref<string | null>(null);
  const stateDiff = ref<ElementDiff | null>(null);

  const rewindLoading = ref(false);
  const rewindError = ref<string | null>(null);
  const pendingRewindIndex = ref<number | null>(null);

  async function fetchHistory(): Promise<void> {
    if (historyLoading.value) return;

    historyLoading.value = true;
    historyError.value = null;
    try {
      actionHistory.value = await bridge.history();
      historyLastFetched.value = Date.now();
    } catch (e) {
      historyError.value = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      historyLoading.value = false;
    }
  }

  async function refreshHistoryIfStale(maxAgeMs: number): Promise<void> {
    if (Date.now() - historyLastFetched.value <= maxAgeMs) return;
    await fetchHistory();
  }

  function clearHistoricalState(): void {
    selectedActionIndex.value = null;
    historicalState.value = null;
    historicalStateError.value = null;
    stateDiff.value = null;
    onTimeTravel(null, null, null);
  }

  async function fetchStateAtAction(actionIndex: number): Promise<void> {
    historicalStateLoading.value = true;
    historicalStateError.value = null;

    try {
      // The state and the diff that produced it are independent reads, so they
      // go out together. Action 0 has no predecessor to diff against.
      const [state, diff] = await Promise.all([
        bridge.stateAt(actionIndex, playerSeat.value),
        actionIndex > 0
          ? bridge.stateDiff(actionIndex - 1, actionIndex, playerSeat.value)
          : Promise.resolve(null),
      ]);

      historicalState.value = state;
      stateDiff.value = diff;
      onTimeTravel(state, actionIndex, diff);
    } catch (e) {
      historicalStateError.value = e instanceof Error ? e.message : 'Unknown error';
      historicalState.value = null;
      stateDiff.value = null;
      onTimeTravel(null, null, null);
    } finally {
      historicalStateLoading.value = false;
    }
  }

  async function selectAction(index: number): Promise<void> {
    // The index one past the end IS the live head, and re-picking the current
    // selection toggles it off. Both mean "stop time travelling".
    if (index === actionHistory.value.length || selectedActionIndex.value === index) {
      clearHistoricalState();
      return;
    }
    selectedActionIndex.value = index;
    await fetchStateAtAction(index);
  }

  function requestRewind(actionIndex: number): void {
    rewindError.value = null;
    pendingRewindIndex.value = actionIndex;
  }

  function cancelRewind(): void {
    pendingRewindIndex.value = null;
  }

  const pendingRewindDiscardCount = computed(() =>
    pendingRewindIndex.value === null ? 0 : actionHistory.value.length - pendingRewindIndex.value
  );

  async function confirmRewind(): Promise<void> {
    const actionIndex = pendingRewindIndex.value;
    if (actionIndex === null) return;
    pendingRewindIndex.value = null;

    rewindLoading.value = true;
    rewindError.value = null;
    try {
      await bridge.rewind(actionIndex);
      // The rewound head IS the live state now, so stop time travelling before
      // reloading the list the rewind just shortened.
      clearHistoricalState();
      await fetchHistory();
    } catch (err) {
      rewindError.value = err instanceof Error ? err.message : 'Rewind failed';
    } finally {
      rewindLoading.value = false;
    }
  }

  return {
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
    isViewingHistory: computed(() => selectedActionIndex.value !== null),
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
  };
}

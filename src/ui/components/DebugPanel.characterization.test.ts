// @vitest-environment jsdom
/**
 * Characterization tests for DebugPanel.vue (#41).
 *
 * These pin the behaviour of the debug panel's request handlers, its view-tree
 * derivations, and its confirm flows BEFORE any of it was pulled out of the
 * component, so the extraction can be proved behaviour-preserving rather than
 * asserted to be.
 *
 * They deliberately drive the component through its own bindings and its host
 * bridge, not through the extracted units, so they keep their value after the
 * refactor: they are the contract the panel still has to honour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DebugPanel from './DebugPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';

type Op = (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

const VIEW = {
  id: 1,
  className: 'Board',
  children: [
    {
      id: 2,
      className: 'MainDeck',
      name: 'Draw',
      $type: 'deck',
      children: [
        { id: 10, className: 'Card', name: 'Ace', notation: 'AS' },
        { id: 11, className: 'Card', name: 'King' },
      ],
    },
    {
      id: 3,
      className: 'Hand',
      name: 'My Hand',
      children: [{ id: 12, className: 'Card', name: 'Queen' }],
    },
    { id: 4, className: 'Piece', notation: 'a1', attributes: { color: 'red' } },
  ],
};

const STATE = { state: { view: VIEW, customDebug: { seed: 42 } }, flowState: null };

const HISTORY = [
  { name: 'playCard', player: 1, args: {}, timestamp: 1000 },
  { name: 'endTurn', player: 1, args: {}, timestamp: 2000 },
  { name: 'playCard', player: 2, args: {}, timestamp: 3000 },
];

interface Vm {
  activeTab: string;
  actionTraces: unknown[];
  tracesError: string | null;
  tracesLoading: boolean;
  flowContext: unknown;
  flowStateInfo: unknown;
  flowRestrictedActions: Array<{ actionName: string }>;
  trulyAvailableActions: Array<{ actionName: string }>;
  conditionFailedActions: Array<{ actionName: string }>;
  fetchActionTraces: () => Promise<void>;
  fetchFlowState: () => Promise<void>;
  actionHistory: unknown[];
  historyError: string | null;
  fetchHistory: () => Promise<void>;
  logEntries: unknown[];
  logsError: string | null;
  fetchLogs: () => Promise<void>;
  selectedActionIndex: number | null;
  historicalState: unknown;
  historicalStateError: string | null;
  stateDiff: unknown;
  displayedState: unknown;
  isViewingHistory: boolean;
  selectAction: (i: number) => Promise<void>;
  fetchStateAtAction: (i: number) => Promise<void>;
  clearHistoricalState: () => void;
  pendingRewindIndex: number | null;
  pendingRewindDiscardCount: number;
  rewindError: string | null;
  requestRewind: (i: number) => void;
  cancelRewind: () => void;
  confirmRewind: () => Promise<void>;
  deckManipulationError: string | null;
  moveCardToTop: (id: number) => Promise<void>;
  reorderCard: (id: number, target: number) => Promise<void>;
  transferCard: (id: number, deck: number, pos?: 'first' | 'last') => Promise<void>;
  shuffleDeck: (id: number) => Promise<void>;
  moveCardUp: (deck: unknown, id: number) => void;
  moveCardDown: (deck: unknown, id: number) => void;
  transferDialogOpen: boolean;
  transferDialogCardId: number | null;
  transferDialogTargetDeckId: number | null;
  transferDialogPosition: 'first' | 'last';
  openTransferDialog: (cardId: number, sourceDeckId: number) => void;
  closeTransferDialog: () => void;
  confirmTransfer: () => Promise<void>;
  availableTargetContainers: Array<{ id: number }>;
  groupedElements: Record<string, Array<{ id: number }>>;
  filteredElementGroups: Record<string, Array<{ id: number }>>;
  elementSearchQuery: string;
  selectedElementId: number | null;
  selectedElement: unknown;
  selectElement: (el: { id: number }) => void;
  getElementDisplayName: (el: unknown) => string;
  discoveredDecks: Array<{ id: number; name: string; cards: Array<{ id: number }> }>;
  discoveredCardContainers: Array<{ id: number; cardCount: number }>;
  filteredDecks: Array<{ id: number }>;
  deckSearchQuery: string;
  isDeckExpanded: (id: number) => boolean;
  toggleDeck: (id: number) => void;
  selectDeckCard: (deckId: number, cardId: number) => void;
  selectedCard: unknown;
  getCardDisplayName: (card: unknown) => string;
  customDebugData: unknown;
  restartConfirming: boolean;
  handleRestartClick: () => void;
  switchToPlayer: (p: number) => void;
  formatActionName: (n: string) => string;
  formatActionArgs: (a: Record<string, unknown>) => string;
  formatTimestamp: (t?: number) => string;
  formatConditionValue: (v: unknown) => string;
  cardMatchesSearch: (card: unknown, q: string) => boolean;
  expandedPaths: Set<string>;
  toggleExpand: (p: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  copyNodeToClipboard: (v: unknown) => Promise<void>;
  copyToastVisible: boolean;
  copyState: () => void;
  downloadState: () => void;
  copyAvailableActions: () => Promise<void>;
  copyUnavailableActions: () => Promise<void>;
  copyDeckToClipboard: (d: unknown) => Promise<void>;
  copyElementToClipboard: (e: unknown) => Promise<void>;
  formattedState: string;
  panelExpanded: boolean;
  togglePanel: () => void;
}

function mountPanel(handler?: Op, props: Record<string, unknown> = {}) {
  const platformRequest = vi.fn<Op>(
    handler ?? (async () => ({ success: true }))
  );
  const wrapper = mount(DebugPanel, {
    props: {
      state: STATE,
      playerSeat: 1,
      playerCount: 2,
      gameId: 'test-game',
      expanded: true,
      ...props,
    },
    global: { provide: { [GAME_CONTEXT_KEYS.platformRequest as symbol]: platformRequest } },
    attachTo: document.body,
  });
  return { wrapper, platformRequest, vm: wrapper.vm as unknown as Vm };
}

/** Mount with NO host bridge provided. */
function mountBridgeless() {
  const wrapper = mount(DebugPanel, {
    props: { state: STATE, playerSeat: 1, playerCount: 2, gameId: 'g', expanded: true },
    attachTo: document.body,
  });
  return { wrapper, vm: wrapper.vm as unknown as Vm };
}

function callsFor(pr: ReturnType<typeof vi.fn>, op: string) {
  return pr.mock.calls.filter((c) => c[0] === op);
}

/** Let every pending microtask AND the current macrotask settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let mounted: Array<{ unmount: () => void }> = [];
function track<T extends { wrapper: { unmount: () => void } }>(m: T): T {
  mounted.push(m.wrapper);
  return m;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  mounted.forEach((w) => w.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('DebugPanel host bridge', () => {
  it('reports a missing bridge as an actionable error rather than throwing', async () => {
    const { vm } = track({ ...mountBridgeless(), platformRequest: null as never });
    await vm.fetchActionTraces();
    expect(vm.tracesError).toContain('requires a host bridge');
  });

  it('routes every debug op through the injected bridge', async () => {
    const { platformRequest, vm } = track(mountPanel());
    await vm.fetchActionTraces();
    await vm.fetchFlowState();
    await vm.fetchHistory();
    await vm.fetchLogs();
    await vm.shuffleDeck(2);
    const ops = platformRequest.mock.calls.map((c) => c[0]);
    expect(ops).toContain('debug:action-traces');
    expect(ops).toContain('debug:flow-state');
    expect(ops).toContain('debug:history');
    expect(ops).toContain('debug:logs');
    expect(ops).toContain('debug:shuffle-deck');
  });
});

describe('DebugPanel action traces', () => {
  const traces = [
    { actionName: 'zeta', available: true, selections: [] },
    { actionName: 'alpha', available: true, selections: [] },
    { actionName: 'beta', available: false, selections: [] },
  ];

  it('sends the viewing seat and stores traces plus flow context', async () => {
    const { platformRequest, vm } = track(
      mountPanel(async () => ({
        success: true,
        traces,
        flowContext: { flowAllowedActions: ['alpha'], isMyTurn: true, currentPlayer: 1 },
      }))
    );
    await vm.fetchActionTraces();
    expect(callsFor(platformRequest, 'debug:action-traces')[0][1]).toEqual({ player: 1 });
    expect(vm.actionTraces).toHaveLength(3);
    expect(vm.tracesError).toBeNull();
  });

  it('degrades a non-array traces payload to an empty list', async () => {
    const { vm } = track(mountPanel(async () => ({ success: true, traces: 'nope' })));
    await vm.fetchActionTraces();
    expect(vm.actionTraces).toEqual([]);
  });

  it('rejects a malformed flowContext rather than half-populating it', async () => {
    const { vm } = track(
      mountPanel(async () => ({ success: true, traces: [], flowContext: { isMyTurn: true } }))
    );
    await vm.fetchActionTraces();
    expect(vm.flowContext).toBeNull();
  });

  it('surfaces the host error string when success is false', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false, error: 'no traces here' })));
    await vm.fetchActionTraces();
    expect(vm.tracesError).toBe('no traces here');
  });

  it('falls back to a generic message when the host gives no error string', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false })));
    await vm.fetchActionTraces();
    expect(vm.tracesError).toBe('Failed to fetch action traces');
  });

  it('turns a rejected request into an error message and clears loading', async () => {
    const { vm } = track(mountPanel(async () => { throw new Error('socket gone'); }));
    await vm.fetchActionTraces();
    expect(vm.tracesError).toBe('socket gone');
    expect(vm.tracesLoading).toBe(false);
  });

  it('ignores a second fetch while one is in flight', async () => {
    let release: (v: Record<string, unknown>) => void = () => {};
    const { platformRequest, vm } = track(
      mountPanel(() => new Promise<Record<string, unknown>>((r) => { release = r; }))
    );
    const first = vm.fetchActionTraces();
    await vm.fetchActionTraces();
    expect(callsFor(platformRequest, 'debug:action-traces')).toHaveLength(1);
    release({ success: true, traces: [] });
    await first;
  });

  it('partitions traces into truly-available, flow-restricted and failed, each sorted', async () => {
    const { vm } = track(
      mountPanel(async () => ({
        success: true,
        traces,
        flowContext: { flowAllowedActions: ['alpha'], isMyTurn: true },
      }))
    );
    await vm.fetchActionTraces();
    expect(vm.trulyAvailableActions.map((t) => t.actionName)).toEqual(['alpha']);
    expect(vm.flowRestrictedActions.map((t) => t.actionName)).toEqual(['zeta']);
    expect(vm.conditionFailedActions.map((t) => t.actionName)).toEqual(['beta']);
  });

  it('treats every available action as truly available when there is no flow context', async () => {
    const { vm } = track(mountPanel(async () => ({ success: true, traces })));
    await vm.fetchActionTraces();
    expect(vm.trulyAvailableActions.map((t) => t.actionName)).toEqual(['alpha', 'zeta']);
    expect(vm.flowRestrictedActions).toEqual([]);
  });
});

describe('DebugPanel flow state', () => {
  it('stores the host flow description on success', async () => {
    const info = { path: [0], awaiting: {}, description: 'phase: play' };
    const { platformRequest, vm } = track(
      mountPanel(async () => ({ success: true, flowDebugInfo: info }))
    );
    await vm.fetchFlowState();
    expect(callsFor(platformRequest, 'debug:flow-state')[0][1]).toEqual({ player: 1 });
    expect(vm.flowStateInfo).toEqual(info);
  });

  it('clears flow state when the host refuses', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false, error: 'x' })));
    await vm.fetchFlowState();
    expect(vm.flowStateInfo).toBeNull();
  });

  it('clears flow state when the request throws, without surfacing an error', async () => {
    const { vm } = track(mountPanel(async () => { throw new Error('boom'); }));
    await vm.fetchFlowState();
    expect(vm.flowStateInfo).toBeNull();
  });
});

describe('DebugPanel history and logs', () => {
  it('loads history and falls back to an empty list', async () => {
    const { vm } = track(mountPanel(async () => ({ success: true, actionHistory: HISTORY })));
    await vm.fetchHistory();
    expect(vm.actionHistory).toHaveLength(3);
  });

  it('reports the host error for history', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false })));
    await vm.fetchHistory();
    expect(vm.historyError).toBe('Failed to fetch history');
  });

  it('loads log entries', async () => {
    const entries = [{ severity: 'error', message: 'bad', source: 'engine', timestamp: 1 }];
    const { vm } = track(mountPanel(async () => ({ success: true, entries })));
    await vm.fetchLogs();
    expect(vm.logEntries).toEqual(entries);
  });

  it('reports the host error for logs', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false, error: 'no logs' })));
    await vm.fetchLogs();
    expect(vm.logsError).toBe('no logs');
  });
});

describe('DebugPanel tab-driven fetching', () => {
  it('fetches traces and flow state on switching to the actions tab', async () => {
    const { platformRequest, vm } = track(mountPanel(async () => ({ success: true, traces: [] })));
    vm.activeTab = 'actions';
    await nextTick();
    await flush();
    expect(callsFor(platformRequest, 'debug:action-traces')).toHaveLength(1);
    expect(callsFor(platformRequest, 'debug:flow-state')).toHaveLength(1);
  });

  it('fetches history on switching to the history tab', async () => {
    const { platformRequest, vm } = track(mountPanel(async () => ({ success: true })));
    vm.activeTab = 'history';
    await nextTick();
    expect(callsFor(platformRequest, 'debug:history')).toHaveLength(1);
  });

  it('fetches logs on switching to the logs tab', async () => {
    const { platformRequest, vm } = track(mountPanel(async () => ({ success: true })));
    vm.activeTab = 'logs';
    await nextTick();
    expect(callsFor(platformRequest, 'debug:logs')).toHaveLength(1);
  });

  it('does not refetch a tab that was loaded less than two seconds ago', async () => {
    const { platformRequest, wrapper, vm } = track(
      mountPanel(async () => ({ success: true, actionHistory: HISTORY }))
    );
    vm.activeTab = 'history';
    await nextTick();
    await flush();
    vm.activeTab = 'state';
    await nextTick();
    vm.activeTab = 'history';
    await nextTick();
    expect(callsFor(platformRequest, 'debug:history')).toHaveLength(1);
    void wrapper;
  });

  it('refetches the active tab when the game state changes', async () => {
    const { platformRequest, wrapper, vm } = track(mountPanel(async () => ({ success: true })));
    vm.activeTab = 'logs';
    await nextTick();
    await flush();
    await wrapper.setProps({ state: { ...STATE } });
    await nextTick();
    await flush();
    expect(callsFor(platformRequest, 'debug:logs').length).toBeGreaterThan(1);
  });

  it('does not fetch for a tab that is not active when state changes', async () => {
    const { platformRequest, wrapper } = track(mountPanel(async () => ({ success: true })));
    await wrapper.setProps({ state: { ...STATE } });
    await nextTick();
    expect(callsFor(platformRequest, 'debug:history')).toHaveLength(0);
  });
});

describe('DebugPanel time travel', () => {
  const handler: Op = async (op) => {
    if (op === 'debug:state-at') return { success: true, state: { view: VIEW } };
    if (op === 'debug:state-diff') return { success: true, diff: { added: [] } };
    if (op === 'debug:history') return { success: true, actionHistory: HISTORY };
    return { success: true };
  };

  it('requests the state and the diff from the previous action in one go', async () => {
    const { platformRequest, vm } = track(mountPanel(handler));
    await vm.fetchStateAtAction(2);
    expect(callsFor(platformRequest, 'debug:state-at')[0][1]).toEqual({ actionIndex: 2, player: 1 });
    expect(callsFor(platformRequest, 'debug:state-diff')[0][1]).toEqual({
      fromIndex: 1,
      toIndex: 2,
      player: 1,
    });
  });

  it('asks for no diff at action index zero', async () => {
    const { platformRequest, vm } = track(mountPanel(handler));
    await vm.fetchStateAtAction(0);
    expect(callsFor(platformRequest, 'debug:state-diff')).toHaveLength(0);
    expect(vm.stateDiff).toBeNull();
  });

  it('emits time-travel with the historical state, index and diff', async () => {
    const { wrapper, vm } = track(mountPanel(handler));
    await vm.fetchStateAtAction(1);
    const emitted = wrapper.emitted('time-travel');
    expect(emitted).toBeTruthy();
    expect(emitted![0][1]).toBe(1);
    expect(emitted![0][2]).toEqual({ added: [] });
  });

  it('emits a live-state time-travel and records the error when the fetch fails', async () => {
    const { wrapper, vm } = track(mountPanel(async () => { throw new Error('gone'); }));
    await vm.fetchStateAtAction(1);
    expect(vm.historicalStateError).toBe('gone');
    expect(vm.historicalState).toBeNull();
    expect(wrapper.emitted('time-travel')![0]).toEqual([null, null, null]);
  });

  it('shows the historical state in place of the live one while viewing history', async () => {
    const { vm } = track(mountPanel(handler));
    await vm.fetchStateAtAction(1);
    vm.selectedActionIndex = 1;
    await nextTick();
    expect(vm.isViewingHistory).toBe(true);
    expect(vm.displayedState).toEqual({ state: { view: VIEW }, flowState: null });
  });

  it('returns to live state on clearHistoricalState', async () => {
    const { wrapper, vm } = track(mountPanel(handler));
    await vm.fetchStateAtAction(1);
    vm.selectedActionIndex = 1;
    vm.clearHistoricalState();
    await nextTick();
    expect(vm.isViewingHistory).toBe(false);
    expect(vm.displayedState).toStrictEqual(STATE);
    expect(wrapper.emitted('time-travel')!.at(-1)).toEqual([null, null, null]);
  });

  it('selectAction on the already-selected index returns to live', async () => {
    const { vm } = track(mountPanel(handler));
    await vm.selectAction(1);
    expect(vm.selectedActionIndex).toBe(1);
    await vm.selectAction(1);
    expect(vm.selectedActionIndex).toBeNull();
  });

  it('selectAction on the index one past the end returns to live', async () => {
    const { vm } = track(mountPanel(handler));
    await vm.fetchHistory();
    await vm.selectAction(HISTORY.length);
    expect(vm.selectedActionIndex).toBeNull();
  });
});

describe('DebugPanel rewind', () => {
  const handler: Op = async (op) => {
    if (op === 'debug:history') return { success: true, actionHistory: HISTORY };
    return { success: true };
  };

  it('arms an in-panel confirmation and sends nothing until confirmed', async () => {
    const { platformRequest, vm } = track(mountPanel(handler));
    await vm.fetchHistory();
    vm.requestRewind(1);
    expect(vm.pendingRewindIndex).toBe(1);
    expect(callsFor(platformRequest, 'debug:rewind')).toHaveLength(0);
  });

  it('counts how many actions the pending rewind would discard', async () => {
    const { vm } = track(mountPanel(handler));
    await vm.fetchHistory();
    vm.requestRewind(1);
    await nextTick();
    expect(vm.pendingRewindDiscardCount).toBe(2);
  });

  it('cancelling clears the pending index and sends nothing', async () => {
    const { platformRequest, vm } = track(mountPanel(handler));
    vm.requestRewind(1);
    vm.cancelRewind();
    expect(vm.pendingRewindIndex).toBeNull();
    expect(callsFor(platformRequest, 'debug:rewind')).toHaveLength(0);
  });

  it('confirming sends the rewind, clears time travel and reloads history', async () => {
    const { platformRequest, wrapper, vm } = track(mountPanel(handler));
    vm.selectedActionIndex = 1;
    vm.requestRewind(1);
    await vm.confirmRewind();
    expect(callsFor(platformRequest, 'debug:rewind')[0][1]).toEqual({ actionIndex: 1 });
    expect(vm.selectedActionIndex).toBeNull();
    expect(callsFor(platformRequest, 'debug:history')).toHaveLength(1);
    expect(wrapper.emitted('time-travel')!.at(-1)).toEqual([null, null, null]);
  });

  it('confirming with nothing pending does nothing', async () => {
    const { platformRequest, vm } = track(mountPanel(handler));
    await vm.confirmRewind();
    expect(callsFor(platformRequest, 'debug:rewind')).toHaveLength(0);
  });

  it('surfaces a refused rewind and leaves history alone', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false, error: 'too far back' })));
    vm.requestRewind(1);
    await vm.confirmRewind();
    expect(vm.rewindError).toBe('too far back');
  });

  it('surfaces a thrown rewind', async () => {
    const { vm } = track(mountPanel(async () => { throw new Error('bridge down'); }));
    vm.requestRewind(1);
    await vm.confirmRewind();
    expect(vm.rewindError).toBe('bridge down');
  });
});

describe('DebugPanel deck edits', () => {
  it('sends each edit with its own op and payload', async () => {
    const { platformRequest, vm } = track(mountPanel());
    await vm.moveCardToTop(10);
    await vm.reorderCard(10, 2);
    await vm.transferCard(10, 3, 'last');
    await vm.shuffleDeck(2);
    expect(callsFor(platformRequest, 'debug:move-to-top')[0][1]).toEqual({ cardId: 10 });
    expect(callsFor(platformRequest, 'debug:reorder-card')[0][1]).toEqual({ cardId: 10, targetIndex: 2 });
    expect(callsFor(platformRequest, 'debug:transfer-card')[0][1]).toEqual({
      cardId: 10,
      targetDeckId: 3,
      position: 'last',
    });
    expect(callsFor(platformRequest, 'debug:shuffle-deck')[0][1]).toEqual({ deckId: 2 });
  });

  it('defaults a transfer to the first position', async () => {
    const { platformRequest, vm } = track(mountPanel());
    await vm.transferCard(10, 3);
    expect(callsFor(platformRequest, 'debug:transfer-card')[0][1]).toMatchObject({ position: 'first' });
  });

  it('uses the per-edit fallback message when the host gives no error', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false })));
    await vm.moveCardToTop(10);
    expect(vm.deckManipulationError).toBe('Failed to move card');
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).toBe('Failed to shuffle deck');
  });

  it('prefers the host error string over the fallback', async () => {
    const { vm } = track(mountPanel(async () => ({ success: false, error: 'card is face down' })));
    await vm.reorderCard(10, 1);
    expect(vm.deckManipulationError).toBe('card is face down');
  });

  it('turns a thrown edit into a message', async () => {
    const { vm } = track(mountPanel(async () => { throw new Error('bridge down'); }));
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).toBe('bridge down');
  });

  it('clears the previous error when a later edit succeeds', async () => {
    let fail = true;
    const { vm } = track(mountPanel(async () => (fail ? { success: false } : { success: true })));
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).not.toBeNull();
    fail = false;
    await vm.shuffleDeck(2);
    expect(vm.deckManipulationError).toBeNull();
  });

  it('moveCardUp reorders to the preceding index and refuses at the top', async () => {
    const { platformRequest, vm } = track(mountPanel());
    const deck = vm.discoveredDecks[0];
    vm.moveCardUp(deck, 11);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')[0][1]).toEqual({ cardId: 11, targetIndex: 0 });
    vm.moveCardUp(deck, 10);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')).toHaveLength(1);
  });

  it('moveCardDown reorders to the following index and refuses at the bottom', async () => {
    const { platformRequest, vm } = track(mountPanel());
    const deck = vm.discoveredDecks[0];
    vm.moveCardDown(deck, 10);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')[0][1]).toEqual({ cardId: 10, targetIndex: 1 });
    vm.moveCardDown(deck, 11);
    await nextTick();
    expect(callsFor(platformRequest, 'debug:reorder-card')).toHaveLength(1);
  });
});

describe('DebugPanel transfer dialog', () => {
  it('opens with a clean target and first position', async () => {
    const { vm } = track(mountPanel());
    vm.transferDialogTargetDeckId = 99;
    vm.openTransferDialog(10, 2);
    expect(vm.transferDialogOpen).toBe(true);
    expect(vm.transferDialogCardId).toBe(10);
    expect(vm.transferDialogTargetDeckId).toBeNull();
    expect(vm.transferDialogPosition).toBe('first');
  });

  it('offers every card container except the source', async () => {
    const { vm } = track(mountPanel());
    vm.openTransferDialog(10, 2);
    await nextTick();
    const ids = vm.availableTargetContainers.map((c) => c.id);
    expect(ids).not.toContain(2);
    expect(ids).toContain(3);
  });

  it('sends nothing and stays open when no target is chosen', async () => {
    const { platformRequest, vm } = track(mountPanel());
    vm.openTransferDialog(10, 2);
    await vm.confirmTransfer();
    expect(callsFor(platformRequest, 'debug:transfer-card')).toHaveLength(0);
    expect(vm.transferDialogOpen).toBe(true);
  });

  it('sends the transfer and closes once a target is chosen', async () => {
    const { platformRequest, vm } = track(mountPanel());
    vm.openTransferDialog(10, 2);
    vm.transferDialogTargetDeckId = 3;
    vm.transferDialogPosition = 'last';
    await vm.confirmTransfer();
    expect(callsFor(platformRequest, 'debug:transfer-card')[0][1]).toEqual({
      cardId: 10,
      targetDeckId: 3,
      position: 'last',
    });
    expect(vm.transferDialogOpen).toBe(false);
    expect(vm.transferDialogCardId).toBeNull();
  });
});

describe('DebugPanel view-tree derivations', () => {
  it('groups every element with a numeric id by class name', async () => {
    const { vm } = track(mountPanel());
    expect(Object.keys(vm.groupedElements).sort()).toEqual(['Board', 'Card', 'Hand', 'MainDeck', 'Piece']);
    expect(vm.groupedElements.Card.map((e) => e.id).sort()).toEqual([10, 11, 12]);
  });

  it('filters element groups by name, notation, class and id', async () => {
    const { vm } = track(mountPanel());
    vm.elementSearchQuery = 'a1';
    await nextTick();
    expect(Object.keys(vm.filteredElementGroups)).toEqual(['Piece']);
    vm.elementSearchQuery = '12';
    await nextTick();
    expect(Object.keys(vm.filteredElementGroups)).toEqual(['Card']);
  });

  it('selecting an element highlights it and selecting it again clears it', async () => {
    const { wrapper, vm } = track(mountPanel());
    const piece = vm.groupedElements.Piece[0];
    vm.selectElement(piece);
    await nextTick();
    expect(vm.selectedElementId).toBe(4);
    expect((vm.selectedElement as { id: number }).id).toBe(4);
    vm.selectElement(piece);
    expect(vm.selectedElementId).toBeNull();
    expect(wrapper.emitted('highlight-element')).toEqual([[4], [null]]);
  });

  it('prefers notation, then name, then id for an element label', async () => {
    const { vm } = track(mountPanel());
    expect(vm.getElementDisplayName({ id: 4, notation: 'a1', name: 'x' })).toBe('a1');
    expect(vm.getElementDisplayName({ id: 4, name: 'x' })).toBe('x');
    expect(vm.getElementDisplayName({ id: 4 })).toBe('#4');
  });

  it('discovers decks by $type or a Deck-ish class name, with their cards', async () => {
    const { vm } = track(mountPanel());
    expect(vm.discoveredDecks.map((d) => d.id)).toEqual([2]);
    expect(vm.discoveredDecks[0].cards.map((c) => c.id)).toEqual([10, 11]);
  });

  it('discovers every container that holds card-like children', async () => {
    const { vm } = track(mountPanel());
    const byId = Object.fromEntries(vm.discoveredCardContainers.map((c) => [c.id, c.cardCount]));
    expect(byId[2]).toBe(2);
    expect(byId[3]).toBe(1);
    expect(byId[1]).toBe(3);
  });

  it('matches decks whose cards match, and auto-expands those decks', async () => {
    const { vm } = track(mountPanel());
    vm.deckSearchQuery = 'Ace';
    await nextTick();
    expect(vm.filteredDecks.map((d) => d.id)).toEqual([2]);
    expect(vm.isDeckExpanded(2)).toBe(true);
  });

  it('drops decks that match neither themselves nor any card', async () => {
    const { vm } = track(mountPanel());
    vm.deckSearchQuery = 'nothing-here';
    await nextTick();
    expect(vm.filteredDecks).toEqual([]);
  });

  it('toggles deck expansion by hand', async () => {
    const { vm } = track(mountPanel());
    expect(vm.isDeckExpanded(2)).toBe(false);
    vm.toggleDeck(2);
    await nextTick();
    expect(vm.isDeckExpanded(2)).toBe(true);
    vm.toggleDeck(2);
    await nextTick();
    expect(vm.isDeckExpanded(2)).toBe(false);
  });

  it('selects and deselects a card inside a deck', async () => {
    const { vm } = track(mountPanel());
    vm.selectDeckCard(2, 10);
    await nextTick();
    expect((vm.selectedCard as { id: number }).id).toBe(10);
    vm.selectDeckCard(2, 10);
    await nextTick();
    expect(vm.selectedCard).toBeNull();
  });

  it('prefers notation, then name, then id for a card label', async () => {
    const { vm } = track(mountPanel());
    expect(vm.getCardDisplayName({ id: 10, notation: 'AS', name: 'Ace' })).toBe('AS');
    expect(vm.getCardDisplayName({ id: 11, name: 'King' })).toBe('King');
    expect(vm.getCardDisplayName({ id: 12 })).toBe('#12');
  });

  it('exposes the game-supplied custom debug data', async () => {
    const { vm } = track(mountPanel());
    expect(vm.customDebugData).toEqual({ seed: 42 });
  });

  it('derives elements and decks from the historical state while time travelling', async () => {
    const alt = { id: 90, className: 'Board', children: [{ id: 91, className: 'Token' }] };
    const { vm } = track(
      mountPanel(async (op) =>
        op === 'debug:state-at' ? { success: true, state: { view: alt } } : { success: true, diff: null }
      )
    );
    await vm.fetchStateAtAction(0);
    vm.selectedActionIndex = 0;
    await nextTick();
    expect(Object.keys(vm.groupedElements).sort()).toEqual(['Board', 'Token']);
  });
});

describe('DebugPanel controls tab', () => {
  it('emits switch-player', async () => {
    const { wrapper, vm } = track(mountPanel());
    vm.switchToPlayer(2);
    expect(wrapper.emitted('switch-player')).toEqual([[2]]);
  });

  it('arms restart on the first click and fires on the second', async () => {
    const { wrapper, vm } = track(mountPanel());
    vm.handleRestartClick();
    expect(vm.restartConfirming).toBe(true);
    expect(wrapper.emitted('restart-game')).toBeUndefined();
    vm.handleRestartClick();
    expect(vm.restartConfirming).toBe(false);
    expect(wrapper.emitted('restart-game')).toEqual([[]]);
  });

  it('disarms restart after five seconds', async () => {
    vi.useFakeTimers();
    const { wrapper, vm } = track(mountPanel());
    vm.handleRestartClick();
    expect(vm.restartConfirming).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(vm.restartConfirming).toBe(false);
    expect(wrapper.emitted('restart-game')).toBeUndefined();
  });
});

describe('DebugPanel panel chrome', () => {
  it('toggles and reports its expanded state', async () => {
    const { wrapper, vm } = track(mountPanel(undefined, { expanded: false }));
    expect(vm.panelExpanded).toBe(false);
    vm.togglePanel();
    expect(vm.panelExpanded).toBe(true);
    expect(wrapper.emitted('update:expanded')).toEqual([[true]]);
  });

  it('follows the expanded prop', async () => {
    const { wrapper, vm } = track(mountPanel(undefined, { expanded: false }));
    await wrapper.setProps({ expanded: true });
    expect(vm.panelExpanded).toBe(true);
  });
});

describe('DebugPanel state tree', () => {
  it('starts with only the root expanded', async () => {
    const { vm } = track(mountPanel());
    expect([...vm.expandedPaths]).toEqual(['root']);
  });

  it('toggles a path on and off', async () => {
    const { vm } = track(mountPanel());
    vm.toggleExpand('root.state');
    expect(vm.expandedPaths.has('root.state')).toBe(true);
    vm.toggleExpand('root.state');
    expect(vm.expandedPaths.has('root.state')).toBe(false);
  });

  it('expandAll opens every object path in the live state, and collapseAll returns to root', async () => {
    const { vm } = track(mountPanel(undefined, { state: { a: { b: { c: 1 } } } }));
    vm.expandAll();
    expect(vm.expandedPaths.has('root.a.b')).toBe(true);
    vm.collapseAll();
    expect([...vm.expandedPaths]).toEqual(['root']);
  });

  it('formats condition values for the actions tab', async () => {
    const { vm } = track(mountPanel());
    expect(vm.formatConditionValue(null)).toBe('null');
    expect(vm.formatConditionValue(undefined)).toBe('undefined');
    expect(vm.formatConditionValue(false)).toBe('false');
    expect(vm.formatConditionValue(3)).toBe('3');
    expect(vm.formatConditionValue('x')).toBe('"x"');
    expect(vm.formatConditionValue([1, 2, 3])).toBe('[3 items]');
    expect(vm.formatConditionValue({ a: 1 })).toBe('{"a":1}');
  });

  it('formats action names, args and timestamps for the history tab', async () => {
    const { vm } = track(mountPanel());
    expect(vm.formatActionName('playCard')).toBe('Play Card');
    expect(vm.formatActionArgs({})).toBe('');
    expect(vm.formatActionArgs({ a: 1, b: undefined, c: null })).toBe('a: 1');
    expect(vm.formatActionArgs({ card: { __elementRef: 'AS' } })).toBe('card: AS');
    expect(vm.formatActionArgs({ card: { __elementId: 10 } })).toBe('card: #10');
    expect(vm.formatActionArgs({ card: { rank: 1 } })).toBe('card: {"rank":1}');
    expect(vm.formatTimestamp()).toBe('');
    expect(vm.formatTimestamp(1000)).toBe(new Date(1000).toLocaleTimeString());
  });

  it('matches cards by name, notation, class and id, and never on an empty query', async () => {
    const { vm } = track(mountPanel());
    const card = { id: 10, name: 'Ace', notation: 'AS', className: 'Card' };
    expect(vm.cardMatchesSearch(card, '')).toBe(false);
    expect(vm.cardMatchesSearch(card, 'ace')).toBe(true);
    expect(vm.cardMatchesSearch(card, 'as')).toBe(true);
    expect(vm.cardMatchesSearch(card, 'card')).toBe(true);
    expect(vm.cardMatchesSearch(card, '10')).toBe(true);
    expect(vm.cardMatchesSearch(card, 'zzz')).toBe(false);
  });
});

describe('DebugPanel clipboard and download', () => {
  it('copies a node as pretty JSON and shows a toast that clears itself', async () => {
    vi.useFakeTimers();
    const { vm } = track(mountPanel());
    await vm.copyNodeToClipboard({ a: 1 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(vm.copyToastVisible).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(vm.copyToastVisible).toBe(false);
  });

  it('survives a clipboard the browser refuses', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'));
    const { vm } = track(mountPanel());
    await expect(vm.copyNodeToClipboard({ a: 1 })).resolves.toBeUndefined();
    expect(vm.copyToastVisible).toBe(false);
    err.mockRestore();
  });

  it('copies the formatted state', async () => {
    const { vm } = track(mountPanel(undefined, { state: { a: 1 } }));
    vm.copyState();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it('reports unformattable state rather than throwing', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const { vm } = track(mountPanel(undefined, { state: cyclic }));
    expect(vm.formattedState).toBe('Error formatting state');
  });

  it('says so when there is no state at all', async () => {
    const { vm } = track(mountPanel(undefined, { state: null }));
    expect(vm.formattedState).toBe('No state available');
  });

  it('downloads the state under the game id', async () => {
    const createURL = vi.fn(() => 'blob:x');
    const revokeURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeURL, configurable: true });
    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') el.click = () => clicked.push((el as HTMLAnchorElement).download);
      return el;
    });
    const { vm } = track(mountPanel(undefined, { state: { a: 1 }, gameId: 'abc' }));
    vm.downloadState();
    expect(clicked).toEqual(['game-state-abc.json']);
    expect(revokeURL).toHaveBeenCalledWith('blob:x');
    vi.mocked(document.createElement).mockRestore();
  });

  it('copies available and unavailable action traces separately', async () => {
    const traces = [
      { actionName: 'a', available: true, selections: [] },
      { actionName: 'b', available: false, selections: [] },
    ];
    const { vm } = track(mountPanel(async () => ({ success: true, traces })));
    await vm.fetchActionTraces();
    await vm.copyAvailableActions();
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(JSON.stringify([traces[0]], null, 2));
    await vm.copyUnavailableActions();
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(JSON.stringify([traces[1]], null, 2));
  });

  it('copies a deck with its cards flattened into the payload', async () => {
    const { vm } = track(mountPanel());
    await vm.copyDeckToClipboard(vm.discoveredDecks[0]);
    const written = JSON.parse(
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    );
    expect(written.id).toBe(2);
    expect(written.cards.map((c: { id: number }) => c.id)).toEqual([10, 11]);
  });

  it('copies an element without its children', async () => {
    const { vm } = track(mountPanel());
    await vm.copyElementToClipboard(vm.groupedElements.MainDeck[0]);
    const written = JSON.parse(
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    );
    expect(written.children).toBeUndefined();
    expect(written.id).toBe(2);
  });
});

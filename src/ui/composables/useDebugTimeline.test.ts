import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useDebugTimeline } from './useDebugTimeline.js';
import type { DebugBridge, SerializedAction } from './useDebugBridge.js';

const HISTORY: SerializedAction[] = [
  { name: 'playCard', player: 1, args: {}, timestamp: 1000 },
  { name: 'endTurn', player: 1, args: {}, timestamp: 2000 },
  { name: 'playCard', player: 2, args: {}, timestamp: 3000 },
];

const DIFF = { added: [1], removed: [], changed: [], fromIndex: 0, toIndex: 1 };

function stubBridge(over: Partial<DebugBridge> = {}): DebugBridge {
  return {
    actionTraces: vi.fn(async () => ({ traces: [], flowContext: null })),
    flowState: vi.fn(async () => null),
    history: vi.fn(async () => HISTORY),
    logs: vi.fn(async () => []),
    stateAt: vi.fn(async () => ({ phase: 'play' })),
    stateDiff: vi.fn(async () => DIFF),
    rewind: vi.fn(async () => {}),
    moveCardToTop: vi.fn(async () => {}),
    reorderCard: vi.fn(async () => {}),
    transferCard: vi.fn(async () => {}),
    shuffleDeck: vi.fn(async () => {}),
    ...over,
  };
}

function setup(over: Partial<DebugBridge> = {}, seat = 1) {
  const bridge = stubBridge(over);
  const onTimeTravel = vi.fn();
  const timeline = useDebugTimeline({ bridge, playerSeat: ref(seat), onTimeTravel });
  return { bridge, onTimeTravel, timeline };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('history loading', () => {
  it('stores what the host reports', async () => {
    const { timeline } = setup();
    await timeline.fetchHistory();
    expect(timeline.actionHistory.value).toEqual(HISTORY);
    expect(timeline.historyError.value).toBeNull();
    expect(timeline.historyLoading.value).toBe(false);
  });

  it('turns a refusal into a message and clears loading', async () => {
    const { timeline } = setup({ history: vi.fn(async () => { throw new Error('no history'); }) });
    await timeline.fetchHistory();
    expect(timeline.historyError.value).toBe('no history');
    expect(timeline.historyLoading.value).toBe(false);
  });

  it('describes a non-Error rejection rather than showing "undefined"', async () => {
    const { timeline } = setup({ history: vi.fn(async () => { throw 'nope'; }) });
    await timeline.fetchHistory();
    expect(timeline.historyError.value).toBe('Unknown error');
  });

  it('clears a previous error on a later success', async () => {
    let fail = true;
    const { timeline } = setup({
      history: vi.fn(async () => {
        if (fail) throw new Error('no history');
        return HISTORY;
      }),
    });
    await timeline.fetchHistory();
    expect(timeline.historyError.value).not.toBeNull();
    fail = false;
    await timeline.fetchHistory();
    expect(timeline.historyError.value).toBeNull();
  });

  it('ignores a second load while one is in flight', async () => {
    let release: (v: SerializedAction[]) => void = () => {};
    const history = vi.fn(() => new Promise<SerializedAction[]>((r) => { release = r; }));
    const { timeline } = setup({ history });
    const first = timeline.fetchHistory();
    await timeline.fetchHistory();
    expect(history).toHaveBeenCalledTimes(1);
    release(HISTORY);
    await first;
  });
});

describe('staleness', () => {
  it('reloads when nothing has been loaded yet', async () => {
    const { bridge, timeline } = setup();
    await timeline.refreshHistoryIfStale(2000);
    expect(bridge.history).toHaveBeenCalledTimes(1);
  });

  it('does not reload data fetched moments ago', async () => {
    const { bridge, timeline } = setup();
    await timeline.fetchHistory();
    await timeline.refreshHistoryIfStale(2000);
    expect(bridge.history).toHaveBeenCalledTimes(1);
  });

  it('reloads once the data is older than the window', async () => {
    vi.useFakeTimers();
    const { bridge, timeline } = setup();
    await timeline.fetchHistory();
    vi.setSystemTime(Date.now() + 2001);
    await timeline.refreshHistoryIfStale(2000);
    expect(bridge.history).toHaveBeenCalledTimes(2);
  });

  it('does not mark a failed load as fresh', async () => {
    const history = vi.fn(async () => { throw new Error('down'); });
    const { timeline } = setup({ history });
    await timeline.fetchHistory();
    await timeline.refreshHistoryIfStale(2000);
    expect(history).toHaveBeenCalledTimes(2);
  });
});

describe('time travel', () => {
  it('reads the state and the diff that produced it, for the viewing seat', async () => {
    const { bridge, timeline } = setup({}, 3);
    await timeline.fetchStateAtAction(5);
    expect(bridge.stateAt).toHaveBeenCalledWith(5, 3);
    expect(bridge.stateDiff).toHaveBeenCalledWith(4, 5, 3);
  });

  it('asks for no diff at the first action, which has no predecessor', async () => {
    const { bridge, timeline } = setup();
    await timeline.fetchStateAtAction(0);
    expect(bridge.stateDiff).not.toHaveBeenCalled();
    expect(timeline.stateDiff.value).toBeNull();
  });

  it('tells the shell which state to render', async () => {
    const { onTimeTravel, timeline } = setup();
    await timeline.fetchStateAtAction(1);
    expect(onTimeTravel).toHaveBeenCalledWith({ phase: 'play' }, 1, DIFF);
  });

  it('sends the shell back to live when the state cannot be read', async () => {
    const { onTimeTravel, timeline } = setup({
      stateAt: vi.fn(async () => { throw new Error('too far back'); }),
    });
    await timeline.fetchStateAtAction(1);
    expect(timeline.historicalStateError.value).toBe('too far back');
    expect(timeline.historicalState.value).toBeNull();
    expect(timeline.stateDiff.value).toBeNull();
    expect(onTimeTravel).toHaveBeenCalledWith(null, null, null);
  });

  it('keeps the historical state when only the diff is unavailable', async () => {
    const { timeline } = setup({ stateDiff: vi.fn(async () => null) });
    await timeline.fetchStateAtAction(1);
    expect(timeline.historicalState.value).toEqual({ phase: 'play' });
    expect(timeline.stateDiff.value).toBeNull();
    expect(timeline.historicalStateError.value).toBeNull();
  });

  it('fails the whole read when the diff request itself breaks', async () => {
    const { timeline } = setup({
      stateDiff: vi.fn(async () => { throw new Error('socket closed'); }),
    });
    await timeline.fetchStateAtAction(1);
    expect(timeline.historicalStateError.value).toBe('socket closed');
    expect(timeline.historicalState.value).toBeNull();
  });

  it('reports whether it is time travelling', async () => {
    const { timeline } = setup();
    expect(timeline.isViewingHistory.value).toBe(false);
    await timeline.selectAction(1);
    await nextTick();
    expect(timeline.isViewingHistory.value).toBe(true);
  });

  it('returns to live, clearing everything and telling the shell', async () => {
    const { onTimeTravel, timeline } = setup();
    await timeline.selectAction(1);
    onTimeTravel.mockClear();
    timeline.clearHistoricalState();
    expect(timeline.selectedActionIndex.value).toBeNull();
    expect(timeline.historicalState.value).toBeNull();
    expect(timeline.stateDiff.value).toBeNull();
    expect(onTimeTravel).toHaveBeenCalledWith(null, null, null);
  });

  it('re-picking the current action returns to live', async () => {
    const { timeline } = setup();
    await timeline.selectAction(1);
    expect(timeline.selectedActionIndex.value).toBe(1);
    await timeline.selectAction(1);
    expect(timeline.selectedActionIndex.value).toBeNull();
  });

  it('picking the index one past the end returns to live, because that IS live', async () => {
    const { bridge, timeline } = setup();
    await timeline.fetchHistory();
    await timeline.selectAction(HISTORY.length);
    expect(timeline.selectedActionIndex.value).toBeNull();
    expect(bridge.stateAt).not.toHaveBeenCalled();
  });
});

describe('rewind', () => {
  it('opens a confirmation without sending anything', async () => {
    const { bridge, timeline } = setup();
    timeline.requestRewind(1);
    expect(timeline.pendingRewindIndex.value).toBe(1);
    expect(bridge.rewind).not.toHaveBeenCalled();
  });

  it('clears a stale error when a new confirmation opens', async () => {
    const { timeline } = setup({ rewind: vi.fn(async () => { throw new Error('nope'); }) });
    timeline.requestRewind(1);
    await timeline.confirmRewind();
    expect(timeline.rewindError.value).toBe('nope');
    timeline.requestRewind(2);
    expect(timeline.rewindError.value).toBeNull();
  });

  it('says how many actions would be discarded, and nothing when none is pending', async () => {
    const { timeline } = setup();
    await timeline.fetchHistory();
    expect(timeline.pendingRewindDiscardCount.value).toBe(0);
    timeline.requestRewind(1);
    await nextTick();
    expect(timeline.pendingRewindDiscardCount.value).toBe(2);
  });

  it('cancelling sends nothing', async () => {
    const { bridge, timeline } = setup();
    timeline.requestRewind(1);
    timeline.cancelRewind();
    expect(timeline.pendingRewindIndex.value).toBeNull();
    expect(bridge.rewind).not.toHaveBeenCalled();
  });

  it('confirming rewinds, returns to live and reloads the shortened history', async () => {
    const { bridge, onTimeTravel, timeline } = setup();
    await timeline.selectAction(1);
    timeline.requestRewind(1);
    await timeline.confirmRewind();
    expect(bridge.rewind).toHaveBeenCalledWith(1);
    expect(timeline.selectedActionIndex.value).toBeNull();
    expect(bridge.history).toHaveBeenCalledTimes(1);
    expect(onTimeTravel).toHaveBeenLastCalledWith(null, null, null);
    expect(timeline.rewindLoading.value).toBe(false);
  });

  it('confirming with nothing pending does nothing at all', async () => {
    const { bridge, timeline } = setup();
    await timeline.confirmRewind();
    expect(bridge.rewind).not.toHaveBeenCalled();
  });

  it('a refused rewind leaves the timeline where it was', async () => {
    const { bridge, timeline } = setup({
      rewind: vi.fn(async () => { throw new Error('too far back'); }),
    });
    await timeline.selectAction(1);
    timeline.requestRewind(1);
    await timeline.confirmRewind();
    expect(timeline.rewindError.value).toBe('too far back');
    expect(timeline.selectedActionIndex.value).toBe(1);
    expect(bridge.history).not.toHaveBeenCalled();
  });

  it('describes a non-Error rejection', async () => {
    const { timeline } = setup({ rewind: vi.fn(async () => { throw 'nope'; }) });
    timeline.requestRewind(1);
    await timeline.confirmRewind();
    expect(timeline.rewindError.value).toBe('Rewind failed');
  });

  it('closes the confirmation before the request goes out, so it cannot fire twice', async () => {
    let release: () => void = () => {};
    const rewind = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const { timeline } = setup({ rewind });
    timeline.requestRewind(1);
    const pending = timeline.confirmRewind();
    expect(timeline.pendingRewindIndex.value).toBeNull();
    await timeline.confirmRewind();
    expect(rewind).toHaveBeenCalledTimes(1);
    release();
    await pending;
  });
});

describe('the seat the timeline reads for', () => {
  it('follows the seat as it changes', async () => {
    const bridge = stubBridge();
    const playerSeat = ref(1);
    const timeline = useDebugTimeline({ bridge, playerSeat, onTimeTravel: () => {} });
    await timeline.fetchStateAtAction(2);
    expect(bridge.stateAt).toHaveBeenLastCalledWith(2, 1);
    playerSeat.value = 2;
    await timeline.fetchStateAtAction(2);
    expect(bridge.stateAt).toHaveBeenLastCalledWith(2, 2);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

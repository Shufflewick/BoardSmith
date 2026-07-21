// @vitest-environment jsdom
/**
 * GameShell — LIBX-04 (D31): time-travel debug view `#game-board` desync (164-04).
 *
 * Bug: the board `:state` slot/prop was ALWAYS live (`:state="state"`) while
 * `:game-view` was already historical-aware (`gameView` reads `timeTravelState`
 * when set). A board click during time-travel could therefore commit against the
 * LIVE engine even while the board visually showed historical state.
 *
 * Defense in depth (per 164-CONTEXT.md):
 *   (a) `displayedState` computed (mirrors `gameView`'s existing pattern) re-wraps
 *       the historical `PlayerGameState` into a `GameState`-shaped object, used at
 *       ALL THREE `:state` sites: #sidebar-extra, the dynamic-component board
 *       branch, and the `#game-board` slot fallback branch.
 *   (b) `useBoardActionBridge`'s four mutating functions (startAction,
 *       executeAction, setSelectionValue, toggleMultiSelectValue) early-return
 *       when `isViewingHistory` is true — an inert no-op, no live-engine mutation,
 *       independent of the display fix.
 *
 * Two testing strategies, matching this codebase's established convention for
 * GameShell-derived tests (see GameShell.ia.test.ts, GameShell.action-panel-
 * suppression.test.ts): GameShell itself requires full WS client setup to mount,
 * so (1) a harness component mirrors displayedState's exact computed logic and
 * BOTH board-render branches (Pitfall 3: dynamic-component AND slot paths), and
 * (2) the action-bridge guard is tested directly against the REAL
 * useBoardActionBridge composable (no harness — the actual production code),
 * exactly like the existing useBoardActionBridge.test.ts does.
 */
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, ref, computed, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBoardInteraction } from '../composables/useBoardInteraction.js';
import { useBoardActionBridge } from '../composables/useBoardActionBridge.js';
import type {
  UseActionControllerReturn,
  PickMetadata,
  ValidElement,
} from '../composables/useActionControllerTypes.js';

// ── (1) displayedState computed — both board-render branches ─────────────────

interface FakeGameState {
  flowState: unknown;
  state: { view: string; marker: string };
  playerSeat: number;
  isSpectator: boolean;
}

/**
 * Mirrors GameShell.vue's displayedState computed exactly:
 *   const displayedState = computed<GameState | null>(() => {
 *     if (timeTravelState.value) {
 *       return state.value ? { ...state.value, state: timeTravelState.value } : null;
 *     }
 *     return state.value;
 *   });
 */
function makeDisplayedState(
  state: ReturnType<typeof ref<FakeGameState | null>>,
  timeTravelState: ReturnType<typeof ref<{ view: string; marker: string } | null>>
) {
  return computed<FakeGameState | null>(() => {
    if (timeTravelState.value) {
      return state.value ? { ...state.value, state: timeTravelState.value } : null;
    }
    return state.value;
  });
}

const BoardBranchHarness = defineComponent({
  name: 'BoardBranchHarness',
  props: {
    useDynamicComponent: { type: Boolean, default: false },
  },
  setup(props) {
    const state = ref<FakeGameState | null>({
      flowState: {},
      state: { view: 'live-view', marker: 'live' },
      playerSeat: 1,
      isSpectator: false,
    });
    const timeTravelState = ref<{ view: string; marker: string } | null>(null);
    const displayedState = makeDisplayedState(state, timeTravelState);

    const BoardStub = defineComponent({
      name: 'BoardStub',
      props: { state: { type: Object, default: null } },
      setup(p) {
        return () => h('div', { class: 'board-stub', 'data-marker': p.state?.state?.marker ?? 'none' });
      },
    });

    function timeTravel(marker: string | null) {
      timeTravelState.value = marker ? { view: 'historical-view', marker } : null;
    }

    return { state, timeTravelState, displayedState, BoardStub, timeTravel, useDynamicComponent: props.useDynamicComponent };
  },
  render() {
    // Mirrors GameShell.vue's two mutually-exclusive board-render branches
    // (`v-if="selectedUiComponent"` dynamic-component vs. `v-else` slot), both
    // fixed with the SAME displayedState computed (Pitfall 3).
    if (this.useDynamicComponent) {
      return h(this.BoardStub, { class: 'game-board-dynamic', state: this.displayedState });
    }
    return h(this.BoardStub, { class: 'game-board-slot', state: this.displayedState });
  },
});

describe('GameShell displayedState (LIBX-04, 164-04)', () => {
  it('dynamic-component board branch: reflects LIVE state before time-travel', () => {
    const wrapper = mount(BoardBranchHarness, { props: { useDynamicComponent: true } });
    expect(wrapper.find('.board-stub').attributes('data-marker')).toBe('live');
  });

  it('dynamic-component board branch: reflects HISTORICAL state during time-travel (not live)', async () => {
    const wrapper = mount(BoardBranchHarness, { props: { useDynamicComponent: true } });
    (wrapper.vm as unknown as { timeTravel: (m: string | null) => void }).timeTravel('action-3');
    await nextTick();
    expect(wrapper.find('.board-stub').attributes('data-marker')).toBe('action-3');
  });

  it('slot fallback board branch: reflects LIVE state before time-travel', () => {
    const wrapper = mount(BoardBranchHarness, { props: { useDynamicComponent: false } });
    expect(wrapper.find('.board-stub').attributes('data-marker')).toBe('live');
  });

  it('slot fallback board branch: reflects HISTORICAL state during time-travel (not live)', async () => {
    const wrapper = mount(BoardBranchHarness, { props: { useDynamicComponent: false } });
    (wrapper.vm as unknown as { timeTravel: (m: string | null) => void }).timeTravel('action-7');
    await nextTick();
    expect(wrapper.find('.board-stub').attributes('data-marker')).toBe('action-7');
  });

  it('exiting history (timeTravelState -> null) restores displayedState to LIVE state at both branches', async () => {
    for (const useDynamicComponent of [true, false]) {
      const wrapper = mount(BoardBranchHarness, { props: { useDynamicComponent } });
      const vm = wrapper.vm as unknown as { timeTravel: (m: string | null) => void };
      vm.timeTravel('action-2');
      await nextTick();
      expect(wrapper.find('.board-stub').attributes('data-marker')).toBe('action-2');

      // handleTimeTravel(null, null, null) exit path.
      vm.timeTravel(null);
      await nextTick();
      expect(wrapper.find('.board-stub').attributes('data-marker')).toBe('live');
    }
  });

  it('displayedState re-wraps the historical PlayerGameState into the GameState shape (playerSeat/isSpectator preserved from live wrapper)', () => {
    const state = ref<FakeGameState | null>({
      flowState: { turn: 1 },
      state: { view: 'live-view', marker: 'live' },
      playerSeat: 2,
      isSpectator: false,
    });
    const timeTravelState = ref<{ view: string; marker: string } | null>({ view: 'hist-view', marker: 'hist' });
    const displayedState = makeDisplayedState(state, timeTravelState);

    expect(displayedState.value).toEqual({
      flowState: { turn: 1 },
      state: { view: 'hist-view', marker: 'hist' },
      playerSeat: 2,
      isSpectator: false,
    });
  });
});

// ── Direct source assertions: confirm GameShell.vue itself carries the fix ───

describe('GameShell.vue source: displayedState wired at all three sites, DebugPanel stays live', () => {
  const gameShellSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'),
    'utf-8'
  );

  it('defines a displayedState computed next to gameView', () => {
    expect(gameShellSource).toContain('const displayedState = computed');
  });

  it('board + sidebar-extra sites read displayedState (count == 3)', () => {
    const occurrences = (gameShellSource.match(/:state="displayedState"/g) ?? []).length;
    expect(occurrences).toBe(3);
  });

  it('exactly ONE :state="state" site remains — the DebugPanel control surface', () => {
    const occurrences = (gameShellSource.match(/:state="state"/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('the remaining :state="state" site is the DebugPanel (not the board/sidebar)', () => {
    const idx = gameShellSource.indexOf(':state="state"');
    expect(idx).toBeGreaterThan(-1);
    const surrounding = gameShellSource.slice(Math.max(0, idx - 200), idx);
    expect(surrounding).toContain('DebugPanel');
  });
});

// ── (2) useBoardActionBridge isViewingHistory guard — the REAL composable ────

function makeController(opts: { pick?: PickMetadata | null; action?: string | null; validElements?: ValidElement[] }) {
  const currentAction = ref<string | null>(opts.action ?? null);
  const currentPick = computed<PickMetadata | null>(() => opts.pick ?? null);
  const currentArgs = ref<Record<string, unknown>>({});
  const isExecuting = ref(false);
  const actionCompletedTick = ref(0);
  const multiSelectDraft = ref(null);
  const actionSnapshot = ref(null);
  const pendingFollowUp = ref(false);
  const pendingOnServer = ref(false);

  const fill = vi.fn(async () => ({ valid: true }));
  const start = vi.fn(async () => {});
  const execute = vi.fn(async () => ({ success: true }));
  const cancel = vi.fn(() => {});
  const toggleMultiSelect = vi.fn(async () => {});

  const currentChoices = computed(() => opts.pick?.choices ?? []);
  const validElements = computed(() => opts.validElements ?? []);

  const controller = {
    currentAction,
    currentPick,
    currentArgs,
    isExecuting,
    actionCompletedTick,
    multiSelectDraft,
    actionSnapshot,
    pendingFollowUp,
    pendingOnServer,
    currentChoices,
    validElements,
    getCurrentChoices: () => currentChoices.value,
    getValidElements: () => opts.validElements ?? [],
    fill,
    start,
    execute,
    cancel,
    toggleMultiSelect,
  } as unknown as UseActionControllerReturn;

  return { controller, fill, start, execute, toggleMultiSelect, currentAction, currentPick };
}

const cellPick: PickMetadata = { name: 'cell', type: 'element', prompt: 'Select a cell' };

describe('useBoardActionBridge isViewingHistory guard (LIBX-04, 164-04)', () => {
  it('startAction is an inert no-op while isViewingHistory (board click during history never starts an action)', async () => {
    const board = createBoardInteraction();
    const validElements: ValidElement[] = [
      { id: 5, refs: [{ ref: { id: 5, notation: '0,0' }, role: 'highlight' }] },
    ];
    const { controller, start } = makeController({ pick: null, action: null, validElements });
    const isViewingHistory = ref(true);

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ placeStone: { name: 'placeStone', selections: [cellPick] } }),
      availableActions: ref(['placeStone']),
      isViewingHistory,
    } as any);

    board.triggerElementSelect({ id: 5, name: 'A1' });
    await nextTick();
    await nextTick();

    expect(start).not.toHaveBeenCalled();
  });

  it('executeAction is an inert no-op while isViewingHistory (no controller.execute call)', async () => {
    const board = createBoardInteraction();
    const { controller, execute } = makeController({ pick: null, action: null });
    const isViewingHistory = ref(true);

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [] } }),
      availableActions: ref(['endTurn']),
      isViewingHistory,
    } as any);

    await nextTick();
    await nextTick();
    await nextTick();

    expect(execute).not.toHaveBeenCalled();
  });

  it('setSelectionValue is an inert no-op while isViewingHistory: a click on a valid element does NOT call controller.fill', async () => {
    const board = createBoardInteraction();
    const validElements: ValidElement[] = [
      { id: 5, refs: [{ ref: { id: 5, notation: '0,0' }, role: 'highlight' }] },
    ];
    const { controller, fill } = makeController({ pick: cellPick, action: 'placeStone', validElements });
    const isViewingHistory = ref(true);

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ placeStone: { name: 'placeStone', selections: [cellPick] } }),
      availableActions: ref(['placeStone']),
      isViewingHistory,
    } as any);

    board.triggerElementSelect({ id: 5, name: 'A1' });
    await nextTick();

    expect(fill).not.toHaveBeenCalled();
  });

  it('toggleMultiSelectValue is an inert no-op while isViewingHistory', async () => {
    const board = createBoardInteraction();
    const destPick: PickMetadata = {
      name: 'destination',
      type: 'elements',
      multiSelect: { min: 1, max: 3 },
    } as unknown as PickMetadata;
    const validElements: ValidElement[] = [
      { id: 21, refs: [{ ref: { id: 21, notation: 'e5' }, role: 'highlight' }] },
    ];
    const { controller, toggleMultiSelect } = makeController({ pick: destPick, action: 'move', validElements });
    const isViewingHistory = ref(true);

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ move: { name: 'move', selections: [destPick] } }),
      availableActions: ref(['move']),
      isViewingHistory,
    } as any);

    board.triggerElementSelect({ id: 21, name: 'e5', notation: 'e5' });
    await nextTick();

    expect(toggleMultiSelect).not.toHaveBeenCalled();
  });

  it('live behavior unregressed: with isViewingHistory=false, a board click still dispatches setSelectionValue -> controller.fill', async () => {
    const board = createBoardInteraction();
    const validElements: ValidElement[] = [
      { id: 5, refs: [{ ref: { id: 5, notation: '0,0' }, role: 'highlight' }] },
    ];
    const { controller, fill } = makeController({ pick: cellPick, action: 'placeStone', validElements });
    const isViewingHistory = ref(false);

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ placeStone: { name: 'placeStone', selections: [cellPick] } }),
      availableActions: ref(['placeStone']),
      isViewingHistory,
    } as any);

    board.triggerElementSelect({ id: 5, name: 'A1' });
    expect(fill).toHaveBeenCalledWith('cell', 5);
  });

  it('mid-pick-then-time-travel: a selection made after an action was started, then the user time-travels, does NOT commit (setSelectionValue independently guards, not derived from isMyTurn)', async () => {
    const board = createBoardInteraction();
    const validElements: ValidElement[] = [
      { id: 5, refs: [{ ref: { id: 5, notation: '0,0' }, role: 'highlight' }] },
    ];
    const { controller, fill } = makeController({ pick: cellPick, action: 'placeStone', validElements });
    const isViewingHistory = ref(false);
    // isMyTurn STAYS true throughout — the guard must be isViewingHistory itself,
    // not a derived isMyTurn && !isViewingHistory compose (RESEARCH Anti-Pattern).
    const isMyTurn = ref(true);

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn,
      autoEndTurn: ref(true),
      actionMetadata: ref({ placeStone: { name: 'placeStone', selections: [cellPick] } }),
      availableActions: ref(['placeStone']),
      isViewingHistory,
    } as any);

    // User opens the debug panel and time-travels mid-pick.
    isViewingHistory.value = true;
    await nextTick();

    board.triggerElementSelect({ id: 5, name: 'A1' });
    await nextTick();

    expect(fill).not.toHaveBeenCalled();
  });
});

// ── Direct source assertions: confirm useBoardActionBridge.ts carries the fix ─

describe('useBoardActionBridge.ts source: isViewingHistory guard wired at all four mutating functions', () => {
  const bridgeSource = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'composables',
      'useBoardActionBridge.ts'
    ),
    'utf-8'
  );

  it('declares isViewingHistory on BoardActionBridgeOptions', () => {
    expect(bridgeSource).toContain('isViewingHistory');
  });

  it('all four mutating functions guard with `if (isViewingHistory.value) return;` (count == 4)', () => {
    const occurrences = (bridgeSource.match(/if \(isViewingHistory\.value\) return;/g) ?? []).length;
    expect(occurrences).toBe(4);
  });
});

describe('GameShell.vue source: isViewingHistory wired into the useBoardActionBridge call site', () => {
  const gameShellSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'),
    'utf-8'
  );

  it('passes isViewingHistory into useBoardActionBridge({...})', () => {
    const callSiteIdx = gameShellSource.indexOf('useBoardActionBridge({');
    expect(callSiteIdx).toBeGreaterThan(-1);
    const callSiteBlock = gameShellSource.slice(callSiteIdx, callSiteIdx + 400);
    expect(callSiteBlock).toContain('isViewingHistory');
  });
});

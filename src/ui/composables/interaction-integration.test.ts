// @vitest-environment jsdom
/**
 * Controller + bridge + board integration tests.
 *
 * These tests wire the REAL useActionController + useBoardActionBridge +
 * createBoardInteraction together (no mock controller — using a mock controller
 * misses the fill → fetchChoicesForPick → snapshotVersion++ → currentChoices
 * reactive chain that is the crux of Bug A).
 *
 * Test A1 (Checkers destination populates after board-select):
 *   Board-selecting a Checkers piece (element pick) must trigger the next-step
 *   choice fetch so the destination cells appear selectable on the board AND
 *   parity holds with the footer (allCurrentChoicesAnchored=false, choice pick).
 *   EXPECTED RED before Task 2 fix: `selection.type === 'choice' && selection.choices`
 *   guard in useBoardActionBridge.ts fails because selection.choices is undefined
 *   for dynamically-fetched choices, so validElems for destination cells stays
 *   empty and board never marks 'a5'/'c5' as selectable.
 *
 * Test A2 (multi-jump highlight regression guard):
 *   A multi-jump destination choice with source(role:source) + target(role:target)
 *   + 2 captured(role:highlight) refs — all four cells must be highlighted
 *   simultaneously when setHoveredChoice is called with the correct refs.
 *   EXPECTED GREEN: isHighlighted checks sourceRefs+targetRefs; ActionPanel
 *   already maps 'highlight' role refs into targetRefs in executeChoice.
 *   This test guards against that behavior regressing during the A1 fix.
 *
 * Test A3 (Hex regression guard):
 *   Single-step chooseElement placement — one board click selects+auto-executes.
 *   EXPECTED GREEN before and after Task 2 fix.
 *
 * Pitfall notes (from 94.1-RESEARCH.md):
 *   P2: board.clear() wipes validElements after controller.start() — watcher
 *       re-populates on next snapshotVersion tick; flush() must drain 4+ ticks.
 *   P3: board.setCurrentAction called with already-filled index (0/piece) — the
 *       currentAction watcher corrects on next flush.
 *   P4: filterBy uses currentArgs.value — both currentArgs and collectedPicks are
 *       set in start(), so they agree.
 */

import { describe, it, expect, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useActionController } from './useActionController.js';
import { useBoardActionBridge } from './useBoardActionBridge.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import type { ActionMetadata } from './useActionControllerTypes.js';

// ── Flush helper ────────────────────────────────────────────────────────────
// Drains Vue's watcher queue + microtask queue multiple times.
// Needed because the auto-start → async fetch → board populate chain crosses
// several tick boundaries (see Pitfalls 2/3 notes above).
async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

// ── Fixtures (test-local — DO NOT import from ~/BoardSmithGames) ─────────────

// Checkers two-step move: piece (element) then destination (choice, dynamically
// fetched, filtered by pieceId). Mirrors the shape of the real Checkers move
// action without importing the game package.
const checkersMoveAction: ActionMetadata = {
  name: 'move',
  prompt: 'Move',
  selections: [
    { name: 'piece', type: 'element', prompt: 'Select a piece' },
    {
      name: 'destination',
      type: 'choice',
      prompt: 'Select destination',
      // filterBy is applied client-side in getChoices() — the server-returned
      // choices carry pieceId so the client can filter to the selected piece.
      filterBy: { key: 'pieceId', selectionName: 'piece' },
    },
  ],
};

// Simple destinations for Test A1 (two move targets for piece id=42)
const simpleDestinationChoices = [
  {
    value: { pieceId: 42, toNotation: 'a5' },
    display: 'a5',
    refs: [
      { ref: { notation: 'b6' }, role: 'source' as const },
      { ref: { notation: 'a5' }, role: 'target' as const },
    ],
  },
  {
    value: { pieceId: 42, toNotation: 'c5' },
    display: 'c5',
    refs: [
      { ref: { notation: 'b6' }, role: 'source' as const },
      { ref: { notation: 'c5' }, role: 'target' as const },
    ],
  },
];

// Multi-jump destination for Test A2: source + target + 2 captured cells
const multiJumpChoices = [
  {
    value: { pieceId: 42, fromNotation: 'b6', toNotation: 'd4', capturedNotations: ['c5', 'c3'] },
    display: 'd4 (capture)',
    refs: [
      { ref: { notation: 'b6' }, role: 'source' as const },
      { ref: { notation: 'd4' }, role: 'target' as const },
      { ref: { notation: 'c5' }, role: 'highlight' as const },
      { ref: { notation: 'c3' }, role: 'highlight' as const },
    ],
  },
];

// Hex single-step placement: one element pick, auto-executes on fill
const hexPlacementAction: ActionMetadata = {
  name: 'place',
  prompt: 'Place stone',
  selections: [
    { name: 'hex', type: 'element', prompt: 'Choose a hex' },
  ],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Board + controller interaction integration', () => {

  // ── Test A1 ───────────────────────────────────────────────────────────────

  it('A1: board-select of Checkers piece populates destination choices on the board and in currentChoices', async () => {
    const isMyTurn = ref<boolean | undefined>(true);
    const autoEndTurn = ref(true);
    const availableActions = ref(['move']);
    const actionMetadata = ref({ move: checkersMoveAction });
    const sendAction = vi.fn().mockResolvedValue({ success: true });

    // fetchPickChoices: returns valid pieces for 'piece' pick, destination choices
    // (all for pieceId=42) for 'destination' pick. No filtering needed server-side
    // because our fixture only has piece 42 — client-side filterBy handles it.
    const fetchPickChoices = vi.fn(async (_action: string, selectionName: string) => {
      if (selectionName === 'piece') {
        return { success: true, validElements: [{ id: 42, display: 'b6' }] };
      }
      if (selectionName === 'destination') {
        return { success: true, choices: simpleDestinationChoices };
      }
      return { success: false, error: `Unknown selection: ${selectionName}` };
    });

    // Real controller — NOT a mock. Using a mock controller would miss the
    // fill → fetchChoicesForPick → snapshotVersion++ → currentChoices chain.
    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoFill: false,   // prevent auto-fill (only 1 piece → would skip board click)
      autoExecute: false, // prevent auto-execute (we control fills manually)
      fetchPickChoices,
    });

    const board = createBoardInteraction();

    // Wire the REAL bridge. Its immediate watcher fires tryAutoStartSingleAction()
    // synchronously, which starts the 'move' action and fetches piece choices.
    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn,
      autoEndTurn,
      actionMetadata,
      availableActions,
    });

    // Flush: auto-start → controller.start('move') → fetchChoicesForPick('piece')
    // → pickSnapshots.set('piece', {validElements:[{id:42}]}), snapshotVersion++
    // → board.clear(), board.setCurrentAction('move', 0, 'piece')
    // → watch([currentPick, filteredValidElements, choicesForBoard]) fires
    // → board.setValidElements([{id:42, ref:{id:42}}], onSelect)
    await flush();

    // Verify auto-start reached the piece pick
    expect(controller.currentAction.value).toBe('move');
    expect(controller.currentPick.value?.name).toBe('piece');
    // Piece id=42 is selectable on the board
    expect(board.isSelectableElement({ id: 42 })).toBe(true);

    // ── Simulate board click on piece ─────────────────────────────────────
    // triggerElementSelect → onElementSelect(42) → onSelect(42) (bridge callback)
    // → setSelectionValue('piece', 42) → controller.fill('piece', 42)
    // → fetchChoicesForPick('destination') → snapshotVersion++
    board.triggerElementSelect({ id: 42 });

    // Flush: fill('piece', 42) → destination fetch → snapshotVersion++
    // → currentChoices.value updated → choicesForBoard updated
    // → watch([currentPick, filteredValidElements, choicesForBoard]) fires
    //   → RED before fix: condition `selection.type === 'choice' && selection.choices`
    //     evaluates to false (selection.choices=undefined for dynamic choices)
    //     → board.setValidElements([], () => {})
    //   → GREEN after fix: condition `selection.type === 'choice'` is true
    //     → choicesForBoard has 2 choices with notation refs
    //     → board.setValidElements([{id:-1, ref:{notation:'a5'}}, ...], onSelect)
    await flush();

    // (a) Controller has destination choices (reactive currentChoices)
    expect(controller.currentPick.value?.name).toBe('destination');
    expect(controller.currentChoices.value.length).toBe(2); // a5 and c5

    // (b) Board exposes destination cells as selectable via notation refs
    // EXPECTED RED before fix, GREEN after fix in Task 2.
    expect(board.isSelectableElement({ notation: 'a5' })).toBe(true);
    expect(board.isSelectableElement({ notation: 'c5' })).toBe(true);

    // (c) Parity: choice pick → allCurrentChoicesAnchored=false → footer stays visible
    // (validElements is [] for choice type, so D-02 keeps the footer present)
    expect(controller.allCurrentChoicesAnchored.value).toBe(false);
  });

  // ── Test A2 ───────────────────────────────────────────────────────────────

  it('A2: multi-jump destination highlights source + target + 2 captured cells simultaneously', () => {
    // This test exercises the board.isHighlighted path with a multi-ref choice
    // that has source, target, AND highlight-role refs. The bridge (and ActionPanel)
    // must surface ALL refs — not just the target — so all four cells show as
    // highlighted simultaneously.
    //
    // ActionPanel.executeChoice() already does this correctly:
    //   sourceRefs = refs.filter(r => r.role === 'source').map(r => r.ref)
    //   targetRefs = refs.filter(r => r.role === 'target' || r.role === 'highlight').map(r => r.ref)
    // isHighlighted checks [...sourceRefs, ...targetRefs].
    //
    // This test is EXPECTED GREEN before and after the fix — it is a regression
    // guard ensuring the highlight-role-in-targetRefs mapping is preserved.
    const board = createBoardInteraction();

    const choice = multiJumpChoices[0];
    // Simulate what ActionPanel.executeChoice() does when user clicks a multi-jump
    // destination in the footer.
    board.setHoveredChoice({
      value: choice.value,
      display: choice.display,
      sourceRefs: choice.refs.filter(r => r.role === 'source').map(r => r.ref),
      // ActionPanel puts BOTH 'target' and 'highlight' role refs into targetRefs
      // so isHighlighted() surfaces captured squares as well as the target.
      targetRefs: choice.refs.filter(r => r.role === 'target' || r.role === 'highlight').map(r => r.ref),
    });

    // All four cells must be highlighted simultaneously
    expect(board.isHighlighted({ notation: 'b6' })).toBe(true); // source (from-square)
    expect(board.isHighlighted({ notation: 'd4' })).toBe(true); // target (to-square)
    expect(board.isHighlighted({ notation: 'c5' })).toBe(true); // captured (highlight role)
    expect(board.isHighlighted({ notation: 'c3' })).toBe(true); // captured (highlight role)

    // Unrelated cells are not highlighted
    expect(board.isHighlighted({ notation: 'e7' })).toBe(false);
    expect(board.isHighlighted({ notation: 'a1' })).toBe(false);
  });

  // ── Turn-transition race (Phase 94.1 auto-start churn) ──────────────────────

  // Shared setup for the churn tests: a two-step `move` action plus a no-selection
  // `endTurn` action. Mirrors the real Checkers turn where the lone playable action
  // (`move`) should auto-start, but available actions CHURN across async ticks during
  // a turn transition (availableActions flickers [] → ['endTurn'] → ['move']).
  function setupChurn(initialActions: string[]) {
    const isMyTurn = ref<boolean | undefined>(true);
    const autoEndTurn = ref(true);
    const availableActions = ref<string[]>(initialActions);
    const actionMetadata = ref<Record<string, ActionMetadata>>({
      move: checkersMoveAction,
      endTurn: { name: 'endTurn', prompt: 'End Turn', selections: [] },
    });
    const sendAction = vi.fn().mockResolvedValue({ success: true });
    const fetchPickChoices = vi.fn(async (_action: string, selectionName: string) => {
      if (selectionName === 'piece') return { success: true, validElements: [{ id: 42, display: 'b6' }] };
      if (selectionName === 'destination') return { success: true, choices: simpleDestinationChoices };
      return { success: false, error: `Unknown selection: ${selectionName}` };
    });
    const controller = useActionController({
      sendAction, availableActions, actionMetadata, isMyTurn,
      autoFill: false, autoExecute: false, fetchPickChoices,
    });
    const board = createBoardInteraction();
    useBoardActionBridge({ controller, boardInteraction: board, isMyTurn, autoEndTurn, actionMetadata, availableActions });
    return { isMyTurn, autoEndTurn, availableActions, actionMetadata, sendAction, controller, board };
  }

  // ── Test RACE-1 ─────────────────────────────────────────────────────────────

  it('RACE-1: turn-transition churn — sole move auto-starts and survives (not a manual button)', async () => {
    // Reproduces the captured failing transition. currentAction starts null (the
    // previous turn's action is gone); availableActions then churns through the
    // transient ['endTurn'] before settling on the real sole action ['move'].
    //
    // RED before fix: `move` auto-starts on the transient ['move'] tick, then the
    //   availableActions clear-watcher tears it down on a transient that excludes it,
    //   leaving currentAction === null → a manual "Move" button appears.
    // GREEN after fix: auto-start is coalesced onto the SETTLED state and a transient
    //   empty list never tears down currentAction, so `move` survives.
    const s = setupChurn([]);
    await flush();

    // Captured churn: [] → ['endTurn'] → ['move'] across async ticks.
    s.availableActions.value = ['endTurn'];
    await flush();
    s.availableActions.value = ['move'];
    await flush();
    await flush(); // let everything settle

    // The lone `move` action is auto-started and was NOT torn down by the churn.
    expect(s.controller.currentAction.value).toBe('move');
    expect(s.controller.currentPick.value?.name).toBe('piece');
    expect(s.board.isSelectableElement({ id: 42 })).toBe(true);
  });

  // ── Test RACE-2 ─────────────────────────────────────────────────────────────

  it('RACE-2: a transient empty availableActions does not tear down a started action', async () => {
    // Part 2 of the fix in isolation. An empty availableActions means
    // "transitioning / waiting", not "the current action is stale". Tearing
    // currentAction down on a transient empty tick is exactly what killed a
    // freshly auto-started `move`.
    const s = setupChurn(['move']);
    await flush();
    expect(s.controller.currentAction.value).toBe('move'); // auto-started

    // A transient empty tick arrives mid-turn.
    // RED before fix: clear-watcher cancels currentAction (move not in []) → null.
    // GREEN after fix: empty list is treated as transient, action preserved.
    s.availableActions.value = [];
    await flush();

    expect(s.controller.currentAction.value).toBe('move');
    expect(s.controller.currentPick.value?.name).toBe('piece');
  });

  // ── Test RACE-3 ─────────────────────────────────────────────────────────────

  it('RACE-3: a sole no-selection endTurn still auto-executes (auto-advance not regressed)', async () => {
    // Guards the intended auto-advance: when it becomes the player's turn and the
    // only available action is a no-selection action, it must still auto-execute.
    // Ensures the coalescing / skipNoSelections AND did not accidentally suppress
    // no-selection auto-execute entirely.
    const isMyTurn = ref<boolean | undefined>(false);
    const autoEndTurn = ref(true);
    const availableActions = ref<string[]>([]);
    const actionMetadata = ref<Record<string, ActionMetadata>>({
      endTurn: { name: 'endTurn', prompt: 'End Turn', selections: [] },
    });
    // Model the turn ending when endTurn executes, so auto-execute fires exactly
    // once instead of re-triggering forever on a static state.
    const sendAction = vi.fn(async (name: string) => {
      if (name === 'endTurn') {
        isMyTurn.value = false;
        availableActions.value = [];
      }
      return { success: true };
    });
    const controller = useActionController({
      sendAction, availableActions, actionMetadata, isMyTurn,
      autoFill: false, autoExecute: false,
      fetchPickChoices: vi.fn(async () => ({ success: false, error: 'n/a' })),
    });
    const board = createBoardInteraction();
    useBoardActionBridge({ controller, boardInteraction: board, isMyTurn, autoEndTurn, actionMetadata, availableActions });
    await flush();

    // It becomes my turn with a sole no-selection action available.
    isMyTurn.value = true;
    availableActions.value = ['endTurn'];
    await flush();

    expect(sendAction).toHaveBeenCalledWith('endTurn', {});
  });

  // ── Test A3 ───────────────────────────────────────────────────────────────

  it('A3: Hex single-step placement — one board click selects+auto-executes (regression guard)', async () => {
    // This is the regression guard for the Hex single-click flow that was fixed
    // in Phase 94. It MUST be GREEN before AND after the Task 2 fix for Bug A.
    const isMyTurn = ref<boolean | undefined>(true);
    const autoEndTurn = ref(true);
    const availableActions = ref(['place']);
    const actionMetadata = ref({ place: hexPlacementAction });
    const sendAction = vi.fn().mockResolvedValue({ success: true });

    const fetchPickChoices = vi.fn(async (_action: string, selectionName: string) => {
      if (selectionName === 'hex') {
        return {
          success: true,
          validElements: [{ id: 10, display: '0,0' }, { id: 11, display: '1,0' }],
        };
      }
      return { success: false, error: `Unknown selection: ${selectionName}` };
    });

    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoFill: false,
      autoExecute: true,  // single-step → auto-executes when all picks filled
      fetchPickChoices,
    });

    const board = createBoardInteraction();

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn,
      autoEndTurn,
      actionMetadata,
      availableActions,
    });

    // Flush: auto-start 'place' → fetchChoicesForPick('hex') → board shows hexes
    await flush();

    // Both hex cells are selectable after auto-start
    expect(board.isSelectableElement({ id: 10 })).toBe(true);
    expect(board.isSelectableElement({ id: 11 })).toBe(true);

    // ── Single board click on hex ─────────────────────────────────────────
    // triggerElementSelect → onElementSelect(10) → setSelectionValue('hex', 10)
    // → controller.fill('hex', 10) → isReady=true → auto-execute
    board.triggerElementSelect({ id: 10 });

    // Flush: fill → isReady=true → executeCurrentAction → sendAction
    await flush();

    // Stone placed via a single board click — regression guard
    expect(sendAction).toHaveBeenCalledWith('place', { hex: 10 });
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

});

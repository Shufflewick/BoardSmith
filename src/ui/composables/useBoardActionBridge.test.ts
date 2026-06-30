/**
 * Regression test for the Phase-94 board-centric playability bug.
 *
 * Bug: the controller→board sync (auto-start + setValidElements + click
 * dispatch) lived inside ActionPanel, which GameShell makes ABSENT from the DOM
 * for board-anchored element picks (D-02). With the panel absent the board's
 * `validElements` was never populated, so clicking a hex/cell/piece only
 * highlighted it and never executed the action ("Stones placed: 0").
 *
 * useBoardActionBridge lifts that sync into GameShell so it runs unconditionally.
 * These tests exercise the bridge directly against a real board-interaction
 * substrate and a fake controller — NO ActionPanel involved.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import { createBoardInteraction } from './useBoardInteraction.js';
import { useBoardActionBridge } from './useBoardActionBridge.js';
import type { UseActionControllerReturn, PickMetadata, ValidElement } from './useActionControllerTypes.js';

/** Build a minimal fake action controller backed by real refs. */
function makeController(opts: {
  pick?: PickMetadata | null;
  action?: string | null;
  validElements?: ValidElement[];
}) {
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

  // Reactive sources the bridge now depends on (mirror the real controller, which
  // reads snapshotVersion so async-fetched choices/elements surface reactively).
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

  return { controller, fill, start, execute, currentAction, currentPick };
}

const cellPick: PickMetadata = { name: 'cell', type: 'element', prompt: 'Select a cell' };

describe('useBoardActionBridge', () => {
  it('populates board validElements for an active element pick (no ActionPanel)', () => {
    const board = createBoardInteraction();
    // Hex-style validElement: boardRef provides { id, notation }; notation comes
    // from a getter so it is NOT serialized client-side — id must carry matching.
    const validElements: ValidElement[] = [
      { id: 5, refs: [{ ref: { id: 5, notation: '0,0' }, role: 'highlight' }] },
      { id: 6, refs: [{ ref: { id: 6, notation: '1,0' }, role: 'highlight' }] },
    ];
    const { controller } = makeController({ pick: cellPick, action: 'placeStone', validElements });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ placeStone: { name: 'placeStone', selections: [cellPick] } }),
      availableActions: ref(['placeStone']),
    });

    // The board cell (client identity has no notation — getter not serialized)
    // must be selectable, matched by id.
    expect(board.isSelectableElement({ id: 5, name: 'A1' })).toBe(true);
    expect(board.isSelectableElement({ id: 6, name: 'B1' })).toBe(true);
    expect(board.isSelectableElement({ id: 99 })).toBe(false);
  });

  it('dispatches the action when a selectable cell is clicked', () => {
    const board = createBoardInteraction();
    const validElements: ValidElement[] = [
      { id: 5, refs: [{ ref: { id: 5, notation: '0,0' }, role: 'highlight' }] },
    ];
    const { controller, fill } = makeController({ pick: cellPick, action: 'placeStone', validElements });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ placeStone: { name: 'placeStone', selections: [cellPick] } }),
      availableActions: ref(['placeStone']),
    });

    board.triggerElementSelect({ id: 5, name: 'A1' });
    expect(fill).toHaveBeenCalledWith('cell', 5);
  });

  it('matches a notation-only element ref against a notation-keyed square (Checkers piece)', () => {
    const board = createBoardInteraction();
    // Checkers selects a PIECE but the player clicks the SQUARE it sits on. The
    // boardRef is notation-only (no id) so the square's serialized notation matches.
    const validElements: ValidElement[] = [
      { id: 42 /* piece id */, refs: [{ ref: { notation: 'd4' }, role: 'highlight' }] },
    ];
    const { controller, fill } = makeController({ pick: cellPick, action: 'move', validElements });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ move: { name: 'move', selections: [cellPick] } }),
      availableActions: ref(['move']),
    });

    // The rendered square (its own id is 7, notation 'd4') is selectable by notation.
    expect(board.isSelectableElement({ id: 7, name: 'd4', notation: 'd4' })).toBe(true);
    board.triggerElementSelect({ id: 7, name: 'd4', notation: 'd4' });
    // onElementSelect routes back to the piece id, not the clicked square id.
    expect(fill).toHaveBeenCalledWith('cell', 42);
  });

  it('makes notation-only target choices clickable on the board (Checkers destination)', () => {
    const board = createBoardInteraction();
    const destPick: PickMetadata = {
      name: 'destination',
      type: 'choice',
      choices: [
        { value: 'm1', display: 'd4→e5', refs: [{ ref: { notation: 'e5' }, role: 'target' }] },
        { value: 'm2', display: 'd4→c5', refs: [{ ref: { notation: 'c5' }, role: 'target' }] },
      ],
    };
    // Choice picks read choices via the reactive controller.currentChoices, which
    // makeController derives from pick.choices.
    const { controller, fill } = makeController({ pick: destPick, action: 'move' });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ move: { name: 'move', selections: [destPick] } }),
      availableActions: ref(['move']),
    });

    expect(board.isSelectableElement({ id: 21, name: 'e5', notation: 'e5' })).toBe(true);
    expect(board.isSelectableElement({ id: 22, name: 'c5', notation: 'c5' })).toBe(true);
    board.triggerElementSelect({ id: 21, name: 'e5', notation: 'e5' });
    expect(fill).toHaveBeenCalledWith('destination', 'm1');
  });

  it('registers destination squares when choices arrive reactively after the watcher first ran (async fetch)', async () => {
    const board = createBoardInteraction();
    const destPick: PickMetadata = { name: 'destination', type: 'choice', choices: [] };
    // Reactive choices source that starts EMPTY (as during the async fetch) then fills.
    const lateChoices = ref<unknown[]>([]);
    const { controller } = makeController({ pick: destPick, action: 'move' });
    (controller as unknown as { currentChoices: { value: unknown[] } }).currentChoices =
      computed(() => lateChoices.value) as unknown as { value: unknown[] };

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ move: { name: 'move', selections: [destPick] } }),
      availableActions: ref(['move']),
    });

    // Before the fetch lands, the destination square is NOT selectable.
    expect(board.isSelectableElement({ id: 21, name: 'e5', notation: 'e5' })).toBe(false);

    // Fetch lands: choices appear. The board must pick them up reactively.
    lateChoices.value = [
      { value: 'm1', display: 'd4→e5', refs: [{ ref: { notation: 'e5' }, role: 'target' }] },
    ];
    await nextTick();

    expect(board.isSelectableElement({ id: 21, name: 'e5', notation: 'e5' })).toBe(true);
  });

  it('auto-starts the sole available action when none is in progress', async () => {
    const board = createBoardInteraction();
    const { controller, start } = makeController({ pick: null, action: null });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ placeStone: { name: 'placeStone', selections: [cellPick] } }),
      availableActions: ref(['placeStone']),
    });

    // Auto-start is coalesced onto a settled-state nextTick (see scheduleAutoStart),
    // so the sole action starts on the next microtask, not synchronously at setup.
    await nextTick();
    expect(start).toHaveBeenCalledWith('placeStone', undefined);
  });

  // Parity for the selection-step transport: a multi-jump capture chain completes via
  // handleOnSelectFill (never toggling isExecuting), so the controller pulses
  // actionCompletedTick instead. The bridge must treat that pulse as a real
  // execution-complete and auto-execute the sole no-selection endTurn — i.e. the
  // capture chain auto-ends the turn, just like a single move. Without the fix the
  // turn was left at a manual End Turn + Undo.
  it('auto-executes a sole no-selection endTurn when an action completes via the selection-step path (actionCompletedTick)', async () => {
    const board = createBoardInteraction();
    const { controller, execute } = makeController({ pick: null, action: null });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      // After a multi-jump completes, endTurn is the sole available action and has
      // no selections — so it should auto-execute (commit the turn).
      actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [] } }),
      availableActions: ref(['endTurn']),
    });

    await nextTick(); // settle the initial auto-start evaluation
    execute.mockClear();

    // Simulate the selection-step completion of the capture chain's final hop.
    controller.actionCompletedTick.value++;
    await nextTick(); // watcher fires → scheduleAutoStart queues its own nextTick
    await nextTick(); // coalesced auto-start evaluation runs

    expect(execute).toHaveBeenCalledWith('endTurn', {});
  });

  // The REAL bug (proven by live [autoend-debug] logs): the capture chain's final hop is
  // submitted by the R-04 tutorialStep watcher from INSIDE queueFollowUp's async body, so
  // actionCompletedTick pulses while pendingFollowUp is STILL true (its `finally` hasn't
  // run). availableActions is already ['endTurn'] and currentAction is null, but the
  // armed auto-start bails on the pendingFollowUp guard — and nothing re-fires once it
  // clears, leaving a manual End Turn + Undo. The fix retries when pendingFollowUp settles.
  it('auto-ends after a capture chain when pendingFollowUp is still true at completion, then clears', async () => {
    const board = createBoardInteraction();
    const { controller, execute } = makeController({ pick: null, action: null });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [] } }),
      availableActions: ref(['endTurn']),
    });

    await nextTick();
    execute.mockClear();

    // Mirror the live state at completion: endTurn is the sole action, currentAction is
    // cleared, but the followUp machinery hasn't unwound yet → pendingFollowUp is true.
    controller.pendingFollowUp.value = true;
    controller.actionCompletedTick.value++;
    await nextTick();
    await nextTick();
    // Bails on pendingFollowUp — must NOT have auto-executed endTurn yet.
    expect(execute).not.toHaveBeenCalledWith('endTurn', {});

    // queueFollowUp's `finally` runs: pendingFollowUp clears. The armed retry must now
    // fire and auto-execute the sole endTurn.
    controller.pendingFollowUp.value = false;
    await nextTick();
    await nextTick();

    expect(execute).toHaveBeenCalledWith('endTurn', {});
  });
});

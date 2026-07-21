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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import { createBoardInteraction } from './useBoardInteraction.js';
import { useBoardActionBridge } from './useBoardActionBridge.js';
import { useActionController } from './useActionController.js';
import { _clearShownWarnings } from '../../utils/dev.js';
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
      isViewingHistory: ref(false),
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
      isViewingHistory: ref(false),
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
      isViewingHistory: ref(false),
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
      isViewingHistory: ref(false),
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
      isViewingHistory: ref(false),
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
      isViewingHistory: ref(false),
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
      isViewingHistory: ref(false),
    });

    await nextTick(); // settle the initial auto-start evaluation
    execute.mockClear();

    // Simulate the selection-step completion of the capture chain's final hop.
    // actionCompletedTick is Readonly<Ref> on the public API; the test pokes it to
    // simulate an end-of-chain pulse.
    (controller.actionCompletedTick as { value: number }).value++;
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
      isViewingHistory: ref(false),
    });

    await nextTick();
    execute.mockClear();

    // Mirror the live state at completion: endTurn is the sole action, currentAction is
    // cleared, but the followUp machinery hasn't unwound yet → pendingFollowUp is true.
    controller.pendingFollowUp.value = true;
    // actionCompletedTick is Readonly<Ref> on the public API; the test pokes it to
    // simulate an end-of-chain pulse.
    (controller.actionCompletedTick as { value: number }).value++;
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

  // AUTOEXEC-01 (D7): a sole no-selection action marked .manual() must be
  // auto-STARTED (surfaced) but never auto-EXECUTED — the player still takes the
  // beat (e.g. a draw is not silently played for them). Covers both auto-execute
  // routes: the primary isMyTurn/actionsWithMetadata watcher and the end-turn
  // actionCompletedTick coalescing path.
  describe('manual() sole no-selection action (AUTOEXEC-01)', () => {
    it('does NOT auto-execute a manual sole no-selection action via the primary watcher path', async () => {
      const board = createBoardInteraction();
      const { controller, execute } = makeController({ pick: null, action: null });

      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [], manual: true } }),
        availableActions: ref(['endTurn']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();

      expect(execute).not.toHaveBeenCalledWith('endTurn', {});
    });

    it('does NOT auto-execute a manual sole no-selection action via the actionCompletedTick path', async () => {
      const board = createBoardInteraction();
      const { controller, execute } = makeController({ pick: null, action: null });

      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [], manual: true } }),
        availableActions: ref(['endTurn']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      execute.mockClear();

      (controller.actionCompletedTick as { value: number }).value++;
      await nextTick();
      await nextTick();

      expect(execute).not.toHaveBeenCalledWith('endTurn', {});
    });

    it('negative control: still auto-executes a sole no-selection action WITHOUT manual', async () => {
      const board = createBoardInteraction();
      const { controller, execute } = makeController({ pick: null, action: null });

      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [] } }),
        availableActions: ref(['endTurn']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();

      expect(execute).toHaveBeenCalledWith('endTurn', {});
    });
  });

  // Custom UI and Action Panel both consume the bridge through the SAME
  // useBoardActionBridge wiring (CLAUDE.md parity rule: no separate code path
  // per UI). These two tests exercise the identical bridge behavior under the
  // two consumption framings to prove neither can auto-execute a manual() sole
  // option — there is no divergent path to patch separately.
  describe('Custom UI / Action Panel parity for manual() (AUTOEXEC-01)', () => {
    it('Custom UI framing: does not auto-execute a manual sole no-selection action', async () => {
      const board = createBoardInteraction();
      const { controller, execute } = makeController({ pick: null, action: null });

      // Custom UI consumes the bridge exactly like this — no separate wiring.
      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ draw: { name: 'draw', selections: [], manual: true } }),
        availableActions: ref(['draw']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();

      expect(execute).not.toHaveBeenCalledWith('draw', {});
    });

    it('Action Panel framing: does not auto-execute a manual sole no-selection action', async () => {
      const board = createBoardInteraction();
      const { controller, execute } = makeController({ pick: null, action: null });

      // Action Panel consumes the SAME bridge wiring as Custom UI — asserting the
      // single shared behavior twice, per the parity rule.
      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ draw: { name: 'draw', selections: [], manual: true } }),
        availableActions: ref(['draw']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();

      expect(execute).not.toHaveBeenCalledWith('draw', {});
    });
  });

  // Adversarial: the end-turn coalescing / actionCompletedTick route must not
  // defeat manual() even after the armed retry (pendingFollowUp settling) runs.
  it('adversarial: actionCompletedTick + armed retry cannot defeat manual() suppression', async () => {
    const board = createBoardInteraction();
    const { controller, execute } = makeController({ pick: null, action: null });

    useBoardActionBridge({
      controller,
      boardInteraction: board,
      isMyTurn: ref(true),
      autoEndTurn: ref(true),
      actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [], manual: true } }),
      availableActions: ref(['endTurn']),
      isViewingHistory: ref(false),
    });

    await nextTick();
    execute.mockClear();

    // Mirror the pendingFollowUp-still-true race from the existing adversarial
    // capture-chain test, but with manual:true metadata.
    controller.pendingFollowUp.value = true;
    (controller.actionCompletedTick as { value: number }).value++;
    await nextTick();
    await nextTick();
    expect(execute).not.toHaveBeenCalledWith('endTurn', {});

    // The armed retry fires once pendingFollowUp clears — must still not
    // auto-execute the manual action.
    controller.pendingFollowUp.value = false;
    await nextTick();
    await nextTick();

    expect(execute).not.toHaveBeenCalledWith('endTurn', {});
  });

  describe('dev warning on the un-manual() silent auto-execute path (AUTOEXEC-01)', () => {
    beforeEach(() => {
      _clearShownWarnings();
    });

    it('warns exactly once naming the action and mentioning .manual() for a non-manual sole option', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const board = createBoardInteraction();
      const { controller } = makeController({ pick: null, action: null });

      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [] } }),
        availableActions: ref(['endTurn']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();

      const relevantCalls = warnSpy.mock.calls.filter(call => String(call[0]).includes('endTurn'));
      expect(relevantCalls.length).toBe(1);
      expect(String(relevantCalls[0][0])).toContain('endTurn');
      expect(String(relevantCalls[0][0])).toContain('.manual()');

      warnSpy.mockRestore();
    });

    it('does NOT re-warn on a second identical trigger (once-per-action)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const board = createBoardInteraction();
      const { controller, execute } = makeController({ pick: null, action: null });

      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ endTurn: { name: 'endTurn', selections: [] } }),
        availableActions: ref(['endTurn']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();
      const firstCount = warnSpy.mock.calls.filter(call => String(call[0]).includes('endTurn')).length;
      expect(firstCount).toBe(1);

      // Trigger the sole no-selection auto-execute branch a second time.
      execute.mockClear();
      (controller.actionCompletedTick as { value: number }).value++;
      await nextTick();
      await nextTick();

      const secondCount = warnSpy.mock.calls.filter(call => String(call[0]).includes('endTurn')).length;
      expect(secondCount).toBe(1); // still just the one warning — no re-warn

      warnSpy.mockRestore();
    });

    it('never warns when the sole no-selection action is manual()', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const board = createBoardInteraction();
      const { controller } = makeController({ pick: null, action: null });

      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({ draw: { name: 'draw', selections: [], manual: true } }),
        availableActions: ref(['draw']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();

      const relevantCalls = warnSpy.mock.calls.filter(call => String(call[0]).includes('draw'));
      expect(relevantCalls.length).toBe(0);

      warnSpy.mockRestore();
    });

    // Review follow-up (156-REVIEW WR-02): .manual() on an action that HAS
    // selections is a no-op — surface that to the author instead of ignoring it.
    it('warns once when .manual() is applied to a sole action that has selections', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const board = createBoardInteraction();
      const { controller, start } = makeController({ pick: null, action: null });

      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({
          play: { name: 'play', selections: [{ name: 'card', type: 'chooseElement' }], manual: true },
        }),
        availableActions: ref(['play']),
        isViewingHistory: ref(false),
      });

      await nextTick();
      await nextTick();

      const relevantCalls = warnSpy.mock.calls.filter(call => String(call[0]).includes('play'));
      expect(relevantCalls.length).toBe(1);
      expect(String(relevantCalls[0][0])).toContain('no effect');
      // The selection action still auto-starts (surfaces its prompt) — the
      // warning does not suppress it.
      expect(start).toHaveBeenCalled();
      expect(start.mock.calls[0][0]).toBe('play');

      warnSpy.mockRestore();
    });
  });

  // T-160-BLOCKER (D27 commit-leak parity gap): ActionPanel.vue gates its OWN
  // executeAction on `props.completed` (component-level), but every custom/
  // drag-drop UI executes through THIS bridge, which historically checked only
  // `isExecuting`/`isMyTurn` before calling `controller.execute()`. A seat that
  // has already committed its simultaneous action can have a stale
  // `availableActions`/`isMyTurn` (the broadcast reflecting its own commit lags
  // behind the local optimistic state) — the bridge's own auto-retry-after-
  // execution watcher then re-fires `executeAction` and re-submits.
  //
  // This uses the REAL useActionController (not the fake `makeController`)
  // because the bug lives in the interaction between the bridge's watchers and
  // the controller's own `isExecuting` transitions — a fake `execute()` never
  // toggles `isExecuting`, so it can't reproduce the natural re-entry.
  describe('D27 commit-leak parity: completed gate at the shared chokepoint (BLOCKER-160)', () => {
    it('refuses a bridge-driven re-submit once the acting seat has committed, even though the bridge itself never checks `completed`', async () => {
      const completed = ref(false);
      let sendCallCount = 0;
      // Simulates the server confirming the commit — in the real app this flips
      // via the next state broadcast (GameShell's `myCompleted`), but
      // `availableActions`/`isMyTurn` do NOT flip synchronously with it, which is
      // exactly the staleness window the bridge's auto-retry watcher races into.
      const sendAction = vi.fn().mockImplementation(async () => {
        sendCallCount++;
        if (sendCallCount === 1) {
          completed.value = true;
          return { success: true, data: {} };
        }
        // A second network call is the bug itself (the leaked re-commit). Never
        // resolve it — this freezes `isExecuting` true, which naturally bounds
        // the bridge's auto-retry watcher instead of letting an unbounded
        // reactive re-trigger loop spin the Vue scheduler (and the test process).
        return new Promise<never>(() => {});
      });

      const controller = useActionController({
        sendAction,
        availableActions: ref(['commit']),
        isViewingHistory: ref(false),
        actionMetadata: ref({}), // no metadata for `commit` -> synthesized 0-selection meta
        isMyTurn: ref(true), // stays true — the bug is that nothing ever re-checks this either
        completed,
      } as any);

      const board = createBoardInteraction();
      useBoardActionBridge({
        controller,
        boardInteraction: board,
        isMyTurn: ref(true),
        autoEndTurn: ref(true),
        actionMetadata: ref({}),
        availableActions: ref(['commit']),
        isViewingHistory: ref(false),
      });

      // Initial mount auto-starts + auto-executes the sole no-selection action.
      await nextTick();
      await nextTick();
      await nextTick();
      // The isExecuting watcher's completion retry re-evaluates on the next
      // flush(es) — availableActions never changed, so without a `completed`
      // gate the sole action auto-executes AGAIN.
      await nextTick();
      await nextTick();
      await nextTick();

      expect(sendAction).toHaveBeenCalledTimes(1);
    });
  });
});

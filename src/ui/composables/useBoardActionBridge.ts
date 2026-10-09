/**
 * useBoardActionBridge — the always-on bridge between the action controller and
 * the shared board-interaction substrate.
 *
 * WHY THIS EXISTS (Phase 94 board-centric playability):
 * Board-centric is the zero-config default — when every active choice is board
 * anchored the board is the primary surface, and for a candidate set too large
 * for the panel to list the panel hands the choice (and keyboard focus) to the
 * board outright (#172). Previously the controller→board sync (auto-start, setValidElements, the choice
 * callback, board-click dispatch) lived INSIDE ActionPanel, so it died exactly
 * when the panel was hidden: clicking a hex/cell/piece only highlighted it and
 * never became selectable, because `validElements` was never populated.
 *
 * This composable lifts that sync OUT of the view layer into GameShell, where it
 * runs unconditionally — independent of whether the footer ActionPanel, a
 * `#action-panel` slot, or the platform-only `platformActionPanelEscapeHatch`
 * prop is in play (that prop is a platform escape hatch, not an ordinary
 * author-facing option — see GameShell's prop doc; games should suppress an
 * individual action's Action Panel button via `.suppressFromActionPanel()` on the action
 * definition instead). The ActionPanel is now purely presentational; the
 * board substrate is fed from here.
 *
 * Pit of Success: there is exactly ONE place that feeds board interaction, and
 * ONE set of mutators (`actionMutators.ts`) that starts, executes and answers
 * actions, which this bridge and the panel both call (#513). The panel cannot
 * fall out of sync with the board because it neither feeds the board nor holds
 * its own copy of those operations.
 */
import { computed, watch, nextTick, type Ref, type ComputedRef } from 'vue';
import type { BoardInteraction, ElementRef } from './useBoardInteraction.js';
import type {
  UseActionControllerReturn,
  EnrichedPickMetadata,
  EnrichedActionMetadata,
  ChoiceWithRefs,
  EnrichedValidElement,
} from './useActionControllerTypes.js';
import { choiceBoardTarget, devWarn, resolvePickCounts } from './actionControllerHelpers.js';
import { createActionMutators } from './actionMutators.js';

interface BoardActionBridgeOptions {
  controller: UseActionControllerReturn;
  /** Shared board interaction substrate. Undefined outside a GameShell — bridge is a no-op then. */
  boardInteraction: BoardInteraction | undefined;
  /** Reactive: is it the local player's turn. */
  isMyTurn: Ref<boolean | undefined> | ComputedRef<boolean | undefined>;
  /** Reactive: auto mode (auto-start single action / auto-execute no-selection action). */
  autoEndTurn: Ref<boolean> | ComputedRef<boolean>;
  /** Reactive: action metadata keyed by action name. */
  actionMetadata: Ref<Record<string, EnrichedActionMetadata> | undefined> | ComputedRef<Record<string, EnrichedActionMetadata> | undefined>;
  /** Reactive: available action names for the current player. */
  availableActions: Ref<string[]> | ComputedRef<string[]>;
  /**
   * Reactive: action name → why it is disabled (from the action's `.disabled()`
   * rule or the tutorial gate), as projected in `PlayerGameState.disabledActions`.
   *
   * A disabled action stays in `availableActions` so the Action Panel can draw
   * it greyed out WITH its reason. The board substrate must therefore refuse it
   * separately — otherwise auto-start, auto-execute, and board-element clicks
   * would all fire an action the server is about to reject, and the player would
   * meet an error toast instead of an explanation.
   */
  disabledActions: Ref<Record<string, string> | undefined> | ComputedRef<Record<string, string> | undefined>;
  /**
   * Reactive: true while the debug panel shows historical state (time-travel).
   * Board clicks must never commit to the live engine while this is true —
   * LIBX-04 (D31). Guarded independently in every action mutator
   * (`createActionMutators`) rather than derived from isMyTurn, since a pick already in progress does
   * not re-check isMyTurn mid-action.
   */
  isViewingHistory: Ref<boolean> | ComputedRef<boolean>;
  /**
   * Reactive: the seat has committed the current simultaneous step (D27), the
   * same flag the controller's `completed` option takes. A committed seat never
   * executes again from the board. Absent where there are no simultaneous steps.
   */
  completed?: Ref<boolean | undefined> | ComputedRef<boolean | undefined>;
  /**
   * Reactive: which game tree the server is running -- `PlayerGameState`'s
   * `gameInstanceId` and `restoreEpoch`, read off each broadcast.
   *
   * A CHANGE in either means every element id the client captured is stale,
   * including the `validElements` frozen into the open pick's snapshot: the
   * epoch moves when the runner of this game was replaced (undo / rewind), and
   * the id moves when the game itself was (New game, #356). The bridge tears
   * the pick down on either, which is the client-side half of what the host
   * already does for its own element-id state (hint, heatmap, pending
   * selections) on an undo or rewind.
   *
   * `undefined` while no state has arrived yet, and from a host with no table
   * (a world): nothing observed, so nothing is torn down.
   */
  runnerIdentity: Ref<RunnerIdentity | undefined> | ComputedRef<RunnerIdentity | undefined>;
}

/** The game tree a table's broadcast came from. See `runnerIdentity`. */
export interface RunnerIdentity {
  gameInstanceId: string;
  restoreEpoch: number;
}

function formatActionName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Pick the clickable ref for a valid element. Prefer the highlight-role ref
 * (carries notation when the game author supplied a boardRef), else the first
 * ref, else an id-only ref. matchesRef precedence (F22) makes the id win, so an
 * id-only ref reliably matches the rendered element by its element id.
 */
function elementClickRef(ve: EnrichedValidElement): ElementRef {
  const ref =
    ve.refs?.find(r => r.role === 'highlight')?.ref ??
    ve.refs?.[0]?.ref;
  return ref ?? { id: ve.id };
}

/**
 * Wire the action controller to the board-interaction substrate. Call ONCE from
 * GameShell setup; it sets up reactive watchers that live for the GameShell
 * lifetime. No-op when boardInteraction is undefined.
 */
export function useBoardActionBridge(opts: BoardActionBridgeOptions): void {
  const { controller, boardInteraction, isMyTurn, autoEndTurn, actionMetadata, availableActions, disabledActions, isViewingHistory, completed, runnerIdentity } = opts;

  // Without a board substrate there is nothing to feed. (Should not happen inside GameShell.)
  if (!boardInteraction) return;
  const board = boardInteraction;

  const currentAction = controller.currentAction;
  const currentPick = controller.currentPick;
  const currentArgs = controller.currentArgs;
  const isExecuting = controller.isExecuting;

  // Metadata for available actions, with a basic fallback for actions lacking metadata.
  const actionsWithMetadata = computed<EnrichedActionMetadata[]>(() => {
    const names = availableActions.value ?? [];
    const meta = actionMetadata.value;
    return names.map(name => {
      const m = meta?.[name];
      if (m) return m;
      return { name, prompt: formatActionName(name), selections: [] as EnrichedPickMetadata[] };
    });
  });

  /**
   * Why this action is disabled for the local player, or `undefined` when it is
   * not. The single gate consulted by every path in this file that could START
   * or EXECUTE an action.
   */
  function actionDisabledReason(actionName: string): string | undefined {
    // Optional-chained on the option itself: the type makes it required, and a
    // missing one must not take the whole board down.
    return disabledActions?.value?.[actionName];
  }

  // Current action metadata — prefer the controller snapshot (handles followUp
  // actions that aren't in availableActions).
  const currentActionMeta = computed<EnrichedActionMetadata | null>(() => {
    if (!currentAction.value) return null;
    const snapshot = controller.actionSnapshot?.value;
    if (snapshot?.actionName === currentAction.value && snapshot.metadata) {
      return snapshot.metadata;
    }
    return actionsWithMetadata.value.find(a => a.name === currentAction.value) ?? null;
  });

  // Delegates to the shared `resolvePickCounts` helper — the single source of
  // truth also used by `useActionController` and `ActionPanel.vue` — so custom
  // UIs prefer the per-step server-resolved snapshot value (real accumulated
  // args) over the static metadata baked in at action-start time (v4.8-WR01),
  // and a board and the panel can never disagree about whether this pick is a
  // set or a sequence (#249): the same click would mean two different things.
  const currentPickCounts = computed(() =>
    resolvePickCounts(
      currentPick.value,
      currentArgs.value,
      controller.actionSnapshot?.value?.pickSnapshots,
    )
  );
  const currentMultiSelect = computed(() => currentPickCounts.value.multiSelect);
  const currentOrderedList = computed(() => currentPickCounts.value.orderedList);

  // What the open pick offers, exactly as the engine lists it (#407): the same
  // two computeds the Action Panel reads, so the board and the panel can never
  // offer different things. They are REACTIVE (they read snapshotVersion), so a
  // list fetched after the watcher below first ran still reaches the board (the
  // Checkers destination step). The board keeps the anchored choices the panel
  // splits off: those are exactly the clickable ones.
  const offeredChoices = controller.currentChoices;
  const offeredElements = controller.validElements;

  // ── Action mutators ──────────────────────────────────────────────────────────
  // The same module the Action Panel starts and executes through (#513), so a
  // board-started action and a panel-started one change the controller and the
  // board identically.
  const { startAction, executeAction, setSelectionValue, toggleMultiSelectValue, appendListValue } = createActionMutators(
    controller,
    board,
    {
      isViewingHistory: () => isViewingHistory.value,
      isMyTurn: () => !!isMyTurn.value,
      isCompleted: () => !!completed?.value,
      disabledReason: actionDisabledReason,
      actionMetadata: (name) => actionsWithMetadata.value.find(a => a.name === name),
    },
  );

  // ── Auto-start single action ─────────────────────────────────────────────────

  // Armed when an action completes via the selection-step transport (the controller
  // pulses actionCompletedTick). It survives the gap until the game_state broadcast
  // updates availableActions to the sole no-selection endTurn — that broadcast lands
  // on a SEPARATE async channel AFTER the completion, so a one-shot skip=false at
  // completion time evaluates against stale actions and misses (the bug: a checkers
  // capture chain leaves a manual End Turn + Undo on a real client; follow mode just
  // won the race). While armed, the availableActions watcher requests skip=false, so
  // the sole endTurn auto-executes whenever the action set finally settles.
  let autoEndArmed = false;

  function tryAutoStartSingleAction(skipNoSelections = false): void {
    if (autoEndTurn.value === false) return;
    if (!isMyTurn.value) return;
    if (currentAction.value) return;
    if (isExecuting.value) return;
    if (controller.pendingFollowUp.value) return;

    const actions = actionsWithMetadata.value;
    if (actions.length !== 1) return;
    const action = actions[0];

    // The sole available action is disabled: leave it alone. Auto-starting it
    // would replace a button that explains itself with a rejection from the
    // server, and auto-EXECUTING it would do that without the player touching
    // anything. Deliberately checked here rather than by filtering the action
    // list: filtering would change "exactly one action" to mean "exactly one
    // ENABLED action", which would start auto-executing a lone `pass` the
    // moment some other action went grey.
    if (actionDisabledReason(action.name)) return;

    if (action.selections.length > 0) {
      autoEndArmed = false; // a selection action auto-started — the auto-end intent is moot
      // AUTOEXEC-01 / F-02 (v4.8): a `.manual()` selection action still
      // auto-STARTS (surfaces its prompt), but the controller suppresses
      // auto-fill of a single enabled choice so the action never silently
      // auto-executes (the D7 auto-draw). The player picks deliberately.
      void startAction(action.name);
    } else if (!skipNoSelections && actionMetadata.value) {
      autoEndArmed = false; // consumed: the sole no-selection action (endTurn) is firing
      if (action.manual) {
        // AUTOEXEC-01 (D7): suppress the silent auto-execute of a sole
        // no-selection action. The shell does NOT play it for the player — they
        // take the beat themselves via the Action Panel button (default UI) or a
        // control the game wires up in a custom board UI. There is no separate
        // "start" step for a no-selection action, so this is a plain bail-out.
        return;
      }
      devWarn(
        `autoexec:manual-hint:${action.name}`,
        `Action "${action.name}" is the only option and was auto-executed for the player. ` +
          `If this action should require a deliberate tap (e.g. a draw), mark it .manual().`,
      );
      void executeAction(action.name, {});
    }
  }

  // ── Auto-start scheduling (turn-transition race fix) ─────────────────────────
  //
  // During a turn transition the available actions CHURN across async ticks —
  // availableActions flickers e.g. [] → ["endTurn"] → ["move"] while isExecuting
  // toggles (a sole no-selection action like endTurn auto-executes between, which
  // is intended). tryAutoStartSingleAction used to be called DIRECTLY from all
  // three watchers below, so it fired on EVERY transient tick: `move` would
  // auto-start on a transient ["move"], then get torn down when availableActions
  // momentarily excluded it — leaving a manual "Move" button (the bug).
  //
  // Fix: coalesce every auto-start request into ONE evaluation per flush, run on
  // nextTick once the reactive state of the flush has SETTLED rather than on the
  // transient churn. We AND the skipNoSelections flag across all callers that
  // batched into this flush (see scheduleAutoStart) so a pure flow-transition does
  // not auto-execute a no-selection action, while a real execution-complete still
  // does.
  let autoStartScheduled = false;
  // AND-accumulator across the batched callers of the current flush. Starts true so
  // the AND is identity until a skip=false caller participates.
  let pendingSkipNoSelections = true;

  function scheduleAutoStart(skipNoSelections: boolean): void {
    // Logical-AND coalescing: a pure flow-transition (only the availableActions
    // watcher, skip=true) stays skip=true and does NOT auto-execute a sole
    // no-selection endTurn; when the isExecuting watcher (skip=false) participates —
    // i.e. right after an execution completes — the AND yields false so a sole
    // endTurn still auto-executes as before.
    pendingSkipNoSelections = pendingSkipNoSelections && skipNoSelections;
    if (autoStartScheduled) return;
    autoStartScheduled = true;
    void nextTick(() => {
      autoStartScheduled = false;
      const skip = pendingSkipNoSelections;
      pendingSkipNoSelections = true; // reset accumulator for the next flush
      tryAutoStartSingleAction(skip);
    });
  }

  // ── Watchers ─────────────────────────────────────────────────────────────────

  // Auto-start on initial render and when turn/actions change.
  watch([() => isMyTurn.value, actionsWithMetadata], () => {
    // Once the turn passes off this seat the pending auto-end intent is stale — drop
    // it so it can never leak into a later turn.
    if (!isMyTurn.value) autoEndArmed = false;
    scheduleAutoStart(false);
  }, { immediate: true });

  // Clear stale action state on flow transitions; retry auto-start.
  watch(() => availableActions.value, (actions, oldActions) => {
    let shouldClear = false;
    // Turn-transition race: an EMPTY availableActions is a transient
    // "transitioning / waiting" state, NOT a signal that the current action is
    // stale. Tearing down currentAction on a transient empty tick is exactly what
    // killed a freshly auto-started `move`. Only clear when a NON-empty action set
    // genuinely no longer contains the current action.
    if (currentAction.value && actions.length > 0 && !actions.includes(currentAction.value)) shouldClear = true;
    if (oldActions && oldActions.length > 0 && actions.length > 0) {
      if (!actions.some(a => oldActions.includes(a))) shouldClear = true;
    }
    if (shouldClear) {
      // Never tear down a server-pending action (a followUp like collectEquipment
      // is never in availableActions by design — clearing it kills live chains).
      const serverPending = controller.pendingOnServer?.value ?? false;
      if (!serverPending) {
        controller.cancel();
        board.clear();
      }
    }
    // While an auto-end is armed (a step-wise action just completed), a settling
    // action set must be treated as skip=false so the sole no-selection endTurn
    // auto-executes the moment the broadcast lands — not skip=true, which would
    // leave it as a manual button.
    scheduleAutoStart(/* skipNoSelections */ autoEndArmed ? false : true);
  });

  // The server replaced its runner (undo / rewind / host restore) or the game
  // itself (New game, #356): every element id this client captured came from a
  // game tree that no longer exists, so the open pick is unanswerable and must go.
  //
  // Nothing else on the client can see this. `availableActions` is typically
  // BYTE-IDENTICAL across an undo inside a turn, and across a new game that opens
  // at the step the old one was on, so the watcher above never fires;
  // `validElements` is frozen into the pick snapshot taken when the pick opened
  // and only re-runs on `snapshotVersion`, which a broadcast does not bump.
  // Without this the board keeps offering destinations computed from the
  // position the piece was in BEFORE the undo, and the panel keeps listing the
  // previous deal's cards after a new one.
  //
  // Unconditional, unlike the availableActions teardown above: that one spares a
  // server-pending followUp because the server still holds it. Here the server
  // has already discarded every pending selection (the host clears them all on an
  // undo or rewind; a new game has none), so sparing it would strand
  // the client holding a chain the server has forgotten.
  //
  // Compared with the last identity OBSERVED rather than the watcher's previous
  // value, so a frame with no state between two games cannot make the second
  // one look like a first observation.
  let observedRunner: RunnerIdentity | undefined;
  // Optional-chained on the option itself, exactly like `disabledActions` above:
  // the type makes it required, and a missing one must not take the whole board
  // down (a host that omits it simply never reports a replacement).
  watch(() => runnerIdentity?.value, (runner) => {
    if (!runner) return;
    const previous = observedRunner;
    observedRunner = runner;
    // First observation is not a replacement -- there is no prior tree to be stale.
    if (!previous) return;
    if (runner.gameInstanceId === previous.gameInstanceId && runner.restoreEpoch === previous.restoreEpoch) return;
    controller.cancel();
    board.clear();
    // Re-offer from the new position: a seat whose sole action auto-starts
    // gets it back immediately, now computed against the true state. `skip
    // NoSelections` is TRUE on purpose -- a no-selection action must stay a
    // deliberate button press here, never auto-execute the thing just undone.
    scheduleAutoStart(/* skipNoSelections */ true);
  }, { immediate: true });

  // Browsing history (#553): the board and the Action Panel are handed no
  // actions and no turn then, and every commit is refused, so a pick left open
  // would ask for a move beside a past board. Entering history cancels it, as
  // the panel's Cancel button does, so the panel and every custom UI reading
  // this controller and board show no pick. Returning re-offers from the live
  // position the way the runner watcher above does, a no-selection action
  // staying a deliberate press.
  watch(() => isViewingHistory.value, (browsing) => {
    if (!browsing) {
      scheduleAutoStart(/* skipNoSelections */ true);
      return;
    }
    if (!currentAction.value) return;
    controller.cancel();
    board.clear();
  });

  // Retry auto-start when an execution completes (next action may auto-start).
  watch(isExecuting, (executing, wasExecuting) => {
    if (wasExecuting && !executing) scheduleAutoStart(false);
  });

  // Parity for the selection-step transport: an action completed step-wise (e.g. a
  // checkers multi-jump capture chain whose final hop lands on handleOnSelectFill)
  // never toggles isExecuting, so the isExecuting watcher never fires. The controller
  // pulses actionCompletedTick on such completions. ARM the auto-end (the endTurn
  // broadcast arrives later on a separate channel) and also try immediately in case
  // the action set is already settled — so a capture chain auto-ends the turn just
  // like a single move, regardless of broadcast timing.
  watch(() => controller.actionCompletedTick.value, () => {
    autoEndArmed = true;
    scheduleAutoStart(false);
  });

  // The capture-chain's final hop is submitted by the R-04 tutorialStep watcher from
  // INSIDE queueFollowUp's async body, so actionCompletedTick pulses while
  // pendingFollowUp is still true (its `finally` hasn't run). The armed auto-start
  // bails on the pendingFollowUp guard, and without this nothing re-fires once it
  // clears → the turn stays at a manual End Turn + Undo. Retry when pendingFollowUp
  // settles false: skip=false only while armed (a turn-ending completion is pending),
  // so ordinary mid-chain followUp transitions are unaffected.
  watch(() => controller.pendingFollowUp.value, (pending, wasPending) => {
    if (wasPending && !pending) scheduleAutoStart(autoEndArmed ? false : true);
  });

  // Feed the board substrate's selectable elements + click callback for the
  // current pick. This is the watcher whose absence broke board-centric play.
  watch([currentPick, offeredElements, offeredChoices], ([selection]) => {
    if (!selection) {
      board.setValidElements([], () => {});
      board.setDraggableSelectedElement(null);
      return;
    }

    if (currentAction.value && currentActionMeta.value) {
      const idx = currentActionMeta.value.selections.findIndex(s => s.name === selection.name);
      board.setCurrentPick(idx, selection.name);
    }

    let validElems: { id: number; ref: ElementRef; disabled?: string; display?: string }[] = [];
    let onSelect: ((id: number) => void) | null = null;

    if (selection.type === 'element' || selection.type === 'elements') {
      validElems = offeredElements.value.map(ve => ({
        id: ve.id,
        ref: elementClickRef(ve),
        disabled: ve.disabled,
        // The wording the panel would have used, carried to the board because
        // the board is now the only surface this candidate appears on (#189).
        display: ve.display ?? String(ve.id),
      }));
      onSelect = (elementId: number) => {
        const multiSelect = currentMultiSelect.value;
        if (selection.type === 'elements' && multiSelect) {
          void toggleMultiSelectValue(selection.name, elementId);
        } else {
          void setSelectionValue(selection.name, elementId);
        }
      };
      board.setDraggableSelectedElement(null);
    } else if (selection.type === 'choice') {
      // Note: selection.choices carries static metadata choices only; dynamic choices
      // (fetched via fetchPickChoices) are NOT present on selection.choices. Use
      // offeredChoices.value (reactive, reads snapshotVersion) for the actual choices.
      const choices = offeredChoices.value;
      const choicesWithRefs = choices.filter((c: ChoiceWithRefs) => (c.refs ?? []).length > 0);
      if (choicesWithRefs.length > 0) {
        const refToChoice = new Map<number, { value: unknown; ref: ElementRef; disabled?: string; display: string }>();
        // Synthetic key for notation-only (or name-only) target refs that carry no
        // element id (e.g. Checkers destination squares). The key is only a token
        // used to route the click back to its choice; matchesRef matches the clicked
        // element by notation/name, never by this id, so negatives can't collide
        // with real positive element ids.
        let syntheticKey = -1;
        for (const choice of choicesWithRefs) {
          const ref = choiceBoardTarget(choice);
          if (!ref) continue;
          // Two choices on one element: the first is the one the board picks
          // there, for an id as for a notation (#341), so a later one never
          // replaces it.
          if (ref.id !== undefined && refToChoice.has(ref.id)) continue;
          const key = ref.id ?? syntheticKey--;
          refToChoice.set(key, { value: choice.value, ref, disabled: choice.disabled, display: choice.display });
        }
        validElems = Array.from(refToChoice.entries()).map(([id, { ref, disabled, display }]) => ({ id, ref, disabled, display }));
        onSelect = (elementId: number) => {
          const entry = refToChoice.get(elementId);
          if (entry === undefined || entry.disabled) return;
          if (currentOrderedList.value) {
            void appendListValue(selection.name, entry.value);
          } else if (currentMultiSelect.value) {
            void toggleMultiSelectValue(selection.name, entry.value);
          } else {
            void setSelectionValue(selection.name, entry.value);
          }
        };
      }

      // If a previous element selection was auto-filled, mark it as draggable.
      if (selection.filterBy && currentActionMeta.value) {
        const firstSel = currentActionMeta.value.selections[0];
        if ((firstSel?.type === 'element' || firstSel?.type === 'elements') && currentArgs.value[firstSel.name] !== undefined) {
          const selectedPieceId = currentArgs.value[firstSel.name] as number;
          const firstValid = controller.getValidElements(firstSel).find(ve => ve.id === selectedPieceId);
          board.setDraggableSelectedElement(firstValid ? elementClickRef(firstValid) : { id: selectedPieceId });
        }
      }
    }

    if (validElems.length > 0 && onSelect) {
      board.setValidElements(validElems, onSelect);
    } else {
      board.setValidElements([], () => {});
    }
  }, { immediate: true });

  // Mirror the controller's action into the board substrate + expose the choice
  // callback so custom UIs can trigger non-element choices (e.g. suit selection).
  //
  // Keyed on the START, not only the name (#384). When the new state lands
  // before the action's reply, the reply clears `move` and the auto-start opens
  // `move` again in the same flush. A watch on the name sees `move` both times
  // and never runs, so the board stays cleared by createActionMutators().startAction, and
  // the external-cancel watcher below reads that empty board as the player
  // cancelling.
  watch([currentAction, controller.actionStartTick], ([action]) => {
    if (action) {
      const pickName = currentPick.value?.name ?? null;
      const pickIndex = currentActionMeta.value?.selections.findIndex(s => s.name === pickName) ?? 0;
      board.setCurrentAction(action, pickIndex >= 0 ? pickIndex : 0, pickName);
      board.setChoiceSelectCallback((selectionName: string, value: unknown) => {
        if (currentPick.value?.name === selectionName) {
          void setSelectionValue(selectionName, value);
          return;
        }
        devWarn(
          'board-interaction-choice-pick-mismatch',
          `triggerChoiceSelect('${selectionName}', ...) was ignored because the active action's current selection is ` +
            `'${currentPick.value?.name ?? 'none'}', not '${selectionName}'. ` +
            `Fill selections in order, or trigger the choice once '${selectionName}' is the active selection.`,
        );
      });
    } else {
      board.clear();
    }
  }, { immediate: true });

  // External cancel via custom UI calling board.clear(): sync the controller.
  watch(() => board.currentAction, (boardAction) => {
    if (boardAction !== null || currentAction.value === null) return;
    const actionAtClear = currentAction.value;
    void nextTick(() => {
      if (currentAction.value === actionAtClear && board.currentAction == null) {
        controller.cancel();
      }
    });
  });

  // Board element clicked: dispatch selection, or auto-start an action whose
  // first element selection accepts the clicked element.
  watch(() => board.selectedElement, (selected) => {
    if (!selected) return;

    if (currentPick.value && (currentPick.value.type === 'element' || currentPick.value.type === 'elements')) {
      // triggerElementSelect already handled the click via onElementSelect.
      if (board.onElementSelect) return;
      if (Object.values(currentArgs.value).includes(selected.id)) return;
      const validElem = offeredElements.value.find(e => {
        if (selected.id !== undefined && e.id === selected.id) return true;
        if (selected.notation && elementClickRef(e).notation === selected.notation) return true;
        return false;
      });
      if (validElem) void setSelectionValue(currentPick.value.name, validElem.id);
      return;
    }

    if (!isMyTurn.value || isExecuting.value) return;

    const elementAction = actionsWithMetadata.value.find(action => {
      const firstSel = action.selections[0];
      if (firstSel?.type !== 'element') return false;
      return firstSel.validElements?.some(e => {
        if (selected.id !== undefined && e.id === selected.id) return true;
        if (selected.notation && elementClickRef(e).notation === selected.notation) return true;
        return false;
      });
    });
    if (!elementAction) return;
    const firstSel = elementAction.selections[0];
    const validElem = firstSel.validElements?.find(e => {
      if (selected.id !== undefined && e.id === selected.id) return true;
      if (selected.notation && elementClickRef(e).notation === selected.notation) return true;
      return false;
    });
    if (validElem) void startAction(elementAction.name, { args: { [firstSel.name]: validElem.id } });
  });
}

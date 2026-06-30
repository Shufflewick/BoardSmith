/**
 * useBoardActionBridge — the always-on bridge between the action controller and
 * the shared board-interaction substrate.
 *
 * WHY THIS EXISTS (Phase 94 board-centric playability):
 * Board-centric is the zero-config default — when every active choice is board
 * anchored, GameShell makes the footer ActionPanel ABSENT from the DOM (D-02).
 * Previously the controller→board sync (auto-start, setValidElements, the choice
 * callback, board-click dispatch) lived INSIDE ActionPanel, so it died exactly
 * when the panel was hidden: clicking a hex/cell/piece only highlighted it and
 * never became selectable, because `validElements` was never populated.
 *
 * This composable lifts that sync OUT of the view layer into GameShell, where it
 * runs unconditionally — independent of whether the footer ActionPanel, a
 * `#action-panel` slot, or `suppressActionPanel` is in play. The ActionPanel is
 * now purely presentational; the board substrate is fed from here.
 *
 * Pit of Success: there is exactly ONE place that feeds board interaction. The
 * panel cannot fall out of sync with the board because the panel no longer feeds
 * the board at all.
 */
import { computed, watch, nextTick, type Ref, type ComputedRef } from 'vue';
import type { BoardInteraction, ElementRef } from './useBoardInteraction.js';
import type {
  UseActionControllerReturn,
  PickMetadata,
  ActionMetadata,
  ChoiceWithRefs,
  ValidElement,
} from './useActionControllerTypes.js';
import { devWarn } from './actionControllerHelpers.js';

export interface BoardActionBridgeOptions {
  controller: UseActionControllerReturn;
  /** Shared board interaction substrate. Undefined outside a GameShell — bridge is a no-op then. */
  boardInteraction: BoardInteraction | undefined;
  /** Reactive: is it the local player's turn. */
  isMyTurn: Ref<boolean | undefined> | ComputedRef<boolean | undefined>;
  /** Reactive: auto mode (auto-start single action / auto-execute no-selection action). */
  autoEndTurn: Ref<boolean> | ComputedRef<boolean>;
  /** Reactive: action metadata keyed by action name. */
  actionMetadata: Ref<Record<string, ActionMetadata> | undefined> | ComputedRef<Record<string, ActionMetadata> | undefined>;
  /** Reactive: available action names for the current player. */
  availableActions: Ref<string[]> | ComputedRef<string[]>;
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
function elementClickRef(ve: ValidElement): ElementRef {
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
  const { controller, boardInteraction, isMyTurn, autoEndTurn, actionMetadata, availableActions } = opts;

  // Without a board substrate there is nothing to feed. (Should not happen inside GameShell.)
  if (!boardInteraction) return;
  const board = boardInteraction;

  const currentAction = controller.currentAction;
  const currentPick = controller.currentPick;
  const currentArgs = controller.currentArgs;
  const isExecuting = controller.isExecuting;

  const multiSelectValues = computed<unknown[]>(() => controller.multiSelectDraft.value?.values ?? []);

  // Metadata for available actions, with a basic fallback for actions lacking metadata.
  const actionsWithMetadata = computed<ActionMetadata[]>(() => {
    const names = availableActions.value ?? [];
    const meta = actionMetadata.value;
    return names.map(name => {
      const m = meta?.[name];
      if (m) return m;
      return { name, prompt: formatActionName(name), selections: [] as PickMetadata[] };
    });
  });

  // Current action metadata — prefer the controller snapshot (handles followUp
  // actions that aren't in availableActions).
  const currentActionMeta = computed<ActionMetadata | null>(() => {
    if (!currentAction.value) return null;
    const snapshot = controller.actionSnapshot?.value;
    if (snapshot?.actionName === currentAction.value && snapshot.metadata) {
      return snapshot.metadata;
    }
    return actionsWithMetadata.value.find(a => a.name === currentAction.value) ?? null;
  });

  const currentMultiSelect = computed(() => {
    const sel = currentPick.value;
    if (!sel) return undefined;
    if (sel.dependsOn && sel.multiSelectByDependentValue) {
      const depValue = currentArgs.value[sel.dependsOn];
      if (depValue !== undefined) return sel.multiSelectByDependentValue[String(depValue)];
      return undefined;
    }
    return sel.multiSelect;
  });

  // Choices for the current pick, with already-selected choice values removed
  // (mirrors ActionPanel.filteredChoices but WITHOUT the D-03 anchored filter —
  // the board needs the anchored choices, those are exactly the clickable ones).
  const choicesForBoard = computed<ChoiceWithRefs[]>(() => {
    if (!currentPick.value) return [];
    // Use the controller's REACTIVE currentChoices (reads snapshotVersion) so this
    // recomputes when async-fetched choices arrive. getCurrentChoices() is a bare
    // function that does not track the fetch version — depending on it meant the
    // board never registered choices that landed after the watcher first ran (the
    // Checkers destination step: pick a piece → destinations never became
    // selectable because their choices arrived after the watcher had run once).
    let choices = controller.currentChoices.value.slice();
    const meta = currentActionMeta.value;
    if (meta) {
      const alreadySelected = new Set<unknown>();
      for (const sel of meta.selections) {
        if (sel.type === 'choice' && sel.name !== currentPick.value.name) {
          const v = currentArgs.value[sel.name];
          if (v !== undefined) alreadySelected.add(v);
        }
      }
      if (alreadySelected.size > 0) choices = choices.filter(c => !alreadySelected.has(c.value));
    }
    return choices;
  });

  // Valid elements for the current element/elements pick, excluding elements
  // already chosen in OTHER element selections of the same action.
  const filteredValidElements = computed<ValidElement[]>(() => {
    const sel = currentPick.value;
    if (!sel || (sel.type !== 'element' && sel.type !== 'elements')) return [];
    // controller.validElements is the REACTIVE source for the current pick (it reads
    // snapshotVersion), so a second-step element pick whose elements are fetched
    // asynchronously still surfaces on the board. getValidElements() is non-reactive.
    const validElements = controller.validElements.value;
    if (validElements.length === 0) return [];

    const alreadySelectedIds = new Set<number>();
    const meta = currentActionMeta.value;
    if (meta) {
      for (const other of meta.selections) {
        if ((other.type === 'element' || other.type === 'elements') && other.name !== sel.name) {
          const v = currentArgs.value[other.name];
          if (typeof v === 'number') alreadySelectedIds.add(v);
          else if (Array.isArray(v)) for (const id of v) if (typeof id === 'number') alreadySelectedIds.add(id);
        }
      }
    }
    if (alreadySelectedIds.size === 0) return validElements;
    return validElements.filter(e => !alreadySelectedIds.has(e.id));
  });

  // ── Action lifecycle helpers (controller delegation) ─────────────────────────

  async function startAction(actionName: string, options?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> }) {
    const meta = actionsWithMetadata.value.find(a => a.name === actionName);
    if (!meta || meta.selections.length === 0) {
      await executeAction(actionName, {});
      return;
    }
    // Clear any stale board state BEFORE starting (not after). The async fetch inside
    // controller.start() triggers snapshotVersion++ which causes watcher D to fire and
    // populate board.validElements. If board.clear() ran AFTER the await, it would wipe
    // the already-populated validElements and watcher D would not re-run (sources unchanged).
    board.clear();
    await controller.start(actionName, options);
    // board.setCurrentAction and board.setValidElements are handled reactively by
    // watchers E and D in response to controller.currentAction / snapshotVersion changes.
  }

  async function executeAction(actionName: string, args: Record<string, unknown>) {
    if (isExecuting.value) return;
    if (!isMyTurn.value) return;
    const filteredArgs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) if (v !== null) filteredArgs[k] = v;
    try {
      const result = await controller.execute(actionName, filteredArgs);
      if (!result.success && result.error) console.error('Action failed:', result.error);
    } catch (err) {
      console.error('Execute action error:', err);
    } finally {
      board.clear();
    }
  }

  async function setSelectionValue(name: string, value: unknown) {
    const selection = currentPick.value;
    // Capture choices BEFORE fill() — fill() advances the pick state so
    // choicesForBoard.value would return the NEXT pick's choices after the await.
    // selection.choices only holds static metadata choices (never dynamic ones),
    // so use choicesForBoard.value to cover both static and dynamically-fetched choices.
    const choicesSnapshot = selection?.type === 'choice' ? choicesForBoard.value.slice() : [];
    const result = await controller.fill(name, value);
    if (!result.valid) {
      console.error('Selection failed:', result.error);
      return;
    }
    // Keep the chosen board element visually selected/highlighted.
    if (selection?.type === 'choice' && choicesSnapshot.length > 0) {
      const choice = choicesSnapshot.find((c: ChoiceWithRefs) => c.value === value);
      if (choice?.refs?.length) {
        const ref = choice.refs.find(r => r.role === 'target')?.ref ?? choice.refs[0]?.ref;
        if (ref) board.selectElement(ref);
      }
    }
  }

  async function toggleMultiSelectValue(selectionName: string, value: unknown) {
    await controller.toggleMultiSelect(selectionName, value);
    updateMultiSelectBoardHighlights();
  }

  function updateMultiSelectBoardHighlights() {
    const selectedValues = multiSelectValues.value;
    if (selectedValues.length === 0) {
      board.setHoveredChoice(null);
      return;
    }
    const sourceRefs: ElementRef[] = [];
    const targetRefs: ElementRef[] = [];
    for (const val of selectedValues) {
      const choice = choicesForBoard.value.find(c => c.value === val);
      if (!choice) continue;
      for (const r of choice.refs ?? []) {
        if (r.role === 'source') sourceRefs.push(r.ref);
        else targetRefs.push(r.ref);
      }
    }
    if (sourceRefs.length > 0 || targetRefs.length > 0) {
      board.setHoveredChoice({ value: selectedValues, display: `${selectedValues.length} selected`, sourceRefs, targetRefs });
    }
  }

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

    if (action.selections.length > 0) {
      autoEndArmed = false; // a selection action auto-started — the auto-end intent is moot
      void startAction(action.name);
    } else if (!skipNoSelections && actionMetadata.value) {
      autoEndArmed = false; // consumed: the sole no-selection action (endTurn) is firing
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
  watch([currentPick, filteredValidElements, choicesForBoard], ([selection]) => {
    if (!selection) {
      board.setValidElements([], () => {});
      board.setDraggableSelectedElement(null);
      return;
    }

    if (currentAction.value && currentActionMeta.value) {
      const idx = currentActionMeta.value.selections.findIndex(s => s.name === selection.name);
      board.setCurrentPick(idx, selection.name);
    }

    let validElems: { id: number; ref: ElementRef; disabled?: string }[] = [];
    let onSelect: ((id: number) => void) | null = null;

    if (selection.type === 'element' || selection.type === 'elements') {
      validElems = filteredValidElements.value.map(ve => ({
        id: ve.id,
        ref: elementClickRef(ve),
        disabled: ve.disabled,
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
      // choicesForBoard.value (reactive, reads snapshotVersion) for the actual choices.
      const choices = choicesForBoard.value;
      const choicesWithRefs = choices.filter((c: ChoiceWithRefs) => (c.refs ?? []).length > 0);
      if (choicesWithRefs.length > 0) {
        const refToChoice = new Map<number, { value: unknown; ref: ElementRef; disabled?: string }>();
        // Synthetic key for notation-only (or name-only) target refs that carry no
        // element id (e.g. Checkers destination squares). The key is only a token
        // used to route the click back to its choice; matchesRef matches the clicked
        // element by notation/name, never by this id, so negatives can't collide
        // with real positive element ids.
        let syntheticKey = -1;
        for (const choice of choicesWithRefs) {
          const ref = (choice.refs ?? []).find(r => r.role === 'target')?.ref ?? (choice.refs ?? [])[0]?.ref;
          if (!ref) continue;
          const key = ref.id ?? syntheticKey--;
          refToChoice.set(key, { value: choice.value, ref, disabled: choice.disabled });
        }
        validElems = Array.from(refToChoice.entries()).map(([id, { ref, disabled }]) => ({ id, ref, disabled }));
        onSelect = (elementId: number) => {
          const entry = refToChoice.get(elementId);
          if (entry === undefined || entry.disabled) return;
          if (currentMultiSelect.value) {
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
  watch(currentAction, (action) => {
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
      const validElem = filteredValidElements.value.find(e => {
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

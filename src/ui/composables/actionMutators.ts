/**
 * The one set of action mutators: start, execute, choose a value, and the
 * multi-select and ordered-list gestures, each run against the action controller
 * and the board substrate together.
 *
 * The Action Panel and the board bridge both call these (#513). They used to hold
 * a copy each, and the copies drifted: #445's fix reached only the panel's
 * post-execute clear, the panel never marked a fetched choice on the board, only
 * the panel resumed a held follow-up, and each refused a different set of
 * actions. A caller keeps only what is its own (the panel's emits and hover
 * text); everything that changes the controller or the board is here.
 *
 * Create one per surface with {@link createActionMutators}, handing it that
 * surface's view of the guards.
 */
import type { BoardInteraction } from './useBoardInteraction.js';
import type { EnrichedActionMetadata, UseActionControllerReturn } from './useActionControllerTypes.js';
import { choiceBoardTarget } from './actionControllerHelpers.js';

/** What a surface knows about whether the seat may act. Read on every call. */
export interface ActionMutatorGuards {
  /** True while a debug view shows history: nothing may reach the live game. */
  isViewingHistory: () => boolean;
  /** True when the seat may act now. */
  isMyTurn: () => boolean;
  /** True once the seat has committed the current simultaneous step (D27). */
  isCompleted: () => boolean;
  /** Why this action is disabled for the seat, or `undefined` when it is not. */
  disabledReason: (actionName: string) => string | undefined;
  /** The metadata of an action the seat is offered, or `undefined`. */
  actionMetadata: (actionName: string) => EnrichedActionMetadata | undefined;
}

/** What `startAction` did, so a caller can follow up with its own UI. */
export type StartOutcome =
  /** A guard refused it; nothing changed. */
  | 'refused'
  /** The seat's held follow-up was this action, so it was resumed. */
  | 'resumed'
  /** The action has no picks, so it was sent to the controller's execute(). */
  | 'executed'
  /** The action is open at its first pick. */
  | 'started';

export interface ActionMutators {
  startAction(
    actionName: string,
    options?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> },
  ): Promise<StartOutcome>;
  /** Execute an action outright. Resolves `false` when a guard refused it. */
  executeAction(actionName: string, args: Record<string, unknown>): Promise<boolean>;
  /** Answer the open pick. Resolves `true` when the controller accepted the value. */
  setSelectionValue(selectionName: string, value: unknown): Promise<boolean>;
  toggleMultiSelectValue(selectionName: string, value: unknown): Promise<void>;
  appendListValue(selectionName: string, value: unknown): Promise<void>;
  /** Draw the multi-select or ordered-list draft on the board. */
  updateMultiSelectBoardHighlights(): void;
}

type MutatorController = Pick<
  UseActionControllerReturn,
  | 'start'
  | 'execute'
  | 'fill'
  | 'toggleMultiSelect'
  | 'appendListEntry'
  | 'resumeFollowUp'
  | 'heldFollowUp'
  | 'isExecuting'
  | 'actionStartTick'
  | 'currentPick'
  | 'currentChoices'
  | 'multiSelectDraft'
>;

export function createActionMutators(
  controller: MutatorController,
  board: BoardInteraction | undefined,
  guards: ActionMutatorGuards,
): ActionMutators {
  async function startAction(
    actionName: string,
    options?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> },
  ): Promise<StartOutcome> {
    if (guards.isViewingHistory()) return 'refused';
    // A disabled action is offered so the panel can explain it, and is never started.
    if (guards.disabledReason(actionName)) return 'refused';
    // The seat's held follow-up names this action: the server takes it as the
    // follow-up, with its pre-filled args, so start it as one.
    if (controller.heldFollowUp.value?.action === actionName) {
      await controller.resumeFollowUp();
      return 'resumed';
    }
    const meta = guards.actionMetadata(actionName);
    if (!meta || meta.selections.length === 0) {
      return (await executeAction(actionName, {})) ? 'executed' : 'refused';
    }
    // Clear stale board state BEFORE starting, never after (#185).
    // `controller.start()` awaits a choice or element fetch, and that fetch bumps
    // `snapshotVersion` from inside the await, which is what makes the bridge's
    // watchers fill `validElements` and install the selection callbacks. A clear
    // after the await wipes all of that and no watcher re-runs, so the board goes
    // dead for the whole action while `currentAction` still names it.
    board?.clear();
    await controller.start(actionName, options);
    return 'started';
  }

  async function executeAction(actionName: string, args: Record<string, unknown>): Promise<boolean> {
    if (guards.isViewingHistory()) return false;
    if (controller.isExecuting.value) return false;
    if (!guards.isMyTurn()) return false;
    if (guards.isCompleted()) return false;
    if (guards.disabledReason(actionName)) return false;
    // An explicitly skipped optional pick is null here; the server expects it absent.
    const filteredArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) if (value !== null) filteredArgs[key] = value;
    // The board belongs to this execution only until another action starts. The
    // controller drops `isExecuting` before the clear below runs, and a custom
    // board may start its next pick at exactly that moment (#445); clearing then
    // would wipe that pick and the bridge would cancel it. Same guard as the
    // controller's own post-send clear in `sendAndResolve`.
    const startTick = controller.actionStartTick.value;
    // execute() never throws: a failure lands in the controller's `lastError`,
    // which the shell reports once.
    await controller.execute(actionName, filteredArgs);
    if (controller.actionStartTick.value === startTick) board?.clear();
    return true;
  }

  async function setSelectionValue(selectionName: string, value: unknown): Promise<boolean> {
    if (guards.isViewingHistory()) return false;
    const selection = controller.currentPick.value;
    // Snapshot the offered choices BEFORE fill(): fill() moves the pick on, after
    // which `currentChoices` lists the NEXT pick's. `selection.choices` holds only
    // the static metadata choices, so a fetched choice is found only here.
    const offered = selection?.type === 'choice' ? controller.currentChoices.value.slice() : [];
    const result = await controller.fill(selectionName, value);
    // A refusal is already in the controller's `lastError`.
    if (!result.valid) return false;
    // Keep the chosen board element marked.
    const chosen = offered.find(c => c.value === value);
    const ref = chosen && choiceBoardTarget(chosen);
    if (ref) board?.selectElement(ref);
    return true;
  }

  async function toggleMultiSelectValue(selectionName: string, value: unknown): Promise<void> {
    if (guards.isViewingHistory()) return;
    await controller.toggleMultiSelect(selectionName, value);
    updateMultiSelectBoardHighlights();
  }

  /**
   * Add one entry to an ordered-list pick (#249). Not the toggle: choosing the
   * same option twice means "add it twice" here, never "never mind".
   */
  async function appendListValue(selectionName: string, value: unknown): Promise<void> {
    if (guards.isViewingHistory()) return;
    await controller.appendListEntry(selectionName, value);
    updateMultiSelectBoardHighlights();
  }

  function updateMultiSelectBoardHighlights(): void {
    if (!board) return;
    const selectedValues = controller.multiSelectDraft.value?.values ?? [];
    if (selectedValues.length === 0) {
      board.setHoveredChoice(null);
      return;
    }
    const choices = controller.currentChoices.value;
    const refs = selectedValues.flatMap(val => choices.find(c => c.value === val)?.refs ?? []);
    if (refs.length === 0) return;
    board.setHoveredChoice({
      value: selectedValues,
      display: `${selectedValues.length} selected`,
      sourceRefs: refs.filter(r => r.role === 'source').map(r => r.ref),
      // 'target' and 'highlight' both draw on the target side.
      targetRefs: refs.filter(r => r.role !== 'source').map(r => r.ref),
    });
  }

  return { startAction, executeAction, setSelectionValue, toggleMultiSelectValue, appendListValue, updateMultiSelectBoardHighlights };
}

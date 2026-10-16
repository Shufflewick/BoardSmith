/**
 * useDragDropTargets - Shared drag-and-drop target derivation
 *
 * This is the single, generic source of truth for "which board elements can the
 * currently-dragged element be dropped onto?". It derives drop targets from the
 * action controller's CURRENT pick, regardless of action shape or selection
 * ordering, and wires them into the shared board-interaction state.
 *
 * ## Why this exists (audit F36)
 *
 * Drop-target wiring used to live exclusively inside ActionPanel's
 * `watch(isDragging)` and only recognised two hard-coded action shapes
 * (element -> choice WITH filterBy, and element -> element). Every other valid
 * shape (element -> choice WITHOUT filterBy, `elements` multi-picks,
 * choice -> element, dragging onto the current pick of an in-progress action)
 * silently produced no drop targets — and never worked at all in a custom UI,
 * breaking the custom-UI ↔ action-panel parity rule.
 *
 * By deriving targets here, in the board-interaction layer, and wiring this once
 * in GameShell, BOTH the Action Panel and any custom UI consume the exact same
 * drop targets through `useBoardInteraction()` / `useDragDrop()`.
 *
 * ## Where the targets come from (#724)
 *
 * The drop targets of an open pick are the board's own candidates for it
 * (`validElements`, minus disabled ones), and a drop runs the board's own click
 * callback (`onElementSelect`). useBoardActionBridge builds both from the
 * controller's current pick, so a drop does exactly what a click on the same
 * element does: notation-only targets (Checkers squares) match, a multi-select
 * toggles, an ordered list appends, and a number/text pick has no targets.
 */
import { nextTick, watch, type Ref, type WatchStopHandle } from 'vue';
import type { BoardInteraction, ElementRef } from './useBoardInteraction.js';
import type {
  UseActionControllerReturn,
  EnrichedPickMetadata,
  EnrichedActionMetadata,
} from './useActionControllerTypes.js';
import { isChoosableElement } from './useBoardActionBridge.js';
import { devWarn } from '../../utils/dev.js';

export interface DragDropOrchestrationOptions {
  boardInteraction: BoardInteraction;
  actionController: UseActionControllerReturn;
  availableActions: Ref<string[] | undefined>;
  actionMetadata: Ref<Record<string, EnrichedActionMetadata> | undefined>;
  isMyTurn: Ref<boolean | undefined> | Ref<boolean>;
}

/**
 * Find an available action whose FIRST selection is a single element that
 * accepts the dragged element, so a drag can START that action.
 *
 * Priority:
 *  1. Actions whose first selection explicitly lists the dragged element in its
 *     static `validElements` (strong signal this action is for this piece).
 *  2. Actions with an element first selection but no static `validElements`
 *     (validElements are only known after the action starts — let the controller
 *     validate on start; an invalid start simply yields no drop targets).
 */
function findDragStartAction(
  dragged: ElementRef,
  availableActions: Ref<string[] | undefined>,
  actionMetadata: Ref<Record<string, EnrichedActionMetadata> | undefined>,
): { action: EnrichedActionMetadata; firstSel: EnrichedPickMetadata; elementId: number | undefined } | null {
  const metas = (availableActions.value ?? [])
    .map(name => actionMetadata.value?.[name])
    .filter((m): m is EnrichedActionMetadata => !!m);

  // Pass 1: explicit validElements match.
  for (const action of metas) {
    const firstSel = action.selections[0];
    if (firstSel?.type !== 'element') continue;
    const matched = firstSel.validElements?.find(e => isChoosableElement(e, dragged));
    if (matched) return { action, firstSel, elementId: matched.id };
  }

  // Pass 2: element first selection with no static validElements to check against.
  for (const action of metas) {
    const firstSel = action.selections[0];
    if (firstSel?.type !== 'element') continue;
    if (!firstSel.validElements || firstSel.validElements.length === 0) {
      return { action, firstSel, elementId: dragged.id };
    }
  }

  return null;
}

/**
 * Wire generic drag-and-drop target derivation into the shared board-interaction
 * state. Call once in GameShell (where both the controller and board interaction
 * exist). Returns a stop handle for teardown.
 *
 * When a drag starts (via the board's auto-UI element renderers or a custom UI's
 * `useDragDrop`), this:
 *  - if an action is already in progress, derives drop targets for its current
 *    pick; otherwise
 *  - finds an action the dragged element can start, starts it pre-filled with the
 *    dragged element, then derives drop targets for the resulting current pick.
 *
 * The derived targets flow into `boardInteraction.setDropTargets`, which both the
 * Action Panel and custom UIs read through `useBoardInteraction` / `useDragDrop`.
 */
export function setupDragDropOrchestration(options: DragDropOrchestrationOptions): WatchStopHandle {
  const { boardInteraction, actionController, availableActions, actionMetadata, isMyTurn } = options;

  /** Wire the board's candidates for the current pick as drop targets. Returns true if any were wired. */
  async function wireCurrentPick(): Promise<boolean> {
    // The bridge feeds the board from the controller in a watcher; let it run first.
    await nextTick();
    const targets = boardInteraction.validElements.filter(t => !t.disabled);
    const onDrop = boardInteraction.onElementSelect;
    if (targets.length === 0 || !onDrop) return false;
    boardInteraction.setDropTargets(targets, onDrop);
    return true;
  }

  /** Is the dragged element one of the (enabled) valid elements for this pick? */
  function pickAcceptsDragged(pick: EnrichedPickMetadata, dragged: ElementRef): boolean {
    return actionController.getValidElements(pick).some(el => isChoosableElement(el, dragged));
  }

  /** Mirror the controller's current pick into board-interaction state so AutoUI boards react. */
  function syncCurrentActionPick(actionName: string): void {
    const nextPick = actionController.currentPick.value;
    const selections = actionMetadata.value?.[actionName]?.selections ?? [];
    const pickIndex = nextPick ? selections.findIndex(s => s.name === nextPick.name) : 0;
    boardInteraction.setCurrentAction(actionName, pickIndex >= 0 ? pickIndex : 0, nextPick?.name ?? null);
  }

  /** Loud, shape-specific dev warning when a drag can't be wired to any drop target. */
  function warnNoTargets(dragged: ElementRef, matchedAction: string | null): void {
    const pick = actionController.currentPick.value;
    devWarn(
      `drag-no-targets-${JSON.stringify(dragged)}`,
      `Drag started for element ${JSON.stringify(dragged)} but no drop targets could be derived.\n\n` +
        `Dragging completes an action by dropping onto a board target. For drag-drop to wire up automatically:\n` +
        `  1. An available action's FIRST selection must be an 'element' that accepts the dragged element, AND\n` +
        `  2. the NEXT selection must expose board targets, i.e. one of:\n` +
        `       • an 'element' / 'elements' pick  → drop onto any valid element, or\n` +
        `       • a 'choice' pick whose choices carry refs with role 'target'  → drop onto that destination.\n\n` +
        `Observed:\n` +
        `  Dragged element: ${JSON.stringify(dragged)}\n` +
        `  Matched action: ${matchedAction ?? 'none (no action has a first element selection accepting this element)'}\n` +
        `  Current pick: ${pick ? `'${pick.name}' (type '${pick.type}')` : 'none'}\n\n` +
        (pick?.type === 'choice'
          ? `This choice pick exposed no refs with role 'target' on its choices, so the board has nowhere to drop onto. ` +
            `Provide boardRefs() returning refs: [{ ref, role: 'target' }] per choice.`
          : `If your action uses a choice destination, ensure each choice's boardRefs() returns refs with role 'target'.`),
    );
  }

  const stop = watch(
    () => boardInteraction.isDragging,
    async (isDragging) => {
      if (!isDragging) return;
      const dragged = boardInteraction.draggedElement;
      if (!dragged) return;
      // A drag can only complete an action on the player's own turn.
      if (isMyTurn.value === false) return;

      // Case A: an action is already in progress — derive drop targets for its
      // current pick generically (handles element, elements and choice picks,
      // with filterBy already applied by the controller).
      if (actionController.currentAction.value) {
        const actionName = actionController.currentAction.value;
        const pick = actionController.currentPick.value;

        // DRAG-TO-SELECT: if the current pick is a single element pick and the
        // dragged element is one of its valid choices, the drag is SELECTING that
        // element — not dropping onto it. Fill the pick (advancing the action) and
        // derive drop targets from the resulting NEXT pick, mirroring the
        // drag-to-start path below. This is what makes "drag the source card, drop
        // it on the destination zone" work when a custom UI arms the action first
        // (e.g. via an action button) before the drag begins.
        if (pick?.type === 'element' && dragged.id !== undefined && pickAcceptsDragged(pick, dragged)) {
          await actionController.fill(pick.name, dragged.id);
          // Filling may have been the action's final input (auto-executed) — done.
          if (!actionController.currentAction.value) return;
          syncCurrentActionPick(actionName);
          if (!(await wireCurrentPick())) warnNoTargets(dragged, actionName);
          return;
        }

        const wired = await wireCurrentPick();
        // Only warn for pick types that CAN be drop targets but produced none —
        // dragging during a number/text pick is legitimately a no-op.
        if (!wired && (pick?.type === 'element' || pick?.type === 'elements' || pick?.type === 'choice')) {
          warnNoTargets(dragged, actionName);
        }
        return;
      }

      // Case B: no action in progress — find one the dragged element can start.
      const match = findDragStartAction(dragged, availableActions, actionMetadata);
      if (!match) {
        warnNoTargets(dragged, null);
        return;
      }

      try {
        if (match.elementId !== undefined) {
          await actionController.start(match.action.name, { args: { [match.firstSel.name]: match.elementId } });
        } else {
          await actionController.start(match.action.name);
        }
      } catch {
        // Element wasn't valid for this action after server validation — leave no
        // drop targets. (start() resolves; a throw here is defensive.)
        return;
      }

      // Sync the current-action signal so custom boards can react.
      syncCurrentActionPick(match.action.name);

      // The action may have auto-completed (single-option pick auto-filled then
      // auto-executed). If so there is nothing to drop onto — done.
      if (!actionController.currentAction.value) return;

      if (!(await wireCurrentPick())) {
        warnNoTargets(dragged, match.action.name);
      }
    },
  );

  return stop;
}

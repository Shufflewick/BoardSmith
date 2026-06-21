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
 * ## How targets are derived (generic, shape-agnostic)
 *
 * Given the controller's current pick (the selection the player must still
 * fill), the drop targets are:
 *
 * - **element / elements pick** → every valid element for that pick. Dropping
 *   onto one fills the pick with that element id.
 * - **choice pick** → every choice that carries a `targetRef` (a board element
 *   the choice maps to, e.g. a destination square). Dropping onto it fills the
 *   pick with that choice's value. `filterBy` is already applied by the
 *   controller's `getChoices`, so destinations are correctly narrowed by the
 *   previously-selected element with no special-casing here.
 * - **number / text pick** → not a drop target (no board mapping).
 *
 * The two previously-hard-coded cases are exactly the element-pick and
 * choice-with-targetRef branches above, so they keep working identically; this
 * module only ADDS the other shapes.
 */
import { watch, type Ref, type WatchStopHandle } from 'vue';
import type { BoardInteraction, ValidElement, ElementRef } from './useBoardInteraction.js';
import type {
  UseActionControllerReturn,
  PickMetadata,
  ChoiceWithRefs,
  ActionMetadata,
} from './useActionControllerTypes.js';
import { devWarn } from '../../utils/dev.js';

/** Drop targets plus the callback to run when one is dropped onto. */
export interface DerivedDropTargets {
  targets: ValidElement[];
  onDrop: (targetId: number) => void;
}

/** Does a controller valid-element / dragged-element pair refer to the same element? */
function matchesDragged(
  candidate: { id?: number; ref?: ElementRef },
  dragged: ElementRef,
): boolean {
  if (dragged.id !== undefined && candidate.id === dragged.id) return true;
  if (dragged.notation && candidate.ref?.notation === dragged.notation) return true;
  return false;
}

/**
 * Derive drop targets for an arbitrary pick from the action controller.
 *
 * Returns `null` when the pick cannot be a drop target (no pick, or a
 * number/text pick). Returns `{ targets: [], onDrop }` when the pick type CAN
 * carry targets but none are currently available (so callers can distinguish
 * "wrong shape" from "right shape, nothing to drop on").
 */
export function deriveDropTargetsForPick(
  controller: UseActionControllerReturn,
  pick: PickMetadata | null,
): DerivedDropTargets | null {
  if (!pick) return null;

  // Element / elements pick: the valid elements ARE the drop targets.
  if (pick.type === 'element' || pick.type === 'elements') {
    const targets: ValidElement[] = [];
    for (const el of controller.getValidElements(pick)) {
      if (el.disabled) continue;
      if (el.id === undefined || !el.ref) continue;
      targets.push({ id: el.id, ref: el.ref });
    }
    return {
      targets,
      onDrop: (targetId: number) => {
        void controller.fill(pick.name, targetId);
      },
    };
  }

  // Choice pick: choices that map to a board element (targetRef) are drop targets.
  // `getChoices` applies filterBy/dependsOn, so destinations are already narrowed
  // by any previously-selected element.
  if (pick.type === 'choice') {
    const targets: ValidElement[] = [];
    const valueByTargetId = new Map<number, unknown>();
    for (const choice of controller.getChoices(pick) as ChoiceWithRefs[]) {
      if (choice.disabled) continue;
      const ref = choice.targetRef;
      if (!ref || ref.id === undefined) continue;
      targets.push({ id: ref.id, ref });
      valueByTargetId.set(ref.id, choice.value);
    }
    return {
      targets,
      onDrop: (targetId: number) => {
        const value = valueByTargetId.get(targetId);
        if (value !== undefined) void controller.fill(pick.name, value);
      },
    };
  }

  // number / text picks have no board mapping — not droppable.
  return null;
}

export interface DragDropOrchestrationOptions {
  boardInteraction: BoardInteraction;
  actionController: UseActionControllerReturn;
  availableActions: Ref<string[] | undefined>;
  actionMetadata: Ref<Record<string, ActionMetadata> | undefined>;
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
  actionMetadata: Ref<Record<string, ActionMetadata> | undefined>,
): { action: ActionMetadata; firstSel: PickMetadata } | null {
  const metas = (availableActions.value ?? [])
    .map(name => actionMetadata.value?.[name])
    .filter((m): m is ActionMetadata => !!m);

  // Pass 1: explicit validElements match.
  for (const action of metas) {
    const firstSel = action.selections[0];
    if (firstSel?.type !== 'element') continue;
    if (firstSel.validElements?.some(e => matchesDragged(e, dragged))) {
      return { action, firstSel };
    }
  }

  // Pass 2: element first selection with no static validElements to check against.
  for (const action of metas) {
    const firstSel = action.selections[0];
    if (firstSel?.type !== 'element') continue;
    if (!firstSel.validElements || firstSel.validElements.length === 0) {
      return { action, firstSel };
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

  /** Derive + wire drop targets for the controller's current pick. Returns true if any were wired. */
  function wireCurrentPick(): boolean {
    const pick = actionController.currentPick.value;
    const derived = deriveDropTargetsForPick(actionController, pick);
    if (!derived || derived.targets.length === 0) return false;
    boardInteraction.setDropTargets(derived.targets, derived.onDrop);
    return true;
  }

  /** Is the dragged element one of the (enabled) valid elements for this pick? */
  function pickAcceptsDragged(pick: PickMetadata, dragged: ElementRef): boolean {
    return actionController
      .getValidElements(pick)
      .some(el => !el.disabled && matchesDragged({ id: el.id, ref: el.ref }, dragged));
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
        `       • a 'choice' pick whose choices carry a 'targetRef'  → drop onto that destination.\n\n` +
        `Observed:\n` +
        `  Dragged element: ${JSON.stringify(dragged)}\n` +
        `  Matched action: ${matchedAction ?? 'none (no action has a first element selection accepting this element)'}\n` +
        `  Current pick: ${pick ? `'${pick.name}' (type '${pick.type}')` : 'none'}\n\n` +
        (pick?.type === 'choice'
          ? `This choice pick exposed no 'targetRef' on its choices, so the board has nowhere to drop onto. ` +
            `Provide a targetRef per choice (the board element the choice maps to).`
          : `If your action uses a choice destination, ensure each choice provides a 'targetRef'.`),
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
          if (!wireCurrentPick()) warnNoTargets(dragged, actionName);
          return;
        }

        const wired = wireCurrentPick();
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

      const draggedId = dragged.id;
      try {
        if (draggedId !== undefined) {
          await actionController.start(match.action.name, { args: { [match.firstSel.name]: draggedId } });
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

      if (!wireCurrentPick()) {
        warnNoTargets(dragged, match.action.name);
      }
    },
  );

  return stop;
}

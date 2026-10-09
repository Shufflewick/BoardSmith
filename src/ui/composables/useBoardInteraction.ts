/**
 * Board Interaction State
 *
 * Shared state between ActionPanel and game boards for bidirectional
 * interaction. When you hover a choice in ActionPanel, the board highlights.
 * When you click an element on the board, ActionPanel filters choices.
 *
 * Note: Board refs (sourceRefs, targetRefs) are now provided explicitly by
 * the ActionPanel from the action metadata, rather than being parsed from
 * choice values using regex. This makes the system work with any notation
 * format, not just chess-style notation.
 */
import { computed, reactive, provide, inject, type InjectionKey } from 'vue';
import { devWarn } from '../../utils/dev.js';

// THE ELEMENT REFERENCE SHAPE IS OWNED BY ../../types/protocol.js (#263).
//
// This module used to declare its own, and `boardsmith/ui` exported that one
// while `boardsmith/types` exported the protocol's — two different types under
// one name, differing by a `className` field, with nothing telling a game which
// of them it had imported. Imported locally (so it is usable as a type here)
// AND re-exported, keeping the protocol layer the single source of truth.
import type { ElementRef } from '../../types/protocol.js';
export type { ElementRef };

/** Which of its identities the board matches a ref by. */
type BoardRefKind = 'id' | 'notation' | 'name';

/** The identity the board matches a ref by: its kind, and a key unique across kinds. */
interface BoardRefKey {
  kind: BoardRefKind;
  key: string;
}

/**
 * How the board matches a ref, in the one place that says it: by its id if it
 * carries one, else its notation, else its name. A precise id wins outright, so a
 * ref carrying both an id and a name ({ id: 5, name: 'Militia' }) never matches a
 * different element that happens to share the name.
 *
 * Every question the board answers about a ref goes through this: whether an
 * element matches one, the candidate index a board's lookups read (#313), and
 * the Action Panel's rule for handing a large choice to the board (#341), which
 * must count a candidate as on the board exactly when the board can find it.
 */
export function boardRefKey(ref: ElementRef): BoardRefKey | undefined {
  if (ref.id !== undefined) return { kind: 'id', key: `id:${ref.id}` };
  if (ref.notation !== undefined) return { kind: 'notation', key: `notation:${ref.notation}` };
  if (ref.name !== undefined) return { kind: 'name', key: `name:${ref.name}` };
  return undefined;
}

/** Every key a ref could match `element` by: one for each identity it has. */
function elementKeys(element: { id?: number; name?: string; notation?: string }): string[] {
  return [{ id: element.id }, { notation: element.notation }, { name: element.name }]
    .map(boardRefKey)
    .filter((k): k is BoardRefKey => k !== undefined)
    .map(k => k.key);
}

/**
 * A choice that can be highlighted on the board
 */
export interface HighlightableChoice {
  value: unknown;
  display: string;
  /** Elements to highlight as source when this choice is hovered */
  sourceRefs?: ElementRef[];
  /** Elements to highlight as target when this choice is hovered */
  targetRefs?: ElementRef[];
}

/**
 * A board element the player can click right now — a highlight target or a drop
 * target.
 *
 * NOT the same thing as `BoardTarget` in useActionControllerTypes.ts, which is
 * a choice the action controller is offering (`{ id, refs: RefWithRole[], element }`).
 * Both used to be called `BoardTarget`, which meant `boardsmith/ui` exported one
 * of them while board code meant the other — a game reading `element.ref` got
 * "Property 'ref' does not exist… Did you mean 'refs'?" and no way to tell the two
 * apart by name. They are genuinely different: useBoardActionBridge converts a
 * controller choice into one of these (see `elementClickRef`), collapsing the
 * role-tagged refs down to the single ref the board clicks.
 */
export interface BoardTarget {
  id: number;
  ref: ElementRef;
  /** Disabled reason string, present only when element is disabled */
  disabled?: string;
  /**
   * The text the action panel would have shown for this candidate ("Holding 1"),
   * as opposed to the element's internal name the board writes ("holding-1").
   *
   * #189: when the panel yields an element pick to the board, the board is the
   * only surface the candidate appears on, so the player-facing wording has to
   * travel with it or nothing outside the app can name what it is looking at.
   */
  display?: string;
}

/**
 * Board interaction state
 */
export interface BoardInteractionState {
  /** Currently hovered choice in ActionPanel */
  hoveredChoice: HighlightableChoice | null;

  /** Currently selected element on the board */
  selectedElement: ElementRef | null;

  /** Valid elements that can be clicked to complete the current selection */
  validElements: BoardTarget[];

  /** Callback to invoke when a valid element is clicked */
  onElementSelect: ((elementId: number) => void) | null;

  /** Callback to invoke when a choice value is selected (for non-element choices like suit selection) */
  onChoiceSelect: ((selectionName: string, value: unknown) => void) | null;

  /** Currently dragged element (for drag-and-drop actions) */
  draggedElement: ElementRef | null;

  /** Valid drop targets for the dragged element */
  dropTargets: BoardTarget[];

  /** Whether drag mode is active */
  isDragging: boolean;

  /** Element that is selected and can be dragged (for auto-select scenarios) */
  draggableSelectedElement: ElementRef | null;

  /** Last dropped element ID (persists briefly after drop for animation skipping) */
  lastDroppedElementId: number | null;

  /** Currently hovered drop target (for per-zone hover effects) */
  hoveredDropTarget: ElementRef | null;

  // ---- Action State ----

  /** Currently active action name (null if no action is in progress) */
  currentAction: string | null;

  /** Index of the current pick step (0-based) */
  currentPickIndex: number;

  /** Name of the current pick being filled */
  currentPickName: string | null;

  /**
   * Monotonic counter, bumped by {@link BoardInteractionActions.requestBoardFocus}.
   *
   * #172: a large choice that the panel hands to the board needs FOCUS to make
   * the same journey, or the keyboard player who pressed "choose on the board"
   * is left standing on a control that has just unmounted. A board watches this
   * and puts focus on its first candidate. It is a counter and not a boolean so
   * a second handoff for the same pick still fires, and it never rewinds.
   */
  boardFocusRequest: number;
}

/**
 * Board interaction actions
 */
export interface BoardInteractionActions {
  /** Set the hovered choice (called by ActionPanel) */
  setHoveredChoice: (choice: HighlightableChoice | null) => void;

  /** Set the selected element (called by board) */
  selectElement: (ref: ElementRef | null) => void;

  /** Set valid elements for current selection (called by ActionPanel) */
  setValidElements: (elements: BoardTarget[], onSelect: (elementId: number) => void) => void;

  /** Clear all interaction state */
  clear: () => void;

  /** Check if an element should be highlighted (source or target) */
  isHighlighted: (element: { id?: number; name?: string; notation?: string }) => boolean;

  /** Check if an element is the selected source */
  isSelected: (element: { id?: number; name?: string; notation?: string }) => boolean;

  /** Check if an element is a valid target */
  isValidTarget: (element: { id?: number; name?: string; notation?: string }) => boolean;

  /** Check if an element is selectable for the current action */
  isSelectableElement: (element: { id?: number; name?: string; notation?: string }) => boolean;

  /** Check if a board element is disabled for the current action selection. Returns reason string or false. */
  isDisabledElement: (element: { id?: number; name?: string; notation?: string }) => string | false;

  /**
   * The player-facing text for this element as a candidate of the pick in
   * progress, or null when it is not one (#189).
   *
   * Feeds {@link candidateAttrs}, so every board renderer stamps the same hook
   * from one place rather than each deciding for itself what a candidate is.
   */
  candidateLabel: (element: { id?: number; name?: string; notation?: string }) => string | null;

  /** Trigger element selection (called by board when clicking a valid element) */
  triggerElementSelect: (element: { id?: number; name?: string; notation?: string }) => void;

  /** Start dragging an element (called by board when drag starts) */
  startDrag: (element: ElementRef) => void;

  /** End drag operation (called when drag ends or is cancelled) */
  endDrag: () => void;

  /** Set valid drop targets for current drag operation */
  setDropTargets: (targets: BoardTarget[], onDrop: (elementId: number) => void) => void;

  /** Check if an element is a valid drop target */
  isDropTarget: (element: { id?: number; name?: string; notation?: string }) => boolean;

  /** Check if an element is the currently dragged element */
  isDraggedElement: (element: { id?: number; name?: string; notation?: string }) => boolean;

  /** Trigger drop on target (called by board when element is dropped) */
  triggerDrop: (target: { id?: number; name?: string; notation?: string }) => void;

  /** Set the element that is selected and can be dragged (for auto-select) */
  setDraggableSelectedElement: (element: ElementRef | null) => void;

  /** Check if an element is the draggable selected element */
  isDraggableSelectedElement: (element: { id?: number; name?: string; notation?: string }) => boolean;

  /** Set the hovered drop target (called by board during dragover) */
  setHoveredDropTarget: (element: ElementRef | null) => void;

  /** Check if an element is the currently hovered drop target */
  isHoveredDropTarget: (element: { id?: number; name?: string; notation?: string }) => boolean;

  // ---- Action State Methods ----

  /** Set the current action (called by ActionPanel when action starts) */
  setCurrentAction: (actionName: string | null, pickIndex?: number, pickName?: string | null) => void;

  /** Update the current pick step */
  setCurrentPick: (pickIndex: number, pickName: string | null) => void;

  /** Set the callback for choice selection (called by ActionPanel) */
  setChoiceSelectCallback: (callback: ((selectionName: string, value: unknown) => void) | null) => void;

  /** Trigger choice selection (called by custom UI for non-element choices like suit selection) */
  triggerChoiceSelect: (selectionName: string, value: unknown) => void;

  /** Read and clear the most recent dropped element ID (for animation suppression) */
  consumeLastDroppedElementId: () => number | null;

  /**
   * Ask the board to take keyboard focus, on its first valid target for the
   * current pick. Called when the panel hands a choice to the board (#172).
   */
  requestBoardFocus: () => void;
}

export type BoardInteraction = BoardInteractionState & BoardInteractionActions;

/**
 * The injection key `<GameShell>` provides board interaction under.
 *
 * Exported so a test harness can stand in for the shell and provide a real
 * interaction of its own — `renderAsSeat`/`assertNoHiddenInfoLeak` mount a
 * board outside any shell, and a board that calls {@link useBoardInteraction}
 * would otherwise throw in `setup()` before a node rendered (#260). A
 * component in the app never needs this: it calls `useBoardInteraction()`.
 */
export const BOARD_INTERACTION_KEY: InjectionKey<BoardInteraction> = Symbol('boardInteraction');

/**
 * Create board interaction state (call in GameShell)
 */
export function createBoardInteraction(): BoardInteraction {
  const state = reactive<BoardInteractionState>({
    hoveredChoice: null,
    selectedElement: null,
    validElements: [],
    onElementSelect: null,
    onChoiceSelect: null,
    draggedElement: null,
    dropTargets: [],
    isDragging: false,
    draggableSelectedElement: null,
    lastDroppedElementId: null,
    hoveredDropTarget: null,
    // Action state
    currentAction: null,
    currentPickIndex: 0,
    currentPickName: null,
    boardFocusRequest: 0,
  });

  // Callback for when element is dropped on valid target
  let onDropCallback: ((elementId: number) => void) | null = null;

  function matchesRef(element: { id?: number; name?: string; notation?: string }, ref: ElementRef): boolean {
    const key = boardRefKey(ref);
    return key !== undefined && elementKeys(element).includes(key.key);
  }

  function matchesAnyRef(element: { id?: number; name?: string; notation?: string }, refs: ElementRef[]): boolean {
    return refs.some(ref => matchesRef(element, ref));
  }

  // #313: a board asks about every element it draws -- is it a candidate, is it
  // disabled, what is it called. Scanning validElements for each question is
  // quadratic in the size of the pick: a 3,720-space pick took tens of seconds
  // per render of the board. So the list is indexed once each time it changes,
  // by boardRefKey -- the same key matchesRef matches by -- and each lookup is a
  // few map reads.
  const candidateIndex = computed(() => {
    const byKey = new Map<string, number>();
    const list = state.validElements;
    list.forEach((ve, position) => {
      const key = boardRefKey(ve.ref);
      // The first candidate that matches an element is THE candidate, as it was
      // when every lookup was a scan, so a later duplicate never replaces it.
      if (key !== undefined && !byKey.has(key.key)) byKey.set(key.key, position);
    });
    return { list, byKey };
  });

  /** The candidate of the current pick that `element` is, or undefined. */
  function findCandidate(element: { id?: number; name?: string; notation?: string }): BoardTarget | undefined {
    const { list, byKey } = candidateIndex.value;
    const positions = elementKeys(element)
      .map(key => byKey.get(key))
      .filter((p): p is number => p !== undefined);
    return positions.length === 0 ? undefined : list[Math.min(...positions)];
  }

  const actions: BoardInteractionActions = {
    setHoveredChoice(choice) {
      state.hoveredChoice = choice;
    },

    selectElement(ref) {
      // Clear any previous hover state when selecting
      state.hoveredChoice = null;
      state.selectedElement = ref;
    },

    setValidElements(elements, onSelect) {
      state.validElements = elements;
      state.onElementSelect = onSelect;
    },

    clear() {
      state.hoveredChoice = null;
      state.selectedElement = null;
      state.validElements = [];
      state.onElementSelect = null;
      state.onChoiceSelect = null;
      state.draggedElement = null;
      state.dropTargets = [];
      state.isDragging = false;
      state.draggableSelectedElement = null;
      state.lastDroppedElementId = null;
      state.hoveredDropTarget = null;
      state.currentAction = null;
      state.currentPickIndex = 0;
      state.currentPickName = null;
      onDropCallback = null;
    },

    isHighlighted(element) {
      if (!state.hoveredChoice) return false;
      const { sourceRefs = [], targetRefs = [] } = state.hoveredChoice;
      return matchesAnyRef(element, [...sourceRefs, ...targetRefs]);
    },

    isSelected(element) {
      if (!state.selectedElement) return false;
      return matchesRef(element, state.selectedElement);
    },

    isValidTarget(element) {
      // Check if this element is a target in the hovered choice
      if (!state.hoveredChoice?.targetRefs) return false;
      return matchesAnyRef(element, state.hoveredChoice.targetRefs);
    },

    isSelectableElement(element) {
      return findCandidate(element) !== undefined;
    },

    isDisabledElement(element) {
      const validElem = findCandidate(element);
      if (!validElem) return false;
      return validElem.disabled || false;
    },

    candidateLabel(element) {
      const validElem = findCandidate(element);
      if (!validElem) return null;
      return validElem.display ?? String(validElem.id);
    },

    triggerElementSelect(element) {
      // Find the matching valid element and trigger the callback (skip disabled elements)
      const validElem = findCandidate(element);
      if (validElem && !validElem.disabled && state.onElementSelect) {
        state.onElementSelect(validElem.id);
      }
    },

    startDrag(element) {
      state.draggedElement = element;
      state.isDragging = true;
      // Clear hover state when starting drag
      state.hoveredChoice = null;
    },

    endDrag() {
      state.draggedElement = null;
      state.isDragging = false;
      state.dropTargets = [];
      state.hoveredDropTarget = null;
      onDropCallback = null;
    },

    setDropTargets(targets, onDrop) {
      state.dropTargets = targets;
      onDropCallback = onDrop;
    },

    isDropTarget(element) {
      if (!state.isDragging) return false;
      return state.dropTargets.some(dt => matchesRef(element, dt.ref));
    },

    isDraggedElement(element) {
      if (!state.draggedElement) return false;
      return matchesRef(element, state.draggedElement);
    },

    triggerDrop(target) {
      // Find the matching drop target and trigger the callback
      const dropTarget = state.dropTargets.find(dt => matchesRef(target, dt.ref));
      if (dropTarget && onDropCallback) {
        // Store the dragged element's ID before ending drag (for animation skipping)
        const draggedId = state.draggedElement?.id;
        if (draggedId !== undefined) {
          state.lastDroppedElementId = draggedId;
        }
        onDropCallback(dropTarget.id);
        // End drag after successful drop
        this.endDrag();
      }
    },

    setDraggableSelectedElement(element) {
      state.draggableSelectedElement = element;
    },

    isDraggableSelectedElement(element) {
      if (!state.draggableSelectedElement) return false;
      return matchesRef(element, state.draggableSelectedElement);
    },

    setHoveredDropTarget(element) {
      state.hoveredDropTarget = element;
    },

    isHoveredDropTarget(element) {
      if (!state.hoveredDropTarget) return false;
      return matchesRef(element, state.hoveredDropTarget);
    },

    setCurrentAction(actionName, pickIndex = 0, pickName = null) {
      state.currentAction = actionName;
      state.currentPickIndex = pickIndex;
      state.currentPickName = pickName;
    },

    setCurrentPick(pickIndex, pickName) {
      state.currentPickIndex = pickIndex;
      state.currentPickName = pickName;
    },

    setChoiceSelectCallback(callback) {
      state.onChoiceSelect = callback;
    },

    triggerChoiceSelect(selectionName, value) {
      if (!state.onChoiceSelect) {
        devWarn(
          'board-interaction-no-choice-callback',
          `triggerChoiceSelect('${selectionName}', ...) was ignored because no action is active to receive it. ` +
            `Choice selection only works while an action exposing a '${selectionName}' selection is in progress. ` +
            `Start the action first (via the ActionPanel or by selecting the relevant board element) before triggering a choice.`,
        );
        return;
      }
      state.onChoiceSelect(selectionName, value);
    },

    requestBoardFocus() {
      state.boardFocusRequest++;
    },

    consumeLastDroppedElementId() {
      const id = state.lastDroppedElementId;
      state.lastDroppedElementId = null;
      return id;
    },
  };

  // Merge actions into the state object to maintain reactivity
  // (spreading would copy values, breaking reactive updates)
  return Object.assign(state, actions) as unknown as BoardInteraction;
}

/**
 * Map an ElementRef to its stable `data-bs-el-*` anchor attributes.
 *
 * Emits only the keys that are present on the ref (undefined keys are omitted).
 * All values are String()-coerced so they are safe to bind as HTML attributes.
 *
 * This is the SINGLE SOURCE for all anchor attribute names — no other file may
 * define `data-bs-el-id`, `data-bs-el-notation`, `data-bs-el-name`, or the
 * `data-element-id` animation alias as string literals. Overlay targeting queries only these attributes; emitting all
 * present keys means a notation- or name-keyed custom UI can still be matched by
 * the overlay without duplicating the matchesRef precedence logic here.
 *
 * @param ref - Element identity (id/notation/name)
 * @param type - Optional caller-supplied label for the missing-anchor dev
 *   warning's dedup key (e.g. `'card'`, `'piece'`, `'grid-cell'`). The
 *   warning only fires when `ref.id`/`ref.notation`/`ref.name` are ALL
 *   `undefined` — none of those fields can supply a "type" at that point, so
 *   without this parameter every missing-anchor bug across the whole board
 *   collapses into one `'unknown'` bucket, permanently hiding all but the
 *   first distinct bug. Callers that know their own element kind (renderer
 *   components via `useSelectable`/`useSelectableGrid`) should pass it so
 *   distinct bugs (e.g. `CardRenderer` AND `PieceRenderer` both missing
 *   anchors) each warn once instead of only the first ever surfacing.
 *   Defaults to `'unknown'` when omitted (preserves prior behavior for
 *   direct callers that don't supply one).
 */
export function anchorAttrs(ref: ElementRef, type: string = 'unknown'): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (ref.id !== undefined) {
    attrs['data-bs-el-id'] = String(ref.id);
    // FLIP / flying-element anchor. It used to be written inline by whichever
    // renderer remembered to, which is why four of the eight had it and four
    // did not; deriving it here means an element that can be animated or
    // selected always carries it (#189).
    attrs['data-element-id'] = String(ref.id);
  }
  if (ref.notation !== undefined) attrs['data-bs-el-notation'] = String(ref.notation);
  if (ref.name !== undefined) attrs['data-bs-el-name'] = String(ref.name);
  if (Object.keys(attrs).length === 0) {
    devWarn(
      `anchorattrs-missing-${type}`,
      `anchorAttrs() produced no data-bs-el-* attributes for a selectable/renderable element (type: '${type}'). ` +
        `Custom boards must spread anchorAttrs(ref) (or v-bind="attrs" from useSelectable) onto each element's root ` +
        `so FLIP/flying-element animations and drag-drop can find it. Without an anchor, animations silently no-op ` +
        `and traces cannot identify the element. Pass at least one of { id, notation, name } on the ElementRef.`,
    );
  }
  return attrs;
}

/**
 * Map a candidate label to its stable `data-bs-candidate` attribute.
 *
 * Present ONLY while the element is a candidate of the pick in progress, and
 * valued with the text the action panel would have shown for it. That makes an
 * anchored candidate answerable by what a player reads — `[data-bs-candidate="Holding 1"]`
 * — rather than by the internal element name the board happens to print, or by a
 * pointer landing where someone already knows the candidate to be (#189).
 *
 * One attribute rather than two: the identity is already on the same node as
 * `data-bs-el-id` via {@link anchorAttrs}, so a second copy of it would be a
 * second thing to keep true. What was missing is the player-facing wording and
 * a marker saying "this node answers the open selection", and this is both.
 *
 * This is the SINGLE SOURCE for the candidate attribute name — no other file may
 * write `data-bs-candidate` as a string literal.
 *
 * @param label - Candidate display text from {@link BoardInteractionActions.candidateLabel},
 *   or null when the element is not a candidate right now.
 */
export function candidateAttrs(label: string | null): Record<string, string> {
  return label === null ? {} : { 'data-bs-candidate': label };
}

/**
 * Provide board interaction (call in GameShell setup)
 */
export function provideBoardInteraction(interaction: BoardInteraction): void {
  provide(BOARD_INTERACTION_KEY, interaction);
}

/**
 * Use board interaction (call in ActionPanel or game board).
 *
 * Throws if called outside a `<GameShell>` (which always provides board
 * interaction) instead of silently returning undefined. If board interaction is genuinely optional for a component,
 * use {@link tryUseBoardInteraction} instead.
 */
export function useBoardInteraction(): BoardInteraction {
  const interaction = inject(BOARD_INTERACTION_KEY);
  if (!interaction) {
    throw new Error(
      'useBoardInteraction() must be called inside a <GameShell>. ' +
        'Render this component within <GameShell>, or use tryUseBoardInteraction() ' +
        'if board interaction is optional here.'
    );
  }
  return interaction;
}

/**
 * Try to use board interaction without requiring a `<GameShell>` provider.
 *
 * Returns `undefined` instead of throwing when there is no provider. Use this
 * for components/composables that must degrade gracefully when board
 * interaction is unavailable. Prefer {@link useBoardInteraction} when the
 * component is always rendered inside `<GameShell>`.
 */
export function tryUseBoardInteraction(): BoardInteraction | undefined {
  return inject(BOARD_INTERACTION_KEY);
}

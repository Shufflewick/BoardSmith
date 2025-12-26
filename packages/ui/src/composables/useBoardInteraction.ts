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
import { reactive, provide, inject, type InjectionKey } from 'vue';

/**
 * Reference to a board element (can match by various properties)
 */
export interface ElementRef {
  id?: number;
  name?: string;
  notation?: string;
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
 * Valid element for the current action selection
 */
export interface ValidElement {
  id: number;
  ref: ElementRef;
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
  validElements: ValidElement[];

  /** Callback to invoke when a valid element is clicked */
  onElementSelect: ((elementId: number) => void) | null;

  /** Currently dragged element (for drag-and-drop actions) */
  draggedElement: ElementRef | null;

  /** Valid drop targets for the dragged element */
  dropTargets: ValidElement[];

  /** Whether drag mode is active */
  isDragging: boolean;

  /** Element that is selected and can be dragged (for auto-select scenarios) */
  draggableSelectedElement: ElementRef | null;
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
  setValidElements: (elements: ValidElement[], onSelect: (elementId: number) => void) => void;

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

  /** Trigger element selection (called by board when clicking a valid element) */
  triggerElementSelect: (element: { id?: number; name?: string; notation?: string }) => void;

  /** Start dragging an element (called by board when drag starts) */
  startDrag: (element: ElementRef) => void;

  /** End drag operation (called when drag ends or is cancelled) */
  endDrag: () => void;

  /** Set valid drop targets for current drag operation */
  setDropTargets: (targets: ValidElement[], onDrop: (elementId: number) => void) => void;

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
}

export type BoardInteraction = BoardInteractionState & BoardInteractionActions;

const BOARD_INTERACTION_KEY: InjectionKey<BoardInteraction> = Symbol('boardInteraction');

/**
 * Create board interaction state (call in GameShell)
 */
export function createBoardInteraction(): BoardInteraction {
  const state = reactive<BoardInteractionState>({
    hoveredChoice: null,
    selectedElement: null,
    validElements: [],
    onElementSelect: null,
    draggedElement: null,
    dropTargets: [],
    isDragging: false,
    draggableSelectedElement: null,
  });

  // Callback for when element is dropped on valid target
  let onDropCallback: ((elementId: number) => void) | null = null;

  function matchesRef(element: { id?: number; name?: string; notation?: string }, ref: ElementRef): boolean {
    if (ref.id !== undefined && element.id === ref.id) return true;
    if (ref.name && element.name === ref.name) return true;
    if (ref.notation && element.notation === ref.notation) return true;
    return false;
  }

  function matchesAnyRef(element: { id?: number; name?: string; notation?: string }, refs: ElementRef[]): boolean {
    return refs.some(ref => matchesRef(element, ref));
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
      state.draggedElement = null;
      state.dropTargets = [];
      state.isDragging = false;
      state.draggableSelectedElement = null;
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
      // Check if this element is in the valid elements list
      return state.validElements.some(ve => matchesRef(element, ve.ref));
    },

    triggerElementSelect(element) {
      // Find the matching valid element and trigger the callback
      const validElem = state.validElements.find(ve => matchesRef(element, ve.ref));
      if (validElem && state.onElementSelect) {
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
  };

  // Merge actions into the state object to maintain reactivity
  // (spreading would copy values, breaking reactive updates)
  return Object.assign(state, actions) as unknown as BoardInteraction;
}

/**
 * Provide board interaction (call in GameShell setup)
 */
export function provideBoardInteraction(interaction: BoardInteraction): void {
  provide(BOARD_INTERACTION_KEY, interaction);
}

/**
 * Use board interaction (call in ActionPanel or game board)
 */
export function useBoardInteraction(): BoardInteraction | undefined {
  return inject(BOARD_INTERACTION_KEY);
}

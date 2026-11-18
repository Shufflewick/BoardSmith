/**
 * useElementBoardState — an AutoUI renderer's board state for one element.
 *
 * Every renderer reads identity, highlighted, selected, selectable, disabled
 * and drop-target state through boardCellStates, either directly (the grid and
 * hex boards, per cell) or through useElementBoardState, so the renderers
 * cannot drift apart: when each kept its own copy, they disagreed about the
 * draggable-selected element and Card announced selection from sets nothing
 * filled (#1052, #894, #1705).
 */
import { computed } from 'vue';
import { tryUseBoardInteraction, type BoardInteraction } from './useBoardInteraction.js';

/** The fields of an element the board identifies it by. */
interface BoardElement {
  id: number;
  name?: string;
  attributes?: Record<string, unknown>;
}

/**
 * The board states of any element, per call. Every call goes through
 * cellIdentity so a board ref keyed by `notation` (an attribute, not a
 * top-level field) still matches the element.
 */
export function boardCellStates(boardInteraction: BoardInteraction | undefined) {
  function cellIdentity(cell: BoardElement) {
    return {
      id: cell.id,
      name: cell.name,
      notation: cell.attributes?.notation as string | undefined,
    };
  }

  function isCellSelected(cell: BoardElement): boolean {
    return boardInteraction?.isSelected(cellIdentity(cell)) ?? false;
  }

  function isCellActionSelectable(cell: BoardElement): boolean {
    return !!boardInteraction && !isCellSelected(cell) && boardInteraction.isSelectableElement(cellIdentity(cell));
  }

  function isCellDropTarget(cell: BoardElement): boolean {
    return boardInteraction?.isDropTarget(cellIdentity(cell)) ?? false;
  }

  function isCellDisabled(cell: BoardElement): boolean {
    return !!boardInteraction && boardInteraction.isDisabledElement(cellIdentity(cell)) !== false;
  }

  /** The state word a cell's aria-label ends with. */
  function cellStateLabel(cell: BoardElement): string {
    if (isCellDisabled(cell)) return 'unavailable';
    if (isCellSelected(cell)) return 'selected';
    if (isCellDropTarget(cell)) return 'drop target';
    if (isCellActionSelectable(cell)) return 'selectable';
    return 'empty';
  }

  return {
    cellIdentity,
    isCellSelected,
    isCellHighlighted: (cell: BoardElement): boolean => boardInteraction?.isHighlighted(cellIdentity(cell)) ?? false,
    isCellActionSelectable,
    isCellDropTarget,
    // The drop target under the pointer: a finger has no :hover to show it (#1605).
    isCellDropHover: (cell: BoardElement): boolean => boardInteraction?.isHoveredDropTarget(cellIdentity(cell)) ?? false,
    isCellDisabled,
    cellStateLabel,
  };
}

export function useElementBoardState(element: () => BoardElement) {
  const boardInteraction = tryUseBoardInteraction();
  const states = boardCellStates(boardInteraction);
  const identity = () => states.cellIdentity(element());

  const isHighlighted = computed(() => states.isCellHighlighted(element()));
  const isSelected = computed(() => states.isCellSelected(element()));
  const isActionSelectable = computed(() => states.isCellActionSelectable(element()));
  // The auto-filled first pick of a later choice: only a renderer that can drag it on may offer it.
  const isDraggableSelected = computed(
    () => !!boardInteraction && !isSelected.value && boardInteraction.isDraggableSelectedElement(identity()),
  );
  const isDisabled = computed(() => states.isCellDisabled(element()));
  const canStartDrag = computed(() => !!boardInteraction && boardInteraction.canStartDrag(identity()));
  const isDropTarget = computed(() => states.isCellDropTarget(element()));
  const isDragged = computed(() => boardInteraction?.isDraggedElement(identity()) ?? false);
  const isDropHover = computed(() => states.isCellDropHover(element()));

  return {
    boardInteraction,
    identity,
    isHighlighted,
    isSelected,
    isActionSelectable,
    isDraggableSelected,
    isDisabled,
    canStartDrag,
    isDropTarget,
    isDragged,
    isDropHover,
  };
}

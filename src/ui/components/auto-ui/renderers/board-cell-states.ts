import type { BoardInteraction } from '../../../composables/useBoardInteraction.js';

interface BoardCell {
  id: number;
  name?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Per-cell interaction states shared by the grid and hex board renderers.
 * Every call goes through cellIdentity so a board ref keyed by `notation`
 * (an attribute, not a top-level field) still matches the cell.
 */
export function boardCellStates(boardInteraction: BoardInteraction | undefined) {
  function cellIdentity(cell: BoardCell) {
    return {
      id: cell.id,
      name: cell.name,
      notation: cell.attributes?.notation as string | undefined,
    };
  }

  function isCellSelected(cell: BoardCell): boolean {
    return boardInteraction?.isSelected(cellIdentity(cell)) ?? false;
  }

  function isCellActionSelectable(cell: BoardCell): boolean {
    return !!boardInteraction && !isCellSelected(cell) && boardInteraction.isSelectableElement(cellIdentity(cell));
  }

  function isCellDropTarget(cell: BoardCell): boolean {
    return boardInteraction?.isDropTarget(cellIdentity(cell)) ?? false;
  }

  function isCellDisabled(cell: BoardCell): boolean {
    return !!boardInteraction && boardInteraction.isDisabledElement(cellIdentity(cell)) !== false;
  }

  /** The state word a cell's aria-label ends with. */
  function cellStateLabel(cell: BoardCell): string {
    if (isCellDisabled(cell)) return 'unavailable';
    if (isCellSelected(cell)) return 'selected';
    if (isCellDropTarget(cell)) return 'drop target';
    if (isCellActionSelectable(cell)) return 'selectable';
    return 'empty';
  }

  return {
    cellIdentity,
    isCellSelected,
    isCellHighlighted: (cell: BoardCell): boolean => boardInteraction?.isHighlighted(cellIdentity(cell)) ?? false,
    isCellActionSelectable,
    isCellDropTarget,
    isCellDisabled,
    cellStateLabel,
  };
}

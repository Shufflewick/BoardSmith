/**
 * useGameGrid - Utilities for 2D grid-based game boards
 *
 * Provides helpers for working with grid-based games like Chess, Checkers,
 * Go, Tic-Tac-Toe, Connect Four, etc.
 *
 * ## Usage
 *
 * ```typescript
 * import { useGameGrid } from '@boardsmith/ui';
 *
 * const props = defineProps<{ gameView: GameElement; playerSeat: number }>();
 *
 * const {
 *   grid,
 *   getCell,
 *   getCellAt,
 *   getChildAt,
 *   toNotation,
 *   fromNotation,
 *   iterateCells,
 * } = useGameGrid({
 *   gameView: () => props.gameView,
 *   boardClassName: 'Board',
 *   cellClassName: 'Square',
 *   rowAttr: 'row',
 *   colAttr: 'col',
 * });
 *
 * // Get cell at position
 * const cell = getCellAt(3, 4);
 *
 * // Get piece on a cell
 * const piece = getChildAt(3, 4, 'CheckerPiece');
 *
 * // Convert to algebraic notation
 * const notation = toNotation(0, 0); // 'a8' for chess-style
 * ```
 */

import { computed, type ComputedRef } from 'vue';
import { findElement } from './useGameViewHelpers.js';
import type { GameElement, BaseElementAttributes } from '../types.js';

// Re-export GameElement
export type { GameElement };

export interface GameGridOptions {
  /** Function that returns the current game view */
  gameView: () => GameElement | null | undefined;
  /** Class name of the board element (default: 'Board') */
  boardClassName?: string;
  /** Class name of cell elements (default: 'Square') */
  cellClassName?: string;
  /** Attribute name for row index (default: 'row') */
  rowAttr?: string;
  /** Attribute name for column index (default: 'col') */
  colAttr?: string;
  /** Number of rows (default: 8) */
  rows?: number;
  /** Number of columns (default: 8) */
  cols?: number;
  /** Whether row 0 is at the top (default: true) */
  rowZeroAtTop?: boolean;
}

export interface GameGridReturn<TCell = GameElement> {
  /** The board element */
  board: ComputedRef<GameElement | null | undefined>;
  /** Map of cells keyed by "row-col" */
  grid: ComputedRef<Map<string, TCell>>;
  /** Get the key for a row/col position */
  getKey: (row: number, col: number) => string;
  /** Get cell at row/col */
  getCellAt: (row: number, col: number) => TCell | undefined;
  /** Get first child of a specific class at row/col */
  getChildAt: (row: number, col: number, className: string) => GameElement | undefined;
  /** Get all children of a specific class at row/col */
  getChildrenAt: (row: number, col: number, className: string) => GameElement[];
  /** Convert row/col to algebraic notation (a1-h8 style) */
  toNotation: (row: number, col: number) => string;
  /** Convert algebraic notation to row/col */
  fromNotation: (notation: string) => { row: number; col: number } | null;
  /** Iterate over all cells */
  iterateCells: () => IterableIterator<[string, TCell]>;
  /** Find all cells matching a predicate */
  findCells: (predicate: (cell: TCell, row: number, col: number) => boolean) => TCell[];
  /** Check if position is within bounds */
  isInBounds: (row: number, col: number) => boolean;
}

/**
 * Create grid utilities for a 2D game board.
 */
export function useGameGrid<TCell = GameElement>(
  options: GameGridOptions
): GameGridReturn<TCell> {
  const {
    gameView,
    boardClassName = 'Board',
    cellClassName = 'Square',
    rowAttr = 'row',
    colAttr = 'col',
    rows = 8,
    cols = 8,
    rowZeroAtTop = true,
  } = options;

  // Find the board element
  const board = computed(() => {
    const view = gameView();
    if (!view) return null;
    return findElement(view, { className: boardClassName });
  });

  /** Helper to get typed attributes */
  function getAttrs(element: GameElement): BaseElementAttributes & Record<string, unknown> {
    return (element.attributes ?? {}) as BaseElementAttributes & Record<string, unknown>;
  }

  // Build a map of cells keyed by "row-col"
  const grid = computed<Map<string, TCell>>(() => {
    const map = new Map<string, TCell>();
    if (!board.value?.children) return map;

    for (const child of board.value.children) {
      if (child.className === cellClassName) {
        const attrs = getAttrs(child);
        const row = attrs[rowAttr as keyof typeof attrs];
        const col = attrs[colAttr as keyof typeof attrs];
        if (row !== undefined && col !== undefined) {
          map.set(`${row}-${col}`, child as unknown as TCell);
        }
      }
    }
    return map;
  });

  function getKey(row: number, col: number): string {
    return `${row}-${col}`;
  }

  function getCellAt(row: number, col: number): TCell | undefined {
    return grid.value.get(getKey(row, col));
  }

  function getChildAt(row: number, col: number, className: string): GameElement | undefined {
    const cell = getCellAt(row, col) as GameElement | undefined;
    if (!cell?.children) return undefined;
    return cell.children.find((c) => c.className === className);
  }

  function getChildrenAt(row: number, col: number, className: string): GameElement[] {
    const cell = getCellAt(row, col) as GameElement | undefined;
    if (!cell?.children) return [];
    return cell.children.filter((c) => c.className === className);
  }

  /**
   * Convert row/col to algebraic notation (chess-style: a1-h8).
   * Column 0 = 'a', Column 7 = 'h'
   * Row depends on rowZeroAtTop: if true, row 0 = '8', row 7 = '1'
   */
  function toNotation(row: number, col: number): string {
    const colLetter = String.fromCharCode(97 + col); // a-h
    const rowNumber = rowZeroAtTop ? rows - row : row + 1;
    return `${colLetter}${rowNumber}`;
  }

  /**
   * Convert algebraic notation to row/col.
   */
  function fromNotation(notation: string): { row: number; col: number } | null {
    if (notation.length < 2) return null;

    const colLetter = notation[0].toLowerCase();
    const rowNumber = parseInt(notation.slice(1), 10);

    if (colLetter < 'a' || colLetter > String.fromCharCode(96 + cols)) return null;
    if (isNaN(rowNumber) || rowNumber < 1 || rowNumber > rows) return null;

    const col = colLetter.charCodeAt(0) - 97;
    const row = rowZeroAtTop ? rows - rowNumber : rowNumber - 1;

    return { row, col };
  }

  function* iterateCells(): IterableIterator<[string, TCell]> {
    yield* grid.value.entries();
  }

  function findCells(predicate: (cell: TCell, row: number, col: number) => boolean): TCell[] {
    const results: TCell[] = [];
    for (const [key, cell] of grid.value) {
      const [rowStr, colStr] = key.split('-');
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);
      if (predicate(cell, row, col)) {
        results.push(cell);
      }
    }
    return results;
  }

  function isInBounds(row: number, col: number): boolean {
    return row >= 0 && row < rows && col >= 0 && col < cols;
  }

  return {
    board,
    grid,
    getKey,
    getCellAt,
    getChildAt,
    getChildrenAt,
    toNotation,
    fromNotation,
    iterateCells,
    findCells,
    isInBounds,
  };
}

/**
 * Standalone algebraic notation utilities (for use without the full composable).
 */
export function toAlgebraicNotation(
  row: number,
  col: number,
  options: { rows?: number; rowZeroAtTop?: boolean } = {}
): string {
  const { rows = 8, rowZeroAtTop = true } = options;
  const colLetter = String.fromCharCode(97 + col);
  const rowNumber = rowZeroAtTop ? rows - row : row + 1;
  return `${colLetter}${rowNumber}`;
}

export function fromAlgebraicNotation(
  notation: string,
  options: { rows?: number; cols?: number; rowZeroAtTop?: boolean } = {}
): { row: number; col: number } | null {
  const { rows = 8, cols = 8, rowZeroAtTop = true } = options;

  if (notation.length < 2) return null;

  const colLetter = notation[0].toLowerCase();
  const rowNumber = parseInt(notation.slice(1), 10);

  if (colLetter < 'a' || colLetter > String.fromCharCode(96 + cols)) return null;
  if (isNaN(rowNumber) || rowNumber < 1 || rowNumber > rows) return null;

  const col = colLetter.charCodeAt(0) - 97;
  const row = rowZeroAtTop ? rows - rowNumber : rowNumber - 1;

  return { row, col };
}

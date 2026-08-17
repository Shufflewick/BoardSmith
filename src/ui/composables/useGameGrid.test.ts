/**
 * 2D board helpers for custom UIs (chess, checkers, tic-tac-toe): cell lookup
 * by row/column and the algebraic-notation conversion games use for move logs
 * and board refs.
 */
import { describe, it, expect } from 'vitest';
import {
  useGameGrid,
  toAlgebraicNotation,
  fromAlgebraicNotation,
} from './useGameGrid.js';
import type { GameElement } from '../types.js';

const square = (row: number, col: number, children: GameElement[] = []): GameElement =>
  ({
    id: row * 10 + col,
    className: 'Square',
    name: `${row}-${col}`,
    attributes: { row, col },
    children,
  } as unknown as GameElement);

const piece = (className: string, id: number): GameElement =>
  ({ id, className, name: className, attributes: {}, children: [] } as GameElement);

const gameView = (squares: GameElement[]): GameElement =>
  ({
    id: 1, className: 'Game', name: 'game', attributes: {},
    children: [{ id: 2, className: 'Board', name: 'board', attributes: {}, children: squares }],
  } as unknown as GameElement);

const grid = (view: GameElement | null, options = {}) =>
  useGameGrid({ gameView: () => view, ...options });

const SQUARES = [square(0, 0), square(0, 1), square(1, 0), square(1, 1)];

describe('toAlgebraicNotation', () => {
  it('names the chess corners correctly with row 0 at the top', () => {
    expect(toAlgebraicNotation(0, 0)).toBe('a8');
    expect(toAlgebraicNotation(7, 0)).toBe('a1');
    expect(toAlgebraicNotation(7, 7)).toBe('h1');
    expect(toAlgebraicNotation(0, 7)).toBe('h8');
  });

  it('counts rows upward when row 0 is at the bottom', () => {
    expect(toAlgebraicNotation(0, 0, { rowZeroAtTop: false })).toBe('a1');
    expect(toAlgebraicNotation(7, 0, { rowZeroAtTop: false })).toBe('a8');
  });

  it('honours a non-standard board height', () => {
    expect(toAlgebraicNotation(0, 0, { rows: 10 })).toBe('a10');
    expect(toAlgebraicNotation(9, 0, { rows: 10 })).toBe('a1');
  });

  it('maps each column to its own letter', () => {
    expect([0, 1, 2, 25].map((col) => toAlgebraicNotation(0, col)[0]))
      .toEqual(['a', 'b', 'c', 'z']);
  });

  it('gives every square on an 8x8 board a distinct name', () => {
    const names = new Set<string>();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) names.add(toAlgebraicNotation(row, col));
    }
    expect(names.size).toBe(64);
  });
});

describe('fromAlgebraicNotation', () => {
  it('inverts toAlgebraicNotation across a whole board', () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        expect(fromAlgebraicNotation(toAlgebraicNotation(row, col))).toEqual({ row, col });
      }
    }
  });

  it('inverts it under the bottom-origin convention too', () => {
    const options = { rowZeroAtTop: false };
    for (let row = 0; row < 8; row++) {
      expect(fromAlgebraicNotation(toAlgebraicNotation(row, 3, options), options))
        .toEqual({ row, col: 3 });
    }
  });

  it('accepts an uppercase file letter', () => {
    expect(fromAlgebraicNotation('E4')).toEqual(fromAlgebraicNotation('e4'));
  });

  it('reads a two-digit rank on a taller board', () => {
    expect(fromAlgebraicNotation('a10', { rows: 10 })).toEqual({ row: 0, col: 0 });
  });

  it('rejects a file beyond the board width', () => {
    expect(fromAlgebraicNotation('i1')).toBeNull();
    expect(fromAlgebraicNotation('d1', { cols: 3 })).toBeNull();
  });

  it('rejects a rank beyond the board height', () => {
    expect(fromAlgebraicNotation('a9')).toBeNull();
    expect(fromAlgebraicNotation('a0')).toBeNull();
  });

  it('rejects a string that is not notation at all', () => {
    for (const input of ['', 'a', '4', 'aa', '11']) {
      expect(fromAlgebraicNotation(input)).toBeNull();
    }
  });

  it('rejects a file letter before "a"', () => {
    expect(fromAlgebraicNotation('11')).toBeNull();
  });
});

describe('useGameGrid', () => {
  it('finds the board in the game view', () => {
    expect(grid(gameView(SQUARES)).board.value?.className).toBe('Board');
  });

  it('reports no board for an absent game view', () => {
    expect(grid(null).board.value).toBeNull();
  });

  it('keys every cell by row and column', () => {
    const board = grid(gameView(SQUARES));
    expect(board.getKey(1, 2)).toBe('1-2');
    expect(board.grid.value.size).toBe(4);
    expect(board.getCellAt(1, 0)?.name).toBe('1-0');
  });

  it('returns nothing for an empty coordinate', () => {
    expect(grid(gameView(SQUARES)).getCellAt(5, 5)).toBeUndefined();
  });

  it('ignores board children that are not cells', () => {
    expect(grid(gameView([...SQUARES, piece('Marker', 99)])).grid.value.size).toBe(4);
  });

  it('skips cells with no coordinates', () => {
    const nowhere = { id: 7, className: 'Square', name: 'x', attributes: {}, children: [] } as GameElement;
    expect(grid(gameView([...SQUARES, nowhere])).grid.value.size).toBe(4);
  });

  it('honours custom class and attribute names', () => {
    const view = {
      id: 1, className: 'Game', name: 'g', attributes: {},
      children: [{
        id: 2, className: 'Grid', name: 'b', attributes: {},
        children: [{ id: 3, className: 'Cell', name: 'c', attributes: { y: 2, x: 3 }, children: [] }],
      }],
    } as unknown as GameElement;
    const board = grid(view, {
      boardClassName: 'Grid', cellClassName: 'Cell', rowAttr: 'y', colAttr: 'x',
    });
    expect(board.getCellAt(2, 3)?.id).toBe(3);
  });

  it('finds a piece of a given class on a square', () => {
    const view = gameView([square(0, 0, [piece('Pawn', 11)]), square(0, 1)]);
    expect(grid(view).getChildAt(0, 0, 'Pawn')?.id).toBe(11);
    expect(grid(view).getChildAt(0, 1, 'Pawn')).toBeUndefined();
  });

  it('finds every piece of a given class on a square', () => {
    const view = gameView([square(0, 0, [piece('Chip', 1), piece('Chip', 2), piece('King', 3)])]);
    expect(grid(view).getChildrenAt(0, 0, 'Chip').map((c) => c.id)).toEqual([1, 2]);
  });

  it('returns an empty child list for an empty square', () => {
    expect(grid(gameView(SQUARES)).getChildrenAt(9, 9, 'Pawn')).toEqual([]);
  });

  it('converts notation both ways using the board configuration', () => {
    const board = grid(gameView(SQUARES), { rows: 4, cols: 4, rowZeroAtTop: true });
    expect(board.toNotation(0, 0)).toBe('a4');
    expect(board.fromNotation('a4')).toEqual({ row: 0, col: 0 });
    expect(board.fromNotation('e1')).toBeNull();
  });

  it('matches the standalone notation helpers', () => {
    const board = grid(gameView(SQUARES));
    expect(board.toNotation(2, 3)).toBe(toAlgebraicNotation(2, 3));
    expect(board.fromNotation('c6')).toEqual(fromAlgebraicNotation('c6'));
  });

  it('iterates every mapped cell with its key', () => {
    expect([...grid(gameView(SQUARES)).iterateCells()].map(([key]) => key).sort())
      .toEqual(['0-0', '0-1', '1-0', '1-1']);
  });

  it('finds cells matching a coordinate predicate', () => {
    const board = grid(gameView(SQUARES));
    expect(board.findCells((_cell, row) => row === 0)).toHaveLength(2);
    expect(board.findCells(() => false)).toEqual([]);
  });

  it('hands the parsed coordinates to the predicate', () => {
    const seen: Array<[number, number]> = [];
    grid(gameView(SQUARES)).findCells((_c, row, col) => { seen.push([row, col]); return false; });
    expect(seen.sort()).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
  });

  it('bounds-checks against the configured board size', () => {
    const board = grid(gameView(SQUARES), { rows: 3, cols: 3 });
    expect(board.isInBounds(0, 0)).toBe(true);
    expect(board.isInBounds(2, 2)).toBe(true);
    expect(board.isInBounds(3, 0)).toBe(false);
    expect(board.isInBounds(0, 3)).toBe(false);
    expect(board.isInBounds(-1, 0)).toBe(false);
  });

  it('defaults to an 8x8 board', () => {
    const board = grid(gameView(SQUARES));
    expect(board.isInBounds(7, 7)).toBe(true);
    expect(board.isInBounds(8, 0)).toBe(false);
  });

  it('reports empty results for a missing game view rather than throwing', () => {
    const board = grid(null);
    expect(board.grid.value.size).toBe(0);
    expect(board.getCellAt(0, 0)).toBeUndefined();
    expect(board.getChildrenAt(0, 0, 'Pawn')).toEqual([]);
  });
});

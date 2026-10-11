/**
 * A Grid or HexGrid finds the cell at a coordinate by looking it up (#632).
 *
 * `grid.first(CellClass, { <row>: r, <column>: c })`, with exactly the grid's
 * two coordinate attributes, is answered from an index of the grid's cells.
 * The rule that makes that safe: a cell's coordinates do not change while it
 * is in its grid. Development mode checks every indexed answer against a
 * search of the grid, and a mismatch throws; production trusts the rule.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Grid,
  GridCell,
  HexGrid,
  HexCell,
  ElementCollection,
  type GameOptions,
} from '../index.js';

const devMode = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.override ?? actual.isDevMode() };
});

class Board extends Grid<CellGame> {
  $rowCoord = 'rank';
  $colCoord = 'file';
}
class Square extends GridCell<CellGame> {
  file!: number;
  rank!: number;
}
class Hexes extends HexGrid<CellGame> {}
class Hex extends HexCell<CellGame> {
  q!: number;
  r!: number;
}
class Stone extends Piece<CellGame> {}
class Holding extends Space<CellGame> {}

class CellGame extends Game<CellGame, Player> {
  board!: Board;
  hexes!: Hexes;
  holding!: Holding;
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Board, Square, Hexes, Hex, Stone, Holding]);
    this.board = this.create(Board, 'board');
    for (let rank = 1; rank <= 4; rank++) {
      for (let file = 0; file < 4; file++) this.board.create(Square, `s${file}${rank}`, { file, rank });
    }
    this.hexes = this.create(Hexes, 'hexes');
    for (let q = 0; q < 3; q++) {
      for (let r = 0; r < 3; r++) this.hexes.create(Hex, `h${q}${r}`, { q, r });
    }
    this.holding = this.create(Holding, 'holding');
  }
}

/** What a search of the grid finds, as `first` always answered. */
function searched<T extends Square | Hex>(grid: Board | Hexes, cellClass: new (...args: never[]) => T, coordinates: object): T | undefined {
  return new ElementCollection(...grid._t.children).first(cellClass as never, coordinates as never) as T | undefined;
}

afterEach(() => {
  devMode.override = null;
  vi.restoreAllMocks();
});

describe('a grid looks a cell up by coordinate', () => {
  it('without searching the grid, in production', () => {
    devMode.override = false;
    const game = new CellGame({ playerCount: 2 });
    game.board.first(Square, { file: 0, rank: 1 });
    const searches = vi.spyOn(ElementCollection.prototype, '_finder');

    expect(game.board.first(Square, { file: 3, rank: 4 })?.name).toBe('s34');
    expect(game.hexes.first(Hex, { q: 2, r: 1 })?.name).toBe('h21');
    expect(searches).not.toHaveBeenCalled();
  });

  it('finds a cell created after the grid was first asked', () => {
    const game = new CellGame({ playerCount: 2 });
    expect(game.board.first(Square, { file: 9, rank: 9 })).toBeUndefined();
    const late = game.board.create(Square, 'late', { file: 9, rank: 9 });
    expect(game.board.first(Square, { file: 9, rank: 9 })).toBe(late);
  });

  it('does not find a cell moved out of the grid, and finds it again at its new coordinates when moved back', () => {
    const game = new CellGame({ playerCount: 2 });
    const square = game.board.first(Square, { file: 1, rank: 2 })!;
    square.reparent(game.holding);
    expect(game.board.first(Square, { file: 1, rank: 2 })).toBeUndefined();

    square.file = 7;
    square.reparent(game.board);
    expect(game.board.first(Square, { file: 7, rank: 2 })).toBe(square);
  });

  it('does not find a removed cell', () => {
    const game = new CellGame({ playerCount: 2 });
    const hex = game.hexes.first(Hex, { q: 1, r: 1 })!;
    hex.remove();
    expect(game.hexes.first(Hex, { q: 1, r: 1 })).toBeUndefined();
  });

  it('finds the restored cell after a restore', () => {
    const game = new CellGame({ playerCount: 2 });
    const before = game.board.first(Square, { file: 2, rank: 3 })!;
    game.loadSerializedState(game.toJSON());

    const after = game.board.first(Square, { file: 2, rank: 3 });
    expect(after).toBe(searched(game.board, Square, { file: 2, rank: 3 }));
    expect(after).not.toBe(before);
    expect(after?.name).toBe('s23');
  });

  it('answers other queries on the grid by searching it, as before', () => {
    const game = new CellGame({ playerCount: 2 });
    const square = game.board.first(Square, { file: 0, rank: 1 })!;
    square.create(Stone, 'stone');
    expect(game.board.first(Square, { file: 0 })).toBe(square);
    expect(game.board.first(Stone)?.name).toBe('stone');
    expect(game.board.first(Square, (s) => s.rank === 4 && s.file === 2)?.name).toBe('s24');
  });
});

describe('the rule, checked in development mode', () => {
  it("refuses an answer once a cell's coordinates changed while it was in its grid", () => {
    devMode.override = true;
    const game = new CellGame({ playerCount: 2 });
    game.board.first(Square, { file: 0, rank: 1 });
    game.board.first(Square, { file: 1, rank: 1 })!.file = 5;

    expect(() => game.board.first(Square, { file: 5, rank: 1 })).toThrow(
      /Grid "board".*file: 5, rank: 1.*coordinates.*changed while it was in the grid/s,
    );
  });
});

/** A small seeded generator, so a failing sequence can be replayed from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the index never answers differently from a search while the rule holds', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`over a random run of cells moved out, re-addressed and back, stones placed, shuffles and restores (seed ${seed})`, () => {
      devMode.override = false;
      const random = mulberry32(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
      const coordinate = () => Math.floor(random() * 6);
      const game = new CellGame({ playerCount: 2 });
      const states: ReturnType<CellGame['toJSON']>[] = [];

      for (let step = 0; step < 150; step++) {
        const onBoard = [...game.board.all(Square)];
        const held = [...game.holding.all(Square)];
        // Each operation, as often as it appears here. A cell's coordinates
        // change only while it is out of the grid: the rule.
        const operations = [
          () => onBoard.length > 0 && pick(onBoard).reparent(game.holding),
          () => {
            if (held.length === 0) return;
            const square = pick(held);
            square.file = coordinate();
            square.rank = coordinate();
            square.reparent(game.board);
          },
          () => onBoard.length > 0 && pick(onBoard).create(Stone, `stone${step}`),
          () => game.board.shuffle(),
          () => states.push(game.toJSON()),
          () => states.length > 0 && game.loadSerializedState(pick(states)),
        ];
        pick(operations)();

        for (let file = 0; file < 6; file++) {
          for (let rank = 0; rank < 6; rank++) {
            expect(game.board.first(Square, { file, rank })).toBe(searched(game.board, Square, { file, rank }));
          }
        }
      }
    });
  }
});

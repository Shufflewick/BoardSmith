import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Grid, GridCell, Piece, Player, Space } from '../index.js';

class Pawn extends Piece<GridGame> {}

class Square extends GridCell<GridGame> {
  rank!: number;
  file!: number;
}

class Board extends Grid<GridGame> {
  $rowLabels = ['1', '2', '3'];
  $columnLabels = ['a', 'b', 'c'];
  $rowCoord = 'rank';
  $colCoord = 'file';
}

class GridGame extends Game<GridGame, Player> {
  board!: Board;

  constructor(options: { playerCount: number }) {
    super(options);
    this.board = this.create(Board, 'board');
    for (let rank = 1; rank <= 3; rank++) {
      for (let file = 1; file <= 3; file++) {
        this.board.create(Square, `${file}${rank}`, { rank, file });
      }
    }
  }
}

describe('Grid', () => {
  let game: GridGame;

  beforeEach(() => {
    game = new GridGame({ playerCount: 2 });
  });

  it("declares the 'grid' layout so the auto-UI renders it as a board", () => {
    expect(game.board.$layout).toBe('grid');
  });

  it('is a Space, so it holds children like any other zone', () => {
    expect(game.board).toBeInstanceOf(Space);
  });

  it('carries the row/column labels the designer declared', () => {
    expect(game.board.$rowLabels).toEqual(['1', '2', '3']);
    expect(game.board.$columnLabels).toEqual(['a', 'b', 'c']);
  });

  it('names the coordinate attributes the renderer should read off its cells', () => {
    expect(game.board.$rowCoord).toBe('rank');
    expect(game.board.$colCoord).toBe('file');
  });

  it('leaves labels and coordinate names undefined when the designer omits them', () => {
    const plain = game.create(Grid, 'plain');
    expect(plain.$rowLabels).toBeUndefined();
    expect(plain.$columnLabels).toBeUndefined();
    expect(plain.$rowCoord).toBeUndefined();
    expect(plain.$colCoord).toBeUndefined();
  });

  it('holds one cell per position', () => {
    expect(game.board.all(Square)).toHaveLength(9);
  });

  it('serializes its layout and the coordinate metadata the auto-UI needs', () => {
    const json = game.board.toJSON();
    expect(json.attributes).toMatchObject({
      $layout: 'grid',
      $rowCoord: 'rank',
      $colCoord: 'file',
      $rowLabels: ['1', '2', '3'],
      $columnLabels: ['a', 'b', 'c'],
    });
  });
});

describe('GridCell', () => {
  let game: GridGame;

  beforeEach(() => {
    game = new GridGame({ playerCount: 2 });
  });

  const squareAt = (rank: number, file: number) =>
    game.board.first(Square, { rank, file })!;

  it("declares the 'list' layout — a cell is a plain container, not a nested board", () => {
    expect(squareAt(1, 1).$layout).toBe('list');
  });

  it('is a Space, so pieces can move into it', () => {
    expect(squareAt(1, 1)).toBeInstanceOf(Space);
  });

  it('is findable by its coordinate attributes', () => {
    const square = squareAt(2, 3);
    expect(square.rank).toBe(2);
    expect(square.file).toBe(3);
    expect(square.name).toBe('32');
  });

  it('accepts a piece and reports it as its own child', () => {
    const pawn = game.create(Pawn, 'pawn');
    pawn.putInto(squareAt(2, 2));
    expect(squareAt(2, 2).all(Pawn)).toHaveLength(1);
    expect(pawn.parent).toBe(squareAt(2, 2));
  });

  it('a piece moved between cells leaves the first empty', () => {
    const pawn = game.create(Pawn, 'pawn');
    pawn.putInto(squareAt(1, 1));
    pawn.putInto(squareAt(1, 2));
    expect(squareAt(1, 1).all(Pawn)).toHaveLength(0);
    expect(squareAt(1, 2).all(Pawn)).toHaveLength(1);
  });

  it('serializes its coordinates so the client can position it', () => {
    const json = squareAt(3, 2).toJSON();
    expect(json.attributes).toMatchObject({ rank: 3, file: 2, $layout: 'list' });
  });

  it('survives a snapshot restore with its coordinates and contents intact', () => {
    const pawn = game.create(Pawn, 'pawn');
    pawn.putInto(squareAt(2, 2));

    const restored = Game.restoreGame(
      game.toJSON() as any,
      GridGame as unknown as new (options: any) => GridGame,
      game._ctx.classRegistry
    );

    const board = restored.first(Board)!;
    expect(board.$layout).toBe('grid');
    expect(board.all(Square)).toHaveLength(9);
    const restoredSquare = board.first(Square, { rank: 2, file: 2 })!;
    expect(restoredSquare).toBeInstanceOf(GridCell);
    expect(restoredSquare.all(Pawn)).toHaveLength(1);
  });
});

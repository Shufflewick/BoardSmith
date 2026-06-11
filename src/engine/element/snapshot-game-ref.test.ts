import { describe, it, expect } from 'vitest';
import { Game, Space, Piece, Player } from '../index.js';

// game → board (Space) → square (Space) → checker (Piece): the checker is a
// NESTED element, restored via fromJSON rather than the game's direct-children loop.
class BoardGame extends Game<BoardGame, Player> {}
class Board extends Space<BoardGame> {}
class Square extends Space<BoardGame> {}
class Checker extends Piece<BoardGame> {}

function buildGame(): BoardGame {
  const game = new BoardGame({ playerCount: 2 });
  const board = game.create(Board, 'board');
  const square = board.create(Square, 'a1');
  square.create(Checker, 'checker');
  return game;
}

describe('snapshot restore preserves element.game', () => {
  it('a nested element keeps its game back-reference after restore', () => {
    const game = buildGame();
    const json = game.toJSON();

    const restored = Game.restoreGame(json, BoardGame, game._ctx.classRegistry) as BoardGame;
    const checker = restored.first(Board)!.first(Square)!.first(Checker)!;

    // Before the fix this was `undefined` (fromJSON never set it), which made
    // `checker.remove()` throw "Cannot read properties of undefined (reading 'pile')".
    expect(checker.game).toBe(restored);
  });

  it('remove() works on a nested element after restore (the checkers-capture crash)', () => {
    const game = buildGame();
    const json = game.toJSON();

    const restored = Game.restoreGame(json, BoardGame, game._ctx.classRegistry) as BoardGame;
    const checker = restored.first(Board)!.first(Square)!.first(Checker)!;

    expect(() => checker.remove()).not.toThrow();
    expect(restored.pile.count(Checker)).toBe(1);
  });
});

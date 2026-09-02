/**
 * Issue #162: element-level visibility belongs to every element, not just Piece.
 *
 * A Space could declare who may see its CONTENTS (`contentsHidden`,
 * `addZoneVisibleTo`) but not who may see the SPACE ITSELF. The only route was
 * `setVisibilityInternal` — a method whose own doc says the command executor
 * calls it — with a hand-written `VisibilityState` literal.
 *
 * Contract asserted here: the element-level API lives on `GameElement`, so a
 * Space, a Piece and the Game all carry it, and the two halves on a Space read
 * as the two different things they are.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, type GameOptions } from '../index.js';

class Token extends Piece<VisibilityGame> {}
class Room extends Space<VisibilityGame> {}

class VisibilityGame extends Game<VisibilityGame, Player> {
  hall!: Room;
  cellar!: Room;

  constructor(options: GameOptions) {
    super(options);
    this.hall = this.create(Room, 'hall');
    this.cellar = this.create(Room, 'cellar');
    this.hall.create(Token, 'lantern');
  }
}

function newGame(): VisibilityGame {
  return new VisibilityGame({ playerCount: 4, seed: 'element-visibility' });
}

describe('element-level visibility on GameElement', () => {
  it('lets a Space say who may see the space itself', () => {
    const game = newGame();
    game.cellar.showOnlyTo(3);

    expect(game.cellar.isVisibleTo(3)).toBe(true);
    expect(game.cellar.isVisibleTo(1)).toBe(false);
    expect(game.cellar.isVisibleTo(2)).toBe(false);
  });

  it('grants a Space to additional seats without touching the ones already granted', () => {
    const game = newGame();
    game.cellar.hideFromAll();
    game.cellar.addVisibleTo(2, game.players[2]!);

    expect(game.cellar.isVisibleTo(2)).toBe(true);
    expect(game.cellar.isVisibleTo(game.players[2]!.seat)).toBe(true);
    expect(game.cellar.isVisibleTo(1)).toBe(false);
  });

  it('hides a Space from named seats while the rest still see it', () => {
    const game = newGame();
    game.cellar.hideFrom(4);

    expect(game.cellar.isVisibleTo(4)).toBe(false);
    expect(game.cellar.isVisibleTo(1)).toBe(true);
  });

  it('reverts a Space to inherited visibility when its own is cleared', () => {
    const game = newGame();
    game.cellar.hideFromAll();
    expect(game.cellar.isVisibleTo(1)).toBe(false);

    game.cellar.clearVisibility();
    expect(game.cellar.isVisibleTo(1)).toBe(true);
  });

  it('keeps the space half and the contents half independent', () => {
    const game = newGame();
    game.hall.showOnlyTo(1);
    game.hall.contentsHidden();
    game.hall.addZoneVisibleTo(2);

    const lantern = game.hall.first(Token)!;
    expect(game.hall.isVisibleTo(1)).toBe(true);
    expect(game.hall.isVisibleTo(2)).toBe(false);
    expect(lantern.isVisibleTo(2)).toBe(true);
    expect(lantern.isVisibleTo(1)).toBe(false);
  });

  it('still gives a Piece the same API', () => {
    const game = newGame();
    const lantern = game.hall.first(Token)!;
    lantern.showOnlyTo(2);

    expect(lantern.isVisibleTo(2)).toBe(true);
    expect(lantern.isVisibleTo(1)).toBe(false);
  });
});

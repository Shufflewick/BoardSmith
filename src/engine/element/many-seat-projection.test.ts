/**
 * ShufflewickPub #408: MANY SEATS, ONE SERIALIZATION.
 *
 * `toJSONForPlayer(seat)` is two passes, and only the second one is about the
 * seat. The first is `this.toJSON()` -- the whole tree, in full fidelity, with
 * no seat anywhere in it -- and the second is `filterElement`, which reads that
 * tree and builds a redacted copy for one viewer. A fan-out called the pair
 * once per seat, so a world describing itself to five hundred watchers
 * serialized the identical tree five hundred times before redacting it five
 * hundred different ways.
 *
 * Measured on a 500-seat plaza of 200 public stalls (37 KB a view): 213 ms for
 * the fan-out, of which 181 ms was `toJSONForPlayer` and 148 ms of THAT was the
 * shared `toJSON()`. Seven tenths of a fan-out is one answer computed over and
 * over.
 *
 * `toJSONForPlayers` computes the shared half once. It is a BATCH rather than a
 * cache on purpose: "nothing changed between these two projections" is a claim
 * a cache has to guess at, and `src/world/contract.ts` retires guessing at
 * mutation as INCORRECT -- a write inside an attribute value (`at[HEALTH] = x`)
 * changes the tree and touches no setter. A list of seats handed over in one
 * call is the same claim made structurally: there is no await, no dispatch and
 * no bundle callback between the serialization and the last redaction.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Space, type ElementJSON, type GameOptions } from '../index.js';

/** Counts every full-tree serialization any instance of it takes part in. */
class Stall extends Space<PlazaGame> {
  goods = 0;

  static serializations = 0;

  override toJSON(): ElementJSON {
    Stall.serializations += 1;
    return super.toJSON();
  }
}

class Purse extends Piece<PlazaGame> {
  coins = 0;
}

class PlazaGame extends Game<PlazaGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Stall, Purse]);
  }
}

const SEATS = 4;

/**
 * A public square and four private purses.
 *
 * The square is what every seat sees the same way; each purse is visible only
 * to its owner, so the redaction still has real per-seat work to do and a batch
 * that shared the REDACTED answer would be caught here rather than in a world
 * with nothing to hide.
 */
function newPlaza(): PlazaGame {
  const game = new PlazaGame({ playerCount: SEATS, seed: 'plaza' });
  const square = game.create(Stall, 'square', { goods: 9 });
  square.create(Stall, 'baker', { goods: 3 });
  square.create(Stall, 'smith', { goods: 5 });
  for (let seat = 1; seat <= SEATS; seat += 1) {
    const purse = game.create(Purse, `purse-${seat}`, { coins: seat });
    purse.player = game.players[seat - 1];
    purse.showOnlyTo(seat);
  }
  Stall.serializations = 0;
  return game;
}

const seatsOf = (count: number): number[] =>
  Array.from({ length: count }, (_unused, index) => index + 1);

describe('#408 -- one serialization answers a whole audience', () => {
  it('gives every seat exactly what asking one seat at a time gives it', () => {
    const one = newPlaza();
    const apart = seatsOf(SEATS).map((seat) => one.toJSONForPlayer(seat));

    const many = newPlaza();
    const together = many.toJSONForPlayers(seatsOf(SEATS));

    expect(together).toEqual(apart);
  });

  it('still hides each seat\'s own purse from everybody else', () => {
    // The batch's redaction is the one thing it may not share. Stated as its
    // own case because `toEqual` above would pass just as well against a
    // projection that leaked to every seat identically.
    const game = newPlaza();
    const views = game.toJSONForPlayers(seatsOf(SEATS));
    for (const [index, view] of views.entries()) {
      const purses = (view.children ?? []).filter((child) => child.className === 'Purse');
      const mine = purses.filter((purse) => purse.attributes.coins !== undefined);
      expect(mine.map((purse) => purse.attributes.coins), `seat ${index + 1}`).toEqual([index + 1]);
    }
  });

  it('serializes the tree once for the whole audience instead of once per seat', () => {
    // THE MEASUREMENT. `Stall.toJSON` counts, so this is the engine's own
    // serializer reporting how often it ran rather than an assertion about the
    // shape of the new code. Three stalls in the tree, so one full pass is
    // three calls whatever the audience is.
    const perSeat = newPlaza();
    for (const seat of seatsOf(SEATS)) perSeat.toJSONForPlayer(seat);
    const apart = Stall.serializations;

    const batched = newPlaza();
    batched.toJSONForPlayers(seatsOf(SEATS));
    const together = Stall.serializations;

    expect(apart, 'one call per seat serializes the tree once per seat').toBe(3 * SEATS);
    expect(
      together,
      `Describing the plaza to ${SEATS} seats in one call serialized it ${together / 3} times. ` +
        'The full-fidelity pass has no seat in it, so an audience of any size is one pass.',
    ).toBe(3);
  });

  it('serializes once per seat for a game that rewrites its own player view', () => {
    // `static playerView` is bundle code handed the filtered tree, free to
    // rewrite it in place -- and a batch shares every attribute bag it did not
    // have to redact, so one seat's rewrite would reach the next seat's view.
    // A game that declares one is projected the old way, seat at a time. This
    // is a correctness boundary rather than a shortcut: nothing the engine can
    // read tells it whether an author's hook writes.
    class RewritingPlaza extends PlazaGame {
      static override playerView = (state: ElementJSON, seat: number | null): ElementJSON => {
        state.attributes = { ...state.attributes, lookedAt: seat };
        return state;
      };
    }
    const game = new RewritingPlaza({ playerCount: SEATS, seed: 'plaza' });
    game.create(Stall, 'square', { goods: 9 });
    Stall.serializations = 0;

    const views = game.toJSONForPlayers(seatsOf(SEATS));

    expect(views.map((view) => view.attributes.lookedAt)).toEqual(seatsOf(SEATS));
    expect(Stall.serializations, 'one pass per seat, because the hook may write').toBe(SEATS);
  });
});

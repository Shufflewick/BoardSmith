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

/**
 * ShufflewickPub #408, second half: WHEN IS A PROJECTION THE SAME FOR EVERYBODY?
 *
 * Sharing a serialization (above) removed the repeated pass. It did not make
 * two seats' answers EQUAL, and equal is what a host needs before it can encode
 * a fan-out once: a 500-seat announcement in a public room is 500 identical
 * views and was 500 separate `JSON.stringify` calls, 18.5 MB, because nothing
 * could say they were identical.
 *
 * Measured, a plainly public plaza of 200 stalls at 500 seats collapses to ONE
 * distinct body once the seat number and the viewer's own player element are
 * out of the way; the same plaza scoped with `addVisibleTo` stays 500 distinct,
 * because `redactVisibilityForSeat` collapses the grant roster to the receiving
 * seat and that is per-seat by construction.
 *
 * So the question is answered STRUCTURALLY rather than by comparing bytes:
 * comparing 500 encoded bodies costs the 27 ms of encoding this exists to
 * remove. `projectsAlikeForEverySeat` walks the tree once and answers from what
 * the tree DECLARES -- and the cases below hold that answer against actually
 * projecting two seats and comparing, which is the only thing that makes the
 * predicate worth trusting.
 */
describe("#408 -- when every seat's projection is the same projection", () => {
  /** Two seats' projections, held against what the predicate promised. */
  function agrees(game: Game): { predicted: boolean; observed: boolean } {
    const one = JSON.stringify(game.toJSONForPlayer(1));
    const two = JSON.stringify(game.toJSONForPlayer(2));
    return { predicted: game.projectsAlikeForEverySeat(), observed: one === two };
  }

  /** A public square with nothing declared about who may see it. */
  function newSquare(): PlazaGame {
    const game = new PlazaGame({ playerCount: SEATS, seed: 'square' });
    const square = game.create(Stall, 'square', { goods: 9 });
    square.create(Stall, 'baker', { goods: 3 });
    return game;
  }

  it("says so for a world that declares nothing about visibility", () => {
    // The case the whole thing is for: a room everybody is standing in, with
    // nothing hidden in it. Both halves are asserted, so a predicate that
    // simply returned `true` would still have to be right.
    const { predicted, observed } = agrees(newSquare());
    expect(observed, "two seats really do see the same square").toBe(true);
    expect(predicted).toBe(true);
  });

  it("says NO for one hidden element, and is right", () => {
    const game = newSquare();
    game.first(Stall, 'baker')!.showOnlyTo(1);
    const { predicted, observed } = agrees(game);
    expect(observed).toBe(false);
    expect(predicted).toBe(false);
  });

  it("says NO for a zone that names who may see its contents, and is right", () => {
    // The case that matters most, because it is how a world scopes a room and
    // it looks public: EVERY seat is granted, and every seat still gets
    // different bytes -- `redactVisibilityForSeat` collapses the roster to the
    // receiving seat, so the grant list is per-seat output.
    const game = newSquare();
    const square = game.first(Stall, 'square')!;
    square.addZoneVisibleTo(1, 2, 3, 4);
    const { predicted, observed } = agrees(game);
    expect(observed, "a granted roster is redacted to the seat reading it").toBe(false);
    expect(predicted).toBe(false);
  });

  it("says NO for a class that withholds attributes from non-owners, and is right", () => {
    class Strongbox extends Stall {
      static override visibleAttributes = ['name'];
    }
    const game = new PlazaGame({ playerCount: SEATS, seed: 'square' });
    game.registerElements([Strongbox]);
    const box = game.create(Strongbox, 'box', { goods: 4 });
    box.player = game.players[0];
    const { predicted, observed } = agrees(game);
    expect(observed).toBe(false);
    expect(predicted).toBe(false);
  });

  it("says NO for a game that rewrites its own player view", () => {
    // Author code handed the seat. Nothing the engine can read decides what it
    // does with it, so the answer is no whatever the tree looks like.
    class Rewriting extends PlazaGame {
      static override playerView = (state: ElementJSON, seat: number | null): ElementJSON => ({
        ...state,
        attributes: { ...state.attributes, lookedAt: seat },
      });
    }
    const game = new Rewriting({ playerCount: SEATS, seed: 'square' });
    game.create(Stall, 'square', { goods: 9 });
    const { predicted, observed } = agrees(game);
    expect(observed).toBe(false);
    expect(predicted).toBe(false);
  });

  it("says NO while an animation event is addressed to one seat", () => {
    const game = newSquare();
    game.pushAnimationEvent('whisper', { to: 'seat one' }, [1]);
    const { predicted, observed } = agrees(game);
    expect(observed).toBe(false);
    expect(predicted).toBe(false);
  });
});

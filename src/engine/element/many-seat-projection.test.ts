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
 * ShufflewickPub #408 second half, widened by #411: WHEN IS A PROJECTION THE
 * SAME FOR EVERYBODY?
 *
 * Sharing a serialization (above) removed the repeated pass. It did not make
 * two seats' answers EQUAL, and equal is what a host needs before it can encode
 * a fan-out once: a 500-seat announcement in a public room is 500 identical
 * views and was 500 separate `JSON.stringify` calls, 18.5 MB, because nothing
 * could say they were identical.
 *
 * #408 collapsed a plainly public plaza to one body. It left the SCOPED plaza
 * at one body per seat -- a room scoped with `addZoneVisibleTo` to everybody
 * standing in it, which is how most room-shaped worlds are built -- because the
 * redaction spelled the reader's own grant as `addPlayers: [yourSeat]`. #411
 * spells that same bit in the mode instead, so every seat holding the same
 * grant holds the same bytes and the scoped plaza collapses too.
 *
 * So the question is answered STRUCTURALLY rather than by comparing bytes:
 * comparing 500 encoded bodies costs the encoding this exists to remove.
 * `projectsAlikeFor` walks the tree once and answers from what the tree
 * DECLARES about the seats that are asking -- and the cases below hold that
 * answer against actually projecting those seats and comparing, which is the
 * only thing that makes the predicate worth trusting.
 */
describe("#408/#411 -- when every seat's projection is the same projection", () => {
  /** An audience's projections, held against what the predicate promised. */
  function agrees(
    game: PlazaGame,
    audience: readonly number[] = [1, 2],
  ): { predicted: boolean; observed: boolean } {
    const bodies = new Set(audience.map((seat) => JSON.stringify(game.toJSONForPlayer(seat))));
    return { predicted: game.projectsAlikeFor(audience), observed: bodies.size === 1 };
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

  it("says YES for a zone every seat in the audience may see into, and is right", () => {
    // THE CASE #411 IS FOR, and how a world scopes a room: every seat is
    // granted, and every seat now gets the SAME bytes, because the redaction
    // tells each of them that they may see rather than naming them.
    const game = newSquare();
    game.first(Stall, 'square')!.addZoneVisibleTo(...seatsOf(SEATS));
    const { predicted, observed } = agrees(game, seatsOf(SEATS));
    expect(observed, "a granted roster is redacted to a grant, not to a seat").toBe(true);
    expect(predicted).toBe(true);
  });

  it("says NO when one seat in the audience is outside the grant, and is right", () => {
    // The honest limit. A room scoped to SOME of the audience is per-seat
    // output, because the seats outside it are being told something different.
    const game = newSquare();
    game.first(Stall, 'square')!.contentsHidden();
    game.first(Stall, 'square')!.addZoneVisibleTo(1, 2);
    const { predicted, observed } = agrees(game, [1, 2, 3]);
    expect(observed).toBe(false);
    expect(predicted).toBe(false);
  });

  it("still shares nothing between the granted and the ungranted", () => {
    // The boundary, stated as its own case: the two groups above are two
    // bodies, and the granted one is the only one holding the contents.
    const game = newSquare();
    const square = game.first(Stall, 'square')!;
    square.contentsHidden();
    square.addZoneVisibleTo(1, 2);
    const inside = JSON.stringify(game.toJSONForPlayer(1));
    const outside = JSON.stringify(game.toJSONForPlayer(3));
    expect(inside).toBe(JSON.stringify(game.toJSONForPlayer(2)));
    expect(inside).not.toBe(outside);
    expect(inside.includes('baker')).toBe(true);
    expect(outside.includes('baker'), 'an ungranted seat sees no contents').toBe(false);
  });

  it("names no other seat in anybody's view of a scoped room", () => {
    // THE VISIBILITY BOUNDARY (F-09). A seat may learn that it is granted; it
    // may not learn who else is. Asserted over the whole projected body rather
    // than over the redaction helper, so a future path that emitted a roster
    // some other way would be caught here.
    const game = newSquare();
    const square = game.first(Stall, 'square')!;
    square.contentsHidden();
    square.addZoneVisibleTo(1, 2, 3);
    for (const seat of seatsOf(SEATS)) {
      const body = JSON.stringify(game.toJSONForPlayer(seat));
      expect(body.includes('addPlayers'), `seat ${seat}`).toBe(false);
      expect(body.includes('exceptPlayers'), `seat ${seat}`).toBe(false);
    }
    // ...while the FULL tree, which is what a checkpoint stores, still has it.
    expect(JSON.stringify(game.toJSON()).includes('addPlayers')).toBe(true);
  });

  it("collapses a scoped square from one body per seat to one body", () => {
    // THE MEASUREMENT, in the engine's own units: distinct encoded bodies is
    // exactly what decides how many times a host encodes a fan-out.
    const game = newSquare();
    game.first(Stall, 'square')!.contentsHidden();
    game.first(Stall, 'square')!.addZoneVisibleTo(...seatsOf(SEATS));
    const bodies = new Set(
      game.toJSONForPlayers(seatsOf(SEATS)).map((view) => JSON.stringify(view)),
    );
    expect(
      bodies.size,
      `${SEATS} seats granted the same room held ${bodies.size} distinct bodies.`,
    ).toBe(1);
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

  it("says NO for an owner-only zone, and is right", () => {
    // Ownership is not in the visibility state, so the redacted bytes match and
    // what the serializer does with them does not.
    const game = newSquare();
    const square = game.first(Stall, 'square')!;
    square.setZoneVisibility('owner');
    square.player = game.players[0];
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

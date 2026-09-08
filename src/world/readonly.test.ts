// #219: the read-only projection a declaration is handed, on its own.
//
// `world-engine-boardsmith.test.ts` proves the ENGINE hands one over and that
// a writing declaration is refused. This file is about the projection itself:
// what still reads, and what no longer writes. The two mutation vectors are
// separate and a fix that closed only the first would look complete here
// without one of these cases -- assignment is the obvious one, and a mutating
// METHOD writing through its own `this` is the one a `set` trap alone misses.
import { describe, expect, it } from "vitest";
import { Game, Piece, Player, Space } from "../engine/index.js";
import type { GameOptions } from "../engine/index.js";
import { readOnlyProjection } from "./readonly.js";
import { WorldRefusal } from "./refusals.js";

class Token extends Piece<ProjectionGame> {}
class Room extends Space<ProjectionGame> {
  visits = 0;
}
class ProjectionGame extends Game<ProjectionGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room, Token]);
  }
}

function world() {
  const game = new ProjectionGame({ playerCount: 2, seed: "projection", worldMode: true });
  const here = game.create(Room, "here");
  here.create(Token, "token-one");
  const there = game.create(Room, "there");
  return { game, here, there };
}

describe("readOnlyProjection", () => {
  it("reads attributes, children and finders exactly as the live element does", () => {
    // The whole point of #122's second round is that a declaration can READ
    // resident state. A projection that broke a read would close the hole by
    // deleting the feature.
    const { here } = world();
    here.visits = 7;
    const projection = readOnlyProjection(here);

    expect(projection.visits).toBe(7);
    expect(projection.name).toBe("here");
    expect(projection.first(Token)?.name).toBe("token-one");
    expect(projection.all(Token)).toHaveLength(1);
  });

  it("answers the SAME projection for the same element, so a declaration can compare", () => {
    const { here } = world();
    expect(readOnlyProjection(here)).toBe(readOnlyProjection(here));
  });

  it("REFUSES an attribute write, which is the shape the issue is about", () => {
    const { here } = world();
    const projection = readOnlyProjection(here);

    expect(() => {
      projection.visits = 5;
    }).toThrow(WorldRefusal);
    expect(here.visits).toBe(0);
  });

  it("REFUSES a write through a child the projection handed back", () => {
    // The projection is deep or it is nothing: an element reached by reading
    // is as live as the root, and a shallow wrapper would move the hole one
    // property along.
    const { here } = world();
    const token = readOnlyProjection(here).first(Token)!;

    expect(() => {
      (token as unknown as { name: string }).name = "renamed";
    }).toThrow(WorldRefusal);
    expect(here.first(Token)!.name).toBe("token-one");
  });

  it("REFUSES a mutating METHOD, which a set trap alone would not", () => {
    // `putInto` writes through its own `this`, so blocking assignment would
    // have left a declaration able to move an element between partitions --
    // the most expensive write there is, since it dirties two.
    const { here, there } = world();
    const token = readOnlyProjection(here).first(Token)!;

    expect(() => token.putInto(there)).toThrow(WorldRefusal);
    expect(here.all(Token)).toHaveLength(1);
    expect(there.all(Token)).toHaveLength(0);
  });

  it("names run() in the refusal, because that is where the write belongs", () => {
    const { here } = world();
    try {
      readOnlyProjection(here).visits = 1;
      expect.unreachable("the projection accepted a write");
    } catch (error) {
      expect(error).toBeInstanceOf(WorldRefusal);
      expect((error as WorldRefusal).code).toBe("declaration-write");
      expect((error as WorldRefusal).message).toContain("run()");
    }
  });

  it("answers the SAME projection for an element reached THROUGH a method", () => {
    // #374: the identity guarantee above only held for a direct call. A method
    // runs with the projection as its receiver, so what it returns was already
    // projected -- and the `get` trap projected it a SECOND time, handing back
    // a wrapper that compares unequal to the same element's own projection.
    // A declaration comparing "the token I found" against "the token in this
    // room" got false from two reads of one element.
    const { here } = world();
    const throughMethod = readOnlyProjection(here).first(Token)!;
    const direct = readOnlyProjection(here.first(Token)!);

    expect(throughMethod).toBe(direct);
  });

  it("is IDEMPOTENT: projecting a projection answers that same projection", () => {
    // #374: `projections` maps original -> wrapper, and nothing recognised a
    // value that already IS a wrapper. So every layer of re-wrapping added a
    // trap hop to every subsequent read, which is what made a 500-root finder
    // cost seconds. A projection is already read-only; wrapping it again buys
    // no enforcement and charges for the privilege.
    const { here } = world();
    const projection = readOnlyProjection(here);

    expect(readOnlyProjection(projection)).toBe(projection);
  });

  it("answers the SAME wrapper for repeated reads of one method", () => {
    // #374: each read of a function property built a fresh closure. A tree walk
    // reads `first`/`all`/`children` once per element visited, so the garbage
    // was proportional to the tree and not to the question being asked.
    const { here } = world();
    const projection = readOnlyProjection(here);

    expect(projection.first).toBe(projection.first);
  });

  it("mints ONE projection per element however deeply it is reached", () => {
    // #374 as an invariant rather than a stopwatch. The re-wrapping this closes
    // was visible as cost -- a finder over 500 roots took seconds -- but the
    // cost was a symptom: each layer of wrapping added a trap hop to every
    // later read. What the layers actually broke is identity, and identity is
    // the thing a test can pin without a clock. Two methods deep, through a
    // tree big enough that the walk is real, the projection must still be the
    // one projection that element has.
    const game = new ProjectionGame({ playerCount: 2, seed: "depth", worldMode: true });
    for (let i = 0; i < 500; i += 1) {
      game.create(Room, `room-${i}`).create(Token, `token-${i}`);
    }
    const liveRoom = game.first(Room, "room-499")!;

    const room = readOnlyProjection(game).first(Room, "room-499")!;
    const token = room.first(Token)!;

    expect(room).toBe(readOnlyProjection(liveRoom));
    expect(token).toBe(readOnlyProjection(liveRoom.first(Token)!));
  });
});

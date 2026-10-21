// #219: the read-only projection a declaration is handed, on its own.
//
// `world-engine-boardsmith.test.ts` proves the ENGINE hands one over and that
// a writing declaration is refused. This file is about the projection itself:
// what still reads, and what no longer writes. The two mutation vectors are
// separate and a fix that closed only the first would look complete here
// without one of these cases -- assignment is the obvious one, and a mutating
// METHOD writing through its own `this` is the one a `set` trap alone misses.
import { describe, expect, it } from "vitest";
import { Game, PersistentMap, Piece, Player, Space } from "../engine/index.js";
import type { GameOptions } from "../engine/index.js";
import { readOnlyProjection } from "./readonly.js";
import { WorldRefusal } from "./refusals.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

class Token extends Piece<ProjectionGame> {}
class Room extends Space<ProjectionGame> {
  visits = 0;
  tags: string[] = [];
}
class ProjectionGame extends Game<ProjectionGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room, Token]);
  }
}

function world() {
  const game = new ProjectionGame({ playerCount: 2, seed: "projection", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
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

  it("refuses a write through a property descriptor's value, as it refuses the direct write (#800)", () => {
    const { here } = world();
    here.tags = ["calm"];
    const projection = readOnlyProjection(here);

    const held = Object.getOwnPropertyDescriptor(projection, "tags")?.value as string[];
    expect(() => held.push("leaked")).toThrow(WorldRefusal);
    expect(here.tags).toEqual(["calm"]);
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

  it("hands a finder's own PREDICATE a read-only element", () => {
    // The engine's finders are answered against the live tree, so the elements
    // a `(element) => boolean` finder is handed come from the live tree too.
    // A predicate is bundle code on the offer path, which is the one path with
    // no rollback and no checkpoint, so it must reach the same refusal every
    // other read on that path reaches.
    const { game } = world();
    const projection = readOnlyProjection(game);

    expect(() =>
      projection.all(Room, (room: Room) => {
        room.visits = 1;
        return true;
      }),
    ).toThrow(WorldRefusal);
    expect(game.first(Room, "here")!.visits).toBe(0);
  });

  it("answers a finder given a PROJECTED element exactly as a live one does", () => {
    // A declaration reads an element out of the projection and hands it
    // straight back to another read -- `contains`, `indexOfElement`, a finder
    // keyed on a player. Both sides have to be talking about the same object,
    // or a projection would quietly answer "no" to a question the live tree
    // answers "yes".
    const { game, here } = world();
    const projection = readOnlyProjection(game);
    const token = projection.first(Token)!;

    expect(projection.all(Token).contains(token)).toBe(true);
    expect(here.all(Token).contains(token)).toBe(true);
  });

  it("charges ONE trap per ANSWER, not one per step of the walk", () => {
    // ShufflewickPub #409. A world's OFFER runs every action's condition, its
    // greying rule and every selection's candidate callback for one seat, and
    // a world-scoped change runs that for every seat at once. All of it reads
    // through this projection, so a projection that charges a multiple of the
    // live tree charges it once per seat: measured at 500 seats, an offer
    // fan-out cost 2277 ms against a view fan-out's 208 ms, and 95% of the
    // difference was here rather than in anything an offer decides.
    //
    // A COUNT AND NOT A CLOCK (#281). The claim is "a read the engine owns runs
    // on the REAL element and only its ANSWER is projected", and that is a
    // number of proxy traps, not a duration. The ratio of two wall-clock walks
    // that stood here could only fail in one direction for a reason that had
    // nothing to do with this module: a contended machine inflates the
    // projected walk more than the live one, because it allocates more, so a
    // busy box turned correct code red.
    //
    // The subject is the collection the finder walks, wrapped in a counter that
    // tallies only the reads reaching it FROM SOMEWHERE ELSE -- a read whose
    // receiver is the collection itself is the finder's own body running on the
    // real object, which is the thing being asserted, and a read whose receiver
    // is the projection is a trap the walk paid. With the read doors of #409 in
    // place that is one trap per finder call, for the method itself; take them
    // away and every element the walk visits costs two more.
    const game = new ProjectionGame({ playerCount: 2, seed: "cost", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
    for (let i = 0; i < 500; i += 1) game.create(Room, `room-${i}`);
    const rooms = game.all(Room);
    const ROUNDS = 200;

    let traps = 0;
    const counted: typeof rooms = new Proxy(rooms, {
      get(target, property, receiver) {
        if (receiver !== counted) traps += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const projection = readOnlyProjection(counted);
    for (let round = 0; round < ROUNDS; round += 1) {
      expect(projection.first(Room, `room-${round % 500}`)?.name).toBe(`room-${round % 500}`);
    }

    expect(
      traps,
      `A finder called ${ROUNDS} times over a 500-element collection cost ${traps} proxy traps. ` +
        "A read the engine owns runs on the real element and only its ANSWER is projected, so " +
        "the bill is one trap per call for the method itself. A bill that scales with the " +
        "COLLECTION means the method body is running with the projection as its receiver and " +
        "every step of the walk is paying a trap.",
    ).toBeLessThanOrEqual(ROUNDS * 4);
  });

  it("mints ONE projection per element however deeply it is reached", () => {
    // #374 as an invariant rather than a stopwatch. The re-wrapping this closes
    // was visible as cost -- a finder over 500 roots took seconds -- but the
    // cost was a symptom: each layer of wrapping added a trap hop to every
    // later read. What the layers actually broke is identity, and identity is
    // the thing a test can pin without a clock. Two methods deep, through a
    // tree big enough that the walk is real, the projection must still be the
    // one projection that element has.
    const game = new ProjectionGame({ playerCount: 2, seed: "depth", worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
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

// #247: A FROZEN VALUE IS STILL A VALUE A DECLARATION MAY READ.
//
// A `.needs()` callback is ordinary game code, and game code that hands a
// cached snapshot around freezes it so nothing downstream can edit the cache.
// That freeze made the value UNREADABLE through this projection: a JavaScript
// proxy must hand back the exact value held in a non-writable, non-configurable
// data property, and a projection is by definition not that value, so the read
// died in the engine with a TypeError about proxy invariants and no declaration
// ran at all.
//
// The fix cannot be "games stop freezing" -- that trades their immutability for
// ours -- and it cannot be "hand the raw value over", because a frozen object
// is free to point AT a live mutable one and that road ends in the #219 hole.
describe("readOnlyProjection over frozen values (#247)", () => {
  it("reads a nested object off a frozen value a callback returned", () => {
    // The reported shape, reduced: a stored array is read through the
    // projection, its `flatMap` answers a detached deeply frozen row, and the
    // read that threw is one property deeper than the row.
    const detached = Object.freeze({ id: "body-1", holding: Object.freeze({ owner: "seat-1" }) });
    const stored = { planets: [{ id: "body-1" }] };

    const rows = readOnlyProjection(stored).planets.flatMap(() => [detached]);

    expect(rows[0]!.holding.owner).toBe("seat-1");
  });

  it("reads through a FROZEN ARRAY, whose every index is locked the same way", () => {
    // `Object.freeze` on an array locks each index, so the invariant bites on
    // "0" rather than on a named property. Length and iteration have to keep
    // working too, or the value is readable only one element at a time.
    const rows = Object.freeze([Object.freeze({ owner: "seat-1" }), Object.freeze({ owner: "s2" })]);
    const stored = { rows };

    const projected = readOnlyProjection(stored).rows;

    expect(projected).toHaveLength(2);
    expect(projected[0]!.owner).toBe("seat-1");
    expect(projected.map((row) => row.owner)).toEqual(["seat-1", "s2"]);
    expect(Object.keys(projected[1]!)).toEqual(["owner"]);
  });

  it("reads a property locked on its own, without the whole object being frozen", () => {
    // `defineProperty` with the defaults locks one slot and leaves the object
    // extensible, so an object that is not frozen can still carry the property
    // the invariant is about.
    const stored: Record<string, unknown> = { open: 1 };
    Object.defineProperty(stored, "locked", { value: { owner: "seat-1" }, enumerable: true });

    const projection = readOnlyProjection(stored);

    expect((projection.locked as { owner: string }).owner).toBe("seat-1");
    expect(projection.open).toBe(1);
  });

  it("still REFUSES a write to the MUTABLE object a frozen value points at", () => {
    // The reason the raw value cannot simply be handed over. `holding` is
    // frozen INTO the snapshot, but the object it names is the live one, so a
    // read that answered with it would hand a declaration a write it could not
    // be told about -- #219 one property along.
    const live = { owner: "seat-1" };
    const snapshot = Object.freeze({ holding: live });

    const projected = readOnlyProjection({ snapshot }).snapshot;

    expect(projected.holding.owner).toBe("seat-1");
    expect(() => {
      projected.holding.owner = "seat-2";
    }).toThrow(WorldRefusal);
    expect(live.owner).toBe("seat-1");
  });

  it("still REFUSES a write to a stored object read alongside a frozen one", () => {
    // The stored tree is not frozen and must not become writable because some
    // value beside it was: one object, one frozen property and one live one,
    // read through the same projection.
    const stored = { snapshot: Object.freeze({ id: "body-1" }), ledger: { owner: "seat-1" } };
    const projection = readOnlyProjection(stored);

    expect(projection.snapshot.id).toBe("body-1");
    expect(() => {
      projection.ledger.owner = "seat-2";
    }).toThrow(WorldRefusal);
    expect(() => {
      projection.ledger = { owner: "seat-2" };
    }).toThrow(WorldRefusal);
    expect(stored.ledger.owner).toBe("seat-1");
  });

  it("mints ONE projection for a frozen value, as it does for a live element", () => {
    // Identity is what a declaration compares with, and it cannot depend on
    // whether the value it is holding happens to be frozen.
    const frozen = Object.freeze({ holding: Object.freeze({ owner: "seat-1" }) });

    expect(readOnlyProjection(frozen)).toBe(readOnlyProjection(frozen));
    expect(readOnlyProjection(frozen).holding).toBe(readOnlyProjection(frozen.holding));
  });
});

// #285: a class read off a projection is code, not world state. It was being
// wrapped like a method, so `element.constructor` came back as an anonymous
// function with no name and no statics, and a finder handed it treated it as a
// predicate instead of a class. A declaration then answered differently from
// the same code in `execute`, and nothing said so.
describe("readOnlyProjection over classes (#285)", () => {
  it("answers an element's constructor as its own class", () => {
    const { here } = world();
    const projection = readOnlyProjection(here);

    expect(projection.constructor).toBe(Room);
    expect(projection.constructor.name).toBe("Room");
    expect((projection.constructor as typeof Room).isGameElement).toBe(true);
  });

  it("lets a finder handed that constructor find by class", () => {
    const { game } = world();
    const projection = readOnlyProjection(game);
    const token = projection.first(Token)!;

    const found = projection.first(token.constructor as typeof Token, "token-one");
    expect(found).toBe(token);
    expect(projection.all(token.constructor as typeof Token)).toHaveLength(1);
  });

  it("answers a class held as a plain value as that class", () => {
    const projection = readOnlyProjection({ kind: Token });

    expect(projection.kind).toBe(Token);
  });

  it("still wraps a method, so a mutating one is still refused", () => {
    const { here, there } = world();
    const token = readOnlyProjection(here).first(Token)!;

    expect(token.putInto).not.toBe(Token.prototype.putInto);
    expect(() => token.putInto(there)).toThrow(WorldRefusal);
    expect(here.first(Token)).toBeDefined();
  });
});

describe("readOnlyProjection over built-in objects (#1171)", () => {
  it("REFUSES every TypedArray write method, and the array is unchanged", () => {
    const live = new Uint8Array([3, 1, 2]);
    const projection = readOnlyProjection(live);

    for (const [name, write] of [
      ["fill", () => projection.fill(0)],
      ["copyWithin", () => projection.copyWithin(0, 1)],
      ["reverse", () => projection.reverse()],
      ["sort", () => projection.sort()],
      ["set", () => projection.set([9])],
    ] as const) {
      expect(write).toThrow(`cannot call "${name}" on a Uint8Array: it is not one of the built-in reads a world callback may call`);
    }
    expect([...live]).toEqual([3, 1, 2]);
  });

  it("REFUSES a Map method it does not know to be a read, such as a future getOrInsert", () => {
    const prototype = Map.prototype as unknown as Record<string, unknown>;
    const shipped = Object.hasOwn(prototype, "getOrInsert");
    if (!shipped) {
      // Stands in for the TC39 method until the runtime ships it: it inserts when the key is missing.
      prototype.getOrInsert = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      };
    }
    try {
      const live = new Map<string, number>();
      const projection = readOnlyProjection(live) as unknown as { getOrInsert(key: string, value: number): number };

      expect(() => projection.getOrInsert("gold", 5)).toThrow(/cannot call "getOrInsert" on a Map: it is not one of the built-in reads.*move it into the command's run\(\)/);
      expect(live.size).toBe(0);
    } finally {
      if (!shipped) delete prototype.getOrInsert;
    }
  });

  it("still answers every Map and Set read", () => {
    const map = readOnlyProjection(new Map([["a", 1], ["b", 2]]));
    const set = readOnlyProjection(new Set(["x", "y"]));
    const seen: string[] = [];
    map.forEach((value, key) => seen.push(`${key}=${value}`));
    set.forEach((value) => seen.push(value));

    expect([map.get("a"), map.has("b"), map.size, [...map.keys()], [...map.values()]]).toEqual([1, true, 2, ["a", "b"], [1, 2]]);
    expect([...map.entries()].map(([key, value]) => `${key}${value}`)).toEqual(["a1", "b2"]);
    expect([...map].map(([key]) => key)).toEqual(["a", "b"]);
    expect([set.has("x"), set.size, [...set], [...set.values()], [...set.keys()]]).toEqual([true, 2, ["x", "y"], ["x", "y"], ["x", "y"]]);
    expect(seen).toEqual(["a=1", "b=2", "x", "y"]);
    expect(String(map)).toBe("[object Map]");
  });

  it("still answers WeakMap, WeakSet and Date reads", () => {
    const key = {};
    const weakMap = readOnlyProjection(new WeakMap([[key, "held"]]));
    const weakSet = readOnlyProjection(new WeakSet([key]));
    const date = readOnlyProjection(new Date(0));

    expect([weakMap.get(key), weakMap.has(key), weakSet.has(key)]).toEqual(["held", true, true]);
    expect([date.getTime(), date.toISOString(), date.getUTCFullYear(), JSON.stringify(date), +date]).toEqual([
      0, "1970-01-01T00:00:00.000Z", 1970, '"1970-01-01T00:00:00.000Z"', 0,
    ]);
    expect(() => date.setTime(5)).toThrow(/cannot call "setTime" on a Date/);
  });

  it("REFUSES a subclass's own get, which runs on the real Map and could write", () => {
    class Tally extends Map<string, number> {
      override get(key: string) {
        if (!this.has(key)) this.set(key, 0);
        return super.get(key);
      }
    }
    const live = new Tally();

    expect(() => readOnlyProjection(live).get("gold")).toThrow(/cannot call "get" on a Map/);
    expect(live.size).toBe(0);
  });

  it("REFUSES a getter it does not list with the same readable refusal, not a runtime TypeError", () => {
    const projection = readOnlyProjection(new Uint8Array(2));

    expect(() => projection.buffer).toThrow(/cannot call "buffer" on a Uint8Array/);
  });

  it("still answers a PersistentMap's reads", () => {
    const { game } = world();
    const live = new PersistentMap<string, number>(game, "scores");
    live.set("north", 3);
    const projection = readOnlyProjection(live);

    expect([projection.size, projection.get("north"), [...projection.entries()], [...projection]]).toEqual([
      1, 3, [["north", 3]], [["north", 3]],
    ]);
    expect(() => projection.set("south", 1)).toThrow(/cannot call "set" on a PersistentMap/);
  });

  it("still answers every TypedArray read", () => {
    const array = readOnlyProjection(new Int16Array([3, 1, 2]));

    expect([array.length, array[0], array.at(-1), array.indexOf(1), array.includes(2), array.join("-")]).toEqual([3, 3, 2, 1, true, "3-1-2"]);
    expect([[...array], [...array.slice(1)], [...array.map((value) => value * 2)], array.reduce((sum, value) => sum + value, 0)]).toEqual([
      [3, 1, 2], [1, 2], [6, 2, 4], 6,
    ]);
  });
});

describe("readOnlyProjection over arrays a standard method builds (#1327)", () => {
  it("answers filter, map, slice, concat, flat, flatMap, toSorted, toReversed, toSpliced and with as the caller's own plain array", () => {
    const projection = readOnlyProjection({ a: [3, 1, 2], nested: [[1], [2]] });
    // This repo's tsconfig lib predates ES2023, though the runtime has these methods.
    const es2023 = projection.a as unknown as Record<"toSorted" | "toReversed" | "toSpliced" | "with", (...args: number[]) => number[]>;
    const built = [
      projection.a.filter((value) => value > 1),
      projection.a.map((value) => value * 2),
      projection.a.slice(1),
      projection.a.concat([4]),
      projection.nested.flat(),
      projection.a.flatMap((value) => [value]),
      es2023.toSorted(),
      es2023.toReversed(),
      es2023.toSpliced(0, 1),
      es2023.with(0, 9),
    ];

    expect(built.map((array) => structuredClone(array))).toEqual([
      [3, 2], [6, 2, 4], [1, 2], [3, 1, 2, 4], [1, 2], [3, 1, 2], [1, 2, 3], [2, 1, 3], [1, 2], [9, 1, 2],
    ]);
    built[0].push(7);
    expect(built[0]).toEqual([3, 2, 7]);
  });

  it("still answers what a built array holds read-only, so a write cannot reach the world through it", () => {
    const { here } = world();
    here.tags = ["calm"];
    const projection = readOnlyProjection({ rooms: [here] });

    const [room] = projection.rooms.filter(() => true);
    expect(() => room.tags.push("leaked")).toThrow(WorldRefusal);
    expect(here.tags).toEqual(["calm"]);
  });

  it("still refuses structuredClone of a built array whose elements are objects, since they stay projections (#1337)", () => {
    const projection = readOnlyProjection({ a: [{ n: 1 }] });

    expect(() => structuredClone(projection.a.filter(() => true))).toThrow(DOMException);
    expect(structuredClone(projection.a.map((item) => ({ ...item })))).toEqual([{ n: 1 }]);
  });

  it("answers an ElementCollection's own filter and slice as the caller's, as its inherited map is", () => {
    const { game, here } = world();
    const rooms = readOnlyProjection(game).all(Room);

    const built = [rooms.filter(() => true), rooms.slice(0), rooms.map((room) => room)];
    for (const array of built) array.push(readOnlyProjection(here));
    expect(built.map((array) => array.length)).toEqual([3, 3, 3]);
    expect(() => built[0][0].tags.push("leaked")).toThrow(WorldRefusal);
  });
});

// The conformance suite, run against the REAL engine (#35 item 2).
//
// `world-engine-contract.test.ts` proves the suite can pass; this proves
// BoardSmith passes it. The two are not interchangeable and neither replaces
// the other: the reference engine is a Map of counters, and the only thing it
// can tell you is that the assertions are satisfiable.
//
// The fixture world below is the smallest one that makes each cost claim
// MEASURABLE rather than merely typed:
//
//   Two partitions, so "only what was asked for" is a distinguishable claim.
//   A `touch` that names ONE of them and a `touchAll` that names both, so the
//     scaling case has something to compare.
//   Nothing resident at construction: every partition is adopted from the
//     store, which is what a Durable Object waking on a cold world does.
//
// The world is built ONCE, by a genesis game, and then only ever reached
// through serialized bytes -- the engine under test never sees the tree that
// produced them. A fixture that handed the engine live objects would prove
// adoption worked without ever running it (docs/TEST-FIXTURES.md).
import { describe, expect, it } from "vitest";
import { Game, Piece, Player, Space } from "../engine/index.js";
import type { ElementJSON, GameOptions } from "../engine/index.js";
import { assertWorldEngineConformance } from "./engine-conformance.test-helper.js";
import {
  BoardSmithWorldEngine,
  type WorldCommandTable,
} from "./engine.js";
import type { StoredPartition, WorldPartitionSource } from "./contract.js";

class Token extends Piece<WorldFixtureGame> {}

class Room extends Space<WorldFixtureGame> {
  /** Written by `touch`, so a checkpoint of this room actually changes. */
  visits = 0;

  /**
   * How many times any room has been serialized, for the per-command cost
   * case below. A count, not a clock: a millisecond assertion on a shared
   * machine is noise, and the defect (#316) was a MULTIPLE, which counts.
   */
  static serializations = 0;

  override toJSON(): ElementJSON {
    Room.serializations += 1;
    return super.toJSON();
  }
}

class WorldFixtureGame extends Game<WorldFixtureGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Registered in the class constructor, not the Game constructor: world
    // mode has no handler re-bind pass on adoption, so anything a grafted
    // element needs must come from its own class.
    this.registerElements([Room, Token]);
  }
}

/** A stamped arrival instant, for the cases that do not care which one it is.
 *  The platform stamps every command with one (#57); a test that omitted it
 *  would be testing a road no command travels. */
const STAMP = {
  now: 1_700_000_000_000,
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  // Nobody connected: the platform's presence stamp is derived from attached
  // sockets, and this suite attaches none (#144).
  presence: [],
};

const ROOM_ONE = "room:1";
const ROOM_TWO = "room:2";

/** A cold-storage round trip, which is what the engine will really be fed. */
function throughStorage(json: ElementJSON): ElementJSON {
  return JSON.parse(JSON.stringify(json)) as ElementJSON;
}

/**
 * Build the world once and keep only its bytes.
 *
 * Genesis is the platform's job, not the engine's: the engine adopts what the
 * store holds, so a world is created by writing partitions and then waking an
 * engine over them.
 */
function genesis(): Map<string, StoredPartition> {
  const game = newWorldGame();
  const roomOne = game.create(Room, "room-one");
  roomOne.create(Token, "token-one");
  const roomTwo = game.create(Room, "room-two");
  roomTwo.create(Token, "token-two");

  return new Map<string, StoredPartition>([
    [ROOM_ONE, { parentId: game.id, json: throughStorage(roomOne.toJSON()) }],
    [ROOM_TWO, { parentId: game.id, json: throughStorage(roomTwo.toJSON()) }],
  ]);
}

function newWorldGame(): WorldFixtureGame {
  const game = new WorldFixtureGame({ playerCount: 2, seed: "world-fixture", worldMode: true });
  return game;
}

/** Counts every read, so "loaded once, then resident" is measurable. */
class CountingStore implements WorldPartitionSource {
  readonly reads: string[] = [];
  constructor(private readonly stored: Map<string, StoredPartition>) {}
  async read(name: string): Promise<StoredPartition | undefined> {
    this.reads.push(name);
    return this.stored.get(name);
  }
  /** A cold store re-reads a forgotten partition from its own bytes, which is
   *  what the parent's storage does too. Nothing to drop; the READ COUNT is
   *  the point, and a re-read after an eviction is a real one. */
  forget(): void {}
}

const COMMANDS: WorldCommandTable = {
  // Names ONE partition. The whole model is that this costs one room.
  touch: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition, seat }) => {
      const room = partition(ROOM_ONE) as Room;
      room.visits += 1;
      return [{ scope: ROOM_ONE, payload: { by: seat, visits: room.visits } }];
    },
  },
  // Names both, so the suite has something strictly larger to compare against.
  touchAll: {
    args: [],
    partitions: () => [ROOM_ONE, ROOM_TWO],
    run: ({ partition, seat }) =>
      [ROOM_ONE, ROOM_TWO].map((name) => {
        const room = partition(name) as Room;
        room.visits += 1;
        return { scope: name, payload: { by: seat, visits: room.visits } };
      }),
  },
  // Names NOTHING and changes nothing durable: a scheduled beat whose output
  // is a function of its scheduled `due` alone.
  tick: {
    args: [],
    partitions: () => [],
    run: ({ timing }) => [
      { scope: "world", payload: { at: timing?.due, folded: timing?.missedCount } },
    ],
  },
  // A SCHEDULED beat that does touch a partition: the catch-up path integrates
  // the missed occurrences instead of asking the platform to replay them.
  decay: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition, timing }) => {
      const room = partition(ROOM_ONE) as Room;
      room.visits += 1 + (timing?.missedCount ?? 0);
      return [{ scope: ROOM_ONE, payload: { at: timing?.due, visits: room.visits } }];
    },
  },
  // DECLARES THE SEASON OVER. The one ending a game may name, and it names it
  // by calling a no-argument hook rather than returning a string -- see
  // `WorldCommandContext.complete`.
  finish: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition, complete }) => {
      complete();
      return [{ scope: ROOM_ONE, payload: { over: true } }];
    },
  },
  // Reports the clock the PLATFORM handed it, beside whatever the caller put
  // in `args` -- so a test can see which of the two reached the handler (#57).
  stamp: {
    args: [],
    partitions: () => [],
    run: ({ now, args }) => [{ scope: "world", payload: { now, claimed: args.now } }],
  },
  // Reads the platform's presence stamp (#144): which seats are connected,
  // as a handler sees it -- a Set, asked by membership.
  who: {
    args: [],
    partitions: () => [],
    run: ({ presence }) => [
      { scope: "world", payload: { online: [...presence].sort((a, b) => a - b) } },
    ],
  },
  // MUTATES, THEN THROWS. The shape #68 is about: the platform expects
  // handlers to throw -- it quarantines them -- and a handler that debits and
  // then fails must not leave the debit behind a `refused` answer.
  tearRoom: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      room.visits += 100;
      throw new Error("this handler fails halfway, deliberately");
    },
  },
  // The same, but it first throws a token into a room it never declared -- so
  // the torn state is spread across a partition no snapshot could cover. The
  // context no longer hands over the game (#152), so the undeclared room is
  // reached the one way left: walking up from a declared root. The engine's
  // re-parent tracking catches the move whichever way the room was found.
  tearAcross: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      const token = room.first(Token);
      const destination = room.game.first(Room, "room-two");
      if (!token || !destination) throw new Error("tearAcross needs both rooms resident");
      token.putInto(destination);
      throw new Error("this handler fails after moving something, deliberately");
    },
  },
  // WRITES FROM ITS OWN DECLARATION (#219). `partitions` runs before the
  // rollback snapshot is taken, so a write here used to be captured INTO the
  // snapshot and survive the refusal the player was told discarded it.
  declareAndWrite: {
    args: [],
    partitions: (_args, _seat, world) => {
      const room = world.partition(ROOM_ONE) as Room | undefined;
      if (room) room.visits = 500;
      return [ROOM_ONE];
    },
    run: () => [],
  },
  // TAKES SOMETHING OUT OF EVERY PARTITION, and then throws (#294).
  // `remove()` parks the token in the game's PILE, which is not a partition:
  // nothing marks it touched, nothing names it, and nothing evicts it -- and
  // `adoptSubtree` looks for an id clash in the pile as well as in the tree.
  tearRemove: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      const token = room.first(Token);
      if (!token) throw new Error("tearRemove needs a token in room-one");
      token.remove();
      throw new Error("this handler fails after removing something, deliberately");
    },
  },
  // MOVES BETWEEN TWO DECLARED PARTITIONS, and then throws (#189). Both
  // endpoints are declared, so the collateral pass drops neither and the
  // rollback has to restore two snapshots whose ids overlap: old room:1 holds
  // the token that is, at restore time, still live inside room:2.
  tearBetween: {
    args: [],
    partitions: () => [ROOM_ONE, ROOM_TWO],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      const destination = partition(ROOM_TWO) as Room;
      const token = room.first(Token);
      if (!token) throw new Error("tearBetween needs a token in room-one");
      token.putInto(destination);
      throw new Error("this handler fails after a declared-to-declared move, deliberately");
    },
  },
  // NAMES ONE PARTITION TWICE, and then throws (#263). A command whose
  // declaration is "the actor's own land, and the land the arguments chose"
  // names one partition when a settler aims at themselves -- nothing the
  // author did wrong, and the shape `partitions(args, seat)` exists to make
  // writable. The rollback then holds two snapshots of the same subtree.
  tearOwn: {
    args: [],
    partitions: () => [ROOM_ONE, ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      room.visits += 100;
      throw new Error("this handler refuses in the game's own words, deliberately");
    },
  },
  // MUTATES, RETURNS, and only then fails: the event names a scope that is
  // neither "world" nor a partition. The #151 shape -- the handler SUCCEEDED,
  // so the #68 catch around `run` alone would never see the refusal.
  misroute: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      room.visits += 100;
      return [{ scope: "tavern:9", payload: { typo: true } }];
    },
  },
  // MUTATES, RETURNS, and fails the OTHER post-run check: it moves a token
  // into a partition root the engine never loaded and cannot name, so
  // dirty-set resolution refuses after the handler already succeeded (#151).
  strand: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      const rogue = room.game.create(Room, "rogue-room");
      room.game.definePartition(rogue.id);
      const token = room.first(Token);
      if (!token) throw new Error("strand needs a token in room-one");
      token.putInto(rogue);
      return [];
    },
  },
  // Names ONE partition and writes an ATTRIBUTE in another, reached by walking
  // up from the declared root and querying (#173, #295). Nothing re-parents,
  // so `moveToInternal` never sees it: the only thing that can report this is
  // the serialized-form comparison -- and the comparison only runs over
  // room-two because the query that produced it is a door the engine marks.
  reachAndWrite: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      const other = room.game.first(Room, "room-two");
      if (!other) {
        throw new Error("reachAndWrite needs a resident room-two; run touchAll first.");
      }
      other.visits += 7;
      return [{ scope: ROOM_ONE, payload: { wrote: other.visits } }];
    },
  },
  // Names ONE partition and moves a token OUT of it, into a room it never
  // declared. This is the half of the dirty set only the engine can supply.
  throwToken: {
    args: [],
    partitions: () => [ROOM_ONE],
    run: ({ partition }) => {
      const room = partition(ROOM_ONE) as Room;
      const token = room.first(Token);
      const destination = room.game.first(Room, "room-two");
      if (!token || !destination) {
        throw new Error(
          "throwToken needs a token in room-one and a resident room-two; " +
            "run touchAll first so both rooms are in the tree.",
        );
      }
      token.putInto(destination);
      return [{ scope: ROOM_TWO, payload: { landed: token.name } }];
    },
  },
};

function newEngine(store: WorldPartitionSource = new CountingStore(genesis())) {
  return new BoardSmithWorldEngine({
    game: newWorldGame(),
    seats: new Map([
      ["player-a", 1],
      ["player-b", 2],
    ]),
    store,
    commands: COMMANDS,
    // WHAT A LOOK IS ABOUT (#95). Both rooms, so the conformance suite's views
    // are of a world that is actually there rather than of a bare root.
    view: () => [ROOM_ONE, ROOM_TWO],
  });
}

/**
 * An engine holding the tree a bundle's `genesis` hook BUILT (#294).
 *
 * The other half of a world's life, and the half a store-fed fixture can never
 * reach: on its FIRST instance a world's partitions were created in the live
 * game and handed to the engine by `registerResident`, never adopted from
 * bytes. Everything the engine knows about a move across partitions comes from
 * the game's own partition roots, so a fixture that only ever adopts proves
 * nothing about the instance that ran genesis -- which is every world's first
 * hours.
 *
 * Its store holds NOTHING, because nothing here ever came from one.
 */
function genesisEngine(): BoardSmithWorldEngine {
  const game = newWorldGame();
  const roomOne = game.create(Room, "room-one");
  roomOne.create(Token, "token-one");
  const roomTwo = game.create(Room, "room-two");
  roomTwo.create(Token, "token-two");

  const engine = new BoardSmithWorldEngine({
    game,
    seats: new Map([
      ["player-a", 1],
      ["player-b", 2],
    ]),
    store: new CountingStore(new Map()),
    commands: COMMANDS,
    view: () => [ROOM_ONE, ROOM_TWO],
  });
  engine.registerResident(ROOM_ONE, roomOne);
  engine.registerResident(ROOM_TWO, roomTwo);
  return engine;
}

describe("WorldEngine conformance — BoardSmith world mode", () => {
  assertWorldEngineConformance(() => newEngine());
});

describe("BoardSmithWorldEngine — the properties the suite cannot see", () => {
  it("refuses a game that is still in snapshot mode", () => {
    const game = new WorldFixtureGame({ playerCount: 2, seed: "snapshot" });

    expect(() =>
      new BoardSmithWorldEngine({
        game,
        seats: new Map([["player-a", 1]]),
        store: new CountingStore(genesis()),
        commands: COMMANDS,
        view: () => [],
      }),
    ).toThrow(/needs a game in world mode/);
  });

  // WHAT ONE COMMAND MAY SPEND ON THE RESIDENT SET (#316, then #295).
  //
  // The dirty set is derived by serializing partitions and comparing them
  // against a baseline. #316 made that ONE pass rather than three -- a
  // `clearTouchedPartitions()` at the top of dispatch, a `snapshotResident()`
  // for the rollback copy, and a `touchedPartitions` read at the bottom, each
  // serializing every resident partition. But one pass over the RESIDENT set
  // is still O(the world), and at 256 resident rooms of ~10 KB that one pass
  // measured 11.5 ms of a 12.8 ms command against the 5 ms
  // `WORLD_EVENT_HANDLER_BUDGET_MS` the drain batch is derived from.
  //
  // #295 scopes the pass to the partitions the command REACHED. So the claim
  // this case pins is no longer "once per resident partition" but "once per
  // partition the command could have written, and not once for the rest".
  //
  // Counted rather than timed, because the defect is a factor and a factor is
  // exactly what a count sees.
  it("serializes the partition it reached, and not the resident partitions it did not", async () => {
    const engine = newEngine();
    // Both rooms resident, so "per reached partition" is distinguishable from
    // "per resident partition".
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    Room.serializations = 0;
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    // One: room-one, which `touch` named. Room-two is resident and untouched,
    // and nothing handed it to the command.
    expect(Room.serializations).toBe(1);
  });

  it("serializes every partition a command DID reach, so the cost follows the command", async () => {
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    Room.serializations = 0;
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    expect(Room.serializations).toBe(2);
  });

  it("does not let the READ path enlarge the next command's comparison", async () => {
    // A view is answered by `viewDeclaredFor` (a declaration) and then by
    // `toJSONForPlayer` over the resident tree, and neither may write. If
    // either marked what it walked, every partition anybody LOOKED at would be
    // compared on the next command -- and residency is everybody's doing, so
    // that is the O(resident) cost #295 removed, arriving by the read path.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);
    await engine.viewFor("player-a");
    await engine.viewFor("player-b");

    Room.serializations = 0;
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    expect(Room.serializations).toBe(1);
  });

  // THE #173 SHAPE, WHICH THE SCOPING MUST NOT REOPEN.
  //
  // A handler is expressly allowed to reach past what it declared, and an
  // attribute write it makes out there re-parents nothing -- so `moveToInternal`
  // never sees it and only the serialized-form comparison can. Scoping the
  // comparison would lose it if the query that produced the element were not
  // itself a door the engine marks. It is.
  it("reports an UNDECLARED attribute write reached by a query, and pays only for it", async () => {
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    Room.serializations = 0;
    const result = await engine.applyCommand(
      "player-a",
      { name: "reachAndWrite", args: {} },
      STAMP,
    );

    expect([...result.dirty].sort()).toEqual([ROOM_ONE, ROOM_TWO]);
    // Both, and only because both were reached: the declared room and the one
    // the query handed over.
    expect(Room.serializations).toBe(2);
  });

  it("rolls an undeclared attribute write back when the command is refused", async () => {
    // The rollback copy comes from the same baselines the comparison keeps
    // (#316), so a partition the scoping skipped must still hold bytes that
    // match the tree. If it did not, a refusal would restore stale state into
    // a partition nobody wrote.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);
    // room-two goes untouched for a command, so its baseline is older than
    // room-one's -- the exact asymmetry scoping introduces.
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    const before = await engine.serializePartitions([ROOM_TWO]);

    await expect(
      engine.applyCommand("player-a", { name: "tearAcross", args: {} }, STAMP),
    ).rejects.toThrow(/deliberately/);

    expect(await engine.serializePartitions([ROOM_TWO])).toEqual(before);
  });

  it("a command that does not complete reports NO ending", async () => {
    // The default has to be silence. An engine that reported an ending on every
    // command would make the platform settle a season per move.
    const engine = newEngine();
    const result = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(result.ending).toBeUndefined();
  });

  it("a command that calls complete() reports the ONE ending a game may declare", async () => {
    // #35 section 8: "only the game may declare a completion." The hook takes
    // no argument, so a bundle cannot name `cancelled`, `refusal-parked` or
    // any of the platform's own endings -- which makes the anti-abuse rule a
    // property of the surface rather than a check somewhere downstream.
    const engine = newEngine();
    const result = await engine.applyCommand("player-a", { name: "finish", args: {} }, STAMP);
    expect(result.ending).toBe("completed");
  });

  it("an ending does not leak into the NEXT command", async () => {
    // The flag is per command, cleared with the touched set. A leak would
    // settle the season again on the next move, and `settleSeason` is
    // idempotent per season number rather than per call -- so the second one
    // would be a real second season.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "finish", args: {} }, STAMP);
    const after = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(after.ending).toBeUndefined();
  });

  it("reports which partitions are resident, and when each was last NAMED", async () => {
    // What `planEviction` reads. `lastUsed` rises on every command that NAMES a
    // partition -- reads included -- because what predicts residency being
    // needed again is being named, not being written.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    const residency = engine.residency();
    expect(residency.map((p) => p.name).sort()).toEqual([ROOM_ONE, ROOM_TWO]);

    const one = residency.find((p) => p.name === ROOM_ONE)!;
    const two = residency.find((p) => p.name === ROOM_TWO)!;
    expect(one.lastUsed).toBeGreaterThan(two.lastUsed);
  });

  it("evicts a partition, and the next command that names it adopts it again", async () => {
    // The whole point of eviction: residency is released and the world is
    // unchanged. A second read of the same partition is what proves the first
    // eviction actually happened -- residency's own test asserts the opposite,
    // that a resident partition is NOT re-read.
    const store = new CountingStore(genesis());
    const engine = newEngine(store);

    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(store.reads).toEqual([ROOM_ONE]);

    engine.evict([ROOM_ONE]);
    expect(engine.residency().map((p) => p.name)).toEqual([]);

    const result = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(store.reads).toEqual([ROOM_ONE, ROOM_ONE]);
    // ...and it came back with what the last checkpoint held, not from nothing.
    expect(result.dirty).toEqual([ROOM_ONE]);
  });

  it("evicting a partition it does not hold is a no-op, not a throw", async () => {
    // The caller is `planEviction`, whose list is computed from a residency
    // snapshot the parent took a moment earlier. A partition evicted twice, or
    // one that was never adopted, must not turn a routine housekeeping pass
    // into a refusal that parks a world.
    const engine = newEngine();
    expect(() => engine.evict(["room:404"])).not.toThrow();
  });

  it("adopts a partition on first use and NOT again -- residency is the point", async () => {
    // The amortisation the whole cost argument rests on: a resident Durable
    // Object pays for a room once, not once per action. A second read here
    // would mean the engine was re-hydrating the world on every command.
    const store = new CountingStore(genesis());
    const engine = newEngine(store);

    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    await engine.applyCommand("player-b", { name: "touch", args: {} }, STAMP);

    expect(store.reads).toEqual([ROOM_ONE]);
  });

  it("never loads a partition no command named", async () => {
    // Absent-until-loaded, stated as a measurement. A `touch` that dragged
    // room:2 into memory would be the O(world) read this mode removes.
    const store = new CountingStore(genesis());
    const engine = newEngine(store);

    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    expect(store.reads).toEqual([ROOM_ONE]);
    await expect(engine.serializePartitions([ROOM_TWO])).rejects.toThrow(
      /not resident/,
    );
  });

  it("reports the DESTINATION of a cross-partition move the command never named", async () => {
    // The engine's own half of the dirty set, and the reason `moveToInternal`
    // marks both endpoints: the platform cannot see this one. `throwToken`
    // declares room:1 alone, and the token lands in room:2.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    const thrown = await engine.applyCommand("player-a", {
      name: "throwToken",
      args: {},
    }, STAMP,);

    expect([...thrown.dirty].sort()).toEqual([ROOM_ONE, ROOM_TWO]);
  });

  it("a dirty set describes ONE command, not every command since the checkpoint", async () => {
    // Accumulating until a checkpoint is the caller's job. An engine that kept
    // the touch set would report room:2 forever after the move above, and the
    // checkpoint would grow monotonically with the session.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);
    await engine.applyCommand("player-a", { name: "throwToken", args: {} }, STAMP);

    const after = await engine.applyCommand("player-a", {
      name: "touch",
      args: {},
    }, STAMP,);

    expect(after.dirty).toEqual([ROOM_ONE]);
  });

  it("serializes a partition at a SIZE that does not grow with the action count", async () => {
    // The `actionHistory` prohibition, measured rather than promised (#32).
    // A per-action record kept anywhere in the tree would show up here as a
    // partition whose checkpoint gets bigger every time somebody acts.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    const early = (await engine.serializePartitions([ROOM_ONE]))[ROOM_ONE]!;

    for (let i = 0; i < 50; i++) {
      await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    }
    const late = (await engine.serializePartitions([ROOM_ONE]))[ROOM_ONE]!;

    // Only `visits` moved, 1 -> 51, so the room grows by the single digit that
    // added. Anything accumulating per action would be far past this.
    expect(late.length).toBeLessThanOrEqual(early.length + 1);
  });

  it("runs a scheduled event through the SAME residency and dirty machinery", async () => {
    // `onEvent` is not a second way for a world to change. A scheduled beat
    // loads the partitions it names, reports them dirty, and folds a coalesced
    // catch-up into one pass rather than 68 -- #35's "catch-up integrates
    // rather than replays", measured on the state and not just the events.
    const store = new CountingStore(genesis());
    const engine = newEngine(store);

    const drained = await engine.onEvent(
      { name: "decay", args: {} },
      { due: 5_000, missedCount: 68 },
      { allowance: { unkeyed: 0, keys: [], worldPending: 0 }, presence: [] },
    );

    expect(drained.dirty).toEqual([ROOM_ONE]);
    expect(store.reads).toEqual([ROOM_ONE]);
    expect(JSON.parse((await engine.serializePartitions([ROOM_ONE]))[ROOM_ONE]!))
      .toMatchObject({ attributes: { visits: 69 } });
  });

  it("refuses a command the world does not answer to, naming what it does", async () => {
    const engine = newEngine();

    await expect(
      engine.applyCommand("player-a", { name: "unbolt", args: {} }, STAMP),
    ).rejects.toThrow(/touch, touchAll, tick, decay, finish, stamp, who, tearRoom, tearAcross, declareAndWrite, tearRemove, tearBetween, tearOwn, misroute, strand, reachAndWrite, throwToken/);
  });

  it("refuses a player it does not seat", async () => {
    const engine = newEngine();

    await expect(engine.viewFor("player-z")).rejects.toThrow(
      /not in this world/,
    );
  });

  it("hands a handler NO raw game -- an undeclared write has no vehicle (#152)", async () => {
    // The dirty-set contract is "everything a command may have written is
    // reported dirty", and it was enforced only through the `partition()`
    // accessor while the same context handed the whole tree over as `game`.
    // An attribute write reaching a resident-but-undeclared partition through
    // `ctx.game` was not refused, not named, and not touched: visible in every
    // view, then silently reverted on eviction or hibernation. The context no
    // longer carries the game at all, so the easy wrong way is gone.
    let handed: unknown = "unset";
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      commands: {
        probe: {
          args: [],
          partitions: () => [],
          run: (ctx) => {
            handed = (ctx as unknown as Record<string, unknown>).game;
            return [];
          },
        },
      },
      view: () => [],
    });

    await engine.applyCommand("player-a", { name: "probe", args: {} }, STAMP);
    expect(handed).toBeUndefined();
  });

  it("refuses a partition the command did not declare", async () => {
    // The undeclared partition is the silent-corruption case: it would not be
    // resident, and it would not be reported dirty either.
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      commands: {
        ...COMMANDS,
        sneak: {
          args: [],
          partitions: () => [ROOM_ONE],
          run: ({ partition }) => {
            partition(ROOM_TWO);
            return [];
          },
        },
      },
      view: () => [],
    });

    await expect(
      engine.applyCommand("player-a", { name: "sneak", args: {} }, STAMP),
    ).rejects.toThrow(/did not declare/);
  });
});

describe("#163 — a world has no message-log surface", () => {
  /** An engine whose one command writes to the game root's message log, plus
   *  the game itself so the test can measure what stays resident. */
  function gossipWorld() {
    const game = newWorldGame();
    const engine = new BoardSmithWorldEngine({
      game,
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      commands: {
        gossip: {
          args: [],
          partitions: () => [ROOM_ONE],
          run: ({ partition }) => {
            (partition(ROOM_ONE) as Room).game.message("gossip travels");
            return [{ scope: ROOM_ONE, payload: {} }];
          },
        },
      },
      view: () => [ROOM_ONE],
    });
    return { game, engine };
  }

  it("a view ships player, state and phase -- and NO messages", async () => {
    // The log lives on the game root, outside every partition, so a checkpoint
    // never persists it and every wake silently reset it to empty. A surface
    // that means "messages since the last hibernation" while looking like "all
    // messages" is not offered at all: a world's narration is its EVENTS,
    // routed per command to the seats that can see the scope.
    const { engine } = gossipWorld();
    await engine.applyCommand("player-a", { name: "gossip", args: {} }, STAMP);

    const view = (await engine.viewFor("player-a")) as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual(["phase", "player", "state"]);
  });

  it("the resident log is bounded by ONE command, not by the world's age", async () => {
    // The unbounded half: every game.message() a handler emitted accumulated
    // in the resident tree for the life of the isolate. Nothing reads the log
    // any more, so the engine clears it at each dispatch -- the same moment it
    // clears the touched set.
    const { game, engine } = gossipWorld();
    for (let i = 0; i < 50; i++) {
      await engine.applyCommand("player-a", { name: "gossip", args: {} }, STAMP);
    }

    expect(game.messages.length).toBeLessThanOrEqual(1);
  });
});

/** `visits` as the checkpoint bytes actually record it. A substring check
 *  cannot tell 1 from 101, which is exactly the difference a rollback is. */
function visitsIn(written: Record<string, string>): number {
  return (JSON.parse(written[ROOM_ONE]!) as { attributes: { visits: number } })
    .attributes.visits;
}

describe("#190 — a partition name that is also an Object.prototype key", () => {
  it("writes a partition named __proto__ as an OWN property of the checkpoint", async () => {
    // Partition names come from an untrusted bundle. Written into a plain
    // `Record<string, string>`, `written["__proto__"] = bytes` goes through
    // the inherited setter and is a silent no-op: the partition disappears
    // from the checkpoint, and the world reverts it on the next wake with no
    // error anywhere.
    const source = newWorldGame();
    const room = source.create(Room, "proto-room");
    const engine = newEngine(
      new CountingStore(
        new Map<string, StoredPartition>([
          ["__proto__", { parentId: source.id, json: throughStorage(room.toJSON()) }],
        ]),
      ),
    );

    await engine.hydrate(["__proto__"]);
    const written = await engine.serializePartitions(["__proto__"]);

    expect(Object.keys(written)).toEqual(["__proto__"]);
    expect(Object.prototype.hasOwnProperty.call(written, "__proto__")).toBe(true);
    expect(written["__proto__"]).toContain("proto-room");
  });
});

describe("#219 — a declaration reads, and cannot write", () => {
  it("REFUSES a command whose partitions() writes, and leaves the world alone", async () => {
    // The declaration runs BEFORE the rollback snapshot, so the write was
    // captured into the snapshot rather than covered by it: a later refusal
    // "rolled back" to the mutated state and the write survived.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "declareAndWrite", args: {} }, STAMP),
    ).rejects.toThrow(/partitions\(\)/);

    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(1);
  });

  it("REFUSES a bundle's view() that writes, which no snapshot covers at all", async () => {
    // The read path has no rollback and the next dispatch clears the touched
    // record, so a view-time write showed up in every watcher's view, was
    // never checkpointed, and was silently reverted at the next hibernation.
    const store = new CountingStore(genesis());
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store,
      commands: COMMANDS,
      view: (_seat, world) => {
        const room = world.partition(ROOM_ONE) as Room | undefined;
        if (room) room.visits = 500;
        return [ROOM_ONE];
      },
    });

    // The first look has nothing resident, so the declaration reads undefined
    // and writes nothing; the second is the one that reaches a live room.
    await engine.viewFor("player-a");
    await expect(engine.viewFor("player-a")).rejects.toThrow(/view\(\)/);

    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(0);
  });
});

describe("#68 — a refused command leaves the world unchanged", () => {
  it("rolls back a handler that mutated and then threw", async () => {
    // The failure this closes: a handler debits gold, throws before crediting
    // the unit, and the player is sent `refused` -- which means "nothing
    // changed" to any client. The live tree had lost the gold.
    const engine = newEngine();

    // An earlier command that SUCCEEDED and has not been checkpointed. The
    // rollback must keep it: it is a complete change riding an un-checkpointed
    // partition, and discarding it is the other half of the same bug.
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "tearRoom", args: {} }, STAMP),
    ).rejects.toThrow(/fails halfway/);

    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(1);
    expect(await engine.serializePartitions([ROOM_ONE])).toMatchObject({
      [ROOM_ONE]: expect.stringContaining("token-one"),
    });
  });

  it("rolls back a SCHEDULED event the same way", async () => {
    // The platform quarantines a throwing event and moves on, so a torn tree
    // behind a quarantine is even quieter than one behind a refusal: nobody is
    // told at all.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.onEvent({ name: "tearRoom", args: {} }, { due: 1_000, missedCount: 0 }, { allowance: { unkeyed: 0, keys: [], worldPending: 0 }, presence: [] }),
    ).rejects.toThrow(/fails halfway/);

    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(1);
  });

  it("recovers the token a failing handler threw into a room it never declared", async () => {
    // The destination was never NAMED, and it is restored anyway (#294). The
    // engine used to release it instead and let the next command re-read the
    // last checkpointed bytes, which loses every un-checkpointed change to it
    // -- including a change an EARLIER, SUCCESSFUL command in the same
    // checkpoint window made, which no rollback is entitled to discard.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "tearAcross", args: {} }, STAMP),
    ).rejects.toThrow(/after moving something/);

    // The token is back where it started, and it is there exactly once.
    const written = await engine.serializePartitions([ROOM_ONE, ROOM_TWO]);
    expect(written[ROOM_ONE]).toContain("token-one");
    expect(written[ROOM_TWO]).not.toContain("token-one");

    // AND THE EARLIER COMMAND'S WRITE TO THAT ROOM IS STILL THERE. `touchAll`
    // raised both rooms to 1 and nothing has checkpointed since, so a rollback
    // that re-read `room:2` from the store would have put it back to 0.
    expect(
      (JSON.parse(written[ROOM_TWO]!) as { attributes: { visits: number } }).attributes.visits,
    ).toBe(1);

    // The room is still resident, which is what makes the parent's checkpoint
    // possible: it is still in the dirty set the earlier command put it in,
    // and a child that had dropped it refuses to serialize it.
    expect(engine.residency().map((r) => r.name).sort()).toEqual([ROOM_ONE, ROOM_TWO]);
  });

  it("reports a cross-partition move on a GENESIS tree dirty (#294)", async () => {
    // A world's first instance holds what `genesis` built, and until #294
    // `registerResident` did not tell the game those subtrees were partition
    // ROOTS. `touchedPartitions` reads the roots, so on that instance it was
    // always empty: a successful move out of a declared room into an
    // undeclared one reported only the SOURCE dirty. The source checkpointed
    // without the token, the destination never checkpointed at all, and the
    // token was gone at the next wake with nothing raised anywhere.
    const engine = genesisEngine();

    const result = await engine.applyCommand(
      "player-a",
      { name: "throwToken", args: {} },
      STAMP,
    );

    expect([...result.dirty].sort()).toEqual([ROOM_ONE, ROOM_TWO]);
  });

  it("rolls back an undeclared cross-partition move on a GENESIS tree (#294)", async () => {
    // The same missing registration, seen on the failure path. With no
    // partition roots there was no collateral pass, so the rollback went
    // straight to the declared restore -- and met the moved token still live
    // inside `room:2`, which `adoptSubtree` refuses as an id clash. The game's
    // own refusal was replaced by a platform error about element ids, and
    // `room:1` was left evicted, unmapped, and unreadable for the rest of the
    // world's life.
    const engine = genesisEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "tearAcross", args: {} }, STAMP),
    ).rejects.toThrow(/after moving something/);

    const written = await engine.serializePartitions([ROOM_ONE, ROOM_TWO]);
    expect(written[ROOM_ONE]).toContain("token-one");
    expect(written[ROOM_TWO]).not.toContain("token-one");
    expect(
      (JSON.parse(written[ROOM_TWO]!) as { attributes: { visits: number } }).attributes.visits,
    ).toBe(1);
  });

  it("rolls back a handler that REMOVED something and then threw (#294)", async () => {
    // The element leaves every partition without entering one, so the restore
    // met its own id still live in the game's pile: `adoptSubtree` refused, the
    // game's refusal was replaced by a platform error about element ids, and
    // room:1 was left evicted, unmapped and unreadable for the rest of the
    // world's life.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "tearRemove", args: {} }, STAMP),
    ).rejects.toThrow(/after removing something/);

    const written = await engine.serializePartitions([ROOM_ONE]);
    expect(written[ROOM_ONE]).toContain("token-one");
    expect(visitsIn(written)).toBe(1);

    // And the engine is not wedged: the next command runs normally.
    const after = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(after.dirty).toEqual([ROOM_ONE]);
  });

  it("rolls back a move between TWO DECLARED partitions (#189)", async () => {
    // Both endpoints are declared, so the collateral pass drops neither and
    // both snapshots have to go back. Restoring them one at a time re-adopted
    // old room:1 while the moved token was still live inside a not-yet-restored
    // room:2, and `adoptSubtree` refused the clash from INSIDE the rollback:
    // the game's own refusal was replaced by an id clash, room:1 was left
    // evicted but still mapped, and the next read of it raised
    // `partition-vanished` -- a platform-owned code that parks the world.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "tearBetween", args: {} }, STAMP),
    ).rejects.toThrow(/after a declared-to-declared move/);

    // The token is back in room:1 and nowhere else, and both rooms are still
    // resident and still readable.
    const written = await engine.serializePartitions([ROOM_ONE, ROOM_TWO]);
    expect(written[ROOM_ONE]).toContain("token-one");
    expect(written[ROOM_TWO]).not.toContain("token-one");
    expect(engine.residency().map((r) => r.name).sort()).toEqual([ROOM_ONE, ROOM_TWO]);

    // And the engine is not wedged: the next command runs normally.
    const after = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(after.dirty).toEqual([ROOM_ONE]);
  });

  it("rolls back a command that DECLARED ONE PARTITION TWICE (#263)", async () => {
    // The rollback snapshots the declaration verbatim, so a declaration naming
    // one partition twice produced two snapshots of the same subtree: since
    // #189 every root comes out before any goes back in, so the second adopt
    // met the first one's ids and `adoptSubtree` refused -- and the GAME's own
    // refusal was replaced by a platform error about element ids, which no
    // author can act on. This is example-rts `tend` aimed at the actor's own
    // holding: `partitions: (args, seat) => [ownHolding(seat), args.neighbour]`.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "tearOwn", args: {} }, STAMP),
    ).rejects.toThrow(/in the game's own words/);

    // The mutation is gone, the partition is still resident and readable, and
    // the engine still answers the next command.
    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(1);
    expect(engine.residency().map((r) => r.name)).toContain(ROOM_ONE);
    const after = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(after.dirty).toEqual([ROOM_ONE]);
  });

  it("declares a twice-named partition ONCE to the platform (#263)", async () => {
    // The parent reads what this answers straight out of storage, so a
    // duplicate here is a partition fetched and shipped across the child
    // boundary twice for one command.
    const engine = newEngine();
    expect(
      engine.commandPartitions("player-a", { name: "tearOwn", args: {} }),
    ).toEqual([ROOM_ONE]);
  });

  it("rolls back a handler that SUCCEEDED and then failed event routing (#151)", async () => {
    // The refusal is thrown by `audienceOf`, AFTER `run` returned -- the exact
    // window #151 names: the tree holds the full mutation, the player is told
    // `refused`, and until the rollback covered it the phantom change waited to
    // ride the next checkpoint of the same partition.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "misroute", args: {} }, STAMP),
    ).rejects.toThrow(/tavern:9/);

    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(1);
  });

  it("rolls back a handler that SUCCEEDED and then failed dirty-set resolution (#151)", async () => {
    // The other post-run refusal: the handler moved a token into a partition
    // root the engine never loaded, so the touched-partition walk refuses. The
    // moved token must come back, and the rogue subtree must not survive.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "strand", args: {} }, STAMP),
    ).rejects.toThrow(/cannot name/);

    const written = await engine.serializePartitions([ROOM_ONE]);
    expect(visitsIn(written)).toBe(1);
    // The token is back where it started -- not stranded in the rogue room.
    expect(written[ROOM_ONE]).toContain("token-one");

    // And the engine is not wedged: the next command runs normally.
    const after = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(after.dirty).toEqual([ROOM_ONE]);
    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(2);
  });

  it("still runs the NEXT command against a world that refused the last one", async () => {
    // A rollback that left the engine wedged would trade a torn world for a
    // dead one.
    const engine = newEngine();
    await expect(
      engine.applyCommand("player-a", { name: "tearRoom", args: {} }, STAMP),
    ).rejects.toThrow();

    const result = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    expect(result.dirty).toEqual([ROOM_ONE]);
    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(1);
  });
});

describe("#57 — the clock a handler can trust is the platform's", () => {
  it("hands a player's command the instant the PLATFORM stamped, not the one the client sent", async () => {
    // The classic clock-trust hole. A player who could name the time could
    // backdate every timer they start, and every building would finish
    // instantly. The stamped instant is now the reachable one.
    const engine = newEngine();
    const result = await engine.applyCommand(
      "player-a",
      { name: "stamp", args: { now: 1 } },
      {
        now: 1_700_000_000_000,
        allowance: { unkeyed: 0, keys: [], worldPending: 0 },
        presence: [],
      },
    );
    expect(result.events[0]!.payload).toEqual({
      now: 1_700_000_000_000,
      claimed: 1,
    });
  });

  it("hands a SCHEDULED event its own due, so a late drain is not a late clock", async () => {
    // The same rule the `timing.due` argument already made: a world parked for
    // a week and poked by the sweep must compute from the moment it was always
    // going to run at, or two identical worlds diverge on how promptly their
    // platform happened to wake them.
    const engine = newEngine();
    const result = await engine.onEvent(
      { name: "stamp", args: {} },
      { due: 5_000, missedCount: 0 },
      { allowance: { unkeyed: 0, keys: [], worldPending: 0 }, presence: [] },
    );
    expect((result.events[0]!.payload as { now: number }).now).toBe(5_000);
  });

  it("hands a player's command the platform's presence stamp, as ctx.presence (#144)", async () => {
    // The stamp is the parent's own derivation from its attached sockets;
    // this proves the threading -- what the platform said is what the handler
    // read, per seat and nothing invented on the way.
    const engine = newEngine();
    const result = await engine.applyCommand(
      "player-a",
      { name: "who", args: {} },
      {
        now: 1_700_000_000_000,
        allowance: { unkeyed: 0, keys: [], worldPending: 0 },
        presence: [2, 1],
      },
    );
    expect(result.events[0]!.payload).toEqual({ online: [1, 2] });
  });

  it("hands a SCHEDULED event the presence stamp too -- the 03:00 raid can ask who is watching", async () => {
    // The clock's road carries the same fact: a due event drained over an
    // empty world is told nobody is here, rather than remembering somebody.
    const engine = newEngine();
    const result = await engine.onEvent(
      { name: "who", args: {} },
      { due: 5_000, missedCount: 0 },
      { allowance: { unkeyed: 0, keys: [], worldPending: 0 }, presence: [] },
    );
    expect(result.events[0]!.payload).toEqual({ online: [] });
  });
});

describe("#183 — a view is scoped to what the seat's declaration named", () => {
  // The interface has said it from the start (`world-engine.ts:viewFor`):
  // "Returning the whole world here would put the O(world) cost back in a
  // different place", and "what `viewPartitions` named is the whole of what
  // this method is allowed to look at". The implementation serialized the
  // whole RESIDENT tree instead, so a view's content depended on what other
  // players had happened to load: 260 KB per view for example-rts at 500
  // seats with the village resident, against ~2 named partitions of actual
  // declaration. Measured 2026-08-31; the deployed fan-out saturation of the
  // same date carried that view on every command's answer.
  function scopedEngine(store: WorldPartitionSource = new CountingStore(genesis())) {
    return new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([
        ["player-a", 1],
        ["player-b", 2],
      ]),
      store,
      commands: COMMANDS,
      // Seat 1's view is about room one ALONE; seat 2's about room two.
      view: (seat) => (seat === 1 ? [ROOM_ONE] : [ROOM_TWO]),
    });
  }

  it("a resident partition the declaration did not name is NOT in the view", async () => {
    const engine = scopedEngine();
    // `touchAll` makes BOTH rooms resident -- the state a busy world is
    // always in, because somebody recently loaded every popular room.
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    const view = JSON.stringify(await engine.viewFor("player-a"));
    expect(view).toContain("room-one");
    // Room two is resident, visible, and NOT named by seat 1's declaration.
    // Before the fix it rode along in every one of seat 1's views.
    expect(view).not.toContain("room-two");
  });

  it("a view's bytes do not change when unrelated residency grows", async () => {
    const engine = scopedEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    const before = JSON.stringify(await engine.viewFor("player-a"));

    // The platform hydrates room two -- another player looked at it. Nothing
    // seat 1's declaration names has changed, so seat 1's view must not.
    await engine.hydrate([ROOM_TWO]);
    const after = JSON.stringify(await engine.viewFor("player-a"));

    expect(after).toEqual(before);
  });

  it("still refuses to hide a NAMED partition: the named set is all there", async () => {
    // The guard rail on the guard rail: pruning must remove exactly the
    // unnamed partitions and nothing else. Both rooms named means both rooms
    // in the view, resident or freshly adopted.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    const view = JSON.stringify(await engine.viewFor("player-a"));
    expect(view).toContain("room-one");
    expect(view).toContain("room-two");
  });
});

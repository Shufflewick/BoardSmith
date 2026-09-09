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
import type { GameElement } from "../engine/index.js";
import { PlayerFacingError } from "../engine/errors.js";
import type { ActionDefinition, ElementJSON, GameOptions } from "../engine/index.js";
import { assertWorldEngineConformance } from "./engine-conformance.test-helper.js";
import { BoardSmithWorldEngine } from "./engine.js";
import { worldAction, worldClockAction } from "./action.js";
import type { StoredPartition, WorldPartitionSource } from "./contract.js";
import { worldBudgets } from "./budgets.js";
import {
  Holding,
  VillageFixture,
  holdingPartition,
  newVillageEngine,
} from "./village.test-helper.js";

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
    //
    // ITS ACTIONS ARE NOT REGISTERED HERE (#169). A world's verbs are handed
    // to the engine, which registers them itself -- so "the actions the engine
    // offers" and "the actions the game holds" are the same list by
    // construction rather than by convention, and a game class that also
    // registered them would be registering each one twice.
    this.registerElements([Room, Token]);
  }

  /** The room by its element name, or a refusal naming the fixture's own
   *  precondition. Written once because a dozen actions below need it and
   *  `first` returning `undefined` is a much worse sentence than this one. */
  room(name: string): Room {
    const found = this.first(Room, name);
    if (!found) throw new Error(`the fixture needs ${name} resident`);
    return found;
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
  // No history: this suite is not about the watermark, and the cases that are
  // name their own (ShufflewickPub #383).
  activity: { seat: 1, at: null, since: 1_700_000_000_000 },
};

const EVENT_STAMP = {
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  presence: [],
  activity: null,
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
  const game = new WorldFixtureGame({ playerCount: 4, seed: "world-fixture", worldMode: true });
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

// ── THE WORLD'S VERBS (#169) ────────────────────────────────────────────────
//
// Each one is an ACTION, out of the same registry a table's actions come from,
// declaring what each of its steps needs resident. Where the flat table wrote
// `partitions(args, seat, world)` and was asked again until it stopped naming
// anything new, an action writes `.needs()` for round one, a `needs:` on each
// selection for that selection's round, and a trailing `.needs()` for whatever
// `execute` writes that no candidate list ever mentioned. The walk is ordered,
// so there is no ceiling to tune and no unsettled refusal to explain.
//
// SEATED AND SEATLESS ARE DIFFERENT VERBS, and where this fixture needs both
// roads to reach the same behaviour it writes both. That is not duplication for
// its own sake: a seatless action's context has NO `player`, deliberately, so
// one definition standing in for both would be exactly the invented-player
// fallback `worldClockAction` exists to make unrepresentable.

/** Names ONE partition. The whole model is that this costs one room. */
const touch = worldAction<WorldFixtureGame>("touch")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    const room = ctx.game.room("room-one");
    room.visits += 1;
    ctx.world.emit(ROOM_ONE, { by: ctx.player.seat, visits: room.visits });
  });

/** Names both, so the suite has something strictly larger to compare against. */
const touchAll = worldAction<WorldFixtureGame>("touchAll")
  .needs(() => [ROOM_ONE, ROOM_TWO])
  .execute((_args, ctx) => {
    for (const [name, element] of [
      [ROOM_ONE, "room-one"],
      [ROOM_TWO, "room-two"],
    ] as const) {
      const room = ctx.game.room(element);
      room.visits += 1;
      ctx.world.emit(name, { by: ctx.player.seat, visits: room.visits });
    }
  });

/**
 * ASKS A QUESTION, which is what makes the offer case mean anything.
 *
 * Every other verb here is a bare button, and an enumeration assertion over a
 * world of bare buttons is vacuous. This one names its candidates the way #169
 * requires -- an `elements:` list computed from what this step's `needs`
 * declared -- so the offer carries two resolved element ids rather than an
 * instruction to search the resident tree.
 */
const visit = worldAction<WorldFixtureGame>("visit")
  .prompt("Look in on a room")
  .chooseElement("room", {
    needs: () => [ROOM_ONE, ROOM_TWO],
    elements: ({ game }) => [game.room("room-one"), game.room("room-two")],
  })
  .execute(({ room }, ctx) => {
    room.visits += 1;
    ctx.world.emit(ROOM_ONE, { visited: room.name });
  });

/**
 * DECLARES THE SEASON OVER. The one ending a game may name, and it names it by
 * calling a no-argument hook rather than returning a string -- see
 * `WorldFacilities.complete`.
 */
const finish = worldAction<WorldFixtureGame>("finish")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    ctx.world.complete();
    ctx.world.emit(ROOM_ONE, { over: true });
  });

/**
 * Reports the clock the PLATFORM handed it, beside what the CLIENT sent (#57).
 *
 * The selection is called `now` on purpose. Under the flat table that name was
 * RESERVED and a bundle declaring it was refused, because a command's arguments
 * and its clock arrived in the same context and a player who could name the
 * time would finish every timer the moment they started it. An action has no
 * such collision to defend against: arguments are `args` and the clock is
 * `ctx.world.now`, two channels that never meet, so the name is now ordinary
 * and this case is what says so.
 */
const stamp = worldAction<WorldFixtureGame>("stamp")
  .needs(() => [])
  .enterNumber("now")
  .execute((args, ctx) => {
    ctx.world.emit("world", { now: ctx.world.now, claimed: args.now });
  });

/**
 * Reads the platform's presence stamp (#144): which seats are connected, as an
 * action sees it -- a Set, asked by membership.
 */
const who = worldAction<WorldFixtureGame>("who")
  .needs(() => [])
  .execute((_args, ctx) => {
    ctx.world.emit("world", { online: [...ctx.world.presence].sort((a, b) => a - b) });
  });

/**
 * MUTATES, THEN THROWS. The shape #68 is about: the platform expects handlers
 * to throw -- it quarantines them -- and a handler that debits and then fails
 * must not leave the debit behind a `refused` answer.
 */
const tearRoom = worldAction<WorldFixtureGame>("tearRoom")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    ctx.game.room("room-one").visits += 100;
    throw new Error("this handler fails halfway, deliberately");
  });

/**
 * The same, but it first throws a token into a room it never declared -- so the
 * torn state is spread across a partition no snapshot could cover. The engine's
 * re-parent tracking catches the move whichever way the room was found.
 */
const tearAcross = worldAction<WorldFixtureGame>("tearAcross")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    const room = ctx.game.room("room-one");
    const token = room.first(Token);
    if (!token) throw new Error("tearAcross needs a token in room-one");
    token.putInto(ctx.game.room("room-two"));
    throw new Error("this handler fails after moving something, deliberately");
  });

/**
 * TAKES SOMETHING OUT OF EVERY PARTITION, and then throws (#294). `remove()`
 * parks the token in the game's PILE, which is not a partition: nothing marks
 * it touched, nothing names it, and nothing evicts it -- and `adoptSubtree`
 * looks for an id clash in the pile as well as in the tree.
 */
const tearRemove = worldAction<WorldFixtureGame>("tearRemove")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    const token = ctx.game.room("room-one").first(Token);
    if (!token) throw new Error("tearRemove needs a token in room-one");
    token.remove();
    throw new Error("this handler fails after removing something, deliberately");
  });

/**
 * MOVES BETWEEN TWO DECLARED PARTITIONS, and then throws (#189). Both endpoints
 * are declared, so the collateral pass drops neither and the rollback has to
 * restore two snapshots whose ids overlap: old room:1 holds the token that is,
 * at restore time, still live inside room:2.
 */
const tearBetween = worldAction<WorldFixtureGame>("tearBetween")
  .needs(() => [ROOM_ONE, ROOM_TWO])
  .execute((_args, ctx) => {
    const token = ctx.game.room("room-one").first(Token);
    if (!token) throw new Error("tearBetween needs a token in room-one");
    token.putInto(ctx.game.room("room-two"));
    throw new Error("this handler fails after a declared-to-declared move, deliberately");
  });

/**
 * NAMES ONE PARTITION TWICE, ACROSS TWO ROUNDS, and then throws (#263).
 *
 * The flat table named it twice in one list -- "the actor's own land, and the
 * land the arguments chose", which is one partition when a settler aims at
 * themselves. An action's walk has more than one round, so the same collision
 * arrives a step apart instead: round one names the room, and the execute round
 * names it again for what `execute` writes. Nothing the author did is wrong in
 * either shape, and the platform's job is the same -- absorb the duplicate --
 * because the rollback snapshots the declaration verbatim, and two snapshots of
 * one subtree meant the second adopt met the first one's ids and `adoptSubtree`
 * refused. The GAME's own refusal was then replaced by a platform error about
 * element ids, which no author can act on.
 */
const tearOwn = worldAction<WorldFixtureGame>("tearOwn")
  // ROUND ONE: the actor's own land.
  .needs(() => [ROOM_ONE])
  .chooseFrom("aim", {
    // THIS SELECTION'S ROUND: the land the arguments chose -- which, when a
    // settler aims at themselves, is the land round one already named.
    needs: () => [ROOM_ONE],
    choices: ["room-one"],
  })
  .execute((_args, ctx) => {
    ctx.game.room("room-one").visits += 100;
    throw new Error("this handler refuses in the game's own words, deliberately");
  });

/**
 * MUTATES, RETURNS, and only then fails: the event names a scope that is
 * neither "world" nor a partition. The #151 shape -- the handler SUCCEEDED, so
 * a catch around `execute` alone would never see the refusal.
 */
const misroute = worldAction<WorldFixtureGame>("misroute")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    ctx.game.room("room-one").visits += 100;
    ctx.world.emit("tavern:9", { typo: true });
  });

/**
 * REFUSES IN THE GAME'S OWN WORDS, through the channel whose whole purpose is
 * carrying them (#191).
 *
 * A refusal a player can only discover by TRYING -- a bank that overflows on
 * the amount they chose -- is the one class `.disabled()` cannot grey out in
 * advance, and so the one class where a generic sentence is least useful. It
 * travels because `PlayerFacingError` says "my message was written to be read";
 * `refuseUnreadably` below is the same refusal thrown as a plain `Error`, and
 * that one is sanitized. The pair is the point.
 */
const refuseInWords = worldAction<WorldFixtureGame>("refuseInWords")
  .needs(() => [ROOM_ONE])
  .execute(() => {
    throw new PlayerFacingError("The hearth is full: it holds 3 logs and you offered 14.");
  });

/** Writes, and THEN refuses in words -- the #68 rollback's own shape. */
const refuseInWordsAfterWriting = worldAction<WorldFixtureGame>("refuseInWordsAfterWriting")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    ctx.game.room("room-one").visits += 100;
    throw new PlayerFacingError("The hearth is full: it holds 3 logs and you offered 14.");
  });

/** The same refusal an author wrote as a plain `Error`, which is sanitized. */
const refuseUnreadably = worldAction<WorldFixtureGame>("refuseUnreadably")
  .needs(() => [ROOM_ONE])
  .execute(() => {
    throw new Error("The hearth is full: it holds 3 logs and you offered 14.");
  });

/**
 * MUTATES, RETURNS, and fails the OTHER post-run check: it moves a token into a
 * partition root the engine never loaded and cannot name, so dirty-set
 * resolution refuses after the handler already succeeded (#151).
 */
const strand = worldAction<WorldFixtureGame>("strand")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    const room = ctx.game.room("room-one");
    const rogue = ctx.game.create(Room, "rogue-room");
    ctx.game.definePartition(rogue.id);
    const token = room.first(Token);
    if (!token) throw new Error("strand needs a token in room-one");
    token.putInto(rogue);
  });

/**
 * Names ONE partition and writes an ATTRIBUTE in another, reached through
 * `ctx.game` (#173, #295, and the successor to #152).
 *
 * #152 removed the raw game from a command's context entirely, on the argument
 * that an undeclared write reaching a resident partition through `ctx.game` was
 * not refused, not named and not touched -- visible in every view, then silently
 * reverted at the next hibernation. A world action IS an Action, so `ctx.game`
 * is back, and it has to be: it is what a table's action is written against and
 * the whole point of one registry. What replaced the removal is the pass that
 * makes such a write IMPOSSIBLE TO LOSE -- BoardSmith marks every element its
 * own queries and accessors hand out, and the dirty set is computed over the
 * partitions the action REACHED. So this is the case that holds the successor
 * rule: reach past what you declared, and the engine reports it dirty and
 * checkpoints it, rather than the door being nailed shut.
 *
 * Nothing re-parents, so `moveToInternal` never sees it: the only thing that
 * can report this is the serialized-form comparison -- and the comparison only
 * runs over room-two because the query that produced it is a door the engine
 * marks.
 */
const reachAndWrite = worldAction<WorldFixtureGame>("reachAndWrite")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    // The declared room is REACHED, exactly as any honest action reaches what
    // it declared -- so the comparison below pays for two partitions and the
    // case can tell "both, because both were reached" from "one, by accident".
    ctx.world.partition(ROOM_ONE);
    const other = ctx.game.room("room-two");
    other.visits += 7;
    ctx.world.emit(ROOM_ONE, { wrote: other.visits });
  });

/**
 * Names ONE partition and moves a token OUT of it, into a room it never
 * declared. This is the half of the dirty set only the engine can supply.
 */
const throwToken = worldAction<WorldFixtureGame>("throwToken")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    const room = ctx.game.room("room-one");
    const token = room.first(Token);
    if (!token) throw new Error("throwToken needs a token in room-one");
    token.putInto(ctx.game.room("room-two"));
    ctx.world.emit(ROOM_TWO, { landed: token.name });
  });

/**
 * Names NOTHING and changes nothing durable: a scheduled beat whose output is a
 * function of its scheduled `due` alone. SEATLESS, because the clock is the
 * only caller a beat has and a seatless action's context has no `player` to
 * invent.
 */
const tick = worldClockAction<WorldFixtureGame>("tick")
  .needs(() => [])
  .execute((_args, ctx) => {
    ctx.world.emit("world", {
      at: ctx.world.timing?.due,
      folded: ctx.world.timing?.missedCount,
    });
  });

/**
 * A SCHEDULED beat that does touch a partition: the catch-up path integrates
 * the missed occurrences instead of asking the platform to replay them.
 */
const decay = worldClockAction<WorldFixtureGame>("decay")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    const room = ctx.world.partition(ROOM_ONE) as Room;
    room.visits += 1 + (ctx.world.timing?.missedCount ?? 0);
    ctx.world.emit(ROOM_ONE, { at: ctx.world.timing?.due, visits: room.visits });
  });

/** `stamp` on the clock's road: the same fact asked of a seatless action. */
const clockStamp = worldClockAction<WorldFixtureGame>("clockStamp")
  .needs(() => [])
  .execute((_args, ctx) => {
    ctx.world.emit("world", { now: ctx.world.now });
  });

/** `who` on the clock's road: the 03:00 raid asking who is watching. */
const clockWho = worldClockAction<WorldFixtureGame>("clockWho")
  .needs(() => [])
  .execute((_args, ctx) => {
    ctx.world.emit("world", { online: [...ctx.world.presence].sort((a, b) => a - b) });
  });

/** `tearRoom` on the clock's road, for the rollback a quarantine hides. */
const clockTear = worldClockAction<WorldFixtureGame>("clockTear")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    (ctx.world.partition(ROOM_ONE) as Room).visits += 100;
    throw new Error("this handler fails halfway, deliberately");
  });

/**
 * Every verb the fixture world answers to, in the order it declares them --
 * which is the order `unknown-command` names them back in.
 */
const ACTIONS: readonly ActionDefinition[] = [
  touch,
  touchAll,
  visit,
  finish,
  stamp,
  who,
  tearRoom,
  tearAcross,
  tearRemove,
  tearBetween,
  tearOwn,
  misroute,
  strand,
  reachAndWrite,
  throwToken,
  tick,
  decay,
  clockStamp,
  clockWho,
  clockTear,
  // #191's pair, appended: the refusal-naming assertion above quotes this list
  // verbatim and in order, so a name inserted mid-list breaks a test that is
  // about something else entirely.
  refuseInWords,
  refuseInWordsAfterWriting,
  refuseUnreadably,
];

function newEngine(store: WorldPartitionSource = new CountingStore(genesis())) {
  return new BoardSmithWorldEngine({
    game: newWorldGame(),
    seats: new Map([
      ["player-a", 1],
      ["player-b", 2],
    ]),
    store,
    actions: ACTIONS,
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
    actions: ACTIONS,
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
        actions: ACTIONS,
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
      EVENT_STAMP,
    );

    expect(drained.dirty).toEqual([ROOM_ONE]);
    expect(store.reads).toEqual([ROOM_ONE]);
    expect(JSON.parse((await engine.serializePartitions([ROOM_ONE]))[ROOM_ONE]!))
      .toMatchObject({ attributes: { visits: 69 } });
  });

  it("refuses an action the world does not answer to, naming what it does", async () => {
    const engine = newEngine();

    await expect(
      engine.applyCommand("player-a", { name: "unbolt", args: {} }, STAMP),
    ).rejects.toThrow(
      /touch, touchAll, visit, finish, stamp, who, tearRoom, tearAcross, tearRemove, tearBetween, tearOwn, misroute, strand, reachAndWrite, throwToken, tick, decay, clockStamp, clockWho, clockTear/,
    );
  });

  it("refuses a player it does not seat", async () => {
    const engine = newEngine();

    await expect(engine.viewFor("player-z")).rejects.toThrow(
      /not in this world/,
    );
  });

  it("reports a write reached through ctx.game rather than losing it (#152, #295)", async () => {
    // WHAT #152 DID, AND WHAT REPLACED IT. The dirty-set contract is
    // "everything a command may have written is reported dirty", and under the
    // flat table it was enforced only through the `partition()` accessor while
    // the same context handed the whole tree over as `game`. An attribute write
    // reaching a resident-but-undeclared partition through `ctx.game` was not
    // refused, not named, and not touched: visible in every view, then silently
    // reverted on eviction or hibernation. #152 closed it by taking the game
    // out of the context altogether.
    //
    // That door cannot stay shut. A world action IS an `ActionDefinition`, so
    // its context is the engine's own `{game, player, args}` with `ctx.world`
    // added -- which is the single property that lets one registry and one
    // enumeration serve both backends, and therefore the thing an MCTS bot
    // reaches a world action through. Removing `game` from it would mean a
    // world action was not an action after all.
    //
    // So the guarantee is upheld the other way now, and this is the case that
    // says so: BoardSmith marks every element its own queries and accessors
    // hand out, and the dirty pass runs over the partitions the action REACHED
    // (#295). A write through the raw game is therefore reported and
    // checkpointed rather than being made unreachable -- which is a stronger
    // promise than the removal was, because it also covers the room a handler
    // legitimately reaches past its declaration to touch.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touchAll", args: {} }, STAMP);

    const result = await engine.applyCommand(
      "player-a",
      { name: "reachAndWrite", args: {} },
      STAMP,
    );

    expect([...result.dirty].sort()).toEqual([ROOM_ONE, ROOM_TWO]);
    const written = await engine.serializePartitions([ROOM_TWO]);
    expect(
      (JSON.parse(written[ROOM_TWO]!) as { attributes: { visits: number } }).attributes.visits,
    ).toBe(8);
  });

  it("refuses a partition the action did not declare", async () => {
    // The undeclared partition is the silent-corruption case: it would not be
    // resident, and it would not be reported dirty either. `ctx.world.partition`
    // is the accessor that hands back a PARTITION ROOT, and it is held to the
    // running declaration -- so an action that reaches for a room it never
    // named is refused BY NAME rather than meeting whatever the last command
    // happened to leave loaded.
    const sneak = worldAction<WorldFixtureGame>("sneak")
      .needs(() => [ROOM_ONE])
      .execute((_args, ctx) => {
        ctx.world.partition(ROOM_TWO);
      });
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [...ACTIONS, sneak],
      view: () => [],
    });

    await expect(
      engine.applyCommand("player-a", { name: "sneak", args: {} }, STAMP),
    ).rejects.toThrow(/did not declare/);
  });
});

/** The one verb that writes to the game root's message log. */
const gossip = worldAction<WorldFixtureGame>("gossip")
  .needs(() => [ROOM_ONE])
  .execute((_args, ctx) => {
    ctx.game.message("gossip travels");
    ctx.world.emit(ROOM_ONE, {});
  });

describe("#163 — a world has no message-log surface", () => {
  /** An engine whose one action writes to the game root's message log, plus
   *  the game itself so the test can measure what stays resident. */
  function gossipWorld() {
    const game = newWorldGame();
    const engine = new BoardSmithWorldEngine({
      game,
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [gossip],
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
  it("REFUSES an action whose needs() writes, and leaves the world alone", async () => {
    // The declaration runs BEFORE the rollback snapshot, so the write was
    // captured into the snapshot rather than covered by it: a later refusal
    // "rolled back" to the mutated state and the write survived.
    //
    // KEPT IN AN ENGINE OF ITS OWN, and that is a fact about #169 rather than
    // tidiness: a declaration is now walked by the OFFER path as well as the
    // dispatch path, so an action whose `needs` writes would refuse every
    // enumeration this fixture's other cases make -- including the conformance
    // suite's, which asks what seat one can do here.
    const writing = worldAction<WorldFixtureGame>("declareAndWrite")
      .needs(({ game }) => {
        const room = game.first(Room, "room-one");
        if (room) room.visits = 500;
        return [ROOM_ONE];
      })
      .execute(() => {});
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [touch, writing],
      view: () => [],
    });
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "declareAndWrite", args: {} }, STAMP),
    ).rejects.toThrow(/A declaration tried to write/);

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
      actions: ACTIONS,
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
      engine.onEvent({ name: "clockTear", args: {} }, { due: 1_000, missedCount: 0 }, EVENT_STAMP),
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
      engine.applyCommand("player-a", { name: "tearOwn", args: { aim: "room-one" } }, STAMP),
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
      engine.commandPartitions("player-a", { name: "tearOwn", args: { aim: "room-one" } }, STAMP.now),
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
        activity: STAMP.activity,
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
      { name: "clockStamp", args: {} },
      { due: 5_000, missedCount: 0 },
      EVENT_STAMP,
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
        activity: STAMP.activity,
      },
    );
    expect(result.events[0]!.payload).toEqual({ online: [1, 2] });
  });

  it("hands a SCHEDULED event the presence stamp too -- the 03:00 raid can ask who is watching", async () => {
    // The clock's road carries the same fact: a due event drained over an
    // empty world is told nobody is here, rather than remembering somebody.
    const engine = newEngine();
    const result = await engine.onEvent(
      { name: "clockWho", args: {} },
      { due: 5_000, missedCount: 0 },
      EVENT_STAMP,
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
      actions: ACTIONS,
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

describe("#181 — a view carries the seat it is for, not the world's roster", () => {
  // #183 made a view's content a function of the seat's DECLARATION rather
  // than of what other players left resident, and one thing escaped it: the
  // game root's player list is in no partition, so pruning partitions never
  // touched it. Measured on example-rts at 500 seats, a seat whose declaration
  // named two partitions got a view whose root had 502 children -- 500
  // `Player`s, the commons, and one holding. That is O(world) per view, per
  // look, which is the exact cost the partitioned model exists to delete.
  //
  // What makes dropping them safe is that a player-valued attribute is not a
  // pointer at a node: example-rts writes
  // `holding.player = this.players[seat - 1]`, and that serializes as
  // `{ __playerRef, seat, color, name }` -- resolved by SEAT, with the facts a
  // board reads carried inline. The two tests below are the two halves of that:
  // the roster is gone, and the reference into it still says everything it said.
  const POPULATION = 500;

  async function villageView(seat: number): Promise<ElementJSON> {
    const { engine } = newVillageEngine([], worldBudgets(), POPULATION);
    const view = (await engine.viewFor(`p${seat}`)) as { state: ElementJSON };
    return view.state;
  }

  const playersIn = (state: ElementJSON): ElementJSON[] =>
    (state.children ?? []).filter((child) => child.className === "Player");

  it("a 500-seat village's view root does not grow with the village", async () => {
    const state = await villageView(1);
    // The commons, this seat's holding, and this seat. Before the fix: 502.
    expect(state.children).toHaveLength(3);
    expect(playersIn(state).map((player) => player.attributes.seat)).toEqual([1]);
  });

  it("a view's size is the same at 500 seats as at 6", async () => {
    // The claim stated as a measurement rather than a number: two villages
    // whose only difference is population project the same root.
    const { engine: small } = newVillageEngine([], worldBudgets(), 6);
    const smallView = (await small.viewFor("p1")) as { state: ElementJSON };
    expect((await villageView(1)).children).toHaveLength(smallView.state.children?.length ?? 0);
  });

  it("a dropped player's reference still carries who they were", async () => {
    // Seat 7's holding names seat 7, and seat 3's names seat 3. Looking as
    // seat 7, seat 3's element is gone -- and nothing about seat 7's own
    // reference lost anything, because the reference never pointed at a node.
    const state = await villageView(7);
    const holding = (state.children ?? []).find((child) => child.className === "Holding");
    expect(holding?.attributes.player).toMatchObject({ __playerRef: 7, seat: 7 });
  });

  it("keeps a player that a named partition was adopted underneath", async () => {
    // The path rule, which is the one shape a roster prune must not break: a
    // partition living under a player element would go with the player.
    const game = newWorldGame();
    const roomOne = game.create(Room, "room-one");
    const underPlayer = game.players[1].create(Room, "room-two");
    const engine = new BoardSmithWorldEngine({
      game,
      seats: new Map([
        ["player-a", 1],
        ["player-b", 2],
      ]),
      store: new CountingStore(new Map()),
      actions: ACTIONS,
      view: () => [ROOM_ONE, ROOM_TWO],
    });
    engine.registerResident(ROOM_ONE, roomOne);
    engine.registerResident(ROOM_TWO, underPlayer);

    const view = (await engine.viewFor("player-a")) as { state: ElementJSON };
    expect(JSON.stringify(view.state)).toContain("room-two");
  });
});

describe("#186 — a world can say something a player reads", () => {
  // `WorldNarration.text` has documented the shared shell's log since #170 and
  // no world could ever fill it: `emit` took a scope and a payload, the engine
  // recorded exactly those two keys, and the shell's log filters on a `text`
  // that was `undefined` on every event any world could produce. Measured in
  // sotf: three narrations with sentences in their payloads, and a LOG of 0.
  //
  // The payload stays the board's and stays uninterpretable between the rules
  // and the game's own UI -- so the sentence is its own argument, and a world
  // that writes one is saying it to the SHELL rather than hoping the shell
  // parses the board's shape.
  const say = worldAction<WorldFixtureGame>("say")
    .needs(() => [ROOM_ONE])
    .execute((_args, ctx) => {
      const room = ctx.game.room("room-one");
      room.visits += 1;
      ctx.world.emit(ROOM_ONE, { visits: room.visits }, "Somebody swept the room.");
    });

  const proclaim = worldAction<WorldFixtureGame>("proclaim")
    .needs(() => [ROOM_ONE])
    .execute((_args, ctx) => {
      ctx.world.emit(
        ROOM_ONE,
        {},
        { text: "The hearth is lit.", type: "highlight" },
      );
    });

  function sayingEngine() {
    return new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [say, proclaim, touch],
      view: () => [ROOM_ONE],
    });
  }

  it("carries the sentence out with the routed event", async () => {
    const engine = sayingEngine();
    await engine.hydrate([ROOM_ONE]);
    const result = await engine.applyCommand("player-a", { name: "say", args: {} }, STAMP);

    expect(result.events[0]).toMatchObject({
      scope: ROOM_ONE,
      payload: { visits: 1 },
      text: "Somebody swept the room.",
    });
    // The audience is still the engine's answer, unchanged by the sentence.
    expect(result.events[0]?.seats).toEqual([1]);
  });

  it("carries the line's kind when the game names one", async () => {
    const engine = sayingEngine();
    await engine.hydrate([ROOM_ONE]);
    const result = await engine.applyCommand("player-a", { name: "proclaim", args: {} }, STAMP);

    expect(result.events[0]).toMatchObject({ text: "The hearth is lit.", type: "highlight" });
  });

  it("says nothing when the game wrote nothing -- absent, not empty", async () => {
    // The shell puts no line in the log for an event with no `text`, and an
    // empty string would be a blank line rather than silence.
    const engine = sayingEngine();
    await engine.hydrate([ROOM_ONE]);
    const result = await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    expect(result.events[0]).not.toHaveProperty("text");
    expect(result.events[0]).not.toHaveProperty("type");
  });
});

/**
 * #191 -- A GAME'S OWN REFUSAL KEEPS ITS SENTENCE, AND A BUG STILL DOES NOT.
 *
 * The failure this closes: `kindle {logs: 14}` in example-rts came back as
 * "could not be completed because of an error in the game's rules". The game
 * had a real sentence and the player never saw it.
 *
 * #169 deliberately left a game's own refusal travelling unclassified, and that
 * stands -- a code out of `WORLD_REFUSALS` would relabel every bug in a game's
 * rules as one of the platform's words. What was missing was not a code but the
 * channel the engine already has for "this text was written to be read", and
 * these two cases are the whole of it: `PlayerFacingError` travels VERBATIM,
 * and anything else is replaced, because an accidental `TypeError` must not
 * reach a player.
 *
 * A world dispatch is the path being asserted, not `executeAction` -- which
 * `action.test.ts` already covers. The world re-throws a failed result so the
 * rollback runs, and the sentence has to survive that re-throw to be worth
 * anything.
 */
describe("#191 — a refusal written for a player reaches one", () => {
  const SENTENCE = "The hearth is full: it holds 3 logs and you offered 14.";

  it("carries a PlayerFacingError's sentence out of a world dispatch, verbatim", async () => {
    const engine = newEngine();

    const refusal = await engine
      .applyCommand("player-a", { name: "refuseInWords", args: {} }, STAMP)
      .then(() => null, (error: unknown) => (error as Error).message);

    // EXACTLY the game's own words, with nothing of the platform's wrapped
    // around them. `toContain` would pass on the generic sentence in a dev
    // environment, where the raw text rides along in parentheses.
    expect(refusal).toBe(SENTENCE);
  });

  it("replaces a plain Error's, which may be an accident rather than a refusal", async () => {
    const engine = newEngine();

    const refusal = await engine
      .applyCommand("player-a", { name: "refuseUnreadably", args: {} }, STAMP)
      .then(() => null, (error: unknown) => (error as Error).message);

    // The player is given the platform's sentence and not the game's. In THIS
    // environment -- positively labelled `test` -- the raw text also rides
    // along in parentheses for the author's benefit, which is why the claim is
    // about what the message IS rather than about what it contains: a deployed
    // isolate is not labelled dev or test, drops that parenthesis, and this
    // assertion holds either way.
    expect(refusal).not.toBe(SENTENCE);
    expect(refusal).toContain("error in the game's rules");
  });

  it("leaves the world unchanged either way, because a refusal is still a refusal", async () => {
    // The sentence is the only thing #191 changes. A `PlayerFacingError` is
    // thrown out of `execute` exactly as a plain one is, so it must ride the
    // same #68 rollback -- otherwise the readable refusals would be the ones
    // that quietly kept half their changes.
    const engine = newEngine();
    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);

    await expect(
      engine.applyCommand("player-a", { name: "refuseInWordsAfterWriting", args: {} }, STAMP),
    ).rejects.toThrow(SENTENCE);

    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(1);
  });
});

describe("#374 — a declaration reaches a partition BY NAME, not by walking the tree", () => {
  // The offer path re-runs every declaration on every refresh. A declaration
  // that can only find a resident root by asking the GAME for it -- the
  // documented `game.first(Class, name)` -- pays a walk of the whole resident
  // tree, through the read-only projection, once per round per refresh. At 500
  // seats that is the seconds #374 measured, for a question the engine already
  // holds the answer to: `residentIds` maps the name straight to the id.
  //
  // The accessor is the SAME `WorldResidency` a bundle's `view(seat, world)`
  // and a command's `execute` already receive. What was missing was the wiring,
  // not the concept, which is why this reads as an omission rather than a new
  // surface.

  /** Round two reads what round one made resident, by name. */
  const named = (record: (root: Room | undefined) => void) =>
    worldAction<WorldFixtureGame>("readByName")
      .needs(() => [ROOM_ONE])
      .needs(({ world }) => {
        record(world.partition(ROOM_ONE) as Room | undefined);
        return [ROOM_ONE];
      })
      .execute(() => {});

  function engineFor(action: ReturnType<typeof named>) {
    return new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [touch, action],
      view: () => [],
    });
  }

  it("hands a declaration the resident root the game holds under that name", async () => {
    let seen: Room | undefined;
    const engine = engineFor(named((root) => (seen = root)));

    await engine.applyCommand(
      "player-a",
      { name: "readByName", args: {} },
      STAMP,
    );

    expect(seen?.name).toBe("room-one");
  });

  it("hands it READ-ONLY, exactly as the view path is handed one (#219)", async () => {
    // The accessor projects, so the write a declaration must not make is
    // refused here for the same reason it is refused through `game`. An
    // indexed path that skipped the projection would be a hole with a shortcut
    // in front of it.
    const engine = engineFor(
      named((root) => {
        if (root) root.visits = 500;
      }),
    );

    await expect(
      engine.applyCommand("player-a", { name: "readByName", args: {} }, STAMP),
    ).rejects.toThrow(/A declaration tried to write/);
    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(0);
  });

  it("answers undefined for a partition that is not resident yet", async () => {
    // The honest answer while a root is still absent, and the same one
    // `WorldResidency` gives the view path. A throw here would make the first
    // round of every declaration a special case for the bundle to branch on.
    let seen: Room | undefined | "unset" = "unset";
    const asking = worldAction<WorldFixtureGame>("askEarly")
      .needs(({ world }) => {
        seen = world.partition(ROOM_TWO) as Room | undefined;
        return [ROOM_ONE];
      })
      .execute(() => {});
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [touch, asking],
      view: () => [],
    });

    await engine.applyCommand("player-a", { name: "askEarly", args: {} }, STAMP);

    expect(seen).toBeUndefined();
  });
});

describe("#375 — a declaration is stamped with the instant it is being made at", () => {
  // `execute` has had the authoritative clock since #57: `ctx.world.now` is the
  // platform's stamped arrival, because `Date.now()` inside the isolate is the
  // EXECUTION instant and `args` is the client's own frame. A DECLARATION had
  // neither. It ran before the clock existed on its context at all.
  //
  // That is the same asymmetry #374 closed for `world.partition`, and it costs
  // the same thing: a game whose partitions are TIMED -- a market of private
  // contracts, each due at its own instant -- cannot name the due ones. Its
  // only correct move is to declare every active contract there is, which is
  // O(world) in the one mode whose whole argument is that a command costs
  // O(room).
  //
  // The instant is the dispatch's own: a command's stamped arrival, and a
  // scheduled event's `due`. Not `presence`, deliberately -- what a declaration
  // may name must not depend on who happens to be connected, or two watchers
  // of one world would disagree about what is resident.

  const stamped = (record: (now: number) => void) =>
    worldAction<WorldFixtureGame>("stamped")
      .needs(({ world }) => {
        record(world.now);
        return [ROOM_ONE];
      })
      .execute(() => {});

  it("hands a command's declaration the arrival the platform stamped", async () => {
    let seen = -1;
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [touch, stamped((now) => (seen = now))],
      view: () => [],
    });

    await engine.applyCommand("player-a", { name: "stamped", args: {} }, STAMP);

    expect(seen).toBe(STAMP.now);
  });

  it("hands an OFFER's declaration the instant the offer is being made at", async () => {
    // The offer path re-runs every declaration, so it needs the clock for the
    // same reason -- and it must be the offer's own stamp, not the last
    // command's, or a watcher's enumeration would drift behind the world.
    let seen = -1;
    const engine = new BoardSmithWorldEngine({
      game: newWorldGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [stamped((now) => (seen = now))],
      view: () => [],
    });
    const at = STAMP.now + 90_000;

    for (;;) {
      const needs = engine.offerPartitions("player-a", at);
      if (needs.length === 0) break;
      await engine.hydrate(needs);
    }

    expect(seen).toBe(at);
  });
});

describe("#381 — a resident-root lookup is asked of the root table, not of the tree", () => {
  // `residentIds` resolves a declared name to an id in one map read, and then
  // the accessor spent the saving it had just made: it handed the id to
  // `getElementById`, a depth-first walk of the whole resident world. So the
  // read-only door that #374 opened by NAME still cost O(resident) per look,
  // and a declaration that reads three roots per round paid three walks of
  // every seat, every token and every card resident at that moment.
  //
  // Measured in a 500-seat world with one colony hydrated: 2.4 s to declare
  // and 2.2 s to evaluate one refresh of nine offers, with 1.8 s of that in
  // `atId` alone. The engine's own `rootOf` had already stopped doing this in
  // #316 -- `Game#partitionRoot` is a direct reference the engine holds -- and
  // the read-only accessor simply never got the same treatment.
  //
  // The cases below pin the SHAPE, not a millisecond: no tree search at all,
  // and every answer the walk used to give unchanged. A timing assertion on a
  // shared machine is noise.

  /** Counts the tree walks, so "no search" is measurable rather than asserted. */
  class SearchCountingGame extends WorldFixtureGame {
    searches = 0;
    override getElementById(id: number): GameElement | undefined {
      this.searches += 1;
      return super.getElementById(id);
    }
  }

  function countingGame(): SearchCountingGame {
    return new SearchCountingGame({
      playerCount: 4,
      seed: "world-fixture",
      worldMode: true,
    });
  }

  /** Round two reads a resident root by name, exactly as #374 wired it. */
  function readerFor(record: (root: Room | undefined) => void) {
    return worldAction<WorldFixtureGame>("readByName")
      .needs(() => [ROOM_ONE])
      .needs(({ world }) => {
        record(world.partition(ROOM_ONE) as Room | undefined);
        return [ROOM_ONE];
      })
      .execute(() => {});
  }

  it("finds the declared root without searching the tree", async () => {
    const game = countingGame();
    const engine = new BoardSmithWorldEngine({
      game,
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [touch, readerFor(() => {})],
      view: () => [],
    });

    await engine.applyCommand("player-a", { name: "readByName", args: {} }, STAMP);
    const afterHydration = game.searches;
    game.searches = 0;

    // A second command over the SAME resident root: nothing left to adopt, so
    // every remaining look is the accessor's own.
    await engine.applyCommand("player-a", { name: "readByName", args: {} }, STAMP);

    expect(game.searches).toBe(0);
    // The first command is allowed its adoption bookkeeping; what it must not
    // be is unbounded in the resident set.
    expect(afterHydration).toBeLessThanOrEqual(2);
  });

  it("asks the view path's lookup of the root table too", async () => {
    const game = countingGame();
    const engine = new BoardSmithWorldEngine({
      game,
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: ACTIONS,
      view: (_seat, world) => {
        void (world.partition(ROOM_ONE) as Room | undefined)?.visits;
        return [ROOM_ONE];
      },
    });

    await engine.viewFor("player-a");
    await engine.viewFor("player-a");
    game.searches = 0;

    await engine.viewFor("player-a");

    expect(game.searches).toBe(0);
  });

  it("still answers with the live root, read-only, and undefined when absent", async () => {
    // The three answers the walk gave. An index that served a different one --
    // a stale object, a writable root, a throw for an absent name -- would be
    // a faster wrong answer.
    let seen: Room | undefined | "unset" = "unset";
    let absent: Room | undefined | "unset" = "unset";
    const engine = new BoardSmithWorldEngine({
      game: countingGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [
        touch,
        worldAction<WorldFixtureGame>("readByName")
          .needs(({ world }) => {
            absent = world.partition(ROOM_TWO) as Room | undefined;
            return [ROOM_ONE];
          })
          .needs(({ world }) => {
            seen = world.partition(ROOM_ONE) as Room | undefined;
            return [ROOM_ONE];
          })
          .execute(() => {}),
      ],
      view: () => [],
    });

    await engine.applyCommand("player-a", { name: "readByName", args: {} }, STAMP);

    expect(absent).toBeUndefined();
    expect(seen).not.toBe("unset");
    expect((seen as unknown as Room | undefined)?.name).toBe("room-one");
  });

  it("refuses a declaration's write through the indexed door as well (#219)", async () => {
    const engine = new BoardSmithWorldEngine({
      game: countingGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [
        touch,
        readerFor((root) => {
          if (root) root.visits = 500;
        }),
      ],
      view: () => [],
    });

    await expect(
      engine.applyCommand("player-a", { name: "readByName", args: {} }, STAMP),
    ).rejects.toThrow(/A declaration tried to write/);
    expect(visitsIn(await engine.serializePartitions([ROOM_ONE]))).toBe(0);
  });

  it("serves the RE-ADOPTED root after an eviction, never the evicted one", async () => {
    // The index holds object references, so the one failure mode a name-to-id
    // map does not have is handing back an object the platform has since
    // dropped. Evict, re-hydrate from the store, and the accessor must answer
    // with the new tree -- carrying the writes the checkpoint kept.
    let seen: Room | undefined;
    const engine = new BoardSmithWorldEngine({
      game: countingGame(),
      seats: new Map([["player-a", 1]]),
      store: new CountingStore(genesis()),
      actions: [touch, readerFor((root) => (seen = root))],
      view: () => [],
    });

    await engine.applyCommand("player-a", { name: "touch", args: {} }, STAMP);
    await engine.applyCommand("player-a", { name: "readByName", args: {} }, STAMP);
    const before = seen;

    engine.evict([ROOM_ONE]);
    await engine.applyCommand("player-a", { name: "readByName", args: {} }, STAMP);

    expect(seen).toBeDefined();
    expect(seen).not.toBe(before);
    expect(seen?.name).toBe("room-one");
  });
});

// ShufflewickPub #399: A CHAIR CAN BE GIVEN BACK.
//
// The roster used to be add-only, which made a departed player's chair
// unreclaimable from here: a host that wanted one back had to throw the whole
// isolate away and rebuild it from a roster that omitted them. On a platform
// that caps a world's LIFETIME isolates that is not an implementation, it is a
// world that stops working after a handful of departures -- so the roster
// shrinks now, and these are the two halves of what shrinking has to mean.
describe("retiring a seat's holder (ShufflewickPub #399)", () => {
  const tend = worldAction<VillageFixture>("tend")
    .needs(({ player }) => [holdingPartition(player.seat)])
    .execute((_args, ctx) => {
      (ctx.world.partition(holdingPartition(ctx.player.seat)) as Holding).standing += 1;
    });

  it("forgets the mapping, so a command for a retired holder is unknown-player", async () => {
    // NOT "runs against whoever holds the chair now", which is the failure this
    // exists to prevent: the seat number is about to be handed on, and a
    // command still resolving through the old holder would reach the new one's
    // ground.
    const { engine } = newVillageEngine([tend]);
    engine.unseat("p2");

    // Thrown where the seat is resolved, which is before the declaration walk
    // begins, so it arrives synchronously rather than as a rejected promise.
    let refused: unknown;
    try {
      await engine.commandPartitions("p2", { name: "tend", args: {} }, 0);
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({ code: "unknown-player" });
  });

  it("frees the chair for somebody else, which a live roster could not do before", async () => {
    // THE WHOLE POINT. `seat` refuses to MOVE a seated player, so seat 2 could
    // not be reissued while p2 still held it -- and the only way out was a
    // rebuilt engine.
    const { engine } = newVillageEngine([tend]);
    engine.unseat("p2");
    engine.seat("newcomer", 2);

    expect(await engine.commandPartitions("newcomer", { name: "tend", args: {} }, 0)).toEqual([
      holdingPartition(2),
    ]);
  });

  it("lets a retired holder come back to a DIFFERENT chair", async () => {
    // The case a stale mapping breaks and nothing else would catch: `seat`
    // answers `seat-conflict` for a player it still knows, so a returning
    // leaver given a fresh chair would have been refused at the door by an
    // engine that had merely been told to forget them badly.
    const { engine } = newVillageEngine([tend]);

    // WHILE THEY ARE STILL SEATED this is a refusal, and rightly: moving a
    // seated player would hand them somebody else's holdings.
    expect(() => engine.seat("p2", 3)).toThrow(/already plays seat/);

    engine.unseat("p2");
    expect(() => engine.seat("p2", 3)).not.toThrow();
  });

  it("is idempotent, so a host retrying a departure is not the failure", () => {
    const { engine } = newVillageEngine([tend]);
    engine.unseat("p2");
    expect(() => engine.unseat("p2")).not.toThrow();
    expect(() => engine.unseat("never-sat-here")).not.toThrow();
  });

  it("moves NOTHING in the world: the ground behind the chair stands", async () => {
    // A seat is a chair and a chair is not a castle. Returning the ground is
    // the GAME's, through the verb it declares as `world.vacate`, and this
    // engine deliberately cannot tell whether that has happened -- which is
    // exactly why the ordering is the host's to keep.
    const { engine, store } = newVillageEngine([tend]);
    const before = await store.read(holdingPartition(2));
    expect(before).toBeDefined();

    engine.unseat("p2");

    expect(await store.read(holdingPartition(2))).toEqual(before);
    // And the chair's next holder reaches that same standing ground, which is
    // the danger stated as an assertion: retiring a seat is not a cleanup.
    engine.seat("newcomer", 2);
    expect(await engine.commandPartitions("newcomer", { name: "tend", args: {} }, 0)).toEqual([
      holdingPartition(2),
    ]);
  });
});

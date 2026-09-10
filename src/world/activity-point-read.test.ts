/**
 * ShufflewickPub #423: A DECLARED POINT READ, FOR A SEAT THE WORLD NAMES.
 *
 * #383 hands a dispatch the watermark for the seat the dispatch BELONGS TO --
 * the acting seat on a player's road, the owner of a scheduled event on the
 * clock's. That answers "has this player been away", and it cannot answer the
 * three questions an occupied world's own lifecycle asks:
 *
 *   AN EXISTING EMPIRE NOBODY WILL EVER COME BACK TO. A world upgraded with
 *     five hundred empires in it holds no seat-owned timer for any of them, and
 *     nothing may arm one on their behalf: a schedule's owner is stamped from
 *     the acting seat, so arming a seat-owned deadline requires the seat to
 *     act, which is exactly what an abandoned empire will never do. The audit
 *     has to be the WORLD's, and a world-owned event is about nobody.
 *   A SUCCESSOR, WHICH IS A FACT ABOUT SOMEBODY ELSE. "The most recently active
 *     eligible member" is not a question the destroyed leader's own stamp can
 *     answer, and presence cannot order a set of people who are all offline.
 *   A RECHECK BEFORE SOMETHING IRREVERSIBLE. The countdown a world-owned audit
 *     armed is charged to the world, so when it fires #383 hands it null. A
 *     timestamp the game copied into the schedule row when it armed it is a
 *     memory, and what has to be rechecked is precisely whether that memory is
 *     still true.
 *
 * So a phase SAYS WHICH SEAT IT IS ABOUT, on the same declaration walk it
 * already uses to say which partitions it will touch, and the host answers one
 * point read per declared seat. That shape is forced rather than chosen: the
 * engine runs in a child isolate that can see no store, so a watermark can only
 * arrive as an argument -- and an argument can only be supplied for something
 * named before the handler ran.
 *
 * FOUR PROPERTIES THIS FILE PINS, AND ALL FOUR ARE THE POINT:
 *
 * IT IS THE CLOCK'S ROAD ONLY. `.about()` exists on `worldClockAction` and
 * nowhere else, and a seated action carrying an activity round is refused at
 * engine construction -- the same two-site enforcement `seatless` itself gets.
 * A player's command therefore has no road to another seat's watermark at all.
 *
 * ONE SEAT PER ROUND, so the total is the action's own source. There is no
 * all-seat enumeration and no way to write one: `.about()` answers a seat or
 * nothing, and a fan-out would have to be as many `.about()` calls as there are
 * empires, written out in the bundle, in the open.
 *
 * AN UNDECLARED SEAT IS REFUSED, exactly as an undeclared partition is. What a
 * handler may read is what its walk named, so a dispatch's cost is knowable
 * from the declaration rather than from what the handler decided to ask about
 * once it was already running.
 *
 * THE ANSWER SAYS WHOSE CHAIR IT IS. `tenancy` is the one fact about a seat
 * number that the game cannot hold for itself, and the three values are the
 * three the host can actually vouch for: somebody holds it, nobody holds it, or
 * its holder's account was erased (#399, #410).
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import type { ActionDefinition } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import { worldAction, worldClockAction, type WorldNeedsRound } from "./action.js";
import type {
  DeclaredSeatActivity,
  DeclaredSeatActivityStamp,
  SeatTenancy,
  StoredPartition,
} from "./contract.js";

class Room extends Space<Demo> {
  /** Which seat the next occurrence of a sweep is about. */
  cursor = 0;
  /** The best candidate the sweep has found, and the evidence for it. */
  bestSeat = 0;
  bestAt = 0;
  /** Set by `destroy` when it really did the irreversible thing. */
  destroyed = 0;
}

class Demo extends Game<Demo> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Room]);
  }
}

/** What the last dispatch read, so a test can see a facility that is otherwise
 *  visible only from inside a handler. */
let seen: DeclaredSeatActivity | null = null;
/** What `report` found in the world's durable state, so a case can prove a
 *  sweep's evidence survived a cold wake without reading inside the bytes. */
let reported: { destroyed: number; bestSeat: number; bestAt: number } = {
  destroyed: 0,
  bestSeat: 0,
  bestAt: 0,
};

const DAY = 86_400_000;
const OPENED = 1_700_000_000_000;
const TWENTY_DAYS = 20 * DAY;

/**
 * THE WORLD-OWNED AUDIT: the shape all three missing paths are written in.
 *
 * Round one names the ledger, because the seat this occurrence is about is
 * itself world state -- a cursor, so an occupied world is swept one empire per
 * wake rather than enumerated in one call. The activity round then names that
 * seat, and the round after it names the empire's own partition, which is only
 * knowable once the cursor has been read.
 */
const audit = worldClockAction<Demo>("audit")
  .needs(() => ["hall"])
  .about(({ world }) => (world.partition("hall") as Room).cursor)
  .needs(({ world }) => [`empire:${(world.partition("hall") as Room).cursor}`])
  .execute((_args, { world }) => {
    seen = world.activityOf((world.partition("hall") as Room).cursor);
  });

/** The countdown a world-owned audit armed: charged to the world, about a
 *  person, and it must recheck before it destroys anything. */
const destroy = worldClockAction<Demo>("destroy")
  .needs(() => ["hall"])
  .about(({ args }) => Number(args.seat))
  .execute((args, { world }) => {
    const seat = Number(args.seat);
    const stamp = world.activityOf(seat);
    seen = stamp;
    const idle = world.now - stamp.inactiveSince;
    if (idle < TWENTY_DAYS) {
      // They came back before the overdue deadline drained. Re-arm against the
      // watermark the host just answered, and destroy nothing.
      world.schedule({
        key: `destroy:${seat}`,
        delayMs: TWENTY_DAYS - idle,
        action: "destroy",
        args: { seat },
      });
      return;
    }
    (world.partition("hall") as Room).destroyed = seat;
  });

/**
 * ONE PHASE OF A SUCCESSOR SWEEP, resumed through a durable cursor.
 *
 * The evidence is kept VERBATIM -- the instant itself, not a rank and not a
 * boolean -- because the next phase compares against it after a cold wake, and
 * a sweep that stored "was better" could not.
 */
const elect = worldClockAction<Demo>("elect")
  .needs(() => ["roll"])
  .about(({ world }) => {
    const roll = world.partition("roll") as Room;
    // NOTHING LEFT TO ASK ABOUT is an answer. The last phase of a sweep runs
    // off the end of the roster and must not be forced to name a chair it has
    // no reason to read.
    return roll.cursor > 3 ? null : roll.cursor;
  })
  .execute((_args, { world }) => {
    const roll = world.partition("roll") as Room;
    if (roll.cursor > 3) return;
    const stamp = world.activityOf(roll.cursor);
    seen = stamp;
    // AN ERASED OR EMPTY CHAIR IS NOT AN ELIGIBLE SUCCESSOR, and `tenancy` is
    // the only thing that says so: an empty chair's watermark was deleted with
    // it, so it reads exactly like an empire that has been quiet since the
    // upgrade.
    if (stamp.tenancy === "held" && stamp.inactiveSince > roll.bestAt) {
      roll.bestSeat = stamp.seat;
      roll.bestAt = stamp.inactiveSince;
    }
    roll.cursor += 1;
  });

/** Read the world back, from bytes, with no activity round anywhere: what a
 *  case asserts on is the state a previous phase checkpointed. */
const report = worldClockAction<Demo>("report")
  .needs(() => ["hall", "roll"])
  .execute((_args, { world }) => {
    const hall = world.partition("hall") as Room;
    const roll = world.partition("roll") as Room;
    reported = { destroyed: hall.destroyed, bestSeat: roll.bestSeat, bestAt: roll.bestAt };
  });

/** A phase that reads a chair its walk never named. The refusal is the point. */
const peek = worldClockAction<Demo>("peek")
  .needs(() => ["hall"])
  .about(() => 1)
  .execute((_args, { world }) => {
    seen = world.activityOf(2);
  });

const definition = {
  gameClass: Demo,
  gameType: "demo",
  world: {
    maxPlayers: 4,
    actions: [audit, destroy, elect, report, peek],
    genesis: (game: Game) => {
      const hall = game.create(Room, "hall");
      // The audit's sweep is mid-flight on seat 2 -- an established empire that
      // has never acted since this world began recording.
      hall.cursor = 2;
      const roll = game.create(Room, "roll");
      roll.cursor = 1;
      return { hall, "empire:2": game.create(Room, "empire2"), roll } as Record<
        string,
        GameElement
      >;
    },
    view: () => ["hall"],
  },
} as WorldRunnerOptions["definition"];

const SEATS = new Map([
  ["p1", 1],
  ["p2", 2],
  ["p3", 3],
]);

function world() {
  return createWorld({ definition, seed: "point-read", seats: SEATS }).runner;
}

/** A stamp as a HOST answers one: the facts, with no fallback applied. */
function stamp(
  seat: number,
  at: number | null,
  since = OPENED,
  tenancy: SeatTenancy = "held",
): DeclaredSeatActivityStamp {
  return { seat, at, since, tenancy };
}

/**
 * DRIVE ONE CLOCK DISPATCH THE WAY A HOST DOES.
 *
 * Declare, answer what the walk named, declare again, and apply with everything
 * the walk collected. The activity legs are answered by one point read per
 * declared seat -- exactly what a host's store does -- and the answers
 * ACCUMULATE across rounds, because the host is the side that remembers them:
 * the child holds no store, and must not hold a watermark between calls either.
 */
async function drain(
  runner: Awaited<ReturnType<typeof world>>,
  bytes: Record<string, StoredPartition>,
  options: {
    name: string;
    args?: Record<string, unknown>;
    due: number;
    activityOf?: (seat: number) => DeclaredSeatActivityStamp;
  },
) {
  const command = { name: options.name, args: options.args ?? {} };
  const declared: DeclaredSeatActivityStamp[] = [];
  const asked: number[] = [];
  let supplied: Record<string, StoredPartition> = {};
  for (;;) {
    const needs = await runner.declare(command, null, supplied, options.due, declared);
    if (needs.partitions.length === 0 && needs.seats.length === 0) break;
    supplied = {};
    for (const name of needs.partitions) {
      const stored = bytes[name];
      if (stored === undefined) throw new Error(`test store has no partition "${name}"`);
      supplied[name] = stored;
    }
    for (const seat of needs.seats) {
      asked.push(seat);
      declared.push((options.activityOf ?? ((one) => stamp(one, null)))(seat));
    }
  }
  const result = await runner.apply({
    player: null,
    command,
    timing: { due: options.due, missedCount: 0 },
    arrivedAt: options.due,
    allowance: { unkeyed: 0, keys: [], worldPending: 0 },
    presence: [] as readonly number[],
    activity: null,
    declaredActivity: declared,
  });
  return { result, asked };
}

/** Genesis, as a host's store would hold it. */
async function launched() {
  const runner = world();
  const genesis = await runner.genesis();
  return { runner, bytes: { ...genesis.partitions } };
}

/** Re-read what a dispatch wrote, so the next phase starts from bytes rather
 *  than from a live tree. */
async function checkpoint(
  runner: Awaited<ReturnType<typeof world>>,
  bytes: Record<string, StoredPartition>,
  dirty: readonly string[],
): Promise<Record<string, StoredPartition>> {
  const written = await runner.serialize(dirty);
  const next = { ...bytes };
  for (const [name, json] of Object.entries(written.partitions)) {
    next[name] = { parentId: bytes[name]!.parentId, json: JSON.parse(json) as unknown };
  }
  return next;
}

describe("#423 — a world-owned phase declares the seat it asks about", () => {
  it("answers an EXISTING seat that will never return, with no player command anywhere", async () => {
    const { runner, bytes } = await launched();
    const now = OPENED + 40 * DAY;

    const { asked } = await drain(runner, bytes, {
      name: "audit",
      due: now,
      activityOf: (seat) => stamp(seat, null, OPENED),
    });

    // ONE point read, for the one seat the phase declared.
    expect(asked).toEqual([2]);
    expect(seen).toEqual({
      seat: 2,
      at: null,
      since: OPENED,
      inactiveSince: OPENED,
      tenancy: "held",
    });
    // Forty days idle, measured from the recording baseline and never from the
    // epoch: the migration promise #383 made, kept on the road #423 adds.
    expect(now - seen!.inactiveSince).toBe(40 * DAY);
  });

  it("lets the round after the activity leg name the partition the seat owns", async () => {
    const { runner, bytes } = await launched();
    // `empire:2` is only nameable once the cursor has been read, and the seat's
    // watermark is only askable once the same round has run. Both are in one
    // walk, in the author's own order.
    const { result } = await drain(runner, bytes, {
      name: "audit",
      due: OPENED,
      activityOf: (seat) => stamp(seat, OPENED),
    });
    expect(result.events).toEqual([]);
    expect(seen!.seat).toBe(2);
  });

  it("refuses a chair the handler did not declare", async () => {
    const { runner, bytes } = await launched();
    // `peek` declares seat 1 and reads seat 2. What a handler may read is what
    // its walk named, exactly as it is for a partition.
    await expect(
      drain(runner, bytes, { name: "peek", due: OPENED }),
    ).rejects.toThrow(/did not declare/);
  });

  it("refuses a host that answers about a different chair", async () => {
    const { runner, bytes } = await launched();
    // Asked about seat 2, answering about seat 3. Refused at the next round
    // rather than looping forever asking for an answer that never arrives.
    await expect(
      drain(runner, bytes, {
        name: "audit",
        due: OPENED,
        activityOf: (seat) => stamp(seat + 1, null),
      }),
    ).rejects.toThrow(/answered about seat 3/);
  });

  it("carries tenancy verbatim, so a vacated chair is not read as a silent empire", async () => {
    const { runner, bytes } = await launched();

    await drain(runner, bytes, {
      name: "audit",
      due: OPENED + 40 * DAY,
      activityOf: (seat) => stamp(seat, null, OPENED, "empty"),
    });

    expect(seen!.tenancy).toBe("empty");
  });

  it("says when a chair's holder was erased, which is not the same as empty", async () => {
    const { runner, bytes } = await launched();

    await drain(runner, bytes, {
      name: "audit",
      due: OPENED + 40 * DAY,
      activityOf: (seat) => stamp(seat, OPENED + 2 * DAY, OPENED, "erased"),
    });

    expect(seen!.tenancy).toBe("erased");
    // The watermark survives the erasure, because it is a fact about the CHAIR.
    expect(seen!.at).toBe(OPENED + 2 * DAY);
  });
});

describe("#423 — an overdue destructive deadline rechecks the real watermark", () => {
  it("re-arms instead of destroying when activity arrived before the deadline drained", async () => {
    const { runner, bytes } = await launched();
    // Armed on day 0 for day 20, drained on day 20, and the seat acted on day
    // 19 -- which the schedule row cannot know and the world's own event is
    // handed no watermark for.
    const { result } = await drain(runner, bytes, {
      name: "destroy",
      args: { seat: 1 },
      due: OPENED + TWENTY_DAYS,
      activityOf: (seat) => stamp(seat, OPENED + 19 * DAY),
    });

    expect(seen!.at).toBe(OPENED + 19 * DAY);
    expect(result.schedules).toEqual([
      { key: "destroy:1", delayMs: 19 * DAY, action: "destroy", args: { seat: 1 } },
    ]);
    const after = await checkpoint(runner, bytes, result.dirty);
    await drain(world(), after, { name: "report", due: OPENED });
    expect(reported.destroyed).toBe(0);
  });

  it("destroys when the watermark still says nobody came back", async () => {
    const { runner, bytes } = await launched();

    const { result } = await drain(runner, bytes, {
      name: "destroy",
      args: { seat: 1 },
      due: OPENED + TWENTY_DAYS,
      activityOf: (seat) => stamp(seat, null, OPENED),
    });

    expect(result.schedules).toEqual([]);
    expect(result.dirty).toContain("hall");
    const after = await checkpoint(runner, bytes, result.dirty);
    await drain(world(), after, { name: "report", due: OPENED });
    expect(reported.destroyed).toBe(1);
  });
});

describe("#423 — a successor is elected through cold bounded continuations", () => {
  it("picks the most recently active eligible member, one member per phase", async () => {
    const watermarks = new Map([
      [1, OPENED + 3 * DAY],
      [2, OPENED + 11 * DAY],
      [3, OPENED + 7 * DAY],
    ]);
    const tenancies = new Map<number, SeatTenancy>([
      [1, "held"],
      [2, "held"],
      [3, "held"],
    ]);
    let bytes = (await launched()).bytes;
    const askedPerPhase: number[][] = [];

    // FOUR PHASES: three members, and the one that runs off the end of the
    // roster and asks about nobody.
    for (let phase = 0; phase < 4; phase++) {
      // A COLD WAKE between every phase. A brand new runner, adopting only the
      // bytes the last phase checkpointed: nothing about the sweep lives in the
      // isolate, so a world evicted mid-election resumes exactly where it was.
      const cold = world();
      const { result, asked } = await drain(cold, bytes, {
        name: "elect",
        due: OPENED + 20 * DAY,
        activityOf: (seat) =>
          stamp(seat, watermarks.get(seat) ?? null, OPENED, tenancies.get(seat) ?? "empty"),
      });
      askedPerPhase.push(asked);
      bytes = await checkpoint(cold, bytes, result.dirty);
    }

    // ONE seat per phase, and none at all once the roster is exhausted.
    expect(askedPerPhase).toEqual([[1], [2], [3], []]);
    await drain(world(), bytes, { name: "report", due: OPENED });
    expect(reported.bestSeat).toBe(2);
    // THE EVIDENCE ITSELF, kept across three cold wakes.
    expect(reported.bestAt).toBe(OPENED + 11 * DAY);
  });

  it("passes over a member whose chair is empty, however quiet the chair looks", async () => {
    const watermarks = new Map([[3, OPENED + 7 * DAY]]);
    const tenancies = new Map<number, SeatTenancy>([
      [1, "empty"],
      [2, "erased"],
      [3, "held"],
    ]);
    let bytes = (await launched()).bytes;

    for (let phase = 0; phase < 3; phase++) {
      const cold = world();
      const { result } = await drain(cold, bytes, {
        name: "elect",
        due: OPENED + 20 * DAY,
        activityOf: (seat) =>
          stamp(seat, watermarks.get(seat) ?? null, OPENED, tenancies.get(seat) ?? "empty"),
      });
      bytes = await checkpoint(cold, bytes, result.dirty);
    }

    await drain(world(), bytes, { name: "report", due: OPENED });
    expect(reported.bestSeat).toBe(3);
  });
});

describe("#423 — the read is the world's own authority, and a seat cannot forge it", () => {
  it("refuses a seated action that declares an activity round", () => {
    // `.about()` is not on the seated builder at all, so this is the shape a
    // bundle would have to hand-craft to reach it -- and it is refused at
    // engine construction, before any player is in the world, exactly as
    // `seatless` itself is.
    const forged = worldAction<Demo>("forge")
      .needs(() => ["hall"])
      .execute(() => {}) as ActionDefinition;
    (forged.world!.needs as WorldNeedsRound[]).push({
      before: 0,
      kind: "activity",
      about: () => 1,
    });

    expect(() =>
      createWorld({
        definition: {
          ...definition,
          world: { ...definition.world, actions: [forged] },
        } as WorldRunnerOptions["definition"],
        seed: "forged",
        seats: SEATS,
      }),
    ).toThrow(/the world's own clock/);
  });

  it("refuses a round that names something that is not a seat", async () => {
    const bad = worldClockAction<Demo>("bad")
      .needs(() => ["hall"])
      .about(() => 1.5)
      .execute(() => {});
    const runner = createWorld({
      definition: {
        ...definition,
        world: { ...definition.world, actions: [bad] },
      } as WorldRunnerOptions["definition"],
      seed: "bad",
      seats: SEATS,
    }).runner;

    const genesis = await runner.genesis();
    await expect(
      drain(runner, { ...genesis.partitions }, { name: "bad", due: OPENED }),
    ).rejects.toThrow(/whole seat number/);
  });
});

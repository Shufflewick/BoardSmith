/**
 * ShufflewickPub #475: THE WORLD'S CLOCK FINALIZES A VACANCY.
 *
 * `world.vacate` names a SEATED verb, and it has to: a vacating is about the
 * sender's own ground, and the worst a player does by sending it is leave. That
 * road is unchanged by everything below.
 *
 * What it cannot do is the one departure nobody sends: a player who never comes
 * back. Their estate is torn down by the world's OWN clock -- a ladder of
 * scheduled occurrences, each its own checkpoint, so a five-hundred-holding
 * empire is not one dispatch -- and at the end of it the chair is empty and
 * there is nobody to say so. A scheduled dispatch may run only a seatless
 * action, a seatless action has no `ctx.player`, and `world.vacate` must name a
 * seated one. There was no third road.
 *
 * `world.vacateByClock` is that road, and the whole of its design is who gets
 * to name the chair:
 *
 * THE GAME NAMES A SEAT NUMBER IT ALREADY DECLARED, AND NOTHING ELSE. The only
 * chair `ctx.world.vacate()` admits is one an `.about()` round asked for and
 * the HOST answered a point read about, in this same dispatch's walk -- the
 * identical admission `activityOf` uses. A bundle cannot name a player id at
 * all: the engine resolves the roster key from its own roster and reports it.
 * So there is nothing to forge with -- no player string reaches the platform
 * from the game, and a chair the host never vouched for has no answer to give.
 *
 * THE HOST'S OWN ANSWER DECIDES WHETHER THERE IS ANYTHING TO RELEASE. An
 * `empty` tenancy is the host saying the chair is already back, and the call is
 * then a no-op rather than a second release -- which is what makes a retried
 * completion release EXACTLY ONCE across a cold wake, without the bundle having
 * to remember anything.
 *
 * AND ONLY THE DECLARED VERB MAY CALL IT. Every other action -- a seat's, and
 * the clock's other phases -- is refused by name, so the verb that frees a
 * chair is a line in the bundle a reviewer can find rather than a call site
 * anywhere in it.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import { worldAction, worldClockAction } from "./action.js";
import { checkpointBytes, drainScheduled } from "./stored-world.test-helper.js";
import type {
  DeclaredSeatActivityStamp,
  SeatTenancy,
  StoredPartition,
  WorldCommandResult,
} from "./contract.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

class Ledger extends Space<Colony> {
  /** What is left of a departed empire, counted down by the teardown ladder. */
  holdings = 0;
  /** How many teardown occurrences have run, so a case can see the ladder took
   *  more than one committed step. */
  passes = 0;
}

class Colony extends Game<Colony> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Ledger]);
  }
}

const OPENED = 1_700_000_000_000;
const DAY = 86_400_000;
/** How much of an estate one occurrence is allowed to take down. */
const PER_PASS = 2;

const estate = (seat: number): string => `estate:${seat}`;

/** The chair this occurrence is for, and the estate standing behind it. Both
 *  clock verbs below open the same door, and they open it the same way. */
function opened(
  args: Record<string, unknown>,
  world: { partition(name: string): unknown },
): { seat: number; held: Ledger } {
  const seat = Number(args.seat);
  return { seat, held: world.partition(estate(seat)) as Ledger };
}

/** A seat's own departure, which is the road #399 already built. Untouched. */
const leave = worldAction<Colony>("leave")
  .needs(({ player }) => [estate(player.seat)])
  .execute((_args, { world, player }) => {
    (world.partition(estate(player.seat)) as Ledger).holdings = 0;
  });

/**
 * ONE BOUNDED CHECKPOINT OF A TEARDOWN, re-arming until the estate is empty.
 *
 * It frees no chair. The release is the ladder's LAST rung and a committed step
 * of its own, so a teardown interrupted at pass two resumes at pass three from
 * bytes rather than starting over.
 */
const teardown = worldClockAction<Colony>("teardown")
  .about(({ args }) => Number(args.seat))
  .needs(({ args }) => [estate(Number(args.seat))])
  .execute((args, { world }) => {
    const { seat, held } = opened(args, world);
    held.holdings = Math.max(0, held.holdings - PER_PASS);
    held.passes += 1;
    world.schedule({
      key: `teardown:${seat}`,
      delayMs: DAY,
      action: held.holdings > 0 ? "teardown" : "reap",
      args: { seat },
    });
  });

/**
 * THE DECLARED VACANCY VERB: the world's proof that the ground is back, and the
 * one call that says so.
 */
const reap = worldClockAction<Colony>("reap")
  .about(({ args }) => Number(args.seat))
  // A SECOND DECLARED CHAIR, for the case that proves one dispatch releases one
  // chair even when both were declared and answered. Null everywhere else,
  // which is the honest shape: one occurrence, one chair.
  .about(({ args }) => (args.twice === undefined ? null : Number(args.twice)))
  .needs(({ args }) => [estate(Number(args.seat))])
  .execute((args, { world }) => {
    const { seat, held } = opened(args, world);
    if (held.holdings > 0) {
      throw new Error(
        `seat ${seat} still holds ${held.holdings} things, so its chair is not free yet`,
      );
    }
    // A CHAIR THE WALK NEVER NAMED, on purpose, for the case that proves the
    // admission. Absent everywhere else, which is every honest bundle.
    world.vacate(args.instead === undefined ? seat : Number(args.instead));
    if (args.twice !== undefined) world.vacate(Number(args.twice));
  });

/**
 * A SEAT'S VERB REACHING FOR THE DOOR ITS TYPE DOES NOT OFFER.
 *
 * `WorldFacilities` carries no `vacate`, so this only compiles through a cast --
 * which is exactly why the rule is enforced at runtime too. It reaches for it
 * from a `condition`, which is the OFFER road: a question, asked once per
 * watcher per refresh, with no checkpoint behind it.
 */
const snoop = worldAction<Colony>("snoop")
  .condition({
    "the world is still here": ({ world }) => {
      (world as unknown as { vacate: (seat: number) => void }).vacate(1);
      return true;
    },
  })
  .needs(() => [])
  .execute(() => {});

/** The clock's other phases may not free a chair, and this is one of them. */
const sweep = worldClockAction<Colony>("sweep")
  .about(({ args }) => Number(args.seat))
  .needs(() => [])
  .execute((args, { world }) => {
    world.vacate(Number(args.seat));
  });

/**
 * A world of three estates. `holdings` says what each seat still stands on, so
 * a case about the vacancy call itself can start from an estate that is already
 * down rather than driving the whole ladder to get there.
 */
function colony(
  actions: readonly unknown[],
  vacancy: Record<string, unknown>,
  holdings: Record<number, number> = { 1: 1, 2: 5, 3: 1 },
) {
  return {
    gameClass: Colony,
    gameType: "colony",
    world: {
      maxPlayers: 4,
      actions,
      genesis: (game: Game) => {
        const roots: Record<string, GameElement> = {};
        for (const seat of [1, 2, 3]) {
          const held = game.create(Ledger, `estate${seat}`);
          held.holdings = holdings[seat] ?? 0;
          roots[estate(seat)] = held;
        }
        return roots;
      },
      view: () => [],
      ...vacancy,
    },
  } as WorldRunnerOptions["definition"];
}

/** The same world with seat 1's estate already down, so `reap` reaches its own
 *  vacancy call rather than refusing on ground that is still standing. */
function razed(vacancy: Record<string, unknown>): WorldRunnerOptions["definition"] {
  return colony([leave, teardown, reap, sweep], vacancy, { 1: 0, 2: 5, 3: 1 });
}

const definition = colony([leave, teardown, reap, sweep], {
  vacate: "leave",
  vacateByClock: "reap",
});

const SEATS = new Map([
  ["p1", 1],
  ["p2", 2],
  ["p3", 3],
]);

function world(built = definition, seats: ReadonlyMap<string, number> = SEATS) {
  return createWorld({ elementIdKey: TEST_WORLD_ELEMENT_ID_KEY, definition: built, seed: "clock-vacancy", seats });
}

/** A stamp as a HOST answers one: its own roster's facts about one chair. */
function stamp(
  seat: number,
  tenancy: SeatTenancy = "held",
  at: number | null = OPENED,
): DeclaredSeatActivityStamp {
  return { seat, at, since: OPENED, tenancy };
}

/** Genesis, as a host's store would hold it. */
async function launched(built = definition) {
  const genesis = await world(built).runner.genesis();
  return { ...genesis.partitions };
}

/**
 * ONE SCHEDULED DISPATCH AND THE CHECKPOINT AFTER IT.
 *
 * `drainScheduled` is the loop; what is here is the COLD world around it -- a
 * runner built fresh from the bytes of the last checkpoint, and the bytes the
 * next pass starts from. That is the only way a multi-checkpoint ladder can be
 * seen at all: a resident tree would carry the previous pass in memory.
 */
async function drain(
  bytes: Record<string, StoredPartition>,
  options: {
    name: string;
    args?: Record<string, unknown>;
    tenancyOf?: (seat: number) => DeclaredSeatActivityStamp;
    built?: WorldRunnerOptions["definition"];
    seats?: ReadonlyMap<string, number>;
  },
): Promise<{ result: WorldCommandResult; bytes: Record<string, StoredPartition> }> {
  const runner = world(options.built ?? definition, options.seats).runner;
  const { result } = await drainScheduled(runner, bytes, {
    name: options.name,
    ...(options.args === undefined ? {} : { args: options.args }),
    due: OPENED + 30 * DAY,
    answer: options.tenancyOf ?? ((seat) => stamp(seat)),
  });
  return { result, bytes: await checkpointBytes(runner, bytes, result.dirty) };
}

/** One field of an estate, read out of its checkpointed bytes. */
function stored(bytes: Record<string, StoredPartition>, seat: number, field: string): number {
  const attributes = (bytes[estate(seat)]!.json as { attributes?: Record<string, number> })
    .attributes;
  return attributes?.[field] ?? 0;
}

describe("#475 — the world's clock finalizes a vacancy it declared", () => {
  it("REFUSES a clock vacancy verb that is seated, which could only run for somebody present", () => {
    expect(() =>
      world(colony([leave, teardown, reap, sweep], { vacateByClock: "leave" })),
    ).toThrow(/seated action/);
  });

  it("REFUSES a clock vacancy verb that never declares a chair, since it could name none", () => {
    const blind = worldClockAction<Colony>("blind")
      .needs(() => [])
      .execute(() => {});
    expect(() =>
      world(colony([leave, teardown, reap, sweep, blind], { vacateByClock: "blind" })),
    ).toThrow(/about\(\)/);
  });

  it("REFUSES a name no verb answers to, rather than holding chairs in silence", () => {
    expect(() =>
      world(colony([leave, teardown, reap, sweep], { vacateByClock: "reep" })),
    ).toThrow(/is not an action/);
  });

  it("reports both roads to a host, so neither is discovered at dispatch time", () => {
    const built = world();
    expect(built.vacate).toBe("leave");
    expect(built.vacateByClock).toBe("reap");
    expect(world(colony([leave], {})).vacateByClock).toBeNull();
  });

  it("frees the chair after a teardown that took SEVERAL committed checkpoints", async () => {
    let bytes = await launched();
    // Five holdings, two per occurrence: three teardown passes and none of them
    // frees anything.
    for (const pass of [1, 2, 3]) {
      const step = await drain(bytes, { name: "teardown", args: { seat: 2 } });
      bytes = step.bytes;
      expect(step.result.vacated).toBeUndefined();
      expect(stored(bytes, 2, "passes")).toBe(pass);
    }
    expect(stored(bytes, 2, "holdings")).toBe(0);

    // The last rung is its own dispatch, and it is the only one that frees a
    // chair -- named as a seat AND as the roster key the engine resolved.
    const done = await drain(bytes, { name: "reap", args: { seat: 2 } });
    expect(done.result.vacated).toEqual({ seat: 2, player: "p2" });
  });

  it("REFUSES the release while the estate still stands, and changes nothing", async () => {
    const bytes = await launched();
    await expect(drain(bytes, { name: "reap", args: { seat: 2 } })).rejects.toThrow(
      /still holds 5 things/,
    );
  });

  it("releases EXACTLY ONCE when a completion is retried against an already-empty chair", async () => {
    let bytes = await launched();
    for (const _pass of [1, 2, 3]) {
      bytes = (await drain(bytes, { name: "teardown", args: { seat: 2 } })).bytes;
    }
    const first = await drain(bytes, { name: "reap", args: { seat: 2 } });
    expect(first.result.vacated).toEqual({ seat: 2, player: "p2" });

    // THE RETRY, after the host committed the release: its own roster now
    // answers `empty` for that chair, and the same dispatch reports nothing to
    // release a second time.
    const again = await drain(first.bytes, {
      name: "reap",
      args: { seat: 2 },
      tenancyOf: (seat) => stamp(seat, "empty", null),
    });
    expect(again.result.vacated).toBeUndefined();
  });

  it("frees an ERASED holder's chair, which is held by somebody with no name left", async () => {
    let bytes = await launched();
    for (const _pass of [1, 2, 3]) {
      bytes = (await drain(bytes, { name: "teardown", args: { seat: 2 } })).bytes;
    }
    const done = await drain(bytes, {
      name: "reap",
      args: { seat: 2 },
      tenancyOf: (seat) => stamp(seat, "erased"),
    });
    expect(done.result.vacated).toEqual({ seat: 2, player: "p2" });
  });

  it("REFUSES a chair the walk never declared, which is the whole of forging one", async () => {
    const built = razed({ vacate: "leave", vacateByClock: "reap" });
    const bytes = await launched(built);
    // Seat 1's estate is down and `reap` is about seat 1 -- but it
    // names seat 3, whose chair no `.about()` round asked the host about.
    await expect(
      drain(bytes, { name: "reap", args: { seat: 1, instead: 3 }, built }),
    ).rejects.toThrow(/did not declare/);
  });

  it("REFUSES a second, different chair in one dispatch, so a release is one chair's own step", async () => {
    const built = razed({ vacate: "leave", vacateByClock: "reap" });
    const bytes = await launched(built);
    await expect(
      drain(bytes, { name: "reap", args: { seat: 1, twice: 3 }, built }),
    ).rejects.toThrow(/finalized seat 1's vacancy and then seat 3's/);
  });

  it("REFUSES the vacancy call from any verb but the declared one", async () => {
    const bytes = await launched();
    await expect(drain(bytes, { name: "sweep", args: { seat: 2 } })).rejects.toThrow(
      /"reap"/,
    );
  });

  it("REFUSES a release the host vouched for and this world's roster contradicts", async () => {
    const built = razed({ vacate: "leave", vacateByClock: "reap" });
    const bytes = await launched(built);
    // The host says seat 1 is held; this world seats nobody there. A chair the
    // two layers disagree about is the one that must not be handed on.
    await expect(
      drain(bytes, {
        name: "reap",
        args: { seat: 1 },
        built,
        seats: new Map([["p2", 2]]),
      }),
    ).rejects.toThrow(/seats nobody there/);
  });

  it("REFUSES the vacancy call on the OFFER road, which nothing writes down", async () => {
    // No seated verb but `snoop`, so the enumeration reaches its condition
    // without first loading another action's estate.
    const built = colony([teardown, reap, snoop], { vacateByClock: "reap" });
    const runner = world(built).runner;
    await expect(
      runner.offersFor("p1", {
        now: OPENED,
        presence: [1],
        activity: { seat: 1, at: null, since: OPENED },
      }),
    ).rejects.toThrow(/deciding what to OFFER/);
  });

  it("REFUSES the vacancy call in a world that declares no clock road at all", async () => {
    const built = razed({ vacate: "leave" });
    const bytes = await launched(built);
    await expect(drain(bytes, { name: "reap", args: { seat: 1 }, built })).rejects.toThrow(
      /declares no `world.vacateByClock`/,
    );
  });
});

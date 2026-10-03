/**
 * A CLOCK'S DECLARATION CAN READ THE FOLD IT IS RUNNING (#271).
 *
 * A recurrence that produces at a RATE integrates with `1 + missedCount`, and
 * until this the fold was readable only from inside `execute`. That is half an
 * answer: what a handler may WRITE is what its declaration NAMED, so a body
 * that learns it owes ten spawns into ten partitions cannot make them unless
 * the declaration already knew to name ten. A declaration that cannot size its
 * own catch-up has to guess a ceiling, and everything past the ceiling is work
 * the world silently never does -- downtime turned into a permanent shortfall.
 *
 * So `world.timing` is on the declaration's facilities exactly as it is on the
 * handler's, with the same meaning on both: the scheduled occurrence this
 * dispatch is, or `null` when a seat is acting and nothing was folded at all.
 *
 * AND THE TWO CANNOT DISAGREE. The declaration is told WHEN as one fact rather
 * than two -- a seat's arrival instant, or the clock's whole occurrence -- so
 * there is no way to hand the walk one `due` and the handler another.
 */
import { describe, expect, it } from "vitest";
import { Game, Space, type GameElement, type GameOptions } from "../engine/index.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import { worldAction, worldClockAction } from "./action.js";
import { walkDeclaration } from "./declaration.js";
import { checkpointBytes } from "./stored-world.test-helper.js";
import type { StoredPartition } from "./contract.js";
import { TEST_WORLD_ELEMENT_ID_KEY } from "../engine/element/world-element-id-key.test-helper.js";

class Yard extends Space<Depot> {
  /** The next crate a spawn fills, so a catch-up resumes where the last one
   *  stopped rather than filling the same crate twice. */
  cursor = 0;
  /** What this crate holds, for the crates that are crates. */
  items = 0;
}

class Depot extends Game<Depot> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Yard]);
  }
}

const CRATES = 12;
const crate = (index: number): string => `crate:${index}`;

/** What a declaration saw, so a case can assert on a context that is otherwise
 *  visible only from inside the bundle. */
let declaredTiming: { due: number; missedCount: number } | null = null;
let declaredNow = 0;
/** What the handler saw, for the half of #271 that was already reachable. */
let ranTiming: { due: number; missedCount: number } | null = null;

/** How many occurrences this call is: the one that ran, plus the ones folded
 *  into it. The same arithmetic in the declaration and in the body, which is
 *  the whole point -- they can only agree if both can read the fold. */
function occurrences(timing: { missedCount: number } | null): number {
  return 1 + (timing?.missedCount ?? 0);
}

/**
 * THE RATE-PRODUCING RECURRENCE #271 IS ABOUT.
 *
 * Round one names the yard, because the crate this occurrence starts at is
 * world state. The round after it names ONE CRATE PER OCCURRENCE -- which is
 * knowable only from the fold -- and the body fills exactly those.
 */
const spawn = worldClockAction<Depot>("spawn")
  .needs(() => ["yard"])
  .needs(({ world }) => {
    declaredTiming = world.timing;
    declaredNow = world.now;
    const yard = world.partition("yard") as Yard;
    return Array.from({ length: occurrences(world.timing) }, (_, step) =>
      crate(yard.cursor + step),
    );
  })
  .execute((_args, { world }) => {
    ranTiming = world.timing;
    const yard = world.partition("yard") as Yard;
    const due = occurrences(world.timing);
    for (let step = 0; step < due; step++) {
      (world.partition(crate(yard.cursor + step)) as Yard).items += 1;
    }
    yard.cursor += due;
  });

/** A seat's verb, whose declaration is about an arrival and not an occurrence. */
const stock = worldAction<Depot>("stock")
  .needs(({ world }) => {
    declaredTiming = world.timing;
    declaredNow = world.now;
    return ["yard"];
  })
  .execute((_args, { world }) => {
    ranTiming = world.timing;
    (world.partition("yard") as Yard).items += 1;
  });

const definition = {
  gameClass: Depot,
  gameType: "depot",
  world: {
    maxPlayers: 2,
    actions: [spawn, stock],
    genesis: (game: Game) => {
      const roots: Record<string, GameElement> = { yard: game.create(Yard, "yard") };
      for (let index = 0; index < CRATES; index++) {
        roots[crate(index)] = game.create(Yard, `crate${index}`);
      }
      return roots;
    },
    view: () => ["yard"],
  },
} as WorldRunnerOptions["definition"];

const OPENED = 1_700_000_000_000;
const MINUTE = 60_000;

function world() {
  return createWorld({ elementIdKey: TEST_WORLD_ELEMENT_ID_KEY, definition, seed: "clock-timing", seats: new Map([["p1", 1]]) }).runner;
}

/** Genesis, as a host's store would hold it. Every case below runs against a
 *  COLD world built from these bytes, which is the only way to see what a
 *  declaration actually asks the host to load: a partition the runner already
 *  holds resident is subtracted before the host ever hears of it. */
async function launched(): Promise<Record<string, StoredPartition>> {
  const genesis = await world().genesis();
  return { ...genesis.partitions };
}

/**
 * DRIVE ONE DISPATCH THE WAY A HOST DOES: declare, supply, declare again, apply.
 *
 * `when` is handed to BOTH halves, so a case cannot accidentally prove the
 * declaration right against a fold the handler never ran under.
 */
async function drain(
  bytes: Record<string, StoredPartition>,
  options: {
    name: string;
    player?: string | null;
    timing: { due: number; missedCount: number } | null;
    arrivedAt?: number;
  },
) {
  const runner = world();
  const command = { name: options.name, args: {} };
  const player = options.player ?? null;
  const when =
    options.timing === null
      ? ({ kind: "arrival", now: options.arrivedAt ?? OPENED } as const)
      : ({ kind: "scheduled", timing: options.timing } as const);
  // THE LIBRARY'S OWN LOOP, so a case cannot prove a declaration right against
  // a walk only this file knows how to drive.
  const named: string[] = [];
  await walkDeclaration(
    (supplied, declared) => runner.declare(command, player, supplied, when, declared),
    (name) => {
      const stored = bytes[name];
      if (stored === undefined) throw new Error(`test store has no partition "${name}"`);
      named.push(name);
      return Promise.resolve(stored);
    },
    (seat) => Promise.reject(new Error(`no action here declares a chair, and one named ${seat}`)),
    (seat) => Promise.reject(new Error(`no action here declares a notice box, and one named ${seat}`)),
  );
  const result = await runner.apply({
    player,
    command,
    timing: options.timing,
    arrivedAt: options.timing === null ? (options.arrivedAt ?? OPENED) : options.timing.due,
    allowance: { unkeyed: 0, keys: [], worldPending: 0 },
    presence: [] as readonly number[],
    activity: null,
    declaredActivity: [],
    declaredNotices: [],
  });
  return { runner, result, named };
}


/** One field of a partition, read out of its stored bytes. */
function storedField(
  bytes: Record<string, StoredPartition>,
  name: string,
  field: "items" | "cursor",
): number {
  const attributes = (bytes[name]!.json as { attributes?: Record<string, number> }).attributes;
  if (attributes === undefined) throw new Error(`partition "${name}" stored no attributes`);
  return attributes[field]!;
}

/** What one crate holds, read out of its stored bytes. */
function itemsIn(bytes: Record<string, StoredPartition>, name: string): number {
  return storedField(bytes, name, "items");
}

describe("#271 — a clock declaration reads the occurrence it is running", () => {
  it("names one partition per folded occurrence, not a guessed ceiling", async () => {
    const bytes = await launched();

    // Four occurrences in one call: the one that ran, and the three that got no
    // call of their own.
    const { runner, result, named } = await drain(bytes, {
      name: "spawn",
      timing: { due: OPENED + 4 * MINUTE, missedCount: 3 },
    });

    expect(declaredTiming).toEqual({ due: OPENED + 4 * MINUTE, missedCount: 3 });
    expect(named).toEqual(["yard", crate(0), crate(1), crate(2), crate(3)]);
    // AND THE WRITES LANDED. A declaration that named them and a body that
    // could not write them would be the same shortfall in a different place.
    const after = await checkpointBytes(runner, bytes, result.dirty);
    expect([0, 1, 2, 3].map((index) => itemsIn(after, crate(index)))).toEqual([1, 1, 1, 1]);
    expect(itemsIn(after, "yard")).toBe(0);
    expect(storedField(after, "yard", "cursor")).toBe(4);
  });

  it("gives the declaration the same occurrence the handler runs under", async () => {
    const bytes = await launched();

    await drain(bytes, {
      name: "spawn",
      timing: { due: OPENED + 9 * MINUTE, missedCount: 8 },
    });

    expect(ranTiming).toEqual(declaredTiming);
    // A scheduled declaration's clock is its occurrence's own `due`, never a
    // second number a host could get wrong (#375).
    expect(declaredNow).toBe(OPENED + 9 * MINUTE);
  });

  it("resumes where the last catch-up stopped, over two drains", async () => {
    const bytes = await launched();

    const first = await drain(bytes, {
      name: "spawn",
      timing: { due: OPENED + 2 * MINUTE, missedCount: 1 },
    });
    const after = await checkpointBytes(first.runner, bytes, first.result.dirty);

    // A SECOND WAKE, COLD. The cursor the first catch-up left behind is in the
    // bytes, so the second names the crates after it and not the same two.
    const second = await drain(after, {
      name: "spawn",
      timing: { due: OPENED + 4 * MINUTE, missedCount: 1 },
    });
    expect(second.named).toEqual(["yard", crate(2), crate(3)]);
    const end = await checkpointBytes(second.runner, after, second.result.dirty);
    expect([0, 1, 2, 3].map((index) => itemsIn(end, crate(index)))).toEqual([1, 1, 1, 1]);
  });

  it("reports an un-folded occurrence as a fold of nothing", async () => {
    const bytes = await launched();

    const { named } = await drain(bytes, {
      name: "spawn",
      timing: { due: OPENED + MINUTE, missedCount: 0 },
    });

    expect(declaredTiming).toEqual({ due: OPENED + MINUTE, missedCount: 0 });
    expect(named).toEqual(["yard", crate(0)]);
  });

  it("tells a seat's declaration there is no occurrence at all", async () => {
    const bytes = await launched();

    await drain(bytes, {
      name: "stock",
      player: "p1",
      timing: null,
      arrivedAt: OPENED + 7 * MINUTE,
    });

    // NULL rather than a fold of zero: a player's command is not an occurrence
    // of anything, and saying "nothing was missed" would be an answer to a
    // question nobody asked.
    expect(declaredTiming).toBeNull();
    expect(ranTiming).toBeNull();
    expect(declaredNow).toBe(OPENED + 7 * MINUTE);
  });

  it("refuses a clock dispatch whose declaration was driven as an arrival", async () => {
    const bytes = await launched();
    const runner = world();

    // The one way a host could still hand the walk a fold of nothing and the
    // handler a fold of three. Refused at the door, because the shortfall it
    // produces is silent everywhere else.
    await expect(
      runner.declare(
        { name: "spawn", args: {} },
        null,
        {},
        { kind: "arrival", now: OPENED },
        { declaredActivity: [], declaredNotices: [] },
      ),
    ).rejects.toThrow(/scheduled/i);
    expect(bytes.yard).toBeDefined();
  });
});

/**
 * THE TWO THINGS EVERY READ-PATH TEST NEEDS, AND NEITHER IS WHAT IT IS ABOUT.
 *
 * A world's read paths -- `offersFor`, `resolvePick` (ShufflewickPub #378),
 * `resolveQuote` (#248) -- are all driven the same way: an engine over a store
 * that already holds a genesis, asked a question at a stamped instant. The store
 * and the stamp were written out per file, which is two copies of "what a host
 * supplies" sitting in the fixtures of tests about something else.
 */
import type {
  DeclaredSeatActivityStamp,
  StoredPartition,
  WorldCommandResult,
  WorldOfferStamp,
  WorldPartitionSource,
} from "./contract.js";
import { createWorld, type WorldRunnerOptions } from "./definition.js";
import type { WorldRunnerHandle } from "./runner.js";

/**
 * WHAT A HOST SUPPLIES TO OPEN A WORLD: one definition, one seed, one seat, and
 * -- once a world has been born -- the id the next element it creates must take.
 *
 * Every migration test opens its world this way, so the shape lives here rather
 * than once per file.
 */
export function worldOptions(
  definition: WorldRunnerOptions["definition"],
  seed: string,
  nextElementId?: number,
): WorldRunnerOptions {
  return {
    definition,
    seed,
    seats: new Map([["p1", 1]]),
    ...(nextElementId === undefined ? {} : { nextElementId }),
  } as WorldRunnerOptions;
}

/**
 * GENESIS, AS THE HOST STORES IT: the bytes a world is born with and the id its
 * next element takes, which together are what a migration starts from.
 */
export async function storedWorld(
  definition: WorldRunnerOptions["definition"],
  seed: string,
): Promise<{ rows: Record<string, StoredPartition>; nextElementId: number }> {
  const genesis = await createWorld(worldOptions(definition, seed)).runner.genesis();
  return { rows: genesis.partitions, nextElementId: genesis.nextElementId };
}

/** A store that holds exactly what a test put in it, and forgets nothing. */
export class MapStore implements WorldPartitionSource {
  constructor(private readonly stored: Map<string, StoredPartition>) {}

  async read(name: string): Promise<StoredPartition | undefined> {
    return this.stored.get(name);
  }

  forget(): void {}
}

/**
 * The stamp a host puts on one read.
 *
 * NO ACTIVITY HISTORY by default: a case that is about a watermark names its own
 * (ShufflewickPub #383), and `at: null` is what a world that has recorded none
 * for this seat honestly answers.
 */
export function offerStamp(now: number, presence: readonly number[] = [1, 2]): WorldOfferStamp {
  return { now, presence, activity: { seat: 1, at: null, since: now } };
}

/**
 * ONE CHECKPOINT, AS A HOST WRITES ONE.
 *
 * Serialize what the dispatch dirtied and fold it back into the bytes the
 * store holds, so the NEXT wake starts from bytes rather than from a live
 * tree. Shared, because a cold-wake case is the only way to see what a
 * declaration really asks a host to load and every such case needs this same
 * three lines.
 */
export async function checkpointBytes(
  runner: { serialize(dirty: readonly string[]): Promise<{ partitions: Record<string, string> }> },
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

/**
 * DRIVE ONE SCHEDULED DISPATCH THE WAY A HOST DOES.
 *
 * Declare, answer what the walk named, declare again, and apply with everything
 * the walk collected -- the library's own loop rather than each test file's, so
 * a case cannot prove a declaration right against a walk only it knows how to
 * drive. The activity legs are answered by one point read per declared seat,
 * exactly as a host's own seat table answers them, and the answers ACCUMULATE
 * across rounds because the host is the side that remembers them: the child
 * holds no store and must not hold a watermark between calls either.
 *
 * `answer` is required rather than defaulted. A default would be one file's
 * idea of an ordinary chair standing in for another's, and the whole of what
 * these cases turn on -- a watermark, a tenancy -- is exactly that answer.
 */
export async function drainScheduled(
  runner: WorldRunnerHandle,
  bytes: Readonly<Record<string, StoredPartition>>,
  options: {
    readonly name: string;
    readonly args?: Record<string, unknown>;
    readonly due: number;
    readonly answer: (seat: number) => DeclaredSeatActivityStamp;
  },
): Promise<{ result: WorldCommandResult; asked: readonly number[] }> {
  const command = { name: options.name, args: options.args ?? {} };
  const timing = { due: options.due, missedCount: 0 };
  const declared: DeclaredSeatActivityStamp[] = [];
  const asked: number[] = [];
  let supplied: Record<string, StoredPartition> = {};
  for (;;) {
    const needs = await runner.declare(
      command,
      null,
      supplied,
      { kind: "scheduled", timing },
      { declaredActivity: declared, declaredNotices: [] },
    );
    // No case driven through here reads a notice box; one that does is driven
    // through `walkDeclaration` itself (see `notice-box.test.ts`).
    if (needs.noticeBoxes.length > 0) {
      throw new Error(`drainScheduled answers no notice box, and "${options.name}" named one`);
    }
    if (needs.partitions.length === 0 && needs.seats.length === 0) break;
    supplied = {};
    for (const name of needs.partitions) {
      const stored = bytes[name];
      if (stored === undefined) throw new Error(`test store has no partition "${name}"`);
      supplied[name] = stored;
    }
    for (const seat of needs.seats) {
      asked.push(seat);
      declared.push(options.answer(seat));
    }
  }
  const result = await runner.apply({
    player: null,
    command,
    timing,
    arrivedAt: options.due,
    allowance: { unkeyed: 0, keys: [], worldPending: 0 },
    presence: [] as readonly number[],
    activity: null,
    declaredActivity: declared,
    declaredNotices: [],
  });
  return { result, asked };
}

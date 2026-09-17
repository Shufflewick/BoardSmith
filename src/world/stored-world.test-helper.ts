/**
 * THE TWO THINGS EVERY READ-PATH TEST NEEDS, AND NEITHER IS WHAT IT IS ABOUT.
 *
 * A world's read paths -- `offersFor`, `resolvePick` (ShufflewickPub #378),
 * `resolveQuote` (#248) -- are all driven the same way: an engine over a store
 * that already holds a genesis, asked a question at a stamped instant. The store
 * and the stamp were written out per file, which is two copies of "what a host
 * supplies" sitting in the fixtures of tests about something else.
 */
import type { StoredPartition, WorldOfferStamp, WorldPartitionSource } from "./contract.js";

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

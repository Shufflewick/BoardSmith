/**
 * WHERE A WORLD'S PARTITIONS LIVE, AS A CONTRACT RATHER THAN A PLACE.
 *
 * A world engine reads partitions through `WorldPartitionStore` (`contract.ts`)
 * and hands a checkpoint back through `serializePartitions`. What is here is
 * the other half: the WRITE side every store must implement, and the two rules
 * every store must enforce before it writes -- what a partition may be NAMED,
 * and how large one may be.
 *
 * ## One key per partition, and that IS the cost argument
 *
 * A world could be one big value. It must not be: reading a partition would
 * then cost the whole world, and a checkpoint would rewrite every byte of it
 * because one player moved a chair. The entire point of the partitioned model
 * is that a command costs O(room), so any store's layout has to make a single
 * partition a POINT READ and a checkpoint a write of exactly the dirty set.
 * `WorldPartitionWriter` is shaped so that is the only way to implement it.
 *
 * ## `parentId` is remembered, not re-derived
 *
 * `serializePartitions` answers `name -> json` and says nothing about where the
 * subtree hangs, because a checkpoint does not move partitions -- only creation
 * decides a parent. So a store records `parentId` when a partition is created,
 * carries it through every rewrite, and refuses to write a partition it has
 * never seen. That refusal is the interesting half: a checkpoint naming an
 * unknown partition means the engine serialized something that reached the tree
 * without going through the store, and writing it under a guessed parent would
 * graft the subtree into the wrong place on the next wake.
 * `checkpoint-unknown-partition` is the code for it.
 *
 * ## What is NOT here
 *
 * Any actual store. A Durable Object's storage, a local SQLite file and an
 * in-memory map are three implementations of this interface, and each one owns
 * its own key layout, its own batching against its own multi-key limits, and
 * its own atomicity story. Those are properties of a place, and the whole
 * reason this is an interface is that the engine above it must not know which
 * place it is talking to.
 *
 * A host may also have naming rules of its own on top of `assertStorablePartitionName`
 * -- a platform that erases a person's data on request must refuse a partition
 * named after one, because a store the erasure proof cannot reach would outlive
 * the deletion request. That rule needs the host's own vocabulary for "one
 * person's data", so it composes rather than living here.
 */
import type { StoredPartition } from "./contract.js";
import { worldRefusal } from "./refusals.js";
import type { WorldBudgets } from "./budgets.js";

/**
 * What a partition name may contain.
 *
 * Deliberately narrow, and narrow in the shape a key is usually narrow: this
 * name becomes part of a storage key on every host, so a name that needs
 * escaping somewhere is a name that stores differently in two places.
 */
const PARTITION_NAME_PATTERN = /^[A-Za-z0-9._:@/-]+$/;

/**
 * Names that are properties of every JavaScript object.
 *
 * The pattern above permits underscores, so `__proto__` was a legal partition
 * name -- and partition names come from an untrusted bundle. Each of these
 * crosses into a plain record somewhere on the way to storage, where
 * `record[name] = value` reaches an inherited accessor rather than creating an
 * own property: the partition vanishes from the checkpoint, or the record's
 * prototype is swapped, and nothing throws. The records this library builds are
 * Maps and null-prototype objects, so this refusal is the second lock rather
 * than the only one -- but it is the one that makes the wrong shape unreachable
 * at the door, before any of them has to be right.
 */
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** How long a partition name may be. Bounds the key, which bounds the read. */
const PARTITION_NAME_MAX_LENGTH = 128;

/**
 * Refuse a name no store may hold, with the reason and the alternative.
 *
 * Every clause is about a name the GAME chose, so every message has to be
 * actionable by a game author reading a log, not by whoever wrote the store.
 */
export function assertStorablePartitionName(name: string): void {
  if (name.length === 0) {
    throw worldRefusal("invalid-partition-name", "A partition name cannot be empty.");
  }
  if (name.length > PARTITION_NAME_MAX_LENGTH) {
    throw worldRefusal(
      "invalid-partition-name",
      `The partition name ${JSON.stringify(name.slice(0, 32))}... is ${name.length} characters, ` +
        `over the ${PARTITION_NAME_MAX_LENGTH}-character limit.`,
    );
  }
  if (!PARTITION_NAME_PATTERN.test(name)) {
    throw worldRefusal(
      "invalid-partition-name",
      `The partition name ${JSON.stringify(name)} contains characters a partition name may not: ` +
        `use letters, digits, and any of . _ : @ / -`,
    );
  }
  if (PROTOTYPE_KEYS.has(name)) {
    throw worldRefusal(
      "invalid-partition-name",
      `A partition may not be named ${JSON.stringify(name)}. That name is reserved by JavaScript ` +
        `objects, and a partition carrying it does not store: writing it into a plain record ` +
        `either silently does nothing or replaces the record's prototype, so the partition would ` +
        `disappear from checkpoints with no error at all. Rename it -- "${name}s" or ` +
        `"world/${name}" both work.`,
    );
  }
}

/** One encoder for the module: constructing one per call is pure waste on a
 *  path that runs once per partition per checkpoint. */
const encoder = new TextEncoder();

/** What a string weighs where it is actually stored. */
export function partitionBytes(json: string): number {
  return encoder.encode(json).length;
}

/**
 * Refuse a partition that has outgrown what one storage value may hold.
 *
 * GAME-OWNED, and deliberately so: the budget is the host's, but what a
 * partition contains is entirely the bundle's. A game-owned refusal never parks
 * a world 499 other players are in, and the message is written for the one
 * person who can actually fix it.
 *
 * Measured in UTF-8 bytes rather than characters, because that is what storage
 * holds: a room full of non-Latin names is up to three times bigger than its
 * length suggests, and a guard that missed that would refuse some worlds and
 * not others for the same content.
 *
 * Answers that byte count, so a store batching a write can measure it in the
 * same units without encoding the same string a second time.
 */
export function assertPartitionWithinBudget(
  name: string,
  json: string,
  budgets: WorldBudgets,
): number {
  const bytes = partitionBytes(json);
  if (bytes <= budgets.partitionMaxBytes) return bytes;
  throw worldRefusal(
    "partition-too-large",
    `Partition ${JSON.stringify(name)} serializes to ${bytes} bytes, over the ` +
      `${budgets.partitionMaxBytes}-byte limit one partition may hold. A partition is written as ` +
      `a single storage value and the storage layer refuses one much past this, so the world ` +
      `cannot be made durable while this partition is this big. Split it: move what has ` +
      `accumulated -- a market's listings, a room's log -- into partitions of its own, which is ` +
      `also what makes a command that touches it cost one room again instead of the whole ` +
      `collection.`,
  );
}

/**
 * A store that can be WRITTEN as well as read.
 *
 * Two operations and not one upsert, because CREATION IS THE ONLY OPERATION
 * THAT DECIDES A PARENT. An upsert would let a checkpoint silently re-parent a
 * partition, and a subtree grafted somewhere new is not a change any test of
 * the checkpoint would notice.
 */
export interface WorldPartitionWriter {
  /**
   * Mint an ENTIRE GENESIS, or none of it.
   *
   * ALL-OR-NOTHING, and that is the requirement rather than a nicety. A bundle
   * whose genesis names one storable partition and one it may not, committed
   * one at a time, leaves the world un-launched with a partition already in it;
   * every later command re-runs genesis, meets a partition that already exists,
   * and the world is wedged forever over one bad name. A crash between two
   * creates does the same with no game mistake at all.
   *
   * So an implementation checks every name and every size before it writes
   * anything, and whatever flag it uses to record that the world has launched
   * goes out in the same commit as these partitions -- a retry then finds
   * either an empty world or a launched one, and never the state in between
   * that had no way out.
   */
  /**
   * Create every partition a genesis produced, in one write.
   *
   * A host may widen this -- the local dev store takes the state version
   * genesis wrote under, and the platform's takes the rows that ride the same
   * write (#200, #369) -- because what ELSE lands with a genesis is that
   * host's storage business. What the contract requires is only that the
   * partitions land together.
   */
  createAll(records: Record<string, StoredPartition>): Promise<void>;
  /**
   * Write exactly what a checkpoint serialized.
   *
   * `serialized` is `name -> json`, straight from `WorldEngine.serializePartitions`
   * over the accumulated dirty set. An implementation refuses a name it has
   * neither read nor created (`checkpoint-unknown-partition`), because it does
   * not know where that subtree hangs.
   *
   * ONE COMMIT, however many keys it takes. A checkpoint that landed a prefix
   * of the dirty set leaves a world whose rooms disagree about which command
   * last ran, which is a corruption nothing downstream can detect.
   */
  writeCheckpoint(serialized: Record<string, string>): Promise<void>;
}

/**
 * WHAT A HOST MUST BE ABLE TO STORE FOR A WORLD TO SURVIVE A RESTART.
 *
 * `WorldPartitionStore` and `WorldPartitionWriter` are the two halves the
 * library already names for the PARTITIONS. This is everything else a host has
 * to keep beside them and that has to survive the same restart -- the launched
 * flag, the dirty set, the schedule, the roster, the activity watermarks, the
 * receipts and the clock skew.
 *
 * IT LIVES IN THE LIBRARY RATHER THAN IN ONE HOST because there is more than
 * one of them and they must not disagree about what durability means:
 * `boardsmith dev` keeps a world in SQLite on a laptop, the platform keeps one
 * in a Durable Object, and `boardsmith/testing`'s `TestWorld` keeps one in a
 * Map. All three drive {@link ResidentWorld}, which is written against THIS and
 * against no storage engine in particular.
 */
import type {
  DeclaredSeatActivityStamp,
  StoredPartition,
  WorldPartitionStore,
} from "../contract.js";
import {
  assertPartitionWithinBudget,
  assertStorablePartitionName,
  type WorldPartitionWriter,
} from "../partition-store.js";
import type { WorldBudgets } from "../budgets.js";
import type {
  WorldCreatedPartition,
  WorldGenesis,
  WorldMigrated,
  WorldSerialized,
} from "../runner.js";
import type { PlannedEvent } from "../schedule-api.js";
import type { WorldReceipt } from "../orders.js";
import type { SettledNoticeBox, WorldNoticeBox } from "../notices.js";

/** One seat, as the roster holds it. */
export interface WorldSeatRecord {
  readonly player: string;
  readonly seat: number;
}

/**
 * A durable world, whatever it is durable IN. See this file's header for who
 * implements it and why it is only declared once.
 */
export interface WorldStore extends WorldPartitionStore, WorldPartitionWriter {
  /**
   * `WorldPartitionWriter.writeCheckpoint`, WIDENED to carry what settles and
   * arms with it.
   *
   * The library's signature is the partitions alone, because that is all a
   * store must be able to do. This one takes the schedule too, for the reason
   * the Durable Object store takes `alsoDelete`/`alsoPut`: an event's deletion
   * has to commit in the same write as its effects, and a command's timers must
   * not become durable before the checkpoint that makes their cause durable.
   * The extra argument is optional, so this is still a `WorldPartitionWriter`
   * everywhere one is asked for.
   */
  writeCheckpoint(
    checkpoint: WorldSerialized,
    extras?: WorldCheckpointExtras,
  ): Promise<void>;

  /**
   * `WorldPartitionWriter.createAll`, WIDENED to record the state version
   * genesis wrote under (#200).
   *
   * The library's signature is the genesis answer alone; what ELSE lands with a
   * genesis is each host's own storage business, and for this one it is the
   * version. Optional, so this is still a `WorldPartitionWriter`.
   */
  createAll(genesis: WorldGenesis, stateVersion?: number): Promise<void>;

  /**
   * Has genesis already run?
   *
   * The flag is written IN THE SAME TRANSACTION as the genesis partitions
   * (`createAll`), which is what makes a launch all-or-nothing: a reopened
   * store finds either an empty world or a launched one, and never the state in
   * between -- a world marked launched with nothing in it, which refuses every
   * command it ever receives for a missing partition whose absence nothing
   * explains.
   */
  isLaunched(): boolean;

  /** Every partition name whose live bytes are not yet durable. */
  dirtyPartitions(): readonly string[];

  /**
   * Accumulate what a command dirtied.
   *
   * Its own write, deliberately: recording dirt PRECEDES the checkpoint rather
   * than being part of it, and a restart that finds a non-empty dirty set is
   * being told the truth -- those partitions' durable bytes are older than the
   * last command that ran, because the host stopped before it checkpointed.
   */
  recordDirty(names: readonly string[]): void;

  /**
   * FORGET THAT THESE PARTITIONS WERE EVER DIRTY, because the live bytes they
   * were about are gone.
   *
   * The only caller is a host that has just THROWN ITS RESIDENT WORLD AWAY --
   * `boardsmith dev`'s answer to a checkpoint that would not land, and the
   * platform's `discardChild` by another name. A dirty mark says "this
   * partition's durable bytes are older than the live tree"; once there is no
   * live tree, that sentence is false, and a mark nobody can ever satisfy would
   * make every later checkpoint try to serialize a partition no engine holds.
   *
   * It is NOT a way to skip a checkpoint. Discarding a mark without discarding
   * the residency it describes is exactly the corruption `writeCheckpoint`'s
   * one-transaction rule exists to prevent, which is why this is documented
   * against that single caller and against no other.
   */
  discardDirty(names: readonly string[]): void;

  /**
   * Every pending scheduled event, ordered `(due, seq)`.
   *
   * The same order `nextDueBatch` sorts by, because a world's behaviour must
   * not depend on how a storage engine happened to return ties.
   */
  pendingEvents(): readonly PlannedEvent[];

  /**
   * The next monotonic insertion sequence for a scheduled event.
   *
   * Advanced BY THE CHECKPOINT, in the transaction that makes the events using
   * it durable. A counter bumped outside that transaction would keep counting
   * through a rolled-back checkpoint, which is a gap in an ordering that exists
   * only to break ties deterministically.
   */
  nextSeq(): number;

  /** The roster: which player holds which seat. Durable the instant it is
   *  granted, because a seat is where a player's holdings are. */
  seats(): readonly WorldSeatRecord[];

  /**
   * Record that `player` holds `seat`, as of `seatedAt`.
   *
   * `seatedAt` IS PART OF THE ROSTER ROW because it is what a new holder's
   * idleness is measured from (ShufflewickPub #423). Without it, a player who
   * joins a world that has been recording for four hundred days reads
   * `at: null` and `since: <four hundred days ago>` -- so the first inactivity
   * sweep after they arrive finds them four hundred days idle and reaps the
   * empire they have not finished building. The world's recording epoch is the
   * floor and this is the other one; a chair's baseline is the later of the two.
   */
  seat(player: string, seat: number, seatedAt: number): void;

  /**
   * WHEN THIS WORLD BEGAN WATCHING (ShufflewickPub #383), fixing it on the
   * first call and answering the same instant forever after.
   *
   * Called once when a host opens the world, BEFORE any command runs, because
   * a seat's idleness is measured from here and `activityOf` refuses rather
   * than invent an epoch. Taking `openedAt` rather than reading a clock keeps
   * the store testable and keeps the host the only thing that knows what time
   * it is -- the same split `advanceClock` already makes.
   */
  activitySince(openedAt: number): number;

  /**
   * THIS SEAT'S DURABLE ACTIVITY WATERMARK (ShufflewickPub #383, #423).
   *
   * A POINT READ, per seat, which is the whole reason it is a table and not a
   * scan: a five-hundred-seat world answering "is this empire idle" must not
   * read four hundred and ninety-nine other empires to do it. Answers for any
   * seat, including one that has never acted -- `at: null` -- so a caller never
   * has to distinguish "no row" from "no activity".
   *
   * IT ANSWERS WHO IS IN THE CHAIR TOO (#423), because that is the one thing
   * the numbers cannot say: a chair nobody holds reads `at: null` exactly as an
   * established empire that has been quiet since the upgrade does, and only one
   * of those is somebody's game. This host never erases an account and never
   * hands a chair on, so it answers `held` or `empty` and never `erased`.
   */
  activityOf(seat: number): DeclaredSeatActivityStamp;

  /**
   * THIS SEAT'S NOTICE BOX (ShufflewickPub #521), or `EMPTY_NOTICE_BOX` when
   * nothing is waiting for it.
   *
   * A POINT READ of one small row, for `activityOf`'s reason: a declared box
   * read and a send are both about one seat, and must never cost what the
   * world costs. A store keeps no row for an empty box.
   */
  noticeBox(seat: number): WorldNoticeBox;

  /**
   * THE STATE VERSION THIS WORLD'S BYTES WERE LAST WRITTEN UNDER (#200).
   *
   * Zero for a world that has never recorded one, which is the same default
   * `boardsmith build` writes into a manifest -- so a world launched before
   * versions existed and one whose author declared 0 are the same world, and
   * neither is asked to migrate to reach 0.
   */
  stateVersion(): number;

  /**
   * THE WORLD'S DURABLE ID ALLOCATION STAMP (ShufflewickPub #377).
   *
   * The next element id this world may mint, as the last write that minted one
   * left it. `undefined` for a world written before the stamp existed -- the
   * host derives one from the stored bytes ONCE and writes it, rather than
   * being handed a number nothing can vouch for.
   */
  nextElementId(): number | undefined;

  /**
   * WRITE THE STAMP A WORLD SHOULD ALWAYS HAVE HAD (ShufflewickPub #377).
   *
   * The one repair door, for a world launched before the stamp existed. Every
   * other write that moves the allocation carries it in the transaction that
   * minted the ids; this one has no ids to carry, because it is derived from
   * bytes that are already durable.
   */
  recordAllocation(nextElementId: number): void;

  /** Every partition this world holds, by name. A migration is the one caller:
   *  it transforms all of them, and nothing else in this host ever wants the
   *  whole list (that would be the O(world) read residency exists to delete). */
  partitionNames(): readonly string[];

  /**
   * A MIGRATION, WRITTEN WHOLE OR NOT AT ALL (#200).
   *
   * Every transformed partition, every queued event's new arguments, and the
   * version they are now written under, in ONE transaction. A migration that
   * landed halfway would be a world whose rooms disagree about which rules
   * wrote them -- and unlike a checkpoint there is no retry that could finish
   * it, because the second attempt would read bytes the first had already
   * moved.
   */
  migrate(migrated: {
    partitions: Record<string, string>;
    /**
     * NEW partition roots this migration adds (#218), each with the parent it
     * hangs from -- which a transformed partition does not need, because its
     * row already records one.
     */
    created: WorldMigrated;
    events: readonly PlannedEvent[];
    toStateVersion: number;
  }): void;

  /**
   * LIFT THIS WORLD'S ELEMENT IDS ABOVE THE CONSTRUCTION FLOOR (#223).
   *
   * Every partition and every queued event, rewritten with one offset, in ONE
   * transaction -- for the reason `migrate` is one transaction, and one more:
   * a world half lifted is a world whose partitions disagree about what an id
   * means, and its references point at nothing. There is no retry that could
   * finish it, because the second attempt would shift bytes the first had
   * already shifted.
   */
  rekey(lifted: {
    partitions: Record<string, string>;
    events: readonly PlannedEvent[];
    /** The stamp, moved by the same offset as the ids (#377). */
    nextElementId: number;
  }): void;

  /**
   * RECORD A PARTITION ROOT BUILT ON FIRST USE (#218).
   *
   * Its own write, and deliberately not part of a checkpoint: it happens while
   * a declaration is still settling, before anything has decided whether the
   * command will run at all. An empty root written for a command that then
   * refuses is the correct outcome -- the partition exists, the command did
   * not, and the next reach finds the root rather than building a second one.
   *
   * Writing a name the store already holds is a no-op, so a race between two
   * declarations reaching for the same absent root leaves one partition.
   */
  createOne(name: string, built: WorldCreatedPartition): void;

  /**
   * WHAT THIS SEAT'S ORDER COMMITTED, if this store still holds its receipt
   * (#195).
   *
   * Keyed by player as well as order id, so one seat can never replay another's
   * order by guessing its name.
   */
  receipt(player: string, orderId: string): WorldReceipt | undefined;

  /** The instant this store's receipts reach back to. Everything at or after it
   *  that ever committed is still on file. */
  receiptFloorAt(): number;

  /**
   * HOW FAR AHEAD OF THE WALL CLOCK THIS WORLD RUNS (#216).
   *
   * "Fire due events now" moves a world's clock to the instant an event was
   * due, and the partitions that firing settled are durable at that future
   * time. The advance has to be durable with them: a host that started again
   * at the wall -- after a rule reload replaced the runtime, or after the CLI
   * was restarted -- would stamp its next command EARLIER than state already on
   * disk, and a world that checks its own monotonicity refuses that order until
   * real time catches up.
   *
   * So it lives here rather than in the host that advanced it, for the same
   * reason the roster does: it outlives every host that ever ran this world.
   */
  clockSkewMs(): number;

  /**
   * Move this world's clock forward and remember it, answering the new total.
   *
   * The ONLY way the skew changes, and it answers rather than returning void so
   * a host's cached copy comes back FROM the store instead of being computed
   * alongside it -- two additions that could disagree is exactly the drift this
   * is here to prevent.
   */
  advanceClock(byMs: number): number;

  /**
   * WHEN THIS WORLD ENDED, or `undefined` while it is still running (#395).
   *
   * Durable, because an ending is final: a host rebuilt over this store after
   * a restart or a rule reload must still refuse commands and run no events,
   * exactly as the platform does from its own `worldEndedAt`. Written only by
   * the checkpoint that carries the ending, see `WorldCheckpointExtras.endedAt`.
   */
  endedAt(): number | undefined;

  /** Close the database. Never deletes anything -- see `resetWorldStore`. */
  close(): void;
}

/**
 * What settles and what arms alongside a checkpoint's partitions.
 *
 * The local counterpart of the Durable Object store's `alsoDelete`/`alsoPut`,
 * and it exists for the reason those do: an event's deletion has to commit in
 * the same write as its effects, or a crash between them replays a handler onto
 * already-durable state and pays the same income twice. Conversely a command's
 * schedule requests must not become durable before the checkpoint that makes
 * their cause durable, or a rolled-back command leaves its timers behind.
 */
export interface WorldCheckpointExtras {
  /** Event ids to delete: the ones this drain ran to completion. */
  readonly settle?: readonly string[];
  /** Events to insert or replace, including a recurrence's own re-arm. */
  readonly schedule?: readonly PlannedEvent[];
  /**
   * THE RECEIPT FOR THE ORDER THIS CHECKPOINT IS THE EFFECTS OF (#195).
   *
   * In the same transaction for the same reason a settled event is: "the world
   * changed" and "this order changed it" have to become true together, or a
   * crash between them leaves an order whose effects are durable and whose
   * receipt is not -- and the page's retry then pays for it twice.
   */
  readonly receipt?: WorldReceipt;
  /**
   * SWEEP EVERY RECEIPT OLDER THAN THIS, and remember having done so.
   *
   * Passed by the host, which owns the clock and the retention budget. The
   * remembered floor is what lets a later repeat with no receipt be told
   * honestly that nothing can say what became of it.
   */
  readonly receiptFloorAt?: number;
  /**
   * THIS SEAT WAS HERE, AND THE WORLD ACCEPTED WHAT THEY DID (#383).
   *
   * In the same transaction as the effects, for the reason the receipt is:
   * "the world changed" and "this player is the one who changed it" have to
   * become true together. A watermark moved outside the checkpoint would keep
   * a seat alive on the strength of a command that was rolled back -- and,
   * worse, moved BEFORE it would let any client hold an empire open by sending
   * refusable garbage on a timer, which is an inactivity deadline that nothing
   * can ever reach.
   *
   * Absent on the roads that are not a seat acting: a drained event, a
   * presence hook, a migration.
   */
  readonly activity?: { readonly seat: number; readonly at: number };
  /**
   * THE CHAIR THIS CHECKPOINT HANDS ON (#278, ShufflewickPub #475).
   *
   * The engine answers `result.vacated` when the world's own clock verb
   * finalized a vacancy, and this is the write that makes it true. In the same
   * transaction as the effects for the reason the receipt is, and one more: the
   * release is downstream of the ground coming back, so a checkpoint that
   * refuses must leave the chair HELD and the estate standing. A seat freed
   * beside its teardown rather than with it is the one pairing that hands a
   * newcomer somebody else's castle.
   *
   * BOTH HALVES ARE THE ENGINE'S ANSWER: the seat a declared point read
   * vouched for, and the roster key resolved from the engine's own roster. A
   * store writes exactly that identity and resolves nothing of its own.
   *
   * The seat's activity watermark and its notice box go with the holder. The
   * watermark measures how long the person in the chair has been away, and a
   * chair that kept the last holder's mark would report its NEXT occupant as
   * idle since before they arrived -- an inactivity sweep reaping somebody on
   * their first day. The box holds what the game told the last holder, which
   * the next one must not read (ShufflewickPub #521).
   */
  readonly vacate?: { readonly seat: number; readonly player: string };
  /**
   * EVERY NOTICE BOX THIS CHECKPOINT'S DISPATCH CHANGED, as it now stands
   * (ShufflewickPub #521).
   *
   * `applyNoticeWrites`' answer, written in the same transaction as the
   * effects for the receipt's reason: a notice must exist exactly when the
   * command that sent it does, and a take must empty the box exactly when the
   * state the game moved the notices into is durable. An EMPTY box is a row to
   * delete, so a seat with nothing waiting costs no storage at all.
   *
   * A vacated chair's box goes with it, as its watermark does: a notice left
   * for the person who held the chair is not the next holder's to read.
   */
  readonly notices?: readonly SettledNoticeBox[];
  /**
   * THIS CHECKPOINT ENDS THE WORLD, at this instant (#395).
   *
   * Recorded in the same write as the effects of the command or event that
   * called `complete()`, and that write also empties the whole schedule --
   * including anything this same checkpoint arms -- because an ended world
   * runs nothing else ever, and a queue left behind would keep re-arming a
   * timer on a world that will never run it. That is the platform's
   * `endSeason` then `clearEvents`, in one transaction here.
   *
   * A store that has already recorded an ending refuses a second one: a world
   * has exactly one ending (ShufflewickPub #339), and a second would mean the
   * host ran something on a world that had already ended.
   */
  readonly endedAt?: number;
}

/**
 * The sentence a store refuses a second ending with. One wording for every
 * store, so the SQLite store and the memory store cannot disagree about it.
 */
export function secondEndingRefused(endedAt: number): Error {
  return new Error(
    `This world has already ended (at ${new Date(endedAt).toISOString()}), and a world has ` +
      "exactly one ending, so a second one cannot be recorded. Something ran on the world " +
      "after it ended; an ended world must refuse commands and run no scheduled events.",
  );
}

/** One partition, ready to be written: checked, and with its bytes already a
 *  string, because both halves of "may this be stored" are about the string.
 *  Unexported for the reason `WorldSeatRecord` was: a caller reads the answer
 *  and TypeScript checks its use structurally. */
interface StorableRow {
  readonly name: string;
  readonly parentId: number;
  readonly json: string;
}

/**
 * CHECK EVERY NAME AND EVERY SIZE BEFORE ANY OF THEM IS WRITTEN.
 *
 * The roads that write partitions carrying their OWN parent -- a genesis, and
 * the new roots a migration adds (#218) -- and the reason it is one function is
 * that the check has to happen before the transaction opens. A genesis refused
 * for one bad name must write NOTHING: a world marked launched with one
 * partition in it is wedged forever, because every later command re-runs
 * genesis, meets a partition that already exists, and refuses. A migration that
 * landed halfway is the same failure with no retry that could finish it.
 *
 * Shared by every store rather than written per store, because "what may be
 * stored" is a decision two hosts must not be able to make differently.
 */
export function storablePartitionRows(
  records: Readonly<Record<string, StoredPartition>>,
  budgets: WorldBudgets,
): StorableRow[] {
  return Object.entries(records).map(([name, record]) => {
    assertStorablePartitionName(name);
    const json = JSON.stringify(record.json);
    assertPartitionWithinBudget(name, json, budgets);
    return { name, parentId: record.parentId, json };
  });
}

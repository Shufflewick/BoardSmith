/**
 * Issue #37 item 1: THE SEAM BETWEEN THE PARENT AND THE ENGINE.
 *
 * "`BoardSmithWorldEngine` is implemented and tested but never instantiated by
 * the DO" reads like a missing `new`. It is not, and this file is why.
 *
 * ## The problem, stated once
 *
 * The engine holds a live `Game` -- untrusted game code -- so it must run in
 * the CHILD ISOLATE. Section 3 and `world-session.ts:childIsolate()` both state
 * that boundary as `env: {}`: no network, no bindings, the child is handed
 * nothing. But the engine reads partitions through `WorldPartitionStore.read`,
 * which is asynchronous because the only place partitions exist is the
 * PARENT's `ctx.storage`. A child with no bindings cannot reach it.
 *
 * So the engine can be constructed on neither side as things stood. In the
 * parent, the trust boundary is gone. In the child, `ensureResident` has
 * nothing to ask.
 *
 * ## The answer: DECLARE, then APPLY
 *
 * Two calls, and the child never reaches out:
 *
 *   1. `declare(command, player, supplied)` -- the parent hands over whatever
 *      the LAST round asked for, the child adopts it, and the child's engine
 *      then answers which partitions this command still needs. It runs NO GAME
 *      CODE beyond the bundle's own declaration, so a command refused later has
 *      still not touched the world; what it changes is what is LOADED, which is
 *      residency and not state. The acting player is named because the
 *      declaration may name that seat's own partition (#121), and only the
 *      engine's roster can turn one into the other.
 *   2. Repeat 1 until it asks for nothing (#122). A declaration is answered
 *      against what is resident, so a world whose player LOCATION is state can
 *      name its index, read it, and then name the room -- the one thing no
 *      arrangement of arguments could express. `world-declaration.ts` carries
 *      the reasoning and the ceiling; a first round that asks for nothing is
 *      not asked again, so the steady state costs exactly what it did before.
 *   3. `apply(...)` -- everything the command declared is already resident, so
 *      the command runs against a world the parent finished assembling.
 *
 * `env: {}` is untouched. The child is still handed nothing; it is TOLD things,
 * which is a different relationship and the one the boundary was drawn for.
 *
 * ## Why not the two alternatives
 *
 * PUSH-ON-MISS -- one call, and a miss comes back as a refusal naming what was
 * missing. It discovers the miss part-way through the command rather than
 * before it, so the command re-runs from the start; that is only safe because
 * a faulted command has committed nothing, which is a property no type
 * enforces. Exception-driven control flow for a case that is not exceptional.
 *
 * AN RPC STUB IN THE CHILD'S `env` -- one call, no round trips, and `env` stops
 * being `{}`. Narrowing it to one read-only capability is arguable, but it is a
 * change to a stated trust boundary and would make `childIsolate()`'s "the
 * child is handed nothing" false.
 *
 * ## What the extra round trips actually cost
 *
 * Once per partition per Durable Object lifetime, not once per command: the
 * engine keeps a partition resident after adopting it, so `declare` answers an
 * empty list for every later command that names it, and the parent reads
 * nothing. #122's SECOND round is bounded the same way and by the same fact --
 * a declaration whose first round asks for nothing is not asked again, because
 * nothing became resident and nothing could have changed its answer -- so a
 * warm world pays one `declare` and one `apply`, exactly as it did before, and
 * a cold one pays one more round trip per level of the chain it declares.
 * The Stage 0 measurement (#36) says the parent has the headroom -- the object
 * billed 12-18% of wall clock while holding 551 sockets, and a loaded child
 * isolate did not raise it.
 */
import type {
  StoredPartition,
  WorldPartitionSource,
  WorldActionOffer,
  WorldCommand,
  WorldCommandResult,
  WorldEngine,
  WorldOfferStamp,
} from "./contract.js";
import type { Game, GameElement } from "../engine/index.js";
import type { WorldMigrationCreateContext } from "./migration.js";
import type { ScheduleAllowance } from "./schedule-api.js";
import { WorldRefusal } from "./refusals.js";

/** A scheduled event's timing, or `null` for a player's command. */
export type WorldTiming = { readonly due: number; readonly missedCount: number } | null;

/**
 * ONE COMMAND, AS THE PARENT HANDS IT ACROSS THE BOUNDARY.
 *
 * An object rather than five positional arguments, because everything on it is
 * a fact the child cannot derive and the list grows with each one the platform
 * takes ownership of -- `arrivedAt` and `allowance` are the two most recent,
 * and a caller that transposed a pair of numbers would arm a timer at the wrong
 * instant with no type error anywhere.
 */
export interface WorldApplyRequest {
  readonly player: string | null;
  readonly command: WorldCommand;
  readonly timing: WorldTiming;
  /** The platform's stamped instant for this command (#57). A scheduled
   *  event's clock is its own `due` and comes from `timing` instead. */
  readonly arrivedAt: number;
  /** What the queue already holds for this command's OWNER and for this world,
   *  which is what `ctx.schedule()` refuses against (#56, #105). */
  readonly allowance: ScheduleAllowance;
  /** Which seats are connected as this command runs (#144). The parent's own
   *  derivation from its attached sockets, per seat and never stored -- see
   *  `WorldCommandStamp.presence` for the full promise. It rides BOTH roads:
   *  a player's command and a due event alike may ask who is here. */
  readonly presence: readonly number[];
}

/**
 * What `declare` answers.
 *
 * `needs` is what the parent must send, NOT everything the command names --
 * the child subtracts what it already holds, so the steady state is an empty
 * list and no storage read at all.
 */
export interface WorldDeclaration {
  readonly needs: readonly string[];
}

/**
 * WHY ONE PLAYER GOT NO VIEW, IN THE FORM THE ENVELOPE ALREADY CARRIES (#310).
 *
 * The same two fields `world-runner-entry.ts` puts on a refused answer, and
 * deliberately so: the CODE is what crosses the boundary, an absent code is an
 * unclassified throw and therefore the game's, and the parent has one mapping
 * from code to `reason` rather than two that can drift.
 *
 * It exists because the read path answers an AUDIENCE. A view is one seat's, so
 * a failure computing one is one seat's too -- and until #310 it was thrown out
 * of the whole batch's work, which refused every other watcher in the window and
 * told each of them whatever the failing seat's error said about that player.
 */
export interface WorldViewRefusal {
  readonly code?: string;
  readonly message: string;
}

/**
 * What `declareViews` answers: the union the parent must load, and the players
 * whose declaration would not run.
 *
 * THE UNION IS STILL ONE CALL. A player whose `world.view` throws is recorded
 * and skipped rather than aborting the loop, so the declaration costs exactly
 * the round trip it always did -- splitting it per player is what would put
 * back the O(watchers) child calls #114 removed.
 */
export interface WorldViewNeeds extends WorldDeclaration {
  readonly refused: Readonly<Record<string, WorldViewRefusal>>;
}

/** What `viewsFor` answers: a view for each player it could project, and a
 *  refusal for each it could not. Both, because a batch is a set of separate
 *  answers that happen to share a round trip. */
export interface WorldViews {
  readonly views: Record<string, unknown>;
  readonly refused: Record<string, WorldViewRefusal>;
}

/** One player's failure, classified for the wire. `world-runner-entry.ts`'s
 *  catch writes the identical pair for a whole call, and the parent reads both
 *  the same way. */
function viewRefusalOf(error: unknown): WorldViewRefusal {
  return {
    ...(error instanceof WorldRefusal ? { code: error.code } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The store the engine reads through INSIDE the child.
 *
 * It never reaches anywhere. The parent fills it immediately before the
 * command that needs it, so by the time `ensureResident` asks, the answer is
 * already in memory -- which is what lets an interface designed around an
 * asynchronous read work across a boundary that permits no I/O.
 *
 * Entries are dropped once adopted. The engine holds the live subtree from
 * then on, and keeping the bytes too would mean the child carried a second
 * copy of every resident partition for the lifetime of the world.
 */
export interface InlinedPartitionStore extends WorldPartitionSource {
  /** Accept what the parent sent for the command about to run. */
  provide(partitions: Readonly<Record<string, StoredPartition>>): void;
  /** Whether this store can already answer for `name`, which is what
   *  `declare` subtracts so the parent never re-sends a resident partition. */
  holds(name: string): boolean;
  /**
   * Forget that `name` was ever adopted (#43).
   *
   * EVICTION'S OTHER HALF, and it is not optional. `holds` is what `declare`
   * subtracts, so a store that still claimed an evicted partition would make
   * the parent send nothing for it -- and the engine, asked to adopt from a
   * store whose bytes were dropped at adoption time, has nothing to adopt. The
   * partition is then neither resident nor obtainable, which is a world that
   * has silently lost a room.
   */
  forget(name: string): void;
}

export function createInlinedPartitionStore(): InlinedPartitionStore {
  const pending = new Map<string, StoredPartition>();
  // Everything handed to the engine so far. The engine holds the live subtree
  // from then on, so the bytes are dropped -- keeping them would mean the
  // child carried a second copy of every resident partition for the lifetime
  // of the world.
  const adopted = new Set<string>();

  return {
    provide(partitions) {
      for (const [name, partition] of Object.entries(partitions)) {
        pending.set(name, partition);
      }
    },
    holds(name) {
      return adopted.has(name) || pending.has(name);
    },
    forget(name) {
      adopted.delete(name);
      pending.delete(name);
    },
    async read(name) {
      const partition = pending.get(name);
      if (!partition) return undefined;
      pending.delete(name);
      adopted.add(name);
      return partition;
    },
  };
}

/**
 * The child's half: an engine, its command table, and the two calls above.
 *
 * A factory over an object literal rather than a class, because there is no
 * state here beyond what is closed over and nothing to subclass -- and because
 * a `WorldRunnerHandle` is what every caller actually holds. The two names
 * below are the whole of the child's surface.
 *
 * Deliberately NOT a `WorldEngine`. It is the same operations with the
 * partitions made explicit, and collapsing the two would hide exactly the
 * thing this file exists to make visible: that a command's partitions are
 * decided before it runs and supplied from outside.
 */
/**
 * THE PARTITIONS THE ENGINE HOLDS AS LIVE SUBTREES (#217).
 *
 * The other half of "this child already has it", and the half `declare` used
 * to miss. The inlined store holds bytes the parent sent; the ENGINE holds the
 * tree, and a partition the bundle's `genesis` BUILT was never in the store at
 * all -- `registerResident` put it straight into the engine. So a store-only
 * subtraction reported every genesis partition as needed on the first command
 * that named it, in the very instance that had just created it: one wasted
 * storage read and transfer per room, and a second serialized copy pinned in
 * isolate memory until an eviction forgot it.
 */
function residentNames(engine: WorldEngine): Set<string> {
  return new Set(engine.residency().map((partition) => partition.name));
}

/**
 * Take what the parent sent, DROPPING what the engine already holds (#217).
 *
 * Bytes for a resident partition have nothing to be adopted into --
 * `ensureResident` returns early -- so keeping them would leave a second copy
 * of a live subtree sitting in the store's pending map for the life of the
 * world, which is exactly what `InlinedPartitionStore` says it does not do.
 */
async function adopt(
  engine: WorldEngine,
  store: InlinedPartitionStore,
  supplied: Readonly<Record<string, StoredPartition>>,
): Promise<void> {
  const resident = residentNames(engine);
  const fresh: Record<string, StoredPartition> = Object.create(null) as Record<
    string,
    StoredPartition
  >;
  for (const [name, partition] of Object.entries(supplied)) {
    if (!resident.has(name)) fresh[name] = partition;
  }
  store.provide(fresh);
  await engine.hydrate(Object.keys(fresh));
}

export function createWorldRunner(
  engine: WorldEngine,
  store: InlinedPartitionStore,
  buildGenesis: () => Record<string, StoredPartition> = () => ({}),
  /**
   * The bundle's `world.migration.create`, or a world that adds no roots (#218).
   *
   * Supplied the same way `buildGenesis` is, and for the same reason: the
   * runner is handed the ENGINE rather than the game, and only `createWorld`
   * holds both the game and the bundle's declaration.
   */
  buildMigrationRoots: (
    game: Game,
    ctx: WorldMigrationCreateContext,
  ) => Record<string, GameElement> = () => ({}),
): WorldRunnerHandle {
  return {
    /**
     * Which partitions the parent must send for this command.
     *
     * Answered from the bundle's own declaration, WITHOUT running anything --
     * that is what `partitions(args, seat)` is for, and it is why the contract
     * requires it to be answerable with no world loaded. An unknown command,
     * and a player reaching for the clock's own (#120), are refused here rather
     * than after a storage read, so neither costs anything.
     *
     * THE ACTING PLAYER IS NAMED (#121), because the declaration is now allowed
     * to see the acting seat -- and the ENGINE is what turns a player into one,
     * since the roster is the engine's. This used to read the command table
     * directly, which is exactly why a command could not name "my own holding".
     */
    async declare(
      command: WorldCommand,
      player: string | null,
      supplied: Readonly<Record<string, StoredPartition>>,
    ): Promise<WorldDeclaration> {
      // WHAT THE LAST ROUND ASKED FOR, MADE RESIDENT (#122). Adopted rather
      // than merely held, because a declaration reads through the ENGINE's live
      // tree and bytes sitting in the store answer nothing.
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      return {
        needs: engine
          .commandPartitions(player, command)
          .filter((name) => !store.holds(name) && !resident.has(name)),
      };
    },

    async genesis(): Promise<Record<string, StoredPartition>> {
      return buildGenesis();
    },

    serialize(dirty: readonly string[]): Promise<Record<string, string>> {
      return engine.serializePartitions(dirty);
    },

    async migratePartition(
      name: string,
      stored: StoredPartition,
      transform: (element: GameElement) => void,
    ): Promise<string> {
      await adopt(engine, store, { [name]: stored });
      engine.migratePartition(name, transform);
      const written = await engine.serializePartitions([name]);
      return written[name] as string;
    },

    async migrateCreate(
      existing: readonly string[],
      ctx: { readonly from: number; readonly to: number },
    ): Promise<Record<string, StoredPartition>> {
      return engine.createMigratedPartitions(
        (game) => buildMigrationRoots(game, { ...ctx, existing }),
        existing,
      );
    },

    async createPartition(name: string): Promise<StoredPartition | undefined> {
      return engine.createPartition(name);
    },

    seat(player: string, seat: number): void {
      engine.seat(player, seat);
    },

    residency() {
      return engine.residency();
    },

    /**
     * Which partitions these players' views are about (#95).
     *
     * The read path's `declare`, and the same subtraction: what the parent must
     * SEND, not everything the views name -- so a second look at a world that
     * is already resident reads no storage at all.
     *
     * MANY PLAYERS, ONE ANSWER (#114). A notice reaches an event's whole
     * audience and every client answers with a view request, so the parent
     * batches them; a per-player call would put the O(watchers) round trips
     * back a layer down from where they were removed.
     */
    async declareViews(
      players: readonly string[],
      supplied: Readonly<Record<string, StoredPartition>>,
    ): Promise<WorldViewNeeds> {
      // The read path's half of #122's second round, and the same adoption: a
      // `view` that is about the room a player is standing in cannot know which
      // room that is until the index it named is in the tree.
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      const needs = new Set<string>();
      const refused: Record<string, WorldViewRefusal> = {};
      for (const player of players) {
        // PER PLAYER, INSIDE ONE CALL (#310). `viewPartitions` runs the
        // bundle's own `world.view` for that seat and reads the seat off the
        // roster, so it throws for a seat the game cannot describe and for a
        // player the engine does not hold. Recorded and skipped, because the
        // union of everybody ELSE's declaration is still exactly right and the
        // parent still loads it in one round trip.
        //
        // The refusals are the LAST round's, and that is what the parent keeps:
        // a declaration is asked again once what it named is resident, so a
        // seat that threw reaching for an absent partition may well succeed on
        // the round after the one that loaded it.
        try {
          for (const name of engine.viewPartitions(player)) {
            if (!store.holds(name) && !resident.has(name)) needs.add(name);
          }
        } catch (error) {
          refused[player] = viewRefusalOf(error);
        }
      }
      return { needs: [...needs], refused };
    },

    async viewsFor(players: readonly string[]): Promise<WorldViews> {
      // NOTHING TO SUPPLY. Everything these views are about was adopted while
      // the declaration was settling (#122), so this projects and never fetches.
      const views: Record<string, unknown> = {};
      const refused: Record<string, WorldViewRefusal> = {};
      // ONE SEAT'S PROJECTION IS ONE SEAT'S FATE (#310). `viewFor` runs the
      // bundle's `world.view` and then `toJSONForPlayer` for that seat alone,
      // and either can throw for one player while every other view in the
      // batch is perfectly computable -- the observed case being a view that
      // reaches a deliberately absent partition after a wake. Captured here,
      // the failing seat is refused by name and the rest of the audience is
      // answered.
      for (const player of players) {
        try {
          views[player] = await engine.viewFor(player);
        } catch (error) {
          refused[player] = viewRefusalOf(error);
        }
      }
      return { views, refused };
    },

    async declareOffers(
      player: string,
      supplied: Readonly<Record<string, StoredPartition>>,
    ): Promise<WorldDeclaration> {
      // The offer path's half of the same adoption the write path makes: a
      // declaration reads through the ENGINE's live tree, and bytes sitting in
      // the store answer nothing.
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      return {
        needs: engine
          .offerPartitions(player)
          .filter((name) => !store.holds(name) && !resident.has(name)),
      };
    },

    offersFor(player: string, stamp: WorldOfferStamp): Promise<readonly WorldActionOffer[]> {
      return engine.offersFor(player, stamp);
    },

    evict(names: readonly string[]): void {
      // BOTH HALVES ARE THE ENGINE'S NOW. It releases the live subtree and
      // tells its own `WorldPartitionSource` to stop claiming the name, because
      // eviction is no longer the only caller: #68's rollback drops a partition
      // too, and a paired operation with two callers is how the pairing comes
      // apart. Without the second half `declare` subtracts the partition from
      // what the parent must send, so the next command that needs it finds
      // nothing anywhere.
      engine.evict(names);
    },

    /** Run the command, against a world `declare` already finished assembling. */
    async apply(request: WorldApplyRequest): Promise<WorldCommandResult> {
      // `timing` decides which road, and it also decides the clock: a
      // scheduled event's `now` is its own `due`, which `onEvent` takes from
      // the timing it is already given. `arrivedAt` is the PLAYER command's
      // clock, stamped by the parent (#57).
      return request.timing === null
        ? engine.applyCommand(request.player as string, request.command, {
            now: request.arrivedAt,
            allowance: request.allowance,
            presence: request.presence,
          })
        : engine.onEvent(request.command, request.timing, {
            allowance: request.allowance,
            presence: request.presence,
          });
    },
  };
}

/** The parent's side of the boundary, as the little of it the driver needs. */
export interface WorldRunnerHandle {
  /**
   * The partitions a brand-new world starts with (#37 item 1).
   *
   * THE BUNDLE IS THE AUTHORITY, and it has to be: only the game knows what a
   * world contains before anybody has played it. The platform's alternative was
   * to invent a shape and make every game conform, which is the opposite of
   * what `WorldCommandTable` is for.
   *
   * Answers `name -> { parentId, json }`, which is exactly what
   * `DurableObjectPartitionStore.create` takes -- the parent writes them and
   * never looks inside.
   */
  genesis(): Promise<Record<string, StoredPartition>>;
  /**
   * Serialize exactly the partitions the parent says are dirty (#37 item 4).
   *
   * The dirty set is the ENGINE's own answer, accumulated by the PARENT across
   * however many commands one checkpoint covers -- `WorldCommandResult.dirty`
   * is per command, and `BoardSmithWorldEngine` says outright that unioning
   * them is the caller's job. Nothing here decides what changed; the parent
   * hands back what it accumulated and gets bytes.
   */
  serialize(dirty: readonly string[]): Promise<Record<string, string>>;

  /**
   * MIGRATE ONE PARTITION, from bytes to bytes (#200).
   *
   * Hands the partition's own element to the bundle's migration hook and
   * answers what it serializes to. Adoption is done here rather than by the
   * caller because a migration reads bytes the CALLER holds -- a world's
   * stored partitions -- rather than anything this runner already has resident.
   *
   * Nothing is written: the caller collects every answer and commits them
   * together, because a migration that landed halfway is a world whose rooms
   * disagree about which rules wrote them.
   */
  migratePartition(
    name: string,
    stored: StoredPartition,
    transform: (element: GameElement) => void,
  ): Promise<string>;

  /**
   * THE DURABLE PARTITION ROOTS THIS MIGRATION ADDS (#218).
   *
   * `migratePartition` transforms a root that exists; it cannot answer more
   * roots and has nowhere to say what a new one hangs from, so a world that
   * outgrew its genesis -- twelve empires becoming five hundred, one shared
   * timeline becoming a region apiece -- had no expressible upgrade at all,
   * because genesis runs once and never again.
   *
   * `existing` is every name the world already holds; the bundle's hook filters
   * against it, and a duplicate is refused by name rather than replacing a live
   * partition's bytes with a fresh element.
   *
   * Nothing is written, for the reason `migratePartition` writes nothing: the
   * caller lands these in the SAME transaction as the transformed partitions.
   */
  migrateCreate(
    existing: readonly string[],
    ctx: { readonly from: number; readonly to: number },
  ): Promise<Record<string, StoredPartition>>;

  /**
   * A PARTITION ROOT THE STORE HAS NEVER HELD, built on demand (#218).
   *
   * The host looks for a declared partition, finds no row, and asks here before
   * refusing: the bundle answers an element for a name it creates on first use,
   * and nothing for a name that is simply wrong. Idempotent -- a name already
   * resident is answered from residency rather than rebuilt -- so the host may
   * ask on every miss.
   *
   * The host owns the write, as it owns every other write.
   */
  createPartition(name: string): Promise<StoredPartition | undefined>;
  /**
   * Admit a player to a world that is already running (#37 item 2).
   *
   * Separate from every other operation because it is the only one that
   * changes WHO the world is for rather than what it contains. A persistent
   * world's roster outlives no season boundary in particular: players join one
   * that is already running, and the engine cannot be rebuilt to admit them
   * without evicting everything resident in it.
   */
  seat(player: string, seat: number): void;
  /**
   * Which partitions are resident and how recently each was named (#43).
   *
   * The parent cannot answer this: residency is a property of the live tree in
   * the child, and the parent deliberately never parses a partition. So it asks
   * -- and then decides, because only the parent knows what is dirty.
   */
  residency(): readonly { readonly name: string; readonly lastUsed: number }[];
  /**
   * WHAT THESE PLAYERS' VIEWS ARE ABOUT, before any of them is computed (#95).
   *
   * Declare-then-read, which is `declare`/`apply` on the other half of the
   * protocol and for the same reason: the child cannot reach the parent's
   * storage, so it says what it needs and is told.
   *
   * A PLAYER WHOSE DECLARATION THROWS IS NAMED, NOT RAISED (#310). One asker's
   * failure may not decide the batch's, and the union the other players need is
   * unaffected by it.
   */
  declareViews(
    players: readonly string[],
    supplied: Readonly<Record<string, StoredPartition>>,
  ): Promise<WorldViewNeeds>;
  /**
   * THESE PLAYERS' VIEWS OF THE WORLD (#44, #114).
   *
   * Computed on demand and per player, which is the whole read-cost argument:
   * a view costs what that player can see rather than what the world contains.
   * It is what replaces the round architecture's per-round fan-out of
   * pre-computed views.
   *
   * A LIST RATHER THAN ONE PLAYER, because the read path's real unit is an
   * audience: one world-visible change makes every watcher ask at the same
   * instant, and answering them one call at a time serializes the whole
   * audience under the parent's world lock (#114). The partitions arrived
   * during `declareViews`, exactly as a command's arrive during `declare`.
   *
   * AND A LIST OF ANSWERS, NOT ONE ANSWER (#310). Each player gets a view or a
   * refusal of their own; a throw computing one seat's view is that seat's, and
   * raising it would refuse the whole audience for one unviewable watcher.
   */
  viewsFor(players: readonly string[]): Promise<WorldViews>;
  /** Release these partitions. Safe only immediately after a checkpoint. */
  evict(names: readonly string[]): void;
  /**
   * What this SEAT may do here, enumerated (#85, #91, #169).
   *
   * Applies nothing. It LOADS what each action's round-one declaration names,
   * which for every catalogue game is a subset of what that seat's view already
   * names -- so an offer over a seat that has just looked reads no storage.
   */
  offersFor(player: string, stamp: WorldOfferStamp): Promise<readonly WorldActionOffer[]>;
  /**
   * Which partitions an offer for this seat still needs (#169).
   *
   * `supplied` is what the last round asked for. Drive it with
   * `walkDeclaration`, exactly as a command's declaration is driven.
   */
  declareOffers(
    player: string,
    supplied: Readonly<Record<string, StoredPartition>>,
  ): Promise<WorldDeclaration>;
  /**
   * Which partitions this command needs, and who is asking for them (#121).
   *
   * `player` is null for a scheduled event. It is here because the bundle's
   * `partitions(args, seat, world)` may name the ACTING SEAT's own partition,
   * and the seat is a fact only the engine's roster holds.
   *
   * `supplied` is WHAT THE LAST ROUND ASKED FOR (#122). The child adopts it
   * before answering, so a declaration that could only be made by reading the
   * world is made on the round after the one that loaded it. Empty on the
   * first round, which is every declaration a world without location state ever
   * makes.
   */
  declare(
    command: WorldCommand,
    player: string | null,
    supplied: Readonly<Record<string, StoredPartition>>,
  ): Promise<WorldDeclaration>;
  apply(request: WorldApplyRequest): Promise<WorldCommandResult>;
}

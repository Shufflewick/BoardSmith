/**
 * A RESIDENT WORLD: everything a host does to a world that is not transport.
 *
 * `boardsmith/world` says what a world IS. This says how one is DRIVEN -- the
 * declare-then-run-then-checkpoint loop, the world lock that makes it
 * single-threaded, the per-seat projection a watcher is sent, the offer walk,
 * the schedule drain, the genesis/migration a start performs, and the two
 * controls that exist because somebody is watching ("fire due events now" and
 * "wake from parked").
 *
 * ## WHY IT IS HERE AND NOT IN `boardsmith dev`
 *
 * It was in `boardsmith dev`, as private methods on `LocalWorldHost`, which
 * made it unreachable to anything without a socket. That is why no test could
 * construct or drive a world the way a host does, and why the platform's own
 * hidden-information DOM gate could not be aimed at the surface that most needs
 * it (#262). There are now two drivers of exactly this loop -- the dev host and
 * `boardsmith/testing`'s `TestWorld` -- and the projection a test scans has to
 * be the one a host SENDS, not a second implementation of it that can drift.
 *
 * ## WHAT IS STILL THE HOST'S
 *
 * Sockets, frames, who is attached, what a browser is told and in what words,
 * departure grace timers, and the seat switcher. This core answers in values
 * and raises refusals; it sends nothing and knows about no client. The three
 * facts it cannot derive arrive as callbacks: who is watching (`presence`), a
 * durable id for a scheduled event (`mintId`), and where narration and notices
 * go (`onEvents`, `onNotice`).
 *
 * ## CHECKPOINT PER COMMAND
 *
 * Every command and every drained event ends in one `writeCheckpoint`, so the
 * longest window in which work can be lost is one command. The hosting platform
 * accumulates a dirty set across a batch and writes once, because it is paying
 * for storage round trips under a world lock held against 500 sockets; a laptop
 * and a test are not, and what they need to be able to trust is that the world
 * is exactly where it was left.
 *
 * ## ONE WORLD LOCK, AS A PROMISE CHAIN
 *
 * A command arriving while a drain is running would interleave two dispatches
 * over one engine, and the engine's rollback baseline is per dispatch. Every
 * entry point goes through {@link ResidentWorld.run}, so a world is
 * single-threaded here exactly as a world lock makes it single-threaded on the
 * platform.
 *
 * ## Every public member is called through a private field
 *
 * `LocalWorldHost` and `TestWorld` call each one through a private field
 * holding this class. The pinned fallow (3.28.0) resolves that reference, so
 * no member needs a `fallow-ignore` marker; the markers an older fallow needed
 * were removed in #545.
 */
import {
  WORLD_OWNER,
  assertSeatWithinWorld,
  createWorld,
  nextDueBatch,
  runDueOccurrences,
  dispatchStep,
  rearmAt,
  readWorldDefinition,
  settleDeclaration,
  walkDeclaration,
  applyNoticeWrites,
  worldRefusal,
  WorldRefusal,
  assertWorldOrder,
  migratedArgs,
  planMigration,
  receiptFloor,
  resolveOrder,
  type PlannedEvent,
  type RoutedEvent,
  type SeatActivityStamp,
  type ScheduleAllowance,
  type StoredPartition,
  type WorldBudgets,
  type WorldCommand,
  type WorldPresenceDeclaration,
  type WorldRunner,
  type WorldRunnerHandle,
  type WorldRunnerOptions,
  type WorldActionOffer,
  type WorldOrder,
  type WorldReceipt,
  type WorldTiming,
  type SettledNoticeBox,
  type WorldNoticeWrites,
} from "../index.js";
import type { WorldHostClock } from "./clock.js";
import type { WorldStore } from "./store.js";

/**
 * WHO A SEAT IS, and it is a function rather than a literal because both halves
 * have to agree: the roster a store keeps is durable, so the name a seat is
 * written under on Monday is the name it must be looked up under after a
 * restart on Tuesday.
 *
 * A seat is where a player's holdings are and is never handed on, so a host
 * that minted a random id per run would strand every seat it ever opened -- a
 * world with three logs in it and nobody who can reach them.
 */
export function worldSeatPlayer(seat: number): string {
  return `seat-${seat}`;
}

/**
 * THE CHAIR A DISPATCH FINALIZED THE VACANCY OF, for the checkpoint (#278).
 *
 * `#activityWrite`'s shape, and spread into the same write for the same reason:
 * the release is downstream of the ground coming back, so a checkpoint that
 * refuses leaves the chair HELD and the estate standing -- the one pairing that
 * must not come apart. ABSENT is the normal case, and it is also what a retried
 * teardown answers once the chair is already empty.
 */
function vacancyWrite(
  vacated: { readonly seat: number; readonly player: string } | undefined,
): { vacate?: { readonly seat: number; readonly player: string } } {
  return vacated === undefined ? {} : { vacate: vacated };
}

interface ResidentWorldOptions {
  /** The bundle's `gameDefinition`, exactly as `createWorld` reads it. */
  readonly definition: WorldRunnerOptions["definition"];
  /** The world's seed. The same one on every wake, or randomness makes a
   *  different world each time the host rebuilds it. */
  readonly seed: string;
  /** THE CEILINGS THIS WORLD RUNS. Passed, never read, so two hosts cannot
   *  silently disagree (#165). */
  readonly budgets: WorldBudgets;
  readonly store: WorldStore;
  readonly clock: WorldHostClock;
  /**
   * WHICH SEATS ARE WATCHING, at the instant this asks.
   *
   * Derived and never stored: a persisted claim about who holds a socket is
   * falsified by the first restart, so a parked world reports nobody rather
   * than a memory of an audience that went home. Only the host knows.
   */
  readonly presence: () => readonly number[];
  /** A fresh durable id for a scheduled event. The host's, because a random
   *  source is a host capability and a test wants a predictable one. */
  readonly mintId: () => string;
  /** Narration the engine routed, for whoever is listening. Called with the
   *  events of each dispatch this core makes on its own -- a drained event, a
   *  presence hook -- never with the ones it hands back to a caller. */
  readonly onEvents?: (events: readonly RoutedEvent[]) => void;
  /** Something the audience must be told that is nobody's reply: a due event
   *  that refused and stays queued. */
  readonly onNotice?: (message: string) => void;
  /** The world moved on its own -- the armed timer fired and a batch drained --
   *  so whatever is on screen is stale. A caller's own commands do not reach
   *  this; it is for the changes nobody asked for. */
  readonly onChanged?: () => Promise<void> | void;
  /**
   * THE WORLD'S CLOCK FINALIZED A CHAIR'S VACANCY (#278).
   *
   * Called once per release, AFTER the checkpoint that made it durable, so
   * nothing a host does here is about a release that might still roll back.
   * Who was watching through that chair, and what they are told, is the host's:
   * this core sends nothing and knows about no client.
   */
  readonly onVacated?: (vacancy: { readonly seat: number; readonly player: string }) => void;
}

/** What one upgrade moved, for whoever says it out loud. */
export interface WorldMigrationOutcome {
  readonly from: number;
  readonly to: number;
  readonly partitions: number;
  /** How many NEW partition roots the upgrade added (#218). */
  readonly created: number;
  readonly events: number;
}

/**
 * WHAT STARTING A WORLD ANSWERED (#200).
 *
 * `migrated` is absent for the ordinary start -- a new world, or one whose
 * bytes already read as these rules read them -- and present when this start
 * moved the world forward a state version, with what it moved. A refusal is
 * thrown rather than reported: a world these rules cannot read is not a world a
 * host may serve.
 */
export interface WorldStartOutcome {
  readonly migrated?: WorldMigrationOutcome;
}

/** One player's view, or the reason there is not one. */
interface WorldSeatProjections {
  /** This seat's own body, or null when it has none. */
  bodyFor: (player: string) => unknown;
  /** Why a named player has no body, by player. */
  readonly failed: Readonly<Record<string, { code?: string; message: string }>>;
  /**
   * WHICH COMMITTED STATE THESE PROJECTIONS ARE OF (#244).
   *
   * Taken once, for the projection and for the offers that follow it, so that
   * the number on both frames is the same one: a page reading a late offer can
   * then tell whether it is about the world on its screen.
   */
  readonly revision: number;
}

/** What a player's ordered command did (#195). */
type WorldCommandOutcome =
  | {
      /** This order already committed once, and is answered from its receipt
       *  without running the handler again. */
      readonly kind: "replayed";
      readonly message?: string;
    }
  | { readonly kind: "committed"; readonly events: readonly RoutedEvent[] };

/** What "fire due events now" did, or null when nothing was scheduled. */
interface WorldFireOutcome {
  /** How far the world's clock was moved to reach the earliest due event. */
  readonly jumpMs: number;
  /** The world's total skew from the wall clock afterwards. */
  readonly skewMs: number;
}

export class ResidentWorld {
  readonly #store: WorldStore;
  readonly #budgets: WorldBudgets;
  readonly #definition: WorldRunnerOptions["definition"];
  readonly #seed: string;
  readonly #clock: WorldHostClock;
  readonly #presence: () => readonly number[];
  readonly #mintId: () => string;
  readonly #onEvents: (events: readonly RoutedEvent[]) => void;
  readonly #onNotice: (message: string) => void;
  readonly #onChanged: () => Promise<void> | void;
  readonly #onVacated: (vacancy: { readonly seat: number; readonly player: string }) => void;
  readonly #presenceDeclaration: WorldPresenceDeclaration | undefined;

  /** Rebuilt whole by `wake`, which is what makes that control real. */
  #world: WorldRunner;
  /**
   * HOW FAR AHEAD OF THE WALL CLOCK THIS WORLD IS.
   *
   * The whole of "fire due events now", and it is an offset rather than a
   * fabricated tick on purpose: the world's clock jumps to the instant the
   * event was actually due, so the handler still receives its own `due` and the
   * world computes exactly the state ten real minutes of waiting would have
   * produced. A control that invented a tick at `now` would produce a state no
   * published world ever reaches.
   *
   * A CACHE OF THE STORE'S VALUE, not a second copy of it (#216). The advance
   * is durable because the state it settled is, so it is read from the store
   * when this world is built and only ever reassigned from the store's own
   * answer -- a host that started at the wall over a world already settled in
   * the future would stamp commands that world has to refuse.
   */
  #skewMs: number;
  /** How many partitions were resident immediately before the last `wake`, so
   *  the control can say what it dropped rather than claim it. */
  #droppedOnWake = 0;
  /**
   * WHICH COMMITTED STATE THIS WORLD IS PUBLISHING (#244).
   *
   * Counted, not derived: it moves when and only when this world commits a
   * change, and it goes out on every state and every offer frame so a page can
   * tell whether an offer set is about the world on its screen.
   *
   * Two things move it, and they are the two things an offer is enumerated
   * against: a checkpoint, which is where a command's or an event's effects
   * become the world; and the clock's advance, because `now` is an input to
   * `offersFor` and a verb that opens at dawn is a different offer at a
   * different instant.
   *
   * A WAKE DOES NOT MOVE IT. Rebuilding the runner from the store throws away
   * what was resident and changes nothing about what the world IS, so offers
   * enumerated before it are still about this state.
   */
  #revision = 0;
  #closed = false;
  /** The world lock. Every entry point queues behind it. */
  #lock: Promise<unknown> = Promise.resolve();

  constructor(options: ResidentWorldOptions) {
    // FIRST, AND BEFORE ANYTHING IS BUILT. `bundle-not-a-world` is the refusal
    // an author most needs at the moment they run the command, and reaching it
    // through `createWorld` would mean a store had already been opened for a
    // project that has no world in it.
    readWorldDefinition(options.definition);
    this.#store = options.store;
    this.#budgets = options.budgets;
    this.#definition = options.definition;
    this.#seed = options.seed;
    this.#clock = options.clock;
    this.#presence = options.presence;
    this.#mintId = options.mintId;
    this.#onEvents = options.onEvents ?? (() => {});
    this.#onNotice = options.onNotice ?? (() => {});
    this.#onChanged = options.onChanged ?? (() => {});
    this.#onVacated = options.onVacated ?? (() => {});
    this.#skewMs = this.#store.clockSkewMs();
    this.#world = this.#build();
    this.#presenceDeclaration = readWorldDefinition(options.definition).presence;
  }

  /** How many seats this world's own rules declare. */
  get seatCount(): number {
    return this.#world.seatCount;
  }

  /** Which committed state this world is publishing (#244). */
  get revision(): number {
    return this.#revision;
  }

  /**
   * HAS THIS WORLD REPORTED THAT IT IS COMPLETE? (#395)
   *
   * Read from the store, because the ending is durable: a host rebuilt over
   * this store after a restart is looking at the same finished world. An ended
   * world refuses every command with `world-ended`, runs no scheduled event and
   * no clock command, and still answers views -- the platform's behaviour.
   */
  get completed(): boolean {
    return this.#store.endedAt() !== undefined;
  }

  /** How far ahead of the wall clock this world is running (#216). */
  get skewMs(): number {
    return this.#skewMs;
  }

  /** What time it is in this world: the host's clock plus the durable skew. */
  now(): number {
    return this.#clock.now() + this.#skewMs;
  }

  /** Which partitions are resident right now. The wake control's evidence. */
  residency(): readonly { readonly name: string; readonly lastUsed: number }[] {
    return this.#world.runner.residency();
  }

  /** How many partitions the last `wake` dropped. */
  residencyBeforeLastWake(): number {
    return this.#droppedOnWake;
  }

  /** Resolves once everything queued behind the world lock has run. */
  async settled(): Promise<void> {
    await this.#lock.catch(() => {});
  }

  // ── the world lock ─────────────────────────────────────────────────────────

  /**
   * RUN `body` WITH THE WORLD TO ITSELF.
   *
   * Public because a host's own entry points -- a socket message, a disconnect
   * -- do more than one thing to the world and must do them as one ordered
   * unit. Everything this class does on its own already runs inside it.
   */
  run<T>(body: () => Promise<T>): Promise<T> {
    const next = this.#lock.then(body, body);
    // Swallowed HERE and nowhere else: the chain must survive a rejection, or
    // one refused command would strand every later one behind a dead promise.
    // The caller still gets the rejection through `next`.
    this.#lock = next.catch(() => {});
    return next;
  }

  // ── construction and residency ─────────────────────────────────────────────

  #build(): WorldRunner {
    // THE DURABLE ALLOCATION (ShufflewickPub #377). A world's element ids
    // outlive every host that ever ran it and only a fraction of the partitions
    // holding them is ever resident, so the counter comes out of the store too.
    // Absent only for a world that has not launched yet: genesis owns its own
    // counter, and writes the stamp in the same transaction as its bytes.
    const nextElementId = this.#store.nextElementId();
    return createWorld({
      definition: this.#definition,
      seed: this.#seed,
      // THE WORLD'S ID KEY (#482), out of the store for the reason the stamp
      // is: it was minted once, when this world was created, and every stored
      // id is read back with it.
      elementIdKey: this.#store.elementIdKey(),
      // THE DURABLE ROSTER. A world's seats outlive every host that ever ran
      // it, so they come out of the store rather than out of this process.
      seats: new Map(this.#store.seats().map((row) => [row.player, row.seat] as const)),
      budgets: this.#budgets,
      ...(nextElementId === undefined ? {} : { nextElementId }),
    });
  }

  /**
   * THROW THE RESIDENT WORLD AWAY AND KEEP THE DURABLE ONE.
   *
   * `wake`'s machinery reached for a different reason: there, an author asks to
   * prove the rehydration path; here, the live tree has been made untrustworthy
   * by a checkpoint that would not land. The dirty marks go with it, because a
   * mark describes a live tree that no longer exists.
   */
  #discardResident(): void {
    this.#store.discardDirty(this.#store.dirtyPartitions());
    this.#world = this.#build();
  }

  async #readPartition(name: string, message: string): Promise<StoredPartition> {
    const partition = await this.#store.read(name);
    if (partition !== undefined) return partition;
    // NO ROW IS NOT YET NO PARTITION (#218). A world may build a root the first
    // time somebody reaches for it -- `world.createPartition` -- and only the
    // bundle can tell that name from a typo, so it is asked before the refusal.
    // The row is written here rather than at the next checkpoint: the partition
    // exists from the instant it is built, and a command that then refuses
    // leaves an empty root rather than a root nothing recorded.
    const built = await this.#world.runner.createPartition(name);
    if (built === undefined) throw worldRefusal("partition-missing", message);
    // THE BYTES AND THE STAMP TOGETHER (#377). `createOne` takes the whole
    // answer rather than the partition alone, so a host cannot write a minted
    // root and leave the allocation that produced it behind.
    this.#store.createOne(name, built);
    return built.partition;
  }

  /**
   * THE WATERMARK FOR THE SEAT A DISPATCH IS ABOUT (ShufflewickPub #383).
   *
   * `player` is who the dispatch is ABOUT, which is not always who is being
   * charged for it: a due event's schedules are billed to the world while the
   * deadline it checks belongs to a person, so the drain passes the EVENT's
   * owner here and the world's own reserved owner resolves to nobody.
   *
   * A POINT READ per dispatch. Five hundred empires and this asks about one,
   * which is what keeps an inactivity rule from costing what the world costs.
   */
  #activityFor(player: string | null): SeatActivityStamp | null {
    const seat = this.#seatOf(player);
    if (seat === undefined) return null;
    // #383's SHAPE, AND NOT #423's. `tenancy` answers a question this road
    // cannot ask: this stamp is resolved from a PLAYER, so the chair is
    // occupied by definition and a tenancy field on it would be a constant --
    // and a constant on a surface is a field somebody eventually branches on.
    const { seat: chair, at, since } = this.#store.activityOf(seat);
    return { seat: chair, at, since };
  }

  /**
   * THE WATERMARK THIS DISPATCH MOVES, if it moves one (ShufflewickPub #383).
   *
   * Spread into the checkpoint, so it lands with the effects it produced or
   * not at all. A PLAYER'S ROAD ONLY: a drained event runs at its NOMINAL due,
   * so recording one would let a world that came back after a week of downtime
   * write a week of activity nobody performed. And it is only ever reached on
   * the way OUT, past every refusal -- a watermark a rejected command could
   * move is a deadline any client holds open with garbage on a timer.
   */
  #activityWrite(
    player: string | null,
    arrivedAt: number,
  ): { activity?: { seat: number; at: number } } {
    const seat = this.#seatOf(player);
    return seat === undefined ? {} : { activity: { seat, at: arrivedAt } };
  }

  /**
   * THE RESIDENT ROSTER FOLLOWS THE DURABLE ONE (#278).
   *
   * Called only past the checkpoint, and in that order for the reason the
   * revision moves there: the store is the truth, and a chair released in
   * memory before the write landed would be one this host could not get back.
   * After it lands the two agree -- and they agree again after a discard,
   * because `#build` reads the roster out of the store.
   *
   * The host is told LAST, once the release is both durable and resident, so
   * nothing a page is told outlives a rollback.
   */
  #released(
    runner: WorldRunnerHandle,
    vacated: { readonly seat: number; readonly player: string } | undefined,
  ): void {
    if (vacated === undefined) return;
    runner.unseat(vacated.player);
    this.#onVacated(vacated);
  }

  /** The seat a player id is filed under, or undefined for the world's own
   *  reserved owner and for anybody this roster has never seated. */
  #seatOf(player: string | null): number | undefined {
    if (player === null || player === WORLD_OWNER) return undefined;
    return this.#store.seats().find((record) => record.player === player)?.seat;
  }

  #allowanceFor(owner: string): ScheduleAllowance {
    const pending = this.#store.pendingEvents();
    const mine = pending.filter((event) => event.owner === owner);
    return {
      unkeyed: mine.filter((event) => event.key === undefined).length,
      keys: [...new Set(mine.flatMap((event) => (event.key === undefined ? [] : [event.key])))],
      worldPending: pending.length,
    };
  }

  // ── starting ───────────────────────────────────────────────────────────────

  /**
   * LAUNCH THE WORLD IF IT HAS NEVER BEEN LAUNCHED.
   *
   * The launched flag and the genesis partitions commit together (`createAll`),
   * so a store reopened after a crash holds either an empty world or a whole
   * one -- never a world marked launched with nothing in it, which would refuse
   * every command it ever received for a partition whose absence nothing
   * explains.
   */
  async start(): Promise<WorldStartOutcome> {
    let migrated: WorldStartOutcome["migrated"] = undefined;
    await this.run(async () => {
      // BEFORE ANYTHING ASKS (ShufflewickPub #383). A seat's idleness is
      // measured from the instant this world began watching, and `activityOf`
      // refuses rather than invent one -- so the epoch is fixed here, on the
      // first open, ahead of genesis, migration and every command. Fixed once:
      // a later open is told the original answer, because an epoch that drifted
      // forward with each restart would reset everybody's idleness on every
      // deploy and no deadline would ever be reached.
      this.#store.activitySince(this.now());
      if (!this.#store.isLaunched()) {
        // GENESIS RECORDS THE VERSION IT WROTE UNDER (#200), with the bytes: a
        // world born on stateVersion 2 that recorded 0 would be asked to
        // migrate from a version it was never written in.
        await this.#store.createAll(
          await this.#world.runner.genesis(),
          readWorldDefinition(this.#definition).stateVersion ?? 0,
        );
      } else {
        // BEFORE ANYTHING IS WRITTEN (#400): an ended world is never moved
        // onto rules that read its bytes differently.
        this.#refuseNewVersionIfEnded();
        migrated = await this.#migrateIfNeeded();
      }
      this.rearm();
    });
    return { migrated };
  }

  /** Upgrade this world's bytes to the rules that are about to run them (#200). */
  async #migrateIfNeeded(): Promise<WorldStartOutcome["migrated"]> {
    const declaration = readWorldDefinition(this.#definition);
    const plan = planMigration({
      stored: this.#store.stateVersion(),
      declared: declaration.stateVersion ?? 0,
      migration: declaration.migration,
    });
    if (plan.kind === "current") return undefined;
    if (plan.kind === "refuse") throw plan.refusal;

    const { migration, from, to } = plan;

    // EVERY STORED ROOT, READ BEFORE ANY OF IT IS TRANSFORMED (#379). Only the
    // host has the store's whole key set, so the host reads and the runner
    // adopts -- and it adopts ALL of them before running a single hook, which
    // is what makes a derivation across roots independent of the order this
    // list happens to arrive in.
    const stored: Record<string, StoredPartition> = Object.create(null) as Record<
      string,
      StoredPartition
    >;
    for (const name of this.#store.partitionNames()) {
      stored[name] = await this.#readPartition(
        name,
        `Migrating this world needs partition "${name}", which its store does not have.`,
      );
    }

    // THE QUEUED EVENTS TOO. Their frozen arguments are as opaque to a host as
    // a partition's bytes, and mean exactly as much to the new handler.
    const events = this.#store.pendingEvents().map((event) => ({
      ...event,
      args: migratedArgs(migration, { action: event.action, args: event.args }),
    }));

    // ONE CALL: the per-root hooks, the roots this version adds (#218), the
    // whole-world `finalize` (#379), and the bytes taken only after all of them
    // have run. A hook that throws leaves the world on its old rules with its
    // old roots, playable, because nothing below has happened yet.
    const migrated = await this.#world.runner.migrateAll(stored, { from, to });

    this.#store.migrate({
      partitions: migrated.partitions,
      created: migrated,
      events,
      toStateVersion: to,
    });
    // THE RESIDENT TREE GOES WITH THE OLD BYTES. It was hydrated from them one
    // partition at a time to be transformed, which is not the state any command
    // should run against; the next one rebuilds from what was just written.
    this.#discardResident();
    return {
      from,
      to,
      partitions: Object.keys(migrated.partitions).length,
      created: Object.keys(migrated.created).length,
      events: events.length,
    };
  }

  // ── the roster ─────────────────────────────────────────────────────────────

  /**
   * GIVE `player` A SEAT, in the engine and in the durable roster.
   *
   * Refuses BEFORE anything durable is written: a seat past the bundle's
   * `maxPlayers` is a chair that does not exist, and seats are never reused, so
   * a refusal here has to burn nothing.
   *
   * `seatedAt` goes in the roster row because it is what a new holder's
   * idleness is measured from (ShufflewickPub #423): without it, a player who
   * joins a world that has been recording for four hundred days is found four
   * hundred days idle by the first sweep after they arrive.
   */
  seat(player: string, seat: number): void {
    assertSeatWithinWorld(player, seat, this.#world.seatCount);
    this.#world.runner.seat(player, seat);
    this.#store.seat(player, seat, this.now());
  }

  // ── what a seat sees ───────────────────────────────────────────────────────

  /**
   * THESE PLAYERS' VIEWS, projected through the bundle's own `world.view`.
   *
   * The declaration settles first and per BATCH, not per player: a notice
   * reaches an audience and every one of them wants a view, so one round of
   * declaration covers the lot. A player whose own `world.view` throws is named
   * in `failed` and everybody else is still answered -- one watcher's failure
   * may not decide the batch's.
   *
   * A failure that leaves NOBODY projectable -- the declaration itself could not
   * be settled -- is raised, because there is no per-player answer to give.
   */
  async viewsFor(players: readonly string[]): Promise<WorldSeatProjections> {
    const runner = this.#world.runner;
    let declined: Record<string, { code?: string; message: string }> = {};
    await settleDeclaration(
      async (supplied) => {
        const declared = await runner.declareViews(players, supplied);
        declined = { ...declared.refused };
        return declared.needs;
      },
      (name) =>
        this.#readPartition(
          name,
          `A view of this world is about partition "${name}", which this world's store does not ` +
            "have. The bundle's `world.view` names it; either the name is wrong or the " +
            "partition was never created.",
        ),
      "This world's `world.view` declaration",
    );
    const projecting = players.filter((player) => declined[player] === undefined);
    // TAKEN ONCE, FOR THE PROJECTION AND FOR THE OFFERS THAT FOLLOW IT. The
    // world lock holds for the whole of this call, so nothing can commit
    // between them: the number on the state frame is the same one the offers
    // were enumerated over, and saying so is what makes the two frames one
    // answer.
    const revision = this.#revision;
    // EACH DISTINCT VIEW ONCE (ShufflewickPub #408). The runner answers a table
    // of bodies and which one each seat holds, because seats of a world that
    // hides nothing between them hold the SAME body and a host that was handed
    // one copy per seat could not tell. A host with one reader per socket
    // simply looks its own up; the saving is the platform's, where a body is
    // encoded once for everybody naming it.
    const { bodies, of, refused } = await runner.viewsFor(projecting);
    return {
      bodyFor: (player: string): unknown => {
        const at = of[player];
        return at === undefined ? null : (bodies[at] ?? null);
      },
      failed: { ...declined, ...refused },
      revision,
    };
  }

  /**
   * WHAT THIS SEAT MAY DO, over what it can see (BoardSmith #169).
   *
   * Declared and supplied exactly as a command's partitions are, because the
   * engine names and the host reads: an offer walks each action's round-one
   * declaration and each selection's own, and every round it names is read out
   * of the store before it is asked again.
   */
  async offersFor(player: string): Promise<readonly WorldActionOffer[]> {
    const runner = this.#world.runner;
    await walkDeclaration(
      async (supplied) => ({
        partitions: (await runner.declareOffers(player, supplied, this.now())).needs,
        // NO CHAIRS ON THE OFFER ROAD, EVER (ShufflewickPub #423). An offer
        // belongs to a seat, and a seated action may not declare an activity
        // round at all -- `assertWorldAction` refuses one at construction -- so
        // this list is empty by the engine's own rule rather than by omission.
        seats: [],
        // Nor a notice box: an offer reads none (ShufflewickPub #521).
        noticeBoxes: [],
      }),
      (name) =>
        this.#readPartition(
          name,
          `An action offered to ${player} needs partition "${name}", which this world's ` +
            "store does not have. The action's `needs` names it; either the name is wrong or " +
            "the partition was never created.",
        ),
      // The reader a host has, wired the same way on both roads: what keeps it
      // out of an offer is the engine's rule above, not a host declining to
      // answer.
      (chair) => Promise.resolve(this.#store.activityOf(chair)),
      (seat) => Promise.resolve({ seat, box: this.#store.noticeBox(seat) }),
    );
    return runner.offersFor(player, {
      now: this.now(),
      presence: this.#presence(),
      // So a prompt may say how long this player has been away (#383).
      activity: this.#activityFor(player),
    });
  }

  /**
   * ONE SELECTION, RE-EVALUATED WITH THE ARGS BOUND SO FAR (ShufflewickPub
   * #378).
   *
   * A world's offer is enumerated in one frame with nothing bound, so a
   * selection whose `multiSelect` bounds or `choices` callback read an earlier
   * selection's value cannot be answered there: the panel asks again once it has
   * something to ask with, exactly as a table's does.
   *
   * It is a READ. Nothing is dispatched and nothing is checkpointed -- what it
   * changes is what is LOADED, which is residency and not state, and a partition
   * hydrated for a pick nobody went on to submit is cold by `residency`'s own
   * ordering and the first thing evicted.
   */
  async resolvePick(
    player: string,
    action: string,
    selection: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<WorldActionOffer["selections"][number]> {
    const runner = this.#world.runner;
    const now = this.now();
    await settleDeclaration(
      async (supplied) =>
        (await runner.declarePick(player, action, selection, args, now, supplied)).needs,
      (name) =>
        this.#readPartition(
          name,
          `Re-asking "${selection}" needs partition "${name}", which this world's store does ` +
            "not have. The action's own declaration names it; either the name is wrong or the " +
            "partition was never created.",
        ),
      `The "${action}" action's declaration`,
    );
    return runner.resolvePick(player, action, selection, args, {
      now,
      presence: this.#presence(),
      activity: this.#activityFor(player),
    });
  }

  /**
   * WHAT THE DRAFT IN FRONT OF THE PLAYER WOULD COST (#248).
   *
   * {@link resolvePick}'s twin, one step further on: a pick asks what one
   * selection may be, and this asks what the whole draft adds up to -- so the
   * args carry a number the player has typed and never submitted.
   *
   * IT IS A READ, on exactly the terms the pick is. A player being told a price
   * has not paid one, and the world is where it was when they came to it.
   */
  async quote(
    player: string,
    action: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly string[] | null> {
    const runner = this.#world.runner;
    const now = this.now();
    await settleDeclaration(
      async (supplied) => (await runner.declareQuote(player, action, args, now, supplied)).needs,
      (name) =>
        this.#readPartition(
          name,
          `Pricing "${action}" needs partition "${name}", which this world's store does not ` +
            "have. The action's own declaration names it; either the name is wrong or the " +
            "partition was never created.",
        ),
      `The "${action}" action's declaration`,
    );
    return runner.resolveQuote(player, action, args, {
      now,
      presence: this.#presence(),
      activity: this.#activityFor(player),
    });
  }

  // ── a player's command ─────────────────────────────────────────────────────

  /**
   * ONE ORDERED COMMAND FROM A SEAT (#195).
   *
   * THE ORDER IS SETTLED BEFORE THE COMMAND IS RUN. A repeat of an order this
   * world already committed is answered from its receipt: the handler does not
   * run, and the candidates the FIRST attempt consumed are never revalidated,
   * because consuming them is what it did.
   */
  async command(request: {
    player: string;
    /** THE ORDER'S DURABLE IDENTITY (#195), minted by the caller before the
     *  command was sent. A repeat carries the same one. */
    order: WorldOrder;
    action: string;
    args?: Record<string, unknown>;
  }): Promise<WorldCommandOutcome> {
    const { player, order, action } = request;
    const args = request.args ?? {};
    assertWorldOrder(order);
    // BEFORE THE RECEIPT CHECK, as on the platform: an ended world answers
    // every command the same way (#395).
    this.#refuseIfEnded();
    const decision = resolveOrder({
      order,
      receipt: this.#store.receipt(player, order.id),
      floorAt: this.#store.receiptFloorAt(),
    });
    if (decision.kind === "unanswerable") throw decision.refusal;
    if (decision.kind === "replay") {
      return {
        kind: "replayed",
        ...(decision.receipt.message === undefined ? {} : { message: decision.receipt.message }),
      };
    }
    // THE PLAYER'S OWN ARRIVAL INSTANT, taken once and used for everything
    // below: the catch-up's ceiling, the handler's `world.now`, and the
    // receipt. Reading the clock twice would let a long catch-up move the
    // instant the command claims to have arrived at.
    const arrivedAt = this.now();
    try {
      // EVERYTHING ALREADY DUE FIRST, for a world that declared it (#380).
      // After the receipt check above, so a REPLAYED order is answered from its
      // receipt without running the clock: a receipt is not a reason to tick.
      //
      // AND A WORLD STILL BEHIND DOES NOT RUN THIS COMMAND (ShufflewickPub
      // #395, #274). Raised BEFORE the dispatch, so the handler never runs and
      // no receipt is written: the world is exactly as it was, which is what
      // makes sending the same order again the right response rather than a
      // gamble. The `finally` below re-arms, so the catch-up is already
      // continuing while the player reads the refusal.
      if (await this.#catchUpBefore(arrivedAt)) {
        throw worldRefusal(
          "world-catching-up",
          "This world is still catching up on events that were due before your command " +
            "arrived, and its rules say a command must not overtake them. Nothing was changed. " +
            "Send it again in a moment -- it will run exactly once when the world is level.",
        );
      }
      // THE CATCH-UP CAN END THE WORLD, and then this command is refused like
      // any other that arrives after the ending (#395).
      this.#refuseIfEnded();
      const events = await this.#dispatch({
        player,
        command: { name: action, args },
        timing: null,
        arrivedAt,
        receipt: { orderId: order.id, player, at: arrivedAt },
      });
      return { kind: "committed", events };
    } finally {
      // RE-ARMED HERE AND NOT BY THE CALLER (#262). A command is the one road
      // that can both mint an event and, through the catch-up above, run one --
      // so it is the one road after which the armed instant may be wrong. It is
      // in a `finally` because a REFUSED command may still have drained a
      // catch-up on the way in, and a host that had to remember to re-arm is a
      // host that will eventually forget.
      this.rearm();
    }
  }

  /**
   * ONE COMMAND ISSUED BY THE CLOCK RATHER THAN BY A SEAT.
   *
   * A presence transition is the clock issuing one of the world's own verbs, so
   * a world still has exactly one way to change. Narrated through `onEvents`
   * and answered to nobody.
   *
   * RE-ARMED HERE, as `command` is (#327). A clock-issued verb can schedule --
   * an `onArrive` that books a welcome or a timeout is the ordinary case -- and
   * an event written to the store with no timer behind it waits for whatever
   * the world does next.
   */
  async clockCommand(name: string, args: Record<string, unknown>): Promise<void> {
    // AN ENDED WORLD HEARS NOTHING FROM ITS CLOCK EITHER (#395). The platform
    // drops a presence transition on an ended world the same way: nobody is
    // owed an answer, so there is nothing to refuse.
    if (this.completed) return;
    try {
      const events = await this.#dispatch({
        player: null,
        command: { name, args },
        timing: { due: this.now(), missedCount: 0 },
        arrivedAt: this.now(),
      });
      this.#onEvents(events);
    } finally {
      this.rearm();
    }
  }

  /** The bundle's own presence declaration, which is what a host's arrival and
   *  departure policy is written against. */
  get presenceHooks(): WorldPresenceDeclaration | undefined {
    return this.#presenceDeclaration;
  }

  /**
   * ONE COMMAND, DECLARED THEN RUN THEN MADE DURABLE.
   *
   * The same three steps in the same order the platform takes, through the same
   * library calls. What differs is only that the checkpoint is per command
   * rather than per batch, which is stated at the top of this file.
   */
  async #dispatch(request: {
    player: string | null;
    command: WorldCommand;
    timing: WorldTiming;
    arrivedAt: number;
    /** Event ids this dispatch settles, committed with its effects. */
    settle?: readonly string[];
    /** A recurrence's own re-arm, committed with the occurrence it follows. */
    rearm?: readonly PlannedEvent[];
    /** The receipt for the player order this dispatch is the effects of (#195),
     *  committed with them or not at all. */
    receipt?: WorldReceipt;
    /**
     * WHOSE IDLENESS THIS DISPATCH IS ABOUT (ShufflewickPub #383).
     *
     * `player` on a seat's own road, and the EVENT'S OWNER on the clock's,
     * where `player` is null because nobody is acting. They are different
     * questions -- who is charged, and who is being asked about -- and a
     * deadline handed the charge owner would be checking the world's idleness
     * instead of the person's.
     */
    about?: string;
  }): Promise<readonly RoutedEvent[]> {
    const { player, command, timing, arrivedAt } = request;
    const runner = this.#world.runner;

    // THE ORDER EVERY HOST SHARES (#539): walk the action's declaration
    // (BoardSmith #169), read this owner's allowance ONCE, apply with it, and
    // plan the command's schedules against the same allowance. The checkpoint
    // below is this host's own, per command.
    const { result, plan } = await dispatchStep(
      { player, command, timing, arrivedAt },
      {
        declare: (supplied, when, declared) =>
          runner.declare(command, player, supplied, when, declared),
        readPartition: (name) =>
          this.#readPartition(
            name,
            `Action "${command.name}" needs partition "${name}", which this world's store does not have.`,
          ),
        // ONE POINT READ PER CHAIR THE WALK NAMED (ShufflewickPub #423), and
        // per notice box (ShufflewickPub #521) -- the box, never the seat's
        // partition.
        readActivity: (seat) => Promise.resolve(this.#store.activityOf(seat)),
        readNoticeBox: (seat) => Promise.resolve({ seat, box: this.#store.noticeBox(seat) }),
        allowance: (asking) => Promise.resolve(this.#allowanceFor(asking)),
        apply: ({ allowance, answers }) =>
          runner.apply({
            player,
            command,
            timing,
            arrivedAt,
            allowance,
            // DERIVED HERE AND NEVER STORED. Who is watching is the host's
            // answer from its open connections at the instant it asks -- a
            // parked world reports nobody rather than a memory of an audience
            // that went home.
            presence: this.#presence(),
            // READ BEFORE THE COMMAND RUNS (#383), which is what makes it the
            // watermark from BEFORE this arrival: the handler is told when this
            // seat was last here, not that it is here now.
            activity: this.#activityFor(request.about ?? player),
            ...answers,
          }),
        planning: (owner) => {
          const pending = this.#store.pendingEvents();
          return Promise.resolve({
            nextSeq: this.#store.nextSeq(),
            mintId: this.#mintId,
            replaces: (key: string) =>
              pending.find((event) => event.owner === owner && event.key === key)?.id,
          });
        },
      },
      this.#budgets,
    );

    // RECORDED BEFORE THE CHECKPOINT, deliberately: a restart that finds a
    // non-empty dirty set is being told the truth about which partitions'
    // durable bytes are older than the last command that ran.
    this.#store.recordDirty(result.dirty);
    const dirty = this.#store.dirtyPartitions();
    try {
      await this.#store.writeCheckpoint(await runner.serialize(dirty), {
        // SETTLED AND ARMED IN THE SAME WRITE AS THE EFFECTS. A crash between
        // them would replay a handler onto already-durable state, or leave a
        // rolled-back command's timers behind.
        settle: [...(request.settle ?? []), ...plan.replaced],
        schedule: [...(request.rearm ?? []), ...plan.events],
        // THE ORDER'S RECEIPT LANDS WITH ITS EFFECTS (#195), or neither does.
        ...(request.receipt === undefined ? {} : { receipt: request.receipt }),
        // And the ledger is swept on the way past, so a world running for
        // months does not keep every answer it ever gave.
        receiptFloorAt: receiptFloor(this.now(), this.#budgets, this.#store.receiptFloorAt()),
        // THIS SEAT WAS HERE (ShufflewickPub #383), landing with the effects
        // it produced or not at all.
        ...this.#activityWrite(player, arrivedAt),
        // AND THIS CHAIR IS HANDED ON (#278), in the same write as the teardown
        // that earned it.
        ...vacancyWrite(result.vacated),
        // THE NOTICE BOXES THIS DISPATCH SENT TO OR TOOK (ShufflewickPub #521),
        // in the same write as its effects, so a notice exists exactly when the
        // command that sent it does.
        ...(await this.#noticeWrite(result.notices)),
        // THE ENDING IS DURABLE WITH THE EFFECTS THAT DECLARED IT (#395), and
        // the store empties the queue in the same write.
        ...(result.ending === "completed" ? { endedAt: arrivedAt } : {}),
      });
      // THE STATE MOVED, AND IT MOVED HERE (#244). After the write and not
      // before: a checkpoint that refuses is a command that did not happen, and
      // the discard below leaves the world at the revision it was already at.
      this.#revision += 1;
      this.#released(runner, result.vacated);
    } catch (error) {
      // A COMMAND THAT CANNOT BE MADE DURABLE IS A COMMAND THAT DID NOT HAPPEN.
      //
      // The handler ran and the resident tree changed, but the write refused --
      // an oversized partition is the reachable case -- so the live world and
      // the durable one now disagree, and the durable one is the truth. The
      // platform answers this by DISCARDING THE CHILD ISOLATE, and this is the
      // same move: the whole runner goes and the store is what is left, so the
      // sentence below is true rather than hopeful.
      this.#discardResident();
      throw rolledBack(error, command.name);
    }
    return result.events;
  }

  /** The boxes a dispatch's notice writes leave, for its checkpoint (#521). */
  async #noticeWrite(
    notices: WorldNoticeWrites | undefined,
  ): Promise<{ notices?: readonly SettledNoticeBox[] }> {
    if (notices === undefined) return {};
    return { notices: await applyNoticeWrites(notices, (seat) => this.#store.noticeBox(seat)) };
  }

  // ── the schedule ───────────────────────────────────────────────────────────

  /**
   * WHEN THIS WORLD NEXT WAKES ITSELF.
   *
   * `rearmAt` is the library's answer, so every host arms for the same instant:
   * the earliest pending event, or now when something is already overdue --
   * overload degrades to latency, never refusal.
   */
  rearm(): void {
    if (this.#closed) return;
    const at = rearmAt(this.#store.pendingEvents(), this.now());
    this.#clock.arm(at === null ? null : at - this.now(), () => {
      void this.run(async () => {
        await this.#drain();
        await this.#onChanged();
      });
    });
  }

  /**
   * ONE DRAIN: the batch that is due, and then a re-arm.
   *
   * ONE BATCH AND NOT A LOOP, which is the platform's shape and for its reason:
   * a world still behind after a batch re-arms for now, so being behind costs
   * latency rather than a refusal -- and a handler that re-armed itself at zero
   * delay produces a busy host rather than a wedged one.
   */
  async #drain(): Promise<void> {
    await this.#drainBatch(this.now());
    this.rearm();
  }

  /**
   * ONE BATCH OF EVENTS DUE AT OR BEFORE `now`, run in nominal order.
   *
   * Answers how many handler calls it actually made, which is what tells a
   * catch-up loop that it is making progress (ShufflewickPub #380): a batch
   * that ran nothing is a batch that will run nothing again, and the loop stops
   * rather than spinning on an event the world cannot move past.
   *
   * THE QUEUE IS RE-READ BEFORE EVERY ENTRY, AND THAT IS THE BATCH (#280). It
   * used to be selected once and then dispatched, which made "nominal order" a
   * claim about the queue as it was when the batch began rather than about the
   * queue. Every entry here ends in its own checkpoint, and a checkpoint can
   * insert an event due EARLIER than one the old list already held, cancel one
   * of them, or displace one with a keyed upsert -- so a chronological world
   * committed T+20 before the T+10 its own T event had just scheduled, and
   * fired occurrences its own earlier occurrence had taken back. The only way
   * a drain can honour an ordering is to arbitrate against what is committed.
   *
   * STILL ONE BATCH AND STILL BOUNDED: at most `drainBatch` entries, whoever
   * added them. Re-reading a queue the entries themselves can grow is exactly
   * how a drain becomes an unbounded loop, and the bound is what makes a
   * handler that re-arms itself at zero delay a slow world rather than a
   * wedged one.
   */
  async #drainBatch(now: number): Promise<number> {
    let ran = 0;
    // WHAT THIS BATCH HAS ALREADY TAKEN. An event that REFUSED stays queued by
    // design, and a re-read would hand back the same refusal until the bound
    // ran out; an event that ran is gone from the queue and is here only
    // because being spent is this batch's fact, not the store's.
    const spent = new Set<string>();
    for (let taken = 0; taken < this.#budgets.drainBatch; taken++) {
      // RE-ASKED BEFORE EVERY EVENT (#395): the one before may have ended the
      // world, and an ended world runs nothing else.
      if (this.completed) break;
      const event = this.#nextDue(now, spent);
      if (event === undefined) break;
      spent.add(event.id);
      ran += await this.#runQueued(event, now);
    }
    return ran;
  }

  /**
   * ONE QUEUED EVENT, AND EVERY OCCURRENCE OF IT THAT IS DUE AT `now`.
   *
   * A ONE-SHOT IS ONE CALL AT ITS OWN DUE. A RECURRENCE THAT FELL BEHIND IS
   * INTEGRATED, not replayed: at most `catchUpMaxRealIterations` real
   * iterations and then one coalesced call carrying how many got no call at
   * all, so a world that was away for a week is caught up in one wake. The
   * loop is `runDueOccurrences`, the one every host runs (#539).
   *
   * Answers how many calls it made, which is a batch's own measure of progress.
   */
  async #runQueued(event: PlannedEvent, now: number): Promise<number> {
    const outcome = await runDueOccurrences(event, now, this.#budgets, async (timing, owedDue) => {
      const events = await this.#dispatch({
        player: null,
        command: { name: event.action, args: event.args },
        timing,
        // ITS `now` IS ITS `due`, never the wall clock at execution: a world
        // that drained late must produce the state a punctual one would.
        arrivedAt: timing.due,
        // THE EVENT'S OWNER IS WHO IT IS ABOUT (#383), which is not who is
        // charged for it. A seat's own deadline rechecks that seat.
        about: event.owner,
        // SETTLED AND RE-ARMED WITH EVERY OCCURRENCE (#538), at the next one
        // still owed: each occurrence checkpoints on its own, so a later
        // refusal must find the event already past what ran, or the next wake
        // runs it again.
        settle: [event.id],
        rearm: owedDue === null ? [] : [{ ...event, due: owedDue, attempts: 0 }],
      });
      this.#onEvents(events);
      // A RECURRENCE CAN END THE WORLD on one of several occurrences due at
      // once, and the rest belong to a world that no longer runs (#395).
      return { ended: this.completed };
    });
    if (outcome.kind === "refused") {
      // A DUE EVENT THAT REFUSED IS SAID OUT LOUD AND LEFT QUEUED, at the
      // occurrence that refused -- which is where the last occurrence that ran
      // already re-armed it, so there is nothing more to write. Its effects
      // rolled back, so the world is unchanged; dropping it silently is how a
      // world stops ticking with nobody told.
      this.#onNotice(
        `The scheduled action "${event.action}" refused, and stays queued: ${messageOf(outcome.error)}`,
      );
    }
    return outcome.ran;
  }

  /**
   * THE EARLIEST EVENT DUE AT `now` THAT THIS BATCH HAS NOT TAKEN.
   *
   * `nextDueBatch` is the library's ordering and is asked for one, so the
   * order a re-reading drain runs in is the same `(due, seq)` a single
   * selection ran in -- insertion still breaks a tie within one millisecond,
   * and no second comparison of due times exists to disagree with it.
   */
  #nextDue(now: number, spent: ReadonlySet<string>): PlannedEvent | undefined {
    const queued = this.#store.pendingEvents().filter((event) => !spent.has(event.id));
    return nextDueBatch(queued, now, 1).batch[0];
  }

  /**
   * EVERYTHING ALREADY DUE, BEFORE THIS PLAYER'S COMMAND (#380).
   *
   * Reached only by a world that declared `world.ordering: 'chronological'`.
   * The default is the other one and it is deliberate: a host drains what it
   * can on the way in and applies the command whether or not the queue emptied,
   * because blocking every command on an arbitrarily long catch-up is the
   * failure that budget exists to prevent.
   *
   * A world whose clock is part of its rules cannot live with that. An event
   * that chooses an offer, creates its contract and schedules the next decision
   * cannot say which partitions that next decision needs until the earlier one
   * has committed, so it cannot be predeclared and a player who overtakes it
   * produces a state no punctual world reaches.
   *
   * BOUNDED, AND YIELDING. One `drainBatch` at a time, `catchUpRounds` of them
   * at most, with the runtime given a turn between each -- so a defective
   * handler that re-arms itself at zero delay makes a slow world rather than a
   * wedged one, and the host's own overload protections still apply.
   *
   * ANSWERS WHETHER THE WORLD IS STILL BEHIND, which is what the caller refuses
   * on (ShufflewickPub #395, #274). Running out of the budget, or meeting an
   * event that refuses, stops the catch-up with work still due -- and the
   * command is then NOT applied over it. This host used to apply anyway, which
   * made the declaration a bigger budget rather than an ordering: it held only
   * while a world was less than one budget behind, and past that a player
   * overtook the remainder with nothing anywhere saying so. The old reasoning
   * was that refusing "would make the player press the button again and lose
   * the ordering this exists to keep"; since #195 an order carries a durable
   * identity and receipt, so pressing again runs exactly once and in order.
   *
   * `arrivedAt` is the player's own stamped instant and is never moved. What
   * this changes is what has happened before their handler runs.
   */
  async #catchUpBefore(arrivedAt: number): Promise<boolean> {
    if ((readWorldDefinition(this.#definition).ordering ?? "arrival") !== "chronological") {
      // AN `arrival` WORLD IS NEVER BEHIND for this purpose. It did not ask not
      // to be overtaken, and the absence of a guarantee is not a lesser one.
      return false;
    }
    for (let round = 0; round < this.#budgets.catchUpRounds; round++) {
      if (!this.#anythingDueAt(arrivedAt)) return false;
      // A BATCH THAT RAN NOTHING WILL RUN NOTHING NEXT ROUND EITHER: an earlier
      // event refused, said so out loud, and stays queued. The world is behind
      // it and stopping here is what keeps this from spinning.
      if ((await this.#drainBatch(arrivedAt)) === 0) return true;
      // A TURN FOR EVERYTHING ELSE. The world lock is still held -- the catch-up
      // and the command it gates are one ordered unit -- but the runtime is not
      // starved, so a host under load stays answerable while it happens.
      await this.#clock.yieldTurn();
    }
    return this.#anythingDueAt(arrivedAt);
  }

  /** Whether any scheduled event was already due at `instant`, which is the
   *  whole of "is this world behind that instant?". */
  #anythingDueAt(instant: number): boolean {
    return this.#store.pendingEvents().some((event) => event.due <= instant);
  }

  /**
   * "FIRE DUE EVENTS NOW", and what it actually does.
   *
   * It moves the WORLD'S CLOCK forward to the instant the earliest pending
   * event was due, and then drains normally. So nothing is fabricated: the
   * handler receives its own `due`, a recurrence's later occurrences land on
   * their own beats, and what appears on screen is exactly the state waiting
   * ten real minutes would have produced. A control that invented a tick at
   * `now` would show an author a world no published one ever reaches.
   *
   * Answers null when nothing is scheduled, because there is then nothing to
   * fire and no clock to move.
   */
  async fireDue(): Promise<WorldFireOutcome | null> {
    const pending = this.#store.pendingEvents();
    if (pending.length === 0) return null;
    const earliest = Math.min(...pending.map((event) => event.due));
    const jumpMs = Math.max(0, earliest - this.now());
    // DURABLE BEFORE IT IS DRAINED. The partitions this firing settles become
    // durable at the advanced time, so the advance itself has to be on disk
    // first or a crash between the two leaves a world settled in a future its
    // next host does not know about.
    this.#skewMs = this.#store.advanceClock(jumpMs);
    // THE CLOCK IS PART OF WHAT AN OFFER IS ENUMERATED AGAINST (#244), so
    // moving it moves the state an offer can claim to be about -- a verb that
    // opens at dawn is a different offer at a different instant.
    if (jumpMs > 0) this.#revision += 1;
    await this.#drain();
    return { jumpMs, skewMs: this.#skewMs };
  }

  /**
   * DROP EVERYTHING RESIDENT AND REHYDRATE FROM THE STORE.
   *
   * The whole runner goes -- the engine, the live element tree, the inlined
   * partition store -- and a new one is built from the durable roster. Nothing
   * is reused, which is what makes this the path that finds an
   * `{ __elementId }` reference that was never adopted and an `adoptSubtree`
   * that grafted a partition in the wrong place: those are invisible on the
   * instance that ran `genesis`, because it has held the real objects all along.
   *
   * The dirty set is written FIRST. Rebuilding over unwritten bytes would lose
   * them and call it a wake. Answers how many partitions were dropped.
   */
  async wake(): Promise<number> {
    const dirty = this.#store.dirtyPartitions();
    if (dirty.length > 0) {
      await this.#store.writeCheckpoint(await this.#world.runner.serialize(dirty));
    }
    this.#droppedOnWake = this.#world.runner.residency().length;
    this.#world = this.#build();
    return this.#droppedOnWake;
  }

  /**
   * STOP, LEAVING NOTHING RESIDENT THAT IS NOT DURABLE.
   *
   * A dirty set survives a restart honestly -- it says those partitions'
   * durable bytes are older than the last command -- but there is no reason to
   * leave one behind when a host is stopping in an orderly way.
   */
  async close(): Promise<void> {
    await this.settled();
    this.#closed = true;
    this.#clock.arm(null, () => {});
    const dirty = this.#store.dirtyPartitions();
    if (dirty.length > 0) {
      await this.#store.writeCheckpoint(await this.#world.runner.serialize(dirty));
    }
    this.#store.close();
  }

  /**
   * REFUSE TO OPEN AN ENDED WORLD ON RULES OF ANOTHER STATE VERSION (#400).
   *
   * The platform never upgrades a finished season: it keeps the rules it
   * ended on and goes on answering views with them (ShufflewickPub
   * `games/src/world-session.ts`, `#upgradeDoorClosed`). A host here has only
   * the rules it was given, so it cannot keep the old ones beside them, and
   * reading the old bytes with new rules is what a migration exists to avoid.
   * So it refuses, before anything is written, and says what to do instead.
   * An ended world on rules of its own version opens as before.
   */
  #refuseNewVersionIfEnded(): void {
    if (!this.completed) return;
    const stored = this.#store.stateVersion();
    const declared = readWorldDefinition(this.#definition).stateVersion ?? 0;
    if (stored === declared) return;
    throw worldRefusal(
      "world-ended",
      "This world's season has already ended, so there are no rules left for it to run. " +
        "A finished season keeps the version it played on. " +
        `It ended under state version ${stored} and these rules declare ${declared}, and an ` +
        "ended world is never migrated. Run `boardsmith dev --reset` to start a new season on " +
        `these rules, or run the rules it ended on (state version ${stored}) to look at the ` +
        "finished one.",
    );
  }

  /** Refuse a command because this world has ended, in the platform's words. */
  #refuseIfEnded(): void {
    if (!this.completed) return;
    throw worldRefusal(
      "world-ended",
      "This world's season has ended, so it no longer answers commands.",
    );
  }

  /** Has this world been closed? A host's own timers must not reach a world
   *  that has stopped. */
  get closed(): boolean {
    return this.#closed;
  }
}

/** What went wrong, as a sentence. A `WorldRefusal`'s message is the one the
 *  author can act on, so it is passed through unedited. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The refusal, plus the one thing the player needs that the refusal cannot know:
 * that the command did not survive.
 *
 * The library's sentence explains what is wrong with the WORLD; this adds what
 * is true of the COMMAND, and it is worded once so an author who meets it in
 * both places meets it once.
 */
function rolledBack(error: unknown, command: string): Error {
  const message =
    `${messageOf(error)} Command "${command}" ran and was then rolled back, because the world ` +
    "could not be made durable -- nothing it changed survives, and sending it again is safe.";
  return error instanceof WorldRefusal
    ? worldRefusal(error.code, message)
    : Object.assign(new Error(message), { name: error instanceof Error ? error.name : "Error" });
}

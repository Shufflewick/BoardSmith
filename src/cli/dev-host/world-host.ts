/**
 * THE LOCAL WORLD HOST: what `boardsmith dev` runs when a project declares a
 * world (#167, closing #163).
 *
 * `MultiplayerHost`'s sibling, and deliberately its sibling rather than a mode
 * of it. A table's host owns a turn, an action table, undo, bots and
 * spectators; a world has none of the five, and its unit of change is a COMMAND
 * against NAMED PARTITIONS rather than an op against a whole resident tree.
 * Feeding one into the other would mean fabricating a turn and a flow position,
 * which is the same lie `worldProtocol.ts` refused for the UI half.
 *
 * ## IT DRIVES THE LIBRARY, IT DOES NOT REIMPLEMENT IT
 *
 * Every decision about what a world IS comes from `boardsmith/world`:
 * `createWorld` builds the runner, `settleDeclaration` runs declare-then-apply,
 * `planSchedules` is the only thing that mints an event, `nextDueBatch` and
 * `occurrencesDue` decide what a drain runs, `rearmAt` decides when the next
 * one happens, and every refusal is raised by the library at the line that
 * found it. What is HERE is the part that is a laptop's rather than a world's:
 * which sockets are open, when a checkpoint happens, what a browser is told,
 * and the two controls that exist because a person is watching -- "fire due
 * events now" and "wake from parked".
 *
 * That split is what makes #164's promise true by construction. A world that
 * ran differently here would make an author's local run a poor guide to their
 * published one, and the way to guarantee it does not is to leave the host
 * nothing to disagree about.
 *
 * ## CHECKPOINT PER COMMAND, WHICH IS THIS HOST'S POLICY AND NOT THE LIBRARY'S
 *
 * The platform accumulates a dirty set across a batch and writes once, because
 * it is paying for storage round trips under a world lock held against 500
 * sockets. A laptop is not, and the thing an author has to be able to trust is
 * "close the lid, open it again, and the world is where I left it". So every
 * command and every drained event ends in one `writeCheckpoint`, and the
 * longest window in which work can be lost is one command.
 *
 * ## ONE WORLD LOCK, AS A PROMISE CHAIN
 *
 * A command arriving while a drain is running would interleave two dispatches
 * over one engine, and the engine's rollback baseline is per dispatch. Every
 * entry point below goes through `#run`, so the world is single-threaded here
 * exactly as `#withWorldLock` makes it single-threaded on the platform.
 */

import { randomUUID } from 'node:crypto';

import {
  WORLD_OWNER,
  assertSeatWithinWorld,
  createWorld,
  nextDueBatch,
  occurrencesDue,
  planSchedules,
  rearmAt,
  readWorldDefinition,
  settleDeclaration,
  walkDeclaration,
  worldRefusal,
  WorldRefusal,
  assertWorldOrder,
  migratedArgs,
  planMigration,
  receiptFloor,
  resolveOrder,
  type PlannedEvent,
  type RoutedEvent,
  type ScheduleAllowance,
  type StoredPartition,
  type WorldBudgets,
  type WorldCommand,
  type WorldPresenceDeclaration,
  type WorldRunner,
  type WorldRunnerOptions,
  type WorldActionOffer,
  type WorldOrder,
  type WorldReceipt,
  type WorldTiming,
  lowestElementId,
  rekeyOffsetFor,
  rekeyPartition,
  rekeyReferences,
  worldIdAllocationOf,
} from '../../world/index.js';
import { createNodeWorldClock, type WorldDevClock } from './node-world-clock.js';
import type { LocalWorldStore } from './world-store.js';

/**
 * WHO A DEV SEAT IS, and it is a function rather than a literal because both
 * halves have to agree: the roster the store keeps is durable, so the name a
 * seat is written under on Monday is the name it must be looked up under after
 * a restart on Tuesday.
 *
 * A seat is where a player's holdings are and is never handed on, so a dev host
 * that minted a random id per run would strand every seat it ever opened -- a
 * world with three logs in it and nobody who can reach them.
 */
export function devWorldPlayer(seat: number): string {
  return `seat-${seat}`;
}

/** Reachable without being exported, the way `runner.ts` keeps `SchedulePlan`
 *  unexported: a caller writes an object literal and TypeScript checks it
 *  structurally. A name nothing imports is a public surface larger than its
 *  callers. */
interface LocalWorldHostOptions {
  /** The bundle's `gameDefinition`, exactly as `createWorld` reads it. */
  readonly definition: WorldRunnerOptions['definition'];
  /** What to call this world on screen. */
  readonly worldName: string;
  /** The world's seed. The same one on every wake, or randomness makes a
   *  different world each time the host rebuilds it. */
  readonly seed: string;
  /** THE CEILINGS THIS HOST RUNS. Passed, never read, so a laptop and the
   *  hosting platform cannot silently disagree (#165). */
  readonly budgets: WorldBudgets;
  readonly store: LocalWorldStore;
  readonly send: (clientId: string, message: unknown) => void;
  readonly clock?: WorldDevClock;
}

/**
 * WHAT STARTING A WORLD ANSWERED (#200).
 *
 * `migrated` is absent for the ordinary start -- a new world, or one whose
 * bytes already read as these rules read them -- and present when this start
 * moved the world forward a state version, with what it moved. A refusal is
 * thrown rather than reported here: a world these rules cannot read is not a
 * world this host may serve.
 */
interface WorldStartOutcome {
  readonly migrated?: WorldMigrationOutcome;
  /** Present when this start lifted a pre-floor world's ids (#223). */
  readonly lifted?: WorldLiftOutcome;
}

/** What one id lift moved, for whoever says it out loud. */
export interface WorldLiftOutcome {
  readonly offset: number;
  readonly partitions: number;
  readonly events: number;
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

/** Everything a browser may ask this host to do. */
export type WorldDevRequest =
  | { type: 'hello' }
  | { type: 'attach'; seat: number }
  | {
      type: 'action';
      requestId: string;
      /** THE ORDER'S DURABLE IDENTITY (#195), minted and written down by the
       *  page before the command was sent. A repeat carries the same one. */
      order: WorldOrder;
      action: string;
      args?: Record<string, unknown>;
    }
  | {
      type: 'pick';
      requestId: string;
      /** The action being walked, and which of its selections to re-ask. */
      action: string;
      selection: string;
      /** Every selection's value bound so far (ShufflewickPub #378). */
      args?: Record<string, unknown>;
    }
  | { type: 'fire_due' }
  | { type: 'wake' };

/**
 * A WORLD, RUNNING ON A LAPTOP.
 *
 * Constructed with a store that may already hold a world -- `start()` runs
 * genesis only when it does not.
 */
export class LocalWorldHost {
  readonly #store: LocalWorldStore;
  readonly #budgets: WorldBudgets;
  readonly #definition: WorldRunnerOptions['definition'];
  readonly #seed: string;
  readonly #worldName: string;
  readonly #send: (clientId: string, message: unknown) => void;
  readonly #clock: WorldDevClock;
  readonly #presenceDeclaration: WorldPresenceDeclaration | undefined;

  /** Rebuilt whole by `wake`, which is what makes that control real. */
  #world: WorldRunner;
  /** Which seat each open connection is looking through. */
  readonly #attached = new Map<string, number>();
  /** Departure timers, one per seat, for a bundle that declares `onDepart`. */
  readonly #departing = new Map<number, ReturnType<typeof setTimeout>>();
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
   * when this host is built and only ever reassigned from the store's own
   * answer -- a host that started at the wall over a world already settled in
   * the future would stamp commands that world has to refuse.
   */
  #skewMs: number;
  /** How many partitions were resident immediately before the last `wake`, so
   *  the control can say what it dropped rather than claim it. */
  #droppedOnWake = 0;
  #completed = false;
  #closed = false;
  /** The one shutdown, once it has been asked for. */
  #closing: Promise<void> | null = null;
  /** The world lock. Every entry point queues behind it. */
  #lock: Promise<unknown> = Promise.resolve();

  constructor(options: LocalWorldHostOptions) {
    // FIRST, AND BEFORE ANYTHING IS BUILT. `bundle-not-a-world` is the refusal
    // an author most needs at the moment they run the command, and reaching it
    // through `createWorld` would mean a store had already been opened for a
    // project that has no world in it.
    readWorldDefinition(options.definition);
    this.#store = options.store;
    this.#budgets = options.budgets;
    this.#definition = options.definition;
    this.#seed = options.seed;
    this.#worldName = options.worldName;
    this.#send = options.send;
    this.#clock = options.clock ?? createNodeWorldClock();
    this.#skewMs = this.#store.clockSkewMs();
    this.#world = this.#build();
    this.#presenceDeclaration = readWorldDefinition(options.definition).presence;
  }

  /** How many seats this world's own rules declare. */
  get seatCount(): number {
    return this.#world.seatCount;
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
    let migrated: WorldStartOutcome['migrated'] = undefined;
    let lifted: WorldStartOutcome['lifted'] = undefined;
    await this.#run(async () => {
      if (!this.#store.isLaunched()) {
        // GENESIS RECORDS THE VERSION IT WROTE UNDER (#200), with the bytes: a
        // world born on stateVersion 2 that recorded 0 would be asked to
        // migrate from a version it was never written in.
        await this.#store.createAll(
          await this.#world.runner.genesis(),
          readWorldDefinition(this.#definition).stateVersion ?? 0,
        );
      } else {
        // BEFORE ANY MIGRATION, AND BEFORE ANY ADOPTION (#223). A world
        // written before #218's construction-id floor holds roots at ids the
        // wider game's own construction now mints, so widening it failed on
        // the FIRST adoption -- before any migration hook could run, which is
        // to say at a moment no author could have reached. Lifting is a
        // storage-format concern rather than a rules one, so it is not gated
        // on `stateVersion`: a world whose ids are already above the floor
        // pays one comparison and nothing else.
        lifted = await this.#liftPreFloorIds();
        // AFTER THE LIFT (#377/#223). A world below the construction floor has
        // no allocation that means anything -- every id in it is one the wider
        // game's own construction mints -- so the stamp is derived from the
        // bytes the lift left behind, not from the ones it read.
        await this.#repairAllocationStamp();
        migrated = await this.#migrateIfNeeded();
      }
      this.#rearm();
    });
    return lifted === undefined ? { migrated } : { migrated, lifted };
  }

  /**
   * GIVE AN OCCUPIED WORLD THE ALLOCATION STAMP IT NEVER HAD (#377).
   *
   * A world launched before the stamp existed has partitions full of minted ids
   * and nothing recording how far the counter got. Deriving it means reading
   * every stored partition, which is the O(world) cost this whole mode exists
   * to avoid -- so it is paid ONCE, here, on the first start after the stamp
   * landed, and never again: the number is written and every later start reads
   * it out of meta.
   *
   * It runs BEFORE the lift and before any migration, because both of those
   * adopt, and an adoption against a missing stamp is exactly the corruption
   * the stamp exists to catch.
   */
  async #repairAllocationStamp(): Promise<void> {
    if (this.#store.nextElementId() !== undefined) return;
    const stored: StoredPartition[] = [];
    for (const name of this.#store.partitionNames()) {
      stored.push(
        await this.#readPartition(
          name,
          `Repairing this world's id allocation needs partition "${name}", which its store ` +
            `does not have.`,
        ),
      );
    }
    this.#store.recordAllocation(worldIdAllocationOf(stored));
    // The world was BUILT without a stamp, so the runner it holds still has the
    // construction floor for a counter. Rebuild it over the number just
    // written, before anything adopts against the old one.
    this.#discardResident();
  }

  /**
   * LIFT A WORLD WRITTEN BEFORE THE CONSTRUCTION-ID FLOOR (#223).
   *
   * `world/rekey.ts` carries the whole argument for the shape: one offset for
   * the whole world, chosen to put its lowest id exactly on the floor, applied
   * to every partition and every queued event so that ids keep meaning the
   * same thing ACROSS partitions.
   *
   * ONE TRANSACTION, and nothing is adopted first: a world half lifted is a
   * world whose references point at nothing, and unlike a checkpoint there is
   * no retry that could finish it -- the second attempt would shift bytes the
   * first had already shifted. It runs before `#migrateIfNeeded` because a
   * migration ADOPTS, and adoption is the thing that was failing.
   *
   * A world already above the floor -- every world written since #218 -- costs
   * one comparison per partition and writes nothing.
   */
  async #liftPreFloorIds(): Promise<WorldStartOutcome['lifted']> {
    const names = this.#store.partitionNames();
    const stored = new Map<string, StoredPartition>();
    let lowest = Number.POSITIVE_INFINITY;
    for (const name of names) {
      const partition = await this.#readPartition(
        name,
        `Reading this world needs partition "${name}", which its store does not have.`,
      );
      stored.set(name, partition);
      lowest = Math.min(lowest, lowestElementId(partition.json));
    }

    const offset = rekeyOffsetFor(lowest);
    if (offset === 0) return undefined;

    const partitions: Record<string, string> = {};
    const lifted: StoredPartition[] = [];
    for (const [name, partition] of stored) {
      const moved = rekeyPartition(partition.json, offset) as StoredPartition['json'];
      partitions[name] = JSON.stringify(moved);
      lifted.push({ parentId: partition.parentId, json: moved });
    }
    const events = this.#store.pendingEvents().map((event) => ({
      ...event,
      args: rekeyReferences(event.args, offset) as Record<string, unknown>,
    }));

    // THE STAMP COMES OFF THE LIFTED BYTES (#377). Every id in the world just
    // moved, so the stamp has to move with them -- and it is read from the
    // result rather than shifted by `offset`, because the bytes are already in
    // hand here and a number derived from them cannot drift from them.
    this.#store.rekey({ partitions, events, nextElementId: worldIdAllocationOf(lifted) });
    // THE RESIDENT TREE GOES WITH THE OLD BYTES, exactly as a migration's
    // does: nothing has been adopted yet on this start, and rebuilding is what
    // makes that true for certain rather than by inspection.
    this.#discardResident();
    return { offset, partitions: Object.keys(partitions).length, events: events.length };
  }

  /**
   * MOVE THIS WORLD ONTO THESE RULES, OR REFUSE TO RUN THEM OVER IT (#200).
   *
   * Before the first frame, before a browser is pointed at anything: an author
   * whose bundle cannot read the world in front of it meets the refusal in the
   * terminal, with the world untouched, rather than through a page whose every
   * command fails for a reason nothing states.
   *
   * ONE TRANSACTION for the whole thing (`store.migrate`). A migration that
   * landed halfway is a world whose rooms disagree about which rules wrote
   * them -- and unlike a checkpoint there is no retry that could finish it,
   * because the second attempt would read bytes the first had already moved.
   * A laptop's store is SQLite, so "all of it or none of it" is a transaction;
   * a host whose storage cannot do that owes the same guarantee by its own
   * means before it may claim this contract.
   */
  async #migrateIfNeeded(): Promise<WorldStartOutcome['migrated']> {
    const declaration = readWorldDefinition(this.#definition);
    const plan = planMigration({
      stored: this.#store.stateVersion(),
      declared: declaration.stateVersion ?? 0,
      migration: declaration.migration,
    });
    if (plan.kind === 'current') return undefined;
    if (plan.kind === 'refuse') throw plan.refusal;

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
    const events = this.#store
      .pendingEvents()
      .map((event) => ({
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
    // ANSWERED RATHER THAN BROADCAST: a migration runs before the first socket
    // exists, so there is nobody in the world to tell. The CLI says it in the
    // terminal, where the person who published the new rules is standing.
    return {
      from,
      to,
      partitions: Object.keys(migrated.partitions).length,
      created: Object.keys(migrated.created).length,
      events: events.length,
    };
  }

  async handleMessage(clientId: string, message: WorldDevRequest): Promise<void> {
    await this.#run(async () => {
      switch (message.type) {
        case 'hello':
          await this.#hello(clientId);
          return;
        case 'attach':
          await this.#attach(clientId, message.seat);
          return;
        case 'action':
          await this.#command(clientId, message);
          return;
        case 'pick':
          await this.#resolvePick(clientId, message);
          return;
        case 'fire_due':
          await this.#fireDueNow(clientId);
          return;
        case 'wake':
          await this.#wake(clientId);
          return;
      }
    });
  }

  /**
   * A SOCKET WENT.
   *
   * On a laptop that IS a departure: there is no hibernation to make a close
   * ambiguous, which is exactly the kind of question `WorldDefinition.presence`
   * says is the host's rather than the library's.
   */
  async disconnect(clientId: string): Promise<void> {
    await this.#run(async () => {
      const seat = this.#attached.get(clientId);
      this.#attached.delete(clientId);
      if (seat !== undefined && !this.#seatIsOpen(seat)) this.#armDeparture(seat);
      await this.#pushViews();
    });
  }

  /**
   * CLOSING TWICE IS CLOSING ONCE (#197).
   *
   * Ctrl-C through a package script delivers the signal to every process in
   * the group, so a host is routinely asked to stop twice; a second pass used
   * to reach a finalised statement on a database the first pass had already
   * closed. The shutdown is therefore one promise, handed to everybody who
   * asks -- so a second caller waits for the same orderly stop rather than
   * starting a second one.
   */
  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    await this.settled();
    this.#closed = true;
    this.#clock.arm(null, () => {});
    for (const timer of this.#departing.values()) clearTimeout(timer);
    this.#departing.clear();
    const dirty = this.#store.dirtyPartitions();
    if (dirty.length > 0) {
      // WHAT IS RESIDENT AND NOT YET DURABLE, WRITTEN ON THE WAY OUT. A dirty
      // set survives a restart honestly -- it says those partitions' durable
      // bytes are older than the last command -- but there is no reason to
      // leave one behind when the host is stopping in an orderly way.
      await this.#store.writeCheckpoint(await this.#world.runner.serialize(dirty));
    }
    this.#store.close();
  }

  // ── the world lock ─────────────────────────────────────────────────────────

  #run<T>(body: () => Promise<T>): Promise<T> {
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
    // Absent for a world that has not launched yet -- genesis owns its own
    // counter -- and for one written before the stamp existed, which `start`
    // repairs before anything is adopted.
    const nextElementId = this.#store.nextElementId();
    return createWorld({
      definition: this.#definition,
      seed: this.#seed,
      // THE DURABLE ROSTER. A world's seats outlive every host that ever ran
      // it, so they come out of the store rather than out of this process.
      seats: new Map(this.#store.seats().map((row) => [row.player, row.seat] as const)),
      budgets: this.#budgets,
      ...(nextElementId === undefined ? {} : { nextElementId }),
    });
  }

  #worldNow(): number {
    return this.#clock.now() + this.#skewMs;
  }

  #presence(): readonly number[] {
    return [...new Set(this.#attached.values())].sort((a, b) => a - b);
  }

  #seatIsOpen(seat: number): boolean {
    return [...this.#attached.values()].includes(seat);
  }

  // ── attaching, and the seat switcher ───────────────────────────────────────

  async #hello(clientId: string): Promise<void> {
    if (!this.#attached.has(clientId)) {
      await this.#attach(clientId, this.#firstFreeSeat(), { announce: true });
      return;
    }
    await this.#pushViews();
  }

  /** The lowest seat nobody has open, or seat 1 when the world is full of
   *  watchers -- a dev host's seats are shareable, unlike a table's. */
  #firstFreeSeat(): number {
    for (let seat = 1; seat <= this.#world.seatCount; seat++) {
      if (!this.#seatIsOpen(seat)) return seat;
    }
    return 1;
  }

  async #attach(clientId: string, seat: number, options: { announce?: boolean } = {}): Promise<void> {
    const player = devWorldPlayer(seat);
    try {
      // THE LIBRARY'S OWN DOOR, before anything durable is written. A seat past
      // the bundle's `maxPlayers` is a chair that does not exist, and seats are
      // never reused -- so a refusal here has to burn nothing.
      assertSeatWithinWorld(player, seat, this.#world.seatCount);
      this.#world.runner.seat(player, seat);
    } catch (error) {
      this.#notice(clientId, error);
      return;
    }
    const previous = this.#attached.get(clientId);
    this.#store.seat(player, seat);
    this.#attached.set(clientId, seat);
    const departing = this.#departing.get(seat);
    if (departing !== undefined) {
      clearTimeout(departing);
      this.#departing.delete(seat);
    }
    if (previous !== undefined && previous !== seat && !this.#seatIsOpen(previous)) {
      this.#armDeparture(previous);
    }
    if (options.announce !== false) await this.#announceArrival(seat);
    await this.#pushViews();
  }

  // ── presence hooks, which are this host's lifecycle policy ─────────────────

  /**
   * A SEAT ARRIVED, and the world is told through its own command table.
   *
   * The declaration names a `worldClockAction()` verb, so a transition is the CLOCK
   * issuing one of the world's verbs and a world still has exactly one way to
   * change. What is the host's is when: on a laptop an attach is an arrival the
   * instant it happens, because a socket here is unambiguous.
   */
  async #announceArrival(seat: number): Promise<void> {
    const command = this.#presenceDeclaration?.onArrive;
    if (command === undefined) return;
    await this.#clockCommand(command, { seat, present: true });
  }

  #armDeparture(seat: number): void {
    const command = this.#presenceDeclaration?.onDepart;
    if (command === undefined) return;
    const grace = this.#presenceDeclaration?.departGraceMs ?? 0;
    const existing = this.#departing.get(seat);
    if (existing !== undefined) clearTimeout(existing);
    this.#departing.set(
      seat,
      setTimeout(() => {
        this.#departing.delete(seat);
        if (this.#seatIsOpen(seat) || this.#closed) return;
        void this.#run(async () => {
          await this.#clockCommand(command, { seat, present: false });
          await this.#pushViews();
        });
      }, grace),
    );
  }

  /** One clock-issued command, run and narrated but never answered to a seat. */
  async #clockCommand(name: string, args: Record<string, unknown>): Promise<void> {
    try {
      const events = await this.#dispatch({
        player: null,
        command: { name, args },
        timing: { due: this.#worldNow(), missedCount: 0 },
        arrivedAt: this.#worldNow(),
      });
      this.#narrate(events);
    } catch (error) {
      this.#broadcastNotice(messageOf(error));
    }
  }

  // ── one pick, re-asked ─────────────────────────────────────────────────────

  /**
   * ONE SELECTION, RE-EVALUATED WITH THE ARGS BOUND SO FAR (ShufflewickPub
   * #378).
   *
   * A world's offer is enumerated in one frame with nothing bound, so a
   * selection whose `multiSelect` bounds or `choices` callback read an earlier
   * selection's value cannot be answered there: the panel asks again once it has
   * something to ask with, exactly as a table's does.
   *
   * It is a READ. Nothing is dispatched, nothing is checkpointed and no view is
   * pushed -- what it changes is what is LOADED, which is residency and not
   * state, and a partition hydrated for a pick nobody went on to submit is cold
   * by `residency`'s own ordering and the first thing evicted.
   */
  async #resolvePick(
    clientId: string,
    message: Extract<WorldDevRequest, { type: 'pick' }>,
  ): Promise<void> {
    const { requestId, action, selection } = message;
    const args = message.args ?? {};
    const seat = this.#attached.get(clientId);
    if (seat === undefined) {
      this.#send(clientId, {
        type: 'world_pick_result',
        requestId,
        ok: false,
        message: 'This page holds no seat in this world yet, so it has no offer to walk.',
      });
      return;
    }
    const player = devWorldPlayer(seat);
    const runner = this.#world.runner;
    const now = this.#worldNow();
    try {
      await settleDeclaration(
        async (supplied) =>
          (await runner.declarePick(player, action, selection, args, now, supplied)).needs,
        (name) =>
          this.#readPartition(
            name,
            `Re-asking "${selection}" needs partition "${name}", which this world's store does ` +
              "not have. The action's own declaration names it; either the name is wrong or the " +
              'partition was never created.',
          ),
        `The "${action}" action's declaration`,
      );
      this.#send(clientId, {
        type: 'world_pick_result',
        requestId,
        ok: true,
        selection: await runner.resolvePick(player, action, selection, args, {
          now,
          presence: this.#presence(),
        }),
      });
    } catch (error) {
      this.#send(clientId, {
        type: 'world_pick_result',
        requestId,
        ok: false,
        message: messageOf(error),
        ...(error instanceof WorldRefusal ? { code: error.code } : {}),
      });
    }
  }

  // ── a player's command ─────────────────────────────────────────────────────

  async #command(
    clientId: string,
    message: Extract<WorldDevRequest, { type: 'action' }>,
  ): Promise<void> {
    const { requestId, action: name, order } = message;
    const args = message.args ?? {};
    const seat = this.#attached.get(clientId);
    if (seat === undefined) {
      this.#send(clientId, {
        type: 'world_response',
        requestId,
        ok: false,
        message: 'This page holds no seat in this world yet, so it cannot act in it.',
      });
      return;
    }
    const player = devWorldPlayer(seat);
    try {
      // THE ORDER IS SETTLED BEFORE THE COMMAND IS RUN (#195). A repeat of an
      // order this world already committed is answered from its receipt: the
      // handler does not run, and the candidates the FIRST attempt consumed are
      // never revalidated, because consuming them is what it did.
      assertWorldOrder(order);
      const decision = resolveOrder({
        order,
        receipt: this.#store.receipt(player, order.id),
        floorAt: this.#store.receiptFloorAt(),
      });
      if (decision.kind === 'unanswerable') throw decision.refusal;
      if (decision.kind === 'replay') {
        this.#send(clientId, {
          type: 'world_response',
          requestId,
          ok: true,
          replayed: true,
          ...(decision.receipt.message === undefined ? {} : { message: decision.receipt.message }),
        });
        await this.#pushViews();
        return;
      }
      // THE PLAYER'S OWN ARRIVAL INSTANT, taken once and used for everything
      // below: the catch-up's ceiling, the handler's `world.now`, and the
      // receipt. Reading the clock twice would let a long catch-up move the
      // instant the command claims to have arrived at.
      const arrivedAt = this.#worldNow();
      // EVERYTHING ALREADY DUE FIRST, for a world that declared it (#380).
      // After the receipt check above, so a REPLAYED order is answered from its
      // receipt without running the clock: a receipt is not a reason to tick.
      await this.#catchUpBefore(arrivedAt);
      const events = await this.#dispatch({
        player,
        command: { name, args },
        timing: null,
        arrivedAt,
        receipt: { orderId: order.id, player, at: arrivedAt },
      });
      // ANSWERED AFTER THE CHECKPOINT LANDED, exactly as the platform answers
      // one: a player told "taken" about a command whose effects were not made
      // durable has been told something that may stop being true.
      this.#send(clientId, { type: 'world_response', requestId, ok: true });
      this.#narrate(events);
    } catch (error) {
      // A REFUSAL RESOLVES. A world refuses constantly and legitimately -- a
      // bare holding, a door that is not there -- and the sentence is the
      // library's, unedited, because it is the one the author can act on.
      this.#send(clientId, {
        type: 'world_response',
        requestId,
        ok: false,
        message: messageOf(error),
        ...(error instanceof WorldRefusal ? { code: error.code } : {}),
      });
    }
    await this.#pushViews();
    this.#rearm();
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
  }): Promise<readonly RoutedEvent[]> {
    const { player, command, timing, arrivedAt } = request;
    const runner = this.#world.runner;

    // DECLARE UNTIL IT SETTLES (#122). A view or a command whose subject is
    // decided by state names an index, is handed it, and names the room on the
    // round after -- which is the one thing no arrangement of arguments could
    // express.
    // WALK THE ACTION'S DECLARATION (BoardSmith #169). One round per step, in
    // the order the author wrote them: round one, then each selection's own,
    // then what execute writes. No ceiling and no `declaration-unsettled`,
    // because the length is the action's own selection count -- see
    // `walkDeclaration`, and `settleDeclaration` beside it, which is still what
    // a VIEW needs.
    await walkDeclaration(
      // THE SAME INSTANT THE APPLY BELOW IS STAMPED WITH (#375), so the
      // declaration and the handler it precedes agree about what time it is.
      async (supplied) => (await runner.declare(command, player, supplied, arrivedAt)).needs,
      (name) =>
        this.#readPartition(
          name,
          `Action "${command.name}" needs partition "${name}", which this world's store does not have.`,
        ),
    );

    const owner = player ?? WORLD_OWNER;
    // ONE ALLOWANCE, read once and used by both the apply and the plan. Two
    // reads either side of a command that scheduled something would let the
    // parent's re-plan judge against numbers the child never saw.
    const allowance = this.#allowanceFor(owner);
    const result = await runner.apply({
      player,
      command,
      timing,
      arrivedAt,
      allowance,
      // DERIVED HERE AND NEVER STORED. Who is watching is this host's answer
      // from its open connections at the instant it asks -- a parked world
      // reports nobody rather than a memory of an audience that went home.
      presence: this.#presence(),
    });

    // THE PARENT IS THE ONLY WRITER. `ctx.schedule()` refused inside the
    // handler at the offending line, where the rollback unwinds it; this is the
    // authority that actually mints the events.
    const pending = this.#store.pendingEvents();
    const plan = planSchedules(result.schedules, {
      owner: player,
      arrivedAt,
      nextSeq: this.#store.nextSeq(),
      mintId: () => randomUUID(),
      allowance,
      budgets: this.#budgets,
      replaces: (key) => pending.find((event) => event.owner === owner && event.key === key)?.id,
    });
    if (!plan.ok) throw plan.refusal;

    if (result.ending === 'completed') this.#completed = true;

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
        receiptFloorAt: receiptFloor(
          this.#worldNow(),
          this.#budgets,
          this.#store.receiptFloorAt(),
        ),
      });
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
    if (built === undefined) throw worldRefusal('partition-missing', message);
    // THE BYTES AND THE STAMP TOGETHER (#377). `createOne` takes the whole
    // answer rather than the partition alone, so a host cannot write a minted
    // root and leave the allocation that produced it behind.
    this.#store.createOne(name, built);
    return built.partition;
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

  // ── the schedule ───────────────────────────────────────────────────────────

  /**
   * WHEN THIS HOST NEXT WAKES ITSELF.
   *
   * `rearmAt` is the library's answer, so a laptop and the platform arm for the
   * same instant: the earliest pending event, or now when something is already
   * overdue -- overload degrades to latency, never refusal.
   */
  #rearm(): void {
    if (this.#closed) return;
    const at = rearmAt(this.#store.pendingEvents(), this.#worldNow());
    this.#clock.arm(at === null ? null : at - this.#worldNow(), () => {
      void this.#run(async () => {
        await this.#drain();
        await this.#pushViews();
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
    await this.#drainBatch(this.#worldNow());
    this.#rearm();
  }

  /**
   * ONE BATCH OF EVENTS DUE AT OR BEFORE `now`, run in nominal order.
   *
   * Answers how many handler calls it actually made, which is what tells a
   * catch-up loop that it is making progress (ShufflewickPub #380): a batch
   * that ran nothing is a batch that will run nothing again, and the loop stops
   * rather than spinning on an event the world cannot move past.
   */
  async #drainBatch(now: number): Promise<number> {
    let ran = 0;
    const { batch } = nextDueBatch(this.#store.pendingEvents(), now, this.#budgets.drainBatch);
    for (const event of batch) {
      // A ONE-SHOT IS ONE CALL AT ITS OWN DUE. A RECURRENCE THAT FELL BEHIND IS
      // INTEGRATED, not replayed: at most `catchUpMaxRealIterations` real
      // iterations and then one coalesced call carrying how many got no call at
      // all, so a world that was away for a week is caught up in one wake.
      const { occurrences, nextDue } = occurrencesDue(
        event,
        now,
        this.#budgets.catchUpMaxRealIterations,
      );
      const advanced: PlannedEvent[] =
        nextDue === null ? [] : [{ ...event, due: nextDue, attempts: 0 }];
      for (const [index, timing] of occurrences.entries()) {
        const last = index === occurrences.length - 1;
        try {
          const events = await this.#dispatch({
            player: null,
            command: { name: event.action, args: event.args },
            timing,
            // ITS `now` IS ITS `due`, never the wall clock at execution: a
            // world that drained late must produce the state a punctual one
            // would.
            arrivedAt: timing.due,
            settle: last ? [event.id] : [],
            rearm: last ? advanced : [],
          });
          this.#narrate(events);
          ran += 1;
        } catch (error) {
          // A DUE EVENT THAT REFUSED IS SAID OUT LOUD AND LEFT QUEUED. Its
          // effects rolled back, so the world is unchanged; dropping it
          // silently is how a world stops ticking with nobody told.
          this.#broadcastNotice(
            `The scheduled action "${event.action}" refused, and stays queued: ${messageOf(error)}`,
          );
          break;
        }
      }
    }
    return ran;
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
   * at most, with the event loop given a turn between each -- so a defective
   * handler that re-arms itself at zero delay makes a slow world rather than a
   * wedged one, and the host's own overload protections still apply. Running
   * out, or meeting an event that refuses, STOPS the catch-up and the command
   * is applied over a world that is still behind: degradation by latency, never
   * refusal, because a refusal would make the player press the button again and
   * lose the ordering this exists to keep.
   *
   * `arrivedAt` is the player's own stamped instant and is never moved. What
   * this changes is what has happened before their handler runs.
   */
  async #catchUpBefore(arrivedAt: number): Promise<void> {
    if ((readWorldDefinition(this.#definition).ordering ?? 'arrival') !== 'chronological') return;
    for (let round = 0; round < this.#budgets.catchUpRounds; round++) {
      const { batch } = nextDueBatch(
        this.#store.pendingEvents(),
        arrivedAt,
        this.#budgets.drainBatch,
      );
      if (batch.length === 0) return;
      if ((await this.#drainBatch(arrivedAt)) === 0) return;
      // A TURN FOR EVERYTHING ELSE. The world lock is still held -- the catch-up
      // and the command it gates are one ordered unit -- but the runtime is not
      // starved, so a host under load stays answerable while it happens.
      await new Promise((resolve) => setImmediate(resolve));
    }
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
   */
  async #fireDueNow(clientId: string): Promise<void> {
    const pending = this.#store.pendingEvents();
    if (pending.length === 0) {
      this.#send(clientId, {
        type: 'world_notice',
        message:
          'Nothing is scheduled, so there is nothing to fire. A world schedules an event when a ' +
          'command calls `ctx.schedule()`.',
      });
      return;
    }
    const earliest = Math.min(...pending.map((event) => event.due));
    const jump = Math.max(0, earliest - this.#worldNow());
    // DURABLE BEFORE IT IS DRAINED. The partitions this firing settles become
    // durable at the advanced time, so the advance itself has to be on disk
    // first or a crash between the two leaves a world settled in a future its
    // next host does not know about.
    this.#skewMs = this.#store.advanceClock(jump);
    await this.#drain();
    await this.#pushViews();
    this.#broadcastNotice(
      jump === 0
        ? `Fired what was already due. This world's clock is ${this.#skewMs}ms ahead of yours.`
        : `Moved this world's clock forward ${jump}ms to the moment the next event was due, and ` +
            `fired it. Total skew: ${this.#skewMs}ms. Each handler still ran at its own due time, ` +
            `so this is the state waiting would have produced.`,
    );
  }

  // ── wake from parked ───────────────────────────────────────────────────────

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
   * them and call it a wake.
   */
  async #wake(clientId: string): Promise<void> {
    const dirty = this.#store.dirtyPartitions();
    if (dirty.length > 0) {
      await this.#store.writeCheckpoint(await this.#world.runner.serialize(dirty));
    }
    this.#droppedOnWake = this.#world.runner.residency().length;
    this.#world = this.#build();
    await this.#pushViews();
    this.#send(clientId, {
      type: 'world_notice',
      message:
        `Parked and woken: ${this.#droppedOnWake} resident partition(s) dropped, and everything on ` +
        'screen was rebuilt from the store. This is the path a hibernated world takes.',
    });
  }

  // ── what a browser is told ─────────────────────────────────────────────────

  /**
   * ONE STATE FRAME PER OPEN SEAT, projected through the bundle's own `view`.
   *
   * The declaration settles first and per BATCH, not per player: a notice
   * reaches an audience and every one of them wants a view, so one round of
   * declaration covers the lot. A seat whose own `world.view` throws is refused
   * BY NAME and everybody else is still answered -- one watcher's failure may
   * not decide the batch's.
   */
  async #pushViews(): Promise<void> {
    if (this.#attached.size === 0) {
      this.#broadcastStatus();
      return;
    }
    const runner = this.#world.runner;
    const players = [...new Set(this.#attached.values())].map(devWorldPlayer);
    let declined: Record<string, { code?: string; message: string }> = {};
    try {
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
              'partition was never created.',
          ),
        "This world's `world.view` declaration",
      );
    } catch (error) {
      // NOTHING CAN BE PROJECTED, so every watcher is told the same sentence
      // rather than left looking at a board that stopped updating.
      for (const clientId of this.#attached.keys()) {
        this.#send(clientId, this.#stateFrame(clientId, null, messageOf(error), 'refused'));
      }
      this.#broadcastStatus();
      return;
    }
    const projecting = players.filter((player) => declined[player] === undefined);
    const { views, refused } = await runner.viewsFor(projecting);
    const failed = { ...declined, ...refused };
    for (const [clientId, seat] of this.#attached) {
      const player = devWorldPlayer(seat);
      const refusal = failed[player];
      if (refusal !== undefined) {
        this.#send(clientId, this.#stateFrame(clientId, null, refusal.message, 'refused'));
        continue;
      }
      // ONE SEAT'S OFFER IS ONE SEAT'S FATE, exactly as its view is. An action
      // whose enumeration refuses -- a candidate outside its declaration, a
      // selection past the budget -- is a bundle mistake, and raising it here
      // would refuse the whole audience for one seat's bad verb.
      let actions: readonly WorldActionOffer[] = [];
      let offerRefusal: string | null = null;
      try {
        actions = await this.#offersFor(seat);
      } catch (error) {
        offerRefusal = messageOf(error);
      }
      this.#send(
        clientId,
        this.#stateFrame(clientId, views[player] ?? null, this.#notices(), 'watching', actions),
      );
      // SAID OUT LOUD IN THE DEV BAR, because the reader is the AUTHOR. An
      // offer that refuses is a bundle mistake -- a candidate outside its own
      // declaration, a selection past the budget -- and the seat it happened to
      // is simply offered nothing. Left on the state frame alone it would be a
      // world that quietly stopped having verbs.
      if (offerRefusal !== null) this.#send(clientId, { type: 'world_notice', message: offerRefusal });
    }
    this.#broadcastStatus();
  }

  #stateFrame(
    clientId: string,
    view: unknown,
    notice: string | null,
    phase: 'watching' | 'refused',
    actions: readonly WorldActionOffer[] = [],
  ): Record<string, unknown> {
    return {
      type: 'world_state',
      phase,
      view,
      seat: this.#attached.get(clientId) ?? null,
      // ENUMERATED FOR THIS SEAT, and never a seatless one: a client that was
      // never offered the clock's own cannot send it by accident.
      actions,
      notice,
      worldName: this.#worldName,
      presence: this.#presence(),
    };
  }

  /**
   * WHAT THIS SEAT MAY DO, over what it can see (BoardSmith #169).
   *
   * Declared and supplied exactly as a command's partitions are, because the
   * engine names and this host reads: an offer walks each action's round-one
   * declaration and each selection's own, and every round it names is read out
   * of the local store before it is asked again.
   */
  async #offersFor(seat: number): Promise<readonly WorldActionOffer[]> {
    const runner = this.#world.runner;
    const player = devWorldPlayer(seat);
    await walkDeclaration(
      async (supplied) => (await runner.declareOffers(player, supplied, this.#worldNow())).needs,
      (name) =>
        this.#readPartition(
          name,
          `An action offered to seat ${seat} needs partition "${name}", which this world's ` +
            "store does not have. The action's `needs` names it; either the name is wrong or " +
            'the partition was never created.',
        ),
    );
    return runner.offersFor(player, { now: this.#worldNow(), presence: this.#presence() });
  }

  #notices(): string | null {
    return this.#completed
      ? 'This world has reported that it is complete. On the hosting platform this is what settles the season.'
      : null;
  }

  /**
   * NARRATION IS NOT STATE, so it rides its own frame.
   *
   * State is re-pushed whenever anything moves, so a line carried on it would
   * be re-delivered on every later push; and a view answers "what is here"
   * while an event answers "what just happened", which leaves no trace in the
   * tree for a view to report.
   */
  #narrate(events: readonly RoutedEvent[]): void {
    if (events.length === 0) return;
    for (const [clientId, seat] of this.#attached) {
      // THE AUDIENCE IS THE ENGINE'S ANSWER, not this host's guess. `seats` was
      // routed inside the command, while the world it is a fact about was still
      // in front of the engine.
      const mine = events.filter((event) => event.seats.includes(seat));
      if (mine.length === 0) continue;
      this.#send(clientId, {
        type: 'world_events',
        // THE AUDIENCE DOES NOT GO ON THE WIRE. A UI that received it would
        // learn who else is in the room from an event addressed to it. That is
        // the ONE field this drops -- and it used to drop the narration with it
        // (#186), which left the shared shell's log empty in every world there
        // has ever been.
        events: mine.map(({ seats: _audience, ...narration }) => narration),
      });
    }
  }

  #notice(clientId: string, error: unknown): void {
    this.#send(clientId, { type: 'world_notice', message: messageOf(error) });
  }

  #broadcastNotice(message: string): void {
    for (const clientId of this.#attached.keys()) {
      this.#send(clientId, { type: 'world_notice', message });
    }
  }

  /** What the dev CHROME shows, as opposed to what the world shows. Facts about
   *  the host, so an author can see the queue, the clock and the residency the
   *  wake control is about. */
  #broadcastStatus(): void {
    const pending = this.#store.pendingEvents();
    const status = {
      type: 'world_status',
      seatCount: this.#world.seatCount,
      seats: this.#store.seats(),
      presence: this.#presence(),
      resident: this.#world.runner.residency().map((entry) => entry.name),
      dirty: this.#store.dirtyPartitions(),
      pending: pending.map((event) => ({
        id: event.id,
        due: event.due,
        command: event.action,
        owner: event.owner,
        ...(event.everyMs === undefined ? {} : { everyMs: event.everyMs }),
      })),
      nextDue: rearmAt(pending, this.#worldNow()),
      worldNow: this.#worldNow(),
      clockSkewMs: this.#skewMs,
      storePath: this.#store.path,
      completed: this.#completed,
    };
    for (const clientId of this.#attached.keys()) this.#send(clientId, status);
  }
}

/** What went wrong, as a sentence. A `WorldRefusal`'s message is the one the
 *  author can act on, so it is passed through unedited. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The refusal, plus the one thing the player needs that the refusal cannot know:
 * that the command did not survive.
 *
 * The library's sentence explains what is wrong with the WORLD; this adds what
 * is true of the COMMAND, and it is the platform's own wording so an author who
 * meets it in both places meets it once.
 */
function rolledBack(error: unknown, command: string): Error {
  const message =
    `${messageOf(error)} Command "${command}" ran and was then rolled back, because the world ` +
    'could not be made durable -- nothing it changed survives, and sending it again is safe.';
  return error instanceof WorldRefusal
    ? worldRefusal(error.code, message)
    : Object.assign(new Error(message), { name: error instanceof Error ? error.name : 'Error' });
}

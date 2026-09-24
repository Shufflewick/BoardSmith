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
 * ## IT IS A TRANSPORT OVER `ResidentWorld`, AND NOTHING ELSE
 *
 * Every decision about what a world IS comes from `boardsmith/world`, and every
 * decision about how one is DRIVEN comes from `boardsmith/world/host`'s
 * {@link ResidentWorld} -- genesis, migration, the declare-then-run-then-
 * checkpoint loop, the per-seat projection, the offer walk, the schedule drain,
 * "fire due events now" and "wake from parked". What is HERE is the part that
 * is a laptop's rather than a world's: which sockets are open, which seat each
 * one is looking through, what a browser is told and in what words, and the
 * departure grace a closed tab gets.
 *
 * That split is what makes #164's promise true by construction. A world that
 * ran differently here would make an author's local run a poor guide to their
 * published one, and the way to guarantee it does not is to leave the host
 * nothing to disagree about. It is also what lets `boardsmith/testing`'s
 * `TestWorld` hand a game's real board the projection this host sends, rather
 * than a second implementation of it that can drift (#262).
 */

import { randomUUID } from 'node:crypto';

import {
  rearmAt,
  WorldRefusal,
  type RoutedEvent,
  type WorldActionOffer,
  type WorldBudgets,
  type WorldOrder,
  type WorldRunnerOptions,
} from '../../world/index.js';
import {
  messageOf,
  ResidentWorld,
  worldSeatPlayer,
  type WorldStartOutcome,
} from '../../world/host/index.js';
import { createNodeWorldClock, type WorldHostClock } from './node-world-clock.js';
import type { LocalWorldStore } from './world-store.js';

/**
 * WHO A DEV SEAT IS. The durable roster's naming, which outlives this process
 * -- see {@link worldSeatPlayer}, where the argument for it lives.
 */
export const devWorldPlayer = worldSeatPlayer;

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
  /**
   * IS THIS CLIENT'S SOCKET STILL OPEN, at the instant this asks (#284)?
   *
   * The transport's answer, not a copy of it: the socket closes the moment the
   * peer dies, but the departure {@link LocalWorldHost.disconnect} queues only
   * reaches the world lock after everything received before it. Between the
   * two, a seat whose page is gone would otherwise still be projected, offered
   * and counted as present -- on a real world, seconds of work per push for
   * somebody who is not there.
   */
  readonly isOpen: (clientId: string) => boolean;
  readonly clock?: WorldHostClock;
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
  | {
      type: 'quote';
      requestId: string;
      /** The action being drafted (#248). */
      action: string;
      /** Every selection as the player has it SO FAR -- a number typed into the
       *  panel's field and not yet submitted included, which is the whole point
       *  of this message existing. */
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
  readonly #worldName: string;
  readonly #send: (clientId: string, message: unknown) => void;
  readonly #isOpen: (clientId: string) => boolean;
  readonly #clock: WorldHostClock;
  readonly #world: ResidentWorld;

  /** Which seat each connection is looking through. A connection whose socket
   *  has closed stays here until its queued departure runs, and counts for
   *  nothing meanwhile -- see {@link LocalWorldHost.#watching}. */
  readonly #attached = new Map<string, number>();
  /** Departure timers, one per seat, for a bundle that declares `onDepart`. */
  readonly #departing = new Map<number, ReturnType<typeof setTimeout>>();
  /**
   * THE SEATS THE WORLD HAS BEEN TOLD ARE PRESENT, and not since told they
   * left (#331) -- the platform's "informed" record. `closedAt` is written only
   * for a bundle with no `onDepart`, where no departure timer carries the
   * instant, so a return can tell a flap from a genuine absence.
   */
  readonly #told = new Map<number, { closedAt: number | null }>();
  /** The one shutdown, once it has been asked for. */
  #closing: Promise<void> | null = null;

  constructor(options: LocalWorldHostOptions) {
    this.#store = options.store;
    this.#worldName = options.worldName;
    this.#send = options.send;
    this.#isOpen = options.isOpen;
    this.#clock = options.clock ?? createNodeWorldClock();
    this.#world = new ResidentWorld({
      definition: options.definition,
      seed: options.seed,
      budgets: options.budgets,
      store: options.store,
      clock: this.#clock,
      presence: () => this.#presence(),
      mintId: () => randomUUID(),
      onEvents: (events) => this.#narrate(events),
      onNotice: (message) => this.#broadcastNotice(message),
      onChanged: () => this.#pushViews(),
      onVacated: (vacancy) => this.#released(vacancy),
    });
  }

  /** How many seats this world's own rules declare. */
  get seatCount(): number {
    return this.#world.seatCount;
  }

  /** Which partitions are resident right now. The wake control's evidence. */
  residency(): readonly { readonly name: string; readonly lastUsed: number }[] {
    return this.#world.residency();
  }

  /** How many partitions the last `wake` dropped. */
  residencyBeforeLastWake(): number {
    return this.#world.residencyBeforeLastWake();
  }

  /** Resolves once everything queued behind the world lock has run. */
  settled(): Promise<void> {
    return this.#world.settled();
  }

  /** Launch the world if it has never been launched, migrating and lifting it
   *  first if these rules need it to be moved (#200, #223). */
  start(): Promise<WorldStartOutcome> {
    return this.#world.start();
  }

  async handleMessage(clientId: string, message: WorldDevRequest): Promise<void> {
    await this.#world.run(async () => {
      // A PAGE THAT IS GONE IS ASKED NOTHING ON ITS BEHALF (#284). Its request
      // waited behind the world lock while its socket died, and a greeting, a
      // seat change or a read would now seat, project and walk offers for
      // nobody. What still runs is what CHANGES the world: that was received,
      // and a command must not have run or not run depending on how fast a
      // socket died -- its order's receipt answers the player's next page.
      if (!this.#isOpen(clientId) && !changesTheWorld(message)) return;
      await this.#route(clientId, message);
    });
  }

  /** One request, to the handler for its type. Always inside the world lock. */
  async #route(clientId: string, message: WorldDevRequest): Promise<void> {
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
      case 'quote':
        await this.#resolveQuote(clientId, message);
        return;
      case 'fire_due':
        await this.#fireDueNow(clientId);
        return;
      case 'wake':
        await this.#wake(clientId);
        return;
    }
  }

  /**
   * A SOCKET WENT.
   *
   * On a laptop that IS a departure: there is no hibernation to make a close
   * ambiguous, which is exactly the kind of question `WorldDefinition.presence`
   * says is the host's rather than the library's.
   */
  async disconnect(clientId: string): Promise<void> {
    await this.#world.run(async () => {
      const seat = this.#attached.get(clientId);
      this.#attached.delete(clientId);
      if (seat !== undefined && !this.#seatIsOpen(seat)) this.#seatBecameAbsent(seat);
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
    await this.#world.settled();
    for (const timer of this.#departing.values()) clearTimeout(timer);
    this.#departing.clear();
    await this.#world.close();
  }

  // ── attaching, and the seat switcher ───────────────────────────────────────

  async #hello(clientId: string): Promise<void> {
    if (!this.#attached.has(clientId)) {
      await this.#attach(clientId, this.#firstFreeSeat());
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

  async #attach(clientId: string, seat: number): Promise<void> {
    const player = devWorldPlayer(seat);
    try {
      // THE LIBRARY'S OWN DOOR, before anything durable is written. A seat past
      // the bundle's `maxPlayers` is a chair that does not exist, and seats are
      // never reused -- so a refusal here has to burn nothing. `seat` writes
      // the roster row too, with the instant a newcomer's idleness is measured
      // from (ShufflewickPub #423).
      this.#world.seat(player, seat);
    } catch (error) {
      this.#notice(clientId, error);
      return;
    }
    const previous = this.#attached.get(clientId);
    // Asked BEFORE this page counts: a second tab, or a page re-attaching to
    // the seat it already holds, finds the seat open and is no arrival (#331).
    const arriving = !this.#seatIsOpen(seat);
    this.#attached.set(clientId, seat);
    if (previous !== undefined && previous !== seat && !this.#seatIsOpen(previous)) {
      this.#seatBecameAbsent(previous);
    }
    if (arriving) await this.#seatBecamePresent(seat);
    await this.#pushViews();
  }

  /**
   * THE ATTACHMENTS WHOSE SOCKETS ARE STILL OPEN (#284), which is the only
   * sense in which anybody is watching. Everything this host does for an
   * audience -- presence, projection, offers, narration -- asks this, so a
   * socket that died counts for nothing from the instant it closed rather
   * than from the instant its departure reaches the world lock.
   */
  #watching(): Array<[clientId: string, seat: number]> {
    return [...this.#attached].filter(([clientId]) => this.#isOpen(clientId));
  }

  #presence(): readonly number[] {
    return [...new Set(this.#watching().map(([, seat]) => seat))].sort((a, b) => a - b);
  }

  #seatIsOpen(seat: number): boolean {
    return this.#watching().some(([, watched]) => watched === seat);
  }

  // ── presence hooks, which are this host's lifecycle policy ─────────────────

  /**
   * A SEAT GAINED ITS FIRST OPEN SOCKET, and the world may be told it arrived.
   *
   * The declaration names a `worldClockAction()` verb, so a transition is the
   * CLOCK issuing one of the world's verbs and a world still has exactly one
   * way to change. WHEN is the platform's rule, matched exactly (#331,
   * ShufflewickPub `seatBecamePresent` in `games/src/world-presence-policy.ts`),
   * so an author's `onArrive` runs as often here as it does in production:
   *
   *   A DEPARTURE STILL WAITING OUT ITS GRACE is a flap caught in time: it is
   *     cancelled and nobody is told anything.
   *   A SEAT THE WORLD ALREADY BELIEVES PRESENT is announced only when it was
   *     gone for at least the grace (the no-`onDepart` road, which records when
   *     its last socket closed).
   *   ANY OTHER SEAT is an arrival.
   *
   * On a laptop the announcement runs the instant it is decided, because a
   * socket here is unambiguous.
   */
  async #seatBecamePresent(seat: number): Promise<void> {
    const hooks = this.#world.presenceHooks;
    if (hooks === undefined) return;
    const departing = this.#departing.get(seat);
    if (departing !== undefined) {
      clearTimeout(departing);
      this.#departing.delete(seat);
      return;
    }
    const told = this.#told.get(seat);
    this.#told.set(seat, { closedAt: null });
    if (told !== undefined) {
      if (told.closedAt === null) return;
      if (this.#clock.now() - told.closedAt < this.#departGraceMs()) return;
    }
    if (hooks.onArrive !== undefined) {
      await this.#clockCommand(hooks.onArrive, { seat, present: true });
    }
  }

  /**
   * A SEAT LOST ITS LAST OPEN SOCKET. The platform's `seatBecameAbsent`: a seat
   * the world was never told about owes it nothing; otherwise the departure
   * waits out the grace, or, with no `onDepart` declared, the instant is
   * written down for {@link LocalWorldHost.#seatBecamePresent} to read.
   */
  #seatBecameAbsent(seat: number): void {
    const hooks = this.#world.presenceHooks;
    if (hooks === undefined || !this.#told.has(seat)) return;
    if (hooks.onDepart === undefined) {
      this.#told.set(seat, { closedAt: this.#clock.now() });
      return;
    }
    this.#armDeparture(seat, hooks.onDepart);
  }

  #departGraceMs(): number {
    return this.#world.presenceHooks?.departGraceMs ?? 0;
  }

  /**
   * THE WORLD'S CLOCK TOOK A CHAIR, AND THE PAGE IN IT IS TOLD (#278).
   *
   * A dev client watching through that seat is looking at holdings the world
   * has just given back, and its next action would be answered `unknown-player`
   * by a roster that no longer seats it. So the attachment goes -- the chair is
   * genuinely not theirs any more -- and the sentence says which chair and why,
   * because the reader is the AUTHOR watching their own teardown run.
   *
   * IT DOES NOT RE-SEAT ANYBODY. Attaching seats the player, so a host that
   * helpfully put the page back in the chair would undo the release it is
   * announcing. Pressing the seat selector again is the author's own choice.
   *
   * The departure timer goes with it: `onDepart` is a presence hook about the
   * holder of a chair, and this chair has none.
   */
  #released(vacancy: { readonly seat: number; readonly player: string }): void {
    const departing = this.#departing.get(vacancy.seat);
    if (departing !== undefined) {
      clearTimeout(departing);
      this.#departing.delete(vacancy.seat);
    }
    // The chair's next page holds a new player, and a new player arrives.
    this.#told.delete(vacancy.seat);
    for (const [clientId, seat] of [...this.#attached]) {
      if (seat !== vacancy.seat) continue;
      this.#attached.delete(clientId);
      this.#send(clientId, {
        type: 'world_notice',
        message:
          `This world's clock finalized the vacancy of seat ${vacancy.seat}, so this page no ` +
          'longer holds it. The estate behind it was given back first -- that is what the ' +
          '`world.vacateByClock` verb proved before it released the chair. Pick a seat again ' +
          'to join as a newcomer.',
      });
    }
  }

  /**
   * A DEPARTURE, due once the grace is over. Whether it is still true is asked
   * again INSIDE the world lock, because a page may have taken the seat back
   * between the timer firing and the lock coming free: then the world goes on
   * believing the seat present, and is told nothing.
   */
  #armDeparture(seat: number, command: string): void {
    this.#departing.set(
      seat,
      setTimeout(() => {
        this.#departing.delete(seat);
        if (this.#world.closed) return;
        void this.#world.run(async () => {
          if (this.#seatIsOpen(seat)) return;
          this.#told.delete(seat);
          await this.#clockCommand(command, { seat, present: false });
          await this.#pushViews();
        });
      }, this.#departGraceMs()),
    );
  }

  /** One clock-issued command, run and narrated but never answered to a seat. */
  async #clockCommand(name: string, args: Record<string, unknown>): Promise<void> {
    try {
      await this.#world.clockCommand(name, args);
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
   * pushed.
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
    try {
      this.#send(clientId, {
        type: 'world_pick_result',
        requestId,
        ok: true,
        selection: await this.#world.resolvePick(devWorldPlayer(seat), action, selection, args),
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

  // ── the draft, priced ──────────────────────────────────────────────────────

  /**
   * WHAT THE DRAFT IN FRONT OF THE PLAYER WOULD COST (#248).
   *
   * `#resolvePick`'s twin, one step further on: a pick asks what one selection
   * may be, and this asks what the whole draft adds up to -- so the args carry a
   * number the player has typed and never submitted, which no other message on
   * this socket does.
   */
  async #resolveQuote(
    clientId: string,
    message: Extract<WorldDevRequest, { type: 'quote' }>,
  ): Promise<void> {
    const { requestId, action } = message;
    const args = message.args ?? {};
    const seat = this.#attached.get(clientId);
    if (seat === undefined) {
      this.#send(clientId, {
        type: 'world_quote_result',
        requestId,
        ok: false,
        message: 'This page holds no seat in this world yet, so it has no draft to price.',
      });
      return;
    }
    try {
      this.#send(clientId, {
        type: 'world_quote_result',
        requestId,
        ok: true,
        quote: await this.#world.quote(devWorldPlayer(seat), action, args),
      });
    } catch (error) {
      this.#send(clientId, {
        type: 'world_quote_result',
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
    const { requestId, action, order } = message;
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
    try {
      const outcome = await this.#world.command({
        player: devWorldPlayer(seat),
        order,
        action,
        ...(message.args === undefined ? {} : { args: message.args }),
      });
      if (outcome.kind === 'replayed') {
        this.#send(clientId, {
          type: 'world_response',
          requestId,
          ok: true,
          replayed: true,
          ...(outcome.message === undefined ? {} : { message: outcome.message }),
        });
        await this.#pushViews();
        return;
      }
      // ANSWERED AFTER THE CHECKPOINT LANDED, exactly as the platform answers
      // one: a player told "taken" about a command whose effects were not made
      // durable has been told something that may stop being true.
      this.#send(clientId, { type: 'world_response', requestId, ok: true });
      this.#narrate(outcome.events);
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
  }

  // ── the dev controls ───────────────────────────────────────────────────────

  /**
   * "FIRE DUE EVENTS NOW", said out loud.
   *
   * The control itself is {@link ResidentWorld.fireDue}; what is here is the
   * sentence, because the reader is the AUTHOR standing in front of the dev bar
   * and the numbers only mean something with it.
   */
  async #fireDueNow(clientId: string): Promise<void> {
    const fired = await this.#world.fireDue();
    if (fired === null) {
      this.#send(clientId, {
        type: 'world_notice',
        message:
          'Nothing is scheduled, so there is nothing to fire. A world schedules an event when a ' +
          'command calls `ctx.schedule()`.',
      });
      return;
    }
    await this.#pushViews();
    this.#broadcastNotice(
      fired.jumpMs === 0
        ? `Fired what was already due. This world's clock is ${fired.skewMs}ms ahead of yours.`
        : `Moved this world's clock forward ${fired.jumpMs}ms to the moment the next event was ` +
            `due, and fired it. Total skew: ${fired.skewMs}ms. Each handler still ran at its own ` +
            `due time, so this is the state waiting would have produced.`,
    );
  }

  /** "Wake from parked", said out loud -- {@link ResidentWorld.wake} is the
   *  control, and this is the sentence the author reads. */
  async #wake(clientId: string): Promise<void> {
    const dropped = await this.#world.wake();
    await this.#pushViews();
    this.#send(clientId, {
      type: 'world_notice',
      message:
        `Parked and woken: ${dropped} resident partition(s) dropped, and everything on ` +
        'screen was rebuilt from the store. This is the path a hibernated world takes.',
    });
  }

  // ── what a browser is told ─────────────────────────────────────────────────

  /**
   * ONE STATE FRAME PER OPEN SEAT, projected through the bundle's own `view`.
   *
   * The projection is settled per BATCH, not per player: a notice reaches an
   * audience and every one of them wants a view, so one round of declaration
   * covers the lot. A seat whose own `world.view` throws is refused BY NAME and
   * everybody else is still answered -- one watcher's failure may not decide
   * the batch's.
   */
  async #pushViews(): Promise<void> {
    const watching = this.#watching();
    if (watching.length === 0) {
      this.#broadcastStatus();
      return;
    }
    const players = [...new Set(watching.map(([, seat]) => seat))].map(devWorldPlayer);
    let projections;
    try {
      projections = await this.#world.viewsFor(players);
    } catch (error) {
      // NOTHING CAN BE PROJECTED, so every watcher is told the same sentence
      // rather than left looking at a board that stopped updating.
      for (const [clientId] of watching) {
        this.#send(
          clientId,
          this.#stateFrame(clientId, null, messageOf(error), 'refused', this.#world.revision),
        );
      }
      this.#broadcastStatus();
      return;
    }
    const { bodyFor, failed, revision } = projections;
    // THE PROJECTION GOES OUT FIRST, TO EVERY WATCHER (#244).
    //
    // It is finished: the world committed, the projection has answered, and
    // there is nothing left for it to wait on. Enumerating a seat's offers is a
    // separate and unbounded cost -- every offerable action's declaration, the
    // partitions those name hydrated, every candidate of every selection -- and
    // holding the finished view behind it made a browser wait on work the view
    // does not depend on. Worse, the second pass below is sequential, so on one
    // frame the LAST watcher used to wait on every earlier seat's walk as well.
    const offering: Array<{ clientId: string; seat: number }> = [];
    for (const [clientId, seat] of watching) {
      const player = devWorldPlayer(seat);
      const refusal = failed[player];
      if (refusal !== undefined) {
        this.#send(clientId, this.#stateFrame(clientId, null, refusal.message, 'refused', revision));
        continue;
      }
      this.#send(
        clientId,
        this.#stateFrame(clientId, bodyFor(player), this.#notices(), 'watching', revision),
      );
      offering.push({ clientId, seat });
    }
    this.#broadcastStatus();

    // AND THE OFFERS FOLLOW, one seat at a time and stamped with the state they
    // were enumerated over. Sequential deliberately: a declaration walk changes
    // what is resident in the one engine this host has, so two of them at once
    // would be two dispatches over a tree with a single rollback baseline --
    // the same reason every entry point goes through the world lock.
    //
    // AND A TURN FOR THE REST OF THE PROCESS BEFORE EACH ONE (#284). A walk is
    // the whole of a real world's cost, and without a turn between them one push
    // held the event loop for all of them: no close was noticed, no socket
    // accepted, nothing answered -- a port that took connections and settled
    // nothing. The world lock is still held, so nothing can commit and the
    // revision on these frames stays true; what the turn buys is that a seat
    // whose socket died meanwhile is skipped rather than walked for nobody.
    for (const { clientId, seat } of offering) {
      await this.#clock.yieldTurn();
      if (this.#isOpen(clientId)) await this.#offer(clientId, seat, revision);
    }
  }

  /** One seat's offers, walked and sent, stamped with the revision the push
   *  that asks for them projected. */
  async #offer(clientId: string, seat: number, revision: number): Promise<void> {
    // ONE SEAT'S OFFER IS ONE SEAT'S FATE, exactly as its view is. An action
    // whose enumeration refuses -- a candidate outside its declaration, a
    // selection past the budget -- is a bundle mistake, and raising it here
    // would refuse the whole audience for one seat's bad verb.
    let actions: readonly WorldActionOffer[] = [];
    let offerRefusal: string | null = null;
    try {
      actions = await this.#world.offersFor(devWorldPlayer(seat));
    } catch (error) {
      offerRefusal = messageOf(error);
    }
    this.#send(clientId, { type: 'world_offers', revision, actions });
    // SAID OUT LOUD IN THE DEV BAR, because the reader is the AUTHOR. An
    // offer that refuses is a bundle mistake -- a candidate outside its own
    // declaration, a selection past the budget -- and the seat it happened to
    // is simply offered nothing. Left on the offer frame alone it would be a
    // world that quietly stopped having verbs.
    if (offerRefusal !== null) {
      this.#send(clientId, { type: 'world_notice', message: offerRefusal });
    }
  }

  #stateFrame(
    clientId: string,
    view: unknown,
    notice: string | null,
    phase: 'watching' | 'refused',
    revision: number,
  ): Record<string, unknown> {
    return {
      type: 'world_state',
      phase,
      view,
      seat: this.#attached.get(clientId) ?? null,
      // WHICH COMMITTED STATE THIS PROJECTION IS OF (#244). The offer frame
      // that follows carries the same number, which is the whole of what stops
      // a page reading a late offer as being about the world on its screen.
      revision,
      notice,
      worldName: this.#worldName,
      presence: this.#presence(),
    };
  }

  #notices(): string | null {
    return this.#world.completed
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
    for (const [clientId, seat] of this.#watching()) {
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
    for (const [clientId] of this.#watching()) {
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
      resident: this.#world.residency().map((entry) => entry.name),
      dirty: this.#store.dirtyPartitions(),
      pending: pending.map((event) => ({
        id: event.id,
        due: event.due,
        command: event.action,
        owner: event.owner,
        ...(event.everyMs === undefined ? {} : { everyMs: event.everyMs }),
      })),
      nextDue: rearmAt(pending, this.#world.now()),
      worldNow: this.#world.now(),
      clockSkewMs: this.#world.skewMs,
      storePath: this.#store.path,
      completed: this.#world.completed,
    };
    for (const [clientId] of this.#watching()) this.#send(clientId, status);
  }
}

/**
 * THE REQUESTS THAT CHANGE THE WORLD, as opposed to the ones that ask it
 * something on a page's behalf (#284). Exhaustive by construction: a new
 * request type does not compile until somebody says which it is.
 */
function changesTheWorld(message: WorldDevRequest): boolean {
  switch (message.type) {
    case 'action':
    case 'fire_due':
    case 'wake':
      return true;
    case 'hello':
    case 'attach':
    case 'pick':
    case 'quote':
      return false;
  }
}

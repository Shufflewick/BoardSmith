/**
 * `TestGame`'S SIBLING FOR A PERSISTENT WORLD (#262).
 *
 * A table and a world are two backends, not two modes, and `TestGame` drives
 * only the first: it is built on the snapshot runner, which knows nothing about
 * partitions, residency, `world.view` or a `WorldActionOffer`. So until now a
 * project testing a world had to hand-build the per-seat projection itself,
 * which meant the platform's own hidden-information DOM gate could not be
 * aimed at the surface that most needs it -- hidden information in a world is
 * per-partition and per-seat on every single frame.
 *
 * ## IT IS THE HOST'S PROJECTION, NOT A SECOND ONE
 *
 * {@link TestWorld.getPlayerView} answers by calling {@link ResidentWorld}'s
 * `viewsFor` and `offersFor` -- the same two calls, in the same order, over the
 * same world lock, that `boardsmith dev` calls to fill a `world_state` and a
 * `world_offers` frame. That is deliberate and it is the whole point: a scan
 * that ran against a reimplementation of the projection would go green while
 * production leaked.
 *
 * ## WHAT IS ITS OWN
 *
 * A store that lives in memory ({@link createMemoryWorldStore}) and a clock a
 * test moves by hand. Everything else -- genesis, the declare-then-run loop,
 * the checkpoint, the offer walk, the drain -- is the host core.
 *
 * ```ts
 * const world = await createTestWorld({ definition: myBundle });
 * await world.take(1, 'chop');
 * await assertNoHiddenInfoLeak(world, 2, { component: MyWorldBoard });
 * ```
 */
import type { ElementJSON } from '../engine/index.js';
import {
  worldBudgets,
  type StoredPartition,
  type WorldActionOffer,
  type WorldBudgets,
  type WorldRunnerOptions,
} from '../world/index.js';
import {
  ResidentWorld,
  worldSeatPlayer,
  type WorldHostClock,
  type WorldStore,
} from '../world/host/index.js';
import { createMemoryWorldStore } from './memory-world-store.js';

/** The instant a test world starts at, unless a test names another. A fixed
 *  number rather than `Date.now()`, because a world's `now` is an input to
 *  every offer and a test that read the wall clock would be a different test
 *  every time it ran. */
export const TEST_WORLD_EPOCH = 1_700_000_000_000;

export interface TestWorldOptions {
  /** The bundle's `gameDefinition` -- `{ gameClass, world }` -- exactly as a
   *  host reads it. */
  readonly definition: WorldRunnerOptions['definition'];
  /** The world's seed. The same one on every rebuild, or the world's randomness
   *  is a different world each time. */
  readonly seed?: string;
  /** The ceilings this world runs. The library's defaults unless a test is
   *  about one of them. */
  readonly budgets?: WorldBudgets;
  /** The instant this world starts at. */
  readonly now?: number;
  /**
   * WHICH SEATS ARE WATCHING, which is what `presence` answers.
   *
   * Every seat by default, because the common case is a test that wants to
   * look through any of them. Name fewer when a rule is ABOUT who is present:
   * a verb that only opens when a neighbour is here reads this.
   */
  readonly watching?: readonly number[];
}

/** One seat's whole frame, exactly as a world host sends it. */
export interface WorldSeatView {
  /**
   * THE `world_state.view` BODY, verbatim.
   *
   * What the host puts on the wire for this seat. `state` below is the part of
   * it a board is handed; this is the whole envelope, and it is here so a test
   * can hold the harness and a real host to the same bytes.
   */
  readonly view: unknown;
  /**
   * The pruned per-seat element tree -- what `useWorldPlay` pulls out of the
   * frame and hands a board as its `gameView`. It is the bundle's own
   * `world.view` declaration projected for this seat and redacted by the
   * engine, so a partition this seat cannot see is not in it at all.
   */
  readonly state: ElementJSON;
  /** Every action offered to this seat, disabled ones included -- what arrives
   *  as `world_offers.actions`. */
  readonly offers: readonly WorldActionOffer[];
  /**
   * EVERY OFFER'S NAME, DISABLED ONES INCLUDED, because that is what the world
   * shell hands a board: a greyed verb with a reason is still on the panel, and
   * why it cannot be taken travels separately in {@link disabledActions}.
   */
  readonly availableActions: readonly string[];
  /** Action name to why it is offered but cannot be taken right now. */
  readonly disabledActions: Readonly<Record<string, string>>;
  /**
   * MAY THIS SEAT ACT? The world shell's `mayAct`, which is the value a board's
   * `isMyTurn` prop actually carries -- "this viewer is seated and the world is
   * listening", not "it is their go", because a world has no go.
   *
   * It is true for every frame this method answers: a seat whose projection
   * refused is raised rather than returned, which is the same thing as the
   * shell's `phase !== 'watching'` branch.
   */
  readonly isMyTurn: boolean;
  /**
   * DOES THIS SEAT HOLD AN OFFER IT CAN TAKE?
   *
   * The question {@link isMyTurn} sounds like and is not. Answered separately
   * because a test about "this verb is closed to me now" wants it, and reading
   * it off `isMyTurn` would be reading the wrong field.
   */
  readonly canAct: boolean;
  /** Which committed state this frame is of (#244). The state body and the
   *  offers carry the same number, as they do on the wire. */
  readonly revision: number;
  /** The seats watching this world, as `world_state.presence` carries them. */
  readonly presence: readonly number[];
}

/**
 * A clock a test moves by hand.
 *
 * `arm` records rather than sets a timer: "the world drains on its due time" is
 * the one behaviour a test must not prove by waiting for it, so
 * {@link TestWorld.advanceClock} moves `now` and fires what was armed, which is
 * the code path a real timer takes and none of the wall time.
 */
interface ManualClock extends WorldHostClock {
  set(now: number): void;
  fireArmed(): Promise<void>;
  readonly armedAt: number | null;
}

function manualClock(start: number): ManualClock {
  let now = start;
  let armed: { at: number; fire: () => void } | null = null;
  return {
    now: () => now,
    arm(delayMs, fire) {
      armed = delayMs === null ? null : { at: now + delayMs, fire };
    },
    // A MICROTASK IS THE TURN HERE. The Node host yields with `setImmediate`
    // because a real process has I/O waiting behind it; a test world has
    // nothing else running, so the only thing a turn has to do is let the
    // promise chain the catch-up is already inside make progress.
    yieldTurn: () => Promise.resolve(),
    get armedAt() {
      return armed === null ? null : armed.at;
    },
    set(to: number) {
      now = to;
    },
    async fireArmed() {
      const pending = armed;
      armed = null;
      pending?.fire();
    },
  };
}

/**
 * A persistent world, constructed and driven the way a host drives one.
 *
 * Built through {@link createTestWorld}, which runs genesis -- a world that has
 * not launched has no partitions and nothing to look at, and making a caller
 * remember to launch it would be a harness whose easy path is the wrong one.
 *
 * A PUBLIC MEMBER ONLY TESTS CALL CARRIES A `fallow-ignore-next-line
 * unused-class-member`. Test files and a game's own suite are not consumers the
 * dead-code scan counts -- `ResidentWorld` carries the same note for the same
 * reason. The members `boardsmith validate`'s world audit drives need none.
 */
export class TestWorld {
  readonly #world: ResidentWorld;
  readonly #clock: ManualClock;
  readonly #store: WorldStore;
  readonly #watching: readonly number[];
  #orders = 0;
  #minted = 0;

  private constructor(options: TestWorldOptions) {
    const budgets = options.budgets ?? worldBudgets();
    this.#clock = manualClock(options.now ?? TEST_WORLD_EPOCH);
    this.#store = createMemoryWorldStore(budgets);
    this.#world = new ResidentWorld({
      definition: options.definition,
      seed: options.seed ?? 'test-world',
      budgets,
      store: this.#store,
      clock: this.#clock,
      presence: () => this.#watching,
      // ONE COUNTER, NOT A UUID. A world's scheduled events are part of what a
      // test asserts about, and an id that changed run to run would make the
      // queue unassertable for no gain: nothing here is racing anything.
      mintId: () => `test-event-${++this.#minted}`,
    });
    this.#watching =
      options.watching ??
      Array.from({ length: this.#world.seatCount }, (_unused, index) => index + 1);
  }

  /**
   * BUILD THE WORLD AND LAUNCH IT, with every declared seat on the roster.
   *
   * The roster is durable and a world's seats are where a player's holdings
   * are, so it is written before genesis runs -- exactly as a host writes one
   * the first time a socket attaches, and for the same reason: a view or an
   * offer for a player the roster has never seen has no seat to be about.
   */
  static async create(options: TestWorldOptions): Promise<TestWorld> {
    const world = new TestWorld(options);
    await world.#world.start();
    for (let seat = 1; seat <= world.#world.seatCount; seat++) {
      world.#world.seat(worldSeatPlayer(seat), seat);
    }
    return world;
  }

  /** How many seats this world's own rules declare. */
  // fallow-ignore-next-line unused-class-member
  get seatCount(): number {
    return this.#world.seatCount;
  }

  /** Which committed state this world is publishing (#244). */
  // fallow-ignore-next-line unused-class-member
  get revision(): number {
    return this.#world.revision;
  }

  /** What time it is in this world. */
  // fallow-ignore-next-line unused-class-member
  get now(): number {
    return this.#world.now();
  }

  /** Has this world reported that it is complete? */
  // fallow-ignore-next-line unused-class-member
  get completed(): boolean {
    return this.#world.completed;
  }

  /** The durable player id a seat is filed under, which is what every world
   *  call takes. Exposed because a test asserting on a stored roster or a
   *  receipt needs the same name the world uses. */
  // fallow-ignore-next-line unused-class-member
  playerOf(seat: number): string {
    return worldSeatPlayer(seat);
  }

  /**
   * WHAT THIS SEAT WOULD BE SENT, right now.
   *
   * The `world_state` body and the `world_offers` list of one frame, assembled
   * by the same two calls a host makes and in the same order -- so they carry
   * one revision between them and a test is looking at what a player looks at.
   *
   * A seat whose own `world.view` throws raises here rather than answering an
   * empty frame: on the wire that seat is told its view refused, and a test
   * that quietly scanned nothing would be a gate that cannot fail.
   */
  async getPlayerView(seat: number): Promise<WorldSeatView> {
    return this.#world.run(async () => {
      const player = worldSeatPlayer(seat);
      // PROJECTED FOR THE WHOLE AUDIENCE, exactly as a host projects: one
      // declaration round covers every watcher, and seats that hide nothing
      // from each other share one body. Asking for this seat alone would take a
      // road no host takes.
      const audience = [...new Set([...this.#watching, seat])].map(worldSeatPlayer);
      const { bodyFor, failed, revision } = await this.#world.viewsFor(audience);
      const refusal = failed[player];
      if (refusal !== undefined) {
        throw new Error(
          `Seat ${seat} has no view of this world: ${refusal.message} On the wire this seat is ` +
            "sent a refused frame; here it is raised, because a scan of a frame that was never " +
            'projected proves nothing.',
        );
      }
      const offers = await this.#world.offersFor(player);
      const disabledActions: Record<string, string> = {};
      for (const offer of offers) {
        if (offer.disabled !== undefined) disabledActions[offer.name] = offer.disabled;
      }
      const view = bodyFor(player);
      return {
        view,
        // THE SAME UNWRAP `useWorldPlay` DOES. The frame is an envelope and the
        // tree is one field of it; a harness that handed a board the envelope
        // would be handing it something no board has ever received.
        state: (view as { state?: unknown } | null)?.state as ElementJSON,
        offers,
        availableActions: offers.map((offer) => offer.name),
        disabledActions,
        isMyTurn: true,
        canAct: offers.some((offer) => offer.disabled === undefined),
        revision,
        presence: this.#watching,
      };
    });
  }

  /** Every action offered to this seat, disabled ones included. */
  async offersFor(seat: number): Promise<readonly WorldActionOffer[]> {
    return this.#world.run(() => this.#world.offersFor(worldSeatPlayer(seat)));
  }

  /**
   * ONE SELECTION OF AN OFFER, RE-ASKED WITH THE ANSWERS SO FAR BOUND.
   *
   * An offer is enumerated with nothing bound, so a later selection whose
   * candidates read an earlier answer offers nothing there. The world shell
   * asks again once the player has answered, and this is that call: the
   * narrowed list here is the list `take` is validated against.
   */
  async resolvePick(
    seat: number,
    action: string,
    selection: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<WorldActionOffer['selections'][number]> {
    return this.#world.run(() =>
      this.#world.resolvePick(worldSeatPlayer(seat), action, selection, args),
    );
  }

  /**
   * WHAT THE DRAFT WOULD COST, as the action's own `.quote()` prices it (#248).
   *
   * The call a host makes when the panel asks about a draft, so the lines are
   * the ones this seat would be shown. A read: nothing is dispatched.
   */
  async quote(
    seat: number,
    action: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly string[] | null> {
    return this.#world.run(() => this.#world.quote(worldSeatPlayer(seat), action, args));
  }

  /**
   * THIS SEAT ARRIVES, as a host announces it when a player attaches.
   *
   * The platform issues the bundle's `world.presence.onArrive` verb as the
   * clock with `{ seat, present: true }`. A bundle that declares no such verb
   * is told nothing, exactly as a host tells it nothing. The seat must be one
   * of `watching`, because an arrival is a player turning up and presence is
   * who is here.
   */
  async arrive(seat: number): Promise<void> {
    if (!this.#watching.includes(seat)) {
      throw new Error(
        `Seat ${seat} is not watching this world, so it cannot arrive in it. Name it in ` +
          '`watching` when you create the test world.',
      );
    }
    const hook = this.#world.presenceHooks?.onArrive;
    if (hook === undefined) return;
    await this.#world.run(() => this.#world.clockCommand(hook, { seat, present: true }));
  }

  /**
   * TAKE ONE OF THIS SEAT'S OFFERS.
   *
   * A command with an order minted for it, declared, run and checkpointed --
   * the road a player's click takes. The refusal a world raises is raised here,
   * unedited, because it is the sentence the author can act on.
   */
  async take(seat: number, action: string, args: Record<string, unknown> = {}): Promise<void> {
    await this.#world.run(() =>
      this.#world.command({
        player: worldSeatPlayer(seat),
        // ONE ORDER PER CALL. Two presses of the same button are two orders, so
        // a test that takes the same action twice must not be answered from the
        // first one's receipt.
        order: { id: `test-order-${++this.#orders}`, at: this.#world.now() },
        action,
        args,
      }),
    );
  }

  /**
   * MOVE THE WORLD'S CLOCK FORWARD AND RUN WHAT FALLS DUE.
   *
   * The same path the armed timer takes on a laptop: `now` moves, the arm that
   * was waiting fires, and the drain runs each event at its OWN due rather than
   * at the instant the clock arrived -- so the state a test sees is the state
   * waiting would have produced.
   */
  // fallow-ignore-next-line unused-class-member
  async advanceClock(byMs: number): Promise<void> {
    if (!Number.isFinite(byMs) || byMs < 0) {
      throw new Error(
        `A world's clock only ever moves forward, so it cannot be advanced by ${byMs}ms.`,
      );
    }
    this.#clock.set(this.#clock.now() + byMs);
    const armed = this.#clock.armedAt;
    if (armed !== null && armed <= this.#clock.now()) await this.#clock.fireArmed();
    await this.#world.settled();
  }

  /**
   * RUN WHAT IS SCHEDULED WITHOUT WAITING FOR IT, by moving the world's clock
   * to the instant the earliest pending event was due.
   *
   * `boardsmith dev`'s "fire due events now" control. Answers false when
   * nothing was scheduled, because there was then nothing to fire.
   */
  async fireDue(): Promise<boolean> {
    return this.#world.run(async () => (await this.#world.fireDue()) !== null);
  }

  /**
   * DROP EVERYTHING RESIDENT AND REBUILD FROM THE STORE.
   *
   * The path a hibernated world takes, and the one that finds a reference that
   * was never adopted or a subtree grafted in the wrong place -- those are
   * invisible on the instance that ran genesis, because it has held the real
   * objects all along. Worth a call in any test that then asserts on a view.
   */
  // fallow-ignore-next-line unused-class-member
  async wake(): Promise<void> {
    await this.#world.run(async () => {
      await this.#world.wake();
    });
  }

  /**
   * EVERY ELEMENT THIS WORLD HOLDS, UNREDACTED.
   *
   * Read out of the store rather than off a live tree, which is the only place
   * the whole world exists: a world is resident one partition at a time by
   * design, so there is no moment at which an engine holds all of it.
   *
   * It is what the hidden-information gate diffs a seat's projection AGAINST
   * (see `dom-leak.ts`): a marker is forbidden for a seat when this says the
   * world holds it and that seat's frame does not.
   */
  async unredactedElements(): Promise<readonly ElementJSON[]> {
    const all: ElementJSON[] = [];
    for (const name of this.#store.partitionNames()) {
      const stored = (await this.#store.read(name)) as StoredPartition | undefined;
      if (stored === undefined) continue;
      flatten(stored.json as ElementJSON, all);
    }
    return all;
  }

  /** Stop, leaving nothing resident that is not durable. A memory store has
   *  nothing to release, so this is here for the shape a host has: a test that
   *  calls it and one that does not get the same world. */
  async close(): Promise<void> {
    await this.#world.close();
  }
}

/** Depth-first, every node of a partition's tree. */
function flatten(node: ElementJSON, into: ElementJSON[]): void {
  into.push(node);
  for (const child of node.children ?? []) flatten(child, into);
}

/**
 * Build and launch a persistent world for a test -- `createTestGame`'s sibling.
 *
 * @example
 * ```ts
 * const world = await createTestWorld({ definition: myBundle });
 * const view = await world.getPlayerView(1);
 * expect(view.availableActions).toContain('chop');
 * ```
 */
export function createTestWorld(options: TestWorldOptions): Promise<TestWorld> {
  return TestWorld.create(options);
}

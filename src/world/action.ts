/**
 * A WORLD'S VERBS ARE ACTIONS (#169).
 *
 * Until this file a world's verbs were a flat command table: a name, a prompt,
 * and typed arguments of kind `choice`, `number` or `text`. That is a second
 * vocabulary for something the engine already had, and it is why a world had no
 * board clicks, no accessible action panel, no enumeration and no bots -- every
 * one of those is built over the Action system, and a command was not one.
 *
 * So a world action IS an `ActionDefinition`, registered in the same `_actions`
 * registry a table's action is registered in, reached through the same
 * `game.getAction`, enumerated by the same `getAvailableActions`. What a world
 * adds is ONE optional block on the definition -- `world: { needs, seatless }`
 * -- and this module is what an author writes to produce it.
 *
 * ## The declaration is an ordered walk, not a fixpoint
 *
 * A world is absent until something names it, so a verb has always had to
 * declare which partitions it needs BEFORE it can read any of them. The flat
 * table answered that with one `partitions(args, seat, world)` function asked
 * repeatedly until it stopped naming anything new -- a fixpoint, with a round
 * ceiling and a `declaration-unsettled` refusal for an author who wrote a
 * traversal instead of a declaration.
 *
 * An action does not need the fixpoint, because an action is ALREADY ordered.
 * Its selections are a sequence the engine resolves one step at a time, so the
 * declaration is one `needs` step per selection step, in the author's own
 * order, hydrated between steps:
 *
 * ```ts
 * worldAction<VillageGame>('tend')
 *   // Round one: what I need before I can name anything else. A pure
 *   // function of the seat -- nothing is resident yet.
 *   .needs(({ player }) => [holdingPartition(player.seat)])
 *   .chooseElement('neighbour', {
 *     // This selection's round, evaluated with round one resident.
 *     needs: ({ player }) => neighbourSeats(player.seat).map(holdingPartition),
 *     // Evaluated with this selection's round resident. Every element must
 *     // lie inside a partition the line above named, and the engine checks.
 *     elements: ({ game, player }) =>
 *       neighbourSeats(player.seat).map((s) => holdingRoot(game, s)),
 *   })
 *   .execute(({ neighbour }, ctx) => { ... });
 * ```
 *
 * `.needs()` before any selection is round one. A `needs` on a selection is
 * that selection's round. A `.needs()` after the last selection is the EXECUTE
 * round -- for a partition `execute` writes but no candidate list ever
 * mentioned, which is the case sotf's navigate roll makes real: a declaration
 * may not roll, so a move that can miss must declare every sector it could
 * land in even though the player only ever aimed at one.
 *
 * The walk cannot fail the way the fixpoint could. Its length is the number of
 * `needs` steps the author wrote, which is bounded by the selection count,
 * which is bounded by the action's own source. There is no ceiling to tune and
 * no unsettled refusal to explain.
 *
 * ## Why a builder of its own rather than `Action.create` and a cast
 *
 * `ActionContext` is `{game, player, args}` and must stay that: the table
 * backend has no clock and no partitions, and widening the shared context so a
 * world can reach its own facilities would put `now` on a surface where it
 * means nothing. So the world's facilities ride on ONE added property,
 * `ctx.world`, and `worldAction()` is what types it -- it wraps the core
 * builder, re-types every callback's context as {@link WorldActionContext}, and
 * returns an ordinary `ActionDefinition` that the ordinary `registerAction`
 * accepts. That is what keeps the table and the world one registry and one
 * enumeration, which is in turn what lets an MCTS bot reach a world action
 * through `getAction` with no world-only path to teach it.
 */
import { Action } from "../engine/index.js";
import type {
  ActionContext,
  ActionDefinition,
  ActionResult,
  BoardElementRef,
  ChoiceBoardRefs,
  Game,
  GameElement,
  Player,
  PlayerOf,
  Selection,
} from "../engine/index.js";
import type { ConditionConfig, MultiSelectConfig } from "../engine/action/types.js";
import type { WorldBudgets } from "./budgets.js";
import type { ScheduleArm } from "./schedule-api.js";
import type { SeatActivity, WorldNarrationLine } from "./contract.js";
// TYPE-ONLY, so the import is erased and the cycle with `engine.ts` is not one
// at runtime. `WorldResidency` is declared beside the engine that answers it.
import type { WorldDeclarationFacilities } from "./engine.js";
import { worldRefusal } from "./refusals.js";

/**
 * WHAT A WORLD GIVES AN ACTION THAT A TABLE CANNOT.
 *
 * Everything `WorldCommandContext` used to carry, on one property of the
 * ordinary action context rather than in place of it.
 */
export interface WorldFacilities {
  /**
   * WHEN THIS IS HAPPENING, according to the host.
   *
   * The stamped ARRIVAL instant for a player's action and a scheduled event's
   * own `due` for one the clock issued, so a world drained a week late computes
   * exactly what a punctual one would. It is the ONLY clock an action may
   * trust: `Date.now()` inside the isolate is the execution instant rather than
   * the arrival one, and the two diverge exactly when the world is busy.
   */
  readonly now: number;
  /**
   * A scheduled event's timing, or null for a seat's action.
   *
   * `missedCount` is how many occurrences of a recurrence got no call of their
   * own and were folded into this one; this call is not one of them, so
   * integrate with `1 + timing.missedCount`.
   */
  readonly timing: { readonly due: number; readonly missedCount: number } | null;
  /**
   * Which seats hold an open connection right now.
   *
   * The host's stamp, exactly as `now` is: socket state lives outside the
   * world, so this is handed down rather than read. Per seat, derived at this
   * instant and never stored.
   */
  readonly presence: ReadonlySet<number>;
  /**
   * HOW LONG THE SEAT THIS DISPATCH BELONGS TO HAS BEEN SILENT (#383).
   *
   * The host's durable per-seat watermark, handed down the way `now` and
   * `presence` are and for the same reason. Write a deadline against
   * `world.now - world.activity.inactiveSince`; see `SeatActivity` for what
   * counts as activity, why the value predates the command carrying it, and
   * why `inactiveSince` rather than `at` is the field to subtract.
   *
   * NULL WHEN THERE IS NO SEAT TO BE ABOUT -- the world's own clock events.
   * A handler that needs one says so by refusing on null rather than by
   * defaulting, because a default here is somebody's empire.
   */
  readonly activity: SeatActivity | null;
  /** The resident root of a partition this step's declaration named. */
  partition(name: string): GameElement;
  /**
   * SAY WHAT JUST HAPPENED, AND WHERE.
   *
   * A world's narration is its routed events. `scope` is either the reserved
   * `"world"` -- everybody in this world -- or the NAME OF A PARTITION, whose
   * audience is the seats that can see it. That narrowing is what makes a
   * broadcast cost what the room costs rather than what the world contains, and
   * it is why a world action emits rather than calling `game.message()`: the
   * message log lives outside every partition, so nothing ever checkpoints it
   * and nobody who was not connected would see it.
   *
   * Who can see a scope is the ENGINE's answer and not the game's: an action
   * says where something happened, and the world is what decides who was there.
   *
   * Refused outside a real dispatch, for the reason `schedule` is: an offer is
   * a question, and answering it must not narrate anything.
   *
   * AND `narration` IS THE SENTENCE, IF THERE IS ONE (#186). `payload` is the
   * board's and stays uninterpretable by every layer between the rules and the
   * game's own UI -- so a shell that had to render the log out of it would be
   * printing JSON, which is the debug console #170 removed. The line is
   * therefore its own argument: the game writes what it wants SAID, in the
   * shape `GameHistory` already takes, and the shell says exactly that.
   *
   * OMITTED MEANS SILENCE, and it is the common case: an event with no
   * narration puts no line in the log rather than an invented one.
   */
  emit(scope: string, payload: unknown, narration?: WorldNarrationLine): void;
  /**
   * ASK THE HOST TO WAKE THIS WORLD LATER.
   *
   * A request rather than an insertion: the queue belongs to the host, so the
   * request rides home on this action's result and the host stamps the owner,
   * enforces the cap and inserts. It THROWS when the request cannot be taken,
   * at the offending line, so the whole action unwinds and the world is left
   * unchanged.
   *
   * REFUSED OUTSIDE A REAL DISPATCH. Enumeration and any simulated dispatch --
   * a bot's search, which rolls the tree back many times inside one real
   * command -- reach the same facilities object, and a schedule escapes the
   * tree and cannot be rolled back with it.
   */
  schedule(request: ScheduleArm): void;
  /**
   * ASK THE HOST TO FORGET A TIMER THIS SEAT ARMED (#177).
   *
   * The inverse of `schedule`, and a request in exactly the same way: it rides
   * home on this action's result and the host is the only writer.
   *
   * KEYED, because a key is the only handle a cancel has -- a pending event is
   * addressed by `(owner, key)` and the owner is stamped from the acting seat,
   * so a bundle can no more forget somebody else's timer than charge one to
   * them. An unkeyed event cannot be cancelled at all, which is one more reason
   * a keyed schedule is the shape to write.
   *
   * IDEMPOTENT. Cancelling a key nothing holds does nothing, because the
   * pattern this exists for is a deadline a seat can beat: whoever arrives
   * first clears the obligation and the loser finds it cleared. The loser is
   * the caller whose timer already fired, and a handler cannot read the queue
   * to know which it is.
   *
   * Refused outside a real dispatch, for the reason `schedule` is.
   */
  cancel(key: string): void;
  /**
   * DECLARE THIS SEASON OVER. Takes no argument so it cannot name any other
   * ending. Refused outside a real dispatch, for the reason `schedule` is.
   */
  complete(): void;
}

/**
 * The context every callback of a SEATED world action receives.
 *
 * `ActionContext` unchanged, plus the one property that says this is a world.
 */
export interface WorldActionContext<G extends Game = Game> extends ActionContext<G> {
  readonly world: WorldFacilities;
}

/**
 * The context a SEATLESS action's `execute` receives.
 *
 * NO `player`, and no synthetic clock seat to stand in for one. A clock action
 * genuinely has nobody acting, and inventing a player would be the kind of
 * fallback that masks the real problem later -- the flat table's `requireSeat`
 * and `ownHolding` helpers exist precisely because the old model let a null
 * seat reach a handler that assumed one. Here the type says it.
 */
export interface WorldClockContext<G extends Game = Game> {
  readonly game: G;
  readonly args: Record<string, unknown>;
  readonly world: WorldFacilities;
}

/**
 * HOW MANY OF A THING A WORLD'S CHOICE TAKES (#376).
 *
 * The engine's own form also admits `undefined` from the function, meaning
 * "single-select after all". A world's does not, and that is the one place this
 * narrows what the engine can express: a `multiSelect` here ALWAYS resolves to
 * an array, so the argument's type is knowable from the call rather than from
 * whatever the function decided at render time. An author who wants exactly one
 * writes `{ min: 1, max: 1 }` and receives an array of one, which is a shape a
 * handler can write once instead of branching on.
 */
export type WorldMultiSelect<G extends Game = Game> =
  | number
  | MultiSelectConfig
  | ((context: WorldActionContext<G>) => number | MultiSelectConfig);

/**
 * Everything a world's `chooseFrom` takes apart from `multiSelect`, which is
 * split out because it is what decides whether the argument is a `T` or a
 * `T[]` and therefore has to live in the overloads.
 */
export interface WorldChoiceOptions<G extends Game, T> {
  prompt?: WorldPrompt<G>;
  needs?: (context: WorldNeedsContext<G>) => readonly string[];
  choices: T[] | ((context: WorldActionContext<G>) => T[]);
  display?: (choice: T) => string;
  optional?: boolean | string;
  validate?: (
    value: T,
    args: Record<string, unknown>,
    context: WorldActionContext<G>,
  ) => boolean | string;
  boardRefs?: (choice: T, context: WorldActionContext<G>) => ChoiceBoardRefs;
  disabled?: (choice: T, context: WorldActionContext<G>) => string | false;
}

/**
 * Everything both element selections take, apart from `validate` -- whose value
 * is a `T` on the singular form and a `T[]` on the plural -- and the plural's
 * `multiSelect`. The same split `WorldChoiceOptions` makes, for the same
 * reason: what differs is exactly what decides the argument's type.
 */
export interface WorldElementOptions<G extends Game, T extends GameElement> {
  prompt?: WorldPrompt<G>;
  needs?: (context: WorldNeedsContext<G>) => readonly string[];
  elements: T[] | ((context: WorldActionContext<G>) => T[]);
  optional?: boolean | string;
  display?: (element: T, context: WorldActionContext<G>, all: T[]) => string;
  boardRef?: (element: T, context: WorldActionContext<G>) => BoardElementRef;
  disabled?: (element: T, context: WorldActionContext<G>) => string | false;
}

/** What a seated step's declaration may read: the seat, and whatever earlier
 *  rounds made resident. */
export interface WorldNeedsContext<G extends Game = Game> {
  readonly game: G;
  readonly player: PlayerOf<G>;
  readonly args: Record<string, unknown>;
  /**
   * WHAT AN EARLIER ROUND MADE RESIDENT, BY NAME (#374).
   *
   * The same accessor `execute` and a bundle's `view(seat, world)` already
   * receive, and for the same reason: a name is the thing a declaration has,
   * and the engine indexes it. Reaching the same root through `game` instead
   * means a walk of the resident tree -- every seat's roster, through the
   * read-only projection -- to rediscover an id the engine is already holding.
   * At 500 seats that walk was the whole of #374's measured cost.
   *
   * Read-only, exactly as `game` is: a declaration runs before the platform has
   * decided what this command may change, so a write here could not be
   * checkpointed. See `readonly.ts`.
   *
   * It also carries `now`, the instant this dispatch is happening at (#375).
   */
  readonly world: WorldDeclarationFacilities;
}

/** What a seatless step's declaration may read. `seat` is null and there is no
 *  `player` to reach for. */
export interface WorldClockNeedsContext<G extends Game = Game> {
  readonly game: G;
  readonly seat: null;
  readonly args: Record<string, unknown>;
  /** As `WorldNeedsContext.world` (#374, #375). A clock's declaration reads the
   *  same resident state a seat's does, and its `now` is the event's own
   *  `due` -- the instant the clock is acting at. */
  readonly world: WorldDeclarationFacilities;
}

/**
 * One step's declaration, with its author's typing erased.
 *
 * The engine calls every declaration through this one shape, which is why both
 * contexts above are satisfied by a single runtime object: a seated step reads
 * `player`, a seatless one reads `seat`, and the fields the other kind must not
 * touch are absent from its type rather than merely undocumented.
 */
/** One round of the walk, and the step it comes before. */
export interface WorldNeedsRound {
  /** The index of the selection this round precedes; `selections.length` for
   *  the round before `execute`. */
  readonly before: number;
  readonly declare: WorldNeeds;
}

export type WorldNeeds = (context: {
  readonly game: Game;
  readonly player: Player | null;
  readonly seat: number | null;
  readonly args: Record<string, unknown>;
  readonly world: WorldDeclarationFacilities;
}) => readonly string[];

/**
 * THE ONE WORLD-OWNED BLOCK ON AN `ActionDefinition`.
 *
 * `ActionDefinition` is the engine's and stays the engine's; this is the single
 * optional slot a world adds to it, typed here in `boardsmith/world` and
 * imported into the engine's types as a type-only reference -- the same
 * reversal `GameDefinition.world` already makes.
 */
export interface WorldActionBlock {
  /**
   * NOBODY ACTS THIS: it is the world's own clock.
   *
   * A scheduled event runs an action out of the SAME registry a player's action
   * comes from -- a world has one way to change rather than two -- so this is
   * what keeps a completion handler nobody should ever press off the panel.
   *
   * EXACTLY TWO SITES READ IT, AND IT MUST STAY TWO: the filter that builds a
   * seat's offer, and the refusal on the submit path. Filtering alone leaves
   * the rule enforceable only by the client, which is not a place a rule can
   * live; refusing alone leaves the dead button on the panel.
   */
  readonly seatless?: boolean;
  /**
   * THE ORDERED WALK, in the order the author wrote it.
   *
   * A ROUND is one declaration: a function answered read-only, whose names are
   * made resident before the next thing happens. `before` says which selection
   * this round must precede, and `selections.length` means "before execute".
   *
   * The array is in source order and `before` never decreases, so the walk is
   * simply: run the rounds in order, and run selection `i` once every round
   * whose `before` is `i` has been hydrated.
   *
   * SEVERAL ROUNDS MAY SHARE A `before`, and that is the shape a chain needs.
   * `.needs(a).needs(b)` on an action with no selections is two rounds: `a` is
   * answered with nothing resident, `b` is answered with what `a` loaded. That
   * is a MUD's `look` -- name the wanderer index, read it, name the room the
   * index points at -- and an earlier design that allowed one declaration per
   * position could not express it, so `look` had to branch on whether its own
   * partition happened to be there yet. That branch is the thing #122 exists to
   * delete, and it comes back the moment a position may only be declared once.
   */
  readonly needs: readonly WorldNeedsRound[];
}

/**
 * WHOSE WORLD THIS GAME IS RUNNING IN, while it is running in one.
 *
 * Held ON THE GAME, under a key from the GLOBAL symbol registry, and both
 * halves of that are a measured fix rather than a preference.
 *
 * ON THE GAME, because a world is not a property of the engine: the same `Game`
 * class runs on a table, where none of this exists. Bound by the world engine
 * for the length of one offer or one dispatch and released afterwards, so an
 * action that squirrelled its context away cannot reach a tree the host has
 * since evicted.
 *
 * UNDER `Symbol.for`, because THE GAME AND THE HOST ARE NOT THE SAME COPY OF
 * THIS MODULE. A published bundle compiles the library INTO itself -- the local
 * host loads `.boardsmith/runtime-bundle.mjs`, and a Cloudflare child isolate
 * loads a bundle built the same way -- while the engine driving it is the
 * host's own import. Two module instances, two module-scope variables: a
 * `WeakMap` declared here was written by the engine's copy and read by the
 * bundle's, so every world action refused with "this only exists while a
 * persistent world is running it" at the first offer. A symbol from the global
 * registry is the same symbol in both copies, and the game object is the one
 * thing they demonstrably share.
 */
const FACILITIES_KEY = Symbol.for("boardsmith.world.facilities");

type FacilitiesHolder = { [FACILITIES_KEY]?: WorldFacilities };

/** Bind (or, with `null`, release) the facilities this game's actions reach.
 *  The world engine is the only caller. */
export function bindWorldFacilities(game: Game, facilities: WorldFacilities | null): void {
  const holder = game as unknown as FacilitiesHolder;
  if (facilities === null) delete holder[FACILITIES_KEY];
  else holder[FACILITIES_KEY] = facilities;
}

/**
 * The facilities in force, or a refusal naming why there are none.
 *
 * The refusal is the one an author meets when they register a world action on a
 * table game, which is a real mistake with an unhelpful failure otherwise: the
 * callback would read `undefined.partition` and report a TypeError from inside
 * library code.
 */
export function worldFacilitiesOf(game: Game): WorldFacilities {
  const facilities = (game as unknown as FacilitiesHolder)[FACILITIES_KEY];
  if (facilities === undefined) {
    throw worldRefusal(
      "not-in-a-world",
      "This action reached `ctx.world`, which only exists while a persistent world is running " +
        "it. An action built with `worldAction()` belongs to a game whose definition exports a " +
        "`world` block; registered on a table it has no partitions, no clock and no schedule to " +
        "reach for.",
    );
  }
  return facilities;
}

/** Erase the author's game type at the storage boundary. Sound because the
 *  runtime always passes the game this chain was written for. */
type AnyContext = ActionContext<Game>;

function withWorld<G extends Game>(context: AnyContext): WorldActionContext<G> {
  return {
    game: context.game as G,
    player: context.player as PlayerOf<G>,
    args: context.args,
    world: worldFacilitiesOf(context.game),
  };
}

type NoArgs = Record<never, never>;
type AddArg<A, K extends string, T> = A & { [P in K]: T };

/** A prompt as either half of the pair the core builder accepts, re-typed. */
type WorldPrompt<G extends Game> = string | ((context: WorldActionContext<G>) => string);

function forwardPrompt<G extends Game>(
  prompt: WorldPrompt<G> | undefined,
): string | ((context: AnyContext) => string) | undefined {
  if (typeof prompt !== "function") return prompt;
  return (context: AnyContext) => prompt(withWorld<G>(context));
}

/**
 * The forwarding `chooseElement` and `chooseElements` share (#376).
 *
 * The two differ only in how many elements come back, so every option except
 * `validate` -- whose value is a `T` on one and a `T[]` on the other -- is
 * re-typed identically. Written once, because the copy that existed for one
 * release was already drifting: `chooseElements` is where `multiSelect` had to
 * be remembered and `chooseElement` is where it must not appear.
 */
function forwardElementOptions<G extends Game, T extends GameElement>(
  options: WorldElementOptions<G, T>,
) {
  return {
    prompt: forwardPrompt<G>(options.prompt),
    elements:
      typeof options.elements === "function"
        ? (context: AnyContext) =>
            (options.elements as (c: WorldActionContext<G>) => T[])(withWorld<G>(context))
        : options.elements,
    optional: options.optional,
    display: options.display
      ? (element: T, context: AnyContext, all: T[]) =>
          options.display!(element, withWorld<G>(context), all)
      : undefined,
    boardRef: options.boardRef
      ? (element: T, context: AnyContext) => options.boardRef!(element, withWorld<G>(context))
      : undefined,
    disabled: options.disabled
      ? (element: T, context: AnyContext) => options.disabled!(element, withWorld<G>(context))
      : undefined,
  };
}

/** A world's `multiSelect`, re-typed onto the engine's. The function form gets
 *  the WORLD context, like every other callback on this facade (#376). */
function forwardMultiSelect<G extends Game>(
  multiSelect: WorldMultiSelect<G> | undefined,
): number | MultiSelectConfig | ((context: AnyContext) => number | MultiSelectConfig) | undefined {
  if (typeof multiSelect !== "function") return multiSelect;
  return (context: AnyContext) => multiSelect(withWorld<G>(context));
}

/**
 * ONE WORLD ACTION, UNDER CONSTRUCTION.
 *
 * Every method forwards to the core `Action` builder with the callback's
 * context re-typed, so what an author writes is the engine's own builder with
 * `ctx.world` in scope and one method -- `.needs()` -- added. It deliberately
 * does NOT expose the core builder's `from`/`filter`/`elementClass` element
 * form, `dependsOn`, `filterBy` or `repeat`: each of those makes an
 * enumeration whose size is a function of the RESIDENT tree rather than of the
 * declaration, and the resident tree is a function of what every other player
 * recently touched. `assertWorldActions` refuses them on a definition built by
 * any other route, so the omission here is a signpost and not the enforcement.
 */
/*
 * EVERY METHOD BELOW CARRIES A `fallow-ignore-next-line unused-class-member`.
 *
 * They are the AUTHORING SURFACE, and its callers are world bundles in other
 * repositories -- `~/BoardSmithGames`, a publisher's own project, the template
 * `boardsmith init --world` writes. Nothing inside this repository calls
 * `.chooseElement()` except a test, so a dead-code scan that only sees this
 * repository reports the whole builder as unused. That is the documented false
 * positive for this library's public API, and marking each one is how the scan
 * stays useful for the members that really are dead.
 */
export class WorldAction<G extends Game = Game, A extends Record<string, unknown> = NoArgs> {
  private readonly definition: ActionDefinition;

  private constructor(
    private readonly inner: Action<G, Record<string, unknown>>,
    private readonly seatless: boolean,
  ) {
    this.definition = inner.build();
    this.definition.world = seatless ? { needs: [], seatless: true } : { needs: [] };
  }

  /** Start a world action. `worldAction()` is the exported door. */
  static create<G2 extends Game>(name: string, seatless: boolean): WorldAction<G2, NoArgs> {
    return new WorldAction<G2, NoArgs>(
      Action.create<G2>(name) as Action<G2, Record<string, unknown>>,
      seatless,
    );
  }

  /**
   * WHAT THIS STEP NEEDS RESIDENT, evaluated before the step runs.
   *
   * Called before any selection it is round one, answered with nothing loaded.
   * Called after the last selection it is the execute round. Between them, put
   * the declaration ON the selection it belongs to (`needs:` in its options),
   * so the order in the source is the order the engine walks.
   *
   * Twice at the same position is refused: two declarations for one step is two
   * answers to one question, and which one wins would be a fact about
   * evaluation order rather than about the game.
   */
  // fallow-ignore-next-line unused-class-member
  needs(declare: (context: WorldNeedsContext<G>) => readonly string[]): this {
    // BEFORE THE FIRST SELECTION it is round one; AFTER THE LAST it is the
    // execute round. Called twice in the same place it is two rounds, and the
    // second may read what the first loaded -- which is how a declaration whose
    // subject is itself state gets written without branching on whether the
    // partition happens to be there yet.
    this.declareAt(this.definition.selections.length, declare as unknown as WorldNeeds);
    return this;
  }

  /** Append one round of the walk. `worldClockAction`'s facade reaches it for
   *  a seatless action's rounds, which is why it is not private. */
  declareAt(before: number, declare: WorldNeeds): void {
    (this.definition.world!.needs as WorldNeedsRound[]).push({ before, declare });
  }

  prompt(prompt: string): this {
    this.inner.prompt(prompt);
    return this;
  }

  // fallow-ignore-next-line unused-class-member
  help(text: string): this {
    this.inner.help(text);
    return this;
  }

  /** Offer this action only when the world says it is relevant here. */
  // fallow-ignore-next-line unused-class-member
  condition(config: Record<string, (context: WorldActionContext<G>) => boolean>): this {
    const forwarded: Record<string, (context: AnyContext) => boolean> = {};
    for (const [label, predicate] of Object.entries(config)) {
      forwarded[label] = (context: AnyContext) => predicate(withWorld<G>(context));
    }
    this.inner.condition(forwarded as ConditionConfig<G>);
    return this;
  }

  /** Offer it greyed out, with the reason why. */
  // fallow-ignore-next-line unused-class-member
  disabled(fn: (context: WorldActionContext<G>) => string | false): this {
    this.inner.disabled((context) => fn(withWorld<G>(context as AnyContext)));
    return this;
  }

  /** The whole-action gate, checked at submit with every selection resolved. */
  validate(fn: (args: A, context: WorldActionContext<G>) => boolean | string): this {
    this.inner.validate(((args: Record<string, unknown>, context: AnyContext) =>
      fn(args as A, withWorld<G>(context))) as never);
    return this;
  }

  /** Surface a no-selection action rather than taking the beat for the player. */
  // fallow-ignore-next-line unused-class-member
  manual(): this {
    this.inner.manual();
    return this;
  }

  /** Keep it off the action panel; the board can still drive it. */
  // fallow-ignore-next-line unused-class-member
  suppressFromActionPanel(): this {
    this.inner.suppressFromActionPanel();
    return this;
  }

  /**
   * A choice between values the game names.
   *
   * `choices` is a precomputed list, for the reason `elements` is: a world's
   * enumeration must be bounded by what the declaration named, and the
   * declaration is authored, finite and readable.
   */
  // TWO OVERLOADS, because `multiSelect` is what decides whether the argument
  // is a `T` or a `T[]`, and a handler should not have to be told which. Each
  // signature is a "member" to the dead-code pass and each is reached only by
  // games, so all three carry the same marker the other verbs do.
  // fallow-ignore-next-line unused-class-member
  chooseFrom<K extends string, T>(
    name: K,
    options: WorldChoiceOptions<G, T> & { multiSelect: WorldMultiSelect<G> },
  ): WorldAction<G, AddArg<A, K, T[]>>;
  // fallow-ignore-next-line unused-class-member
  chooseFrom<K extends string, T>(
    name: K,
    options: WorldChoiceOptions<G, T> & { multiSelect?: undefined },
  ): WorldAction<G, AddArg<A, K, T>>;
  // fallow-ignore-next-line unused-class-member
  chooseFrom<K extends string, T>(
    name: K,
    options: WorldChoiceOptions<G, T> & { multiSelect?: WorldMultiSelect<G> },
  ): WorldAction<G, AddArg<A, K, T | T[]>> {
    this.declareSelection(options.needs);
    this.inner.chooseFrom<K, T>(name, {
      // AN ORDINARY `ChoiceSelection` FIELD the facade had stopped passing on
      // (#376).
      multiSelect: forwardMultiSelect<G>(options.multiSelect),
      prompt: forwardPrompt<G>(options.prompt),
      choices:
        typeof options.choices === "function"
          ? (context) => (options.choices as (c: WorldActionContext<G>) => T[])(withWorld<G>(context))
          : options.choices,
      display: options.display,
      optional: options.optional,
      validate: options.validate
        ? (value, args, context) => options.validate!(value, args, withWorld<G>(context))
        : undefined,
      boardRefs: options.boardRefs
        ? (choice, context) => options.boardRefs!(choice, withWorld<G>(context))
        : undefined,
      disabled: options.disabled
        ? (choice, context) => options.disabled!(choice, withWorld<G>(context))
        : undefined,
    });
    return this as unknown as WorldAction<G, AddArg<A, K, T | T[]>>;
  }

  /**
   * One element off the board, from a list this step's declaration named.
   *
   * The whole point of the element form for a world: a `Holding` IS a
   * `GameElement`, so the board bridge wires the click straight through with no
   * `boardRefs` mapping to write, and the wire carries the two to four
   * candidates the declaration named rather than the five hundred a static
   * choice list would.
   */
  // fallow-ignore-next-line unused-class-member
  chooseElement<K extends string, T extends GameElement>(
    name: K,
    options: WorldElementOptions<G, T> & {
      validate?: (
        value: T,
        args: Record<string, unknown>,
        context: WorldActionContext<G>,
      ) => boolean | string;
    },
  ): WorldAction<G, AddArg<A, K, T>> {
    this.declareSelection(options.needs);
    this.inner.chooseElement<K, T>(name, {
      ...forwardElementOptions<G, T>(options),
      validate: options.validate
        ? (value, args, context) => options.validate!(value, args, withWorld<G>(context))
        : undefined,
    });
    return this as unknown as WorldAction<G, AddArg<A, K, T>>;
  }

  /**
   * A GROUP of elements off the board, from a list this step's declaration
   * named (#376).
   *
   * The plural of `chooseElement`, and the method two of this module's own
   * refusals already told authors to reach for -- "ask for the whole set in one
   * `chooseElements`" is what a world action is told when it tries to `repeat`
   * a selection. It was not on this facade, so that advice named a door that
   * did not exist and the only way to pick a crew was to pick one member.
   *
   * `elements:` is required for the reason it is on the singular form: a world
   * holds what its declaration named plus whatever anybody left resident, so a
   * board SEARCH finds a set whose size is a fact about other players. The
   * candidates are authored; the count is `multiSelect`.
   */
  // fallow-ignore-next-line unused-class-member
  chooseElements<K extends string, T extends GameElement>(
    name: K,
    options: WorldElementOptions<G, T> & {
      multiSelect?: WorldMultiSelect<G>;
      validate?: (
        value: T[],
        args: Record<string, unknown>,
        context: WorldActionContext<G>,
      ) => boolean | string;
    },
  ): WorldAction<G, AddArg<A, K, T[]>> {
    this.declareSelection(options.needs);
    this.inner.chooseElements<K, T>(name, {
      ...forwardElementOptions<G, T>(options),
      multiSelect: forwardMultiSelect<G>(options.multiSelect),
      validate: options.validate
        ? (value, args, context) => options.validate!(value, args, withWorld<G>(context))
        : undefined,
    });
    return this as unknown as WorldAction<G, AddArg<A, K, T[]>>;
  }

  /** Free text, bounded by the engine's own `maxLength`. */
  // fallow-ignore-next-line unused-class-member
  enterText<K extends string>(
    name: K,
    options: {
      prompt?: WorldPrompt<G>;
      needs?: (context: WorldNeedsContext<G>) => readonly string[];
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
      optional?: boolean | string;
      validate?: (
        value: string,
        args: Record<string, unknown>,
        context: WorldActionContext<G>,
      ) => boolean | string;
    } = {},
  ): WorldAction<G, AddArg<A, K, string>> {
    this.declareSelection(options.needs);
    this.inner.enterText<K>(name, {
      prompt: forwardPrompt<G>(options.prompt),
      minLength: options.minLength,
      maxLength: options.maxLength,
      pattern: options.pattern,
      optional: options.optional,
      validate: options.validate
        ? (value, args, context) => options.validate!(value, args, withWorld<G>(context))
        : undefined,
    });
    return this as unknown as WorldAction<G, AddArg<A, K, string>>;
  }

  /** A number, bounded where the game knows the bound. */
  // fallow-ignore-next-line unused-class-member
  enterNumber<K extends string>(
    name: K,
    options: {
      prompt?: WorldPrompt<G>;
      needs?: (context: WorldNeedsContext<G>) => readonly string[];
      min?: number;
      max?: number;
      integer?: boolean;
      optional?: boolean | string;
      validate?: (
        value: number,
        args: Record<string, unknown>,
        context: WorldActionContext<G>,
      ) => boolean | string;
    } = {},
  ): WorldAction<G, AddArg<A, K, number>> {
    this.declareSelection(options.needs);
    this.inner.enterNumber<K>(name, {
      prompt: forwardPrompt<G>(options.prompt),
      min: options.min,
      max: options.max,
      integer: options.integer,
      optional: options.optional,
      validate: options.validate
        ? (value, args, context) => options.validate!(value, args, withWorld<G>(context))
        : undefined,
    });
    return this as unknown as WorldAction<G, AddArg<A, K, number>>;
  }

  /** Record the declaration belonging to the selection about to be added. */
  private declareSelection(
    declare: ((context: WorldNeedsContext<G>) => readonly string[]) | undefined,
  ): void {
    if (declare === undefined) return;
    // Called just BEFORE the selection is pushed, so `selections.length` is
    // this selection's own index -- which is exactly the step this round comes
    // before.
    this.declareAt(this.definition.selections.length, declare as unknown as WorldNeeds);
  }

  /**
   * What this action does, and the end of the chain.
   *
   * A SEATLESS action's execute receives no `player`, because there is nobody
   * acting; a seated one receives the ordinary action context with `ctx.world`
   * added.
   */
  execute(
    fn: (args: A, context: WorldActionContext<G>) => ActionResult | void,
  ): ActionDefinition {
    const handler = fn as unknown as (
      args: A,
      context: WorldActionContext<G> | WorldClockContext<G>,
    ) => ActionResult | void;
    return this.inner.execute(((args: Record<string, unknown>, context: AnyContext) =>
      handler(
        args as A,
        this.seatless
          ? {
              game: context.game as G,
              args: context.args,
              world: worldFacilitiesOf(context.game),
            }
          : withWorld<G>(context),
      )) as never);
  }

  /** The definition so far, for inspection. Registering one that never reached
   *  `.execute(fn)` is refused by `registerAction`, exactly as a table's is. */
  // fallow-ignore-next-line unused-class-member
  build(): ActionDefinition {
    return this.definition;
  }
}

/**
 * A SEATLESS world action: the clock's own, and no player may issue it.
 *
 * Two rules, both refused at engine construction rather than at the moment a
 * scheduled event comes due:
 *
 *   IT DECLARES NO SELECTIONS. A selection is a question, and there is nobody
 *     to ask. Every clock verb in the catalogue already takes its arguments
 *     from the schedule row and never from a person.
 *   ITS DECLARATION READS `args` AND `seat: null`, and there is no `player`.
 */
export class WorldClockAction<G extends Game = Game> {
  private readonly action: WorldAction<G, NoArgs>;

  constructor(name: string) {
    this.action = WorldAction.create<G>(name, true);
  }

  // fallow-ignore-next-line unused-class-member
  prompt(prompt: string): this {
    this.action.prompt(prompt);
    return this;
  }

  // fallow-ignore-next-line unused-class-member
  needs(declare: (context: WorldClockNeedsContext<G>) => readonly string[]): this {
    // A seatless action has no selections, so every round comes before execute.
    // Called more than once they are consecutive rounds, and the second reads
    // what the first loaded.
    this.action.declareAt(0, declare as unknown as WorldNeeds);
    return this;
  }

  // fallow-ignore-next-line unused-class-member
  execute(
    fn: (args: Record<string, unknown>, context: WorldClockContext<G>) => ActionResult | void,
  ): ActionDefinition {
    return this.action.execute(
      fn as unknown as (args: NoArgs, context: WorldActionContext<G>) => ActionResult | void,
    );
  }
}

/**
 * Start a world action a seat may take.
 *
 * ```ts
 * worldAction<MudGame>('move')
 *   .needs(({ player }) => [WANDERERS_PARTITION])
 *   .chooseElement('to', {
 *     needs: ({ game, player }) => exitsOf(roomOf(game, player)).map(roomPartition),
 *     elements: ({ game, player }) => exitsOf(roomOf(game, player)),
 *   })
 *   .execute(({ to }, ctx) => { ... });
 * ```
 */
export function worldAction<G extends Game = Game>(name: string): WorldAction<G, Record<never, never>> {
  return WorldAction.create<G>(name, false);
}

/**
 * Start the world's own clock action: no seat, no selections, reachable only
 * by a scheduled event naming it.
 */
export function worldClockAction<G extends Game = Game>(name: string): WorldClockAction<G> {
  return new WorldClockAction<G>(name);
}

/**
 * REFUSE A WORLD ACTION THAT CANNOT BE OFFERED, OR CANNOT BE BOUNDED.
 *
 * Checked where `checkDeclaredArgs` checked a command table -- at engine
 * construction, before the world is built -- and for the reason stated there: a
 * bundle whose declaration is wrong is wrong for every player who will ever
 * attach, so it is refused once rather than on whichever player first asked
 * what they could do here.
 *
 * Three of the four rules are the O(view) guarantee. `viewFor` argues at length
 * that a world may never call `createPlayerView`, because that evaluates every
 * registered action's selections against a tree whose size is a function of
 * what every OTHER player recently touched. #169 deliberately reintroduces
 * enumeration; these are the contract that makes it affordable, and that
 * comment is the constraint they have to satisfy rather than an obsolete note.
 */
export function assertWorldAction(definition: ActionDefinition): void {
  const block = definition.world;
  if (block === undefined) {
    throw worldRefusal(
      "invalid-world-action",
      `The "${definition.name}" action is registered as one of this world's verbs but was not ` +
        "built with `worldAction()`. A world action declares which partitions each of its steps " +
        "needs resident; one built with `Action.create()` declares nothing, so the world would " +
        "have to load everything before offering it. Import `worldAction` from `boardsmith/world`.",
    );
  }

  if (block.seatless === true && definition.selections.length > 0) {
    throw worldRefusal(
      "invalid-world-action",
      `The "${definition.name}" action is the world's own clock and declares ` +
        `${definition.selections.length} selection(s). A selection is a question and there is ` +
        "nobody to ask: a clock action runs when the event scheduled for it comes due, whether " +
        "or not anybody is here. Take its arguments from the schedule row instead.",
    );
  }

  for (const round of block.needs) {
    if (round.before >= 0 && round.before <= definition.selections.length) continue;
    throw worldRefusal(
      "invalid-world-action",
      `The "${definition.name}" action declares what it needs before a step it does not have. ` +
        `It has ${definition.selections.length} selection(s), so a round comes before one of ` +
        `them or before execute.`,
    );
  }

  for (const selection of definition.selections) {
    assertWorldSelection(definition.name, selection);
  }
}

/** What a selection carries that a world action may not use. */
type WorldSelectionShape = Selection & {
  from?: unknown;
  filter?: unknown;
  elementClass?: unknown;
  elements?: unknown;
  dependsOn?: unknown;
  filterBy?: unknown;
  repeat?: unknown;
  repeatUntil?: unknown;
};

/** The per-selection half of the rule above: two rules, named separately
 *  because they refuse for two different reasons. */
function assertWorldSelection(action: string, selection: Selection): void {
  assertNamedCandidates(action, selection as WorldSelectionShape);
  assertIndependentSelection(action, selection as WorldSelectionShape);
}

/** (a) and its refusal. */
function assertNamedCandidates(action: string, shape: WorldSelectionShape): void {
  const selection = shape;
  // (a) THE UNBOUNDED ELEMENT FORM IS REFUSED.
  //
  // `getChoices`'s element branch, with `elements` absent, resolves `from`
  // (defaulting to the whole game) and walks `all()`, then filters over every
  // result. On a table that is a walk of the board. In a world it is a walk of
  // the RESIDENT tree, whose size is a function of what every other player
  // recently touched -- so an action written this way is not merely slow, it is
  // slow NON-DETERMINISTICALLY, and it is the exact shape measured at 260 KB
  // per view for a 500-seat village.
  if (selection.type === "element" || selection.type === "elements") {
    if (shape.from !== undefined || shape.filter !== undefined || shape.elementClass !== undefined) {
      throw worldRefusal(
        "invalid-world-action",
        `The "${action}" action's "${selection.name}" selection searches the board with ` +
          "`from`/`filter`/`elementClass`. A world holds only the partitions its declaration " +
          "named, and everything ELSE that anybody happened to leave resident, so a search finds " +
          "a set whose size is a fact about other players. Name your candidates: give the " +
          "selection an `elements:` list computed from what this step's `needs` declared.",
      );
    }
    if (shape.elements === undefined) {
      throw worldRefusal(
        "invalid-world-action",
        `The "${action}" action's "${selection.name}" selection names no candidates. A world ` +
          "action's element selection must supply `elements:`, because the alternative is a " +
          "search of the resident tree.",
      );
    }
  }

}

/** (d) and its refusal. */
function assertIndependentSelection(action: string, shape: WorldSelectionShape): void {
  const selection = shape;
  // (d) NO SELECTION MAY DEPEND ON ANOTHER, YET.
  //
  // `dependsOn` asks the engine to compute a selection's candidates for EVERY
  // value of the selection it depends on, which in a world is a per-candidate
  // declaration and a per-candidate hydration -- and the world protocol is
  // single-shot, so the offer would have to carry the whole product. Refused
  // rather than capped until the protocol is step-wise (#170); the fix is
  // one action per shape, which is also what makes each one's declaration
  // honest.
  if (shape.dependsOn !== undefined || shape.filterBy !== undefined) {
    throw worldRefusal(
      "invalid-world-action",
      `The "${action}" action's "${selection.name}" selection depends on another selection. A ` +
        "world offers a seat every selection's candidates at once, so a dependent selection " +
        "would have to be enumerated once per value of the one it depends on -- a hydration per " +
        "candidate. Split it into one action per shape, each with its own declaration.",
    );
  }
  if (shape.repeat !== undefined || shape.repeatUntil !== undefined) {
    throw worldRefusal(
      "invalid-world-action",
      `The "${action}" action's "${selection.name}" selection repeats. A repeating selection ` +
        "round-trips to the world once per iteration, and each trip is a declaration and a " +
        "hydration; a world action asks its questions once. Ask for the whole set in one " +
        "`chooseElements`, or make each iteration its own action.",
    );
  }
}

/**
 * REFUSE A SELECTION THAT OFFERS MORE THAN THIS HOST ALLOWS.
 *
 * The third guard, and the one the other two cannot supply: a 500-seat roster
 * is ONE partition and one honest declaration, and enumerating it yields 500
 * candidates. Checked where the candidates are actually produced -- at
 * enumeration -- because it is a fact about this world's state rather than
 * about the bundle's source.
 */
export function assertCandidateBudget(
  action: string,
  selection: string,
  count: number,
  budgets: WorldBudgets,
): void {
  if (count <= budgets.maxCandidatesPerSelection) return;
  throw worldRefusal(
    "invalid-world-action",
    `The "${action}" action's "${selection}" selection offers ${count} candidates, and this ` +
      `host allows ${budgets.maxCandidatesPerSelection} per selection. Every candidate is ` +
      "evaluated on the READ path, so an unbounded selection is paid by every watcher rather " +
      "than by whoever acted. Narrow it with an earlier selection -- offer the exits of the " +
      "room the player is in, not the rooms of the world.",
  );
}

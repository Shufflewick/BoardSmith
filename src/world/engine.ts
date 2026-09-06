/**
 * The BoardSmith implementation of `WorldEngine` (#35 item 2).
 *
 * `world-engine.ts` states the platform's requirement and why each member
 * exists; this file is the engine that meets it, and it is deliberately thin.
 * BoardSmith supplies every primitive it needs -- `adoptSubtree`,
 * `takeTouchedPartitions`, `partitionBaseline`, `GameElement.toJSON()` and
 * `toJSONForPlayer` -- so what remains here is residency bookkeeping and the
 * mapping between the platform's partition NAMES and the engine's partition
 * IDS.
 *
 * ## Names here, ids there, and why the split is the right one
 *
 * The engine takes partition roots as ELEMENT IDS and knows nothing about what
 * a partition is called. That is not an omission: an id is minted by the tree
 * and a name is minted by whatever wrote the checkpoint, and only the platform
 * has both. This class is the one place they are joined, so a partition name
 * never reaches the engine and an element id never reaches storage.
 *
 * ## HOW `applyCommand` DECIDES `dirty`
 *
 * `dirty` is LOADED-OR-TOUCHED, exactly as the contract's header decided:
 *
 *   LOADED -- every partition the command NAMED. Not "every partition the
 *     command's load actually hydrated": a partition left resident by an
 *     earlier command is still one this command was free to write, and there
 *     is no write barrier that could tell us it did not. Reporting the named
 *     set is an overcount bounded by what the command touched, which is the
 *     bargain the header struck and the reason the cost stays O(room).
 *   TOUCHED -- `game.takeTouchedPartitions()`, the engine's own half. It
 *     carries BOTH endpoints of every physical re-parent, which is the half the
 *     platform structurally cannot see: a cross-partition move dirties a
 *     destination this command's reads never named.
 *
 * `adoptSubtree` deliberately does not mark anything touched, because the
 * platform already knows what it hydrated. The union above is where the two
 * halves meet, and it is the whole of the dirty set.
 *
 * The touch set is TAKEN once at the end of every dispatch -- on the success
 * path and on the rollback path both -- so a result describes THAT command and
 * no earlier one, and a command pays for exactly one pass over the resident set
 * rather than the three it used to (#316). Accumulating until a checkpoint is
 * the caller's job: `WorldCommandResult.dirty` is per command, and a
 * `WorldSession` that batches N commands into one checkpoint unions the N
 * answers itself.
 *
 * ## The two prohibitions, and how they are kept
 *
 * No per-action snapshot: nothing here calls `createSnapshot`, and the only
 * serialisation that ever happens is `serializePartitions`, which the platform
 * calls at a CHECKPOINT with the dirty set -- never per action.
 *
 * No `actionHistory`: a command runs as a plain function against the live
 * tree. It does not go through `Game#execute`, which records a command and its
 * inverse. Direct tree mutation is recorded in no history at all (the engine
 * says so itself), so there is nothing to accumulate and nothing to trim.
 *
 * ## What this engine does NOT do yet
 *
 * It never evicts. A partition stays resident once loaded, which is what makes
 * the overcount above affordable and is the header's own "a resident DO
 * amortises it". Bounding a long-lived world's memory means an eviction policy
 * -- which partitions, on what signal -- and that is a `WorldSession` decision
 * about a live Durable Object, not something this class can decide alone.
 * `Game#evictSubtree` is the primitive it will use when that policy exists.
 */
import type { ElementJSON, Game, GameElement } from "../engine/index.js";
import type {
  WorldCommand,
  WorldCommandArgument,
  WorldCommandOffer,
  WorldCommandResult,
  WorldCommandStamp,
  WorldEngine,
  WorldEventStamp,
  WorldPartitionSource,
} from "./contract.js";
import { RESERVED_COMMAND_ARG } from "./contract.js";
import {
  scheduleBudget,
  WORLD_OWNER,
  type ScheduleAllowance,
  type ScheduleRequest,
} from "./schedule-api.js";
import { worldRefusal } from "./refusals.js";
import { readOnlyProjection } from "./readonly.js";
import { worldBudgets, type WorldBudgets } from "./budgets.js";

/**
 * The authoring types below are EXPORTED, and that reverses the call this file
 * used to make.
 *
 * They were reachable structurally -- a caller writes a handler into a
 * `WorldCommandTable` and TypeScript checks it -- so exporting them looked like
 * a public surface larger than its callers. It was not: the callers are world
 * BUNDLES, in other repositories, and every one of them hand-copied these
 * declarations because it had no way to import them. Three copies of a contract
 * is three places for it to drift, and it drifted. One declaration both sides
 * import is the whole point of `boardsmith/world`.
 *
 * Every one of them is TRANSITIONAL; see the note on `WorldCommandHandler`.
 */

/**
 * The events one command's HANDLER produced, before they are routed.
 *
 * Deliberately NOT `WorldCommandResult["events"]` any more (#58). What the
 * engine answers is a `RoutedEvent` -- the same event with its audience
 * resolved -- and resolving it is this engine's job, not the game author's. A
 * handler says WHERE something happened; who can see that place is a fact
 * about the world, and the world is what this class holds.
 */
export type WorldEvents = readonly { readonly scope: string; readonly payload: unknown }[];

/**
 * THE ONE SCOPE THE PLATFORM RESERVES: everybody in this world (#58).
 *
 * Not exported: a scope is a string a GAME writes, and the only thing that
 * reads this is the audience rule below. An export would invite a caller to
 * construct routing from outside the engine that owns it.
 *
 * Reserved rather than derived, because "everyone" is a real and common
 * address -- a season ending, a server-wide announcement -- and the alternative
 * is every game inventing its own name for it and the router having to trust
 * the name. A game that wants it says so.
 *
 * Every OTHER scope names a partition. That is the narrowing that makes a
 * broadcast cost what the room costs: a partition is the unit a world is
 * already loaded, checkpointed and evicted in, so "who can see this room" is a
 * question the engine can answer without walking the world.
 */
const WORLD_SCOPE = "world";

/**
 * One declaration, each partition named once, in the order the bundle named it.
 *
 * ORDER IS KEPT because it is the only thing a bundle can say about which
 * partition matters more, and `dispatch` stamps `lastUsed` by walking it.
 * `declaredFor` and `viewDeclaredFor` explain why the duplicate arises and why
 * it is the platform's to absorb rather than the author's to avoid.
 */
function declaredOnce(names: readonly string[]): readonly string[] {
  return [...new Set(names)];
}

/**
 * Every element id a serialized subtree claims.
 *
 * What the rollback has to free before it can graft that subtree back: a
 * partition may only be adopted once, and `adoptSubtree` looks for the clash in
 * the whole resident tree AND in the game's pile.
 */
function idsIn(json: ElementJSON, into: number[] = []): number[] {
  into.push(json.id);
  for (const child of json.children ?? []) idsIn(child, into);
  return into;
}

/**
 * REFUSE A COMMAND DECLARATION THAT CANNOT BE HONOURED (#91).
 *
 * A descriptor is a PROMISE to a surface: this command asks for these things,
 * so draw these inputs. Three declarations break the promise before a player
 * ever sees them, and each one produces a form whose every submission is
 * refused -- the worst failure a generic UI has, because it looks like the
 * player's mistake.
 *
 *   - a `now` argument. `WorldSession` refuses any frame carrying one (#57),
 *     so an input for it could never be filled in successfully. The reserved
 *     name is `RESERVED_COMMAND_ARG`, defined once at the contract, because
 *     the refusing side and the declaring side must mean the same word.
 *   - two arguments of one name. The second silently wins whichever way a
 *     surface builds its object, so which one the handler reads is a fact
 *     about the client rather than about the game.
 *   - an empty name, or a `choice` offering nothing. Neither can be drawn.
 *
 * Refused at construction, so the bundle's author learns of it on the world's
 * first wake rather than from a player who cannot do anything.
 */
function checkDeclaredArgs(
  command: string,
  args: readonly WorldCommandArgument[] | undefined,
): void {
  if (!Array.isArray(args)) {
    throw worldRefusal(
      "invalid-command-args",
      `The "${command}" command declares no \`args\`. Every world command must say what it ` +
        "asks a player for, so the platform can offer a real form instead of a JSON box. A " +
        "command that asks for nothing declares `args: []`.",
    );
  }
  const seen = new Set<string>();
  for (const arg of args) {
    if (typeof arg.name !== "string" || arg.name === "") {
      throw worldRefusal(
        "invalid-command-args",
        `The "${command}" command declares an argument with no name. Every argument needs the ` +
          "name its handler reads it by.",
      );
    }
    if (arg.name === RESERVED_COMMAND_ARG) {
      throw worldRefusal(
        "invalid-command-args",
        `The "${command}" command declares an argument named "${RESERVED_COMMAND_ARG}", and a ` +
          "client does not get to say what time it is -- a frame carrying one is refused before " +
          "it runs. Read the platform's own stamped instant as `ctx.now` and drop the argument.",
      );
    }
    if (seen.has(arg.name)) {
      throw worldRefusal(
        "invalid-command-args",
        `The "${command}" command declares "${arg.name}" twice. One argument, one name: a ` +
          "client can only send one value under it, so the second declaration describes an " +
          "input nothing will read.",
      );
    }
    seen.add(arg.name);
    if (arg.kind === "choice" && arg.choices.length === 0) {
      throw worldRefusal(
        "invalid-command-args",
        `The "${command}" command's "${arg.name}" is a choice between nothing. Declare the ` +
          "values the game itself can name -- the world's own state is the handler's business, " +
          "and this is answered before any partition is loaded.",
      );
    }
  }
}


/**
 * What a command handler is given when it runs.
 *
 * DELIBERATELY NO `game` (#152). The dirty-set contract -- everything a
 * command may have written is reported dirty -- was enforced only through the
 * `partition()` accessor below, while the same context handed the whole tree
 * over as `game`. An attribute write reaching a resident-but-undeclared
 * partition through a global query (`game.getElementById(id).at.price = 5`)
 * was not refused, not named, and not touched: every watcher's view showed the
 * new value, the checkpoint never serialized it, and eviction or hibernation
 * silently reverted it. The API made the wrong way exactly as easy as the
 * right way, so the wrong way is no longer on the surface at all: a handler
 * reads and writes the world through `partition()`, and a cross-partition move
 * travels on an element reference a declared partition already holds -- whose
 * re-parent the engine tracks (`takeTouchedPartitions`) whichever way the
 * reference was obtained.
 */
/**
 * TRANSITIONAL -- #169 DELETES THIS TYPE.
 *
 * A world command's handler receives this; a world ACTION's will receive the
 * engine's own action context. Everything on it survives in some form -- `now`,
 * `timing`, `presence`, `schedule` and `complete` are all facts an action needs
 * just as much -- but the OBJECT does not, and `args` and `partition` in
 * particular change shape: an action's arguments are its selections, and what
 * it may reach is what its own `needs` declared.
 */
export interface WorldCommandContext {
  /** The command's own payload, unread by the platform. */
  readonly args: Readonly<Record<string, unknown>>;
  /** The seat that issued this command, or null for a scheduled event. */
  readonly seat: number | null;
  /**
   * WHEN THIS COMMAND HAPPENS, according to the platform (#57).
   *
   * The stamped ARRIVAL instant for a player's command, and a scheduled
   * event's own `due` for one the clock issued -- so a world drained a week
   * late computes exactly what a punctual one would.
   *
   * THIS IS THE ONLY CLOCK A HANDLER MAY TRUST. `args` is the client's frame:
   * a player who could name the time would backdate every timer they start,
   * and every building would finish the moment it was begun. `Date.now()`
   * inside the isolate is the execution instant rather than the arrival one,
   * and the two diverge exactly when the world is busy -- which is when it
   * matters.
   *
   * Measure a delay FROM THIS, and give `ctx.schedule()` the delay rather than
   * an absolute instant, so both halves of a timer read the same clock.
   */
  readonly now: number;
  /**
   * A scheduled event's timing, or null for a player command.
   *
   * `due` is the SCHEDULED time and never the wall clock, so a world that
   * drained late produces the same state as one that drained on time.
   *
   * `missedCount` is how many occurrences of a RECURRENCE got no call of their
   * own, folded into this one (#127). This call is not one of them, so
   * integrate with `1 + timing.missedCount`. It is 0 for a one-shot and for
   * every occurrence that ran on its own, so a handler that never reads it is
   * correct whenever the world kept up.
   */
  readonly timing: {
    readonly due: number;
    readonly missedCount: number;
  } | null;
  /**
   * WHICH SEATS ARE CONNECTED RIGHT NOW (#144).
   *
   * The platform's stamp, exactly as `now` is: socket state lives on the
   * parent, so this is handed down rather than read, and a handler asking
   * `ctx.presence.has(seat)` is asking the only side that can know. PER SEAT
   * -- a player with two tabs is present once -- and DERIVED at the moment of
   * this command, never stored, so it cannot claim anybody across a
   * hibernation: a world woken hours after parking sees whoever is actually
   * attached, usually nobody.
   *
   * It means exactly "this seat holds an open connection at this instant".
   * The platform does not distinguish "left" from "dropped and reconnecting";
   * a world that wants durable consequences of leaving writes them as state,
   * through commands. Presence is not world state and never becomes any
   * unless a handler deliberately writes it.
   */
  readonly presence: ReadonlySet<number>;
  /** The resident root of one of the partitions this command declared. */
  partition(name: string): GameElement;
  /**
   * ASK THE PLATFORM TO WAKE THIS WORLD LATER (#37 item 3, #56).
   *
   * The EAGER half of the timer primitive, and the expensive one: a scheduled
   * event costs a wake, because the world must exist at that instant to do
   * something nobody asked for. If the effect is only visible when somebody
   * next looks, write a `completesAt` timestamp from `ctx.now` instead and
   * compute it on read -- that costs nothing at all, and the world sleeps
   * through the whole thing.
   *
   * A REQUEST, not an insertion. The queue is a key in the parent's storage
   * and this runs in a child isolate with no bindings, so the request rides
   * home on the command's result and the parent stamps the owner, enforces the
   * cap and inserts. That is section 7's "the abusive path cannot reach the
   * queue rather than failing a check" as a property of the surface.
   *
   * `delayMs` is measured from `ctx.now`, so a world woken late schedules the
   * instant a punctual one would.
   *
   * `everyMs` MAKES IT A RECURRENCE, and the platform re-arms it: `delayMs` is
   * the first occurrence, `everyMs` the gap between the rest. A handler never
   * writes the re-arm and cannot forget it, and one that fell behind is caught
   * up by `catchUpPlan` rather than replayed -- four real occurrences and one
   * coalesced call carrying `timing.missedCount`. It costs ONE queue row for
   * the life of the world, because the drain replaces its event rather than
   * adding beside it.
   *
   * It THROWS when the request cannot be taken -- a negative delay, or this
   * player's unkeyed events at the cap -- and it throws HERE rather than
   * quietly later, so the whole command unwinds and the player is told no over
   * a world that did not change. A keyed schedule upserts and can never hit the
   * cap, which is why the refusal's first suggestion is to use one.
   */
  schedule(request: ScheduleRequest): void;
  /**
   * DECLARE THIS SEASON OVER.
   *
   * The one ending a game may name, and it takes no argument so it cannot name
   * any other -- section 8's "only the game may declare a completion" as a
   * property of the surface rather than a check downstream.
   *
   * Calling it does not stop the command: the handler runs to its end and its
   * events and dirty set are reported normally. What ends is the SEASON, which
   * the platform settles once the command's changes are durable.
   */
  complete(): void;
}

/**
 * WHAT A DECLARATION CAN SEE OF THE WORLD SO FAR (#122).
 *
 * The third argument to `partitions` and the second to `world.view`, and the
 * whole of #122's authoring surface. It answers the resident root of a
 * partition, or `undefined` while that partition is still absent -- which on
 * the FIRST round is every partition, because nothing has been loaded yet.
 *
 * So a declaration in a world whose player location is state is written in two
 * steps: name the index while it is absent, and name the room it points at once
 * it is there. The platform asks again with the first round resident, which is
 * what makes the second step reachable at all.
 *
 * DELIBERATELY NOT the whole game. A declaration that could walk the tree could
 * ask a question no partition answers, and the honest answer to it would be
 * loading the world. What is reachable here is exactly what an earlier round of
 * this same declaration asked for.
 *
 * Reachable without being exported: a bundle's declaration receives one and
 * TypeScript checks it structurally, exactly as a command handler is.
 */
export interface WorldResidency {
  /** The resident root of `name`, or `undefined` while it is still absent. */
  partition(name: string): GameElement | undefined;
}

/**
 * TRANSITIONAL -- #169 REPLACES A WORLD'S COMMANDS WITH ACTIONS.
 *
 * A world's verbs are a flat command table today, which is why a world has no
 * board clicks, no accessible action panel, no enumeration and no bots: those
 * are all built over the engine's Action system, and a world does not use it.
 * #169 makes a world command an Action, and this type and everything shaped
 * around it (`WorldCommandContext`, `WorldCommandTable`, `WorldCommandOffer`,
 * `WorldCommandArgument`, and the `genesis` / `view` / `presence` signatures on
 * `WorldDefinition`) go with it.
 *
 * It is exported anyway, and marked rather than hidden, because a bundle has to
 * name the shape it exports and hand-copying it into every world game is how
 * the contract drifted in the first place. Write against it; expect it to
 * change in one pass, with every catalogue game updated at once.
 */
/** One command the world answers to. */
export interface WorldCommandHandler {
  /**
   * WHAT THIS COMMAND ASKS A PLAYER FOR (#91).
   *
   * REQUIRED, and empty is a legal answer. `partitions(args)` reads the
   * arguments and `run` reads them, and until this existed both discovered
   * what they were by looking -- so the platform could name a command and
   * could not name one thing it wanted, and the action panel's only honest
   * surface was a JSON box. A command that asks for nothing says `args: []`;
   * making that explicit is what stops "asks nothing" and "never got round to
   * declaring" from looking identical from outside.
   */
  readonly args: readonly WorldCommandArgument[];
  /**
   * Which partitions must be resident before `run`.
   *
   * Declared WITHOUT THE WORLD, because it is answered BEFORE the world is
   * loaded -- that is what absent-until-loaded means. Everything named here
   * is reported dirty whether or not `run` wrote to it.
   *
   * `seat` IS THE ACTING SEAT, or null when the clock is acting (#121). It was
   * not there until 2026-08-28, and its absence was the reason no command could
   * name "my own holding": a per-player world had to make every settler pass
   * their own land as an argument with exactly one legal answer, and then have
   * `run` refuse everybody who named somebody else's. The seat is known before
   * the child is called -- the roster is the engine's and `dispatch` already
   * resolves it -- so nothing about the lazy-hydration argument changes: this
   * is still answered with no partition loaded and no world to consult.
   *
   * A command that needs the seat and is handed null must SAY SO, by throwing.
   * `clockOnly` below is the declaration for the opposite case.
   *
   * `world` IS WHAT AN EARLIER ROUND LOADED (#122), and it is what makes a
   * command in a world whose player LOCATION is state expressible at all. The
   * platform asks this again once what it named is resident, so a MUD's `look`
   * names its wanderer index while everything is absent and, reading it, names
   * the room that player is standing in. On the first round every partition is
   * `undefined`; declare what you need to READ, and the next round can read it.
   *
   * Everything named on the LAST round is what gets loaded and reported dirty,
   * so a declaration must keep naming what it already asked for -- see the
   * worked example in `docs/persistent-worlds.md`, which is this repository's
   * authoring guide now that the contract is here (#165).
   */
  partitions(
    args: Readonly<Record<string, unknown>>,
    seat: number | null,
    world: WorldResidency,
  ): readonly string[];
  /** Mutate the resident tree and say what happened. */
  run(context: WorldCommandContext): WorldEvents;
  /** What this command does, for a surface that has to label a button. */
  readonly prompt?: string;
  /**
   * THIS COMMAND IS THE CLOCK'S, AND NO PLAYER MAY SEND IT (#120).
   *
   * A scheduled event runs a command out of THIS SAME TABLE -- that is the
   * design, and a good one: a world has one way to change rather than two. The
   * consequence, until this flag, was that a completion handler nobody should
   * ever press was enumerated to players like everything else, so every game
   * with an eager timer grew a dead button on its action panel AND a
   * hand-written refusal inside `run` to answer whoever pressed it.
   *
   * Declaring it does two things and they are deliberately both:
   * `commandOffers` leaves it out, so no surface draws it; and a player's frame
   * naming it is refused at the door, before a partition is read or a handler
   * is reached. Filtering alone would leave the rule enforceable only by the
   * client, which is not a place a rule can live.
   *
   * It says nothing about what the command may DO. Whether a due burn is legal
   * this instant stays the game's judgement, made with the holding in front of
   * it; this is only about who may issue it.
   *
   * EXACTLY TWO SITES READ THIS, AND IT MUST STAY TWO: the filter in
   * `commandOffers`, and the refusal in `handlerFor`. Neither is redundant --
   * filtering alone leaves the rule enforceable only by the client, which is
   * not a place a rule can live, and refusing alone leaves the dead button on
   * the panel. A third reader would be a third opinion about what "the clock's
   * own" means.
   *
   * TRANSITIONAL, and likely to be RENAMED rather than deleted (#169). Under
   * Actions the same fact is "this verb has no acting seat", which is what
   * `seatless` says and what `clockOnly` only implies -- the flag is about who
   * may issue it, and "the clock" is one answer to that rather than the
   * question. Both sites move together whichever name wins.
   */
  readonly clockOnly?: boolean;
}

/** The world's whole command surface, by name. */
export type WorldCommandTable = Readonly<Record<string, WorldCommandHandler>>;

/**
 * WHICH PARTITIONS ONE SEAT'S VIEW IS ABOUT (#95).
 *
 * The read path's counterpart to `WorldCommandHandler.partitions`, and it is
 * required of a world bundle for the same reason `args` is required of a
 * command: a game that never declared one and a game that declared nothing
 * must not look the same from outside. `() => []` is the whole of the second.
 *
 * Reachable without being exported: a bundle writes one into its `world` block
 * and TypeScript checks it structurally, exactly as a command handler is.
 */
export type WorldViewDeclaration = (
  seat: number,
  world: WorldResidency,
) => readonly string[];

export interface BoardSmithWorldEngineOptions {
  /**
   * The resident game, ALREADY in world mode and with its element classes
   * registered. Its tree may be empty: every partition is adopted from the
   * store, so a Durable Object waking with nothing but a root is the normal
   * case rather than a special one.
   */
  readonly game: Game;
  /**
   * Which seat each player id the platform will name plays, AS THE WORLD IS
   * BUILT. A persistent world's roster is not fixed at construction -- players
   * join a season that is already running -- so `seat` below adds to it.
   */
  readonly seats: ReadonlyMap<string, number>;
  /** Where partitions are read from, and told when this engine lets one go. */
  readonly store: WorldPartitionSource;
  /** What the world answers to. */
  readonly commands: WorldCommandTable;
  /**
   * WHAT ONE SEAT'S VIEW IS ABOUT (#95).
   *
   * The bundle's own declaration, taken by SEAT because that is what the world
   * holds a player as -- a seat is where a player's holdings are. It is
   * answered before anything is loaded, so it may read the seat and nothing
   * else; a declaration that had to consult the world would be a declaration
   * that could not be made in the state it exists to fix.
   */
  readonly view: WorldViewDeclaration;
  /**
   * THE CEILINGS THIS HOST RUNS THE WORLD AGAINST.
   *
   * `ctx.schedule()` refuses against these INSIDE the handler, where the
   * command then unwinds and the world is left unchanged -- so a host whose own
   * queue enforced different numbers would let a command run to completion
   * believing timers it will not get. Both sides count with the same object,
   * which is what makes that impossible rather than merely unlikely.
   *
   * Left out, a world runs the library's defaults.
   */
  readonly budgets?: WorldBudgets;
}

export class BoardSmithWorldEngine implements WorldEngine {
  private readonly budgets: WorldBudgets;
  private readonly game: Game;
  /** MUTABLE, and that is the point: see `seat`. */
  private readonly seats: Map<string, number>;
  private readonly store: WorldPartitionSource;
  private readonly commands: WorldCommandTable;
  /** What a seat's view is about, from the bundle (#95). */
  private readonly view: WorldViewDeclaration;

  /** Partition name to the id of its resident root. */
  private readonly residentIds = new Map<string, number>();
  /** The same mapping backwards, for reading the taken touch set. */
  private readonly residentNames = new Map<number, string>();
  /** Partition name to the value `useClock` held when a command last NAMED it. */
  private readonly lastUsed = new Map<string, number>();
  /**
   * A monotonic counter, raised once per command.
   *
   * Not a clock, deliberately: two commands in the same millisecond must still
   * be ordered -- the same reason `ScheduledEvent.seq` exists -- so a world's
   * eviction order is a function of its own history rather than of how fast the
   * machine was running.
   */
  private useClock = 0;

  constructor(options: BoardSmithWorldEngineOptions) {
    if (!options.game.worldMode) {
      throw worldRefusal(
        "engine-not-world-mode",
        "BoardSmithWorldEngine needs a game in world mode: construct it with " +
          "`new GameClass({ ..., worldMode: true })`. In snapshot mode an element reference serializes " +
          "as a positional branch path, which resolves to the WRONG element once a partition " +
          "is not resident.",
      );
    }
    this.game = options.game;
    this.seats = new Map(options.seats);
    this.store = options.store;
    this.commands = options.commands;
    this.view = options.view;
    this.budgets = options.budgets ?? worldBudgets();
    // AT CONSTRUCTION, NOT AT THE FIRST OFFER. A bundle whose declaration is
    // wrong is wrong for every player who will ever attach, so it is refused
    // once, before the world is built, rather than on whichever player first
    // asked what they could do here.
    for (const [name, handler] of Object.entries(this.commands)) {
      checkDeclaredArgs(name, handler.args);
    }
  }

  /**
   * Record a partition this engine did NOT adopt from the store.
   *
   * GENESIS is the only caller, and the case is real rather than theoretical:
   * the bundle's `genesis` hook CREATES its partitions in the live game, so
   * they are already in the tree when the world's first command runs. Without
   * this the engine would try to adopt them from the store and the engine
   * refuses -- "a partition may only be adopted once" -- which is exactly the
   * failure the end-to-end test found.
   *
   * Deliberately NOT part of `ensureResident`: adoption and creation are
   * different events, and a single path that silently accepted either would
   * make "was this partition loaded, or invented?" unanswerable at the moment
   * a checkpoint needs to know where its parent is.
   *
   * IT DECLARES THE PARTITION ROOT TO THE GAME (#294). `adoptSubtree` does that
   * for a partition read out of the store; a partition the genesis hook BUILT
   * reaches the tree by `game.create`, which the game has no reason to think is
   * special. The touch set reads the declared roots, so on a world's
   * first instance -- the one that ran genesis, and every hour it lives before
   * anything evicts it -- the engine's half of the dirty set was structurally
   * EMPTY: a token moved out of a declared room into an undeclared one reported
   * only the source dirty, the source checkpointed without the token, the
   * destination never checkpointed at all, and the token was gone at the next
   * wake with nothing raised anywhere.
   */
  registerResident(name: string, root: GameElement): void {
    this.game.definePartition(root.id);
    this.residentIds.set(name, root.id);
    this.residentNames.set(root.id, name);
  }

  /**
   * WHAT A DECLARATION MAY READ, and nothing else (#122).
   *
   * Built fresh on every declaration rather than held as a field, because it
   * closes over `this` and holding one would invite a bundle to keep it: a
   * declaration is answered for one command at one instant, and an accessor
   * that outlived that would let game code reach a tree the platform has since
   * evicted.
   */
  private residentWorld(): WorldResidency {
    return {
      partition: (name) => {
        const id = this.residentIds.get(name);
        if (id === undefined) return undefined;
        const root = this.game.getElementById(id);
        // READ-ONLY, AND NOT BY PROMISE (#219). The accessor used to hand over
        // the live element, so the paragraph above was the only thing stopping
        // a declaration writing -- and a declare-time write lands outside both
        // protections the handler surface has. `world-readonly.ts` carries the
        // whole argument.
        return root === undefined ? undefined : readOnlyProjection(root);
      },
    };
  }

  async hydrate(names: readonly string[]): Promise<void> {
    // ADOPTION, AND ONLY ADOPTION. Nothing is run and nothing is written; what
    // changes is what is LOADED, which is the one thing a second round of
    // declaration needs to be different from the first (#122).
    for (const name of names) await this.ensureResident(name);
  }

  async applyCommand(
    player: string,
    command: WorldCommand,
    stamp: WorldCommandStamp,
  ): Promise<WorldCommandResult> {
    // The acting player is the schedule OWNER: their events are charged to
    // their budget, and a bundle cannot charge them to somebody else because
    // it never gets to name one.
    return this.dispatch(command, this.seatFor(player), null, {
      now: stamp.now,
      owner: player,
      allowance: stamp.allowance,
      presence: stamp.presence,
    });
  }

  async onEvent(
    event: WorldCommand,
    timing: { readonly due: number; readonly missedCount: number },
    stamp: WorldEventStamp,
  ): Promise<WorldCommandResult> {
    // The SAME dispatch a player command takes. A scheduled event is a command
    // the clock issued rather than a seat, so giving it a second machinery
    // would give a world two ways to change and two sets of bugs.
    //
    // ITS `now` IS ITS `due`, never the wall clock at execution: a world that
    // drained late must produce the state a punctual one would, which is the
    // same rule `timing.due` already carries one field over.
    //
    // ITS SCHEDULES ARE CHARGED TO THE WORLD, under a reserved owner. A due
    // event has no acting player, and an unowned event would be uncapped -- a
    // recurring handler that re-armed itself without a key is precisely the
    // shape that would then grow a queue forever with nobody to refuse.
    return this.dispatch(event, null, timing, {
      now: timing.due,
      owner: WORLD_OWNER,
      allowance: stamp.allowance,
      presence: stamp.presence,
    });
  }

  commandOffers(): readonly WorldCommandOffer[] {
    // From the TABLE and not from the tree: asking what a world answers to
    // must not load a partition, or "what can I do here?" would cost what
    // acting costs. The ARGUMENTS come from the same place for the same
    // reason -- a choice's options are what the bundle can state about itself,
    // never what the world happens to hold this instant (#91).
    return Object.keys(this.commands)
      .sort()
      // THE CLOCK'S OWN COMMANDS ARE NOT OFFERED (#120). They are in the table
      // -- a scheduled event reaches them through it -- and they are not
      // actions a player has, so a surface that drew one would be drawing a
      // button whose every press is refused.
      .filter((name) => this.commands[name]!.clockOnly !== true)
      .map((name) => {
        const handler = this.commands[name]!;
        return handler.prompt === undefined
          ? { name, args: handler.args }
          : { name, prompt: handler.prompt, args: handler.args };
      });
  }

  /**
   * WHICH PARTITIONS THIS COMMAND IS ABOUT, BEFORE IT RUNS (#121).
   *
   * The write path's counterpart to `viewPartitions(player)`, and it is on the
   * engine for the same reason that one is: the ROSTER is the engine's, so the
   * seat a command acts from can only be resolved here. `world-runner.ts` used
   * to reach into the command table itself and call `partitions(args)` -- which
   * is exactly why a command could not name the acting player's own partition,
   * because the one caller that could have supplied a seat did not have one.
   *
   * `player` is null for a scheduled event, which reaches `partitions` as a
   * null seat.
   *
   * IT LOADS NOTHING and applies nothing. The declaration is the bundle's own,
   * answerable while every partition is still absent -- that is the whole of
   * declare-then-apply.
   */
  commandPartitions(player: string | null, command: WorldCommand): readonly string[] {
    const seat = player === null ? null : this.seatFor(player);
    return this.declaredFor(command, seat);
  }

  /**
   * WHAT A COMMAND NAMES, EACH PARTITION ONCE (#263).
   *
   * Read here rather than at the two call sites -- `commandPartitions` on the
   * parent's behalf and `dispatch` when the command actually runs -- because
   * the whole of "everything the declaration named is resident" rests on those
   * two asking the same question and getting the same answer.
   *
   * A DECLARATION MAY NAME ONE PARTITION TWICE, and that is an author writing
   * ordinary code rather than an author making a mistake: `partitions: (args,
   * seat) => [ownHolding(seat), args.neighbour]` names one partition whenever a
   * settler aims at their own land. Nothing downstream is written for a repeat
   * -- `ensureResident` returns early on the second, so the write path looked
   * fine -- but the ROLLBACK snapshots this list verbatim, and since #189 every
   * declared root comes out before any goes back in, so the second restore met
   * the first one's element ids and `adoptSubtree` refused. The game's own
   * refusal was replaced by a platform error about ids, which is precisely the
   * thing the author cannot act on. It also costs a duplicate: the parent reads
   * every name this answers out of storage and ships it to the child.
   *
   * THE THIRD ARGUMENT IS WHAT AN EARLIER ROUND LOADED (#122). It is empty on
   * the first round of a cold world, which is the state this declaration was
   * always answered in; what is new is that there IS a later round.
   */
  private declaredFor(command: WorldCommand, seat: number | null): readonly string[] {
    // READ-ONLY, AND THE ENGINE IS TOLD SO (#295). `residentWorld()` hands out
    // projections that refuse every write (#219), so nothing a declaration
    // touches can end up dirty -- and the engine's dirty-set comparison now
    // runs only over what a command REACHED. Left unsaid, a declaration that
    // walked the world would put every partition it looked at into the next
    // command's comparison, which is the O(resident) cost this removed; and
    // the mark itself would be refused by the very projection that makes the
    // read safe.
    return declaredOnce(
      this.game.readingOnly(() =>
        this.handlerFor(command.name, seat).partitions(
          command.args,
          seat,
          this.residentWorld(),
        ),
      ),
    );
  }

  /**
   * The handler for this command, and WHETHER THIS CALLER MAY HAVE IT.
   *
   * Both refusals live here rather than at each of the two call sites --
   * `commandPartitions` and `dispatch` -- because the declaration path and the
   * apply path are separate calls across a boundary, and a rule enforced in
   * only one of them is a rule a caller can step around by skipping a call.
   */
  private handlerFor(name: string, seat: number | null): WorldCommandHandler {
    const handler = this.commands[name];
    if (!handler) {
      const known = Object.keys(this.commands);
      throw worldRefusal(
        "unknown-command",
        `This world has no command named "${name}". It answers to: ` +
          `${known.length > 0 ? known.join(", ") : "no commands at all"}.`,
      );
    }
    // A PLAYER MAY NOT ISSUE THE CLOCK'S COMMAND (#120). `seat === null` is the
    // clock, and it is the only caller this command has.
    if (handler.clockOnly === true && seat !== null) {
      throw worldRefusal(
        "clock-only-command",
        `"${name}" is this world's own clock at work, not an action you take. It runs when the ` +
          "event that was scheduled for it comes due, whether or not anybody is here to watch " +
          "it, and no player may issue it.",
      );
    }
    return handler;
  }

  viewPartitions(player: string): readonly string[] {
    // FROM THE BUNDLE, and from what an earlier round of this same declaration
    // has already loaded (#122). A look is still answered before the world is
    // there -- the first round sees an empty residency -- but a view whose
    // subject is decided by state can now name the index, read it, and name the
    // room. `look` is the case that motivated the whole mechanism.
    return this.viewDeclaredFor(this.seatFor(player));
  }

  /**
   * What one seat's view is about, EACH PARTITION ONCE (#263).
   *
   * The read path's half of `declaredFor`, and deduplicated for the same
   * reason: a `view` that names the room a player is in and the room they can
   * see into names one partition when those are the same room, and the parent
   * would otherwise read and ship it twice for one look.
   */
  private viewDeclaredFor(seat: number): readonly string[] {
    // Read-only for the same reason `declaredFor` is, and told so for the same
    // reason (#295): a view decides what to LOAD and may not write.
    return declaredOnce(this.game.readingOnly(() => this.view(seat, this.residentWorld())));
  }

  async viewFor(player: string): Promise<unknown> {
    const seat = this.seatFor(player);
    // WHAT THIS SEAT'S VIEW IS ABOUT, MADE RESIDENT (#95). The platform has
    // already put the bytes in the store -- it asked `viewPartitions` and read
    // them -- so this is an adoption from memory and never a fetch. Before it,
    // a woken world projected the root alone and a settler who had only looked
    // saw an empty world for as long as they refrained from acting.
    const named = this.viewDeclaredFor(seat);
    for (const name of named) await this.ensureResident(name);

    // NAMED IS NAMED, whoever named it. `residency` orders eviction by when a
    // partition was last NAMED, reads included -- and a room a dozen people are
    // watching is the last room a world should drop.
    this.useClock += 1;
    for (const name of named) this.lastUsed.set(name, this.useClock);

    // Computed from the live objects on demand. The fog of war is
    // `toJSONForPlayer`'s, already written and tested in the engine, and the
    // cost is what this seat can see rather than what the world contains.
    //
    // AND IT IS STATE, NOT A TURN (#126). This used to be
    // `createPlayerView(game, seat)`, the projection a TABLE sends -- and that
    // one calls `getDisabledActions` -> `getAvailableActions`, which evaluates
    // EVERY action the bundle registered for the table, selection choices and
    // all, to decide which are open right now.
    //
    // A world may not pay that and may not survive it. A table action is
    // written for a table, where the whole board is there; a resident world
    // holds only the partitions its declaration named (#95, #122), so a
    // perfectly correct table action that offers "the rooms you can walk to"
    // reaches for a partition that is deliberately absent and throws the game's
    // own refusal. The MUD example did exactly that, and the failure looked like a
    // wake bug because the instance that ran `world.genesis` holds every
    // partition: the view was right once and threw on every view afterwards.
    //
    // A WORLD'S VERBS ARE ITS COMMANDS, offered by `commandOffers()` from the
    // bundle's own table and never from the tree, for the same reason. Its flow
    // does not run -- `definition.ts:createWorld` never starts one -- so there is
    // no turn to report, and the three things below are the whole of what a
    // world has to say to one seat.
    //
    // AND NO MESSAGES (#163). The game root's message log lives outside every
    // partition, so a checkpoint never persisted it: a `messages` surface here
    // was unbounded while the isolate lived, O(history) in every view, and
    // silently empty after every wake -- "messages since the last hibernation"
    // wearing the face of "all messages". A world's narration is its EVENTS,
    // routed per command to the seats that can see the scope; there is no
    // second, lying channel beside them.
    // AND SCOPED TO WHAT THE DECLARATION NAMED (#183). `toJSONForPlayer`
    // serializes the whole resident tree, and residency is everybody's doing:
    // every partition anybody recently commanded or looked at is still
    // resident, so a view built from the raw projection grew with the world's
    // POPULARITY -- 260 KB per view for example-rts at 500 seats with the
    // village resident, against the two partitions seat's declaration actually
    // names (measured 2026-08-31). The
    // interface has always said the named set "is the whole of what this
    // method is allowed to look at"; pruning the unnamed resident partitions
    // makes the view's content a function of the DECLARATION rather than of
    // what other players happened to leave loaded -- the same tree a fresh
    // instance with only the named partitions resident would project. The fog
    // of war stays `toJSONForPlayer`'s: pruning only ever REMOVES subtrees,
    // after the engine's own redaction has run.
    const state = this.game.toJSONForPlayer(seat);
    const namedNames = new Set(named);
    const unnamedIds = new Set<number>();
    const namedIds = new Set<number>();
    for (const [name, id] of this.residentIds) {
      (namedNames.has(name) ? namedIds : unnamedIds).add(id);
    }
    return {
      player: seat,
      state: pruneUnnamedPartitions(state, unnamedIds, namedIds),
      phase: this.game.phase,
    };
  }

  // (pruneUnnamedPartitions, the module-scope helper `viewFor` ends with, is
  // defined at the bottom of this file.)

  async serializePartitions(
    dirty: readonly string[],
  ): Promise<Record<string, string>> {
    // `GameElement.toJSON()` already recurses over exactly one subtree, so a
    // partition IS an element and a checkpoint costs what moved. No new engine
    // primitive was needed for this.
    // NULL PROTOTYPE, because the KEYS ARE THE BUNDLE'S (#190). A partition
    // named `__proto__` assigned into a plain `{}` goes through the inherited
    // setter and stores nothing: the partition would drop out of every
    // checkpoint and revert on the next wake, silently. The store refuses that
    // name at the door as well; this side does not depend on it having.
    const written: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const name of dirty) {
      written[name] = JSON.stringify(this.rootOf(name).toJSON());
    }
    return written;
  }

  residency(): readonly { readonly name: string; readonly lastUsed: number }[] {
    return [...this.residentIds.keys()].map((name) => ({
      name,
      // A partition adopted but never since named still has an order: 0 makes
      // it the coldest thing in the world, which is exactly what it is.
      lastUsed: this.lastUsed.get(name) ?? 0,
    }));
  }

  evict(names: readonly string[]): void {
    for (const name of names) {
      const id = this.residentIds.get(name);
      // Silent on a name this engine does not hold -- see the interface.
      if (id === undefined) continue;
      // THE TREE FIRST, then the bookkeeping. `evictSubtree` is what actually
      // frees the memory; forgetting the ids without it would leave the subtree
      // in the game and make the partition unreachable AND still resident,
      // which is the worst of both.
      this.game.evictSubtree(id);
      this.residentIds.delete(name);
      this.residentNames.delete(id);
      this.lastUsed.delete(name);
      // BOTH SIDES FORGET. The source stops claiming it can answer for the
      // name, so the next `declare` asks the parent for it again -- see
      // `WorldPartitionSource`.
      this.store.forget(name);
    }
  }

  private async dispatch(
    command: WorldCommand,
    seat: number | null,
    timing: WorldCommandContext["timing"],
    charge: {
      now: number;
      owner: string;
      allowance: ScheduleAllowance;
      presence: readonly number[];
    },
  ): Promise<WorldCommandResult> {
    const handler = this.handlerFor(command.name, seat);

    // THE SAME SEAT THE DECLARATION SAW (#121). `commandPartitions` answered
    // this a moment ago on the parent's behalf, from the same table with the
    // same seat, which is what makes "everything named here is loaded" true.
    const named = this.declaredFor(command, seat);
    for (const name of named) await this.ensureResident(name);

    // Raised once per command and stamped on everything this one NAMED, so two
    // partitions named by the same command are equally warm and the tiebreak
    // falls to `planEviction`'s by-name ordering rather than to argument order.
    this.useClock += 1;
    for (const name of named) this.lastUsed.set(name, this.useClock);

    // THE MESSAGE LOG IS CLEARED HERE (#163). Nothing platform-side reads
    // it -- `viewFor` deliberately ships no messages -- so a `game.message()`
    // a handler emits is a write into resident memory nobody will ever see,
    // and left alone it grows for the life of the isolate. Clearing at each
    // dispatch bounds the log at one command's worth on both the success and
    // the rollback path.
    //
    // THE TOUCHED SET USED TO BE CLEARED ALONGSIDE IT, and is not any more
    // (#316). `clearTouchedPartitions()` right here serialized every resident
    // partition to re-baseline -- a whole pass over the resident world before
    // this command had done anything. Both exits below TAKE the set instead,
    // which reports and re-baselines in the one pass, so what the next command
    // sees still belongs to the next command and nothing pays twice.
    this.game.pruneMessages({ keepLast: 0 });

    // Per command, and declared here rather than as a field so it cannot leak
    // into the next one. A leaked ending would settle the season again on the
    // following move, at a later `endedAt` -- so it is not a replay the settle
    // identity absorbs (#106), and since #339 it is not a second season either:
    // `convex/seasons.ts:settleSeason` REFUSES an ending that differs from the
    // one the campaign already has, so the world's bounded retries end in
    // `markSeasonSettleFailed` and an operator is left to explain a settle that
    // never landed.
    let completed = false;

    // WHAT THIS COMMAND ASKED THE PLATFORM TO WAKE FOR (#56). Declared per
    // command rather than as a field for the same reason `completed` is: a
    // request that leaked into the next command would arm a timer nobody asked
    // for, charged to whoever acted next.
    const schedules: ScheduleRequest[] = [];
    // Requests are not durable until the parent writes them, so the caps have
    // to count this command's own as it goes -- otherwise a handler could ask
    // for a cap's worth twice in one command and the parent would refuse the
    // batch after the command had already changed the world. The budget does
    // that counting, so this side and the parent cannot count differently.
    const budget = scheduleBudget(charge.owner, charge.allowance, this.budgets);

    // WHAT THE WORLD LOOKS LIKE BEFORE THIS COMMAND (#68, #294).
    const before = this.snapshotResident();

    // TAKEN AT MOST ONCE, WHICHEVER WAY THIS DISPATCH ENDS (#316).
    //
    // The take is what re-baselines, so it is not a read that can be repeated:
    // a second one over the same command reports an EMPTY set, because the
    // first has already absorbed every mark and every content change into the
    // baseline. Both exits need the answer -- the success path to build the
    // dirty set, the rollback to know what to put back -- and until this was
    // memoised the rollback's own take came up empty and left a partition the
    // handler had minted resident, dirty and nameless, so the NEXT command
    // refused on it.
    let taken: ReadonlySet<number> | null = null;
    const touchedOnce = (): ReadonlySet<number> => {
      taken ??= this.game.takeTouchedPartitions();
      return taken;
    };

    // EVERYTHING BETWEEN THE SNAPSHOT AND THE RETURN IS UNDER THE ROLLBACK
    // (#68, #151). The catch used to wrap `handler.run` alone, and the two
    // refusals thrown after it -- dirty-set resolution and event routing --
    // landed on a tree the handler had already successfully mutated. `refused`
    // then meant "mutated, and durably so once anything else checkpointed the
    // same partition". The only way out of this block without the rollback is
    // the successful return at its end.
    try {
      const events = handler.run({
        args: command.args,
        seat,
        now: charge.now,
        timing,
        // A SET, built per dispatch from the platform's stamp, so a handler
        // asks membership rather than scanning -- and so nothing a handler
        // does to it can outlive this command (#144).
        presence: new Set(charge.presence),
        complete: () => {
          completed = true;
        },
        schedule: (request: ScheduleRequest) => {
          // REFUSED AT THE OFFENDING LINE. The parent is still the authority
          // and re-plans everything below before it writes a single event; this
          // is what makes the refusal land inside the handler, so the command
          // unwinds and `refused` means the world is unchanged.
          const refusal = budget.admit(request);
          if (refusal !== null) throw refusal;
          schedules.push(request);
        },
        partition: (name: string) => {
          assertDeclared(command.name, name, named);
          const root = this.rootOf(name);
          // THE ONE DOOR THE ENGINE CANNOT SEE (#295). The dirty-set
          // comparison runs only over the partitions a command could have
          // written, and BoardSmith knows that set because it marks every
          // element its own queries and tree accessors hand out. This root did
          // not come from one of those -- the platform looked it up -- and
          // `room.visits += 1` on it touches no accessor at all, so without
          // this line the comparison would skip exactly the partition the
          // command was about. `Game#reachPartition` is deliberately separate
          // from `partitionRoot` so the platform's OWN reads below --
          // `serializePartitions`, `audienceOf`, both after the command has
          // finished -- do not enlarge the next command's comparison.
          this.game.reachPartition(root.id);
          return root;
        },
      });

      // TAKEN, not read: one pass both reports what changed and re-baselines
      // for the next command (#316) -- and since #295 that pass runs over the
      // partitions this command REACHED rather than over the resident set, so
      // what it costs is the room.
      const dirty = new Set<string>(named);
      for (const id of touchedOnce()) {
        const name = this.residentNames.get(id);
        if (name === undefined) {
          throw worldRefusal(
            "partition-not-resident",
            `Command "${command.name}" moved something into or out of partition root ${id}, which ` +
              `this engine never loaded and cannot name. Every partition must reach the tree through ` +
              `the partition store, or its changes cannot be checkpointed.`,
          );
        }
        dirty.add(name);
      }

      return {
        // ROUTED HERE AND NOWHERE ELSE (#58). The handler said where; this is
        // the engine saying who, once per event, while the world it is a fact
        // about is still in front of us. A parent that had to ask would be a
        // second round trip per command into a child that has the answer
        // already.
        events: events.map((event) => ({
          ...event,
          seats: this.audienceOf(command.name, event.scope),
        })),
        dirty: [...dirty],
        schedules,
        ...(completed ? { ending: "completed" as const } : {}),
      };
    } catch (error) {
      // A REFUSED COMMAND LEAVES THE WORLD UNCHANGED, or the word is worthless
      // (#68). The platform EXPECTS handlers to throw -- it quarantines them --
      // and until this the throw simply propagated: a handler that debited gold
      // and failed before crediting the unit sent the player `refused`, which
      // means "nothing changed" to any client, over a tree that had lost the
      // gold. The same word is owed for a refusal thrown AFTER a handler
      // succeeded -- an unroutable event scope, a touch on a partition root
      // this engine cannot name (#151) -- so the rollback covers those too.
      this.rollback(before, named, touchedOnce());
      throw error;
    }
  }

  /**
   * WHO CAN SEE WHAT HAPPENS IN THIS SCOPE (#58).
   *
   * Two rules, and there is deliberately no third:
   *
   *   `WORLD_SCOPE` is EVERY SEAT. The one address the platform reserves.
   *   Anything else NAMES A PARTITION, and its audience is the seats that can
   *     see that partition -- its effective owner alone when it has one, and
   *     otherwise every seat the element is visible to. Both are BoardSmith's
   *     own primitives (`getEffectiveOwner`, `isVisibleTo`) rather than a
   *     second notion of visibility invented here, so a room hidden from a
   *     player in the tree is a room they are not told about either.
   *
   * A SCOPE THAT NAMES NOTHING IS A REFUSAL, not an event delivered to nobody.
   * The silent version is invisible: the game author sees an event that never
   * arrives, and cannot tell that from nobody having been watching.
   *
   * The whole roster is walked, which is O(seats) of a cheap predicate per
   * event -- against the O(seats) of SERIALIZED FRAMES this replaces. The
   * expensive half is the sending, and that is now the size of the audience.
   */
  private audienceOf(commandName: string, scope: string): readonly number[] {
    const all = [...this.seats.values()];
    if (scope === WORLD_SCOPE) return all;

    if (!this.residentIds.has(scope)) {
      throw worldRefusal(
        "unknown-scope",
        `Command "${commandName}" addressed an event to scope "${scope}", which is neither the ` +
          `reserved "${WORLD_SCOPE}" scope nor a partition this world has loaded. An event's scope ` +
          `is how the platform decides who is told about it, so one nobody can be in would be ` +
          `delivered to nobody at all -- silently. Name a partition the command declared, or ` +
          `"${WORLD_SCOPE}" if everybody should hear it.`,
      );
    }

    const root = this.rootOf(scope);
    const owner = root.getEffectiveOwner();
    if (owner !== undefined) return all.filter((seat) => seat === owner.seat);
    return all.filter((seat) => root.isVisibleTo(seat));
  }

  /**
   * EVERY RESIDENT PARTITION AS IT STANDS BEFORE THIS COMMAND RUNS (#68, #294).
   *
   * NOT the forbidden per-action snapshot. `world-engine.ts` prohibits
   * `createSnapshot(game)`, which is the whole WORLD -- history, flow, players,
   * every partition in storage -- and is the cost this mode exists to delete.
   * This is the RESIDENT set, which is what the world is paying for in memory
   * already and what `WORLD_MAX_RESIDENT_PARTITIONS` bounds.
   *
   * IT COVERS WHAT THE COMMAND DID NOT DECLARE, and that is the whole point of
   * the change (#294). It used to snapshot the declaration alone, and a handler
   * is expressly allowed to reach further: a cross-partition move travels on an
   * element reference a declared partition is holding, and the engine reports
   * the reached partition dirty on success. On a throw there was nothing to
   * restore that partition from, so it was RELEASED -- discarding every
   * un-checkpointed change to it, including changes an earlier, successful
   * command in the same drain batch had made, and leaving the parent asking a
   * child that no longer held it to serialize it at the batch checkpoint.
   *
   * The declaration cannot bound this. A handler reaches an undeclared
   * partition through a query over the live tree, so the set it could touch IS
   * the resident set; a snapshot of anything smaller has a hole in it exactly
   * where the bug was.
   *
   * WHAT IT COSTS: NOTHING, and that is the point of #316. It used to serialize
   * every resident partition here, on the reasoning that the engine already
   * made two such passes per command so a third was not a new order of cost.
   * The reasoning was wrong twice over. Three whole-residency serializations
   * are three times one, and one was already the whole cost -- measured on the
   * platform's own instrument, a command at 500 resident partitions took 19 ms
   * against the 5 ms `WORLD_EVENT_HANDLER_BUDGET_MS` that
   * `WORLD_DRAIN_BATCH` is derived from.
   *
   * The bytes were never new. BoardSmith holds one serialized copy of every
   * resident partition already -- the baseline its dirty-set comparison is
   * against -- captured at the end of the previous command, which is exactly
   * "before this one". `Game#partitionBaseline` hands those over, so the
   * rollback copy is a map lookup per resident partition and the engine's
   * single remaining pass is the only serialization a command pays for.
   *
   * SERIALIZED RATHER THAN HELD, and still deliberately. `toJSON()` may hand
   * back structures that share array and object identity with live attribute
   * values, and a handler mutating through one of those would corrupt the very
   * copy the rollback restores from. The baselines are strings, so the bytes
   * cannot be mutated by anything.
   *
   * STILL WHOLE, AND STILL CURRENT, AFTER #295. The engine now compares only
   * the partitions a command REACHED, so a partition's baseline can be older
   * than the last command -- it is from the last command that could have
   * written it. That is exactly what "before this command" means for a
   * partition nothing has touched since: unreached is unwritten, so the bytes
   * on file are the bytes in the tree. Taking the copy over the whole resident
   * set therefore stays both correct and free, which is why it is not scoped
   * as well.
   */
  private snapshotResident(): ReadonlyMap<
    string,
    { readonly id: number; readonly parentId: number; readonly bytes: string }
  > {
    const before = new Map<
      string,
      { readonly id: number; readonly parentId: number; readonly bytes: string }
    >();
    for (const [name, id] of this.residentIds) {
      const point = this.game.partitionBaseline(id);
      if (!point) {
        throw worldRefusal(
          "partition-vanished",
          `Partition "${name}" is in this engine's residency but the engine holds no restorable ` +
            `copy of it -- it is no longer a partition root, or it hangs from nothing, so there is ` +
            `no attachment point to restore it to if this command fails.`,
        );
      }
      before.set(name, { id, parentId: point.parentId, bytes: point.bytes });
    }
    return before;
  }

  /**
   * Put back every partition this command changed -- the ones it declared and
   * the ones it merely reached.
   *
   * A COLLATERAL PARTITION IS RESTORED, NOT DROPPED (#294). It used to be
   * released, on the reasoning that there was no snapshot of a partition the
   * command never named and the next command would re-read it from the last
   * checkpoint. Both halves of that were wrong. What was released was not only
   * the failing handler's work: an EARLIER, SUCCESSFUL command in the same
   * batch may have written the same partition, and a refusal is not entitled to
   * discard somebody else's committed change. And the parent was never told: it
   * still held that name in the batch's dirty set, so the batch checkpoint
   * asked the child to serialize a partition the child had let go, which
   * refuses as `partition-not-resident` -- a PLATFORM-owned code. Nothing in
   * the batch then became durable, not even the dead letter that would have
   * converged the quarantine, and Cloudflare redelivered the identical batch on
   * every alarm, forever, with no ending reported and no park rung climbed.
   *
   * THE ORDER IS LOAD-BEARING. Every root comes out of the tree before any goes
   * back in (#189): a re-adopted subtree carries the ids it had, and a handler
   * that moved an element between two partitions leaves that element's id
   * inside the other one -- so restoring a partition at a time re-adopted old
   * room:1 while its token was still live inside a not-yet-restored room:2, and
   * `adoptSubtree` refused the clash from INSIDE the rollback. The game's own
   * refusal was then replaced by an id clash, the first partition was left
   * evicted but still mapped, and the next read of it raised
   * `partition-vanished`, which parks the world.
   */
  private rollback(
    before: ReadonlyMap<
      string,
      { readonly id: number; readonly parentId: number; readonly bytes: string }
    >,
    declared: readonly string[],
    touched: ReadonlySet<number>,
  ): void {
    const changed = new Set<string>(declared);
    for (const id of touched) {
      const name = this.residentNames.get(id);
      if (name !== undefined) {
        changed.add(name);
        continue;
      }
      // A TOUCHED ROOT THIS ENGINE CANNOT NAME (#151): the handler minted a
      // partition of its own -- `definePartition` mid-command -- and moved
      // something into it. It never came through the store, so there is no
      // name to evict by and no checkpoint to read back; releasing the subtree
      // directly is what frees the ids the restore below needs.
      if (this.game.getElementById(id)) this.game.evictSubtree(id);
    }

    // Read off the SNAPSHOT rather than off `changed`, so every name below is
    // one this rollback holds bytes for -- and so a declaration that named one
    // partition twice (#263) is one entry here rather than two snapshots of the
    // same subtree, the second of which used to meet the first one's ids.
    const restoring = [...before]
      .filter(([name]) => changed.has(name))
      .map(([name, point]) => ({
        name,
        parentId: point.parentId,
        id: point.id,
        json: JSON.parse(point.bytes) as ElementJSON,
      }));

    for (const point of restoring) {
      this.game.evictSubtree(point.id);
      this.residentIds.delete(point.name);
      this.residentNames.delete(point.id);
    }

    // EVERY ID THE RESTORE CLAIMS MUST BE FREE BEFORE ANY OF IT GOES BACK IN
    // (#294). Evicting the roots frees the ids that are still inside them, and
    // an element the handler moved BETWEEN two restoring partitions is covered
    // by that -- but an element it took out of every partition is not.
    // `token.remove()` parks it in the game's PILE, which is not a partition,
    // is therefore not touched, not named and not evicted above, and is
    // nonetheless where `adoptSubtree` looks for a clash. The stray copy is
    // released here, because the bytes about to be grafted are the authority on
    // what that element is and where it belongs.
    for (const point of restoring) {
      for (const id of idsIn(point.json)) {
        if (this.game.getElementById(id)) this.game.evictSubtree(id);
      }
    }

    for (const point of restoring) {
      const root = this.game.adoptSubtree(point.parentId, point.json);
      this.residentIds.set(point.name, root.id);
      this.residentNames.set(root.id, point.name);
    }
  }

  private async ensureResident(name: string): Promise<void> {
    if (this.residentIds.has(name)) return;

    const stored = await this.store.read(name);
    if (!stored) {
      throw worldRefusal(
        "partition-missing",
        `This world has no partition named "${name}" in its store, so the command that needs it ` +
          `cannot run. Check the name, or write the partition before a command names it.`,
      );
    }

    // WHERE THE PLATFORM'S OPAQUE BYTES BECOME THIS ENGINE'S AGAIN (#218).
    // `StoredPartition.json` is `unknown` across the seam because nothing
    // between here and storage may read inside it -- the store round-trips it
    // through JSON and the parent ships it to the child, neither knowing what
    // an element is. This engine does: what it is handed is what its own
    // `serializePartitions` wrote, and `adoptSubtree` is the reader.
    const root = this.game.adoptSubtree(stored.parentId, stored.json as ElementJSON);
    this.residentIds.set(name, root.id);
    this.residentNames.set(root.id, name);
  }

  private rootOf(name: string): GameElement {
    const id = this.residentIds.get(name);
    if (id === undefined) {
      throw worldRefusal(
        "partition-not-resident",
        `Partition "${name}" is not resident, so there is nothing to read from it. A partition ` +
          `becomes resident when a command declares it in partitions().`,
      );
    }
    // ASKED OF THE ROOT TABLE, NOT OF THE TREE (#316). `getElementById` is a
    // depth-first walk of the whole resident world, so a caller that looks one
    // root up per resident partition paid O(resident) per lookup -- and every
    // per-command pass over the residency did exactly that.
    const root = this.game.partitionRoot(id);
    if (!root) {
      throw worldRefusal(
        "partition-vanished",
        `Partition "${name}" was adopted as element ${id} but is no longer a partition root in ` +
          `this engine. Something evicted it behind this engine's back, and its changes since the ` +
          `last checkpoint are lost.`,
      );
    }
    return root;
  }

  /**
   * SEAT A PLAYER IN A WORLD THAT IS ALREADY RUNNING (#37 item 2).
   *
   * The one thing a persistent world needs that a table does not. A table's
   * roster is settled before the first move; a world's roster changes for as
   * long as the world lasts, and a player who joins in week three attaches to
   * an engine that has been resident since week one. Rebuilding the engine to
   * admit them would evict every partition in it, which is the exact cost this
   * whole mode exists to avoid.
   *
   * IDEMPOTENT for the same seat, and a REFUSAL for a different one. Re-seating
   * is what a reconnect looks like from here and must be free; moving a seated
   * player to another seat is not a reconnect, and silently accepting it would
   * hand one person another person's holdings.
   */
  seat(player: string, seat: number): void {
    const held = this.seats.get(player);
    if (held !== undefined && held !== seat) {
      // `seat-conflict`, not `unknown-player`: this player IS known, and
      // anything keying on the code must not misread a move as absence (#150).
      throw worldRefusal(
        "seat-conflict",
        `"${player}" already plays seat ${held} in this world and cannot be moved to seat ` +
          `${seat}. A seat is where a player's holdings are; moving one would hand them ` +
          `somebody else's.`,
      );
    }
    this.seats.set(player, seat);
  }

  private seatFor(player: string): number {
    const seat = this.seats.get(player);
    if (seat === undefined) {
      const known = [...this.seats.keys()];
      throw worldRefusal(
        "unknown-player",
        `"${player}" is not in this world: it seats ` +
          `${known.length > 0 ? known.join(", ") : "nobody"}.`,
      );
    }
    return seat;
  }
}

/**
 * Drop every resident partition the view's declaration did NOT name (#183).
 *
 * Runs on the OUTPUT of `toJSONForPlayer`, so the engine's fog of war has
 * already redacted everything it redacts; this only ever removes whole
 * subtrees, which is exactly what the same view would look like on an
 * instance where those partitions had never been loaded. Partition roots keep
 * their real ids through redaction (the engine's single-hidden-element and
 * count-only branches both preserve `json.id`), which is what makes an
 * id-keyed prune sound.
 *
 * A partition nested INSIDE an unnamed one is the one shape that must not be
 * lost: an unnamed subtree that contains a named partition is kept as a path
 * and recursed into rather than dropped, so the named partition survives
 * wherever the game put it.
 */
/**
 * MAY THIS COMMAND REACH THIS PARTITION?
 *
 * A NAMED PREDICATE AND NOT AN INLINE CHECK, deliberately (#169). It was
 * written inside the per-dispatch `partition:` closure, which was the only
 * place that asked the question -- and the moment a second place asks it, an
 * inline check is copied rather than called. The second place is coming: under
 * Actions, ENUMERATION has to answer "which of this action's choices can this
 * seat actually reach?" against the same declaration, and two copies of a
 * residency rule is exactly how a world comes to offer a player a choice its
 * own dispatch then refuses.
 *
 * `declared` is what the command's `partitions()` named on its last round --
 * everything the host loaded and everything this command is reported to have
 * dirtied. A partition outside it may be RESIDENT (an earlier command left it
 * so) and is still refused, because residency is an accident of what else has
 * run and the dirty set is computed from the declaration: a write through an
 * undeclared partition would be visible to every watcher and serialized by no
 * checkpoint.
 */
function assertDeclared(
  command: string,
  name: string,
  declared: readonly string[],
): void {
  if (declared.includes(name)) return;
  throw worldRefusal(
    "undeclared-partition",
    `Command "${command}" asked for partition "${name}", which it did not declare. ` +
      `Add it to the command's partitions() so the platform loads it before the command runs; ` +
      `an undeclared partition is not resident and would not be reported dirty either.`,
  );
}

function pruneUnnamedPartitions(
  json: ElementJSON,
  unnamed: ReadonlySet<number>,
  named: ReadonlySet<number>,
): ElementJSON {
  if (unnamed.size === 0 || json.children === undefined) return json;

  const containsNamed = (node: ElementJSON): boolean =>
    named.has(node.id) || (node.children?.some(containsNamed) ?? false);

  json.children = json.children.filter(
    (child) => !unnamed.has(child.id) || containsNamed(child),
  );
  for (const child of json.children) pruneUnnamedPartitions(child, unnamed, named);
  return json;
}

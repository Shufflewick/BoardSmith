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
import type {
  ActionContext,
  ActionDefinition,
  ElementJSON,
  Game,
  GameElement,
  Player,
} from "../engine/index.js";
import type { ActionMetadata, PickMetadata } from "../session/types.js";
import { buildPickMetadata } from "../engine/element/action-metadata.js";
import {
  formatChoiceCandidates,
  formatElementCandidates,
  type AnnotatedCandidate,
} from "../engine/element/pick-candidates.js";
import {
  assertCandidateBudget,
  assertWorldAction,
  bindWorldFacilities,
  type WorldFacilities,
  type WorldNeedsRound,
} from "./action.js";
import type {
  WorldActionOffer,
  WorldCommand,
  WorldCommandResult,
  WorldCommandStamp,
  WorldEngine,
  WorldEventStamp,
  WorldNarrationLine,
  WorldOfferStamp,
  WorldPartitionSource,
  RoutedEvent,
  StoredPartition,
} from "./contract.js";
import {
  scheduleBudget,
  WORLD_OWNER,
  type ScheduleAllowance,
  type ScheduleArm,
  type ScheduleCancel,
  type ScheduleRequest,
} from "./schedule-api.js";
import { worldRefusal, WorldRefusal } from "./refusals.js";
import { evaluateCondition } from "../engine/index.js";
import { readOnlyProjection } from "./readonly.js";
import { assertCreatedRoots } from "./migration.js";
import { worldBudgets, type WorldBudgets } from "./budgets.js";

/**
 * The authoring types below are EXPORTED, and that reverses the call this file
 * used to make.
 *
 * They were reachable structurally -- a bundle writes a declaration and
 * TypeScript checks it -- so exporting them looked like a public surface larger
 * than its callers. It was not: the callers are world BUNDLES, in other
 * repositories, and every one of them hand-copied these declarations because it
 * had no way to import them. Four copies of a contract is four places for it to
 * drift, and it drifted. One declaration both sides import is the whole point
 * of `boardsmith/world`.
 */

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
 * WHAT A DECLARATION MAY READ: the resident tree, and the clock (#375).
 *
 * `execute` has had the authoritative instant since #57, and a declaration had
 * none -- so a world whose partitions are TIMED could not name the due ones.
 * Its only correct move was to declare every active one, which is O(world) in
 * the one mode whose argument is that a command costs O(room).
 *
 * NO `presence`, deliberately, though `execute` has that too. What a
 * declaration names decides what is RESIDENT, and residency that depended on
 * who happened to be connected would differ between two watchers of one world
 * and between a command and its own replay. The clock is a fact about the
 * dispatch; presence is a fact about the moment, and only the second is
 * unstable.
 */
export interface WorldDeclarationFacilities extends WorldResidency {
  /**
   * THE INSTANT THIS DISPATCH IS HAPPENING AT, stamped by the platform.
   *
   * A command's stamped arrival, and a scheduled event's own `due` -- the same
   * instant `execute` is about to be given, so a declaration and the handler it
   * precedes cannot disagree about what time it is. On the offer path it is the
   * instant the offer is being made at.
   */
  readonly now: number;
}

/**
 * WHICH PARTITIONS ONE SEAT'S VIEW IS ABOUT (#95).
 *
 * The read path's counterpart to a world action's own `needs` walk, and it is
 * required of a world bundle: a game that never declared one and a game that
 * declared nothing must not look the same from outside. `() => []` is the whole
 * of the second.
 *
 * A VIEW KEEPS THE FIXPOINT an action's declaration gave up (#169). An action
 * is a sequence, so its declaration is an ordered walk whose length is its own
 * selection count; a view has no steps, so "what is this seat looking at?" can
 * only be answered by asking, loading, and asking again until it stops changing
 * its mind. That is why `settleDeclaration` is still here and why it still has
 * a ceiling.
 *
 * Reachable without being exported: a bundle writes one into its `world` block
 * and TypeScript checks it structurally.
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
  /**
   * THE WORLD'S VERBS, as `worldAction()` built them (#169).
   *
   * Registered on the game by this engine, so they land in the SAME `_actions`
   * registry a table's actions land in and are reached through the same
   * `game.getAction`. That is what lets one enumeration serve both backends --
   * and it is the single property that keeps a world bot possible, since MCTS
   * finds its moves through `getAction` and `enumerateSelectionsInternal` with
   * no world-only path to teach it.
   *
   * Taken as a list rather than read off the game, because a game class may
   * register a table's actions in its own constructor and those are not this
   * world's verbs. What is named here is what a seat may be offered.
   */
  readonly actions: readonly ActionDefinition[];
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
  /**
   * BUILD A PARTITION ROOT THE STORE DOES NOT HAVE YET (#218).
   *
   * The bundle's `world.createPartition`. A declaration that names a partition
   * the store has never held is refused -- that is what catches a typo -- and
   * until this there was no way to say "this one is supposed to be absent until
   * somebody arrives". Genesis runs once, so every root a world would ever need
   * had to exist from its first instant: a 500-seat world paid for 500 empires
   * on the day it opened, and a world whose rooms are discovered could not be
   * written at all.
   *
   * Answer `undefined` for a name this world does not create, and the command
   * meets the same refusal it does today.
   *
   * Left out, no partition is ever created on first use.
   */
  readonly createPartition?: (game: Game, name: string) => GameElement | undefined;
}

export class BoardSmithWorldEngine implements WorldEngine {
  private readonly budgets: WorldBudgets;
  private readonly game: Game;
  /** MUTABLE, and that is the point: see `seat`. */
  private readonly seats: Map<string, number>;
  private readonly store: WorldPartitionSource;
  /** This world's verbs by name, in the order the bundle declared them. */
  private readonly actions = new Map<string, ActionDefinition>();
  /** What a seat's view is about, from the bundle (#95). */
  private readonly view: WorldViewDeclaration;

  /** Partition name to the id of its resident root. */
  private readonly residentIds = new Map<string, number>();
  /** The same mapping backwards, for reading the taken touch set. */
  private readonly residentNames = new Map<number, string>();
  /** Partition name to the value `useClock` held when a command last NAMED it. */
  private readonly lastUsed = new Map<string, number>();
  /** The bundle's first-use root builder, or undefined for a world with none. */
  private readonly buildOnFirstUse: ((game: Game, name: string) => GameElement | undefined) | undefined;
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
    this.view = options.view;
    this.budgets = options.budgets ?? worldBudgets();
    this.buildOnFirstUse = options.createPartition;
    // AT CONSTRUCTION, NOT AT THE FIRST OFFER. A bundle whose declaration is
    // wrong is wrong for every player who will ever attach, so it is refused
    // once, before the world is built, rather than on whichever player first
    // asked what they could do here.
    for (const action of options.actions) {
      assertWorldAction(action);
      // ONE REGISTRY, and this is where a world's verbs enter it. Registering
      // here rather than asking the bundle to do it in its game constructor is
      // what makes "the actions the engine offers" and "the actions the game
      // holds" the same list by construction rather than by convention.
      this.game.registerAction(action);
      this.actions.set(action.name, action);
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

  /**
   * `residentWorld` with the dispatch's clock on it (#375).
   *
   * Built fresh per declaration for the reason `residentWorld` is, and separate
   * from it because the VIEW path has no stamp: `viewFor(player)` is answered
   * whenever a watcher asks, so a clock there would be the isolate's own and
   * therefore the wrong one. A view that wants the time takes it from the
   * partition it is projecting.
   */
  private declaringWorld(now: number): WorldDeclarationFacilities {
    return { ...this.residentWorld(), now };
  }

  /**
   * TRANSFORM ONE RESIDENT PARTITION IN PLACE (#200).
   *
   * The migration hook's one reach into a world: the partition's own element,
   * live and mutable, exactly as a command handler sees it. Nothing else is
   * offered -- no clock, no schedule, no seat -- because a migration is not a
   * command and must not be able to act like one.
   *
   * The partition must already be resident; the caller hydrates. Serializing
   * it afterwards is the caller's too, so one write can carry every partition
   * the migration touched.
   */
  migratePartition(name: string, transform: (element: GameElement) => void): void {
    transform(this.rootOf(name));
  }

  /**
   * BUILD A PARTITION ROOT THE STORE HAS NEVER HELD (#218).
   *
   * Genesis runs once. Every root a world would ever need therefore had to
   * exist from its first instant, which is why a 500-seat world paid for 500
   * empires on the day it opened and a world whose rooms are discovered could
   * not be written at all. This is the other door: a host that looks for a
   * declared partition and finds no row asks here, and the bundle answers
   * either an element -- which becomes that partition -- or nothing, in which
   * case the name is the typo the refusal has always said it was.
   *
   * IDEMPOTENT BY CONSTRUCTION. It is reached only when the store holds no row
   * for the name, and a name already resident is answered from residency
   * without building anything, so a second reach finds the first one's work
   * rather than replacing it.
   *
   * The host owns the WRITE, as it owns every other write: this answers the
   * bytes and the parent, and a partition that was built and not yet stored is
   * simply a partition the next checkpoint writes.
   */
  createPartition(name: string): StoredPartition | undefined {
    const resident = this.residentIds.get(name);
    if (resident !== undefined) {
      const root = this.game.partitionRoot(resident);
      if (root) return { parentId: this.game.id, json: root.toJSON() };
    }
    const built = this.buildOnFirstUse?.(this.game, name);
    if (built === undefined) return undefined;
    // The hook CREATED this in the live game, so it is already in the tree --
    // the same case genesis is in, and the same reason telling the engine
    // matters: adoption and creation are different events, and a later command
    // must not try to adopt from the store what was invented here.
    this.registerResident(name, built);
    return {
      // The ROOT is the parent, because a partition hangs from the game tree
      // and the subtree's own bytes cannot say where.
      parentId: this.game.id,
      json: built.toJSON() as StoredPartition["json"],
    };
  }

  /**
   * DURABLE PARTITION ROOTS AN UPGRADE ADDS (#218).
   *
   * The migration hook's other reach, beside `migratePartition`: that one
   * transforms a root that exists and has nowhere to answer more, so a world
   * that outgrew its genesis had no expressible upgrade at all.
   *
   * `existing` is every name the world already holds -- the host's knowledge,
   * because only the host has read the store's whole key set -- and it is both
   * what the hook filters against and what a duplicate is refused by. Nothing
   * is written here: the caller collects these and lands them in the SAME write
   * as the transformed partitions, so a migration is still all or nothing.
   */
  createMigratedPartitions(
    build: (game: Game) => Record<string, GameElement>,
    existing: readonly string[],
  ): Record<string, StoredPartition> {
    const built = build(this.game);
    assertCreatedRoots(built, existing);
    // NULL PROTOTYPE: the names are the bundle's, and `created["__proto__"] =
    // record` on a plain object replaces this record's prototype instead of
    // adding an entry -- so the host would never receive the partition while
    // `registerResident` had already run.
    const created: Record<string, StoredPartition> = Object.create(null) as Record<
      string,
      StoredPartition
    >;
    for (const [name, element] of Object.entries(built)) {
      this.registerResident(name, element);
      created[name] = { parentId: this.game.id, json: element.toJSON() as StoredPartition["json"] };
    }
    return created;
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

  /**
   * WHAT THIS SEAT CAN DO HERE, ENUMERATED (#169).
   *
   * The flat command table's `commandOffers()` answered from the bundle's own
   * static declaration and loaded nothing: it could say `tend` exists and that
   * it wants a holding, and the only holdings it could name were all five
   * hundred, because the bundle can state what it holds and not what is legal
   * this instant. That is the JSON box wearing a form's clothes.
   *
   * This answers the seat's ACTIONS, in the table's own `ActionMetadata` shape,
   * with each selection's candidates already resolved -- so `tend` offers the
   * two to four neighbouring holdings that exist right now, as element IDs the
   * board bridge wires straight to a click.
   *
   * ## Why this does not resurrect what `viewFor` refuses to do
   *
   * `viewFor` argues at length that a world may never call `createPlayerView`,
   * because that reaches `getAvailableActions` and evaluates every registered
   * action's selections against a tree the world deliberately does not hold.
   * That argument is the CONSTRAINT this method satisfies, not an obsolete
   * note. What makes the difference is that a world action declares what each
   * of its steps needs, and three rules hold the declaration to it:
   *
   *   the unbounded `from`/`filter` element form is refused at construction;
   *   every candidate must lie inside a partition this step declared, checked
   *     with the SAME `assertDeclared` the dispatch path uses; and
   *   a selection may not offer more than `maxCandidatesPerSelection`.
   *
   * So an action that reaches an undeclared partition is refused BY NAME at the
   * enumeration boundary, which is the difference between a bug that looks like
   * a wake bug and a message that names the action.
   *
   * ## What it costs
   *
   * `O(actions) x (condition + each selection's own candidates)`. There is no
   * term that scales with the world: it scales with what the declaration named,
   * and the declaration is authored, finite and readable. The hydration is the
   * union of the actions' round-one declarations, which for every game in the
   * catalogue is a subset of what `world.view` already names -- so in practice
   * an offer over a seat's own view loads nothing at all.
   */
  async offersFor(player: string, stamp: WorldOfferStamp): Promise<readonly WorldActionOffer[]> {
    const seat = this.seatFor(player);
    const acting = this.playerFor(seat);
    const offers: WorldActionOffer[] = [];

    for (const definition of this.actions.values()) {
      // THE CLOCK'S OWN ARE NOT OFFERED (#120), and this is the FIRST of the
      // exactly two sites that read `seatless`. Filtering alone would leave the
      // rule enforceable only by the client, which is not a place a rule can
      // live; `actionFor` is the other half.
      if (definition.world?.seatless === true) continue;
      const offer = await this.offerOf(definition, seat, acting, stamp);
      if (offer !== null) offers.push(offer);
    }
    // By name, so a surface's order is the game's own fact rather than the
    // order a Map happened to iterate.
    return offers.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * WHAT AN OFFER FOR THIS SEAT STILL NEEDS RESIDENT, one round at a time.
   *
   * The read path's `commandPartitions`, and it exists for the same reason: a
   * host reads storage and the engine does not, so the engine names and the
   * host supplies. It walks every action the seat could be offered -- round
   * one, then each selection's own round -- and answers the first unmet round
   * of each, unioned, because the actions are independent of one another and
   * batching them keeps an offer to one storage round trip per LEVEL rather
   * than one per action.
   *
   * Conditions run only in the stamped offer context. Declaration has no clock
   * or presence snapshot, so it cannot decide availability. It declares the
   * bounded read rounds; offerOf evaluates conditions after those reads arrive.
   *
   * The EXECUTE round is deliberately not walked: it names what `execute`
   * writes, and an offer executes nothing.
   */
  offerPartitions(player: string, now: number): readonly string[] {
    const seat = this.seatFor(player);
    const missing: string[] = [];
    for (const definition of this.actions.values()) {
      if (definition.world?.seatless === true) continue;
      missing.push(...this.offerPartitionsOf(definition, seat, now));
    }
    return declaredOnce(missing);
  }

  /** One action's share of the answer above: the first round it cannot yet
   *  make, or nothing when its whole offer is already resident. */
  private offerPartitionsOf(
    definition: ActionDefinition,
    seat: number,
    now: number,
  ): readonly string[] {
    for (let step = 0; step < definition.selections.length || step === 0; step++) {
      for (const round of definition.world!.needs) {
        if (round.before !== step) continue;
        const unmet = this.declareRound(round, seat, {}, now).filter(
          (name) => !this.residentIds.has(name),
        );
        // ONE ROUND AT A TIME. A later round may read what an earlier one
        // loaded, so there is nothing to say about it until the host has
        // supplied this one.
        if (unmet.length > 0) return unmet;
      }
    }
    return [];
  }

  /** One action's offer, or null when this seat may not take it at all. */
  private async offerOf(
    definition: ActionDefinition,
    seat: number,
    acting: Player,
    stamp: WorldOfferStamp,
  ): Promise<WorldActionOffer | null> {
    const named: string[] = [];
    const facilities = this.readOnlyFacilities(definition.name, named, stamp);
    bindWorldFacilities(this.game, facilities);
    try {
      // ROUND ONE (and any round that shares its place), before anything is
      // asked of the player.
      await this.hydrateRounds(definition, 0, seat, {}, named, stamp.now);

      // WITH EMPTY ARGS, exactly as a table evaluates availability. An action
      // whose condition is false is not offered and no further round runs, so a
      // verb that is irrelevant here costs one predicate and no hydration past
      // round one.
      if (
        definition.condition &&
        !evaluateCondition(
          definition.condition,
          { game: this.game, player: acting, args: {} },
          `action '${definition.name}'`,
        )
      ) {
        return null;
      }

      // ONE ROUND, THEN ONE SELECTION, IN THE AUTHOR'S ORDER.
      //
      // Deliberately NOT `isActionAvailable`, and the reason is the whole of
      // why `viewFor` refuses `createPlayerView`: that helper enumerates every
      // selection of every registered action in one pass, against whatever
      // happens to be resident, and a world's partitions are absent until a
      // declaration names them. Interleaving is what makes enumeration possible
      // at all here -- selection i's candidates are evaluated with selection
      // i's declaration resident and not before.
      const selections: PickMetadata[] = [];
      let satisfiable = true;
      for (let index = 0; index < definition.selections.length; index++) {
        if (index > 0) await this.hydrateRounds(definition, index, seat, {}, named, stamp.now);
        const pick = this.pickOf(definition, index, acting, named);
        selections.push(pick);
        // WHAT `hasValidSelectionPath` MEANS FOR A WORLD ACTION. On a table it
        // recurses, because a later selection may depend on an earlier one's
        // value; a world action may not declare a dependent selection, so the
        // whole of "is there a legal path through this action" is "does every
        // question it asks have at least one answer".
        if (!pick.optional && candidateless(pick)) satisfiable = false;
      }
      // THE REASON IT CANNOT BE TAKEN OUTRANKS WHETHER IT HAS AN ANSWER (#187).
      //
      // A disabled action is never STARTED, so whether its questions still have
      // answers decides nothing about it -- and dropping it for that leaves the
      // seat looking at a world where the verb does not exist, which is the one
      // thing `disabled` is for saying instead. It is also what `candidateless`
      // already points at: "an action offered on that basis is a button whose
      // every press is refused -- which is what `disabled` on the ACTION exists
      // to say". That sentence is only true if the engine reads the reason
      // BEFORE it decides. `example-rts` is the case that proved it did not:
      // every holding stands at its cap from genesis, so `tend`'s two
      // neighbours are both greyed and the verb vanished from every seat's
      // offer, while `kindle` -- a number, which can never be candidateless --
      // sat beside it correctly greyed.
      //
      // An ENABLED action with no answerable question is still dropped, and
      // that is the half this must not undo: it is a pick that opens on
      // nothing, which is what #187 was first reported as.
      const disabled = this.game.getActionDisabledReason(definition, acting);
      if (disabled === null && !satisfiable) return null;

      return offerOf(definition, selections, disabled);
    } finally {
      bindWorldFacilities(this.game, null);
    }
  }

  /**
   * One selection's metadata WITH ITS CANDIDATES, and both guards applied.
   *
   * The static half is `buildPickMetadata`, the engine's own -- the same
   * function that builds a table's, so a world's picks and a table's are the
   * same shape by construction rather than by inspection. The candidates are
   * resolved here rather than fetched on demand because a world's offer is
   * answered in one frame; the cap and the residency check are what keep that
   * affordable.
   */
  private pickOf(
    definition: ActionDefinition,
    index: number,
    acting: Player,
    named: readonly string[],
  ): PickMetadata {
    const selection = definition.selections[index]!;
    const pick = buildPickMetadata(this.game, acting, selection);
    if (selection.type === "number" || selection.type === "text") return pick;

    const candidates = this.game
      .getActionExecutor()
      .getChoices(selection, acting, {}, definition.name) as AnnotatedCandidate[];

    // (c) THE PER-SELECTION CAP, this host's own number.
    assertCandidateBudget(definition.name, selection.name, candidates.length, this.budgets);

    const context = { game: this.game, player: acting, args: {} };
    // Warnings are the SESSION's channel for a soft-failed display callback and
    // a world has no frame to carry them; collected so the formatters have
    // somewhere to put one, and dropped, because the console already has it.
    const warnings: never[] = [];
    if (selection.type === "choice") {
      pick.choices = formatChoiceCandidates(candidates, selection, context, warnings);
      return pick;
    }

    // (b) EVERY CANDIDATE INSIDE A DECLARED PARTITION, checked with the same
    // predicate the dispatch path uses. Two copies of a residency rule is
    // exactly how a world comes to offer a player a choice its own dispatch
    // then refuses.
    for (const candidate of candidates) {
      assertDeclared(definition.name, this.partitionOf(candidate.value as GameElement), named);
    }
    pick.validElements = formatElementCandidates(candidates, selection, context, warnings);
    return pick;
  }

  /**
   * WHICH PARTITION AN ELEMENT LIVES IN, walking up to the root that names one.
   *
   * An element outside every partition is not a candidate a world can offer:
   * nothing would checkpoint a write to it, so choosing it would change the
   * world exactly until the next hibernation. The refusal names the action so
   * the author knows which candidate list to narrow.
   */
  private partitionOf(element: GameElement): string {
    for (let node: GameElement | undefined = element; node; node = node.parent) {
      const name = this.residentNames.get(node.id);
      if (name !== undefined) return name;
    }
    return "(no partition)";
  }

  /**
   * WHAT THIS ACTION STILL NEEDS RESIDENT, one round at a time (#169).
   *
   * The write path's counterpart to `viewPartitions(player)`, and it is on the
   * engine for the same reason that one is: the ROSTER is the engine's, so the
   * seat an action acts from can only be resolved here.
   *
   * IT ANSWERS THE NEXT UNMET ROUND, not the whole declaration. An action's
   * declaration is an ORDERED WALK -- round one, then each selection's own
   * round, then the execute round -- and a later round is allowed to read what
   * an earlier one loaded, so it cannot be answered until that one is resident.
   * The host supplies what this names and asks again; the loop ends when this
   * answers nothing, and it terminates because the walk has one round per step
   * and every round it returns becomes resident before it is asked again. That
   * is what replaces the fixpoint's ceiling and its `declaration-unsettled`
   * refusal for the write path: there is no number to tune, because the length
   * is the action's own source.
   *
   * IT LOADS NOTHING. Everything named here is answered while the partitions
   * are still absent -- that is the whole of declare-then-apply.
   *
   * `player` is null for a scheduled event, which reaches a seatless action's
   * declaration as a null seat and no player at all.
   */
  commandPartitions(player: string | null, command: WorldCommand, now: number): readonly string[] {
    const seat = player === null ? null : this.seatFor(player);
    const definition = this.actionFor(command.name, seat);
    for (const round of definition.world!.needs) {
      const missing = this.declareRound(round, seat, command.args, now).filter(
        (name) => !this.residentIds.has(name),
      );
      if (missing.length > 0) return declaredOnce(missing);
    }
    return [];
  }

  /**
   * One round of a declaration, answered read-only.
   *
   * READ-ONLY TWICE OVER, and both halves matter (#219, #295). The game is
   * handed over as a projection that REFUSES every write, because a declaration
   * runs before the host has decided what this action may change, so nothing it
   * wrote could be checkpointed -- it would either ride a rollback the player
   * was told discarded it, or revert at the next hibernation with nobody told.
   * And the whole call runs inside `readingOnly`, so what a declaration merely
   * LOOKED at does not enter the next dispatch's dirty comparison, which is the
   * O(resident) cost that removed.
   */
  private declareRound(
    round: WorldNeedsRound,
    seat: number | null,
    args: Readonly<Record<string, unknown>>,
    now: number,
  ): readonly string[] {
    const player = seat === null ? null : this.playerFor(seat);
    return declaredOnce(
      this.game.readingOnly(() =>
        round.declare({
          game: readOnlyProjection(this.game),
          player: player === null ? null : readOnlyProjection(player),
          seat,
          args: args as Record<string, unknown>,
          // BY NAME, AND INDEXED (#374). The alternative a declaration is left
          // with when this is absent is `game.first(Class, name)`, which walks
          // the resident tree through the projection to rediscover an id
          // `residentIds` already holds -- the whole of the cost #374 measured.
          world: this.declaringWorld(now),
        }),
      ),
    );
  }

  /**
   * Evaluate every round that comes before step `step`, in order, making what
   * each names resident before the next is asked.
   *
   * IN ORDER AND ONE AT A TIME, because that is the whole mechanism: a later
   * round is allowed to READ what an earlier one loaded, which is how a
   * declaration whose subject is itself state -- the room a wanderer is
   * standing in -- gets written without branching on whether the partition
   * happens to be there yet.
   */
  private async hydrateRounds(
    definition: ActionDefinition,
    step: number,
    seat: number | null,
    args: Readonly<Record<string, unknown>>,
    named: string[],
    now: number,
  ): Promise<void> {
    for (const round of definition.world!.needs) {
      if (round.before !== step) continue;
      for (const name of this.declareRound(round, seat, args, now)) {
        if (!named.includes(name)) named.push(name);
        await this.ensureResident(name);
      }
    }
  }

  /**
   * The action for this name, and WHETHER THIS CALLER MAY HAVE IT.
   *
   * Both refusals live here rather than at each call site -- `commandPartitions`
   * and `dispatch` -- because the declaration path and the apply path are
   * separate calls across a boundary, and a rule enforced in only one of them
   * is a rule a caller can step around by skipping a call.
   */
  private actionFor(name: string, seat: number | null): ActionDefinition {
    const definition = this.actions.get(name);
    if (!definition) {
      const known = [...this.actions.keys()];
      throw worldRefusal(
        "unknown-command",
        `This world has no action named "${name}". It answers to: ` +
          `${known.length > 0 ? known.join(", ") : "no actions at all"}.`,
      );
    }
    // A PLAYER MAY NOT ISSUE THE CLOCK'S OWN (#120), and this is the SECOND of
    // the two sites that read `seatless`. `seat === null` is the clock, and it
    // is the only caller a seatless action has.
    if (definition.world?.seatless === true && seat !== null) {
      throw worldRefusal(
        "clock-only-command",
        `"${name}" is this world's own clock at work, not an action you take. It runs when the ` +
          "event that was scheduled for it comes due, whether or not anybody is here to watch " +
          "it, and no player may issue it.",
      );
    }
    // AND THE CLOCK MAY NOT ISSUE A SEAT'S. The other half of the same rule,
    // and it was missing: a scheduled event naming an ordinary action reached
    // `player.seat` on nothing and answered with a TypeError out of game code,
    // which tells a bundle author neither what happened nor which schedule row
    // did it. A seated action asks a person a question, and a due event has
    // nobody to ask.
    if (definition.world?.seatless !== true && seat === null) {
      throw worldRefusal(
        "clock-only-command",
        `A scheduled event named "${name}", which is something a seat does rather than something ` +
          "the clock does: it acts for a player, and a due event has no player. Build the verb " +
          "the clock runs with `worldClockAction()`, or schedule one that is already seatless.",
      );
    }
    return definition;
  }

  /**
   * The Game player holding this seat.
   *
   * A REAL PLAYER AND NEVER A SYNTHETIC ONE: a world's game is constructed with
   * `playerCount` equal to the bundle's own `maxPlayers`, so every seat in the
   * world has a chair in the tree and `ActionContext.player` is honest. That is
   * what lets a world action be enumerated by the engine's own
   * `getAvailableActions` rather than by something written beside it.
   */
  private playerFor(seat: number): Player {
    const player = this.game.getPlayer(seat);
    if (!player) {
      throw worldRefusal(
        "world-full",
        `This world's game holds ${this.game.players.length} seats and nothing sits at seat ` +
          `${seat}. A seat is minted by the bundle's own maxPlayers; nothing else may mint one.`,
      );
    }
    return player;
  }

  /**
   * The facilities an OFFER runs against: reads only.
   *
   * `schedule`, `complete` and `emit` refuse. An offer is a question, and a
   * question that armed a timer, ended a season or narrated a line would do
   * those things once per watcher per frame. It is also the boundary a bot
   * needs: an MCTS search rolls the tree back many times inside one real
   * dispatch, and a schedule or a completion escapes the tree and cannot be
   * rolled back with it.
   */
  private readOnlyFacilities(
    action: string,
    named: readonly string[],
    stamp: WorldOfferStamp,
  ): WorldFacilities {
    const refuse = (what: string): never => {
      throw worldRefusal(
        "not-in-a-world",
        `The "${action}" action called ctx.world.${what}() while the world was deciding what to ` +
          "OFFER this seat, which is a question rather than a moment. Nothing an offer does can " +
          "be checkpointed or rolled back, so a timer armed here would be armed once per " +
          `watcher. Move the ${what}() into the action's execute().`,
      );
    };
    return {
      now: stamp.now,
      timing: null,
      presence: new Set(stamp.presence),
      partition: (name: string) => {
        assertDeclared(action, name, named);
        return this.rootOf(name);
      },
      schedule: () => refuse("schedule"),
      cancel: () => refuse("cancel"),
      complete: () => refuse("complete"),
      emit: () => refuse("emit"),
    };
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
    // A WORLD'S VERBS ARE ANSWERED BY `offersFor()`, which enumerates them
    // under the bounded contract `assertWorldAction` enforces -- one action at
    // a time, hydrating each one's own declaration as it goes, rather than
    // evaluating every registered action against whatever happens to be
    // resident. Its flow does not run -- `definition.ts:createWorld` never
    // starts one -- so there is no turn to report, and the three things below
    // are the whole of what a world has to say to one seat.
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
    // AND THE ROSTER GOES WITH IT (#181). The game root's player list is in no
    // partition, so the prune above never reached it: a 500-seat world shipped
    // 500 serialized `Player` elements to every seat on every look, which is
    // O(world) per view and the one cost the partitioned model exists to
    // delete. What survives is the seat doing the looking; see
    // `pruneRosterToViewer` for why nothing dangles when the rest go.
    return {
      player: seat,
      state: pruneRosterToViewer(
        pruneUnnamedPartitions(state, unnamedIds, namedIds),
        new Set(this.game.players.map((player) => player.id)),
        this.game.players.find((player) => player.seat === seat)?.id,
        namedIds,
      ),
      phase: this.game.phase,
    };
  }

  // (pruneUnnamedPartitions and pruneRosterToViewer, the two module-scope
  // helpers `viewFor` ends with, are defined at the bottom of this file.)

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
    timing: { readonly due: number; readonly missedCount: number } | null,
    charge: {
      now: number;
      owner: string;
      allowance: ScheduleAllowance;
      presence: readonly number[];
    },
  ): Promise<WorldCommandResult> {
    const definition = this.actionFor(command.name, seat);

    // THE ORDERED WALK, WITH EVERY ARGUMENT ALREADY IN HAND (#169).
    //
    // An offer walks with empty args, because it is asking what could be
    // chosen. A dispatch walks with the args the player actually sent, so every
    // round -- round one, each selection's, and the execute round -- is
    // answered against the move being made. Hydration happens BETWEEN rounds,
    // which is what lets a later round read what an earlier one loaded, and it
    // all happens before the rollback snapshot below, because adopting a
    // partition is not a change this dispatch could be asked to undo.
    //
    // `named` is the union of every round, and it is what the dirty set starts
    // from and what `assertDeclared` holds the action to.
    const named: string[] = [];
    for (let step = 0; step <= definition.selections.length; step++) {
      await this.hydrateRounds(definition, step, seat, command.args, named, charge.now);
    }

    // Raised once per command and stamped on everything this one NAMED, so two
    // partitions named by the same command are equally warm and the tiebreak
    // falls to `planEviction`'s by-name ordering rather than to argument order.
    this.useClock += 1;
    for (const name of named) this.lastUsed.set(name, this.useClock);

    // THE MESSAGE LOG IS CLEARED HERE (#163). Nothing platform-side reads
    // it -- `viewFor` deliberately ships no messages -- so a `game.message()`
    // an action emits is a write into resident memory nobody will ever see,
    // and left alone it grows for the life of the isolate. Clearing at each
    // dispatch bounds the log at one action's worth on both the success and
    // the rollback path.
    //
    // THE TOUCHED SET USED TO BE CLEARED ALONGSIDE IT, and is not any more
    // (#316). `clearTouchedPartitions()` right here serialized every resident
    // partition to re-baseline -- a whole pass over the resident world before
    // this command had done anything. Both exits below TAKE the set instead,
    // which reports and re-baselines in the one pass, so what the next command
    // sees still belongs to the next command and nothing pays twice.
    this.game.pruneMessages({ keepLast: 0 });

    // Requests are not durable until the host writes them, so the caps have to
    // count this dispatch's own as they go -- otherwise an action could ask for
    // a cap's worth twice and the host would refuse the batch after the world
    // had already changed. The budget does that counting, so this side and the
    // host cannot count differently.
    const budget = scheduleBudget(charge.owner, charge.allowance, this.budgets);

    // WHAT THE WORLD LOOKS LIKE BEFORE THIS ACTION (#68, #294).
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

    // WHAT THE ACTION DID BESIDE CHANGING THE TREE.
    //
    // PER DISPATCH, and one object rather than four closed-over variables
    // because the facilities that write into it are built by a method of their
    // own. Declared here rather than as a field so none of it can leak into the
    // next dispatch: a leaked ending would settle the season again on the
    // following move; a leaked schedule would arm a timer nobody asked for,
    // charged to whoever acted next; a leaked event would narrate one action's
    // news over another's.
    const ledger: DispatchLedger = { completed: false, schedules: [], events: [], refused: null };
    const facilities = this.dispatchFacilities(command.name, named, timing, charge, budget, ledger);

    // EVERYTHING BETWEEN THE SNAPSHOT AND THE RETURN IS UNDER THE ROLLBACK
    // (#68, #151). The catch used to wrap the handler alone, and the two
    // refusals thrown after it -- dirty-set resolution and event routing --
    // landed on a tree the handler had already successfully mutated. `refused`
    // then meant "mutated, and durably so once anything else checkpointed the
    // same partition". The only way out of this block without the rollback is
    // the successful return at its end.
    bindWorldFacilities(this.game, facilities);
    try {
      const result =
        seat === null
          ? this.executeSeatless(definition, command.args)
          : // THROUGH THE ENGINE'S OWN EXECUTOR, which resolves element ids to
            // elements, runs each selection's `validate`, fires `onSelect`, and
            // applies the action's `disabled` rule server-side. A world that
            // called `execute` directly would be a second, quieter action
            // system, and the greyed-out button would stop being a closed door.
            this.game.performAction(command.name, this.playerFor(seat), {
              ...command.args,
            });
      if (!result.success) {
        // THE GAME'S OWN SENTENCE, BACK ON THE ROAD IT CAME IN ON.
        // `executeAction` catches a throw out of the rules and answers
        // `{success: false, error}`; a world needs it as a throw, because the
        // throw is what triggers the rollback that makes "refused" mean the
        // world is unchanged.
        //
        // A PLAIN ERROR AND NOT A `worldRefusal`, deliberately. Under the flat
        // table a refusing handler threw the game's own exception and it
        // travelled unclassified, which is how a host tells "the rules said no"
        // from "the platform's bookkeeping broke". Giving it a code here would
        // relabel every bug in a game's rules as one of the platform's words.
        // THE CLASSIFIED ONE IF THERE WAS ONE, and the game's own sentence
        // otherwise. A plain `Error` is deliberate for the second case: under
        // the flat table a refusing handler threw the game's own exception and
        // it travelled unclassified, which is how a host tells "the rules said
        // no" from "the platform's bookkeeping broke". Giving that a code would
        // relabel every bug in a game's rules as one of the platform's words.
        throw (
          ledger.refused ??
          new Error(
            result.error ?? `The "${command.name}" action was refused and said nothing about why.`,
          )
        );
      }

      return {
        // ROUTED HERE AND NOWHERE ELSE (#58). The action said where; this is
        // the engine saying who, once per event, while the world it is a fact
        // about is still in front of us.
        events: ledger.events.map((event) => ({
          ...event,
          seats: this.audienceOf(command.name, event.scope),
        })),
        // TAKEN, not read: one pass both reports what changed and re-baselines
        // for the next command (#316) -- and since #295 that pass runs over the
        // partitions this command REACHED rather than over the resident set, so
        // what it costs is the room.
        dirty: this.dirtySet(command.name, named, touchedOnce()),
        schedules: ledger.schedules,
        ...(ledger.completed ? { ending: "completed" as const } : {}),
      };
    } catch (error) {
      // A REFUSED ACTION LEAVES THE WORLD UNCHANGED, or the word is worthless
      // (#68). The host EXPECTS rules to refuse -- it quarantines them -- and
      // until this the throw simply propagated: an action that debited gold and
      // failed before crediting the unit sent the player `refused`, which means
      // "nothing changed" to any client, over a tree that had lost the gold.
      // The same word is owed for a refusal thrown AFTER the rules succeeded --
      // an unroutable event scope, a touch on a partition root this engine
      // cannot name (#151) -- so the rollback covers those too.
      this.rollback(before, named, touchedOnce());
      throw error;
    } finally {
      // THE FACILITIES DO NOT OUTLIVE THE DISPATCH. An action that squirrelled
      // `ctx.world` away would otherwise hold a `partition()` that reaches a
      // tree the host has since evicted, and a `schedule()` charged to whoever
      // acted next.
      bindWorldFacilities(this.game, null);
    }
  }

  /**
   * WHAT THIS DISPATCH CHANGED: loaded-or-touched.
   *
   * LOADED -- every partition the walk NAMED. Not "every partition the walk
   * actually hydrated": one left resident by an earlier command is still one
   * this action was free to write, and there is no write barrier that could
   * tell us it did not. TOUCHED -- the engine's own half, which carries BOTH
   * endpoints of every physical re-parent, the half a host structurally cannot
   * see.
   */
  private dirtySet(
    action: string,
    named: readonly string[],
    touched: ReadonlySet<number>,
  ): string[] {
    const dirty = new Set<string>(named);
    for (const id of touched) {
      const name = this.residentNames.get(id);
      if (name === undefined) {
        throw worldRefusal(
          "partition-not-resident",
          `Action "${action}" moved something into or out of partition root ${id}, which this ` +
            `engine never loaded and cannot name. Every partition must reach the tree through ` +
            `the partition store, or its changes cannot be checkpointed.`,
        );
      }
      dirty.add(name);
    }
    return [...dirty];
  }

  /**
   * THE WORLD AN ACTION ACTS THROUGH, for the length of one dispatch.
   *
   * Every refusal these raise is RECORDED before it propagates, and that is
   * what the ledger is for. A refusal thrown from inside `execute` travels out
   * through `ActionExecutor.executeAction`, which catches it and answers
   * `{success: false, error}` -- a STRING. That is right for a game's own
   * refusal, whose sentence is the whole of what it carries, and wrong for the
   * platform's: `schedule-cap`, `invalid-schedule-delay` and
   * `undeclared-partition` are classified, and a host's park ladder reads the
   * CODE rather than the sentence.
   */
  private dispatchFacilities(
    action: string,
    named: readonly string[],
    timing: { readonly due: number; readonly missedCount: number } | null,
    charge: { now: number; presence: readonly number[] },
    budget: ReturnType<typeof scheduleBudget>,
    ledger: DispatchLedger,
  ): WorldFacilities {
    const raise = (refusal: WorldRefusal): never => {
      ledger.refused = refusal;
      throw refusal;
    };
    return {
      now: charge.now,
      timing,
      // A SET, built per dispatch from the host's stamp, so an action asks
      // membership rather than scanning -- and so nothing an action does to it
      // can outlive this dispatch (#144).
      presence: new Set(charge.presence),
      partition: (name: string) => {
        const undeclared = declaredRefusal(action, name, named);
        if (undeclared !== null) raise(undeclared);
        const root = this.rootOf(name);
        // THE ONE DOOR THE ENGINE CANNOT SEE (#295). The dirty-set comparison
        // runs only over the partitions an action could have written, and
        // BoardSmith knows that set because it marks every element its own
        // queries and tree accessors hand out. This root did not come from one
        // of those -- the world looked it up -- and `room.visits += 1` on it
        // touches no accessor at all, so without this line the comparison would
        // skip exactly the partition the action was about.
        this.game.reachPartition(root.id);
        return root;
      },
      emit: (scope: string, payload: unknown, narration?: WorldNarrationLine) => {
        // NORMALIZED HERE AND NOWHERE ELSE (#186). A game may write a bare
        // string or the `{ text, type }` `GameHistory` takes; everything
        // downstream -- the routing, the host, the shell's filter -- reads one
        // shape. And ABSENT rather than `undefined`: these travel as JSON, and
        // a key whose value is `undefined` vanishes on the way, which makes
        // "the game said nothing" and "the game said nothing HERE" the same
        // frame with two spellings.
        const line = typeof narration === "string" ? { text: narration } : narration;
        ledger.events.push({
          scope,
          payload,
          ...(line === undefined ? {} : { text: line.text }),
          ...(line?.type === undefined ? {} : { type: line.type }),
        });
      },
      schedule: (request: ScheduleArm) => {
        // REFUSED AT THE OFFENDING LINE. The host is still the authority and
        // re-plans everything before it writes a single event; this is what
        // makes the refusal land inside the action, so the whole thing unwinds
        // and `refused` means the world is unchanged.
        const refusal = budget.admit(request);
        if (refusal !== null) raise(refusal);
        ledger.schedules.push(request);
      },
      // ONTO THE SAME LIST, in the order the handler wrote them. Cancel-then-arm
      // under one key leaves a timer and arm-then-cancel leaves none, so the two
      // cannot be collected separately without the host deciding which came
      // first for the author.
      cancel: (key: string) => {
        const request: ScheduleCancel = { cancel: key };
        const refusal = budget.admit(request);
        if (refusal !== null) raise(refusal);
        ledger.schedules.push(request);
      },
      complete: () => {
        ledger.completed = true;
      },
    };
  }

  /**
   * RUN A SEATLESS ACTION DIRECTLY, and why that is sound rather than a
   * shortcut.
   *
   * `ActionExecutor.executeAction` exists to resolve and validate selection
   * args and fire `onSelect` hooks, and a seatless action HAS NO SELECTIONS --
   * that is refused at construction. What it would add here is the one thing a
   * clock cannot supply: `ActionContext.player` is not optional, and a
   * scheduled event genuinely has nobody acting. Inventing a player to satisfy
   * a signature is exactly the kind of fallback that masks a real problem
   * later, so the drain calls the definition's own `execute` and the seatless
   * context the builder hands the author has no `player` on it at all.
   */
  private executeSeatless(
    definition: ActionDefinition,
    args: Readonly<Record<string, unknown>>,
  ): { success: boolean; error?: string } {
    try {
      const result = definition.execute({ ...args }, {
        game: this.game,
        args: { ...args },
      } as unknown as ActionContext);
      return result ?? { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
          `cannot run. Check the name, or write the partition before a command names it. A world ` +
          `that builds a root the first time somebody reaches for it declares ` +
          `\`world.createPartition(game, name)\` and answers an element for the names it creates.`,
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
function assertDeclared(command: string, name: string, declared: readonly string[]): void {
  const refusal = declaredRefusal(command, name, declared);
  if (refusal !== null) throw refusal;
}

/** The same question, answered rather than raised, for the one caller that has
 *  to record a refusal before it propagates. */
function declaredRefusal(
  command: string,
  name: string,
  declared: readonly string[],
): WorldRefusal | null {
  if (declared.includes(name)) return null;
  return worldRefusal(
    "undeclared-partition",
    `Action "${command}" asked for partition "${name}", which it did not declare. ` +
      `Name it in the needs() of the step that reaches it, so the host loads it before that step ` +
      `runs; an undeclared partition is not resident and would not be reported dirty either.`,
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

/**
 * Drop every player this view is not about (#181).
 *
 * The roster is not a partition, so `pruneUnnamedPartitions` never saw it, and
 * a view's size stayed a function of how many people the WORLD holds rather
 * than of what the seat declared: 500 serialized `Player` elements on every
 * look, in a view whose declaration named two rooms. That is the O(world) cost
 * the partitioned model exists to delete, paid on the read path by everybody.
 *
 * NOTHING DANGLES WHEN THEY GO. A player-valued attribute does not serialize as
 * a pointer at a node: `GameElement.serializeValue` writes
 * `{ __playerRef, seat, color, name }` for one, which resolves BY SEAT and
 * carries the three facts a board reads inline. So example-rts's
 * `holding.player` is answered in full by the holding's own bytes, and the
 * roster it points into is not part of the answer.
 *
 * AND THERE IS NOTHING ELSE ON THEM TO SHIP. A player element is in no
 * partition, so nothing checkpoints a write to one -- the same fact that makes
 * an element outside every partition an illegal candidate (see
 * `docs/persistent-worlds.md`). A world's Player carries what its constructor
 * gave it and no more, which is exactly what the reference already inlined.
 *
 * TWO SURVIVE, and only two shapes of one.
 *
 *   THE VIEWER. The seat doing the looking is the one player a view is
 *   definitionally about -- the envelope says so in `player` -- and it is what
 *   a board renders as `mine`. One element, whatever the world's population.
 *
 *   WHOEVER HOLDS A NAMED PARTITION. The same path rule the partition prune
 *   keeps: a partition adopted under a player element must survive wherever the
 *   game put it, because dropping the player would drop the room.
 */
function pruneRosterToViewer(
  json: ElementJSON,
  roster: ReadonlySet<number>,
  viewer: number | undefined,
  named: ReadonlySet<number>,
): ElementJSON {
  if (roster.size === 0) return json;

  const holdsNamed = (node: ElementJSON): boolean =>
    named.has(node.id) || (node.children?.some(holdsNamed) ?? false);

  const prune = (node: ElementJSON): void => {
    if (node.children === undefined) return;
    node.children = node.children.filter(
      (child) => !roster.has(child.id) || child.id === viewer || holdsNamed(child),
    );
    for (const child of node.children) prune(child);
  };
  prune(json);
  return json;
}

/**
 * A question with no answer.
 *
 * Every candidate greyed out counts as none: a selection whose only options
 * carry a reason they cannot be taken leaves the player nothing to do, and an
 * action offered on that basis is a button whose every press is refused --
 * which is what `disabled` on the ACTION exists to say instead.
 */
function candidateless(pick: PickMetadata): boolean {
  const candidates = pick.validElements ?? pick.choices;
  if (candidates === undefined) return false;
  return !candidates.some((candidate) => candidate.disabled === undefined);
}

/**
 * The wire shape of one offered action.
 *
 * Every field the table's own `buildActionMetadata` sets, plus the one a world
 * adds. Absent rather than `undefined` throughout, because these travel as
 * JSON and a key whose value is `undefined` is a key that vanishes on the way
 * -- which makes "the bundle said nothing" and "the bundle said nothing about
 * this" indistinguishable on the far side.
 */
function offerOf(
  definition: ActionDefinition,
  selections: PickMetadata[],
  disabled: string | null,
): WorldActionOffer {
  return {
    name: definition.name,
    ...(definition.prompt === undefined ? {} : { prompt: definition.prompt }),
    ...(definition.help === undefined ? {} : { help: definition.help }),
    ...(definition.manual ? { manual: true } : {}),
    ...(definition.suppressFromActionPanel ? { suppressFromActionPanel: true } : {}),
    ...(disabled === null ? {} : { disabled }),
    selections,
  };
}

/** What one dispatch collects while the rules run. */
interface DispatchLedger {
  completed: boolean;
  readonly schedules: ScheduleRequest[];
  /** The events the handler produced, BEFORE the engine resolves who saw them
   *  -- which is why this is a `RoutedEvent` without its audience. Typed off
   *  the routed shape so a field added to one is carried by the other. */
  readonly events: Omit<RoutedEvent, "seats">[];
  /** The classified refusal a facility raised, kept so the failure path can
   *  rethrow the object rather than a fresh Error carrying only its message. */
  refused: WorldRefusal | null;
}

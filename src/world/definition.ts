/**
 * WHAT A WORLD BUNDLE EXPORTS, AND HOW A HOST TURNS IT INTO A RUNNING WORLD.
 *
 * This is the contract half of what used to be ShufflewickPub's
 * `world-runner-entry.ts`. That file did two things at once: it defined what a
 * `gameDefinition.world` block must contain and built a runner over it, and it
 * wrapped both in a Cloudflare child-isolate entry point -- a CJS splice point,
 * a `sandboxedRequire`, a `fetch` dispatch over ten operations, and the
 * bookkeeping that tells one Durable Object instance's resident tree from
 * another's. The second half is isolate plumbing and stayed with the platform.
 * This half is the contract, and a contract that lives inside one host's
 * transport is a contract every other host has to guess at.
 *
 * ## Why the checks are here and not at publish time
 *
 * Nothing that reads a game's manifest can see inside its compiled rules. A
 * bundle whose `boardsmith.json` declares `"backend": "world"` and whose code
 * exports no `world.actions` passes every validation a build can run, and then fails as a
 * runtime TypeError on somebody's first command. `readWorldDefinition` is the
 * first moment anything CAN check, so it is where the refusals live, and every
 * one of them is written for the game author rather than for whoever is reading
 * the log.
 */
import { DEFAULT_COLOR_PALETTE, WORLD_PARTITION_ID_FLOOR } from "../engine/index.js";
import type { ElementJSON, Game, GameElement } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import type { WorldViewDeclaration } from "./engine.js";
import type { ActionDefinition } from "../engine/index.js";
import { createInlinedPartitionStore, createWorldRunner } from "./runner.js";
import type { InlinedPartitionStore, WorldRunnerHandle } from "./runner.js";
import type { StoredPartition } from "./contract.js";
import { worldRefusal } from "./refusals.js";
import { assertWorldMigration, type WorldMigration } from "./migration.js";
import { worldBudgets, type WorldBudgets } from "./budgets.js";

/**
 * WHAT A WORLD BUNDLE EXPORTS ALONGSIDE ITS GAME CLASS.
 *
 * One declaration both sides import, which is the whole point of
 * `boardsmith/world`: every world bundle used to hand-copy this shape because
 * it had no way to reach it, and the four copies drifted.
 */
export interface WorldDefinition {
  /**
   * HOW MANY SEATS THIS WORLD HAS, FOR ITS WHOLE LIFETIME.
   *
   * THE ONE SEAT COUNT A WORLD HAS. A world does not start, so there is no
   * minimum to reach; a seat is assigned once and never handed on, because a
   * departed player's holdings are still standing in the world. So this is not
   * a table's roster and it does not live where a table's roster lives: a world
   * game that declared `gameDefinition.minPlayers/maxPlayers` shipped a
   * vestigial table half beside its world, and a person opened one and started
   * the table (ShufflewickPub #354).
   *
   * `boardsmith build` DERIVES the manifest's `world.maxPlayers` from this
   * number, so the compiled rules and the published manifest cannot disagree
   * about a world's capacity -- which they previously could, and only the
   * manifest's copy was ever checked at publish.
   *
   * Bounded at run time by the HOST's `budgets.maxPlayers`: this is how large a
   * world the GAME is built for, that is how large a world the host is prepared
   * to keep resident, and both doors are needed.
   */
  readonly maxPlayers: number;
  /**
   * WHAT THIS WORLD'S STORED STATE MEANS, AS A WHOLE NUMBER (#194).
   *
   * A live world is never rewritten when its bundle is replaced: its partition
   * bytes and its queued schedule rows were written by the old rules and are
   * read by the new ones. A host can compare what it can SEE -- element
   * classes, clock actions, seat count -- and refuse a version that dropped
   * one. What no host can see is a version that keeps every one of them and
   * reads an existing attribute, or an existing schedule row's frozen
   * arguments, to MEAN something new.
   *
   * Only the author knows that, so only the author can say it: bump this
   * number and the platform refuses to upgrade a running world onto the new
   * version, and its season plays out on the rules it started under. Leave it
   * alone and an upgrade is judged on what the platform can check.
   *
   * ABSENT MEANS 0, and `boardsmith build` writes the 0 down: an absent
   * declaration and an explicit `stateVersion: 0` produce the same manifest, so
   * the default is a fact of the bytes rather than a convention every reader
   * re-implements.
   *
   * DECLARED HERE, beside the seat count, because this is a statement about the
   * state the RULES define -- and because a second copy in `boardsmith.json`
   * is exactly the split #171 closed for capacity.
   */
  readonly stateVersion?: number;
  /**
   * HOW A WORLD WRITTEN UNDER AN OLDER `stateVersion` BECOMES THIS ONE (#200).
   *
   * `stateVersion` alone is a veto: bump it and a host refuses to move a
   * running world onto these rules, and that season plays out on the ones it
   * started under. Declare a migration and the answer changes from "never" to
   * "here is how" -- the author's sentence about their own bytes, which is the
   * only place it can come from.
   *
   * See `migration.ts` for what one may be, what it may not, and why it is one
   * step rather than a chain.
   */
  readonly migration?: WorldMigration;
  /**
   * THIS WORLD'S VERBS, built with `worldAction()` (#169).
   *
   * A LIST OF `ActionDefinition`s and not a table keyed by name, because that
   * is what they are: the same class a table registers, registered into the
   * same `_actions` map, enumerated by the same `getAvailableActions`. A world
   * that had its own verb type would need its own action panel, its own board
   * bridge and its own bot, which is exactly the position worlds were in.
   *
   * NAMED HERE RATHER THAN READ OFF THE GAME, because a game class may register
   * a TABLE's actions in its own constructor and those are not this world's
   * verbs. What this list holds is what a seat may be offered.
   */
  readonly actions: readonly ActionDefinition[];
  /**
   * WHAT A LOOK IS ABOUT, DECLARED OR THE WORLD DOES NOT RUN.
   *
   * Required, and the reason is a bug: partitions are absent until something
   * names them, and looking named nothing -- so a woken world answered its
   * first visitor with the root and none of the places the world is made of,
   * for as long as they refrained from acting. A default of "nothing" would be
   * that bug wearing a library decision's clothes, and a default of
   * "everything" would be the O(world) read this whole mode deletes. Only the
   * game can say, so the game must.
   *
   * A world whose view needs no partition writes `view: () => []`, for the same
   * reason a command that asks for nothing writes `args: []`: "asks for
   * nothing" and "never got round to declaring" must not look the same.
   */
  readonly view: WorldViewDeclaration;
  /**
   * THE PARTITIONS A BRAND-NEW WORLD STARTS WITH.
   *
   * The bundle is the authority, and it has to be: only the game knows what a
   * world contains before anybody has played it. Returns the ELEMENTS it
   * created, by partition name; the host records where each one hangs, because
   * `parentId` is outside the subtree and so is not in the serialized bytes.
   *
   * Optional. A world whose first command creates everything is a world, and
   * refusing it would be the library having an opinion about game design.
   */
  readonly genesis?: (game: Game) => Record<string, GameElement>;
  /**
   * A PARTITION ROOT BUILT THE FIRST TIME SOMEBODY REACHES FOR IT (#218).
   *
   * `genesis` runs once, at the world's first instant and never again, so
   * without this every root a world would ever need had to exist from the
   * start: a 500-seat world paid for 500 empires on the day it opened, and a
   * world whose rooms are discovered rather than laid out could not be written.
   *
   * A host that looks for a declared partition and finds no stored row asks
   * this before refusing. Answer the ELEMENT for a name this world creates on
   * demand -- built on the game exactly as `genesis` builds one -- and
   * `undefined` for anything else, which keeps a mistyped partition name the
   * loud refusal it has always been.
   *
   * IDEMPOTENT WITHOUT EFFORT: it is reached only when the store holds nothing
   * for that name, and once built the root is resident and then stored, so the
   * second reach finds the first one's work.
   *
   * Optional, and absent for most worlds.
   */
  readonly createPartition?: (game: Game, name: string) => GameElement | undefined;
  /**
   * WHETHER A PLAYER'S COMMAND MAY OVERTAKE AN OVERDUE EVENT
   * (ShufflewickPub #380).
   *
   * `"arrival"` -- the default, and what every world did before this existed.
   * A host drains what it can on the way in, spends a BUDGET doing it, and
   * applies the command whether or not the queue emptied. Blocking every
   * command on an arbitrarily long catch-up, with the world lock held and every
   * other socket queued behind it, is the failure that budget exists to
   * prevent, and most worlds do not care what order two unrelated things
   * happened in.
   *
   * `"chronological"` -- a world whose clock is part of its rules. Before a
   * player's command runs, every event already due at that player's arrival
   * instant is drained in nominal order, in bounded batches, and only then does
   * the command apply. It is the answer for a chain that cannot be predeclared:
   * an event that chooses an offer, creates its contract and schedules the next
   * decision cannot say which partitions that next decision needs until the
   * earlier one has committed, so a player who overtakes it produces a state no
   * punctual world reaches.
   *
   * It costs LATENCY and never correctness in the other direction: a catch-up
   * that runs out of the host's budget, or meets an event that refuses, stops
   * and the command is applied over a world that is still behind. A refusal
   * would make the player press the button again, which loses the ordering this
   * exists to keep. The player's own arrival instant, order identity and
   * receipt are untouched -- what changes is what has happened before their
   * handler runs, not when they arrived.
   */
  readonly ordering?: WorldOrdering;
  /**
   * WHAT HAPPENS WHEN A SEAT ARRIVES OR LEAVES.
   *
   * Each hook names a SEATLESS action from this world's own list, so a
   * transition is the clock acting and a world still has exactly one way to
   * change. A player who could send "seat 3 departed" would forge it;
   * `seatless` is what makes that structural.
   *
   * The library types the declaration. What a host DOES with it -- how long a
   * departure's grace is, whether a dropped socket is a departure at all,
   * whether presence is observable in the first place -- is that host's
   * lifecycle policy, and a laptop host with one browser tab answers it
   * differently from a platform holding 500 sockets.
   */
  readonly presence?: WorldPresenceDeclaration;
}

/** Each hook names a SEATLESS action from the world's own list. */
export interface WorldPresenceDeclaration {
  readonly onArrive?: string;
  readonly onDepart?: string;
  readonly departGraceMs?: number;
}

/**
 * The world half of a bundle's definition, or a refusal naming what is missing.
 *
 * `presence` is returned as the bundle wrote it. Validating it needs the host's
 * own grace bounds and its own answer to what a departure is, so the host
 * checks it; what cannot be left to the host is the SHAPE, which is why the
 * field is typed here.
 */
export function readWorldDefinition(definition: {
  world?: WorldDefinition;
}): WorldDefinition {
  const world = definition.world;
  if (!world || !Array.isArray(world.actions)) {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's gameDefinition has no `world.actions`, so it cannot run as a resident " +
        "world. A world game exports `world: { actions, view }` alongside `gameClass`, where " +
        "each action is built with `worldAction()` from `boardsmith/world` -- the manifest's " +
        '`"backend": "world"` declares the intent, and this is what implements it.',
    );
  }
  if (!Number.isInteger(world.maxPlayers) || world.maxPlayers < 1) {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `gameDefinition.world` declares no usable `world.maxPlayers`, so its world " +
        "has no seats for anybody to play. Declare the largest roster this world holds, e.g. " +
        "`world: { maxPlayers: 40, actions, view }`. It is the ONE seat count a world has -- a " +
        "world does not start, so it has no minimum to reach, and its seats are never handed on.",
    );
  }
  if (world.stateVersion !== undefined && (!Number.isInteger(world.stateVersion) || world.stateVersion < 0)) {
    throw worldRefusal(
      "bundle-not-a-world",
      `This bundle's \`gameDefinition.world\` declares stateVersion ${String(world.stateVersion)}, ` +
        "which is not a version a world can have. A stateVersion is a whole number from 0 up, " +
        "and it means \"what this world's stored partitions and queued events MEAN to these " +
        "rules\" -- bump it when a new version reads existing stored state differently, and the " +
        "platform will refuse to move a running world onto it. Leave it out entirely and this " +
        "world is version 0.",
    );
  }
  if (world.migration !== undefined) {
    assertWorldMigration(world.migration, world.stateVersion ?? 0);
  }
  if (world.ordering !== undefined && !WORLD_ORDERINGS.includes(world.ordering)) {
    throw worldRefusal(
      "bundle-not-a-world",
      `This bundle's \`gameDefinition.world\` declares \`world.ordering: ` +
        `${JSON.stringify(world.ordering)}\`, which is not an ordering a host runs. It is ` +
        `${WORLD_ORDERINGS.map((one) => `"${one}"`).join(" or ")}: "arrival" lets a player's ` +
        `command apply over whatever the host's budgeted drain reached, which is the default and ` +
        `what every world did before this existed; "chronological" drains every event already ` +
        `due at that player's arrival instant before their command runs. Leave it out for ` +
        `"arrival".`,
    );
  }
  if (typeof world.view !== "function") {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `gameDefinition.world` declares no `view`, so nothing can say what a player " +
        "who is merely LOOKING should be shown. A resident world's partitions are absent until " +
        "something names them, and a look that names nothing projects an empty world. Export " +
        "`world: { actions, genesis, view }`, where `view(seat, world)` answers the partition " +
        "names that seat's view is about -- `() => []` if it genuinely needs none. `world` is " +
        "what an earlier round already loaded, so a view about the room a player is standing in " +
        "names its index first and reads the room from it on the next round.",
    );
  }
  return world;
}

/**
 * HOW MANY SEATS THIS WORLD HAS, from the bundle that declared it.
 *
 * THE BUNDLE'S NUMBER, BOUNDED BY THE HOST'S. `maxPlayers` is what the game
 * says its world holds; `budgets.maxPlayers` is how large a world this host is
 * prepared to keep resident. Both doors are needed and neither is the other:
 * the number read here comes from the COMPILED definition, and the manifest's
 * own `world.maxPlayers` is DERIVED from it at build -- so the two agree by
 * construction, and this door is what holds the HOST's ceiling. A
 * hand-built bundle with a spotless manifest and `maxPlayers: 10_000_000` was
 * handed straight to `new GameClass({ playerCount })` beside a ten-million-entry
 * colour palette, so the door that was supposed to hold the ceiling held only
 * the floor.
 */
export function worldSeatCount(
  declaration: { maxPlayers?: unknown },
  budgets: WorldBudgets,
): number {
  const declared = declaration.maxPlayers;
  if (typeof declared !== "number" || !Number.isInteger(declared) || declared < 1) {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle declares no maxPlayers, so its world has no seats for anybody to play. " +
        "A resident world must say how many players it holds.",
    );
  }
  if (declared > budgets.maxPlayers) {
    throw worldRefusal(
      "bundle-not-a-world",
      `This bundle's compiled rules declare world.maxPlayers: ${declared}, and the largest resident ` +
        `world this host runs holds ${budgets.maxPlayers} players. A manifest's own ` +
        `world.maxPlayers is checked at build; this is the number inside the rules, which build ` +
        `validation cannot see. Lower it to ${budgets.maxPlayers} or fewer and rebuild, or raise ` +
        `the host's maxPlayers budget.`,
    );
  }
  return declared;
}

/**
 * REFUSE A SEAT THIS WORLD DOES NOT HAVE.
 *
 * The engine is constructed with exactly `seatCount` Game players, so a seat
 * past that number is a chair that does not exist -- every later view or
 * command for its holder fails deep inside game code, and the seat is burned
 * forever because seats are never reused. A host must call this BEFORE it
 * writes a seating durably, so a refusal burns nothing.
 */
export function assertSeatWithinWorld(player: string, seat: number, seatCount: number): void {
  if (Number.isInteger(seat) && seat >= 1 && seat <= seatCount) return;
  throw worldRefusal(
    "world-full",
    `Cannot seat "${player}" at seat ${seat}: this world's game declares maxPlayers: ` +
      `${seatCount}, so it holds seats 1 through ${seatCount} and no layer may mint another. ` +
      "A seat is assigned once and never handed on -- a player who leaves keeps theirs, " +
      "because their holdings are still standing in the world -- so these are all the seats " +
      "this world will ever have. A host that admits players before seating them counts those " +
      "same lifetime seats, so a joiner should have been refused before reaching this door: " +
      "what puts the two out of step is a stored player count declaring more players than the " +
      "compiled rules build. Rebuild so the declared player count matches " +
      "gameDefinition.world.maxPlayers, or raise gameDefinition.world.maxPlayers and rebuild.",
  );
}

/**
 * A DISTINCT COLOUR PER SEAT, for a world with more seats than any table has.
 *
 * THIS IS THE ENGINE'S OWN ESCAPE HATCH, taken deliberately and with its cost
 * stated. `Game` refuses to construct more players than its colour palette
 * holds, and the default palette holds 16 -- "the maximum any BoardSmith host
 * supports", says the refusal, which then names the way out: "pass a longer
 * gameOptions.colors array if you are running this game outside a host."
 *
 * A resident world IS outside that host. A table's palette is a UI affordance
 * -- sixteen colours a person can tell apart at a glance -- and a 500-player
 * world renders no such legend; what it needs from a colour is only that no two
 * seats share one. So the hues are spread evenly around the wheel and the
 * result is DETERMINISTIC: the same seat gets the same colour on every wake,
 * which matters because the colour is written into the player element and
 * therefore into every checkpoint.
 *
 * "NO TWO SEATS SHARE ONE" IS BOUNDED. Hues are rounded to whole degrees and
 * alternate over two lightnesses, so this yields 720 distinct colours and
 * duplicates above that. `worldSeatCount` refusing a bundle above
 * `budgets.maxPlayers` is what makes the promise true, which is why a host
 * raising that budget past 720 gives two seats the same colour.
 *
 * Supplied ONLY when the world is bigger than the default palette. A world of
 * eight players gets the real palette, with the names people recognise.
 */
export function worldColorPalette(seatCount: number): string[] | undefined {
  if (seatCount <= DEFAULT_COLOR_PALETTE.length) return undefined;
  return Array.from({ length: seatCount }, (_unused, index) => {
    const hue = Math.round((index * 360) / seatCount);
    // Two lightnesses, alternating, so adjacent hues stay distinguishable at
    // the small angles a large world produces.
    return hslToHex(hue, 65, index % 2 === 0 ? 50 : 38);
  });
}

/** HSL to the `#rrggbb` the engine stores. */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = l - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = (
    [
      [chroma, secondary, 0],
      [secondary, chroma, 0],
      [0, chroma, secondary],
      [0, secondary, chroma],
      [secondary, 0, chroma],
      [chroma, 0, secondary],
    ] as const
  )[sector]!;
  const channel = (value: number) =>
    Math.round((value + base) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Run the bundle's `world.genesis(game)` and collect what it built.
 *
 * The hook returns the ELEMENTS it created as `name -> element`, and this turns
 * each into the `{ parentId, json }` a store holds -- because `parentId` is the
 * host's to record, not the game's: it is outside the subtree and so is not in
 * the serialized bytes. A game that had to supply it would be told about a
 * storage detail it has no business knowing.
 */
function buildGenesis(
  game: Game,
  world: WorldDefinition,
  engine: BoardSmithWorldEngine,
): Record<string, StoredPartition> {
  if (!world.genesis) return {};

  const built = world.genesis(game);
  // NULL PROTOTYPE: the names are the bundle's. `partitions["__proto__"] =
  // record` on a plain object replaces this record's prototype instead of
  // adding an entry, so the runner would believe the partition resident --
  // `registerResident` has already run -- while the host never received it.
  const partitions: Record<string, StoredPartition> = Object.create(null) as Record<
    string,
    StoredPartition
  >;
  // GENESIS OWNS THE COUNTER (#377). This instance minted every id the world
  // has, so its counter IS the world's durable allocation -- and saying so here
  // is what lets a freshly born world create an on-demand root before any host
  // has had a chance to persist a stamp.
  engine.adoptAllocation(game.worldIdAllocation());
  for (const [name, element] of Object.entries(built)) {
    // The hook CREATED these in the live game, so they are already in the tree.
    // Telling the engine is what stops the first command trying to adopt them
    // from the store and being refused -- adoption and creation are different
    // events, and only this call site knows which one happened.
    engine.registerResident(name, element);
    partitions[name] = {
      // The ROOT is the parent, because a partition hangs from the game tree
      // and the subtree's own bytes cannot say where.
      parentId: game.id,
      json: element.toJSON() as StoredPartition["json"],
    };
  }
  return partitions;
}

/**
 * THE ALLOCATION STAMP AN OCCUPIED WORLD SHOULD HAVE (ShufflewickPub #377).
 *
 * The supported repair, and the only O(stored) step in the whole scheme: read
 * every partition the world holds, take the highest element id in any of them,
 * and the stamp is one above it. Run it ONCE -- when a world that predates the
 * stamp is first woken, or when a world's roots have already collided and are
 * being rewritten -- persist what it returns, and the world never pays for it
 * again.
 *
 * It reads BYTES, not a live tree: a host can answer this from storage without
 * hydrating anything into a game.
 */
export function worldIdAllocationOf(
  stored: Iterable<StoredPartition | ElementJSON>,
): number {
  let highest = WORLD_PARTITION_ID_FLOOR - 1;
  for (const record of stored) {
    // `StoredPartition.json` is `unknown` to a host on purpose -- it never
    // parses a partition -- so the shape is asserted here, at the one place
    // that does read inside the bytes.
    const json = ("json" in record ? record.json : record) as ElementJSON;
    highest = Math.max(highest, highestElementId(json));
  }
  return highest + 1;
}

/** Every id in a serialized subtree, which is where a stored root's ids are. */
function highestElementId(json: ElementJSON): number {
  let highest = typeof json.id === "number" ? json.id : WORLD_PARTITION_ID_FLOOR - 1;
  for (const child of json.children ?? []) {
    highest = Math.max(highest, highestElementId(child));
  }
  return highest;
}

/**
 * When a player's command runs relative to the events already due (#380).
 *
 * A closed pair rather than a boolean, because "chronological" and "arrival"
 * are both real answers a world can want and neither reads as the negation of
 * the other.
 */
export type WorldOrdering = "arrival" | "chronological";

/** The orderings a host runs, in one place, so the refusal can name them. */
export const WORLD_ORDERINGS: readonly WorldOrdering[] = ["arrival", "chronological"];

/** What a host must supply to build a world out of a bundle's definition. */
export interface WorldRunnerOptions {
  /**
   * The bundle's `gameDefinition`. Only the three members a world needs are
   * typed: the class to construct, the seat count it declares, and the world
   * block itself.
   */
  readonly definition: {
    readonly gameClass: new (options: {
      playerCount: number;
      seed: string;
      colors?: string[];
      worldMode?: boolean;
    }) => Game;
    readonly world?: WorldDefinition;
  };
  /** The world's seed. The same seed on every wake, or the world's randomness
   *  is a different world each time it is rebuilt. */
  readonly seed: string;
  /** Who sits where, as the world is built. A world's roster is not fixed at
   *  construction -- players join a season already running -- so
   *  `WorldRunnerHandle.seat` adds to it. */
  readonly seats: ReadonlyMap<string, number>;
  /** The ceilings this host runs. Omitted, the library's defaults. */
  readonly budgets?: WorldBudgets;
  /**
   * THE WORLD'S DURABLE ID ALLOCATION STAMP (ShufflewickPub #377).
   *
   * The `nextElementId` this world last reported -- from `genesis()`, from
   * `createPartition()`, or from `migrateCreate()` -- as the host persisted it.
   * Element ids outlive the process that minted them and only a fraction of the
   * partitions holding them is ever resident, so a host that omits this builds
   * a world whose counter speaks only for what it happens to have loaded.
   *
   * Omitted, the world may still be read, written and played; what it may NOT
   * do is create a partition on demand, because minting from the construction
   * floor is exactly how a cold host came to build a new root on an unloaded
   * one's identity. The instance that runs `genesis()` needs no stamp -- it
   * mints every id there is.
   *
   * For a world that was already occupied before this existed, derive the stamp
   * ONCE with {@link worldIdAllocationOf} over its stored partitions.
   */
  readonly nextElementId?: number;
}

/** A built world: the runner a host drives, and the store it feeds. */
export interface WorldRunner {
  readonly runner: WorldRunnerHandle;
  readonly store: InlinedPartitionStore;
  /** How many seats this world has, from the bundle's own declaration. A host
   *  needs it to refuse a seating before it writes one. */
  readonly seatCount: number;
}

/**
 * BUILD A WORLD FROM A BUNDLE'S DEFINITION.
 *
 * The one function every host calls, and the reason it exists: the platform's
 * Durable Object, `boardsmith dev` and a test harness must construct the same
 * world from the same declaration, or a game's local behaviour stops predicting
 * its published behaviour.
 *
 * WORLD MODE IS DECLARED AT CONSTRUCTION and is not switchable afterwards. In
 * snapshot mode an element reference serializes as a positional branch path,
 * which resolves to the WRONG element once a partition is not resident -- the
 * engine refuses to be constructed without it. It has to be a construction
 * option rather than a later call, because a game's subclass constructor builds
 * its furniture before any switch could run.
 */
export function createWorld(options: WorldRunnerOptions): WorldRunner {
  const budgets = options.budgets ?? worldBudgets();
  const world = readWorldDefinition(options.definition);
  // THE WORLD BLOCK'S OWN NUMBER. Not `definition.maxPlayers`: a table's roster
  // is a different fact, and a world game that has one at all is one #174 has
  // not reached yet.
  const seatCount = worldSeatCount(world, budgets);
  for (const [player, seat] of options.seats) {
    assertSeatWithinWorld(player, seat, seatCount);
  }

  const game = new options.definition.gameClass({
    playerCount: seatCount,
    seed: options.seed,
    colors: worldColorPalette(seatCount),
    worldMode: true,
  });
  // CONSTRUCTION BELOW, THE DURABLE WORLD ABOVE (#218). Everything the game
  // class built for itself -- players most of all -- has an id below the floor;
  // everything genesis and every command build has one above it. That is what
  // lets `world.maxPlayers` change on a live world without the wider
  // construction minting ids its stored partitions already hold.
  game.reserveConstructionIdSpace();

  const store = createInlinedPartitionStore();
  const engine = new BoardSmithWorldEngine({
    game,
    seats: options.seats,
    store,
    actions: world.actions,
    view: world.view,
    budgets,
    // A world that builds a root the first time somebody reaches for it (#218).
    // Absent for a world whose every root came from genesis, which is most.
    ...(world.createPartition === undefined ? {} : { createPartition: world.createPartition }),
    // THE HOST'S PERSISTED ALLOCATION (#377), or nothing -- and a world built
    // with nothing refuses to mint rather than minting a guess.
    ...(options.nextElementId === undefined ? {} : { nextElementId: options.nextElementId }),
  });
  const runner = createWorldRunner(
    engine,
    store,
    () => buildGenesis(game, world, engine),
    // The bundle's own migration hooks, or a world that declares none. The
    // engine refuses a duplicate name and an unusable answer; what is decided
    // here is only which hooks exist at all.
    {
      ...(world.migration?.partition === undefined
        ? {}
        : { partition: world.migration.partition }),
      ...(world.migration?.create === undefined ? {} : { create: world.migration.create }),
      ...(world.migration?.finalize === undefined ? {} : { finalize: world.migration.finalize }),
    },
  );
  return { runner, store, seatCount };
}


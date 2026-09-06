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
 * bundle whose `boardsmith.json` declares a world and whose code exports no
 * `world.commands` passes every validation a build can run, and then fails as a
 * runtime TypeError on somebody's first command. `readWorldDefinition` is the
 * first moment anything CAN check, so it is where the refusals live, and every
 * one of them is written for the game author rather than for whoever is reading
 * the log.
 */
import { DEFAULT_COLOR_PALETTE } from "../engine/index.js";
import type { Game, GameElement } from "../engine/index.js";
import { BoardSmithWorldEngine } from "./engine.js";
import type { WorldViewDeclaration } from "./engine.js";
import type { ActionDefinition } from "../engine/index.js";
import { createInlinedPartitionStore, createWorldRunner } from "./runner.js";
import type { InlinedPartitionStore, WorldRunnerHandle } from "./runner.js";
import type { StoredPartition } from "./contract.js";
import { worldRefusal } from "./refusals.js";
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
        "`world` block declares the intent, and this is what implements it.",
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
 * a build can cap what a manifest declares, but the number read here comes from
 * the COMPILED definition, which a build's manifest validation never sees. A
 * hand-built bundle with a spotless manifest and `maxPlayers: 10_000_000` was
 * handed straight to `new GameClass({ playerCount })` beside a ten-million-entry
 * colour palette, so the door that was supposed to hold the ceiling held only
 * the floor.
 */
export function worldSeatCount(
  definition: { maxPlayers?: unknown },
  budgets: WorldBudgets,
): number {
  const declared = definition.maxPlayers;
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
      `This bundle's compiled rules declare maxPlayers: ${declared}, and the largest resident ` +
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
      "gameDefinition.maxPlayers, or raise gameDefinition.maxPlayers and rebuild.",
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
    readonly maxPlayers?: unknown;
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
  const seatCount = worldSeatCount(options.definition, budgets);
  for (const [player, seat] of options.seats) {
    assertSeatWithinWorld(player, seat, seatCount);
  }

  const game = new options.definition.gameClass({
    playerCount: seatCount,
    seed: options.seed,
    colors: worldColorPalette(seatCount),
    worldMode: true,
  });

  const store = createInlinedPartitionStore();
  const engine = new BoardSmithWorldEngine({
    game,
    seats: options.seats,
    store,
    actions: world.actions,
    view: world.view,
    budgets,
  });
  const runner = createWorldRunner(engine, store, () => buildGenesis(game, world, engine));
  return { runner, store, seatCount };
}

